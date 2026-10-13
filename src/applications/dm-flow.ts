import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
  type ButtonInteraction, type Client, type Message, type ModalSubmitInteraction, type StringSelectMenuInteraction,
} from 'discord.js';
import { answerable, formatAnswer, isVisible, LIMITS, validateAnswer, validateSubmission, visibleQuestions, type Language, type Question } from './questions.js';
import { t } from './i18n.js';
import { receivedEmbed } from './messages.js';
import {
  announceApplication, applyUrl, buildReviewPayload, canDecide, canReview, checkEligibility, colorOf, decideApplication, deleteUnstartedApplication, findApplication, findApplications,
  formSettings, getApplication, getForm, insertApplication, patchApplication, shortId, toggleVote,
} from '../services/application.service.js';
import { createLog } from '../services/log.service.js';
import type { ApplicationDoc, ApplicationFormDoc } from '../models/Application.js';

type AnyInteraction = ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction;
const REVIEW = '__review';
const TEXT_TYPES = new Set(['short', 'paragraph', 'number', 'url', 'date']);
const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value);
const langOf = (app: ApplicationDoc): Language => app.meta?.lang || 'en';
const colorNum = (app: ApplicationDoc) => parseInt(String(app.meta?.color || '#8175f5').replace('#', ''), 16) || 0x8175f5;
const bar = (done: number, total: number) => { const size = 12; const filled = Math.round((done / Math.max(1, total)) * size); return `${'▰'.repeat(filled)}${'▱'.repeat(size - filled)}`; };
const ephemeral = { flags: 64 as const };
const log = (guildId: string, action: string, userId: string, actorId: string | null, details: Record<string, unknown>) => createLog(guildId, action, userId, actorId, details).catch(() => undefined);

// ---- Rendering ---------------------------------------------------------------------------------

function sectionOf(app: ApplicationDoc, question: Question) {
  const index = app.questions.findIndex(item => item.id === question.id);
  return app.questions.slice(0, index).reverse().find(item => item.type === 'section') || null;
}

function promptPayload(app: ApplicationDoc, question: Question, state: { answered?: unknown; note?: string } = {}) {
  const lang = langOf(app);
  const visible = visibleQuestions(app.questions, app.answers);
  const position = Math.max(1, visible.findIndex(item => item.id === question.id) + 1);
  const total = Math.max(position, visible.length);
  const section = sectionOf(app, question);
  const hint = TEXT_TYPES.has(question.type) ? t(lang, 'typeHint') : question.type === 'checkbox' ? t(lang, 'pickManyHint') : question.type === 'yesno' || question.type === 'scale' ? t(lang, 'buttonHint') : t(lang, 'pickHint');
  const limits: string[] = [];
  if ((question.type === 'short' || question.type === 'paragraph') && question.min) limits.push(lang === 'ar' ? `الحد الأدنى ${question.min} حرف` : `min ${question.min} characters`);
  if (question.type === 'number' && (question.min !== null || question.max !== null)) limits.push(`${question.min ?? '−∞'} – ${question.max ?? '∞'}`);
  if (question.type === 'date') limits.push('YYYY-MM-DD');
  if (question.type === 'scale') limits.push(`${question.min ?? 1}${question.minLabel ? ` (${question.minLabel})` : ''} → ${question.max ?? 5}${question.maxLabel ? ` (${question.maxLabel})` : ''}`);
  const done = state.answered !== undefined;
  const description = [
    `**${question.label}**${question.required ? ' *' : ''}`,
    question.description ? `> ${question.description.split('\n').join('\n> ')}` : '',
    limits.length ? `-# ${limits.join(' · ')}` : '',
    '',
    done ? '' : hint,
    state.note ? `\n⚠️ ${state.note}` : '',
  ].filter((line, index, lines) => line || (index > 0 && lines[index - 1])).join('\n');
  const embed = new EmbedBuilder()
    .setColor(done ? 0x4fc08d : colorNum(app))
    .setTitle(t(lang, 'question', { n: position, total }))
    .setDescription(clip(description, 4000))
    .setFooter({ text: clip(`${bar(position - 1, total)}  ${app.formTitle} · ${question.required ? t(lang, 'required') : t(lang, 'optional')}`, 2048) });
  if (section) embed.setAuthor({ name: clip(`📂 ${section.label}`, 256) });
  if (done) embed.addFields({ name: t(lang, 'answered'), value: clip(formatAnswer(question, state.answered, lang), 1024) });
  else if (app.answers[question.id] !== undefined) embed.addFields({ name: lang === 'ar' ? 'إجابتك الحالية' : 'Current answer', value: clip(formatAnswer(question, app.answers[question.id], lang), 1024) });
  if (done) return { embeds: [embed], components: [] };

  const id = app.id;
  const rows: ActionRowBuilder<any>[] = [];
  if (question.type === 'choice' || question.type === 'dropdown' || question.type === 'checkbox') {
    const current = app.answers[question.id];
    const chosen = new Set(Array.isArray(current) ? current.map(String) : current !== undefined ? [String(current)] : []);
    const menu = new StringSelectMenuBuilder().setCustomId(`app_pick:${id}:${question.id}`).setPlaceholder(t(lang, 'choosePlaceholder'))
      .addOptions(question.options.slice(0, 25).map((option, index) => ({ label: clip(option, 100), value: String(index), default: chosen.has(option) })));
    if (question.type === 'checkbox') {
      const count = Math.min(25, question.options.length);
      menu.setMinValues(Math.min(count, Math.max(1, question.min || 1))).setMaxValues(Math.max(1, Math.min(count, question.max || count)));
    }
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu));
  }
  if (question.type === 'yesno') rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`app_yn:${id}:${question.id}:yes`).setLabel(t(lang, 'yes')).setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`app_yn:${id}:${question.id}:no`).setLabel(t(lang, 'no')).setEmoji('✖️').setStyle(ButtonStyle.Danger),
  ));
  if (question.type === 'scale') {
    const min = question.min ?? 1; const max = question.max ?? 5;
    const values = Array.from({ length: max - min + 1 }, (_, index) => min + index);
    for (let index = 0; index < values.length; index += 5) rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(values.slice(index, index + 5).map(value =>
      new ButtonBuilder().setCustomId(`app_sc:${id}:${question.id}:${value}`).setLabel(String(value)).setStyle(app.answers[question.id] === value ? ButtonStyle.Primary : ButtonStyle.Secondary))));
  }
  const nav = new ActionRowBuilder<ButtonBuilder>();
  if (TEXT_TYPES.has(question.type)) nav.addComponents(new ButtonBuilder().setCustomId(`app_ans:${id}:${question.id}`).setLabel(t(lang, 'answer')).setEmoji('✏️').setStyle(ButtonStyle.Primary));
  if (app.answers[question.id] !== undefined) nav.addComponents(new ButtonBuilder().setCustomId(`app_keep:${id}:${question.id}`).setLabel(lang === 'ar' ? 'إبقاء الإجابة' : 'Keep answer').setEmoji('↪️').setStyle(ButtonStyle.Success));
  else if (!question.required) nav.addComponents(new ButtonBuilder().setCustomId(`app_skip:${id}:${question.id}`).setLabel(t(lang, 'skip')).setEmoji('⏭️').setStyle(ButtonStyle.Secondary));
  nav.addComponents(
    new ButtonBuilder().setCustomId(`app_back:${id}:${question.id}`).setLabel(t(lang, 'back')).setEmoji('⬅️').setStyle(ButtonStyle.Secondary).setDisabled(position <= 1),
    new ButtonBuilder().setCustomId(`app_cancel:${id}`).setLabel(t(lang, 'cancel')).setStyle(ButtonStyle.Danger),
  );
  rows.push(nav);
  return { embeds: [embed], components: rows };
}

function reviewPayload(app: ApplicationDoc, note = '') {
  const lang = langOf(app);
  const visible = visibleQuestions(app.questions, app.answers);
  const per = Math.floor(4800 / Math.max(1, visible.length));
  const nameMax = Math.min(256, Math.max(30, Math.floor(per * 0.35)));
  const valueMax = Math.min(1024, Math.max(30, per - nameMax));
  const fields = visible.map((question, index) => ({ name: clip(`${index + 1}. ${question.label}`, nameMax), value: clip(formatAnswer(question, app.answers[question.id], lang), valueMax) || '—' }));
  const embeds: EmbedBuilder[] = [];
  for (let index = 0; index < Math.max(1, fields.length); index += 25) {
    const embed = new EmbedBuilder().setColor(colorNum(app)).addFields(fields.slice(index, index + 25));
    if (index === 0) embed.setTitle(t(lang, 'review')).setDescription(`${t(lang, 'reviewHint')}${note ? `\n\n⚠️ ${note}` : ''}`);
    embeds.push(embed);
  }
  embeds.at(-1)!.setFooter({ text: clip(`${bar(1, 1)}  ${app.formTitle}`, 2048) });
  const menu = new StringSelectMenuBuilder().setCustomId(`app_edit:${app.id}`).setPlaceholder(t(lang, 'editAnswer'))
    .addOptions(visible.slice(0, 25).map((question, index) => ({ label: clip(`${index + 1}. ${question.label}`, 100), value: question.id, emoji: '✏️' })));
  return {
    embeds,
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`app_submit:${app.id}`).setLabel(t(lang, 'submit')).setEmoji('📨').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`app_back:${app.id}:${REVIEW}`).setLabel(t(lang, 'back')).setEmoji('⬅️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`app_cancel:${app.id}`).setLabel(t(lang, 'cancel')).setStyle(ButtonStyle.Danger),
      ),
    ],
  };
}

function introPayload(app: ApplicationDoc, form: ApplicationFormDoc, guildName: string) {
  const s = formSettings(form);
  const lang = s.language;
  const embed = new EmbedBuilder().setColor(colorOf(s)).setTitle(clip(`📝 ${form.title}`, 256))
    .setDescription(clip([t(lang, 'intro', { form: form.title, server: guildName }), form.description ? `\n${form.description}` : '', `\n${t(lang, 'introHow')}`, `\n${t(lang, 'introTimeout', { minutes: s.dmTimeoutMinutes })}`].join('\n'), 4000))
    .addFields({ name: t(lang, 'panelQuestions'), value: String(visibleQuestions(app.questions, {}).length), inline: true })
    .setFooter({ text: `Rift · #${shortId(app.id)}` });
  if (s.bannerUrl) embed.setImage(s.bannerUrl);
  return {
    embeds: [embed],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`app_start:${app.id}`).setLabel(t(lang, 'start')).setEmoji('🚀').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`app_cancel:${app.id}`).setLabel(t(lang, 'cancel')).setStyle(ButtonStyle.Secondary),
    )],
  };
}

// ---- State changes -----------------------------------------------------------------------------

const questionOf = (app: ApplicationDoc, id: string) => app.questions.find(item => item.id === id && item.type !== 'section') || null;

async function dmOf(client: Client, app: ApplicationDoc) {
  const user = await client.users.fetch(app.userId);
  return user.createDM();
}

// Sends whatever the applicant should see next and remembers it as the live prompt.
async function sendStep(client: Client, app: ApplicationDoc, note = '') {
  const dm = await dmOf(client, app);
  const question = app.cursor && app.cursor !== REVIEW ? questionOf(app, app.cursor) : null;
  const payload = question ? promptPayload(app, question, { note }) : reviewPayload(app, note);
  const message = await dm.send(payload);
  await patchApplication(app.id, { promptMessageId: message.id, dmChannelId: dm.id });
  return message;
}

async function closePrompt(client: Client, app: ApplicationDoc) {
  if (!app.promptMessageId) return;
  const dm = await dmOf(client, app).catch(() => null);
  const message = await dm?.messages.fetch(app.promptMessageId).catch(() => null);
  await message?.edit({ components: [] }).catch(() => undefined);
}

// Stores an answer (null clears it) and moves the cursor. The cursor guard makes stale or double clicks no-ops.
async function recordAnswer(app: ApplicationDoc, question: Question, value: unknown) {
  const answers: Record<string, unknown> = { ...app.answers };
  if (value === null || value === undefined) delete answers[question.id]; else answers[question.id] = value;
  for (const item of answerable(app.questions)) if (!isVisible(item, answers)) delete answers[item.id];
  const visible = visibleQuestions(app.questions, answers);
  let next: Question | undefined;
  if (app.editing) next = visible.find(item => item.required && answers[item.id] === undefined);
  else next = visible[visible.findIndex(item => item.id === question.id) + 1];
  return patchApplication(app.id, { answers, cursor: next ? next.id : REVIEW, editing: next ? app.editing : false, lastActivityAt: new Date() }, { status: 'in_progress', cursor: question.id });
}

async function loadOwn(i: AnyInteraction, id: string) {
  const app = await getApplication(id);
  if (!app || app.userId !== i.user.id || app.status !== 'in_progress') {
    await i.reply({ content: t(app ? langOf(app) : 'en', 'notActive'), ...ephemeral }).catch(() => undefined);
    return null;
  }
  return app;
}

async function stale(i: AnyInteraction, app: ApplicationDoc) {
  await i.reply({ content: langOf(app) === 'ar' ? 'هذه الرسالة قديمة، استخدم آخر رسالة في المحادثة 👇' : 'This message is outdated, use the latest one below 👇', ...ephemeral }).catch(() => undefined);
}

async function answerFromComponent(i: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction, app: ApplicationDoc, question: Question, value: unknown) {
  const updated = await recordAnswer(app, question, value);
  if (!updated) return stale(i, app);
  const closed = promptPayload(app, question, { answered: value });
  if (i.isModalSubmit()) { if (i.isFromMessage()) await i.update(closed); else await i.deferUpdate(); }
  else await i.update(closed);
  await sendStep(i.client, updated);
}

// ---- Entry points ------------------------------------------------------------------------------

async function startFromPanel(i: ButtonInteraction, formId: string) {
  await i.deferReply(ephemeral);
  const form = await getForm(formId);
  if (!form || form.guildId !== i.guildId) return i.editReply({ content: t('en', 'notActive') });
  const s = formSettings(form);
  const lang = s.language;
  const dmLink = (channelId: string) => new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(t(lang, 'openDm')).setURL(`https://discord.com/channels/@me/${channelId}`));
  const existing = await findApplication({ userId: i.user.id, status: 'in_progress' });
  if (existing && existing.formId !== form.id) {
    return i.editReply({ content: t(lang, 'alreadyInProgress'), components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`app_cancel:${existing.id}`).setLabel(t(lang, 'cancelOther')).setStyle(ButtonStyle.Danger))] });
  }
  if (existing) {
    const message = existing.cursor ? await sendStep(i.client, existing).catch(() => null) : await (await dmOf(i.client, existing)).send(introPayload(existing, form, i.guild?.name || '')).catch(() => null);
    if (message && !existing.cursor) await patchApplication(existing.id, { promptMessageId: message.id });
    return message ? i.editReply({ content: t(lang, 'checkDm'), components: [dmLink(message.channelId)] }) : i.editReply({ content: t(lang, 'dmClosed') });
  }
  const eligibility = await checkEligibility(i.client, form, i.user.id, 'dm');
  if (!eligibility.ok) return i.editReply({ content: `❌ ${eligibility.reason}` });
  const member = eligibility.member;
  let app: ApplicationDoc;
  try {
    app = await insertApplication({
      guildId: form.guildId, formId: form.id, formTitle: form.title, userId: member.id, username: member.user.username, displayName: member.displayName,
      avatar: member.user.displayAvatarURL({ extension: 'png', size: 128 }), source: 'dm', status: 'in_progress', questions: form.questions, answers: {},
      cursor: '', lastActivityAt: new Date(), timeoutMinutes: s.dmTimeoutMinutes, accountCreatedAt: member.user.createdAt, memberJoinedAt: member.joinedAt,
      meta: { lang, color: s.color, guildName: member.guild.name },
    });
  } catch {
    return i.editReply({ content: t(lang, 'alreadyInProgress') });
  }
  const message = await member.send(introPayload(app, form, member.guild.name)).catch(() => null);
  if (!message) {
    await deleteUnstartedApplication(app.id);
    const web = s.mode === 'both' ? [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(t(lang, 'applyWeb')).setEmoji('🌐').setURL(applyUrl(form.id)))] : [];
    return i.editReply({ content: `${t(lang, 'dmClosed')}${web.length ? `\n${t(lang, 'dmClosedWeb')}` : ''}`, components: web });
  }
  await patchApplication(app.id, { promptMessageId: message.id, dmChannelId: message.channelId });
  await log(form.guildId, 'APPLICATION_STARTED', member.id, member.id, { applicationId: app.id, formId: form.id });
  return i.editReply({ content: t(lang, 'checkDm'), components: [dmLink(message.channelId)] });
}

async function submit(i: ButtonInteraction, app: ApplicationDoc) {
  const lang = langOf(app);
  const form = await getForm(app.formId);
  if (!form) {
    await patchApplication(app.id, { status: 'cancelled' }, { status: 'in_progress' });
    return i.update({ content: t(lang, 'notActive'), embeds: [], components: [] });
  }
  const result = validateSubmission(app.questions, app.answers, lang);
  if (!result.ok) {
    const first = visibleQuestions(app.questions, result.answers).find(question => result.errors[question.id]);
    if (!first) return i.reply({ content: t(lang, 'notActive'), ...ephemeral });
    const moved = await patchApplication(app.id, { cursor: first.id, editing: true, answers: result.answers, lastActivityAt: new Date() }, { status: 'in_progress', cursor: REVIEW });
    if (!moved) return stale(i, app);
    await i.update({ components: [] });
    return sendStep(i.client, moved, result.errors[first.id]);
  }
  let submitted: ApplicationDoc | null = null;
  try {
    submitted = await patchApplication(app.id, { status: 'pending', answers: result.answers, submittedAt: new Date(), cursor: '', lastActivityAt: new Date() }, { status: 'in_progress', cursor: REVIEW });
  } catch {
    // The unique index on (form, user) where pending: they already have one waiting.
    await patchApplication(app.id, { status: 'cancelled' }, { status: 'in_progress' }).catch(() => undefined);
    return i.update({ content: t(lang, 'ePending'), embeds: [], components: [] });
  }
  if (!submitted) return stale(i, app);
  const s = formSettings(form);
  const guild = i.client.guilds.cache.get(app.guildId);
  const guildName = guild?.name || app.meta?.guildName || '';
  const custom = s.confirmationMessage.replace(/\{(\w+)\}/g, (match, name) => ({ user: `<@${app.userId}>`, server: guildName, form: app.formTitle } as Record<string, string>)[name] ?? match);
  const done = receivedEmbed({ lang, formTitle: app.formTitle, reference: shortId(app.id), guildName, guildIcon: guild?.iconURL() || null, userMention: `<@${app.userId}>`, color: colorOf(s), custom }, submitted.submittedAt ? new Date(submitted.submittedAt) : new Date());
  await i.update({ embeds: [done], components: [] });
  await log(app.guildId, 'APPLICATION_SUBMITTED', app.userId, app.userId, { applicationId: app.id, formId: app.formId, source: 'dm' });
  await announceApplication(i.client, submitted, form);
}

const adminOnly = (i: ButtonInteraction | ModalSubmitInteraction) => i.reply({ content: '⛔ Only the server owner and Administrators can accept or reject applications.', ...ephemeral });

// Management actions on the review message in the server.
async function reviewerAction(i: ButtonInteraction, action: string, id: string, extra: string) {
  if (!i.inCachedGuild()) return i.reply({ content: 'Server only.', ...ephemeral });
  const app = await getApplication(id);
  if (!app || app.guildId !== i.guildId) return i.reply({ content: 'Application not found.', ...ephemeral });
  const form = await getForm(app.formId);
  // Voting (like or dislike) is open to reviewers. Accepting or rejecting is for administrators only.
  if (action === 'app_vote') { if (!await canReview(i.member, form)) return i.reply({ content: '⛔ You are not allowed to vote on applications.', ...ephemeral }); }
  else if (!canDecide(i.member)) return adminOnly(i);
  if (app.status !== 'pending') return i.reply({ content: `This application was already ${app.status}.`, ...ephemeral });
  if (action === 'app_vote') {
    const updated = await toggleVote(id, i.user.id, extra === 'down' ? 'down' : 'up').catch(() => null);
    if (!updated) return i.reply({ content: 'Voting is closed.', ...ephemeral });
    return i.update(buildReviewPayload(updated, form));
  }
  const decision = action === 'app_accept' ? 'accepted' : 'rejected';
  const modal = new ModalBuilder().setCustomId(`app_decide:${id}:${decision}`).setTitle(decision === 'accepted' ? 'Accept application' : 'Reject application');
  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('reason').setLabel(decision === 'accepted' ? 'Internal note (optional)' : 'Reason (sent to the applicant)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000)));
  return i.showModal(modal);
}

export async function handleApplicationButton(i: ButtonInteraction) {
  const [action = '', id = '', extra = '', value = ''] = i.customId.split(':');
  if (action === 'app_apply') return startFromPanel(i, id);
  if (action === 'app_accept' || action === 'app_reject' || action === 'app_vote') return reviewerAction(i, action, id, extra);
  if (action === 'app_cancel') {
    const app = await loadOwn(i, id); if (!app) return;
    const lang = langOf(app);
    return i.reply({ content: lang === 'ar' ? 'هل أنت متأكد من إلغاء التقديم؟ ستفقد إجاباتك.' : 'Cancel this application? Your answers will be lost.', components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`app_cancelok:${id}`).setLabel(lang === 'ar' ? 'نعم، إلغاء' : 'Yes, cancel').setStyle(ButtonStyle.Danger),
    )], ...ephemeral });
  }
  const app = await loadOwn(i, id); if (!app) return;
  const lang = langOf(app);
  if (action === 'app_cancelok') {
    const cancelled = await patchApplication(id, { status: 'cancelled', lastActivityAt: new Date() }, { status: 'in_progress' });
    await i.update({ content: t(lang, 'cancelled'), components: [] });
    if (cancelled) { await closePrompt(i.client, app); await log(app.guildId, 'APPLICATION_CANCELLED', app.userId, app.userId, { applicationId: app.id }); }
    return;
  }
  if (action === 'app_start') {
    if (app.cursor) return stale(i, app);
    const first = visibleQuestions(app.questions, app.answers)[0];
    if (!first) return i.reply({ content: t(lang, 'notActive'), ...ephemeral });
    const started = await patchApplication(id, { cursor: first.id, lastActivityAt: new Date() }, { status: 'in_progress', cursor: '' });
    if (!started) return stale(i, app);
    await i.update({ components: [] });
    return sendStep(i.client, started);
  }
  if (action === 'app_submit') { if (app.cursor !== REVIEW) return stale(i, app); return submit(i, app); }
  if (extra !== app.cursor) return stale(i, app);
  if (action === 'app_back') {
    const visible = visibleQuestions(app.questions, app.answers);
    const index = extra === REVIEW ? visible.length : visible.findIndex(item => item.id === extra);
    const previous = visible[index - 1];
    if (!previous) return stale(i, app);
    const moved = await patchApplication(id, { cursor: previous.id, editing: false, lastActivityAt: new Date() }, { status: 'in_progress', cursor: extra });
    if (!moved) return stale(i, app);
    await i.update({ components: [] });
    return sendStep(i.client, moved);
  }
  const question = questionOf(app, extra);
  if (!question) return stale(i, app);
  if (action === 'app_ans') {
    const modal = new ModalBuilder().setCustomId(`app_modal:${id}:${question.id}`).setTitle(clip(`${t(lang, 'answer')} · ${app.formTitle}`, 45));
    const input = new TextInputBuilder().setCustomId('value').setLabel(clip(question.label, 45)).setRequired(question.required)
      .setStyle(question.type === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short);
    const cap = question.type === 'paragraph' ? LIMITS.paragraph : question.type === 'short' ? LIMITS.short : 100;
    const max = Math.min(cap, question.max && (question.type === 'short' || question.type === 'paragraph') ? question.max : cap);
    input.setMaxLength(max);
    if ((question.type === 'short' || question.type === 'paragraph') && question.min) input.setMinLength(Math.min(question.min, max));
    const placeholder = question.placeholder || (question.type === 'date' ? 'YYYY-MM-DD' : question.type === 'url' ? 'https://' : '');
    if (placeholder) input.setPlaceholder(clip(placeholder, 100));
    const current = app.answers[question.id];
    if (current !== undefined && String(current).length <= max) input.setValue(String(current));
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
    return i.showModal(modal);
  }
  if (action === 'app_skip') { if (question.required) return stale(i, app); return answerFromComponent(i, app, question, null); }
  if (action === 'app_keep') { if (app.answers[question.id] === undefined) return stale(i, app); return answerFromComponent(i, app, question, app.answers[question.id]); }
  if (action === 'app_yn' || action === 'app_sc') {
    const result = validateAnswer(question, value, lang);
    if (!result.ok) return i.reply({ content: `⚠️ ${result.error}`, ...ephemeral });
    return answerFromComponent(i, app, question, result.value);
  }
  return stale(i, app);
}

export async function handleApplicationSelect(i: StringSelectMenuInteraction) {
  const [action = '', id = '', extra = ''] = i.customId.split(':');
  const app = await loadOwn(i, id); if (!app) return;
  const lang = langOf(app);
  if (action === 'app_edit') {
    if (app.cursor !== REVIEW) return stale(i, app);
    const question = questionOf(app, i.values[0] || '');
    if (!question) return stale(i, app);
    const moved = await patchApplication(id, { cursor: question.id, editing: true, lastActivityAt: new Date() }, { status: 'in_progress', cursor: REVIEW });
    if (!moved) return stale(i, app);
    await i.update({ components: [] });
    return sendStep(i.client, moved);
  }
  if (action !== 'app_pick' || extra !== app.cursor) return stale(i, app);
  const question = questionOf(app, extra);
  if (!question) return stale(i, app);
  const picked = i.values.map(value => question.options[Number(value)]).filter((value): value is string => value !== undefined);
  const result = validateAnswer(question, question.type === 'checkbox' ? picked : picked[0], lang);
  if (!result.ok) return i.reply({ content: `⚠️ ${result.error}`, ...ephemeral });
  return answerFromComponent(i, app, question, result.value);
}

export async function handleApplicationModal(i: ModalSubmitInteraction) {
  const [action = '', id = '', extra = ''] = i.customId.split(':');
  if (action === 'app_decide') {
    if (!i.inCachedGuild()) return i.reply({ content: 'Server only.', ...ephemeral });
    const app = await getApplication(id);
    if (!app || app.guildId !== i.guildId) return i.reply({ content: 'Application not found.', ...ephemeral });
    if (!canDecide(i.member)) return adminOnly(i);
    await i.deferReply(ephemeral);
    try {
      const result = await decideApplication(i.client, id, extra === 'accepted' ? 'accepted' : 'rejected', { id: i.user.id, name: i.user.username }, i.fields.getTextInputValue('reason'));
      return i.editReply({ content: `${extra === 'accepted' ? '✅ Accepted' : '❌ Rejected'} <@${app.userId}>.${result.warnings.length ? `\n⚠️ ${result.warnings.join('\n⚠️ ')}` : ''}` });
    } catch (error) {
      return i.editReply({ content: `⚠️ ${error instanceof Error ? error.message : 'Could not save the decision.'}` });
    }
  }
  const app = await loadOwn(i, id); if (!app) return;
  if (action !== 'app_modal' || extra !== app.cursor) return stale(i, app);
  const question = questionOf(app, extra);
  if (!question) return stale(i, app);
  const result = validateAnswer(question, i.fields.getTextInputValue('value'), langOf(app));
  if (!result.ok) return i.reply({ content: `⚠️ ${result.error}`, ...ephemeral });
  return answerFromComponent(i, app, question, result.value);
}

// Typed answers in DMs. Returns true when the message belonged to an application.
export async function handleApplicationMessage(message: Message) {
  if (message.guild || message.author.bot) return false;
  const app = await findApplication({ userId: message.author.id, status: 'in_progress' });
  if (!app) return false;
  const lang = langOf(app);
  if (!app.cursor) { await message.reply(lang === 'ar' ? 'اضغط **ابدأ التقديم** في الرسالة بالأعلى للبدء 👆' : 'Press **Start** in the message above to begin 👆').catch(() => undefined); return true; }
  if (app.cursor === REVIEW) { await message.reply(t(lang, 'useButtons')).catch(() => undefined); return true; }
  const question = questionOf(app, app.cursor);
  if (!question) return true;
  if (!TEXT_TYPES.has(question.type)) { await message.reply(t(lang, 'useButtons')).catch(() => undefined); return true; }
  const raw = question.type === 'url' && !message.content.trim() && message.attachments.first() ? message.attachments.first()!.url : message.content;
  const result = validateAnswer(question, raw, lang);
  if (!result.ok) { await message.reply(`⚠️ ${result.error}`).catch(() => undefined); return true; }
  const updated = await recordAnswer(app, question, result.value);
  if (!updated) return true;
  const dm = await message.author.createDM().catch(() => null);
  const prompt = dm && app.promptMessageId ? await dm.messages.fetch(app.promptMessageId).catch(() => null) : null;
  await prompt?.edit(promptPayload(app, question, { answered: result.value })).catch(() => undefined);
  await message.react('✅').catch(() => undefined);
  await sendStep(message.client, updated).catch(error => console.error('Could not send the next application step:', error));
  return true;
}

// Watchdog: closes DM sessions that went quiet for longer than the form allows.
export async function expireApplications(client: Client) {
  const rows = await findApplications({ status: 'in_progress' });
  const now = Date.now();
  for (const app of rows) {
    const timeoutMs = (app.timeoutMinutes || 30) * 60_000;
    if (now - new Date(app.lastActivityAt).getTime() < timeoutMs) continue;
    const expired = await patchApplication(app.id, { status: 'expired' }, { status: 'in_progress', idleBefore: new Date(now - timeoutMs) });
    if (!expired) continue;
    await closePrompt(client, app);
    const dm = await dmOf(client, app).catch(() => null);
    await dm?.send({ embeds: [new EmbedBuilder().setColor(0xe0b04f).setDescription(t(langOf(app), 'expired'))] }).catch(() => undefined);
    await log(app.guildId, 'APPLICATION_EXPIRED', app.userId, null, { applicationId: app.id });
  }
}
