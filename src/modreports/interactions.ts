import {
  LabelBuilder, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
  type ButtonInteraction, type ModalSubmitInteraction,
} from 'discord.js';
import {
  ACTIONS, L, actionLabel, actionOptions, addModReportNote, canReport, canReviewModReports, createModReport, decideModReport, getModReport, getModSettings, moderatorSummary, pad, reopenModReport,
  type ModAction, type ModLanguage, type PanelLanguage,
} from '../services/mod-report.service.js';
import { button, row, ts } from '../utils/v2.js';

const ephemeral = { flags: 64 as const };
type Draft = { target: string; action: string; reason: string; duration: string; evidence: string; at: number };
// Last submitted values per user, so a failed validation can reopen the form already filled in.
const drafts = new Map<string, Draft>();
const DRAFT_MS = 15 * 60_000;
const langOf = (value: string | undefined, fallback: PanelLanguage): PanelLanguage => (value === 'ar' || value === 'en' ? value : fallback);

export function reportModal(lang: PanelLanguage, draft?: Draft) {
  const input = (id: string, style: TextInputStyle, required: boolean, max: number, value = '', placeholder = '') => {
    const field = new TextInputBuilder().setCustomId(id).setStyle(style).setRequired(required).setMaxLength(max);
    if (value) field.setValue(value.slice(0, max));
    if (placeholder) field.setPlaceholder(placeholder);
    return field;
  };
  const select = new StringSelectMenuBuilder().setCustomId('action').setPlaceholder(L(lang, 'اختر الإجراء', 'Choose the action')).setMinValues(1).setMaxValues(1)
    .addOptions(actionOptions(lang).map(option => ({ ...option, default: draft?.action === option.value })));
  return new ModalBuilder().setCustomId(`mr_modal:${lang}`).setTitle(L(lang, 'تقرير إداري', 'Moderation report').slice(0, 45)).addLabelComponents(
    new LabelBuilder().setLabel(L(lang, 'آيدي العضو', 'User ID').slice(0, 45)).setDescription(L(lang, 'آيدي العضو أو منشنه', 'The member ID or mention').slice(0, 100)).setTextInputComponent(input('target', TextInputStyle.Short, true, 40, draft?.target, '123456789012345678')),
    new LabelBuilder().setLabel(L(lang, 'الإجراء', 'Action').slice(0, 45)).setStringSelectMenuComponent(select),
    new LabelBuilder().setLabel(L(lang, 'السبب', 'Reason').slice(0, 45)).setTextInputComponent(input('reason', TextInputStyle.Paragraph, true, 1000, draft?.reason)),
    new LabelBuilder().setLabel(L(lang, 'المدة', 'Duration').slice(0, 45)).setDescription(L(lang, 'مطلوبة للميوت، مثال: 1h أو 7d', 'Required for mutes, e.g. 1h or 7d').slice(0, 100)).setTextInputComponent(input('duration', TextInputStyle.Short, false, 50, draft?.duration)),
    new LabelBuilder().setLabel(L(lang, 'الدليل', 'Evidence').slice(0, 45)).setDescription(L(lang, 'روابط صور أو رسائل', 'Links to screenshots or messages').slice(0, 100)).setTextInputComponent(input('evidence', TextInputStyle.Paragraph, false, 1000, draft?.evidence)),
  );
}

async function openForm(i: ButtonInteraction, useDraft: boolean, requested?: string) {
  if (!i.inCachedGuild()) return i.reply({ content: 'Server only.', ...ephemeral });
  const s = await getModSettings(i.guild.id);
  const lang = langOf(requested, s.language);
  if (!s.enabled) return i.reply({ content: L(lang, 'نظام التقارير متوقف حاليًا.', 'Moderation reports are turned off.'), ...ephemeral });
  if (!await canReport(i.member, s)) return i.reply({ content: L(lang, 'هذا متاح للإدارة فقط.', 'Only staff can submit moderation reports.'), ...ephemeral });
  const draft = drafts.get(i.user.id);
  return i.showModal(reportModal(lang, useDraft && draft && Date.now() - draft.at < DRAFT_MS ? draft : undefined));
}

async function myReports(i: ButtonInteraction, requested?: string) {
  if (!i.inCachedGuild()) return i.reply({ content: 'Server only.', ...ephemeral });
  const s = await getModSettings(i.guild.id);
  const lang = langOf(requested, s.language);
  const summary = await moderatorSummary(i.guild.id, i.user.id);
  const icon = { pending: '🕒', approved: '✅', rejected: '❌' } as const;
  const listing = summary.rows.length ? summary.rows.map(report => `${icon[report.status]} **${pad(report.number)}** · ${actionLabel(report.action, lang)} · <@${report.targetUserId}> · ${ts(report.createdAt)}`).join('\n') : L(lang, 'لا توجد تقارير بعد.', 'No reports yet.');
  return i.reply({ content: `### 📋 ${L(lang, 'تقاريري', 'My reports')}\n✅ ${summary.approved} · ❌ ${summary.rejected} · 🕒 ${summary.pending}\n\n${listing}`, allowedMentions: { parse: [] }, ...ephemeral });
}

async function submit(i: ModalSubmitInteraction, requested?: string) {
  if (!i.inCachedGuild()) return i.reply({ content: 'Server only.', ...ephemeral });
  const s = await getModSettings(i.guild.id);
  const lang = langOf(requested, s.language);
  if (!await canReport(i.member, s)) return i.reply({ content: L(lang, 'هذا متاح للإدارة فقط.', 'Only staff can submit moderation reports.'), ...ephemeral });
  const draft: Draft = {
    target: i.fields.getTextInputValue('target').trim(), action: i.fields.getStringSelectValues('action')[0] || '',
    reason: i.fields.getTextInputValue('reason').trim(), duration: i.fields.getTextInputValue('duration').trim(), evidence: i.fields.getTextInputValue('evidence').trim(), at: Date.now(),
  };
  for (const [userId, item] of drafts) if (Date.now() - item.at > DRAFT_MS) drafts.delete(userId);
  drafts.set(i.user.id, draft);
  const retry = [row([button({ id: `mr_retry:${lang}`, label: L(lang, 'تعديل وإعادة الإرسال', 'Fix and resend'), style: 'primary', emoji: '✏️' })])];
  const fail = (message: string) => i.reply({ content: `⚠️ ${message}`, components: retry, ...ephemeral });
  const targetUserId = /(\d{15,22})/.exec(draft.target)?.[1] || '';
  if (!targetUserId) return fail(L(lang, 'اكتب آيدي صحيح للعضو (رقم من 17 إلى 20 خانة).', 'Enter a valid user ID (a 17–20 digit number).'));
  if (!(ACTIONS as readonly string[]).includes(draft.action)) return fail(L(lang, 'اختر الإجراء.', 'Choose the action.'));
  if (draft.action === 'mute' && !draft.duration) return fail(L(lang, 'المدة مطلوبة عند الميوت.', 'Duration is required for mutes.'));
  if (s.requireEvidence.includes(draft.action as ModAction) && !draft.evidence) return fail(L(lang, 'الدليل مطلوب لهذا الإجراء.', 'Evidence is required for this action.'));
  if (!await i.client.users.fetch(targetUserId).catch(() => null)) return fail(L(lang, 'ما لقيت مستخدم بهذا الآيدي.', 'No Discord user has that ID.'));
  await i.deferReply(ephemeral);
  const report = await createModReport(i.client, i.member, { targetUserId, action: draft.action as ModAction, reason: draft.reason, duration: draft.duration, evidence: draft.evidence, lang });
  drafts.delete(i.user.id);
  const jump = report.reviewChannelId && report.reviewMessageId ? `\nhttps://discord.com/channels/${i.guild.id}/${report.reviewChannelId}/${report.reviewMessageId}` : '';
  return i.editReply({ content: `✅ ${L(lang, 'تم إرسال التقرير', 'Report submitted')} **${pad(report.number)}** · ${actionLabel(report.action, lang)} · <@${targetUserId}>${report.reviewMessageId ? '' : `\n⚠️ ${L(lang, 'لم يتم تحديد روم المراجعة، أبلغ الإدارة.', 'No review channel is set, tell an administrator.')}`}${jump}`, allowedMentions: { parse: [] } });
}

async function reviewer(i: ButtonInteraction | ModalSubmitInteraction) {
  if (!i.inCachedGuild()) { await i.reply({ content: 'Server only.', ...ephemeral }); return null; }
  const s = await getModSettings(i.guild.id);
  if (!canReviewModReports(i.member)) { await i.reply({ content: L(s.language, 'هذا الإجراء للإدارة العليا فقط.', 'Only administrators can review moderation reports.'), ...ephemeral }); return null; }
  return s;
}

export function noteModal(id: string, lang: ModLanguage, kind: 'note' | 'reject') {
  return new ModalBuilder().setCustomId(`${kind === 'note' ? 'mr_notemodal' : 'mr_rejectmodal'}:${id}`).setTitle((kind === 'note' ? L(lang, 'إضافة ملاحظة', 'Add a note') : L(lang, 'رفض التقرير', 'Reject report')).slice(0, 45)).addLabelComponents(
    new LabelBuilder().setLabel((kind === 'note' ? L(lang, 'الملاحظة', 'Note') : L(lang, 'السبب', 'Reason')).slice(0, 45)).setDescription(kind === 'reject' ? L(lang, 'يُرسل للمشرف مع النتيجة', 'Sent to the moderator with the result').slice(0, 100) : L(lang, 'تظهر في بطاقة التقرير', 'Shown on the report card').slice(0, 100))
      .setTextInputComponent(new TextInputBuilder().setCustomId('note').setStyle(TextInputStyle.Paragraph).setRequired(kind === 'note').setMaxLength(1000)),
  );
}

async function onButton(i: ButtonInteraction) {
  const [action = '', id = ''] = i.customId.split(':');
  if (action === 'mr_open') return openForm(i, false, id);
  if (action === 'mr_retry') return openForm(i, true, id);
  if (action === 'mr_mine') return myReports(i, id);
  const s = await reviewer(i); if (!s) return;
  const report = await getModReport(id);
  if (!report || report.guildId !== i.guildId) return i.reply({ content: 'Report not found.', ...ephemeral });
  if (action === 'mr_note') return i.showModal(noteModal(id, s.language, 'note'));
  if (report.moderatorId === i.user.id && i.guild?.ownerId !== i.user.id) return i.reply({ content: L(s.language, 'لا يمكنك مراجعة تقريرك.', 'You cannot review your own report.'), ...ephemeral });
  if (action === 'mr_reject') { if (report.status !== 'pending') return i.reply({ content: L(s.language, 'تمت مراجعة هذا التقرير.', 'This report was already reviewed.'), ...ephemeral }); return i.showModal(noteModal(id, s.language, 'reject')); }
  await i.deferReply(ephemeral);
  try {
    if (action === 'mr_approve') { const { dmSent } = await decideModReport(i.client, id, 'approved', { id: i.user.id, name: i.user.username }); return i.editReply(`✅ ${L(s.language, 'تم القبول', 'Approved')}${dmSent ? '' : ` · ${L(s.language, 'خاص المشرف مغلق', 'moderator DMs are closed')}`}`); }
    if (action === 'mr_reopen') { await reopenModReport(i.client, id, i.user.id); return i.editReply(`↩️ ${L(s.language, 'أُعيد فتح التقرير', 'Report reopened')}`); }
  } catch (error) { return i.editReply(`⚠️ ${error instanceof Error ? error.message : 'Failed.'}`); }
  return i.editReply('Unknown action.');
}

async function onModal(i: ModalSubmitInteraction) {
  const [action = '', id = ''] = i.customId.split(':');
  if (action === 'mr_modal') return submit(i, id);
  const s = await reviewer(i); if (!s) return;
  // The report must belong to this server; a crafted modal id must not reach another server's report.
  const report = await getModReport(id);
  if (!report || report.guildId !== i.guildId) return i.reply({ content: 'Report not found.', ...ephemeral });
  if (action === 'mr_rejectmodal' && report.moderatorId === i.user.id && i.guild?.ownerId !== i.user.id) return i.reply({ content: L(s.language, 'لا يمكنك مراجعة تقريرك.', 'You cannot review your own report.'), ...ephemeral });
  const note = i.fields.getTextInputValue('note');
  await i.deferReply(ephemeral);
  try {
    if (action === 'mr_notemodal') { await addModReportNote(i.client, id, { id: i.user.id, name: i.user.username }, note); return i.editReply(`📝 ${L(s.language, 'أُضيفت الملاحظة', 'Note added')}`); }
    if (action === 'mr_rejectmodal') { const { dmSent } = await decideModReport(i.client, id, 'rejected', { id: i.user.id, name: i.user.username }, note); return i.editReply(`❌ ${L(s.language, 'تم الرفض', 'Rejected')}${dmSent ? '' : ` · ${L(s.language, 'خاص المشرف مغلق', 'moderator DMs are closed')}`}`); }
  } catch (error) { return i.editReply(`⚠️ ${error instanceof Error ? error.message : 'Failed.'}`); }
  return i.editReply('Unknown action.');
}

export const handleModReportButton = onButton;
export const handleModReportModal = onModal;
