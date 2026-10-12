/**
 * اللوقات الاحترافية — 15 نوع لوق.
 *
 * - الأوامر: /اللوقات تحديد · /اللوقات الكل · /اللوقات ايقاف · /اللوقات الحالة · /اللوقات تجربة
 * - أسماء المشرفين من حدث سجل التدقيق (GUILD_AUDIT_LOG_ENTRY_CREATE) بدل استدعاء السجل مع كل حدث.
 * - الذاكرة: كاش إعدادات صغير مدته 30 ثانية فقط.
 * - الإعدادات في logs_settings.db (نفس القاعدة اللي تعدّلها لوحة التحكم).
 */
import type { Bot } from "../discord/client.ts";
import type { CMessage, CUser } from "../discord/cache.ts";
import type { Ctx } from "../discord/ctx.ts";
import { AuditAction, CDN, P } from "../discord/constants.ts";
import { db, TTL } from "../core/db.ts";
import { E } from "../core/emojis.ts";
import { o } from "../core/opts.ts";
import { clip, embed, field, linkButton, row, ts, type Embed, type Field } from "../core/ui.ts";

const sql = db("logs_settings.db");
sql.exec("CREATE TABLE IF NOT EXISTS server_logs (guild_id INTEGER, log_type TEXT, channel_id INTEGER, PRIMARY KEY (guild_id, log_type))");

/** نوع اللوق → إيموجي */
const TYPES: Record<string, string> = {
  members_join_remove: "log_join", member_bans: "log_ban", member_kick: "log_kick", member_timeout: "log_timeout",
  member_roles: "log_role", nicknames: "log_msg_edit", messages: "log_msg_delete", reactions: "log_reaction",
  voice: "log_voice", channels_crud: "log_channel_create", channels_update: "log_channel_edit",
  roles_crud: "log_role_create", roles_update: "log_role", invites: "log_invite", server_updates: "log_server",
};
const TYPE_NAMES: Record<string, string> = {
  members_join_remove: "دخول وخروج الأعضاء", member_bans: "الباند وفك الباند", member_kick: "طرد الأعضاء", member_timeout: "التايم أوت",
  member_roles: "إعطاء وسحب الرتب", nicknames: "تغيير الأسماء المستعارة", messages: "حذف وتعديل الرسائل", reactions: "التفاعلات",
  voice: "القنوات الصوتية", channels_crud: "إنشاء وحذف الرومات", channels_update: "تعديل الرومات", roles_crud: "إنشاء وحذف الرتب",
  roles_update: "تعديل الرتب", invites: "الدعوات", server_updates: "إعدادات السيرفر",
};
const TYPE_KEYS = Object.keys(TYPES);

/** ألوان الإيمبدات حسب نوع الحدث (core/brand.py). */
const KIND: Record<string, number> = {
  brand: 0x2f6bff, success: 0x1fc46a, error: 0xf23d4f, warn: 0xffa51f, info: 0x22b8f0,
  join: 0x1fc46a, leave: 0xff7a1f, ban: 0xf23d4f, unban: 0x1fc46a, kick: 0xff7a1f,
  timeout: 0xffa51f, role: 0x8b5cf6, message: 0x2f6bff, edit: 0x22b8f0, delete: 0xf23d4f,
  channel: 0x14c8b0, server: 0x7b8bab, voice: 0x22b8f0, invite: 0x14c8b0, ticket: 0x2f6bff, gold: 0xf6c445,
};

const T = {
  need_perm: (ch: string) => `البوت يحتاج صلاحية **إرسال الرسائل + إرفاق الروابط** في ${ch}.`,
  audit_warn: "⚠️ البوت ما عنده صلاحية **عرض سجل التدقيق** — لن تظهر أسماء المشرفين في اللوقات.",
  status_t: "حالة اللوقات", off_label: "غير مفعّل", no_perm: "❌ ما عندك صلاحية لاستخدام هذا.",
  f_member: "العضو", f_by: "بواسطة", f_reason: "السبب", f_id: "الآيدي", f_created: "إنشاء الحساب", f_joined: "انضم",
  f_count: "عدد الأعضاء", f_roles: "الرتب", f_new_acc: "⚠️ حساب جديد (أقل من 7 أيام)", f_until: "ينتهي", f_role: "الرتبة",
  f_content: "المحتوى", f_before: "قبل", f_after: "بعد", f_author: "الكاتب", f_channel: "الروم", f_attach: "المرفقات",
  f_msg_sent: "أُرسلت", f_nocache: "*الرسالة قديمة وغير محفوظة في الذاكرة*", f_empty: "*بدون نص*", f_count_msgs: "عدد الرسائل",
  f_emoji: "التفاعل", f_jump: "اذهب للرسالة", f_name: "الاسم", f_changes: "التغييرات", f_added: "أُضيفت", f_removed: "أُزيلت",
  f_code: "الكود", f_uses: "الاستخدامات", f_age: "المدة", f_unlimited: "غير محدود", f_link: "رابط", f_hours: "ساعة",
  f_from: "من", f_to: "إلى", f_unknown: "غير معروف", f_none: "—",
};

/** أسماء الخصائص في سجل التدقيق (logs_attr). */
const ATTR: Record<string, string> = {
  name: "الاسم", nick: "الاسم المستعار", topic: "الوصف", color: "اللون", colour: "اللون", hoist: "عرض منفصل", mentionable: "قابلة للمنشن",
  slowmode_delay: "الوضع البطيء (ث)", nsfw: "+18", bitrate: "جودة الصوت", user_limit: "حد الأعضاء", verification_level: "مستوى التحقق",
  icon: "الصورة", banner: "البانر", afk_timeout: "مهلة AFK", afk_channel: "روم AFK", system_channel: "روم النظام", rules_channel: "روم القوانين",
  vanity_url_code: "الرابط المخصص", default_notifications: "الإشعارات الافتراضية", explicit_content_filter: "فلتر المحتوى",
  mfa_level: "التحقق بخطوتين", preferred_locale: "لغة السيرفر", owner: "المالك", permissions: "الصلاحيات", position: "الترتيب",
  type: "النوع", category: "الكاتيجوري",
};
/** نفس إعادة التسمية اللي يسويها discord.py لمفاتيح سجل التدقيق. */
const RENAME: Record<string, string> = {
  color: "colour", owner_id: "owner", inviter_id: "inviter", channel_id: "channel", afk_channel_id: "afk_channel",
  system_channel_id: "system_channel", widget_channel_id: "widget_channel", rules_channel_id: "rules_channel",
  public_updates_channel_id: "public_updates_channel", permission_overwrites: "overwrites", splash_hash: "splash", banner_hash: "banner",
  discovery_splash_hash: "discovery_splash", icon_hash: "icon", avatar_hash: "avatar", rate_limit_per_user: "slowmode_delay",
  default_thread_rate_limit_per_user: "default_thread_slowmode_delay", guild_id: "guild", tags: "emoji", emoji_name: "emoji",
  default_message_notifications: "default_notifications", communication_disabled_until: "timed_out_until", user_id: "user",
};
const AUDIT_FLAGS = new Set(["id", "type", "overwrites", "roles", "$add", "$remove", "permissions_new", "available_tags"]);
const CHANNEL_KEYS = new Set(["channel", "afk_channel", "system_channel", "widget_channel", "rules_channel", "public_updates_channel"]);
const ENUMS: Record<string, string[]> = {
  verification_level: ["none", "low", "medium", "high", "highest"],
  explicit_content_filter: ["disabled", "no_role", "all_members"],
  default_notifications: ["all_messages", "only_mentions"],
  mfa_level: ["disabled", "require_2fa"],
  video_quality_mode: ["", "auto", "full"],
};
/** أسماء الصلاحيات (نفس أسماء discord.py) حسب رقم البت. */
const PERM_NAMES = [
  "create_instant_invite", "kick_members", "ban_members", "administrator", "manage_channels", "manage_guild", "add_reactions",
  "view_audit_log", "priority_speaker", "stream", "read_messages", "send_messages", "send_tts_messages", "manage_messages",
  "embed_links", "attach_files", "read_message_history", "mention_everyone", "external_emojis", "view_guild_insights", "connect",
  "speak", "mute_members", "deafen_members", "move_members", "use_voice_activation", "change_nickname", "manage_nicknames",
  "manage_roles", "manage_webhooks", "manage_expressions", "use_application_commands", "request_to_speak", "manage_events",
  "manage_threads", "create_public_threads", "create_private_threads", "external_stickers", "send_messages_in_threads",
  "use_embedded_activities", "moderate_members", "view_creator_monetization_analytics", "use_soundboard", "create_expressions",
  "create_events", "use_external_sounds", "send_voice_messages", "", "", "send_polls", "use_external_apps",
];
const permList = (v: bigint): string[] => {
  const out: string[] = [];
  for (let i = 0; i < 64; i++) if ((v >> BigInt(i)) & 1n) out.push(PERM_NAMES[i] || `bit_${i}`);
  return out;
};

const AA = { ...AuditAction, EmojiCreate: 60, EmojiUpdate: 61, EmojiDelete: 62 } as const;

// ─────────── الإعدادات ───────────
const cache = new TTL<Record<string, string>>(30_000, 500);

function cfg(gid: string): Record<string, string> {
  let c = cache.get(gid);
  if (!c) {
    c = {};
    for (const r of sql.all<{ log_type: string; channel_id: string | number | null }>("SELECT log_type, channel_id FROM server_logs WHERE guild_id = ?", gid)) {
      if (r.channel_id) c[r.log_type] = String(r.channel_id);
    }
    cache.set(gid, c);
  }
  return c;
}

function save(gid: string, type: string, channelId: string | null) {
  if (channelId) {
    sql.run("INSERT INTO server_logs(guild_id, log_type, channel_id) VALUES(?,?,?) ON CONFLICT(guild_id, log_type) DO UPDATE SET channel_id=excluded.channel_id", gid, type, channelId);
  } else {
    sql.run("DELETE FROM server_logs WHERE guild_id=? AND log_type=?", gid, type);
  }
  cache.delete(gid);
}

// ─────────── أدوات ───────────
const snowflakeSec = (id: string) => Number((BigInt(id) >> 22n) + 1420070400000n) / 1000;
const isoSec = (iso: string) => Date.parse(iso) / 1000;
const uname = (u: { username: string }) => u.username;
const userRef = (u: CUser | null | undefined, id?: string | null) => (u ? `<@${u.id}> (\`${uname(u)}\`)` : id ? `<@${id}>` : "—");

interface Draft {
  kind: string; title: string; author?: { name: string; icon_url?: string }; description?: string;
  fields: Field[]; footer?: string; thumbnail?: string;
}

export default function setup(bot: Bot): void {
  const avatarOf = (u: CUser) => bot.avatar(u);

  /** عنوان الإيمبد + صورة العضو/المشرف في الأعلى. */
  const head = (kind: string, emojiKey: string, title: string, who?: CUser | null): Draft => ({
    kind, title: `${E(emojiKey)} ${title}`, fields: [],
    author: who ? { name: uname(who), icon_url: avatarOf(who) } : undefined,
  });
  const build = (d: Draft): Embed =>
    embed({ color: KIND[d.kind] ?? KIND.brand, title: d.title, description: d.description, author: d.author, fields: d.fields, footer: d.footer ? { text: d.footer } : undefined, thumbnail: d.thumbnail });

  async function send(gid: string, type: string, d: Draft, components?: any[]) {
    const cid = cfg(gid)[type];
    if (!cid || !bot.guild(gid)?.channels.has(cid)) return;
    await bot.trySend(cid, { embeds: [build(d)], components, allowed_mentions: { parse: [] } });
  }
  const enabled = (gid: string, type: string) => !!cfg(gid)[type];

  /** المستخدم من الكاش أو REST (null لو ما انوجد). */
  async function who(gid: string, id: string | null | undefined): Promise<CUser | null> {
    if (!id) return null;
    return bot.cache.member(gid, id) ?? bot.cache.users.get(id) ?? (await bot.userById(id));
  }
  const cachedUser = (gid: string, id: string): CUser | undefined => bot.cache.member(gid, id) ?? bot.cache.users.get(id);

  async function hasAudit(gid: string): Promise<boolean> {
    const me = await bot.me(gid);
    return !!me && (bot.basePerms(gid, me.roles, me.id) & P.ViewAuditLog) === P.ViewAuditLog;
  }

  // ─────────── تنسيق قيم سجل التدقيق ───────────
  function fmtVal(gid: string, key: string, v: any, targetId: string | null): string {
    if (v === null || v === undefined) return "—";
    if (typeof v === "boolean") return v ? "✅" : "❌";
    if (CHANNEL_KEYS.has(key)) return bot.guild(gid)?.channels.has(String(v)) ? `<#${v}>` : `\`${v}\``;
    if (key === "owner" || key === "inviter" || key === "user") {
      const u = cachedUser(gid, String(v));
      return `\`${u ? uname(u) : v}\``;
    }
    if (key === "colour") return `\`#${Number(v).toString(16).toUpperCase().padStart(6, "0")}\``;
    if (key === "permissions" || key === "allow" || key === "deny") return `\`${v}\``;
    if (key === "timed_out_until") return ts(isoSec(String(v)), "R");
    if (key in ENUMS && typeof v === "number") return `\`${ENUMS[key]![v] || v}\``;
    if (["icon", "banner", "splash", "discovery_splash", "avatar"].includes(key)) {
      const path = key === "icon" && targetId && targetId !== gid && bot.role(gid, targetId) ? `role-icons/${targetId}`
        : key === "icon" ? `icons/${gid}` : key === "banner" ? `banners/${gid}` : key === "splash" ? `splashes/${gid}`
        : key === "discovery_splash" ? `discovery-splashes/${gid}` : `avatars/${targetId}`;
      return `[${T.f_link}](${CDN}/${path}/${v}.png)`;
    }
    if (typeof v === "object") return clip(`\`${JSON.stringify(v)}\``, 200);
    if (typeof v !== "string") return `\`${v}\``;
    if (!v) return "—";
    return clip(v.length < 60 ? `\`${v}\`` : v, 200);
  }

  function diffLines(gid: string, entry: any): string[] {
    const lines: string[] = [];
    const seen = new Set<string>();
    for (const c of (entry.changes ?? []) as { key: string; old_value?: any; new_value?: any }[]) {
      const k = RENAME[c.key] ?? c.key;
      if (AUDIT_FLAGS.has(k) || seen.has(k)) continue;
      seen.add(k);
      const b = c.old_value;
      const a = c.new_value;
      if (k === "permissions" && a != null && b != null) {
        const av = BigInt(a);
        const bv = BigInt(b);
        const on = permList(av & ~bv);
        const off = permList(bv & ~av);
        if (on.length) lines.push(`${E("on")} **${T.f_added}:** ` + on.map((n) => `\`${n.replace(/_/g, " ")}\``).join(", "));
        if (off.length) lines.push(`${E("off")} **${T.f_removed}:** ` + off.map((n) => `\`${n.replace(/_/g, " ")}\``).join(", "));
        continue;
      }
      const label = ATTR[k] ?? k.replace(/_/g, " ");
      lines.push(`**${label}:** ${fmtVal(gid, k, b, entry.target_id ?? null)} ➜ ${fmtVal(gid, k, a, entry.target_id ?? null)}`);
    }
    return lines;
  }

  const change = (entry: any, key: string) => (entry.changes ?? []).find((c: any) => c.key === key);
  const modLine = (u: CUser | null, id: string | null | undefined) => (id ? `${E("admin")} **${T.f_by}:** ${userRef(u, id)}` : "");

  // ─────────── أحداث سجل التدقيق (الأساس) ───────────
  bot.on("GUILD_AUDIT_LOG_ENTRY_CREATE", async (entry: any) => {
    const gid: string = entry.guild_id;
    const c = cfg(gid);
    if (!Object.keys(c).length) return;
    const a: number = entry.action_type;
    const tid: string | null = entry.target_id ?? null;
    const reasonLine = () => `${E("ticket_note")} **${T.f_reason}:** ${entry.reason || T.f_none}`;

    // باند / فك باند / طرد
    if (a === AA.MemberBanAdd || a === AA.MemberBanRemove || a === AA.MemberKick) {
      const [kind, em, title, typ] = a === AA.MemberBanAdd ? ["ban", "log_ban", "تم حظر عضو", "member_bans"]
        : a === AA.MemberBanRemove ? ["unban", "log_unban", "تم فك الحظر", "member_bans"] : ["kick", "log_kick", "تم طرد عضو", "member_kick"];
      if (!c[typ!]) return;
      const [user, mod] = await Promise.all([who(gid, tid), who(gid, entry.user_id)]);
      const d = head(kind!, em!, title!, user);
      d.description = `${E("users")} **${T.f_member}:** ${userRef(user, tid)}\n${modLine(mod, entry.user_id)}\n${reasonLine()}`;
      d.footer = `${T.f_id}: ${tid}`;
      return send(gid, typ!, d);
    }

    // التايم أوت
    if (a === AA.MemberUpdate) {
      const ch = change(entry, "communication_disabled_until");
      if (!ch || !c.member_timeout) return;
      const until: string | null = ch.new_value ?? null;
      const on = until != null;
      const [user, mod] = await Promise.all([who(gid, tid), who(gid, entry.user_id)]);
      const d = head(on ? "timeout" : "success", on ? "log_timeout" : "log_untimeout", on ? "تايم أوت لعضو" : "إزالة التايم أوت", user);
      d.description = `${E("users")} **${T.f_member}:** ${userRef(user, tid)}\n${modLine(mod, entry.user_id)}`;
      if (on) {
        const s = isoSec(until);
        d.description += `\n${E("log_timeout")} **${T.f_until}:** ${ts(s, "f")} (${ts(s, "R")})`;
      }
      d.description += `\n${reasonLine()}`;
      return send(gid, "member_timeout", d);
    }

    // إعطاء وسحب الرتب
    if (a === AA.MemberRoleUpdate) {
      if (!c.member_roles) return;
      const added: any[] = change(entry, "$add")?.new_value ?? [];
      const removed: any[] = change(entry, "$remove")?.new_value ?? [];
      if (!added.length && !removed.length) return;
      const [user, mod] = await Promise.all([who(gid, tid), who(gid, entry.user_id)]);
      const groups: [any[], boolean][] = [[added, true], [removed, false]];
      for (const [roles, isAdd] of groups) {
        for (const r of roles) {
          const d = head(isAdd ? "role" : "delete", isAdd ? "log_role_add" : "log_role_remove", isAdd ? "إضافة رتبة لعضو" : "سحب رتبة من عضو", user);
          const rm = bot.role(gid, r.id) ? `<@&${r.id}>` : `\`${r.id}\``;
          d.description = `${E("users")} **${T.f_member}:** ${userRef(user, tid)}\n${E("log_role")} **${T.f_role}:** ${rm}\n${modLine(mod, entry.user_id)}`;
          await send(gid, "member_roles", d);
        }
      }
      return;
    }

    // الرومات
    if (a === AA.ChannelCreate || a === AA.ChannelDelete || a === AA.ChannelUpdate) {
      const [title, em, kind, typ] = a === AA.ChannelCreate ? ["إنشاء روم", "log_channel_create", "channel", "channels_crud"]
        : a === AA.ChannelDelete ? ["حذف روم", "log_channel_delete", "delete", "channels_crud"] : ["تعديل روم", "log_channel_edit", "edit", "channels_update"];
      if (!c[typ!]) return;
      const lines = a === AA.ChannelUpdate ? diffLines(gid, entry) : [];
      if (a === AA.ChannelUpdate && !lines.length) return;
      const mod = await who(gid, entry.user_id);
      const d = head(kind!, em!, title!, mod);
      const chan = tid ? bot.guild(gid)?.channels.get(tid) : undefined;
      const name = chan?.name || change(entry, "name")?.old_value || change(entry, "name")?.new_value || String(tid);
      const ref = chan ? `<#${tid}>` : `\`#${name}\``;
      d.description = `${E("folder")} **${T.f_channel}:** ${ref}\n${modLine(mod, entry.user_id)}`;
      if (lines.length) d.fields.push(field(T.f_changes, clip(lines.join("\n"), 1000), false));
      d.footer = `${T.f_id}: ${tid}`;
      return send(gid, typ!, d);
    }

    // الرتب
    if (a === AA.RoleCreate || a === AA.RoleDelete || a === AA.RoleUpdate) {
      const [title, em, kind, typ] = a === AA.RoleCreate ? ["إنشاء رتبة", "log_role_create", "role", "roles_crud"]
        : a === AA.RoleDelete ? ["حذف رتبة", "log_role_delete", "delete", "roles_crud"] : ["تعديل رتبة", "log_role", "role", "roles_update"];
      if (!c[typ!]) return;
      const lines = a === AA.RoleUpdate ? diffLines(gid, entry) : [];
      if (a === AA.RoleUpdate && !lines.length) return;
      const mod = await who(gid, entry.user_id);
      const d = head(kind!, em!, title!, mod);
      const role = bot.role(gid, tid);
      const name = change(entry, "name")?.old_value || change(entry, "name")?.new_value || role?.name || String(tid);
      const ref = role ? `<@&${tid}>` : `\`${name}\``;
      d.description = `${E("log_role")} **${T.f_role}:** ${ref}\n${modLine(mod, entry.user_id)}`;
      if (lines.length) d.fields.push(field(T.f_changes, clip(lines.join("\n"), 1000), false));
      d.footer = `${T.f_id}: ${tid}`;
      return send(gid, typ!, d);
    }

    if (!c.server_updates) return;

    // إعدادات السيرفر
    if (a === AA.GuildUpdate) {
      const lines = diffLines(gid, entry);
      if (!lines.length) return;
      const mod = await who(gid, entry.user_id);
      const d = head("server", "log_server", "تعديل إعدادات السيرفر", mod);
      d.description = modLine(mod, entry.user_id);
      d.fields.push(field(T.f_changes, clip(lines.join("\n"), 1000), false));
      d.thumbnail = bot.guildIcon(bot.guild(gid));
      return send(gid, "server_updates", d);
    }

    // الإيموجي
    if (a === AA.EmojiCreate || a === AA.EmojiDelete || a === AA.EmojiUpdate) {
      const title = a === AA.EmojiCreate ? "إيموجي جديد" : a === AA.EmojiDelete ? "حذف إيموجي" : "تعديل إيموجي";
      const mod = await who(gid, entry.user_id);
      const d = head("server", "log_server", title, mod);
      const name = change(entry, "name")?.new_value || change(entry, "name")?.old_value || String(tid);
      d.description = `${E("log_reaction")} **${T.f_name}:** \`${name}\`\n${modLine(mod, entry.user_id)}`;
      return send(gid, "server_updates", d);
    }

    // إضافة بوت
    if (a === AA.BotAdd) {
      const [target, mod] = await Promise.all([who(gid, tid), who(gid, entry.user_id)]);
      const d = head("warn", "log_bot", "إضافة بوت", mod);
      d.description = `${E("log_bot")} **${T.f_name}:** ${userRef(target, tid)}\n${modLine(mod, entry.user_id)}`;
      return send(gid, "server_updates", d);
    }

    // الويب هوك
    if (a === AA.WebhookCreate || a === AA.WebhookDelete || a === AA.WebhookUpdate) {
      const mod = await who(gid, entry.user_id);
      const d = head("server", "log_server", "تغيير في الويب هوك", mod);
      const what = a === AA.WebhookCreate ? "إنشاء ويب هوك" : a === AA.WebhookDelete ? "حذف ويب هوك" : "تعديل ويب هوك";
      d.description = `**${what}**\n${modLine(mod, entry.user_id)}`;
      return send(gid, "server_updates", d);
    }
  });

  // ─────────── دخول وخروج (بدون سجل تدقيق) ───────────
  bot.on("GUILD_MEMBER_ADD", async (d: any, { member, guild }: any) => {
    const gid: string = d.guild_id;
    if (!enabled(gid, "members_join_remove") || !member) return;
    const created = snowflakeSec(member.id);
    const ageDays = Math.floor((Date.now() / 1000 - created) / 86400);
    const e = head("join", "log_join", "عضو جديد", member);
    e.description = `${E("users")} **${T.f_member}:** <@${member.id}> (\`${uname(member)}\`)\n`
      + `${E("calendar")} **${T.f_created}:** ${ts(created, "D")} (${ts(created, "R")})\n`
      + `${E("users")} **${T.f_count}:** \`${guild?.memberCount ?? "?"}\``;
    if (ageDays < 7) e.fields.push(field("​", T.f_new_acc, false));
    e.thumbnail = bot.avatar(member);
    e.footer = `${T.f_id}: ${member.id}`;
    await send(gid, "members_join_remove", e);
  });

  bot.on("GUILD_MEMBER_REMOVE", async (d: any, { before, guild }: any) => {
    const gid: string = d.guild_id;
    if (!enabled(gid, "members_join_remove") || !d.user) return;
    const u: CUser = before ?? { id: d.user.id, username: d.user.username, globalName: d.user.global_name ?? null, avatar: d.user.avatar ?? null, bot: !!d.user.bot };
    const e = head("leave", "log_leave", "غادر عضو", u);
    e.description = `${E("users")} **${T.f_member}:** <@${u.id}> (\`${uname(u)}\`)\n${E("users")} **${T.f_count}:** \`${guild?.memberCount ?? "?"}\``;
    if (before?.joinedAt) e.description += `\n**${T.f_joined}:** ${ts(isoSec(before.joinedAt), "R")}`;
    if (before?.roles?.length) {
      const g = bot.guild(gid);
      const roles = (before.roles as string[])
        .map((r) => g?.roles.get(r)).filter((r) => r && r.id !== gid)
        .sort((x, y) => x!.position - y!.position).slice(0, 15).map((r) => `<@&${r!.id}>`);
      if (roles.length) e.fields.push(field(T.f_roles, roles.join(" "), false));
    }
    e.thumbnail = bot.avatar(before ?? u);
    e.footer = `${T.f_id}: ${u.id}`;
    await send(gid, "members_join_remove", e);
  });

  // بدائل عند غياب صلاحية سجل التدقيق
  const banFallback = (unban: boolean) => async (d: any) => {
    const gid: string = d.guild_id;
    if (!enabled(gid, "member_bans") || !d.user || (await hasAudit(gid))) return;
    const u: CUser = { id: d.user.id, username: d.user.username, globalName: d.user.global_name ?? null, avatar: d.user.avatar ?? null, bot: !!d.user.bot };
    const e = unban ? head("unban", "log_unban", "تم فك الحظر", u) : head("ban", "log_ban", "تم حظر عضو", u);
    e.description = `${E("users")} **${T.f_member}:** ${userRef(u)}`;
    await send(gid, "member_bans", e);
  };
  bot.on("GUILD_BAN_ADD", banFallback(false));
  bot.on("GUILD_BAN_REMOVE", banFallback(true));

  bot.on("GUILD_MEMBER_UPDATE", async (d: any, { before, member }: any) => {
    if (!before || !member || (before.nick ?? null) === (member.nick ?? null)) return;
    const gid: string = d.guild_id;
    if (!enabled(gid, "nicknames")) return;
    const e = head("edit", "log_msg_edit", "تغيير اسم مستعار", member);
    e.description = `${E("users")} **${T.f_member}:** <@${member.id}>\n**${T.f_before}:** ${clip(before.nick || before.username, 100)}\n**${T.f_after}:** ${clip(member.nick || member.username, 100)}`;
    e.footer = `${T.f_id}: ${member.id}`;
    await send(gid, "nicknames", e);
  });

  // ─────────── الرسائل ───────────
  const jump = (gid: string, ch: string, id: string) => [row(linkButton(`https://discord.com/channels/${gid}/${ch}/${id}`, T.f_jump, E("message")))];
  const chanRef = (gid: string, ch: string, tick = true) => (bot.guild(gid)?.channels.has(ch) ? `<#${ch}>` : tick ? `\`${ch}\`` : ch);
  const msgAuthor = (m: CMessage): CUser => ({ id: m.authorId, username: m.authorName, globalName: null, avatar: m.authorAvatar, bot: m.bot });

  bot.on("MESSAGE_DELETE", async (d: any, { before }: { before?: CMessage }) => {
    const gid: string | undefined = d.guild_id;
    if (!gid || !bot.guild(gid) || !enabled(gid, "messages")) return;
    const m = before;
    if (m?.bot) return;
    const e = head("delete", "log_msg_delete", "حذف رسالة", m ? msgAuthor(m) : null);
    e.description = `${E("users")} **${T.f_author}:** ${m ? `<@${m.authorId}>` : T.f_unknown}\n${E("message")} **${T.f_channel}:** ${chanRef(gid, d.channel_id)}`;
    if (m) {
      e.fields.push(field(T.f_content, clip(m.content, 1000) || T.f_empty, false));
      if (m.attachments.length) {
        const list = m.attachments.map((url) => `[${decodeURIComponent(url.split("?")[0]!.split("/").pop() || "file")}](${url})`).join("\n");
        e.fields.push(field(T.f_attach, clip(list, 1000), false));
      }
      e.fields.push(field(T.f_msg_sent, ts(snowflakeSec(m.id), "R"), true));
    } else {
      e.fields.push(field(T.f_content, T.f_nocache, false));
    }
    e.footer = `${T.f_id}: ${d.id}`;
    await send(gid, "messages", e);
  });

  bot.on("MESSAGE_DELETE_BULK", async (d: any) => {
    const gid: string | undefined = d.guild_id;
    if (!gid || !bot.guild(gid) || !enabled(gid, "messages")) return;
    const e = head("delete", "log_msg_delete", "حذف جماعي للرسائل");
    e.description = `${E("message")} **${T.f_channel}:** ${chanRef(gid, d.channel_id, false)}\n${E("log_msg_delete")} **${T.f_count_msgs}:** \`${(d.ids ?? []).length}\``;
    await send(gid, "messages", e);
  });

  bot.on("MESSAGE_UPDATE", async (d: any, { before }: { before?: CMessage }) => {
    const gid: string | undefined = d.guild_id;
    if (!gid || !before || typeof d.content !== "string") return;
    if (!bot.guild(gid) || before.bot || before.content === d.content.slice(0, 1500) || !enabled(gid, "messages")) return;
    const e = head("edit", "log_msg_edit", "تعديل رسالة", msgAuthor(before));
    e.description = `${E("users")} **${T.f_author}:** <@${before.authorId}>\n${E("message")} **${T.f_channel}:** <#${d.channel_id}>`;
    e.fields.push(field(T.f_before, clip(before.content, 1000) || T.f_empty, false));
    e.fields.push(field(T.f_after, clip(d.content, 1000) || T.f_empty, false));
    e.footer = `${T.f_id}: ${d.id}`;
    await send(gid, "messages", e, jump(gid, d.channel_id, d.id));
  });

  bot.on("MESSAGE_REACTION_ADD", async (d: any) => {
    const gid: string | undefined = d.guild_id;
    if (!gid || d.member?.user?.bot) return;
    if (!bot.guild(gid) || !enabled(gid, "reactions")) return;
    const mu = d.member?.user;
    const actor: CUser | null = mu ? { id: mu.id, username: mu.username, globalName: mu.global_name ?? null, avatar: mu.avatar ?? null, bot: !!mu.bot } : null;
    const em = d.emoji?.id ? `<${d.emoji.animated ? "a" : ""}:${d.emoji.name ?? "_"}:${d.emoji.id}>` : (d.emoji?.name ?? "?");
    const e = head("message", "log_reaction", "تفاعل جديد", actor);
    e.description = `${E("users")} **${T.f_member}:** ${actor ? `<@${actor.id}>` : d.user_id}\n`
      + `${E("log_reaction")} **${T.f_emoji}:** ${em}\n${E("message")} **${T.f_channel}:** ${chanRef(gid, d.channel_id, false)}`;
    await send(gid, "reactions", e, jump(gid, d.channel_id, d.message_id));
  });

  // ─────────── الصوت والدعوات ───────────
  bot.on("VOICE_STATE_UPDATE", async (d: any, x: { before: string | null; after: string | null; beforeFlags?: { mute: boolean; deaf: boolean }; member?: CUser }) => {
    const gid: string = d.guild_id;
    const m: CUser | undefined = x.member;
    if (m?.bot || d.member?.user?.bot || !enabled(gid, "voice")) return;
    const uid: string = d.user_id;
    if (x.before !== x.after) {
      const title = !x.before ? "دخول روم صوتي" : !x.after ? "خروج من روم صوتي" : "انتقال بين الرومات الصوتية";
      const e = head("voice", "log_voice", title, m ?? null);
      const lines = [`${E("users")} **${T.f_member}:** <@${uid}>`];
      if (x.before) lines.push(`**${T.f_from}:** <#${x.before}>`);
      if (x.after) lines.push(`**${T.f_to}:** <#${x.after}>`);
      e.description = lines.join("\n");
      return send(gid, "voice", e);
    }
    if (!x.beforeFlags || !x.after) return;
    const pairs: ["mute" | "deaf", string][] = [["mute", "كتم/فك كتم من الإدارة"], ["deaf", "صمم/فك صمم من الإدارة"]];
    for (const [attr, title] of pairs) {
      const now = !!d[attr];
      if (x.beforeFlags[attr] !== now) {
        const e = head("voice", "log_voice", title, m ?? null);
        e.description = `${E("users")} **${T.f_member}:** <@${uid}>\n${now ? "✅" : "❌"}`;
        await send(gid, "voice", e);
      }
    }
  });

  bot.on("INVITE_CREATE", async (d: any) => {
    const gid: string | undefined = d.guild_id;
    if (!gid || !bot.guild(gid) || !enabled(gid, "invites")) return;
    const inv = d.inviter;
    const actor: CUser | null = inv ? { id: inv.id, username: inv.username, globalName: inv.global_name ?? null, avatar: inv.avatar ?? null, bot: !!inv.bot } : null;
    const e = head("invite", "log_invite", "إنشاء دعوة", actor);
    const age = d.max_age ? `${Math.floor(d.max_age / 3600)} ${T.f_hours}` : T.f_unlimited;
    e.description = `${E("log_invite")} **${T.f_code}:** \`${d.code}\`\n${E("message")} **${T.f_channel}:** ${d.channel_id ? `<#${d.channel_id}>` : "—"}\n`
      + `**${T.f_uses}:** \`${d.max_uses || T.f_unlimited}\`\n**${T.f_age}:** \`${age}\``;
    await send(gid, "invites", e);
  });

  bot.on("INVITE_DELETE", async (d: any) => {
    const gid: string | undefined = d.guild_id;
    if (!gid || !bot.guild(gid) || !enabled(gid, "invites")) return;
    const e = head("delete", "log_invite", "حذف دعوة");
    e.description = `${E("log_invite")} **${T.f_code}:** \`${d.code}\``;
    await send(gid, "invites", e);
  });

  // ─────────── أوامر السلاش /اللوقات ───────────
  const typeChoices = TYPE_KEYS.map((k) => [TYPE_NAMES[k]!, k] as [string, string]);

  async function channelOk(gid: string, chId: string): Promise<boolean> {
    const me = await bot.me(gid);
    if (!me) return false;
    const need = P.SendMessages | P.EmbedLinks | P.ViewChannel;
    return (bot.channelPerms(gid, chId, me.roles, me.id) & need) === need;
  }
  const withAuditWarn = async (gid: string, e: Embed) => {
    if (!(await hasAudit(gid))) e.fields = [...(e.fields ?? []), { name: "​", value: T.audit_warn, inline: false }];
    return e;
  };
  const needManage = async (ctx: Ctx) => {
    if (ctx.can(P.ManageGuild)) return true;
    await ctx.reply(T.no_perm, true);
    return false;
  };

  bot.command({
    name: "اللوقات", description: "إدارة لوقات السيرفر", perms: P.ManageGuild,
    options: [
      o.sub("تحديد", "تحديد روم لنوع معيّن من اللوقات", [o.choice("النوع", "نوع اللوق", typeChoices), o.channel("الروم", "روم اللوق")]),
      o.sub("الكل", "تحديد روم واحد لكل أنواع اللوقات", [o.channel("الروم", "روم اللوق")]),
      o.sub("ايقاف", "إيقاف نوع من اللوقات أو كلها", [o.choice("النوع", "نوع اللوق (اتركه فاضي لإيقاف الكل)", typeChoices, { required: false })]),
      o.sub("الحالة", "عرض حالة كل اللوقات والرومات المرتبطة"),
      o.sub("تجربة", "إرسال رسالة تجريبية لكل روم لوق"),
    ],
    run: async (ctx) => {
      const gid = ctx.guildId;
      if (!gid) return;

      if (ctx.sub === "تحديد" || ctx.sub === "الكل") {
        if (!(await needManage(ctx))) return;
        const chId = ctx.id("الروم")!;
        if (!(await channelOk(gid, chId))) return ctx.reply(T.need_perm(`<#${chId}>`), true);
        let e: Embed;
        if (ctx.sub === "تحديد") {
          const type = ctx.str("النوع")!;
          if (!(type in TYPES)) return ctx.fail("نوع غير معروف.");
          save(gid, type, chId);
          const name = TYPE_NAMES[type]!;
          e = embed({ color: KIND.success, title: `${E("success")} ${name}`, description: `تم ربط **${name}** بالروم <#${chId}>.` });
        } else {
          sql.tx(() => { for (const k of TYPE_KEYS) save(gid, k, chId); });
          e = embed({ color: KIND.success, title: `${E("success")} ${T.status_t}`, description: `تم ربط **كل اللوقات (${TYPE_KEYS.length})** بالروم <#${chId}>.` });
        }
        return ctx.reply({ embeds: [await withAuditWarn(gid, e)] }, true);
      }

      if (ctx.sub === "ايقاف") {
        if (!(await needManage(ctx))) return;
        const type = ctx.str("النوع");
        if (type && !(type in TYPES)) return ctx.fail("نوع غير معروف.");
        sql.tx(() => { for (const k of type ? [type] : TYPE_KEYS) save(gid, k, null); });
        const msg = type ? `تم إيقاف **${TYPE_NAMES[type]}**.` : "تم إيقاف كل اللوقات.";
        return ctx.reply({ embeds: [embed({ color: KIND.warn, title: `${E("off")} ${T.status_t}`, description: msg })] }, true);
      }

      if (ctx.sub === "الحالة") {
        const c = cfg(gid);
        const g = bot.guild(gid);
        let on = 0;
        const lines = TYPE_KEYS.map((k) => {
          const ch = c[k] && g?.channels.has(c[k]!) ? c[k] : null;
          if (ch) on++;
          return `${E(TYPES[k]!)} **${TYPE_NAMES[k]}** ➜ ${ch ? `<#${ch}>` : `\`${T.off_label}\``}`;
        });
        const e = embed({ color: KIND.brand, title: `${E("shield")} ${T.status_t}`, description: lines.join("\n"), footer: { text: `${on} من ${TYPE_KEYS.length} مفعّلة` } });
        return ctx.reply({ embeds: [await withAuditWarn(gid, e)] }, true);
      }

      if (ctx.sub === "تجربة") {
        if (!(await needManage(ctx))) return;
        const c = cfg(gid);
        if (!Object.keys(c).length) return ctx.reply("ما فيه لوقات مفعّلة. استخدم `/اللوقات تحديد` أولاً.", true);
        await ctx.defer(true);
        let n = 0;
        for (const k of TYPE_KEYS) {
          if (!c[k]) continue;
          const d: Draft = { kind: "brand", title: `${E(TYPES[k]!)} اختبار اللوقات`, description: `هذه رسالة تجريبية للوق **${TYPE_NAMES[k]}** ✅`, fields: [] };
          await send(gid, k, d);
          n++;
        }
        return ctx.followup(`تم إرسال ${n} رسالة تجريبية.`, true);
      }
    },
  });
}
