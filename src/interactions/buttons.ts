import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, StringSelectMenuBuilder,
  TextInputBuilder, TextInputStyle, type ButtonInteraction, type Guild
} from '../lib/djs/index.js';
import { requireSettings } from '../services/settings.service.js';
import { isAdministrator, isManagement, isStaff } from '../utils/permissions.js';
import { Shift } from '../models/Shift.js';
import { LeaveRequest } from '../models/LeaveRequest.js';
import { ResignationRequest } from '../models/ResignationRequest.js';
import { Report } from '../models/Report.js';
import { Complaint } from '../models/Complaint.js';
import { Staff } from '../models/Staff.js';
import { suppressAutoStart } from '../services/auto-shift.service.js';
import { startShift, endShift, startBreak, resumeShift, activeMs, duration, ensureStaff, getActiveShift } from '../services/shift.service.js';
import { createReport, markReportReviewed } from '../services/report.service.js';
import { sendLog, createLog } from '../services/log.service.js';
import { discordDate } from '../utils/format.js';
import { buildRatingPanel } from '../utils/rating-panel.js';
import { rtl } from '../utils/v2.js';

async function buildComplaintStaffPicker(guild: Guild, page = 0) {
  const completeMembers = await guild.members.fetch();
  const registeredStaff = await Staff.find({ guildId: guild.id, active: true }).sort({ userId: 1 });

  const members = registeredStaff
    .map(row => completeMembers.get(row.userId))
    .filter((member): member is NonNullable<typeof member> => Boolean(member))
    .filter(member => !member.user.bot)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'ar', { sensitivity: 'base' }));

  if (!members.length) return null;

  const pageSize = 25;
  const pageCount = Math.max(1, Math.ceil(members.length / pageSize));
  const safePage = Math.min(Math.max(page, 0), pageCount - 1);
  const pageMembers = members.slice(safePage * pageSize, (safePage + 1) * pageSize);

  const menu = new StringSelectMenuBuilder()
    .setCustomId('complaint_panel_staff')
    .setPlaceholder(`اختر الإداري (${safePage + 1}/${pageCount})`)
    .addOptions(pageMembers.map(member => ({
      label: member.displayName.slice(0, 100),
      value: member.id,
      description: `@${member.user.username}`.slice(0, 100)
    })));

  const components: ActionRowBuilder<any>[] = [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)];
  if (pageCount > 1) {
    components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`complaint_panel_page:${safePage - 1}`).setLabel('السابق').setStyle(ButtonStyle.Secondary).setDisabled(safePage === 0),
      new ButtonBuilder().setCustomId(`complaint_panel_page:${safePage + 1}`).setLabel('التالي').setStyle(ButtonStyle.Primary).setDisabled(safePage === pageCount - 1),
      new ButtonBuilder().setCustomId('complaint_panel_submit').setLabel(`الكل · ${members.length}`).setStyle(ButtonStyle.Secondary)
    ));
  }

  return {
    content: `اختر الإداري اللي تبي تشتكي عليه (${members.length} إداري):\n> يظهر هنا كل الإداريين الفعّالين المسجلين في لوحة التحكم.`,
    components,
  };
}

export async function handleButton(i: ButtonInteraction) {
  if (i.customId.startsWith('shift_confirm:')) {
    await i.deferReply({ flags: 64 }).catch(() => undefined);
    const shift = await Shift.findById(i.customId.split(':')[1]);
    if (!shift || shift.userId !== i.user.id || shift.status !== 'active') return i.editReply({ content: 'هذا الشفت ما عاد فعّال.' });
    shift.lastActivityAt = new Date();
    shift.checkSentAt = null;
    await shift.save();
    await createLog(shift.guildId, 'SHIFT_ACTIVITY_CONFIRMED', i.user.id, i.user.id, { shiftId: String(shift._id) });
    return i.editReply({ content: '✅ تمام — شفتك للحين شغّال، ورجّعنا عدّاد الخمول من جديد.' });
  }

  if (!i.guild) return i.reply({ content: 'هذا داخل السيرفر فقط.', flags: 64 });
  const settings = await requireSettings(i.guild.id);

  if (i.customId.startsWith('rating_panel_page:')) {
    const page = Number(i.customId.split(':')[1]);
    const payload = await buildRatingPanel(i.guild, Number.isFinite(page) ? page : 0);
    if (!payload) return i.reply({ content: 'ما فيه ستاف ينفع تقييمهم.', flags: 64 });
    return i.update(payload);
  }

  if (i.customId === 'shift_start') {
    if (!await isStaff(await i.guild.members.fetch(i.user.id))) return i.reply({ content: 'هذا للستاف فقط.', flags: 64 });
    const current = await getActiveShift(i.guild.id, i.user.id);
    if (current) return i.reply({ content: '⏱️ عندك شفت شغّال من قبل. أنهِ شفتك الحالي قبل ما تبدأ شفت جديد.', flags: 64 });
    await ensureStaff(i.guild.id, i.user.id);
    const shift = await startShift(i.guild.id, i.user.id);
    const member = await i.guild.members.fetch(i.user.id);
    await member.roles.add(settings.onShiftRoleId, 'بدأ شفت الستاف');
    await createLog(i.guild.id, 'SHIFT_STARTED', i.user.id, i.user.id, { shiftId: String(shift._id) });
    await sendLog(i.client, i.guild.id, `🟢 **بدأ الشفت**\n${member} — <t:${Math.floor(Date.now()/1000)}:F>`);
    return i.update({ embeds: [new EmbedBuilder().setTitle('🟢 بدأ الشفت').setDescription(`البداية: <t:${Math.floor(Date.now()/1000)}:F>`)] , components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('shift_end').setLabel('أنهِ الشفت').setStyle(ButtonStyle.Danger))] });
  }

  if (i.customId === 'shift_end') {
    const shift = await endShift(i.guild.id, i.user.id);
    suppressAutoStart(i.guild.id, i.user.id);
    const member = await i.guild.members.fetch(i.user.id);
    await member.roles.remove(settings.onShiftRoleId, 'أنهى شفت الستاف');
    const d = duration(activeMs(shift));
    await createLog(i.guild.id, 'SHIFT_ENDED', i.user.id, i.user.id, { shiftId: String(shift._id), duration: d });
    await sendLog(i.client, i.guild.id, `🔴 **انتهى الشفت**\n${member} — المدة: **${d}**`);
    return i.update({ embeds: [new EmbedBuilder().setTitle('🔴 انتهى الشفت').setDescription(`المدة: **${d}**`)], components: [] });
  }

  if (i.customId === 'shift_break' || i.customId === 'shift_resume') {
    if (i.customId === 'shift_break') {
      await startBreak(i.guild.id, i.user.id);
      await createLog(i.guild.id, 'BREAK_STARTED', i.user.id, i.user.id);
    } else {
      await resumeShift(i.guild.id, i.user.id);
      await createLog(i.guild.id, 'BREAK_RESUMED', i.user.id, i.user.id);
    }
    return i.deferUpdate();
  }

  if (i.customId === 'shift_history') {
    const rows = await Shift.find({ guildId: i.guild.id, userId: i.user.id }).sort({ startedAt: -1 }).limit(10);
    const text = rows.length ? rows.map(s => `• <t:${Math.floor(s.startedAt.getTime()/1000)}:f> → ${s.endedAt ? `<t:${Math.floor(s.endedAt.getTime()/1000)}:f>` : '🟢 شغّال'} — ${duration(activeMs(s))}`).join('\n') : 'ما فيه شفتات.';
    return i.reply({ embeds: [new EmbedBuilder().setTitle('📋 سجل شفتاتي').setDescription(text)], flags: 64 });
  }

  if (i.customId.startsWith('complaint_panel_page:')) {
    const page = Number(i.customId.split(':')[1]);
    if (!Number.isFinite(page)) return i.reply({ content: 'الصفحة غير صحيحة.', flags: 64 });
    const payload = await buildComplaintStaffPicker(i.guild, page);
    if (!payload) return i.reply({ content: 'ما فيه إداريين تقدر تشتكي عليهم.', flags: 64 });
    return i.update({ content: payload.content, components: payload.components });
  }

  if (i.customId.startsWith('complaint_approve:') || i.customId.startsWith('complaint_reject:')) {
    if (!isAdministrator(await i.guild.members.fetch(i.user.id))) return i.reply({ content: 'تحتاج صلاحية أدمن.', flags: 64 });
    if (i.customId.startsWith('complaint_approve:')) {
      const modal = new ModalBuilder().setCustomId(`complaint_penalty:${i.customId.split(':')[1]}`).setTitle('اعتماد الشكوى');
      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('penalty_points').setLabel('كم نقطة تنخصم').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(3)),
        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('decision_note').setLabel('ملاحظة القرار').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000))
      );
      return i.showModal(modal);
    }
    const complaint = await Complaint.findById(i.customId.split(':')[1]);
    if (!complaint || complaint.status !== 'pending') return i.reply({ content: 'هذي الشكوى ما عادت معلّقة.', flags: 64 });
    const targetMember = await i.guild.members.fetch(complaint.staffUserId).catch(() => null);
    complaint.status = i.customId.startsWith('complaint_approve:') ? 'approved' : 'rejected';
    complaint.penaltyPoints = complaint.status === 'approved' ? 1 : 0;
    complaint.reviewedBy = i.user.id;
    complaint.reviewedAt = new Date();
    complaint.decisionNote = complaint.status === 'approved' ? 'انعتمدت من ديسكورد؛ خصم نقطة وحدة.' : 'انرفضت من ديسكورد.';
    await complaint.save();
    if (complaint.status === 'approved') {
      const staff = await Staff.findOne({ guildId: i.guild.id, userId: complaint.staffUserId });
      if (staff) { staff.points = Math.max(0, staff.points - 1); await staff.save(); }
    }
    const target = await i.client.users.fetch(complaint.staffUserId).catch(() => null);
    if (target) await target.send({ embeds: [new EmbedBuilder().setColor(0x8175f5).setTitle(complaint.status === 'approved' ? '⚠️ تم اعتماد شكوى عليك' : '✅ تم رفض الشكوى').setDescription(complaint.status === 'approved' ? 'انعتمدت الشكوى وانخصمت نقطة وحدة من نقاطك.' : 'انراجعت الشكوى وما انعتمدت.').setFooter({ text: 'عمليات ستاف Rift' })] }).catch(() => undefined);
    return i.update({ embeds: [new EmbedBuilder().setColor(0x8175f5).setTitle(complaint.status === 'approved' ? '⚠️ انعتمدت الشكوى' : '✅ انرفضت الشكوى').setDescription(`سجّل القرار <@${i.user.id}>.`)], components: [] });
  }

  if (i.customId === 'complaint_panel_submit') {
    const payload = await buildComplaintStaffPicker(i.guild);
    if (!payload) return i.reply({ content: 'ما فيه إداريين تقدر تشتكي عليهم.', flags: 64 });
    return i.reply({ content: payload.content, components: payload.components, flags: 64 });
  }

  if (i.customId === 'staff_stats') {
    if (!await isManagement(await i.guild.members.fetch(i.user.id))) return i.reply({ content: 'هذا للإدارة فقط.', flags: 64 });
    const members = await i.guild.members.fetch();
    const staffCount = members.filter(m => m.roles.cache.has(settings.staffRoleId)).size;
    const onShiftCount = members.filter(m => m.roles.cache.has(settings.onShiftRoleId)).size;
    const active = await Shift.countDocuments({ guildId: i.guild.id, status: 'active' });
    const leaveActive = await LeaveRequest.countDocuments({ guildId: i.guild.id, status: 'approved' });
    const resignPending = await ResignationRequest.countDocuments({ guildId: i.guild.id, status: 'pending' });
    return i.reply({
      embeds: [new EmbedBuilder().setTitle('📊 إحصائيات الفريق')
        .setDescription(rtl(`👥 الستاف: ${staffCount}\n🟢 في الشفت: ${onShiftCount}\n🏖️ في إجازة: ${leaveActive}\n🚪 استقالات معلّقة: ${resignPending}`))
        .addFields({ name: 'الشفتات الشغّالة', value: String(active), inline: true })],
      flags: 64
    });
  }

  if (i.customId === 'staff_config_info') {
    if (!await isManagement(await i.guild.members.fetch(i.user.id))) return i.reply({ content: 'هذا للإدارة فقط.', flags: 64 });
    const embed = new EmbedBuilder().setTitle('⚙️ إعدادات نظام الستاف').addFields(
      { name: 'رتبة الستاف', value: `<@&${settings.staffRoleId}>`, inline: true },
      { name: 'رتبة الشفت', value: `<@&${settings.onShiftRoleId}>`, inline: true },
      { name: 'رتبة الإجازة', value: `<@&${settings.leaveRoleId}>`, inline: true },
      { name: 'رتبة الإدارة', value: `<@&${settings.managementRoleId}>`, inline: true },
      { name: 'روم الشفتات', value: `<#${settings.shiftChannelId}>`, inline: true },
      { name: 'روم الإجازات', value: `<#${settings.leaveChannelId}>`, inline: true },
      { name: 'روم الاستقالات', value: `<#${settings.resignationChannelId}>`, inline: true },
      { name: 'روم السجلات', value: `<#${settings.logsChannelId}>`, inline: true },
      { name: 'روم التقارير', value: settings.reportChannelId ? `<#${settings.reportChannelId}>` : 'مو محدد', inline: false }
    );
    return i.reply({ embeds: [embed], flags: 64 });
  }

  if (i.customId === 'report_submit') {
    const embed = new EmbedBuilder().setTitle('📝 رفع تقرير').setDescription('اختر نوع التقرير اللي تبي ترفعه:');
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('report_modal:shift_summary').setLabel('ملخص شفت').setEmoji('📋').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('report_modal:incident').setLabel('حادثة').setEmoji('⚠️').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('report_modal:general').setLabel('عام').setEmoji('📝').setStyle(ButtonStyle.Secondary)
    );
    return i.reply({ embeds: [embed], components: [row], flags: 64 });
  }

  if (i.customId.startsWith('report_modal:')) {
    const member = await i.guild.members.fetch(i.user.id);
    if (!await isStaff(member)) return i.reply({ content: 'هذا للستاف فقط.', flags: 64 });
    const reportType = i.customId.split(':')[1] as 'shift_summary' | 'incident' | 'general';
    const modal = new ModalBuilder().setCustomId(`report_modal_submit:${reportType}`).setTitle('رفع تقرير');
    const titleInput = new TextInputBuilder().setCustomId('report_title').setLabel('عنوان التقرير').setStyle(TextInputStyle.Short).setRequired(true);
    const contentInput = new TextInputBuilder().setCustomId('report_content').setLabel('تفاصيل التقرير').setStyle(TextInputStyle.Paragraph).setRequired(true);
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(contentInput)
    );
    return i.showModal(modal);
  }

  if (i.customId.startsWith('report_review:')) {
    if (!await isManagement(await i.guild.members.fetch(i.user.id))) return i.reply({ content: 'هذا للإدارة فقط.', flags: 64 });
    const report = await Report.findById(i.customId.split(':')[1]);
    if (!report || report.status !== 'submitted') return i.reply({ content: 'هذا التقرير ما عاد ينتظر مراجعة.', flags: 64 });
    await markReportReviewed(String(report._id), i.user.id);
    const member = await i.guild.members.fetch(report.userId).catch(() => null);
    if (member) {
      const dm = await member.createDM();
      await dm.send({
        embeds: [new EmbedBuilder().setTitle('📝 انراجع تقريرك').setDescription(`**${report.title}**\n\nراجع تقريرك <@${i.user.id}>.`)]
      }).catch(() => undefined);
    }
    await createLog(i.guild.id, 'REPORT_REVIEWED', report.userId, i.user.id, { reportId: String(report._id) });
    await sendLog(i.client, i.guild.id, `🔍 **انراجع تقرير**\n<@${report.userId}> بواسطة <@${i.user.id}>`);
    return i.update({ embeds: [new EmbedBuilder().setTitle('✅ انراجع التقرير').setDescription(`تقرير <@${report.userId}> صار مُراجَع.`)] , components: [] });
  }
}
