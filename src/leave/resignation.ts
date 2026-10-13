import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type Client } from '../lib/djs/index.js';
import { Staff } from '../models/Staff.js';
import { ResignationRequest, type ResignationRequestDoc } from '../models/ResignationRequest.js';
import { getSettings } from '../services/settings.service.js';
import { createLog, sendLog } from '../services/log.service.js';
import { endShift, getActiveShift } from '../services/shift.service.js';
import { suppressAutoStart } from '../services/auto-shift.service.js';
import { assertAdministrator } from './access.js';
import { claim, patchRow } from './db.js';
import { findResignation } from './requests.js';
import { refreshRequestCard, resignationDecisionPayload, sendDecisionDm } from './cards.js';
import { closeOpenLeaves, warnManagement } from './lifecycle.js';
import { gregorianDate, isArabic } from './util.js';

// A resignation is decided by an administrator (approved or rejected). An approved one waits for the last working day; on that day
// the member gets a confirmation DM, and pressing "Yes" removes ONLY the configured staff role (plus the bot's own On Shift / On Leave
// state roles) and sends the farewell. Nothing else the member owns is touched.

export async function decideResignation(client: Client, id: number | string, decision: 'approved' | 'rejected', reviewer: { id: string }, note = '', card?: { channelId: string; messageId: string }, guildId?: string) {
  const request = await findResignation(id);
  if (!request || (guildId && request.guildId !== guildId)) throw new Error('Resignation request not found.');
  // The second lock, before anything changes, whichever button or route called this.
  await assertAdministrator(client, request.guildId, reviewer.id);
  if (request.status !== 'pending') throw new Error('This request is no longer pending.');
  if (request.userId === reviewer.id) throw new Error('You cannot review your own request.');
  const approved = decision === 'approved';
  // `status: pending` in the match: two administrators clicking together cannot both decide (and both message the member).
  const won = await claim('resignation_requests', request.id, { status: 'pending' }, {
    status: decision, decisionNote: note.slice(0, 1000), reviewedBy: reviewer.id, reviewedAt: new Date(),
    ...(approved ? { confirmationSentAt: null } : {}), ...(card ? { reviewChannelId: card.channelId, reviewMessageId: card.messageId } : {}),
  });
  const updated = won ? await findResignation(request.id) : null;
  if (!updated) throw new Error('This request was already decided.');
  const ar = await isArabic(request.guildId);
  // A new message, not an edit of the old one: only a new message notifies the member.
  const dmSent = await sendDecisionDm(client, updated, resignationDecisionPayload(updated, approved, ar), 'resignation', ar);
  await createLog(request.guildId, approved ? 'RESIGNATION_APPROVED' : 'RESIGNATION_REJECTED', request.userId, reviewer.id, { resignationId: String(request.id) });
  await warnManagement(client, request.guildId, approved ? `🚪 **RESIGNATION ACCEPTED**\n<@${request.userId}> by <@${reviewer.id}> — last day ${gregorianDate(request.lastWorkingDay)}` : `❌ **RESIGNATION REJECTED**\n<@${request.userId}> by <@${reviewer.id}>`);
  await refreshRequestCard(client, 'resignation', updated);
  return { request: updated, dmSent };
}

// ---- last working day: ask the member to confirm ---------------------------------------------------
const dmAttempts = new Map<number, number>();

const confirmationPayload = (request: ResignationRequestDoc, ar: boolean) => ({
  embeds: [new EmbedBuilder()
    .setTitle(ar ? '🚪 حان موعد استقالتك' : '🚪 Your resignation date has arrived')
    .setDescription(ar ? 'اليوم هو آخر يوم عمل في استقالتك المعتمدة. هل أنت متأكد أنك تريد إتمام الاستقالة؟ ستُزال رتبة الستاف وتصلك رسالة وداع.' : 'Today is the last working day in your approved resignation. Are you sure you want to complete your resignation? Your staff role will be removed and a farewell message will be sent.')
    .addFields({ name: ar ? 'آخر يوم عمل' : 'Last working day', value: gregorianDate(request.lastWorkingDay), inline: true })],
  components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`resign_confirm:${request.id}`).setLabel(ar ? 'نعم، أكمل الاستقالة' : 'Yes, complete resignation').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`resign_cancel:${request.id}`).setLabel(ar ? 'ليس الآن' : 'Not now').setStyle(ButtonStyle.Secondary))],
});

export async function runResignationMonitor(client: Client) {
  const requests = await ResignationRequest.find({ status: 'approved' });
  const now = Date.now();
  for (const request of requests) {
    if (new Date(request.lastWorkingDay).getTime() > now || request.confirmationSentAt) continue;
    const guild = await client.guilds.fetch(request.guildId).catch(() => null);
    const member = await guild?.members.fetch(request.userId).catch(() => null);
    if (!member) continue;
    // A closed DM is retried every 6 hours and reported to the logs channel once.
    const lastTry = dmAttempts.get(request.id) || 0;
    if (now - lastTry < 6 * 60 * 60 * 1000) continue;
    dmAttempts.set(request.id, now);
    const message = await member.send(confirmationPayload(request, await isArabic(request.guildId))).catch(() => null);
    if (message) await patchRow('resignation_requests', request.id, { confirmationSentAt: new Date(), dmMessageId: message.id });
    else if (!lastTry) await sendLog(client, request.guildId, `⚠️ Could not DM <@${request.userId}> to confirm their resignation (last day reached). Their DMs are closed.`).catch(() => undefined);
  }
}

// ---- the member's answer ---------------------------------------------------------------------------
export async function withdrawResignation(request: ResignationRequestDoc) {
  // Closed as rejected, so the member can submit a new request later instead of being stuck with no buttons.
  const won = await claim('resignation_requests', request.id, { status: 'approved' }, { status: 'rejected', decisionNote: 'Withdrawn by the staff member on the last day.', confirmationSentAt: new Date() });
  if (!won) throw new Error('This resignation is no longer awaiting confirmation.');
  await createLog(request.guildId, 'RESIGNATION_WITHDRAWN', request.userId, request.userId, { resignationId: String(request.id) });
}

export async function completeResignation(client: Client, request: ResignationRequestDoc) {
  // Claimed first, atomically: a double press cannot run the removal twice.
  const won = await claim('resignation_requests', request.id, { status: 'approved' }, { status: 'accepted', confirmationSentAt: new Date(), reviewedAt: new Date() });
  if (!won) throw new Error('This resignation is no longer awaiting confirmation.');
  const guild = await client.guilds.fetch(request.guildId).catch(() => null);
  const settings = guild ? await getSettings(guild.id).catch(() => null) : null;
  const member = guild ? await guild.members.fetch(request.userId).catch(() => null) : null;
  const stuckRoles: string[] = [];
  if (member && settings && member.id !== guild?.ownerId) {
    for (const roleId of [settings.staffRoleId, settings.onShiftRoleId, settings.leaveRoleId].filter(Boolean)) {
      if (member.roles.cache.has(roleId)) await member.roles.remove(roleId, 'Resignation confirmed').catch(() => { stuckRoles.push(roleId); });
    }
  }
  // Close everything the member still has open, so they stop earning time and receiving weekly reports.
  if (await getActiveShift(request.guildId, request.userId).catch(() => null)) { await endShift(request.guildId, request.userId).catch(() => undefined); suppressAutoStart(request.guildId, request.userId, 24 * 60 * 60 * 1000); }
  const staffRow = await Staff.findOne({ guildId: request.guildId, userId: request.userId }).catch(() => null);
  if (staffRow) { staffRow.active = false; await staffRow.save().catch(() => undefined); }
  // A leave still running must not give the roles back later (its "I came back" button would restore the staff role).
  await closeOpenLeaves(request.guildId, request.userId).catch(() => undefined);
  await createLog(request.guildId, 'RESIGNATION_CONFIRMED', request.userId, request.userId, { resignationId: String(request.id), stuckRoles });
  if (stuckRoles.length) await sendLog(client, request.guildId, `⚠️ <@${request.userId}> completed their resignation but the bot could not remove these roles: ${stuckRoles.map(id => `<@&${id}>`).join(' ')}. Remove them by hand (move the bot role above them).`).catch(() => undefined);
  else await sendLog(client, request.guildId, `🚪 **RESIGNATION COMPLETED**\n<@${request.userId}> — the staff role was removed.`).catch(() => undefined);
  const ar = await isArabic(request.guildId);
  const farewell = new EmbedBuilder().setTitle(ar ? '🚪 اكتملت الاستقالة' : '🚪 Resignation completed').setDescription(stuckRoles.length
    ? (ar ? 'اكتملت استقالتك. تعذّر إزالة بعض الرتب تلقائيًا، وقد أُبلغت الإدارة لإزالتها. شكرًا لك على عملك معنا ونتمنى لك كل التوفيق.' : 'Your resignation has been completed. Some roles could not be removed automatically; management has been told and will remove them. Thank you for your work with us, and we wish you all the best.')
    : (ar ? 'اكتملت استقالتك وأُزيلت رتبة الستاف. شكرًا لك على عملك معنا ونتمنى لك كل التوفيق.' : 'Your resignation has been completed and your staff role was removed. Thank you for your work with us, and we wish you all the best.'));
  return { farewell, stuckRoles };
}
