import { EmbedBuilder, type Guild, type GuildMember } from '../lib/djs/index.js';
import { supabase } from '../supabase/client.js';
import { Staff } from '../models/Staff.js';
import { getSettings } from './settings.service.js';
import { createLog } from './log.service.js';
import { endShift, getActiveShift } from './shift.service.js';
import { changePoints } from './staff-points.js';
import { forgetShift, suppressAutoStart } from './auto-shift.service.js';
import { dropPresenceCheck } from './presence-check.service.js';
import { isDismissed } from '../discipline/dismissed.js';
import { tolerantUpdate } from '../discipline/db.js';

// نظام الفصل:
//   فصل  → ينهي الشفت بصمت، يشيل رتبة الستاف ورتبة الشفت (والإجازة لو موجودة)، يعطّل السجل ويعلّمه مفصول (ما يرجع
//          تلقائياً لا من الرسائل ولا من المزامنة)، تصفير نقاط اختياري، رسالة خاص للعضو بالسبب، روم اللوق، وسجل الستاف.
//   إلغاء الفصل → يرجّع السجل نشط، يرجّع رتبة الستاف (اختياري) ويصفّر الإنذارات النشطة عشان ما ينفصل من جديد فوراً.
// بدون ملف 036: الفصل ينحفظ كـ active=false + سجل STAFF_DISMISSED، و isDismissed يقرأ من السجلات.

export { isDismissed };

export type DismissSource = 'command' | 'dashboard' | 'warnings';
const SOURCE_AR: Record<string, string> = { command: 'أمر', dashboard: 'الداشبورد', warnings: 'وصل حد الإنذارات' };
const busy = new Set<string>();

async function memberOf(guild: Guild, userId: string): Promise<GuildMember | null> {
  return guild.members.fetch({ user: userId, force: true }).catch(() => null);
}

/** يتأكد إن البوت يقدر يشيل/يعطي هذي الرتب، قبل ما نغيّر أي شي. */
async function assertRolesManageable(guild: Guild, roleIds: string[]) {
  if (!roleIds.length) return;
  const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
  if (!me) return; // ما نعرف رتبة البوت: نجرب ونرجّع الخطأ لو فشل.
  for (const id of roleIds) {
    const role = guild.roles.cache.get(id);
    if (role && !role.editable) throw new Error(`ما أقدر أعدّل رتبة «${role.name}»: لازم رتبة البوت تكون فوقها وعنده صلاحية إدارة الرتب.`);
  }
}

async function postLog(guild: Guild, channelId: string | null | undefined, embed: EmbedBuilder) {
  if (!channelId) return;
  const channel = await guild.client.channels.fetch(channelId).catch(() => null);
  if (channel?.isTextBased()) await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => undefined);
}

export async function dismissStaff(guild: Guild, userId: string, opts: { by: string; reason: string; resetPoints?: boolean; source?: DismissSource }): Promise<{ ok: true; rolesRemoved: string[]; shiftEnded: boolean; dmSent: boolean }> {
  const reason = String(opts.reason || '').trim().slice(0, 500);
  if (!reason) throw new Error('اكتب سبب الفصل.');
  const id = `${guild.id}:${userId}`;
  if (busy.has(id)) throw new Error('فيه عملية فصل شغالة لهذا العضو الحين.');
  busy.add(id);
  try {
    const settings = await getSettings(guild.id).catch(() => null);
    if (!settings) throw new Error('Rift ما انضبط في هذا السيرفر بعد.');
    if (userId === guild.client.user?.id) throw new Error('ما أقدر أفصل نفسي.');
    if (userId === guild.ownerId) throw new Error('ما ينفع تفصل مالك السيرفر.');
    const [staff, member] = await Promise.all([Staff.findOne({ guildId: guild.id, userId }).catch(() => null), memberOf(guild, userId)]);
    const hasRole = Boolean(member && settings.staffRoleId && member.roles.cache.has(settings.staffRoleId));
    if (!staff && !hasRole) throw new Error('هذا العضو مو من الستاف.');
    if (await isDismissed(guild.id, userId)) throw new Error('هذا العضو مفصول من قبل.');

    const roles = member ? [settings.staffRoleId, settings.onShiftRoleId, settings.leaveRoleId].filter((roleId): roleId is string => Boolean(roleId) && member.roles.cache.has(roleId!)) : [];
    await assertRolesManageable(guild, roles);

    // 1) الشفت ينتهي بصمت.
    let shiftEnded = false;
    if (await getActiveShift(guild.id, userId).catch(() => null)) {
      shiftEnded = Boolean(await endShift(guild.id, userId).catch(() => null));
      forgetShift(guild.id, userId);
      suppressAutoStart(guild.id, userId);
      await dropPresenceCheck(guild.client, guild.id, userId).catch(() => undefined);
    }

    // 2) الرتب.
    const rolesRemoved: string[] = [];
    for (const roleId of [...new Set(roles)]) {
      try { await member!.roles.remove(roleId, `فصل: ${reason}`.slice(0, 400)); rolesRemoved.push(roleId); }
      catch { throw new Error(`ما قدرت أشيل رتبة <@&${roleId}>. تأكد إن رتبة البوت فوقها.`); }
    }

    // 3) السجل: معطّل + مفصول.
    const now = new Date().toISOString();
    const row = staff ?? await Staff.create({ guildId: guild.id, userId, joinedAt: new Date(), active: false, points: 0, claimed: 0, closed: 0 });
    await tolerantUpdate('staff', { id: row.id }, { active: false, dismissed_at: now, dismissed_by: opts.by, dismiss_reason: reason }, ['dismissed_at', 'dismissed_by', 'dismiss_reason']);

    // 4) تصفير النقاط (اختياري) — من خلال السجل عشان يبان في تاريخ النقاط.
    let pointsReset = 0;
    if (opts.resetPoints) {
      const { data } = await supabase.from('staff').select('points').eq('id', row.id).maybeSingle();
      const points = Number(data?.points) || 0;
      if (points > 0) { await changePoints({ guildId: guild.id, userId, delta: -points, source: 'dismissal', reason: `فصل: ${reason}`, actorId: opts.by }); pointsReset = points; }
    }

    // 5) سجل الستاف (ومنه يعرف isDismissed حالة الفصل لو ملف 036 ما انطبق).
    await createLog(guild.id, 'STAFF_DISMISSED', userId, opts.by, { reason, source: opts.source ?? 'command', rolesRemoved, shiftEnded, pointsReset }).catch(error => console.error('Dismissal log failed:', error));

    // 6) رسالة للعضو بالسبب.
    let dmSent = false;
    const user = member?.user ?? await guild.client.users.fetch(userId).catch(() => null);
    if (user) {
      dmSent = await user.send({ embeds: [new EmbedBuilder().setColor(0xe9697b).setTitle('تم فصلك من الستاف')
        .setDescription(`تم فصلك من فريق الستاف في **${guild.name}**.\n\n**السبب:** ${reason}${pointsReset ? `\n**النقاط:** تم تصفير نقاطك (${pointsReset}).` : ''}\n\nلو عندك اعتراض تواصل مع الإدارة.`)
        .setTimestamp()] }).then(() => true, () => false);
    }

    // 7) روم اللوق.
    await postLog(guild, settings.logsChannelId, new EmbedBuilder().setColor(0xe9697b)
      .setDescription(`### ⛔ فصل إداري\n<@${userId}> · بواسطة <@${opts.by}> (${SOURCE_AR[opts.source ?? 'command'] ?? opts.source})\n**السبب:** ${reason}\n${rolesRemoved.length ? `الرتب المشالة: ${rolesRemoved.map(r => `<@&${r}>`).join(' ')}` : 'ما كان عنده رتب ستاف'}${shiftEnded ? ' · انتهى شفته' : ''}${pointsReset ? ` · تصفير ${pointsReset} نقطة` : ''}${dmSent ? '' : '\n-# ما وصلته رسالة الخاص (مقفل الخاص).'}`).setTimestamp());

    return { ok: true, rolesRemoved, shiftEnded, dmSent };
  } finally {
    busy.delete(id);
  }
}

export async function reinstateStaff(guild: Guild, userId: string, opts: { by: string; reason?: string; restoreRole?: boolean; source?: 'command' | 'dashboard' }): Promise<{ ok: true; roleRestored: boolean }> {
  const settings = await getSettings(guild.id).catch(() => null);
  if (!settings) throw new Error('Rift ما انضبط في هذا السيرفر بعد.');
  const staff = await Staff.findOne({ guildId: guild.id, userId }).catch(() => null);
  if (!staff || !await isDismissed(guild.id, userId)) throw new Error('هذا العضو مو مفصول.');
  const restore = opts.restoreRole !== false;
  const member = restore ? await memberOf(guild, userId) : null;
  if (restore && member && settings.staffRoleId) await assertRolesManageable(guild, [settings.staffRoleId]);

  await tolerantUpdate('staff', { id: staff.id }, { active: true, dismissed_at: null, dismissed_by: null, dismiss_reason: null }, ['dismissed_at', 'dismissed_by', 'dismiss_reason']);
  // إنذاراته القديمة تنقفل، وإلا أول إنذار جديد يفصله على طول.
  await supabase.from('staff_warnings').update({ active: false }).eq('guild_id', guild.id).eq('staff_user_id', userId).eq('active', true).then(() => undefined, () => undefined);

  let roleRestored = false;
  if (restore && member && settings.staffRoleId && !member.roles.cache.has(settings.staffRoleId)) {
    roleRestored = await member.roles.add(settings.staffRoleId, `إلغاء فصل${opts.reason ? `: ${opts.reason}` : ''}`.slice(0, 400)).then(() => true, () => false);
  }
  const reason = String(opts.reason || '').trim().slice(0, 500);
  await createLog(guild.id, 'STAFF_REINSTATED', userId, opts.by, { reason, source: opts.source ?? 'command', roleRestored }).catch(error => console.error('Reinstate log failed:', error));
  await postLog(guild, settings.logsChannelId, new EmbedBuilder().setColor(0x4fc08d)
    .setDescription(`### ↩️ إلغاء فصل\n<@${userId}> رجع للستاف · بواسطة <@${opts.by}>${reason ? `\n**السبب:** ${reason}` : ''}${roleRestored ? `\nرجعت له رتبة <@&${settings.staffRoleId}>` : ''}`).setTimestamp());
  return { ok: true, roleRestored };
}

export type DismissedEntry = { userId: string; at: Date | null; by: string | null; reason: string };

/** آخر المفصولين (للأمر وللداشبورد). */
export async function listDismissed(guildId: string, limit = 25): Promise<DismissedEntry[]> {
  const { data, error } = await supabase.from('staff').select('user_id,dismissed_at,dismissed_by,dismiss_reason').eq('guild_id', guildId).not('dismissed_at', 'is', null).order('dismissed_at', { ascending: false }).limit(limit);
  if (!error) return (data ?? []).map(row => ({ userId: String(row.user_id), at: row.dismissed_at ? new Date(String(row.dismissed_at)) : null, by: (row.dismissed_by as string) || null, reason: String(row.dismiss_reason || '') }));
  // بدون 036: من السجلات.
  const { data: logs } = await supabase.from('staff_logs').select('user_id,actor_id,details,created_at,action').eq('guild_id', guildId).in('action', ['STAFF_DISMISSED', 'STAFF_REINSTATED']).order('created_at', { ascending: false }).limit(500);
  const seen = new Set<string>();
  const out: DismissedEntry[] = [];
  for (const row of logs ?? []) {
    const id = String(row.user_id);
    if (seen.has(id)) continue;
    seen.add(id);
    if (row.action === 'STAFF_DISMISSED') out.push({ userId: id, at: new Date(String(row.created_at)), by: (row.actor_id as string) || null, reason: String((row.details as Record<string, unknown> | null)?.reason || '') });
    if (out.length >= limit) break;
  }
  return out;
}
