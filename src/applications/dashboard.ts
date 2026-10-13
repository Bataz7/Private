import type { Express, Request, RequestHandler, Response } from 'express';
import type { Client } from 'discord.js';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { env } from '../config/env.js';
import { supabase } from '../supabase/client.js';
import type { DashboardContext, DashboardExtension } from '../dashboard/extensions.js';
import { answerable, formatAnswer, sanitizeForm, validateSubmission, visibleQuestions } from './questions.js';
import { buildTemplate, TEMPLATE_KEYS } from './templates.js';
import { t } from './i18n.js';
import { buildApplicationPanel } from './panel.js';
import {
  addNote, ApplicationsSetupError, checkEligibility, countForms, createWebApplication, decideApplication, DECIDED, deleteApplication, deleteForm, findApplications, formCounts,
  formSettings, getApplication, getForm, insertForm, isUniqueViolation, isUuid, listForms, patchForm, refreshReviewMessage, toggleVote,
} from '../services/application.service.js';
import { createLog } from '../services/log.service.js';
import { applicationFromRow, type ApplicationDoc, type ApplicationFormDoc } from '../models/Application.js';

type Applicant = { id: string; username: string; avatar: string };

const DAY = 86_400_000;
const STATUSES = ['in_progress', 'pending', 'accepted', 'rejected', 'cancelled', 'expired'];
const fail = (res: Response, status: number, error: string, extra: Record<string, unknown> = {}) => res.status(status).json({ error, ...extra });
const sessionUserOf = (req: Request) => (req.session as any)?.user as { id: string; username: string } | undefined;

function handle(handler: (req: Request, res: Response) => Promise<unknown>): RequestHandler {
  return (req, res) => {
    handler(req, res).catch(error => {
      if (error instanceof ApplicationsSetupError) return void (!res.headersSent && fail(res, 503, error.message, { setup: true }));
      console.error(`Applications API ${req.method} ${req.path}:`, error);
      if (!res.headersSent) fail(res, 500, 'Something went wrong. Try again in a moment.');
    });
  };
}

// A small in-memory rate limiter for the public routes (per IP and bucket).
const hits = new Map<string, { count: number; resetAt: number }>();
setInterval(() => { const now = Date.now(); for (const [key, hit] of hits) if (hit.resetAt < now) hits.delete(key); }, 5 * 60_000).unref();
function rateLimit(bucket: string, max: number, windowMs = 60_000): RequestHandler {
  return (req, res, next) => {
    const key = `${bucket}:${req.ip || req.socket.remoteAddress || 'unknown'}`;
    const now = Date.now();
    const hit = hits.get(key);
    if (!hit || hit.resetAt < now) { hits.set(key, { count: 1, resetAt: now + windowMs }); return next(); }
    hit.count += 1;
    if (hit.count > max) return void fail(res, 429, 'Too many requests. Wait a moment and try again.');
    next();
  };
}

function avatarUrl(user: { id: string; avatar: string | null }) {
  return user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128` : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(user.id) >> 22n) % 6}.png`;
}

function formView(form: ApplicationFormDoc, counts: Record<string, number> = {}) {
  return { id: form.id, title: form.title, description: form.description, open: form.open, questions: form.questions, settings: formSettings(form), panel: form.panel, createdAt: form.createdAt, updatedAt: form.updatedAt, counts, applyUrl: `${env.dashboardUrl}/apply/${form.id}` };
}

// Posts or edits the Discord panel for a form.
async function publishPanel(discord: Client, form: ApplicationFormDoc, channelId: string) {
  const channel: any = await discord.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.() || !('send' in channel) || channel.guildId !== form.guildId) throw new Error('Choose a text channel in this server.');
  const payload = buildApplicationPanel(form);
  if (form.panel.messageId && form.panel.channelId === channelId) {
    const existing = await channel.messages.fetch(form.panel.messageId).catch(() => null);
    if (existing) { await existing.edit(payload); return { updated: true }; }
  }
  const message = await channel.send(payload);
  await patchForm(form.id, { panel: { channelId, messageId: message.id } });
  return { updated: false };
}

async function refreshPanel(discord: Client, form: ApplicationFormDoc) {
  if (!form.panel.channelId || !form.panel.messageId) return false;
  const channel: any = await discord.channels.fetch(form.panel.channelId).catch(() => null);
  const message = channel?.messages ? await channel.messages.fetch(form.panel.messageId).catch(() => null) : null;
  return message ? message.edit(buildApplicationPanel(form)).then(() => true).catch(() => false) : false;
}

const csvCell = (value: unknown) => { let text = String(value ?? '').replace(/\r?\n/g, ' ').trim(); if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`; return `"${text.replace(/"/g, '""')}"`; };
const cleanSearch = (value: string) => value.replace(/[,()%*\\"'`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);

// ---- Staff API (owners and administrators) -----------------------------------------------------

function mountApi(ctx: DashboardContext) {
  const { app, discord, selectedGuildId } = ctx;
  const admin = (handler: (req: Request, res: Response) => Promise<unknown>): RequestHandler => handle(async (req, res) => {
    if (!await ctx.requireAdministrator(req, res)) return;
    await handler(req, res);
  });
  const ownForm = async (req: Request, res: Response) => {
    const form = await getForm(String(req.params.id || ''));
    if (!form || form.guildId !== selectedGuildId(req)) { fail(res, 404, 'Form not found.'); return null; }
    return form;
  };
  const ownApplication = async (req: Request, res: Response) => {
    const item = await getApplication(String(req.params.id || ''));
    if (!item || item.guildId !== selectedGuildId(req)) { fail(res, 404, 'Application not found.'); return null; }
    return item;
  };

  app.get('/api/applications/overview', admin(async (req, res) => {
    const guildId = selectedGuildId(req);
    const start = Math.floor(Date.now() / DAY) * DAY - 13 * DAY;
    const [forms, counts, recent] = await Promise.all([
      listForms(guildId),
      formCounts(guildId),
      supabase.from('applications').select('submitted_at').eq('guild_id', guildId).gte('submitted_at', new Date(start).toISOString()).limit(5000),
    ]);
    const byDay = new Map<string, number>();
    for (const row of recent.data ?? []) { const day = new Date(row.submitted_at).toISOString().slice(0, 10); byDay.set(day, (byDay.get(day) || 0) + 1); }
    const daily = Array.from({ length: 14 }, (_, index) => { const date = new Date(start + index * DAY).toISOString().slice(0, 10); return { date, count: byDay.get(date) || 0 }; });
    const totals: Record<string, number> = { pending: 0, accepted: 0, rejected: 0, in_progress: 0 };
    for (const perForm of Object.values(counts)) for (const [status, n] of Object.entries(perForm)) totals[status] = (totals[status] || 0) + n;
    res.json({ forms: forms.map(form => formView(form, counts[form.id] || {})), totals, daily, templates: TEMPLATE_KEYS, oauthReady: Boolean(env.discordClientSecret) });
  }));

  app.get('/api/applications/options', admin(async (req, res) => {
    const guild = discord.guilds.cache.get(selectedGuildId(req));
    if (!guild) return fail(res, 404, 'Server not found.');
    const me = guild.members.me;
    const roles = guild.roles.cache.filter(role => role.id !== guild.id && !role.managed).sort((a, b) => b.position - a.position)
      .map(role => ({ id: role.id, name: role.name, color: role.hexColor, manageable: Boolean(me && me.roles.highest.position > role.position) }));
    const channels = [...(await guild.channels.fetch().catch(() => guild.channels.cache)).values()].filter((channel: any) => channel?.isTextBased?.() && !channel.isThread?.())
      .sort((a: any, b: any) => (a.parent?.position ?? -1) - (b.parent?.position ?? -1) || (a.position || 0) - (b.position || 0))
      .map((channel: any) => ({ id: channel.id, name: channel.parent?.name ? `${channel.parent.name} / ${channel.name}` : channel.name }));
    res.json({ roles, channels });
  }));

  app.post('/api/applications/forms', admin(async (req, res) => {
    const guildId = selectedGuildId(req);
    if (await countForms(guildId) >= 25) return fail(res, 400, 'A server can have up to 25 forms.');
    const definition = buildTemplate(String(req.body?.template || 'staff'));
    const user = sessionUserOf(req);
    const form = await insertForm({ guildId, ...definition, createdBy: user?.id || '' });
    await createLog(guildId, 'APPLICATION_FORM_CREATED', user?.id || '', user?.id || null, { formId: form.id }).catch(() => undefined);
    res.json({ form: formView(form) });
  }));

  app.get('/api/applications/forms/:id', admin(async (req, res) => {
    const form = await ownForm(req, res); if (!form) return;
    res.json({ form: formView(form, (await formCounts(form.guildId))[form.id] || {}) });
  }));

  app.put('/api/applications/forms/:id', admin(async (req, res) => {
    const form = await ownForm(req, res); if (!form) return;
    let definition;
    try { definition = sanitizeForm(req.body); } catch (error) { return fail(res, 400, error instanceof Error ? error.message : 'Invalid form.'); }
    const updated = await patchForm(form.id, { ...definition, updatedBy: sessionUserOf(req)?.id || '' });
    if (!updated) return fail(res, 404, 'Form not found.');
    res.json({ form: formView(updated), panelUpdated: await refreshPanel(discord, updated) });
  }));

  app.patch('/api/applications/forms/:id/open', admin(async (req, res) => {
    const form = await ownForm(req, res); if (!form) return;
    const updated = await patchForm(form.id, { open: Boolean(req.body?.open) });
    if (!updated) return fail(res, 404, 'Form not found.');
    const user = sessionUserOf(req);
    await createLog(form.guildId, updated.open ? 'APPLICATION_FORM_OPENED' : 'APPLICATION_FORM_CLOSED', user?.id || '', user?.id || null, { formId: form.id }).catch(() => undefined);
    res.json({ form: formView(updated), panelUpdated: await refreshPanel(discord, updated) });
  }));

  app.post('/api/applications/forms/:id/duplicate', admin(async (req, res) => {
    const form = await ownForm(req, res); if (!form) return;
    if (await countForms(form.guildId) >= 25) return fail(res, 400, 'A server can have up to 25 forms.');
    const copy = await insertForm({ guildId: form.guildId, title: `${form.title} (copy)`.slice(0, 100), description: form.description, open: false, questions: form.questions, settings: form.settings, createdBy: sessionUserOf(req)?.id || '' });
    res.json({ form: formView(copy) });
  }));

  app.delete('/api/applications/forms/:id', admin(async (req, res) => {
    const form = await ownForm(req, res); if (!form) return;
    if (form.panel.channelId && form.panel.messageId) {
      const channel: any = await discord.channels.fetch(form.panel.channelId).catch(() => null);
      await channel?.messages?.delete(form.panel.messageId).catch(() => undefined);
    }
    await deleteForm(form.id); // responses go with it (foreign key cascade)
    const user = sessionUserOf(req);
    await createLog(form.guildId, 'APPLICATION_FORM_DELETED', user?.id || '', user?.id || null, { formId: form.id, title: form.title }).catch(() => undefined);
    res.json({ ok: true });
  }));

  app.post('/api/applications/forms/:id/panel', admin(async (req, res) => {
    const form = await ownForm(req, res); if (!form) return;
    const channelId = String(req.body?.channelId || '');
    if (!channelId) return fail(res, 400, 'Choose a channel first.');
    try { res.json({ ok: true, ...(await publishPanel(discord, form, channelId)) }); }
    catch (error) { fail(res, 400, error instanceof Error ? error.message : 'Could not send the panel.'); }
  }));

  app.get('/api/applications/forms/:id/export.csv', admin(async (req, res) => {
    const form = await ownForm(req, res); if (!form) return;
    const rows: ApplicationDoc[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('applications').select('*').eq('form_id', form.id).in('status', [...DECIDED]).order('submitted_at', { ascending: false }).range(from, from + 999);
      if (error) throw new Error(error.message);
      rows.push(...(data ?? []).map(applicationFromRow));
      if ((data?.length ?? 0) < 1000) break;
    }
    const questions = answerable(form.questions);
    const lang = formSettings(form).language;
    const header = ['Application', 'Status', 'User ID', 'Username', 'Display name', 'Source', 'Submitted', 'Reviewed by', 'Reason', ...questions.map(question => question.label)];
    const lines = rows.map(row => [row.id.replace(/-/g, '').slice(-6).toUpperCase(), row.status, row.userId, row.username, row.displayName, row.source, row.submittedAt ? row.submittedAt.toISOString() : '', row.reviewedBy || '', row.decisionReason || '',
      ...questions.map(question => row.answers?.[question.id] === undefined ? '' : formatAnswer(question, row.answers[question.id], lang).replace(/\n• /g, '; ').replace(/^• /, ''))].map(csvCell).join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="applications-${form.id.slice(0, 8)}.csv"`);
    // Leading BOM so Excel reads the file as UTF-8 (Arabic answers).
    res.send(`﻿${[header.map(csvCell).join(','), ...lines].join('\n')}`);
  }));

  app.get('/api/applications/responses', admin(async (req, res) => {
    const guildId = selectedGuildId(req);
    const page = Math.max(1, Number(req.query.page) || 1);
    const size = 30;
    let query: any = supabase.from('applications')
      .select('id,form_id,form_title,user_id,username,display_name,avatar,source,status,submitted_at,created_at,reviewed_at,reviewed_by,votes,questions,answers', { count: 'exact' })
      .eq('guild_id', guildId);
    const formId = String(req.query.formId || '');
    if (formId) { if (!isUuid(formId)) return res.json({ total: 0, page, hasMore: false, rows: [] }); query = query.eq('form_id', formId); }
    const status = String(req.query.status || 'pending');
    if (STATUSES.includes(status)) query = query.eq('status', status);
    else if (status === 'all') query = query.in('status', [...DECIDED]);
    const q = cleanSearch(String(req.query.q || ''));
    if (q) query = query.or(`username.ilike.%${q}%,display_name.ilike.%${q}%,user_id.eq.${q}`);
    const { data, count, error } = await query.order('submitted_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).range((page - 1) * size, page * size - 1);
    if (error) throw new Error(error.message);
    const total = (count as number | null) ?? 0;
    res.json({
      total, page, hasMore: page * size < total,
      rows: ((data ?? []) as Array<Record<string, any>>).map(row => {
        const item = applicationFromRow(row);
        const visible = visibleQuestions(item.questions, item.answers);
        return { id: item.id, formId: item.formId, formTitle: item.formTitle, userId: item.userId, username: item.username, displayName: item.displayName, avatar: item.avatar, source: item.source, status: item.status, submittedAt: item.submittedAt, createdAt: item.createdAt, reviewedAt: item.reviewedAt, up: item.votes.filter(vote => vote.value === 'up').length, down: item.votes.filter(vote => vote.value === 'down').length, answered: visible.filter(question => item.answers[question.id] !== undefined).length, questionCount: visible.length };
      }),
    });
  }));

  app.get('/api/applications/responses/:id', admin(async (req, res) => {
    const item = await ownApplication(req, res); if (!item) return;
    const guild = discord.guilds.cache.get(item.guildId);
    const name = async (id: string | null) => {
      if (!id) return null;
      const member = guild ? guild.members.cache.get(id) || await guild.members.fetch(id).catch(() => null) : null;
      return member?.displayName || (await discord.users.fetch(id).catch(() => null))?.username || id;
    };
    const member = guild ? await guild.members.fetch(item.userId).catch(() => null) : null;
    const history = await findApplications({ guildId: item.guildId, userId: item.userId, status: DECIDED }, { orderBy: 'submitted_at', limit: 10 });
    const lang = item.meta?.lang || 'ar';
    res.json({
      application: {
        ...item,
        reviewerName: await name(item.reviewedBy),
        notes: await Promise.all(item.notes.map(async note => ({ ...note, name: await name(note.userId) || note.name }))),
        votes: await Promise.all(item.votes.map(async vote => ({ ...vote, name: await name(vote.userId) }))),
        items: visibleQuestions(item.questions, item.answers).map(question => ({ id: question.id, type: question.type, label: question.label, answered: item.answers[question.id] !== undefined, value: item.answers[question.id] ?? null, text: formatAnswer(question, item.answers[question.id], lang) })),
        sections: item.questions.filter(question => question.type === 'section').map(question => ({ id: question.id, label: question.label, before: item.questions[item.questions.indexOf(question) + 1]?.id || '' })),
        stillMember: Boolean(member),
        roles: member ? member.roles.cache.filter(role => role.id !== guild!.id).sort((a, b) => b.position - a.position).map(role => ({ id: role.id, name: role.name, color: role.hexColor })).slice(0, 12) : [],
        reviewUrl: item.reviewChannelId && item.reviewMessageId ? `https://discord.com/channels/${item.guildId}/${item.reviewChannelId}/${item.reviewMessageId}` : '',
        history: history.filter(row => row.id !== item.id).map(row => ({ id: row.id, formTitle: row.formTitle, status: row.status, submittedAt: row.submittedAt })),
      },
    });
  }));

  app.post('/api/applications/responses/:id/decision', admin(async (req, res) => {
    const item = await ownApplication(req, res); if (!item) return;
    const decision = req.body?.decision === 'accepted' ? 'accepted' : req.body?.decision === 'rejected' ? 'rejected' : null;
    if (!decision) return fail(res, 400, 'Choose accept or reject.');
    const user = sessionUserOf(req);
    try {
      const result = await decideApplication(discord, item.id, decision, { id: user?.id || '', name: user?.username }, String(req.body?.reason || ''));
      res.json({ ok: true, warnings: result.warnings, dmSent: result.dmSent });
    } catch (error) {
      if (error instanceof ApplicationsSetupError) throw error;
      fail(res, 409, error instanceof Error ? error.message : 'Could not save the decision.');
    }
  }));

  app.post('/api/applications/responses/:id/notes', admin(async (req, res) => {
    const item = await ownApplication(req, res); if (!item) return;
    const text = String(req.body?.text || '').trim().slice(0, 1000);
    if (!text) return fail(res, 400, 'Write a note first.');
    const user = sessionUserOf(req);
    await addNote(item.id, { text, userId: user?.id || '', name: user?.username || '' });
    res.json({ ok: true });
  }));

  app.post('/api/applications/responses/:id/vote', admin(async (req, res) => {
    const item = await ownApplication(req, res); if (!item) return;
    try {
      const updated = await toggleVote(item.id, sessionUserOf(req)?.id || '', req.body?.value === 'down' ? 'down' : 'up');
      await refreshReviewMessage(discord, updated);
      res.json({ ok: true });
    } catch (error) {
      if (error instanceof ApplicationsSetupError) throw error;
      fail(res, 409, error instanceof Error ? error.message : 'Could not vote.');
    }
  }));

  app.delete('/api/applications/responses/:id', admin(async (req, res) => {
    const item = await ownApplication(req, res); if (!item) return;
    await deleteApplication(item.id);
    const user = sessionUserOf(req);
    await createLog(item.guildId, 'APPLICATION_DELETED', item.userId, user?.id || null, { applicationId: item.id }).catch(() => undefined);
    res.json({ ok: true });
  }));
}

// ---- Public web form ---------------------------------------------------------------------------

const submitTimes = new Map<string, number>();
setInterval(() => { const cutoff = Date.now() - 3_600_000; for (const [id, at] of submitTimes) if (at < cutoff) submitTimes.delete(id); }, 10 * 60_000).unref();

function applicantOf(req: Request): Applicant | null {
  const session = req.session as any;
  if (session?.applicant) return session.applicant;
  if (session?.user) return { id: session.user.id, username: session.user.username, avatar: session.user.avatar ? (String(session.user.avatar).startsWith('http') ? session.user.avatar : avatarUrl(session.user)) : avatarUrl({ id: session.user.id, avatar: null }) };
  return null;
}

/** Only same-site paths of the public apply pages are accepted, so the login can never become an open redirect. */
const safeNext = (value: string) => (/^\/apply\/[0-9a-f-]{36}$/i.test(value) ? value : '/');

function mountPublic(ctx: DashboardContext) {
  const { app, discord } = ctx;
  const applyPage = join(ctx.publicDir, 'apply.html');
  const publicApi = rateLimit('apply-api', 90);
  app.use('/apply-api', publicApi);
  app.use(/^\/apply\/[^/]+\/login$/, rateLimit('apply-login', 20));

  app.get('/apply/:formId', (_req, res) => res.sendFile(applyPage));

  app.get('/apply/:formId/login', (req, res) => {
    const formId = String(req.params.formId || '');
    if (!isUuid(formId)) return res.redirect('/');
    if (!env.discordClientSecret) return res.status(503).send('Discord login is not configured on this dashboard (DISCORD_CLIENT_SECRET).');
    const nonce = randomBytes(16).toString('hex');
    (req.session as any).applyState = { nonce, next: `/apply/${formId}` };
    const params = new URLSearchParams({ client_id: env.clientId, redirect_uri: `${env.dashboardUrl}/auth/callback`, response_type: 'code', scope: 'identify', state: `apply.${nonce}` });
    req.session.save(() => res.redirect(`https://discord.com/oauth2/authorize?${params}`));
  });

  app.post('/apply-api/logout', (req, res) => { delete (req.session as any).applicant; res.json({ ok: true }); });

  app.get('/apply-api/forms/:formId', handle(async (req, res) => {
    const form = await getForm(String(req.params.formId || ''));
    if (!form) return fail(res, 404, 'This form does not exist.');
    const s = formSettings(form);
    const guild = discord.guilds.cache.get(form.guildId) || await discord.guilds.fetch(form.guildId).catch(() => null);
    const viewer = applicantOf(req);
    let eligibility: { ok: boolean; reason: string } = { ok: false, reason: '' };
    let latest: { status: string; submittedAt: Date | null; reason: string } | null = null;
    if (viewer) {
      const result = await checkEligibility(discord, form, viewer.id, 'web');
      eligibility = result.ok ? { ok: true, reason: '' } : { ok: false, reason: result.reason };
      const last = (await findApplications({ formId: form.id, userId: viewer.id, status: DECIDED }, { orderBy: 'submitted_at', limit: 1 }))[0];
      if (last) latest = { status: last.status, submittedAt: last.submittedAt, reason: last.status === 'rejected' && s.shareRejectReason ? last.decisionReason : '' };
    }
    const closed = !form.open || Boolean(s.closesAt && new Date(s.closesAt).getTime() < Date.now()) || s.mode === 'dm';
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      form: { id: form.id, title: form.title, description: form.description, questions: form.questions, open: !closed, closedReason: s.mode === 'dm' ? t(s.language, 'eDmOnly') : !form.open ? t(s.language, 'eFormClosed') : closed ? t(s.language, 'eFormExpired') : '', language: s.language, color: s.color, bannerUrl: s.bannerUrl, closesAt: s.closesAt },
      guild: guild ? { name: guild.name, icon: guild.iconURL({ extension: 'png', size: 128 }) || '', members: guild.memberCount } : null,
      viewer, eligibility, latest, loginReady: Boolean(env.discordClientSecret),
    });
  }));

  app.post('/apply-api/forms/:formId/submit', handle(async (req, res) => {
    if (!req.is('application/json')) return fail(res, 415, 'Unsupported request.');
    const viewer = applicantOf(req);
    if (!viewer) return fail(res, 401, 'Log in with Discord first.');
    const form = await getForm(String(req.params.formId || ''));
    if (!form) return fail(res, 404, 'This form does not exist.');
    const lang = formSettings(form).language;
    const last = submitTimes.get(viewer.id) || 0;
    if (Date.now() - last < 8000) return fail(res, 429, lang === 'ar' ? 'انتظر قليلًا قبل المحاولة مرة أخرى.' : 'Wait a moment before trying again.');
    submitTimes.set(viewer.id, Date.now());
    const eligibility = await checkEligibility(discord, form, viewer.id, 'web');
    if (!eligibility.ok) return fail(res, 403, eligibility.reason);
    const result = validateSubmission(form.questions, req.body?.answers || {}, lang);
    if (!result.ok) { submitTimes.delete(viewer.id); return fail(res, 400, lang === 'ar' ? 'راجع الأسئلة المظللة بالأحمر.' : 'Check the highlighted questions.', { fieldErrors: result.errors }); }
    try {
      const created = await createWebApplication(discord, form, eligibility.member, result.answers);
      res.json({ ok: true, id: created.id, reference: created.id.replace(/-/g, '').slice(-6).toUpperCase() });
    } catch (error) {
      if (isUniqueViolation(error)) return fail(res, 409, t(lang, 'ePending'));
      throw error;
    }
  }));
}

/** Handles the OAuth callback for applicants (state = "apply.<nonce>"). Staff dashboard logins never reach this. */
export async function handleApplyCallback(req: Request, res: Response) {
  const saved = (req.session as any).applyState as { nonce: string; next?: string } | undefined;
  const state = String(req.query.state || '');
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const back = safeNext(saved?.next || '/');
  if (!saved || state !== `apply.${saved.nonce}`) return res.redirect(`${back}?error=state`);
  delete (req.session as any).applyState;
  if (!code) return res.redirect(`${back}?error=cancelled`);
  try {
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: env.clientId, client_secret: env.discordClientSecret, grant_type: 'authorization_code', code, redirect_uri: `${env.dashboardUrl}/auth/callback` }),
    });
    const token = await tokenResponse.json() as { access_token?: string };
    if (!tokenResponse.ok || !token.access_token) return res.redirect(`${back}?error=oauth`);
    const userResponse = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${token.access_token}` } });
    if (!userResponse.ok) return res.redirect(`${back}?error=oauth`);
    const user = await userResponse.json() as { id: string; username: string; global_name?: string | null; avatar: string | null };
    (req.session as any).applicant = { id: user.id, username: user.global_name || user.username, avatar: avatarUrl(user) } satisfies Applicant;
    req.session.save(() => res.redirect(back));
  } catch (error) {
    console.error('Applicant OAuth failed:', error);
    res.redirect(`${back}?error=oauth`);
  }
}

export const applicationsDashboard: DashboardExtension = {
  name: 'applications',
  mountPublic,
  mountApi,
  styles: ['applications'],
};
