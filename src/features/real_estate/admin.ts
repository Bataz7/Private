/**
 * العقارات — لوحة الإدارة: إضافة، عرض الكل، الإحصائيات، نقل الملكية، التعديل، والحذف.
 */
import type { Bot } from "../../discord/client.ts";
import type { Ctx } from "../../discord/ctx.ts";
import { ButtonStyle } from "../../discord/constants.ts";
import { button, embed, field, input, mention, modal, row, select, userSelect } from "../../core/ui.ts";
import { C, SHOP, money, pyInt, sendLog, sql, type Prop } from "./data.ts";

export const ADMIN_ADD = "admin_add_prop_btn_v12";
export const ADMIN_SELECT = "admin_menu_select_v12";
const ADD_MODAL = "realestate:add";
const EDIT_PICK = "realestate:editpick";
const EDIT_MODAL = "realestate:edit:";
const DEL_PICK = "realestate:delpick";
const XFER_PICK = "realestate:xferpick";
const XFER_USER = "realestate:xferuser:";

export function adminPanel() {
  return {
    embeds: [embed({
      title: "🏢 إدارة العقارات والمحلات",
      description: "لوحة تحكم المسؤولين\n\nمن هنا تقدر تدير جميع العقارات والمحلات وأرباحها والطلبات.",
      color: C.dark, now: false,
    })],
    components: [
      row(button(ADMIN_ADD, "إضافة عقار / محل", ButtonStyle.Success, { emoji: "➕" })),
      row(select(ADMIN_SELECT, [
        { label: "جميع العقارات والمحلات", emoji: "🏠", value: "list", description: "عرض قائمة بكل العقارات والمحلات المسجلة" },
        { label: "الإحصائيات", emoji: "📊", value: "stats", description: "عرض إحصائيات العقارات" },
        { label: "نقل الملكية", emoji: "🔄", value: "transfer", description: "نقل ملكية عقار لمواطن آخر" },
        { label: "تعديل عقار/محل", emoji: "✏️", value: "edit", description: "تعديل كافة بيانات العقار" },
        { label: "إزالة عقار/محل", emoji: "🗑️", value: "delete", description: "حذف عقار من النظام" },
      ], { placeholder: "📋 اختر إجراءً من القائمة...", min: 1, max: 1 })),
    ],
  };
}

/** قائمة اختيار عقار (حد ديسكورد 25 خياراً) — القيمة هي رقم الصف الداخلي. */
function propSelect(customId: string, placeholder: string) {
  const props = sql.all<{ id: number; name: string | null; property_id: string }>("SELECT id, property_id, name FROM properties LIMIT 25");
  if (!props.length) return null;
  return row(select(customId, props.map((p) => ({ label: p.name || p.property_id || "—", value: String(p.id) })), { placeholder, min: 1, max: 1 }));
}

const propByRow = (id: string | undefined) => (id && /^\d+$/.test(id) ? sql.get<Prop>("SELECT * FROM properties WHERE id = ?", Number(id)) : undefined);

async function onSelect(ctx: Ctx): Promise<unknown> {
  const val = ctx.values[0];
  if (val === "list") {
    const props = sql.all<Prop>("SELECT property_id, name, category, price, profit_amount, status FROM properties LIMIT 25");
    if (!props.length) return ctx.reply("❌ لا توجد أي عقارات أو محلات مسجلة بالنظام حالياً.", true);
    const fields = props.map((p) => {
      const profit = p.category === SHOP ? `\n💵 الأرباح الدورية: ${money(p.profit_amount)} ريال` : "";
      return field(`${p.name} (${p.category})`, `🆔 المعرف: \`${p.property_id}\`\n💰 السعر: ${money(p.price)} ريال${profit}\n📌 الحالة: ${p.status}`, false);
    });
    return ctx.reply({ embeds: [embed({ title: "🏠 جميع العقارات والمحلات المسجلة", color: C.blue, fields, now: false })] }, true);
  }
  if (val === "stats") {
    const total = sql.value<number>("SELECT COUNT(*) FROM properties") ?? 0;
    const available = sql.value<number>("SELECT COUNT(*) FROM properties WHERE status='متاح'") ?? 0;
    const sold = sql.value<number>("SELECT COUNT(*) FROM properties WHERE status='مباع'") ?? 0;
    return ctx.reply({
      embeds: [embed({
        title: "📊 إحصائيات العقارات والمحلات", color: C.gold, now: false,
        fields: [field("📦 إجمالي العقارات/المحلات", total), field("🟢 المتاحة", available), field("🔴 المباعة", sold)],
      })],
    }, true);
  }
  if (val === "transfer") {
    const r = propSelect(XFER_PICK, "اختر العقار لنقل ملكيته...");
    if (!r) return ctx.reply("❌ لا توجد عقارات لنقل ملكيتها.", true);
    return ctx.reply({ content: "🔄 اختر العقار/المحل الذي تريد نقل ملكيته:", components: [r] }, true);
  }
  if (val === "edit") {
    const r = propSelect(EDIT_PICK, "اختر العقار أو المحل لتعديله...");
    if (!r) return ctx.reply("❌ لا توجد عقارات لتعديلها.", true);
    return ctx.reply({ content: "✏️ اختر العقار أو المحل الذي تريد تعديل بياناته:", components: [r] }, true);
  }
  if (val === "delete") {
    const r = propSelect(DEL_PICK, "اختر العقار أو المحل لحذفه...");
    if (!r) return ctx.reply("❌ لا توجد عقارات لحذفها.", true);
    return ctx.reply({ content: "🗑️ اختر العقار أو المحل الذي تريد إزالته من النظام:", components: [r] }, true);
  }
  return ctx.deferUpdate();
}

export function registerAdmin(bot: Bot): void {
  bot.component(ADMIN_ADD, (ctx) => ctx.showModal(modal(ADD_MODAL, "إضافة عقار أو محل جديد", [
    input("prop_id", "معرف العقار/المحل (مثال: shop_01)", { placeholder: "shop_01" }),
    input("category", "القسم (فلل، شقق، محلات، مكاتب، استراحات)", { placeholder: "محلات" }),
    input("location", "الموقع / المنطقة", { placeholder: "حي النخيل" }),
    input("price", "سعر الشراء (أرقام فقط)", { placeholder: "250000" }),
    input("profit", "الأرباح الدورية (كل 48 ساعة للمحلات)", { placeholder: "اكتب 0 إذا لم يكن محلاً", value: "0" }),
  ])));

  bot.modal(ADD_MODAL, async (ctx) => {
    const price = pyInt(ctx.fields.get("price"));
    const profit = pyInt(ctx.fields.get("profit"));
    if (price === null || profit === null) return ctx.reply("❌ السعر والأرباح يجب أن تكون أرقاماً صحيحة!", true);
    const pid = ctx.fields.get("prop_id") ?? "";
    const category = ctx.fields.get("category") ?? "";
    try {
      sql.run(
        `INSERT INTO properties (property_id, name, category, location, price, profit_amount, description, owner_id, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'متاح')`,
        pid, pid, category, ctx.fields.get("location") ?? "", price, profit, "لا يوجد وصف",
      );
    } catch (e) {
      if (/UNIQUE|constraint/i.test(String((e as Error)?.message))) return ctx.reply("❌ معرف العقار مستخدم مسبقاً.", true);
      throw e;
    }
    await ctx.reply(`✅ تم إضافة \`${pid}\` بنجاح!`, true);
    await sendLog(bot, ctx.guildId, "➕ إضافة عقار/محل جديد",
      `**المسؤول:** ${mention.user(ctx.user.id)}\n**المعرف:** \`${pid}\`\n**القسم:** ${category}\n**السعر:** ${money(price)} ريال\n**الأرباح:** ${money(profit)} ريال`, C.green);
  });

  bot.component(ADMIN_SELECT, onSelect);

  // ─── نقل الملكية ───
  bot.component(XFER_PICK, (ctx) => {
    const p = propByRow(ctx.values[0]);
    if (!p) return ctx.update({ content: "❌ لم يتم العثور على بيانات هذا العقار.", components: [] });
    return ctx.update({
      content: `🔄 تم اختيار \`${p.property_id}\`. الآن حدد المواطن الجديد من القائمة أدناه لنقل الملكية إليه:`,
      components: [row(userSelect(`${XFER_USER}${p.id}`, "👤 اختر المواطن الجديد لنقل الملكية...", { min: 1, max: 1 }))],
    });
  });
  bot.component(XFER_USER, async (ctx) => {
    const p = propByRow(ctx.customId.slice(XFER_USER.length));
    const newOwner = ctx.values[0];
    if (!p || !newOwner) return ctx.update({ content: "❌ لم يتم العثور على بيانات هذا العقار.", components: [] });
    sql.run("UPDATE properties SET status = 'مباع', owner_id = ? WHERE property_id = ?", newOwner, p.property_id);
    await ctx.update({ content: `✅ تم نقل ملكية العقار/المحل بنجاح إلى المواطن ${mention.user(newOwner)}!`, components: [] });
    await sendLog(bot, ctx.guildId, "🔄 نقل ملكية (إداري)",
      `**المسؤول:** ${mention.user(ctx.user.id)}\n**العقار:** \`${p.property_id}\`\n**المالك الجديد:** ${mention.user(newOwner)}`, C.blue);
  });

  // ─── التعديل ───
  bot.component(EDIT_PICK, (ctx) => {
    const p = propByRow(ctx.values[0]);
    if (!p) return ctx.reply("❌ لم يتم العثور على بيانات هذا العقار.", true);
    return ctx.showModal(modal(`${EDIT_MODAL}${p.id}`, "تعديل بيانات العقار أو المحل", [
      input("name", "الاسم الجديد", { placeholder: "اكتب الاسم الجديد...", value: p.name ?? "" }),
      // التسمية الأصلية (47 حرف) تتعدى حد ديسكورد 45 فكانت النافذة ترفض — اختصرناها.
      input("category", "القسم (فلل، شقق، مكاتب، استراحات، محلات)", { placeholder: "محلات", value: p.category ?? "" }),
      input("location", "الموقع الجديد", { placeholder: "اكتب الموقع الجديد...", value: p.location ?? "" }),
      input("price", "السعر الجديد والأرباح (السعر,الأرباح)", { placeholder: "250000, 10000", value: `${p.price ?? ""}, ${p.profit_amount ?? ""}` }),
      input("desc", "الحالة والوصف (متاح/مباع - الوصف)", {
        paragraph: true, required: false, placeholder: "متاح - تفاصيل جديدة...", value: `${p.status ?? ""} - ${p.description ?? ""}`,
      }),
    ]));
  });
  bot.modal(EDIT_MODAL, async (ctx) => {
    const p = propByRow(ctx.customId.slice(EDIT_MODAL.length));
    if (!p) return ctx.reply("❌ لم يتم العثور على بيانات هذا العقار.", true);
    const parts = (ctx.fields.get("price") ?? "").replaceAll(" ", "").split(",");
    const price = pyInt(parts[0]);
    const profit = parts.length > 1 ? pyInt(parts[1]) : 0;
    if (price === null || profit === null) return ctx.reply("❌ صيغة السعر والأرباح خاطئة! تأكد من كتابتها هكذا: `250000, 10000`", true);
    const descText = (ctx.fields.get("desc") ?? "").trim();
    let status = "متاح";
    let desc = descText;
    const dash = descText.indexOf("-");
    if (dash >= 0) {
      status = descText.slice(0, dash).trim();
      desc = descText.slice(dash + 1).trim();
    }
    const name = ctx.fields.get("name") ?? "";
    sql.run(
      "UPDATE properties SET name = ?, category = ?, location = ?, price = ?, profit_amount = ?, status = ?, description = ? WHERE property_id = ?",
      name, ctx.fields.get("category") ?? "", ctx.fields.get("location") ?? "", price, profit, status, desc, p.property_id,
    );
    await ctx.reply(`✅ تم تعديل بيانات العقار/المحل \`${p.property_id}\` بنجاح!`, true);
    await sendLog(bot, ctx.guildId, "✏️ تعديل بيانات عقار/محل",
      `**المسؤول:** ${mention.user(ctx.user.id)}\n**معرف العقار:** \`${p.property_id}\`\n**الاسم الجديد:** ${name}\n**السعر الجديد:** ${money(price)} ريال`, C.gold);
  });

  // ─── الحذف ───
  bot.component(DEL_PICK, async (ctx) => {
    const p = propByRow(ctx.values[0]);
    if (!p) return ctx.update({ content: "❌ لم يتم العثور على بيانات هذا العقار.", components: [] });
    sql.run("DELETE FROM properties WHERE property_id = ?", p.property_id);
    await ctx.update({ content: `🗑️ تم حذف وإزالة العقار/المحل بمعرف \`${p.property_id}\` من النظام بنجاح!`, components: [] });
    await sendLog(bot, ctx.guildId, "🗑️ حذف عقار/محل", `**المسؤول:** ${mention.user(ctx.user.id)}\n**المعرف المحذوف:** \`${p.property_id}\``, C.red);
  });
}
