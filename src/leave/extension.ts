import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type Client } from 'discord.js';
import type { LeaveRequestDoc } from '../models/LeaveRequest.js';
import { getSettings } from '../services/settings.service.js';
import { createLog } from '../services/log.service.js';
import { assertAdministrator } from './access.js';
import { claim, patchRow } from './db.js';
import { findLeave } from './requests.js';
import { refreshRequestCard, requestsChannelId } from './cards.js';
import { extensionRejectedText, leaveExtendedPayload } from './lifecycle.js';
import { DAY_MS, gregorianDate } from './util.js';

// Extending an approved leave is only a REQUEST when a member asks. The end date moves when an administrator approves it,
// or when an administrator extends the leave directly (for example after the member asked in person).
const MAX_AHEAD_MS = 366 * DAY_MS;

const extensionCard = (request: LeaveRequestDoc, asked: Date, ar: boolean, decision?: { approved: boolean; by: string }) => {
  const embed = new EmbedBuilder()
    .setTitle(decision ? (ar ? (decision.approved ? '✅ تم قبول طلب التمديد' : '❌ تم رفض طلب التمديد') : (decision.approved ? '✅ Extension approved' : '❌ Extension rejected')) : (ar ? '🔁 طلب تمديد إجازة' : '🔁 Leave extension request'))
    .setDescription(decision ? (ar ? `القرار من <@${decision.by}>` : `Decided by <@${decision.by}>`)
      : (ar ? `<@${request.userId}> يطلب تمديد إجازته. تبقى الإجازة كما هي حتى يوافق أدمن.` : `<@${request.userId}> asks to extend their leave. The leave stays as it is until an administrator approves.`))
    .addFields({ name: ar ? 'تنتهي حاليًا' : 'Ends now', value: gregorianDate(request.endDate), inline: true }, { name: ar ? 'المطلوب' : 'Asked to end', value: gregorianDate(asked), inline: true })
    .setFooter({ text: `Rift Leave #${String(request.id).slice(-6)}` });
  const components = decision ? [] : [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`leave_ext_approve:${request.id}:${asked.getTime()}`).setLabel(ar ? 'موافقة' : 'Approve').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`leave_ext_reject:${request.id}:${asked.getTime()}`).setLabel(ar ? 'رفض' : 'Reject').setStyle(ButtonStyle.Danger))];
  return { embeds: [embed], components };
};

export async function requestLeaveExtension(client: Client, request: LeaveRequestDoc, endDate: Date) {
  if (endDate.getTime() > Date.now() + MAX_AHEAD_MS) throw new Error('That date is too far away. Choose a date within one year.');
  // Only the request is stored here. `endDate` itself is not touched.
  const previousCard = { channelId: request.extensionChannelId, messageId: request.extensionMessageId };
  const saved = await claim('leave_requests', request.id, { status: 'approved' }, { extensionEndDate: endDate, extensionRequestedAt: new Date() });
  if (!saved) throw new Error('This leave is not active.');
  // The member changed the date: the older card must not stay clickable, or approving it would approve the new date.
  if (previousCard.channelId && previousCard.messageId) {
    const oldChannel: any = await client.channels.fetch(previousCard.channelId).catch(() => null);
    const oldMessage = oldChannel?.messages ? await oldChannel.messages.fetch(previousCard.messageId).catch(() => null) : null;
    await oldMessage?.edit({ content: '↪️ Replaced by a newer request from the member.', components: [], allowedMentions: { parse: [] } }).catch(() => undefined);
  }
  await createLog(request.guildId, 'LEAVE_EXTENSION_REQUESTED', request.userId, request.userId, { leaveId: String(request.id), from: gregorianDate(request.endDate), to: gregorianDate(endDate) });
  const settings = await getSettings(request.guildId).catch(() => null);
  const channelId = requestsChannelId(settings, 'leave');
  const channel: any = channelId ? await client.channels.fetch(channelId).catch(() => null) : null;
  if (!channel?.isTextBased?.() || typeof channel.send !== 'function' || channel.guildId !== request.guildId) return { posted: false };
  const message = await channel.send({ allowedMentions: { parse: [] }, ...extensionCard(request, endDate, settings?.botLanguage === 'ar') }).catch(() => null);
  // The message is remembered so the decision can edit it, whether it is made with the buttons or in the dashboard.
  if (message) await patchRow('leave_requests', request.id, { extensionChannelId: channel.id, extensionMessageId: message.id }).catch(() => undefined);
  return { posted: Boolean(message) };
}

async function editExtensionCard(client: Client, request: LeaveRequestDoc, asked: Date, ar: boolean, decision: { approved: boolean; by: string }) {
  if (!request.extensionChannelId || !request.extensionMessageId) return;
  const channel: any = await client.channels.fetch(request.extensionChannelId).catch(() => null);
  const message = channel?.messages ? await channel.messages.fetch(request.extensionMessageId).catch(() => null) : null;
  await message?.edit({ allowedMentions: { parse: [] }, ...extensionCard(request, asked, ar, decision) }).catch(() => undefined);
}

async function tellMember(client: Client, userId: string, payload: any) {
  const user = await client.users.fetch(userId).catch(() => null);
  return user ? user.send({ ...payload, allowedMentions: { parse: [] } }).then(() => true, () => false) : false;
}

export async function decideLeaveExtension(client: Client, id: number | string, decision: 'approved' | 'rejected', actor: { id: string }, guildId?: string, expectedAt?: number) {
  const request = await findLeave(id);
  if (!request || (guildId && request.guildId !== guildId)) throw new Error('Leave request not found.');
  // The second lock, before anything changes.
  await assertAdministrator(client, request.guildId, actor.id);
  const asked: Date | null = request.extensionEndDate ? new Date(request.extensionEndDate) : null;
  if (!asked || request.status !== 'approved') throw new Error('There is no extension waiting for a decision.');
  // A card is bound to the date it shows: if the member asked again, an older card cannot approve the newer date.
  if (expectedAt && asked.getTime() !== expectedAt) throw new Error('This card is out of date: the member asked for a different date. Use their newest request.');
  // Atomic: only the request that was read can be decided, and only once.
  const cleared = { extensionEndDate: null, extensionRequestedAt: null, endReminderAt: null, endReminderTriedAt: null, endReminderCount: 0 };
  const won = await claim('leave_requests', request.id, { status: 'approved', extensionEndDate: asked }, decision === 'approved' ? { endDate: asked, ...cleared } : cleared);
  const done = won ? await findLeave(request.id) : null;
  if (!done) throw new Error('This request was already decided.');
  await createLog(request.guildId, decision === 'approved' ? 'LEAVE_EXTENDED' : 'LEAVE_EXTENSION_REJECTED', request.userId, actor.id, { leaveId: String(request.id), endDate: gregorianDate(asked) });
  const ar = (await getSettings(request.guildId).catch(() => null))?.botLanguage === 'ar';
  await editExtensionCard(client, request, asked, ar, { approved: decision === 'approved', by: actor.id });
  // A rejected request leaves the leave as it was: the member is still asked about the original end date.
  const dmSent = await tellMember(client, request.userId, decision === 'approved' ? leaveExtendedPayload(done, ar) : { content: extensionRejectedText(ar) });
  await refreshRequestCard(client, 'leave', done);
  return { endDate: asked, dmSent };
}

/** An administrator moves the end of a running leave directly. No request is needed. */
export async function adminExtendLeave(client: Client, id: number | string, newEnd: Date, actor: { id: string }, note = '', guildId?: string) {
  const request = await findLeave(id);
  if (!request || (guildId && request.guildId !== guildId)) throw new Error('Leave request not found.');
  await assertAdministrator(client, request.guildId, actor.id);
  if (request.status !== 'approved') throw new Error('Only a running (approved) leave can be extended.');
  if (Number.isNaN(newEnd.getTime())) throw new Error('Choose a valid date.');
  if (newEnd.getTime() <= new Date(request.endDate).getTime()) throw new Error('The new end date must be after the current end date.');
  if (newEnd.getTime() > Date.now() + MAX_AHEAD_MS) throw new Error('That date is too far away. Choose a date within one year.');
  // A leave that already ended still needs a date that has not ended yet, otherwise the member is asked again at once.
  if (newEnd.getTime() + DAY_MS - 1 < Date.now()) throw new Error('The new end date is already in the past.');
  const won = await claim('leave_requests', request.id, { status: 'approved' }, { endDate: newEnd, decisionNote: note ? note.slice(0, 1000) : request.decisionNote || '', extensionEndDate: null, extensionRequestedAt: null, endReminderAt: null, endReminderTriedAt: null, endReminderCount: 0 });
  const done = won ? await findLeave(request.id) : null;
  if (!done) throw new Error('This leave is not active.');
  await createLog(request.guildId, 'LEAVE_EXTENDED', request.userId, actor.id, { leaveId: String(request.id), endDate: gregorianDate(newEnd), byAdministrator: true });
  const ar = (await getSettings(request.guildId).catch(() => null))?.botLanguage === 'ar';
  // If the member had asked for more time, that request is settled by this extension.
  if (request.extensionEndDate) await editExtensionCard(client, request, new Date(request.extensionEndDate), ar, { approved: true, by: actor.id });
  const dmSent = await tellMember(client, request.userId, leaveExtendedPayload(done, ar));
  await refreshRequestCard(client, 'leave', done);
  return { request: done, dmSent };
}
