/**
 * المستويات — XP مع كل رسالة (15-25)، الصعود كل (المستوى+1)×250 خبرة، ورسالة تهنئة في روم المستويات.
 * levels_settings.db (user_levels + server_levels_settings).
 */
import type { Bot } from "../discord/client.ts";
import { P } from "../discord/constants.ts";
import { db } from "../core/db.ts";
import { o } from "../core/opts.ts";
import { COLORS, bar, container, embed, fmt, mention, section, sep, text, thumb, V2 } from "../core/ui.ts";

const DEFAULT_MSG = "مبروك {user}، لقد صعدت إلى المستوى {level}! (المستوى القادم: {next-level})";

const sql = db("levels_settings.db");
sql.exec(`
CREATE TABLE IF NOT EXISTS user_levels (
    guild_id INTEGER,
    user_id INTEGER,
    xp INTEGER DEFAULT 0,
    level INTEGER DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
);
CREATE TABLE IF NOT EXISTS server_levels_settings (
    guild_id INTEGER PRIMARY KEY,
    channel_id INTEGER,
    custom_message TEXT DEFAULT '${DEFAULT_MSG}'
);`);

interface Settings { guild_id: string; channel_id: string | number | null; custom_message: string | null }
const getSettings = (gid: string) => sql.get<Settings>("SELECT * FROM server_levels_settings WHERE guild_id = ?", gid);

/** XP اللازم للمستوى القادم (نفس المعادلة القديمة — الخبرة تراكمية). */
const nextXp = (level: number) => (level + 1) * 250;

export default function setup(bot: Bot): void {
  bot.command({
    name: "روم-المستويات", description: "تحديد روم إرسال إشعارات صعود المستويات", perms: P.Administrator,
    options: [
      o.channel("الروم", "روم المستويات"),
      o.str("الرسالة", "رسالة التلفل المخصصة (استخدم المتغيرات: {user}, {level}, {next-level}, {xp})", { required: false }),
    ],
    run: async (ctx) => {
      if (!ctx.isAdmin) return ctx.fail("هذا الأمر للأدمن فقط.");
      const gid = ctx.guildId!;
      const ch = ctx.id("الروم")!;
      const message = ctx.str("الرسالة");
      const cur = getSettings(gid);
      if (!cur) sql.run("INSERT INTO server_levels_settings (guild_id, channel_id, custom_message) VALUES (?, ?, ?)", gid, ch, message || DEFAULT_MSG);
      else sql.run("UPDATE server_levels_settings SET channel_id = ?, custom_message = ? WHERE guild_id = ?", ch, message ?? cur.custom_message, gid);
      await ctx.reply({ embeds: [embed({
        title: "✨ إعدادات نظام المستويات", color: COLORS.green, now: false,
        description: `**روم المستويات:** ${mention.channel(ch)}\n**الرسالة:**\n\`\`\`${message || "افتراضية"}\`\`\``,
      })] }, true);
    },
  });

  bot.command({
    name: "المستوى", description: "عرض مستواك الحالي وعدد نقاط الخبرة",
    options: [o.user("العضو", "العضو المراد عرض مستواه (اختياري)", { required: false })],
    run: async (ctx) => {
      const gid = ctx.guildId!;
      const uid = ctx.id("العضو") ?? ctx.user.id;
      const m = ctx.memberOpt("العضو") ?? (uid === ctx.user.id ? ctx.member : undefined);
      const u = m ?? ctx.userOpt("العضو") ?? ctx.user;
      const r = sql.get<{ xp: number; level: number }>("SELECT xp, level FROM user_levels WHERE guild_id = ? AND user_id = ?", gid, uid);
      const xp = r?.xp ?? 0;
      const level = r?.level ?? 0;
      const next = nextXp(level);
      const rank = r ? (sql.value<number>("SELECT COUNT(*) FROM user_levels WHERE guild_id = ? AND (level > ? OR (level = ? AND xp > ?))", gid, level, level, xp) ?? 0) + 1 : null;
      const into = Math.max(0, xp - level * 250);
      const name = m ? bot.name(m) : bot.name({ nick: null, globalName: u.globalName, username: u.username });
      await ctx.reply({
        flags: V2,
        components: [container(0x3498db,
          section([`## 📊 بطاقة المستوى لـ ${name}`, `**المستوى:** \`${level}\`${rank ? ` · **الترتيب:** #${rank}` : ""}`,
            `**النقاط الحالية:** \`${fmt(xp)} / ${fmt(next)} خبرة\``], thumb(bot.avatar(m ?? u, 256))),
          sep(),
          text(`\`${bar(into, 250, 16)}\` ${Math.min(100, Math.round((into / 250) * 100))}%\n-# باقي ${fmt(Math.max(0, next - xp))} خبرة للمستوى ${level + 1}`),
        )],
      });
    },
  });

  bot.on("MESSAGE_CREATE", async (d) => {
    if (!d.guild_id || d.author?.bot || d.webhook_id) return;
    const gid: string = d.guild_id;
    const uid: string = d.author.id;
    const earned = 15 + Math.floor(Math.random() * 11); // 15..25
    const r = sql.get<{ xp: number; level: number }>(
      `INSERT INTO user_levels (guild_id, user_id, xp, level) VALUES (?, ?, ?, 0)
       ON CONFLICT(guild_id, user_id) DO UPDATE SET xp = xp + excluded.xp RETURNING xp, level`, gid, uid, earned);
    if (!r || r.xp < nextXp(r.level)) return;
    const level = r.level + 1;
    sql.run("UPDATE user_levels SET level = ? WHERE guild_id = ? AND user_id = ?", level, gid, uid);

    const st = getSettings(gid);
    if (!st?.channel_id) return;
    const ch = String(st.channel_id);
    if (!bot.guild(gid)?.channels.has(ch)) return;
    const msg = (st.custom_message || "مبروك {user}، لقد صعدت إلى المستوى {level}!")
      .replaceAll("{user}", mention.user(uid)).replaceAll("{level}", String(level))
      .replaceAll("{next-level}", String(level + 1)).replaceAll("{xp}", String(r.xp));
    await bot.trySend(ch, { content: msg, allowed_mentions: { users: [uid] } });
  });
}
