import type { Request, Response } from 'express';
import type { Guild } from 'discord.js';
import type { DashboardContext, DashboardExtension } from './extensions.js';
import {
  addModReportNote, buildModPanel, buildReviewCard, decideModReport, deleteModReport, getModReport, getModSettings, isSetupError, listModReports, modReportHistory, modReportOverview,
  modSettings, publishModPanel, refreshModPanel, reopenModReport, saveModSettings, type ModReportDoc,
} from '../services/mod-report.service.js';
import { createLog } from '../services/log.service.js';

type Person = { displayName: string; avatar: string; username: string };

export const modReportsDashboard: DashboardExtension = {
  name: 'modreports',
  styles: ['modreports'],
  mountApi(context) { registerModReportRoutes(context); },
};

function registerModReportRoutes({ app, discord, selectedGuildId, requireAdministrator, sessionUser }: DashboardContext) {
  const fail = (res: Response, status: number, error: string) => res.status(status).json({ error });
  // Every route is administrator-only; a missing database table is reported as a clear 503 instead of a crash.
  const route = (handler: (req: Request, res: Response, guildId: string) => Promise<unknown>) => (req: Request, res: Response) => {
    (async () => {
      if (!await requireAdministrator(req, res)) return;
      await handler(req, res, selectedGuildId(req));
    })().catch(error => {
      if (res.headersSent) return;
      if (isSetupError(error)) return fail(res, 503, error.message);
      console.error(`Mod reports API ${req.method} ${req.path}:`, error);
      fail(res, 400, error instanceof Error ? error.message : 'Unexpected error.');
    });
  };
  const actor = (req: Request) => { const user = sessionUser(req); return { id: user?.id || '', name: user?.username || '' }; };
  const own = async (req: Request, res: Response, guildId: string) => {
    const report = await getModReport(String(req.params.id || ''));
    if (!report || report.guildId !== guildId) { fail(res, 404, 'Report not found.'); return null; }
    return report;
  };
  // Names and avatars come from the guild cache first; a lookup is made once per person and request.
  const people = (guildId: string) => {
    const seen = new Map<string, Promise<Person | null>>();
    const guild: Guild | undefined = discord.guilds.cache.get(guildId);
    return (userId: string | null) => {
      if (!userId || !guild) return Promise.resolve(null);
      if (!seen.has(userId)) seen.set(userId, guild.members.fetch(userId).then(member => ({ displayName: member.displayName, username: member.user.username, avatar: member.displayAvatarURL({ extension: 'png', size: 64 }) })).catch(() => null));
      return seen.get(userId)!;
    };
  };
  const jumpUrl = (report: ModReportDoc) => (report.reviewChannelId && report.reviewMessageId ? `https://discord.com/channels/${report.guildId}/${report.reviewChannelId}/${report.reviewMessageId}` : '');

  // Channels and roles for the settings form.
  app.get('/api/mod-reports/options', route(async (_req, res, guildId) => {
    const guild = await discord.guilds.fetch(guildId);
    const channels = (await guild.channels.fetch()).filter(channel => channel && channel.isTextBased() && !channel.isThread() && !channel.isVoiceBased()).map(channel => ({ id: channel!.id, name: channel!.name }));
    const roles = (await guild.roles.fetch()).filter(role => role.id !== guild.id && !role.managed).sort((a, b) => b.position - a.position).map(role => ({ id: role.id, name: role.name, color: role.hexColor }));
    res.json({ channels, roles });
  }));

  app.get('/api/mod-reports/overview', route(async (req, res, guildId) => {
    const name = people(guildId);
    const [overview, settings] = await Promise.all([modReportOverview(guildId), getModSettings(guildId)]);
    res.json({
      ...overview,
      top: await Promise.all(overview.top.map(async item => ({ ...item, displayName: (await name(item.userId))?.displayName || '', avatar: (await name(item.userId))?.avatar || '' }))),
      settings,
    });
  }));

  app.get('/api/mod-reports', route(async (req, res, guildId) => {
    const name = people(guildId);
    const result = await listModReports(guildId, { status: String(req.query.status || 'pending'), action: String(req.query.action || ''), q: String(req.query.q || ''), page: Number(req.query.page) || 1 });
    res.json({
      total: result.total, page: result.page, hasMore: result.hasMore,
      rows: await Promise.all(result.rows.map(async row => {
        const moderator = await name(row.moderatorId);
        return { id: row.id, number: row.number, action: row.action, status: row.status, moderatorId: row.moderatorId, moderator: moderator?.displayName || row.moderatorName, moderatorAvatar: moderator?.avatar || '', targetUserId: row.targetUserId, targetTag: row.targetTag, targetAvatar: row.targetAvatar, reason: row.reason.slice(0, 160), notes: row.notes.length, flags: row.flags.length, createdAt: row.createdAt };
      })),
    });
  }));

  app.get('/api/mod-reports/:id', route(async (req, res, guildId) => {
    const report = await own(req, res, guildId); if (!report) return;
    const name = people(guildId);
    const [moderator, reviewer, history] = await Promise.all([name(report.moderatorId), name(report.reviewedBy), modReportHistory(report)]);
    res.json({
      report: {
        ...report, moderator: moderator?.displayName || report.moderatorName, moderatorAvatar: moderator?.avatar || '', reviewer: reviewer?.displayName || null,
        notes: await Promise.all(report.notes.map(async note => ({ ...note, name: (await name(note.userId))?.displayName || note.name }))),
        history, jumpUrl: jumpUrl(report),
      },
    });
  }));

  app.post('/api/mod-reports/:id/decision', route(async (req, res, guildId) => {
    const report = await own(req, res, guildId); if (!report) return;
    const decision = req.body?.decision === 'approved' ? 'approved' : req.body?.decision === 'rejected' ? 'rejected' : null;
    if (!decision) return fail(res, 400, 'Choose approve or reject.');
    const user = sessionUser(req);
    if (report.moderatorId === user?.id && !user?.isOwner) return fail(res, 403, 'You cannot review your own report.');
    const result = await decideModReport(discord, report.id, decision, actor(req), String(req.body?.note || ''));
    res.json({ ok: true, dmSent: result.dmSent });
  }));

  app.post('/api/mod-reports/:id/notes', route(async (req, res, guildId) => {
    const report = await own(req, res, guildId); if (!report) return;
    await addModReportNote(discord, report.id, actor(req), String(req.body?.text || ''));
    res.json({ ok: true });
  }));

  app.post('/api/mod-reports/:id/reopen', route(async (req, res, guildId) => {
    const report = await own(req, res, guildId); if (!report) return;
    await reopenModReport(discord, report.id, actor(req).id);
    res.json({ ok: true });
  }));

  app.delete('/api/mod-reports/:id', route(async (req, res, guildId) => {
    const report = await own(req, res, guildId); if (!report) return;
    await deleteModReport(report.id);
    await createLog(guildId, 'MOD_REPORT_DELETED', report.moderatorId, actor(req).id, { number: report.number }).catch(() => undefined);
    res.json({ ok: true });
  }));

  app.put('/api/mod-reports-settings', route(async (req, res, guildId) => {
    const settings = await saveModSettings(guildId, req.body);
    res.json({ settings, panelUpdated: await refreshModPanel(discord, guildId) });
  }));

  // Renders both panels and a sample review card from unsaved settings, with the same builders the bot uses.
  app.post('/api/mod-reports-preview', route(async (req, res, guildId) => {
    const s = modSettings(req.body);
    const guildName = discord.guilds.cache.get(guildId)?.name || 'Rift';
    const user = sessionUser(req);
    const sample: ModReportDoc = {
      id: '0', guildId, number: 42, moderatorId: user?.id || '1', moderatorName: user?.username || '', targetUserId: '123456789012345678', targetTag: '@member', targetAvatar: '',
      action: 'mute', reason: s.language === 'en' ? 'Repeated spam in general chat after a warning.' : 'سبام متكرر في الشات العام بعد التحذير.', duration: '1h', evidence: 'https://example.com/screenshot.png',
      flags: [], status: 'pending', reviewedBy: null, reviewedAt: null, pointsApplied: 0, notes: [], reviewChannelId: '', reviewMessageId: '', lang: s.language,
      createdAt: new Date(), updatedAt: new Date(), version: '',
    };
    res.json({ panelAr: buildModPanel(s, guildName, 'ar'), panelEn: buildModPanel(s, guildName, 'en'), card: buildReviewCard(sample, s) });
  }));

  app.post('/api/mod-reports-panel', route(async (req, res, guildId) => {
    const channelId = String(req.body?.channelId || '');
    if (!channelId) return fail(res, 400, 'Choose a channel first.');
    const lang = req.body?.lang === 'ar' ? 'ar' : 'en';
    res.json({ ok: true, lang, ...(await publishModPanel(discord, guildId, channelId, lang)) });
  }));
}
