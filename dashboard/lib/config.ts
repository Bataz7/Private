/** إعدادات لوحة التحكم من البيئة / .env (يقرأها src/core/config.ts تلقائياً) — لا أسرار في الكود. */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config as core, env, ROOT } from "../../src/core/config.ts";

const flag = (k: string, d: string) => !["0", "false", "no", "off", ""].includes((env(k, d) || "").trim().toLowerCase());

let base = env("DASHBOARD_URL").trim().replace(/\/+$/, "");
if (base && !base.includes("://")) base = "https://" + base;

/** مفتاح الجلسات: من البيئة، وإلا يُولَّد مرة وحدة ويُحفظ في .session_secret (نفس سلوك النسخة القديمة). */
function sessionSecret(): string {
  const e = env("SESSION_SECRET").trim();
  if (e) return e;
  const f = join(ROOT, ".session_secret");
  try {
    const saved = readFileSync(f, "utf8").trim();
    if (saved) return saved;
  } catch {}
  const key = randomBytes(48).toString("base64url");
  try {
    writeFileSync(f, key, { mode: 0o600 });
  } catch {}
  return key;
}

/** آيدي البوت من أول جزء في التوكن (base64)، وإلا آيدي التطبيق. */
function botIdFromToken(token: string, fallback: string): string {
  try {
    const id = Buffer.from(token.split(".")[0] ?? "", "base64").toString("utf8");
    if (/^\d{15,21}$/.test(id)) return id;
  } catch {}
  return fallback;
}

const CLIENT_ID = env("DISCORD_CLIENT_ID", "1549657352385597491").trim();

export const cfg = {
  ROOT,
  WEB_DIR: join(ROOT, "web"),
  EMOJI_DIR: core.EMOJI_DIR,
  CLIENT_ID,
  CLIENT_SECRET: env("DISCORD_CLIENT_SECRET").trim(),
  BOT_TOKEN: core.TOKEN,
  BOT_ID: botIdFromToken(core.TOKEN, CLIENT_ID),
  BASE_URL: base,
  FORCE_HTTPS: flag("FORCE_HTTPS", "1"),
  PORT: Number.parseInt(env("DASHBOARD_PORT", env("SERVER_PORT", "8080")), 10) || 8080,
  HOST: env("DASHBOARD_HOST", "0.0.0.0"),
  SSL_CERTFILE: env("SSL_CERTFILE").trim(),
  SSL_KEYFILE: env("SSL_KEYFILE").trim(),
  FORWARDED_ALLOW_IPS: env("FORWARDED_ALLOW_IPS", "*").split(",").map((s) => s.trim()).filter(Boolean),
  SUPPORT_URL: env("SUPPORT_URL", "https://discord.gg/ZHpPtZZsZv"),
  SESSION_SECRET: sessionSecret(),
  /** عمر الجلسة بالثواني (يوم، مثل النسخة القديمة). */
  SESSION_MAX_AGE: 86400,
  /** للاختبار فقط (خادم وهمي)؛ الافتراضي واجهة ديسكورد الرسمية. */
  API: env("DISCORD_API_BASE", "https://discord.com/api/v10").replace(/\/+$/, ""),
};

export const hasEmojiDir = () => existsSync(cfg.EMOJI_DIR);
