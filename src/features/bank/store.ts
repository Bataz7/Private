/**
 * قاعدة بيانات البنك (data/bank.db) — نفس جداول وأعمدة نظام بايثون القديم بالضبط.
 * الأنظمة الثانية (المرور، المركبات، العقارات) تقدر تستورد الدوال الصغيرة هنا:
 *   getAccount(gid, uid) · getBalance(gid, uid) · deductMoney(uid, gid, amount) · addMoney(uid, gid, amount)
 * المبالغ أعداد صحيحة (INTEGER) زي بايثون.
 */
import { db } from "../../core/db.ts";

export const sql = db("bank.db");

sql.exec(`
CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    account_number TEXT NOT NULL,
    balance INTEGER NOT NULL DEFAULT 0,
    is_frozen INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE(guild_id, user_id)
);
CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    target_user_id INTEGER,
    transaction_type TEXT NOT NULL,
    amount INTEGER NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS loans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    account_number TEXT NOT NULL,
    amount INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id INTEGER PRIMARY KEY,
    loan_channel_id INTEGER,
    log_channel_id INTEGER,
    bank_staff_role_id INTEGER
);
`);
for (const col of ["loan_channel_id", "log_channel_id", "bank_staff_role_id", "account_panel_channel_id", "citizens_panel_channel_id", "staff_panel_channel_id"]) {
  sql.addColumn("guild_settings", col, "INTEGER");
}

export interface Account {
  id: number; guild_id: string; user_id: string; account_number: string; balance: number; is_frozen: number; created_at: string;
}
export interface Loan { id: number; guild_id: string; user_id: string; account_number: string; amount: number; status: string; created_at: string }
export interface BankSettings {
  guild_id: string; loan_channel_id: string | null; log_channel_id: string | null; bank_staff_role_id: string | null;
  account_panel_channel_id: string | null; citizens_panel_channel_id: string | null; staff_panel_channel_id: string | null;
}

const pad = (n: number) => String(n).padStart(2, "0");
/** نفس صيغة بايثون: %Y-%m-%d %H:%M:%S (وقت الجهاز المحلي). */
export function stamp(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const idStr = (r: any, keys: string[]) => {
  if (r) for (const k of keys) if (r[k] != null) r[k] = String(r[k]);
  return r;
};

export function getSettings(gid: string): BankSettings | undefined {
  return idStr(sql.get<BankSettings>("SELECT * FROM guild_settings WHERE guild_id = ?", gid),
    ["guild_id", "loan_channel_id", "log_channel_id", "bank_staff_role_id", "account_panel_channel_id", "citizens_panel_channel_id", "staff_panel_channel_id"]);
}

export function getAccount(gid: string, uid: string): Account | undefined {
  return idStr(sql.get<Account>("SELECT * FROM accounts WHERE guild_id = ? AND user_id = ?", gid, uid), ["guild_id", "user_id", "account_number"]);
}

export function getAccountByNumber(gid: string, accountNumber: string): Account | undefined {
  return idStr(sql.get<Account>("SELECT * FROM accounts WHERE guild_id = ? AND account_number = ?", gid, accountNumber), ["guild_id", "user_id", "account_number"]);
}

/** رصيد العضو، أو null لو ما عنده حساب. */
export function getBalance(gid: string, uid: string): number | null {
  const b = sql.value<number>("SELECT balance FROM accounts WHERE guild_id = ? AND user_id = ?", gid, uid);
  return b == null ? null : Number(b);
}

export function generateAccountNumber(gid: string): string | null {
  for (let i = 0; i < 20_000; i++) {
    const n = String(1000 + Math.floor(Math.random() * 9000));
    if (!sql.value("SELECT id FROM accounts WHERE guild_id = ? AND account_number = ?", gid, n)) return n;
  }
  return null;
}

export function addTransaction(gid: string, uid: string, type: string, amount: number, description: string, targetUserId: string | null = null): void {
  sql.run(
    "INSERT INTO transactions (guild_id, user_id, target_user_id, transaction_type, amount, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    gid, uid, targetUserId, type, amount, description, stamp(),
  );
}

// ─────────── واجهة للأنظمة الأخرى (نفس ترتيب وسلوك بايثون: user_id ثم guild_id) ───────────
/** يخصم مبلغاً من حساب العضو؛ false لو ما عنده حساب أو رصيد كافٍ أو الحساب مجمّد. */
export function deductMoney(userId: string, guildId: string, amount: number, description = "خصم من نظام آخر"): boolean {
  amount = Math.trunc(Number(amount));
  if (!Number.isSafeInteger(amount) || amount <= 0) return false;
  return sql.tx(() => {
    const r = sql.run("UPDATE accounts SET balance = balance - ? WHERE guild_id = ? AND user_id = ? AND is_frozen = 0 AND balance >= ?", amount, guildId, userId, amount);
    if (!r.changes) return false;
    addTransaction(guildId, userId, "خصم", amount, description);
    return true;
  });
}

/** يضيف مبلغاً لحساب العضو؛ false لو ما عنده حساب. */
export function addMoney(userId: string, guildId: string, amount: number, description = "إضافة من نظام آخر"): boolean {
  amount = Math.trunc(Number(amount));
  if (!Number.isSafeInteger(amount) || amount <= 0) return false;
  return sql.tx(() => {
    const r = sql.run("UPDATE accounts SET balance = balance + ? WHERE guild_id = ? AND user_id = ?", amount, guildId, userId);
    if (!r.changes) return false;
    addTransaction(guildId, userId, "إيداع", amount, description);
    return true;
  });
}

/** مثل int() في بايثون: يقبل الأرقام العربية والمسافات و +/- و _ بين الأرقام. null لو غير صحيح. */
export function parseIntPy(v: string | undefined | null): number | null {
  if (v == null) return null;
  const s = toAsciiDigits(v).trim();
  if (!/^[+-]?\d+(_\d+)*$/.test(s)) return null;
  const n = Number(s.replace(/_/g, ""));
  return Number.isSafeInteger(n) ? n : null;
}

/** ٠-٩ و ۰-۹ → 0-9 */
export function toAsciiDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0));
}
