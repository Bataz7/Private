import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type Client } from '../lib/djs/index.js';
import { getSettings } from '../services/settings.service.js';
import { patchRow, type RequestTable } from './db.js';
import { clip, seconds, type RequestKind } from './util.js';

// The review card for leave and resignation requests: the message administrators see in the requests channel.
// It is built in one place, so a request looks the same whether it came from Discord or from the dashboard,
// and it is edited (buttons removed, decision shown) whoever decides it.
const TABLE: Record<RequestKind, RequestTable> = { leave: 'leave_requests', resignation: 'resignation_requests' };

const TEXT = {
  leaveTitle: { ar: '🏖️ طلب إجازة', en: '🏖️ Leave request' },
  resignationTitle: { ar: '🚪 طلب استقالة', en: '🚪 Resignation request' },
  staff: { ar: 'العضو', en: 'Staff member' },
  status: { ar: 'الحالة', en: 'Status' },
  period: { ar: '📅 الفترة', en: '📅 Period' },
  duration: { ar: '⏱️ المدة', en: '⏱️ Duration' },
  days: { ar: '{n} يوم', en: '{n} day(s)' },
  lastDay: { ar: '📅 آخر يوم عمل', en: '📅 Last working day' },
  reason: { ar: '📝 السبب', en: '📝 Reason' },
  notes: { ar: '🗒️ ملاحظات العضو', en: '🗒️ Member notes' },
  decision: { ar: '⚖️ القرار', en: '⚖️ Decision' },
  note: { ar: '💬 ملاحظة الإدارة', en: '💬 Management note' },
  extension: { ar: '🔁 طلب تمديد', en: '🔁 Extension asked' },
  approve: { ar: 'موافقة', en: 'Approve' },
  reject: { ar: 'رفض', en: 'Reject' },
  extend: { ar: 'تمديد الإجازة', en: 'Extend leave' },
  footerLeave: { ar: 'إجازة', en: 'Leave' },
  footerResignation: { ar: 'استقالة', en: 'Resignation' },
  decidedBy: { ar: 'بواسطة {who}', en: 'by {who}' },
  pending: { ar: '⏳ بانتظار القرار', en: '⏳ Waiting for a decision' },
  approved: { ar: '✅ تمت الموافقة', en: '✅ Approved' },
  approvedResignation: { ar: '✅ تمت الموافقة، بانتظار آخر يوم', en: '✅ Approved, waiting for the last day' },
  accepted: { ar: '✅ اكتملت الاستقالة', en: '✅ Resignation completed' },
  rejected: { ar: '❌ مرفوض', en: '❌ Rejected' },
  returned: { ar: '🟢 عاد من الإجازة', en: '🟢 Returned from leave' },
} as const;
type Key = keyof typeof TEXT;
const say = (ar: boolean, key: Key, vars: Record<string, string | number> = {}) => TEXT[key][ar ? 'ar' : 'en'].replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ''));
const KNOWN = ['pending', 'approved', 'accepted', 'rejected', 'returned'] as const;

export type RequestLike = {
  id: number | string; userId: string; status: string; reason: string; createdAt?: Date | string;
  startDate?: Date | string; endDate?: Date | string; lastWorkingDay?: Date | string; notes?: string;
  reviewedBy?: string | null; reviewedAt?: Date | string | null; decisionNote?: string | null;
  extensionEndDate?: Date | string | null;
};
type Stored = RequestLike & { guildId: string; reviewChannelId?: string | null; reviewMessageId?: string | null; dmMessageId?: string | null };

export function buildRequestCard(kind: RequestKind, request: RequestLike, opts: { ar: boolean; staffName?: string; staffAvatar?: string | null }) {
  const { ar } = opts;
  const status = ((KNOWN as readonly string[]).includes(request.status) ? request.status : 'pending') as (typeof KNOWN)[number];
  const statusText = status === 'approved' && kind === 'resignation' ? say(ar, 'approvedResignation') : say(ar, status as Key);
  const embed = new EmbedBuilder().setTitle(say(ar, kind === 'leave' ? 'leaveTitle' : 'resignationTitle'))
    .setDescription(`**${say(ar, 'staff')}:** <@${request.userId}>\n**${say(ar, 'status')}:** ${statusText}`)
    .setFooter({ text: `${say(ar, kind === 'leave' ? 'footerLeave' : 'footerResignation')} Rift #${String(request.id).slice(-6)}` })
    .setTimestamp(request.createdAt ? new Date(request.createdAt) : new Date());
  if (opts.staffName) embed.setAuthor({ name: clip(opts.staffName, 256), iconURL: opts.staffAvatar || undefined });
  if (opts.staffAvatar) embed.setThumbnail(opts.staffAvatar);
  const fields: { name: string; value: string; inline?: boolean }[] = [];
  if (kind === 'leave' && request.startDate && request.endDate) {
    const days = Math.max(1, Math.round((new Date(request.endDate).getTime() - new Date(request.startDate).getTime()) / 86_400_000) + 1);
    fields.push({ name: say(ar, 'period'), value: `<t:${seconds(request.startDate)}:D> → <t:${seconds(request.endDate)}:D>`, inline: true }, { name: say(ar, 'duration'), value: say(ar, 'days', { n: days }), inline: true });
    if (request.extensionEndDate) fields.push({ name: say(ar, 'extension'), value: `<t:${seconds(request.extensionEndDate)}:D>`, inline: true });
  }
  if (kind === 'resignation' && request.lastWorkingDay) fields.push({ name: say(ar, 'lastDay'), value: `<t:${seconds(request.lastWorkingDay)}:D> · <t:${seconds(request.lastWorkingDay)}:R>`, inline: false });
  fields.push({ name: say(ar, 'reason'), value: clip(request.reason || '—', 1000) });
  if (kind === 'resignation' && request.notes) fields.push({ name: say(ar, 'notes'), value: clip(request.notes, 1000) });
  if (status !== 'pending' && request.reviewedBy) fields.push({ name: say(ar, 'decision'), value: `${statusText} · ${say(ar, 'decidedBy', { who: `<@${request.reviewedBy}>` })}${request.reviewedAt ? ` · <t:${seconds(request.reviewedAt)}:R>` : ''}` });
  if (status !== 'pending' && request.decisionNote) fields.push({ name: say(ar, 'note'), value: clip(request.decisionNote, 1000) });
  embed.addFields(fields);
  const components = status === 'pending' ? [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(kind === 'leave' ? `leave_approve:${request.id}` : `resign_approve:${request.id}`).setLabel(say(ar, 'approve')).setStyle(kind === 'leave' ? ButtonStyle.Success : ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(kind === 'leave' ? `leave_reject:${request.id}` : `resign_reject:${request.id}`).setLabel(say(ar, 'reject')).setStyle(kind === 'leave' ? ButtonStyle.Danger : ButtonStyle.Secondary),
  )] : kind === 'leave' && status === 'approved' ? [new ActionRowBuilder<ButtonBuilder>().addComponents(
    // An administrator can move the end of a running leave at any time (for example when the member asks in person).
    new ButtonBuilder().setCustomId(`leave_admin_extend:${request.id}`).setLabel(say(ar, 'extend')).setStyle(ButtonStyle.Primary),
  )] : [];
  return { embeds: [embed], components };
}

// The confirmation the member gets in DMs right after sending a request (also edited later by the decision).
const DM = {
  leaveTitle: { ar: '🏖️ تم استلام طلب إجازتك', en: '🏖️ Leave request received' },
  resignationTitle: { ar: '🚪 تم استلام طلب استقالتك', en: '🚪 Resignation request received' },
  body: { ar: 'وصل طلبك للإدارة وهو الحين تحت المراجعة. بتوصلك النتيجة هنا في الخاص، وما يحتاج ترسل الطلب مرة ثانية.', en: 'Your request reached the management team and is under review. The result will be sent to you here, so there is no need to send it again.' },
  ref: { ar: '🔖 رقم الطلب', en: '🔖 Reference' },
  keepDm: { ar: '💡 خلّ الخاص مفتوح عشان توصلك النتيجة.', en: '💡 Keep your DMs open so the result can reach you.' },
} as const;
// Once a decision is made the same message is edited: status changes and the text points to the newer message.
const DECIDED = { ar: 'طلع القرار في طلبك. التفاصيل في الرسالة الأحدث تحت.', en: 'A decision was made on your request. See the newest message below.' } as const;

export function requestSubmittedEmbed(kind: RequestKind, request: RequestLike, ar: boolean) {
  const decided = request.status !== 'pending';
  const status = ((KNOWN as readonly string[]).includes(request.status) ? request.status : 'pending') as (typeof KNOWN)[number];
  const l = ar ? 'ar' : 'en';
  const embed = new EmbedBuilder().setTitle(DM[kind === 'leave' ? 'leaveTitle' : 'resignationTitle'][l]).setDescription(decided ? DECIDED[l] : DM.body[l]).setFooter({ text: DM.keepDm[l] }).setTimestamp();
  const statusText = decided ? (status === 'approved' && kind === 'resignation' ? say(ar, 'approvedResignation') : say(ar, status as Key)) : say(ar, 'pending');
  const fields: { name: string; value: string; inline: boolean }[] = [{ name: say(ar, 'status'), value: statusText, inline: true }, { name: DM.ref[l], value: `\`#${String(request.id).slice(-6).toUpperCase()}\``, inline: true }];
  if (kind === 'leave' && request.startDate && request.endDate) fields.push({ name: say(ar, 'period'), value: `<t:${seconds(request.startDate)}:D> → <t:${seconds(request.endDate)}:D>`, inline: false });
  if (kind === 'resignation' && request.lastWorkingDay) fields.push({ name: say(ar, 'lastDay'), value: `<t:${seconds(request.lastWorkingDay)}:D>`, inline: false });
  fields.push({ name: say(ar, 'reason'), value: clip(request.reason || '—', 1000), inline: false });
  return embed.addFields(fields);
}

/** Where requests are sent for review. Falls back to the logs channel only when no requests channel was chosen. */
export const requestsChannelId = (settings: { leaveChannelId?: string | null; resignationChannelId?: string | null; logsChannelId?: string | null } | null | undefined, kind: RequestKind) =>
  (kind === 'leave' ? settings?.leaveChannelId : settings?.resignationChannelId) || settings?.logsChannelId || '';

async function staffLook(client: Client, guildId: string, userId: string) {
  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  const member = await guild?.members.fetch(userId).catch(() => null);
  return { staffName: member?.displayName, staffAvatar: member?.displayAvatarURL({ extension: 'png', size: 128 }) || null };
}

/** The card as a message payload (used to answer a button press on the card itself). */
export async function cardPayload(client: Client, kind: RequestKind, request: Stored) {
  const settings = await getSettings(request.guildId).catch(() => null);
  return buildRequestCard(kind, request, { ar: settings?.botLanguage === 'ar', ...await staffLook(client, request.guildId, request.userId) });
}

/** Sends the card to the requests channel and remembers the message, so a later decision can edit it. */
export async function postRequestCard(client: Client, kind: RequestKind, request: Stored) {
  const settings = await getSettings(request.guildId).catch(() => null);
  const channelId = requestsChannelId(settings, kind);
  const channel: any = channelId ? await client.channels.fetch(channelId).catch(() => null) : null;
  if (!channel?.isTextBased?.() || typeof channel.send !== 'function' || channel.guildId !== request.guildId) return null;
  const payload = buildRequestCard(kind, request, { ar: settings?.botLanguage === 'ar', ...await staffLook(client, request.guildId, request.userId) });
  const message = await channel.send({ ...payload, allowedMentions: { parse: [] } }).catch((error: unknown) => { console.error(`Could not post ${kind} request:`, error); return null; });
  if (message) await patchRow(TABLE[kind], request.id, { reviewChannelId: channel.id, reviewMessageId: message.id }).catch(() => undefined);
  return message;
}

/** Rebuilds the card from the saved request (decision shown, buttons removed). Works for any way of deciding. */
export async function refreshRequestCard(client: Client, kind: RequestKind, request: Stored) {
  if (!request.reviewChannelId || !request.reviewMessageId) return false;
  const settings = await getSettings(request.guildId).catch(() => null);
  const channel: any = await client.channels.fetch(request.reviewChannelId).catch(() => null);
  const message = channel?.messages ? await channel.messages.fetch(request.reviewMessageId).catch(() => null) : null;
  if (!message) return false;
  const payload = buildRequestCard(kind, request, { ar: settings?.botLanguage === 'ar', ...await staffLook(client, request.guildId, request.userId) });
  return message.edit({ ...payload, allowedMentions: { parse: [] } }).then(() => true, () => false);
}

/** Sends a NEW DM (that is what notifies the member) and turns the old "request received" message into a "decided" one. */
export async function sendDecisionDm(client: Client, request: RequestLike & { dmMessageId?: string | null }, payload: any, kind: RequestKind = 'leave', ar = true) {
  const user = await client.users.fetch(request.userId).catch(() => null);
  if (!user) return false;
  if (request.dmMessageId) {
    const dm = await user.createDM().catch(() => null);
    const old = dm ? await dm.messages.fetch(request.dmMessageId).catch(() => null) : null;
    await old?.edit({ embeds: [requestSubmittedEmbed(kind, request, ar)], components: [] }).catch(() => undefined);
  }
  return user.send({ ...payload, allowedMentions: { parse: [] } }).then(() => true, () => false);
}

const RES = {
  approvedTitle: { ar: '🚪 تمت الموافقة على استقالتك', en: '🚪 Your resignation was approved' },
  approvedBody: { ar: 'وافقت الإدارة على استقالتك. في آخر يوم عمل ({day}) بتوصلك رسالة تأكيد قبل ما تنشال رتبة الستاف.', en: 'Management approved your resignation. On your last working day ({day}) you will get a confirmation message before your staff role is removed.' },
  rejectedTitle: { ar: '🚪 ما تمت الموافقة على استقالتك', en: '🚪 Your resignation was not approved' },
  rejectedBody: { ar: 'راجعت الإدارة طلبك وما وافقت عليه هالمرة. تقدر تتواصل معهم للتفاصيل.', en: 'Management reviewed your request and did not approve it this time. You can talk to them for details.' },
} as const;

export function resignationDecisionPayload(request: RequestLike, approved: boolean, ar: boolean) {
  const l = ar ? 'ar' : 'en';
  const embed = new EmbedBuilder().setTitle(RES[approved ? 'approvedTitle' : 'rejectedTitle'][l])
    .setDescription(approved ? RES.approvedBody[l].replace('{day}', request.lastWorkingDay ? `<t:${seconds(request.lastWorkingDay)}:D>` : '') : RES.rejectedBody[l]);
  if (request.decisionNote) embed.addFields({ name: say(ar, 'note'), value: clip(request.decisionNote, 1000) });
  return { embeds: [embed.setFooter({ text: DM.keepDm[l] }).setTimestamp()], components: [] as never[] };
}
