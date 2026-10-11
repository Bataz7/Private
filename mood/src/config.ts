/** الإعدادات: تنقرأ من .env ومن متغيرات البيئة، وتتحقق منها قبل التشغيل. */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { isLang, type Lang } from "./i18n.ts";
import { isValidTimeZone, parseHHMM, parseWeekday } from "./time.ts";

export type AIProvider = "openrouter" | "openai" | "anthropic" | "none";

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
  defaultLang: Lang;
  aiProvider: AIProvider;
  aiKey: string;
  aiModel: string;
  aiBaseUrl: string;
  aiChat: boolean;
  appUrl: string;
  appName: string;
  databaseUrl: string;
  dataDir: string;
  backupKeep: number;
  logLevel: string;
  /** رسالة الأمان المخصصة (لو فاضية نستخدم الافتراضية حسب اللغة) */
  safetyMessage: string;
  statusText: string;
  /** للاختبارات فقط: سيرفر ديسكورد وهمي */
  apiUrl?: string;
  gatewayUrl?: string;
}

export class ConfigError extends Error {}

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

  const defaultLang = (env.DEFAULT_LANG || "ar").trim().toLowerCase();
  if (!isLang(defaultLang)) throw new ConfigError("DEFAULT_LANG: لازم ar أو en");

  const ai = resolveAI(env);

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
    defaultLang,
    ...ai,
    aiChat: bool(env.AI_CHAT, true),
    appUrl: env.APP_URL || "https://github.com/bataz7/private",
    appName: env.APP_NAME || "Mood Bot",
    databaseUrl: (env.DATABASE_URL ?? "").trim(),
    dataDir: resolve(env.DATA_DIR || "data"),
    backupKeep: num(env.BACKUP_KEEP, 14, "BACKUP_KEEP", 0, 365),
    logLevel: env.LOG_LEVEL || "info",
    safetyMessage: env.SAFETY_MESSAGE?.replace(/\\n/g, "\n") ?? "",
    statusText: env.STATUS_TEXT || "كيف كان يومك؟ 🌈",
    apiUrl: env.DISCORD_API_URL || undefined,
    gatewayUrl: env.DISCORD_GATEWAY_URL || undefined,
  };
}

const DEFAULT_MODELS: Record<Exclude<AIProvider, "none">, string> = {
  openrouter: "openai/gpt-4o",
  openai: "gpt-4o",
  anthropic: "claude-opus-5-5",
};
const BASE_URLS: Record<Exclude<AIProvider, "none">, string> = {
  openrouter: "https://openrouter.ai/api/v1",
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
};

/** يختار مزوّد الذكاء الاصطناعي: AI_PROVIDER، أو تلقائياً حسب المفتاح الموجود. */
function resolveAI(env: NodeJS.ProcessEnv): { aiProvider: AIProvider; aiKey: string; aiModel: string; aiBaseUrl: string } {
  const keys = {
    openrouter: (env.OPENROUTER_API_KEY ?? "").trim(),
    openai: (env.OPENAI_API_KEY ?? "").trim(),
    anthropic: (env.ANTHROPIC_API_KEY ?? "").trim(),
  };
  let provider = (env.AI_PROVIDER || "auto").trim().toLowerCase();
  if (provider === "auto") provider = keys.openrouter ? "openrouter" : keys.openai ? "openai" : keys.anthropic ? "anthropic" : "none";
  if (!["openrouter", "openai", "anthropic", "none"].includes(provider)) {
    throw new ConfigError("AI_PROVIDER: لازم openrouter أو openai أو anthropic أو none");
  }
  if (provider === "none") return { aiProvider: "none", aiKey: "", aiModel: "", aiBaseUrl: "" };
  const p = provider as Exclude<AIProvider, "none">;
  const key = keys[p] || (env.AI_API_KEY ?? "").trim();
  if (!key) return { aiProvider: "none", aiKey: "", aiModel: "", aiBaseUrl: "" };
  return { aiProvider: p, aiKey: key, aiModel: (env.AI_MODEL || DEFAULT_MODELS[p]).trim(), aiBaseUrl: (env.AI_BASE_URL || BASE_URLS[p]).replace(/\/+$/, "") };
}

/** المالك: اللي في OWNER_ID. لو فاضي والشخص واحد بس، هو المالك (عشان ما يشوف أحد بيانات غيره). */
export const isOwner = (c: Config, id: string) =>
  c.ownerIds.length ? c.ownerIds.includes(id) : c.targetIds.length === 1 && c.targetIds[0] === id;
export const isTarget = (c: Config, id: string) => c.targetIds.includes(id);
export const isAllowed = (c: Config, id: string) => isOwner(c, id) || isTarget(c, id);
