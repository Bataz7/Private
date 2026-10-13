import type { Request, Response } from 'express';
import type { Guild } from '../lib/djs/index.js';
import { EmbedBuilder } from '../lib/djs/index.js';
import type { DashboardContext, DashboardExtension } from '../dashboard/extensions.js';
import { supabase } from '../supabase/client.js';
import { Staff } from '../models/Staff.js';
import { Shift } from '../models/Shift.js';
import { Complaint } from '../models/Complaint.js';
import { StaffRating } from '../models/StaffRating.js';
import { StaffNote } from '../models/StaffNote.js';
import { StaffProfile, type ProfileConnection, type ProfileLink, type StaffProfileDoc } from '../models/StaffProfile.js';
import { ProfileComment, ProfileRep, ProfileView } from '../models/ProfileSocial.js';
import { PointsLedger } from '../models/PointsLedger.js';
import { getSettings } from '../services/settings.service.js';
import { createLog } from '../services/log.service.js';
import { activeMs, isOnBreak } from '../services/shift.service.js';
import { AdminOnlyError, assertAdministrator, isAdministrator } from '../utils/permissions.js';
import { cssSafeUrl } from '../utils/css-safe.js';
import { adjustStaffPoints, clearLedger, pointRules, pointsBreakdown, recentPointChanges } from './points.js';
import { listInbox, markRead, sendNotification, type NotificationDelivery, type NotificationLevel, type NotificationTarget } from './notifications.js';
import { HEAT_DAYS, PRIVATE_ACTIONS, PUBLIC_ACTIONS, activeDaysIn, badgesOf, buildDays, modReportStats, ratingSpread, shiftStats, streakOf } from './profile-stats.js';
import { logDbIssue, SetupMissingError } from './db.js';

// The dashboard side of the staff core: points page, notifications, staff notes and the staff profile page.
// Routes here are registered before the built-in ones in server.ts, so they replace the old in-memory versions.
const DAY = 86_400_000;
const LEVEL_STEP = 100;
const isId = (value: unknown): value is string => /^\d{15,22}$/.test(String(value ?? ''));
const clean = (value: unknown, max: number) => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);

type Info = { displayName: string; username: string; avatar: string; banner: string };
type Handler = (req: Request, res: Response) => Promise<unknown>;

export const coreDashboard: DashboardExtension = {
  name: 'core',
  styles: ['core'],
  mountApi(ctx) { mountRoutes(ctx); },
};

function mountRoutes(ctx: DashboardContext) {
  const { app, discord, selectedGuildId } = ctx;

  // ---- helpers ------------------------------------------------------------------------------------
  const infoCache = new Map<string, { at: number; info: Info | null }>();
  async function memberInfo(guild: Guild, userId: string): Promise<Info | null> {
    const key = `${guild.id}:${userId}`;
    const hit = infoCache.get(key);
    if (hit && Date.now() - hit.at < 5 * 60_000) return hit.info;
    const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
    const user = member?.user || await discord.users.fetch(userId).catch(() => null);
    const info = user ? {
      displayName: member?.displayName || user.displayName || user.username, username: user.username,
      avatar: (member ?? user).displayAvatarURL({ extension: 'png', size: 128 }),
      banner: member?.displayBannerURL({ extension: 'png', size: 1024 }) || user.bannerURL({ extension: 'png', size: 1024 }) || '',
    } : null;
    infoCache.set(key, { at: Date.now(), info });
    if (infoCache.size > 3000) infoCache.delete(infoCache.keys().next().value!);
    return info;
  }

  /** Live administrator check for reading private data (the session flags can be a few minutes old). */
  async function liveAdmin(req: Request) {
    const user = ctx.sessionUser(req);
    if (!user) return false;
    const guild = await ctx.getGuild(selectedGuildId(req)).catch(() => null);
    const member = guild ? await guild.members.fetch(user.id).catch(() => null) : null;
    return Boolean(member && isAdministrator(member));
  }

  const route = (handler: Handler) => (req: Request, res: Response) => {
    handler(req, res).catch(error => {
      if (res.headersSent) return;
      if (error instanceof AdminOnlyError) return res.status(403).json({ error: error.message });
      if (error instanceof SetupMissingError) return res.status(503).json({ error: error.message });
      console.error('[core] dashboard route failed:', error);
      res.status(400).json({ error: error instanceof Error ? error.message : 'Something went wrong.' });
    });
  };
  const signedIn = (req: Request, res: Response) => {
    const user = ctx.sessionUser(req);
    if (!user) res.status(401).json({ error: 'Unauthorized' });
    return user;
  };
  const avatarUrl = (user: { id: string; avatar: string | null }) => (user.avatar ? (String(user.avatar).startsWith('http') ? user.avatar : `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`) : '');

  // ---- Points -------------------------------------------------------------------------------------
  // Everyone on the team sees the rules, the leaderboard and their own breakdown; only administrators see others' and adjust.
  app.get('/api/points', route(async (req, res) => {
    const guildId = selectedGuildId(req);
    const viewer = signedIn(req, res); if (!viewer) return;
    const admin = await liveAdmin(req);
    const guild = await ctx.getGuild(guildId);
    const rows = await Staff.find({ guildId, active: true }).sort({ points: -1 });
    const leaderboard = await Promise.all(rows.map(async (row, index) => {
      const info = await memberInfo(guild, row.userId);
      return { place: index + 1, userId: row.userId, displayName: info?.displayName || row.userId, avatar: info?.avatar || '', points: row.points || 0, rank: '' };
    }));
    const nameOf = (id: string | null) => (id ? leaderboard.find(item => item.userId === id)?.displayName || id : '');
    const settings = await getSettings(guildId).catch(() => null);
    const recent = admin ? (await recentPointChanges(guildId, { limit: 20 })).map(item => ({ userId: item.userId, name: nameOf(item.userId), by: item.actorId ? nameOf(item.actorId) : '', delta: item.delta, reason: item.reason, source: item.source, at: item.at })) : [];
    res.json({ admin, lang: settings?.botLanguage === 'ar' ? 'ar' : 'en', rules: await pointRules(guildId), me: await pointsBreakdown(guildId, viewer.id), leaderboard, recent });
  }));

  app.get('/api/points/:userId', route(async (req, res) => {
    if (!await ctx.requireAdministrator(req, res)) return;
    const breakdown = await pointsBreakdown(selectedGuildId(req), String(req.params.userId));
    if (!breakdown) return res.status(404).json({ error: 'This member is not on the staff list.' });
    res.json({ breakdown });
  }));

  app.post('/api/points/adjust', route(async (req, res) => {
    if (!await ctx.requireAdministrator(req, res)) return;
    const guildId = selectedGuildId(req);
    const actor = signedIn(req, res); if (!actor) return;
    const userId = String(req.body?.userId || '');
    const delta = Math.trunc(Number(req.body?.delta));
    const reason = clean(req.body?.reason, 300);
    if (!isId(userId)) return res.status(400).json({ error: 'Choose a staff member.' });
    if (!delta || Math.abs(delta) > 1000) return res.status(400).json({ error: 'Enter an amount between -1000 and 1000 (not 0).' });
    if (reason.length < 3) return res.status(400).json({ error: 'Write a short reason. The staff member sees it.' });
    // adjustStaffPoints checks the administrator again (live) before it changes anything.
    const result = await adjustStaffPoints(discord, { guildId, userId, delta, actorId: actor.id, reason });
    if (!result) return res.status(404).json({ error: 'This member is not on the staff list.' });
    let dmSent = false;
    if (req.body?.notify !== false) {
      const change = result.after - result.before;
      const member = await (await ctx.getGuild(guildId)).members.fetch(userId).catch(() => null);
      const ar = (await getSettings(guildId).catch(() => null))?.botLanguage === 'ar';
      if (member && change !== 0) {
        const line = ar
          ? `${change >= 0 ? '➕' : '➖'} **${change >= 0 ? 'انضافت لك' : 'انخصمت منك'} ${Math.abs(change)} نقطة** من الإدارة.\n> ${reason}\nمجموع نقاطك الحين: **${result.after}**`
          : `${change >= 0 ? '➕' : '➖'} Management **${change >= 0 ? 'added' : 'removed'} ${Math.abs(change)} point(s)**.\n> ${reason}\nYour total is now **${result.after}**.`;
        dmSent = await member.send({ embeds: [new EmbedBuilder().setTitle(ar ? 'تحديث نقاطك' : 'Your points changed').setDescription(line).setFooter({ text: 'Rift Staff Operations' }).setTimestamp()], allowedMentions: { parse: [] } }).then(() => true).catch(() => false);
      }
    }
    res.json({ ok: true, ...result, dmSent });
  }));

  // Keep the ledger in step with the older staff-page routes that write points or reset a member directly.
  const afterSuccess = (res: Response, job: () => Promise<unknown>) => { res.on('finish', () => { if (res.statusCode < 400) job().catch(error => logDbIssue(error, 'The points ledger')); }); };
  app.post('/api/staff/:userId/reset', (req, res, next) => {
    try {
      const guildId = selectedGuildId(req); const userId = String(req.params.userId);
      afterSuccess(res, async () => { await clearLedger(guildId, userId); await supabase.from('assistances').delete().eq('guild_id', guildId).eq('staff_user_id', userId); });
    } catch { /* no server selected: the built-in route answers */ }
    next();
  });
  app.post('/api/staff/reset-all', (req, res, next) => {
    try {
      const guildId = selectedGuildId(req);
      afterSuccess(res, async () => { await clearLedger(guildId); await supabase.from('assistances').delete().eq('guild_id', guildId); });
    } catch { /* no server selected: the built-in route answers */ }
    next();
  });
  app.patch('/api/staff/:userId', async (req, res, next) => {
    if (req.body?.points === undefined) return next();
    try {
      const guildId = selectedGuildId(req); const userId = String(req.params.userId); const actorId = ctx.sessionUser(req)?.id ?? null;
      const { data: before } = await supabase.from('staff').select('points').eq('guild_id', guildId).eq('user_id', userId).maybeSingle();
      afterSuccess(res, async () => {
        const { data: after } = await supabase.from('staff').select('points').eq('guild_id', guildId).eq('user_id', userId).maybeSingle();
        const from = Number(before?.points) || 0; const to = Number(after?.points) || 0;
        if (before && after && from !== to) await PointsLedger.create({ guildId, userId, delta: to - from, pointsBefore: from, pointsAfter: to, source: 'manual', reason: 'Set from the staff page', actorId });
      });
    } catch { /* the built-in route answers */ }
    next();
  });

  // ---- Notifications ------------------------------------------------------------------------------
  app.get('/api/notifications', route(async (req, res) => {
    const user = signedIn(req, res); if (!user) return;
    res.json(await listInbox(discord, selectedGuildId(req), user.id));
  }));

  // What the composer needs: staff to pick from and roles (administrators only).
  app.get('/api/notifications/options', route(async (req, res) => {
    if (!await ctx.requireAdministrator(req, res)) return;
    const guildId = selectedGuildId(req);
    const guild = await ctx.getGuild(guildId);
    const [staffRows] = await Promise.all([Staff.find({ guildId, active: true }), guild.roles.fetch().catch(() => null)]);
    const staff = await Promise.all(staffRows.map(async row => { const info = await memberInfo(guild, row.userId); return { userId: row.userId, displayName: info?.displayName || row.userId, username: info?.username || '' }; }));
    const roles = [...guild.roles.cache.values()].filter(role => role.id !== guild.id && !role.managed).sort((a, b) => b.position - a.position).map(role => ({ id: role.id, name: role.name, color: role.hexColor }));
    res.json({ staff: staff.sort((a, b) => a.displayName.localeCompare(b.displayName)), roles });
  }));

  app.post('/api/notifications/admin-note', route(async (req, res) => {
    if (!await ctx.requireAdministrator(req, res)) return;
    const sender = signedIn(req, res); if (!sender) return;
    const body = req.body || {};
    const target: NotificationTarget = ['user', 'staff', 'role'].includes(String(body.target)) ? body.target : 'user';
    const level: NotificationLevel = ['info', 'warning', 'important'].includes(String(body.level)) ? body.level : 'info';
    const delivery: NotificationDelivery = ['dashboard', 'discord', 'both'].includes(String(body.delivery)) ? body.delivery : 'both';
    // sendNotification checks the administrator again, live, before anything is saved or sent.
    const result = await sendNotification(discord, {
      guildId: selectedGuildId(req), sender: { id: sender.id, username: sender.username }, target, recipientUserId: String(body.recipientUserId || ''), roleId: String(body.roleId || ''),
      delivery, level, title: String(body.title || ''), message: String(body.message || ''),
    });
    res.json({ ...result, discordSent: delivery === 'dashboard' ? undefined : result.sent === result.recipients });
  }));

  app.patch('/api/notifications/:id/read', route(async (req, res) => {
    const user = signedIn(req, res); if (!user) return;
    if (!await markRead(selectedGuildId(req), user.id, String(req.params.id))) return res.status(404).json({ error: 'Notification not found.' });
    res.json({ ok: true });
  }));

  // ---- Staff notes (administrators only; saved in the database) -----------------------------------
  app.post('/api/staff/:userId/notes', route(async (req, res) => {
    if (!await ctx.requireAdministrator(req, res)) return;
    const guildId = selectedGuildId(req);
    const actor = signedIn(req, res); if (!actor) return;
    const userId = String(req.params.userId);
    await assertAdministrator(discord, guildId, actor.id); // second lock: live check, on top of the route guard
    if (!isId(userId)) return res.status(400).json({ error: 'Invalid staff member.' });
    const text = clean(req.body?.text, 1000);
    if (!text) return res.status(400).json({ error: 'Write a note first.' });
    if (!await Staff.findOne({ guildId, userId })) return res.status(404).json({ error: 'Staff member not found.' });
    await StaffNote.create({ guildId, userId, text, addedBy: actor.username, addedById: actor.id }).catch(error => { if (/does not exist|schema cache|could not find/i.test(String(error?.message))) throw new SetupMissingError('Staff notes'); throw error; });
    await createLog(guildId, 'STAFF_NOTE_ADDED', userId, actor.id).catch(() => undefined);
    res.json({ ok: true });
  }));

  // The staff page reads notes (and helps) from /api/bootstrap; add them there so the old in-memory notes are gone.
  app.get('/api/bootstrap', (req, res, next) => {
    let guildId = '';
    try { guildId = selectedGuildId(req); } catch { /* the built-in route answers */ }
    if (!guildId) return next();
    const original = res.json.bind(res);
    res.json = ((body: any) => {
      if (!body || !Array.isArray(body.staff)) return original(body);
      enrichBootstrap(guildId, body).catch(error => logDbIssue(error, 'Staff notes')).finally(() => { original(body); });
      return res;
    }) as typeof res.json;
    next();
  });

  async function enrichBootstrap(guildId: string, body: any) {
    const guild = await ctx.getGuild(guildId);
    const [{ data: notes, error: notesError }, { data: claimedRows }, { data: assists, error: assistError }] = await Promise.all([
      supabase.from('staff_notes').select('user_id, text, added_by, created_at').eq('guild_id', guildId).order('created_at', { ascending: false }).limit(1000),
      supabase.from('staff').select('user_id, claimed').eq('guild_id', guildId),
      supabase.from('assistances').select('id, staff_user_id, member_user_id, type, note, created_at').eq('guild_id', guildId).order('created_at', { ascending: false }).limit(300),
    ]);
    if (notesError) logDbIssue(notesError, 'Staff notes');
    if (assistError) logDbIssue(assistError, 'Assist logging');
    const claimed = new Map((claimedRows ?? []).map(row => [row.user_id as string, Number(row.claimed) || 0]));
    const notesBy = new Map<string, Array<{ text: string; addedBy: string; createdAt: string }>>();
    for (const row of notes ?? []) { const list = notesBy.get(row.user_id) ?? []; list.push({ text: row.text, addedBy: row.added_by, createdAt: row.created_at }); notesBy.set(row.user_id, list); }
    for (const member of body.staff) { member.notes = notesBy.get(member.userId) ?? []; member.claimed = claimed.get(member.userId) ?? 0; }
    body.assistances = (assists ?? []).map(row => ({ id: String(row.id), staffUserId: row.staff_user_id, memberUserId: row.member_user_id, memberName: guild.members.cache.get(row.member_user_id)?.displayName || row.member_user_id, type: row.type, note: row.note, createdAt: row.created_at }));
  }

  // ---- Staff profile page -------------------------------------------------------------------------
  const CONNECTION_URL: Record<string, (name: string, id: string) => string> = {
    github: name => `https://github.com/${name}`, twitter: name => `https://x.com/${name}`, youtube: (_n, id) => `https://www.youtube.com/channel/${id}`,
    twitch: name => `https://www.twitch.tv/${name}`, reddit: name => `https://www.reddit.com/user/${name}`, steam: (_n, id) => `https://steamcommunity.com/profiles/${id}`,
    instagram: name => `https://www.instagram.com/${name}`, tiktok: name => `https://www.tiktok.com/@${name}`, spotify: (_n, id) => `https://open.spotify.com/user/${id}`,
    bluesky: name => `https://bsky.app/profile/${name}`, domain: name => `https://${name}`, facebook: (_n, id) => `https://www.facebook.com/${id}`,
  };
  const connectionView = (item: ProfileConnection) => {
    let url = '';
    try { url = CONNECTION_URL[item.type]?.(encodeURIComponent(item.name), encodeURIComponent(item.id)) || ''; if (url && new URL(url).protocol !== 'https:') url = ''; } catch { url = ''; }
    return { type: item.type, name: item.name, verified: Boolean(item.verified), url };
  };
  async function fetchDiscordConnections(accessToken: string): Promise<ProfileConnection[] | null> {
    const response = await fetch('https://discord.com/api/users/@me/connections', { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) return null;
    const rows = await response.json() as Array<{ type?: string; id?: string; name?: string; verified?: boolean; visibility?: number }>;
    return rows.filter(row => row.visibility === 1 && row.type && row.id && row.name).map(row => ({ type: String(row.type), id: String(row.id), name: String(row.name), verified: Boolean(row.verified) }));
  }
  const httpUrl = (value: unknown, max: number) => {
    const text = String(value ?? '').trim();
    if (!text) return '';
    if (text.length > max) throw new Error('A link is too long.');
    const url = new URL(text);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Links must start with http:// or https://');
    return url.toString();
  };

  /** A profile is addressed by Discord id, "me", or username. Anyone in the server has one (stats stay at zero without a staff row). */
  async function resolveTarget(req: Request, identifier: string) {
    const guildId = selectedGuildId(req);
    const guild = await ctx.getGuild(guildId);
    const viewerId = ctx.sessionUser(req)?.id || '';
    const wanted = decodeURIComponent(identifier || 'me').replace(/^@/, '');
    let userId = wanted.toLowerCase() === 'me' ? viewerId : isId(wanted) ? wanted : '';
    if (!userId) {
      if (guild.members.cache.size < 2) await guild.members.fetch().catch(() => undefined);
      userId = [...guild.members.cache.values()].find(item => item.user.username.toLowerCase() === wanted.toLowerCase() || item.displayName.toLowerCase() === wanted.toLowerCase())?.id || '';
    }
    const member = userId ? await guild.members.fetch(userId).catch(() => null) : null;
    return { guildId, guild, viewerId, member };
  }

  const profileOf = async (guildId: string, userId: string): Promise<StaffProfileDoc | null> => StaffProfile.findOne({ guildId, userId }).catch(error => { logDbIssue(error, 'Staff profiles'); return null; });

  app.get('/api/profile/:identifier', route(async (req, res) => {
    const { guildId, guild, viewerId, member } = await resolveTarget(req, String(req.params.identifier));
    if (!member) return res.status(404).json({ error: 'Profile not found.' });
    const viewer = ctx.sessionUser(req);
    const userId = member.id;
    const isSelf = userId === viewerId;
    const isAdmin = await liveAdmin(req);
    // Leave, resignation, complaints and point changes are private: only the member and administrators see them.
    const seesPrivate = isSelf || isAdmin;
    const heatStart = new Date(Math.floor(Date.now() / DAY) * DAY - (HEAT_DAYS - 1) * DAY).toISOString().slice(0, 10);
    const [staff, staffRows, shifts, ratings, activityRows, logRows, complaints, modReports, breakdown, profileRow] = await Promise.all([
      Staff.findOne({ guildId, userId }),
      Staff.find({ guildId, active: true }).sort({ points: -1 }),
      Shift.find({ guildId, userId }).sort({ startedAt: -1 }),
      StaffRating.find({ guildId, staffUserId: userId }).sort({ createdAt: -1 }),
      supabase.from('staff_daily_activity').select('activity_date, message_count, active_minutes, last_message_at').eq('guild_id', guildId).eq('user_id', userId).gte('activity_date', heatStart).then(result => result.data ?? []),
      supabase.from('staff_logs').select('action, created_at, details').eq('guild_id', guildId).eq('user_id', userId).in('action', seesPrivate ? [...PUBLIC_ACTIONS, ...PRIVATE_ACTIONS] : PUBLIC_ACTIONS).order('created_at', { ascending: false }).limit(30).then(result => result.data ?? []),
      Complaint.countDocuments({ guildId, staffUserId: userId, status: 'approved' }).catch(() => 0),
      modReportStats(guildId, userId),
      seesPrivate ? pointsBreakdown(guildId, userId).catch(() => null) : null,
      profileOf(guildId, userId),
    ]);
    const activity = activityRows.map(row => ({ activityDate: new Date(`${String(row.activity_date).slice(0, 10)}T00:00:00Z`), messageCount: Number(row.message_count) || 0, activeMinutes: Number(row.active_minutes) || 0, lastMessageAt: row.last_message_at as string | null }));

    const info = await memberInfo(guild, userId);
    const profile = profileRow ?? { tagline: '', bio: '', accent: '', bannerUrl: '', showFeedback: true, showConnections: true, links: [] as ProfileLink[], connections: [] as ProfileConnection[], connectionsSyncedAt: null as Date | null };

    // Public Discord connections come from the member's own login; refreshed while they view their own profile.
    const accessToken = (req.session as any)?.discordAccessToken as string | undefined;
    let connections = profile.connections || [];
    if (isSelf && accessToken && (!profile.connectionsSyncedAt || Date.now() - new Date(profile.connectionsSyncedAt).getTime() > 10 * 60_000)) {
      const fresh = await fetchDiscordConnections(accessToken).catch(() => null);
      if (fresh) {
        connections = fresh;
        const fields = { connections: fresh, connectionsSyncedAt: new Date(), updatedAt: new Date() };
        if (profileRow) await StaffProfile.update(profileRow.id, fields).catch(error => logDbIssue(error, 'Staff profiles'));
        else await StaffProfile.create({ guildId, userId, ...fields }).catch(error => logDbIssue(error, 'Staff profiles'));
      }
    }

    if (!isSelf && viewerId) await ProfileView.create({ guildId, profileUserId: userId, viewerUserId: viewerId, day: new Date().toISOString().slice(0, 10) }).catch(() => undefined);
    const [views, reps, ownRep, commentRows, commentCount] = await Promise.all([
      ProfileView.countDocuments({ guildId, profileUserId: userId }).catch(() => 0),
      ProfileRep.countDocuments({ guildId, profileUserId: userId }).catch(() => 0),
      viewerId ? ProfileRep.findOne({ guildId, profileUserId: userId, fromUserId: viewerId }).catch(() => null) : null,
      ProfileComment.find({ guildId, profileUserId: userId }).sort({ createdAt: -1 }).limit(50).catch(() => []),
      ProfileComment.countDocuments({ guildId, profileUserId: userId }).catch(() => 0),
    ]);
    const comments = await Promise.all(commentRows.map(async row => {
      const author = await memberInfo(guild, row.authorUserId);
      return { id: String(row.id), text: row.text, createdAt: row.createdAt, authorUserId: row.authorUserId, authorName: author?.displayName || row.authorName || 'Member', authorUsername: author?.username || null, authorAvatar: author?.avatar || null, canDelete: row.authorUserId === viewerId || isSelf || isAdmin };
    }));

    const points = staff?.points ?? 0;
    const showConnections = profile.showConnections !== false;
    const showFeedback = profile.showFeedback !== false || isSelf || isAdmin;
    const days = buildDays(activity, shifts);
    const streak = streakOf(days);
    const spread = ratingSpread(ratings);
    const shiftInfo = shiftStats(shifts);
    const shiftHours = shifts.reduce((sum, shift) => sum + activeMs(shift), 0) / 3_600_000;
    const position = staffRows.findIndex(row => row.userId === userId) + 1;
    const tenureDays = Math.max(0, Math.floor((Date.now() - new Date(staff?.joinedAt || member.joinedAt || Date.now()).getTime()) / DAY));
    const messages = staff?.messageCount ?? 0;
    const assists = staff?.claimed ?? 0;
    const activeShift = shifts.find(shift => shift.status === 'active');
    const lastSeen = Math.max(0, ...activity.map(row => (row.lastMessageAt ? new Date(row.lastMessageAt).getTime() : 0)), ...shifts.slice(0, 1).map(shift => new Date(shift.startedAt).getTime()));
    // Who left a rating is only shown to administrators, so members can rate honestly.
    const feedback = showFeedback ? await Promise.all(ratings.slice(0, 30).map(async rating => ({ rating: rating.rating, comment: rating.comment || '', createdAt: rating.createdAt, reviewerName: isAdmin ? (await memberInfo(guild, rating.reviewerUserId))?.displayName || rating.reviewerName || '' : '' }))) : [];
    const banner = cssSafeUrl(profile.bannerUrl);

    res.json({
      member: { userId, username: info?.username || member.user.username, displayName: info?.displayName || member.displayName, avatar: info?.avatar || null, discordBanner: cssSafeUrl(info?.banner) || null, rank: '', status: 'active', joinedAt: member.joinedAt ?? staff?.joinedAt ?? null },
      profile: { bio: profile.bio || '', tagline: profile.tagline || '', accent: profile.accent || '', bannerUrl: banner, links: profile.links || [], showFeedback: profile.showFeedback !== false, showConnections },
      connections: showConnections || isSelf ? connections.map(connectionView) : [], connectionsHidden: !showConnections && !isSelf, connectionsRequiresAuth: isSelf && !accessToken,
      social: { views, reps, hasRep: Boolean(ownRep), commentCount },
      comments,
      level: { level: Math.floor(points / LEVEL_STEP) + 1, progress: (points % LEVEL_STEP) / LEVEL_STEP, toNext: LEVEL_STEP - (points % LEVEL_STEP) },
      viewer: { userId: viewerId, name: viewer?.username || '', avatar: viewer ? avatarUrl(viewer) : '' },
      stats: {
        points, shiftHours: Math.round(shiftHours * 10) / 10, shiftCount: shiftInfo.count, avgShiftMinutes: shiftInfo.avgMinutes, longestShiftMinutes: shiftInfo.longestMinutes,
        messages, messages30: days.slice(-30).reduce((sum, item) => sum + item.messages, 0), activeDays30: activeDaysIn(days, 30), streak,
        voiceHours: Math.round(((staff?.voiceMinutes ?? 0) / 60) * 10) / 10,
        assists, ratingCount: spread.count, averageRating: spread.average, distribution: spread.distribution,
        modReports, complaints: seesPrivate ? complaints : null,
        position, totalStaff: staffRows.length, tenureDays,
      },
      badges: badgesOf({ position, totalStaff: staffRows.length, streak, longestShiftMinutes: shiftInfo.longestMinutes, assists, ratingCount: spread.count, averageRating: spread.average, modApproved: modReports.approved, messages, tenureDays }),
      pointsBreakdown: breakdown,
      status: { onShift: Boolean(activeShift), onBreak: Boolean(activeShift && isOnBreak(activeShift)), lastSeenAt: lastSeen ? new Date(lastSeen).toISOString() : null },
      feedback, feedbackHidden: !showFeedback,
      activity: logRows.map(log => ({ action: log.action, createdAt: log.created_at, ...(log.action === 'POINTS_ADJUSTED' ? { delta: Number(log.details?.delta) || 0, reason: String(log.details?.reason || '').slice(0, 200) } : {}) })),
      shifts: shifts.slice(0, 15).map(shift => ({ startedAt: shift.startedAt, endedAt: shift.endedAt, status: shift.status, minutes: Math.round(activeMs(shift) / 60000), points: (shift.pointsAwarded || 0) + (shift.interactionPointsAwarded || 0) + (shift.voicePointsAwarded || 0), messages: shift.interactionMessageCount || 0 })),
      days, isSelf, isAdmin,
    });
  }));

  app.patch('/api/profile', route(async (req, res) => {
    const guildId = selectedGuildId(req);
    const user = signedIn(req, res); if (!user) return;
    if (!user.isStaff && !user.isAdministrator && !user.isOwner) return res.status(403).json({ error: 'Only staff members can edit a profile.' });
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      const accent = String(body.accent ?? '').trim();
      if (accent && !/^#[0-9a-f]{6}$/i.test(accent)) throw new Error('Accent must be a hex colour like #8175f5.');
      const links = (Array.isArray(body.links) ? body.links : []).slice(0, 4).map((item: any) => ({ label: clean(item?.label, 24), url: httpUrl(item?.url, 200) })).filter(item => item.url);
      const bannerUrl = (() => { const url = httpUrl(body.bannerUrl, 500); if (url && !cssSafeUrl(url)) throw new Error('The banner link has characters that are not allowed (quotes, brackets or spaces).'); return url; })();
      const fields = {
        bio: clean(body.bio, 300).split('\n').slice(0, 6).join('\n'), tagline: clean(body.tagline, 60), accent: accent.toLowerCase(), bannerUrl, links,
        showFeedback: body.showFeedback !== false, showConnections: body.showConnections !== false, updatedAt: new Date(),
      };
      const existing = await StaffProfile.findOne({ guildId, userId: user.id }).catch(error => { if (/does not exist|schema cache|could not find/i.test(String(error?.message))) throw new SetupMissingError('Profiles'); throw error; });
      if (existing) await StaffProfile.update(existing.id, fields); else await StaffProfile.create({ guildId, userId: user.id, ...fields });
      res.json({ ok: true, profile: { bio: fields.bio, tagline: fields.tagline, accent: fields.accent, bannerUrl, links, showFeedback: fields.showFeedback, showConnections: fields.showConnections } });
    } catch (error) {
      if (error instanceof SetupMissingError) throw error;
      res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid profile.' });
    }
  }));

  // Reputation: one per viewer per profile, toggled by the same button.
  app.post('/api/profile/:identifier/rep', route(async (req, res) => {
    const { guildId, viewerId, member } = await resolveTarget(req, String(req.params.identifier));
    if (!member) return res.status(404).json({ error: 'Profile not found.' });
    if (!viewerId) return res.status(401).json({ error: 'Unauthorized' });
    if (member.id === viewerId) return res.status(400).json({ error: 'You cannot give reputation to yourself.' });
    const filter = { guildId, profileUserId: member.id, fromUserId: viewerId };
    const existing = await ProfileRep.findOne(filter).catch(error => { if (/does not exist|schema cache|could not find/i.test(String(error?.message))) throw new SetupMissingError('Profile reputation'); throw error; });
    if (existing) await ProfileRep.deleteMany(filter);
    else await ProfileRep.create(filter).catch(error => { if (!/duplicate key/i.test(String(error?.message))) throw error; });
    res.json({ hasRep: !existing, reps: await ProfileRep.countDocuments({ guildId, profileUserId: member.id }) });
  }));

  app.post('/api/profile/:identifier/comments', route(async (req, res) => {
    const { guildId, guild, viewerId, member } = await resolveTarget(req, String(req.params.identifier));
    if (!member) return res.status(404).json({ error: 'Profile not found.' });
    const viewer = signedIn(req, res); if (!viewer || !viewerId) return;
    const text = clean(req.body?.text, 2000);
    if (!text) return res.status(400).json({ error: 'Write something first.' });
    if (text.length > 500) return res.status(400).json({ error: 'Comments are limited to 500 characters.' });
    const { count } = await supabase.from('profile_comments').select('id', { count: 'exact', head: true }).eq('guild_id', guildId).eq('author_user_id', viewerId).gte('created_at', new Date(Date.now() - 8000).toISOString());
    if (count) return res.status(429).json({ error: 'Slow down a little before commenting again.' });
    const row = await ProfileComment.create({ guildId, profileUserId: member.id, authorUserId: viewerId, authorName: viewer.username, text }).catch(error => { if (/does not exist|schema cache|could not find/i.test(String(error?.message))) throw new SetupMissingError('Profile comments'); throw error; });
    const author = await memberInfo(guild, viewerId);
    res.json({ comment: { id: String(row.id), text, createdAt: row.createdAt, authorUserId: viewerId, authorName: author?.displayName || viewer.username, authorUsername: author?.username || null, authorAvatar: author?.avatar || null, canDelete: true } });
  }));

  app.delete('/api/profile/comments/:id', route(async (req, res) => {
    const guildId = selectedGuildId(req);
    const viewer = signedIn(req, res); if (!viewer) return;
    const id = String(req.params.id || '');
    if (!/^\d{1,18}$/.test(id)) return res.status(400).json({ error: 'Invalid comment.' });
    const row = await ProfileComment.findOne({ id: Number(id), guildId });
    if (!row) return res.status(404).json({ error: 'Comment not found.' });
    if (row.authorUserId !== viewer.id && row.profileUserId !== viewer.id && !await liveAdmin(req)) return res.status(403).json({ error: 'You cannot delete this comment.' });
    await ProfileComment.deleteMany({ id: Number(id), guildId });
    res.json({ ok: true });
  }));
}
