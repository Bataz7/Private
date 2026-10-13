import express, { type Request, type Response, type NextFunction } from 'express';
import session from 'express-session';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, EmbedBuilder, GatewayIntentBits, PermissionFlagsBits } from 'discord.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { supabase } from '../supabase/client.js';
import { Staff } from '../models/Staff.js';
import { StaffRating } from '../models/StaffRating.js';
import { Shift } from '../models/Shift.js';
import { LeaveRequest } from '../models/LeaveRequest.js';
import { ResignationRequest } from '../models/ResignationRequest.js';
import { Complaint } from '../models/Complaint.js';
import { createLog } from '../services/log.service.js';
import { buildShiftPanel } from '../utils/shift-panel.js';
import { StaffReport } from '../models/StaffReport.js';
import { StaffDailyActivity } from '../models/StaffDailyActivity.js';
import { StaffLog } from '../models/StaffLog.js';
import { buildStaffCard } from '../utils/staff-card.js';
import { AttachmentBuilder } from 'discord.js';
import { buildComplaintPanel } from '../utils/complaint-panel.js';
import { buildRatingPanel } from '../utils/rating-panel.js';
import { createComplaintOnce } from '../services/complaint.service.js';
import { status } from '../utils/terminal.js';
import { runWeeklyReports as runWeeklyReportsJob } from '../services/weekly-report.service.js';
import { installEmojiHook, waitForEmojis } from '../utils/emoji.js';

import { dashboard as dashboardExtensions, type DashboardContext } from './extensions.js';
import { useBuiltWeb, webFile, webManifest, webRoot } from './web-root.js';
import { assertSessionSecret, checkOAuthState, newOAuthState, originGuard, rateLimit, securityHeaders } from './security.js';
import { handleApplyCallback } from '../applications/dashboard.js';

installEmojiHook();

const app = express();
const discord = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
const staffSyncAt = new Map<string, number>();
const complaintPanelPublishing = new Set<string>();
let lastWeeklyReportKey = '';
const dashboardStartedAt = new Date();
type DashboardNotification = { id: string; guildId: string; recipientUserId: string; senderUserId: string; senderName: string; senderAvatar: string; title: string; message: string; createdAt: Date; readBy: Array<{ userId: string }> };
type DashboardMaintenance = { id: string; guildId: string; title: string; description: string; startsAt: string; endsAt: string; affects: string[]; status: 'scheduled' | 'in_progress' | 'completed' };
type PublicProfile = { tagline: string; bio: string; accent: string; bannerUrl: string; showFeedback: boolean; showConnections: boolean; links: Array<{ label: string; url: string }> };
type PublicConnection = { type: string; id: string; name: string; verified: boolean; url: string };
const dashboardNotifications = new Map<string, DashboardNotification[]>();
const dashboardMaintenances = new Map<string, DashboardMaintenance[]>();
const staffNotes = new Map<string, Array<{ text: string; addedBy: string; createdAt: Date }>>();
const publicProfiles = new Map<string, PublicProfile>();
const profileConnections = new Map<string, PublicConnection[]>();
const profileComments = new Map<string, Array<{ id: string; authorUserId: string; authorName: string; authorUsername: string; authorAvatar: string; text: string; createdAt: Date }>>();
const profileReputations = new Map<string, Set<string>>();
const developerModes = new Map<string, boolean>();
const discordReady = new Promise<Client>((resolve, reject) => {
  discord.once('clientReady', () => resolve(discord));
  discord.once('error', reject);
});

type SessionUser = { id: string; username: string; avatar: string | null; isOwner: boolean; isAdministrator: boolean; isManagement: boolean; isStaff: boolean; guilds: Array<{ id: string; name: string; icon: string | null; owner: boolean }> };

function authCookie(user: SessionUser, guildId: string) {
  const payload = Buffer.from(JSON.stringify({ user, guildId, exp: Date.now() + 12 * 60 * 60 * 1000 })).toString('base64url');
  const signature = createHmac('sha256', env.sessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}
function readAuthCookie(value?: string) {
  if (!value) return null;
  const [payload, signature] = value.split('.');
  if (!payload || !signature) return null;
  const expected = createHmac('sha256', env.sessionSecret).update(payload).digest('base64url');
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { user: SessionUser; guildId: string; exp?: number };
    // A signed cookie must also expire on the server: without this, a copied cookie would stay valid forever.
    if (typeof data.exp !== 'number' || data.exp < Date.now()) return null;
    return data;
  } catch { return null; }
}

assertSessionSecret();
actionSetup();

function actionSetup() {
  // Behind a domain the site is served over https by a proxy (hosting panel, Nginx, Cloudflare). Without this, Express thinks the
  // connection is plain http and refuses to set the secure login cookie, so the login would loop.
  if (process.env.TRUST_PROXY || env.dashboardUrl.startsWith('https://')) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(express.json({ limit: '1mb' }));
  app.use(session({ secret: env.sessionSecret, resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: 'lax', secure: env.dashboardUrl.startsWith('https://'), maxAge: 1000 * 60 * 60 * 12 } }));
  // Only the built front end (web-dist) is served: minified and hashed, no source maps, readable sources unreachable.
  const dashboardDir = webRoot;
  const dashboardIndex = webFile('index.html');
  const profileIndex = webFile('profile.html');
  const loginIndex = webFile('login.html');
  const pageCache = new Map<string, string>();
  // Administrators get the extra stylesheet of the admin pages injected; everyone else's page never mentions it.
  const sendPage = (req: Request, res: Response, file: string) => {
    if (!useBuiltWeb) return void res.sendFile(file);
    let html = pageCache.get(file);
    if (html === undefined) { html = readFileSync(file, 'utf8'); pageCache.set(file, html); }
    if (webManifest.adminCss && (req.session as any).user?.isManagement) html = html.replace('</head>', `<link rel="stylesheet" href="${webManifest.adminCss}"></head>`);
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(html);
  };
  const styles = ['styles', 'status', 'brand', 'setup', 'motion', 'resignations', 'modal', 'shift-panel', 'commands', 'message-template', 'reference', 'points', 'personal-points', 'staff-actions', 'profile-metrics', 'profile-controls', 'reports', 'manage-modal', 'identity', 'picker', 'icon-polish', 'setup-error', 'setup-guide', 'notifications', 'theme-system', 'enhance', 'dashboard-polish', 'rift-ui', 'rift-polish'];
  const hasAuth = (req: Request) => Boolean((req.session as any).user || readAuthCookie(req.headers.cookie?.split(';').map(item => item.trim()).find(item => item.startsWith('rift_auth='))?.slice(10)));
  app.get('/', (req, res) => res.redirect(hasAuth(req) ? '/dashboard' : '/login'));
  app.get(['/login', '/login/'], (req, res) => { if (hasAuth(req)) return res.redirect('/dashboard'); sendPage(req, res, loginIndex); });
  app.get('/p', (_req, res) => res.redirect('/p/me'));
  app.get('/p/:name', requireStaffPage, (req, res) => sendPage(req, res, profileIndex));
  app.get(['/dashboard', '/dashboard/:page'], requireStaffPage, (req, res) => sendPage(req, res, dashboardIndex));
  // /status, /status.rss, /status/badge.svg, /api/status and /api/status/metrics: src/status/dashboard.ts
  if (useBuiltWeb) {
    app.get('/app.css', (_req, res) => void res.status(404).end());
    // Pages, manifests, source maps and sources are only reachable through their own routes.
    app.use((req, res, next) => (/\.(html?|json|map|ts|mjs|cjs)$/i.test(req.path) ? void res.status(404).end() : next()));
    // /a/p = public pages (login, status, apply form). /a/d = the dashboard: only for signed-in staff; the code of administrator
    // pages only for administrators. Anyone else gets a plain 404, so nothing shows that these files exist.
    app.use('/a/d', async (req, res, next) => {
      const state = req.session as any;
      if (!(state.assetOkUntil > Date.now())) {
        if (!restoreSession(req) || !await hasConfiguredStaffRole(req)) return void res.status(404).end();
        state.assetOkUntil = Date.now() + 60_000; // the live role check is repeated once a minute, not for every file
      }
      if (webManifest.adminFiles.has(`/a/d${req.path}`) && !state.user?.isManagement) return void res.status(404).end();
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
      next();
    });
    app.use('/a', express.static(`${dashboardDir}/a`, { index: false, dotfiles: 'ignore', extensions: false, immutable: true, maxAge: '365d', setHeaders: res => { res.setHeader('X-Robots-Tag', 'noindex'); } }));
  } else {
    app.get('/app.css', (_req, res) => {
      res.type('text/css').setHeader('Cache-Control', 'no-cache');
      res.send([...styles, ...dashboardExtensions.flatMap(extension => extension.styles ?? [])].map(name => readFileSync(`${dashboardDir}/${name}.css`, 'utf8')).join('\n'));
    });
  }
  app.use(express.static(dashboardDir, { index: false, dotfiles: 'ignore', extensions: false }));

  app.use('/auth', rateLimit('auth', 60_000, 30));
  app.get('/auth/discord', (req, res) => {
    if (!env.discordClientSecret) return res.status(503).send('Rift OAuth is not configured. Add DISCORD_CLIENT_SECRET to .env and restart the dashboard.');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    const params = new URLSearchParams({ client_id: env.clientId, redirect_uri: `${env.dashboardUrl}/auth/callback`, response_type: 'code', scope: 'identify guilds connections', prompt: 'consent', state: newOAuthState(req) });
    res.redirect(`https://discord.com/oauth2/authorize?${params}`);
  });

  // Applicants of the public web form sign in through this same redirect URI, marked by a state that starts with "apply.".
  app.get('/auth/callback', (req, res, next) => { if (String(req.query.state || '').startsWith('apply.')) return void handleApplyCallback(req, res); next(); });
  app.get('/auth/callback', async (req, res) => {
    try {
      const code = typeof req.query.code === 'string' ? req.query.code : '';
      // The state must match the one issued to this browser, otherwise the login was started elsewhere (login CSRF).
      if (!checkOAuthState(req, req.query.state)) return res.redirect('/dashboard?error=oauth');
      if (!code || !env.discordClientSecret) return res.redirect('/dashboard?error=oauth');
      await discordReady;
      const tokenResponse = await fetch('https://discord.com/api/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: env.clientId, client_secret: env.discordClientSecret, grant_type: 'authorization_code', code, redirect_uri: `${env.dashboardUrl}/auth/callback` }) });
      const token = await tokenResponse.json() as { access_token?: string; error?: string; error_description?: string };
      if (!tokenResponse.ok || !token.access_token) {
        console.error('Discord OAuth token exchange failed:', token.error_description || token.error || tokenResponse.status);
        return res.redirect('/dashboard?error=oauth_token');
      }
      const userResponse = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${token.access_token}` } });
      if (!userResponse.ok) {
        console.error('Discord OAuth user lookup failed:', userResponse.status);
        return res.redirect('/dashboard?error=oauth_user');
      }
      const user = await userResponse.json() as { id: string; username: string; avatar: string | null };
      const guildResponse = await fetch('https://discord.com/api/users/@me/guilds', { headers: { Authorization: `Bearer ${token.access_token}` } });
      if (!guildResponse.ok) {
        console.error('Discord OAuth guild lookup failed:', guildResponse.status);
        return res.redirect('/dashboard?error=oauth_guilds');
      }
      const oauthGuilds = await guildResponse.json() as Array<{ id: string; name: string; icon: string | null; owner: boolean; permissions: string }>;
      const oauthGuildById = new Map(oauthGuilds.map(guild => [guild.id, guild]));
      const availableGuilds: SessionUser['guilds'] = [];
      for (const candidate of discord.guilds.cache.values()) {
        const member = await candidate.members.fetch(user.id).catch(() => null);
        const settings = await getSettings(candidate.id).catch(() => null);
        if (!member || !settings?.staff_role_id || !member.roles.cache.has(settings.staff_role_id)) continue;
        const oauthGuild = oauthGuildById.get(candidate.id);
        availableGuilds.push({ id: candidate.id, name: candidate.name, icon: candidate.icon ?? oauthGuild?.icon ?? null, owner: candidate.ownerId === user.id });
      }
      let selectedGuildId = env.guildId && availableGuilds.some(item => item.id === env.guildId) ? env.guildId : undefined;
      if (!selectedGuildId) selectedGuildId = availableGuilds[0]?.id;
      if (!selectedGuildId) {
        console.error(`OAuth login rejected: no compatible server. OAuth returned ${oauthGuilds.length} guilds; bot is installed in ${discord.guilds.cache.size}.`);
        return res.redirect('/dashboard?error=server');
      }
      const member = await getMember(user.id, selectedGuildId);
      if (!member) {
        console.error('OAuth login rejected: Discord bot cannot fetch the logged-in member.');
        return res.redirect('/dashboard?error=member');
      }
      const guild = await getGuild(selectedGuildId);
      const isOwner = guild.ownerId === user.id;
      const settings = await getSettings(selectedGuildId);
      const isAdministrator = member.permissions.has(PermissionFlagsBits.Administrator);
      const isStaff = Boolean(settings?.staff_role_id && member.roles.cache.has(settings.staff_role_id));
      const isManagement = isOwner || isAdministrator;
      if (!isStaff) {
        console.error(`OAuth login rejected: ${user.username} does not have the configured staff role.`);
        return res.redirect('/dashboard?error=forbidden');
      }
      const sessionUser = { ...user, isOwner, isAdministrator, isManagement, isStaff, guilds: availableGuilds } satisfies SessionUser;
      (req.session as any).user = sessionUser;
      (req.session as any).guildId = selectedGuildId;
      (req.session as any).discordAccessToken = token.access_token;
      console.log(`  ${status('ok', 'Login', `${user.username} signed in (owner=${isOwner}, admin=${isAdministrator})`)}`);
      req.session.save(error => {
        if (error) return res.redirect('/dashboard?error=oauth_user');
        res.append('Set-Cookie', `rift_auth=${authCookie(sessionUser, selectedGuildId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200${env.dashboardUrl.startsWith('https://') ? '; Secure' : ''}`);
        res.redirect('/dashboard');
      });
    } catch (error) {
      console.error('Discord OAuth callback failed:', error);
      res.redirect('/dashboard?error=oauth_user');
    }
  });

  app.post('/auth/logout', (req, res) => req.session.destroy(() => {
    res.clearCookie('rift_auth', { path: '/' });
    res.clearCookie('connect.sid', { path: '/' });
    res.json({ ok: true });
  }));
  app.get('/api/me', async (req, res) => {
    let user = (req.session as any).user ?? null;
    if (!user) {
      const cookie = readAuthCookie(req.headers.cookie?.split(';').map(item => item.trim()).find(item => item.startsWith('rift_auth='))?.slice(10));
      if (cookie) { (req.session as any).user = cookie.user; (req.session as any).guildId = cookie.guildId; user = cookie.user; }
    }
    if (user && (req.session as any).guildId) {
      const member = await getMember(user.id, (req.session as any).guildId).catch(() => null);
      const guild = await getGuild((req.session as any).guildId).catch(() => null);
      if (member && guild) {
        user.isOwner = guild.ownerId === user.id;
        user.isAdministrator = member.permissions.has(PermissionFlagsBits.Administrator);
        user.isManagement = user.isOwner || user.isAdministrator;
        const settings = await getSettings((req.session as any).guildId).catch(() => null);
        user.isStaff = Boolean(settings?.staff_role_id && member.roles.cache.has(settings.staff_role_id));
        (req.session as any).user = user;
      }
    }
    res.json({ user, configured: Boolean(env.discordClientSecret) });
  });
  const extensionContext: DashboardContext = {
    app, discord, supabase, selectedGuildId, requireManagement, requireAdministrator, getGuild, publicDir: dashboardDir,
    sessionUser: req => ((req.session as any)?.user as SessionUser | undefined) ?? null,
  };
  for (const extension of dashboardExtensions) extension.mountPublic?.(extensionContext);
  app.use('/api', originGuard, rateLimit('api', 60_000, 600));
  app.use('/api', requireStaffApi);
  for (const extension of dashboardExtensions) extension.mountApi?.(extensionContext);
  app.get('/api/guilds', listGuilds);
  app.post('/api/guilds/select', selectGuild);
  app.get('/api/setup/options', setupOptions);
  app.post('/api/setup', saveSetup);
  app.patch('/api/settings/messages', updateMessageSettings);
  app.get('/api/bootstrap', bootstrap);
  app.get('/api/notifications', listNotifications);
  app.get('/api/management-users', listManagementUsers);
  app.post('/api/notifications/admin-note', createAdminNote);
  app.patch('/api/notifications/:id/read', markNotificationRead);
  app.get('/api/audit', listAuditLog);
  app.get('/api/shifts', listShifts);
  app.get('/api/staff', listStaff);
  app.get('/api/activity/weekly', weeklyActivity);
  app.get('/api/health', health);
  app.get('/api/staff/complaint-candidates', listComplaintStaffCandidates);
  app.post('/api/staff', addStaff);
  app.delete('/api/staff/:userId', removeStaff);
  app.patch('/api/staff/:userId', updateStaff);
  app.post('/api/staff/:userId/reset', resetStaffStats);
  app.post('/api/staff/:userId/reset-shift-hours', resetStaffShiftHours);
  app.post('/api/staff/reset-all', resetAllStaff);
  app.post('/api/staff/:userId/notes', addStaffNote);
  app.post('/api/complaints', createComplaint);
  app.patch('/api/complaints/:id', reviewComplaint);
  app.get('/api/bot/status', botStatus);
  app.patch('/api/bot/status', updateBotStatus);
  app.patch('/api/bot/custom-status', updateCustomStatus);
  app.get('/api/panel/options', panelOptions);
  app.post('/api/shifts/panel', sendShiftPanel);
  app.post('/api/complaints/panel', sendComplaintPanel);
  app.post('/api/ratings/panel', sendRatingPanel);
  app.patch('/api/settings/help-commands', updateHelpCommands);
  app.patch('/api/settings/language', updateLanguage);
  app.patch('/api/settings/dev-mode', updateDeveloperMode);
  app.post('/api/staff-reports', createStaffReport);
  app.get('/api/staff-reports', listStaffReports);
  app.patch('/api/staff-reports/:id', updateStaffReport);
  app.delete('/api/staff-reports/:id', deleteStaffReport);
  app.post('/api/maintenances', createMaintenance);
  app.post('/api/maintenances/:id/end', endMaintenance);
  app.delete('/api/maintenances/:id', deleteMaintenance);
  app.get('/api/profile/:identifier', getPublicProfile);
  app.patch('/api/profile', updatePublicProfile);
  app.post('/api/profile/:userId/rep', toggleProfileRep);
  app.post('/api/profile/:userId/comments', addProfileComment);
  app.delete('/api/profile/comments/:id', deleteProfileComment);

  app.listen(env.dashboardPort, () => console.log(`  ${status('ok', 'Dashboard', `listening on ${env.dashboardUrl}`)}`));
  discord.once('clientReady', async () => {
    const { data: settings } = await supabase.from('guild_settings').select('bot_status').limit(1).maybeSingle();
    const configuredStatus = settings?.bot_status ?? '';
    const status: 'online' | 'idle' | 'dnd' | 'invisible' = ['online', 'idle', 'dnd', 'invisible'].includes(configuredStatus) ? configuredStatus as 'online' | 'idle' | 'dnd' | 'invisible' : 'idle';
    discord.user?.setPresence({ status, activities: [] });
    void waitForEmojis(discord).catch(() => undefined);
    setInterval(() => runWeeklyReports().catch(error => console.error('Weekly reports failed:', error)), 60 * 60 * 1000);
  });
  discord.login(env.token).catch(error => console.error('Dashboard Discord login failed:', error));
}

function reportPeriod() {
  const end = new Date();
  const currentMonday = new Date(end);
  currentMonday.setDate(end.getDate() - ((end.getDay() + 6) % 7));
  currentMonday.setHours(0, 0, 0, 0);
  const start = new Date(currentMonday);
  start.setDate(start.getDate() - 7);
  const periodEnd = new Date(currentMonday);
  periodEnd.setMilliseconds(-1);
  return { start, end: periodEnd };
}

async function staffMetrics(guildId: string, userId: string, start: Date, end: Date) {
  const [shifts, activities, staff, ratings] = await Promise.all([
    Shift.find({ guildId, userId }),
    StaffDailyActivity.find({ guildId, userId }),
    Staff.findOne({ guildId, userId }),
    StaffRating.find({ guildId, staffUserId: userId })
  ]);
  const range = shifts.filter(shift => shift.startedAt <= end && (!shift.endedAt || shift.endedAt >= start));
  const activityRange = activities.filter(activity => activity.activityDate >= start && activity.activityDate <= end);
  const shiftHours = range.reduce((sum, shift) => sum + activeDuration(shift), 0) / 3600000;
  const activityHours = activityRange.reduce((sum, activity) => sum + activity.activeMinutes, 0) / 60;
  const activeDays = new Set(activityRange.map(activity => activity.activityDate.toISOString().slice(0, 10))).size;
  const ratingCount = ratings.length;
  const ratingAverage = ratingCount ? ratings.reduce((sum, rating) => sum + rating.rating, 0) / ratingCount : 0;
  return { staff, shiftHours, activityHours, activeDays, ratingAverage, ratingCount };
}

function reportText(userId: string, report: { points: number; shiftHours: number; activityHours: number; voiceHours: number; messageCount: number; activeDays: number; complaints: number; ratingAverage: number; ratingCount: number; note?: string }) {
  return [
    `Rift weekly staff report for <@${userId}>`,
    `Points: ${report.points}`,
    `Shift hours: ${report.shiftHours.toFixed(1)}`,
    `Activity hours: ${report.activityHours.toFixed(1)}`,
    `Voice hours: ${report.voiceHours.toFixed(1)}`,
    `Messages: ${report.messageCount}`,
    `Active days: ${report.activeDays}`,
    `Approved complaints: ${report.complaints}`,
    `Rating: ${report.ratingAverage.toFixed(2)}/5 (${report.ratingCount} reviewers)`,
    report.note ? `Note: ${report.note}` : ''
  ].filter(Boolean).join('\n');
}

async function runWeeklyReports() {
  await runWeeklyReportsJob(discord);
}

function selectedGuildId(req: Request) {
  const id = (req.session as any).guildId as string | undefined;
  if (!id) throw new Error('No server selected.');
  const allowed = ((req.session as any).user as SessionUser).guilds.some(guild => guild.id === id);
  if (!allowed) throw new Error('Selected server is not available to this account.');
  return id;
}

async function getGuild(guildId: string) {
  return discord.guilds.fetch(guildId);
}

async function getMember(userId: string, guildId: string) {
  const guild = await getGuild(guildId);
  return guild.members.fetch(userId).catch(() => null);
}

async function getSettings(guildId: string) {
  const { data, error } = await supabase.from('guild_settings').select('*').eq('guild_id', guildId).maybeSingle();
  if (error) throw error;
  return data;
}

async function listComplaintStaffCandidates(req: Request, res: Response) {
  if (!await requireManagement(req, res)) return;
  try {
    const guildId = selectedGuildId(req);
    const guild = await getGuild(guildId);
    const members = await guild.members.fetch();
    const rows = await Staff.find({ guildId, active: true }).sort({ userId: 1 });
    const staff = rows
      .map(row => {
        const member = members.get(row.userId);
        if (!member || member.user.bot) return null;
        return { id: row.userId, username: member.user.username, displayName: member.displayName || member.user.username };
      })
      .filter((item): item is { id: string; username: string; displayName: string } => Boolean(item));
    res.json({ staff });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Could not load complaint staff list.' });
  }
}

async function panelOptions(req: Request, res: Response) {
  if (!await requireAdministrator(req, res)) return;
  try {
    const guild = await getGuild(selectedGuildId(req));
    const channels = (await guild.channels.fetch()).filter(channel => channel?.isTextBased()).map(channel => ({ id: channel!.id, name: channel!.name ?? channel!.id }));
    res.json({ channels });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Could not load channels.' }); }
}

async function sendShiftPanel(req: Request, res: Response) {
  if (!await requireManagement(req, res)) return;
  try {
    const guild = await getGuild(selectedGuildId(req));
    const channelId = String(req.body.channelId || '');
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) return res.status(400).json({ error: 'Select a text channel.' });
    const row = await getSettings(guild.id).catch(() => null);
    await channel.send(buildShiftPanel({ messages: row?.auto_shift_messages ?? undefined, windowMinutes: row?.auto_shift_window_minutes ?? undefined, idleMinutes: row?.auto_shift_idle_minutes ?? undefined, enabled: row?.auto_shift_enabled !== false }));
    res.json({ ok: true });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Could not send shift panel.' }); }
}

async function sendComplaintPanel(req: Request, res: Response) {
  if (!await requireManagement(req, res)) return;
  try {
    const guild = await getGuild(selectedGuildId(req));
    const channel = await guild.channels.fetch(String(req.body.channelId || '')).catch(() => null);
    if (!channel?.isTextBased()) return res.status(400).json({ error: 'Select a text channel.' });
    if (complaintPanelPublishing.has(channel.id)) return res.status(409).json({ error: 'Complaint panel update is already in progress.' });
    complaintPanelPublishing.add(channel.id);
    const settings = await getSettings(selectedGuildId(req));
    const payload = buildComplaintPanel(settings?.bot_language === 'ar' ? 'ar' : 'en');
    const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    const panels = [...(messages?.filter(message => message.author.id === discord.user?.id && message.components.some(row => 'components' in row && row.components.some(component => 'customId' in component && component.customId === 'complaint_panel_submit'))).values() ?? [])].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    const existing = panels[0];
    if (existing) await existing.edit(payload);
    else await channel.send(payload);
    for (const duplicate of panels.slice(1)) await duplicate.delete().catch(() => undefined);
    complaintPanelPublishing.delete(channel.id);
    res.json({ ok: true, updated: Boolean(existing), removedDuplicates: Math.max(0, panels.length - 1) });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Could not send complaint panel.' }); }
}

async function sendRatingPanel(req: Request, res: Response) {
  if (!await requireAdministrator(req, res)) return;
  try {
    const guild = await getGuild(selectedGuildId(req));
    const channelId = String(req.body.channelId || '');
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) return res.status(400).json({ error: 'اختر قناة نصية صحيحة.' });
    const payload = await buildRatingPanel(guild);
    if (!payload) return res.status(400).json({ error: 'لا يوجد ستاف مؤهل للتقييم.' });
    await channel.send(payload);
    res.json({ ok: true });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Could not send rating panel.' }); }
}

async function updateHelpCommands(req: Request, res: Response) {
  if (!await requireAdministrator(req, res)) return;
  const commands = [...new Set(String(req.body.commands || '').split(/[,\s]+/).map(value => value.replace(/^!/, '').trim()).filter(Boolean).slice(0, 10))];
  if (!commands.length) return res.status(400).json({ error: 'Add at least one help command.' });
  const { error } = await supabase.from('guild_settings').update({ help_commands: commands }).eq('guild_id', selectedGuildId(req));
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true, commands });
}

async function updateLanguage(req: Request, res: Response) {
  if (!await requireAdministrator(req, res)) return;
  const language = req.body.language === 'ar' ? 'ar' : 'en';
  const { error } = await supabase.from('guild_settings').update({ bot_language: language }).eq('guild_id', selectedGuildId(req));
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true, language });
}

async function createStaffReport(req: Request, res: Response) {
  if (!await requireAdministrator(req, res)) return;
  try {
    const guildId = selectedGuildId(req); const userId = String(req.body.staffUserId);
    const requestedStart = new Date(`${String(req.body.periodStart || '')}T00:00:00.000Z`);
    const requestedEnd = new Date(`${String(req.body.periodEnd || '')}T23:59:59.999Z`);
    const { start, end } = Number.isNaN(requestedStart.getTime()) || Number.isNaN(requestedEnd.getTime()) || requestedEnd < requestedStart ? reportPeriod() : { start: requestedStart, end: requestedEnd };
    const metrics = await staffMetrics(guildId, userId, start, end); if (!metrics.staff) return res.status(404).json({ error:'Staff member not found.' });
    const complaints = await Complaint.countDocuments({ guildId, staffUserId:userId, status:'approved' });
    const note = String(req.body.note || '').trim().slice(0, 1500);
    const report = await StaffReport.create({ guildId, staffUserId:userId, authorUserId:((req.session as any).user as SessionUser).id, periodStart:start, periodEnd:end, note, automated:false, shiftHours:metrics.shiftHours, activityHours:metrics.activityHours, activeDays:metrics.activeDays, helped:0, messageCount:metrics.staff.messageCount, points:metrics.staff.points, voiceHours:metrics.staff.voiceMinutes/60, complaints, ratingAverage:metrics.ratingAverage, ratingCount:metrics.ratingCount });
    const content = reportText(userId, { points:metrics.staff.points, shiftHours:metrics.shiftHours, activityHours:metrics.activityHours, voiceHours:metrics.staff.voiceMinutes/60, messageCount:metrics.staff.messageCount, activeDays:metrics.activeDays, complaints, ratingAverage:metrics.ratingAverage, ratingCount:metrics.ratingCount, note });
    const user = await discord.users.fetch(userId); await user.send({ content }).catch(()=>undefined);
    const guild = await getGuild(guildId); const settings = await getSettings(guildId); if (settings?.report_channel_id) { const channel = await guild.channels.fetch(settings.report_channel_id).catch(()=>null); if (channel?.isTextBased()) await channel.send({ content }); }
    res.json({ok:true, report});
  } catch(error){ res.status(400).json({error:error instanceof Error?error.message:'Could not create report.'}); }
}
async function listStaffReports(req: Request, res: Response){
  try {
    const user = (req.session as any).user as SessionUser;
    const guildId = selectedGuildId(req); const guild = await getGuild(guildId);
    const isAdmin = user.isOwner || user.isAdministrator || Boolean((await getMember(user.id, guildId))?.permissions.has(PermissionFlagsBits.Administrator));
    const rows = await StaffReport.find(isAdmin ? { guildId } : { guildId, staffUserId: user.id }).sort({createdAt:-1}).limit(50);
    const members = await guild.members.fetch().catch(() => guild.members.cache);
    const reports = rows.map(report => {
      const member = members.get(report.staffUserId) ?? null;
      const discordUser = member?.user ?? null;
      return { ...report, username: discordUser?.username ?? report.staffUserId, displayName: member?.displayName ?? discordUser?.username ?? report.staffUserId, avatar: member?.displayAvatarURL({ extension: 'png', size: 128 }) ?? discordUser?.displayAvatarURL({ extension: 'png', size: 128 }) ?? '', banner: member?.displayBannerURL({ extension: 'png', size: 1024 }) ?? discordUser?.bannerURL({ extension: 'png', size: 1024 }) ?? '' };
    });
    res.json({ reports, canCreate: isAdmin });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Could not load reports.' }); }
}

async function setupOptions(req: Request, res: Response) {
  if (!await requireAdministrator(req, res)) return;
  try {
    const guild = await getGuild(selectedGuildId(req));
    const roles = (await guild.roles.fetch()).filter(role => !role.managed).sort((a, b) => b.position - a.position).map(role => ({ id: role.id, name: role.name, color: role.hexColor }));
    const channels = (await guild.channels.fetch()).filter(channel => channel?.isTextBased()).map(channel => ({ id: channel!.id, name: channel!.name ?? channel!.id }));
    res.json({ roles, channels });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Could not load server options.' }); }
}

async function saveSetup(req: Request, res: Response) {
  if (!await requireAdministrator(req, res)) return;
  try {
    const guildId = selectedGuildId(req);
    const values = req.body as Record<string, string | null>;
    const requiredRoles = ['staffRoleId', 'onShiftRoleId', 'leaveRoleId'];
    const requiredChannels = ['shiftChannelId', 'leaveChannelId', 'resignationChannelId', 'logsChannelId'];
    if ([...requiredRoles, ...requiredChannels].some(key => !values[key])) return res.status(400).json({ error: 'Complete all required roles and channels.' });
    const guild = await getGuild(guildId);
    const roles = await guild.roles.fetch();
    const channels = await guild.channels.fetch();
    if (requiredRoles.some(key => !roles.has(values[key]!)) || requiredChannels.some(key => !channels.has(values[key]!))) return res.status(400).json({ error: 'One or more selected Discord resources are invalid.' });
    if (values.ratingChannelId && !channels.has(values.ratingChannelId)) return res.status(400).json({ error: 'The selected rating channel is invalid.' });
    const { error } = await supabase.from('guild_settings').upsert({ guild_id: guildId, staff_role_id: values.staffRoleId, on_shift_role_id: values.onShiftRoleId, leave_role_id: values.leaveRoleId, management_role_id: null, shift_channel_id: values.shiftChannelId, leave_channel_id: values.leaveChannelId, resignation_channel_id: values.resignationChannelId, logs_channel_id: values.logsChannelId, report_channel_id: values.reportChannelId || null, complaint_channel_id: values.complaintChannelId || null, rating_channel_id: values.ratingChannelId || null }, { onConflict: 'guild_id' });
    if (error) throw error;
    res.json({ ok: true });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Could not save setup.' }); }
}

async function updateMessageSettings(req: Request, res: Response) {
  if (!await requireAdministrator(req, res)) return;
  const guildId = selectedGuildId(req);
  const values = req.body as Record<string, string>;
  const clean = (value: string | undefined, fallback: string) => String(value ?? fallback).trim().slice(0, 400);
  const { error } = await supabase.from('guild_settings').update({
    points_message_title: clean(values.title, '💜 Rift • نقاطك الخاصة'),
    points_message_description: clean(values.description, 'هذا التقرير خاص بك ولا يظهر لباقي الأعضاء.'),
    points_message_footer: clean(values.footer, 'Rift Staff Operations')
  }).eq('guild_id', guildId);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true });
}

async function listGuilds(req: Request, res: Response) {
  const user = (req.session as any).user as SessionUser;
  res.json({ guilds: user.guilds, selectedGuildId: selectedGuildId(req) });
}

async function selectGuild(req: Request, res: Response) {
  const user = (req.session as any).user as SessionUser;
  const guildId = String(req.body.guildId || '');
  const candidate = user.guilds.find(guild => guild.id === guildId);
  if (!candidate) return res.status(403).json({ error: 'You cannot access this server.' });
  const guild = await getGuild(guildId);
  const member = await getMember(user.id, guildId);
  const settings = await getSettings(guildId);
  const isOwner = guild.ownerId === user.id;
  const isManagement = isOwner || Boolean(member?.permissions.has(PermissionFlagsBits.Administrator));
  const isStaff = Boolean(settings?.staff_role_id && member?.roles.cache.has(settings.staff_role_id));
  if (!isStaff) return res.status(403).json({ error: 'The configured staff role is required.' });
  (req.session as any).guildId = guildId;
  (req.session as any).user = { ...user, isOwner, isAdministrator: Boolean(member?.permissions.has(PermissionFlagsBits.Administrator)), isManagement, isStaff };
  res.json({ ok: true });
}

function restoreSession(req: Request) {
  if (!(req.session as any).user) {
    const value = req.headers.cookie?.split(';').map(item => item.trim()).find(item => item.startsWith('rift_auth='))?.slice(10);
    const cookie = readAuthCookie(value);
    if (cookie) { (req.session as any).user = cookie.user; (req.session as any).guildId = cookie.guildId; }
  }
  return Boolean((req.session as any).user);
}

async function hasConfiguredStaffRole(req: Request) {
  const user = (req.session as any).user as SessionUser | undefined;
  const guildId = (req.session as any).guildId as string | undefined;
  if (!user || !guildId) return false;
  const [guild, member, settings] = await Promise.all([
    getGuild(guildId).catch(() => null),
    getMember(user.id, guildId),
    getSettings(guildId).catch(() => null)
  ]);
  const isOwner = guild?.ownerId === user.id;
  const isAdministrator = Boolean(member?.permissions.has(PermissionFlagsBits.Administrator));
  const isStaff = Boolean(settings?.staff_role_id && member?.roles.cache.has(settings.staff_role_id));
  user.isOwner = isOwner;
  user.isAdministrator = isAdministrator;
  user.isManagement = isOwner || isAdministrator;
  user.isStaff = isStaff;
  (req.session as any).user = user;
  return isStaff;
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!restoreSession(req)) return res.status(401).json({ error: 'Authentication required.' });
  next();
}

async function requireStaffApi(req: Request, res: Response, next: NextFunction) {
  if (!restoreSession(req)) return res.status(401).json({ error: 'Authentication required.' });
  if (await hasConfiguredStaffRole(req)) return next();
  req.session.destroy(() => undefined);
  res.clearCookie('rift_auth', { path: '/' });
  res.clearCookie('connect.sid', { path: '/' });
  res.status(403).json({ error: 'The configured staff role is required to access the dashboard.' });
}

async function requireStaffPage(req: Request, res: Response, next: NextFunction) {
  if (restoreSession(req) && await hasConfiguredStaffRole(req)) return next();
  req.session.destroy(() => undefined);
  res.clearCookie('rift_auth', { path: '/' });
  res.clearCookie('connect.sid', { path: '/' });
  const reason = typeof req.query.error === 'string' && /^[a-z_]{1,24}$/.test(req.query.error) ? req.query.error : '';
  res.redirect(reason ? `/login?error=${reason}` : '/login');
}

async function requireManagement(req: Request, res: Response) {
  return requireAdministrator(req, res);
}

async function requireOwner(req: Request, res: Response) {
  const user = (req.session as any).user as SessionUser;
  if (user.isOwner) return true;
  res.status(403).json({ error: 'Only the server owner can perform this action.' });
  return false;
}

async function requireAdministrator(req: Request, res: Response) {
  const user = (req.session as any).user as SessionUser;
  const guildId = selectedGuildId(req);
  const guild = await getGuild(guildId).catch(() => null);
  const member = await getMember(user.id, guildId);
  const isOwner = guild?.ownerId === user.id;
  const isAdministrator = Boolean(member?.permissions.has(PermissionFlagsBits.Administrator));
  user.isOwner = isOwner;
  user.isAdministrator = isAdministrator;
  user.isManagement = isOwner || isAdministrator;
  (req.session as any).user = user;
  if (isOwner || isAdministrator) return true;
  res.status(403).json({ error: 'Administrator permission is required for this action.' });
  return false;
}

async function requireStaffAccess(req: Request, res: Response) {
  const user = (req.session as any).user as SessionUser;
  if (user.isStaff || user.isAdministrator || user.isOwner) return true;
  res.status(403).json({ error: 'Staff role is required to submit this request.' });
  return false;
}

async function bootstrap(_req: Request, res: Response) {
  if (!await requireAdministrator(_req, res)) return;
  try {
    const req = _req;
    const guildId = selectedGuildId(req);
    const guild = await getGuild(guildId);
    const settings = await getSettings(guildId);
    if (settings?.staff_role_id) await syncStaffMembers(guild, settings.staff_role_id);
    const [staffRows, shifts, complaints, ratingRows, activities, leaves, resignations] = await Promise.all([
      Staff.find({ guildId, active: true }), Shift.find({ guildId }).sort({ startedAt: -1 }).limit(1000), Complaint.find({ guildId }).sort({ createdAt: -1 }).limit(50), StaffRating.find({ guildId }).sort({ createdAt: -1 }).limit(300), StaffDailyActivity.find({ guildId }), LeaveRequest.find({ guildId }).sort({ createdAt: -1 }).limit(100), ResignationRequest.find({ guildId }).sort({ createdAt: -1 }).limit(100)
    ]);
    const ratings = uniqueRatings(ratingRows);
    const members = guild.members.cache;
    const staff = await Promise.all(staffRows.map(async row => {
      const member = members.get(row.userId);
      const user = member?.user ?? await discord.users.fetch(row.userId).catch(() => null);
      const userRatings = ratings.filter(rating => rating.staffUserId === row.userId);
      const userShifts = shifts.filter(shift => shift.userId === row.userId);
      const userComplaints = complaints.filter(complaint => complaint.staffUserId === row.userId && complaint.status === 'approved');
      const activityHours = activities.filter(activity => activity.userId === row.userId).reduce((sum, activity) => sum + activity.activeMinutes, 0) / 60;
      const totalMs = userShifts.reduce((sum, shift) => sum + activeDuration(shift), 0);
      return { userId: row.userId, username: user?.username ?? row.userId, displayName: member?.displayName ?? user?.username ?? row.userId, avatar: member?.displayAvatarURL({ extension: 'png', size: 128 }) ?? user?.displayAvatarURL({ extension: 'png', size: 128 }) ?? '', banner: member?.displayBannerURL({ extension: 'png', size: 1024 }) ?? user?.bannerURL({ extension: 'png', size: 1024 }) ?? '', joinedAt: row.joinedAt, points: row.points, messageCount: row.messageCount, voiceMinutes: row.voiceMinutes, activityHours, complaintCount: userComplaints.length, ratingCount: userRatings.length, averageRating: userRatings.length ? userRatings.reduce((sum, rating) => sum + rating.rating, 0) / userRatings.length : 0, shiftHours: totalMs / 3600000, active: Boolean(shifts.find(shift => shift.userId === row.userId && shift.status === 'active')), status: 'active', rank: '', notes: staffNotes.get(`${guildId}:${row.userId}`) ?? [] };
    }));
    const viewerId = ((req.session as any).user as SessionUser).id;
    const viewer = staff.find(item => item.userId === viewerId) ?? null;
    const viewerComplaints = complaints.filter(item => item.staffUserId === viewerId && item.status === 'approved').length;
    const ratingsWithNames = ratings.map(rating => ({ ...rating, reviewerName: members.get(rating.reviewerUserId)?.displayName ?? rating.reviewerUserId }));
    res.json({ guild: { id: guild.id, name: guild.name, icon: guild.iconURL({ extension: 'png', size: 128 }) }, settings, staff, viewer: viewer ? { ...viewer, complaintCount: viewerComplaints, voiceHours: (viewer.voiceMinutes ?? 0) / 60, messageCount: viewer.messageCount ?? 0 } : null, shifts, complaints, leaves, resignations, ratings: ratingsWithNames, botStatus: settings?.bot_status ?? 'idle' });
  } catch (error) {
    console.error(error);
    if (error instanceof Error && error.message.includes('Unknown Guild')) {
      _req.session.destroy(() => undefined);
      return res.status(401).json({ error: 'The selected server is no longer available to Rift. Please sign in again and select the correct server.' });
    }
    res.status(500).json({ error: error instanceof Error ? error.message : 'Could not load dashboard data.' });
  }
}

async function listNotifications(req: Request, res: Response) {
  const guildId = selectedGuildId(req);
  const user = (req.session as any).user as SessionUser;
  const notifications = (dashboardNotifications.get(guildId) ?? []).filter(item => item.recipientUserId === user.id);
  const unread = notifications.filter(item => !item.readBy.some(read => read.userId === user.id)).length;
  res.json({ notifications, unread });
}

async function listManagementUsers(req: Request, res: Response) {
  try {
    const guild = await getGuild(selectedGuildId(req));
    const members = guild.members.cache.size >= guild.memberCount ? guild.members.cache : await guild.members.fetch();
    const users = [...members.values()]
      .filter(member => !member.user.bot && member.permissions.has(PermissionFlagsBits.Administrator))
      .map(member => ({ userId: member.id, username: member.user.username, displayName: member.displayName, avatar: member.user.displayAvatarURL({ extension: 'png', size: 128 }) }));
    res.json({ users });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Could not load management users.' });
  }
}

async function createAdminNote(req: Request, res: Response) {
  if (!await requireAdministrator(req, res)) return;
  try {
    const guildId = selectedGuildId(req);
    const recipientUserId = String(req.body.recipientUserId || '');
    const message = String(req.body.message || '').trim().slice(0, 2000);
    const delivery = ['dashboard', 'discord', 'both'].includes(req.body.delivery) ? req.body.delivery : 'dashboard';
    if (!recipientUserId || !message) return res.status(400).json({ error: 'Choose a recipient and enter a message.' });
    const recipient = await getMember(recipientUserId, guildId);
    if (!recipient) return res.status(404).json({ error: 'Recipient is not in this server.' });
    const sender = (req.session as any).user as SessionUser;
    const senderMember = await getMember(sender.id, guildId);
    const senderUser = await discord.users.fetch(sender.id).catch(() => null);
    const senderName = senderMember?.displayName ?? senderUser?.username ?? sender.username;
    const senderAvatar = senderMember?.displayAvatarURL({ extension: 'png', size: 128 }) ?? senderUser?.displayAvatarURL({ extension: 'png', size: 128 }) ?? '';
    const notification: DashboardNotification = { id: crypto.randomUUID(), guildId, recipientUserId, senderUserId: sender.id, senderName, senderAvatar, title: 'Rift private note', message, createdAt: new Date(), readBy: [] };
    const rows = dashboardNotifications.get(guildId) ?? [];
    rows.unshift(notification); dashboardNotifications.set(guildId, rows);
    let discordSent = true;
    if (delivery === 'discord' || delivery === 'both') {
      const embed = new EmbedBuilder().setColor(0x9474ff).setTitle('Rift private note').setDescription(message).setFooter({ text: 'Sent from the Rift dashboard' }).setTimestamp();
      embed.setAuthor({ name: `From ${senderName}`, ...(senderAvatar ? { iconURL: senderAvatar } : {}) });
      discordSent = Boolean(await recipient.user.send({ embeds: [embed] }).catch(() => null));
    }
    res.json({ ok: true, discordSent });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Could not send the notification.' }); }
}

async function markNotificationRead(req: Request, res: Response) {
  const guildId = selectedGuildId(req);
  const user = (req.session as any).user as SessionUser;
  const notification = (dashboardNotifications.get(guildId) ?? []).find(item => item.id === req.params.id && item.recipientUserId === user.id);
  if (!notification) return res.status(404).json({ error: 'Notification not found.' });
  if (!notification.readBy.some(item => item.userId === user.id)) notification.readBy.push({ userId: user.id });
  res.json({ ok: true });
}

async function listAuditLog(req: Request, res: Response) {
  if (!await requireAdministrator(req, res)) return;
  try {
    const guildId = selectedGuildId(req);
    const query = String(req.query.q || '').trim().toLowerCase();
    const action = String(req.query.action || '');
    const from = String(req.query.from || ''); const to = String(req.query.to || '');
    const page = Math.max(1, Number(req.query.page) || 1); const pageSize = 50;
    let rows = await StaffLog.find({ guildId }).sort({ createdAt: -1 });
    if (action) rows = rows.filter(row => row.action === action);
    if (from) rows = rows.filter(row => row.createdAt >= new Date(`${from}T00:00:00.000Z`));
    if (to) rows = rows.filter(row => row.createdAt <= new Date(`${to}T23:59:59.999Z`));
    const guild = await getGuild(guildId); const members = guild.members.cache;
    let namedRows = rows.map(row => ({ ...row, name: members.get(row.userId)?.displayName ?? row.userId, actorName: row.actorId ? (members.get(row.actorId)?.displayName ?? row.actorId) : null }));
    if (query) namedRows = namedRows.filter(row => `${row.action} ${row.name} ${row.actorName || ''}`.toLowerCase().includes(query));
    const actions = [...new Set(rows.map(row => row.action))].sort();
    const start = (page - 1) * pageSize;
    res.json({ rows: namedRows.slice(start, start + pageSize), actions, total: namedRows.length, hasMore: start + pageSize < namedRows.length });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Could not load audit logs.' }); }
}

async function addStaffNote(req: Request, res: Response) {
  if (!await requireAdministrator(req, res)) return;
  const text = String(req.body.text || '').trim().slice(0, 1000);
  if (!text) return res.status(400).json({ error: 'Note text is required.' });
  const guildId = selectedGuildId(req); const actor = (req.session as any).user as SessionUser;
  const key = `${guildId}:${req.params.userId}`; const notes = staffNotes.get(key) ?? [];
  notes.unshift({ text, addedBy: actor.username, createdAt: new Date() }); staffNotes.set(key, notes);
  await createLog(guildId, 'STAFF_NOTE_ADDED', String(req.params.userId), actor.id).catch(() => undefined);
  res.json({ ok: true });
}

async function updateDeveloperMode(req: Request, res: Response) {
  if (!await requireAdministrator(req, res)) return;
  const guildId = selectedGuildId(req); const enabled = Boolean(req.body.enabled);
  developerModes.set(guildId, enabled); res.json({ ok: true, enabled });
}

async function updateStaffReport(req: Request, res: Response) {
  if (!await requireAdministrator(req, res)) return;
  try {
    const guildId = selectedGuildId(req); const id = Number(req.params.id);
    const report = await StaffReport.findOne({ id, guildId });
    if (!report) return res.status(404).json({ error: 'Report not found.' });
    const note = String(req.body.note || '').trim().slice(0, 1500);
    res.json({ ok: true, report: await StaffReport.update(report.id, { note }) });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Could not update report.' }); }
}

async function deleteStaffReport(req: Request, res: Response) {
  if (!await requireAdministrator(req, res)) return;
  try {
    const guildId = selectedGuildId(req); const id = Number(req.params.id);
    const report = await StaffReport.findOne({ id, guildId });
    if (!report) return res.status(404).json({ error: 'Report not found.' });
    await StaffReport.deleteMany({ id, guildId }); res.json({ ok: true });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Could not delete report.' }); }
}

function maintenanceGroups(guildId?: string) {
  const now = Date.now(); const rows = [...dashboardMaintenances.values()].flat().filter(item => !guildId || item.guildId === guildId).map(item => ({ ...item, status: item.status === 'completed' ? 'completed' : new Date(item.startsAt).getTime() <= now ? 'in_progress' : 'scheduled' }));
  return { ongoing: rows.filter(item => item.status === 'in_progress'), upcoming: rows.filter(item => item.status === 'scheduled'), completed: rows.filter(item => item.status === 'completed') };
}

async function createMaintenance(req: Request, res: Response) {
  if (!await requireAdministrator(req, res)) return;
  const guildId = selectedGuildId(req); const title = String(req.body.title || '').trim().slice(0, 90); const startsAt = String(req.body.startsAt || ''); const endsAt = String(req.body.endsAt || '');
  if (!title || Number.isNaN(new Date(startsAt).getTime()) || Number.isNaN(new Date(endsAt).getTime())) return res.status(400).json({ error: 'Enter a title and valid maintenance dates.' });
  const entry: DashboardMaintenance = { id: crypto.randomUUID(), guildId, title, description: String(req.body.description || '').trim().slice(0, 600), startsAt, endsAt, affects: Array.isArray(req.body.affects) ? req.body.affects.map(String).slice(0, 4) : [], status: 'scheduled' };
  const rows = dashboardMaintenances.get(guildId) ?? []; rows.unshift(entry); dashboardMaintenances.set(guildId, rows); res.json({ ok: true, maintenance: entry });
}

async function endMaintenance(req: Request, res: Response) {
  if (!await requireAdministrator(req, res)) return;
  const entry = (dashboardMaintenances.get(selectedGuildId(req)) ?? []).find(item => item.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'Maintenance item not found.' }); entry.status = 'completed'; res.json({ ok: true });
}

async function deleteMaintenance(req: Request, res: Response) {
  if (!await requireAdministrator(req, res)) return;
  const guildId = selectedGuildId(req); const rows = dashboardMaintenances.get(guildId) ?? []; dashboardMaintenances.set(guildId, rows.filter(item => item.id !== req.params.id)); res.json({ ok: true });
}

async function resolveProfileMember(req: Request) {
  const guildId = selectedGuildId(req); const guild = await getGuild(guildId); const user = (req.session as any).user as SessionUser; const identifier = String(req.params.identifier || user.id);
  if (identifier === 'me') return { guildId, guild, member: await getMember(user.id, guildId) };
  const direct = await getMember(identifier, guildId); if (direct) return { guildId, guild, member: direct };
  const member = [...guild.members.cache.values()].find(item => item.user.username.toLowerCase() === identifier.toLowerCase());
  return { guildId, guild, member: member ?? null };
}

function connectionUrl(type: string, id: string, name: string) {
  if (type === 'github') return `https://github.com/${encodeURIComponent(name)}`;
  if (type === 'spotify') return `https://open.spotify.com/user/${encodeURIComponent(id)}`;
  if (type === 'twitch') return `https://twitch.tv/${encodeURIComponent(name)}`;
  if (type === 'youtube') return `https://youtube.com/@${encodeURIComponent(name)}`;
  return '';
}

async function getDiscordConnections(accessToken: string) {
  const response = await fetch('https://discord.com/api/users/@me/connections', { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) return null;
  const rows = await response.json() as Array<{ type?: string; id?: string; name?: string; verified?: boolean; visibility?: number }>;
  return rows.filter(row => row.visibility === 1 && row.type && row.id && row.name).map(row => ({ type: String(row.type), id: String(row.id), name: String(row.name), verified: Boolean(row.verified), url: connectionUrl(String(row.type), String(row.id), String(row.name)) }));
}

async function getPublicProfile(req: Request, res: Response) {
  try {
    const { guildId, guild, member } = await resolveProfileMember(req); if (!member) return res.status(404).json({ error: 'Profile not found.' });
    const sessionUser = (req.session as any).user as SessionUser; const key = `${guildId}:${member.id}`;
    const profileMember = await member.fetch(true).catch(() => member);
    const profileUser = await discord.users.fetch(profileMember.id, { force: true }).catch(() => profileMember.user);
    const [staff, shifts, ratings, activities, logs] = await Promise.all([Staff.findOne({ guildId, userId: profileMember.id }), Shift.find({ guildId, userId: profileMember.id }).sort({ startedAt: -1 }).limit(30), StaffRating.find({ guildId, staffUserId: profileMember.id }).sort({ createdAt: -1 }).limit(20), StaffDailyActivity.find({ guildId, userId: profileMember.id }), StaffLog.find({ guildId, userId: profileMember.id }).sort({ createdAt: -1 }).limit(20)]);
    const profile = publicProfiles.get(key) ?? { tagline: '', bio: '', accent: '', bannerUrl: '', showFeedback: true, showConnections: true, links: [] };
    const isSelf = sessionUser.id === profileMember.id;
    const accessToken = (req.session as any).discordAccessToken as string | undefined;
    if (isSelf && accessToken) {
      const connections = await getDiscordConnections(accessToken).catch(() => null);
      if (connections) profileConnections.set(key, connections);
    }
    const connections = profile.showConnections ? profileConnections.get(key) ?? [] : [];
    const totalShiftMinutes = shifts.reduce((total, shift) => total + Math.floor(activeDuration(shift) / 60_000), 0); const ratingCount = ratings.length; const averageRating = ratingCount ? ratings.reduce((sum, row) => sum + row.rating, 0) / ratingCount : 0;
    const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - 13);
    const weekly = Array.from({ length: 14 }, (_, index) => { const day = new Date(start); day.setDate(day.getDate() + index); const row = activities.find(activity => activity.activityDate.toISOString().slice(0, 10) === day.toISOString().slice(0, 10)); return { date: day.toISOString().slice(0, 10), minutes: row?.activeMinutes ?? 0, messages: row?.messageCount ?? 0 }; });
    const reps = profileReputations.get(key) ?? new Set<string>(); const comments = profileComments.get(key) ?? [];
    res.json({ member: { userId: profileMember.id, username: profileUser.username, displayName: profileMember.displayName, avatar: profileMember.displayAvatarURL({ extension: 'png', size: 256 }), discordBanner: profileMember.displayBannerURL({ extension: 'png', size: 1024 }) ?? profileUser.bannerURL({ extension: 'png', size: 1024 }) ?? '', joinedAt: profileMember.joinedAt ?? staff?.joinedAt ?? null, rank: '' }, profile, stats: { points: staff?.points ?? 0, shiftHours: (totalShiftMinutes / 60).toFixed(1), activityHours: (activities.reduce((sum, row) => sum + row.activeMinutes, 0) / 60).toFixed(1), messages: staff?.messageCount ?? 0, voiceHours: ((staff?.voiceMinutes ?? 0) / 60).toFixed(1), complaints: 0, position: 0, totalStaff: await Staff.countDocuments({ guildId, active: true }), ratingCount, averageRating, closed: 0, assists: 0 }, level: { level: Math.floor((staff?.points ?? 0) / 100) + 1, progress: ((staff?.points ?? 0) % 100) / 100, toNext: 100 - ((staff?.points ?? 0) % 100) }, weekly, connections, connectionsHidden: !profile.showConnections, connectionsRequiresAuth: isSelf && !accessToken, feedbackHidden: !profile.showFeedback && !isSelf, feedback: profile.showFeedback || isSelf ? ratings.map(row => ({ ...row, reviewerName: guild.members.cache.get(row.reviewerUserId)?.displayName ?? row.reviewerUserId })) : [], activity: logs, shifts: shifts.map(shift => ({ startedAt: shift.startedAt, status: shift.status, minutes: Math.floor(activeDuration(shift) / 60_000) })), social: { reps: reps.size, hasRep: reps.has(sessionUser.id), commentCount: comments.length, views: 0 }, comments: comments.map(comment => ({ ...comment, canDelete: comment.authorUserId === sessionUser.id || sessionUser.isAdministrator || sessionUser.isOwner })), isSelf, viewer: { name: sessionUser.username, avatar: sessionUser.avatar ? `https://cdn.discordapp.com/avatars/${sessionUser.id}/${sessionUser.avatar}.png?size=64` : '' } });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Could not load profile.' }); }
}

async function updatePublicProfile(req: Request, res: Response) {
  const guildId = selectedGuildId(req); const user = (req.session as any).user as SessionUser; const key = `${guildId}:${user.id}`;
  publicProfiles.set(key, { tagline: String(req.body.tagline || '').trim().slice(0, 60), bio: String(req.body.bio || '').trim().slice(0, 300), accent: String(req.body.accent || '').slice(0, 7), bannerUrl: String(req.body.bannerUrl || '').trim().slice(0, 500), showFeedback: Boolean(req.body.showFeedback), showConnections: Boolean(req.body.showConnections), links: Array.isArray(req.body.links) ? req.body.links.map((item: any) => ({ label: String(item?.label || '').slice(0, 24), url: String(item?.url || '').slice(0, 200) })).filter((item: { url: string }) => item.url) : [] });
  res.json({ ok: true });
}

/** The profile owner in a rep/comment route must be a real member of the selected server (stops unbounded junk entries) . */
async function profileTargetOk(req: Request, res: Response, guildId: string) {
  const target = String(req.params.userId || '');
  if (!/^\d{15,22}$/.test(target) || !await getMember(target, guildId)) { res.status(404).json({ error: 'Profile not found.' }); return false; }
  return true;
}

async function toggleProfileRep(req: Request, res: Response) {
  const guildId = selectedGuildId(req); const user = (req.session as any).user as SessionUser;
  if (!await profileTargetOk(req, res, guildId)) return;
  if (req.params.userId === user.id) return void res.status(400).json({ error: 'You cannot give rep to yourself.' });
  const key = `${guildId}:${req.params.userId}`; const reps = profileReputations.get(key) ?? new Set<string>();
  if (reps.has(user.id)) reps.delete(user.id); else reps.add(user.id); profileReputations.set(key, reps); res.json({ reps: reps.size, hasRep: reps.has(user.id) });
}

async function addProfileComment(req: Request, res: Response) {
  const guildId = selectedGuildId(req); const user = (req.session as any).user as SessionUser;
  if (!await profileTargetOk(req, res, guildId)) return;
  if ((profileComments.get(`${guildId}:${req.params.userId}`)?.length ?? 0) >= 200) return void res.status(429).json({ error: 'This profile has too many comments.' });
  const text = String(req.body.text || '').trim().slice(0, 500); if (!text) return res.status(400).json({ error: 'Comment text is required.' });
  const key = `${guildId}:${req.params.userId}`; const comment = { id: crypto.randomUUID(), authorUserId: user.id, authorName: user.username, authorUsername: user.username, authorAvatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64` : '', text, createdAt: new Date() }; const rows = profileComments.get(key) ?? []; rows.unshift(comment); profileComments.set(key, rows); res.json({ comment: { ...comment, canDelete: true } });
}

async function deleteProfileComment(req: Request, res: Response) {
  const user = (req.session as any).user as SessionUser; for (const [key, comments] of profileComments) { const comment = comments.find(item => item.id === req.params.id); if (!comment) continue; if (comment.authorUserId !== user.id && !user.isAdministrator && !user.isOwner) return res.status(403).json({ error: 'You cannot delete this comment.' }); profileComments.set(key, comments.filter(item => item.id !== comment.id)); return res.json({ ok: true }); } res.status(404).json({ error: 'Comment not found.' });
}

async function listShifts(req: Request, res: Response) {
  if (!await requireAdministrator(req, res)) return;
  try {
    const guildId = selectedGuildId(req);
    const guild = await getGuild(guildId);
    const [shifts, staffRows] = await Promise.all([
      Shift.find({ guildId }).sort({ startedAt: -1 }).limit(1000),
      Staff.find({ guildId, active: true })
    ]);
    const staff = await Promise.all(staffRows.map(async row => {
      const member = guild.members.cache.get(row.userId);
      const user = member?.user ?? await discord.users.fetch(row.userId).catch(() => null);
      const totalMs = shifts.filter(shift => shift.userId === row.userId).reduce((sum, shift) => sum + activeDuration(shift), 0);
      return { userId: row.userId, displayName: member?.displayName ?? user?.username ?? row.userId, username: user?.username ?? row.userId, active: row.active, shiftHours: totalMs / 3_600_000 };
    }));
    res.json({ shifts, staff, summary: { active: shifts.filter(shift => shift.status === 'active').length } });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Could not load shifts.' }); }
}

async function listStaff(req: Request, res: Response) {
  if (!await requireAdministrator(req, res)) return;
  try {
    const guildId = selectedGuildId(req);
    const guild = await getGuild(guildId);
    const rows = await Staff.find({ guildId, active: true });
    const staff = await Promise.all(rows.map(async row => {
      const member = guild.members.cache.get(row.userId);
      const user = member?.user ?? await discord.users.fetch(row.userId).catch(() => null);
      return { userId: row.userId, username: user?.username ?? row.userId, displayName: member?.displayName ?? user?.username ?? row.userId, points: row.points, messageCount: row.messageCount, voiceMinutes: row.voiceMinutes };
    }));
    res.json({ staff });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Could not load staff.' }); }
}

async function weeklyActivity(req: Request, res: Response) {
  if (!await requireAdministrator(req, res)) return;
  try {
    const guildId = selectedGuildId(req);
    const dayMs = 86_400_000;
    const start = new Date(Math.floor(Date.now() / dayMs) * dayMs - 13 * dayMs);
    const [activities, shifts] = await Promise.all([StaffDailyActivity.find({ guildId }), Shift.find({ guildId })]);
    const days = Array.from({ length: 14 }, (_, index) => ({ date: new Date(start.getTime() + index * dayMs).toISOString().slice(0, 10), minutes: 0, messages: 0, shiftHours: 0 }));
    const dayIndex = (value: Date) => Math.floor((new Date(value).getTime() - start.getTime()) / dayMs);
    for (const activity of activities) {
      const index = dayIndex(activity.activityDate);
      if (index >= 0 && index < days.length) { days[index]!.minutes += activity.activeMinutes; days[index]!.messages += activity.messageCount; }
    }
    for (const shift of shifts) {
      const index = dayIndex(shift.startedAt);
      if (index >= 0 && index < days.length) days[index]!.shiftHours += activeDuration(shift) / 3_600_000;
    }
    res.json({ days: days.map(day => ({ ...day, shiftHours: Math.round(day.shiftHours * 10) / 10 })) });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Could not load activity.' }); }
}

async function health(req: Request, res: Response) {
  if (!await requireAdministrator(req, res)) return;
  try {
    const guildId = selectedGuildId(req);
    const started = performance.now();
    const { error } = await supabase.from('guild_settings').select('guild_id').limit(1);
    const latencyMs = Math.round(performance.now() - started);
    const [staff, activeShifts, pendingComplaints, pendingLeaves, pendingResignations, logs] = await Promise.all([
      Staff.countDocuments({ guildId, active: true }),
      Shift.countDocuments({ guildId, status: 'active' }),
      Complaint.countDocuments({ guildId, status: 'pending' }),
      LeaveRequest.countDocuments({ guildId, status: 'pending' }),
      ResignationRequest.countDocuments({ guildId, status: 'pending' }),
      StaffLog.find({ guildId }).sort({ id: -1 }).limit(12)
    ]);
    const now = Date.now();
    res.json({ now, bot: { startedAt: dashboardStartedAt, updatedAt: new Date(), pingMs: Math.max(0, Math.round(discord.ws.ping)), guilds: discord.guilds.cache.size, memoryMb: Math.round(process.memoryUsage().rss / 1_048_576), nodeVersion: process.version, activeShifts }, database: { connected: !error, latencyMs }, dashboard: { uptimeSec: Math.floor((now - dashboardStartedAt.getTime()) / 1000), memoryMb: Math.round(process.memoryUsage().rss / 1_048_576), gatewayReady: discord.isReady(), gatewayPingMs: Math.max(0, Math.round(discord.ws.ping)) }, queue: { staff, pendingComplaints, pendingLeaves, pendingResignations }, logs, uptime: { uptime24h: null, uptime30: null, days: [], halfHours: [], incidents: [] } });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Could not load health.' }); }
}

async function publicStatus(_req: Request, res: Response) {
  const started = performance.now();
  const { error } = await supabase.from('guild_settings').select('guild_id').limit(1);
  const latencyMs = Math.round(performance.now() - started);
  const botReady = discord.isReady();
  const databaseState = error ? 'outage' : latencyMs > 300 ? 'degraded' : 'operational';
  const botState = botReady ? 'operational' : 'outage';
  const gatewayPing = Math.max(0, Math.round(discord.ws.ping));
  const discordState = !botReady ? 'outage' : gatewayPing > 400 ? 'degraded' : 'operational';
  const overallState = botState === 'outage' || databaseState === 'outage' || discordState === 'outage' ? 'outage' : databaseState === 'degraded' || discordState === 'degraded' ? 'degraded' : 'operational';
  const detail = botReady ? `Responding, ${Math.max(0, Math.round(discord.ws.ping))} ms to Discord` : 'Dashboard gateway is connecting';
  const components = [
    { key: 'bot', name: 'Rift bot', description: 'Shifts, points, voice activity and staff actions', state: botState, detail, uptime30: null, days: [] },
    { key: 'discord', name: 'Discord gateway', description: 'Live connection between Rift and Discord', state: discordState, detail: botReady ? `${gatewayPing} ms gateway latency across ${discord.guilds.cache.size} server(s)` : 'Waiting for the Rift bot to connect', uptime30: null, days: [] },
    { key: 'database', name: 'Supabase database', description: 'Stores Rift staff, shifts and activity', state: databaseState, detail: error ? 'Connection unavailable' : `Connected, ${latencyMs} ms query`, uptime30: null, days: [] },
    { key: 'dashboard', name: 'Rift dashboard', description: 'Dashboard, profiles and public status', state: 'operational', detail: 'Serving requests', uptime30: null, days: [] }
  ];
  res.json({ generatedAt: new Date().toISOString(), name: 'Rift', overall: { state: overallState, title: overallState === 'operational' ? 'All systems operational' : overallState === 'degraded' ? 'Partial degradation' : 'Major outage', text: overallState === 'operational' ? 'All Rift services are running normally' : 'One or more Rift services need attention' }, uptime: { h24: null, d30: null, since: dashboardStartedAt.toISOString() }, components, incidents: [], maintenances: maintenanceGroups(), restarts: [], lastSampleAt: new Date().toISOString() });
}

async function publicStatusMetrics(req: Request, res: Response) {
  const range = ['1h', '24h', '7d', '30d', '90d'].includes(String(req.query.range)) ? String(req.query.range) : '24h';
  const durationMs = { '1h': 3_600_000, '24h': 86_400_000, '7d': 604_800_000, '30d': 2_592_000_000, '90d': 7_776_000_000 }[range] ?? 86_400_000;
  const started = performance.now(); const { error } = await supabase.from('guild_settings').select('guild_id').limit(1); const dbMs = Math.max(0, Math.round(performance.now() - started));
  res.json({ source: String(req.query.source || 'dashboard'), range, bucketMs: Math.max(60_000, Math.round(durationMs / 48)), from: new Date(Date.now() - durationMs).toISOString(), points: [{ t: Date.now(), cpu: 0, mem: Math.round(process.memoryUsage().rss / 1_048_576), ping: Math.max(0, Math.round(discord.ws.ping)), dbMs: error ? 0 : dbMs }] });
}

function uniqueRatings<T extends { guildId: string; staffUserId: string; reviewerUserId: string; createdAt: Date }>(rows: T[]) {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const key = `${row.guildId}:${row.staffUserId}:${row.reviewerUserId}`;
    const current = latest.get(key);
    if (!current || row.createdAt.getTime() > current.createdAt.getTime()) latest.set(key, row);
  }
  return [...latest.values()];
}

async function syncStaffMembers(guild: Awaited<ReturnType<typeof getGuild>>, staffRoleId: string) {
  const lastSync = staffSyncAt.get(guild.id) ?? 0;
  if (Date.now() - lastSync < 60_000) return;
  staffSyncAt.set(guild.id, Date.now());
  const members = guild.members.cache;
  for (const member of members.values()) {
    if (!member.roles.cache.has(staffRoleId) || member.user.bot) continue;
    try {
      const existing = await Staff.findOne({ guildId: guild.id, userId: member.id });
      if (existing) {
        if (!existing.active) { existing.active = true; await existing.save(); }
      } else {
        await Staff.create({ guildId: guild.id, userId: member.id, joinedAt: new Date(), active: true, points: 0, claimed: 0, closed: 0 });
      }
    } catch (error) {
      console.error(`Could not sync Staff member ${member.id} in guild ${guild.id}:`, error);
    }
  }
}

async function addStaff(req: Request, res: Response) {
  if (!await requireAdministrator(req, res)) return;
  try {
    const userId = String(req.body.userId || '').trim();
    const points = Math.max(0, Number(req.body.points || 0));
    if (!/^\d{15,22}$/.test(userId)) return res.status(400).json({ error: 'Enter a valid Discord User ID.' });
    const guildId = selectedGuildId(req);
    const settings = await getSettings(guildId);
    const member = await getMember(userId, guildId);
    if (!member) return res.status(400).json({ error: 'This Discord user is not a member of the selected server.' });
    if (!settings?.staff_role_id) return res.status(400).json({ error: 'Staff Role is not configured. Open Server Settings first.' });
    const guild = await getGuild(guildId);
    const botMember = guild.members.me;
    const canAssignRole = Boolean(member.manageable && botMember && member.roles.highest.position < botMember.roles.highest.position);
    if (canAssignRole) await member.roles.add(settings.staff_role_id, 'Added from Rift dashboard');
    const existing = await Staff.findOne({ guildId, userId });
    if (existing) { existing.active = true; existing.points = points; await existing.save(); }
    else await Staff.create({ guildId, userId, joinedAt: new Date(), active: true, points, claimed: 0, closed: 0 });
    res.json({ ok: true, roleAssigned: canAssignRole });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Could not add staff.' }); }
}

async function removeStaff(req: Request, res: Response) {
  if (!await requireAdministrator(req, res)) return;
  try {
    const userId = req.params.userId;
    if (!userId) return res.status(400).json({ error: 'User ID is required.' });
    const guildId = selectedGuildId(req);
    const settings = await getSettings(guildId);
    const member = await getMember(userId, guildId);
    if (member && settings?.staff_role_id) await member.roles.remove(settings.staff_role_id, 'Removed from Rift dashboard');
    const existing = await Staff.findOne({ guildId, userId });
    if (existing) { existing.active = false; await existing.save(); }
    res.json({ ok: true });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Could not remove staff.' }); }
}

async function updateStaff(req: Request, res: Response) {
  if (!await requireAdministrator(req, res)) return;
  try {
    const guildId = selectedGuildId(req);
    const actor = ((req.session as any).user as SessionUser).id;
    if (actor === req.params.userId) return res.status(403).json({ error: 'You cannot change your own staff points.' });
    const staff = await Staff.findOne({ guildId, userId: req.params.userId });
    if (!staff) return res.status(404).json({ error: 'Staff member not found.' });
    staff.points = Math.max(0, Number(req.body.points ?? staff.points));
    if (req.body.shiftHours !== undefined) {
      const shiftHours = Math.max(0, Number(req.body.shiftHours));
      if (!Number.isFinite(shiftHours)) return res.status(400).json({ error: 'Shift hours must be a valid number.' });
      const activeShift = await Shift.findOne({ guildId, userId: req.params.userId, status: 'active' });
      if (activeShift) return res.status(409).json({ error: 'End the active shift before setting shift hours.' });
      await Shift.deleteMany({ guildId, userId: req.params.userId });
      const startedAt = new Date('2000-01-01T00:00:00.000Z');
      const endedAt = new Date(startedAt.getTime() + shiftHours * 60 * 60 * 1000);
      await Shift.create({ guildId, userId: req.params.userId, startedAt, endedAt, status: 'ended', breaks: [], lastActivityAt: endedAt, checkSentAt: null, pointsAwarded: 0 });
    }
    staff.closed = Math.max(0, Number(req.body.closed ?? staff.closed));
    await staff.save();
    await createLog(guildId, 'STAFF_STATS_UPDATED', staff.userId, actor, { points: staff.points, closed: staff.closed });
    const user = await discord.users.fetch(staff.userId).catch(() => null);
    if (user) {
      const settings = await getSettings(guildId);
      const replace = (value: string, fallback: string) => (value || fallback).replaceAll('{points}', String(staff.points)).replaceAll('{helped}', '0').replaceAll('{hours}', '0').replaceAll('{complaints}', '0');
      await user.send({ embeds: [new EmbedBuilder().setColor(0x8175f5).setTitle(replace(settings?.points_message_title, 'Rift • تم تحديث نقاطك')).setDescription(replace(settings?.points_message_description, 'تم تحديث إحصائياتك من إدارة السيرفر.')).addFields({ name: 'Rift • النقاط', value: String(staff.points), inline: true }).setFooter({ text: replace(settings?.points_message_footer, 'Rift Staff Operations') }).setThumbnail(user.displayAvatarURL({ extension: 'png', size: 128 })).setTimestamp()] }).catch(() => undefined);
    }
    res.json({ ok: true });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Could not update staff.' }); }
}

async function resetStaffStats(req: Request, res: Response) {
  if (!await requireAdministrator(req, res)) return;
  try {
    const guildId = selectedGuildId(req);
    const staff = await Staff.findOne({ guildId, userId: req.params.userId });
    if (!staff) return res.status(404).json({ error: 'Staff member not found.' });
    const activeShift = await Shift.findOne({ guildId, userId: req.params.userId, status: 'active' });
    if (activeShift) return res.status(409).json({ error: 'End the active shift before resetting all staff data.' });
    staff.points = 0; staff.claimed = 0; staff.closed = 0; staff.messageCount = 0; staff.voiceMinutes = 0;
    await staff.save();
    await Shift.deleteMany({ guildId, userId: req.params.userId });
    await Complaint.deleteMany({ guildId, staffUserId: req.params.userId });
    await StaffRating.deleteMany({ guildId, staffUserId: req.params.userId });
    await createLog(guildId, 'STAFF_STATS_RESET', staff.userId, ((req.session as any).user as SessionUser).id);
    res.json({ ok: true });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Could not reset staff stats.' }); }
}

async function resetStaffShiftHours(req: Request, res: Response) {
  if (!await requireAdministrator(req, res)) return;
  try {
    const userId = req.params.userId;
    if (!userId) return res.status(400).json({ error: 'User ID is required.' });
    const guildId = selectedGuildId(req);
    const staff = await Staff.findOne({ guildId, userId });
    if (!staff) return res.status(404).json({ error: 'Staff member not found.' });
    const activeShift = await Shift.findOne({ guildId, userId, status: 'active' });
    if (activeShift) return res.status(409).json({ error: 'End the active shift before resetting shift hours.' });
    await Shift.deleteMany({ guildId, userId });
    await createLog(guildId, 'STAFF_SHIFT_HOURS_RESET', userId, ((req.session as any).user as SessionUser).id);
    res.json({ ok: true });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Could not reset shift hours.' }); }
}

async function resetAllStaff(req: Request, res: Response) {
  if (!await requireAdministrator(req, res)) return;
  try {
    const guildId = selectedGuildId(req);
    const settings = await getSettings(guildId);
    const staffRows = await Staff.find({ guildId });
    const { error: staffError } = await supabase.from('staff').update({ points: 0, claimed: 0, closed: 0, message_count: 0, voice_minutes: 0 }).eq('guild_id', guildId);
    if (staffError) throw staffError;
    const { error: shiftError } = await supabase.from('shifts').delete().eq('guild_id', guildId);
    if (shiftError) throw shiftError;
    const { error: activityError } = await supabase.from('staff_daily_activity').delete().eq('guild_id', guildId);
    if (activityError) throw activityError;
    const { error: ratingsError } = await supabase.from('staff_ratings').delete().eq('guild_id', guildId);
    if (ratingsError) throw ratingsError;
    const { error: complaintsError } = await supabase.from('complaints').delete().eq('guild_id', guildId);
    if (complaintsError) throw complaintsError;
    const { error: reportsError } = await supabase.from('staff_reports').delete().eq('guild_id', guildId);
    if (reportsError) throw reportsError;
    if (settings?.on_shift_role_id) {
      const guild = await getGuild(guildId);
      const members = guild.members.cache.size >= guild.memberCount ? guild.members.cache : await guild.members.fetch();
      for (const member of members.values()) if (member.roles.cache.has(settings.on_shift_role_id)) await member.roles.remove(settings.on_shift_role_id, 'All Staff stats reset').catch(() => undefined);
    }
    await createLog(guildId, 'ALL_STAFF_STATS_RESET', 'all-staff', ((req.session as any).user as SessionUser).id, { count: staffRows.length });
    res.json({ ok: true, count: staffRows.length });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Could not reset all staff.' }); }
}

async function createComplaint(req: Request, res: Response) {
  try {
    const { staffUserId, reason, evidence = '' } = req.body;
    if (!staffUserId || !reason) return res.status(400).json({ error: 'Staff member and reason are required.' });
    const guildId = selectedGuildId(req);
    if (((req.session as any).user as SessionUser).id === staffUserId) return res.status(403).json({ error: 'You cannot submit a complaint against yourself.' });
    const member = await getMember(staffUserId, guildId);
    const settings = await getSettings(guildId);
    if (!member || !settings?.staff_role_id || !member.roles.cache.has(settings.staff_role_id)) return res.status(400).json({ error: 'Staff member not found.' });
    const result = await createComplaintOnce({ guildId, staffUserId, reporterUserId: ((req.session as any).user as SessionUser).id, reason, evidence });
    const complaint = result.complaint;
    if (!result.created) return res.json({ ok: true, duplicate: true, complaint });
    const guild = await getGuild(guildId);
    const complaintEmbed = new EmbedBuilder().setColor(0x8175f5).setTitle('◇ شكوى جديدة').addFields({ name: 'الإداري', value: `<@${staffUserId}>`, inline: true }, { name: 'المبلّغ', value: `<@${((req.session as any).user as SessionUser).id}>`, inline: true }, { name: 'التفاصيل', value: reason }, { name: 'الدليل', value: evidence || 'لا يوجد' }).setFooter({ text: `Rift Complaint #${String(complaint._id).slice(-6)}` });
    if (settings.complaint_channel_id) { const channel = await guild.channels.fetch(settings.complaint_channel_id).catch(() => null); if (channel?.isTextBased()) await channel.send({ embeds: [complaintEmbed], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`complaint_approve:${complaint._id}`).setLabel('اعتماد وخصم نقطة').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId(`complaint_reject:${complaint._id}`).setLabel('رفض').setStyle(ButtonStyle.Secondary))] }); }
    if (settings.logs_channel_id) { const channel = await guild.channels.fetch(settings.logs_channel_id).catch(() => null); if (channel?.isTextBased()) await channel.send({ content: `◇ Complaint created for <@${staffUserId}> by <@${((req.session as any).user as SessionUser).id}>` }); }
    res.json({ ok: true, complaint });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Could not create complaint.' }); }
}

async function reviewComplaint(req: Request, res: Response) {
  if (!await requireAdministrator(req, res)) return;
  try {
    const complaint = await Complaint.findById(req.params.id);
    // A complaint can only be decided in the server it belongs to, and never by the person it is about.
    if (!complaint || complaint.guildId !== selectedGuildId(req) || complaint.status !== 'pending') return res.status(404).json({ error: 'Complaint is no longer pending.' });
    if (complaint.staffUserId === ((req.session as any).user as SessionUser).id) return res.status(403).json({ error: 'You cannot review a complaint about yourself.' });
    const target = await getMember(complaint.staffUserId, selectedGuildId(req));
    complaint.status = req.body.status === 'approved' ? 'approved' : 'rejected';
    complaint.penaltyPoints = complaint.status === 'approved' ? Math.min(1000, Math.max(0, Math.floor(Number(req.body.penaltyPoints) || 0))) : 0;
    complaint.reviewedBy = ((req.session as any).user as SessionUser).id;
    complaint.reviewedAt = new Date();
    complaint.decisionNote = String(req.body.note || '').slice(0, 1500);
    await complaint.save();
    if (complaint.status === 'approved' && complaint.penaltyPoints > 0) {
      const staff = await Staff.findOne({ guildId: selectedGuildId(req), userId: complaint.staffUserId });
      if (staff) { staff.points = Math.max(0, staff.points - complaint.penaltyPoints); await staff.save(); }
    }
    await createLog(selectedGuildId(req), 'COMPLAINT_REVIEWED', complaint.staffUserId, ((req.session as any).user as SessionUser).id, { complaintId: complaint.id, status: complaint.status, penaltyPoints: complaint.penaltyPoints });
    const staffUser = await discord.users.fetch(complaint.staffUserId).catch(() => null);
    if (staffUser) await staffUser.send({ content: `Your complaint review on Rift is **${complaint.status}**.${complaint.decisionNote ? `\nNote: ${complaint.decisionNote}` : ''}` }).catch(() => undefined);
    res.json({ ok: true });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Could not review complaint.' }); }
}

async function botStatus(req: Request, res: Response) {
  if (!await requireAdministrator(req, res)) return;
  const settings = await getSettings(selectedGuildId(req));
  res.json({ status: settings?.bot_status ?? 'idle', online: discord.isReady(), settings: settings ? { customStatuses: settings.custom_statuses ?? [], customStatusInterval: settings.custom_status_interval ?? 30, customStatusType: settings.custom_status_type ?? 'playing', customStatusUrl: settings.custom_status_url ?? '' } : {} });
}

async function updateBotStatus(req: Request, res: Response) {
  if (!await requireAdministrator(req, res)) return;
  const status = ['online', 'idle', 'dnd', 'invisible'].includes(req.body.status) ? req.body.status : 'idle';
  const guildId = selectedGuildId(req);
  const { error } = await supabase.from('guild_settings').update({ bot_status: status }).eq('guild_id', guildId);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true, status });
}

async function updateCustomStatus(req: Request, res: Response) {
  if (!await requireAdministrator(req, res)) return;
  const statuses = Array.isArray(req.body.statuses) ? req.body.statuses.map((item: unknown) => String(item).trim()).filter(Boolean).slice(0, 10) : [];
  const interval = Math.max(5, Math.min(3600, Number(req.body.interval || 30)));
  const activityType = ['playing', 'streaming', 'listening', 'watching', 'competing'].includes(req.body.activityType) ? req.body.activityType : 'playing';
  const streamUrl = activityType === 'streaming' && /^https?:\/\//i.test(String(req.body.streamUrl || '')) ? String(req.body.streamUrl).trim() : '';
  const guildId = selectedGuildId(req);
  let { error } = await supabase.from('guild_settings').update({ custom_statuses: statuses, custom_status_interval: interval, custom_status_type: activityType, custom_status_url: streamUrl }).eq('guild_id', guildId);
  if (error?.message.includes('custom_status_')) ({ error } = await supabase.from('guild_settings').update({ custom_statuses: statuses, custom_status_interval: interval }).eq('guild_id', guildId));
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true });
}

function activeDuration(shift: any) {
  const startedAt = new Date(shift.startedAt).getTime();
  if (!Number.isFinite(startedAt)) return 0;
  const end = new Date(shift.endedAt ?? new Date()).getTime();
  const breaks = (shift.breaks ?? []).reduce((sum: number, item: any) => {
    const breakStart = new Date(item.startedAt).getTime();
    const breakEnd = new Date(item.endedAt ?? shift.endedAt ?? new Date()).getTime();
    return Number.isFinite(breakStart) && Number.isFinite(breakEnd) ? sum + Math.max(0, breakEnd - breakStart) : sum;
  }, 0);
  return Number.isFinite(end) ? Math.max(0, end - startedAt - breaks) : 0;
}
