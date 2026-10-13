import type { ButtonInteraction, ModalSubmitInteraction } from '../lib/djs/index.js';
import { getSettings } from '../services/settings.service.js';
import { createLog, sendLog } from '../services/log.service.js';
import { isStaff } from '../utils/permissions.js';
import { AdminOnlyError, isAdmin, replyAdminOnly } from './access.js';
import { MIGRATION_HINT, patchRow, schemaReady } from './db.js';
import { cardPayload, postRequestCard, requestSubmittedEmbed } from './cards.js';
import { adminExtendLeave, decideLeaveExtension, requestLeaveExtension } from './extension.js';
import { approveLeaveRequest, earlyReturnPayload, leaveReturnedPayload, rejectLeaveRequest, returnFromLeave } from './lifecycle.js';
import { adminExtendModal, extendModal, leaveModal, myRequestsEmbed, resignationModal } from './panels.js';
import { createLeave, createResignation, findBlockingLeave, findBlockingResignation, findLeave, findResignation } from './requests.js';
import { completeResignation, decideResignation, withdrawResignation } from './resignation.js';
import { gregorianDate, isArabic, leaveEndsAt, parseDay } from './util.js';

// Buttons and forms of the leave / resignation system. Every handler returns true when it handled the interaction.
const starts = (id: string, ...prefixes: string[]) => prefixes.some(prefix => id.startsWith(prefix));
const BUTTON_PREFIXES = ['leave_return:', 'leave_return_confirm:', 'leave_return_cancel:', 'leave_extend:', 'resign_confirm:', 'resign_cancel:', 'leave_ext_approve:', 'leave_ext_reject:', 'leave_admin_extend:', 'leave_approve:', 'leave_reject:', 'resign_approve:', 'resign_reject:'];
const MODAL_PREFIXES = ['leave_extend_modal:', 'leave_admin_extend_modal:'];

// After this, i.update edits the message and i.reply sends a private follow-up, so the handler code stays the same.
async function deferAsUpdate(i: ButtonInteraction) {
  await i.deferUpdate();
  (i as any).update = (options: any) => i.editReply(options);
  (i as any).reply = (options: any) => i.followUp({ ...(typeof options === 'string' ? { content: options } : options), flags: 64 });
}

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);
const closedDms = '⚠️ العضو قافل الخاص، فما وصله إشعار. بلّغه بنفسك.';

export async function handleLeaveButton(i: ButtonInteraction): Promise<boolean> {
  const id = i.customId;
  if (id !== 'requests_mine' && id !== 'leave_request' && id !== 'resignation_request' && !starts(id, ...BUTTON_PREFIXES)) return false;
  if (!await schemaReady()) { await i.reply({ content: MIGRATION_HINT, flags: 64 }).catch(() => undefined); return true; }
  const arg = id.split(':')[1] ?? '';

  // ---- the member's leave buttons (they live in DMs): come back (asks first when it is early) and ask for more time ----
  if (starts(id, 'leave_return:', 'leave_return_confirm:', 'leave_return_cancel:', 'leave_extend:')) {
    const request = await findLeave(arg);
    const ar = request ? await isArabic(request.guildId) : true;
    if (!request || request.userId !== i.user.id || request.status !== 'approved') { await i.reply({ content: 'هذي الإجازة ما عادت فعّالة.', flags: 64 }); return true; }
    const ended = leaveEndsAt(request) <= Date.now();
    if (id.startsWith('leave_return_cancel:')) { await i.update({ content: 'تمام، إجازتك مستمرة لين موعد انتهائها.', embeds: [], components: [] }); return true; }
    if (id.startsWith('leave_extend:')) {
      // The extension button only exists after the leave ended, and this check keeps an old message from being used earlier.
      if (!ended) { await i.reply({ content: 'تقدر تطلب وقت إضافي بعد ما تخلص مدة الإجازة. لو تحتاج وقت قبل كذا كلّم أحد الأدمن.', flags: 64 }); return true; }
      await i.showModal(extendModal(request.id, ar));
      return true;
    }
    // Returning before the end date needs a yes: the confirmation is a separate message so "no" leaves everything untouched.
    if (id.startsWith('leave_return:') && !ended) { await i.reply({ ...earlyReturnPayload(request, ar) }); return true; }
    await deferAsUpdate(i);
    try {
      const result = await returnFromLeave(i.client, request.id, i.user.id, !ended);
      await i.update(leaveReturnedPayload(result.ar, result.rolesOk));
    } catch (error) {
      await i.reply({ content: errorText(error, 'ما قدرنا ننهي الإجازة.'), flags: 64 });
    }
    return true;
  }

  // ---- resignation confirmation on the last working day (DMs) ----
  if (starts(id, 'resign_confirm:', 'resign_cancel:')) {
    const request = await findResignation(arg);
    if (!request || request.userId !== i.user.id || request.status !== 'approved') { await i.reply({ content: 'هذي الاستقالة ما عادت تنتظر تأكيد.', flags: 64 }); return true; }
    try {
      if (id.startsWith('resign_cancel:')) {
        await withdrawResignation(request);
        await i.update({ content: 'تم سحب استقالتك وتبقى معنا في الفريق 💙 لو غيّرت رأيك تقدر تقدّم طلب جديد بأي وقت.', embeds: [], components: [] });
        return true;
      }
      await i.deferUpdate();
      const { farewell } = await completeResignation(i.client, request);
      await i.editReply({ embeds: [farewell], content: '', components: [] });
    } catch (error) {
      const message = errorText(error, 'هذي الاستقالة ما عادت تنتظر تأكيد.');
      if (i.deferred || i.replied) await i.followUp({ content: message, flags: 64 }).catch(() => undefined); else await i.reply({ content: message, flags: 64 }).catch(() => undefined);
    }
    return true;
  }

  // Everything below happens in a server.
  if (!i.guild) { await i.reply({ content: 'هذا داخل السيرفر فقط.', flags: 64 }); return true; }
  const guild = i.guild;
  const settings = await getSettings(guild.id).catch(() => null);
  const ar = settings?.botLanguage === 'ar';

  if (id === 'requests_mine') {
    await i.reply({ embeds: [await myRequestsEmbed(guild.id, i.user.id, ar)], flags: 64 });
    return true;
  }

  if (id === 'leave_request' || id === 'resignation_request') {
    const member = await guild.members.fetch(i.user.id).catch(() => null);
    if (!member || !await isStaff(member)) { await i.reply({ content: 'هذا للستاف فقط.', flags: 64 }); return true; }
    if (id === 'leave_request') {
      if (await findBlockingLeave(guild.id, i.user.id)) { await i.reply({ content: 'عندك طلب إجازة مفتوح. انتظر لين ينرفض أو يخلص.', flags: 64 }); return true; }
      await i.showModal(leaveModal('ar'));
      return true;
    }
    if (await findBlockingResignation(guild.id, i.user.id)) { await i.reply({ content: 'عندك طلب استقالة مفتوح. انتظر لين ينرد عليه.', flags: 64 }); return true; }
    await i.showModal(resignationModal('ar'));
    return true;
  }

  // ---- administrator buttons ----
  const member = await guild.members.fetch(i.user.id).catch(() => null);
  if (!member || !isAdmin(member)) { await replyAdminOnly(i); return true; }
  if (!arg) { await i.reply({ content: 'الطلب غير صالح.', flags: 64 }); return true; }

  if (starts(id, 'leave_ext_approve:', 'leave_ext_reject:')) {
    const approve = id.startsWith('leave_ext_approve:');
    await deferAsUpdate(i);
    try {
      const askedAt = Number(id.split(':')[2]) || undefined;
      const result = await decideLeaveExtension(i.client, arg, approve ? 'approved' : 'rejected', { id: i.user.id }, guild.id, askedAt);
      await sendLog(i.client, guild.id, `${approve ? '✅ **تمت الموافقة على تمديد إجازة**' : '❌ **تم رفض تمديد إجازة**'}\nبواسطة <@${i.user.id}> — تنتهي ${gregorianDate(result.endDate)}`).catch(() => undefined);
      await i.update({ content: approve ? '✅ تمت الموافقة على تمديد الإجازة.' : '❌ تم رفض تمديد الإجازة.', components: [] });
    } catch (error) {
      if (error instanceof AdminOnlyError) await replyAdminOnly(i); else await i.reply({ content: errorText(error, 'ما قدرنا نبت في هذا الطلب.'), flags: 64 });
    }
    return true;
  }

  if (id.startsWith('leave_admin_extend:')) {
    await i.showModal(adminExtendModal(arg));
    return true;
  }

  if (starts(id, 'leave_approve:', 'leave_reject:')) {
    const existing = await findLeave(arg);
    if (existing && existing.guildId !== guild.id) { await i.reply({ content: 'هذا الطلب تابع لسيرفر ثاني.', flags: 64 }); return true; }
    await deferAsUpdate(i);
    try {
      const card = { channelId: i.channelId, messageId: i.message.id };
      const approve = id.startsWith('leave_approve:');
      const result = approve ? await approveLeaveRequest(i.client, arg, { id: i.user.id }, '', card) : await rejectLeaveRequest(i.client, arg, { id: i.user.id }, '', card);
      const warnings = [
        'rolesUpdated' in result && !result.rolesUpdated ? '⚠️ ما قدرنا نعدّل رتب الإجازة. تأكد من صلاحية إدارة الرتب وترتيب رتبة البوت.' : '',
        result.dmSent ? '' : closedDms,
      ].filter(Boolean).join('\n');
      await i.update({ ...(await cardPayload(i.client, 'leave', result.request)), content: warnings });
    } catch (error) {
      if (error instanceof AdminOnlyError) await replyAdminOnly(i); else await i.reply({ content: errorText(error, 'ما قدرنا نبت في هذا الطلب.'), flags: 64 });
    }
    return true;
  }

  if (starts(id, 'resign_approve:', 'resign_reject:')) {
    const existing = await findResignation(arg);
    if (!existing || existing.guildId !== guild.id || existing.status !== 'pending') { await i.reply({ content: 'هذا الطلب ما عاد معلّق.', flags: 64 }); return true; }
    await deferAsUpdate(i);
    try {
      const approve = id.startsWith('resign_approve:');
      const result = await decideResignation(i.client, arg, approve ? 'approved' : 'rejected', { id: i.user.id }, '', { channelId: i.channelId, messageId: i.message.id }, guild.id);
      await i.update({ ...(await cardPayload(i.client, 'resignation', result.request)), content: result.dmSent ? '' : closedDms });
    } catch (error) {
      if (error instanceof AdminOnlyError) await replyAdminOnly(i); else await i.reply({ content: errorText(error, 'ما قدرنا نبت في هذا الطلب.'), flags: 64 });
    }
    return true;
  }

  return false;
}

// ---- forms -------------------------------------------------------------------------------------------
// A member can only ASK to extend their own approved leave. Nothing changes until an administrator approves.
async function handleLeaveExtension(i: ModalSubmitInteraction) {
  const request = await findLeave(i.customId.split(':')[1]);
  if (!request || request.userId !== i.user.id || request.status !== 'approved') return i.reply({ content: 'هذي الإجازة ما عادت فعّالة.', flags: 64 });
  if (i.guild && request.guildId !== i.guild.id) return i.reply({ content: 'هذي الإجازة تابعة لسيرفر ثاني.', flags: 64 });
  // Asking for more time exists only once the leave period is over.
  if (leaveEndsAt(request) > Date.now()) return i.reply({ content: 'تقدر تطلب وقت إضافي بعد ما تخلص مدة الإجازة. قبل كذا كلّم أحد الأدمن.', flags: 64 });
  let endDate: Date;
  try { endDate = parseDay(i.fields.getTextInputValue('end_date')); } catch (error) { return i.reply({ content: errorText(error, 'التاريخ غير صحيح.'), flags: 64 }); }
  if (endDate.getTime() <= new Date(request.endDate).getTime()) return i.reply({ content: 'التاريخ الجديد لازم يكون بعد تاريخ الانتهاء الحالي.', flags: 64 });
  try {
    const { posted } = await requestLeaveExtension(i.client, request, endDate);
    return i.reply({ content: posted ? `✅ انرسل طلب تمديد إجازتك لين ${gregorianDate(endDate)}. ما يتغير شي إلا إذا وافق أدمن.` : '⚠️ انحفظ طلبك، بس ما فيه قناة طلبات محددة فما انبلّغ أحد. كلّم أحد الأدمن.', flags: 64 });
  } catch (error) {
    return i.reply({ content: errorText(error, 'ما قدرنا نرسل الطلب.'), flags: 64 });
  }
}

// An administrator extends a running leave directly (for example when the member asked in person).
async function handleAdminLeaveExtend(i: ModalSubmitInteraction) {
  const member = i.guild ? await i.guild.members.fetch(i.user.id).catch(() => null) : null;
  if (!i.guild || !member || !isAdmin(member)) return replyAdminOnly(i);
  const id = i.customId.split(':')[1];
  if (!id) return i.reply({ content: 'الطلب غير صالح.', flags: 64 });
  let endDate: Date;
  try { endDate = parseDay(i.fields.getTextInputValue('end_date')); } catch (error) { return i.reply({ content: errorText(error, 'التاريخ غير صحيح.'), flags: 64 }); }
  try {
    const result = await adminExtendLeave(i.client, id, endDate, { id: i.user.id }, i.fields.getTextInputValue('note').trim(), i.guild.id);
    return i.reply({ content: `✅ تم تمديد الإجازة لين ${gregorianDate(endDate)}.${result.dmSent ? '' : '\n⚠️ العضو قافل الخاص، فما وصله الخبر. بلّغه بنفسك.'}`, flags: 64 });
  } catch (error) {
    if (error instanceof AdminOnlyError) return replyAdminOnly(i);
    return i.reply({ content: errorText(error, 'ما قدرنا نمدد الإجازة.'), flags: 64 });
  }
}

async function submitLeave(i: ModalSubmitInteraction) {
  if (!i.guild) return i.reply({ content: 'هذا داخل السيرفر فقط.', flags: 64 });
  const settings = await getSettings(i.guild.id).catch(() => null);
  const ar = settings?.botLanguage === 'ar';
  const member = await i.guild.members.fetch(i.user.id).catch(() => null);
  if (!member || !await isStaff(member)) return i.reply({ content: 'هذا للستاف فقط.', flags: 64 });
  if (await findBlockingLeave(i.guild.id, i.user.id)) return i.reply({ content: 'عندك طلب إجازة مفتوح. تقدر تقدّم طلب ثاني بس بعد ما ينرفض أو يخلص.', flags: 64 });
  let startDate: Date; let endDate: Date;
  try {
    startDate = parseDay(i.fields.getTextInputValue('start'));
    endDate = parseDay(i.fields.getTextInputValue('end'));
  } catch (error) { return i.reply({ content: errorText(error, 'التاريخ غير صحيح. اكتبه بصيغة سنة-شهر-يوم.'), flags: 64 }); }
  if (endDate.getTime() < startDate.getTime()) return i.reply({ content: 'تاريخ النهاية لازم يكون بعد تاريخ البداية.', flags: 64 });
  const reason = i.fields.getTextInputValue('reason').trim();
  if (!reason) return i.reply({ content: 'اكتب سبب الإجازة.', flags: 64 });
  await i.deferReply({ flags: 64 });
  try {
    const request = await createLeave({ guildId: i.guild.id, userId: i.user.id, startDate, endDate, reason });
    const dm = await i.user.createDM().catch(() => null);
    const dmMessage = dm ? await dm.send({ embeds: [requestSubmittedEmbed('leave', request, ar)] }).catch(() => null) : null;
    if (dmMessage) await patchRow('leave_requests', request.id, { dmMessageId: dmMessage.id });
    await createLog(i.guild.id, 'LEAVE_REQUESTED', i.user.id, i.user.id, { leaveId: String(request.id) });
    await sendLog(i.client, i.guild.id, `🏖️ **طلب إجازة جديد**\n${i.user} — ${gregorianDate(startDate)} ← ${gregorianDate(endDate)}`).catch(() => undefined);
    const posted = await postRequestCard(i.client, 'leave', request);
    return i.editReply({ content: posted ? '✅ انرسل طلب إجازتك للإدارة عشان يراجعونه.' : '⚠️ انحفظ طلبك، بس ما فيه قناة طلبات محددة فما انبلّغت الإدارة. نبّه أحد الأدمن.' });
  } catch (error) {
    return i.editReply({ content: errorText(error, 'ما قدرنا نرسل الطلب.') });
  }
}

async function submitResignation(i: ModalSubmitInteraction) {
  if (!i.guild) return i.reply({ content: 'هذا داخل السيرفر فقط.', flags: 64 });
  const settings = await getSettings(i.guild.id).catch(() => null);
  const ar = settings?.botLanguage === 'ar';
  const member = await i.guild.members.fetch(i.user.id).catch(() => null);
  if (!member || !await isStaff(member)) return i.reply({ content: 'هذا للستاف فقط.', flags: 64 });
  if (await findBlockingResignation(i.guild.id, i.user.id)) return i.reply({ content: 'عندك طلب استقالة مفتوح. تقدر تقدّم طلب ثاني بس بعد ما ينرفض.', flags: 64 });
  let lastDay: Date;
  try { lastDay = parseDay(i.fields.getTextInputValue('last_day')); } catch (error) { return i.reply({ content: errorText(error, 'التاريخ غير صحيح. اكتبه بصيغة سنة-شهر-يوم.'), flags: 64 }); }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const latestAllowed = new Date(today); latestAllowed.setFullYear(latestAllowed.getFullYear() + 1);
  if (lastDay < today || lastDay > latestAllowed) return i.reply({ content: 'آخر يوم عمل لازم يكون بين اليوم وسنة من اليوم.', flags: 64 });
  const reason = i.fields.getTextInputValue('reason').trim();
  if (!reason) return i.reply({ content: 'اكتب سبب الاستقالة.', flags: 64 });
  const notes = i.fields.getTextInputValue('notes').trim();
  await i.deferReply({ flags: 64 });
  try {
    const request = await createResignation({ guildId: i.guild.id, userId: i.user.id, lastWorkingDay: lastDay, reason, notes });
    const dm = await i.user.createDM().catch(() => null);
    const dmMessage = dm ? await dm.send({ embeds: [requestSubmittedEmbed('resignation', request, ar)] }).catch(() => null) : null;
    if (dmMessage) await patchRow('resignation_requests', request.id, { dmMessageId: dmMessage.id });
    await createLog(i.guild.id, 'RESIGNATION_REQUESTED', i.user.id, i.user.id, { resignationId: String(request.id) });
    await sendLog(i.client, i.guild.id, `🚪 **طلب استقالة جديد**\n${i.user} — آخر يوم عمل: ${gregorianDate(lastDay)}`).catch(() => undefined);
    const posted = await postRequestCard(i.client, 'resignation', request);
    return i.editReply({ content: posted ? '✅ انرسل طلب استقالتك للإدارة عشان يراجعونه.' : '⚠️ انحفظ طلبك، بس ما فيه قناة طلبات محددة فما انبلّغت الإدارة. نبّه أحد الأدمن.' });
  } catch (error) {
    return i.editReply({ content: errorText(error, 'ما قدرنا نرسل الطلب.') });
  }
}

export async function handleLeaveModal(i: ModalSubmitInteraction): Promise<boolean> {
  const id = i.customId;
  if (id !== 'leave_modal' && id !== 'resignation_modal' && !starts(id, ...MODAL_PREFIXES)) return false;
  if (!await schemaReady()) { await i.reply({ content: MIGRATION_HINT, flags: 64 }).catch(() => undefined); return true; }
  if (id.startsWith('leave_extend_modal:')) await handleLeaveExtension(i);
  else if (id.startsWith('leave_admin_extend_modal:')) await handleAdminLeaveExtend(i);
  else if (id === 'leave_modal') await submitLeave(i);
  else await submitResignation(i);
  return true;
}
