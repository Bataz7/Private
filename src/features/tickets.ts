/**
 * نظام التذاكر الاحترافي (من cogs/tickets.py).
 *
 * - واجهة Components V2 (بطاقات Container) — رسائل التحكم القديمة (إيمبد) تتحدث بنفس شكلها.
 * - أسئلة قبل فتح التذكرة (12 قالب جاهز أو أسئلة مخصصة من لوحة التحكم) تظهر إجاباتها داخل التذكرة.
 * - حالة التذاكر في tickets.db فتبقى الأزرار تعمل بعد إعادة التشغيل (بدون بيانات داخل الأزرار).
 * - استلام/إلغاء استلام، أولوية، إضافة/إزالة عضو، نسخة المحادثة HTML، تقييم بالخاص، لوق مفصّل.
 * - /تذكرة اعداد · لوحة · اغلاق · استلام · اضافة · ازالة · تسمية · الاولوية · نسخة · معلومات
 * - نفس custom_id القديمة، فالبانلات المرسلة سابقاً تستمر بالعمل.
 * - لوحة التحكم ترسل البانل عبر مهمة "ticket-panel".
 */
import type { Bot } from "../discord/client.ts";
import type { Ctx, Payload } from "../discord/ctx.ts";
import { DiscordAPIError } from "../discord/rest.ts";
import { ButtonStyle, ChannelType, MessageFlags, P } from "../discord/constants.ts";
import { db, JsonStore, TTL } from "../core/db.ts";
import { E } from "../core/emojis.ts";
import { onJob } from "../core/jobs.ts";
import { log } from "../core/log.ts";
import { o } from "../core/opts.ts";
import {
  button, channelSelect, clip, container, embed, field, gallery, input, mention, modal, row as ar, section, select, sep, text, thumb, ts, userSelect, V2,
} from "../core/ui.ts";
import { PRESETS, presetEmoji, questionsFor } from "./tickets/presets.ts";

const PRIORITIES = ["normal", "high", "urgent"] as const;
const P_LABEL: Record<string, string> = { normal: "عادية", high: "عالية", urgent: "عاجلة" };
const P_ACCENT: Record<string, number> = { normal: 0x2f6bff, high: 0xff7a1f, urgent: 0xf23d4f };
const RATE_LABEL: Record<number, string> = { 5: "ممتاز جداً", 4: "جيد جداً", 3: "جيد", 2: "مقبول", 1: "سيئ" };
const C = { brand: 0x2f6bff, success: 0x1fc46a, warn: 0xffa51f, gold: 0xf6c445, ticket: 0x2f6bff };

const T = {
  no_type: "❌ ما لقيت إعدادات هذا النوع من التذاكر.",
  no_ticket: "❌ هذا الروم ليس تذكرة.",
  staff_only: "❌ هذا الخيار للإدارة المسؤولة عن التذاكر فقط.",
  owner_or_staff: "❌ هذا الخيار لصاحب التذكرة أو الإدارة فقط.",
  no_cat: "❌ كاتيجوري التذاكر غير موجود. تواصل مع الإدارة.",
  no_perm_bot: "❌ البوت يحتاج صلاحية **إدارة الرومات** و **إدارة الصلاحيات** في كاتيجوري التذاكر.",
  welcome_default: "أهلاً بك! اشرح طلبك وسيرد عليك فريق الدعم بأقرب وقت. 💙",
  no_perm: "❌ ما عندك صلاحية لاستخدام هذا.",
  closing: "🔒 جاري إغلاق التذكرة… ستُحذف خلال 5 ثوانٍ وتُرسل لك النسخة والتقييم.",
  panel_none: "❌ ما فيه أنواع تذاكر محفوظة. استخدم `/تذكرة اعداد` أو لوحة التحكم أولاً.",
  panel_default_t: "مركز الدعم",
  panel_default_d: "اختر نوع التذكرة المناسب وسنكون معك بأسرع وقت.",
  cant_owner: "لا يمكن إزالة صاحب التذكرة.",
};

// ─────────── قاعدة البيانات ───────────
const sql = db("tickets.db");
const COLS: Record<string, string> = {
  guild_id: "INTEGER", type_num: "INTEGER", name: "TEXT", ticket_no: "INTEGER", status: "TEXT DEFAULT 'open'", priority: "TEXT DEFAULT 'normal'",
  closed_at: "TEXT", closed_by: "INTEGER", answers: "TEXT", rating: "INTEGER", rating_msg_id: "INTEGER", control_msg_id: "INTEGER", reason: "TEXT",
};
sql.exec("CREATE TABLE IF NOT EXISTS tickets (channel_id INTEGER PRIMARY KEY, user_id INTEGER, category TEXT, claimed_by INTEGER DEFAULT NULL, created_at TEXT)");
for (const [c, ddl] of Object.entries(COLS)) sql.addColumn("tickets", c, ddl);
sql.exec("CREATE INDEX IF NOT EXISTS idx_tk_user ON tickets(guild_id, user_id, status)");

interface Row {
  channel_id: string; user_id: string; category: string | null; claimed_by: string | null; created_at: string | null; guild_id: string;
  type_num: number | null; name: string | null; ticket_no: number | null; status: string; priority: string | null; closed_at: string | null;
  closed_by: string | null; answers: string | null; rating: number | null; rating_msg_id: string | null; control_msg_id: string | null; reason: string | null;
}

const getRow = (ch: string) => sql.get<Row>("SELECT * FROM tickets WHERE channel_id = ?", ch);
const byRating = (msg: string) => sql.get<Row>("SELECT * FROM tickets WHERE rating_msg_id = ?", msg);
const nextNo = (gid: string) => (sql.value<number>("SELECT MAX(ticket_no) FROM tickets WHERE guild_id = ?", gid) ?? 0) + 1;
const openOf = (gid: string, uid: string, num: number) =>
  sql.all<Row>("SELECT channel_id FROM tickets WHERE guild_id = ? AND user_id = ? AND type_num = ? AND status = 'open'", gid, uid, num);
function insert(kw: Record<string, string | number | null>) {
  const cols = Object.keys(kw);
  sql.run(`INSERT OR REPLACE INTO tickets(${cols.join(",")}) VALUES(${cols.map(() => "?").join(",")})`, ...Object.values(kw));
}
function update(ch: string, kw: Record<string, string | number | null>) {
  const cols = Object.keys(kw);
  sql.run(`UPDATE tickets SET ${cols.map((k) => `${k}=?`).join(",")} WHERE channel_id=?`, ...Object.values(kw), ch);
}
function stats(gid: string): [number, number, number | null] {
  const r = sql.get<{ n: number; o: number | null; a: number | null }>("SELECT COUNT(*) AS n, SUM(status='open') AS o, AVG(rating) AS a FROM tickets WHERE guild_id = ?", gid);
  return [r?.n ?? 0, r?.o ?? 0, r?.a ?? null];
}

/** tickets_data.json: {guild: {num: {name, category_id, support_role_id, …}}} — تعدّله لوحة التحكم. */
const store = new JsonStore("tickets_data.json");
type Cfg = Record<string, any>;
const types = (gid: string): Record<string, Cfg> => store.get()[gid] ?? {};
const cfgOf = (gid: string, num: unknown): Cfg | undefined => types(gid)[String(num)];
const sid = (v: unknown): string | null => (v === null || v === undefined || v === "" || v === 0 ? null : String(v));

const utcIso = () => `${new Date().toISOString().slice(0, 19)}+00:00`;
const isoSec = (s: string | null | undefined) => {
  const t = s ? Date.parse(s) : NaN;
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
};
/** نفس str(timedelta) في بايثون: "1 day, 2:03:04" */
function tdStr(sec: number): string {
  sec = Math.max(0, Math.floor(sec));
  const d = Math.floor(sec / 86400);
  const r = sec % 86400;
  const hms = `${Math.floor(r / 3600)}:${String(Math.floor((r % 3600) / 60)).padStart(2, "0")}:${String(r % 60).padStart(2, "0")}`;
  return d ? `${d} day${d === 1 ? "" : "s"}, ${hms}` : hms;
}
export function slug(s: string): string {
  const x = s.toLowerCase().replace(/[^\p{L}\p{N}\p{M}_؀-ۿ-]+/gu, "-").replace(/^-+|-+$/g, "");
  return x.slice(0, 40) || "user";
}
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

// ─────────── نسخة المحادثة (HTML خفيفة) ───────────
const CSS = "body{margin:0;background:#1e1f22;color:#dbdee1;font:15px/1.5 system-ui,'Segoe UI',Tahoma,sans-serif}header{padding:20px 28px;background:#2b2d31;border-bottom:1px solid #111}"
  + "h1{margin:0;font-size:20px;color:#fff}small{color:#949ba4}.m{display:flex;gap:14px;padding:8px 28px}.m:hover{background:#2e3035}"
  + ".a{width:40px;height:40px;border-radius:50%;flex:none;background:#5865f2}.n{font-weight:600;color:#fff}.b{background:#5865f2;color:#fff;border-radius:4px;padding:0 5px;font-size:11px;margin-inline-start:4px}"
  + ".t{color:#949ba4;font-size:12px;margin-inline-start:8px}.c{white-space:pre-wrap;word-break:break-word}.e{border-inline-start:4px solid #5865f2;background:#2b2d31;border-radius:4px;padding:8px 12px;margin-top:4px;max-width:520px}"
  + ".f a{color:#00a8fc}";
/** حد حجم النسخة بالأحرف (بايثون 1.8 مليون — هنا أقل عشان ميزانية الذاكرة). */
const TRANSCRIPT_MAX_CHARS = 1_000_000;

const fmtUtc = (iso: string) => iso.slice(0, 16).replace("T", " ");
const idCmp = (a: string, b: string) => (a.length - b.length) || (a < b ? -1 : a > b ? 1 : 0);

export default function setup(bot: Bot): void {
  const cool = new TTL<number>(20_000, 500); // "gid:uid" → وقت انتهاء الانتظار

  const isStaff = (ctx: Ctx, cfg: Cfg | undefined): boolean => {
    if (ctx.isAdmin) return true;
    const ids = [sid(cfg?.support_role_id), sid(cfg?.ticket_mod_role_id)].filter(Boolean) as string[];
    return ids.some((r) => ctx.hasRole(r));
  };

  /** صف التذكرة؛ للتذاكر القديمة (قبل التحديث) نستنتجه من الروم ونحفظه. */
  async function resolve(gid: string | undefined, chId: string): Promise<Row | undefined> {
    if (!gid) return undefined;
    const r = getRow(chId);
    if (r) return r;
    const ch = bot.channel(chId);
    if (!ch || ch.type !== ChannelType.Text) return undefined;
    const m = /-(\d{1,2})$/.exec(ch.name || "");
    if (!m || !ch.parentId) return undefined;
    let owner: string | undefined;
    for (const ow of ch.overwrites) {
      if (ow.type !== 1 || ow.id === bot.user.id) continue;
      const mem = await bot.member(gid, ow.id);
      if (mem && !mem.bot) {
        owner = ow.id;
        break;
      }
    }
    if (!owner) return undefined;
    insert({ channel_id: chId, user_id: owner, category: "legacy", guild_id: gid, type_num: Number(m[1]), name: null, ticket_no: nextNo(gid), created_at: utcIso(), status: "open", priority: "normal" });
    return getRow(chId);
  }

  // ─────────── رسالة التذكرة ───────────
  interface Owner { id: string; name: string; avatar: string }
  async function ownerOf(gid: string, uid: string): Promise<Owner | null> {
    const m = await bot.member(gid, uid);
    return m ? { id: m.id, name: bot.name(m), avatar: bot.avatar(m, 256) } : null;
  }

  const manageSelect = () => select("persistent_ticket_actions_select", [
    { label: "تعديل اسم التذكرة", value: "rename", emoji: E("ticket_rename") },
    { label: "استدعاء صاحب التذكرة", value: "ping", emoji: E("ticket_notify") },
    { label: "إضافة عضو", value: "add", emoji: E("ticket_user_add") },
    { label: "إزالة عضو", value: "remove", emoji: E("ticket_user_remove") },
    { label: "تغيير الأولوية", value: "priority", emoji: E("ticket_priority") },
  ], { placeholder: "⚙️ خيارات إدارة التذكرة…" });

  function render(row: Row, cfg: Cfg, owner: Owner, v2 = true): Payload {
    const emoji = presetEmoji(cfg.preset);
    const name = cfg.name || `تذكرة ${owner.name}`;
    const welcome = cfg.welcome_msg || T.welcome_default;
    const claimer = sid(row.claimed_by);
    const pr = PRIORITIES.includes(row.priority as any) ? row.priority! : "normal";
    const opened = isoSec(row.created_at);
    const info = [
      `${E("ticket_user")} **صاحب التذكرة:** ${mention.user(owner.id)}`,
      `${E("ticket_time")} **وقت الفتح:** ${opened ? ts(opened, "R") : "—"}`,
      `${E("ticket_priority")} **الأولوية:** \`${P_LABEL[pr]}\``,
      `${E("ticket_claim")} **المستلم:** ${claimer ? mention.user(claimer) : "`لم تُستلم بعد`"}`,
    ].join("\n");
    let answers: [string, string][] = [];
    try {
      answers = row.answers ? JSON.parse(row.answers) : [];
    } catch {}
    const qa = answers.map(([q, a]) => `**${q}**\n> ${clip(a, 500).replaceAll("\n", "\n> ")}`).join("\n\n");
    const accent = claimer ? 0x1fc46a : P_ACCENT[pr]!;
    const support = sid(cfg.support_role_id);
    const ping = `${mention.user(owner.id)} ${support ? mention.role(support) : ""}`;
    const allowed = { users: [owner.id], roles: support ? [support] : [] };

    const claim = button("persistent_claim_ticket_btn", claimer ? "إلغاء الاستلام" : "استلام", claimer ? ButtonStyle.Secondary : ButtonStyle.Success,
      { emoji: E(claimer ? "ticket_unclaim" : "ticket_claim") });
    const close = button("persistent_close_ticket_btn", "إغلاق", ButtonStyle.Danger, { emoji: E("ticket_close") });
    const call = button("persistent_summon_support_btn", "استدعاء الدعم", ButtonStyle.Primary, { emoji: E("ticket_notify") });

    if (v2) {
      return {
        flags: V2, allowed_mentions: allowed,
        components: [container(accent,
          text(ping),
          section([`## ${emoji} ${name}\n${welcome}`], thumb(owner.avatar)),
          sep(),
          text(info),
          qa ? sep() : null,
          qa ? text(`### ${E("ticket_questions")} إجابات صاحب التذكرة\n${clip(qa, 3000)}`) : null,
          cfg.image_url ? gallery(String(cfg.image_url)) : null,
          sep(true, true),
          ar(claim, close, call),
          ar(manageSelect()),
        )],
      };
    }
    return {
      content: ping, allowed_mentions: allowed,
      embeds: [embed({
        title: `${emoji} ${name}`, description: welcome, color: accent, thumbnail: owner.avatar, image: cfg.image_url || null,
        fields: [field("​", info, false), qa ? field(`${E("ticket_questions")} إجابات صاحب التذكرة`, clip(qa, 1000), false) : null],
      })],
      components: [ar(claim, close, call), ar(manageSelect())],
    };
  }

  async function refreshControl(chId: string, row: Row) {
    const gid = row.guild_id;
    const cfg = cfgOf(gid, row.type_num) ?? {};
    const owner = await ownerOf(gid, row.user_id);
    if (!owner || !row.control_msg_id) return;
    let msg: any;
    try {
      msg = await bot.rest.get(`/channels/${chId}/messages/${row.control_msg_id}`);
    } catch {
      return;
    }
    const v2 = ((msg.flags ?? 0) & MessageFlags.ComponentsV2) !== 0;
    const p = render(row, cfg, owner, v2);
    const body: Payload = v2 ? { components: p.components } : { content: p.content, embeds: p.embeds, components: p.components };
    await bot.edit(chId, String(row.control_msg_id), body).catch((e) => log.debug("tickets", `refresh: ${e.message}`));
  }

  // ─────────── فتح تذكرة ───────────
  async function openTicket(ctx: Ctx, num: number) {
    const gid = ctx.guildId;
    const cfg = gid ? cfgOf(gid, num) : undefined;
    if (!gid || !cfg) return ctx.reply(T.no_type, true);
    const key = `${gid}:${ctx.user.id}`;
    const wait = (cool.get(key) ?? 0) - Date.now();
    if (wait > 0) return ctx.reply(`⏳ انتظر ${Math.floor(wait / 1000) + 1} ثانية قبل فتح تذكرة جديدة.`, true);
    const existing = openOf(gid, ctx.user.id, num).filter((r) => bot.channel(String(r.channel_id)));
    if (existing.length >= (Number.parseInt(cfg.max_open, 10) || 1)) {
      return ctx.reply(`❌ عندك تذكرة مفتوحة بالفعل من هذا النوع: ${mention.channel(String(existing[0]!.channel_id))}`, true);
    }
    const qs = questionsFor(cfg);
    if (qs.length) {
      return ctx.showModal(modal(`tk:q:${num}`, String(cfg.name || "تذكرة").slice(0, 45), qs.map((q) => input(q.id, q.label, {
        placeholder: q.ph || undefined, required: q.required, max: q.style === "p" ? 1000 : 200, paragraph: q.style === "p",
      }))));
    }
    await ctx.defer(true);
    await create(ctx, num, cfg, []);
  }

  async function create(ctx: Ctx, num: number, cfg: Cfg, answers: [string, string][]) {
    const gid = ctx.guildId!;
    const user = ctx.user;
    const catId = sid(cfg.category_id);
    const category = catId ? bot.channel(catId) : undefined;
    if (!category || category.type !== ChannelType.Category) return ctx.reply(T.no_cat, true);
    const s = (x: bigint) => String(x);
    const memberAllow = P.ViewChannel | P.SendMessages | P.ReadMessageHistory | P.AttachFiles | P.EmbedLinks;
    const overwrites: any[] = [
      { id: gid, type: 0, allow: "0", deny: s(P.ViewChannel) },
      { id: user.id, type: 1, allow: s(memberAllow), deny: "0" },
      { id: bot.user.id, type: 1, allow: s(P.ViewChannel | P.SendMessages | P.ManageChannels | P.ManageMessages | P.EmbedLinks | P.AttachFiles), deny: "0" },
    ];
    for (const k of ["support_role_id", "ticket_mod_role_id"]) {
      const rid = sid(cfg[k]);
      if (rid && bot.role(gid, rid)) {
        const allow = P.ViewChannel | P.SendMessages | P.ReadMessageHistory | P.AttachFiles | (k === "ticket_mod_role_id" ? P.ManageMessages : 0n);
        const prev = overwrites.find((x) => x.id === rid);
        if (prev) prev.allow = s(BigInt(prev.allow) | allow);
        else overwrites.push({ id: rid, type: 0, allow: s(allow), deny: "0" });
      }
    }
    const no = nextNo(gid);
    let ch: any;
    try {
      ch = await bot.rest.post(`/guilds/${gid}/channels`, {
        body: { name: `تذكرة-${String(no).padStart(4, "0")}-${slug(user.username)}-${num}`.slice(0, 100), type: ChannelType.Text, parent_id: category.id,
          permission_overwrites: overwrites, topic: `ticket:${user.id}:${num}` },
        reason: `تذكرة بواسطة ${user.username}`,
      });
    } catch (e) {
      if (e instanceof DiscordAPIError && e.status === 403) return ctx.reply(T.no_perm_bot, true);
      throw e;
    }
    const row: Record<string, string | number | null> = {
      channel_id: ch.id, user_id: user.id, category: cfg.preset || "custom", guild_id: gid, type_num: num, name: cfg.name ?? null, ticket_no: no,
      created_at: utcIso(), status: "open", priority: "normal", answers: answers.length ? JSON.stringify(answers) : null,
    };
    insert(row);
    const m = ctx.member;
    const owner: Owner = m ? { id: m.id, name: bot.name(m), avatar: bot.avatar(m, 256) } : { id: user.id, name: user.globalName || user.username, avatar: bot.avatar(user, 256) };
    const msg = await bot.send(ch.id, render(getRow(ch.id)!, cfg, owner));
    update(ch.id, { control_msg_id: msg.id });
    await bot.rest.put(`/channels/${ch.id}/pins/${msg.id}`).catch(() => undefined);
    cool.set(`${gid}:${user.id}`, Date.now() + 20_000);
    await ctx.reply(`✅ تم إنشاء تذكرتك: ${mention.channel(ch.id)}`, true);
  }

  // ─────────── إجراءات داخل التذكرة ───────────
  /** يرجع {row, cfg} أو null بعد الرد بالخطأ. */
  async function tctx(ctx: Ctx, staff = false, allowOwner = false): Promise<{ row: Row; cfg: Cfg } | null> {
    const row = await resolve(ctx.guildId, ctx.channelId);
    if (!row) {
      await ctx.reply(T.no_ticket, true);
      return null;
    }
    const cfg = cfgOf(row.guild_id, row.type_num) ?? {};
    const msg = ctx.message;
    if (msg && !row.control_msg_id && msg.channel_id === ctx.channelId && !((msg.flags ?? 0) & MessageFlags.Ephemeral)) {
      update(ctx.channelId, { control_msg_id: msg.id });
      row.control_msg_id = msg.id;
    }
    if (staff && !isStaff(ctx, cfg) && !(allowOwner && ctx.user.id === String(row.user_id))) {
      await ctx.reply(allowOwner ? T.owner_or_staff : T.staff_only, true);
      return null;
    }
    return { row, cfg };
  }

  async function doClaim(ctx: Ctx) {
    const c = await tctx(ctx, true);
    if (!c) return;
    const { row } = c;
    const cur = sid(row.claimed_by);
    const unclaim = cur === ctx.user.id;
    if (cur && !unclaim && !ctx.isAdmin) return ctx.reply(`${mention.user(cur)} استلم التذكرة وسيتابع معك.`, true);
    update(ctx.channelId, { claimed_by: unclaim ? null : ctx.user.id });
    row.claimed_by = unclaim ? null : ctx.user.id;
    await ctx.reply({ embeds: [embed({
      color: unclaim ? C.warn : C.success,
      description: unclaim ? `${E("ticket_unclaim")} ${mention.user(ctx.user.id)} ألغى استلام التذكرة. بانتظار مسؤول آخر.`
        : `${E("ticket_claim")} ${mention.user(ctx.user.id)} استلم التذكرة وسيتابع معك.`,
    })] });
    await refreshControl(ctx.channelId, row);
  }

  async function doCall(ctx: Ctx) {
    const c = await tctx(ctx);
    if (!c) return;
    const { row, cfg } = c;
    if (ctx.user.id !== String(row.user_id) && !isStaff(ctx, cfg)) return ctx.reply(T.owner_or_staff, true);
    const roles = ["support_role_id", "ticket_mod_role_id"].map((k) => sid(cfg[k])).filter(Boolean) as string[];
    const who = roles.map(mention.role).join(" ") || "@here";
    await ctx.reply({ content: `${E("ticket_notify")} 🔔 تم استدعاء فريق الدعم: ${who}`, allowed_mentions: roles.length ? { roles } : { parse: ["everyone"] } });
  }

  async function doManage(ctx: Ctx, choice: string) {
    const c = await tctx(ctx, true);
    if (!c) return;
    const { row } = c;
    const uid = String(row.user_id);
    if (choice === "rename") return ctx.showModal(modal("tk:rename", "تعديل اسم التذكرة", [input("n", "الاسم الجديد", { max: 90 })]));
    if (choice === "ping") return ctx.reply({ content: `🔔 ${mention.user(uid)} فريق الدعم ينتظر ردك.`, allowed_mentions: { users: [uid] } });
    if (choice === "add" || choice === "remove") {
      return ctx.reply({ content: choice === "add" ? "اختر العضو الذي تريد إضافته:" : "اختر العضو الذي تريد إزالته:", components: [ar(userSelect(`tk:pick:${choice}`, "…"))] }, true);
    }
    if (choice === "priority") {
      return ctx.reply({ content: "اختر الأولوية", components: [ar(select("tk:prio", PRIORITIES.map((p) => ({ label: P_LABEL[p]!, value: p, emoji: E("ticket_priority") })), { placeholder: "اختر الأولوية" }))] }, true);
    }
  }

  const addMember = (chId: string, uid: string) =>
    bot.rest.put(`/channels/${chId}/permissions/${uid}`, { body: { type: 1, allow: String(P.ViewChannel | P.SendMessages | P.ReadMessageHistory | P.AttachFiles), deny: "0" } });
  const removeMember = (chId: string, uid: string) => bot.rest.delete(`/channels/${chId}/permissions/${uid}`);

  async function rename(ctx: Ctx, name: string) {
    await ctx.defer(true);
    await bot.rest.patch(`/channels/${ctx.channelId}`, { body: { name: slug(name).slice(0, 90) || "تذكرة" } });
    await ctx.edit(`✅ تم تغيير الاسم إلى **${name}**`);
  }

  async function setPriority(ctx: Ctx, row: Row, level: string) {
    if (!PRIORITIES.includes(level as any)) level = "normal";
    update(String(row.channel_id), { priority: level });
    row.priority = level;
    await ctx.reply(`✅ الأولوية الآن: **${P_LABEL[level]}**`, true);
    await refreshControl(String(row.channel_id), row);
  }

  async function buildTranscript(chId: string, gid: string, limit = 2500): Promise<{ data: Uint8Array; count: number }> {
    const chName = bot.channel(chId)?.name ?? chId;
    const parts: string[] = [];
    let size = 0;
    const w = (s: string) => {
      parts.push(s);
      size += s.length;
    };
    w(`<!doctype html><meta charset='utf-8'><title>${esc(chName)}</title><style>${CSS}</style>`);
    w(`<header><h1>#${esc(chName)}</h1><small>${esc(bot.guild(gid)?.name ?? "")} · ${fmtUtc(new Date().toISOString())} UTC</small></header>`);
    let n = 0;
    let after = "0";
    outer: while (n < limit) {
      let page: any[];
      try {
        page = await bot.rest.get(`/channels/${chId}/messages`, { query: { limit: 100, after } });
      } catch {
        break;
      }
      if (!page.length) break;
      page.sort((a, b) => idCmp(a.id, b.id));
      for (const m of page) {
        n++;
        const a = m.author ?? {};
        const av = esc(a.id ? bot.avatar({ id: a.id, avatar: a.avatar ?? null }, 64) : "");
        let extra = "";
        for (const e of m.embeds ?? []) extra += `<div class='e'><b>${esc(e.title ?? "")}</b><div>${esc(e.description ?? "")}</div></div>`;
        for (const f of m.attachments ?? []) extra += `<div class='f'><a href='${esc(f.url)}'>📎 ${esc(f.filename)}</a></div>`;
        if (m.components?.length && !m.content && !m.embeds?.length) extra += "<div class='c'><small>[مكونات]</small></div>";
        w(`<div class='m'><img class='a' src='${av}' width='40' height='40'><div><span class='n'>${esc(a.global_name || a.username || "?")}</span>`
          + `${a.bot ? "<span class=b>بوت</span>" : ""}<span class='t'>${fmtUtc(String(m.timestamp ?? ""))}</span><div class='c'>${esc(m.content ?? "")}</div>${extra}</div></div>`);
        if (size > TRANSCRIPT_MAX_CHARS) {
          w("<p style='padding:16px 28px'><small>… تم اختصار النسخة</small></p>");
          break outer;
        }
        if (n >= limit) break outer;
      }
      after = page[page.length - 1].id;
      if (page.length < 100) break;
    }
    return { data: new TextEncoder().encode(parts.join("")), count: n };
  }

  async function doClose(ctx: Ctx, reason: string | null) {
    const gid = ctx.guildId;
    const row = await resolve(gid, ctx.channelId);
    if (!gid || !row) return ctx.reply(T.no_ticket, true);
    const cfg = cfgOf(gid, row.type_num) ?? {};
    if (!(isStaff(ctx, cfg) || ctx.user.id === String(row.user_id))) return ctx.reply(T.owner_or_staff, true);
    await ctx.reply(`${E("ticket_close")} ${T.closing}`);
    const chId = ctx.channelId;
    const closedAt = utcIso();
    update(chId, { status: "closed", closed_at: closedAt, closed_by: ctx.user.id, reason });
    const { data, count } = await buildTranscript(chId, gid);
    const file = { name: `نسخة-تذكرة-${row.ticket_no || chId}.html`, data, contentType: "text/html" };
    const ownerId = String(row.user_id);
    const owner = await bot.member(gid, ownerId);
    // لوق الإدارة
    const logId = sid(cfg.log_channel_id);
    if (logId && bot.channel(logId)) {
      const claimer = sid(row.claimed_by);
      const opened = isoSec(row.created_at);
      const g = bot.guild(gid);
      await bot.trySend(logId, { embeds: [embed({
        title: `${E("ticket_close")} تم إغلاق تذكرة · #${row.ticket_no ?? ""}`, color: C.ticket,
        thumbnail: owner ? bot.avatar(owner, 256) : bot.guildIcon(g),
        fields: [
          field(`${E("ticket_user")} صاحب التذكرة`, mention.user(ownerId)),
          field(`${E("ticket_claim")} المستلم`, claimer ? mention.user(claimer) : "لم تُستلم بعد"),
          field(`${E("ticket")} النوع`, cfg.name || "—"),
          field(`${E("ticket_close")} أُغلقت بواسطة`, mention.user(ctx.user.id)),
          field(`${E("ticket_time")} المدة`, `\`${opened ? tdStr(Date.now() / 1000 - opened) : "—"}\``),
          field(`${E("message")} الرسائل`, `\`${count}\``),
          reason ? field(`${E("ticket_note")} السبب`, clip(reason, 500), false) : null,
          opened ? field("وقت الفتح", ts(opened, "f")) : null,
          field("وقت الإغلاق", ts(Date.now() / 1000, "f")),
        ],
      })], files: [file] });
    }
    // خاص صاحب التذكرة: تقييم + نسخة
    if (owner && sid(cfg.rating_channel_id)) {
      const m = await bot.dm(ownerId, {
        embeds: [embed({ title: `${E("ticket_rating")} قيّم تجربتك`, description: `شكراً لتواصلك! كيف كانت خدمة فريق الدعم في تذكرة **${cfg.name || "—"}**؟`, color: C.gold })],
        components: [ar(select("persistent_rating_select", [5, 4, 3, 2, 1].map((n) => ({ label: `${"⭐".repeat(n)} ${RATE_LABEL[n]}`, value: String(n), emoji: E("ticket_rating") })), { placeholder: "⭐ اختر تقييمك" }))],
        files: [file],
      });
      if (m) update(chId, { rating_msg_id: m.id });
    }
    await Bun.sleep(5000);
    await bot.rest.delete(`/channels/${chId}`, { reason: `تم إغلاق التذكرة بواسطة ${ctx.user.username}` }).catch(() => undefined);
  }

  async function doRating(ctx: Ctx, stars: number) {
    const row = ctx.message ? byRating(ctx.message.id) : undefined;
    if (!row) return ctx.reply(T.no_ticket, true);
    if (ctx.user.id !== String(row.user_id)) return ctx.reply("❌ هذا التقييم لصاحب التذكرة فقط.", true);
    stars = Math.max(1, Math.min(5, stars || 5));
    update(String(row.channel_id), { rating: stars });
    const gid = String(row.guild_id);
    const cfg = cfgOf(gid, row.type_num) ?? {};
    const rch = sid(cfg.rating_channel_id);
    if (bot.guild(gid) && rch && bot.channel(rch)) {
      const claimer = sid(row.claimed_by);
      await bot.trySend(rch, { embeds: [embed({
        title: `${E("ticket_rating")} تقييم تذكرة جديد`, color: C.gold,
        fields: [
          field("النوع", cfg.name || "—"), field("صاحب التذكرة", mention.user(String(row.user_id))),
          field("المستلم", claimer ? mention.user(claimer) : "لم تُستلم بعد"),
          field("التقييم", `${"⭐".repeat(stars)}${"✩".repeat(5 - stars)}  **${stars}/5** — ${RATE_LABEL[stars]}`, false),
        ],
      })] });
    }
    await ctx.update({ content: "", embeds: [embed({ title: `${E("success")} قيّم تجربتك`, description: "💙 شكراً لتقييمك! رأيك يساعدنا نتطور.", color: C.success })], components: [], attachments: [] });
  }

  // ─────────── البانل ───────────
  function panelPayload(cfgs: Record<string, Cfg>, nums: string[], display: string, title: string, desc: string, image: string | null): Payload {
    let rows: any[];
    if (display === "dropdown") {
      rows = [ar(select("persistent_panel_ticket_dropdown", nums.map((n) => ({
        label: String(cfgs[n]!.name ?? n).slice(0, 100), value: n, emoji: presetEmoji(cfgs[n]!.preset), description: PRESETS[cfgs[n]!.preset || ""]?.ar,
      })), { placeholder: "🎫 اختر نوع التذكرة…" }))];
    } else {
      const btns = nums.map((n, i) => button(`persistent_open_ticket_${n}`, String(cfgs[n]!.name ?? n).slice(0, 80), i % 2 === 0 ? ButtonStyle.Primary : ButtonStyle.Secondary, { emoji: presetEmoji(cfgs[n]!.preset) }));
      rows = [];
      for (let i = 0; i < btns.length; i += 5) rows.push(ar(...btns.slice(i, i + 5)));
    }
    return {
      flags: V2,
      components: [container(C.brand, image ? gallery(image) : null, text(`# ${E("ticket")} ${title}\n${desc}`), sep(true, true), ...rows)],
    };
  }

  /** تستخدمها لوحة التحكم والاستوديو: ترسل بانل التذاكر في الروم. */
  async function sendPanel(gid: string, channelId: string, title: string, desc: string, image: string | null, display: string, nums: string[]) {
    const ch = bot.channel(channelId);
    if (!ch || bot.guildOfChannel(channelId) !== gid || ![ChannelType.Text, ChannelType.News].includes(ch.type as any)) throw new Error("الروم غير موجود");
    const cfgs = types(gid);
    const list = nums.map(String).filter((n) => n in cfgs).slice(0, 25);
    if (!list.length) throw new Error("التذاكر المحددة غير مسطّبة");
    try {
      return await bot.send(channelId, panelPayload(cfgs, list, display, title, desc, image));
    } catch (e) {
      log.debug("tickets", `panel: ${(e as Error).message}`);
      throw new Error("تعذر إرسال البانل، تأكد من صلاحيات البوت في الروم");
    }
  }

  onJob("ticket-panel", async (gid, p: any) => {
    const channelId = String(p?.channel_id ?? "");
    if (!/^\d+$/.test(channelId)) throw new Error("حدد روم نصي صالح");
    const title = String(p.title ?? "").trim();
    const desc = String(p.desc ?? "").trim();
    if (!title || !desc) throw new Error("اكتب عنوان ووصف البانل");
    const image = String(p.image ?? "").trim() || null;
    if (image && !/^https?:\/\//.test(image)) throw new Error("رابط الصورة لازم يبدأ بـ http أو https");
    const nums = (Array.isArray(p.nums) ? p.nums : []).map(String).filter((n: string) => /^\d+$/.test(n));
    if (!nums.length) throw new Error("اختر عنصر واحد على الأقل");
    await sendPanel(gid, channelId, title, desc, image, p.display === "buttons" ? "buttons" : "dropdown", nums);
    return "تم إرسال البانل";
  });

  // ─────────── استوديو البانل (/تذكرة لوحة) ───────────
  interface Studio { owner: string; gid: string; channelId: string | null; display: string; nums: string[]; title: string; desc: string; image: string | null; edited: boolean }
  const studios = new TTL<Studio>(600_000, 50);
  const token = () => Math.random().toString(36).slice(2, 10);

  function studioView(t: string, s: Studio): Payload {
    const cfgs = types(s.gid);
    const items = Object.entries(cfgs).filter(([n]) => /^\d+$/.test(n)).sort((a, b) => Number(a[0]) - Number(b[0])).slice(0, 25);
    const chSel: any = channelSelect(`tk:st:${t}:ch`, "📍 اختر روم البانل", [ChannelType.Text]);
    if (s.channelId) chSel.default_values = [{ id: s.channelId, type: "channel" }];
    return {
      embeds: [s.edited ? embed({ title: `${E("ticket")} ${s.title}`, description: s.desc, color: C.brand, image: s.image }) : embed({ title: `${E("ticket_panel")} إرسال بانل التذاكر`, color: C.brand })],
      components: [
        ar(chSel),
        ar(select(`tk:st:${t}:style`, [
          { label: "أزرار", value: "buttons", emoji: E("ticket_panel"), default: s.display === "buttons" },
          { label: "قائمة منسدلة", value: "dropdown", emoji: E("list"), default: s.display === "dropdown" },
        ], { placeholder: "🔘 طريقة العرض" })),
        ar(select(`tk:st:${t}:items`, items.map(([n, c]) => ({ label: `${n}: ${c.name}`.slice(0, 100), value: n, emoji: E("ticket"), default: s.nums.includes(n) })),
          { placeholder: "🎫 اختر أنواع التذاكر", min: 1, max: Math.max(1, items.length) })),
        ar(button(`tk:st:${t}:edit`, "العنوان والوصف", ButtonStyle.Secondary, { emoji: E("message") }), button(`tk:st:${t}:send`, "إرسال", ButtonStyle.Success, { emoji: E("success") })),
      ],
    };
  }

  const studioOf = async (ctx: Ctx, t: string): Promise<Studio | null> => {
    const s = studios.get(t);
    if (!s) {
      await ctx.reply("⌛ انتهت صلاحية هذه اللوحة، أعد الأمر `/تذكرة لوحة`.", true);
      return null;
    }
    if (s.owner !== ctx.user.id) {
      await ctx.deferUpdate();
      return null;
    }
    return s;
  };

  bot.component("tk:st:", async (ctx) => {
    const [, , t, action] = ctx.customId.split(":") as [string, string, string, string];
    const s = await studioOf(ctx, t);
    if (!s) return;
    if (action === "ch") {
      s.channelId = ctx.values[0] ?? null;
      return ctx.deferUpdate();
    }
    if (action === "style") {
      s.display = ctx.values[0] === "dropdown" ? "dropdown" : "buttons";
      return ctx.deferUpdate();
    }
    if (action === "items") {
      s.nums = [...ctx.values];
      return ctx.deferUpdate();
    }
    if (action === "edit") {
      return ctx.showModal(modal(`tk:stm:${t}`, "نص البانل", [
        input("t", "العنوان", { max: 100, value: s.title }),
        input("d", "الوصف", { paragraph: true, max: 1500, value: s.desc }),
        input("i", "رابط الصورة (اختياري)", { required: false, value: s.image ?? undefined }),
      ]));
    }
    if (action === "send") {
      if (!s.channelId || !s.nums.length) return ctx.reply("اختر الروم وأنواع التذاكر أولاً.", true);
      await ctx.deferUpdate();
      try {
        await sendPanel(s.gid, s.channelId, s.title, s.desc, s.image, s.display, s.nums);
      } catch (e) {
        return ctx.followup(`❌ ${(e as Error).message}`, true);
      }
      studios.delete(t);
      await ctx.edit({ embeds: [embed({ description: `✅ تم إرسال البانل إلى ${mention.channel(s.channelId)}.`, color: C.success })], components: [] });
    }
  });

  bot.modal("tk:stm:", async (ctx) => {
    const t = ctx.customId.split(":")[2]!;
    const s = await studioOf(ctx, t);
    if (!s) return;
    s.title = ctx.fields.get("t") || s.title;
    s.desc = ctx.fields.get("d") || s.desc;
    s.image = (ctx.fields.get("i") ?? "").trim() || null;
    s.edited = true;
    await ctx.update(studioView(t, s));
  });

  // ─────────── الأزرار والقوائم الدائمة ───────────
  bot.component("persistent_open_ticket_", (ctx) => openTicket(ctx, Number.parseInt(ctx.customId.slice("persistent_open_ticket_".length), 10)));
  bot.component("persistent_panel_ticket_dropdown", (ctx) => openTicket(ctx, Number.parseInt(ctx.values[0] ?? "", 10)));
  bot.component("persistent_claim_ticket_btn", doClaim);
  bot.component("persistent_close_ticket_btn", (ctx) =>
    ctx.showModal(modal("tk:close", "إغلاق التذكرة", [input("r", "سبب الإغلاق (اختياري)", { required: false, max: 300, paragraph: true })])));
  bot.component("persistent_summon_support_btn", doCall);
  bot.component("persistent_ticket_actions_select", (ctx) => doManage(ctx, ctx.values[0] ?? ""));
  bot.component("persistent_rating_select", (ctx) => doRating(ctx, Number.parseInt(ctx.values[0] ?? "5", 10)));

  bot.modal("tk:q:", async (ctx) => {
    const num = Number.parseInt(ctx.customId.split(":")[2] ?? "", 10);
    await ctx.defer(true);
    const cfg = ctx.guildId ? cfgOf(ctx.guildId, num) : undefined;
    if (!cfg) return ctx.reply(T.no_type, true);
    const answers = questionsFor(cfg).map((q) => [q.label, (ctx.fields.get(q.id) ?? "").trim()] as [string, string]).filter(([, a]) => a);
    await create(ctx, num, cfg, answers);
  });
  bot.modal("tk:close", (ctx) => doClose(ctx, (ctx.fields.get("r") ?? "").trim() || null));
  bot.modal("tk:rename", async (ctx) => {
    const c = await tctx(ctx, true);
    if (c) await rename(ctx, ctx.fields.get("n") ?? "");
  });

  bot.component("tk:pick:", async (ctx) => {
    const action = ctx.customId.split(":")[2];
    const uid = ctx.values[0];
    const member = uid ? ctx.resolvedMember(uid) ?? (ctx.guildId ? await bot.member(ctx.guildId, uid) : null) : null;
    if (!member || !uid) return ctx.deferUpdate();
    const row = await resolve(ctx.guildId, ctx.channelId);
    if (!row) return ctx.update({ content: T.no_ticket, components: [] });
    if (action === "add") {
      await addMember(ctx.channelId, uid);
      return ctx.update({ content: `✅ تمت إضافة ${mention.user(uid)} إلى التذكرة.`, components: [] });
    }
    if (uid === String(row.user_id)) return ctx.update({ content: T.cant_owner, components: [] });
    await removeMember(ctx.channelId, uid);
    await ctx.update({ content: `✅ تمت إزالة ${mention.user(uid)} من التذكرة.`, components: [] });
  });

  bot.component("tk:prio", async (ctx) => {
    const row = await resolve(ctx.guildId, ctx.channelId);
    if (!row) return ctx.reply(T.no_ticket, true);
    await setPriority(ctx, row, ctx.values[0] ?? "normal");
  });

  // ─────────── أوامر السلاش ───────────
  bot.command({
    name: "تذكرة", description: "إدارة التذاكر",
    options: [
      o.sub("اعداد", "إعداد نوع تذكرة جديد (1 إلى 10)", [
        o.int("الرقم", "رقم التذكرة 1-10"), o.str("الاسم", "اسم التذكرة"),
        o.channel("الكاتيجوري", "كاتيجوري التذاكر", { types: [ChannelType.Category] }),
        o.role("رتبة_الدعم", "رتبة الدعم"), o.role("رتبة_المشرف", "رتبة مشرف التذاكر"), o.channel("روم_اللوق", "روم اللوق"),
        o.choice("قالب_الاسئلة", "قالب الأسئلة", Object.entries(PRESETS).map(([k, p]) => [p.ar, k] as [string, string]), { required: false }),
        o.str("رسالة_الترحيب", "رسالة الترحيب", { required: false }),
        o.channel("روم_التقييم", "روم التقييم", { required: false }),
        o.str("رابط_الصورة", "رابط صورة (اختياري)", { required: false }),
      ]),
      o.sub("لوحة", "إرسال بانل التذاكر في روم"),
      o.sub("اغلاق", "إغلاق التذكرة الحالية", [o.str("السبب", "سبب الإغلاق", { required: false })]),
      o.sub("استلام", "استلام التذكرة الحالية"),
      o.sub("اضافة", "إضافة عضو للتذكرة", [o.user("العضو", "العضو")]),
      o.sub("ازالة", "إزالة عضو من التذكرة", [o.user("العضو", "العضو")]),
      o.sub("تسمية", "تغيير اسم التذكرة", [o.str("الاسم_الجديد", "الاسم الجديد")]),
      o.sub("الاولوية", "تغيير أولوية التذكرة", [o.choice("المستوى", "مستوى الأولوية", [["عادية", "normal"], ["عالية", "high"], ["عاجلة", "urgent"]])]),
      o.sub("نسخة", "إرسال نسخة المحادثة"),
      o.sub("معلومات", "معلومات التذكرة الحالية / إحصائيات السيرفر"),
    ],
    run: async (ctx) => {
      const gid = ctx.guildId;
      if (!gid) return ctx.fail("هذا الأمر داخل السيرفر فقط.");
      switch (ctx.sub) {
        case "اعداد": {
          if (!ctx.isAdmin) return ctx.reply(T.no_perm, true);
          const n = ctx.int("الرقم")!;
          if (n < 1 || n > 10) return ctx.reply("❌ الرقم لازم يكون من 1 إلى 10.", true);
          const name = ctx.str("الاسم")!;
          const preset = ctx.str("قالب_الاسئلة") ?? null;
          const data = store.get();
          (data[gid] ??= {})[String(n)] = {
            name, category_id: ctx.id("الكاتيجوري"), support_role_id: ctx.id("رتبة_الدعم"), ticket_mod_role_id: ctx.id("رتبة_المشرف"),
            welcome_msg: ctx.str("رسالة_الترحيب") || null, log_channel_id: ctx.id("روم_اللوق"), rating_channel_id: ctx.id("روم_التقييم") ?? null,
            image_url: ctx.str("رابط_الصورة") ?? null, preset,
          };
          store.save(data);
          return ctx.reply({ embeds: [embed({
            title: `${E("success")} إدارة التذاكر`, description: `تم حفظ التذكرة رقم **${n}** باسم **${name}**.`, color: C.success,
            fields: [field("قالب الأسئلة", preset ? PRESETS[preset]?.ar ?? "—" : "—")],
          })] }, true);
        }
        case "لوحة": {
          if (!ctx.isAdmin) return ctx.reply(T.no_perm, true);
          if (!Object.keys(types(gid)).length) return ctx.reply(T.panel_none, true);
          const t = token();
          const s: Studio = { owner: ctx.user.id, gid, channelId: null, display: "buttons", nums: [], title: T.panel_default_t, desc: T.panel_default_d, image: null, edited: false };
          studios.set(t, s);
          return ctx.reply(studioView(t, s), true);
        }
        case "اغلاق":
          return doClose(ctx, ctx.str("السبب") ?? null);
        case "استلام":
          return doClaim(ctx);
        case "اضافة": {
          const c = await tctx(ctx, true);
          if (!c) return;
          const uid = ctx.id("العضو")!;
          await addMember(ctx.channelId, uid);
          return ctx.reply(`✅ تمت إضافة ${mention.user(uid)} إلى التذكرة.`);
        }
        case "ازالة": {
          const c = await tctx(ctx, true);
          if (!c) return;
          const uid = ctx.id("العضو")!;
          if (uid === String(c.row.user_id)) return ctx.reply(T.cant_owner, true);
          await removeMember(ctx.channelId, uid);
          return ctx.reply(`✅ تمت إزالة ${mention.user(uid)} من التذكرة.`);
        }
        case "تسمية": {
          const c = await tctx(ctx, true);
          if (c) await rename(ctx, ctx.str("الاسم_الجديد")!);
          return;
        }
        case "الاولوية": {
          const c = await tctx(ctx, true);
          if (c) await setPriority(ctx, c.row, ctx.str("المستوى")!);
          return;
        }
        case "نسخة": {
          const c = await tctx(ctx, true, true);
          if (!c) return;
          await ctx.defer(true);
          const { data } = await buildTranscript(ctx.channelId, gid);
          return ctx.followup({ content: "📄 نسخة المحادثة:", files: [{ name: `نسخة-تذكرة-${c.row.ticket_no || ctx.channelId}.html`, data, contentType: "text/html" }] }, true);
        }
        case "معلومات": {
          const row = await resolve(gid, ctx.channelId);
          const [total, opened, avg] = stats(gid);
          return ctx.reply({ embeds: [embed({
            title: `${E("ticket")} معلومات التذكرة`, color: C.ticket,
            fields: [
              row ? field("صاحب التذكرة", mention.user(String(row.user_id))) : null,
              row ? field("الأولوية", P_LABEL[row.priority ?? "normal"] ?? P_LABEL.normal) : null,
              field(`${E("chart")} #`, avg ? `\`${total}\` · \`${opened}\` مفتوحة · ⭐ \`${avg.toFixed(1)}\`` : `\`${total}\` · \`${opened}\` مفتوحة`, false),
            ],
          })] }, true);
        }
      }
    },
  });
}

/** للاختبارات. */
export const _test = { sql, store, slug, tdStr, questionsFor, getRow, insert, update, stats };
