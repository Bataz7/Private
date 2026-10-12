/**
 * العقارات — قاعدة البيانات (real_estate.db)، الإعدادات، السجلات، والتعامل مع رصيد البنك (bank.db).
 *
 * ملاحظة: الإعدادات والعقارات عامة (بدون guild_id) تماماً مثل نسخة البايثون.
 */
import type { Bot } from "../../discord/client.ts";
import { db } from "../../core/db.ts";
import { log } from "../../core/log.ts";
import { embed } from "../../core/ui.ts";

export const sql = db("real_estate.db");

sql.exec(`
CREATE TABLE IF NOT EXISTS properties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    property_id TEXT UNIQUE,
    name TEXT,
    category TEXT,
    location TEXT,
    price INTEGER,
    profit_amount INTEGER DEFAULT 0,
    status TEXT DEFAULT 'متاح',
    description TEXT,
    owner_id INTEGER DEFAULT 0,
    last_claimed_timestamp TEXT DEFAULT NULL
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    channel_id INTEGER
);
`);
sql.addColumn("properties", "profit_amount", "INTEGER DEFAULT 0");
sql.addColumn("properties", "last_claimed_timestamp", "TEXT DEFAULT NULL");

/** ألوان discord.py الافتراضية المستخدمة في الكوج الأصلي. */
export const C = { blue: 0x3498db, green: 0x2ecc71, gold: 0xf1c40f, orange: 0xe67e22, red: 0xe74c3c, purple: 0x9b59b6, dark: 0x2b2d31 } as const;

export const CATEGORIES = ["فلل", "شقق", "مكاتب", "استراحات", "محلات"];
export const SHOP = "محلات";

export interface Prop {
  id: number; property_id: string; name: string | null; category: string | null; location: string | null; price: number | string | null;
  profit_amount: number | string | null; status: string | null; description: string | null; owner_id: number | string | null;
  last_claimed_timestamp: string | null;
}

export type SettingKey = "requests_channel" | "market_channel" | "logs_channel" | "citizen_channel" | "admin_channel" | "admin_panel_msg" | "citizen_panel_msg";

export function getSetting(key: SettingKey): string | null {
  const v = sql.value<string | number | null>("SELECT channel_id FROM settings WHERE key = ?", key);
  return v ? String(v) : null;
}
export function setSetting(key: SettingKey, id: string): void {
  sql.run("INSERT OR REPLACE INTO settings (key, channel_id) VALUES (?, ?)", key, id);
}

/** روم من الإعدادات بشرط إنه موجود في نفس السيرفر (مثل guild.get_channel). */
export function guildChannel(bot: Bot, gid: string | undefined, key: SettingKey): string | null {
  const id = getSetting(key);
  if (!id || !gid || bot.guildOfChannel(id) !== gid) return null;
  return id;
}

/** صيغة {:,} من بايثون — تدعم الأرقام الكبيرة اللي ترجع نص. */
export function money(v: unknown): string {
  if (typeof v === "string" && /^-?\d+$/.test(v)) return BigInt(v).toLocaleString("en-US");
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n.toLocaleString("en-US") : String(v);
}

/** int() من بايثون: يقبل مسافات حوله، وإشارة، و _ بين الأرقام، والأرقام العربية/الفارسية. */
export function pyInt(s: string | undefined): number | null {
  if (s == null) return null;
  const t = s.trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0));
  if (!/^[+-]?\d+(_\d+)*$/.test(t)) return null;
  const n = Number(t.replace(/_/g, ""));
  return Number.isSafeInteger(n) ? n : null;
}

/** datetime.utcnow().isoformat() */
export const utcIso = () => new Date().toISOString().replace("Z", "000");
/** datetime.fromisoformat() لوقت UTC بدون منطقة زمنية → ms (null لو الصيغة غلط). */
export function parseUtcIso(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?)?/.exec(s.trim());
  if (!m) return null;
  const ms = m[7] ? Math.floor(Number(m[7].padEnd(6, "0")) / 1000) : 0;
  const t = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0), ms);
  return Number.isNaN(t) ? null : t;
}

/** send_log: يرسل في روم اللوق لو كان في نفس السيرفر. */
export async function sendLog(bot: Bot, gid: string | undefined, title: string, description: string, color: number): Promise<void> {
  try {
    const ch = guildChannel(bot, gid, "logs_channel");
    if (!ch) return;
    await bot.trySend(ch, { embeds: [embed({ title, description, color, footer: { text: "نظام العقارات والمحلات - السجلات" } })] });
  } catch (e) {
    log.err("real_estate log", e);
  }
}

// ─────────── البنك (bank.db) — نفس استعلامات deduct_money / add_money في cogs/bank.py ───────────
const bank = () => db("bank.db");

/** datetime.now().strftime("%Y-%m-%d %H:%M:%S") */
function localNow(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function addTransaction(gid: string, uid: string, type: string, amount: number, description: string): void {
  bank().run(
    "INSERT INTO transactions (guild_id, user_id, target_user_id, transaction_type, amount, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    gid, uid, null, type, amount, description, localNow(),
  );
}

/** يخصم مبلغ؛ false لو ما عنده حساب أو رصيد كافٍ أو الحساب مجمّد. */
export function deductMoney(uid: string, gid: string, amount: number): boolean {
  const b = bank();
  return b.tx(() => {
    const row = b.get<{ balance: number; is_frozen: number }>("SELECT balance, is_frozen FROM accounts WHERE guild_id = ? AND user_id = ?", gid, uid);
    if (!row || row.is_frozen || amount <= 0 || Number(row.balance) < amount) return false;
    b.run("UPDATE accounts SET balance = balance - ? WHERE guild_id = ? AND user_id = ?", amount, gid, uid);
    addTransaction(gid, uid, "خصم", amount, "خصم من نظام آخر");
    return true;
  });
}

/** يضيف مبلغ؛ false لو ما عنده حساب. */
export function addMoney(uid: string, gid: string, amount: number, description = "إضافة من نظام آخر"): boolean {
  const b = bank();
  return b.tx(() => {
    if (amount <= 0 || !b.value("SELECT 1 FROM accounts WHERE guild_id = ? AND user_id = ?", gid, uid)) return false;
    b.run("UPDATE accounts SET balance = balance + ? WHERE guild_id = ? AND user_id = ?", amount, gid, uid);
    addTransaction(gid, uid, "إيداع", amount, description);
    return true;
  });
}

/** يخصم من المشتري ويضيف للمستلم في عملية وحدة. false لو الخصم فشل. */
export function payTo(fromId: string, toId: string, gid: string, amount: number, description: string): boolean {
  return bank().tx(() => {
    if (!deductMoney(fromId, gid, amount)) return false;
    addMoney(toId, gid, amount, description);
    return true;
  });
}

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
