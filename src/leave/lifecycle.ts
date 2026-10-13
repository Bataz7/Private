import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type Client } from '../lib/djs/index.js';
import { supabase } from '../supabase/client.js';
import { Staff } from '../models/Staff.js';
import { LeaveRequest, type LeaveRequestDoc } from '../models/LeaveRequest.js';
import { getSettings } from '../services/settings.service.js';
import { createLog, sendLog } from '../services/log.service.js';
import { assertAdministrator } from './access.js';
import { claim, patchRow } from './db.js';
import { findLeave } from './requests.js';
import { refreshRequestCard, sendDecisionDm } from './cards.js';
import { clip, gregorianDate, isArabic, leaveEndsAt, stamp, DAY_MS } from './util.js';

// The life of a leave, as the member lives it in DMs:
//   approved  -> a NEW message with the "I came back" button (editing an old message never notifies anyone)
//   pressed early -> "are you sure you want to return before the end date?" (yes / no)
//   end date passes -> a message with "I came back" and "I need more time"; repeated daily until answered
//   more time -> only a request: an administrator decides (or extends directly when the member asks in person)
const T = {
  approvedTitle: { ar: '🏖️ تمت الموافقة على إجازتك', en: '🏖️ Your leave was approved' },
  approvedBody: { ar: 'وافقت الإدارة على طلب إجازتك. نتمنى لك وقتًا طيبًا.', en: 'Management approved your leave request. Enjoy your time off.' },
  startedTitle: { ar: '🏖️ بدأت إجازتك', en: '🏖️ Your leave has started' },
  startedBody: { ar: 'بدأت إجازتك اليوم. اضغط الزر أدناه عندما ترجع.', en: 'Your leave started today. Press the button below when you are back.' },
  rejectedTitle: { ar: '🏖️ لم تتم الموافقة على إجازتك', en: '🏖️ Your leave request was not approved' },
  rejectedBody: { ar: 'اطلعت الإدارة على طلبك ولم توافق عليه هذه المرة.', en: 'Management reviewed your request and did not approve it this time.' },
  period: { ar: '📅 فترة الإجازة', en: '📅 Leave period' },
  status: { ar: '📊 الحالة', en: '📊 Status' },
  onLeave: { ar: 'في إجازة الآن', en: 'On leave now' },
  startsIn: { ar: 'تبدأ {when}', en: 'Starts {when}' },
  note: { ar: '💬 ملاحظة الإدارة', en: '💬 Management note' },
  reason: { ar: '📝 السبب', en: '📝 Reason' },
  howTitle: { ar: '↩️ عند رجوعك', en: '↩️ When you are back' },
  howBody: { ar: 'اضغط **رجعت من الإجازة**. لو ضغطته قبل انتهاء الإجازة سيُطلب منك التأكيد.', en: 'Press **I came back**. If you press it before your leave ends you will be asked to confirm.' },
  came: { ar: 'رجعت من الإجازة', en: 'I came back' },
  yes: { ar: 'نعم، رجعت الآن', en: 'Yes, I am back' },
  no: { ar: 'لا، أكمل إجازتي', en: 'No, keep my leave' },
  moreTime: { ar: 'أحتاج وقتًا أطول', en: 'I need more time' },
  confirmTitle: { ar: '⚠️ هل أنت متأكد من الرجوع الآن؟', en: '⚠️ Are you sure you want to return now?' },
  confirmBody: { ar: 'إجازتك تنتهي في **{end}**. إذا رجعت الآن ستُغلق الإجازة وتعود رتبك.', en: 'Your leave ends on **{end}**. If you return now the leave closes and your roles come back.' },
  endedTitle: { ar: '⏰ انتهت فترة إجازتك', en: '⏰ Your leave period has ended' },
  endedBody: { ar: 'هل رجعت؟ أم تحتاج وقتًا أطول؟ التمديد طلب يقرره الأدمن، ولن يتغير شيء قبل موافقته.', en: 'Have you returned, or do you need more time? An extension is a request: an administrator decides, and nothing changes until they approve.' },
  backTitle: { ar: '🟢 أهلًا بعودتك', en: '🟢 Welcome back' },
  backBody: { ar: 'أُغلقت إجازتك وعادت رتبك.', en: 'Your leave is closed and your roles are back.' },
  backWarn: { ar: 'تعذّر تغيير بعض الرتب. اطلب من الإدارة مراجعتها.', en: 'Some roles could not be changed. Ask management to check them.' },
  extendedTitle: { ar: '🔁 تم تمديد إجازتك', en: '🔁 Your leave was extended' },
  extendedBody: { ar: 'إجازتك الآن تنتهي في **{end}**.', en: 'Your leave now ends on **{end}**.' },
  extensionNo: { ar: '❌ لم يتم قبول طلب التمديد. تنتهي إجازتك في تاريخها الأصلي.', en: '❌ Your extension request was not approved. Your leave ends on its original date.' },
  footer: { ar: 'إدارة الطاقم', en: 'Staff management' },
} as const;
type Key = keyof typeof T;
const say = (ar: boolean, key: Key, vars: Record<string, string> = {}) => T[key][ar ? 'ar' : 'en'].replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? '');
const cameButton = (id: number | string, ar: boolean) => new ButtonBuilder().setCustomId(`leave_return:${id}`).setLabel(say(ar, 'came')).setEmoji('🟢').setStyle(ButtonStyle.Success);
const row = (...buttons: ButtonBuilder[]) => new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);
const periodField = (r: LeaveRequestDoc, ar: boolean) => ({ name: say(ar, 'period'), value: `${stamp(r.startDate)} → ${stamp(r.endDate)}`, inline: true });

// ---- message builders (pure) --------------------------------------------------------------------
export function leaveApprovedPayload(r: LeaveRequestDoc, ar: boolean, kind: 'approved' | 'started' = 'approved') {
  const started = new Date(r.startDate).getTime() <= Date.now();
  const embed = new EmbedBuilder().setTitle(say(ar, kind === 'started' ? 'startedTitle' : 'approvedTitle')).setDescription(say(ar, kind === 'started' ? 'startedBody' : 'approvedBody'))
    .addFields(periodField(r, ar), { name: say(ar, 'status'), value: started ? say(ar, 'onLeave') : say(ar, 'startsIn', { when: stamp(r.startDate, 'R') }), inline: true });
  if (r.decisionNote) embed.addFields({ name: say(ar, 'note'), value: clip(r.decisionNote, 1000) });
  embed.addFields({ name: say(ar, 'howTitle'), value: say(ar, 'howBody') }).setFooter({ text: say(ar, 'footer') }).setTimestamp();
  return { embeds: [embed], components: [row(cameButton(r.id, ar))] };
}

export function leaveRejectedPayload(r: LeaveRequestDoc, ar: boolean) {
  const embed = new EmbedBuilder().setTitle(say(ar, 'rejectedTitle')).setDescription(say(ar, 'rejectedBody')).addFields(periodField(r, ar), { name: say(ar, 'reason'), value: clip(r.reason || '—', 1000) });
  if (r.decisionNote) embed.addFields({ name: say(ar, 'note'), value: clip(r.decisionNote, 1000) });
  return { embeds: [embed.setFooter({ text: say(ar, 'footer') }).setTimestamp()], components: [] as never[] };
}

export function leaveEndedPayload(r: LeaveRequestDoc, ar: boolean) {
  const embed = new EmbedBuilder().setTitle(say(ar, 'endedTitle')).setDescription(say(ar, 'endedBody'))
    .addFields({ name: say(ar, 'period'), value: `${stamp(r.startDate)} → ${stamp(r.endDate)}`, inline: false }).setFooter({ text: say(ar, 'footer') }).setTimestamp();
  // The extension button exists only here, after the leave period has ended.
  return { embeds: [embed], components: [row(cameButton(r.id, ar), new ButtonBuilder().setCustomId(`leave_extend:${r.id}`).setLabel(say(ar, 'moreTime')).setEmoji('🔁').setStyle(ButtonStyle.Primary))] };
}

export function earlyReturnPayload(r: LeaveRequestDoc, ar: boolean) {
  const embed = new EmbedBuilder().setTitle(say(ar, 'confirmTitle')).setDescription(say(ar, 'confirmBody', { end: gregorianDate(r.endDate) }));
  return { embeds: [embed], components: [row(new ButtonBuilder().setCustomId(`leave_return_confirm:${r.id}`).setLabel(say(ar, 'yes')).setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId(`leave_return_cancel:${r.id}`).setLabel(say(ar, 'no')).setStyle(ButtonStyle.Secondary))] };
}

export function leaveReturnedPayload(ar: boolean, rolesOk: boolean) {
  const embed = new EmbedBuilder().setTitle(say(ar, 'backTitle')).setDescription(say(ar, 'backBody') + (rolesOk ? '' : `\n\n⚠️ ${say(ar, 'backWarn')}`));
  return { embeds: [embed], components: [] as never[] };
}

export function leaveExtendedPayload(r: LeaveRequestDoc, ar: boolean) {
  const embed = new EmbedBuilder().setTitle(say(ar, 'extendedTitle')).setDescription(say(ar, 'extendedBody', { end: gregorianDate(r.endDate) }));
  if (r.decisionNote) embed.addFields({ name: say(ar, 'note'), value: clip(r.decisionNote, 1000) });
  return { embeds: [embed.setFooter({ text: say(ar, 'footer') }).setTimestamp()], components: [row(cameButton(r.id, ar))] };
}

export const extensionRejectedText = (ar: boolean) => say(ar, 'extensionNo');

// ---- sending -------------------------------------------------------------------------------------
export async function warnManagement(client: Client, guildId: string, text: string) { await sendLog(client, guildId, text).catch(() => undefined); }

async function restoreRoles(client: Client, request: LeaveRequestDoc, reason: string) {
  const guild = await client.guilds.fetch(request.guildId).catch(() => null);
  const member = guild ? await guild.members.fetch(request.userId).catch(() => null) : null;
  const settings = await getSettings(request.guildId).catch(() => null);
  if (!guild || !member) return { ok: false, member: null };
  if (member.id === guild.ownerId) return { ok: true, member };
  let ok = true;
  try { if (settings?.leaveRoleId && member.roles.cache.has(settings.leaveRoleId)) await member.roles.remove(settings.leaveRoleId, reason); } catch { ok = false; }
  // Staff who were removed or resigned while on leave must not get their staff role back by pressing "I came back".
  const staffRow = await Staff.findOne({ guildId: request.guildId, userId: request.userId }).catch(() => null);
  if (staffRow && !staffRow.active) return { ok, member };
  for (const roleId of request.previousRoleIds || []) { try { await member.roles.add(roleId, reason); } catch { ok = false; } }
  return { ok, member };
}

// ---- decisions (administrators) ------------------------------------------------------------------
export async function approveLeaveRequest(client: Client, id: number | string, reviewer: { id: string }, note = '', card?: { channelId: string; messageId: string }) {
  const request = await findLeave(id);
  if (!request) throw new Error('Leave request not found.');
  // The second lock, before anything changes, whichever button or route called this.
  await assertAdministrator(client, request.guildId, reviewer.id);
  if (request.status !== 'pending') throw new Error(`This request is already ${request.status}.`);
  if (request.userId === reviewer.id) throw new Error('You cannot review your own request.');
  const settings = await getSettings(request.guildId).catch(() => null);
  if (!settings?.leaveRoleId) throw new Error('On Leave role is not configured.');
  const guild = await client.guilds.fetch(request.guildId).catch(() => null);
  const member = guild ? await guild.members.fetch(request.userId).catch(() => null) : null;
  if (!guild || !member) throw new Error('Discord member not found.');
  const previousRoleIds = [settings.staffRoleId, settings.managementRoleId].filter(Boolean).filter(roleId => member.roles.cache.has(roleId as string)) as string[];
  const startsNow = new Date(request.startDate).getTime() <= Date.now();
  // `status: pending` in the match makes the decision atomic: two administrators cannot both win.
  const won = await claim('leave_requests', request.id, { status: 'pending' }, {
    previousRoleIds, leaveRoleId: settings.leaveRoleId, status: 'approved', decisionNote: note.slice(0, 1000), reviewedBy: reviewer.id, reviewedAt: new Date(),
    // activatedAt marks a leave that already started, so the watchdog does not start it (and message) a second time.
    activatedAt: startsNow ? new Date() : null, ...(card ? { reviewChannelId: card.channelId, reviewMessageId: card.messageId } : {}),
  });
  const updated = won ? await findLeave(request.id) : null;
  if (!updated) throw new Error('This request was already decided.');
  let rolesUpdated = true;
  if (startsNow && member.id !== guild.ownerId) {
    for (const roleId of previousRoleIds) await member.roles.remove(roleId, 'Staff leave approved').catch(() => { rolesUpdated = false; });
    await member.roles.add(settings.leaveRoleId, 'Staff leave approved').catch(() => { rolesUpdated = false; });
  }
  await createLog(request.guildId, 'LEAVE_APPROVED', request.userId, reviewer.id, { leaveId: String(request.id), startDate: gregorianDate(request.startDate), endDate: gregorianDate(request.endDate) });
  await warnManagement(client, request.guildId, `🏖️ **LEAVE APPROVED**\n<@${request.userId}> — ${stamp(request.startDate)} → ${stamp(request.endDate)} · by <@${reviewer.id}>`);
  const ar = await isArabic(request.guildId);
  const dmSent = await sendDecisionDm(client, updated, leaveApprovedPayload(updated, ar), 'leave', ar);
  if (!dmSent) await warnManagement(client, request.guildId, `⚠️ Could not DM <@${request.userId}> about the approved leave (their DMs are closed). Tell them yourself.`);
  await refreshRequestCard(client, 'leave', updated);
  return { request: updated, rolesUpdated, dmSent };
}

export async function rejectLeaveRequest(client: Client, id: number | string, reviewer: { id: string }, note = '', card?: { channelId: string; messageId: string }) {
  const request = await findLeave(id);
  if (!request) throw new Error('Leave request not found.');
  await assertAdministrator(client, request.guildId, reviewer.id);
  if (request.status !== 'pending') throw new Error(`This request is already ${request.status}.`);
  if (request.userId === reviewer.id) throw new Error('You cannot review your own request.');
  const won = await claim('leave_requests', request.id, { status: 'pending' }, { status: 'rejected', decisionNote: note.slice(0, 1000), reviewedBy: reviewer.id, reviewedAt: new Date(), ...(card ? { reviewChannelId: card.channelId, reviewMessageId: card.messageId } : {}) });
  const updated = won ? await findLeave(request.id) : null;
  if (!updated) throw new Error('This request was already decided.');
  await createLog(request.guildId, 'LEAVE_REJECTED', request.userId, reviewer.id, { leaveId: String(request.id) });
  await warnManagement(client, request.guildId, `❌ **LEAVE REJECTED**\n<@${request.userId}> by <@${reviewer.id}>`);
  const ar = await isArabic(request.guildId);
  const dmSent = await sendDecisionDm(client, updated, leaveRejectedPayload(updated, ar), 'leave', ar);
  await refreshRequestCard(client, 'leave', updated);
  return { request: updated, dmSent };
}

// ---- the member coming back ----------------------------------------------------------------------
export async function returnFromLeave(client: Client, id: number | string, memberId: string, early: boolean) {
  const request = await findLeave(id);
  if (!request || request.userId !== memberId || request.status !== 'approved') throw new Error('This leave is not active.');
  const won = await claim('leave_requests', request.id, { status: 'approved' }, { status: 'returned', returnedAt: new Date(), extensionEndDate: null, extensionRequestedAt: null });
  const closed = won ? await findLeave(request.id) : null;
  if (!closed) throw new Error('This leave is not active.');
  const { ok } = await restoreRoles(client, request, early ? 'Returned early from leave' : 'Returned from leave');
  await createLog(request.guildId, 'RETURNED_FROM_LEAVE', request.userId, request.userId, { leaveId: String(request.id), early });
  await warnManagement(client, request.guildId, `${early ? '🟢 **RETURNED EARLY FROM LEAVE**' : '🟢 **RETURNED FROM LEAVE**'}\n<@${request.userId}>`);
  await refreshRequestCard(client, 'leave', closed);
  return { request: closed, rolesOk: ok, ar: await isArabic(request.guildId) };
}

/** An administrator closes a running leave (the member cannot press the button: DMs closed, forgot, or left). */
export async function closeLeaveByAdmin(client: Client, id: number | string, actor: { id: string }, guildId?: string) {
  const request = await findLeave(id);
  if (!request || (guildId && request.guildId !== guildId)) throw new Error('Leave request not found.');
  await assertAdministrator(client, request.guildId, actor.id);
  if (request.status !== 'approved') throw new Error('Only a running leave can be closed.');
  const won = await claim('leave_requests', request.id, { status: 'approved' }, { status: 'returned', returnedAt: new Date(), extensionEndDate: null, extensionRequestedAt: null });
  const closed = won ? await findLeave(request.id) : null;
  if (!closed) throw new Error('This leave is not active.');
  const { ok } = await restoreRoles(client, request, 'Leave closed by an administrator');
  await createLog(request.guildId, 'LEAVE_CLOSED_BY_ADMIN', request.userId, actor.id, { leaveId: String(request.id) });
  await warnManagement(client, request.guildId, `🟢 **LEAVE CLOSED**\n<@${request.userId}> by <@${actor.id}>`);
  const ar = await isArabic(request.guildId);
  const user = await client.users.fetch(request.userId).catch(() => null);
  const dmSent = user ? await user.send({ ...leaveReturnedPayload(ar, ok), allowedMentions: { parse: [] } }).then(() => true, () => false) : false;
  await refreshRequestCard(client, 'leave', closed);
  return { request: closed, rolesOk: ok, dmSent };
}

// ---- watchdog: scheduled start, end-of-leave message ---------------------------------------------
export async function runLeaveWatchdog(client: Client) {
  const requests = await LeaveRequest.find({ status: 'approved' });
  const now = Date.now();
  const languages = new Map<string, boolean>();
  for (const request of requests) {
    const guild = await client.guilds.fetch(request.guildId).catch(() => null);
    const member = guild ? await guild.members.fetch(request.userId).catch(() => null) : null;
    if (!guild || !member) continue;
    if (!languages.has(request.guildId)) languages.set(request.guildId, await isArabic(request.guildId));
    const ar = languages.get(request.guildId)!;
    // Scheduled leave that starts today: swap the roles once and tell the member (with the button).
    if (new Date(request.startDate).getTime() <= now && !request.activatedAt) {
      const settings = await getSettings(request.guildId).catch(() => null);
      const claimed = await claim('leave_requests', request.id, { status: 'approved', activatedAt: null }, { activatedAt: new Date() });
      if (!claimed) continue;
      if (settings?.leaveRoleId && member.id !== guild.ownerId) {
        for (const roleId of request.previousRoleIds || []) await member.roles.remove(roleId, 'Scheduled leave started').catch(() => undefined);
        await member.roles.add(settings.leaveRoleId, 'Scheduled leave started').catch(() => undefined);
      }
      await createLog(request.guildId, 'LEAVE_STARTED', request.userId, client.user?.id || null, { leaveId: String(request.id) });
      await member.send({ ...leaveApprovedPayload(request, ar, 'started'), allowedMentions: { parse: [] } }).catch(() => undefined);
    }
    if (leaveEndsAt(request) > now) continue;
    // The leave period is over: ask (again, once a day) whether they came back or want more time.
    const last = request.endReminderAt ? new Date(request.endReminderAt).getTime() : 0;
    const tried = request.endReminderTriedAt ? new Date(request.endReminderTriedAt).getTime() : 0;
    if (last && now - last < DAY_MS) continue;
    if (tried && now - tried < 6 * 60 * 60 * 1000) continue;
    const sent = await member.send({ ...leaveEndedPayload(request, ar), allowedMentions: { parse: [] } }).then(() => true, () => false);
    if (sent) {
      const count = (request.endReminderCount || 0) + 1;
      await patchRow('leave_requests', request.id, { endReminderAt: new Date(), endReminderTriedAt: null, endReminderCount: count });
      if (count === 3) await warnManagement(client, request.guildId, `⚠️ <@${request.userId}>'s leave ended ${stamp(request.endDate, 'R')} and they still have not answered the reminders. Check with them or extend the leave from the Leaves page.`);
    } else {
      // Do not pretend it was sent: try again in 6 hours, and tell management once.
      await patchRow('leave_requests', request.id, { endReminderTriedAt: new Date() });
      if (!tried) await warnManagement(client, request.guildId, `⚠️ <@${request.userId}>'s leave has ended but their DMs are closed, so the reminder was not delivered.`);
    }
  }
}

/** Closes the leaves of someone who is leaving the team (removed or resigned), so no later button gives their roles back. */
export async function closeOpenLeaves(guildId: string, userId: string) {
  const now = new Date().toISOString();
  const closed = await supabase.from('leave_requests').update({ status: 'returned', returned_at: now, extension_end_date: null, extension_requested_at: null }).eq('guild_id', guildId).eq('user_id', userId).eq('status', 'approved');
  if (closed.error) throw new Error(closed.error.message);
  const rejected = await supabase.from('leave_requests').update({ status: 'rejected', reviewed_at: now, decision_note: 'The member left the team.' }).eq('guild_id', guildId).eq('user_id', userId).eq('status', 'pending');
  if (rejected.error) throw new Error(rejected.error.message);
}
