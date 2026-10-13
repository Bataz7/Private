import type { Request } from 'express';
import type { Guild } from '../lib/djs/index.js';
import type { DashboardContext, DashboardExtension } from '../dashboard/extensions.js';
import { createLog } from '../services/log.service.js';
import {
  COMPLAINT_PENALTY, GRADE_STEPS, NO_RATING_DEFAULT, SCORE_WEIGHTS, computeWeek, loadWeeklySettings, nextGrade, previewForMember, rowFromSettings, scoreParts, sendReportsNow, weekBounds, weeklySettings, type Metrics,
} from '../services/weekly-report.service.js';

const DAY = 86_400_000;
const sending = new Set<string>();
const migrationHint = 'Weekly report settings need database migration 034_reports_status.sql. Run it in the Supabase SQL editor, then try again.';
const isSchemaError = (error: { message?: string; code?: string } | null | undefined) => Boolean(error && (/column|schema cache|does not exist/i.test(error.message || '') || ['42703', 'PGRST204', 'PGRST205'].includes(error.code || '')));

/** Owner or Administrator of the selected server. Unlike requireAdministrator it never sends a 403 by itself. */
async function isAdmin(ctx: DashboardContext, req: Request) {
  const user = ctx.sessionUser(req);
  if (!user) return false;
  if (user.isOwner || user.isAdministrator) return true;
  try {
    const guild = await ctx.getGuild(ctx.selectedGuildId(req));
    if (guild.ownerId === user.id) return true;
    const member = guild.members.cache.get(user.id) ?? await guild.members.fetch(user.id).catch(() => null);
    return Boolean(member?.permissions.has('Administrator'));
  } catch { return false; }
}

type Person = { userId: string; displayName: string; username: string; avatar: string };
/** Display info for many user ids: guild cache first, then one bulk fetch for whoever is missing. */
async function people(guild: Guild, ids: string[]) {
  const unique = [...new Set(ids)];
  const missing = unique.filter(id => !guild.members.cache.has(id));
  for (let i = 0; i < missing.length; i += 100) await guild.members.fetch({ user: missing.slice(i, i + 100) }).catch(() => undefined);
  const out = new Map<string, Person>();
  for (const id of unique) {
    const member = guild.members.cache.get(id);
    out.set(id, { userId: id, displayName: member?.displayName ?? member?.user.username ?? id, username: member?.user.username ?? id, avatar: member?.displayAvatarURL({ extension: 'png', size: 128 }) ?? '' });
  }
  return out;
}

async function activeStaffIds(ctx: DashboardContext, guildId: string) {
  const { data, error } = await ctx.supabase.from('staff').select('user_id').eq('guild_id', guildId).eq('active', true);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: any) => String(row.user_id));
}

const reportView = (row: any, person?: Person) => ({
  id: row.id, staffUserId: row.staff_user_id, authorUserId: row.author_user_id, periodStart: row.period_start, periodEnd: row.period_end, note: row.note ?? '', automated: Boolean(row.automated),
  shiftHours: Number(row.shift_hours) || 0, activityHours: Number(row.activity_hours) || 0, messageCount: row.message_count || 0, activeDays: row.active_days || 0, points: row.points || 0,
  voiceHours: Number(row.voice_hours) || 0, complaints: row.complaints || 0, ratingAverage: Number(row.rating_average) || 0, ratingCount: row.rating_count || 0,
  score: typeof row.score === 'number' ? row.score : null, grade: row.grade ?? null, rank: row.rank || 0, engagement: Number(row.engagement) || 0, pointsTotal: row.points_total || 0, createdAt: row.created_at,
  displayName: person?.displayName ?? row.staff_user_id, username: person?.username ?? row.staff_user_id, avatar: person?.avatar ?? '',
});

const round1 = (value: number) => Math.round(value * 10) / 10;
const breakdown = (m: Metrics, targets: ReturnType<typeof weeklySettings>['targets']) => {
  const rating = m.ratingCount ? m.ratingAverage : (m.overallRating || NO_RATING_DEFAULT);
  const result = scoreParts({ shiftHours: m.shiftHours, activeDays: m.activeDays, voiceHours: m.voiceHours, messages: m.messages, ratingScore: rating, complaints: m.complaints }, targets);
  return { penalty: result.penalty, parts: result.parts.map(part => ({ key: part.key, earned: round1(part.earned), max: part.max, value: round1(part.value), target: round1(part.target) })) };
};

export const reportsDashboard: DashboardExtension = {
  name: 'reports',
  styles: ['reports-status'],
  mountApi(ctx) {
    const { app, supabase, discord } = ctx;

    // Report history: administrators see everyone's, staff only their own.
    app.get('/api/staff-reports', async (req, res) => {
      try {
        const guildId = ctx.selectedGuildId(req);
        const admin = await isAdmin(ctx, req);
        const me = ctx.sessionUser(req);
        let query = supabase.from('staff_reports').select('*').eq('guild_id', guildId).order('created_at', { ascending: false }).limit(200);
        if (!admin) query = query.eq('staff_user_id', me?.id ?? '-');
        const { data, error } = await query;
        if (error) throw new Error(error.message);
        const guild = await ctx.getGuild(guildId);
        const map = await people(guild, (data ?? []).map((row: any) => String(row.staff_user_id)));
        res.json({ reports: (data ?? []).map((row: any) => reportView(row, map.get(String(row.staff_user_id)))), canCreate: admin });
      } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Could not load reports.' }); }
    });

    app.get('/api/weekly-reports/settings', async (req, res) => {
      if (!await ctx.requireAdministrator(req, res)) return;
      try {
        const guildId = ctx.selectedGuildId(req);
        const guild = await ctx.getGuild(guildId);
        const { row, settings } = await loadWeeklySettings(guildId);
        const [ids, channels] = await Promise.all([activeStaffIds(ctx, guildId), guild.channels.fetch().catch(() => guild.channels.cache)]);
        const map = await people(guild, ids);
        const staff = [...map.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
        res.json({
          settings, lastRun: row?.weekly_last_run || null, nextRun: weekBounds(new Date(), -1).start.toISOString(), configured: Boolean(row),
          // The columns from migration 034 are missing when their values come back undefined.
          migrated: Boolean(row) && 'weekly_dm_staff' in row!,
          staff, channels: [...channels.values()].filter(channel => channel?.isTextBased() && !channel.isThread()).map(channel => ({ id: channel!.id, name: channel!.name })),
        });
      } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Could not load the weekly report settings.' }); }
    });

    app.put('/api/weekly-reports/settings', async (req, res) => {
      if (!await ctx.requireAdministrator(req, res)) return;
      try {
        const guildId = ctx.selectedGuildId(req);
        const guild = await ctx.getGuild(guildId);
        const next = weeklySettings(req.body, '', 'en');
        if (next.channelId) {
          const channel = guild.channels.cache.get(next.channelId) ?? await guild.channels.fetch(next.channelId).catch(() => null);
          if (!channel?.isTextBased()) return res.status(400).json({ error: 'Choose a text channel in this server.' });
        }
        // Only people who are active staff can be chosen.
        const active = new Set(await activeStaffIds(ctx, guildId));
        next.staffIds = next.staffIds.filter(id => active.has(id));
        if (next.recipients === 'selected' && !next.staffIds.length) return res.status(400).json({ error: 'Choose at least one staff member, or switch to all active staff.' });
        const { data, error } = await supabase.from('guild_settings').update(rowFromSettings(next)).eq('guild_id', guildId).select('guild_id');
        if (error) {
          if (isSchemaError(error)) { console.error(`[reports] ${migrationHint} (${error.message})`); return res.status(400).json({ error: migrationHint }); }
          throw new Error(error.message);
        }
        if (!data?.length) return res.status(404).json({ error: 'Set up this server first (Server settings).' });
        res.json({ settings: next });
      } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Could not save the weekly report settings.' }); }
    });

    // Preview to yourself: this week so far, for you or for a chosen staff member.
    app.post('/api/weekly-reports/preview', async (req, res) => {
      if (!await ctx.requireAdministrator(req, res)) return;
      try {
        const guild = await ctx.getGuild(ctx.selectedGuildId(req));
        const viewerId = ctx.sessionUser(req)?.id ?? '';
        const target = String(req.body?.staffUserId || viewerId);
        const metrics = await previewForMember(discord, guild, target, viewerId);
        res.json({ ok: true, metrics: { score: metrics.score, grade: metrics.grade, rank: metrics.rank, of: metrics.of } });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not send the preview.';
        res.status(400).json({ error: /Cannot send messages to this user/i.test(message) ? 'Rift could not DM you. Open your DMs for this server and try again.' : message });
      }
    });

    // Send now: the chosen staff for any period, measured exactly like the weekly report.
    app.post('/api/staff-reports/send', async (req, res) => {
      if (!await ctx.requireAdministrator(req, res)) return;
      const guildId = ctx.selectedGuildId(req);
      if (sending.has(guildId)) return res.status(429).json({ error: 'Reports are already being sent. Wait for them to finish.' });
      sending.add(guildId);
      try {
        const guild = await ctx.getGuild(guildId);
        const raw = req.body?.staffUserIds;
        const userIds = raw === 'all' ? 'all' as const : [...new Set((Array.isArray(raw) ? raw : []).map(String).filter((id: string) => /^\d{15,22}$/.test(id)))].slice(0, 200);
        if (userIds !== 'all' && !userIds.length) return res.status(400).json({ error: 'Choose at least one staff member.' });
        const start = new Date(`${String(req.body?.periodStart || '').slice(0, 10)}T00:00:00.000Z`);
        const end = new Date(`${String(req.body?.periodEnd || '').slice(0, 10)}T23:59:59.999Z`);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return res.status(400).json({ error: 'Choose a valid report period.' });
        if (end.getTime() - start.getTime() > 92 * DAY) return res.status(400).json({ error: 'A report can cover at most 92 days.' });
        const actor = ctx.sessionUser(req)!;
        const note = String(req.body?.note || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, 1500);
        const result = await sendReportsNow(discord, guild, { userIds, start, end, note, summary: Boolean(req.body?.summary), dmSummary: req.body?.dmSummary === undefined ? undefined : Boolean(req.body.dmSummary), authorId: actor.id });
        await createLog(guildId, 'REPORTS_SENT', actor.id, actor.id, { staff: result.staff, dms: result.dms, periodStart: start.toISOString().slice(0, 10), periodEnd: end.toISOString().slice(0, 10) }).catch(() => undefined);
        res.json({ ok: true, ...result });
      } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Could not send the reports.' }); }
      finally { sending.delete(guildId); }
    });

    // The Grades page: the rules for everyone, each staff member's own score so far this week, and the whole team for administrators.
    app.get('/api/grades', async (req, res) => {
      try {
        const guildId = ctx.selectedGuildId(req);
        const user = ctx.sessionUser(req);
        const admin = await isAdmin(ctx, req);
        const { settings } = await loadWeeklySettings(guildId);
        const { start } = weekBounds(new Date(), 0);
        const now = new Date();
        const everyone = admin ? await computeWeek(guildId, start, now, settings.targets) : (user ? await computeWeek(guildId, start, now, settings.targets, new Set([user.id])) : []);
        let me: any = null;
        // Ranks in the admin view cover the whole team, so re-run for one person only when we do not already have them.
        const mine = user ? everyone.find(item => item.userId === user.id) : undefined;
        if (mine) {
          const { data: last } = await supabase.from('staff_reports').select('score, grade, period_end').eq('guild_id', guildId).eq('staff_user_id', mine.userId).eq('automated', true).order('period_end', { ascending: false }).limit(1);
          const previous = last?.[0];
          const parts = breakdown(mine, settings.targets);
          me = {
            score: mine.score, grade: mine.grade, rank: mine.rank, of: mine.of, next: nextGrade(mine.score), penalty: parts.penalty, parts: parts.parts, weekStart: start.toISOString(),
            ratingIsDefault: !mine.ratingCount && !mine.overallRating,
            last: previous && typeof previous.score === 'number' ? { score: previous.score, grade: previous.grade, periodEnd: previous.period_end } : null,
          };
        }
        let team: any[] | undefined;
        if (admin) {
          const guild = await ctx.getGuild(guildId);
          const map = await people(guild, everyone.map(item => item.userId));
          team = [...everyone].sort((a, b) => a.rank - b.rank).map(item => {
            const person = map.get(item.userId);
            return { userId: item.userId, displayName: person?.displayName ?? item.userId, avatar: person?.avatar ?? '', score: item.score, grade: item.grade, rank: item.rank, next: nextGrade(item.score), shiftHours: round1(item.shiftHours), voiceHours: round1(item.voiceHours), messages: item.messages, activeDays: item.activeDays };
          });
        }
        res.json({ grades: GRADE_STEPS, weights: SCORE_WEIGHTS, penalty: COMPLAINT_PENALTY, targets: settings.targets, noRatingDefault: NO_RATING_DEFAULT, me, team, admin });
      } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Could not load grades.' }); }
    });
  },
};
