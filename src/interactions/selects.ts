import { ActionRowBuilder, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, type StringSelectMenuInteraction } from '../lib/djs/index.js';
import { requireSettings } from '../services/settings.service.js';
import { isStaff } from '../utils/permissions.js';
import { Shift } from '../models/Shift.js';
import { shiftAutoKind, suppressAutoStart } from '../services/auto-shift.service.js';
import { activeMs, duration, endShift, ensureStaff, getActiveShift, resumeShift, startBreak, startShift } from '../services/shift.service.js';
import { createLog, sendLog } from '../services/log.service.js';
import { Staff } from '../models/Staff.js';
import { rtl } from '../utils/v2.js';
import { slashName } from '../i18n/commands.js';

export async function handleSelectMenu(i: StringSelectMenuInteraction) {
  if (!i.guild) return;
  if (i.customId === 'complaint_panel_staff') {
    const staffUserId = i.values[0];
    if (!staffUserId) return i.reply({ content: 'اختر إداري أول.', flags: 64 });
    const target = await i.guild.members.fetch(staffUserId).catch(() => null);
    const registered = await Staff.findOne({ guildId: i.guild.id, userId: staffUserId, active: true });
    if (!target || !registered || target.user.bot) return i.reply({ content: 'ما ينفع تشتكي على هذا العضو.', flags: 64 });
    const modal = new ModalBuilder().setCustomId(`complaint_panel_modal:${staffUserId}`).setTitle('تقديم شكوى');
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('complaint_reason').setLabel('وش المشكلة؟').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)), new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('complaint_evidence').setLabel('الدليل (اختياري)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1500)));
    return i.showModal(modal);
  }
  if (i.customId === 'rating_panel_staff') {
    const staffUserId = i.values[0];
    if (!staffUserId) return i.reply({ content: 'اختر إداري لو سمحت.', flags: 64 });
    const target = await i.guild.members.fetch(staffUserId).catch(() => null);
    if (!target || !target.roles.cache.has((await requireSettings(i.guild.id)).staffRoleId) || target.user.bot) return i.reply({ content: 'ما ينفع تقيّم هذا العضو.', flags: 64 });
    if (target.id === i.user.id) return i.reply({ content: 'ما تقدر تقيّم نفسك.', flags: 64 });
    const modal = new ModalBuilder().setCustomId(`rating_panel_modal:${staffUserId}`).setTitle(`تقييم ${target.displayName}`.slice(0, 45));
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('rating_score').setLabel('عدد النجوم من 1 إلى 5').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(1)),
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('rating_comment').setLabel('ملاحظة (اختيارية)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000))
    );
    return i.showModal(modal);
  }
  if (i.customId !== 'shift_panel_action') return;
  const member = await i.guild.members.fetch(i.user.id);
  if (!await isStaff(member)) return i.reply({ content: 'هذا للستاف فقط.', flags: 64 });
  const settings = await requireSettings(i.guild.id);
  const action = i.values[0];
  if (action === 'start') {
    const current = await getActiveShift(i.guild.id, i.user.id);
    if (current) return i.reply({ content: '⏱️ عندك شفت شغّال من قبل. أنهِ شفتك الحالي قبل ما تبدأ شفت جديد.', flags: 64 });
    await ensureStaff(i.guild.id, i.user.id);
    const shift = await startShift(i.guild.id, i.user.id);
    await member.roles.add(settings.onShiftRoleId, 'بدأ شفت الستاف');
    await createLog(i.guild.id, 'SHIFT_STARTED', i.user.id, i.user.id, { shiftId: String(shift._id) });
    await sendLog(i.client, i.guild.id, `🟢 **بدأ الشفت**\n${member}`);
    return i.reply({ content: '✅ بدأ شفتك. هذا الرد يظهر لك بس.', flags: 64 });
  }
  if (action === 'end') {
    const shift = await getActiveShift(i.guild.id, i.user.id);
    if (!shift) return i.reply({ content: 'ما عندك شفت شغّال.', flags: 64 });
    if (activeMs(shift) < 30 * 60 * 1000) return i.reply({ content: `لازم يكون لك 30 دقيقة على الأقل في الشفت. وقتك الحين: ${duration(activeMs(shift))}.`, flags: 64 });
    const ended = await endShift(i.guild.id, i.user.id);
    suppressAutoStart(i.guild.id, i.user.id);
    await member.roles.remove(settings.onShiftRoleId, 'أنهى شفت الستاف');
    await createLog(i.guild.id, 'SHIFT_ENDED', i.user.id, i.user.id, { shiftId: String(ended._id), duration: duration(activeMs(ended)) });
    await sendLog(i.client, i.guild.id, `🔴 **انتهى الشفت**\n${member} — ${duration(activeMs(ended))}`);
    return i.reply({ content: `✅ انتهى الشفت. المدة: ${duration(activeMs(ended))}`, flags: 64 });
  }
  if (action === 'break') {
    const shift = await getActiveShift(i.guild.id, i.user.id);
    if (!shift) return i.reply({ content: 'ما عندك شفت شغّال.', flags: 64 });
    const current = shift.breaks.at(-1);
    if (current && !current.endedAt) { await resumeShift(i.guild.id, i.user.id); await createLog(i.guild.id, 'BREAK_RESUMED', i.user.id, i.user.id); return i.reply({ content: '▶️ رجعنا للشفت.', flags: 64 }); }
    await startBreak(i.guild.id, i.user.id); await createLog(i.guild.id, 'BREAK_STARTED', i.user.id, i.user.id); return i.reply({ content: '⏸️ بدأت الاستراحة. اختر نفس الخيار عشان ترجع للشفت.', flags: 64 });
  }
  if (action === 'stats') {
    const rows = await Shift.find({ guildId: i.guild.id, userId: i.user.id }).sort({ startedAt: -1 }).limit(10);
    const total = rows.reduce((sum, shift) => sum + activeMs(shift), 0);
    const current = rows.find(row => row.status === 'active');
    const kind = current ? await shiftAutoKind(current).catch(() => null) : null;
    const pendingLine = current?.checkSentAt ? `\n⏳ «هل انت موجود؟» ينتظر تأكيدك` : '';
    const state = current ? `في الشفت · ${kind ? '🤖 تلقائي' : '✋ يدوي'}` : 'متاح';
    return i.reply({ embeds: [new EmbedBuilder().setColor(0x8175f5).setTitle('📊 إحصائيات شفتاتي').setDescription(rtl(`مجموع الوقت المحسوب: **${duration(total)}**\nعدد الشفتات: **${rows.length}**\nحالتك الحين: **${state}**${pendingLine}\n-# التفاصيل وموعد التحقق القادم: \`${slashName('shift status')}\``))], flags: 64 });
  }
  if (action === 'active') {
    const rows = await Shift.find({ guildId: i.guild.id, status: 'active' }).limit(50);
    return i.reply({ content: rows.length ? `🟢 الشفتات الشغّالة:\n${rows.map(row => `<@${row.userId}> — ${duration(activeMs(row))}`).join('\n')}` : 'ما فيه شفتات شغّالة الحين.', flags: 64 });
  }
}
