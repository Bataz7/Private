import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type ModalSubmitInteraction } from 'discord.js';
import { saveSettings, requireSettings } from '../services/settings.service.js';
import { LeaveRequest } from '../models/LeaveRequest.js';
import { ResignationRequest } from '../models/ResignationRequest.js';
import { Complaint } from '../models/Complaint.js';
import { createComplaintOnce } from '../services/complaint.service.js';
import { StaffRating } from '../models/StaffRating.js';
import { Staff } from '../models/Staff.js';
import { isStaff } from '../utils/permissions.js';
import { parseDateInput, discordDate } from '../utils/format.js';
import { sendLog, createLog } from '../services/log.service.js';
import { createReport } from '../services/report.service.js';

const handledRatingInteractions = new Set<string>();
const handledComplaintInteractions = new Set<string>();

export async function handleModal(i: ModalSubmitInteraction) {
  if (!i.guild) return i.reply({ content: 'Server only.', flags: 64 });


  if (i.customId === 'setup_modal') {
    const member = await i.guild.members.fetch(i.user.id);
    if (!member.permissions.has('Administrator')) return i.reply({ content: 'Administrator only.', flags: 64 });
    const channels = i.fields.getTextInputValue('channels').split(',').map(x => x.trim());
    if (channels.length < 4 || channels.length > 5) return i.reply({ content: 'Channels must be 4 or 5 channel IDs separated by commas: shift,leave,resignation,logs[,reports]', flags: 64 });
    const [shiftChannelId, leaveChannelId, resignationChannelId, logsChannelId, reportChannelId] = channels;
    if (!shiftChannelId || !leaveChannelId || !resignationChannelId || !logsChannelId) return i.reply({ content: 'All required channel IDs must be provided.', flags: 64 });
    const data = {
      guildId: i.guild.id,
      staffRoleId: i.fields.getTextInputValue('staff_role'),
      onShiftRoleId: i.fields.getTextInputValue('on_shift_role'),
      leaveRoleId: i.fields.getTextInputValue('leave_role'),
      managementRoleId: i.fields.getTextInputValue('management_role'),
      shiftChannelId,
      leaveChannelId,
      resignationChannelId,
      logsChannelId,
      reportChannelId: reportChannelId || null
    };
    // Every id must be a real role / channel of THIS server, otherwise a typo or a foreign id would be saved.
    const roleIds = [data.staffRoleId, data.onShiftRoleId, data.leaveRoleId, data.managementRoleId].map(value => value.trim());
    const channelIds = [shiftChannelId, leaveChannelId, resignationChannelId, logsChannelId, reportChannelId].filter((value): value is string => Boolean(value)).map(value => value.trim());
    if (roleIds.some(value => !/^\d{15,22}$/.test(value) || !i.guild!.roles.cache.has(value))) return i.reply({ content: 'One of the role IDs is not a role in this server.', flags: 64 });
    if (channelIds.some(value => !/^\d{15,22}$/.test(value) || !i.guild!.channels.cache.has(value))) return i.reply({ content: 'One of the channel IDs is not a channel in this server.', flags: 64 });
    await saveSettings({ ...data, staffRoleId: roleIds[0]!, onShiftRoleId: roleIds[1]!, leaveRoleId: roleIds[2]!, managementRoleId: roleIds[3]!, shiftChannelId: shiftChannelId!.trim(), leaveChannelId: leaveChannelId!.trim(), resignationChannelId: resignationChannelId!.trim(), logsChannelId: logsChannelId!.trim(), reportChannelId: reportChannelId?.trim() || null });
    return i.reply({ content: '✅ Staff system configured successfully.', flags: 64 });
  }

  if (i.customId.startsWith('rating_panel_modal:')) {
    if (handledRatingInteractions.has(i.id)) return;
    handledRatingInteractions.add(i.id);
    setTimeout(() => handledRatingInteractions.delete(i.id), 10 * 60 * 1000);
    const staffUserId = i.customId.split(':')[1];
    if (!staffUserId) return i.reply({ content: 'Invalid staff member.', flags: 64 });
    const settings = await requireSettings(i.guild.id);
    const target = await i.guild.members.fetch(staffUserId).catch(() => null);
    if (!target || !target.roles.cache.has(settings.staffRoleId) || target.user.bot) return i.reply({ content: 'لا يمكن تقييم هذا العضو.', flags: 64 });
    if (staffUserId === i.user.id) return i.reply({ content: 'لا يمكنك تقييم نفسك.', flags: 64 });
    const rating = Number(i.fields.getTextInputValue('rating_score').trim());
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return i.reply({ content: 'عدد النجوم يجب أن يكون من 1 إلى 5.', flags: 64 });
    const comment = i.fields.getTextInputValue('rating_comment').trim();
    const points = rating === 5 ? 3 : rating === 4 ? 2 : rating === 3 ? 1 : 0;
    let previousRating = await StaffRating.findOne({ guildId: i.guild.id, staffUserId, reviewerUserId: i.user.id });
    let previousPoints = previousRating ? (previousRating.rating === 5 ? 3 : previousRating.rating === 4 ? 2 : previousRating.rating === 3 ? 1 : 0) : 0;
    if (previousRating) {
      previousRating.rating = rating;
      previousRating.comment = comment;
      previousRating.createdAt = new Date();
      await previousRating.save();
    } else {
      try {
        await StaffRating.create({ guildId: i.guild.id, staffUserId, reviewerUserId: i.user.id, rating, comment, createdAt: new Date() });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes('staff_ratings_one_per_reviewer_idx') && !message.includes('duplicate key')) throw error;
        previousRating = await StaffRating.findOne({ guildId: i.guild.id, staffUserId, reviewerUserId: i.user.id });
        if (!previousRating) throw error;
        previousPoints = previousRating.rating === 5 ? 3 : previousRating.rating === 4 ? 2 : previousRating.rating === 3 ? 1 : 0;
        previousRating.rating = rating;
        previousRating.comment = comment;
        previousRating.createdAt = new Date();
        await previousRating.save();
      }
    }
    const staff = await Staff.findOne({ guildId: i.guild.id, userId: staffUserId });
    if (staff && points !== previousPoints) { staff.points = Math.max(0, staff.points + points - previousPoints); await staff.save(); }
    const allRatings = await StaffRating.find({ guildId: i.guild.id, staffUserId });
    const ratingCount = allRatings.length;
    const averageRating = ratingCount ? allRatings.reduce((sum, item) => sum + item.rating, 0) / ratingCount : rating;
    const ratingTitle = rating === 5 ? 'إداري ممتاز' : rating === 4 ? 'إداري مميز' : rating === 3 ? 'إداري جيد' : rating === 2 ? 'يحتاج إلى تحسين' : 'يحتاج إلى متابعة';
    const ratingChannel = settings.ratingChannelId ? await i.guild.channels.fetch(settings.ratingChannelId).catch(() => null) : null;
    if (ratingChannel?.isTextBased()) await ratingChannel.send({ embeds: [new EmbedBuilder().setColor(0x8b6cff).setTitle('تقييم إداري جديد').addFields({ name: 'الإداري', value: `<@${staffUserId}>`, inline: true }, { name: 'التقييم', value: `${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}  ${rating}/5`, inline: true }, { name: 'المعدل', value: `${averageRating.toFixed(2)}/5 · ${ratingCount} تقييم`, inline: true }, { name: 'المقيّم', value: `<@${i.user.id}>`, inline: true }, { name: 'الملاحظة', value: comment || 'بدون ملاحظة' }).setFooter({ text: ratingTitle }).setTimestamp()] });
    return i.reply({ content: `تم تسجيل تقييمك بنجاح: ${rating}/5. المعدل الحالي للإداري ${averageRating.toFixed(2)}/5.`, flags: 64 });
  }

  if (i.customId.startsWith('complaint_penalty:')) {
    const complaint = await Complaint.findById(i.customId.split(':')[1]);
    if (!complaint || complaint.status !== 'pending') return i.reply({ content: 'This complaint is no longer pending.', flags: 64 });
    const target = await i.guild.members.fetch(complaint.staffUserId).catch(() => null);
    if (target?.permissions.has('Administrator')) return i.reply({ content: 'Complaints do not apply to Administrators.', flags: 64 });
    const penaltyPoints = Number(i.fields.getTextInputValue('penalty_points').trim());
    if (!Number.isInteger(penaltyPoints) || penaltyPoints < 0) return i.reply({ content: 'Penalty points must be a whole number of 0 or more.', flags: 64 });
    const decisionNote = i.fields.getTextInputValue('decision_note').trim();
    complaint.status = 'approved';
    complaint.penaltyPoints = penaltyPoints;
    complaint.reviewedBy = i.user.id;
    complaint.reviewedAt = new Date();
    complaint.decisionNote = decisionNote || `Approved from Discord; ${penaltyPoints} point(s) deducted.`;
    await complaint.save();
    const staff = await Staff.findOne({ guildId: i.guild.id, userId: complaint.staffUserId });
    if (staff && penaltyPoints > 0) { staff.points = Math.max(0, staff.points - penaltyPoints); await staff.save(); }
    await createLog(i.guild.id, 'COMPLAINT_REVIEWED', complaint.staffUserId, i.user.id, { complaintId: complaint.id, status: 'approved', penaltyPoints });
    return i.reply({ content: `✅ Complaint approved. Deducted ${penaltyPoints} point(s) from <@${complaint.staffUserId}>.`, flags: 64 });
  }

  if (i.customId.startsWith('complaint_modal:')) {
    if (handledComplaintInteractions.has(i.id)) return;
    handledComplaintInteractions.add(i.id);
    setTimeout(() => handledComplaintInteractions.delete(i.id), 10 * 60 * 1000);
    const staffUserId = i.customId.split(':')[1];
    if (!staffUserId) return i.reply({ content: 'Invalid complaint target.', flags: 64 });
    if (staffUserId === i.user.id) return i.reply({ content: 'لا يمكنك تقديم شكوى على نفسك.', flags: 64 });
    const settings = await requireSettings(i.guild.id);
    const member = await i.guild.members.fetch(staffUserId).catch(() => null);
    const registered = await Staff.findOne({ guildId: i.guild.id, userId: staffUserId, active: true });
    if (!member || !registered || member.user.bot) return i.reply({ content: 'لا يمكن تقديم الشكوى على هذا العضو.', flags: 64 });
    const result = await createComplaintOnce({ guildId: i.guild.id, staffUserId, reporterUserId: i.user.id, reason: i.fields.getTextInputValue('complaint_reason'), evidence: i.fields.getTextInputValue('complaint_evidence') });
    const complaint = result.complaint;
    if (!result.created) return i.reply({ content: 'تم تسجيل نفس الشكوى قبل قليل، ولم يتم إرسال نسخة مكررة.', flags: 64 });
    if (settings.complaintChannelId) {
      const channel = await i.guild.channels.fetch(settings.complaintChannelId).catch(() => null);
      if (channel?.isTextBased()) await channel.send({ embeds: [new EmbedBuilder().setColor(0x8175f5).setTitle('◇ شكوى جديدة على إداري').addFields({ name: 'الإداري', value: `<@${staffUserId}>`, inline: true }, { name: 'المبلّغ', value: `<@${i.user.id}>`, inline: true }, { name: 'التفاصيل', value: complaint.reason }, { name: 'الدليل', value: complaint.evidence || 'لم يتم إرفاق دليل.' }).setFooter({ text: `Rift Complaint #${String(complaint._id).slice(-6)}` })], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`complaint_approve:${complaint._id}`).setLabel('اعتماد وخصم نقطة').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId(`complaint_reject:${complaint._id}`).setLabel('رفض').setStyle(ButtonStyle.Secondary))] });
    }
    await sendLog(i.client, i.guild.id, `◇ **COMPLAINT SUBMITTED**\n<@${i.user.id}> submitted a complaint about <@${staffUserId}> — ID: ${complaint._id}`);
    return i.reply({ content: '✅ Your complaint was submitted for management review.', flags: 64 });
  }

  if (i.customId.startsWith('complaint_panel_modal:')) {
    if (handledComplaintInteractions.has(i.id)) return;
    handledComplaintInteractions.add(i.id);
    setTimeout(() => handledComplaintInteractions.delete(i.id), 10 * 60 * 1000);
    const staffUserId = i.customId.split(':')[1];
    if (!staffUserId) return i.reply({ content: 'بيانات الإداري غير صحيحة.', flags: 64 });
    if (staffUserId === i.user.id) return i.reply({ content: 'You cannot report yourself.', flags: 64 });
    const settings = await requireSettings(i.guild.id);
    const member = await i.guild.members.fetch(staffUserId).catch(() => null);
    const registered = await Staff.findOne({ guildId: i.guild.id, userId: staffUserId, active: true });
    if (!member || !registered || member.user.bot) return i.reply({ content: 'لا يمكن تقديم الشكوى على هذا العضو.', flags: 64 });
    const result = await createComplaintOnce({ guildId: i.guild.id, staffUserId, reporterUserId: i.user.id, reason: i.fields.getTextInputValue('complaint_reason'), evidence: i.fields.getTextInputValue('complaint_evidence') });
    const complaint = result.complaint;
    if (!result.created) return i.reply({ content: 'تم تسجيل نفس الشكوى قبل قليل، ولم يتم إرسال نسخة مكررة.', flags: 64 });
    const channel = settings.complaintChannelId ? await i.guild.channels.fetch(settings.complaintChannelId).catch(() => null) : null;
    if (channel?.isTextBased()) await channel.send({ embeds: [new EmbedBuilder().setColor(0xef6f83).setTitle('⚠️ شكوى جديدة').addFields({ name: 'الإداري', value: `<@${staffUserId}>`, inline: true }, { name: 'المبلّغ', value: `<@${i.user.id}>`, inline: true }, { name: 'المشكلة', value: complaint.reason }, { name: 'الدليل', value: complaint.evidence || 'لا يوجد' }).setFooter({ text: `Complaint #${String(complaint._id).slice(-6)}` })], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`complaint_approve:${complaint._id}`).setLabel('اعتماد وخصم نقاط').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId(`complaint_reject:${complaint._id}`).setLabel('رفض').setStyle(ButtonStyle.Secondary))] });
    await sendLog(i.client, i.guild.id, `◇ **OFFICIAL COMPLAINT**\n<@${i.user.id}> reported <@${staffUserId}> — ${complaint._id}`);
    return i.reply({ content: '✅ تم إرسال الشكوى إلى قناة المراجعة.', flags: 64 });
  }

  if (i.customId.startsWith('report_modal_submit:')) {
    const member = await i.guild.members.fetch(i.user.id);
    if (!await isStaff(member)) return i.reply({ content: 'Staff only.', flags: 64 });
    const reportType = i.customId.split(':')[1] as 'shift_summary' | 'incident' | 'general';
    const title = i.fields.getTextInputValue('report_title');
    const content = i.fields.getTextInputValue('report_content');
    const settings = await requireSettings(i.guild.id);
    const approvedComplaints = await Complaint.find({ guildId: i.guild.id, staffUserId: i.user.id, status: 'approved' }).limit(10);

    const report = await createReport({
      guildId: i.guild.id,
      userId: i.user.id,
      title,
      content,
      type: reportType
    });
    await createLog(i.guild.id, 'REPORT_SUBMITTED', i.user.id, i.user.id, { reportId: String(report._id), type: reportType });

    const embed = new EmbedBuilder()
      .setTitle(`📝 ${reportType === 'incident' ? '⚠️ Incident' : reportType === 'shift_summary' ? '📋 Shift Summary' : '📝'} Report`)
      .addFields(
        { name: 'Title', value: report.title },
        { name: 'Submitted by', value: `<@${i.user.id}>`, inline: true },
        { name: 'Type', value: reportType, inline: true },
        { name: 'Date', value: discordDate(report.createdAt), inline: true },
        { name: 'Complaints on record', value: approvedComplaints.length ? `${approvedComplaints.length} approved complaint(s)` : 'No approved complaints', inline: true },
        { name: 'Details', value: report.content.slice(0, 1024) || 'No details provided.' }
      )
      .setFooter({ text: `Report ID: ${String(report._id).slice(-6)}` });

    const dm = await member.createDM();
    await dm.send({ embeds: [embed] }).catch(() => undefined);

    if (settings.reportChannelId) {
      const channel = await i.guild.channels.fetch(settings.reportChannelId).catch(() => null);
      if (channel?.isTextBased()) {
        await channel.send({ embeds: [embed] }).catch(() => undefined);
      } else {
        await sendLog(i.client, i.guild.id, `⚠️ Report channel <#${settings.reportChannelId}> not found or is not text-based.`);
      }
    } else {
      await sendLog(i.client, i.guild.id, `⚠️ Report channel not configured. Report was sent to submitter's DM only.`);
    }

    await sendLog(i.client, i.guild.id, `📝 **REPORT SUBMITTED**\n<@${i.user.id}> — ${report.title} (${reportType})`);
    return i.reply({ content: '✅ Your report has been submitted. A copy has been sent to your DMs and the report channel.', flags: 64 });
  }
}
