/** تعريف أوامر السلاش + تسجيلها (فقط لو تغيرت). */
import { createHash } from "node:crypto";
import type { RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10";
import type { MoodApp } from "./app.ts";
import { OptionType } from "./discord/constants.ts";
import { bi } from "./i18n.ts";

/** تشتغل في السيرفرات والخاص، وتنفع تثبيت سيرفر أو تثبيت مستخدم. */
const everywhere = { integration_types: [0, 1], contexts: [0, 1, 2] };

const userOpt = (description = bi("(للمالك) الشخص", "(owner) person")) => ({ type: OptionType.User, name: "user", description, required: false });

const periodOpt = {
  type: OptionType.Integer,
  name: "period",
  description: bi("الفترة", "Period"),
  required: false,
  choices: [
    { name: "أسبوع · Week", value: 7 },
    { name: "شهر · Month", value: 30 },
    { name: "3 شهور · 3 months", value: 90 },
    { name: "سنة · Year", value: 365 },
  ],
};

export const COMMANDS = [
  { name: "checkin", description: bi("سجّل مزاجك الحين", "Log your mood now"), options: [userOpt(bi("(للمالك) أرسل السؤال لهالشخص", "(owner) send to this person"))] },
  { name: "report", description: bi("تقرير المزاج بالرسوم والنصائح", "Mood report with charts & tips"), options: [periodOpt, userOpt()] },
  { name: "insights", description: bi("وش يرفع مزاجك ووش ينزله؟", "What lifts or lowers your mood?"), options: [userOpt()] },
  {
    name: "history",
    description: bi("آخر الأيام باختصار", "Recent days at a glance"),
    options: [{ type: OptionType.Integer, name: "days", description: bi("كم يوم (افتراضي 7)", "How many days (default 7)"), required: false, min_value: 1, max_value: 60 }, userOpt()],
  },
  { name: "achievements", description: bi("إنجازاتك وسلسلتك 🔥", "Achievements & streak 🔥"), options: [userOpt()] },
  {
    name: "talk",
    description: bi("دردش مع مود 🤖", "Chat with Mood 🤖"),
    options: [
      { type: OptionType.String, name: "message", description: bi("رسالتك", "Your message"), required: false, max_length: 1500 },
      { type: OptionType.Boolean, name: "reset", description: bi("امسح ذاكرة الدردشة", "Clear chat memory"), required: false },
    ],
  },
  {
    name: "settings",
    description: bi("إعداداتك: الوقت، المنطقة، التذكير، الإجازة", "Your settings: time, zone, reminder, vacation"),
    options: [
      { type: OptionType.Subcommand, name: "show", description: bi("اعرض إعداداتك", "Show your settings"), options: [userOpt()] },
      {
        type: OptionType.Subcommand, name: "time", description: bi("وقت السؤال اليومي", "Daily check-in time"),
        options: [{ type: OptionType.String, name: "value", description: bi("مثل 14:30", "e.g. 14:30"), required: true, max_length: 5 }, userOpt()],
      },
      {
        type: OptionType.Subcommand, name: "timezone", description: bi("المنطقة الزمنية", "Time zone"),
        options: [{ type: OptionType.String, name: "value", description: bi("مثل Asia/Riyadh", "e.g. Europe/London"), required: true, autocomplete: true }, userOpt()],
      },
      {
        type: OptionType.Subcommand, name: "reminder", description: bi("تذكير لو ما رديت", "Reminder if you don't answer"),
        options: [{ type: OptionType.Integer, name: "hours", description: bi("بعد كم ساعة (0 = بدون)", "After how many hours (0 = off)"), required: true, min_value: 0, max_value: 12 }, userOpt()],
      },
      {
        type: OptionType.Subcommand, name: "pause", description: bi("إجازة: وقف السؤال كم يوم", "Vacation: pause check-ins"),
        options: [{ type: OptionType.Integer, name: "days", description: bi("عدد الأيام", "Number of days"), required: true, min_value: 1, max_value: 60 }, userOpt()],
      },
      { type: OptionType.Subcommand, name: "resume", description: bi("رجّع السؤال اليومي", "Resume daily check-ins"), options: [userOpt()] },
    ],
  },
  {
    name: "export",
    description: bi("نزّل بياناتك", "Download your data"),
    options: [
      { type: OptionType.String, name: "format", description: bi("الصيغة", "Format"), required: false, choices: [{ name: "CSV (Excel)", value: "csv" }, { name: "JSON", value: "json" }] },
      userOpt(),
    ],
  },
  {
    name: "language",
    description: bi("غيّر لغة البوت", "Change the bot language"),
    options: [
      { type: OptionType.String, name: "language", description: bi("اللغة", "Language"), required: true, choices: [{ name: "العربية 🇸🇦", value: "ar" }, { name: "English 🇬🇧", value: "en" }] },
      userOpt(),
    ],
  },
  { name: "forget", description: bi("احذف كل بياناتك نهائياً", "Delete all your data") },
  { name: "help", description: bi("وش يقدر يسوي البوت؟", "What can this bot do?") },
  {
    name: "admin",
    description: bi("لوحة المالك", "Owner panel"),
    options: [
      { type: OptionType.Subcommand, name: "overview", description: bi("نظرة عامة", "Overview") },
      { type: OptionType.Subcommand, name: "checkin", description: bi("أرسل السؤال الحين", "Send check-in now"), options: [{ ...userOpt(bi("الشخص", "Person")), required: true }] },
      { type: OptionType.Subcommand, name: "backup", description: bi("نسخة احتياطية الحين", "Back up now") },
    ],
  },
].map((c) => ({ ...c, ...everywhere })) as unknown as RESTPostAPIApplicationCommandsJSONBody[];

export async function registerCommands(app: MoodApp, force = false): Promise<void> {
  const hash = createHash("sha256").update(app.discord.applicationId + JSON.stringify(COMMANDS)).digest("hex").slice(0, 16);
  if (!force && (await app.db.getMeta("commands_hash")) === hash) {
    app.log.info(`\x1b[32m✓\x1b[0m commands  ${COMMANDS.length} up to date`);
    return;
  }
  await app.discord.setGlobalCommands(COMMANDS);
  await app.db.setMeta("commands_hash", hash);
  app.log.info(`\x1b[32m✓\x1b[0m commands  ${COMMANDS.length} slash commands registered`);
}
