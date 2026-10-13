import type { Client, Guild } from '../lib/djs/index.js';
import { supabase } from '../supabase/client.js';
import { env } from '../config/env.js';
import { BRAND_COLOR, e, emojisReady, progressBar } from '../utils/emoji.js';
import { event } from '../utils/terminal.js';
import { V2_FLAG, button, clip, container, row, rtl, section, separator, text, thumbnail, type Raw } from '../utils/v2.js';

const DAY = 86_400_000;

// ---- Settings ----------------------------------------------------------------------------------
// Weekly targets: reaching one gives the full points of its part of the score.
export interface WeeklyTargets { shiftHours: number; activeDays: number; voiceHours: number; messages: number }
export const DEFAULT_TARGETS: WeeklyTargets = { shiftHours: 10, activeDays: 5, voiceHours: 5, messages: 300 };
export type ReportLang = 'en' | 'ar';

/**
 * Per-server weekly report settings, stored in guild_settings (migration 034 adds the columns, 028 has weekly_enabled,
 * weekly_language and weekly_last_run). recipients 'all' sends to every active staff member; 'selected' only to staffIds
 * (ranks and the team summary then cover just those people).
 */
export interface WeeklySettings { enabled: boolean; dmStaff: boolean; dmSummary: boolean; channelId: string; language: ReportLang; recipients: 'all' | 'selected'; staffIds: string[]; targets: WeeklyTargets }
const num = (value: unknown, min: number, max: number, fallback: number) => { const n = Number(value); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback; };

/** Cleans a settings object (from the dashboard or built from a database row) into a safe WeeklySettings. */
export function weeklySettings(raw: unknown, fallbackChannel = '', _fallbackLang: ReportLang = 'ar'): WeeklySettings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const targets = (s.targets && typeof s.targets === 'object' ? s.targets : {}) as Record<string, unknown>;
  return {
    enabled: s.enabled !== false, dmStaff: s.dmStaff !== false,
    // Each person also gets the team report in their DMs, not only their own card (on unless switched off).
    dmSummary: s.dmSummary !== false,
    recipients: s.recipients === 'selected' ? 'selected' : 'all',
    staffIds: [...new Set((Array.isArray(s.staffIds) ? s.staffIds : []).map(String).filter((id: string) => /^\d{15,22}$/.test(id)))].slice(0, 200) as string[],
    channelId: /^\d{15,22}$/.test(String(s.channelId || '')) ? String(s.channelId) : fallbackChannel,
    // البوت عربي دائمًا: التقارير الأسبوعية بالعربي مهما كان المحفوظ.
    language: 'ar',
    targets: { shiftHours: num(targets.shiftHours, 1, 100, DEFAULT_TARGETS.shiftHours), activeDays: num(targets.activeDays, 1, 7, DEFAULT_TARGETS.activeDays), voiceHours: num(targets.voiceHours, 1, 100, DEFAULT_TARGETS.voiceHours), messages: num(targets.messages, 10, 20000, DEFAULT_TARGETS.messages) },
  };
}

/** guild_settings row -> settings. Missing columns (migration 034 not applied yet) just fall back to the defaults. */
export function settingsFromRow(row: Record<string, any> | null | undefined): WeeklySettings {
  const r = row ?? {};
  return weeklySettings({
    enabled: r.weekly_enabled, dmStaff: r.weekly_dm_staff, dmSummary: r.weekly_dm_summary, recipients: r.weekly_recipients, staffIds: r.weekly_staff_ids,
    // null means "never chosen": use the server's report channel. An empty string means "do not post a summary".
    channelId: r.weekly_channel_id ?? r.report_channel_id ?? '', language: r.weekly_language || r.bot_language, targets: r.weekly_targets,
  }, '', 'ar');
}

export function rowFromSettings(s: WeeklySettings) {
  return {
    weekly_enabled: s.enabled, weekly_dm_staff: s.dmStaff, weekly_dm_summary: s.dmSummary, weekly_recipients: s.recipients, weekly_staff_ids: s.staffIds,
    weekly_channel_id: s.channelId, weekly_language: s.language, weekly_targets: s.targets,
  };
}

export async function loadWeeklySettings(guildId: string) {
  const { data, error } = await supabase.from('guild_settings').select('*').eq('guild_id', guildId).maybeSingle();
  if (error) throw new Error(`ما قدرنا نقرأ إعدادات التقرير الأسبوعي: ${error.message}`);
  return { row: data as Record<string, any> | null, settings: settingsFromRow(data) };
}

/** Who a scheduled report goes to: undefined means everyone. */
export const recipientSet = (s: WeeklySettings) => (s.recipients === 'selected' ? new Set(s.staffIds) : undefined);

// Weeks are Monday 00:00 -> Sunday 23:59:59 in UTC, so the host timezone never shifts the window.
export function weekBounds(reference = new Date(), weeksBack = 1) {
  const today = Math.floor(reference.getTime() / DAY) * DAY;
  const weekday = (new Date(today).getUTCDay() + 6) % 7;
  const start = new Date(today - weekday * DAY - weeksBack * 7 * DAY);
  return { start, end: new Date(start.getTime() + 7 * DAY - 1) };
}
const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/** A period counts as "weekly" when it starts on a Monday and is at most 7 days; anything else is scored per its length. */
export function periodDays(start: Date, end: Date) {
  const span = Math.max(1, Math.round((end.getTime() - start.getTime() + 1) / DAY));
  const monday = (start.getUTCDay() + 6) % 7 === 0;
  return monday && span <= 7 ? 7 : span;
}

/** Targets are per week; a longer or shorter period scales them, so a 30-day report is not scored against 7 days. */
export function scaledTargets(targets: WeeklyTargets, days: number): WeeklyTargets {
  if (days === 7) return targets;
  const weeks = days / 7;
  return { shiftHours: Math.max(0.5, targets.shiftHours * weeks), activeDays: Math.min(days, Math.max(1, Math.round(targets.activeDays * weeks))), voiceHours: Math.max(0.5, targets.voiceHours * weeks), messages: Math.max(5, targets.messages * weeks) };
}

// ---- Scoring: one place, so cards, summary and stored rows always agree -------------------------
export const GRADE_STEPS = [{ letter: 'S', min: 90 }, { letter: 'A', min: 75 }, { letter: 'B', min: 60 }, { letter: 'C', min: 40 }, { letter: 'D', min: 0 }] as const;
export const SCORE_WEIGHTS = { shift: 30, activeDays: 15, voice: 15, messages: 15, rating: 15, clean: 10 } as const;
export const COMPLAINT_PENALTY = { each: 8, max: 20 } as const;
export const NO_RATING_DEFAULT = 3.5;
export type Grade = typeof GRADE_STEPS[number]['letter'];
const gradeOf = (score: number): Grade => GRADE_STEPS.find(step => score >= step.min)!.letter;

export interface Metrics {
  userId: string;
  /** Length of the measured period in days (7 for a normal week). */
  days: number;
  shiftHours: number; shifts: number; voiceHours: number; messages: number; activeDays: number;
  engagement: number; engagementLevel: 'elite' | 'high' | 'steady' | 'low';
  busiestDay: string | null; messagesPerHour: number;
  ratingCount: number; ratingAverage: number; overallRating: number; complaints: number;
  pointsTotal: number; pointsGained: number | null;
  score: number; grade: Grade; rank: number; of: number;
  previous: { score: number; shiftHours: number; voiceHours: number; messages: number; activeDays: number } | null;
}

export function scoreParts(input: { shiftHours: number; activeDays: number; voiceHours: number; messages: number; ratingScore: number; complaints: number }, t: WeeklyTargets) {
  const ratio = (value: number, target: number) => Math.min(1, value / Math.max(0.0001, target));
  const parts = [
    { key: 'shift', earned: ratio(input.shiftHours, t.shiftHours) * SCORE_WEIGHTS.shift, max: SCORE_WEIGHTS.shift, value: input.shiftHours, target: t.shiftHours },
    { key: 'activeDays', earned: ratio(input.activeDays, t.activeDays) * SCORE_WEIGHTS.activeDays, max: SCORE_WEIGHTS.activeDays, value: input.activeDays, target: t.activeDays },
    { key: 'voice', earned: ratio(input.voiceHours, t.voiceHours) * SCORE_WEIGHTS.voice, max: SCORE_WEIGHTS.voice, value: input.voiceHours, target: t.voiceHours },
    { key: 'messages', earned: ratio(input.messages, t.messages) * SCORE_WEIGHTS.messages, max: SCORE_WEIGHTS.messages, value: input.messages, target: t.messages },
    { key: 'rating', earned: (input.ratingScore / 5) * SCORE_WEIGHTS.rating, max: SCORE_WEIGHTS.rating, value: input.ratingScore, target: 5 },
    { key: 'clean', earned: input.complaints ? 0 : SCORE_WEIGHTS.clean, max: SCORE_WEIGHTS.clean, value: input.complaints, target: 0 },
  ];
  const penalty = Math.min(COMPLAINT_PENALTY.max, input.complaints * COMPLAINT_PENALTY.each);
  const total = Math.round(Math.max(0, Math.min(100, parts.reduce((sum, part) => sum + part.earned, 0) - penalty)));
  return { parts, penalty, total };
}

/** Engagement: how much of the chat and voice targets the member reached, averaged (0-100). */
export function engagementOf(messages: number, voiceHours: number, t: WeeklyTargets) {
  const value = Math.round(((Math.min(1, messages / t.messages) + Math.min(1, voiceHours / t.voiceHours)) / 2) * 100);
  return { value, level: value >= 90 ? 'elite' as const : value >= 65 ? 'high' as const : value >= 35 ? 'steady' as const : 'low' as const };
}

export function nextGrade(score: number) {
  const above = [...GRADE_STEPS].reverse().find(step => step.min > score);
  return above ? { letter: above.letter, min: above.min, need: above.min - score } : null;
}

// ---- Data --------------------------------------------------------------------------------------
type ShiftRow = { user_id: string; started_at: string; ended_at: string | null; breaks: Array<{ startedAt: string; endedAt: string | null }> | null };

/** Working milliseconds of a shift that fall inside [from, to]: the clipped span minus breaks inside it. */
function activeMsIn(shift: ShiftRow, from: number, to: number, now = Date.now()) {
  const start = Math.max(from, new Date(shift.started_at).getTime());
  const end = Math.min(to, shift.ended_at ? new Date(shift.ended_at).getTime() : now);
  if (end <= start) return 0;
  let paused = 0;
  for (const pause of shift.breaks ?? []) {
    const a = Math.max(start, new Date(pause.startedAt).getTime());
    const b = Math.min(end, pause.endedAt ? new Date(pause.endedAt).getTime() : now);
    if (b > a) paused += b - a;
  }
  return Math.max(0, end - start - paused);
}

async function rows<T>(query: PromiseLike<{ data: T[] | null; error: { message: string } | null }>, label: string): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw new Error(`التقرير الأسبوعي: فشل استعلام ${label}: ${error.message}`);
  return data ?? [];
}

export async function computeWeek(guildId: string, start: Date, end: Date, baseTargets: WeeklyTargets = DEFAULT_TARGETS, include?: Set<string>): Promise<Metrics[]> {
  const from = start.getTime(); const to = end.getTime();
  const days_ = periodDays(start, end);
  const targets = scaledTargets(baseTargets, days_);
  const staffRows = (await rows(supabase.from('staff').select('user_id, points').eq('guild_id', guildId).eq('active', true), 'staff')).filter(row => !include || include.has((row as any).user_id));
  const [shifts, activity, ratings, allRatings, complaints, previousReports] = await Promise.all([
    rows<ShiftRow>(supabase.from('shifts').select('user_id, started_at, ended_at, breaks').eq('guild_id', guildId).lte('started_at', end.toISOString()).or(`ended_at.is.null,ended_at.gte.${start.toISOString()}`), 'shifts'),
    rows<any>(supabase.from('staff_daily_activity').select('user_id, activity_date, message_count, voice_minutes').eq('guild_id', guildId).gte('activity_date', isoDay(start)).lte('activity_date', isoDay(end)), 'activity'),
    rows<any>(supabase.from('staff_ratings').select('staff_user_id, rating').eq('guild_id', guildId).gte('created_at', start.toISOString()).lte('created_at', end.toISOString()), 'ratings'),
    rows<any>(supabase.from('staff_ratings').select('staff_user_id, rating').eq('guild_id', guildId), 'all ratings'),
    rows<any>(supabase.from('complaints').select('staff_user_id').eq('guild_id', guildId).eq('status', 'approved').gte('reviewed_at', start.toISOString()).lte('reviewed_at', end.toISOString()), 'complaints'),
    // Week-over-week trends only make sense for weekly reports.
    days_ === 7 ? rows<any>(supabase.from('staff_reports').select('*').eq('guild_id', guildId).eq('automated', true).lt('period_end', start.toISOString()).order('period_end', { ascending: false }).limit(1000), 'previous reports') : Promise.resolve([] as any[]),
  ]);
  const average = (list: any[], id: string) => { const own = list.filter(item => item.staff_user_id === id); return { n: own.length, avg: own.length ? own.reduce((sum, item) => sum + Number(item.rating), 0) / own.length : 0 }; };
  const previous = new Map<string, any>();
  for (const report of previousReports) if (!previous.has(report.staff_user_id)) previous.set(report.staff_user_id, report);

  const metrics: Metrics[] = staffRows.map((staff: any) => {
    const id = staff.user_id as string;
    const ownShifts = shifts.filter(shift => shift.user_id === id);
    const days = activity.filter(item => item.user_id === id);
    const shiftMs = ownShifts.reduce((sum, shift) => sum + activeMsIn(shift, from, to), 0);
    const shiftCount = ownShifts.filter(shift => activeMsIn(shift, from, to) > 0).length;
    const messages = days.reduce((sum, item) => sum + (item.message_count || 0), 0);
    const voiceHours = days.reduce((sum, item) => sum + (item.voice_minutes || 0), 0) / 60;
    const dayKeys = new Set(days.filter(item => (item.message_count || 0) > 0 || (item.voice_minutes || 0) > 0).map(item => String(item.activity_date).slice(0, 10)));
    for (const shift of ownShifts) if (activeMsIn(shift, from, to) > 0) dayKeys.add(isoDay(new Date(Math.max(from, new Date(shift.started_at).getTime()))));
    const busiest = [...days].sort((a, b) => ((b.message_count || 0) + (b.voice_minutes || 0)) - ((a.message_count || 0) + (a.voice_minutes || 0)))[0];
    const shiftHours = shiftMs / 3_600_000;
    const week = average(ratings, id); const overall = average(allRatings, id);
    const complaintCount = complaints.filter(item => item.staff_user_id === id).length;
    const prev = previous.get(id);
    const eng = engagementOf(messages, voiceHours, targets);
    const score = scoreParts({ shiftHours, activeDays: dayKeys.size, voiceHours, messages, ratingScore: week.n ? week.avg : (overall.avg || NO_RATING_DEFAULT), complaints: complaintCount }, targets).total;
    const points = Number(staff.points) || 0;
    return {
      userId: id, days: days_, shiftHours, shifts: shiftCount, voiceHours, messages, activeDays: dayKeys.size,
      engagement: eng.value, engagementLevel: eng.level,
      busiestDay: busiest && ((busiest.message_count || 0) + (busiest.voice_minutes || 0)) > 0 ? String(busiest.activity_date).slice(0, 10) : null,
      messagesPerHour: shiftHours > 0.25 ? messages / shiftHours : 0,
      ratingCount: week.n, ratingAverage: week.avg, overallRating: overall.avg, complaints: complaintCount,
      pointsTotal: points, pointsGained: prev && typeof prev.points_total === 'number' && prev.points_total > 0 ? points - prev.points_total : null,
      score, grade: gradeOf(score), rank: 0, of: staffRows.length,
      previous: prev ? { score: prev.score || 0, shiftHours: Number(prev.shift_hours) || 0, voiceHours: Number(prev.voice_hours) || 0, messages: prev.message_count || 0, activeDays: prev.active_days || 0 } : null,
    };
  });
  [...metrics].sort((a, b) => b.score - a.score || b.shiftHours - a.shiftHours).forEach((item, index) => { item.rank = index + 1; });
  return metrics;
}

// ---- Rendering (all cards use Rift purple) ------------------------------------------------------
const bar = (value: number) => (emojisReady() ? progressBar(value / 100) : `\`${progressBar(value / 100)}\``);
const hours = (value: number) => `${(Math.round(value * 10) / 10).toFixed(1)} ساعة`;
const trend = (now: number, before: number | undefined) => {
  if (before === undefined) return '';
  if (!before) return now ? ' `▲ جديد`' : '';
  const change = Math.round(((now - before) / before) * 100);
  return change === 0 ? ' `= 0%`' : change > 0 ? ` \`▲ ${change}%\`` : ` \`▼ ${Math.abs(change)}%\``;
};
const locale = (lang: ReportLang) => (lang === 'ar' ? 'ar-SA-u-nu-latn-ca-gregory' : 'en-US');
const range = (start: Date, end: Date, lang: ReportLang = 'ar') => { const f = new Intl.DateTimeFormat(locale(lang), { month: 'short', day: 'numeric', timeZone: 'UTC' }); return `${f.format(start)} – ${f.format(end)}`; };
const LEVEL = { elite: ['نخبة', 'Elite'], high: ['عالي', 'High'], steady: ['ثابت', 'Steady'], low: ['منخفض', 'Low'] } as const;
const weekday = (day: string, lang: ReportLang = 'ar') => new Intl.DateTimeFormat(locale(lang), { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
// البوت عربي دائمًا: pick يرجّع النص العربي.
const tx = (value: string) => text(rtl(value));
const rtlAll = (values: string[]) => values.map(rtl);
const pick = (_lang: ReportLang) => (ar: string, _en: string) => ar;

function tip(m: Metrics, base: WeeklyTargets, lang: ReportLang) {
  const L = pick(lang);
  const t = scaledTargets(base, m.days);
  if (m.complaints) return `${e('warn')} ${L('وصلتك شكوى مقبولة في هذي الفترة، راجع طريقة تعاملك مع الأعضاء.', 'You had an approved complaint in this period. Review how you handle members.')}`;
  const gaps = [
    { gap: 1 - m.activeDays / t.activeDays, text: L(`حاول تكون متواجد ${base.activeDays} أيام على الأقل في الأسبوع.`, `Be on duty at least ${base.activeDays} days a week.`) },
    { gap: 1 - m.shiftHours / t.shiftHours, text: L(`افتح شفتات أكثر، الهدف ${base.shiftHours} ساعات أسبوعيًا.`, `Spend more time on shift. The target is ${base.shiftHours}h a week.`) },
    { gap: 1 - m.voiceHours / t.voiceHours, text: L(`ادخل الفويس أكثر، الهدف ${base.voiceHours} ساعات أسبوعيًا.`, `Join voice more often. The target is ${base.voiceHours}h a week.`) },
    { gap: 1 - m.messages / t.messages, text: L('تفاعل أكثر في الشات وساعد الأعضاء.', 'Be more active in chat and help members out.') },
  ].sort((a, b) => b.gap - a.gap)[0]!;
  return gaps.gap <= 0 ? `${e('fire')} ${L('أداء ممتاز في كل المحاور، استمر!', 'Excellent across the board. Keep it up!')}` : `${e('idea')} ${gaps.text}`;
}

export function staffReportPayload(m: Metrics, t: WeeklyTargets, info: { name: string; avatar: string }, start: Date, end: Date, note = '', lang: ReportLang = 'ar'): Raw {
  const L = pick(lang);
  const p = m.previous;
  const next = nextGrade(m.score);
  const weekly = m.days === 7;
  const st = scaledTargets(t, m.days);
  const lines = [
    `${e('timer')} **${L('ساعات الشفت', 'Shift hours')}:** ${hours(m.shiftHours)} ${L('في', 'across')} ${m.shifts} ${L('شفت', `shift${m.shifts === 1 ? '' : 's'}`)}${trend(m.shiftHours, p?.shiftHours)}`,
    `${e('voice')} **${L('ساعات الفويس', 'Voice hours')}:** ${hours(m.voiceHours)}${trend(m.voiceHours, p?.voiceHours)}`,
    `${e('chat')} **${L('الرسائل', 'Messages')}:** ${m.messages.toLocaleString('en-US')}${trend(m.messages, p?.messages)}${m.messagesPerHour ? ` · ${Math.round(m.messagesPerHour)}/ساعة ${L('في الشفت', 'on shift')}` : ''}`,
    `${e('calendar')} **${L('أيام النشاط', 'Active days')}:** ${m.activeDays}/${m.days}${trend(m.activeDays, p?.activeDays)}${m.busiestDay ? ` · ${L('الأنشط', 'busiest')} ${weekday(m.busiestDay, lang)}` : ''}`,
    `${e('star')} **${L('التقييم', 'Rating')}:** ${m.ratingCount ? `${m.ratingAverage.toFixed(1)}/5 · ${m.ratingCount} ${weekly ? L('تقييم هذا الأسبوع', 'this week') : L('تقييم', 'ratings')}` : m.overallRating ? `${m.overallRating.toFixed(1)}/5 ${L('إجمالي', 'overall')}` : '—'}`,
    `${e('points')} **${L('النقاط', 'Points')}:** ${m.pointsGained === null ? m.pointsTotal : `${m.pointsGained >= 0 ? '+' : ''}${m.pointsGained} · ${L('الإجمالي', 'total')} ${m.pointsTotal}`}`,
    `${e('warn')} **${L('الشكاوى المقبولة', 'Approved complaints')}:** ${m.complaints}`,
  ];
  const highlights: string[] = [];
  if (m.rank <= 3 && m.score >= 40 && m.of > 1) highlights.push(`${e('trophy')} ${weekly ? L(`من أفضل 3 في الفريق هذا الأسبوع (المركز ${m.rank})`, `Top 3 in the team this week (#${m.rank})`) : L(`من أفضل 3 في الفريق في هذي الفترة (المركز ${m.rank})`, `Top 3 in the team this period (#${m.rank})`)}`);
  if (p && m.score - p.score >= 10) highlights.push(`${e('trend')} ${L(`تحسّن بمقدار ${m.score - p.score} نقطة عن الأسبوع الماضي`, `Improved by ${m.score - p.score} points since last week`)}`);
  const parts: Raw[] = [
    section(rtlAll([
      `## ${e('chart')} ${weekly ? L('تقريرك الأسبوعي', 'Your weekly report') : L('تقرير أدائك', 'Your performance report')}\n-# ${range(start, end, lang)}`,
      `**${clip(info.name, 80)}** · ${L('التقدير', 'Grade')} **${m.grade}** · **${m.score}**/100 · ${L('المركز', 'Rank')} **#${m.rank}** ${L('من', 'of')} ${m.of}${p ? trend(m.score, p.score) : ''}`,
    ]), thumbnail(info.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png')),
    tx(`${bar(m.score)}  **${m.score}%**`),
    separator(),
    tx(`### ${e('engage')} ${L('التفاعل', 'Engagement')} · **${LEVEL[m.engagementLevel][0]}**\n${bar(m.engagement)}  **${m.engagement}%**\n-# ${L(`الشات والفويس مقارنة بالأهداف (${Math.round(st.messages)} رسالة، ${Math.round(st.voiceHours * 10) / 10} ساعة فويس)`, `Chat and voice, measured against the targets (${Math.round(st.messages)} messages, ${Math.round(st.voiceHours * 10) / 10}h voice)`)}`),
    separator(),
    text(lines.join('\n')),
    separator(),
    tx([...highlights, next ? `${e('up')} ${L(`الدرجة الجاية: **${next.letter}** من ${next.min}. ناقصك **${next.need}** نقطة.`, `Next grade: **${next.letter}** at ${next.min}. You need **${next.need}** more points.`)}` : `${e('crown')} ${L('أنت في أعلى درجة (S)، استمر!', 'You are at the top grade (S). Keep it up!')}`, tip(m, t, lang)].join('\n')),
  ];
  if (note) parts.push(tx(`${e('edit')} **${L('ملاحظة الإدارة', 'Note from management')}**\n> ${clip(note, 900).replace(/\n/g, '\n> ')}`));
  parts.push(tx(`-# ستاف Rift${weekly ? ` · ${L('ينرسل كل يوم اثنين', 'sent every Monday')}` : ''}`));
  if (/^https?:\/\//.test(env.dashboardUrl)) parts.push(row([button({ url: `${env.dashboardUrl}/p/${m.userId}`, label: L('ملفي الشخصي', 'My profile'), emoji: '👤' }), button({ url: `${env.dashboardUrl}/dashboard/grades`, label: L('كيف تنحسب الدرجة', 'How grades work'), emoji: 'ℹ️' })]));
  return { flags: V2_FLAG, components: [container(parts, BRAND_COLOR)], allowedMentions: { parse: [] as never[] } };
}

export function teamSummaryPayload(metrics: Metrics[], guildName: string, start: Date, end: Date, lang: ReportLang = 'ar'): Raw {
  const L = pick(lang);
  const days = metrics[0]?.days ?? 7;
  const ranked = [...metrics].sort((a, b) => a.rank - b.rank);
  const sum = (pickValue: (m: Metrics) => number) => metrics.reduce((total, item) => total + pickValue(item), 0);
  const rated = metrics.filter(item => item.ratingCount);
  const medals = [e('first'), e('second'), e('third'), '4.', '5.'];
  const improved = metrics.filter(item => item.previous).map(item => ({ item, delta: item.score - item.previous!.score })).sort((a, b) => b.delta - a.delta)[0];
  const voiceLeader = [...metrics].sort((a, b) => b.voiceHours - a.voiceHours)[0];
  const chatLeader = [...metrics].sort((a, b) => b.messages - a.messages)[0];
  const idle = metrics.filter(item => !item.activeDays && !item.shiftHours);
  const average = metrics.length ? Math.round(sum(item => item.score) / metrics.length) : 0;
  const engagement = metrics.length ? Math.round(sum(item => item.engagement) / metrics.length) : 0;
  const parts: Raw[] = [
    tx(`# ${e('chart')} ${days === 7 ? L('التقرير الأسبوعي للفريق', 'Weekly team report') : L('تقرير أداء الفريق', 'Team performance report')}\n-# ${guildName} · ${range(start, end, lang)}`),
    separator(),
    tx([
      `${e('timer')} **${hours(sum(item => item.shiftHours))}** ${L('شفتات', 'on shift')} · ${e('voice')} **${hours(sum(item => item.voiceHours))}** ${L('فويس', 'in voice')} · ${e('chat')} **${sum(item => item.messages).toLocaleString('en-US')}** ${L('رسالة', 'messages')}`,
      `${e('star')} **${rated.length ? (rated.reduce((total, item) => total + item.ratingAverage, 0) / rated.length).toFixed(1) : '—'}** ${L('متوسط التقييم', 'avg rating')} · ${e('trend')} **${average}**/100 ${L('متوسط الأداء', 'avg score')} · ${e('engage')} **${engagement}%** ${L('متوسط التفاعل', 'avg engagement')}`,
    ].join('\n')),
    separator(),
    tx(`### ${e('trophy')} ${L('الأفضل', 'Top performers')}\n${ranked.slice(0, 5).map((item, index) => `${medals[index]} <@${item.userId}> — **${item.score}** · ${item.grade} · ${hours(item.shiftHours)} ${L('شفت', 'shift')} · ${hours(item.voiceHours)} ${L('فويس', 'voice')}`).join('\n') || '—'}`),
  ];
  const leaders: string[] = [];
  if (voiceLeader && voiceLeader.voiceHours > 0) leaders.push(`${e('voice')} ${L('الأكثر وقتًا في الفويس', 'Most voice time')}: <@${voiceLeader.userId}> (${hours(voiceLeader.voiceHours)})`);
  if (chatLeader && chatLeader.messages > 0) leaders.push(`${e('chat')} ${L('الأنشط في الشات', 'Most active in chat')}: <@${chatLeader.userId}> (${chatLeader.messages.toLocaleString('en-US')})`);
  if (improved && improved.delta > 0) leaders.push(`${e('trend')} ${L('الأكثر تحسنًا', 'Most improved')}: <@${improved.item.userId}> (+${improved.delta})`);
  if (leaders.length) parts.push(tx(`### ${e('fire')} ${L('أبرز اللحظات', 'Highlights')}\n${leaders.join('\n')}`));
  if (idle.length) parts.push(tx(`### ${e('moon')} ${L('بدون نشاط', 'No activity')}\n${idle.slice(0, 15).map(item => `<@${item.userId}>`).join(' ')}${idle.length > 15 ? ` +${idle.length - 15}` : ''}`));
  parts.push(tx(`-# ${GRADE_STEPS.map(step => `${step.letter} ${step.min}+`).join(' · ')}\n-# ${metrics.length} ${L('عضو في الفريق', 'staff members')}`));
  if (/^https?:\/\//.test(env.dashboardUrl)) parts.push(row([button({ url: `${env.dashboardUrl}/dashboard/reports`, label: L('فتح التقارير', 'Open reports'), emoji: '📊' })]));
  return { flags: V2_FLAG, components: [container(parts, BRAND_COLOR)], allowedMentions: { parse: [] as never[] } };
}

// ---- Job ---------------------------------------------------------------------------------------
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function memberInfo(guild: Guild, userId: string) {
  const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
  return { name: member?.displayName || userId, avatar: member?.user.displayAvatarURL({ extension: 'png', size: 128 }) || '', member };
}

export interface DeliverOptions {
  automated: boolean; authorId: string;
  /** DM each person their own card. */
  dm: boolean;
  /** Also DM the team report after each card (needs dm). Defaults to true. */
  dmSummary?: boolean;
  /** Post the team summary in the report channel. Defaults to true. */
  summary?: boolean;
  note?: string; targets?: WeeklyTargets; lang?: ReportLang;
}

/** Saves each report, DMs the member their card, and posts the team summary to the report channel. */
export async function deliverReports(client: Client, guild: Guild, reportChannelId: string | null, metrics: Metrics[], start: Date, end: Date, options: DeliverOptions) {
  const targets = options.targets ?? DEFAULT_TARGETS;
  const lang = options.lang ?? 'ar';
  let dms = 0; const unreachable: string[] = [];
  // The team report is the same for everyone, so it is built once and sent after each person's own card.
  const team = options.dm && (options.dmSummary ?? true) && metrics.length > 1 ? teamSummaryPayload(metrics, guild.name, start, end, lang) : null;
  for (const m of metrics) {
    const saved = await supabase.from('staff_reports').insert({
      guild_id: guild.id, staff_user_id: m.userId, author_user_id: options.authorId, period_start: start.toISOString(), period_end: end.toISOString(), note: options.note || '', automated: options.automated,
      shift_hours: m.shiftHours, activity_hours: m.messages / 60, helped: 0, message_count: m.messages, active_days: m.activeDays, points: m.pointsGained ?? m.pointsTotal,
      voice_hours: m.voiceHours, complaints: m.complaints, rating_average: m.ratingCount ? m.ratingAverage : m.overallRating, rating_count: m.ratingCount,
      score: m.score, grade: m.grade, rank: m.rank, engagement: m.engagement, points_total: m.pointsTotal,
    });
    if (saved.error) console.error('Weekly report save failed:', saved.error.message);
    if (!options.dm) continue;
    const info = await memberInfo(guild, m.userId);
    const ok = info.member ? await info.member.send(staffReportPayload(m, targets, info, start, end, options.note || '', lang)).then(() => true).catch(() => false) : false;
    if (ok) dms += 1; else unreachable.push(info.name);
    // A failed team card never counts against the person: their own report already arrived.
    if (ok && team && info.member) await info.member.send(team).catch(() => undefined);
    // Gentle pace so a big team does not run into Discord's rate limit for private messages.
    if (metrics.length > 5) await sleep(ok && team ? 600 : 350);
  }
  let posted = false;
  if ((options.summary ?? true) && reportChannelId && metrics.length) {
    const channel: any = await client.channels.fetch(reportChannelId).catch(() => null);
    if (channel?.isTextBased?.() && 'send' in channel && channel.guildId === guild.id) posted = await channel.send(teamSummaryPayload(metrics, guild.name, start, end, lang)).then(() => true).catch((error: unknown) => { console.error('Team summary failed:', error); return false; });
  }
  return { staff: metrics.length, dms, unreachable, posted };
}

/** Claims the week for a server atomically, so the bot and the dashboard never both send. */
async function claimWeek(guildId: string, key: string, start: Date) {
  const claim = await supabase.from('guild_settings').update({ weekly_last_run: key }).eq('guild_id', guildId).or(`weekly_last_run.is.null,weekly_last_run.neq.${key}`).select('guild_id');
  if (!claim.error) return claim.data?.length ? 'claimed' as const : 'already' as const;
  // Migration 028 is not applied yet: fall back to "does this week already have automated reports?".
  const existing = await supabase.from('staff_reports').select('id', { count: 'exact', head: true }).eq('guild_id', guildId).eq('automated', true).eq('period_start', start.toISOString());
  return (existing.count ?? 0) > 0 ? 'already' as const : 'claimed' as const;
}

export async function runWeeklyForGuild(client: Client, guild: Guild, { force = false } = {}) {
  const { row: guildRow, settings } = await loadWeeklySettings(guild.id);
  if (!guildRow) return { skipped: 'not configured' };
  if (!settings.enabled && !force) return { skipped: 'disabled' };
  const { start, end } = weekBounds();
  const key = isoDay(start);
  // "Only selected staff" with nobody selected sends nothing, and must not use up this week's send.
  const include = recipientSet(settings);
  if (include && !include.size && !force) return { skipped: 'no staff selected' };
  if (!force && await claimWeek(guild.id, key, start) === 'already') return { skipped: 'already sent' };
  try {
    let metrics = await computeWeek(guild.id, start, end, settings.targets, include);
    // A retry after a failed attempt skips people who already have this week's automated report (no double DMs).
    if (!force) {
      const done = new Set((await rows<any>(supabase.from('staff_reports').select('staff_user_id').eq('guild_id', guild.id).eq('automated', true).eq('period_start', start.toISOString()), 'sent reports')).map(item => item.staff_user_id));
      metrics = metrics.filter(item => !done.has(item.userId));
    }
    const result = await deliverReports(client, guild, settings.channelId || null, metrics, start, end, {
      automated: true, authorId: client.user?.id || guild.ownerId, dm: settings.dmStaff, dmSummary: settings.dmSummary, summary: true, targets: settings.targets, lang: settings.language,
    });
    event('report', `التقارير الأسبوعية لـ ${guild.name}: ${result.staff} إداري، ${result.dms} رسالة خاص${result.unreachable.length ? `، ${result.unreachable.length} ما وصلتهم` : ''}${result.posted ? '، وانرسل ملخص الفريق' : ''}`);
    return result;
  } catch (error) {
    // The week was claimed before sending; a failure must not mark it as sent for good.
    if (!force) await supabase.from('guild_settings').update({ weekly_last_run: null }).eq('guild_id', guild.id).eq('weekly_last_run', key);
    throw error;
  }
}

export async function runWeeklyReports(client: Client) {
  // Reports go out on Monday (UTC) for the week that just ended; if the bot was offline, the next start sends them.
  for (const guild of client.guilds.cache.values()) {
    await runWeeklyForGuild(client, guild).catch(error => console.error(`Weekly reports failed for ${guild.id}:`, error));
  }
}

/** "Send now" from the dashboard: the chosen staff (or everyone) for any period, measured exactly like the weekly report. */
export async function sendReportsNow(client: Client, guild: Guild, input: { userIds: string[] | 'all'; start: Date; end: Date; note: string; summary: boolean; dmSummary?: boolean; authorId: string }) {
  const { settings } = await loadWeeklySettings(guild.id);
  const include = input.userIds === 'all' ? undefined : new Set(input.userIds);
  const metrics = await computeWeek(guild.id, input.start, input.end, settings.targets, include);
  if (!metrics.length) throw new Error('ولا أحد من اللي اخترتهم إداري فعّال.');
  const result = await deliverReports(client, guild, settings.channelId || null, metrics, input.start, input.end, {
    automated: false, authorId: input.authorId, dm: true, dmSummary: input.dmSummary ?? settings.dmSummary, summary: input.summary, note: input.note, targets: settings.targets, lang: settings.language,
  });
  return { ...result, days: metrics[0]!.days, average: Math.round(metrics.reduce((sum, item) => sum + item.score, 0) / metrics.length) };
}

/** Current week so far, for one member: used to preview the report. */
export async function previewForMember(client: Client, guild: Guild, targetUserId: string, recipientId: string) {
  const { settings } = await loadWeeklySettings(guild.id);
  const { start } = weekBounds(new Date(), 0);
  const end = new Date();
  const metrics = await computeWeek(guild.id, start, end, settings.targets);
  const m = metrics.find(item => item.userId === targetUserId);
  if (!m) throw new Error('هذا العضو مو إداري فعّال.');
  const info = await memberInfo(guild, targetUserId);
  const recipient = await client.users.fetch(recipientId);
  await recipient.send(staffReportPayload(m, settings.targets, info, start, end, '', settings.language));
  await recipient.send(teamSummaryPayload(metrics, guild.name, start, end, settings.language)).catch(() => undefined);
  return m;
}
