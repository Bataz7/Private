import { supabase } from '../supabase/client.js';

// أعمدة ملف 036 اختيارية: لو المالك ما طبّقه بعد، الكتابة تنعاد بدون الأعمدة الجديدة والقراءة ترجع القيم الافتراضية.
export const MIGRATION_036 = 'supabase/migrations/036_presence_dismissal_leaderboard.sql';

type DbError = { code?: string; message?: string } | null | undefined;

/** «العمود مو موجود» (PostgREST PGRST204 عند الكتابة، Postgres 42703 عند القراءة). */
export function isMissingColumn(error: DbError) {
  if (!error) return false;
  const code = String(error.code || '');
  return code === 'PGRST204' || code === '42703' || /could not find the '.+' column|column .+ does not exist/i.test(String(error.message || ''));
}

/** دالة SQL مو موجودة (قبل تطبيق 036). */
export function isMissingFunction(error: DbError) {
  if (!error) return false;
  const code = String(error.code || '');
  return code === 'PGRST202' || code === '42883' || code === '404' || /could not find the function|function .+ does not exist/i.test(String(error.message || ''));
}

const warned = new Set<string>();
export function warnMigration(what: string) {
  if (warned.has(what)) return;
  warned.add(what);
  console.warn(`[036] ${what}: run ${MIGRATION_036} in the Supabase SQL editor.`);
}

/**
 * تحديث يتحمّل غياب الأعمدة الجديدة: يجرب الكل، ولو عمود ناقص يعيد بدون `optional`.
 * يرجّع true لو انكتبت الأعمدة الجديدة كمان.
 */
export async function tolerantUpdate(table: string, match: Record<string, string | number>, data: Record<string, unknown>, optional: string[]) {
  const run = (body: Record<string, unknown>) => {
    let query = supabase.from(table).update(body);
    for (const [column, value] of Object.entries(match)) query = query.eq(column, value);
    return query;
  };
  const { error } = await run(data);
  if (!error) return true;
  if (!isMissingColumn(error)) throw new Error(error.message || 'database error');
  warnMigration(`${table}: ${optional.join(', ')}`);
  const rest = Object.fromEntries(Object.entries(data).filter(([key]) => !optional.includes(key)));
  if (Object.keys(rest).length) {
    const { error: retry } = await run(rest);
    if (retry) throw new Error(retry.message || 'database error');
  }
  return false;
}
