/** تعريف أوامر السلاش + تسجيلها (فقط لو تغيرت). */
import { createHash } from "node:crypto";
import type { RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10";
import type { MoodApp } from "./app.ts";
import { OptionType } from "./discord/constants.ts";

/** تشتغل في السيرفرات والخاص، وتنفع تثبيت سيرفر أو تثبيت مستخدم. */
const everywhere = { integration_types: [0, 1], contexts: [0, 1, 2] };

const userOpt = (description = "(للمالك) الشخص") => ({ type: OptionType.User, name: "user", description, required: false });

const periodOpt = {
  type: OptionType.Integer,
  name: "period",
  description: "الفترة",
  required: false,
  choices: [
    { name: "أسبوع", value: 7 },
    { name: "شهر", value: 30 },
    { name: "3 شهور", value: 90 },
    { name: "سنة", value: 365 },
  ],
};

export const COMMANDS = [
  { name: "checkin", description: "سجّل مزاجك الحين (أو أرسل السؤال لشخص لو كنت المالك)", options: [userOpt("(للمالك) أرسل السؤال لهالشخص")] },
  { name: "report", description: "تقرير المزاج مع تحليل ونصائح وملف HTML بالرسوم", options: [periodOpt, userOpt()] },
  { name: "insights", description: "وش يرفع مزاجك ووش ينزله؟ (أنشطة، نوم، أيام الأسبوع)", options: [userOpt()] },
  {
    name: "history",
    description: "آخر الأيام باختصار",
    options: [{ type: OptionType.Integer, name: "days", description: "كم يوم (افتراضي 7)", required: false, min_value: 1, max_value: 60 }, userOpt()],
  },
  { name: "achievements", description: "إنجازاتك وسلسلة التسجيل 🔥", options: [userOpt()] },
  {
    name: "talk",
    description: "دردش مع مود (الذكاء الاصطناعي)",
    options: [
      { type: OptionType.String, name: "message", description: "رسالتك", required: false, max_length: 1500 },
      { type: OptionType.Boolean, name: "reset", description: "امسح ذاكرة الدردشة", required: false },
    ],
  },
  {
    name: "settings",
    description: "إعداداتك: وقت السؤال، المنطقة الزمنية، التذكير، الإجازة",
    options: [
      { type: OptionType.Subcommand, name: "show", description: "اعرض إعداداتك", options: [userOpt()] },
      {
        type: OptionType.Subcommand, name: "time", description: "وقت السؤال اليومي",
        options: [{ type: OptionType.String, name: "value", description: "مثل 14:30 (2:30 الظهر)", required: true, max_length: 5 }, userOpt()],
      },
      {
        type: OptionType.Subcommand, name: "timezone", description: "المنطقة الزمنية",
        options: [{ type: OptionType.String, name: "value", description: "مثل Asia/Riyadh", required: true, autocomplete: true }, userOpt()],
      },
      {
        type: OptionType.Subcommand, name: "reminder", description: "تذكير لو ما رديت",
        options: [{ type: OptionType.Integer, name: "hours", description: "بعد كم ساعة (0 = بدون تذكير)", required: true, min_value: 0, max_value: 12 }, userOpt()],
      },
      {
        type: OptionType.Subcommand, name: "pause", description: "إجازة: وقف السؤال اليومي كم يوم",
        options: [{ type: OptionType.Integer, name: "days", description: "عدد الأيام", required: true, min_value: 1, max_value: 60 }, userOpt()],
      },
      { type: OptionType.Subcommand, name: "resume", description: "رجّع السؤال اليومي", options: [userOpt()] },
    ],
  },
  {
    name: "export",
    description: "نزّل بياناتك",
    options: [
      { type: OptionType.String, name: "format", description: "الصيغة", required: false, choices: [{ name: "CSV (Excel)", value: "csv" }, { name: "JSON", value: "json" }] },
      userOpt(),
    ],
  },
  { name: "forget", description: "احذف كل بياناتك نهائياً" },
  { name: "help", description: "وش يقدر يسوي البوت؟" },
  {
    name: "admin",
    description: "لوحة المالك",
    options: [
      { type: OptionType.Subcommand, name: "overview", description: "نظرة عامة على الكل" },
      { type: OptionType.Subcommand, name: "checkin", description: "أرسل السؤال لشخص الحين", options: [{ ...userOpt("الشخص"), required: true }] },
      { type: OptionType.Subcommand, name: "backup", description: "سو نسخة احتياطية الحين" },
    ],
  },
].map((c) => ({ ...c, ...everywhere })) as unknown as RESTPostAPIApplicationCommandsJSONBody[];

export async function registerCommands(app: MoodApp, force = false): Promise<void> {
  const hash = createHash("sha256").update(app.discord.applicationId + JSON.stringify(COMMANDS)).digest("hex").slice(0, 16);
  if (!force && app.db.getMeta("commands_hash") === hash) {
    app.log.debug("commands unchanged");
    return;
  }
  await app.discord.setGlobalCommands(COMMANDS);
  app.db.setMeta("commands_hash", hash);
  app.log.info(`registered ${COMMANDS.length} slash commands`);
}
