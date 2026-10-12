/**
 * نظام الحماية — security_settings.db
 * دخول البوتات، إعطاء رتبة أدمن، التبنيد/الطرد، حذف/إنشاء الرومات والرتب، والروابط.
 * المنفّذ يُعرف من أحداث سجل التدقيق (GUILD_AUDIT_LOG_ENTRY_CREATE) بدل جلب السجل.
 */
import type { Bot } from "../discord/client.ts";
import type { CMember } from "../discord/cache.ts";
import { AuditAction, ButtonStyle, P } from "../discord/constants.ts";
import { db, TTL } from "../core/db.ts";
import { log } from "../core/log.ts";
import { o } from "../core/opts.ts";
import { button, embed, row, select } from "../core/ui.ts";

const sql = db("security_settings.db");
sql.exec(`
CREATE TABLE IF NOT EXISTS server_security (
    guild_id INTEGER,
    feature TEXT,
    status INTEGER DEFAULT 0,
    PRIMARY KEY (guild_id, feature)
);
CREATE TABLE IF NOT EXISTS security_punishments (
    guild_id INTEGER,
    feature TEXT,
    punishment TEXT DEFAULT 'timeout',
    PRIMARY KEY (guild_id, feature)
);`);

const FEATURE_LABELS: Record<string, string> = {
  bot_add: "دخول البوتات", admin_role: "إعطاء رتبة أدمن", mass_ban: "التبنيد السريع", mass_kick: "الطرد السريع",
  channel_delete: "حذف الرومات", role_delete: "حذف الرتب", role_create: "إنشاء الرتب", channel_create: "إنشاء الرومات", links: "الروابط",
};
export const PUNISHMENT_LABELS: Record<string, string> = { ban: "باند", kick: "طرد", timeout: "تايم أوت", strip_roles: "سحب كافة الرتب" };
export const PUNISHMENT_CHOICES: [string, string][] = [["🔨 باند", "ban"], ["👢 طرد", "kick"], ["⏳ تايم أوت", "timeout"], ["🏷️ سحب كافة الرتب", "strip_roles"]];

const PANEL_OPTIONS = [
  { label: "🤖 حماية دخول البوتات", value: "bot_add", description: "يطرد أي بوت يضاف ويعاقب اللي أضافه" },
  { label: "👑 حماية إعطاء رتبة أدمـن", value: "admin_role", description: "منع إعطاء رتب خطيرة/أدمن" },
  { label: "🔨 حماية التبنيد السريع", value: "mass_ban", description: "منع التخريب بالباند المتسارع" },
  { label: "👢 حماية الطرد السريع", value: "mass_kick", description: "منع الطرد العشوائي السريع" },
  { label: "📁 حماية حذف الرومات", value: "channel_delete", description: "يعاقب من يحذف روم" },
  { label: "🗑️ حماية حذف الرتب", value: "role_delete", description: "يعاقب من يحذف رتبة" },
  { label: "🆕 حماية إنشاء الرتب", value: "role_create", description: "منع سبام إنشاء الرتب" },
  { label: "📂 حماية إنشاء الرومات", value: "channel_create", description: "منع سبام إنشاء الرومات" },
  { label: "🔗 حماية الروابط", value: "links", description: "يحذف أي رسالة فيها رابط أو دعوة ويقمع صاحبها" },
];
const FEATURE_CHOICES: [string, string][] = [
  ["🤖 دخول البوتات", "bot_add"], ["👑 إعطاء رتبة أدمـن", "admin_role"], ["🔨 التبنيد السريع", "mass_ban"], ["👢 الطرد السريع", "mass_kick"],
  ["📁 حذف الرومات", "channel_delete"], ["🗑️ حذف الرتب", "role_delete"], ["🆕 إنشاء الرتب", "role_create"], ["📂 إنشاء الرومات", "channel_create"], ["🔗 الروابط", "links"],
];

/** حالة الأنظمة لكل سيرفر (كاش 30 ثانية عشان تعديلات لوحة التحكم توصل بسرعة). */
const statusCache = new TTL<Record<string, number>>(30_000, 1000);

function statuses(gid: string): Record<string, number> {
  let s = statusCache.get(gid);
  if (!s) {
    s = {};
    for (const r of sql.all<{ feature: string; status: number }>("SELECT feature, status FROM server_security WHERE guild_id = ?", gid)) s[r.feature] = Number(r.status);
    statusCache.set(gid, s);
  }
  return s;
}
const enabled = (gid: string, feature: string) => statuses(gid)[feature] === 1;

function setStatus(gid: string, feature: string, status: number) {
  sql.run(`INSERT INTO server_security (guild_id, feature, status) VALUES (?, ?, ?)
    ON CONFLICT(guild_id, feature) DO UPDATE SET status = excluded.status`, gid, feature, status);
  statusCache.delete(gid);
}

const punishmentOf = (gid: string, feature: string) =>
  sql.value<string>("SELECT punishment FROM security_punishments WHERE guild_id = ? AND feature = ?", gid, feature) ?? "timeout";

/**
 * ينفذ العقوبة على عضو (مشتركة مع نظام الكلمات المحظورة).
 * يتجاهل البوتات ومالك السيرفر ومن رتبته مساوية أو أعلى من رتبة البوت. يرجع true لو تنفذت.
 */
export async function punish(bot: Bot, gid: string, member: CMember | null | undefined, punishment: string, reason: string): Promise<boolean> {
  const g = bot.guild(gid);
  if (!g || !member || member.bot || member.id === g.ownerId) return false;
  const me = await bot.me(gid);
  if (!me || bot.topPosition(gid, me.roles) <= bot.topPosition(gid, member.roles)) {
    log.debug("security", `cannot punish ${member.id} in ${gid}: role hierarchy`);
    return false;
  }
  try {
    if (punishment === "ban") await bot.ban(gid, member.id, reason, 86400);
    else if (punishment === "kick") await bot.kick(gid, member.id, reason);
    else if (punishment === "timeout") await bot.timeout(gid, member.id, 15 * 60, reason);
    else if (punishment === "strip_roles") {
      const keep = member.roles.filter((r) => bot.role(gid, r)?.managed);
      if (keep.length !== member.roles.length) {
        await bot.editMember(gid, member.id, { roles: keep }, reason);
        member.roles = keep;
      }
    } else return false;
    return true;
  } catch (e) {
    log.warn("security", `punishment ${punishment} failed in ${gid}: ${(e as Error).message}`);
    return false;
  }
}

export default function setup(bot: Bot): void {
  const run = async (gid: string, uid: string | null | undefined, feature: string, reason: string) => {
    if (!uid) return;
    const m = await bot.member(gid, uid);
    if (m) await punish(bot, gid, m, punishmentOf(gid, feature), `نظام الحماية: ${reason}`);
  };

  // ─────────── اللوحة والأوامر ───────────
  bot.command({
    name: "لوحة-الحماية", description: "لوحة تحكم إعدادات الحماية في السيرفر", perms: P.Administrator,
    run: async (ctx) => {
      if (!ctx.isAdmin) return ctx.fail("هذا الأمر للأدمن فقط.");
      await ctx.reply({
        embeds: [embed({
          title: "🛡 لوحة إعدادات ونظام الحماية", now: false, color: 0x2b2d31,
          description: "من خلال القائمة أدناه يمكنك تفعيل أو تعطيل أنظمة الحماية وتحديد العقوبات.",
        })],
        components: [
          row(select("security:toggle", PANEL_OPTIONS, { placeholder: "اختر نظام الحماية لتغيير حالته (تفعيل / تعطيل)..." })),
          row(button("security:punish", "⚙️ تحديد العقوبات", ButtonStyle.Secondary)),
        ],
      }, true);
    },
  });

  bot.component("security:toggle", async (ctx) => {
    if (!ctx.guildId || !ctx.isAdmin) return ctx.fail("هذي اللوحة للأدمن فقط.");
    const feature = ctx.values[0]!;
    const next = enabled(ctx.guildId, feature) ? 0 : 1;
    setStatus(ctx.guildId, feature, next);
    await ctx.reply(`✅ تم تحديث حماية (\`${FEATURE_LABELS[feature] ?? feature}\`) وأصبحت الآن: **${next ? "🟢 مفعل" : "🔴 معطل"}**`, true);
  });

  bot.component("security:punish", (ctx) => ctx.reply("اختر النظام لتحديد عقوبته عبر الأمر: `/عقوبة-الحماية`", true));

  bot.command({
    name: "عقوبة-الحماية", description: "تحديد العقوبة لأي نظام حماية", perms: P.Administrator,
    options: [o.choice("النظام", "اختر نظام الحماية", FEATURE_CHOICES), o.choice("العقوبة", "اختر العقوبة", PUNISHMENT_CHOICES)],
    run: async (ctx) => {
      if (!ctx.isAdmin) return ctx.fail("هذا الأمر للأدمن فقط.");
      const feature = ctx.str("النظام")!;
      const p = ctx.str("العقوبة")!;
      sql.run(`INSERT INTO security_punishments (guild_id, feature, punishment) VALUES (?, ?, ?)
        ON CONFLICT(guild_id, feature) DO UPDATE SET punishment = excluded.punishment`, ctx.guildId!, feature, p);
      await ctx.reply(`✅ تم تحديث عقوبة النظام (\`${FEATURE_LABELS[feature] ?? feature}\`) لتصبح: **${PUNISHMENT_LABELS[p] ?? p}**`, true);
    },
  });

  // ─────────── الأحداث ───────────
  bot.on("GUILD_AUDIT_LOG_ENTRY_CREATE", async (d) => {
    const gid: string | undefined = d.guild_id;
    if (!gid || !d.user_id || d.user_id === bot.user.id) return;
    const g = bot.guild(gid);
    switch (d.action_type) {
      case AuditAction.BotAdd: {
        if (!enabled(gid, "bot_add")) return;
        // لو اللي أضاف البوت هو الأونر ما نسوي شي، وإلا نعاقب اللي أضافه فقط (البوت ما يُطرد)
        if (d.user_id === g?.ownerId) return;
        return run(gid, d.user_id, "bot_add", "أضاف بوت غير مصرح به");
      }
      case AuditAction.MemberRoleUpdate: {
        if (!enabled(gid, "admin_role") || !d.target_id) return;
        const changes: any[] = d.changes ?? [];
        const ids = (key: string): string[] => (changes.find((c) => c.key === key)?.new_value ?? []).map((r: any) => String(r.id));
        const added = ids("$add");
        const isAdminRole = (id: string) => ((bot.role(gid, id)?.permissions ?? 0n) & P.Administrator) === P.Administrator;
        if (!added.some(isAdminRole)) return;
        const target = await bot.member(gid, d.target_id);
        if (!target) return;
        // كان أدمن قبل؟ (رتبه الحالية بدون اللي انضافت + اللي انشالت)
        const removed = ids("$remove");
        const before = [...target.roles.filter((r) => !added.includes(r)), ...removed];
        if ((bot.basePerms(gid, before, target.id) & P.Administrator) === P.Administrator) return;
        return run(gid, d.user_id, "admin_role", "أعطى صلاحيات أدمن لشخص آخر");
      }
      case AuditAction.MemberBanAdd:
        if (enabled(gid, "mass_ban")) return run(gid, d.user_id, "mass_ban", "قام بتبنيد أعضاء");
        return;
      case AuditAction.MemberKick:
        if (enabled(gid, "mass_kick")) return run(gid, d.user_id, "mass_kick", "قام بطرد أعضاء");
        return;
      case AuditAction.ChannelCreate:
        if (enabled(gid, "channel_create")) return run(gid, d.user_id, "channel_create", "قام بإنشاء روم");
        return;
      case AuditAction.RoleCreate:
        if (enabled(gid, "role_create")) return run(gid, d.user_id, "role_create", "قام بإنشاء رتبة");
        return;
      case AuditAction.ChannelDelete:
        if (enabled(gid, "channel_delete")) return run(gid, d.user_id, "channel_delete", "حذف روم");
        return;
      case AuditAction.RoleDelete:
        if (enabled(gid, "role_delete")) return run(gid, d.user_id, "role_delete", "حذف رتبة");
        return;
    }
  });

  bot.on("MESSAGE_CREATE", async (d) => {
    if (!d.guild_id || d.author?.bot || d.webhook_id) return;
    const c: string = d.content ?? "";
    if (!c.includes("http://") && !c.includes("https://") && !c.includes("discord.gg/")) return;
    if (!enabled(d.guild_id, "links")) return;
    try {
      await bot.rest.delete(`/channels/${d.channel_id}/messages/${d.id}`, { reason: "نظام الحماية: روابط" });
    } catch {
      return; // ما قدر يحذف الرسالة → ما يعاقب (مثل النسخة القديمة)
    }
    const m = await bot.member(d.guild_id, d.author.id); // من الكاش (الحدث يعبّيه)
    await punish(bot, d.guild_id, m, punishmentOf(d.guild_id, "links"), "نظام الحماية: نشر روابط أو دعوات");
  });
}
