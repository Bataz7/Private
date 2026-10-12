/**
 * العقارات — لوحة المواطنين، طلبات الشراء من النظام (روم الطلبات)، وسوق المواطنين.
 *
 * أزرار طلبات الشراء والسوق تحتفظ بنفس custom_id حق البايثون، وبياناتها (المعرف، المشتري/البائع، السعر)
 * تُقرأ من الإيمبد نفسه — فتشتغل حتى بعد إعادة تشغيل البوت وعلى الرسائل القديمة.
 */
import type { Bot } from "../../discord/client.ts";
import type { Ctx } from "../../discord/ctx.ts";
import { ButtonStyle } from "../../discord/constants.ts";
import { button, clip, embed, field, input, mention, modal, row, select } from "../../core/ui.ts";
import {
  C, CATEGORIES, SHOP, addMoney, errText, getSetting, guildChannel, money, parseUtcIso, payTo, pyInt, sendLog, sql, utcIso, type Prop,
} from "./data.ts";

export const CITIZEN_SELECT = "citizen_menu_select_v12";
const ACCEPT = "accept_req_v12";
const REJECT = "reject_req_v12";
const MARKET_BUY = "market_buy_prop_btn_v12";
const BROWSE = "realestate:browse";
const BUY_MODAL = "realestate:buyreq:";
const SELL_PICK = "realestate:sellpick";
const SELL_MODAL = "realestate:sell:";
const FOOTER = "معرف العقار: ";
const H48 = 48 * 3600_000;

export function citizenPanel() {
  return {
    embeds: [embed({
      title: "🏡 سوق العقارات والمحلات والممتلكات",
      description: "اختر القسم المطلوب للاستعراض أو الشراء، أو استعرض ممتلكاتك، أو استلم أرباح محلاتك من القائمة أدناه:",
      color: C.green, now: false,
    })],
    components: [row(select(CITIZEN_SELECT, [
      { label: "فلل", emoji: "🏰", value: "فلل", description: "استعراض الفلل المتاحة للشراء" },
      { label: "شقق", emoji: "🏢", value: "شقق", description: "استعراض الشقق المتاحة للشراء" },
      { label: "مكاتب", emoji: "💼", value: "مكاتب", description: "استعراض المكاتب المتاحة للشراء" },
      { label: "استراحات", emoji: "🌴", value: "استراحات", description: "استعراض الاستراحات المتاحة للشراء" },
      { label: "محلات", emoji: "🏪", value: "محلات", description: "استعراض المحلات المتاحة للشراء" },
      { label: "ممتلكاتي", emoji: "🏡", value: "my_properties", description: "استعراض العقارات والمحلات التي تملكها" },
      { label: "استلام الأرباح", emoji: "💰", value: "claim_profits", description: "استلام الأرباح الدورية لمحلاتك (كل 48 ساعة)" },
      { label: "عرض عقار للبيع", emoji: "🏷️", value: "sell", description: "عرض عقارك الخاص للبيع في سوق المواطنين" },
    ], { placeholder: "🏡 اختر القسم أو الخدمة المطلوبة...", min: 1, max: 1 }))],
  };
}

const propByRow = (id: string | undefined) => (id && /^\d+$/.test(id) ? sql.get<Prop>("SELECT * FROM properties WHERE id = ?", Number(id)) : undefined);

// ─────────── قائمة المواطنين ───────────
async function browse(ctx: Ctx, category: string) {
  const props = sql.all<Prop>(
    "SELECT id, property_id, name, category, location, price, profit_amount, description FROM properties WHERE category = ? AND status = 'متاح' LIMIT 25", category);
  if (!props.length) return ctx.reply(`❌ لا توجد أي عقارات متاحة في قسم **${category}** حالياً.`, true);
  const fields = props.map((p) => {
    const profit = p.category === SHOP ? `\n💵 الأرباح الدورية: ${money(p.profit_amount)} ريال` : "";
    return field(`${p.name}`, `🆔 المعرف: \`${p.property_id}\`\n📍 الموقع: ${p.location}\n💰 السعر: ${money(p.price)} ريال${profit}\n📝 الوصف: ${p.description}`, false);
  });
  const opts = props.map((p) => ({ label: `${p.name} (${money(p.price)} ريال)`, value: String(p.id) }));
  return ctx.reply({
    embeds: [embed({ title: `🏡 عقارات قسم: ${category}`, color: C.green, fields, now: false })],
    components: [row(select(BROWSE, opts, { placeholder: "🛒 اختر العقار لتقديم طلب شرائه...", min: 1, max: 1 }))],
  }, true);
}

function myProperties(ctx: Ctx) {
  const props = sql.all<Prop>("SELECT property_id, name, category, location, price, profit_amount FROM properties WHERE owner_id = ? LIMIT 25", ctx.user.id);
  if (!props.length) return ctx.reply("❌ أنت لا تملك أي عقارات أو محلات مسجلة باسمك حالياً.", true);
  const fields = props.map((p) => {
    const profit = p.category === SHOP ? `\n💵 الأرباح الدورية: ${money(p.profit_amount)} ريال` : "";
    return field(`${p.name} (${p.category})`, `🆔 المعرف: \`${p.property_id}\`\n📍 الموقع: ${p.location}\n💰 السعر الأصلي: ${money(p.price)} ريال${profit}`, false);
  });
  return ctx.reply({ embeds: [embed({ title: "🏡 ممتلكاتك الخاصة", color: C.blue, fields, now: false })] }, true);
}

/** لمنع الضغط المزدوج (استلام أرباح/شراء/قبول) — يُحذف المفتاح بعد انتهاء العملية. */
const busy = new Set<string>();
async function once(key: string, ctx: Ctx, fn: () => Promise<unknown>): Promise<unknown> {
  if (busy.has(key)) return ctx.reply("⏳ العملية قيد التنفيذ، انتظر لحظة...", true);
  busy.add(key);
  try {
    return await fn();
  } finally {
    busy.delete(key);
  }
}

async function claimProfits(bot: Bot, ctx: Ctx) {
  const uid = ctx.user.id;
  const gid = ctx.guildId!;
  const shops = sql.all<Prop>(
    "SELECT property_id, name, profit_amount, last_claimed_timestamp FROM properties WHERE owner_id = ? AND category = 'محلات' AND profit_amount > 0", uid);
  if (!shops.length) return ctx.reply("❌ لا تملك أي محلات تحقق أرباحاً دورية حالياً.", true);

  const nowMs = Date.now();
  let total = 0;
  const claimed: string[] = [];
  const cooldown: string[] = [];
  for (const s of shops) {
    const last = s.last_claimed_timestamp ? parseUtcIso(s.last_claimed_timestamp) : null;
    if (last !== null && nowMs - last < H48) {
      const remaining = Math.floor((H48 - (nowMs - last)) / 1000);
      const hours = Math.floor(remaining / 3600);
      const minutes = Math.floor((remaining % 3600) / 60);
      cooldown.push(`• **${s.name}** (\`${s.property_id}\`): باقي \`${hours} ساعة و ${minutes} دقيقة\``);
    } else {
      total += Number(s.profit_amount) || 0;
      claimed.push(s.property_id);
    }
  }
  if (!claimed.length && cooldown.length) return ctx.reply(clip("⏳ لم يحين موعد استلام أرباح محلاتك بعد:\n" + cooldown.join("\n"), 2000), true);

  if (total > 0) {
    // الإيداع أولاً: لو فشل (ما عنده حساب) ما يضيع عليه وقت الاستلام.
    try {
      if (!addMoney(uid, gid, total, "استلام أرباح المحلات")) throw new Error("لا يوجد لديك حساب بنكي مسجل");
    } catch (e) {
      return ctx.reply(`❌ حدث خطأ أثناء إيداع الأرباح في رصيدك البنكي: ${errText(e)}`, true);
    }
  }
  const stamp = utcIso();
  sql.tx(() => {
    for (const pid of claimed) sql.run("UPDATE properties SET last_claimed_timestamp = ? WHERE property_id = ?", stamp, pid);
  });

  let msg = `💰 **تم استلام الأرباح بنجاح!**\nإجمالي الأرباح المضافة لرصيدك: \`${money(total)}\` ريال.`;
  if (cooldown.length) msg += "\n\n⏳ **ملاحظة:** بعض محلاتك لم يحين وقت سحب أرباحها:\n" + cooldown.join("\n");
  await ctx.reply(clip(msg, 2000), true);
  await sendLog(bot, gid, "💰 استلام أرباح محل", `**المواطن:** ${mention.user(uid)}\n**المبلغ المستلم:** ${money(total)} ريال`, C.green);
}

function sellPick(ctx: Ctx) {
  const props = sql.all<{ id: number; property_id: string; name: string | null }>("SELECT id, property_id, name FROM properties WHERE owner_id = ? LIMIT 25", ctx.user.id);
  if (!props.length) return ctx.reply("❌ لا تملك أي عقارات أو محلات لعرضها للبيع.", true);
  return ctx.reply({
    content: "🏷️ اختر العقار أو المحل الذي تريد عرضه للبيع في السوق:",
    components: [row(select(SELL_PICK, props.map((p) => ({ label: p.name || p.property_id || "—", value: String(p.id) })), { placeholder: "🏷️ اختر العقار لبيعه...", min: 1, max: 1 }))],
  }, true);
}

// ─────────── قراءة بيانات رسائل الطلبات والسوق ───────────
function messageInfo(ctx: Ctx): { propId: string | null; field: (name: string) => string | undefined } {
  const e = ctx.message?.embeds?.[0];
  const footer: string = e?.footer?.text ?? "";
  const propId = footer.startsWith(FOOTER) ? footer.slice(FOOTER.length) : null;
  return { propId, field: (name) => (e?.fields ?? []).find((f: any) => f.name === name)?.value };
}
const userIdIn = (s: string | undefined) => /<@!?(\d+)>/.exec(s ?? "")?.[1] ?? null;

function requestButtons(disabled: boolean) {
  return [row(
    button(ACCEPT, "قبول الطلب", ButtonStyle.Success, { emoji: "✅", disabled }),
    button(REJECT, "رفض الطلب", ButtonStyle.Danger, { emoji: "❌", disabled }),
  )];
}
const marketButtons = (disabled: boolean) => [row(button(MARKET_BUY, "شراء العقار", ButtonStyle.Success, { emoji: "💳", disabled }))];

export function registerCitizen(bot: Bot): void {
  bot.component(CITIZEN_SELECT, (ctx) => {
    const val = ctx.values[0] ?? "";
    if (CATEGORIES.includes(val)) return browse(ctx, val);
    if (val === "my_properties") return myProperties(ctx);
    if (val === "claim_profits") return once(`claim:${ctx.user.id}`, ctx, () => claimProfits(bot, ctx));
    if (val === "sell") return sellPick(ctx);
    return ctx.deferUpdate();
  });

  // ─── طلب شراء من النظام ───
  bot.component(BROWSE, (ctx) => {
    const id = ctx.values[0];
    if (!id) return ctx.deferUpdate();
    return ctx.showModal(modal(`${BUY_MODAL}${id}`, "طلب شراء عقار أو محل من النظام", [
      input("notes", "سبب الشراء / ملاحظاتك", { paragraph: true, placeholder: "أكتب سبب رغبتك في الشراء...", required: true }),
    ]));
  });

  bot.modal(BUY_MODAL, async (ctx) => {
    const prop = propByRow(ctx.customId.slice(BUY_MODAL.length));
    if (!prop) return ctx.reply("❌ هذا العقار لم يعد موجوداً في النظام!", true);
    const ch = guildChannel(bot, ctx.guildId, "requests_channel");
    if (!ch) {
      const configured = !!getSetting("requests_channel");
      return ctx.reply(configured ? "❌ روم الطلبات غير موجود أو تم حذفه!" : "❌ لم يتم تحديد روم الطلبات من قبل الإدارة عبر أمر `/اعداد-العقارات`!", true);
    }
    const e = embed({
      title: "📥 طلب شراء جديد من النظام", color: C.orange, now: false, footer: { text: `${FOOTER}${prop.property_id}` },
      fields: [
        field("🏠 العقار/المحل", prop.name),
        field("💰 السعر", `${money(prop.price)} ريال`),
        prop.category === SHOP && field("💵 الأرباح الدورية (كل 48 ساعة)", `${money(prop.profit_amount)} ريال`),
        field("📍 الموقع", prop.location),
        field("👤 المشتري", mention.user(ctx.user.id), false),
        field("📝 ملاحظات المشتري", ctx.fields.get("notes"), false),
      ],
    });
    await ctx.defer(true);
    await bot.send(ch, { embeds: [e], components: requestButtons(false) });
    await ctx.edit("✅ تم إرسال طلب الشراء بنجاح إلى الإدارة، سيتم مراجعته والرد عليك قريباً!");
    await sendLog(bot, ctx.guildId, "📥 طلب شراء من النظام",
      `**المشتري:** ${mention.user(ctx.user.id)}\n**العقار:** \`${prop.property_id}\` (${prop.name})\n**السعر:** ${money(prop.price)} ريال`, C.orange);
  });

  bot.component(ACCEPT, (ctx) => {
    const info = messageInfo(ctx);
    const buyerId = userIdIn(info.field("👤 المشتري"));
    return once(`req:${ctx.message?.id}`, ctx, async () => {
      const p = info.propId !== null ? sql.get<{ price: number; name: string }>("SELECT price, name FROM properties WHERE property_id = ?", info.propId) : undefined;
      if (!p || !buyerId) return ctx.reply("❌ هذا العقار غير موجود في النظام!", true);
      const price = Number(p.price) || 0;
      const gid = ctx.guildId!;
      try {
        if (!payTo(buyerId, ctx.user.id, gid, price, "بيع عقار نظامي")) {
          return ctx.reply("❌ فشلت عملية القبول: رصيد المشتري في البنك لا يكفي أو حسابه غير مسجل!", true);
        }
      } catch (e) {
        return ctx.reply(`❌ حدث خطأ أثناء المعالجة المالية: ${errText(e)}`, true);
      }
      sql.run("UPDATE properties SET status = 'مباع', owner_id = ? WHERE property_id = ?", buyerId, info.propId);
      await ctx.update({ components: requestButtons(true) });
      await ctx.followup(`✅ تم قبول الطلب بواسطة ${mention.user(ctx.user.id)}، وتم خصم مبلغ \`${money(price)}\` ريال من المشتري وتحويله لحسابك بنجاح!`);
      await sendLog(bot, gid, "✅ قبول طلب شراء النظام",
        `**المسؤول (المستلم للمبلغ):** ${mention.user(ctx.user.id)}\n**المشتري:** <@${buyerId}>\n**العقار:** \`${info.propId}\` (${p.name})\n**المبلغ المحول:** ${money(price)} ريال`, C.green);
      await bot.dm(buyerId, `🎉 **مبروك! تم قبول طلبك وسحب مبلغ \`${money(price)}\` ريال من حسابك وإتمام نقل الملكية لعقار (${p.name}).**`);
    });
  });

  bot.component(REJECT, async (ctx) => {
    const info = messageInfo(ctx);
    const buyerId = userIdIn(info.field("👤 المشتري"));
    await ctx.update({ components: requestButtons(true) });
    await ctx.followup(`❌ تم رفض الطلب بواسطة ${mention.user(ctx.user.id)}.`);
    await sendLog(bot, ctx.guildId, "❌ رفض طلب شراء",
      `**المسؤول:** ${mention.user(ctx.user.id)}\n**المشتري:** <@${buyerId ?? "?"}>\n**العقار:** \`${info.propId ?? "?"}\``, C.red);
    if (buyerId) await bot.dm(buyerId, "❌ نأسف لك، تم رفض طلب الشراء الخاص بك من قبل الإدارة.");
  });

  // ─── سوق المواطنين ───
  bot.component(SELL_PICK, (ctx) => {
    const id = ctx.values[0];
    if (!id) return ctx.deferUpdate();
    return ctx.showModal(modal(`${SELL_MODAL}${id}`, "عرض عقارك/محلك للبيع", [
      input("price", "سعر البيع المطلوب (أرقام فقط)", { placeholder: "مثال: 300000" }),
    ]));
  });

  bot.modal(SELL_MODAL, async (ctx) => {
    const price = pyInt(ctx.fields.get("price"));
    if (price === null) return ctx.reply("❌ يرجى إدخال أرقام صحيحة لسعر البيع!", true);
    const prop = propByRow(ctx.customId.slice(SELL_MODAL.length));
    if (!prop) return ctx.reply("❌ هذا العقار غير موجود!", true);
    const ch = guildChannel(bot, ctx.guildId, "market_channel");
    if (!ch) {
      const configured = !!getSetting("market_channel");
      return ctx.reply(configured ? "❌ روم سوق المواطنين غير موجود أو تم حذفه!" : "❌ لم يتم تحديد روم سوق المواطنين من قبل الإدارة عبر أمر `/اعداد-العقارات`!", true);
    }
    const e = embed({
      title: "🛒 عقار / محل معروض للبيع من مواطن", description: "تم عرض هذا العقار للبيع بواسطة المالك الحالي.",
      color: C.purple, now: false, footer: { text: `${FOOTER}${prop.property_id}` },
      fields: [
        field("🏠 الاسم", prop.name),
        field("📂 القسم", prop.category),
        field("📍 الموقع", prop.location),
        field("💵 سعر البيع", `${money(price)} ريال`),
        prop.category === SHOP && field("📈 الأرباح الدورية", `${money(prop.profit_amount)} ريال`),
        field("👤 البائع", mention.user(ctx.user.id), false),
      ],
    });
    await ctx.defer(true);
    await bot.send(ch, { embeds: [e], components: marketButtons(false) });
    await ctx.edit(`✅ تم عرض عقارك/محلك للبيع بنجاح في روم ${mention.channel(ch)}!`);
    await sendLog(bot, ctx.guildId, "🏷️ عرض عقار للبيع بسوق المواطنين",
      `**البائع:** ${mention.user(ctx.user.id)}\n**العقار:** \`${prop.property_id}\` (${prop.name})\n**سعر البيع:** ${money(price)} ريال`, C.purple);
  });

  bot.component(MARKET_BUY, (ctx) => {
    const info = messageInfo(ctx);
    const sellerId = userIdIn(info.field("👤 البائع"));
    const price = Number((info.field("💵 سعر البيع") ?? "").replace(/[^\d]/g, "")) || 0;
    const buyerId = ctx.user.id;
    const gid = ctx.guildId!;
    if (buyerId === sellerId) return ctx.reply("❌ لا يمكنك شراء عقارك الخاص!", true);
    return once(`market:${info.propId}`, ctx, async () => {
      const p = info.propId !== null ? sql.get<{ owner_id: string | number; name: string }>("SELECT owner_id, name FROM properties WHERE property_id = ?", info.propId) : undefined;
      if (!p || !sellerId || String(p.owner_id) !== sellerId) {
        return ctx.reply("❌ عذراً، هذا العقار لم يعد ملكاً للبائع أو تم بيعه مسبقاً!", true);
      }
      try {
        if (!payTo(buyerId, sellerId, gid, price, "بيع عقار في السوق")) return ctx.reply("❌ رصيدك في البنك لا يكفي لإتمام عملية الشراء!", true);
      } catch (e) {
        return ctx.reply(`❌ حدث خطأ مالى أثناء إتمام عملية الشراء: ${errText(e)}`, true);
      }
      sql.run("UPDATE properties SET owner_id = ? WHERE property_id = ?", buyerId, info.propId);
      await ctx.update({ components: marketButtons(true) });
      await ctx.followup(`✅ تمت عملية شراء العقار/المحل \`${p.name}\` بنجاح وتم تحويل المبلغ للبائع!`);
      await sendLog(bot, gid, "🤝 إتمام بيع عقار بين المواطنين",
        `**البائع:** <@${sellerId}>\n**المشتري:** ${mention.user(buyerId)}\n**العقار:** \`${info.propId}\` (${p.name})\n**المبلغ:** ${money(price)} ريال`, C.purple);
    });
  });
}
