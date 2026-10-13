import { supabase } from '../supabase/client.js';
import { isMissingColumn, warnMigration } from './db.js';

// حالة الفصل. مع ملف 036: staff.dismissed_at. بدونه: آخر سجل STAFF_DISMISSED / STAFF_REINSTATED في staff_logs.

export class DismissedError extends Error {
  constructor() { super('هذا العضو مفصول من الستاف. لازم أحد من الإدارة يلغي فصله أول.'); this.name = 'DismissedError'; }
}

let hasColumns: boolean | null = null;

async function fromLogs(guildId: string, userIds: string[]) {
  const out = new Set<string>();
  for (let i = 0; i < userIds.length; i += 200) {
    const { data } = await supabase.from('staff_logs').select('user_id,action,created_at').eq('guild_id', guildId)
      .in('action', ['STAFF_DISMISSED', 'STAFF_REINSTATED']).in('user_id', userIds.slice(i, i + 200)).order('created_at', { ascending: false }).limit(1000);
    const seen = new Set<string>();
    for (const row of data ?? []) {
      const id = String(row.user_id);
      if (seen.has(id)) continue;
      seen.add(id);
      if (row.action === 'STAFF_DISMISSED') out.add(id);
    }
  }
  return out;
}

export async function isDismissed(guildId: string, userId: string): Promise<boolean> {
  if (hasColumns !== false) {
    const { data, error } = await supabase.from('staff').select('dismissed_at').eq('guild_id', guildId).eq('user_id', userId).maybeSingle();
    if (!error) { hasColumns = true; return Boolean(data?.dismissed_at); }
    if (!isMissingColumn(error)) return false;
    hasColumns = false;
    warnMigration('staff.dismissed_at');
  }
  return (await fromLogs(guildId, [userId])).has(userId);
}

/** المفصولين في السيرفر (للمزامنة والقائمة). بدون 036: من السجلات بين الأعضاء غير النشطين. */
export async function dismissedUserIds(guildId: string): Promise<Set<string>> {
  if (hasColumns !== false) {
    const out = new Set<string>();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('staff').select('user_id').eq('guild_id', guildId).not('dismissed_at', 'is', null).order('id').range(from, from + 999);
      if (error) {
        if (!isMissingColumn(error)) throw new Error(error.message);
        hasColumns = false;
        warnMigration('staff.dismissed_at');
        break;
      }
      hasColumns = true;
      for (const row of data ?? []) out.add(String(row.user_id));
      if ((data?.length ?? 0) < 1000) return out;
    }
  }
  const inactive: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from('staff').select('user_id').eq('guild_id', guildId).eq('active', false).order('id').range(from, from + 999);
    for (const row of data ?? []) inactive.push(String(row.user_id));
    if ((data?.length ?? 0) < 1000) break;
  }
  return inactive.length ? fromLogs(guildId, inactive) : new Set();
}

/** للاختبارات/إعادة الفحص بعد تطبيق الملف. */
export function resetDismissedColumnCheck() { hasColumns = null; }
