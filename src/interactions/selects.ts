import { ActionRowBuilder, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, type StringSelectMenuInteraction } from '../lib/djs/index.js';
import { requireSettings } from '../services/settings.service.js';
import { isStaff } from '../utils/permissions.js';
import { Shift } from '../models/Shift.js';
import { suppressAutoStart } from '../services/auto-shift.service.js';
import { activeMs, duration, endShift, ensureStaff, getActiveShift, resumeShift, startBreak, startShift } from '../services/shift.service.js';
import { createLog, sendLog } from '../services/log.service.js';
import { Staff } from '../models/Staff.js';

export async function handleSelectMenu(i: StringSelectMenuInteraction) {
  if (!i.guild) return;
  if (i.customId === 'complaint_panel_staff') {
    const staffUserId = i.values[0];
    if (!staffUserId) return i.reply({ content: 'اختر إداريًا أولًا.', flags: 64 });
    const target = await i.guild.members.fetch(staffUserId).catch(() => null);
    const registered = await Staff.findOne({ guildId: i.guild.id, userId: staffUserId, active: true });
    if (!target || !registered || target.user.bot) return i.reply({ content: 'لا يمكن تقديم البلاغ على هذا العضو.', flags: 64 });
    const modal = new ModalBuilder().setCustomId(`complaint_panel_modal:${staffUserId}`).setTitle('تقديم شكوى');
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('complaint_reason').setLabel('ما المشكلة؟').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)), new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('complaint_evidence').setLabel('الدليل (اختياري)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1500)));
    return i.showModal(modal);
  }
  if (i.customId === 'rating_panel_staff') {
    const staffUserId = i.values[0];
    if (!staffUserId) return i.reply({ content: 'Please select a staff member.', flags: 64 });
    const target = await i.guild.members.fetch(staffUserId).catch(() => null);
    if (!target || !target.roles.cache.has((await requireSettings(i.guild.id)).staffRoleId) || target.user.bot) return i.reply({ content: 'لا يمكن تقييم هذا العضو.', flags: 64 });
    if (target.id === i.user.id) return i.reply({ content: 'لا يمكنك تقييم نفسك.', flags: 64 });
    const modal = new ModalBuilder().setCustomId(`rating_panel_modal:${staffUserId}`).setTitle(`تقييم ${target.displayName}`);
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('rating_score').setLabel('عدد النجوم من 1 إلى 5').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(1)),
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('rating_comment').setLabel('ملاحظة (اختيارية)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000))
    );
    return i.showModal(modal);
  }
  if (i.customId !== 'shift_panel_action') return;
  const member = await i.guild.members.fetch(i.user.id);
  if (!await isStaff(member)) return i.reply({ content: 'Staff only.', flags: 64 });
  const settings = await requireSettings(i.guild.id);
  const action = i.values[0];
  if (action === 'start') {
    const current = await getActiveShift(i.guild.id, i.user.id);
    if (current) return i.reply({ content: '⏱️ لديك شفت نشط بالفعل. أنهِ الشفت الحالي قبل بدء شفت جديد.', flags: 64 });
    await ensureStaff(i.guild.id, i.user.id);
    const shift = await startShift(i.guild.id, i.user.id);
    await member.roles.add(settings.onShiftRoleId, 'Started staff shift');
    await createLog(i.guild.id, 'SHIFT_STARTED', i.user.id, i.user.id, { shiftId: String(shift._id) });
    await sendLog(i.client, i.guild.id, `🟢 **SHIFT STARTED**\n${member}`);
    return i.reply({ content: '✅ بدأ الشفت الخاص بك. هذا الرد لا يظهر إلا لك.', flags: 64 });
  }
  if (action === 'end') {
    const shift = await getActiveShift(i.guild.id, i.user.id);
    if (!shift) return i.reply({ content: 'لا يوجد لديك شفت نشط.', flags: 64 });
    if (activeMs(shift) < 30 * 60 * 1000) return i.reply({ content: `You need at least 30 minutes on shift. Current time: ${duration(activeMs(shift))}.`, flags: 64 });
    const ended = await endShift(i.guild.id, i.user.id);
    suppressAutoStart(i.guild.id, i.user.id);
    await member.roles.remove(settings.onShiftRoleId, 'Ended staff shift');
    await createLog(i.guild.id, 'SHIFT_ENDED', i.user.id, i.user.id, { shiftId: String(ended._id), duration: duration(activeMs(ended)) });
    await sendLog(i.client, i.guild.id, `🔴 **SHIFT ENDED**\n${member} — ${duration(activeMs(ended))}`);
    return i.reply({ content: `✅ انتهى الشفت. المدة: ${duration(activeMs(ended))}`, flags: 64 });
  }
  if (action === 'break') {
    const shift = await getActiveShift(i.guild.id, i.user.id);
    if (!shift) return i.reply({ content: 'لا يوجد لديك شفت نشط.', flags: 64 });
    const current = shift.breaks.at(-1);
    if (current && !current.endedAt) { await resumeShift(i.guild.id, i.user.id); await createLog(i.guild.id, 'BREAK_RESUMED', i.user.id, i.user.id); return i.reply({ content: '▶️ تم استئناف الشفت.', flags: 64 }); }
    await startBreak(i.guild.id, i.user.id); await createLog(i.guild.id, 'BREAK_STARTED', i.user.id, i.user.id); return i.reply({ content: '⏸️ بدأ البريك. اختر نفس الخيار لاستئناف الشفت.', flags: 64 });
  }
  if (action === 'stats') {
    const rows = await Shift.find({ guildId: i.guild.id, userId: i.user.id }).sort({ startedAt: -1 }).limit(10);
    const total = rows.reduce((sum, shift) => sum + activeMs(shift), 0);
    return i.reply({ embeds: [new EmbedBuilder().setColor(0x8175f5).setTitle('📊 My Shift Stats').setDescription(`Total tracked time: **${duration(total)}**\nSessions: **${rows.length}**\nCurrent status: **${rows.some(row => row.status === 'active') ? 'On shift' : 'Available'}**`)], flags: 64 });
  }
  if (action === 'active') {
    const rows = await Shift.find({ guildId: i.guild.id, status: 'active' }).limit(50);
    return i.reply({ content: rows.length ? `🟢 Active shifts:\n${rows.map(row => `<@${row.userId}> — ${duration(activeMs(row))}`).join('\n')}` : 'لا توجد شفتات نشطة حاليًا.', flags: 64 });
  }
}
