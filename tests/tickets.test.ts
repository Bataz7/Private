/** اختبار نظام التذاكر والترحيب مع REST وهمي (بدون اتصال بديسكورد). */
import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "tk-"));
process.env.DATA_DIR = dir;
const G = "111111111111111111";
const SUPPORT = "222222222222222222";
const CAT = "333333333333333333";
const LOG = "444444444444444444";
const OWNER = "555555555555555555";
const BOT = "666666666666666666";
writeFileSync(join(dir, "tickets_data.json"), `{"${G}": {"1": {"name": "دعم", "category_id": ${CAT}, "support_role_id": ${SUPPORT}, "ticket_mod_role_id": null, "log_channel_id": ${LOG}, "rating_channel_id": ${LOG}, "preset": "support"}}}`);

const { Bot } = await import("../src/discord/client.ts");
const tickets = (await import("../src/features/tickets.ts")).default;
const welcome = await import("../src/features/welcome.ts");
const { startJobs, enqueueJob, waitJob } = await import("../src/core/jobs.ts");

const bot = new Bot("x.y.z", 0);
bot.appId = "999";
bot.user = { id: BOT, username: "bot", globalName: null, avatar: null, bot: true };
type Call = { m: string; path: string; opts: any };
const calls: Call[] = [];
let nextId = 900;
const memberRaw = (id: string, roles: string[] = []) => ({ user: { id, username: `u${id.slice(0, 3)}`, avatar: null }, roles, nick: null });
for (const m of ["get", "post", "put", "patch", "delete"]) {
  (bot.rest as any)[m] = async (path: string, opts: any = {}) => {
    calls.push({ m, path, opts });
    if (m === "post" && path === `/guilds/${G}/channels`) return { id: "777777777777777777" };
    if (m === "post" && path.endsWith("/messages")) return { id: String(nextId++), channel_id: path.split("/")[2] };
    if (m === "post" && path === "/users/@me/channels") return { id: "888888888888888888" };
    if (m === "get" && path.startsWith(`/guilds/${G}/members/`)) return memberRaw(path.split("/").pop()!);
    if (m === "get" && /\/channels\/\d+\/messages\/\d+$/.test(path)) return { id: path.split("/").pop(), flags: 1 << 15 };
    if (m === "get" && /\/channels\/\d+\/messages$/.test(path)) {
      return opts.query?.after === "0" ? [{ id: "2", content: "<b>مرحبا</b>", author: { id: OWNER, username: "ali" }, timestamp: "2025-01-01T10:00:00Z", embeds: [], attachments: [] },
        { id: "1", content: "", author: { id: BOT, username: "bot", bot: true }, timestamp: "2025-01-01T09:59:00Z", embeds: [{ title: "t" }], attachments: [] }] : [];
    }
    return {};
  };
}
(bot as any).dispatch("GUILD_CREATE", {
  id: G, name: "سيرفر", owner_id: "1", member_count: 42,
  roles: [{ id: G, name: "@everyone", position: 0, permissions: "0" }, { id: SUPPORT, name: "دعم", position: 1, permissions: "0" }],
  channels: [{ id: CAT, type: 4, name: "tickets" }, { id: LOG, type: 0, name: "log" }],
});
tickets(bot);
welcome.default(bot);

let iid = 0;
function interact(type: number, data: any, o: { channel?: string; user?: string; roles?: string[]; perms?: string; message?: any; guild?: boolean } = {}) {
  const i = {
    id: String(++iid), token: `tok${iid}`, type, guild_id: o.guild === false ? undefined : G, channel_id: o.channel ?? LOG,
    member: o.guild === false ? undefined : { ...memberRaw(o.user ?? OWNER, o.roles), permissions: o.perms ?? "0" },
    user: o.guild === false ? memberRaw(o.user ?? OWNER).user : undefined, data, message: o.message,
  };
  return (bot as any).onInteraction(i);
}
const cb = (n: number) => calls.find((c) => c.path === `/interactions/${n}/tok${n}/callback`)?.opts.body;

test("open → questions modal → channel created with V2 control message", async () => {
  await interact(3, { custom_id: "persistent_open_ticket_1", component_type: 2 });
  const r = cb(iid);
  expect(r.type).toBe(9);
  expect(r.data.custom_id).toBe("tk:q:1");
  expect(r.data.components.length).toBe(4);

  await interact(5, { custom_id: "tk:q:1", components: [{ type: 1, components: [{ custom_id: "kind", value: "خطأ" }] }, { type: 1, components: [{ custom_id: "desc", value: "تفاصيل\nسطر" }] }] });
  const create = calls.find((c) => c.path === `/guilds/${G}/channels`)!;
  expect(create.opts.body.parent_id).toBe(CAT);
  expect(create.opts.body.name).toStartWith("تذكرة-0001-");
  expect(create.opts.body.name).toEndWith("-1");
  const ow = create.opts.body.permission_overwrites;
  expect(ow.find((x: any) => x.id === SUPPORT)).toBeTruthy();
  const send = calls.find((c) => c.m === "post" && c.path === "/channels/777777777777777777/messages")!;
  expect(send.opts.body.flags).toBe(1 << 15);
  const json = JSON.stringify(send.opts.body.components);
  expect(json).toContain("persistent_claim_ticket_btn");
  expect(json).toContain("persistent_ticket_actions_select");
  expect(json).toContain("خطأ");
  const row = (await import("../src/features/tickets.ts"))._test.getRow("777777777777777777")!;
  expect(row.user_id).toBe(OWNER);
  expect(row.control_msg_id).toBeTruthy();
  expect(JSON.parse(row.answers!)).toEqual([["ما نوع المشكلة؟", "خطأ"], ["اشرح مشكلتك بالتفصيل", "تفاصيل\nسطر"]]);
});

test("claim by staff only, then refresh control message", async () => {
  await interact(3, { custom_id: "persistent_claim_ticket_btn", component_type: 2 }, { channel: "777777777777777777", user: "123456789012345678" });
  expect(cb(iid).data.content).toContain("للإدارة");
  await interact(3, { custom_id: "persistent_claim_ticket_btn", component_type: 2 }, { channel: "777777777777777777", user: "123456789012345678", roles: [SUPPORT] });
  expect(cb(iid).data.embeds[0].description).toContain("استلم");
  const { getRow } = (await import("../src/features/tickets.ts"))._test;
  expect(getRow("777777777777777777")!.claimed_by).toBe("123456789012345678");
  expect(calls.some((c) => c.m === "patch" && c.path.startsWith("/channels/777777777777777777/messages/"))).toBe(true);
});

test("close → transcript to log + rating DM, then delete; rating works", async () => {
  await interact(5, { custom_id: "tk:close", components: [{ type: 1, components: [{ custom_id: "r", value: "انحلت" }] }] }, { channel: "777777777777777777" });
  const log = calls.find((c) => c.m === "post" && c.path === `/channels/${LOG}/messages` && c.opts.files)!;
  expect(log.opts.files[0].name).toBe("نسخة-تذكرة-1.html");
  const html = new TextDecoder().decode(log.opts.files[0].data);
  expect(html).toContain("&lt;b&gt;مرحبا&lt;/b&gt;");
  expect(html.indexOf("<span class=b>بوت</span>")).toBeLessThan(html.indexOf("مرحبا"));
  const dm = calls.find((c) => c.path === "/channels/888888888888888888/messages")!;
  expect(JSON.stringify(dm.opts.body.components)).toContain("persistent_rating_select");
  expect(calls.some((c) => c.m === "delete" && c.path === "/channels/777777777777777777")).toBe(true);
  const { getRow } = (await import("../src/features/tickets.ts"))._test;
  const row = getRow("777777777777777777")!;
  expect(row.status).toBe("closed");
  await interact(3, { custom_id: "persistent_rating_select", component_type: 3, values: ["4"] }, { guild: false, channel: "888888888888888888", message: { id: row.rating_msg_id } });
  expect(cb(iid).type).toBe(7);
  expect(getRow("777777777777777777")!.rating).toBe(4);
}, 15_000);

test("dashboard ticket-panel job sends a V2 panel", async () => {
  startJobs();
  const id = enqueueJob("ticket-panel", G, { channel_id: LOG, title: "الدعم", desc: "اختر", image: "", display: "buttons", nums: ["1", "7"] });
  const r = await waitJob(id, 8000);
  expect(r).toEqual({ ok: true, message: "تم إرسال البانل" });
  const send = calls.filter((c) => c.m === "post" && c.path === `/channels/${LOG}/messages`).pop()!;
  const json = JSON.stringify(send.opts.body.components);
  expect(json).toContain("persistent_open_ticket_1");
  expect(json).not.toContain("persistent_open_ticket_7");
  const bad = await waitJob(enqueueJob("ticket-panel", G, { channel_id: LOG, title: "x", desc: "y", nums: ["9"] }), 8000);
  expect(bad).toEqual({ ok: false, message: "التذاكر المحددة غير مسطّبة" });
}, 20_000);

test("welcome: V2 card on join, embed when card off", async () => {
  const { saveCfg, defaults } = welcome._test;
  saveCfg(G, "welcome", { ...defaults(), channel_id: LOG, color: "أحمر", card_bg: "https://x.y/bg.png", embed_text: "هلا {user} في {server} رقم {count}" });
  (bot as any).cache.putMember({ id: BOT, username: "bot", globalName: null, avatar: null, bot: true, guildId: G, roles: [], nick: null, memberAvatar: null, joinedAt: null, communicationDisabledUntil: null });
  bot.guild(G)!.roles.get(G)!.permissions = (1n << 10n) | (1n << 11n) | (1n << 14n);
  const before = calls.length;
  (bot as any).dispatch("GUILD_MEMBER_ADD", { guild_id: G, ...memberRaw(OWNER) });
  await Bun.sleep(50);
  const send = calls.slice(before).find((c) => c.m === "post" && c.path === `/channels/${LOG}/messages`)!;
  expect(send.opts.body.flags).toBe(1 << 15);
  const box = send.opts.body.components[0];
  expect(box.accent_color).toBe(0xff5470);
  const json = JSON.stringify(box);
  expect(json).toContain(`هلا <@${OWNER}> في سيرفر رقم 43`);
  expect(json).toContain("https://x.y/bg.png");
  expect(json).toContain("العضو رقم 43");

  saveCfg(G, "goodbye", { ...defaults(), channel_id: LOG, card: 0, outside_text: "باي {name}" });
  const b2 = calls.length;
  (bot as any).dispatch("GUILD_MEMBER_REMOVE", { guild_id: G, user: memberRaw(OWNER).user });
  await Bun.sleep(50);
  const s2 = calls.slice(b2).find((c) => c.m === "post" && c.path === `/channels/${LOG}/messages`)!;
  expect(s2.opts.body.flags).toBeUndefined();
  expect(s2.opts.body.content).toBe("باي u555");
  expect(s2.opts.body.embeds[0].description).toContain("غادر");
});

test("welcome studio opens as ephemeral V2 and toggles", async () => {
  await interact(2, { name: "الترحيب", options: [{ type: 1, name: "اعداد", options: [] }] }, { perms: String(1n << 5n) });
  const r = cb(iid);
  expect(r.data.flags & (1 << 15)).toBeTruthy();
  expect(r.data.flags & (1 << 6)).toBeTruthy();
  const json = JSON.stringify(r.data.components);
  const id = /"(wl:st:[a-z0-9]+):card"/.exec(json)![1];
  await interact(3, { custom_id: `${id}:card`, component_type: 2 }, { perms: String(1n << 5n) });
  expect(cb(iid).type).toBe(7);
  expect(JSON.stringify(cb(iid).data.components)).toContain("البطاقة معطّلة");
});
