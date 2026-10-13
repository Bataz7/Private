import type { Context } from '../web/server/http.js';
import type { Guild } from '../lib/djs/index.js';
import type { DashboardContext, DashboardExtension } from './extensions.js';
import {
  addModReportNote, buildModPanel, buildReviewCard, decideModReport, deleteModReport, getModReport, getModSettings, isSetupError, listModReports, modReportHistory, modReportOverview,
  modSettings, publishModPanel, refreshModPanel, reopenModReport, saveModSettings, type ModReportDoc,
} from '../services/mod-report.service.js';
import { createLog } from '../services/log.service.js';
import type { Mount } from '../web/server/router.js';
import { publicMessage } from '../web/server/errors.js';
import { rateLimit } from '../web/server/security.js';

type Person = { displayName: string; avatar: string; username: string };

export const modReportsDashboard: DashboardExtension = {
  name: 'modreports',
  mountApi(context, app) { registerModReportRoutes(context, app); },
};

function registerModReportRoutes({ discord, selectedGuildId, requireAdministrator, sessionUser, getGuild }: DashboardContext, app: Mount) {
  const writeLimit = rateLimit('mod-reports-writes', 60_000, 30);
  const fail = (c: Context, status: number, error: string) => c.status(status).json({ error });
  // Every route is administrator-only; a missing database table is reported as a clear 503 instead of a crash.
  const route = (handler: (c: Context, guildId: string) => Promise<unknown>) => (c: Context) =>
    (async () => {
      if (!await requireAdministrator(c)) return;
      await handler(c, selectedGuildId(c));
    })().catch(error => {
      if (c.sent) return;
      if (isSetupError(error)) return fail(c, 503, error.message);
      const message = publicMessage(error, '');
      if (!message) console.error(`Mod reports API ${c.method} ${c.path}:`, error);
      fail(c, 400, message || 'صار خطأ غير متوقع.');
    });
  const actor = (c: Context) => { const user = sessionUser(c); return { id: user?.id || '', name: user?.username || '' }; };
  const own = async (c: Context, guildId: string) => {
    const report = await getModReport(String(c.params.id || ''));
    if (!report || report.guildId !== guildId) { fail(c, 404, 'التقرير مو موجود.'); return null; }
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
  app.get('/api/mod-reports/options', route(async (c, guildId) => {
    const guild = await getGuild(guildId);
    const channels = (await guild.channels.fetch()).filter(channel => channel && channel.isTextBased() && !channel.isThread() && !channel.isVoiceBased()).map(channel => ({ id: channel!.id, name: channel!.name }));
    const roles = (await guild.roles.fetch()).filter(role => role.id !== guild.id && !role.managed).sort((a, b) => b.position - a.position).map(role => ({ id: role.id, name: role.name, color: role.hexColor }));
    c.json({ channels, roles });
  }));

  app.get('/api/mod-reports/overview', route(async (c, guildId) => {
    const name = people(guildId);
    const [overview, settings] = await Promise.all([modReportOverview(guildId), getModSettings(guildId)]);
    c.json({
      ...overview,
      top: await Promise.all(overview.top.map(async item => ({ ...item, displayName: (await name(item.userId))?.displayName || '', avatar: (await name(item.userId))?.avatar || '' }))),
      settings,
    });
  }));

  app.get('/api/mod-reports', route(async (c, guildId) => {
    const name = people(guildId);
    const result = await listModReports(guildId, { status: String(c.q('status') || 'pending'), action: String(c.q('action') || ''), q: String(c.q('q') || ''), page: Number(c.q('page')) || 1 });
    c.json({
      total: result.total, page: result.page, hasMore: result.hasMore,
      rows: await Promise.all(result.rows.map(async row => {
        const moderator = await name(row.moderatorId);
        return { id: row.id, number: row.number, action: row.action, status: row.status, moderatorId: row.moderatorId, moderator: moderator?.displayName || row.moderatorName, moderatorAvatar: moderator?.avatar || '', targetUserId: row.targetUserId, targetTag: row.targetTag, targetAvatar: row.targetAvatar, reason: row.reason.slice(0, 160), notes: row.notes.length, flags: row.flags.length, createdAt: row.createdAt };
      })),
    });
  }));

  app.get('/api/mod-reports/:id', route(async (c, guildId) => {
    const report = await own(c, guildId); if (!report) return;
    const name = people(guildId);
    const [moderator, reviewer, history] = await Promise.all([name(report.moderatorId), name(report.reviewedBy), modReportHistory(report)]);
    c.json({
      report: {
        ...report, moderator: moderator?.displayName || report.moderatorName, moderatorAvatar: moderator?.avatar || '', reviewer: reviewer?.displayName || null,
        notes: await Promise.all(report.notes.map(async note => ({ ...note, name: (await name(note.userId))?.displayName || note.name }))),
        history, jumpUrl: jumpUrl(report),
      },
    });
  }));

  app.post('/api/mod-reports/:id/decision', route(async (c, guildId) => {
    const report = await own(c, guildId); if (!report) return;
    const decision = c.body?.decision === 'approved' ? 'approved' : c.body?.decision === 'rejected' ? 'rejected' : null;
    if (!decision) return fail(c, 400, 'اختر قبول أو رفض.');
    const user = sessionUser(c);
    if (report.moderatorId === user?.id && !user?.isOwner) return fail(c, 403, 'ما تقدر تراجع تقريرك بنفسك.');
    const result = await decideModReport(discord, report.id, decision, actor(c), String(c.body?.note || ''));
    c.json({ ok: true, dmSent: result.dmSent });
  }), { guards: [writeLimit] });

  app.post('/api/mod-reports/:id/notes', route(async (c, guildId) => {
    const report = await own(c, guildId); if (!report) return;
    await addModReportNote(discord, report.id, actor(c), String(c.body?.text || ''));
    c.json({ ok: true });
  }), { guards: [writeLimit] });

  app.post('/api/mod-reports/:id/reopen', route(async (c, guildId) => {
    const report = await own(c, guildId); if (!report) return;
    await reopenModReport(discord, report.id, actor(c).id);
    c.json({ ok: true });
  }), { guards: [writeLimit] });

  app.delete('/api/mod-reports/:id', route(async (c, guildId) => {
    const report = await own(c, guildId); if (!report) return;
    await deleteModReport(report.id);
    await createLog(guildId, 'MOD_REPORT_DELETED', report.moderatorId, actor(c).id, { number: report.number }).catch(() => undefined);
    c.json({ ok: true });
  }), { guards: [writeLimit] });

  app.put('/api/mod-reports-settings', route(async (c, guildId) => {
    const settings = await saveModSettings(guildId, c.body);
    c.json({ settings, panelUpdated: await refreshModPanel(discord, guildId) });
  }), { guards: [writeLimit] });

  // Renders both panels and a sample review card from unsaved settings, with the same builders the bot uses.
  app.post('/api/mod-reports-preview', route(async (c, guildId) => {
    const s = modSettings(c.body);
    const guildName = discord.guilds.cache.get(guildId)?.name || 'Rift';
    const user = sessionUser(c);
    const sample: ModReportDoc = {
      id: '0', guildId, number: 42, moderatorId: user?.id || '1', moderatorName: user?.username || '', targetUserId: '123456789012345678', targetTag: '@member', targetAvatar: '',
      action: 'mute', reason: s.language === 'en' ? 'Repeated spam in general chat after a warning.' : 'سبام متكرر في الشات العام بعد التحذير.', duration: '1h', evidence: 'https://example.com/screenshot.png',
      flags: [], status: 'pending', reviewedBy: null, reviewedAt: null, pointsApplied: 0, notes: [], reviewChannelId: '', reviewMessageId: '', lang: s.language,
      createdAt: new Date(), updatedAt: new Date(), version: '',
    };
    c.json({ panelAr: buildModPanel(s, guildName, 'ar'), panelEn: buildModPanel(s, guildName, 'en'), card: buildReviewCard(sample, s) });
  }), { guards: [writeLimit] });

  app.post('/api/mod-reports-panel', route(async (c, guildId) => {
    const channelId = String(c.body?.channelId || '');
    if (!channelId) return fail(c, 400, 'اختر روم أول.');
    const lang = c.body?.lang === 'ar' ? 'ar' : 'en';
    c.json({ ok: true, lang, ...(await publishModPanel(discord, guildId, channelId, lang)) });
  }), { guards: [writeLimit] });
}
