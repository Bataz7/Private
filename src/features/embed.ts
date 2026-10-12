/**
 * إرسال إيمبد مخصص لأي روم: /ارسال-ايمبد ← نافذة (العنوان، الوصف، الصورة، نص خارجي).
 */
import type { Bot } from "../discord/client.ts";
import { P } from "../discord/constants.ts";
import { o } from "../core/opts.ts";
import { embed, input, mention, modal } from "../core/ui.ts";

/** نفس ألوان discord.py القديمة. */
const COLORS: Record<string, number> = {
  "أزرق": 0x3498db, "أخضر": 0x2ecc71, "أحمر": 0xe74c3c, "أصفر": 0xf1c40f,
  "بنفسجي": 0x9b59b6, "برتقالي": 0xe67e22, "أبيض": 0xeeeff1, "أسود": 0x313338,
};

export default function setup(bot: Bot): void {
  bot.command({
    name: "ارسال-ايمبد", description: "إرسال ايمبد نصي مخصص لأي روم تحدده", perms: P.Administrator,
    options: [
      o.channel("الروم", "روم إرسال الإيمبد"),
      o.choice("اللون", "اختر لون الايمبد", Object.keys(COLORS).map((c) => [c, c] as [string, string])),
    ],
    run: async (ctx) => {
      if (!ctx.isAdmin) return ctx.fail("هذا الأمر للأدمن فقط.");
      const ch = ctx.id("الروم")!;
      const color = ctx.str("اللون") ?? "أزرق";
      await ctx.showModal(modal(`embed:send:${ch}:${color}`, "إنشاء وإرسال ايمبد مخصص", [
        input("title", "عنوان الايمبد", { placeholder: "اكتب عنوان الإيمبد هنا...", max: 256 }),
        input("description", "وصف الايمبد", { paragraph: true, placeholder: "اكتب تفاصيل ووصف الإيمبد هنا...", max: 4000 }),
        input("image", "رابط صورة الايمبد (اختياري)", { placeholder: "https://example.com/image.png", required: false, max: 500 }),
        input("outside", "النص الخارجي خارج الايمبد (اختياري)", { placeholder: "رسالة تظهر فوق الإيمبد...", required: false, max: 500 }),
      ]));
    },
  });

  bot.modal("embed:send:", async (ctx) => {
    const [, , ch, color] = ctx.customId.split(":") as [string, string, string, string];
    const image = (ctx.fields.get("image") ?? "").trim();
    const outside = (ctx.fields.get("outside") ?? "").trim();
    try {
      await bot.send(ch, {
        content: outside || undefined,
        embeds: [embed({
          title: ctx.fields.get("title") ?? "", description: ctx.fields.get("description") ?? "",
          color: COLORS[color] ?? COLORS["أزرق"], image: image || undefined,
        })],
        allowed_mentions: { parse: ["users", "roles", "everyone"] },
      });
      await ctx.reply(`✅ تم إرسال الايمبد بنجاح إلى الروم ${mention.channel(ch)}!`, true);
    } catch (e) {
      await ctx.reply(`❌ حدث خطأ أثناء إرسال الايمبد: ${(e as Error).message}`, true);
    }
  });
}
