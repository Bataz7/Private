import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, StringSelectMenuBuilder,
  TextInputBuilder, TextInputStyle, type ButtonInteraction, type Guild
} from 'discord.js';
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
    content: `اختر الإداري المسجّل الذي تريد الإبلاغ عنه (${members.length} إداري):\n> تظهر هنا كل الحسابات النشطة المسجلة في الداشبورد.`,
    components,
  };
}

export async function handleButton(i: ButtonInteraction) {
  if (i.customId.startsWith('shift_confirm:')) {
    await i.deferReply({ flags: 64 }).catch(() => undefined);
    const shift = await Shift.findById(i.customId.split(':')[1]);
    if (!shift || shift.userId !== i.user.id || shift.status !== 'active') return i.editReply({ content: 'This shift is no longer active.' });
    shift.lastActivityAt = new Date();
    shift.checkSentAt = null;
    await shift.save();
    await createLog(shift.guildId, 'SHIFT_ACTIVITY_CONFIRMED', i.user.id, i.user.id, { shiftId: String(shift._id) });
    return i.editReply({ content: '✅ Okay, done — your shift is still active. The inactivity timer has been reset.' });
  }

  if (!i.guild) return i.reply({ content: 'Server only.', flags: 64 });
  const settings = await requireSettings(i.guild.id);

  if (i.customId.startsWith('rating_panel_page:')) {
    const page = Number(i.customId.split(':')[1]);
    const payload = await buildRatingPanel(i.guild, Number.isFinite(page) ? page : 0);
    if (!payload) return i.reply({ content: 'لا يوجد ستاف مؤهل للتقييم.', flags: 64 });
    return i.update(payload);
  }

  if (i.customId === 'shift_start') {
    if (!await isStaff(await i.guild.members.fetch(i.user.id))) return i.reply({ content: 'Staff only.', flags: 64 });
    const current = await getActiveShift(i.guild.id, i.user.id);
    if (current) return i.reply({ content: '⏱️ لديك شفت نشط بالفعل. أنهِ الشفت الحالي قبل بدء شفت جديد.', flags: 64 });
    await ensureStaff(i.guild.id, i.user.id);
    const shift = await startShift(i.guild.id, i.user.id);
    const member = await i.guild.members.fetch(i.user.id);
    await member.roles.add(settings.onShiftRoleId, 'Started staff shift');
    await createLog(i.guild.id, 'SHIFT_STARTED', i.user.id, i.user.id, { shiftId: String(shift._id) });
    await sendLog(i.client, i.guild.id, `🟢 **SHIFT STARTED**\n${member} — <t:${Math.floor(Date.now()/1000)}:F>`);
    return i.update({ embeds: [new EmbedBuilder().setTitle('🟢 Shift Started').setDescription(`Started: <t:${Math.floor(Date.now()/1000)}:F>`)] , components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('shift_end').setLabel('End Shift').setStyle(ButtonStyle.Danger))] });
  }

  if (i.customId === 'shift_end') {
    const shift = await endShift(i.guild.id, i.user.id);
    suppressAutoStart(i.guild.id, i.user.id);
    const member = await i.guild.members.fetch(i.user.id);
    await member.roles.remove(settings.onShiftRoleId, 'Ended staff shift');
    const d = duration(activeMs(shift));
    await createLog(i.guild.id, 'SHIFT_ENDED', i.user.id, i.user.id, { shiftId: String(shift._id), duration: d });
    await sendLog(i.client, i.guild.id, `🔴 **SHIFT ENDED**\n${member} — Duration: **${d}**`);
    return i.update({ embeds: [new EmbedBuilder().setTitle('🔴 Shift Ended').setDescription(`Duration: **${d}**`)], components: [] });
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
    const text = rows.length ? rows.map(s => `• <t:${Math.floor(s.startedAt.getTime()/1000)}:f> → ${s.endedAt ? `<t:${Math.floor(s.endedAt.getTime()/1000)}:f>` : '🟢 Active'} — ${duration(activeMs(s))}`).join('\n') : 'No shifts found.';
    return i.reply({ embeds: [new EmbedBuilder().setTitle('📋 My Shift History').setDescription(text)], flags: 64 });
  }

  if (i.customId.startsWith('complaint_panel_page:')) {
    const page = Number(i.customId.split(':')[1]);
    if (!Number.isFinite(page)) return i.reply({ content: 'صفحة غير صالحة.', flags: 64 });
    const payload = await buildComplaintStaffPicker(i.guild, page);
    if (!payload) return i.reply({ content: 'لا يوجد إداريون مؤهلون للشكوى.', flags: 64 });
    return i.update({ content: payload.content, components: payload.components });
  }

  if (i.customId.startsWith('complaint_approve:') || i.customId.startsWith('complaint_reject:')) {
    if (!isAdministrator(await i.guild.members.fetch(i.user.id))) return i.reply({ content: 'Administrator permission required.', flags: 64 });
    if (i.customId.startsWith('complaint_approve:')) {
      const modal = new ModalBuilder().setCustomId(`complaint_penalty:${i.customId.split(':')[1]}`).setTitle('Approve Complaint');
      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('penalty_points').setLabel('Points to deduct').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(3)),
        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('decision_note').setLabel('Decision note').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000))
      );
      return i.showModal(modal);
    }
    const complaint = await Complaint.findById(i.customId.split(':')[1]);
    if (!complaint || complaint.status !== 'pending') return i.reply({ content: 'This complaint is no longer pending.', flags: 64 });
    const targetMember = await i.guild.members.fetch(complaint.staffUserId).catch(() => null);
    complaint.status = i.customId.startsWith('complaint_approve:') ? 'approved' : 'rejected';
    complaint.penaltyPoints = complaint.status === 'approved' ? 1 : 0;
    complaint.reviewedBy = i.user.id;
    complaint.reviewedAt = new Date();
    complaint.decisionNote = complaint.status === 'approved' ? 'Approved from Discord; 1 point penalty.' : 'Rejected from Discord.';
    await complaint.save();
    if (complaint.status === 'approved') {
      const staff = await Staff.findOne({ guildId: i.guild.id, userId: complaint.staffUserId });
      if (staff) { staff.points = Math.max(0, staff.points - 1); await staff.save(); }
    }
    const target = await i.client.users.fetch(complaint.staffUserId).catch(() => null);
    if (target) await target.send({ embeds: [new EmbedBuilder().setColor(0x8175f5).setTitle(complaint.status === 'approved' ? '⚠️ تم اعتماد شكوى عليك' : '✅ تم رفض الشكوى').setDescription(complaint.status === 'approved' ? 'تم اعتماد الشكوى وخصم نقطة واحدة من نقاطك.' : 'تمت مراجعة الشكوى ولم يتم اعتمادها.').setFooter({ text: 'Rift Staff Operations' })] }).catch(() => undefined);
    return i.update({ embeds: [new EmbedBuilder().setColor(0x8175f5).setTitle(complaint.status === 'approved' ? '⚠️ Complaint approved' : '✅ Complaint rejected').setDescription(`Decision recorded by <@${i.user.id}>.`)], components: [] });
  }

  if (i.customId === 'complaint_panel_submit') {
    const payload = await buildComplaintStaffPicker(i.guild);
    if (!payload) return i.reply({ content: 'لا يوجد إداريون مؤهلون للشكوى.', flags: 64 });
    return i.reply({ content: payload.content, components: payload.components, flags: 64 });
  }

  if (i.customId === 'staff_stats') {
    if (!await isManagement(await i.guild.members.fetch(i.user.id))) return i.reply({ content: 'Management only.', flags: 64 });
    const members = await i.guild.members.fetch();
    const staffCount = members.filter(m => m.roles.cache.has(settings.staffRoleId)).size;
    const onShiftCount = members.filter(m => m.roles.cache.has(settings.onShiftRoleId)).size;
    const active = await Shift.countDocuments({ guildId: i.guild.id, status: 'active' });
    const leaveActive = await LeaveRequest.countDocuments({ guildId: i.guild.id, status: 'approved' });
    const resignPending = await ResignationRequest.countDocuments({ guildId: i.guild.id, status: 'pending' });
    return i.reply({
      embeds: [new EmbedBuilder().setTitle('📊 Team Statistics')
        .setDescription(`👥 Staff: ${staffCount}\n🟢 On Shift: ${onShiftCount}\n🏖️ On Leave: ${leaveActive}\n🚪 Pending Resignations: ${resignPending}`)
        .addFields({ name: 'Active DB Shifts', value: String(active), inline: true })],
      flags: 64
    });
  }

  if (i.customId === 'staff_config_info') {
    if (!await isManagement(await i.guild.members.fetch(i.user.id))) return i.reply({ content: 'Management only.', flags: 64 });
    const embed = new EmbedBuilder().setTitle('⚙️ Staff System Configuration').addFields(
      { name: 'Staff Role', value: `<@&${settings.staffRoleId}>`, inline: true },
      { name: 'On Shift Role', value: `<@&${settings.onShiftRoleId}>`, inline: true },
      { name: 'Leave Role', value: `<@&${settings.leaveRoleId}>`, inline: true },
      { name: 'Management Role', value: `<@&${settings.managementRoleId}>`, inline: true },
      { name: 'Shift Channel', value: `<#${settings.shiftChannelId}>`, inline: true },
      { name: 'Leave Channel', value: `<#${settings.leaveChannelId}>`, inline: true },
      { name: 'Resignation Channel', value: `<#${settings.resignationChannelId}>`, inline: true },
      { name: 'Logs Channel', value: `<#${settings.logsChannelId}>`, inline: true },
      { name: 'Report Channel', value: settings.reportChannelId ? `<#${settings.reportChannelId}>` : 'Not set', inline: false }
    );
    return i.reply({ embeds: [embed], flags: 64 });
  }

  if (i.customId === 'report_submit') {
    const embed = new EmbedBuilder().setTitle('📝 Submit a Report').setDescription('Select the type of report you wish to submit:');
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('report_modal:shift_summary').setLabel('Shift Summary').setEmoji('📋').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('report_modal:incident').setLabel('Incident').setEmoji('⚠️').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('report_modal:general').setLabel('General').setEmoji('📝').setStyle(ButtonStyle.Secondary)
    );
    return i.reply({ embeds: [embed], components: [row], flags: 64 });
  }

  if (i.customId.startsWith('report_modal:')) {
    const member = await i.guild.members.fetch(i.user.id);
    if (!await isStaff(member)) return i.reply({ content: 'Staff only.', flags: 64 });
    const reportType = i.customId.split(':')[1] as 'shift_summary' | 'incident' | 'general';
    const modal = new ModalBuilder().setCustomId(`report_modal_submit:${reportType}`).setTitle('Submit Report');
    const titleInput = new TextInputBuilder().setCustomId('report_title').setLabel('Report Title').setStyle(TextInputStyle.Short).setRequired(true);
    const contentInput = new TextInputBuilder().setCustomId('report_content').setLabel('Report Details').setStyle(TextInputStyle.Paragraph).setRequired(true);
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(contentInput)
    );
    return i.showModal(modal);
  }

  if (i.customId.startsWith('report_review:')) {
    if (!await isManagement(await i.guild.members.fetch(i.user.id))) return i.reply({ content: 'Management only.', flags: 64 });
    const report = await Report.findById(i.customId.split(':')[1]);
    if (!report || report.status !== 'submitted') return i.reply({ content: 'This report is no longer pending.', flags: 64 });
    await markReportReviewed(String(report._id), i.user.id);
    const member = await i.guild.members.fetch(report.userId).catch(() => null);
    if (member) {
      const dm = await member.createDM();
      await dm.send({
        embeds: [new EmbedBuilder().setTitle('📝 Your Report Has Been Reviewed').setDescription(`**${report.title}**\n\nYour report has been reviewed by <@${i.user.id}>.`)]
      }).catch(() => undefined);
    }
    await createLog(i.guild.id, 'REPORT_REVIEWED', report.userId, i.user.id, { reportId: String(report._id) });
    await sendLog(i.client, i.guild.id, `🔍 **REPORT REVIEWED**\n<@${report.userId}> by <@${i.user.id}>`);
    return i.update({ embeds: [new EmbedBuilder().setTitle('✅ Report Reviewed').setDescription(`Report from <@${report.userId}> has been marked as reviewed.`)] , components: [] });
  }
}
