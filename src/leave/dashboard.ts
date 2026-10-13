import type { Request, Response } from 'express';
import { MessageFlags, type Guild, type Message, type TextBasedChannel } from 'discord.js';
import type { DashboardContext, DashboardExtension } from '../dashboard/extensions.js';
import { LeaveRequest, type LeaveRequestDoc } from '../models/LeaveRequest.js';
import { RequestPanelSettings } from '../models/RequestPanelSettings.js';
import { ResignationRequest, type ResignationRequestDoc } from '../models/ResignationRequest.js';
import { createLog } from '../services/log.service.js';
import { getSettings } from '../services/settings.service.js';
import { AdminOnlyError } from './access.js';
import { MIGRATION_HINT, patchRow, schemaReady } from './db.js';
import { postRequestCard, requestSubmittedEmbed, requestsChannelId } from './cards.js';
import { adminExtendLeave, decideLeaveExtension } from './extension.js';
import { approveLeaveRequest, closeLeaveByAdmin, rejectLeaveRequest } from './lifecycle.js';
import { clearClosedRequests, countClosedRequests, resendPendingRequests } from './maintenance.js';
import { buildLeavePanel, buildResignationPanel, LEAVE_PANEL_TITLES, RESIGNATION_PANEL_TITLES } from './panels.js';
import { createLeave, createResignation, findBlockingLeave, findBlockingResignation, findLeave, findResignation } from './requests.js';
import { decideResignation } from './resignation.js';
import { parseDay, type RequestKind } from './util.js';

// Dashboard side of the leave / resignation system. Everyone on staff sees their own requests and can file one;
// administrators see every request, decide with an optional note, choose the panel and requests channels,
// resend waiting requests and clear finished ones. The Discord side checks administrator rights again in the services.
const KINDS: Record<string, RequestKind> = { leaves: 'leave', resignations: 'resignation' };
const plain = (doc: LeaveRequestDoc | ResignationRequestDoc) => ({ ...((doc as any).data ?? doc) });

export const leaveDashboard: DashboardExtension = {
  name: 'leave',
  styles: ['leave-workflow'],
  mountApi(context) {
    const { app, discord, supabase } = context;
    const me = (req: Request) => context.sessionUser(req);
    const guildOf = (req: Request) => context.selectedGuildId(req);
    const isAdminUser = (req: Request) => { const user = me(req); return Boolean(user?.isOwner || user?.isAdministrator); };

    function fail(res: Response, error: unknown, fallback = 'Could not complete this action.') {
      if (error instanceof AdminOnlyError) return res.status(403).json({ error: 'Only administrators can do this.' });
      const message = error instanceof Error ? error.message : fallback;
      return res.status(/not found/i.test(message) ? 404 : /already|no longer|out of date/i.test(message) ? 409 : 400).json({ error: message });
    }

    /** Runs a route only when migration 029 is in place; otherwise answers with a clear message. */
    const guarded = (handler: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
      try {
        if (!await schemaReady()) return res.status(503).json({ error: MIGRATION_HINT });
        await handler(req, res);
      } catch (error) { if (!res.headersSent) fail(res, error); }
    };
    const adminOnly = (handler: (req: Request, res: Response) => Promise<unknown>) => guarded(async (req, res) => { if (!await context.requireAdministrator(req, res)) return; await handler(req, res); });

    async function peopleFor(guild: Guild | null, ids: string[]) {
      const people: Record<string, { displayName: string; username: string; avatar: string }> = {};
      const unique = [...new Set(ids)].slice(0, 400);
      const missing = unique.filter(id => !guild?.members.cache.has(id));
      for (let index = 0; index < missing.length; index += 100) await guild?.members.fetch({ user: missing.slice(index, index + 100) }).catch(() => undefined);
      for (const id of unique) {
        const member = guild?.members.cache.get(id);
        if (member) { people[id] = { displayName: member.displayName, username: member.user.username, avatar: member.displayAvatarURL({ extension: 'png', size: 64 }) }; continue; }
        const user = await discord.users.fetch(id).catch(() => null);
        people[id] = { displayName: user?.globalName || user?.username || `User ${id.slice(-4)}`, username: user?.username || '', avatar: user?.displayAvatarURL({ extension: 'png', size: 64 }) || '' };
      }
      return people;
    }

    // ---- lists -----------------------------------------------------------------------------------
    const list = (view: 'leaves' | 'resignations') => async (req: Request, res: Response) => {
      const guildId = guildOf(req);
      const admin = isAdminUser(req);
      const user = me(req);
      if (!await schemaReady()) return res.json({ ready: false, message: MIGRATION_HINT, rows: [], people: {}, admin });
      const filters = admin ? { guildId } : { guildId, userId: user?.id || '' };
      const rows = view === 'leaves'
        ? await LeaveRequest.find(filters).sort({ createdAt: -1 }).limit(300)
        : await ResignationRequest.find(filters).sort({ createdAt: -1 }).limit(300);
      const guild = await context.getGuild(guildId).catch(() => null);
      const ids = rows.flatMap(row => [row.userId, row.reviewedBy || '']).filter(Boolean);
      const settings = await getSettings(guildId).catch(() => null);
      res.json({
        ready: true, admin, people: await peopleFor(guild, ids), rows: rows.map(plain),
        requestsChannelId: view === 'leaves' ? settings?.leaveChannelId || '' : settings?.resignationChannelId || '',
      });
    };
    const safe = (handler: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
      try { await handler(req, res); } catch (error) { if (!res.headersSent) fail(res, error); }
    };
    app.get('/api/leaves', safe(list('leaves')));
    app.get('/api/resignations', safe(list('resignations')));

    // ---- filing a request (for your own account) --------------------------------------------------
    const staffOnly = (req: Request, res: Response) => {
      const user = me(req);
      if (user && (user.isStaff || user.isAdministrator || user.isOwner)) return true;
      res.status(403).json({ error: 'The staff role is required to file this request.' });
      return false;
    };

    app.post('/api/leaves', guarded(async (req, res) => {
      if (!staffOnly(req, res)) return;
      const guildId = guildOf(req); const userId = String(me(req)?.id || '');
      const reason = String(req.body.reason || '').trim();
      if (!userId) return res.status(401).json({ error: 'Your dashboard session expired. Log in again.' });
      if (!req.body.startDate && !req.body.start) return res.status(400).json({ error: 'Choose a leave start date.' });
      if (!req.body.endDate && !req.body.end) return res.status(400).json({ error: 'Choose a leave end date.' });
      if (!reason) return res.status(400).json({ error: 'Write a leave reason.' });
      let startDate: Date; let endDate: Date;
      try { startDate = parseDay(String(req.body.startDate || req.body.start)); endDate = parseDay(String(req.body.endDate || req.body.end)); } catch { return res.status(400).json({ error: 'Use valid leave dates (YYYY-MM-DD).' }); }
      if (endDate.getTime() < startDate.getTime()) return res.status(400).json({ error: 'Leave end date must be after start date.' });
      if (await findBlockingLeave(guildId, userId)) return res.status(409).json({ error: 'You already have an active leave request.' });
      const request = await createLeave({ guildId, userId, startDate, endDate, reason });
      const settings = await getSettings(guildId).catch(() => null);
      const posted = await postRequestCard(discord, 'leave', request);
      const user = await discord.users.fetch(userId).catch(() => null);
      const dm = user ? await user.send({ embeds: [requestSubmittedEmbed('leave', request, settings?.botLanguage === 'ar')] }).catch(() => null) : null;
      if (dm) await patchRow('leave_requests', request.id, { dmMessageId: dm.id });
      await createLog(guildId, 'LEAVE_REQUESTED', userId, userId, { leaveId: String(request.id), source: 'dashboard' });
      res.json({ request: plain(request), sentToManagement: Boolean(posted) });
    }));

    app.post('/api/resignations', guarded(async (req, res) => {
      if (!staffOnly(req, res)) return;
      const guildId = guildOf(req); const userId = String(me(req)?.id || '');
      const lastDayText = String(req.body.lastWorkingDay || req.body.last_day || '').trim();
      const reason = String(req.body.reason || '').trim();
      if (!userId) return res.status(401).json({ error: 'Your dashboard session expired. Log in again.' });
      if (!lastDayText) return res.status(400).json({ error: 'Choose the last working day.' });
      if (!reason) return res.status(400).json({ error: 'Write a resignation reason.' });
      let lastWorkingDay: Date;
      try { lastWorkingDay = parseDay(lastDayText); } catch { return res.status(400).json({ error: 'Use a valid last working day (YYYY-MM-DD).' }); }
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const latest = new Date(today); latest.setFullYear(latest.getFullYear() + 1);
      if (lastWorkingDay < today || lastWorkingDay > latest) return res.status(400).json({ error: 'The last working day must be between today and one year from today.' });
      if (await findBlockingResignation(guildId, userId)) return res.status(409).json({ error: 'You already have an active resignation request.' });
      const request = await createResignation({ guildId, userId, lastWorkingDay, reason, notes: String(req.body.notes || '').trim() });
      const settings = await getSettings(guildId).catch(() => null);
      const posted = await postRequestCard(discord, 'resignation', request);
      const user = await discord.users.fetch(userId).catch(() => null);
      const dm = user ? await user.send({ embeds: [requestSubmittedEmbed('resignation', request, settings?.botLanguage === 'ar')] }).catch(() => null) : null;
      if (dm) await patchRow('resignation_requests', request.id, { dmMessageId: dm.id });
      await createLog(guildId, 'RESIGNATION_REQUESTED', userId, userId, { resignationId: String(request.id), source: 'dashboard' });
      res.json({ request: plain(request), sentToManagement: Boolean(posted) });
    }));

    // ---- decisions (administrators; the services lock again) ---------------------------------------
    app.patch('/api/leaves/:id', adminOnly(async (req, res) => {
      const guildId = guildOf(req);
      const request = await findLeave(req.params.id);
      if (!request || request.guildId !== guildId) return res.status(404).json({ error: 'Leave request not found' });
      const reviewer = { id: String(me(req)?.id || '') };
      const note = String(req.body.note || '');
      const status = String(req.body.status || '');
      if (status === 'approved') { const result = await approveLeaveRequest(discord, request.id, reviewer, note); return res.json({ request: plain(result.request), rolesUpdated: result.rolesUpdated, dmSent: result.dmSent }); }
      if (status === 'rejected') { const result = await rejectLeaveRequest(discord, request.id, reviewer, note); return res.json({ request: plain(result.request), dmSent: result.dmSent }); }
      res.status(400).json({ error: 'Invalid leave status' });
    }));

    app.patch('/api/resignations/:id', adminOnly(async (req, res) => {
      const requested = String(req.body.status || '');
      const status = requested === 'accepted' ? 'approved' : requested;
      if (status !== 'approved' && status !== 'rejected') return res.status(400).json({ error: 'Invalid resignation status.' });
      const result = await decideResignation(discord, String(req.params.id), status, { id: String(me(req)?.id || '') }, String(req.body.note || ''), undefined, guildOf(req));
      res.json({ request: plain(result.request), dmSent: result.dmSent });
    }));

    // An administrator moves the end of a running leave (for example when the member asked in person).
    app.post('/api/leaves/:id/extend', adminOnly(async (req, res) => {
      const endText = String(req.body.endDate || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(endText)) return res.status(400).json({ error: 'Choose the new end date.' });
      const result = await adminExtendLeave(discord, String(req.params.id), parseDay(endText), { id: String(me(req)?.id || '') }, String(req.body.note || ''), guildOf(req));
      res.json({ request: plain(result.request), dmSent: result.dmSent });
    }));

    // Ends a running leave for the member (roles come back, the member is told).
    app.post('/api/leaves/:id/close', adminOnly(async (req, res) => {
      const result = await closeLeaveByAdmin(discord, String(req.params.id), { id: String(me(req)?.id || '') }, guildOf(req));
      res.json({ request: plain(result.request), rolesOk: result.rolesOk, dmSent: result.dmSent });
    }));

    // Approve or reject a member's request for more time.
    app.post('/api/leaves/:id/extension', adminOnly(async (req, res) => {
      const decision = req.body.decision === 'approved' ? 'approved' : req.body.decision === 'rejected' ? 'rejected' : null;
      if (!decision) return res.status(400).json({ error: 'Invalid decision.' });
      const result = await decideLeaveExtension(discord, String(req.params.id), decision, { id: String(me(req)?.id || '') }, guildOf(req));
      res.json({ ok: true, dmSent: result.dmSent });
    }));

    // ---- panels and channels ---------------------------------------------------------------------
    app.get('/api/requests-workflow/options', adminOnly(async (req, res) => {
      const guildId = guildOf(req);
      const guild = await context.getGuild(guildId);
      const channels = (await guild.channels.fetch()).filter(channel => channel?.isTextBased() && !channel.isThread()).map(channel => ({ id: channel!.id, name: channel!.name ?? channel!.id }));
      const settings = await getSettings(guildId).catch(() => null);
      const panels = await RequestPanelSettings.findOne({ guildId }).catch(() => null);
      res.json({
        channels,
        leave: { panelChannelId: panels?.leavePanelChannelId || '', requestsChannelId: settings?.leaveChannelId || '' },
        resignation: { panelChannelId: panels?.resignationPanelChannelId || '', requestsChannelId: settings?.resignationChannelId || '' },
      });
    }));

    async function sendPanel(req: Request, res: Response, kind: RequestKind) {
      const guildId = guildOf(req);
      const guild = await context.getGuild(guildId);
      const channel = await guild.channels.fetch(String(req.body.channelId || '')).catch(() => null);
      if (!channel?.isTextBased()) return res.status(400).json({ error: 'Choose a text channel in this server.' });
      const settings = await getSettings(guildId).catch(() => null);
      if (!settings) return res.status(400).json({ error: 'Server not configured. Set up your server from the dashboard first.' });
      const requestsId = String(req.body.requestsChannelId || '');
      if (requestsId && !(await guild.channels.fetch(requestsId).catch(() => null))?.isTextBased()) return res.status(400).json({ error: 'Choose a text channel in this server for the requests.' });
      const language = settings.botLanguage === 'ar' ? 'ar' : 'en';
      const result = kind === 'leave'
        ? await upsertPanel(channel, buildLeavePanel(language, guild), { must: 'leave_request', mustNot: 'resignation_request', titles: LEAVE_PANEL_TITLES })
        : await upsertPanel(channel, buildResignationPanel(language, guild), { must: 'resignation_request', titles: RESIGNATION_PANEL_TITLES });
      // The panel channel and the channel where requests are reviewed are different settings; sending a panel never overwrites the requests channel by accident.
      const saved = await supabase.from('request_panel_settings').upsert({ guild_id: guildId, ...(kind === 'leave' ? { leave_panel_channel_id: channel.id } : { resignation_panel_channel_id: channel.id }), updated_at: new Date().toISOString() }, { onConflict: 'guild_id' });
      if (saved.error) console.error('[leave] Could not save the panel channel:', saved.error.message);
      if (requestsId) await supabase.from('guild_settings').update(kind === 'leave' ? { leave_channel_id: requestsId } : { resignation_channel_id: requestsId }).eq('guild_id', guildId);
      res.json({ ok: true, updated: result.updated, removedDuplicates: result.removedDuplicates });
    }
    app.post('/api/leaves/panel', adminOnly((req, res) => sendPanel(req, res, 'leave')));
    app.post('/api/resignations/panel', adminOnly((req, res) => sendPanel(req, res, 'resignation')));

    const kindOf = (req: Request) => KINDS[String(req.params.kind)] ?? null;

    app.get('/api/requests/:kind/closed-count', adminOnly(async (req, res) => {
      const kind = kindOf(req);
      if (!kind) return res.status(404).json({ error: 'Unknown request type.' });
      res.json({ closed: await countClosedRequests(kind, guildOf(req), Number(req.query.olderThanDays) || 0) });
    }));

    app.post('/api/requests/:kind/channel', adminOnly(async (req, res) => {
      const kind = kindOf(req);
      if (!kind) return res.status(404).json({ error: 'Unknown request type.' });
      const guildId = guildOf(req);
      const channelId = String(req.body?.channelId || '');
      const channel = channelId ? await (await context.getGuild(guildId)).channels.fetch(channelId).catch(() => null) : null;
      if (!channel?.isTextBased()) return res.status(400).json({ error: 'Choose a text channel in this server.' });
      const { error } = await supabase.from('guild_settings').update(kind === 'leave' ? { leave_channel_id: channelId } : { resignation_channel_id: channelId }).eq('guild_id', guildId);
      if (error) return res.status(400).json({ error: error.message });
      res.json({ ok: true });
    }));

    app.post('/api/requests/:kind/resend-pending', adminOnly(async (req, res) => {
      const kind = kindOf(req);
      if (!kind) return res.status(404).json({ error: 'Unknown request type.' });
      const guildId = guildOf(req);
      if (!requestsChannelId(await getSettings(guildId).catch(() => null), kind)) return res.status(400).json({ error: 'Choose the requests channel first.' });
      res.json(await resendPendingRequests(discord, kind, guildId));
    }));

    app.post('/api/requests/:kind/clear-closed', adminOnly(async (req, res) => {
      const kind = kindOf(req);
      if (!kind) return res.status(404).json({ error: 'Unknown request type.' });
      if (req.body?.confirm !== true) return res.status(400).json({ error: 'Confirm the cleanup first.' });
      res.json(await clearClosedRequests(kind, guildOf(req), String(me(req)?.id || ''), Number(req.body.olderThanDays) || 0));
    }));
  },
};

// ---- panel messages -----------------------------------------------------------------------------
function customIdsOf(components: unknown): Set<string> {
  const found = new Set<string>();
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return;
    const json = typeof node.toJSON === 'function' ? node.toJSON() : node;
    if (typeof json.custom_id === 'string') found.add(json.custom_id);
    for (const child of [...(json.components || []), ...(json.accessory ? [json.accessory] : [])]) walk(child);
  };
  for (const node of Array.isArray(components) ? components : []) walk(node);
  return found;
}

/**
 * Sends the panel, or edits the one already in the channel (and removes duplicates). A panel is recognised by its unique
 * button, or by its title for the older embed panels. An old embed panel cannot become a Components V2 card, so it is replaced.
 */
async function upsertPanel(channel: TextBasedChannel, payload: any, match: { must: string; mustNot?: string; titles: string[] }) {
  if (!('send' in channel)) return { updated: false, removedDuplicates: 0 };
  const botId = channel.client.user?.id;
  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  const isPanel = (message: Message) => {
    if (message.author.id !== botId) return false;
    const ids = customIdsOf(message.components);
    if (ids.has(match.must) && !(match.mustNot && ids.has(match.mustNot))) return true;
    return message.embeds.some(embed => match.titles.some(title => (embed.title || '').includes(title) || (embed.description || '').includes(title)));
  };
  const existing = [...(messages?.filter(isPanel).values() ?? [])].sort((a, b) => b.createdTimestamp - a.createdTimestamp);
  let current: Message | undefined = existing[0];
  if (current && !current.flags.has(MessageFlags.IsComponentsV2)) { await current.delete().catch(() => undefined); current = undefined; existing.shift(); }
  if (current) await current.edit(payload); else await channel.send(payload);
  const duplicates = current ? existing.slice(1) : existing;
  await Promise.all(duplicates.map(message => message.delete().catch(() => undefined)));
  return { updated: Boolean(current), removedDuplicates: duplicates.length };
}
