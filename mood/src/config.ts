/** الإعدادات: تنقرأ من .env ومن متغيرات البيئة، وتتحقق منها قبل التشغيل. */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { isValidTimeZone, parseHHMM, parseWeekday } from "./time.ts";

export interface Config {
  token: string;
  targetIds: string[];
  ownerIds: string[];
  timezone: string;
  checkinMinutes: number;
  reminderHours: number;
  weeklyReportDay: number;
  weeklyReportMinutes: number;
  monthlyReport: boolean;
  notifyOwner: boolean;
  alerts: boolean;
  lowMoodAlertDays: number;
  anthropicKey: string;
  aiModel: string;
  aiChat: boolean;
  dataDir: string;
  backupKeep: number;
  logLevel: string;
  safetyMessage: string;
  statusText: string;
  /** للاختبارات فقط: سيرفر ديسكورد وهمي */
  apiUrl?: string;
  gatewayUrl?: string;
}

export class ConfigError extends Error {}

const DEFAULT_SAFETY =
  "🫂 كلامك مهم، وأنت مهم. لو تحس إنك ممكن تأذي نفسك، تكفى لا تبقى لحالك:\n" +
  "• كلّم شخص تثق فيه الحين\n" +
  "• الطوارئ في السعودية: **911** (أو **997** للإسعاف)\n" +
  "• مركز اتصال وزارة الصحة: **937** (24 ساعة)\n" +
  "أنا هنا معك، وفيه ناس تبي تساعدك 💛";

const SNOWFLAKE = /^\d{15,21}$/;

function ids(raw: string | undefined, name: string): string[] {
  const list = (raw ?? "").split(/[,\s]+/).filter(Boolean);
  for (const id of list) if (!SNOWFLAKE.test(id)) throw new ConfigError(`${name}: "${id}" مو ID صحيح (لازم أرقام فقط)`);
  return [...new Set(list)];
}

function bool(raw: string | undefined, def: boolean): boolean {
  if (raw === undefined || raw === "") return def;
  return ["1", "true", "yes", "on", "نعم"].includes(raw.trim().toLowerCase());
}

function num(raw: string | undefined, def: number, name: string, min = 0, max = Infinity): number {
  if (raw === undefined || raw === "") return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) throw new ConfigError(`${name}: لازم رقم بين ${min} و ${max}`);
  return n;
}

function time(raw: string | undefined, def: string, name: string): number {
  const v = parseHHMM(raw || def);
  if (v === null) throw new ConfigError(`${name}: الوقت لازم يكون بصيغة HH:MM مثل 14:30`);
  return v;
}

/** يقرأ ملف .env (لو موجود) — المتغيرات الموجودة أصلاً لها الأولوية. */
export function loadEnvFile(path = resolve(process.cwd(), ".env")): void {
  if (existsSync(path)) process.loadEnvFile(path);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, { requireToken = true } = {}): Config {
  const token = (env.DISCORD_TOKEN ?? "").trim();
  if (requireToken && !token) throw new ConfigError("DISCORD_TOKEN فاضي — حط توكن البوت في ملف .env");

  const targetIds = ids(env.TARGET_USER_ID, "TARGET_USER_ID");
  if (requireToken && targetIds.length === 0) throw new ConfigError("TARGET_USER_ID فاضي — حط ID الشخص في ملف .env");

  const timezone = (env.TIMEZONE || "Asia/Riyadh").trim();
  if (!isValidTimeZone(timezone)) throw new ConfigError(`TIMEZONE: "${timezone}" منطقة زمنية غير معروفة (مثال: Asia/Riyadh)`);

  const weeklyReportDay = parseWeekday(env.WEEKLY_REPORT_DAY || "friday");
  if (weeklyReportDay === null) throw new ConfigError("WEEKLY_REPORT_DAY: اكتب اسم يوم مثل friday أو الجمعة");

  return {
    token,
    targetIds,
    ownerIds: ids(env.OWNER_ID, "OWNER_ID"),
    timezone,
    checkinMinutes: time(env.CHECKIN_TIME, "14:30", "CHECKIN_TIME"),
    reminderHours: num(env.REMINDER_AFTER_HOURS, 3, "REMINDER_AFTER_HOURS", 0, 12),
    weeklyReportDay,
    weeklyReportMinutes: time(env.WEEKLY_REPORT_TIME, "21:00", "WEEKLY_REPORT_TIME"),
    monthlyReport: bool(env.MONTHLY_REPORT, true),
    notifyOwner: bool(env.NOTIFY_OWNER, false),
    alerts: bool(env.ALERTS, true),
    lowMoodAlertDays: num(env.LOW_MOOD_ALERT_DAYS, 3, "LOW_MOOD_ALERT_DAYS", 2, 14),
    anthropicKey: (env.ANTHROPIC_API_KEY ?? "").trim(),
    aiModel: (env.AI_MODEL || "claude-opus-5-5").trim(),
    aiChat: bool(env.AI_CHAT, true),
    dataDir: resolve(env.DATA_DIR || "data"),
    backupKeep: num(env.BACKUP_KEEP, 14, "BACKUP_KEEP", 0, 365),
    logLevel: env.LOG_LEVEL || "info",
    safetyMessage: env.SAFETY_MESSAGE?.replace(/\\n/g, "\n") || DEFAULT_SAFETY,
    statusText: env.STATUS_TEXT || "كيف كان يومك؟ 🌈",
    apiUrl: env.DISCORD_API_URL || undefined,
    gatewayUrl: env.DISCORD_GATEWAY_URL || undefined,
  };
}

export const isOwner = (c: Config, id: string) => c.ownerIds.includes(id) || (c.ownerIds.length === 0 && c.targetIds.includes(id));
export const isTarget = (c: Config, id: string) => c.targetIds.includes(id);
export const isAllowed = (c: Config, id: string) => isOwner(c, id) || isTarget(c, id);
