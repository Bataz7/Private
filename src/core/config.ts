/** الإعدادات من متغيرات البيئة أو ملف .env (Bun يقرأ .env تلقائياً) — لا أسرار في الكود. */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** مجلد المشروع: جنب الملف التنفيذي لو مبني (compile)، وإلا مجلد المشروع. */
function findRoot(): string {
  const candidates = [process.cwd(), dirname(process.execPath), resolve(import.meta.dir, "../..")];
  return candidates.find((d) => existsSync(join(d, "emojis")) || existsSync(join(d, ".env"))) ?? process.cwd();
}

export const ROOT = findRoot();

// قارئ .env احتياطي (لو البوت اشتغل من مجلد ثاني أو كملف تنفيذي)
try {
  for (const line of readFileSync(join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([\w.]+)\s*=\s*(.*)$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    let v = m[2]!.trim();
    if (/^["'`]/.test(v) && v.indexOf(v[0]!, 1) > 0) v = v.slice(1, v.indexOf(v[0]!, 1));
    else v = v.split(/\s#/)[0]!.trim();
    if (v && !process.env[m[1]!]) process.env[m[1]!] = v;
  }
} catch {}

export const env = (k: string, d = "") => process.env[k] ?? d;
export const envInt = (k: string, d = 0) => {
  const n = Number.parseInt(env(k), 10);
  return Number.isFinite(n) ? n : d;
};
const flag = (k: string, d: boolean) => (env(k) ? !/^(0|false|no|off)$/i.test(env(k)) : d);

export function cleanToken(raw: string): string {
  let t = raw.replace(/\s+/g, "").replace(/^["'`]|["'`]$/g, "");
  if (/^bot/i.test(t)) t = t.slice(3);
  return t;
}

export function tokenProblem(t: string): string {
  if (!t) return "missing — set DISCORD_TOKEN in .env or in the host's environment variables";
  const dots = t.split(".").length - 1;
  if (dots !== 2) {
    if (t.length === 32 || t.length === 64) return `this is ${t.length} chars: a Client Secret / Public Key, not the bot token (Bot → Reset Token)`;
    return `not a bot token (found ${dots} dots, a bot token has 2). Use Bot → Reset Token → Copy`;
  }
  if (t.length < 50 || t.length > 100) return `wrong length (${t.length} chars, expected ~70) — reset it and copy once`;
  return "";
}

export const config = {
  TOKEN: cleanToken(env("DISCORD_TOKEN")),
  DATA_DIR: resolve(ROOT, env("DATA_DIR") || "data"),
  EMOJI_DIR: join(ROOT, "emojis"),
  OWNER_IDS: new Set(env("OWNER_IDS").split(",").map((s) => s.trim()).filter((s) => /^\d+$/.test(s))),
  OWNER_GUILD_ID: env("OWNER_GUILD_ID"),
  OWNER_LOG_CHANNEL_ID: env("OWNER_LOG_CHANNEL_ID"),
  OWNER_STATS_CHANNEL_ID: env("OWNER_STATS_CHANNEL_ID"),
  AUTO_EMOJIS: flag("AUTO_EMOJIS", true),
  /** حجم كاش الرسائل (للوق الحذف والتعديل). */
  MESSAGE_CACHE: envInt("MESSAGE_CACHE", 400),
  /** حجم كاش الأعضاء. */
  MEMBER_CACHE: envInt("MEMBER_CACHE", 3000),
};

mkdirSync(config.DATA_DIR, { recursive: true });
