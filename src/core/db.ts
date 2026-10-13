// Small helpers so a missing migration never crashes the bot: the feature that needs the table logs one clear line and degrades.

export const MIGRATION_HINT = 'شغّل supabase/migrations/030_staff_core.sql في محرر SQL في Supabase.';

const warned = new Set<string>();
/** Logs a message the first time only. */
export function warnOnce(key: string, message: string) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[core] ${message}`);
}

// أسماء الميزات بالعربي للرسالة اللي تظهر للمستخدم (الاسم الإنجليزي يبقى لسجل المطوّر).
const FEATURE_AR: Record<string, string> = {
  'Assist logging': 'تسجيل المساعدات', 'Staff warnings': 'تحذيرات الستاف', Notifications: 'الإشعارات', 'Staff notes': 'ملاحظات الستاف',
  Profiles: 'البروفايلات', 'Profile reputation': 'سمعة البروفايل', 'Profile comments': 'تعليقات البروفايل', 'The points ledger': 'سجل النقاط', 'Staff profiles': 'بروفايلات الستاف',
};

/** A feature needs a table that does not exist yet. The message is safe to show to the person who used it. */
export class SetupMissingError extends Error {
  constructor(what: string) { super(`${FEATURE_AR[what] || what} ما انضبط للحين. لازم أدمن يطبّق آخر تحديث لقاعدة البيانات (030_staff_core.sql).`); this.name = 'SetupMissingError'; }
}

/** Rethrows a database error as SetupMissingError when it only means the migration is missing. */
export function orSetupMissing(error: unknown, what: string): never {
  const message = error instanceof Error ? error.message : String(error);
  if (isMissing({ message })) { warnOnce(what, `${what} is not available yet. ${MIGRATION_HINT}`); throw new SetupMissingError(what); }
  throw error;
}

type SupabaseLikeError = { code?: string; message?: string } | null | undefined;

/** True for "table does not exist" and "function does not exist" (PostgREST schema cache or Postgres codes). */
export function isMissing(error: SupabaseLikeError) {
  if (!error) return false;
  const code = String(error.code || '');
  const message = String(error.message || '');
  return code === 'PGRST205' || code === 'PGRST202' || code === '42P01' || code === '42883'
    || /could not find the (table|function)|does not exist|schema cache/i.test(message);
}

/** Throws unless the error just means the migration has not been applied; in that case logs once and returns true. */
export function tolerateMissing(error: SupabaseLikeError, what: string) {
  if (!error) return false;
  if (isMissing(error)) {
    warnOnce(what, `${what} is not available yet. ${MIGRATION_HINT}`);
    return true;
  }
  throw new Error(`${what}: ${error.message || 'database error'}`);
}

/** For best-effort writes (ledger rows, logs): never throws, says once when the table is missing, prints other errors. */
export function logDbIssue(error: unknown, what: string) {
  const message = error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String((error as { message: unknown }).message) : String(error);
  if (isMissing({ message })) warnOnce(what, `${what} is not available yet. ${MIGRATION_HINT}`);
  else console.error(`[core] ${what}: ${message}`);
}

/** Reads every row of a query, 1000 at a time (Supabase returns at most 1000 rows per request). */
export async function fetchAll<T = Record<string, any>>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: SupabaseLikeError }>, max = 20000): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message || 'database error');
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}
