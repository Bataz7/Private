/**
 * أدوات المالك — إشعارات دخول/خروج البوت، إحصائيات حية، حظر سيرفرات.
 *
 * كل المعرفات من .env (OWNER_GUILD_ID / OWNER_LOG_CHANNEL_ID / OWNER_STATS_CHANNEL_ID / OWNER_IDS).
 * الإحصائيات تتحدث كل 5 دقائق. أوامر /التحكم-بالبوت تتسجل في سيرفر المالك فقط (ولا تتسجل لو OWNER_GUILD_ID فاضي).
 */
import type { Bot } from "../discord/client.ts";
import type { Ctx } from "../discord/ctx.ts";
import { AuditAction, ButtonStyle, P } from "../discord/constants.ts";
import { config } from "../core/config.ts";
import { db } from "../core/db.ts";
import { E } from "../core/emojis.ts";
import { log } from "../core/log.ts";
import { o } from "../core/opts.ts";
import { COLORS, button, embed, field, fmt, row, type Embed } from "../core/ui.ts";

const sql = db("blacklisted_guilds.db");
sql.exec("CREATE TABLE IF NOT EXISTS blacklisted_guilds (guild_id INTEGER PRIMARY KEY)");

const REFRESH_ID = "revive_stats_refresh";
const MAX_I64 = (1n << 63n) - 1n;

const validId = (s: string) => /^\d{1,20}$/.test(s) && BigInt(s) <= MAX_I64;
const blacklisted = (gid: string) => validId(gid) && sql.value("SELECT 1 FROM blacklisted_guilds WHERE guild_id=?", BigInt(gid)) !== undefined;

export default function setup(bot: Bot): void {
  let statsMsg: string | null = null;
  let busy = false;

  const statsEmbed = (): Embed => {
    let total = 0;
    for (const g of bot.cache.guilds.values()) total += g.memberCount || 0;
    return embed({
      color: COLORS.brand, title: `${E("chart")} إحصائيات ${bot.user.username}`, description: "نظرة مباشرة على انتشار البوت.",
      fields: [
        field(`${E("globe")} السيرفرات`, `\`${fmt(bot.cache.guilds.size)}\``),
        field(`${E("users")} إجمالي الأعضاء`, `\`${fmt(total)}\``),
        field(`${E("bolt")} زمن الاستجابة`, `\`${Math.max(0, Math.round(bot.gateway.ping))} مللي ثانية\``),
      ],
      thumbnail: bot.user.id ? bot.avatar(bot.user) : undefined,
      footer: { text: "يتحدث كل 5 دقائق" },
    });
  };
  const statsView = () => [row(button(REFRESH_ID, "تحديث", ButtonStyle.Primary, { emoji: E("loading") }))];

  /** روم لوق المالك (لازم يكون داخل سيرفر المالك). */
  const logChannel = (): string | null => {
    const g = bot.guild(config.OWNER_GUILD_ID);
    return g && config.OWNER_LOG_CHANNEL_ID && g.channels.has(config.OWNER_LOG_CHANNEL_ID) ? config.OWNER_LOG_CHANNEL_ID : null;
  };

  // زر التحديث يشتغل دايماً (حتى على رسائل قديمة)
  bot.component(REFRESH_ID, (ctx) => ctx.update({ embeds: [statsEmbed()] }));

  // ─────────── أحداث ───────────
  bot.on("GUILD_JOIN", async (d: any, { guild }: any) => {
    const gid: string = d.id;
    if (blacklisted(gid)) {
      await bot.rest.delete(`/users/@me/guilds/${gid}`).catch((e) => log.warn("owner", `leave ${gid}: ${e.message}`));
      return;
    }
    const ch = logChannel();
    if (!ch) return;
    let by = "غير معروف";
    try {
      const r = await bot.rest.get(`/guilds/${gid}/audit-logs`, { query: { limit: 3, action_type: AuditAction.BotAdd } });
      const en = (r.audit_log_entries ?? []).find((x: any) => x.target_id === bot.user.id && x.user_id);
      if (en) {
        const u = (r.users ?? []).find((x: any) => x.id === en.user_id);
        by = `<@${en.user_id}> (\`${u?.username ?? en.user_id}\`)`;
      }
    } catch {}
    await bot.trySend(ch, {
      embeds: [embed({
        color: COLORS.success, title: `${E("log_join")} تمت إضافة البوت لسيرفر جديد`,
        fields: [field("السيرفر", `**${d.name}**\n\`${gid}\``), field("الأعضاء", `\`${fmt(d.member_count ?? 0)}\``), field("أضافه", by, false)],
        thumbnail: bot.guildIcon(guild),
      })],
    });
  });

  bot.on("GUILD_DELETE", async (d: any, { guild }: any) => {
    const ch = logChannel();
    if (!ch) return;
    await bot.trySend(ch, {
      embeds: [embed({ color: COLORS.error, title: `${E("log_leave")} تمت إزالة البوت من سيرفر`, description: `**${guild?.name ?? "غير معروف"}**\n\`${d.id}\`` })],
    });
  });

  // ─────────── الإحصائيات الحية ───────────
  async function statsTick() {
    if (!bot.ready || busy) return;
    const g = bot.guild(config.OWNER_GUILD_ID);
    const ch = config.OWNER_STATS_CHANNEL_ID;
    if (!g || !g.channels.has(ch)) return;
    busy = true;
    const e = statsEmbed();
    try {
      if (statsMsg) {
        await bot.edit(ch, statsMsg, { embeds: [e] });
        return;
      }
      const history: any[] = await bot.rest.get(`/channels/${ch}/messages`, { query: { limit: 10 } });
      const m = history.find((x) => x.author?.id === bot.user.id && x.embeds?.length);
      if (m) {
        statsMsg = m.id;
        await bot.edit(ch, m.id, { embeds: [e], components: statsView() });
        return;
      }
      statsMsg = (await bot.send(ch, { embeds: [e], components: statsView() })).id;
    } catch (err) {
      statsMsg = null;
      log.debug("owner", `stats: ${(err as Error).message}`);
    } finally {
      busy = false;
    }
  }
  if (config.OWNER_GUILD_ID && config.OWNER_STATS_CHANNEL_ID) {
    bot.on("ready", () => void statsTick());
    setInterval(() => void statsTick(), 300_000).unref();
  }

  // ─────────── الأوامر ───────────
  if (!config.OWNER_GUILD_ID) return;

  const guard = async (ctx: Ctx) => {
    if (config.OWNER_IDS.has(ctx.user.id) || ctx.isAdmin) return true;
    await ctx.reply("❌ هذا الأمر لمالك البوت فقط.", true);
    return false;
  };

  bot.command({
    name: "التحكم-بالبوت", description: "أوامر التحكم بالبوت", perms: P.Administrator, guildId: config.OWNER_GUILD_ID,
    options: [
      o.sub("لوحة-الاحصائيات", "إرسال بانل الإحصائيات في هذا الروم"),
      o.sub("حظر-سيرفر", "حظر سيرفر وإخراج البوت منه", [o.str("ايدي_السيرفر", "آيدي السيرفر")]),
      o.sub("فك-حظر-سيرفر", "فك حظر سيرفر", [o.str("ايدي_السيرفر", "آيدي السيرفر")]),
      o.sub("السيرفرات", "عرض أكبر السيرفرات"),
      o.sub("ارسال-رسالة", "إرسال رسالة نصية في روم", [o.channel("الروم", "الروم"), o.str("الرسالة", "الرسالة")]),
    ],
    run: async (ctx) => {
      if (!(await guard(ctx))) return;

      if (ctx.sub === "لوحة-الاحصائيات") {
        await bot.send(ctx.channelId, { embeds: [statsEmbed()], components: statsView() });
        return ctx.reply("✅ تم إرسال البانل.", true);
      }

      if (ctx.sub === "حظر-سيرفر" || ctx.sub === "فك-حظر-سيرفر") {
        const id = (ctx.str("ايدي_السيرفر") ?? "").trim();
        if (!validId(id)) return ctx.reply("❌ آيدي غير صحيح.", true);
        if (ctx.sub === "فك-حظر-سيرفر") {
          sql.run("DELETE FROM blacklisted_guilds WHERE guild_id=?", BigInt(id));
          return ctx.reply(`✅ تم فك حظر السيرفر \`${id}\`.`, true);
        }
        sql.run("INSERT OR IGNORE INTO blacklisted_guilds VALUES(?)", BigInt(id));
        if (bot.guild(id)) await bot.rest.delete(`/users/@me/guilds/${id}`).catch((e) => log.warn("owner", `leave ${id}: ${e.message}`));
        return ctx.reply(`🚫 تم حظر السيرفر \`${id}\`.`, true);
      }

      if (ctx.sub === "السيرفرات") {
        const top = [...bot.cache.guilds.values()].sort((a, b) => (b.memberCount || 0) - (a.memberCount || 0)).slice(0, 15);
        const desc = top.map((g, i) => `\`${String(i + 1).padStart(2)}.\` **${g.name}** — \`${fmt(g.memberCount)}\` · \`${g.id}\``).join("\n");
        return ctx.reply({ embeds: [embed({ color: COLORS.brand, title: `${E("globe")} أكبر السيرفرات`, description: desc || "—" })] }, true);
      }

      if (ctx.sub === "ارسال-رسالة") {
        const ch = ctx.id("الروم")!;
        await bot.send(ch, { content: (ctx.str("الرسالة") ?? "").slice(0, 2000), allowed_mentions: { parse: [] } });
        return ctx.reply(`✅ تم الإرسال إلى <#${ch}>.`, true);
      }
    },
  });
}
