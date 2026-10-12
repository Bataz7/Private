/**
 * خصم من حساب البنك (bank.db) — نفس منطق deduct_money في cogs/bank.py
 * (المرور والمركبات يستخدمونه مباشرة بدون استيراد نظام البنك).
 */
import { db } from "../../core/db.ts";
import { log } from "../../core/log.ts";

const bank = () => db("bank.db");

/** datetime.now().strftime("%Y-%m-%d %H:%M:%S") — بالتوقيت المحلي مثل بايثون. */
function localNow(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** يخصم مبلغاً من حساب العضو؛ يرجع false لو ما عنده حساب أو رصيد كافٍ أو الحساب مجمّد. */
export function deductMoney(userId: string, guildId: string, amount: number): boolean {
  amount = Math.trunc(Number(amount));
  if (!Number.isFinite(amount) || amount <= 0) return false;
  try {
    const sql = bank();
    return sql.tx(() => {
      const r = sql.run(
        "UPDATE accounts SET balance = balance - ? WHERE guild_id = ? AND user_id = ? AND is_frozen = 0 AND balance >= ?",
        amount, guildId, userId, amount,
      );
      if (r.changes !== 1) return false;
      sql.run(
        "INSERT INTO transactions (guild_id, user_id, target_user_id, transaction_type, amount, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        guildId, userId, null, "خصم", amount, "خصم من نظام آخر", localNow(),
      );
      return true;
    });
  } catch (e) {
    // جداول البنك مو موجودة (نظام البنك ما اشتغل للحين) = ما عنده حساب
    log.debug("bank", `deduct failed: ${(e as Error).message}`);
    return false;
  }
}
