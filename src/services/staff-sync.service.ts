import type { Guild } from '../lib/djs/index.js';
import { supabase } from '../supabase/client.js';
import { dismissedUserIds } from '../discipline/dismissed.js';

// مزامنة قائمة الستاف مع رتبة الستاف:
//   sync  → كل من عنده الرتبة يتسجّل/يتفعّل، واللي شالوا منه الرتبة يتعطّل (نقاطه وسجله يبقون).
//   wipe  → يمسح كل سجلات الستاف للسيرفر (النقاط والإحصائيات ترجع صفر) ثم يسجّل كل من عنده الرتبة من جديد.
//   المفصولين ما يرجعون بالمزامنة أبداً (حتى لو عندهم الرتبة)، وسجلهم يبقى في المسح عشان يبقى الفصل محفوظ.
// الأعضاء يُقرون من REST صفحة صفحة (1000 بكل طلب) بدون ما ينحفظون في الكاش = ذاكرة ثابتة حتى في السيرفرات الكبيرة.

export type StaffSyncMode = 'sync' | 'wipe';
export type StaffSyncResult = { mode: StaffSyncMode; withRole: number; added: number; reactivated: number; deactivated: number; wiped: number; skippedDismissed?: number };

const running = new Set<string>();
const CHUNK = 200;

export async function staffRoleOf(guildId: string): Promise<string | null> {
  const { data } = await supabase.from('guild_settings').select('staff_role_id').eq('guild_id', guildId).maybeSingle();
  return (data?.staff_role_id as string | null) || null;
}

export async function syncStaffFromRole(guild: Guild, mode: StaffSyncMode = 'sync'): Promise<StaffSyncResult> {
  if (running.has(guild.id)) throw new Error('فيه مزامنة شغالة الحين لهذا السيرفر، انتظر لين تخلص.');
  running.add(guild.id);
  try {
    const roleId = await staffRoleOf(guild.id);
    if (!roleId) throw new Error('رتبة الستاف مو محددة. حددها من إعدادات السيرفر أول.');
    if (!guild.roles.cache.has(roleId)) throw new Error('رتبة الستاف المحفوظة ما عادت موجودة في السيرفر.');

    const holders: string[] = [];
    for await (const member of guild.members.list()) {
      if (!member.user.bot && member._roles.includes(roleId)) holders.push(member.id);
    }

    const dismissed = await dismissedUserIds(guild.id);
    const eligible = holders.filter(id => !dismissed.has(id));
    const result: StaffSyncResult = { mode, withRole: holders.length, added: 0, reactivated: 0, deactivated: 0, wiped: 0, skippedDismissed: holders.length - eligible.length };

    if (mode === 'wipe') {
      let wipe = supabase.from('staff').delete().eq('guild_id', guild.id);
      if (dismissed.size) wipe = wipe.not('user_id', 'in', [...dismissed]);
      const { data, error } = await wipe.select('id');
      if (error) throw new Error(`تعذّر مسح الستاف: ${error.message}`);
      result.wiped = data?.length ?? 0;
      for (let i = 0; i < eligible.length; i += CHUNK) {
        const rows = eligible.slice(i, i + CHUNK).map(userId => ({ guild_id: guild.id, user_id: userId, active: true, joined_at: new Date().toISOString() }));
        const { error: insertError } = await supabase.from('staff').insert(rows);
        if (insertError) throw new Error(`تعذّر تسجيل الستاف: ${insertError.message}`);
      }
      result.added = eligible.length;
      return result;
    }

    const existing = new Map<string, boolean>();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('staff').select('user_id,active').eq('guild_id', guild.id).order('id').range(from, from + 999);
      if (error) throw new Error(`تعذّر قراءة الستاف: ${error.message}`);
      for (const row of data ?? []) existing.set(String(row.user_id), row.active !== false);
      if ((data?.length ?? 0) < 1000) break;
    }

    const holderSet = new Set(holders);
    const toAdd = eligible.filter(id => !existing.has(id));
    const toReactivate = eligible.filter(id => existing.get(id) === false);
    const toDeactivate = [...existing].filter(([id, active]) => active && !holderSet.has(id)).map(([id]) => id);

    for (let i = 0; i < toAdd.length; i += CHUNK) {
      const rows = toAdd.slice(i, i + CHUNK).map(userId => ({ guild_id: guild.id, user_id: userId, active: true, joined_at: new Date().toISOString() }));
      const { error } = await supabase.from('staff').upsert(rows, { onConflict: 'guild_id,user_id' });
      if (error) throw new Error(`تعذّر تسجيل الستاف: ${error.message}`);
    }
    for (const [ids, active] of [[toReactivate, true], [toDeactivate, false]] as const) {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const { error } = await supabase.from('staff').update({ active }).eq('guild_id', guild.id).in('user_id', ids.slice(i, i + CHUNK));
        if (error) throw new Error(`تعذّر تحديث الستاف: ${error.message}`);
      }
    }
    result.added = toAdd.length;
    result.reactivated = toReactivate.length;
    result.deactivated = toDeactivate.length;
    return result;
  } finally {
    running.delete(guild.id);
  }
}

/** نص عربي مختصر لنتيجة المزامنة (للوق والداشبورد). */
export function describeSync(r: StaffSyncResult) {
  const skipped = r.skippedDismissed ? ` · مفصولين ما رجعوا: ${r.skippedDismissed}` : '';
  return r.mode === 'wipe'
    ? `تم مسح ${r.wiped} سجل وتسجيل ${r.added} ستاف من جديد (عندهم الرتبة).${skipped}`
    : `عندهم الرتبة: ${r.withRole} · جديد: ${r.added} · رجعوا: ${r.reactivated} · تعطّلوا: ${r.deactivated}${skipped}`;
}
