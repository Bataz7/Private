/**
 * الأذكار — يرسل ذكر عشوائي في روم محدد كل X دقيقة (azkar_settings.db).
 * اللوب كل 30 ثانية يقرأ السيرفرات المفعّلة من القاعدة (لوحة التحكم تعدّلها مباشرة).
 */
import type { Bot } from "../discord/client.ts";
import { P } from "../discord/constants.ts";
import { db } from "../core/db.ts";
import { log } from "../core/log.ts";
import { o } from "../core/opts.ts";
import { COLORS, embed, mention } from "../core/ui.ts";

const AZKAR_LIST = [
  "سُبْحَانَ اللَّهِ وَبِحَمْدِهِ، سُبْحَانَ اللَّهِ الْعَظِيمِ.",
  "لَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِاللَّهِ.",
  "أَسْتَغْفِرُ اللَّهَ الْعَظِيمَ وَأَتُوبُ إِلَيْهِ.",
  "سُبْحَانَ اللَّهِ، وَالْحَمْدُ لِلَّهِ، وَلَا إِلَهَ إِلَّا اللَّهُ، وَاللَّهُ أَكْبَرُ.",
  "لَا إِلهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ، لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ وَهُوَ عَلَى كُلِّ شَيْءٍ قَدِيرٌ.",
  "اللَّهُمَّ صَلِّ وَسَلِّمْ عَلَى نَبِيِّنَا مُحَمَّدٍ.",
  "رَبِّ اغْفِرْ لِي وَتُبْ عَلَيَّ إِنَّكَ أَنْتَ التَّوَّابُ الرَّحِيمُ.",
  "سُبْحَانَ اللَّهِ وَبِحَمْدِهِ عَدَدَ خَلْقِهِ، وَرِضَا نَفْسِهِ، وَزِنَةَ عَرْشِهِ، وَمِدَادَ كَلِمَاتِهِ.",
  "رَبَّنَا آتِنَا فِي الدُّنْيَا حَسَنَةً وَفِي الْآخِرَةِ حَسَنَةً وَقِنَا عَذَابَ النَّارِ.",
  "يَا حَيُّ يَا قَيُّومُ بِرَحْمَتِكَ أَسْتَغِيثُ، أَصْلِحْ لِي شَأْنِي كُلَّهُ وَلَا تَكِلْنِي إِلَى نَفْسِي طَرْفَةَ عَيْنٍ.",
  "حَسْبِيَ اللَّهُ لَا إِلَهَ إِلَّا هُوَ عَلَيْهِ تَوَكَّلْتُ وَهُوَ رَبُّ الْعَرْشِ الْعَظِيمِ.",
  "اللَّهُمَّ إِنِّي أَسْأَلُكَ الْعَفْوَ وَالْعَافِيَةَ فِي الدُّنْيَا وَالْآخِرَةِ.",
  "رَبِّ اشْرَحْ لِي صَدْرِي وَيَسِّرْ لِي أَمْرِي.",
  "لَا إِلَهَ إِلَّا أَنْتَ سُبْحَانَكَ إِنِّي كُنْتُ مِنَ الظَّالِمِينَ.",
  "اللَّهُمَّ أَنْتَ رَبِّي لَا إِلَهَ إِلَّا أَنْتَ، خَلَقْتَنِي وَأَنَا عَبْدُكَ، وَأَنَا عَلَى عَهْدِكَ وَوَعْدِكَ مَا اسْتَطَعْتُ.",
];

const sql = db("azkar_settings.db");
sql.exec(`
CREATE TABLE IF NOT EXISTS server_azkar (
    guild_id INTEGER PRIMARY KEY,
    channel_id INTEGER,
    interval_minutes INTEGER DEFAULT 15,
    status TEXT DEFAULT 'FALSE',
    last_sent REAL DEFAULT 0
)`);
// القواعد القديمة اللي ناقصها أعمدة
for (const [c, t] of Object.entries({ channel_id: "INTEGER DEFAULT 0", interval_minutes: "INTEGER DEFAULT 15", status: "TEXT DEFAULT 'FALSE'", last_sent: "REAL DEFAULT 0" })) {
  sql.addColumn("server_azkar", c, t);
}

interface Row { guild_id: string; channel_id: string | number | null; interval_minutes: number | null; status: string; last_sent: number | null }

const BLURPLE = 0x5865f2;

export default function setup(bot: Bot): void {
  bot.command({
    name: "اعداد-الاذكار", description: "تحديد روم الأذكار، المدة الزمنية، وتفعيل النظام", perms: P.Administrator,
    options: [
      o.choice("الحالة", "حالة الأذكار تفعيل أو تعطيل", [["🟢 تفعيل", "TRUE"], ["🔴 تعطيل", "FALSE"]]),
      o.channel("الروم", "روم إرسال الأذكار", { required: false }),
      o.int("المدة", "المدة الزمنية بين كل ذكر والآخر", {
        required: false, choices: [["5 دقائق", 5], ["10 دقائق", 10], ["15 دقيقة", 15], ["30 دقيقة", 30], ["45 دقيقة", 45]],
      }),
    ],
    run: async (ctx) => {
      if (!ctx.isAdmin) return ctx.reply("⛔ هذا الأمر للأدمن فقط.", true);
      const gid = ctx.guildId!;
      const status = ctx.str("الحالة")!;
      const current = sql.get<Row>("SELECT * FROM server_azkar WHERE guild_id = ?", gid);
      const chId = ctx.id("الروم") ?? (current?.channel_id ? String(current.channel_id) : "");
      const inte = ctx.int("المدة") || current?.interval_minutes || 15;

      if (status === "TRUE") {
        if (!chId) return ctx.reply("⚠️ يجب تحديد روم الأذكار عند تفعيل النظام!", true);
        const ch = bot.guild(gid)?.channels.get(chId);
        if (!ch) return ctx.reply("⚠️ ما قدرت ألقى الروم، حدد روم ثاني.", true);
        // نتأكد إن البوت يقدر يرسل في الروم (أشهر سبب إن الأذكار ما تطلع)
        const me = await bot.me(gid);
        const need = P.ViewChannel | P.SendMessages | P.EmbedLinks;
        if (!me || (bot.channelPerms(gid, chId, me.roles, me.id) & need) !== need) {
          return ctx.reply(`⚠️ البوت ما عنده صلاحية (رؤية الروم + إرسال رسائل + تضمين الروابط) في ${mention.channel(chId)}.`, true);
        }
      }

      // عند التفعيل نخلي last_sent = 0 عشان أول ذكر يوصل مباشرة (خلال 30 ثانية)
      sql.run("INSERT OR REPLACE INTO server_azkar (guild_id, channel_id, interval_minutes, status, last_sent) VALUES (?, ?, ?, ?, ?)",
        gid, chId || 0, inte, status, status === "TRUE" ? 0 : Date.now() / 1000);

      await ctx.reply({ embeds: [embed({
        title: "📿 إعدادات نظام الأذكار",
        description: `**الحالة:** \`${status === "TRUE" ? "مفعّل" : "معطّل"}\`\n**الروم:** ${chId ? mention.channel(chId) : "غير محدد"}\n**المدة:** كل \`${inte}\` دقائق`,
        color: status === "TRUE" ? COLORS.green : 0xe74c3c,
      })] }, true);
    },
  });

  async function tick() {
    if (!bot.ready) return;
    const rows = sql.all<Row>("SELECT guild_id, channel_id, interval_minutes, last_sent FROM server_azkar WHERE status = 'TRUE'");
    const t = Date.now() / 1000;
    for (const r of rows) {
      const interval = r.interval_minutes || 15;
      if (t - (r.last_sent || 0) < interval * 60 || !r.channel_id) continue;
      try {
        await bot.send(String(r.channel_id), { embeds: [embed({
          title: "✨ ذكر من القلب", color: BLURPLE,
          description: `>>> **${AZKAR_LIST[Math.floor(Math.random() * AZKAR_LIST.length)]}**`,
          footer: { text: "صَلِّ على الحبيب ليشفع لك • البوت الإسلامي" },
        })] });
      } catch (e) {
        log.debug("azkar", `send failed for guild ${r.guild_id}: ${(e as Error).message}`);
      }
      // نحدث الوقت حتى لو فشل الإرسال عشان ما يعيد المحاولة كل 30 ثانية
      sql.run("UPDATE server_azkar SET last_sent = ? WHERE guild_id = ?", t, r.guild_id);
    }
  }

  let busy = false;
  setInterval(() => {
    if (busy) return;
    busy = true;
    tick().catch((e) => log.err("azkar", e)).finally(() => (busy = false));
  }, 30_000).unref();
}
