import { supabase } from '../supabase/client.js';
import { weekStartOf } from '../services/leaderboard.service.js';
import type { Context } from '../web/server/http.js';
import type { Mount } from '../web/server/router.js';
import { isSnowflake } from '../web/server/security.js';
import type { DashboardContext } from './context.js';

// GET /api/staff/:userId/overview — كل اللي تحتاجه لوحة تفاصيل الستاف في طلب واحد.
// الستاف يشوف نفسه، والأدمن يشوف أي أحد. كل الاستعلامات محدودة ومقيّدة بالسيرفر، وتشتغل بالتوازي.

const DAY = 86_400_000;
export const TIERS = [
  { key: 'bronze', name: 'برونزي', min: 0 },
  { key: 'silver', name: 'فضي', min: 100 },
  { key: 'gold', name: 'ذهبي', min: 300 },
  { key: 'platinum', name: 'بلاتيني', min: 600 },
  { key: 'diamond', name: 'ماسي', min: 1000 },
  { key: 'legend', name: 'أسطوري', min: 2000 },
];

export function tierOf(points: number) {
  let index = 0;
  for (let i = 0; i < TIERS.length; i += 1) if (points >= TIERS[i]!.min) index = i;
  const current = TIERS[index]!;
  const next = TIERS[index + 1] ?? null;
  return { current, next, toNext: next ? next.min - points : 0, progress: next ? (points - current.min) / (next.min - current.min) : 1 };
}

const rows = async (query: PromiseLike<{ data: any; error: { message: string } | null }>) => {
  const { data, error } = await query;
  return error ? [] : (data ?? []) as any[];
};
const time = (value: unknown) => (value ? new Date(String(value)).getTime() : NaN);

function activeMinutes(shift: any) {
  const start = time(shift.started_at);
  const end = shift.ended_at ? time(shift.ended_at) : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  const breaks = (Array.isArray(shift.breaks) ? shift.breaks : []).reduce((sum: number, item: any) => {
    const from = time(item.startedAt ?? item.started_at);
    const to = item.endedAt ?? item.ended_at ? time(item.endedAt ?? item.ended_at) : end;
    return Number.isFinite(from) && Number.isFinite(to) ? sum + Math.max(0, to - from) : sum;
  }, 0);
  return Math.max(0, Math.round((end - start - breaks) / 60_000));
}

const END_ACTIONS: Record<string, string> = { SHIFT_ENDED: 'manual', SHIFT_AUTO_ENDED: 'auto_idle', SHIFT_PRESENCE_TIMEOUT: 'presence_timeout', SHIFT_AUTO_12H: 'auto_12h', SHIFT_MAX_DURATION: 'auto_12h', STAFF_DISMISSED: 'dismissed' };

export function mountStaffOverview(app: Mount, ctx: DashboardContext) {
  app.get('/api/staff/:userId/overview', async (c: Context) => {
    const userId = String(c.params.userId || '');
    if (!isSnowflake(userId)) return c.fail(400, 'آيدي العضو غير صحيح.');
    const guildId = ctx.selectedGuildId(c);
    const viewer = ctx.sessionUser(c)!;
    if (viewer.id !== userId && !await ctx.requireAdministrator(c)) return;

    const now = Date.now();
    const since14 = new Date(Math.floor(now / DAY) * DAY - 13 * DAY);
    const weekStart = weekStartOf(now);
    const guild = await ctx.getGuild(guildId);
    const [member, settings, staffRows, shifts, activity, ledger, weekLedger, ratings, complaints, warnings, notes, logs, leave, dismissal, discordUser] = await Promise.all([
      ctx.getMember(guildId, userId),
      ctx.settingsRow(guildId).catch(() => null),
      rows(supabase.from('staff').select('user_id, points, active, message_count, voice_minutes, joined_at').eq('guild_id', guildId).order('points', { ascending: false }).limit(1000)),
      rows(supabase.from('shifts').select('id, started_at, ended_at, status, breaks').eq('guild_id', guildId).eq('user_id', userId).order('started_at', { ascending: false }).limit(200)),
      rows(supabase.from('staff_daily_activity').select('activity_date, message_count, active_minutes, voice_minutes').eq('guild_id', guildId).eq('user_id', userId).gte('activity_date', since14.toISOString().slice(0, 10)).limit(31)),
      rows(supabase.from('points_ledger').select('id, delta, points_before, points_after, source, reason, actor_id, created_at').eq('guild_id', guildId).eq('user_id', userId).order('created_at', { ascending: false }).limit(30)),
      rows(supabase.from('points_ledger').select('delta, created_at').eq('guild_id', guildId).eq('user_id', userId).gte('created_at', new Date(Math.min(weekStart.getTime(), since14.getTime())).toISOString()).limit(2000)),
      rows(supabase.from('staff_ratings').select('rating, reviewer_user_id, created_at').eq('guild_id', guildId).eq('staff_user_id', userId).order('created_at', { ascending: false }).limit(500)),
      supabase.from('complaints').select('id', { count: 'exact', head: true }).eq('guild_id', guildId).eq('staff_user_id', userId).eq('status', 'approved').then(result => result.count ?? 0),
      rows(supabase.from('staff_warnings').select('id, reason, issued_by, automatic, active, created_at').eq('guild_id', guildId).eq('staff_user_id', userId).order('created_at', { ascending: false }).limit(30)),
      rows(supabase.from('staff_notes').select('id, text, added_by, created_at').eq('guild_id', guildId).eq('user_id', userId).order('created_at', { ascending: false }).limit(30)),
      rows(supabase.from('staff_logs').select('action, details, created_at').eq('guild_id', guildId).eq('user_id', userId).in('action', Object.keys(END_ACTIONS)).order('created_at', { ascending: false }).limit(100)),
      rows(supabase.from('leave_requests').select('id, status, start_date, end_date').eq('guild_id', guildId).eq('user_id', userId).eq('status', 'approved').order('created_at', { ascending: false }).limit(5)),
      rows(supabase.from('staff_logs').select('action, details, created_at').eq('guild_id', guildId).eq('user_id', userId).in('action', ['STAFF_DISMISSED', 'STAFF_REINSTATED']).order('created_at', { ascending: false }).limit(1)),
      ctx.discord.users.fetch(userId).catch(() => null),
    ]);

    const staff = staffRows.find(row => String(row.user_id) === userId) ?? null;
    if (!staff && !member) return c.fail(404, 'العضو مو موجود.');

    // ---- العضو
    const user = member?.user ?? discordUser;
    const topRole = member ? [...member.roles.cache.values()].filter(role => role.id !== guild.id).sort((a, b) => b.position - a.position)[0] : null;
    const info = {
      userId, username: user?.username ?? userId, displayName: member?.displayName ?? user?.globalName ?? user?.username ?? userId,
      avatar: (member ?? user)?.displayAvatarURL({ extension: 'png', size: 256 }) ?? '',
      banner: member?.displayBannerURL({ extension: 'png', size: 1024 }) ?? user?.bannerURL({ extension: 'png', size: 1024 }) ?? '',
      role: topRole ? { name: topRole.name, color: topRole.hexColor } : null, inServer: Boolean(member), joinedAt: staff?.joined_at ?? null,
    };

    // ---- الحالة
    const activeShift = shifts.find(shift => shift.status === 'active' || !shift.ended_at) ?? null;
    const today = new Date(now).toISOString().slice(0, 10);
    const onLeave = leave.find(item => String(item.start_date).slice(0, 10) <= today && String(item.end_date).slice(0, 10) >= today) ?? null;
    const lastDismissal = dismissal[0]?.action === 'STAFF_DISMISSED' ? dismissal[0] : null;
    const dismissed = Boolean(lastDismissal && staff?.active === false);
    const status = {
      onShift: Boolean(activeShift), shiftSince: activeShift?.started_at ?? null,
      onLeave: Boolean(onLeave), leaveUntil: onLeave?.end_date ?? null,
      dismissed, dismissedAt: dismissed ? lastDismissal!.created_at : null, dismissReason: dismissed ? String(lastDismissal!.details?.reason ?? '') : null,
      active: staff?.active !== false,
    };

    // ---- النقاط
    const total = Number(staff?.points) || 0;
    const ranked = staffRows.filter(row => row.active !== false);
    const rank = ranked.findIndex(row => String(row.user_id) === userId) + 1;
    const week = weekLedger.filter(row => time(row.created_at) >= weekStart.getTime()).reduce((sum, row) => sum + (Number(row.delta) || 0), 0);
    const points = { total, week, rank: rank || null, of: ranked.length, top: Number(ranked[0]?.points) || 0, tier: tierOf(total) };

    // ---- الأرقام
    const shiftMinutes = shifts.reduce((sum, shift) => sum + activeMinutes(shift), 0);
    const ratingCount = ratings.length;
    const warnLimit = Number(settings?.warn_limit) || 3;
    const stats = {
      shiftHours: Math.round(shiftMinutes / 6) / 10, voiceHours: Math.round(((Number(staff?.voice_minutes) || 0) / 60) * 10) / 10, messages: Number(staff?.message_count) || 0,
      rating: { average: ratingCount ? Math.round((ratings.reduce((sum, row) => sum + (Number(row.rating) || 0), 0) / ratingCount) * 100) / 100 : 0, count: ratingCount },
      complaints, warnings: { active: warnings.filter(row => row.active !== false).length, limit: warnLimit },
    };

    // ---- آخر 14 يوم
    const days = Array.from({ length: 14 }, (_, index) => ({ date: new Date(since14.getTime() + index * DAY).toISOString().slice(0, 10), points: 0, shiftMinutes: 0, messages: 0 }));
    const byDate = new Map(days.map(day => [day.date, day]));
    for (const row of activity) { const day = byDate.get(String(row.activity_date).slice(0, 10)); if (day) day.messages += Number(row.message_count) || 0; }
    for (const row of weekLedger) { const day = byDate.get(new Date(time(row.created_at)).toISOString().slice(0, 10)); if (day) day.points += Number(row.delta) || 0; }
    for (const shift of shifts) { const day = byDate.get(new Date(time(shift.started_at)).toISOString().slice(0, 10)); if (day) day.shiftMinutes += activeMinutes(shift); }

    // ---- آخر 20 شفت + سبب النهاية من سجل الستاف
    const reasonFor = (shift: any) => {
      if (!shift.ended_at) return null;
      if (shift.end_reason) return String(shift.end_reason);
      const ended = time(shift.ended_at);
      const byId = logs.find(log => String(log.details?.shiftId ?? '') === String(shift.id) && END_ACTIONS[log.action]);
      const near = byId ?? logs.find(log => Math.abs(time(log.created_at) - ended) < 2 * 60_000);
      if (near) return END_ACTIONS[near.action] ?? 'manual';
      return activeMinutes(shift) >= 12 * 60 - 1 ? 'auto_12h' : 'manual';
    };
    const recentShifts = shifts.slice(0, 20).map(shift => ({ startedAt: shift.started_at, endedAt: shift.ended_at, durationMinutes: activeMinutes(shift), endReason: reasonFor(shift) }));

    return c.json({
      member: info, status, points, stats, days, shifts: recentShifts,
      ledger: ledger.map(row => ({ id: String(row.id), delta: Number(row.delta) || 0, before: row.points_before, after: row.points_after, source: row.source, reason: row.reason ?? '', actorId: row.actor_id ?? null, at: row.created_at })),
      warnings: warnings.map(row => ({ id: String(row.id), reason: row.reason ?? '', issuedBy: row.issued_by ?? null, automatic: Boolean(row.automatic), active: row.active !== false, at: row.created_at })),
      notes: viewer.id === userId && !viewer.isManagement ? [] : notes.map(row => ({ id: String(row.id), text: row.text, addedBy: row.added_by, at: row.created_at })),
      isSelf: viewer.id === userId,
    });
  });
}
