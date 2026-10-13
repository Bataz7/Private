/**
 * سيرفر Discord وهمي (Gateway + REST) لاختبار البوت محلياً وقياس الذاكرة تحت ضغط — بدون توكن حقيقي.
 *
 *   bun scripts/mock-discord.ts &
 *   DISCORD_TOKEN=aaaaaaaaaaaaaaaaaaaaaaaa.bbbbbb.ccccccccccccccccccccccccccccccccccccccc \
 *   DISCORD_API_BASE=http://127.0.0.1:37999/api/v10 DISCORD_GATEWAY_URL=ws://127.0.0.1:37999/gw SUPABASE_URL=http://127.0.0.1:37999 bun --smol src/index.ts
 * (يحاكي Supabase كمان على /rest/v1 — انظر scripts/mock-supabase.ts)
 *
 * متغيرات: MOCK_PORT · MOCK_GUILDS · MOCK_CHANNELS · MOCK_ROLES · MOCK_VOICE · MOCK_MSG_PER_SEC · MOCK_INTERACTIONS_PER_SEC
 */
import { db as sb, handleSupabase } from "./mock-supabase.ts";

const PORT = Number(process.env.MOCK_PORT ?? 37999);
const GUILDS = Number(process.env.MOCK_GUILDS ?? 5);
const CHANNELS = Number(process.env.MOCK_CHANNELS ?? 150);
const ROLES = Number(process.env.MOCK_ROLES ?? 100);
const VOICE = Number(process.env.MOCK_VOICE ?? 40);
const MSG_RATE = Number(process.env.MOCK_MSG_PER_SEC ?? 40);
const INT_RATE = Number(process.env.MOCK_INTERACTIONS_PER_SEC ?? 3);

let snow = 1_100_000_000_000_000_000n;
const id = () => String(++snow);
const APP_ID = "1200000000000000001";
const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)]!;
const stats = { rest: 0, events: 0, interactions: 0 };

interface G { id: string; roles: string[]; text: string[]; voice: string[]; users: string[] }
const guilds: G[] = [];
for (let i = 0; i < GUILDS; i++) {
  const g: G = { id: id(), roles: [], text: [], voice: [], users: [] };
  for (let r = 0; r < ROLES; r++) g.roles.push(id());
  for (let c = 0; c < CHANNELS; c++) (c % 10 === 0 ? g.voice : g.text).push(id());
  for (let u = 0; u < 500; u++) g.users.push(id());
  guilds.push(g);
  sb.seed("guild_settings", [{
    guild_id: g.id, staff_role_id: g.roles[0], on_shift_role_id: g.roles[1], leave_role_id: g.roles[2], management_role_id: g.roles[3],
    shift_channel_id: g.text[0], leave_channel_id: g.text[1], resignation_channel_id: g.text[2], logs_channel_id: g.text[3], report_channel_id: g.text[4],
    bot_language: "ar", auto_shift_enabled: true, auto_shift_messages: 5, auto_shift_window_minutes: 10, auto_shift_idle_minutes: 30,
    custom_statuses: ["Rift {staff} ستاف"], custom_status_interval: 30, bot_status: "online", weekly_enabled: false,
    ...(process.env.MOCK_SCENARIO && !process.env.MOCK_MISSING_COLUMNS ? { leaderboard_channel_id: g.text[5], leaderboard_week: "2020-01-03T21:00:00.000Z", presence_check_minutes: 60, presence_check_timeout_minutes: 30, warn_limit: 3 } : {}),
  }]);
}
// MOCK_SCENARIO=1: ستاف في الفويس بشفتات قديمة (تحقق التواجد يرسل/يوقف) + نقاط هذا الأسبوع (لوحة المتصدرين).
if (process.env.MOCK_SCENARIO) {
  const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  for (const g of guilds) {
    const staffInVoice = g.users.slice(0, VOICE).filter((u) => Number(u.slice(-1)) % 2 === 0).slice(0, 6);
    staffInVoice.forEach((u, i) => {
      sb.seed("staff", [{ id: 900000 + Number(u.slice(-5)), guild_id: g.id, user_id: u, active: true, points: 10 * i, message_count: 0, voice_minutes: 0, claimed: 0, joined_at: ago(9999) }]);
      // 0-2: آخر تفاعل قبل ساعتين → يرسل السؤال · 3-4: سؤال قبل 40 دقيقة → يوقف · 5: نشط
      const row: Record<string, unknown> = { id: 800000 + Number(u.slice(-5)), guild_id: g.id, user_id: u, status: "active", started_at: ago(180), last_activity_at: ago(i < 3 ? 120 : i < 5 ? 110 : 5), breaks: [], points_awarded: 0 };
      if (i === 3 || i === 4) row.check_sent_at = ago(40);
      sb.seed("shifts", [row]);
      sb.seed("points_ledger", [{ id: 700000 + Number(u.slice(-5)), guild_id: g.id, user_id: u, delta: 5 + i, source: "shift", created_at: ago(30) }]);
    });
  }
}
const user = (uid: string) => ({ id: uid, username: `user${uid.slice(-4)}`, global_name: `مستخدم ${uid.slice(-4)}`, avatar: null, discriminator: "0" });
// نص الأعضاء ستاف (رتبة الستاف = أول رتبة)
const isStaff = (uid: string) => Number(uid.slice(-1)) % 2 === 0;
const member = (g: G, uid: string) => ({ user: user(uid), roles: isStaff(uid) ? [g.roles[0]!, pick(g.roles)] : [pick(g.roles)], nick: null, joined_at: new Date().toISOString(), permissions: "0" });

function guildCreate(g: G) {
  return {
    id: g.id, name: `سيرفر تجربة ${g.id.slice(-3)}`, icon: null, owner_id: g.users[0], member_count: 5000, afk_channel_id: null,
    roles: [{ id: g.id, name: "@everyone", position: 0, permissions: "1071698660929", color: 0, managed: false },
      ...g.roles.map((r, i) => ({ id: r, name: `رتبة ${i}`, position: i + 1, permissions: i === ROLES - 1 ? "8" : "0", color: 0x3498db, managed: false }))],
    channels: [...g.text.map((c, i) => ({ id: c, name: `شات-${i}`, type: 0, position: i, parent_id: null, permission_overwrites: [{ id: g.id, type: 0, allow: "0", deny: "2048" }] })),
      ...g.voice.map((c, i) => ({ id: c, name: `صوتي ${i}`, type: 2, position: i, parent_id: null, permission_overwrites: [] }))],
    threads: [],
    voice_states: g.users.slice(0, VOICE).map((u) => ({ user_id: u, channel_id: pick(g.voice), self_mute: false, self_deaf: false, mute: false, deaf: false })),
    members: g.users.slice(0, VOICE).map((u) => member(g, u)),
    presences: [],
  };
}

let seq = 0;
const sockets = new Set<any>();
const send = (ws: any, t: string | null, d: unknown, op = 0) => {
  ws.send(JSON.stringify({ op, d, s: op === 0 ? ++seq : null, t }));
  stats.events++;
};

function interaction(name: string, g: G, options: any[] = []) {
  if (name.includes(" ")) {
    const [cmd, sub] = name.split(" ");
    name = cmd!;
    options = [{ type: 1, name: sub, options }];
  }
  const uid = pick(g.users);
  return {
    id: id(), application_id: APP_ID, type: 2, token: `tok${id()}`, version: 1, guild_id: g.id, channel_id: pick(g.text),
    member: member(g, uid), app_permissions: "8", locale: "ar",
    data: { id: id(), name, type: 1, options, resolved: {} },
  };
}

function flood() {
  for (const ws of sockets) {
    for (let i = 0; i < MSG_RATE; i++) {
      const g = pick(guilds);
      const uid = pick(g.users);
      const r = Math.random();
      if (r < 0.8) {
        send(ws, "MESSAGE_CREATE", {
          id: id(), channel_id: pick(g.text), guild_id: g.id, author: user(uid), member: { roles: [pick(g.roles)], joined_at: new Date().toISOString() },
          content: `رسالة تجريبية رقم ${seq} ${"كلام ".repeat(Math.floor(Math.random() * 30))}`, attachments: [], embeds: [], mentions: [], type: 0,
          timestamp: new Date().toISOString(),
        });
      } else if (r < 0.9) {
        send(ws, "VOICE_STATE_UPDATE", { guild_id: g.id, user_id: uid, channel_id: Math.random() < 0.5 ? pick(g.voice) : null, member: member(g, uid), self_mute: false, self_deaf: false, mute: false, deaf: false });
      } else if (r < 0.95) {
        send(ws, "MESSAGE_DELETE", { id: String(snow - BigInt(Math.floor(Math.random() * 50))), channel_id: pick(g.text), guild_id: g.id });
      } else {
        send(ws, "GUILD_MEMBER_ADD", { ...member(g, id()), guild_id: g.id });
      }
    }
    for (let i = 0; i < INT_RATE; i++) {
      const g = pick(guilds);
      send(ws, "INTERACTION_CREATE", interaction(pick(["points", "staff leaderboard", "shift status", "shift stats", "profile", "weekly-top", "report stats"]), g));
      stats.interactions++;
    }
  }
}
setInterval(flood, 1000);
setInterval(() => console.log(`[mock] rest=${stats.rest} events=${stats.events} interactions=${stats.interactions} db=${JSON.stringify(sb.stats())}`), 10_000);

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(req, server) {
    const url = new URL(req.url);
    const sbRes = await handleSupabase(req, url);
    if (sbRes) return sbRes;
    if (url.pathname.startsWith("/gw")) {
      return server.upgrade(req) ? undefined : new Response("upgrade failed", { status: 400 });
    }
    stats.rest++;
    const p = url.pathname.replace(/^\/api\/v10/, "");
    const m = req.method;
    if (m === "GET" && p === "/applications/@me") return Response.json({ id: APP_ID, name: "Rift" });
    if (p.includes("/emojis") && m === "GET") return Response.json({ items: [] });
    if (p.includes("/emojis") && m === "POST") {
      const b = (await req.json().catch(() => ({}))) as { name?: string };
      return Response.json({ id: id(), name: b.name ?? "e", animated: false });
    }
    if (p === "/users/@me/channels") return Response.json({ id: id(), type: 1 });
    if (/\/channels\/\d+\/messages$/.test(p) && m === "POST") return Response.json({ id: id(), channel_id: p.split("/")[2] });
    if (/\/channels\/\d+\/messages\/\d+$/.test(p) && (m === "PATCH" || m === "GET")) return Response.json({ id: p.split("/")[4], channel_id: p.split("/")[2] });
    if (/\/interactions\/\d+\/[^/]+\/callback/.test(p)) return new Response(null, { status: 204 });
    if (/\/webhooks\//.test(p)) return Response.json({ id: id(), channel_id: id() });
    const mm = /^\/guilds\/(\d+)\/members\/(\d+)$/.exec(p);
    if (mm && m === "GET") {
      const g = guilds.find((x) => x.id === mm[1]) ?? guilds[0]!;
      return Response.json(member(g, mm[2]!));
    }
    if (/^\/guilds\/\d+\/members$/.test(p)) return Response.json([]);
    if (m === "PUT" && p.includes("/commands")) return Response.json([]);
    if (m === "GET" && p.startsWith("/users/")) return Response.json(user(p.split("/")[2]!));
    if (m === "GET") return Response.json([]);
    return new Response(null, { status: 204 });
  },
  websocket: {
    open(ws) {
      sockets.add(ws);
      ws.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 41250 } }));
    },
    message(ws, raw) {
      const p = JSON.parse(String(raw));
      if (p.op === 1) ws.send(JSON.stringify({ op: 11 }));
      if (p.op === 2) {
        send(ws, "READY", { v: 10, user: { id: APP_ID, username: "Rift", bot: true, avatar: null }, guilds: guilds.map((g) => ({ id: g.id, unavailable: true })), session_id: "mock", resume_gateway_url: `ws://127.0.0.1:${PORT}/gw`, application: { id: APP_ID } });
        for (const g of guilds) send(ws, "GUILD_CREATE", guildCreate(g));
      }
      if (p.op === 6) send(ws, "RESUMED", {});
    },
    close(ws) {
      sockets.delete(ws);
    },
  },
});
console.log(`[mock] Discord mock on 127.0.0.1:${PORT} · ${GUILDS} guilds × ${CHANNELS} channels × ${ROLES} roles · ${MSG_RATE} msg/s · ${INT_RATE} interactions/s`);
