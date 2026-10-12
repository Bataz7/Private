/**
 * نظام المرور — تسجيل المخالفات (لوحة العساكر)، إزالتها، عرض غير المسددة،
 * لوحة المواطنين (مخالفاتي + السداد من رصيد البنك)، والسحب التلقائي بعد 5 أيام.
 * البيانات: bank_traffic.db (traffic_settings, traffic_violations) والخصم من bank.db.
 */
import type { Bot } from "../discord/client.ts";
import type { Ctx } from "../discord/ctx.ts";
import { ButtonStyle, P } from "../discord/constants.ts";
import { db, TTL } from "../core/db.ts";
import { log } from "../core/log.ts";
import { o } from "../core/opts.ts";
import { button, embed, fmt, input, mention, modal, row, select, userSelect, type Embed } from "../core/ui.ts";
import { deductMoney } from "./traffic/bank.ts";
import { VIOLATIONS } from "./traffic/violations.ts";

const sql = db("bank_traffic.db");
sql.exec(`
CREATE TABLE IF NOT EXISTS traffic_settings (
    guild_id INTEGER PRIMARY KEY,
    police_role INTEGER,
    control_channel INTEGER,
    citizen_channel INTEGER,
    log_channel INTEGER
);
CREATE TABLE IF NOT EXISTS traffic_violations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    officer_id INTEGER NOT NULL,
    car_type TEXT,
    car_model TEXT,
    car_color TEXT,
    car_plate TEXT,
    reason TEXT NOT NULL,
    amount INTEGER NOT NULL,
    status TEXT DEFAULT 'unpaid',
    created_at TEXT
);
`);

interface Settings { guild_id: string; police_role: string | number | null; control_channel: string | number | null; citizen_channel: string | number | null; log_channel: string | number | null }
interface Violation {
  id: number; guild_id: string; user_id: string; officer_id: string; car_type: string; car_model: string; car_color: string; car_plate: string;
  reason: string; amount: number; status: string; created_at: string;
}
interface CarInfo { type: string; model: string; color: string; plate: string }
interface UserSum { user_id: string; count: number; total: number }

const PAGE = 25;
const PAGES = Math.ceil(VIOLATIONS.length / PAGE);
const DEADLINE_DAYS = 5;

// ألوان discord.py
const C = { red: 0xe74c3c, orange: 0xe67e22, blue: 0x3498db, green: 0x2ecc71, gold: 0xf1c40f, darkBlue: 0x206694, darkRed: 0x992d22, darkOrange: 0xa84300 };

/** 0 / null = غير محدد. */
const idOf = (v: unknown): string | null => (v != null && String(v) !== "0" && String(v) !== "" ? String(v) : null);
const money = (v: number) => `${fmt(Number(v) || 0)} ريال`;
/** datetime.now(timezone.utc).isoformat() بنفس صيغة بايثون (عشان مقارنة النصوص في SQL تبقى صحيحة). */
const pyIso = (d: Date) => d.toISOString().replace("Z", "000+00:00");

function parseIso(s: string): number {
  const t = /(Z|[+-]\d\d:?\d\d)$/.test(s) ? s : `${s}Z`;
  return Date.parse(t);
}

function timeDiff(createdAt: string): string {
  const t = parseIso(String(createdAt ?? ""));
  if (!Number.isFinite(t)) return "وقت غير معروف";
  const seconds = Math.floor((Date.now() - t) / 1000);
  if (seconds < 60) return "منذ لحظات";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `منذ ${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `منذ ${hours} ساعة`;
  return `منذ ${Math.floor(hours / 24)} يوم`;
}

const getSettings = (gid: string) => sql.get<Settings>("SELECT * FROM traffic_settings WHERE guild_id = ?", gid);
const unpaidUsers = (gid: string) =>
  sql.all<UserSum>(
    "SELECT user_id, COUNT(*) as count, SUM(amount) as total FROM traffic_violations WHERE guild_id = ? AND status = 'unpaid' GROUP BY user_id LIMIT 25", gid);
const unpaidOf = (gid: string, uid: string, limit = 25) =>
  sql.all<Violation>("SELECT * FROM traffic_violations WHERE guild_id = ? AND user_id = ? AND status = 'unpaid' ORDER BY id DESC LIMIT ?", gid, uid, limit);

/** بيانات المركبة بين النافذة واختيار العضو والمخالفة (مثل الـ View المؤقت في بايثون). */
const drafts = new TTL<CarInfo>(15 * 60_000, 200);
const token = () => Math.random().toString(36).slice(2, 10);

export default function setup(bot: Bot): void {
  const makeEmbed = (gid: string, title: string, description = "", color: number = C.red): Embed =>
    embed({ title, description, color, thumbnail: bot.guildIcon(bot.guild(gid)) });

  const displayName = (gid: string, uid: string) => {
    const m = bot.cache.member(gid, uid);
    return m ? bot.name(m) : `مستخدم (${uid})`;
  };

  function isPolice(ctx: Ctx): boolean {
    const st = getSettings(ctx.guildId!);
    const rid = idOf(st?.police_role);
    if (!rid || !bot.role(ctx.guildId!, rid)) return ctx.isAdmin;
    return ctx.hasRole(rid) || ctx.isAdmin;
  }

  async function logAction(gid: string, e: Embed) {
    const ch = idOf(getSettings(gid)?.log_channel);
    if (ch && bot.guild(gid)?.channels.has(ch)) await bot.trySend(ch, { embeds: [e] });
  }

  const NOT_POLICE = "❌ هذا الزر مخصص لرجال المرور والعساكر فقط.";

  // ─────────── تسجيل مخالفة ───────────
  bot.component("control_issue_violation", async (ctx) => {
    if (!isPolice(ctx)) return ctx.fail(NOT_POLICE);
    await ctx.showModal(modal("traffic:car", "🚗 بيانات المركبة المخالفة", [
      input("car_type", "1- نوع المركبة", { placeholder: "مثال: فورد، شفروليه، تاهو..." }),
      input("car_model", "2- موديل المركبة", { placeholder: "مثال: 2024، سيدان..." }),
      input("car_color", "3- لون المركبة", { placeholder: "مثال: أسود، أبيض..." }),
      input("car_plate", "4- لوحة المركبة", { placeholder: "مثال: أ ب ج 1234" }),
    ]));
  });

  bot.modal("traffic:car", async (ctx) => {
    const t = token();
    drafts.set(t, {
      type: ctx.fields.get("car_type") ?? "", model: ctx.fields.get("car_model") ?? "",
      color: ctx.fields.get("car_color") ?? "", plate: ctx.fields.get("car_plate") ?? "",
    });
    await ctx.reply({
      content: "📋 تم حفظ معلومات المركبة بنجاح.\nالخطوة التالية: **اختر العضو المراد مخالفته** من القائمة أدناه:",
      components: [row(userSelect(`traffic:target:${t}`, "اختر العضو المخالف من القائمة أو ابحث عنه...", { min: 1, max: 1 }))],
    }, true);
  });

  const expired = (ctx: Ctx) => ctx.update({ content: "⌛ انتهت مهلة هذه القائمة، ابدأ من جديد من لوحة التحكم.", embeds: [], components: [] });

  function violationComponents(t: string, uid: string, page: number) {
    const start = page * PAGE;
    const options = VIOLATIONS.slice(start, start + PAGE).map(([name, price], i) => ({
      label: name, description: `الغرامة: ${money(price)}`, value: String(start + i), emoji: "🚨",
    }));
    const comps: any[] = [row(select(`traffic:vio:${t}:${uid}`, options, { placeholder: `اختر المخالفة المرورية (صفحة ${page + 1} من ${PAGES})...`, min: 1, max: 1 }))];
    if (VIOLATIONS.length > PAGE) {
      const nav = [];
      if (page > 0) nav.push(button(`traffic:page:${t}:${uid}:${page - 1}`, "الصفحة السابقة ◀️", ButtonStyle.Secondary));
      if ((page + 1) * PAGE < VIOLATIONS.length) nav.push(button(`traffic:page:${t}:${uid}:${page + 1}`, "الصفحة التالية ▶️", ButtonStyle.Secondary));
      if (nav.length) comps.push(row(...nav));
    }
    return comps;
  }

  bot.component("traffic:target:", async (ctx) => {
    const t = ctx.customId.split(":")[2]!;
    if (!drafts.get(t)) return expired(ctx);
    const uid = ctx.values[0]!;
    const m = ctx.resolvedMember(uid) ?? (await bot.member(ctx.guildId!, uid));
    if (!m) return ctx.fail("❌ العضو غير موجود في السيرفر.");
    await ctx.update({
      content: `🎯 تم اختيار العضو: **${bot.name(m)}**\nالآن يرجى اختيار نوع المخالفة المرورية:`,
      components: violationComponents(t, uid, 0),
    });
  });

  bot.component("traffic:page:", async (ctx) => {
    const [, , t, uid, page] = ctx.customId.split(":") as [string, string, string, string, string];
    if (!drafts.get(t)) return expired(ctx);
    const p = Math.max(0, Math.min(PAGES - 1, Number(page) || 0));
    await ctx.update({ components: violationComponents(t, uid, p) });
  });

  bot.component("traffic:vio:", async (ctx) => {
    const [, , t, uid] = ctx.customId.split(":") as [string, string, string, string];
    const car = drafts.get(t);
    if (!car) return expired(ctx);
    const item = VIOLATIONS[Number(ctx.values[0])];
    if (!item) return ctx.fail("❌ مخالفة غير معروفة.");
    drafts.delete(t);
    const [reason, amount] = item;
    const gid = ctx.guildId!;
    const officer = ctx.user.id;
    const { lastInsertRowid: vid } = sql.run(
      `INSERT INTO traffic_violations
        (guild_id, user_id, officer_id, car_type, car_model, car_color, car_plate, reason, amount, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', ?)`,
      gid, uid, officer, car.type, car.model, car.color, car.plate, reason, amount, pyIso(new Date()),
    );

    await ctx.update({
      content: `✅ **تم تسجيل المخالفة بنجاح!**\n` +
        `👤 المخالف: ${mention.user(uid)}\n` +
        `🚗 المركبة: \`${car.type} - ${car.model} - ${car.color}\`\n` +
        `🔢 اللوحة: \`${car.plate}\`\n` +
        `📝 السبب: \`${reason}\`\n` +
        `💰 الغرامة: \`${money(amount)}\`\n` +
        `🆔 رقم المخالفة: \`#${vid}\`\n` +
        `⏳ ملاحظة: ستسحب تلقائياً من البنك خلال 5 أيام إذا لم تُسدد.`,
      components: [],
    });

    await bot.dm(uid, { embeds: [makeEmbed(gid, "🚨 مخالفة مرورية جديدة",
      `تم تسجيل مخالفة مرورية بحقك:\n\n` +
      `🚗 **المركبة:** ${car.type} (${car.model}) - ${car.color}\n` +
      `🔢 **رقم اللوحة:** ${car.plate}\n` +
      `📋 **السبب:** ${reason}\n` +
      `💰 **الغرامة:** ${money(amount)}\n` +
      `👮 **العسكري:** ${mention.user(officer)}\n` +
      `🆔 **رقم المخالفة:** \`#${vid}\`\n\n` +
      `⚠️ **تنبيه:** مهلة السداد 5 أيام، وبعدها سيتم السحب تلقائياً من رصيدك البنكي.`)] });

    await logAction(gid, makeEmbed(gid, "🚨 تسجيل مخالفة مرورية",
      `👤 **المخالف:** ${mention.user(uid)}\n` +
      `👮 **العسكري:** ${mention.user(officer)}\n` +
      `🚗 **المركبة:** ${car.type} / ${car.model} / ${car.color}\n` +
      `🔢 **اللوحة:** \`${car.plate}\`\n` +
      `📝 **السبب:** ${reason}\n` +
      `💰 **الغرامة:** ${money(amount)}\n` +
      `🆔 **رقم المخالفة:** \`#${vid}\``, C.orange));
  });

  // ─────────── إزالة مخالفة ───────────
  const userOptions = (gid: string, list: UserSum[], prefix: string) => list.slice(0, 25).map((u) => ({
    label: displayName(gid, u.user_id), description: `${prefix}: ${u.count} | الإجمالي: ${money(u.total)}`, value: String(u.user_id), emoji: "👤",
  }));

  bot.component("control_remove_violation", async (ctx) => {
    if (!isPolice(ctx)) return ctx.fail(NOT_POLICE);
    const gid = ctx.guildId!;
    const users = unpaidUsers(gid);
    if (!users.length) return ctx.reply("🎉 لا توجد أي مخالفات نشطة (غير مسددة) في السيرفر حالياً!", true);
    await ctx.reply({
      embeds: [makeEmbed(gid, "🗑️ لوحة إزالة المخالفات المرورية", "اختر العضو المراد إزالة مخالفة عنه من القائمة أدناه:", C.darkBlue)],
      components: [row(select("traffic:rmuser", userOptions(gid, users, "المخالفات النشطة"), { placeholder: "اختر العضو لعرض مخالفاته النشطة وإزالة ما تحتاجه...", min: 1, max: 1 }))],
    }, true);
  });

  bot.component("traffic:rmuser", async (ctx) => {
    const gid = ctx.guildId!;
    const uid = ctx.values[0]!;
    const list = unpaidOf(gid, uid);
    if (!list.length) return ctx.fail("❌ هذا العضو ليس لديه أي مخالفات نشطة (غير مسددة).");
    const options = list.map((v) => ({
      label: `مخالفة #${v.id} - ${displayName(gid, uid)}`, description: `السبب: ${v.reason} | المبلغ: ${money(v.amount)}`, value: String(v.id), emoji: "🗑️",
    }));
    await ctx.update({
      content: "",
      embeds: [makeEmbed(gid, `🗑️ إزالة مخالفة للمواطن: ${displayName(gid, uid)}`, "اختر المخالفة المطلوبة من القائمة أدناه لحذفها فوراً:", C.orange)],
      components: [row(select("traffic:rm", options, { placeholder: "اختر المخالفة المراد إزالتها...", min: 1, max: 1 }))],
    });
  });

  bot.component("traffic:rm", async (ctx) => {
    const gid = ctx.guildId!;
    const vid = Number(ctx.values[0]);
    const v = sql.get<Violation>("SELECT * FROM traffic_violations WHERE id = ? AND guild_id = ?", vid, gid);
    if (!v) return ctx.fail("❌ هذه المخالفة غير موجودة أو تم حذفها مسبقاً.");
    sql.run("DELETE FROM traffic_violations WHERE id = ?", vid);
    await ctx.update({ content: `✅ **تم إزالة المخالفة بنجاح!**\n🆔 رقم المخالفة: \`#${vid}\`\n📋 السبب المزال: \`${v.reason}\``, embeds: [], components: [] });

    const uid = String(v.user_id);
    const member = await bot.member(gid, uid);
    if (member) {
      await bot.dm(uid, { embeds: [makeEmbed(gid, "🛡️ تم إزالة مخالفة مرورية عنك",
        `قام العسكري ${mention.user(ctx.user.id)} بإزالة إحدى المخالفات النشطة المسجلة بحقك:\n\n` +
        `🆔 **رقم المخالفة:** \`#${vid}\`\n📋 **السبب:** ${v.reason}\n💰 **الغرامة:** ${money(v.amount)}`, C.green)] });
    }
    await logAction(gid, makeEmbed(gid, "🗑️ إزالة مخالفة مرورية (خطأ مطبعي/إلغاء)",
      `👮 **العسكري:** ${mention.user(ctx.user.id)}\n` +
      `👤 **المواطن:** ${mention.user(uid)}\n` +
      `🆔 **رقم المخالفة:** \`#${vid}\`\n` +
      `📝 **السبب المزال:** ${v.reason}\n` +
      `💰 **قيمة المخالفة:** ${money(v.amount)}`, C.blue));
  });

  // ─────────── عرض المخالفات الغير مسددة ───────────
  const unpaidListPayload = (gid: string, users: UserSum[]) => ({
    content: "",
    embeds: [makeEmbed(gid, "📋 قائمة الأشخاص الذين عليهم مخالفات غير مسددة", "اختر العضو من القائمة أدناه لعرض تفاصيل مخالفاته:", C.orange)],
    components: [row(select("traffic:unpaid", userOptions(gid, users, "عدد المخالفات"), { placeholder: "اختر عضواً لعرض مخالفاته بالتفصيل...", min: 1, max: 1 }))],
  });

  bot.component("control_check_unpaid", async (ctx) => {
    if (!isPolice(ctx)) return ctx.fail(NOT_POLICE);
    const gid = ctx.guildId!;
    const users = unpaidUsers(gid);
    if (!users.length) return ctx.reply("🎉 لا توجد أي مخالفات مرورية غير مسددة في السيرفر حالياً!", true);
    await ctx.reply(unpaidListPayload(gid, users), true);
  });

  bot.component("traffic:unpaid", async (ctx) => {
    const gid = ctx.guildId!;
    const uid = ctx.values[0]!;
    let text = `👤 **المخالف:** ${mention.user(uid)}\n\n`;
    for (const v of unpaidOf(gid, uid, 30)) {
      text += `🔹 **رقم المخالفة:** \`#${v.id}\`\n` +
        `💰 **الغرامة:** ${money(v.amount)}\n` +
        `🚗 **المركبة:** ${v.car_type} (${v.car_plate})\n` +
        `📝 **السبب:** ${v.reason}\n` +
        `⏳ **الوقت:** ${timeDiff(v.created_at)}\n` +
        `-----------------------------------\n`;
    }
    await ctx.update({
      content: "",
      embeds: [makeEmbed(gid, `📋 تفاصيل مخالفات: ${displayName(gid, uid)}`, text, C.red)],
      components: [row(button("traffic:back", "العودة لقائمة المخالفين 🔙", ButtonStyle.Secondary))],
    });
  });

  bot.component("traffic:back", async (ctx) => {
    const gid = ctx.guildId!;
    const users = unpaidUsers(gid);
    if (!users.length) return ctx.update({ content: "🎉 لا توجد مخالفات غير مسددة حالياً!", embeds: [], components: [] });
    await ctx.update(unpaidListPayload(gid, users));
  });

  // ─────────── لوحة المواطنين ───────────
  bot.component("citizen_my_violations", async (ctx) => {
    const gid = ctx.guildId!;
    const list = unpaidOf(gid, ctx.user.id, 15);
    if (!list.length) return ctx.reply("🎉 سجلك نظيف! ليس لديك أي مخالفات مرورية غير مسددة.", true);
    let text = "";
    for (const v of list) {
      text += `**#${v.id}** — ${money(v.amount)} (❌ غير مسددة)\n` +
        `🚗 **المركبة:** ${v.car_type} (${v.car_plate})\n` +
        `📝 **السبب:** ${v.reason}\n` +
        `⏳ **المضى:** ${timeDiff(v.created_at)}\n\n`;
    }
    await ctx.reply({ embeds: [makeEmbed(gid, "📋 سجل مخالفاتك المرورية غير المسددة", text, C.gold)] }, true);
  });

  bot.component("citizen_pay_violation", async (ctx) => {
    const gid = ctx.guildId!;
    const list = unpaidOf(gid, ctx.user.id);
    if (!list.length) return ctx.reply("🎉 ليس لديك أي مخالفات غير مسددة لسدادها!", true);
    const options = list.map((v) => ({ label: `مخالفة #${v.id} — ${money(v.amount)}`, description: `السبب: ${v.reason}`, value: String(v.id), emoji: "💳" }));
    await ctx.reply({
      embeds: [makeEmbed(gid, "💳 قائمة سداد المخالفات", "اختر المخالفة التي تريد سدادها من القائمة أدناه:", C.green)],
      components: [row(select("traffic:pay", options, { placeholder: "اختر المخالفة التي تريد سدادها...", min: 1, max: 1 }))],
    }, true);
  });

  bot.component("traffic:pay", async (ctx) => {
    const gid = ctx.guildId!;
    const vid = Number(ctx.values[0]);
    const v = sql.get<Violation>("SELECT * FROM traffic_violations WHERE id = ? AND guild_id = ?", vid, gid);
    if (!v) return ctx.fail("❌ هذه المخالفة غير موجودة.");
    if (String(v.user_id) !== ctx.user.id && !ctx.isAdmin) return ctx.fail("❌ هذه المخالفة ليست مسجلة باسمك.");
    if (v.status === "paid") return ctx.reply("⚠️ هذه المخالفة مسددة مسبقاً!", true);
    // نعلّم المخالفة كمسددة أولاً (يمنع السداد المزدوج بضغطتين متتاليتين) ونرجعها لو فشل الخصم
    if (sql.run("UPDATE traffic_violations SET status = 'paid' WHERE id = ? AND status = 'unpaid'", vid).changes !== 1)
      return ctx.reply("⚠️ هذه المخالفة مسددة مسبقاً!", true);
    if (!deductMoney(ctx.user.id, gid, v.amount)) {
      sql.run("UPDATE traffic_violations SET status = 'unpaid' WHERE id = ?", vid);
      return ctx.fail(`❌ رصيدك البنكي لا يكفي أو غير مسجل بالبنك! (قيمة المخالفة: ${money(v.amount)})`);
    }
    await ctx.update({ content: `✅ **تم سداد المخالفة بنجاح!**\n🆔 رقم المخالفة: \`#${vid}\`\n💰 المبلغ المخصوم: \`${money(v.amount)}\``, embeds: [], components: [] });
    await logAction(gid, makeEmbed(gid, "💳 سداد مخالفة",
      `👤 **المواطن:** ${mention.user(ctx.user.id)}\n🆔 **رقم المخالفة:** \`#${vid}\`\n💰 **المبلغ المسدد:** ${money(v.amount)}`, C.green));
  });

  // ─────────── السحب التلقائي بعد 5 أيام ───────────
  async function autoDeduct() {
    const deadline = pyIso(new Date(Date.now() - DEADLINE_DAYS * 86400_000));
    for (const gid of [...bot.cache.guilds.keys()]) {
      const list = sql.all<Violation>(
        "SELECT * FROM traffic_violations WHERE guild_id = ? AND status = 'unpaid' AND created_at <= ? ORDER BY id LIMIT 200", gid, deadline);
      for (const v of list) {
        const uid = String(v.user_id);
        // مثل بايثون: تُعلَّم مسددة حتى لو ما كفى الرصيد (ما تتكرر كل ساعة)
        deductMoney(uid, gid, v.amount);
        sql.run("UPDATE traffic_violations SET status = 'paid' WHERE id = ?", v.id);
        const member = await bot.member(gid, uid);
        if (member) {
          await bot.dm(uid, { embeds: [makeEmbed(gid, "⚠️ تم السحب التلقائي لمخالفة مرورية",
            `لقد تجاوزت مهلة السداد (5 أيام) للمخالفة رقم \`#${v.id}\`.\n\n` +
            `📋 **السبب:** ${v.reason}\n💰 **المبلغ المسحوب:** ${money(v.amount)}\nتم خصم المبلغ تلقائياً من حسابك البنكي بنجاح.`, C.darkRed)] });
        }
        await logAction(gid, makeEmbed(gid, "🤖 سحب تلقائي لمخالفة منتهية",
          `👤 **المواطن:** ${mention.user(uid)}\n🆔 **رقم المخالفة:** \`#${v.id}\`\n` +
          `💰 **المبلغ المسحوب تلقائياً:** ${money(v.amount)}\n⏳ **السبب:** مر 5 أيام بدون سداد.`, C.darkOrange));
      }
    }
  }
  let running = false;
  const tick = () => {
    if (!bot.ready || running) return;
    running = true;
    autoDeduct().catch((e) => log.err("traffic", e)).finally(() => (running = false));
  };
  setInterval(tick, 3600_000).unref();
  bot.on("ready", tick);

  // ─────────── الأوامر ───────────
  bot.command({
    name: "اعداد-المرور", description: "إعداد رتب ورومات نظام المرور", perms: P.Administrator,
    options: [
      o.role("رتبة_العساكر", "رتبة العساكر", { required: false }),
      o.channel("روم_التحكم", "روم تحكم العساكر", { required: false }),
      o.channel("روم_المواطنين", "روم بانل المواطنين", { required: false }),
      o.channel("روم_اللوق", "روم السجلات (اللوق)", { required: false }),
    ],
    run: async (ctx) => {
      const gid = ctx.guildId!;
      try {
        const old = getSettings(gid);
        const pick = (opt: string, col: keyof Settings) => ctx.id(opt) ?? idOf(old?.[col]) ?? 0;
        const pRole = pick("رتبة_العساكر", "police_role");
        const cChan = pick("روم_التحكم", "control_channel");
        const citChan = pick("روم_المواطنين", "citizen_channel");
        const lChan = pick("روم_اللوق", "log_channel");
        sql.run(
          "INSERT OR REPLACE INTO traffic_settings (guild_id, police_role, control_channel, citizen_channel, log_channel) VALUES (?, ?, ?, ?, ?)",
          gid, pRole, cChan, citChan, lChan,
        );
        const g = bot.guild(gid);
        const role = (id: string | number) => (id && bot.role(gid, String(id)) ? mention.role(String(id)) : "غير محددة");
        const chan = (id: string | number) => (id && g?.channels.has(String(id)) ? mention.channel(String(id)) : "غير محدد");
        await ctx.reply({ embeds: [makeEmbed(gid, "⚙️ تم إعداد نظام المرور بنجاح",
          `👮 رتبة المرور: ${role(pRole)}\n` +
          `🛡️ روم التحكم (عساكر): ${chan(cChan)}\n` +
          `🏛️ روم المواطنين: ${chan(citChan)}\n` +
          `📜 روم السجلات: ${chan(lChan)}`, C.blue)] }, true);
      } catch (e) {
        await ctx.reply(`❌ حدث خطأ أثناء الحفظ: \`${(e as Error).message}\``, true);
      }
    },
  });

  async function sendPanel(ctx: Ctx, col: "control_channel" | "citizen_channel") {
    const gid = ctx.guildId!;
    const control = col === "control_channel";
    const ch = idOf(getSettings(gid)?.[col]);
    if (!ch) return ctx.reply(control ? "❌ يرجى تحديد روم تحكم العساكر أولاً عبر أمر `/اعداد-المرور`" : "❌ يرجى تحديد روم بانل المواطنين أولاً عبر أمر `/اعداد-المرور`", true);
    if (!bot.guild(gid)?.channels.has(ch)) return ctx.reply(control ? "❌ روم التحكم غير موجود" : "❌ روم المواطنين غير موجود", true);
    const payload = control
      ? {
        embeds: [makeEmbed(gid, "🛡️ لوحة تحكم العساكر ورجال المرور",
          "مرحباً بك في نظام إدارة المرور العسكري\n\n" +
          "• **تسجيل مخالفة:** لتعبئة بيانات المركبة واختيار العضو والمخالفة (تسحب تلقائياً خلال 5 أيام إذا لم تُسدد).\n" +
          "• **إزالة مخالفة:** لاختيار عضو وإزالة مخالفة خاطئة (تعرض المخالفات النشطة فقط) مع إرسال إشعار ولُوق.\n" +
          "• **عرض المخالفات الغير مسدده:** لعرض قائمة الأشخاص الذين عليهم مخالفات ومعاينة تفاصيل كل شخص بدقة.", C.darkRed)],
        components: [row(
          button("control_issue_violation", "تسجيل مخالفة", ButtonStyle.Danger, { emoji: "🚨" }),
          button("control_remove_violation", "إزالة مخالفة", ButtonStyle.Primary, { emoji: "🗑️" }),
          button("control_check_unpaid", "عرض المخالفات الغير مسدده", ButtonStyle.Secondary, { emoji: "🔍" }),
        )],
      }
      : {
        embeds: [makeEmbed(gid, "🚦 خدمات المرور العامة للمواطنين",
          "مرحباً بك في البانل الرسمي لخدمات المرور\n\n" +
          "• **مخالفاتي:** للاستعلام عن مخالفاتك غير المسددة فقط.\n" +
          "• **سداد مخالفة:** لاختيار وسداد الغرامات آلياً عبر قائمة منسدلة.", C.blue)],
        components: [row(
          button("citizen_my_violations", "مخالفاتي", ButtonStyle.Primary, { emoji: "📜" }),
          button("citizen_pay_violation", "سداد مخالفة", ButtonStyle.Success, { emoji: "💳" }),
        )],
      };
    try {
      await bot.send(ch, payload);
    } catch {
      return ctx.fail(`ما قدرت أرسل البانل في ${mention.channel(ch)} — تأكد من صلاحيات البوت في الروم.`);
    }
    await ctx.reply(`✅ تم إرسال ${control ? "بانل العساكر" : "بانل المواطنين"} بنجاح في روم ${mention.channel(ch)}`, true);
  }

  bot.command({ name: "لوحة-العساكر-المرور", description: "إرسال بانل تحكم العساكر", perms: P.Administrator, run: (ctx) => sendPanel(ctx, "control_channel") });
  bot.command({ name: "لوحة-المواطنين-المرور", description: "إرسال بانل خدمات المواطنين", perms: P.Administrator, run: (ctx) => sendPanel(ctx, "citizen_channel") });
}

/** للاختبارات. */
export const _test = { sql, pyIso, parseIso, timeDiff, drafts };
