/**
 * نظام المركبات — تسجيل مركبة واستخراج لوحة (أسئلة في الخاص + خصم الرسوم من البنك)،
 * شراء تأمين أسبوعي، عرض المركبات، سحب التأمين (للأدمن)، وتنبيه انتهاء التأمين.
 * البيانات: vehicles_data.json ({ userId: [vehicle, …] }) و vehicles_config.json ({ guildId: { panel_channel, log_channel, insured_channel } }).
 */
import type { Bot } from "../discord/client.ts";
import type { Ctx } from "../discord/ctx.ts";
import { P } from "../discord/constants.ts";
import { JsonStore } from "../core/db.ts";
import { log } from "../core/log.ts";
import { o } from "../core/opts.ts";
import { embed, field, input, mention, modal, row, select, type Embed } from "../core/ui.ts";
import { deductMoney } from "./traffic/bank.ts";

const REGISTRATION_FEE = 750;
const PLATE_FEE = 850; // رسوم استخراج اللوحة الإجبارية
const INSURANCE_FEE = 1000;
const TARGET_IBAN = "3554";
const MAX_VEHICLES = 3;
const ANSWER_TIMEOUT = 60_000;

/** نفس نمط بايثون: ^[؀-ۿa-zA-Z0-9\s\-]+-\d+$ (‏\d في بايثون يقبل الأرقام العربية أيضاً). */
const PLATE_REGEX = /^[؀-ۿa-zA-Z0-9\s\-]+-\p{Nd}+$/u;
const IMAGE_EXT = [".png", ".jpg", ".jpeg", ".webp", ".gif"];

// ألوان discord.py
const C = { blue: 0x3498db, green: 0x2ecc71, purple: 0x9b59b6, darkRed: 0x992d22 };

interface Vehicle {
  real_name?: string; age?: string; id_num?: string; name?: string; company?: string; plate?: string; color?: string;
  image?: string | null; insured?: boolean; insurance_expiry?: string | null; expired_notified?: boolean;
}
type Data = Record<string, Vehicle[]>;
interface GuildCfg { panel_channel?: string | number; log_channel?: string | number; insured_channel?: string | number }

const dataStore = new JsonStore<Data>("vehicles_data.json");
const configStore = new JsonStore<Record<string, GuildCfg>>("vehicles_config.json");

const vehiclesOf = (uid: string): Vehicle[] => {
  const v = dataStore.get()[uid];
  return Array.isArray(v) ? v : [];
};

/** datetime.utcnow().isoformat() — بدون منطقة زمنية مثل بايثون. */
const utcIso = (d: Date) => d.toISOString().replace("Z", "000");
const parseUtc = (s: unknown): number => {
  if (typeof s !== "string" || !s) return NaN;
  return Date.parse(/(Z|[+-]\d\d:?\d\d)$/.test(s) ? s : `${s}Z`);
};
/** strftime بالتوقيت العالمي: '%Y-%m-%d' أو '%Y-%m-%d %H:%M'. */
const ymd = (t: number, withTime = false) => {
  const s = new Date(t).toISOString();
  return withTime ? `${s.slice(0, 10)} ${s.slice(11, 16)}` : s.slice(0, 10);
};

function vehicleOptions(list: Vehicle[]) {
  return list.slice(0, 25).map((v, i) => ({
    label: `${v.company ?? ""} ${v.name ?? "مركبة"} (لوحة: ${v.plate ?? "بدون"})`,
    description: `اللون: ${v.color ?? "غير متوفر"} | الحالة: ${v.insured ? "مؤمنة 🟢" : "غير مؤمنة 🔴"}`,
    value: String(i),
  }));
}

export default function setup(bot: Bot): void {
  const cfgOf = (gid: string): GuildCfg | undefined => configStore.get()[gid];
  const logChannel = (gid: string, key: "log_channel" | "insured_channel"): string | null => {
    const id = cfgOf(gid)?.[key];
    if (!id) return null;
    return bot.guild(gid)?.channels.has(String(id)) ? String(id) : null;
  };

  // ─────────── انتظار رسائل الخاص (بديل bot.wait_for) ───────────
  /** جلسة أسئلة وحدة لكل عضو؛ جلسة جديدة تلغي القديمة. */
  const sessions = new Map<string, number>();
  const waiters = new Map<string, (m: any) => void>();
  let seq = 0;

  const startSession = (uid: string) => {
    const id = ++seq;
    sessions.set(uid, id);
    waiters.get(uid)?.(false); // يلغي انتظار الجلسة القديمة
    return id;
  };
  const endSession = (uid: string, id: number) => {
    if (sessions.get(uid) === id) sessions.delete(uid);
  };
  /** يرجع الرسالة، أو null عند انتهاء الوقت، أو false لو انلغت الجلسة. */
  function waitDm(uid: string, sid: number): Promise<any> {
    if (sessions.get(uid) !== sid) return Promise.resolve(false);
    return new Promise((resolve) => {
      const done = (m: any) => {
        clearTimeout(timer);
        if (waiters.get(uid) === done) waiters.delete(uid);
        resolve(m);
      };
      const timer = setTimeout(() => done(null), ANSWER_TIMEOUT);
      waiters.set(uid, done);
    });
  }

  bot.on("MESSAGE_CREATE", (d) => {
    if (d.guild_id || d.author?.bot || !d.author?.id) return;
    waiters.get(d.author.id)?.(d);
  });

  const isImage = (a: any) => IMAGE_EXT.some((ext) => String(a?.filename ?? "").toLowerCase().endsWith(ext));

  /** ينتظر صورة (يرفض النصوص والملفات الأخرى) — يرجع الرابط أو null/false. */
  async function askImage(uid: string, sid: number, notImage: string, noText: string): Promise<string | null | false> {
    for (;;) {
      const msg = await waitDm(uid, sid);
      if (!msg) return msg;
      const a = msg.attachments?.[0];
      if (a) {
        if (isImage(a)) return String(a.url);
        await bot.dm(uid, notImage);
      } else await bot.dm(uid, noText);
    }
  }

  const TIMEOUT_MSG = "⏰ انتهى الوقت المخصص للإجابة، يرجى إعادة المحاولة من البانل الأساسي.";
  const DM_CLOSED = "❌ ما قدرت أرسل لك في الخاص — افتح الخاص (الرسائل المباشرة) وحاول مرة ثانية.";

  // ─────────── تسجيل مركبة ───────────
  async function registerFlow(ctx: Ctx, initial: { name: string; age: string; id_num: string; v_name: string; v_company: string }) {
    const uid = ctx.user.id;
    const gid = ctx.guildId!;
    const sid = startSession(uid);
    try {
      const first = await bot.dm(uid,
        "🪧 **أدخل رقم اللوحة المرورية المطلوبة:**\n• يجب أن تكون بالصيغة الصحيحة وتحتوي على شرطة (-) وأرقام.\n• أمثلة صحيحة: `ABM-123` أو `أبج-1234`");
      if (!first) return void (await ctx.followup(DM_CLOSED, true).catch(() => undefined));

      let plate = "";
      for (;;) {
        const msg = await waitDm(uid, sid);
        if (msg === false) return;
        if (msg === null) return void (await bot.dm(uid, TIMEOUT_MSG));
        const content = String(msg.content ?? "").trim();
        if (PLATE_REGEX.test(content)) {
          plate = content;
          break;
        }
        await bot.dm(uid, "❌ **الصيغة غير صحيحة!** يرجى كتابة اللوحة بالصيغة المطلوبة (مثال: `ABM-123` أو `XYZ-987`):");
      }

      await bot.dm(uid, "🎨 أرسل الآن **لون المركبة**:");
      const colorMsg = await waitDm(uid, sid);
      if (colorMsg === false) return;
      if (colorMsg === null) return void (await bot.dm(uid, TIMEOUT_MSG));
      const color = String(colorMsg.content ?? "");

      await bot.dm(uid, "🖼️ أرسل الآن **صورة للمركبة** (يجب إرفاق ملف صورة حصراً، النصوص غير مقبولة):");
      const image = await askImage(uid, sid, "❌ الملف المرسل ليس صورة! يرجى إرفاق صورة صحيحة (PNG, JPG):", "❌ ممنوع إرسال نصوص هنا! يرجى **إرفاق صورة** للمركبة:");
      if (image === false) return;
      if (image === null) return void (await bot.dm(uid, TIMEOUT_MSG));

      const total = PLATE_FEE + REGISTRATION_FEE;
      if (!deductMoney(uid, gid, total)) {
        await bot.dm(uid,
          `❌ **فشلت عملية التسجيل:** رصيدك البنكي لا يكفي لدفع إجمالي الرسوم (\`${total}\` ريال: ${PLATE_FEE} لوحة + ${REGISTRATION_FEE} تسجيلاً) أو أنك غير مسجل في البنك.`);
        return;
      }

      const vehicle: Vehicle = {
        real_name: initial.name, age: initial.age, id_num: initial.id_num, name: initial.v_name, company: initial.v_company,
        plate, color, image, insured: false,
      };
      const data = dataStore.get();
      if (!Array.isArray(data[uid])) data[uid] = [];
      data[uid]!.push(vehicle);
      dataStore.save(data);

      await bot.dm(uid, `✅ تم خصم إجمالي الرسوم (\`${total}\` ريال) بنجاح، واستخراج اللوحة (\`${plate}\`) وتسجيل المركبة في النظام بشكل دائم!`);

      const ch = logChannel(gid, "log_channel");
      if (ch) {
        await bot.trySend(ch, { embeds: [embed({
          title: "🚗 تسجيل مركبة واستخراج لوحة جديد (مدفوع)", color: C.green, now: false, image,
          fields: [
            field("صاحب المركبة", `${mention.user(uid)} (\`${uid}\`)`, false),
            field("الاسم الحقيقي والعمر", `${initial.name} (العمر: ${initial.age})`),
            field("رقم الهوية", initial.id_num),
            field("المركبة والشركة", `${initial.v_company} ${initial.v_name}`),
            field("رقم اللوحة المستخرجة", `\`${plate}\``),
            field("اللون", color),
            field("الرسوم المدفوعة", `لوحة (${PLATE_FEE}) + تسجيلاً (${REGISTRATION_FEE}) = \`${total} ريال\``, false),
          ],
        })] });
      }
    } finally {
      endSession(uid, sid);
    }
  }

  // ─────────── التأمين ───────────
  async function insuranceFlow(ctx: Ctx, index: number, selected: Vehicle) {
    const uid = ctx.user.id;
    const gid = ctx.guildId!;
    const sid = startSession(uid);
    try {
      const roleName = selected.real_name ?? "غير متوفر";
      const roleAge = selected.age ?? "غير متوفر";
      const company = selected.company ?? "غير متوفر";
      const model = selected.name ?? "غير متوفر";
      const color = selected.color ?? "غير متوفر";
      const plate = selected.plate ?? "غير متوفر";

      const first = await bot.dm(uid,
        `🛡️ **استكمال تأمين المركبة المختارة:**\n• الشركة والنوع: \`${company} ${model}\`\n• اللوحة: \`${plate}\`\n• اللون: \`${color}\`\n\n` +
        "🖼️ أرسل الآن **صورة للمركبة** (أو أعد إرسال صورتها لتأكيد التأمين):");
      if (!first) return void (await ctx.followup(DM_CLOSED, true).catch(() => undefined));

      const image = await askImage(uid, sid, "❌ الملف المرسل ليس صورة! يرجى إرفاق صورة صحيحة:", "❌ ممنوع إرسال نصوص! يرجى **إرفاق صورة** للمركبة:");
      if (image === false) return;
      if (image === null) return void (await bot.dm(uid, TIMEOUT_MSG));

      // نرجع للبيانات الحالية (ممكن تغيّر الملف خلال الأسئلة)
      const data = dataStore.get();
      const list = Array.isArray(data[uid]) ? data[uid]! : [];
      const vehicle = list[index]?.plate === selected.plate ? list[index] : list.find((v) => v.plate === selected.plate);
      if (!vehicle) return void (await bot.dm(uid, "❌ حدث خطأ، المركبة غير موجودة."));

      if (!deductMoney(uid, gid, INSURANCE_FEE)) {
        await bot.dm(uid, `❌ **فشلت عملية إصدار التأمين:** رصيدك البنكي لا يكفي لدفع رسوم التأمين (\`${INSURANCE_FEE}\` ريال).`);
        return;
      }

      const expiry = Date.now() + 7 * 86400_000;
      vehicle.insured = true;
      vehicle.insurance_expiry = utcIso(new Date(expiry));
      vehicle.expired_notified = false;
      if (image) vehicle.image = image;
      dataStore.save(data);

      await bot.dm(uid, `✅ تم خصم رسوم التأمين (\`${INSURANCE_FEE}\` ريال) بنجاح وإصدار التأمين لمدة **أسبوع (7 أيام)** للمركبة ذات اللوحة (\`${plate}\`)!`);

      const logCh = logChannel(gid, "log_channel");
      if (logCh) {
        await bot.trySend(logCh, { embeds: [embed({
          title: "🛡️ إصدار تأمين مركبة جديد", color: C.purple, now: false, image,
          fields: [
            field("صاحب التأمين", `${mention.user(uid)} (\`${uid}\`)`, false),
            field("الاسم والعمر", `${roleName} (العمر: ${roleAge})`),
            field("المركبة والشركة", `${company} ${model}`),
            field("اللون", color),
            field("رقم اللوحة", `\`${plate}\``),
            field("تاريخ الانتهاء", ymd(expiry, true), false),
          ],
        })] });
      }
      const insCh = logChannel(gid, "insured_channel");
      if (insCh) {
        await bot.trySend(insCh, { embeds: [embed({
          title: "🚙 مركبة مؤمنة جديدة", color: C.green, now: false, image,
          fields: [
            field("المواطن", mention.user(uid), false),
            field("نوع المركبة والشركة", `${company} ${model}`),
            field("اللون", color),
            field("رقم اللوحة", `\`${plate}\``),
            field("صلاحية التأمين", `تنتهي في: ${ymd(expiry)}`, false),
          ],
        })] });
      }
    } finally {
      endSession(uid, sid);
    }
  }

  // ─────────── البانل الرئيسي (custom_id دائم) ───────────
  const MAIN_OPTIONS = [
    { label: "تسجيل مركبة ولوحة", description: "تسجيل مركبة جديدة واستخراج لوحة رسمية مرورية", emoji: "🚗", value: "register_vehicle" },
    { label: "شراء تأمين", description: "إصدار تأمين لمدة أسبوع للمركبة المختارة", emoji: "🛡️", value: "buy_insurance" },
    { label: "عرض مركباتي", description: "استعراض تفاصيل مركباتك وحالة التأمين واللوحة", emoji: "📋", value: "view_vehicles" },
    { label: "سحب تأمين (للأدمن)", description: "سحب تأمين مركبة لمواطن وإشعاره بالخاص", emoji: "🚫", value: "revoke_insurance" },
  ];
  const mainPanel = () => row(select("vehicle_main_select_menu", MAIN_OPTIONS, { placeholder: "اختر الخدمة المطلوبة من القائمة...", min: 1, max: 1 }));
  /** يرجّع القائمة لوضعها الافتراضي عشان تقدر تختار نفس الخيار مرة ثانية. */
  const resetPanel = (ctx: Ctx) => {
    if (ctx.message?.id) bot.edit(ctx.channelId, ctx.message.id, { components: [mainPanel()] }).catch(() => undefined);
  };

  bot.component("vehicle_main_select_menu", async (ctx) => {
    const choice = ctx.values[0];
    const uid = ctx.user.id;
    try {
      if (choice === "register_vehicle") {
        if (vehiclesOf(uid).length >= MAX_VEHICLES) return await ctx.reply("❌ عذراً، لقد وصلت للحد الأقصى (3 مركبات).", true);
        return await ctx.showModal(modal("vehicle:register", "تسجيل مركبة واستخراج لوحة", [
          input("real_name", "1. اسمك الحقيقي", { placeholder: "اكتب اسمك الحقيقي هنا..." }),
          input("real_age", "2. عمرك الحقيقي", { placeholder: "اكتب عمرك هنا..." }),
          input("id_number", "3. رقم الهوية", { placeholder: "اكتب رقم الهوية هنا..." }),
          input("vehicle_name", "4. اسم المركبة", { placeholder: "مثال: كامري، تشارجر..." }),
          input("vehicle_company", "5. شركة المركبة", { placeholder: "مثال: تويوتا، دودج..." }),
        ]));
      }
      if (choice === "buy_insurance") {
        const list = vehiclesOf(uid);
        if (!list.length) return await ctx.reply("❌ ليس لديك أي مركبات مسجلة لتأمينها! يرجى تسجيل مركبة أولاً.", true);
        return await ctx.reply({
          content: "🛡️ **اختر من القائمة أدناه المركبة التي تريد إصدار تأمين لها:**",
          components: [row(select("vehicle:insure", vehicleOptions(list), { placeholder: "اختر المركبة المراد تأمينها...", min: 1, max: 1 }))],
        }, true);
      }
      if (choice === "view_vehicles") {
        const list = vehiclesOf(uid);
        if (!list.length) return await ctx.reply("❌ ليس لديك أي مركبات مسجلة في النظام حالياً.", true);
        return await ctx.reply({
          content: "📋 **اختر من القائمة أدناه المركبة التي تريد عرض تفاصيلها:**",
          components: [row(select("vehicle:view", vehicleOptions(list), { placeholder: "اختر المركبة التي تريد عرض تفاصيلها...", min: 1, max: 1 }))],
        }, true);
      }
      if (choice === "revoke_insurance") {
        if (!ctx.isAdmin) return await ctx.reply("❌ عذراً، خيار سحب التأمين مخصص للأدمستريتر (Administrator) فقط!", true);
        const found: { uid: string; idx: number; v: Vehicle }[] = [];
        outer: for (const [u, list] of Object.entries(dataStore.get())) {
          if (!Array.isArray(list)) continue;
          for (let i = 0; i < list.length; i++) {
            if (!list[i]?.insured) continue;
            found.push({ uid: u, idx: i, v: list[i]! });
            if (found.length >= 25) break outer; // أقصى حد لعناصر القائمة في ديسكورد
          }
        }
        if (!found.length) return await ctx.reply("❌ لا توجد أي مركبات مؤمنة حالياً لسحب التأمين عنها!", true);
        await ctx.defer(true);
        const names = new Map<string, string>();
        for (const f of found) {
          if (names.has(f.uid)) continue;
          const m = await bot.member(ctx.guildId!, f.uid).catch(() => null);
          names.set(f.uid, m ? bot.name(m) : `مواطن (${f.uid})`);
        }
        const options = found.map((f) => ({
          label: `${names.get(f.uid)} - ${f.v.company ?? ""} ${f.v.name ?? ""}`, description: `اللوحة: ${f.v.plate ?? ""} | الآيدي: ${f.uid}`,
          value: `${f.uid}_${f.idx}`, emoji: "🛡️",
        }));
        return await ctx.edit({
          content: "🚫 **لوحة سحب التأمين الإدارية:**\nاختر المركبة المراد سحب التأمين عنها من القائمة أدناه:",
          components: [row(select("vehicle:revoke", options, { placeholder: "اختر المركبة المؤمنة لسحب التأمين عنها...", min: 1, max: 1 }))],
        });
      }
      await ctx.deferUpdate();
    } finally {
      resetPanel(ctx);
    }
  });

  bot.modal("vehicle:register", async (ctx) => {
    const f = (k: string) => ctx.fields.get(k) ?? "";
    const initial = { name: f("real_name"), age: f("real_age"), id_num: f("id_number"), v_name: f("vehicle_name"), v_company: f("vehicle_company") };
    await ctx.reply(
      `✅ تم استلام المعلومات الأساسية!\n📌 سيتم إكمال إجراءات استخراج اللوحة (رسومها \`${PLATE_FEE}\` ريال) وتسجيل المركبة (رسومها \`${REGISTRATION_FEE}\` ريال) عبر الخاص (DM).`,
      true,
    );
    await registerFlow(ctx, initial);
  });

  bot.component("vehicle:insure", async (ctx) => {
    const idx = Number(ctx.values[0]);
    const v = vehiclesOf(ctx.user.id)[idx];
    if (!v) return ctx.reply("❌ حدث خطأ، المركبة غير موجودة.", true);
    await ctx.reply(`✅ تم اختيار المركبة (\`${v.plate}\`). تابع الخطوات في الخاص (DM).`, true);
    await insuranceFlow(ctx, idx, { ...v });
  });

  bot.component("vehicle:view", async (ctx) => {
    const v = vehiclesOf(ctx.user.id)[Number(ctx.values[0])];
    if (!v) return ctx.reply("❌ حدث خطأ، المركبة غير موجودة.", true);
    let status = "❌ غير مؤمنة";
    if (v.insured) {
      const exp = parseUtc(v.insurance_expiry);
      if (Number.isFinite(exp)) status = Date.now() < exp ? `✅ مؤمنة (تنتهي في: ${ymd(exp)})` : "⚠️ انتهى التأمين";
    }
    await ctx.reply({ embeds: [embed({
      title: `🚙 تفاصيل المركبة: ${v.company ?? ""} ${v.name ?? ""}`, color: C.blue, now: false, image: v.image || null,
      fields: [
        field("الشركة والنوع", `${v.company ?? "غير متوفر"} ${v.name ?? "غير متوفر"}`),
        field("رقم اللوحة", `\`${v.plate ?? "بدون لوحة"}\``),
        field("اللون", v.color ?? "غير متوفر"),
        field("حالة التأمين", status, false),
        field("الاسم الحقيقي والعمر", `${v.real_name ?? "غير متوفر"} (العمر: ${v.age ?? "غير متوفر"})`, false),
        field("رقم الهوية", v.id_num ?? "غير متوفر"),
      ],
    })] }, true);
  });

  bot.component("vehicle:revoke", async (ctx) => {
    if (!ctx.isAdmin) return ctx.fail("❌ عذراً، هذا الخيار مخصص للأدمستريتر (Administrator) فقط!");
    const raw = ctx.values[0] ?? "";
    const cut = raw.lastIndexOf("_");
    const uid = raw.slice(0, cut);
    const idx = Number(raw.slice(cut + 1));
    const data = dataStore.get();
    const list = Array.isArray(data[uid]) ? data[uid]! : [];
    const vehicle = list[idx];
    if (!vehicle) return ctx.fail("❌ حدث خطأ، المركبة غير موجودة أو تم حذفها مسبقاً.");
    if (!vehicle.insured) return ctx.fail("❌ هذه المركبة ليست مؤمنة أساساً!");

    vehicle.insured = false;
    vehicle.insurance_expiry = null;
    vehicle.expired_notified = false;
    dataStore.save(data);

    const plate = vehicle.plate ?? "غير معروف";
    const gid = ctx.guildId!;
    const gname = bot.guild(gid)?.name ?? "";
    await bot.dm(uid, `⚠️ **تنبيه سحب التأمين:**\nعزيزي المواطن، تم سحب تأمين مركبتك (لوحة: \`${plate}\`) رسمياً في سيرفر **${gname}** من قِبل الإدارة.`);

    const ch = logChannel(gid, "log_channel");
    if (ch) {
      const e: Embed = embed({
        title: "🚫 سحب تأمين مركبة إدارياً", color: C.darkRed,
        description: `قام الإداري ${mention.user(ctx.user.id)} بسحب تأمين المركبة الخاصة بالمواطن ${mention.user(uid)} ذات اللوحة (\`${plate}\`).`,
        footer: { text: `معرف المواطن: ${uid}` },
      });
      await bot.trySend(ch, { embeds: [e] });
    }
    await ctx.update({ content: `✅ تم سحب التأمين عن مركبة المواطن ${mention.user(uid)} (لوحة: \`${plate}\`) بنجاح وتم إشعاره بالخاص!`, components: [] });
  });

  // ─────────── تنبيه انتهاء التأمين (كل 30 دقيقة) ───────────
  async function checkExpiry() {
    const t = Date.now();
    const data = dataStore.get();
    const due: [string, Vehicle][] = [];
    for (const [uid, list] of Object.entries(data)) {
      if (!Array.isArray(list)) continue;
      for (const v of list) {
        if (!v?.insured || v.expired_notified) continue;
        const exp = parseUtc(v.insurance_expiry);
        if (!Number.isFinite(exp) || t < exp) continue;
        v.expired_notified = true;
        due.push([uid, v]);
      }
    }
    if (!due.length) return;
    dataStore.save(data);
    for (const [uid, v] of due) {
      await bot.dm(uid, `⚠️ **تنبيه انتهاء التأمين:** لقد انتهت صلاحية تأمين مركبتك (لوحة: \`${v.plate ?? "غير معروف"}\`). يجب عليك إصدار تأمين جديد عبر البانل ✅`);
    }
  }
  let running = false;
  const tick = () => {
    if (!bot.ready || running) return;
    running = true;
    checkExpiry().catch((e) => log.err("vehicle", e)).finally(() => (running = false));
  };
  setInterval(tick, 30 * 60_000).unref();
  bot.on("ready", tick);

  // ─────────── الأوامر ───────────
  const ADMIN_ONLY = "❌ هذا الأمر مخصص للأدمستريتر (Administrator) فقط!";

  bot.command({
    name: "اعداد-المركبات", description: "إعداد نظام المركبات واللوحات وتحديد الرومات", perms: P.Administrator,
    options: [
      o.channel("روم_البانل", "روم بانل تسجيل المركبات والتأمين"),
      o.channel("روم_اللوق", "روم لوق العمليات"),
      o.channel("روم_المركبات_المؤمنة", "روم المركبات المؤمنة الجديدة"),
    ],
    run: async (ctx) => {
      if (!ctx.isAdmin) return ctx.fail(ADMIN_ONLY);
      const gid = ctx.guildId!;
      const panel = ctx.id("روم_البانل")!;
      const logCh = ctx.id("روم_اللوق")!;
      const insured = ctx.id("روم_المركبات_المؤمنة")!;
      const cfg = configStore.get();
      cfg[gid] = { ...(cfg[gid] ?? {}), panel_channel: panel, log_channel: logCh, insured_channel: insured };
      configStore.save(cfg);
      try {
        await bot.send(panel, {
          embeds: [embed({
            title: "📌 نظام تسجيل المركبات واللوحات المرورية والتأمين", color: C.green, now: false,
            description: `استخدم القائمة أدناه لتسجيل مركبة واستخراج لوحتها الرسمية (رسوم اللوحة: **${PLATE_FEE} ريال** + رسوم التسجيل: **${REGISTRATION_FEE} ريال**) أو شراء تأمين للمركبة (رسوم: **${INSURANCE_FEE} ريال**) تُحول إلى إيبان \`${TARGET_IBAN}\`.`,
          })],
          components: [mainPanel()],
        });
      } catch {
        return ctx.fail(`ما قدرت أرسل البانل في ${mention.channel(panel)} — تأكد من صلاحيات البوت في الروم.`);
      }
      await ctx.reply(
        `✅ تم إعداد النظام بنجاح!\n- **روم البانل:** ${mention.channel(panel)}\n- **روم اللوق:** ${mention.channel(logCh)}\n- **روم المركبات المؤمنة:** ${mention.channel(insured)}`,
        true,
      );
    },
  });

  bot.command({
    name: "حذف-مركبة", description: "[إدارة] حذف مركبة معينة لمواطن باستخدام رقم اللوحة", perms: P.Administrator,
    options: [o.user("العضو", "العضو صاحب المركبة"), o.str("اللوحة", "رقم اللوحة المراد حذفها")],
    run: async (ctx) => {
      if (!ctx.isAdmin) return ctx.fail(ADMIN_ONLY);
      const uid = ctx.id("العضو")!;
      const plate = ctx.str("اللوحة") ?? "";
      const data = dataStore.get();
      const list = Array.isArray(data[uid]) ? data[uid]! : [];
      if (!list.length) return ctx.reply(`❌ العضو ${mention.user(uid)} ليس لديه أي مركبات مسجلة.`, true);
      const key = plate.trim().toLowerCase();
      const i = list.findIndex((v) => String(v.plate ?? "").trim().toLowerCase() === key);
      if (i < 0) return ctx.reply(`❌ لم يتم العثور على مركبة تحمل اللوحة (\`${plate}\`) لهذا العضو.`, true);
      list.splice(i, 1);
      dataStore.save(data);
      await ctx.reply(`✅ تم بنجاح حذف المركبة التي تحمل اللوحة (\`${plate}\`) الخاصة بالمواطن ${mention.user(uid)}.`, true);
    },
  });
}

/** للاختبارات. */
export const _test = { PLATE_REGEX, utcIso, parseUtc, ymd, dataStore, configStore };
