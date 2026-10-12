/**
 * نظام البنك — حسابات بنكية بآيبان من 4 أرقام، تحويل، طلب وسداد القروض، لوحة مسؤولي البنك
 * (كشف حساب، رواتب لرتبة، عرض القروض، إضافة/إزالة أموال، إيقاف/تفعيل حساب)، لوق العمليات، و /اعداد-البنك.
 *
 * نفس قاعدة البيانات (data/bank.db) ونفس custom_id للبانلات الدائمة من نسخة بايثون، فالبانلات المرسلة سابقاً تشتغل.
 * الدوال المشتركة للأنظمة الأخرى (getBalance / addMoney / deductMoney …) في bank/store.ts ومُعاد تصديرها هنا.
 */
import type { Bot } from "../discord/client.ts";
import type { Ctx } from "../discord/ctx.ts";
import { ButtonStyle, P } from "../discord/constants.ts";
import { db } from "../core/db.ts";
import { onJob } from "../core/jobs.ts";
import { log } from "../core/log.ts";
import { o } from "../core/opts.ts";
import { button, embed, field, fmt, input, mention, modal, roleSelect, row, select, type Embed } from "../core/ui.ts";
import {
  addTransaction, generateAccountNumber, getAccount, getAccountByNumber, getSettings, parseIntPy, sql, stamp, toAsciiDigits, type Loan,
} from "./bank/store.ts";

export {
  addMoney, addTransaction, deductMoney, getAccount, getAccountByNumber, getBalance, getSettings, sql as bankSql,
  type Account, type BankSettings, type Loan,
} from "./bank/store.ts";

// ─────────── custom_id (نفس بايثون للبانلات الدائمة) ───────────
const ID = {
  create: "bank:create_account_button_unique",
  citizens: "citizen_services_select_menu_unique",
  staff: "bank_staff_select_menu_unique",
  statement: "account_statement_select_unique",
  loanAccept: "loan:accept_unique",
  loanReject: "loan:reject_unique",
  // نوافذ وقوائم مؤقتة (كانت عشوائية في بايثون)
  transfer: "bank:m:transfer",
  repay: "bank:m:repay",
  loan: "bank:m:loan",
  staffAction: "bank:m:staff:", // + add | remove | freeze
  salary: "bank:m:salary",
  salaryRole: "bank:salary_role:", // + amount
} as const;

const C = { blue: 0x3498db, green: 0x2ecc71, red: 0xe74c3c, gold: 0xf1c40f } as const;
const riyal = (n: number) => `${fmt(Number(n))} ريال`;
/** إيمبد بدون لون/وقت زي discord.Embed() الافتراضي في بايثون. */
const plain = (title: string, description: string, color?: number): Embed => {
  const e = embed({ title, description, color, now: false });
  if (color === undefined) delete e.color;
  return e;
};

// ─────────── البانلات ───────────
export const createAccountEmbed = () => plain("🏦 فتح حساب بنكي", "اضغط على الزر أدناه لإنشاء حسابك البنكي والحصول على رقم الآيبان الخاص بك.");
export const createCitizenEmbed = () =>
  plain("🏦 خدمات المواطنين البنكية", "استخدم القائمة أدناه للوصول إلى الخدمات (الرصيد، التحويل، معلومات الحساب، طلب وقروض وسداد القروض).");
export const createStaffEmbed = () =>
  plain("🏦 لوحة تحكم مسؤولي البنك", "هذه اللوحة مخصصة للمسؤولين لإدارة الرواتب، الأرصدة، عرض القروض، كشف الحسابات، وإيقاف الحسابات للمتعثرين.");

const accountPanel = () => ({ embeds: [createAccountEmbed()], components: [row(button(ID.create, "إنشاء حساب بنكي", ButtonStyle.Success, { emoji: "🏦" }))] });
const citizensPanel = () => ({
  embeds: [createCitizenEmbed()],
  components: [row(select(ID.citizens, [
    { label: "الرصيد", description: "الاستعلام عن رصيدك البنكي الحالي", emoji: "💰", value: "balance" },
    { label: "تحويل", description: "تحويل أموال لحساب آخر عبر الآيبان", emoji: "💸", value: "transfer" },
    { label: "معلومات الحساب", description: "عرض تفاصيل حسابك البنكي والآيبان وقروضك غير المسددة", emoji: "🏦", value: "account_info" },
    { label: "طلب قرض", description: "تقديم نموذج طلب قرض جديد", emoji: "📋", value: "loan" },
    { label: "سداد قرض", description: "سداد جزء أو كامل قرضك النشط برقم القرض", emoji: "💳", value: "repay_loan" },
    { label: "إعادة تشغيل القائمة", description: "تحديث وإعادة تحميل القائمة", emoji: "🔄", value: "refresh" },
  ], { placeholder: "اختر الخدمة البنكية المطلوبة...", min: 1, max: 1 }))],
});
const staffPanel = () => ({
  embeds: [createStaffEmbed()],
  components: [row(select(ID.staff, [
    { label: "كشف حساب", description: "عرض أسامي أصحاب الحسابات ومعلوماتها الكاملة", emoji: "📄", value: "statement" },
    { label: "توزيع الرواتب", description: "صرف رواتب لرتبة معينة مع إشعار الأعضاء", emoji: "💵", value: "salary" },
    { label: "عرض القروض", description: "استعراض كافة القروض النشطة وأرقامها", emoji: "📜", value: "view_loans" },
    { label: "إضافة أموال", description: "إضافة رصيد لحساب مواطن عبر الآيبان", emoji: "➕", value: "add" },
    { label: "إزالة أموال", description: "سحب رصيد من حساب مواطن عبر الآيبان", emoji: "➖", value: "remove" },
    { label: "إيقاف / تفعيل حساب", description: "تجميد أو تفعيل حساب بنكي عبر الآيبان", emoji: "🛑", value: "freeze" },
    { label: "إعادة تشغيل القائمة", description: "تحديث وإعادة تحميل القائمة", emoji: "🔄", value: "refresh" },
  ], { placeholder: "اختر إجراء المسؤول...", min: 1, max: 1 }))],
});

const PANELS = {
  account: { col: "account_panel_channel_id", build: accountPanel },
  citizens: { col: "citizens_panel_channel_id", build: citizensPanel },
  staff: { col: "staff_panel_channel_id", build: staffPanel },
} as const;
type PanelName = keyof typeof PANELS;

// ─────────── نوافذ ───────────
const transferModal = () => modal(ID.transfer, "💸 تحويل أموال", [
  input("iban", "آيبان العضو المستلم", { placeholder: "مثال: 4521", max: 4 }),
  input("amount", "المبلغ", { placeholder: "مثال: 5000" }),
]);
const repayModal = () => modal(ID.repay, "💳 سداد قرض", [
  input("loan_id", "رقم القرض", { placeholder: "مثال: 1" }),
  input("amount", "مبلغ السداد", { placeholder: "مثال: 5000" }),
]);
const loanModal = () => modal(ID.loan, "📋 طلب قرض", [
  input("q1", "1- اسمك الحقيقي:", { placeholder: "مثال: محمد" }),
  input("q2", "2- الوظيفة الحالية:", { placeholder: "مثال: عسكري / مدني" }),
  input("q3", "3- مبلغ القرض المطلوب:", { placeholder: "مثال: 50000" }),
  input("q4", "4- سبب طلبك للقرض:", { placeholder: "شراء سيارة / منزل...", paragraph: true }),
  input("q5", "5- التعهد (اكتب: موافق)", { placeholder: "في حال تاخير السداد سيتم إيقاف حسابك" }),
]);
type StaffAction = "add" | "remove" | "freeze";
const staffActionModal = (action: StaffAction) => {
  const title = action === "add" ? "➕ إضافة أموال" : action === "remove" ? "➖ إزالة أموال" : "🛑 إيقاف / تفعيل حساب";
  const inputs = [input("iban", "رقم الآيبان (4 أرقام)", { placeholder: "مثال: 4521", max: 4 })];
  if (action !== "freeze") inputs.push(input("amount", "المبلغ", { placeholder: "مثال: 5000" }));
  return modal(ID.staffAction + action, title, inputs);
};
const salaryModal = () => modal(ID.salary, "💵 تحديد قيمة الراتب", [input("amount", "قيمة الراتب لكل فرد", { placeholder: "مثال: 5000" })]);

const iban = (v: string | undefined) => toAsciiDigits(v ?? "").trim();

// ─────────── الكود الرئيسي ───────────
export default function setup(bot: Bot): void {
  /** أدمن أو عنده رتبة مسؤولي البنك. */
  const isStaff = (ctx: Ctx): boolean => {
    if (ctx.isAdmin) return true;
    const rid = getSettings(ctx.guildId!)?.bank_staff_role_id;
    return !!rid && ctx.hasRole(rid);
  };

  async function sendLog(gid: string, title: string, description: string, color: number = C.blue) {
    const ch = getSettings(gid)?.log_channel_id;
    if (!ch || !bot.channel(ch)) return;
    await bot.trySend(ch, { embeds: [embed({ title: `📜 لوق البنك: ${title}`, description, color })] });
  }
  const bg = (p: Promise<unknown>) => void p.catch((e) => log.err("bank", e));

  // ═════════ إنشاء الحساب ═════════
  bot.component(ID.create, async (ctx) => {
    const gid = ctx.guildId;
    if (!gid) return ctx.deferUpdate();
    if (getAccount(gid, ctx.user.id)) return ctx.reply("❌ لديك حساب بنكي بالفعل.", true);
    const number = generateAccountNumber(gid);
    if (!number) return ctx.fail("تعذر توليد رقم حساب جديد، تواصل مع الإدارة.");
    const r = sql.run(
      "INSERT OR IGNORE INTO accounts (guild_id, user_id, account_number, balance, is_frozen, created_at) VALUES (?, ?, ?, 0, 0, ?)",
      gid, ctx.user.id, number, stamp(),
    );
    if (!r.changes) return ctx.reply("❌ لديك حساب بنكي بالفعل.", true);
    const acc = getAccount(gid, ctx.user.id)!;
    await ctx.reply({
      embeds: [plain("🏦 تم إنشاء حسابك البنكي", `**رقم الحساب (الآيبان):** \`${acc.account_number}\`\n**الرصيد:** \`${riyal(acc.balance)}\``)],
    }, true);
    await sendLog(gid, "إنشاء حساب", `المستخدم: ${mention.user(ctx.user.id)}\nرقم الحساب: \`${acc.account_number}\``);
  });

  // ═════════ خدمات المواطنين ═════════
  bot.component(ID.citizens, async (ctx) => {
    const gid = ctx.guildId;
    if (!gid) return ctx.deferUpdate();
    const val = ctx.values[0];
    if (val === "refresh") return ctx.reply("🔄 تم تحديث وإعادة تحميل القائمة بنجاح.", true);
    const acc = getAccount(gid, ctx.user.id);
    if (val !== "loan" && !acc) return ctx.reply("❌ لا يوجد لديك حساب بنكي.", true);

    if (val === "balance") return ctx.reply({ embeds: [plain("💰 رصيدك البنكي", `**${riyal(acc!.balance)}**`)] }, true);
    if (val === "transfer") {
      if (acc!.is_frozen) return ctx.reply("❌ حسابك موقوف، لا يمكنك التحويل.", true);
      return ctx.showModal(transferModal());
    }
    if (val === "account_info") {
      const loans = sql.all<{ id: number; amount: number }>(
        "SELECT id, amount FROM loans WHERE guild_id = ? AND user_id = ? AND status = 'active' ORDER BY id LIMIT 40", gid, ctx.user.id);
      const loansText = loans.length
        ? loans.map((l) => `• رقم القرض: \`#${l.id}\` — المتبقي: **${riyal(l.amount)}**\n`).join("")
        : "لا توجد قروض غير مسددة ✅";
      const a = acc!;
      return ctx.reply({
        embeds: [plain("🏦 معلومات الحساب والقروض",
          `**رقم الحساب (الآيبان):** \`${a.account_number}\`\n` +
          `**الرصيد:** \`${riyal(a.balance)}\`\n` +
          `**حالة الحساب:** \`${a.is_frozen ? "موقوف 🛑" : "نشط ✅"}\`\n` +
          `**تاريخ الإنشاء:** \`${a.created_at}\`\n\n` +
          `📋 **القروض غير المسددة:**\n${loansText}`, C.blue)],
      }, true);
    }
    if (val === "loan") return ctx.showModal(loanModal());
    if (val === "repay_loan") {
      if (!sql.value("SELECT 1 FROM loans WHERE guild_id = ? AND user_id = ? AND status = 'active' LIMIT 1", gid, ctx.user.id)) {
        return ctx.reply("❌ ليس لديك أي قروض نشطة للسداد.", true);
      }
      return ctx.showModal(repayModal());
    }
    return ctx.deferUpdate();
  });

  // ═════════ التحويل ═════════
  bot.modal(ID.transfer, async (ctx) => {
    const gid = ctx.guildId!;
    const acc = getAccount(gid, ctx.user.id);
    if (!acc || acc.is_frozen) return ctx.reply("❌ حسابك غير متاح أو موقوف.", true);
    const target = iban(ctx.fields.get("iban"));
    const amount = parseIntPy(ctx.fields.get("amount"));
    if (amount === null) return ctx.reply("❌ مبلغ غير صحيح.", true);
    if (amount <= 0) return ctx.reply("❌ يجب أن يكون المبلغ أكبر من صفر.", true);
    if (acc.account_number === target) return ctx.reply("❌ لا يمكنك التحويل لنفسك.", true);
    const tAcc = getAccountByNumber(gid, target);
    if (!tAcc || tAcc.is_frozen) return ctx.reply("❌ لم يتم العثور على الحساب أو أنه موقوف.", true);
    if (acc.balance < amount) return ctx.reply("❌ رصيدك غير كافي.", true);

    const targetId = tAcc.user_id;
    sql.tx(() => {
      sql.run("UPDATE accounts SET balance = balance - ? WHERE guild_id = ? AND account_number = ?", amount, gid, acc.account_number);
      sql.run("UPDATE accounts SET balance = balance + ? WHERE guild_id = ? AND account_number = ?", amount, gid, target);
      addTransaction(gid, ctx.user.id, "تحويل", amount, `تحويل للآيبان \`${target}\``, targetId);
      addTransaction(gid, targetId, "استلام", amount, `استلام من الآيبان \`${acc.account_number}\``, ctx.user.id);
    });
    await ctx.reply(`✅ تم تحويل **${riyal(amount)}** إلى الآيبان (\`${target}\`) بنجاح.`, true);
    bg(sendLog(gid, "تحويل أموال", `من: ${mention.user(ctx.user.id)} (\`${acc.account_number}\`)\nإلى الآيبان: \`${target}\`\nالمبلغ: **${riyal(amount)}**`));
    bg(bot.dm(targetId, {
      embeds: [plain("💸 استلام حوالة مالية", `لقد استلمت حوالة بقيمة **${riyal(amount)}** من الآيبان (\`${acc.account_number}\`).`, C.green)],
    }));
  });

  // ═════════ سداد القرض ═════════
  bot.modal(ID.repay, async (ctx) => {
    const gid = ctx.guildId!;
    const acc = getAccount(gid, ctx.user.id);
    if (!acc || acc.is_frozen) return ctx.reply("❌ حسابك غير متاح أو موقوف.", true);
    const loanId = parseIntPy(ctx.fields.get("loan_id"));
    const amount = parseIntPy(ctx.fields.get("amount"));
    if (loanId === null || amount === null) return ctx.reply("❌ قيم غير صحيحة.", true);
    if (amount <= 0) return ctx.reply("❌ يجب أن يكون المبلغ أكبر من صفر.", true);
    const loan = sql.get<Loan>("SELECT * FROM loans WHERE id = ? AND guild_id = ? AND user_id = ? AND status = 'active'", loanId, gid, ctx.user.id);
    if (!loan) return ctx.reply("❌ لم يتم العثور على قرض نشط بهذا الرقم يخصك.", true);
    // ما نخصم أكثر من المتبقي على القرض
    const pay = Math.min(amount, Math.max(0, Number(loan.amount)));
    if (acc.balance < pay) return ctx.reply("❌ رصيدك البنكي غير كافي للسداد.", true);

    sql.tx(() => {
      sql.run("UPDATE accounts SET balance = balance - ? WHERE guild_id = ? AND account_number = ?", pay, gid, acc.account_number);
      sql.run("UPDATE loans SET amount = amount - ? WHERE id = ?", pay, loanId);
      const left = sql.value<number>("SELECT amount FROM loans WHERE id = ?", loanId) ?? 0;
      if (left <= 0) sql.run("UPDATE loans SET status = 'paid', amount = 0 WHERE id = ?", loanId);
      addTransaction(gid, ctx.user.id, "سداد قرض", pay, `سداد للقرض رقم #${loanId}`);
    });
    await ctx.reply(`✅ تم سداد مبلغ **${riyal(pay)}** للقرض رقم \`#${loanId}\` بنجاح.`, true);
    bg(sendLog(gid, "سداد قرض", `المواطن: ${mention.user(ctx.user.id)}\nرقم القرض: \`#${loanId}\`\nالمبلغ المسدد: **${riyal(pay)}**`));
  });

  // ═════════ طلب القرض ═════════
  bot.modal(ID.loan, async (ctx) => {
    const gid = ctx.guildId!;
    const acc = getAccount(gid, ctx.user.id);
    if (!acc || acc.is_frozen) return ctx.reply("❌ حسابك موقوف أو لا يملك حساباً بنكياً.", true);
    const f = (k: string) => ctx.fields.get(k) ?? "";
    if (!f("q5").includes("موافق")) return ctx.reply("❌ يجب الموافقة على شرط إيقاف الحساب عند التأخير.", true);
    const amount = parseIntPy(f("q3"));
    if (amount === null) return ctx.reply("❌ مبلغ القرض غير صحيح (يجب أن يكون رقماً).", true);
    if (amount <= 0) return ctx.reply("❌ يجب أن يكون المبلغ أكبر من صفر.", true);
    const channelId = getSettings(gid)?.loan_channel_id;
    if (!channelId) return ctx.reply("❌ لم يتم تحديد روم استقبال القروض من قِبل الإدارة.", true);
    if (!bot.channel(channelId)) return ctx.reply("❌ روم القروض غير موجود حالياً.", true);

    const e = embed({
      title: "📜 طلب قرض جديد", color: C.gold, now: false,
      fields: [
        field("المواطن", mention.user(ctx.user.id), false),
        field("رقم الآيبان", `\`${acc.account_number}\``, false),
        field("1- الاسم", f("q1"), true),
        field("2- الوظيفة", f("q2"), true),
        field("3- مبلغ القرض المطلوب", `**${riyal(amount)}**`, false),
        field("4- السبب", f("q4"), false),
      ],
    });
    await bot.send(channelId, {
      embeds: [e],
      components: [row(button(ID.loanAccept, "قبول", ButtonStyle.Success), button(ID.loanReject, "رفض", ButtonStyle.Danger))],
    });
    await ctx.reply("✅ تم إرسال طلب قرضك بنجاح إلى الإدارة.", true);
  });

  /** بيانات الطلب من الإيمبد نفسه (تشتغل للطلبات القديمة من نسخة بايثون أيضاً). */
  const loanData = (ctx: Ctx): { applicant: string; amount: number; account: string } | null => {
    try {
      const fields: { name: string; value: string }[] = ctx.message?.embeds?.[0]?.fields ?? [];
      const get = (n: string) => fields.find((x) => x.name === n)?.value ?? "";
      const applicant = /\d+/.exec(get("المواطن"))?.[0];
      const digits = get("3- مبلغ القرض المطلوب").replace(/\D/g, "");
      const amount = Number(digits);
      const account = /`(.+?)`/.exec(get("رقم الآيبان"))?.[1] ?? "";
      if (!applicant || !digits || !Number.isSafeInteger(amount)) return null;
      return { applicant, amount, account };
    } catch {
      return null;
    }
  };
  const disabledComponents = (ctx: Ctx) =>
    (ctx.message?.components ?? []).map((r: any) => ({ ...r, components: (r.components ?? []).map((c: any) => ({ ...c, disabled: true })) }));
  /** يمنع قبول/رفض نفس الطلب مرتين لو ضغطوا مع بعض. */
  const busy = new Set<string>();

  const decide = (accept: boolean) => async (ctx: Ctx) => {
    const gid = ctx.guildId;
    if (!gid) return ctx.deferUpdate();
    const d = loanData(ctx);
    if (!d) return ctx.reply("❌ تعذر قراءة بيانات الطلب.", true);
    if (!isStaff(ctx)) return ctx.reply("❌ للإدارة أو مسؤولي البنك فقط.", true);
    const key = String(ctx.message?.id);
    if (busy.has(key)) return ctx.deferUpdate();
    busy.add(key);
    try {
      await ctx.update({ components: disabledComponents(ctx) });
      const staff = mention.user(ctx.user.id);
      if (accept) {
        sql.tx(() => {
          sql.run("UPDATE accounts SET balance = balance + ? WHERE guild_id = ? AND account_number = ?", d.amount, gid, d.account);
          sql.run("INSERT INTO loans (guild_id, user_id, account_number, amount, status, created_at) VALUES (?, ?, ?, ?, 'active', ?)",
            gid, d.applicant, d.account, d.amount, stamp());
          addTransaction(gid, d.applicant, "قرض", d.amount, `صرف قرض معتمد بواسطة ${ctx.user.username}`);
        });
        bg(sendLog(gid, "قبول وصرف قرض", `المسؤول: ${staff}\nالمواطن: <@${d.applicant}>\nالمبلغ: **${riyal(d.amount)}**`));
        await bot.dm(d.applicant, {
          embeds: [plain("✅ تم قبول طلب القرض وصرفه",
            `مبروك! تم قبول طلب القرض الخاص بك بقيمة **${riyal(d.amount)}** وإيداعها في حسابك البنكي بواسطة ${staff}.`, C.green)],
        });
        await ctx.followup({
          content: `✅ تم قبول القرض وصرف مبلغ **${riyal(d.amount)}** للمواطن <@${d.applicant}> بواسطة ${staff}`,
          allowed_mentions: { users: [d.applicant] },
        });
      } else {
        await bot.dm(d.applicant, {
          embeds: [plain("❌ تم رفض طلب القرض", `نأسف لك، تم رفض طلب القرض الخاص بك بقيمة **${riyal(d.amount)}** بواسطة ${staff}.`, C.red)],
        });
        await ctx.followup({ content: `❌ تم رفض القرض للمواطن <@${d.applicant}> بواسطة ${staff}`, allowed_mentions: { users: [d.applicant] } });
      }
    } finally {
      busy.delete(key);
    }
  };
  bot.component(ID.loanAccept, decide(true));
  bot.component(ID.loanReject, decide(false));

  // ═════════ لوحة مسؤولي البنك ═════════
  bot.component(ID.staff, async (ctx) => {
    const gid = ctx.guildId;
    if (!gid) return ctx.deferUpdate();
    if (!isStaff(ctx)) return ctx.reply("❌ ليس لديك صلاحية.", true);
    const val = ctx.values[0];
    if (val === "refresh") return ctx.reply("🔄 تم تحديث وإعادة تحميل لوحة التحكم بنجاح.", true);
    if (val === "statement") {
      const accounts = sql.all<{ user_id: string; account_number: string; balance: number }>(
        "SELECT user_id, account_number, balance FROM accounts WHERE guild_id = ? ORDER BY id LIMIT 25", gid);
      const options = accounts.length
        ? accounts.map((a) => {
          const uid = String(a.user_id);
          const m = bot.cache.member(gid, uid);
          let name = m ? bot.name(m) : `مستخدم #${uid}`;
          if (name.length > 80) name = `${name.slice(0, 77)}...`;
          return { label: name, description: `الآيبان: ${a.account_number} | الرصيد: ${fmt(Number(a.balance))}`, value: uid };
        })
        : [{ label: "لا توجد حسابات مسجلة", value: "none" }];
      return ctx.reply({
        content: "📄 الرجاء اختيار العضو المطلوب لعرض كشف حسابه:",
        components: [row(select(ID.statement, options, { placeholder: "اختر عضواً لعرض كشف حسابه...", min: 1, max: 1 }))],
      }, true);
    }
    if (val === "salary") return ctx.showModal(salaryModal());
    if (val === "view_loans") {
      const loans = sql.all<Loan>("SELECT * FROM loans WHERE guild_id = ? AND status = 'active' ORDER BY id LIMIT 40", gid);
      if (!loans.length) return ctx.reply("❌ لا توجد أي قروض نشطة حالياً.", true);
      const desc = loans.map((l) =>
        `• **رقم القرض:** \`#${l.id}\` | المواطن: <@${l.user_id}> | الآيبان: \`${l.account_number}\` | المتبقي: **${riyal(l.amount)}**\n`).join("");
      return ctx.reply({ embeds: [plain("📜 قائمة القروض النشطة", desc, C.gold)] }, true);
    }
    if (val === "add" || val === "remove" || val === "freeze") return ctx.showModal(staffActionModal(val));
    return ctx.deferUpdate();
  });

  // كشف الحساب
  bot.component(ID.statement, async (ctx) => {
    const gid = ctx.guildId;
    if (!gid) return ctx.deferUpdate();
    if (!isStaff(ctx)) return ctx.reply("❌ ليس لديك صلاحية.", true);
    const v = ctx.values[0];
    if (!v || v === "none") return ctx.reply("❌ لا توجد أي حسابات بنكية مسجلة في السيرفر حالياً.", true);
    const acc = getAccount(gid, v);
    if (!acc) return ctx.reply("❌ لم يتم العثور على هذا الحساب.", true);
    return ctx.reply({
      embeds: [plain("📄 كشف حساب البنك (إداري)",
        `👤 **المواطن:** <@${v}>\n` +
        `🏦 **رقم الآيبان:** \`${acc.account_number}\`\n` +
        `💰 **الرصيد الحالي:** \`${riyal(acc.balance)}\`\n` +
        `🛑 **حالة الحساب:** \`${acc.is_frozen ? "موقوف" : "نشط"}\`\n` +
        `📅 **تاريخ الإنشاء:** \`${acc.created_at}\``, C.blue)],
    }, true);
  });

  // إضافة / إزالة / إيقاف
  bot.modal(ID.staffAction, async (ctx) => {
    const gid = ctx.guildId!;
    if (!isStaff(ctx)) return ctx.reply("❌ ليس لديك صلاحية.", true);
    const action = ctx.customId.slice(ID.staffAction.length) as StaffAction;
    const target = iban(ctx.fields.get("iban"));
    const acc = getAccountByNumber(gid, target);
    if (!acc) return ctx.reply("❌ لم يتم العثور على حساب بهذا الآيبان.", true);
    const staff = mention.user(ctx.user.id);

    if (action === "freeze") {
      const next = acc.is_frozen ? 0 : 1;
      sql.run("UPDATE accounts SET is_frozen = ? WHERE guild_id = ? AND account_number = ?", next, gid, target);
      const status = next === 0 ? "تفعيل الحساب ✅" : "إيقاف الحساب 🛑";
      await ctx.reply(`✅ تم تغيير حالة الحساب للآيبان (\`${target}\`) إلى: **${status}**`, true);
      bg(sendLog(gid, "تغيير حالة حساب", `المسؤول: ${staff}\nالآيبان: \`${target}\`\nالحالة الجديدة: **${status}**`));
      return;
    }

    const amount = parseIntPy(ctx.fields.get("amount"));
    if (amount === null) return ctx.reply("❌ المبلغ غير صحيح.", true);
    if (amount <= 0) return ctx.reply("❌ يجب أن يكون المبلغ أكبر من صفر.", true);

    if (action === "add") {
      sql.tx(() => {
        sql.run("UPDATE accounts SET balance = balance + ? WHERE guild_id = ? AND account_number = ?", amount, gid, target);
        addTransaction(gid, acc.user_id, "إضافة أموال", amount, `بواسطة المسؤول ${ctx.user.username}`);
      });
      await ctx.reply(`✅ تم إضافة **${riyal(amount)}** إلى الآيبان (\`${target}\`).`, true);
      bg(sendLog(gid, "إضافة رصيد", `المسؤول: ${staff}\nالآيبان: \`${target}\`\nالمبلغ: **${riyal(amount)}**`));
    } else if (action === "remove") {
      if (acc.balance < amount) return ctx.reply("❌ رصيد صاحب الحساب غير كافي لإتمام الإزالة.", true);
      sql.tx(() => {
        sql.run("UPDATE accounts SET balance = balance - ? WHERE guild_id = ? AND account_number = ?", amount, gid, target);
        addTransaction(gid, acc.user_id, "إزالة أموال", amount, `بواسطة المسؤول ${ctx.user.username}`);
      });
      await ctx.reply(`✅ تم إزالة **${riyal(amount)}** من الآيبان (\`${target}\`).`, true);
      bg(sendLog(gid, "سحب رصيد", `المسؤول: ${staff}\nالآيبان: \`${target}\`\nالمبلغ المسحوب: **${riyal(amount)}**`));
    }
  });

  // الرواتب: نافذة المبلغ ← اختيار الرتبة
  bot.modal(ID.salary, async (ctx) => {
    if (!isStaff(ctx)) return ctx.reply("❌ ليس لديك صلاحية.", true);
    const amount = parseIntPy(ctx.fields.get("amount"));
    if (amount === null) return ctx.reply("❌ مبلغ غير صحيح.", true);
    if (amount <= 0) return ctx.reply("❌ يجب أن يكون المبلغ أكبر من صفر.", true);
    return ctx.reply({
      content: `💵 تم تحديد الراتب: **${riyal(amount)}**.\nالرجاء اختيار رتبة الموظفين المستحقة:`,
      components: [row(roleSelect(ID.salaryRole + amount, "اختر رتبة الموظفين المستحقة...", { min: 1, max: 1 }))],
    }, true);
  });

  bot.component(ID.salaryRole, async (ctx) => {
    const gid = ctx.guildId;
    if (!gid) return ctx.deferUpdate();
    if (!isStaff(ctx)) return ctx.reply("❌ ليس لديك صلاحية.", true);
    const amount = parseIntPy(ctx.customId.slice(ID.salaryRole.length));
    const rid = ctx.values[0];
    if (!amount || amount <= 0 || !rid) return ctx.deferUpdate();
    const roleName: string = ctx.resolved.roles?.[rid]?.name ?? bot.role(gid, rid)?.name ?? rid;
    await ctx.deferUpdate();

    let paid = 0;
    const everyone = rid === gid;
    for await (const m of bot.allMembers(gid)) {
      if (!everyone && !m.roles.includes(rid)) continue;
      const acc = getAccount(gid, m.id);
      if (!acc || acc.is_frozen) continue;
      sql.tx(() => {
        sql.run("UPDATE accounts SET balance = balance + ? WHERE guild_id = ? AND account_number = ?", amount, gid, acc.account_number);
        addTransaction(gid, m.id, "راتب", amount, `صرف راتب رتبة ${roleName}`);
      });
      paid++;
      await bot.dm(m.id, {
        embeds: [plain("💵 تم استلام راتبك", `تم إيداع راتب رتبتك (**${roleName}**) بقيمة **${riyal(amount)}** في حسابك البنكي.`, C.green)],
      });
    }

    bg(sendLog(gid, "صرف رواتب",
      `المسؤول: ${mention.user(ctx.user.id)}\nالرتبة: ${mention.role(rid)}\nالمبلغ لكل فرد: **${riyal(amount)}**\nعدد المستفيدين: **${paid}**`));
    await ctx.edit({
      content: `✅ تم توزيع الرواتب بنجاح على رتبة **${roleName}** بقيمة **${riyal(amount)}** لكل فرد.\n(عدد المستفيدين: **${paid}**)`,
      components: [],
    });
  });

  // ═════════ /اعداد-البنك ═════════
  bot.command({
    name: "اعداد-البنك",
    description: "إعداد بانلات نظام البنك، روم القروض، روم اللوق، ورتبة مسؤولي البنك",
    perms: P.Administrator,
    options: [
      o.choice("البانل", "اختر البانل المراد إرساله", [
        ["بانل إنشاء الحساب", "account"], ["بانل خدمات المواطنين", "citizens"], ["بانل مسؤولي البنك", "staff"], ["إرسال جميع البانلات", "all"],
      ]),
      o.channel("روم_القروض", "روم استقبال طلبات القروض (اختياري)", { required: false }),
      o.channel("روم_اللوق", "روم العمليات واللوق البنكي (اختياري)", { required: false }),
      o.role("رتبة_البنك", "رتبة مسؤولي البنك (اختياري، مقتصرة على الأدمن إن لم تحدد)", { required: false }),
    ],
    run: async (ctx) => {
      const gid = ctx.guildId;
      if (!gid) return;
      if (!ctx.isAdmin) return ctx.reply("❌ هذا الأمر للأعضاء الإداريين فقط.", true);
      await ctx.defer(true);
      const loan = ctx.id("روم_القروض") ?? null;
      const logCh = ctx.id("روم_اللوق") ?? null;
      const role = ctx.id("رتبة_البنك") ?? null;
      sql.run(
        `INSERT INTO guild_settings (guild_id, loan_channel_id, log_channel_id, bank_staff_role_id) VALUES (?, ?, ?, ?)
         ON CONFLICT(guild_id) DO UPDATE SET
           loan_channel_id = COALESCE(?, loan_channel_id),
           log_channel_id = COALESCE(?, log_channel_id),
           bank_staff_role_id = COALESCE(?, bank_staff_role_id)`,
        gid, loan, logCh, role, loan, logCh, role,
      );
      const panel = ctx.str("البانل") ?? "all";
      const names: PanelName[] = panel === "all" ? ["account", "citizens", "staff"] : panel in PANELS ? [panel as PanelName] : [];
      for (const n of names) await bot.send(ctx.channelId, PANELS[n].build());
      for (const n of names) sql.run(`UPDATE guild_settings SET ${PANELS[n].col} = ? WHERE guild_id = ?`, ctx.channelId, gid);
      await ctx.followup("✅ تم حفظ إعدادات البنك وإرسال البانل بنجاح.", true);
    },
  });

  // ═════════ لوحة التحكم: إرسال البانلات للرومات المحفوظة (مثل panel_bk في بايثون) ═════════
  onJob("bank-panel", async (gid) => {
    const s = getSettings(gid);
    const dash = db("dashboard.db");
    dash.exec("CREATE TABLE IF NOT EXISTS panels(guild_id TEXT, section TEXT, slot TEXT, channel_id TEXT, message_id TEXT, PRIMARY KEY(guild_id, section, slot))");
    let n = 0;
    for (const name of Object.keys(PANELS) as PanelName[]) {
      const ch = s?.[PANELS[name].col];
      if (!ch || !bot.channel(ch)) continue;
      const old = dash.get<{ channel_id: string; message_id: string }>(
        "SELECT channel_id, message_id FROM panels WHERE guild_id = ? AND section = 'bank' AND slot = ?", gid, name);
      if (old && String(old.channel_id) === ch) {
        const exists = await bot.rest.get(`/channels/${ch}/messages/${old.message_id}`).then(() => true, () => false);
        if (exists) continue;
      }
      if (old) await bot.deleteMessage(String(old.channel_id), String(old.message_id));
      const msg = await bot.send(ch, PANELS[name].build());
      dash.run("REPLACE INTO panels VALUES (?, ?, ?, ?, ?)", gid, "bank", name, ch, String(msg.id));
      n++;
    }
    return n ? `تم إرسال ${n} بانل` : "البانلات موجودة مسبقاً أو لم تُحدد رومات البانلات";
  });
}
