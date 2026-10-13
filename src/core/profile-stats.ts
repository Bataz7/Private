import type { Guild, User } from '../lib/djs/index.js';
import { supabase } from '../supabase/client.js';
import { activeMs } from '../services/shift.service.js';
import { Staff } from '../models/Staff.js';
import { Complaint } from '../models/Complaint.js';
import { GuildSettings } from '../models/GuildSettings.js';
import { weekPointsOf } from '../services/leaderboard.service.js';
import { isDismissed } from '../discipline/dismissed.js';
import { countActiveWarnings, warnLimitFrom } from './warnings.js';
import type { StaffCardData } from '../utils/staff-card.js';

// Numbers for the staff profile page. Everything here is counted from data the bot really records:
// shifts, messages sent (staff_daily_activity), assists, ratings, mod reports and complaints.
const DAY = 86_400_000;
export const HEAT_DAYS = 84; // 12 weeks

export type DayStat = { date: string; messages: number; shiftMinutes: number };
export type Badge = { key: string; value: number; goal: number };

const dayStart = (ms: number) => Math.floor(ms / DAY) * DAY;

/** One entry per UTC day for the last 84 days, oldest first. A shift counts on the day it started. */
export function buildDays(activity: Array<{ activityDate: Date | string; messageCount?: number }>, shifts: Array<any>, now = Date.now()): DayStat[] {
  const start = dayStart(now) - (HEAT_DAYS - 1) * DAY;
  const days: DayStat[] = Array.from({ length: HEAT_DAYS }, (_, index) => ({ date: new Date(start + index * DAY).toISOString().slice(0, 10), messages: 0, shiftMinutes: 0 }));
  const at = (value: Date | string) => days[Math.floor((new Date(value).getTime() - start) / DAY)];
  for (const row of activity) { const day = at(row.activityDate); if (day) day.messages += row.messageCount || 0; }
  for (const shift of shifts) { const day = at(shift.startedAt); if (day) day.shiftMinutes += Math.round(activeMs(shift) / 60_000); }
  return days;
}

const isActive = (day?: DayStat) => Boolean(day && (day.messages > 0 || day.shiftMinutes > 0));

/** Days in a row with a message or a shift, ending today (or yesterday, when today has no activity yet). */
export function streakOf(days: DayStat[]) {
  let index = days.length - 1;
  if (!isActive(days[index])) index -= 1;
  let streak = 0;
  while (index >= 0 && isActive(days[index])) { streak += 1; index -= 1; }
  return streak;
}

export const activeDaysIn = (days: DayStat[], last: number) => days.slice(-last).filter(isActive).length;

export function shiftStats(shifts: Array<any>) {
  const minutes = shifts.map(shift => Math.round(activeMs(shift) / 60_000));
  const finished = shifts.map((shift, index) => (shift.status === 'active' ? null : minutes[index]!)).filter((value): value is number => value !== null);
  const pool = finished.length ? finished : minutes;
  return { count: shifts.length, avgMinutes: pool.length ? Math.round(pool.reduce((sum, value) => sum + value, 0) / pool.length) : 0, longestMinutes: minutes.length ? Math.max(...minutes) : 0 };
}

/** Mod report counts. The mod report feature keeps its own table; if it is not there yet everything is 0. */
export async function modReportStats(guildId: string, userId: string) {
  const count = async (status: string) => {
    const { count: n, error } = await supabase.from('mod_reports').select('id', { count: 'exact', head: true }).eq('guild_id', guildId).eq('moderator_id', userId).eq('status', status);
    return error ? 0 : n ?? 0;
  };
  const [approved, rejected, pending] = await Promise.all([count('approved'), count('rejected'), count('pending')]);
  const decided = approved + rejected;
  return { total: approved + rejected + pending, approved, rejected, pending, approvalRate: decided ? Math.round((approved / decided) * 100) : null };
}

export function ratingSpread(ratings: Array<{ rating: number }>) {
  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const item of ratings) if (distribution[item.rating] !== undefined) distribution[item.rating]! += 1;
  const average = ratings.length ? Math.round((ratings.reduce((sum, item) => sum + item.rating, 0) / ratings.length) * 10) / 10 : 0;
  return { distribution, average, count: ratings.length };
}

/** Badges with progress, so a locked one shows how far away it is. The page marks a badge earned when value >= goal. */
export function badgesOf(input: { position: number; totalStaff: number; streak: number; longestShiftMinutes: number; assists: number; ratingCount: number; averageRating: number; modApproved: number; messages: number; tenureDays: number }): Badge[] {
  return [
    { key: 'top', value: input.position === 1 && input.totalStaff > 1 ? 1 : 0, goal: 1 },
    { key: 'streak', value: input.streak, goal: 7 },
    { key: 'marathon', value: Math.round((input.longestShiftMinutes / 60) * 10) / 10, goal: 4 },
    { key: 'helper', value: input.assists, goal: 25 },
    { key: 'loved', value: input.averageRating >= 4.5 ? input.ratingCount : 0, goal: 5 },
    { key: 'reporter', value: input.modApproved, goal: 10 },
    { key: 'chatty', value: input.messages, goal: 1000 },
    { key: 'veteran', value: input.tenureDays, goal: 90 },
  ];
}

// What the activity timeline may show. Everyone sees the first group; the member and administrators see all of it,
// because leave, resignation, complaints and point changes are private.
export const PUBLIC_ACTIONS = ['SHIFT_STARTED', 'SHIFT_STARTED_AUTOMATICALLY', 'SHIFT_ENDED', 'SHIFT_AUTO_ENDED', 'ASSISTANCE_RECORDED', 'MOD_REPORT_SUBMITTED'];
export const PRIVATE_ACTIONS = ['SHIFT_PRESENCE_TIMEOUT', 'STAFF_DISMISSED', 'STAFF_REINSTATED', 'BREAK_STARTED', 'BREAK_RESUMED', 'BREAK_AUTO_ENDED', 'LEAVE_REQUESTED', 'LEAVE_APPROVED', 'LEAVE_STARTED', 'LEAVE_EXTENDED', 'RETURNED_FROM_LEAVE', 'RESIGNATION_REQUESTED', 'RESIGNATION_CONFIRMED', 'RESIGNATION_WITHDRAWN', 'COMPLAINT_REVIEWED', 'REPORT_SUBMITTED', 'REPORT_REVIEWED', 'POINTS_ADJUSTED'];

// ---- بطاقة الستاف (/profile و /report stats) ---------------------------------------------------------
type ShiftLite = { started_at: string; ended_at: string | null; status: string; breaks: Array<{ startedAt: string; endedAt: string | null }> | null };

/**
 * كل حقول بطاقة الستاف بأقل عدد استعلامات: الترتيب بعدّ (count head) بدل تحميل كل الستاف، ونقاط الأسبوع من السجل
 * لهذا العضو بس. يرجّع null لو العضو مو مسجل في الستاف أبداً.
 */
export async function staffCardData(guild: Guild, user: User): Promise<StaffCardData | null> {
  const guildId = guild.id;
  const staff = await Staff.findOne({ guildId, userId: user.id }).catch(() => null);
  if (!staff) return null;
  const points = Number(staff.points) || 0;
  const [shiftRows, complaints, ratings, settings, member, above, top, weekPoints, warnings, dismissed] = await Promise.all([
    supabase.from('shifts').select('started_at,ended_at,status,breaks').eq('guild_id', guildId).eq('user_id', user.id).order('started_at', { ascending: false }).limit(5000).then(r => (r.data ?? []) as ShiftLite[]),
    Complaint.countDocuments({ guildId, staffUserId: user.id, status: 'approved' }).catch(() => 0),
    supabase.from('staff_ratings').select('rating').eq('guild_id', guildId).eq('staff_user_id', user.id).limit(5000).then(r => (r.data ?? []) as Array<{ rating: number }>),
    GuildSettings.findOne({ guildId }).catch(() => null),
    guild.members.fetch(user.id).catch(() => null),
    supabase.from('staff').select('id', { count: 'exact', head: true }).eq('guild_id', guildId).eq('active', true).gt('points', points).then(r => r.count ?? 0),
    supabase.from('staff').select('points').eq('guild_id', guildId).eq('active', true).order('points', { ascending: false }).limit(1).then(r => Number(r.data?.[0]?.points) || 0),
    weekPointsOf(guildId, user.id).catch(() => 0),
    countActiveWarnings(guildId, user.id),
    staff.active ? Promise.resolve(false) : isDismissed(guildId, user.id).catch(() => false),
  ]);
  const shifts = shiftRows.map(row => ({ startedAt: new Date(row.started_at), endedAt: row.ended_at ? new Date(row.ended_at) : null, status: row.status, breaks: (row.breaks ?? []).map(b => ({ startedAt: new Date(b.startedAt), endedAt: b.endedAt ? new Date(b.endedAt) : null })) }));
  const current = shifts.find(shift => shift.status === 'active');
  const highest = member?.roles.highest;
  return {
    name: member?.displayName ?? user.globalName ?? user.username,
    avatar: (member ?? user).displayAvatarURL({ extension: 'png', size: 256 }),
    points, complaints,
    shiftHours: shifts.reduce((sum, shift) => sum + activeMs(shift), 0) / 3_600_000,
    voiceHours: (Number(staff.voiceMinutes) || 0) / 60,
    messages: Number(staff.messageCount) || 0,
    helped: Number(staff.claimed) || 0,
    ratingAverage: ratings.length ? ratings.reduce((sum, row) => sum + (Number(row.rating) || 0), 0) / ratings.length : 0,
    ratingCount: ratings.length,
    rank: staff.active ? above + 1 : null,
    topPoints: Math.max(top, points),
    weekPoints,
    warnings, warnLimit: warnLimitFrom(settings?.warnLimit) || undefined,
    onShiftSince: current ? current.startedAt : null,
    roleName: highest && highest.id !== guild.id ? highest.name : undefined,
    dismissed,
  };
}
