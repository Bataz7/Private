import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits, type Client, type Guild, type GuildMember, type Role } from '../lib/djs/index.js';
import { env } from '../config/env.js';
import { supabase } from '../supabase/client.js';
import { DEFAULT_SETTINGS, formatAnswer, visibleQuestions, type FormSettings, type Language, type Question } from '../applications/questions.js';
import { t } from '../applications/i18n.js';
import { acceptedEmbed, receivedEmbed, rejectedEmbed } from '../applications/messages.js';
import { getSettings } from './settings.service.js';
import { ensureStaff } from './shift.service.js';
import { createLog } from './log.service.js';
import { isAdministrator } from '../utils/permissions.js';
import {
  applicationFromRow, applicationRow, formFromRow, formRow, type ApplicationDoc, type ApplicationFormDoc,
} from '../models/Application.js';

const DAY = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLORS = { accepted: 0x4fc08d, rejected: 0xe9697b, neutral: 0x8175f5 };
export const DECIDED = ['pending', 'accepted', 'rejected'] as const;

export const isUuid = (value: unknown) => UUID.test(String(value || ''));
export const formSettings = (form: Pick<ApplicationFormDoc, 'settings'> | null | undefined): FormSettings => ({ ...DEFAULT_SETTINGS, ...(form?.settings || {}) });
export const colorOf = (settings: FormSettings) => parseInt(settings.color.replace('#', ''), 16) || COLORS.neutral;
export const applyUrl = (formId: string) => `${env.dashboardUrl}/apply/${formId}`;
export const reviewUrl = (applicationId: string) => `${env.dashboardUrl}/dashboard/applications?id=${applicationId}`;
export const shortId = (id: string) => String(id).replace(/-/g, '').slice(-6).toUpperCase();
const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value);
const fill = (template: string, vars: Record<string, string>) => template.replace(/\{(\w+)\}/g, (match, name) => (Object.hasOwn(vars, name) ? vars[name] : undefined) ?? match);

// ---- Database access ---------------------------------------------------------------------------

/** Thrown when the applications tables do not exist yet (migration 031 has not been run). */
export class ApplicationsSetupError extends Error {
  constructor() { super('Applications are not set up yet: run supabase/migrations/031_applications.sql in the Supabase SQL editor.'); this.name = 'ApplicationsSetupError'; }
}
export const isUniqueViolation = (error: unknown) => (error as { code?: string } | null)?.code === '23505';

function fail(what: string, error: { message: string; code?: string }): never {
  if (error.code === 'PGRST205' || error.code === '42P01' || /schema cache|does not exist/i.test(error.message)) throw new ApplicationsSetupError();
  throw Object.assign(new Error(`Supabase ${what} failed: ${error.message}`), { code: error.code });
}

export async function applicationsReady() {
  const { error } = await supabase.from('applications').select('id').limit(1);
  if (!error) return { ok: true as const };
  return { ok: false as const, missing: error.code === 'PGRST205' || error.code === '42P01', message: error.message };
}

export async function getForm(id: string) {
  if (!isUuid(id)) return null;
  const { data, error } = await supabase.from('application_forms').select('*').eq('id', id).maybeSingle();
  if (error) fail('form lookup', error);
  return data ? formFromRow(data) : null;
}

export async function listForms(guildId: string) {
  const { data, error } = await supabase.from('application_forms').select('*').eq('guild_id', guildId).order('created_at', { ascending: false });
  if (error) fail('form list', error);
  return (data ?? []).map(formFromRow);
}

export async function countForms(guildId: string) {
  const { count, error } = await supabase.from('application_forms').select('id', { count: 'exact', head: true }).eq('guild_id', guildId);
  if (error) fail('form count', error);
  return count ?? 0;
}

export async function insertForm(values: Partial<ApplicationFormDoc> & Pick<ApplicationFormDoc, 'guildId' | 'title'>) {
  const { data, error } = await supabase.from('application_forms').insert(formRow(values)).select('*').single();
  if (error) fail('form insert', error);
  return formFromRow(data);
}

export async function patchForm(id: string, patch: Partial<ApplicationFormDoc>) {
  const { data, error } = await supabase.from('application_forms').update(formRow(patch)).eq('id', id).select('*').maybeSingle();
  if (error) fail('form update', error);
  return data ? formFromRow(data) : null;
}

export async function deleteForm(id: string) {
  const { error } = await supabase.from('application_forms').delete().eq('id', id);
  if (error) fail('form delete', error);
}

export async function getApplication(id: string) {
  if (!isUuid(id)) return null;
  const { data, error } = await supabase.from('applications').select('*').eq('id', id).maybeSingle();
  if (error) fail('application lookup', error);
  return data ? applicationFromRow(data) : null;
}

export async function insertApplication(values: Partial<ApplicationDoc> & Pick<ApplicationDoc, 'guildId' | 'formId' | 'userId' | 'source'>) {
  const { data, error } = await supabase.from('applications').insert(applicationRow(values)).select('*').single();
  if (error) fail('application insert', error);
  return applicationFromRow(data);
}

export type ApplicationGuard = { status?: string; cursor?: string; idleBefore?: Date };

/** Updates one application. The guard makes the change conditional (state machine steps, double clicks); null means the guard failed. */
export async function patchApplication(id: string, patch: Partial<ApplicationDoc>, guard: ApplicationGuard = {}) {
  let query: any = supabase.from('applications').update(applicationRow(patch)).eq('id', id);
  if (guard.status !== undefined) query = query.eq('status', guard.status);
  if (guard.cursor !== undefined) query = query.eq('cursor', guard.cursor);
  if (guard.idleBefore) query = query.lt('last_activity_at', guard.idleBefore.toISOString());
  const { data, error } = await query.select('*').maybeSingle();
  if (error) fail('application update', error);
  return data ? applicationFromRow(data) : null;
}

export async function deleteApplication(id: string) {
  const { error } = await supabase.from('applications').delete().eq('id', id);
  if (error) fail('application delete', error);
}

export async function deleteUnstartedApplication(id: string) {
  const { error } = await supabase.from('applications').delete().eq('id', id).eq('status', 'in_progress');
  if (error) fail('application delete', error);
}

type AppFilter = { formId?: string; userId?: string; guildId?: string; status?: string | readonly string[] };
function filtered(query: any, filter: AppFilter) {
  if (filter.formId) query = query.eq('form_id', filter.formId);
  if (filter.userId) query = query.eq('user_id', filter.userId);
  if (filter.guildId) query = query.eq('guild_id', filter.guildId);
  if (Array.isArray(filter.status)) query = query.in('status', filter.status);
  else if (filter.status) query = query.eq('status', filter.status);
  return query;
}

export async function countApplications(filter: AppFilter) {
  const { count, error } = await filtered(supabase.from('applications').select('id', { count: 'exact', head: true }), filter);
  if (error) fail('application count', error);
  return (count as number | null) ?? 0;
}

export async function findApplications(filter: AppFilter, options: { orderBy?: 'submitted_at' | 'reviewed_at' | 'created_at'; limit?: number } = {}) {
  let query: any = filtered(supabase.from('applications').select('*'), filter);
  if (options.orderBy) query = query.order(options.orderBy, { ascending: false, nullsFirst: false });
  if (options.limit) query = query.limit(options.limit);
  const { data, error } = await query;
  if (error) fail('application query', error);
  return ((data ?? []) as Array<Record<string, any>>).map(applicationFromRow);
}
export const findApplication = async (filter: AppFilter, options: { orderBy?: 'submitted_at' | 'reviewed_at' | 'created_at' } = {}) => (await findApplications(filter, { ...options, limit: 1 }))[0] ?? null;

/** Reads, changes and writes JSON columns (votes, notes) with a compare-and-swap on updated_at so two reviewers never overwrite each other. */
async function mutateApplication(id: string, change: (app: ApplicationDoc) => Partial<ApplicationDoc> | null) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data, error } = await supabase.from('applications').select('*').eq('id', id).maybeSingle();
    if (error) fail('application lookup', error);
    if (!data) return null;
    const patch = change(applicationFromRow(data));
    if (!patch) return null;
    const { data: saved, error: saveError } = await supabase.from('applications').update(applicationRow(patch)).eq('id', id).eq('updated_at', data.updated_at).select('*').maybeSingle();
    if (saveError) fail('application update', saveError);
    if (saved) return applicationFromRow(saved);
  }
  throw new Error('Could not save because the application was changed at the same time. Try again.');
}

export async function formCounts(guildId: string) {
  const counts: Record<string, Record<string, number>> = {};
  const rpc = await supabase.rpc('application_status_counts', { p_guild_id: guildId });
  if (!rpc.error && Array.isArray(rpc.data)) {
    for (const row of rpc.data as Array<{ form_id: string; status: string; n: number | string }>) (counts[row.form_id] ||= {})[row.status] = Number(row.n);
    return counts;
  }
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('applications').select('form_id,status').eq('guild_id', guildId).range(from, from + 999);
    if (error) fail('application counts', error);
    for (const row of data ?? []) { const bucket = (counts[row.form_id] ||= {}); bucket[row.status] = (bucket[row.status] || 0) + 1; }
    if ((data?.length ?? 0) < 1000) break;
  }
  return counts;
}

// ---- Eligibility -------------------------------------------------------------------------------

export type Eligibility = { ok: true; member: GuildMember; guild: Guild } | { ok: false; reason: string };

// `when` renders a future date for the channel the reason is shown in: a live Discord timestamp or a plain date.
export async function checkEligibility(client: Client, form: ApplicationFormDoc, userId: string, source: 'dm' | 'web'): Promise<Eligibility> {
  const s = formSettings(form);
  const lang = s.language;
  const when = (ms: number) => (source === 'dm' ? `<t:${Math.ceil(ms / 1000)}:R>` : `${lang === 'ar' ? 'بتاريخ' : 'on'} ${new Date(ms).toISOString().slice(0, 10)}`);
  const no = (reason: string): Eligibility => ({ ok: false, reason });
  if (!form.open) return no(t(lang, 'eFormClosed'));
  if (s.closesAt && new Date(s.closesAt).getTime() < Date.now()) return no(t(lang, 'eFormExpired'));
  if (source === 'dm' && s.mode === 'web') return no(t(lang, 'eWebOnly'));
  if (source === 'web' && s.mode === 'dm') return no(t(lang, 'eDmOnly'));
  if (s.maxResponses > 0 && await countApplications({ formId: form.id, status: DECIDED }) >= s.maxResponses) return no(t(lang, 'eFull'));
  const guild = await client.guilds.fetch(form.guildId).catch(() => null);
  const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
  if (!guild || !member) return no(t(lang, 'eNotMember'));
  if (member.user.bot) return no(t(lang, 'eBot'));
  const roleNames = (ids: string[]) => ids.map(id => guild.roles.cache.get(id)?.name).filter(Boolean).map(name => `@${name}`).join(', ');
  if (s.requiredRoleIds.length && !s.requiredRoleIds.some(id => member.roles.cache.has(id))) return no(t(lang, 'eRequiredRole', { roles: roleNames(s.requiredRoleIds) }));
  const blocked = s.blockedRoleIds.filter(id => member.roles.cache.has(id));
  if (blocked.length) return no(t(lang, 'eBlockedRole', { roles: roleNames(blocked) }));
  const accountReady = member.user.createdTimestamp + s.minAccountAgeDays * DAY;
  if (s.minAccountAgeDays && accountReady > Date.now()) return no(t(lang, 'eAccountAge', { days: s.minAccountAgeDays, when: when(accountReady) }));
  const memberReady = (member.joinedTimestamp || Date.now()) + s.minMemberDays * DAY;
  if (s.minMemberDays && memberReady > Date.now()) return no(t(lang, 'eMemberAge', { days: s.minMemberDays, when: when(memberReady) }));
  if (await findApplication({ formId: form.id, userId, status: 'pending' })) return no(t(lang, 'ePending'));
  if (await findApplication({ formId: form.id, userId, status: 'accepted' })) return no(t(lang, 'eAccepted'));
  if (s.cooldownDays) {
    const last = await findApplication({ formId: form.id, userId, status: 'rejected' }, { orderBy: 'reviewed_at' });
    const ready = last?.reviewedAt ? new Date(last.reviewedAt).getTime() + s.cooldownDays * DAY : 0;
    if (ready > Date.now()) return no(t(lang, 'eCooldown', { when: when(ready) }));
  }
  return { ok: true, member, guild };
}

// ---- Review message ----------------------------------------------------------------------------

function answerFields(questions: Question[], answers: Record<string, unknown>, budget: number, lang: Language) {
  const items = visibleQuestions(questions, answers);
  if (!items.length) return [];
  const per = Math.floor(budget / items.length);
  const nameMax = Math.min(256, Math.max(30, Math.floor(per * 0.35)));
  const valueMax = Math.min(1024, Math.max(30, per - nameMax));
  return items.map((question, index) => ({ name: clip(`${index + 1}. ${question.label}`, nameMax), value: clip(formatAnswer(question, answers[question.id], lang), valueMax) || '—' }));
}

export function transcript(app: ApplicationDoc) {
  const lang = app.meta?.lang || 'ar';
  const lines = [`${app.formTitle}`, `Applicant: ${app.displayName || app.username} (@${app.username}) — ${app.userId}`, `Source: ${app.source === 'web' ? 'Website' : 'Discord DM'}`, `Submitted: ${app.submittedAt ? new Date(app.submittedAt).toISOString() : '-'}`, `Application: #${shortId(app.id)}`, ''];
  visibleQuestions(app.questions, app.answers).forEach((question, index) => lines.push(`${index + 1}. ${question.label}`, formatAnswer(question, app.answers[question.id], lang), ''));
  return lines.join('\n');
}

export function buildReviewPayload(app: ApplicationDoc, form: ApplicationFormDoc | null) {
  const s = formSettings(form);
  const lang = app.meta?.lang || s.language;
  const up = app.votes.filter(vote => vote.value === 'up').length;
  const down = app.votes.filter(vote => vote.value === 'down').length;
  const color = app.status === 'accepted' ? COLORS.accepted : app.status === 'rejected' ? COLORS.rejected : colorOf(s);
  const header = [
    `**Applicant:** <@${app.userId}> · \`${app.userId}\``,
    app.accountCreatedAt ? `**Account created:** <t:${Math.floor(new Date(app.accountCreatedAt).getTime() / 1000)}:R>` : '',
    app.memberJoinedAt ? `**Joined server:** <t:${Math.floor(new Date(app.memberJoinedAt).getTime() / 1000)}:R>` : '',
    `**Source:** ${app.source === 'web' ? '🌐 Website' : '💬 Discord DM'}`,
    app.submittedAt ? `**Submitted:** <t:${Math.floor(new Date(app.submittedAt).getTime() / 1000)}:f>` : '',
  ].filter(Boolean).join('\n');
  const decision = app.status === 'accepted' || app.status === 'rejected'
    ? { name: app.status === 'accepted' ? '✅ Accepted' : '❌ Rejected', value: clip(`By <@${app.reviewedBy}>${app.reviewedAt ? ` · <t:${Math.floor(new Date(app.reviewedAt).getTime() / 1000)}:R>` : ''}${app.decisionReason ? `\n> ${app.decisionReason}` : ''}`, 1024) }
    : null;
  const fields = answerFields(app.questions, app.answers, 5000 - header.length - (decision?.value.length || 0), lang);
  if (decision) fields.unshift(decision);
  const embeds: EmbedBuilder[] = [];
  for (let index = 0; index < Math.max(1, fields.length); index += 25) {
    const embed = new EmbedBuilder().setColor(color).addFields(fields.slice(index, index + 25));
    if (index === 0) embed.setAuthor({ name: clip(`${app.displayName || app.username} (@${app.username})`, 256), iconURL: app.avatar || undefined }).setTitle(clip(`📝 ${app.formTitle}`, 256)).setDescription(header);
    embeds.push(embed);
  }
  embeds.at(-1)!.setFooter({ text: `Application #${shortId(app.id)} · 👍 ${up} · 👎 ${down}` }).setTimestamp(app.submittedAt ? new Date(app.submittedAt) : new Date());
  const link = new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open in dashboard').setURL(reviewUrl(app.id));
  const components = app.status === 'pending'
    ? [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`app_accept:${app.id}`).setLabel('Accept').setEmoji('✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`app_reject:${app.id}`).setLabel('Reject').setEmoji('✖️').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`app_vote:${app.id}:up`).setLabel(String(up)).setEmoji('👍').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`app_vote:${app.id}:down`).setLabel(String(down)).setEmoji('👎').setStyle(ButtonStyle.Secondary),
        link,
      ),
    ]
    : [new ActionRowBuilder<ButtonBuilder>().addComponents(link)];
  return { embeds, components };
}

export async function refreshReviewMessage(client: Client, app: ApplicationDoc) {
  if (!app.reviewChannelId || !app.reviewMessageId) return false;
  const form = await getForm(app.formId);
  const channel: any = await client.channels.fetch(app.reviewChannelId).catch(() => null);
  const message = channel?.messages ? await channel.messages.fetch(app.reviewMessageId).catch(() => null) : null;
  if (!message) return false;
  return message.edit(buildReviewPayload(app, form)).then(() => true).catch(() => false);
}

// ---- Submit ------------------------------------------------------------------------------------

// Posts a pending application to the review channel. Safe to call from the bot or the dashboard process.
export async function announceApplication(client: Client, app: ApplicationDoc, form: ApplicationFormDoc) {
  const s = formSettings(form);
  const guildSettings = await getSettings(app.guildId).catch(() => null);
  const channelId = s.reviewChannelId || guildSettings?.logsChannelId || '';
  const channel: any = channelId ? await client.channels.fetch(channelId).catch(() => null) : null;
  if (!channel?.isTextBased?.() || !('send' in channel) || channel.guildId !== app.guildId) return null;
  const payload = buildReviewPayload(app, form);
  const file = new AttachmentBuilder(Buffer.from(transcript(app), 'utf8'), { name: `application-${shortId(app.id)}.txt` });
  const message = await channel.send({
    content: s.pingRoleId ? `<@&${s.pingRoleId}> New application from <@${app.userId}>` : `New application from <@${app.userId}>`,
    allowedMentions: { roles: s.pingRoleId ? [s.pingRoleId] : [], users: [] },
    ...payload, files: [file],
  }).catch((error: unknown) => { console.error('Could not post application for review:', error); return null; });
  if (!message) return null;
  let threadId = '';
  if (s.reviewThread && typeof message.startThread === 'function') {
    const thread = await message.startThread({ name: clip(`${app.displayName || app.username} · ${app.formTitle}`, 100), autoArchiveDuration: 10080 }).catch(() => null);
    threadId = thread?.id || '';
  }
  await patchApplication(app.id, { reviewChannelId: channel.id, reviewMessageId: message.id, reviewThreadId: threadId });
  return message;
}

// Creates a pending web application. DM applications are promoted from `in_progress` by the DM flow instead.
export async function createWebApplication(client: Client, form: ApplicationFormDoc, member: GuildMember, answers: Record<string, unknown>) {
  const s = formSettings(form);
  const app = await insertApplication({
    guildId: form.guildId, formId: form.id, formTitle: form.title, userId: member.id, username: member.user.username, displayName: member.displayName,
    avatar: member.user.displayAvatarURL({ extension: 'png', size: 128 }), source: 'web', status: 'pending', questions: form.questions, answers,
    submittedAt: new Date(), lastActivityAt: new Date(), accountCreatedAt: member.user.createdAt, memberJoinedAt: member.joinedAt,
    meta: { lang: s.language, color: s.color, guildName: member.guild.name },
  });
  await createLog(form.guildId, 'APPLICATION_SUBMITTED', member.id, member.id, { applicationId: app.id, formId: form.id, source: 'web' }).catch(() => undefined);
  await announceApplication(client, app, form);
  const custom = s.confirmationMessage ? fill(s.confirmationMessage, { user: `<@${member.id}>`, server: member.guild.name, form: form.title }) : '';
  await member.send({ embeds: [receivedEmbed({ lang: s.language, formTitle: form.title, reference: shortId(app.id), guildName: member.guild.name, guildIcon: member.guild.iconURL(), userMention: `<@${member.id}>`, color: colorOf(s), custom }, app.submittedAt ? new Date(app.submittedAt) : new Date())] }).catch(() => undefined);
  return app;
}

// ---- Decisions ---------------------------------------------------------------------------------

// Who may VOTE (like or dislike) on an application: owners, administrators, the management role and the form's voter
// roles. Voting never decides anything. Accepting or rejecting is `canDecide`.
export async function canReview(member: GuildMember, form: ApplicationFormDoc | null) {
  if (member.guild.ownerId === member.id || member.permissions.has('Administrator')) return true;
  const settings = await getSettings(member.guild.id).catch(() => null);
  if (settings?.managementRoleId && member.roles.cache.has(settings.managementRoleId)) return true;
  return formSettings(form).reviewerRoleIds.some(id => member.roles.cache.has(id));
}

/** Only the server owner and Administrators accept or reject. */
export const canDecide = (member: GuildMember) => isAdministrator(member) || member.guild.ownerId === member.id;

const DANGEROUS = [
  PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageWebhooks, PermissionFlagsBits.BanMembers, PermissionFlagsBits.KickMembers, PermissionFlagsBits.MentionEveryone,
  PermissionFlagsBits.ModerateMembers, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ManageNicknames,
];
/** Roles an application must never hand out. The configured Staff role is the one exception (unless it is an Administrator role). */
const isDangerousRole = (role: Role, staffRoleId?: string | null) =>
  role.managed || role.id === role.guild.id || (role.id === staffRoleId ? role.permissions.has(PermissionFlagsBits.Administrator) : DANGEROUS.some(flag => role.permissions.has(flag)));

async function assertAdministrator(client: Client, guildId: string, userId: string) {
  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
  if (!member || !canDecide(member)) throw new Error('Only the server owner and Administrators can accept or reject applications.');
}

export async function decideApplication(client: Client, id: string, decision: 'accepted' | 'rejected', reviewer: { id: string; name?: string }, reason = '') {
  // The second lock: checked here, before anything changes, whichever button or route called this.
  const existing = await getApplication(id);
  if (!existing) throw new Error('Application not found.');
  await assertAdministrator(client, existing.guildId, reviewer.id);
  const cleanReason = String(reason || '').trim().slice(0, 1000);
  // The status guard makes the decision atomic: two reviewers clicking at once cannot both win.
  const app = await patchApplication(id, { status: decision, reviewedBy: reviewer.id, reviewedAt: new Date(), decisionReason: cleanReason }, { status: 'pending' });
  if (!app) throw new Error('This application was already reviewed.');
  const form = await getForm(app.formId);
  const s = formSettings(form);
  const lang = app.meta?.lang || s.language;
  const warnings: string[] = [];
  const grantedRoleIds: string[] = [];
  const guild = await client.guilds.fetch(app.guildId).catch(() => null);
  const member = guild ? await guild.members.fetch(app.userId).catch(() => null) : null;
  if (!member) warnings.push('The applicant is no longer in the server, so roles were not changed.');
  if (decision === 'accepted' && member && guild) {
    const guildSettings = await getSettings(guild.id).catch(() => null);
    const staffRoleId = guildSettings?.staffRoleId || null;
    const add = [...new Set([...s.acceptRoleIds, ...(s.addAsStaff && staffRoleId ? [staffRoleId] : [])])];
    for (const roleId of add) {
      const role = guild.roles.cache.get(roleId);
      if (role && isDangerousRole(role, staffRoleId)) { warnings.push(`@${role.name} has admin or moderator permissions, so it is never given by an application.`); continue; }
      await member.roles.add(roleId, `Application #${shortId(app.id)} accepted`).then(() => { grantedRoleIds.push(roleId); }, () => warnings.push(`Could not add @${role?.name || roleId}. Move the bot role above it.`));
    }
    for (const roleId of s.removeRoleIds) if (member.roles.cache.has(roleId)) await member.roles.remove(roleId, `Application #${shortId(app.id)} accepted`).catch(() => warnings.push(`Could not remove @${guild.roles.cache.get(roleId)?.name || roleId}.`));
    if (s.addAsStaff) await ensureStaff(guild.id, member.id).catch(error => warnings.push(`Staff profile was not created: ${error instanceof Error ? error.message : error}`));
  }
  const vars = { user: `<@${app.userId}>`, server: guild?.name || app.meta?.guildName || '', form: app.formTitle };
  let dmSent = false;
  if (member) {
    const custom = decision === 'accepted' ? s.acceptMessage : s.rejectMessage;
    const input = { lang, formTitle: app.formTitle, reference: shortId(app.id), guildName: vars.server, guildIcon: guild?.iconURL() || null, userMention: vars.user, custom: custom ? fill(custom, vars) : '' };
    const embed = decision === 'accepted'
      ? acceptedEmbed(input, { roleIds: grantedRoleIds.slice(0, 10) })
      : rejectedEmbed(input, { reason: cleanReason && s.shareRejectReason ? cleanReason : '', retryAt: s.cooldownDays ? new Date(Date.now() + s.cooldownDays * DAY) : null });
    dmSent = await member.send({ embeds: [embed] }).then(() => true).catch(() => false);
    if (!dmSent) warnings.push('The applicant has DMs closed, so they were not notified.');
  }
  await refreshReviewMessage(client, app);
  if (app.reviewThreadId) {
    const thread: any = await client.channels.fetch(app.reviewThreadId).catch(() => null);
    if (thread?.send) {
      await thread.send({ content: `${decision === 'accepted' ? '✅ Accepted' : '❌ Rejected'} by <@${reviewer.id}>${cleanReason ? `: ${clip(cleanReason, 1500)}` : ''}`, allowedMentions: { parse: [] } }).catch(() => undefined);
      await thread.setArchived?.(true).catch(() => undefined);
    }
  }
  await createLog(app.guildId, decision === 'accepted' ? 'APPLICATION_ACCEPTED' : 'APPLICATION_REJECTED', app.userId, reviewer.id, { applicationId: app.id, formId: app.formId, reason: cleanReason }).catch(() => undefined);
  return { application: app, warnings, dmSent };
}

export async function toggleVote(id: string, userId: string, value: 'up' | 'down') {
  const updated = await mutateApplication(id, app => {
    if (app.status !== 'pending') return null;
    const existing = app.votes.find(vote => vote.userId === userId);
    const votes = app.votes.filter(vote => vote.userId !== userId);
    if (existing?.value !== value) votes.push({ userId, value });
    return { votes };
  });
  if (!updated) throw new Error('Voting is closed for this application.');
  return updated;
}

export async function addNote(id: string, note: { text: string; userId: string; name: string }) {
  const updated = await mutateApplication(id, app => ({ notes: [...app.notes, { ...note, createdAt: new Date() }] }));
  if (!updated) throw new Error('Application not found.');
  return updated;
}
