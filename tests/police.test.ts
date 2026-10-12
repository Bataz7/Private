/** نظام الشفت: دخول/خروج، «هل انت موجود؟»، الإيقاف الصامت، والتأكيد بالرد — بدون اتصال بديسكورد. */
import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "police-"));
const { Bot } = await import("../src/discord/client.ts");
const police = await import("../src/features/police.ts");
const T = police._test;

const GID = "1100000000000000001";
const UID = "1100000000000000002";
const VC = "1100000000000000003";
const MIL = "1100000000000000004";

interface Call { method: string; path: string; body?: any }
const calls: Call[] = [];
let seq = 1000;
const fakeRest = {
  async request(method: string, path: string, o: any = {}) {
    calls.push({ method, path, body: o.body });
    if (path === "/users/@me/channels") return { id: "dm1" };
    if (path.endsWith("/messages") && method === "POST") return { id: `m${++seq}`, channel_id: path.split("/")[2] };
    return {};
  },
  get(p: string, o?: any) { return this.request("GET", p, o); },
  post(p: string, o?: any) { return this.request("POST", p, o); },
  put(p: string, o?: any) { return this.request("PUT", p, o); },
  patch(p: string, o?: any) { return this.request("PATCH", p, o); },
  delete(p: string, o?: any) { return this.request("DELETE", p, o); },
};

const bot = new Bot("x.y.z", 0);
(bot as any).rest = fakeRest;
police.default(bot);
const dispatch = (t: string, d: any) => (bot as any).dispatch(t, d);
const member = { user: { id: UID, username: "jndi", global_name: "عسكري" }, roles: [MIL], joined_at: null };

dispatch("READY", { user: { id: "1", username: "bot" }, guilds: [] });
dispatch("GUILD_CREATE", {
  id: GID, name: "سيرفر", owner_id: "9", member_count: 10, roles: [{ id: GID, name: "@everyone", position: 0, permissions: "0" }],
  channels: [{ id: VC, name: "شفت", type: 2, position: 0, permission_overwrites: [] }], voice_states: [], members: [],
});
(bot as any).ready = true;
T.setSettings(GID, { military_role_id: MIL, shift_points: 1, shift_block: 10, shift_min: 15, check_after: 60, check_timeout: 30 });
T.sql.run("INSERT OR IGNORE INTO shift_channels VALUES (?, ?)", GID, VC);
T.channelsCache.clear();

const key = `${GID}:${UID}`;
const join_ = async () => dispatch("VOICE_STATE_UPDATE", { guild_id: GID, user_id: UID, channel_id: VC, member });
const leave = async () => dispatch("VOICE_STATE_UPDATE", { guild_id: GID, user_id: UID, channel_id: null, member });
const flush = () => new Promise((r) => setTimeout(r, 20));
const points = () => police.getPoints(GID, UID);

describe("police shifts", () => {
  beforeEach(async () => {
    await leave();
    await flush();
    T.active.clear();
    T.blocked.clear();
    T.sql.run("DELETE FROM user_points");
    T.sql.run("DELETE FROM shifts");
    T.sql.run("DELETE FROM shift_blocks");
    T.sql.run("DELETE FROM active_shifts");
    calls.length = 0;
  });

  test("points formula", () => {
    expect(police.pointsFor(GID, 14 * 60)).toBe(0);
    expect(police.pointsFor(GID, 15 * 60)).toBe(1);
    expect(police.pointsFor(GID, 65 * 60)).toBe(6);
  });

  test("join then leave awards points", async () => {
    await join_();
    await flush();
    expect(T.active.has(key)).toBe(true);
    T.active.get(key)!.start_ts -= 45 * 60;
    await leave();
    await flush();
    expect(T.active.has(key)).toBe(false);
    expect(points()).toBe(4);
  });

  test("no answer → silent stop, check deleted, counted until the check, blocked until rejoin", async () => {
    await join_();
    await flush();
    const s = T.active.get(key)!;
    s.start_ts -= 61 * 60;
    s.last_confirm_ts -= 61 * 60;
    await T.tick!();
    const dms = calls.filter((c) => c.path === "/channels/dm1/messages");
    expect(dms.length).toBe(1);
    expect(JSON.stringify(dms[0]!.body)).toContain("هل انت موجود");
    expect(s.check_sent_ts).toBeTruthy();
    s.check_sent_ts! -= 31 * 60;
    const before = calls.length;
    await T.tick!();
    expect(T.active.has(key)).toBe(false);
    const after = calls.slice(before);
    expect(after.some((c) => c.method === "DELETE" && c.path.startsWith("/channels/dm1/messages/"))).toBe(true); // رسالة التحقق انحذفت
    expect(after.some((c) => c.method === "POST" && c.path === "/channels/dm1/messages")).toBe(false); // ما انرسل له شي
    expect(T.blocked.has(key)).toBe(true);
    const row = T.sql.get<{ end_reason: string; points: number }>("SELECT end_reason, points FROM shifts")!;
    expect(row.end_reason).toBe("afk");
    expect(row.points).toBe(3); // ~30 دقيقة (حتى إرسال التحقق)
    await T.tick!();
    expect(T.active.has(key)).toBe(false); // ما يرجع يبدأ وهو في الروم
    await leave();
    await join_();
    await flush();
    expect(T.active.has(key)).toBe(true); // طلع ورجع → شفت جديد
  });

  test("replying in DM confirms presence", async () => {
    await join_();
    await flush();
    const s = T.active.get(key)!;
    s.last_confirm_ts -= 61 * 60;
    await T.tick!();
    expect(s.check_sent_ts).toBeTruthy();
    dispatch("MESSAGE_CREATE", { id: "77", channel_id: "dm1", author: { id: UID, username: "jndi" }, content: "موجود" });
    await flush();
    expect(s.check_sent_ts).toBeNull();
    expect(T.active.has(key)).toBe(true);
  });

  test("members without the military role don't get shifts", async () => {
    dispatch("VOICE_STATE_UPDATE", { guild_id: GID, user_id: UID, channel_id: VC, member: { ...member, roles: [] } });
    await flush();
    expect(T.active.has(key)).toBe(false);
  });

  test("Arabic command names", () => {
    const names = [...bot.commands.keys()];
    expect(names).toContain("نقاطي");
    expect(names).toContain("فصل");
    expect(names.every((n) => !/[A-Za-z]/.test(n))).toBe(true);
  });
});
