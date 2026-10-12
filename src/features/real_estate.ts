/**
 * نظام العقارات والمحلات — العقارات والأقسام، طلبات الشراء من النظام (موافقة الإدارة)، سوق المواطنين،
 * نقل/تعديل/حذف (لوحة الإدارة)، ممتلكاتي واستلام أرباح المحلات كل 48 ساعة (لوحة المواطنين)، والسجلات.
 *
 * نفس قاعدة البيانات real_estate.db (properties + settings) ونفس custom_id للبانلات القديمة.
 * الخصم والإيداع في bank.db بنفس استعلامات cogs/bank.py (deduct_money / add_money).
 */
import type { Bot } from "../discord/client.ts";
import { ChannelType, P } from "../discord/constants.ts";
import { onJob } from "../core/jobs.ts";
import { o } from "../core/opts.ts";
import { mention } from "../core/ui.ts";
import { adminPanel, registerAdmin } from "./real_estate/admin.ts";
import { citizenPanel, registerCitizen } from "./real_estate/citizen.ts";
import { getSetting, setSetting, type SettingKey } from "./real_estate/data.ts";

const CH = [ChannelType.Text, ChannelType.News];

export default function setup(bot: Bot): void {
  registerAdmin(bot);
  registerCitizen(bot);

  bot.command({
    name: "اعداد-العقارات",
    description: "تسطيب النظام وتحديد رومات المواطنين، الإدارة، الطلبات، سوق البيع، والسجلات",
    perms: P.Administrator,
    options: [
      o.channel("روم_المواطنين", "روم عرض العقارات للمواطنين", { types: CH }),
      o.channel("روم_الادارة", "روم لوحة تحكم المسؤولين", { types: CH }),
      o.channel("روم_الطلبات", "روم استقبال طلبات شراء العقارات من النظام", { types: CH }),
      o.channel("روم_السوق", "روم سوق عقارات المواطنين (لبيع العقارات)", { types: CH }),
      o.channel("روم_اللوق", "روم سجلات العمليات (اللوق)", { types: CH }),
    ],
    run: async (ctx) => {
      if (!ctx.isAdmin) return ctx.fail("هذا الأمر للمسؤولين فقط (صلاحية Administrator).");
      const citizen = ctx.id("روم_المواطنين")!;
      const admin = ctx.id("روم_الادارة")!;
      const requests = ctx.id("روم_الطلبات")!;
      const market = ctx.id("روم_السوق")!;
      const logs = ctx.id("روم_اللوق")!;
      setSetting("requests_channel", requests);
      setSetting("market_channel", market);
      setSetting("logs_channel", logs);
      // لوحة التحكم تقرأ هذي المفاتيح بعد (نفس جدول settings).
      setSetting("citizen_channel", citizen);
      setSetting("admin_channel", admin);
      await ctx.defer(true);
      try {
        await bot.send(admin, adminPanel());
        await bot.send(citizen, citizenPanel());
      } catch {
        return ctx.edit("❌ ما قدرت أرسل البانل — تأكد إن البوت يقدر يكتب في روم الإدارة وروم المواطنين.");
      }
      return ctx.edit(
        `✅ تم تسطيب النظام بنجاح!\n- روم المواطنين: ${mention.channel(citizen)}\n- روم الإدارة: ${mention.channel(admin)}\n- روم طلبات النظام: ${mention.channel(requests)}\n- روم سوق المواطنين: ${mention.channel(market)}\n- روم السجلات (اللوق): ${mention.channel(logs)}`,
      );
    },
  });

  // لوحة التحكم: إرسال بانل الإدارة والمواطنين للرومات المحفوظة (يحذف البانل السابقة لو موجودة).
  onJob("realestate-panel", async (guildId) => {
    const items: [SettingKey, SettingKey, () => object][] = [
      ["admin_channel", "admin_panel_msg", adminPanel],
      ["citizen_channel", "citizen_panel_msg", citizenPanel],
    ];
    let n = 0;
    for (const [chKey, msgKey, build] of items) {
      const ch = getSetting(chKey);
      if (!ch || bot.guildOfChannel(ch) !== guildId) continue;
      const old = getSetting(msgKey);
      if (old) await bot.deleteMessage(ch, old);
      const msg = await bot.send(ch, build());
      setSetting(msgKey, msg.id);
      n++;
    }
    if (!n) throw new Error("حدد روم الإدارة أو روم المواطنين أولاً");
    return `تم إرسال ${n} بانل`;
  });
}
