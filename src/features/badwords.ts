/**
 * الكلمات المحظورة — badwords_settings.db
 * أي رسالة فيها كلمة محظورة تنحذف ويتعاقب صاحبها (باند/طرد/تايم أوت/سحب الرتب).
 */
import type { Bot } from "../discord/client.ts";
import type { Ctx } from "../discord/ctx.ts";
import { P } from "../discord/constants.ts";
import { db, TTL } from "../core/db.ts";
import { log } from "../core/log.ts";
import { o } from "../core/opts.ts";
import { embed } from "../core/ui.ts";
import { PUNISHMENT_CHOICES, PUNISHMENT_LABELS, punish } from "./security.ts";

const sql = db("badwords_settings.db");
sql.exec(`
CREATE TABLE IF NOT EXISTS bad_words (
    guild_id INTEGER,
    word TEXT,
    PRIMARY KEY (guild_id, word)
);
CREATE TABLE IF NOT EXISTS bad_words_punishment (
    guild_id INTEGER PRIMARY KEY,
    punishment TEXT DEFAULT 'timeout'
);`);

/** كلمات كل سيرفر (كاش 30 ثانية — تعديلات لوحة التحكم توصل خلالها). */
const wordsCache = new TTL<string[]>(30_000, 1000);
function words(gid: string): string[] {
  let w = wordsCache.get(gid);
  if (!w) w = wordsCache.set(gid, sql.all<{ word: string }>("SELECT word FROM bad_words WHERE guild_id = ?", gid).map((r) => String(r.word)));
  return w;
}
const punishmentOf = (gid: string) => sql.value<string>("SELECT punishment FROM bad_words_punishment WHERE guild_id = ?", gid) ?? "timeout";

export default function setup(bot: Bot): void {
  const admin = (run: (ctx: Ctx) => unknown) => async (ctx: Ctx) => (ctx.isAdmin ? run(ctx) : ctx.fail("هذا الأمر للأدمن فقط."));

  bot.command({
    name: "اضافة-كلمة", description: "إضافة كلمة جديدة إلى قائمة الكلمات المحظورة", perms: P.Administrator,
    options: [o.str("الكلمة", "الكلمة المراد حظرها")],
    run: admin(async (ctx) => {
      const w = ctx.str("الكلمة")!.trim().toLowerCase();
      const r = sql.run("INSERT OR IGNORE INTO bad_words (guild_id, word) VALUES (?, ?)", ctx.guildId!, w);
      wordsCache.delete(ctx.guildId!);
      if (r.changes) await ctx.reply(`✅ تمت إضافة الكلمة (\`${w}\`) إلى قائمة الحظر بنجاح.`, true);
      else await ctx.reply(`⚠️️ الكلمة (\`${w}\`) موجودة مسبقاً في القائمة.`, true);
    }),
  });

  bot.command({
    name: "حذف-كلمة", description: "إزالة كلمة من قائمة الكلمات المحظورة", perms: P.Administrator,
    options: [o.str("الكلمة", "الكلمة المراد إزالتها")],
    run: admin(async (ctx) => {
      const w = ctx.str("الكلمة")!.trim().toLowerCase();
      sql.run("DELETE FROM bad_words WHERE guild_id = ? AND word = ?", ctx.guildId!, w);
      wordsCache.delete(ctx.guildId!);
      await ctx.reply(`🗑️ تمت إزالة الكلمة (\`${w}\`) من القائمة.`, true);
    }),
  });

  bot.command({
    name: "الكلمات-المحظورة", description: "عرض جميع الكلمات المحظورة في السيرفر", perms: P.Administrator,
    run: admin(async (ctx) => {
      const list = sql.all<{ word: string }>("SELECT word FROM bad_words WHERE guild_id = ?", ctx.guildId!);
      if (!list.length) return ctx.reply("📂 لا توجد أي كلمات محظورة مضافة حالياً في هذا السيرفر.", true);
      await ctx.reply({ embeds: [embed({ title: "🚫 قائمة الكلمات المحظورة", description: list.map((r) => `\`${r.word}\``).join(", "), color: 0xe74c3c, now: false })] }, true);
    }),
  });

  bot.command({
    name: "عقوبة-الكلمات", description: "تحديد العقوبة عند كتابة كلمة محظورة", perms: P.Administrator,
    options: [o.choice("العقوبة", "اختر العقوبة التي ستطبق على المخالف", PUNISHMENT_CHOICES)],
    run: admin(async (ctx) => {
      const p = ctx.str("العقوبة")!;
      sql.run(`INSERT INTO bad_words_punishment (guild_id, punishment) VALUES (?, ?)
        ON CONFLICT(guild_id) DO UPDATE SET punishment = excluded.punishment`, ctx.guildId!, p);
      await ctx.reply(`✅ تم تحديث عقوبة الكلمات المحظورة لتصبح: **${PUNISHMENT_LABELS[p] ?? p}**`, true);
    }),
  });

  bot.on("MESSAGE_CREATE", async (d) => {
    if (!d.guild_id || d.author?.bot || d.webhook_id) return;
    const list = words(d.guild_id);
    if (!list.length) return;
    const content = String(d.content ?? "").toLowerCase();
    const word = list.find((w) => w && content.includes(w));
    if (word === undefined) return;
    try {
      await bot.rest.delete(`/channels/${d.channel_id}/messages/${d.id}`, { reason: "كلمة محظورة" });
    } catch (e) {
      log.debug("badwords", `delete failed: ${(e as Error).message}`);
      return;
    }
    const m = await bot.member(d.guild_id, d.author.id);
    await punish(bot, d.guild_id, m, punishmentOf(d.guild_id), `حماية الكلمات المحظورة: كتب كلمة محظورة: ${word}`);
  });
}
