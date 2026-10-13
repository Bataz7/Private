import type { Context } from '../web/server/http.js';
import type { Mount } from '../web/server/router.js';
import { publicMessage } from '../web/server/errors.js';
import { csrfGuard, originGuard, rateLimit, safeEqual } from '../web/server/security.js';
import { ensureSession, rotateSession } from '../web/server/session.js';
import { renderApplyPage } from '../web/server/shells.js';
import { authorizeUrl, discordJson, exchangeCode } from '../dashboard/oauth.js';
import type { Client } from '../lib/djs/index.js';
import { randomBytes } from 'node:crypto';
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
const fail = (c: Context, status: number, error: string, extra: Record<string, unknown> = {}) => c.status(status).json({ error, ...extra });
const sessionUserOf = (c: Context) => c.session?.data.user as { id: string; username: string } | undefined;

type Handler = (c: Context) => unknown;
function handle(handler: (c: Context) => Promise<unknown>): Handler {
  return (c: Context) => handler(c).catch(error => {
    if (c.sent) return;
    if (error instanceof ApplicationsSetupError) return fail(c, 503, error.message, { setup: true });
    console.error(`Applications API ${c.method} ${c.path}:`, error);
    fail(c, 500, 'صار خطأ. حاول مرة ثانية بعد لحظات.');
  });
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
  if (!channel?.isTextBased?.() || !('send' in channel) || channel.guildId !== form.guildId) throw new Error('اختر روم كتابي في هذا السيرفر.');
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

function mountApi(ctx: DashboardContext, app: Mount) {
  const { discord, selectedGuildId } = ctx;
  const writeLimit = rateLimit('applications-writes', 60_000, 40);
  const admin = (handler: (c: Context) => Promise<unknown>): Handler => handle(async (c: Context) => {
    if (!await ctx.requireAdministrator(c)) return;
    await handler(c);
  });
  const ownForm = async (c: Context) => {
    const form = await getForm(String(c.params.id || ''));
    if (!form || form.guildId !== selectedGuildId(c)) { fail(c, 404, 'النموذج مو موجود.'); return null; }
    return form;
  };
  const ownApplication = async (c: Context) => {
    const item = await getApplication(String(c.params.id || ''));
    if (!item || item.guildId !== selectedGuildId(c)) { fail(c, 404, 'التقديم مو موجود.'); return null; }
    return item;
  };

  app.get('/api/applications/overview', admin(async (c: Context) => {
    const guildId = selectedGuildId(c);
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
    c.json({ forms: forms.map(form => formView(form, counts[form.id] || {})), totals, daily, templates: TEMPLATE_KEYS, oauthReady: Boolean(env.discordClientSecret) });
  }));

  app.get('/api/applications/options', admin(async (c: Context) => {
    const guild = await ctx.getGuild(selectedGuildId(c)).catch(() => null);
    if (!guild) return fail(c, 404, 'السيرفر مو موجود.');
    const me = guild.members.me;
    const roles = guild.roles.cache.filter(role => role.id !== guild.id && !role.managed).sort((a, b) => b.position - a.position)
      .map(role => ({ id: role.id, name: role.name, color: role.hexColor, manageable: Boolean(me && me.roles.highest.position > role.position) }));
    const channels = [...(await guild.channels.fetch().catch(() => guild.channels.cache)).values()].filter((channel: any) => channel?.isTextBased?.() && !channel.isThread?.())
      .sort((a: any, b: any) => (a.parent?.position ?? -1) - (b.parent?.position ?? -1) || (a.position || 0) - (b.position || 0))
      .map((channel: any) => ({ id: channel.id, name: channel.parent?.name ? `${channel.parent.name} / ${channel.name}` : channel.name }));
    c.json({ roles, channels });
  }));

  app.post('/api/applications/forms', admin(async (c: Context) => {
    const guildId = selectedGuildId(c);
    if (await countForms(guildId) >= 25) return fail(c, 400, 'السيرفر يقدر يسوي 25 نموذج كحد أقصى.');
    const definition = buildTemplate(String(c.body?.template || 'staff'));
    const user = sessionUserOf(c);
    const form = await insertForm({ guildId, ...definition, createdBy: user?.id || '' });
    await createLog(guildId, 'APPLICATION_FORM_CREATED', user?.id || '', user?.id || null, { formId: form.id }).catch(() => undefined);
    c.json({ form: formView(form) });
  }), { guards: [writeLimit] });

  app.get('/api/applications/forms/:id', admin(async (c: Context) => {
    const form = await ownForm(c); if (!form) return;
    c.json({ form: formView(form, (await formCounts(form.guildId))[form.id] || {}) });
  }));

  app.put('/api/applications/forms/:id', admin(async (c: Context) => {
    const form = await ownForm(c); if (!form) return;
    let definition;
    try { definition = sanitizeForm(c.body); } catch (error) { return fail(c, 400, publicMessage(error, 'النموذج غير صحيح.')); }
    const updated = await patchForm(form.id, { ...definition, updatedBy: sessionUserOf(c)?.id || '' });
    if (!updated) return fail(c, 404, 'النموذج مو موجود.');
    c.json({ form: formView(updated), panelUpdated: await refreshPanel(discord, updated) });
  }), { guards: [writeLimit] });

  app.patch('/api/applications/forms/:id/open', admin(async (c: Context) => {
    const form = await ownForm(c); if (!form) return;
    const updated = await patchForm(form.id, { open: Boolean(c.body?.open) });
    if (!updated) return fail(c, 404, 'النموذج مو موجود.');
    const user = sessionUserOf(c);
    await createLog(form.guildId, updated.open ? 'APPLICATION_FORM_OPENED' : 'APPLICATION_FORM_CLOSED', user?.id || '', user?.id || null, { formId: form.id }).catch(() => undefined);
    c.json({ form: formView(updated), panelUpdated: await refreshPanel(discord, updated) });
  }), { guards: [writeLimit] });

  app.post('/api/applications/forms/:id/duplicate', admin(async (c: Context) => {
    const form = await ownForm(c); if (!form) return;
    if (await countForms(form.guildId) >= 25) return fail(c, 400, 'السيرفر يقدر يسوي 25 نموذج كحد أقصى.');
    const copy = await insertForm({ guildId: form.guildId, title: `${form.title} (نسخة)`.slice(0, 100), description: form.description, open: false, questions: form.questions, settings: form.settings, createdBy: sessionUserOf(c)?.id || '' });
    c.json({ form: formView(copy) });
  }), { guards: [writeLimit] });

  app.delete('/api/applications/forms/:id', admin(async (c: Context) => {
    const form = await ownForm(c); if (!form) return;
    if (form.panel.channelId && form.panel.messageId) {
      const channel: any = await discord.channels.fetch(form.panel.channelId).catch(() => null);
      await channel?.messages?.delete(form.panel.messageId).catch(() => undefined);
    }
    await deleteForm(form.id); // responses go with it (foreign key cascade)
    const user = sessionUserOf(c);
    await createLog(form.guildId, 'APPLICATION_FORM_DELETED', user?.id || '', user?.id || null, { formId: form.id, title: form.title }).catch(() => undefined);
    c.json({ ok: true });
  }), { guards: [writeLimit] });

  app.post('/api/applications/forms/:id/panel', admin(async (c: Context) => {
    const form = await ownForm(c); if (!form) return;
    const channelId = String(c.body?.channelId || '');
    if (!channelId) return fail(c, 400, 'اختر روم أول.');
    try { c.json({ ok: true, ...(await publishPanel(discord, form, channelId)) }); }
    catch (error) { fail(c, 400, publicMessage(error, 'تعذّر إرسال اللوحة.')); }
  }), { guards: [writeLimit] });

  app.get('/api/applications/forms/:id/export.csv', admin(async (c: Context) => {
    const form = await ownForm(c); if (!form) return;
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
    c.headers.set('Content-Disposition', `attachment; filename="applications-${form.id.slice(0, 8)}.csv"`);
    // Leading BOM so Excel reads the file as UTF-8 (Arabic answers).
    return c.text(`\ufeff${[header.map(csvCell).join(','), ...lines].join('\n')}`, 200, 'text/csv; charset=utf-8');
  }));

  app.get('/api/applications/responses', admin(async (c: Context) => {
    const guildId = selectedGuildId(c);
    const page = Math.max(1, Number(c.q('page')) || 1);
    const size = 30;
    let query: any = supabase.from('applications')
      .select('id,form_id,form_title,user_id,username,display_name,avatar,source,status,submitted_at,created_at,reviewed_at,reviewed_by,votes,questions,answers', { count: 'exact' })
      .eq('guild_id', guildId);
    const formId = String(c.q('formId') || '');
    if (formId) { if (!isUuid(formId)) return c.json({ total: 0, page, hasMore: false, rows: [] }); query = query.eq('form_id', formId); }
    const status = String(c.q('status') || 'pending');
    if (STATUSES.includes(status)) query = query.eq('status', status);
    else if (status === 'all') query = query.in('status', [...DECIDED]);
    const q = cleanSearch(String(c.q('q') || ''));
    if (q) query = query.or(`username.ilike.%${q}%,display_name.ilike.%${q}%,user_id.eq.${q}`);
    const { data, count, error } = await query.order('submitted_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).range((page - 1) * size, page * size - 1);
    if (error) throw new Error(error.message);
    const total = (count as number | null) ?? 0;
    c.json({
      total, page, hasMore: page * size < total,
      rows: ((data ?? []) as Array<Record<string, any>>).map(row => {
        const item = applicationFromRow(row);
        const visible = visibleQuestions(item.questions, item.answers);
        return { id: item.id, formId: item.formId, formTitle: item.formTitle, userId: item.userId, username: item.username, displayName: item.displayName, avatar: item.avatar, source: item.source, status: item.status, submittedAt: item.submittedAt, createdAt: item.createdAt, reviewedAt: item.reviewedAt, up: item.votes.filter(vote => vote.value === 'up').length, down: item.votes.filter(vote => vote.value === 'down').length, answered: visible.filter(question => item.answers[question.id] !== undefined).length, questionCount: visible.length };
      }),
    });
  }));

  app.get('/api/applications/responses/:id', admin(async (c: Context) => {
    const item = await ownApplication(c); if (!item) return;
    const guild = discord.guilds.cache.get(item.guildId);
    const name = async (id: string | null) => {
      if (!id) return null;
      const member = guild ? guild.members.cache.get(id) || await guild.members.fetch(id).catch(() => null) : null;
      return member?.displayName || (await discord.users.fetch(id).catch(() => null))?.username || id;
    };
    const member = guild ? await guild.members.fetch(item.userId).catch(() => null) : null;
    const history = await findApplications({ guildId: item.guildId, userId: item.userId, status: DECIDED }, { orderBy: 'submitted_at', limit: 10 });
    const lang = item.meta?.lang || 'ar';
    c.json({
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

  app.post('/api/applications/responses/:id/decision', admin(async (c: Context) => {
    const item = await ownApplication(c); if (!item) return;
    const decision = c.body?.decision === 'accepted' ? 'accepted' : c.body?.decision === 'rejected' ? 'rejected' : null;
    if (!decision) return fail(c, 400, 'اختر قبول أو رفض.');
    const user = sessionUserOf(c);
    try {
      const result = await decideApplication(discord, item.id, decision, { id: user?.id || '', name: user?.username }, String(c.body?.reason || ''));
      c.json({ ok: true, warnings: result.warnings, dmSent: result.dmSent });
    } catch (error) {
      if (error instanceof ApplicationsSetupError) throw error;
      fail(c, 409, publicMessage(error, 'تعذّر حفظ القرار.'));
    }
  }), { guards: [writeLimit] });

  app.post('/api/applications/responses/:id/notes', admin(async (c: Context) => {
    const item = await ownApplication(c); if (!item) return;
    const text = String(c.body?.text || '').trim().slice(0, 1000);
    if (!text) return fail(c, 400, 'اكتب ملاحظة أول.');
    const user = sessionUserOf(c);
    await addNote(item.id, { text, userId: user?.id || '', name: user?.username || '' });
    c.json({ ok: true });
  }), { guards: [writeLimit] });

  app.post('/api/applications/responses/:id/vote', admin(async (c: Context) => {
    const item = await ownApplication(c); if (!item) return;
    try {
      const updated = await toggleVote(item.id, sessionUserOf(c)?.id || '', c.body?.value === 'down' ? 'down' : 'up');
      await refreshReviewMessage(discord, updated);
      c.json({ ok: true });
    } catch (error) {
      if (error instanceof ApplicationsSetupError) throw error;
      fail(c, 409, publicMessage(error, 'تعذّر التصويت.'));
    }
  }), { guards: [writeLimit] });

  app.delete('/api/applications/responses/:id', admin(async (c: Context) => {
    const item = await ownApplication(c); if (!item) return;
    await deleteApplication(item.id);
    const user = sessionUserOf(c);
    await createLog(item.guildId, 'APPLICATION_DELETED', item.userId, user?.id || null, { applicationId: item.id }).catch(() => undefined);
    c.json({ ok: true });
  }), { guards: [writeLimit] });
}

// ---- Public web form ---------------------------------------------------------------------------

const submitTimes = new Map<string, number>();
setInterval(() => { const cutoff = Date.now() - 3_600_000; for (const [id, at] of submitTimes) if (at < cutoff) submitTimes.delete(id); }, 10 * 60_000).unref();

function applicantOf(c: Context): Applicant | null {
  const data = c.session?.data;
  if (data?.applicant) return data.applicant as Applicant;
  const user = data?.user as { id: string; username: string; avatar: string | null } | undefined;
  if (user) return { id: user.id, username: user.username, avatar: user.avatar ? (String(user.avatar).startsWith('http') ? user.avatar : avatarUrl(user)) : avatarUrl({ id: user.id, avatar: null }) };
  return null;
}

/** صفحات التقديم العامة فقط — ما يصير الدخول تحويل مفتوح لموقع ثاني. */
const safeNext = (value: string) => (/^\/apply\/[0-9a-f-]{36}$/i.test(value) ? value : '/');

function mountPublic(ctx: DashboardContext, app: Mount) {
  const { discord } = ctx;
  const apiLimit = rateLimit('apply-api', 60_000, 90, 'طلبات كثيرة. انتظر لحظة وحاول مرة ثانية.');
  const loginLimit = rateLimit('apply-login', 60_000, 20, 'محاولات دخول كثيرة. انتظر دقيقة.');
  const submitLimit = rateLimit('apply-submit', 60_000, 6, 'محاولات إرسال كثيرة. انتظر دقيقة.');
  // طلبات الكتابة العامة: من نفس الموقع + توكن CSRF الجلسة (المتقدّم يسجل دخول بديسكورد أول، فعنده جلسة).
  const writeGuards = [originGuard, apiLimit, csrfGuard];

  app.get('/apply/:formId', (c: Context) => {
    if (!isUuid(c.params.formId)) return c.text('', 404);
    c.headers.set('Cache-Control', 'no-store');
    return c.html(renderApplyPage(String(c.params.formId), c.session?.csrf));
  }, { guards: [apiLimit] });

  app.get('/apply/:formId/login', (c: Context) => {
    const formId = String(c.params.formId || '');
    if (!isUuid(formId)) return c.redirect('/');
    if (!env.discordClientSecret) return c.text('تسجيل الدخول بديسكورد مو مضبوط في هذه اللوحة (DISCORD_CLIENT_SECRET).', 503);
    const nonce = randomBytes(16).toString('hex');
    ensureSession(c).data.applyState = { nonce, next: `/apply/${formId}` };
    c.headers.set('Cache-Control', 'no-store');
    return c.redirect(authorizeUrl('identify', `apply.${nonce}`));
  }, { guards: [loginLimit] });

  app.post('/apply-api/logout', (c: Context) => { if (c.session) delete c.session.data.applicant; return c.json({ ok: true }); }, { guards: writeGuards });

  app.get('/apply-api/forms/:formId', handle(async (c: Context) => {
    if (!isUuid(c.params.formId)) return fail(c, 404, 'هذا النموذج مو موجود.');
    const form = await getForm(String(c.params.formId || ''));
    if (!form) return fail(c, 404, 'هذا النموذج مو موجود.');
    const s = formSettings(form);
    const guild = discord.guilds.cache.get(form.guildId) ?? await ctx.getGuild(form.guildId).catch(() => null);
    const viewer = applicantOf(c);
    let eligibility: { ok: boolean; reason: string } = { ok: false, reason: '' };
    let latest: { status: string; submittedAt: Date | null; reason: string } | null = null;
    if (viewer) {
      const result = await checkEligibility(discord, form, viewer.id, 'web');
      eligibility = result.ok ? { ok: true, reason: '' } : { ok: false, reason: result.reason };
      const last = (await findApplications({ formId: form.id, userId: viewer.id, status: DECIDED }, { orderBy: 'submitted_at', limit: 1 }))[0];
      if (last) latest = { status: last.status, submittedAt: last.submittedAt, reason: last.status === 'rejected' && s.shareRejectReason ? last.decisionReason : '' };
    }
    const closed = !form.open || Boolean(s.closesAt && new Date(s.closesAt).getTime() < Date.now()) || s.mode === 'dm';
    c.headers.set('Cache-Control', 'no-store');
    return c.json({
      form: { id: form.id, title: form.title, description: form.description, questions: form.questions, open: !closed, closedReason: s.mode === 'dm' ? t(s.language, 'eDmOnly') : !form.open ? t(s.language, 'eFormClosed') : closed ? t(s.language, 'eFormExpired') : '', language: s.language, color: s.color, bannerUrl: s.bannerUrl, closesAt: s.closesAt },
      guild: guild ? { name: guild.name, icon: guild.iconURL({ extension: 'png', size: 128 }) || '', members: guild.memberCount } : null,
      viewer, eligibility, latest, loginReady: Boolean(env.discordClientSecret), csrf: c.session?.csrf,
    });
  }), { guards: [apiLimit] });

  app.post('/apply-api/forms/:formId/submit', handle(async (c: Context) => {
    const viewer = applicantOf(c);
    if (!viewer) return fail(c, 401, 'سجّل دخولك بديسكورد أول.');
    if (!isUuid(c.params.formId)) return fail(c, 404, 'هذا النموذج مو موجود.');
    const form = await getForm(String(c.params.formId || ''));
    if (!form) return fail(c, 404, 'هذا النموذج مو موجود.');
    const lang = formSettings(form).language;
    const last = submitTimes.get(viewer.id) || 0;
    if (Date.now() - last < 8000) return fail(c, 429, lang === 'en' ? 'Wait a moment before trying again.' : 'انتظر شوي قبل تحاول مرة ثانية.');
    if (submitTimes.size >= 10_000) submitTimes.delete(submitTimes.keys().next().value!);
    submitTimes.set(viewer.id, Date.now());
    const eligibility = await checkEligibility(discord, form, viewer.id, 'web');
    if (!eligibility.ok) return fail(c, 403, eligibility.reason);
    const result = validateSubmission(form.questions, c.body?.answers || {}, lang);
    if (!result.ok) { submitTimes.delete(viewer.id); return fail(c, 400, lang === 'en' ? 'Check the highlighted questions.' : 'راجع الأسئلة المظللة بالأحمر.', { fieldErrors: result.errors }); }
    try {
      const created = await createWebApplication(discord, form, eligibility.member, result.answers);
      return c.json({ ok: true, id: created.id, reference: created.id.replace(/-/g, '').slice(-6).toUpperCase() });
    } catch (error) {
      if (isUniqueViolation(error)) return fail(c, 409, t(lang, 'ePending'));
      throw error;
    }
  }), { guards: [...writeGuards, submitLimit], body: 256 * 1024 });
}

/** رجوع المتقدّم من ديسكورد (state = "apply.<nonce>"). دخول الستاف ما يوصل هنا. */
export async function handleApplyCallback(c: Context) {
  const saved = c.session?.data.applyState as { nonce: string; next?: string } | undefined;
  const state = c.q('state');
  const code = c.q('code');
  const back = safeNext(saved?.next || '/');
  if (!saved || !safeEqual(state, `apply.${saved.nonce}`)) return c.redirect(`${back}?error=state`);
  delete c.session!.data.applyState;
  if (!code) return c.redirect(`${back}?error=cancelled`);
  try {
    const token = await exchangeCode(code);
    if (!token?.access_token) return c.redirect(`${back}?error=oauth`);
    const user = await discordJson<{ id: string; username: string; global_name?: string | null; avatar: string | null }>('/users/@me', token.access_token);
    if (!user?.id) return c.redirect(`${back}?error=oauth`);
    // رقم جلسة جديد بعد الدخول (منع تثبيت الجلسة).
    rotateSession(c).data.applicant = { id: user.id, username: user.global_name || user.username, avatar: avatarUrl(user) } satisfies Applicant;
    return c.redirect(back);
  } catch (error) {
    console.error('Applicant OAuth failed:', error instanceof Error ? error.message : error);
    return c.redirect(`${back}?error=oauth`);
  }
}

export const applicationsDashboard: DashboardExtension = {
  name: 'applications',
  mountPublic,
  mountApi,
};
