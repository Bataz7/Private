/**
 * وزارة الداخلية — نقاط العساكر، الشفتات التلقائية، الإنذارات والفصل، وبطاقة النقاط.
 *
 * الشفت التلقائي:
 * - العسكري يدخل روم شفت صوتي → يبدأ شفته، يطلع من رومات الشفت → ينتهي ويأخذ نقاطه.
 * - كل ساعة (قابلة للتعديل) يرسل له «هل انت موجود؟» بالخاص (أو في شات الروم الصوتي لو خاصه مقفل).
 * - لو ما ضغط الزر أو رد أو تفاعل خلال نص ساعة: يوقف الشفت بصمت (بدون أي رسالة له) وتنحذف رسالة التحقق،
 *   ويُحسب له الوقت حتى لحظة إرسال التحقق فقط. ما يبدأ له شفت جديد إلا إذا طلع من الروم ورجع.
 * - الشفتات النشطة محفوظة في قاعدة البيانات فإعادة تشغيل البوت ما تضيّعها.
 */
import type { Bot } from "../discord/client.ts";
import type { CMember } from "../discord/cache.ts";
import type { Ctx } from "../discord/ctx.ts";
import { ButtonStyle, ChannelType, MessageFlags, P } from "../discord/constants.ts";
import { db } from "../core/db.ts";
import { log } from "../core/log.ts";
import { o } from "../core/opts.ts";
import {
  COLORS, bar, button, clip, container, dur, embed, field, fmt, input, mention, modal, now, row, section, select, sep, text, thumb, ts, userSelect, V2,
} from "../core/ui.ts";

const sql = db("police_points.db");

const NEW_COLUMNS: Record<string, string> = {
  log_channel_id: "INTEGER", dismissed_role_id: "INTEGER", dismiss_roles: "TEXT DEFAULT ''",
  shift_enabled: "INTEGER DEFAULT 1", shift_points: "INTEGER DEFAULT 1", shift_block: "INTEGER DEFAULT 10",
  shift_min: "INTEGER DEFAULT 15", check_after: "INTEGER DEFAULT 60", check_timeout: "INTEGER DEFAULT 30", warn_limit: "INTEGER DEFAULT 3",
};
const DEFAULTS = { shift_enabled: 1, shift_points: 1, shift_block: 10, shift_min: 15, check_after: 60, check_timeout: 30, warn_limit: 3 };

const END_REASONS: Record<string, string> = {
  left: "طلع من روم الشفت", afk: "ما رد على التحقق (هل انت موجود؟)", admin: "أنهاه مسؤول", dismissed: "تم فصله",
  restart: "طلع من الروم أثناء توقف البوت", disabled: "تم إيقاف نظام الشفت", role: "انشالت منه رتبة العسكر",
};

interface Settings {
  guild_id: string; manager_role_id?: string | null; military_role_id?: string | null; panel_channel_id?: string | null;
  log_channel_id?: string | null; dismissed_role_id?: string | null; dismiss_roles?: string | null;
  shift_enabled: number; shift_points: number; shift_block: number; shift_min: number; check_after: number; check_timeout: number; warn_limit: number;
}
interface Shift {
  guild_id: string; user_id: string; channel_id: string; start_ts: number; last_confirm_ts: number; last_seen_ts: number;
  check_sent_ts: number | null; check_channel_id: string | null; check_message_id: string | null;
}

// ─────────── قاعدة البيانات ───────────
sql.exec(`
CREATE TABLE IF NOT EXISTS police_settings (guild_id INTEGER PRIMARY KEY, manager_role_id INTEGER, military_role_id INTEGER, panel_channel_id INTEGER);
CREATE TABLE IF NOT EXISTS user_points (guild_id INTEGER, user_id INTEGER, points INTEGER, PRIMARY KEY (guild_id, user_id));
CREATE TABLE IF NOT EXISTS shift_channels (guild_id INTEGER, channel_id INTEGER, PRIMARY KEY (guild_id, channel_id));
CREATE TABLE IF NOT EXISTS active_shifts (
  guild_id INTEGER, user_id INTEGER, channel_id INTEGER, start_ts INTEGER, last_confirm_ts INTEGER, last_seen_ts INTEGER,
  check_sent_ts INTEGER, check_channel_id INTEGER, check_message_id INTEGER, PRIMARY KEY (guild_id, user_id));
CREATE TABLE IF NOT EXISTS shift_blocks (guild_id INTEGER, user_id INTEGER, PRIMARY KEY (guild_id, user_id));
CREATE TABLE IF NOT EXISTS shifts (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id INTEGER, user_id INTEGER, start_ts INTEGER, end_ts INTEGER, seconds INTEGER, points INTEGER, end_reason TEXT);
CREATE INDEX IF NOT EXISTS shifts_user ON shifts (guild_id, user_id, end_ts);
CREATE TABLE IF NOT EXISTS points_log (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id INTEGER, user_id INTEGER, delta INTEGER, balance INTEGER, reason TEXT, by_id INTEGER, kind TEXT, ts INTEGER);
CREATE INDEX IF NOT EXISTS points_log_user ON points_log (guild_id, user_id, ts);
CREATE TABLE IF NOT EXISTS warnings (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id INTEGER, user_id INTEGER, reason TEXT, by_id INTEGER, ts INTEGER, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS dismissals (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id INTEGER, user_id INTEGER, kind TEXT, reason TEXT, by_id INTEGER, ts INTEGER);
`);
for (const [col, type] of Object.entries(NEW_COLUMNS)) sql.addColumn("police_settings", col, type);

const settingsCache = new Map<string, Settings>();
const channelsCache = new Map<string, Set<string>>();
const active = new Map<string, Shift>(); // "gid:uid"
const blocked = new Set<string>();
const K = (g: string, u: string) => `${g}:${u}`;

for (const r of sql.all<Shift>("SELECT * FROM active_shifts")) active.set(K(r.guild_id, r.user_id), r);
for (const r of sql.all<{ guild_id: string; user_id: string }>("SELECT guild_id, user_id FROM shift_blocks")) blocked.add(K(r.guild_id, r.user_id));

export function settings(gid: string): Settings {
  let s = settingsCache.get(gid);
  if (!s) {
    const r = sql.get<Settings>("SELECT * FROM police_settings WHERE guild_id = ?", gid);
    s = { ...DEFAULTS, ...(r ?? {}), guild_id: gid } as Settings;
    for (const [k, v] of Object.entries(DEFAULTS)) if ((s as any)[k] == null) (s as any)[k] = v;
    settingsCache.set(gid, s);
  }
  return s;
}

function setSettings(gid: string, values: Record<string, string | number | null>) {
  const cols = Object.keys(values);
  sql.run(
    `INSERT INTO police_settings (guild_id, ${cols.join(", ")}) VALUES (?, ${cols.map(() => "?").join(", ")})
     ON CONFLICT(guild_id) DO UPDATE SET ${cols.map((c) => `${c}=excluded.${c}`).join(", ")}`,
    gid, ...Object.values(values),
  );
  settingsCache.delete(gid);
}

function shiftChannels(gid: string): Set<string> {
  let s = channelsCache.get(gid);
  if (!s) {
    s = new Set(sql.all<{ channel_id: string }>("SELECT channel_id FROM shift_channels WHERE guild_id = ?", gid).map((r) => String(r.channel_id)));
    channelsCache.set(gid, s);
  }
  return s;
}

export function getPoints(gid: string, uid: string): number {
  return sql.value<number>("SELECT points FROM user_points WHERE guild_id = ? AND user_id = ?", gid, uid) ?? 0;
}

function addPoints(gid: string, uid: string, delta: number, reason: string, byId: string | null, kind: string): number {
  const next = Math.max(0, getPoints(gid, uid) + delta);
  sql.tx(() => {
    sql.run("INSERT INTO user_points (guild_id, user_id, points) VALUES (?, ?, ?) ON CONFLICT(guild_id, user_id) DO UPDATE SET points = excluded.points", gid, uid, next);
    sql.run("INSERT INTO points_log (guild_id, user_id, delta, balance, reason, by_id, kind, ts) VALUES (?,?,?,?,?,?,?,?)", gid, uid, delta, next, reason.slice(0, 300), byId, kind, now());
  });
  return next;
}

function rankOf(gid: string, uid: string): number | null {
  const pts = getPoints(gid, uid);
  if (!pts) return null;
  return (sql.value<number>("SELECT COUNT(*) FROM user_points WHERE guild_id = ? AND points > ?", gid, pts) ?? 0) + 1;
}

/** [عدد الشفتات، مجموع الثواني] — يشمل الشفت الحالي. */
function shiftTotals(gid: string, uid: string, since = 0): [number, number] {
  const r = sql.get<{ n: number; s: number }>(
    "SELECT COUNT(*) AS n, COALESCE(SUM(seconds), 0) AS s FROM shifts WHERE guild_id = ? AND user_id = ? AND end_ts >= ? AND seconds >= 60", gid, uid, since);
  let n = r?.n ?? 0;
  let s = r?.s ?? 0;
  const a = active.get(K(gid, uid));
  if (a) {
    n++;
    s += Math.max(0, now() - Math.max(a.start_ts, since));
  }
  return [n, s];
}

const activeWarnings = (gid: string, uid: string) =>
  sql.all<{ id: number; reason: string; ts: number }>("SELECT * FROM warnings WHERE guild_id = ? AND user_id = ? AND active = 1 ORDER BY ts", gid, uid);

function isDismissed(gid: string, uid: string): boolean {
  return sql.value<string>("SELECT kind FROM dismissals WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1", gid, uid) === "dismiss";
}

function saveShift(s: Shift) {
  sql.run(
    `INSERT OR REPLACE INTO active_shifts (guild_id, user_id, channel_id, start_ts, last_confirm_ts, last_seen_ts, check_sent_ts, check_channel_id, check_message_id)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    s.guild_id, s.user_id, s.channel_id, s.start_ts, s.last_confirm_ts, s.last_seen_ts, s.check_sent_ts, s.check_channel_id, s.check_message_id,
  );
}

function block(gid: string, uid: string, on: boolean) {
  const k = K(gid, uid);
  if (on && !blocked.has(k)) {
    blocked.add(k);
    sql.run("INSERT OR IGNORE INTO shift_blocks VALUES (?, ?)", gid, uid);
  } else if (!on && blocked.has(k)) {
    blocked.delete(k);
    sql.run("DELETE FROM shift_blocks WHERE guild_id = ? AND user_id = ?", gid, uid);
  }
}

/** معادلة النقاط: كل X دقيقة = Y نقطة، وأقل شفت ينحسب Z دقيقة. */
export function pointsFor(gid: string, seconds: number): number {
  const st = settings(gid);
  const minutes = Math.floor(seconds / 60);
  if (minutes < Math.max(0, st.shift_min) || st.shift_block <= 0) return 0;
  return Math.floor(minutes / st.shift_block) * Math.max(0, st.shift_points);
}

const clock = (sec: number) => {
  const m = Math.floor(Math.max(0, sec) / 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
};
const roleIds = (s?: string | null) => (s ?? "").split(",").filter((x) => /^\d+$/.test(x));

// ─────────── الكود الرئيسي ───────────
export default function setup(bot: Bot): void {
  const isManager = (m: CMember | undefined, perms?: bigint): boolean => {
    if (!m) return false;
    const p = perms ?? bot.basePerms(m.guildId, m.roles, m.id);
    if ((p & P.Administrator) === P.Administrator) return true;
    const rid = settings(m.guildId).manager_role_id;
    return !!rid && m.roles.includes(String(rid));
  };
  const isMilitary = (m: CMember) => {
    const rid = settings(m.guildId).military_role_id;
    return !!rid && m.roles.includes(String(rid));
  };
  const inShiftChannel = (gid: string, uid: string) => {
    const ch = bot.guild(gid)?.voice.get(uid);
    return !!ch && shiftChannels(gid).has(ch);
  };
  const canShift = (m: CMember) => {
    const st = settings(m.guildId);
    return !m.bot && !!st.shift_enabled && !!st.military_role_id && isMilitary(m) && !blocked.has(K(m.guildId, m.id));
  };

  async function sendLog(gid: string, e: ReturnType<typeof embed>) {
    await bot.trySend(settings(gid).log_channel_id, { embeds: [e] });
  }
  const footer = (gid: string) => {
    const g = bot.guild(gid);
    return g ? { text: g.name, icon_url: bot.guildIcon(g) } : undefined;
  };

  async function startShift(m: CMember, channelId: string, quiet = false) {
    const k = K(m.guildId, m.id);
    if (active.has(k)) return;
    const t = now();
    const s: Shift = { guild_id: m.guildId, user_id: m.id, channel_id: channelId, start_ts: t, last_confirm_ts: t, last_seen_ts: t, check_sent_ts: null, check_channel_id: null, check_message_id: null };
    active.set(k, s);
    saveShift(s);
    if (!quiet) {
      await sendLog(m.guildId, embed({
        title: "🟢 بداية شفت", description: `${mention.user(m.id)} بدأ شفته في ${mention.channel(channelId)}`, color: COLORS.success,
        author: { name: bot.name(m), icon_url: bot.avatar(m, 64) }, footer: footer(m.guildId),
      }));
    }
  }

  async function deleteCheck(s: Shift) {
    if (s.check_message_id && s.check_channel_id) await bot.deleteMessage(s.check_channel_id, s.check_message_id);
  }

  async function endShift(gid: string, uid: string, reason: string, endTs?: number, byId?: string): Promise<[number, number] | null> {
    const k = K(gid, uid);
    const s = active.get(k);
    if (!s) return null;
    active.delete(k);
    let end = endTs ?? now();
    if (reason === "afk" && s.check_sent_ts) end = s.check_sent_ts; // الوقت بعد التحقق ما يُحسب
    const seconds = Math.max(0, end - s.start_ts);
    const pts = pointsFor(gid, seconds);
    sql.tx(() => {
      sql.run("DELETE FROM active_shifts WHERE guild_id = ? AND user_id = ?", gid, uid);
      sql.run("INSERT INTO shifts (guild_id, user_id, start_ts, end_ts, seconds, points, end_reason) VALUES (?,?,?,?,?,?,?)", gid, uid, s.start_ts, end, seconds, pts, reason);
    });
    if (pts) addPoints(gid, uid, pts, `شفت ${dur(seconds)}`, byId ?? null, "shift");
    await deleteCheck(s);
    const m = bot.cache.member(gid, uid);
    await sendLog(gid, embed({
      title: reason === "afk" ? "💤 إيقاف شفت تلقائي" : "⏹️ نهاية شفت", description: mention.user(uid),
      color: reason === "afk" ? COLORS.orange : seconds < 60 ? COLORS.gray : COLORS.brand,
      author: m ? { name: bot.name(m), icon_url: bot.avatar(m, 64) } : undefined,
      fields: [
        field("المدة", dur(seconds)), field("النقاط المكتسبة", `+${pts}`), field("السبب", END_REASONS[reason] ?? reason),
        field("من", ts(s.start_ts, "t")), field("إلى", ts(end, "t")), byId ? field("بواسطة", mention.user(byId)) : null,
      ],
      footer: footer(gid),
    }));
    return [seconds, pts];
  }

  async function sendCheck(s: Shift) {
    const g = bot.guild(s.guild_id);
    s.check_sent_ts = now();
    s.check_channel_id = s.check_message_id = null;
    const st = settings(s.guild_id);
    if (g) {
      const ch = g.channels.get(s.channel_id);
      const payload = {
        embeds: [embed({
          title: "👮 هل انت موجود؟", color: COLORS.gold, thumbnail: bot.guildIcon(g),
          description: `صار لك أكثر من **${dur(now() - s.last_confirm_ts)}** في شفتك${ch ? ` بروم **${ch.name}**` : ""} في **${g.name}**.\n\n` +
            `اضغط **«نعم، موجود»** أو رد على هذه الرسالة خلال **${st.check_timeout} دقيقة** عشان يستمر شفتك.`,
        })],
        components: [row(button(`police:here:${s.guild_id}:${s.user_id}`, "نعم، موجود", ButtonStyle.Success, { emoji: "✅" }))],
      };
      let msg = await bot.dm(s.user_id, payload);
      if (!msg) { // خاصه مقفل → في شات الروم الصوتي
        msg = await bot.trySend(s.channel_id, { ...payload, content: mention.user(s.user_id), allowed_mentions: { users: [s.user_id] } });
      }
      if (msg) {
        s.check_channel_id = msg.channel_id;
        s.check_message_id = msg.id;
      }
    }
    saveShift(s);
  }

  async function confirm(s: Shift, ctx?: Ctx) {
    s.last_confirm_ts = now();
    s.check_sent_ts = null;
    const done = { embeds: [embed({ title: "✅ تم التأكيد", description: "تمام، شفتك مستمر 👮", color: COLORS.success })], components: [] };
    if (ctx) await ctx.update(done);
    else if (s.check_channel_id && s.check_message_id) await bot.edit(s.check_channel_id, s.check_message_id, done).catch(() => undefined);
    s.check_channel_id = s.check_message_id = null;
    saveShift(s);
  }

  const pendingFor = (uid: string) => [...active.values()].filter((s) => s.user_id === uid && s.check_sent_ts);

  // ─────────── الأحداث ───────────
  bot.on("VOICE_STATE_UPDATE", async (d, { before, after, member }) => {
    if (before === after || !d.guild_id || d.member?.user?.bot) return;
    const gid: string = d.guild_id;
    const uid: string = d.user_id;
    block(gid, uid, false); // أي تنقل/طلعة = حركة حقيقية → ينفك الإيقاف
    const nowIn = !!after && shiftChannels(gid).has(after);
    const s = active.get(K(gid, uid));
    if (s) {
      if (nowIn) {
        s.channel_id = after;
        saveShift(s);
      } else await endShift(gid, uid, "left");
    } else if (nowIn) {
      const m: CMember | null = member ?? (await bot.member(gid, uid));
      if (m && canShift(m)) await startShift(m, after);
    }
  });

  bot.on("GUILD_MEMBER_UPDATE", async (d, { member }) => {
    if (active.has(K(d.guild_id, d.user.id)) && member && !isMilitary(member)) await endShift(d.guild_id, d.user.id, "role");
  });

  bot.on("MESSAGE_CREATE", async (d) => {
    if (d.author?.bot) return;
    const pending = pendingFor(d.author.id);
    if (!pending.length) return;
    let hit = false;
    for (const s of pending) {
      if (!d.guild_id || s.check_channel_id === d.channel_id) {
        await confirm(s);
        hit = true;
      }
    }
    if (hit) await bot.react(d.channel_id, d.id, "✅");
  });

  bot.on("MESSAGE_REACTION_ADD", async (d) => {
    for (const s of pendingFor(d.user_id)) if (s.check_message_id === d.message_id) await confirm(s);
  });

  bot.on("shutdown", () => {
    for (const s of active.values()) {
      s.last_seen_ts = now();
      saveShift(s);
    }
  });

  let reconciled = false;
  async function reconcile() {
    reconciled = true;
    for (const s of [...active.values()]) {
      if (!bot.guild(s.guild_id)) continue;
      if (!inShiftChannel(s.guild_id, s.user_id)) await endShift(s.guild_id, s.user_id, "restart", s.last_seen_ts);
    }
    for (const k of [...blocked]) {
      const [g, u] = k.split(":") as [string, string];
      if (!inShiftChannel(g, u)) block(g, u, false);
    }
    for (const g of bot.cache.guilds.values()) {
      const chans = shiftChannels(g.id);
      if (!chans.size) continue;
      for (const [uid, ch] of g.voice) {
        if (!chans.has(ch) || active.has(K(g.id, uid))) continue;
        const m = await bot.member(g.id, uid);
        if (m && canShift(m)) await startShift(m, ch, true);
      }
    }
  }

  async function tick() {
    if (!bot.ready) return;
    if (!reconciled) await reconcile();
    const t = now();
    for (const s of [...active.values()]) {
      const gid = s.guild_id;
      const g = bot.guild(gid);
      if (!g) continue;
      if (!inShiftChannel(gid, s.user_id)) {
        await endShift(gid, s.user_id, "left", s.last_seen_ts);
        continue;
      }
      const st = settings(gid);
      if (!st.shift_enabled) {
        await endShift(gid, s.user_id, "disabled");
        continue;
      }
      s.last_seen_ts = t;
      if (s.check_sent_ts) {
        if (t - s.check_sent_ts >= st.check_timeout * 60) {
          await endShift(gid, s.user_id, "afk"); // بصمت: ما نرسل له شي
          block(gid, s.user_id, true);
        }
      } else if (st.check_after > 0 && t - s.last_confirm_ts >= st.check_after * 60) {
        await sendCheck(s);
      }
    }
    if (active.size) sql.tx(() => {
      for (const s of active.values()) sql.run("UPDATE active_shifts SET last_seen_ts = ? WHERE guild_id = ? AND user_id = ?", s.last_seen_ts, s.guild_id, s.user_id);
    });
  }
  _test.tick = tick;
  let ticking = false;
  setInterval(() => {
    if (ticking) return;
    ticking = true;
    tick().catch((e) => log.err("police", e)).finally(() => (ticking = false));
  }, 60_000).unref();
  bot.on("ready", () => void tick().catch((e) => log.err("police", e)));

  // ─────────── العرض ───────────
  async function card(ctx: Ctx, uid: string) {
    const gid = ctx.guildId!;
    const m = ctx.resolvedMember(uid) ?? (await bot.member(gid, uid));
    if (!m) return ctx.fail("العضو مو موجود في السيرفر.");
    const g = bot.guild(gid);
    const pts = getPoints(gid, uid);
    const rank = rankOf(gid, uid);
    const [count, secs] = shiftTotals(gid, uid);
    const [, week] = shiftTotals(gid, uid, now() - 7 * 86400);
    const warns = activeWarnings(gid, uid).length;
    const limit = settings(gid).warn_limit;
    const top = sql.value<number>("SELECT MAX(points) FROM user_points WHERE guild_id = ?", gid) ?? 0;
    const s = active.get(K(gid, uid));
    const dismissed = isDismissed(gid, uid) && !isMilitary(m);
    const status = dismissed ? "🔴 **مفصول**" : s ? `🟢 **في الشفت الآن** · ${clock(now() - s.start_ts)} · ${mention.channel(s.channel_id)}` : "⚪ خارج الشفت";
    const topRole = bot.topRole(gid, m.roles);
    const accent = dismissed ? COLORS.error : s ? COLORS.success : COLORS.gold;
    await ctx.reply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [container(accent,
        section([`## 🎖️ ${bot.name(m)}`, `${topRole ? mention.role(topRole.id) : "عسكري"} · ${g?.name ?? ""}`, status], thumb(bot.avatar(m, 256))),
        sep(),
        text(`### 🏅 النقاط: **${fmt(pts)}**\n\`${bar(pts, Math.max(top, 1), 16)}\` ${rank ? `**#${rank}**` : "—"}`),
        text([
          `🏆 الترتيب: **${rank ? `#${rank}` : "—"}**`,
          `⏱️ ساعات الشفت: **${(secs / 3600).toFixed(1)}**`,
          `📋 عدد الشفتات: **${count}**`,
          `⚠️ الإنذارات: **${limit ? `${warns}/${limit}` : warns}**`,
          `📅 آخر 7 أيام: **${dur(week)}**`,
        ].join("\n")),
        sep(false),
        text(`-# ${g?.name ?? ""} · وزارة الداخلية`),
      )],
    }, true);
  }

  async function top10(ctx: Ctx) {
    const gid = ctx.guildId!;
    const rows = sql.all<{ user_id: string; points: number }>("SELECT user_id, points FROM user_points WHERE guild_id = ? AND points > 0 ORDER BY points DESC LIMIT 10", gid);
    const medals = ["🥇", "🥈", "🥉"];
    const lines = rows.map((r, i) => {
      const [, secs] = shiftTotals(gid, r.user_id);
      return `${medals[i] ?? `\`#${i + 1}\``} ${mention.user(r.user_id)} — **${fmt(r.points)}** نقطة · ${(secs / 3600).toFixed(1)} ساعة${active.has(K(gid, r.user_id)) ? " 🟢" : ""}`;
    });
    const mine = rankOf(gid, ctx.user.id);
    await ctx.reply({ embeds: [embed({
      title: "🏆 أعلى 10 عساكر نقاطاً", description: lines.join("\n") || "ما فيه نقاط مسجلة للحين.", color: COLORS.gold,
      thumbnail: bot.guildIcon(bot.guild(gid)), footer: footer(gid),
      fields: [mine && mine > 10 ? field("ترتيبك", `#${mine} — ${fmt(getPoints(gid, ctx.user.id))} نقطة`) : null],
    })] }, true);
  }

  async function myShift(ctx: Ctx) {
    const gid = ctx.guildId!;
    const uid = ctx.user.id;
    const st = settings(gid);
    const s = active.get(K(gid, uid));
    const [, today] = shiftTotals(gid, uid, now() - 86400);
    const [, week] = shiftTotals(gid, uid, now() - 7 * 86400);
    const chans = [...shiftChannels(gid)].map(mention.channel).join(" ") || "ما تحددت رومات شفت للحين";
    const el = s ? now() - s.start_ts : 0;
    await ctx.reply({ embeds: [embed({
      title: s ? "🟢 أنت في الشفت" : "⚪ أنت خارج الشفت", color: s ? COLORS.success : COLORS.gray,
      description: s ? undefined : `ادخل أحد رومات الشفت ويبدأ شفتك تلقائياً:\n${chans}`,
      fields: [
        s ? field("الروم", mention.channel(s.channel_id)) : null, s ? field("بدأ", ts(s.start_ts, "R")) : null,
        s ? field("المدة", dur(el)) : null, s ? field("النقاط لو أنهيته الآن", `+${pointsFor(gid, el)}`) : null,
        field("آخر 24 ساعة", dur(today)), field("آخر 7 أيام", dur(week)),
      ],
      footer: { text: `كل ${st.shift_block} دقيقة = ${st.shift_points} نقطة · أقل مدة تنحسب ${st.shift_min} دقيقة` },
    })] }, true);
  }

  async function record(ctx: Ctx, uid: string) {
    const gid = ctx.guildId!;
    if (uid !== ctx.user.id && !isManager(ctx.member, ctx.perms)) return ctx.fail("تقدر تشوف سجلك أنت بس.");
    const m = ctx.resolvedMember(uid) ?? (await bot.member(gid, uid));
    const [count, secs] = shiftTotals(gid, uid);
    const rank = rankOf(gid, uid);
    const warns = activeWarnings(gid, uid);
    const logs = sql.all<any>("SELECT * FROM points_log WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT 6", gid, uid);
    const shifts = sql.all<any>("SELECT * FROM shifts WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT 5", gid, uid);
    const dis = sql.all<any>("SELECT * FROM dismissals WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT 3", gid, uid);
    await ctx.reply({ embeds: [embed({
      title: `📜 سجل ${m ? bot.name(m) : uid}`, color: COLORS.brand, thumbnail: m ? bot.avatar(m) : undefined, footer: footer(gid),
      fields: [
        field("النقاط", `**${fmt(getPoints(gid, uid))}**${rank ? ` (#${rank})` : ""}`),
        field("الشفتات", `${count} شفت · ${(secs / 3600).toFixed(1)} ساعة`),
        field("الإنذارات", `${warns.length}/${settings(gid).warn_limit || "∞"}`),
        logs.length ? field("آخر عمليات النقاط", logs.map((r) => `\`${r.delta >= 0 ? "+" : ""}${r.delta}\` ${clip(r.reason, 60)} · ${ts(r.ts, "R")}`).join("\n"), false) : null,
        shifts.length ? field("آخر الشفتات", shifts.map((r) => `${ts(r.start_ts, "d")} · ${dur(r.seconds)} · +${r.points}${r.end_reason === "afk" ? " 💤" : ""}`).join("\n"), false) : null,
        warns.length ? field("الإنذارات النشطة", warns.slice(-5).map((w) => `⚠️ ${clip(w.reason, 80)} · ${ts(w.ts, "R")}`).join("\n"), false) : null,
        dis.length ? field("الفصل", dis.map((x) => `${x.kind === "dismiss" ? "⛔ فصل" : "↩️ إرجاع"} · ${clip(x.reason, 70)} · ${ts(x.ts, "R")}`).join("\n"), false) : null,
      ],
    })] }, true);
  }

  async function activeList(ctx: Ctx) {
    const gid = ctx.guildId!;
    const list = [...active.values()].filter((s) => s.guild_id === gid).sort((a, b) => a.start_ts - b.start_ts);
    const lines = list.slice(0, 40).map((s) => `🟢 ${mention.user(s.user_id)} · ${mention.channel(s.channel_id)} · ${dur(now() - s.start_ts)}${s.check_sent_ts ? " · ⏳ ينتظر التحقق" : ""}`);
    await ctx.reply({ embeds: [embed({ title: `👮 الشفتات الحالية (${list.length})`, description: lines.join("\n") || "ما فيه أحد في الشفت الآن.", color: list.length ? COLORS.success : COLORS.gray, footer: footer(gid) })] }, true);
  }

  // ─────────── عمليات الإدارة ───────────
  const needManager = async (ctx: Ctx) => {
    if (isManager(ctx.member, ctx.perms)) return true;
    await ctx.fail("هذا الأمر لمسؤولي النقاط فقط.");
    return false;
  };

  async function changePoints(ctx: Ctx, uid: string, delta: number, reason: string) {
    if (!(await needManager(ctx))) return;
    if (!delta || Math.abs(delta) > 100000) return ctx.fail("عدد النقاط لازم يكون بين 1 و 100000.");
    const gid = ctx.guildId!;
    const next = addPoints(gid, uid, delta, reason, ctx.user.id, "manual");
    const add = delta > 0;
    await ctx.reply(`${add ? "✅ تمت إضافة" : "✅ تم خصم"} **${Math.abs(delta)}** نقطة ${add ? "لـ" : "من"} ${mention.user(uid)}.\n📊 رصيده الحالي: **${fmt(next)}** نقطة.`, true);
    await sendLog(gid, embed({
      title: add ? "➕ إضافة نقاط" : "➖ خصم نقاط", description: mention.user(uid), color: add ? COLORS.success : COLORS.error, footer: footer(gid),
      fields: [field("النقاط", `${add ? "+" : "-"}${Math.abs(delta)}`), field("الرصيد الجديد", fmt(next)), field("بواسطة", mention.user(ctx.user.id)), field("السبب", reason, false)],
    }));
    await bot.dm(uid, { embeds: [embed({
      title: "🔔 تحديث نقاطك", color: add ? COLORS.success : COLORS.error, footer: footer(gid),
      description: `تم **${add ? "إضافة" : "خصم"} ${Math.abs(delta)}** نقطة ${add ? "لك" : "منك"} في **${bot.guild(gid)?.name ?? ""}**.`,
      fields: [field("رصيدك الجديد", fmt(next)), field("السبب", reason, false)],
    })] });
  }

  async function warn(ctx: Ctx, uid: string, reason: string) {
    if (!(await needManager(ctx))) return;
    const gid = ctx.guildId!;
    sql.run("INSERT INTO warnings (guild_id, user_id, reason, by_id, ts) VALUES (?,?,?,?,?)", gid, uid, reason.slice(0, 300), ctx.user.id, now());
    const count = activeWarnings(gid, uid).length;
    const limit = settings(gid).warn_limit;
    const of = limit ? `${count}/${limit}` : `${count}`;
    await ctx.reply(`⚠️ تم إنذار ${mention.user(uid)} — صار عنده **${of}** إنذار.`, true);
    await sendLog(gid, embed({ title: "⚠️ إنذار", description: mention.user(uid), color: COLORS.warn, footer: footer(gid),
      fields: [field("العدد", of), field("بواسطة", mention.user(ctx.user.id)), field("السبب", reason, false)] }));
    await bot.dm(uid, { embeds: [embed({
      title: "⚠️ وصلك إنذار", description: `وصلك إنذار في **${bot.guild(gid)?.name ?? ""}** (${of}).`, color: COLORS.warn,
      fields: [field("السبب", reason, false), limit && count < limit ? field("تنبيه", `عند **${limit}** إنذارات يتم فصلك تلقائياً.`, false) : null],
    })] });
    if (limit && count >= limit) {
      const problems = await dismiss(gid, uid, `وصل حد الإنذارات (${of}) — آخر إنذار: ${reason}`, ctx.user.id, false);
      await ctx.reply(`⛔ وصل ${mention.user(uid)} حد الإنذارات وتم **فصله تلقائياً**.${problems ? `\n${problems}` : ""}`, true);
    }
  }

  /** يفصل العسكري: ينهي شفته، يسحب الرتب، يعطيه رتبة المفصول، يصفّر إنذاراته، ويسجّل كل شي. يرجع رسالة مشكلة أو "". */
  async function dismiss(gid: string, uid: string, reason: string, byId: string, resetPoints: boolean): Promise<string> {
    const st = settings(gid);
    await endShift(gid, uid, "dismissed", undefined, byId);
    const m = await bot.member(gid, uid, true);
    const ids = new Set([st.military_role_id, st.manager_role_id, ...roleIds(st.dismiss_roles)].filter(Boolean).map(String));
    const remove = (m?.roles ?? []).filter((r) => ids.has(r) && !bot.role(gid, r)?.managed);
    let problems = "";
    for (const r of remove) await bot.removeRole(gid, uid, r, `فصل: ${reason}`).catch(() => (problems = "⚠️ ما قدرت أسحب بعض الرتب — تأكد إن رتبة البوت فوق رتب العسكر."));
    if (st.dismissed_role_id && m) await bot.addRole(gid, uid, String(st.dismissed_role_id), `فصل: ${reason}`).catch(() => (problems = "⚠️ ما قدرت أعطي رتبة المفصول — تأكد إن رتبة البوت فوقها."));
    sql.tx(() => {
      sql.run("UPDATE warnings SET active = 0 WHERE guild_id = ? AND user_id = ?", gid, uid);
      sql.run("INSERT INTO dismissals (guild_id, user_id, kind, reason, by_id, ts) VALUES (?,?,?,?,?,?)", gid, uid, "dismiss", reason.slice(0, 300), byId, now());
    });
    if (resetPoints) {
      const pts = getPoints(gid, uid);
      if (pts) addPoints(gid, uid, -pts, "تصفير بسبب الفصل", byId, "dismiss");
    }
    block(gid, uid, false);
    await sendLog(gid, embed({
      title: "⛔ فصل عسكري", description: mention.user(uid), color: COLORS.error, footer: footer(gid),
      author: m ? { name: bot.name(m), icon_url: bot.avatar(m, 64) } : undefined,
      fields: [field("بواسطة", mention.user(byId)), field("الرتب المسحوبة", remove.map(mention.role).join(" ") || "—"),
        field("تصفير النقاط", resetPoints ? "نعم" : "لا"), field("السبب", reason, false)],
    }));
    await bot.dm(uid, { embeds: [embed({ title: "⛔ تم فصلك", description: `تم فصلك من **وزارة الداخلية** في **${bot.guild(gid)?.name ?? ""}**.`, color: COLORS.error, fields: [field("السبب", reason, false)] })] });
    return problems;
  }

  /** طلبات الفصل والتصفير اللي تنتظر تأكيد (تنتهي بعد دقيقتين). */
  const pending = new Map<string, { kind: "dismiss" | "reset"; gid: string; uid?: string; reason?: string; reset?: boolean; by: string; at: number }>();
  const token = () => Math.random().toString(36).slice(2, 10);
  const confirmRow = (t: string, label: string) => row(
    button(`police:yes:${t}`, label, ButtonStyle.Danger, { emoji: "✔️" }), button(`police:no:${t}`, "إلغاء", ButtonStyle.Secondary, { emoji: "✖️" }));

  async function askDismiss(ctx: Ctx, uid: string, reason: string, reset: boolean, skipConfirm = false) {
    if (!(await needManager(ctx))) return;
    const gid = ctx.guildId!;
    if (uid === ctx.user.id) return ctx.fail("ما تقدر تفصل نفسك.");
    const target = await bot.member(gid, uid);
    if (target?.bot) return ctx.fail("ما تقدر تفصل بوت.");
    if (target && !ctx.isAdmin && ctx.member && bot.topPosition(gid, target.roles) >= bot.topPosition(gid, ctx.member.roles))
      return ctx.fail("ما تقدر تفصل شخص رتبته أعلى منك أو مثلك.");
    if (skipConfirm) {
      await ctx.defer(true);
      const problems = await dismiss(gid, uid, reason, ctx.user.id, reset);
      return ctx.edit(`⛔ تم فصل ${mention.user(uid)}.${problems ? `\n${problems}` : ""}`);
    }
    const t = token();
    pending.set(t, { kind: "dismiss", gid, uid, reason, reset, by: ctx.user.id, at: Date.now() });
    await ctx.reply({
      embeds: [embed({ title: "⛔ تأكيد الفصل", color: COLORS.error, description: `متأكد تبي تفصل ${mention.user(uid)}؟\n**السبب:** ${clip(reason, 500)}\n**تصفير النقاط:** ${reset ? "نعم" : "لا"}` })],
      components: [confirmRow(t, "فصل")],
    }, true);
  }

  async function reinstate(ctx: Ctx, uid: string, reason: string) {
    if (!(await needManager(ctx))) return;
    const gid = ctx.guildId!;
    const st = settings(gid);
    await ctx.defer(true);
    let problems = "";
    if (st.military_role_id) await bot.addRole(gid, uid, String(st.military_role_id), `إلغاء فصل: ${reason}`).catch(() => (problems = "\n⚠️ ما قدرت أعطيه رتبة العسكر — تأكد إن رتبة البوت فوقها."));
    if (st.dismissed_role_id) await bot.removeRole(gid, uid, String(st.dismissed_role_id), `إلغاء فصل: ${reason}`).catch(() => undefined);
    sql.run("INSERT INTO dismissals (guild_id, user_id, kind, reason, by_id, ts) VALUES (?,?,?,?,?,?)", gid, uid, "reinstate", reason.slice(0, 300), ctx.user.id, now());
    await ctx.edit(`↩️ تم إرجاع ${mention.user(uid)} للعسكر.${problems}`);
    await sendLog(gid, embed({ title: "↩️ إلغاء فصل", description: mention.user(uid), color: COLORS.success, footer: footer(gid),
      fields: [field("بواسطة", mention.user(ctx.user.id)), field("السبب", reason, false)] }));
  }

  async function forceEnd(ctx: Ctx, uid: string) {
    if (!(await needManager(ctx))) return;
    const gid = ctx.guildId!;
    const res = await endShift(gid, uid, "admin", undefined, ctx.user.id);
    if (!res) return ctx.reply(`⚪ ${mention.user(uid)} مو في شفت الآن.`, true);
    if (inShiftChannel(gid, uid)) block(gid, uid, true); // ما يرجع يبدأ إلا إذا طلع ورجع
    await ctx.reply(`⏹️ تم إنهاء شفت ${mention.user(uid)} — المدة ${dur(res[0])} · +${res[1]} نقطة.`, true);
  }

  async function askReset(ctx: Ctx) {
    if (!ctx.isAdmin) return ctx.fail("تصفير النقاط للأدمن فقط.");
    const t = token();
    pending.set(t, { kind: "reset", gid: ctx.guildId!, by: ctx.user.id, at: Date.now() });
    await ctx.reply({ embeds: [embed({ title: "🔄 تأكيد التصفير", description: "متأكد تبي تصفّر **كل** نقاط العساكر في السيرفر؟ ما تقدر ترجع عنها.", color: COLORS.error })], components: [confirmRow(t, "تصفير")] }, true);
  }

  bot.component("police:no:", (ctx) => {
    pending.delete(ctx.customId.split(":")[2]!);
    return ctx.update({ content: "تم الإلغاء.", embeds: [], components: [] });
  });
  bot.component("police:yes:", async (ctx) => {
    const p = pending.get(ctx.customId.split(":")[2]!);
    if (!p || Date.now() - p.at > 120_000) return ctx.update({ content: "⌛ انتهت مهلة التأكيد، أعد الأمر.", embeds: [], components: [] });
    if (p.by !== ctx.user.id) return ctx.fail("هذا التأكيد مو لك.");
    pending.delete(ctx.customId.split(":")[2]!);
    if (p.kind === "dismiss") {
      await ctx.update({ content: "⏳ جاري الفصل…", embeds: [], components: [] });
      const problems = await dismiss(p.gid, p.uid!, p.reason!, p.by, !!p.reset);
      return ctx.edit(`⛔ تم فصل ${mention.user(p.uid!)}.${problems ? `\n${problems}` : ""}`);
    }
    const n = sql.value<number>("SELECT COUNT(*) FROM user_points WHERE guild_id = ? AND points > 0", p.gid) ?? 0;
    sql.tx(() => {
      sql.run("DELETE FROM user_points WHERE guild_id = ?", p.gid);
      sql.run("INSERT INTO points_log (guild_id, user_id, delta, balance, reason, by_id, kind, ts) VALUES (?,?,?,?,?,?,?,?)", p.gid, 0, 0, 0, "تصفير نقاط السيرفر", p.by, "reset", now());
    });
    await ctx.update({ content: `🔄 تم تصفير نقاط **${n}** عسكري.`, embeds: [], components: [] });
    await sendLog(p.gid, embed({ title: "🔄 تصفير النقاط", description: `صفّر ${mention.user(p.by)} نقاط السيرفر (${n} عسكري).`, color: COLORS.error }));
  });

  // زر «نعم، موجود» (يشتغل حتى بعد إعادة تشغيل البوت لأن البيانات في custom_id)
  bot.component("police:here:", async (ctx) => {
    const [, , gid, uid] = ctx.customId.split(":") as [string, string, string, string];
    if (ctx.user.id !== uid) return ctx.fail("هذا التحقق مو لك.");
    const s = active.get(K(gid, uid));
    if (s?.check_sent_ts) return confirm(s, ctx);
    return ctx.deferUpdate(); // شفت منتهي: بدون أي رد
  });

  // ─────────── اللوحات ───────────
  const ADMIN_OPTIONS = [
    { label: "إضافة نقاط", description: "إضافة نقاط لعسكري مع السبب", emoji: "➕", value: "add_pts" },
    { label: "خصم نقاط", description: "خصم نقاط من عسكري مع السبب", emoji: "➖", value: "remove_pts" },
    { label: "إنذار", description: "إعطاء عسكري إنذار (يُفصل تلقائياً عند الحد)", emoji: "⚠️", value: "warn" },
    { label: "فصل عسكري", description: "سحب رتب العسكر وتسجيل الفصل", emoji: "⛔", value: "dismiss" },
    { label: "إلغاء فصل", description: "إرجاع عسكري مفصول", emoji: "↩️", value: "reinstate" },
    { label: "إنهاء شفت", description: "إنهاء شفت عسكري يدوياً", emoji: "⏹️", value: "end_shift" },
    { label: "سجل عسكري", description: "النقاط والشفتات والإنذارات والفصل", emoji: "📜", value: "record" },
    { label: "الشفتات الحالية", description: "من في الشفت الآن", emoji: "🟢", value: "active" },
    { label: "تصفير النقاط", description: "تصفير نقاط السيرفر كاملة (للأدمن)", emoji: "🔄", value: "reset_pts" },
  ];
  const PUBLIC_OPTIONS = [
    { label: "بطاقتي", description: "بطاقة نقاطك وساعات شفتك", emoji: "🪪", value: "my_card" },
    { label: "بطاقة عسكري", description: "اعرض بطاقة أي عسكري", emoji: "🔍", value: "member_card" },
    { label: "توب 10", description: "أعلى العساكر نقاطاً", emoji: "🏆", value: "top_10" },
    { label: "حالة شفتي", description: "هل أنت في شفت الآن وكم صار لك", emoji: "⏱️", value: "my_shift" },
    { label: "سجلي", description: "آخر عمليات النقاط والشفتات والإنذارات", emoji: "📜", value: "my_record" },
  ];
  // نفس custom_id القديم فالبانلات المرسلة سابقاً تشتغل
  const adminPanel = () => row(select("police:admin_control_select", ADMIN_OPTIONS, { placeholder: "⚙️ اختر العملية…" }));
  const publicPanel = () => row(select("police:public_services_select", PUBLIC_OPTIONS, { placeholder: "📂 اختر الخدمة…" }));
  const pickMember = (action: string) => ({ content: "🔽 اختر العسكري:", components: [row(userSelect(`police:pick:${action}`, "🔍 اختر العسكري…"))] });

  /** يرجّع القائمة لوضعها الافتراضي عشان تقدر تختار نفس الخيار مرة ثانية. */
  const resetPanel = (ctx: Ctx, comps: any) => {
    if (ctx.message) bot.edit(ctx.channelId, ctx.message.id, { components: [comps] }).catch(() => undefined);
  };

  bot.component("police:admin_control_select", async (ctx) => {
    if (!isManager(ctx.member, ctx.perms)) return ctx.fail("هذي اللوحة لمسؤولي النقاط فقط.");
    const c = ctx.values[0]!;
    const pick: Record<string, string> = { add_pts: "add", remove_pts: "remove", warn: "warn", dismiss: "dismiss", reinstate: "reinstate", end_shift: "end", record: "record" };
    if (pick[c]) await ctx.reply(pickMember(pick[c]!), true);
    else if (c === "active") await activeList(ctx);
    else if (c === "reset_pts") await askReset(ctx);
    resetPanel(ctx, adminPanel());
  });

  bot.component("police:public_services_select", async (ctx) => {
    const c = ctx.values[0]!;
    if (c === "my_card" || c === "my_points") await card(ctx, ctx.user.id);
    else if (c === "member_card" || c === "check_military") await ctx.reply(pickMember("card"), true);
    else if (c === "top_10") await top10(ctx);
    else if (c === "my_shift") await myShift(ctx);
    else if (c === "my_record") await record(ctx, ctx.user.id);
    resetPanel(ctx, publicPanel());
  });

  bot.component("police:pick:", async (ctx) => {
    const action = ctx.customId.split(":")[2]!;
    const uid = ctx.values[0]!;
    const m = ctx.resolvedMember(uid);
    if (!m || m.bot) return ctx.fail("العضو مو موجود في السيرفر.");
    const name = clip(bot.name(m), 25);
    if (action === "add" || action === "remove") {
      return ctx.showModal(modal(`police:pts:${action}:${uid}`, `${action === "add" ? "➕ إضافة نقاط" : "➖ خصم نقاط"} — ${name}`, [
        input("points", "عدد النقاط", { placeholder: "مثال: 10", max: 6 }),
        input("reason", "السبب", { paragraph: true, placeholder: "اكتب السبب…", max: 300 }),
      ]));
    }
    if (action === "warn" || action === "dismiss" || action === "reinstate") {
      const titles: Record<string, string> = { warn: "⚠️ إنذار", dismiss: "⛔ فصل", reinstate: "↩️ إلغاء فصل" };
      return ctx.showModal(modal(`police:reason:${action}:${uid}`, `${titles[action]} — ${name}`, [input("reason", "السبب", { paragraph: true, placeholder: "اكتب السبب…", max: 300 })]));
    }
    if (action === "end") return forceEnd(ctx, uid);
    if (action === "card") return card(ctx, uid);
    if (action === "record") return record(ctx, uid);
  });

  bot.modal("police:pts:", async (ctx) => {
    const [, , action, uid] = ctx.customId.split(":") as [string, string, string, string];
    const n = Number.parseInt(ctx.fields.get("points") ?? "", 10);
    if (!Number.isFinite(n) || n <= 0) return ctx.fail("عدد النقاط لازم يكون رقم صحيح أكبر من صفر.");
    return changePoints(ctx, uid, action === "add" ? n : -n, ctx.fields.get("reason") ?? "");
  });

  bot.modal("police:reason:", async (ctx) => {
    const [, , action, uid] = ctx.customId.split(":") as [string, string, string, string];
    const reason = ctx.fields.get("reason") ?? "";
    if (action === "warn") return warn(ctx, uid, reason);
    if (action === "dismiss") return askDismiss(ctx, uid, reason, false, true);
    return reinstate(ctx, uid, reason);
  });

  // ─────────── أوامر السلاش ───────────
  const target = (ctx: Ctx) => ctx.id("العسكري") ?? ctx.user.id;
  bot.command({ name: "نقاطي", description: "بطاقة نقاطك وساعات شفتك", run: (ctx) => card(ctx, ctx.user.id) });
  bot.command({ name: "نقاط", description: "عرض بطاقة نقاط عسكري", options: [o.user("العسكري", "العسكري اللي تبي تشوف نقاطه")], run: (ctx) => card(ctx, target(ctx)) });
  bot.command({ name: "توب", description: "أعلى 10 عساكر نقاطاً", run: top10 });
  bot.command({ name: "شفتي", description: "حالة شفتك الآن وساعاتك", run: myShift });
  bot.command({ name: "الشفتات", description: "العساكر اللي في الشفت الآن", run: activeList });
  bot.command({ name: "سجل", description: "سجل عسكري: النقاط والشفتات والإنذارات والفصل", options: [o.user("العسكري", "اتركه فاضي لعرض سجلك", { required: false })], run: (ctx) => record(ctx, target(ctx)) });
  bot.command({
    name: "اضافة-نقاط", description: "إضافة نقاط لعسكري (لمسؤولي النقاط)",
    options: [o.user("العسكري", "العسكري"), o.int("العدد", "عدد النقاط", { min: 1, max: 100000 }), o.str("السبب", "سبب الإضافة", { max: 300 })],
    run: (ctx) => changePoints(ctx, target(ctx), ctx.int("العدد")!, ctx.str("السبب")!),
  });
  bot.command({
    name: "خصم-نقاط", description: "خصم نقاط من عسكري (لمسؤولي النقاط)",
    options: [o.user("العسكري", "العسكري"), o.int("العدد", "عدد النقاط", { min: 1, max: 100000 }), o.str("السبب", "سبب الخصم", { max: 300 })],
    run: (ctx) => changePoints(ctx, target(ctx), -ctx.int("العدد")!, ctx.str("السبب")!),
  });
  bot.command({
    name: "انذار", description: "إعطاء عسكري إنذار — يُفصل تلقائياً عند الحد",
    options: [o.user("العسكري", "العسكري"), o.str("السبب", "سبب الإنذار", { max: 300 })],
    run: (ctx) => warn(ctx, target(ctx), ctx.str("السبب")!),
  });
  bot.command({
    name: "ازالة-انذار", description: "إزالة آخر إنذار من عسكري", options: [o.user("العسكري", "العسكري")],
    run: async (ctx) => {
      if (!(await needManager(ctx))) return;
      const gid = ctx.guildId!;
      const uid = target(ctx);
      const warns = activeWarnings(gid, uid);
      if (!warns.length) return ctx.reply(`⚪ ${mention.user(uid)} ما عنده إنذارات.`, true);
      sql.run("UPDATE warnings SET active = 0 WHERE id = ?", warns[warns.length - 1]!.id);
      await ctx.reply(`✅ تمت إزالة إنذار من ${mention.user(uid)} — باقي **${warns.length - 1}**.`, true);
      await sendLog(gid, embed({ title: "✅ إزالة إنذار", description: `${mention.user(uid)} · بواسطة ${mention.user(ctx.user.id)}`, color: COLORS.success }));
    },
  });
  bot.command({
    name: "فصل", description: "فصل عسكري: سحب الرتب وإنهاء الشفت وتسجيل الفصل",
    options: [o.user("العسكري", "العسكري"), o.str("السبب", "سبب الفصل", { max: 300 }), o.choice("تصفير_النقاط", "تصفير نقاطه بعد الفصل؟", [["لا", "0"], ["نعم", "1"]], { required: false })],
    run: (ctx) => askDismiss(ctx, target(ctx), ctx.str("السبب")!, ctx.str("تصفير_النقاط") === "1"),
  });
  bot.command({
    name: "الغاء-فصل", description: "إرجاع عسكري مفصول", options: [o.user("العسكري", "العسكري"), o.str("السبب", "سبب الإرجاع", { max: 300 })],
    run: (ctx) => reinstate(ctx, target(ctx), ctx.str("السبب")!),
  });
  bot.command({ name: "انهاء-شفت", description: "إنهاء شفت عسكري يدوياً (لمسؤولي النقاط)", options: [o.user("العسكري", "العسكري")], run: (ctx) => forceEnd(ctx, target(ctx)) });

  // ─────────── /الداخلية (إعدادات الأدمن) ───────────
  const settingsEmbed = (gid: string, title: string) => {
    const st = settings(gid);
    const r = (v?: string | null) => (v ? mention.role(String(v)) : "—");
    const chans = [...shiftChannels(gid)].map(mention.channel).join(" ");
    return embed({
      title, color: COLORS.brand, footer: footer(gid),
      description: !st.military_role_id ? "⚠️ لازم تحدد رتبة العسكر عشان يشتغل الشفت: `/الداخلية اعداد`" : !chans ? "⚠️ أضف روم شفت صوتي: `/الداخلية رومات-الشفت`" : undefined,
      fields: [
        field("رتبة المسؤول", r(st.manager_role_id)), field("رتبة العسكر", r(st.military_role_id)), field("رتبة المفصول", r(st.dismissed_role_id)),
        field("روم اللوق", st.log_channel_id ? mention.channel(String(st.log_channel_id)) : "—"),
        field("الشفت التلقائي", st.shift_enabled ? "🟢 شغال" : "🔴 موقف"), field("النقاط", `كل ${st.shift_block} دقيقة = ${st.shift_points} نقطة`),
        field("أقل مدة", `${st.shift_min} دقيقة`), field("«هل انت موجود؟»", st.check_after ? `بعد ${st.check_after} دقيقة` : "بدون تحقق"),
        field("مهلة الرد", `${st.check_timeout} دقيقة`), field("حد الإنذارات", st.warn_limit ? String(st.warn_limit) : "بدون فصل تلقائي"),
        field("رومات الشفت", chans || "—", false),
      ],
    });
  };
  const ACTIONS: [string, string][] = [["اضافة", "add"], ["ازالة", "remove"], ["عرض", "list"]];

  bot.command({
    name: "الداخلية", description: "إعدادات نظام وزارة الداخلية (النقاط والشفتات والفصل)", perms: P.Administrator,
    options: [
      o.sub("اعداد", "تحديد رتب النظام وروم اللوق", [
        o.role("رتبة_المسؤول", "رتبة مسؤولي النقاط (يضيفون ويخصمون ويفصلون)"), o.role("رتبة_العسكر", "رتبة العساكر (وزارة الداخلية)"),
        o.channel("روم_اللوق", "روم لوق النقاط والشفتات والفصل", { required: false }), o.role("رتبة_المفصول", "رتبة تُعطى للمفصول (اختياري)", { required: false }),
      ]),
      o.sub("رومات-الشفت", "إضافة أو إزالة رومات الشفت الصوتية", [
        o.choice("العملية", "إضافة أو إزالة أو عرض", ACTIONS), o.channel("الروم", "الروم الصوتي", { required: false, types: [ChannelType.Voice, ChannelType.Stage] }),
      ]),
      o.sub("رتب-الفصل", "رتب إضافية تنسحب من العسكري عند فصله (مثل رتب الدرجات)", [
        o.choice("العملية", "إضافة أو إزالة أو عرض", ACTIONS), o.role("الرتبة", "الرتبة", { required: false }),
      ]),
      o.sub("نظام-الشفت", "تشغيل/إيقاف الشفت التلقائي وتعديل النقاط ووقت التحقق", [
        o.choice("الحالة", "تشغيل أو إيقاف الشفت التلقائي", [["تشغيل", "1"], ["ايقاف", "0"]], { required: false }),
        o.int("النقاط", "كم نقطة يأخذ العسكري", { min: 0, max: 1000, required: false }),
        o.int("كل_كم_دقيقة", "كل كم دقيقة شفت يأخذ النقاط (مثلاً 10)", { min: 1, max: 600, required: false }),
        o.int("اقل_مدة", "أقل مدة شفت تنحسب (بالدقائق)", { min: 0, max: 600, required: false }),
        o.int("التحقق_بعد", "بعد كم دقيقة يرسل «هل انت موجود؟» (0 = بدون تحقق)", { min: 0, max: 1440, required: false }),
        o.int("مهلة_الرد", "كم دقيقة ينتظر الرد قبل ما يوقف الشفت", { min: 1, max: 240, required: false }),
        o.int("حد_الانذارات", "عدد الإنذارات اللي يُفصل بعدها تلقائياً (0 = بدون)", { min: 0, max: 50, required: false }),
      ]),
      o.sub("الاعدادات", "عرض إعدادات نظام الداخلية"),
      o.sub("لوحة-الادارة", "إرسال لوحة تحكم المسؤولين في هذا الروم", [o.str("الوصف", "وصف اللوحة (اختياري)", { required: false, max: 3000 })]),
      o.sub("لوحة-الخدمات", "إرسال لوحة خدمات العساكر في هذا الروم", [o.str("الوصف", "وصف اللوحة (اختياري)", { required: false, max: 3000 })]),
      o.sub("تصفير", "تصفير كل نقاط السيرفر (مع تأكيد)"),
    ],
    run: async (ctx) => {
      const gid = ctx.guildId!;
      switch (ctx.sub) {
        case "اعداد": {
          const v: Record<string, string> = { manager_role_id: ctx.id("رتبة_المسؤول")!, military_role_id: ctx.id("رتبة_العسكر")! };
          if (ctx.id("روم_اللوق")) v.log_channel_id = ctx.id("روم_اللوق")!;
          if (ctx.id("رتبة_المفصول")) v.dismissed_role_id = ctx.id("رتبة_المفصول")!;
          setSettings(gid, v);
          return ctx.reply({ embeds: [settingsEmbed(gid, "✅ تم حفظ الإعدادات")] }, true);
        }
        case "رومات-الشفت": {
          const action = ctx.str("العملية");
          const ch = ctx.id("الروم");
          if (action !== "list") {
            if (!ch) return ctx.fail("حدد الروم الصوتي.");
            if (action === "add") sql.run("INSERT OR IGNORE INTO shift_channels VALUES (?, ?)", gid, ch);
            else sql.run("DELETE FROM shift_channels WHERE guild_id = ? AND channel_id = ?", gid, ch);
            channelsCache.delete(gid);
            const g = bot.guild(gid);
            if (action === "add" && g) { // اللي موجودين في الروم الحين يبدأ شفتهم
              for (const [uid, c] of g.voice) if (c === ch) {
                const m = await bot.member(gid, uid);
                if (m && canShift(m)) await startShift(m, ch);
              }
            } else if (action === "remove") {
              for (const s of [...active.values()]) if (s.guild_id === gid && s.channel_id === ch) await endShift(gid, s.user_id, "left");
            }
          }
          const list = [...shiftChannels(gid)].map((c) => `🔊 ${mention.channel(c)}`).join("\n") || "ما فيه رومات شفت.";
          return ctx.reply({ embeds: [embed({ title: "🔊 رومات الشفت", description: list, color: COLORS.brand })] }, true);
        }
        case "رتب-الفصل": {
          const ids = roleIds(settings(gid).dismiss_roles);
          const role = ctx.id("الرتبة");
          const action = ctx.str("العملية");
          if (action !== "list") {
            if (!role) return ctx.fail("حدد الرتبة.");
            if (action === "add" && !ids.includes(role)) ids.push(role);
            if (action === "remove" && ids.includes(role)) ids.splice(ids.indexOf(role), 1);
            setSettings(gid, { dismiss_roles: ids.join(",") });
          }
          return ctx.reply({ embeds: [embed({ title: "⛔ رتب الفصل", color: COLORS.error, description: ids.map(mention.role).join(" ") || "ما فيه رتب إضافية — يُسحب بس رتبة العسكر ورتبة المسؤول." })] }, true);
        }
        case "نظام-الشفت": {
          const map: Record<string, string> = { "النقاط": "shift_points", "كل_كم_دقيقة": "shift_block", "اقل_مدة": "shift_min", "التحقق_بعد": "check_after", "مهلة_الرد": "check_timeout", "حد_الانذارات": "warn_limit" };
          const v: Record<string, number> = {};
          if (ctx.has("الحالة")) v.shift_enabled = Number(ctx.str("الحالة"));
          for (const [opt, col] of Object.entries(map)) if (ctx.has(opt)) v[col] = ctx.int(opt)!;
          if (Object.keys(v).length) setSettings(gid, v);
          return ctx.reply({ embeds: [settingsEmbed(gid, Object.keys(v).length ? "✅ تم الحفظ" : "⚙️ إعدادات الداخلية")] }, true);
        }
        case "الاعدادات":
          return ctx.reply({ embeds: [settingsEmbed(gid, "⚙️ إعدادات الداخلية")] }, true);
        case "لوحة-الادارة": {
          if (!settings(gid).manager_role_id) return ctx.fail("استخدم `/الداخلية اعداد` أول.");
          const desc = ctx.str("الوصف") ?? "لوحة تحكم مسؤولي وزارة الداخلية.\n\n➕ إضافة نقاط · ➖ خصم نقاط · ⚠️ إنذار · ⛔ فصل · ↩️ إلغاء فصل\n⏹️ إنهاء شفت · 📜 سجل عسكري · 🟢 الشفتات الحالية · 🔄 تصفير";
          await bot.send(ctx.channelId, { embeds: [embed({ title: "🛡️ لوحة تحكم الداخلية", description: desc, color: 0xc0392b, thumbnail: bot.guildIcon(bot.guild(gid)), footer: footer(gid) })], components: [adminPanel()] });
          setSettings(gid, { panel_channel_id: ctx.channelId });
          return ctx.reply("✅ تم إرسال لوحة التحكم.", true);
        }
        case "لوحة-الخدمات": {
          const st = settings(gid);
          const chans = [...shiftChannels(gid)].map(mention.channel).join(" ");
          const desc = ctx.str("الوصف") ?? `خدمات العساكر في وزارة الداخلية.\n\n🪪 بطاقتي · 🔍 بطاقة عسكري · 🏆 توب 10 · ⏱️ حالة شفتي · 📜 سجلي\n\n⏱️ **الشفت تلقائي:** ادخل روم الشفت ويبدأ شفتك، وكل **${st.shift_block} دقيقة = ${st.shift_points} نقطة**.${chans ? `\n🔊 رومات الشفت: ${chans}` : ""}`;
          await bot.send(ctx.channelId, { embeds: [embed({ title: "🎖️ خدمات وزارة الداخلية", description: desc, color: COLORS.navy, thumbnail: bot.guildIcon(bot.guild(gid)), footer: footer(gid) })], components: [publicPanel()] });
          return ctx.reply("✅ تم إرسال لوحة الخدمات.", true);
        }
        case "تصفير":
          return askReset(ctx);
      }
    },
  });
}

/** للاختبارات: الوصول للحالة الداخلية. */
export const _test = {
  active, blocked, sql, settings, setSettings, shiftChannels, channelsCache, settingsCache,
  tick: null as null | (() => Promise<void>),
};
