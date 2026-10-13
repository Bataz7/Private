import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type ModalSubmitInteraction } from '../lib/djs/index.js';
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

const REPORT_TYPE_AR: Record<string, string> = { shift_summary: '📋 ملخص شفت', incident: '⚠️ حادثة', general: 'عام' };
const handledRatingInteractions = new Set<string>();
const handledComplaintInteractions = new Set<string>();

export async function handleModal(i: ModalSubmitInteraction) {
  if (!i.guild) return i.reply({ content: 'هذا داخل السيرفر فقط.', flags: 64 });


  if (i.customId === 'setup_modal') {
    const member = await i.guild.members.fetch(i.user.id);
    if (!member.permissions.has('Administrator')) return i.reply({ content: 'هذا للأدمن فقط.', flags: 64 });
    const channels = i.fields.getTextInputValue('channels').split(',').map(x => x.trim());
    if (channels.length < 4 || channels.length > 5) return i.reply({ content: 'الرومات لازم تكون 4 أو 5 آيديات بينها فواصل: الشفتات,الإجازات,الاستقالات,السجلات[,التقارير]', flags: 64 });
    const [shiftChannelId, leaveChannelId, resignationChannelId, logsChannelId, reportChannelId] = channels;
    if (!shiftChannelId || !leaveChannelId || !resignationChannelId || !logsChannelId) return i.reply({ content: 'لازم تكتب آيديات كل الرومات المطلوبة.', flags: 64 });
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
    if (roleIds.some(value => !/^\d{15,22}$/.test(value) || !i.guild!.roles.cache.has(value))) return i.reply({ content: 'أحد آيديات الرتب مو لرتبة في هذا السيرفر.', flags: 64 });
    if (channelIds.some(value => !/^\d{15,22}$/.test(value) || !i.guild!.channels.cache.has(value))) return i.reply({ content: 'أحد آيديات الرومات مو لروم في هذا السيرفر.', flags: 64 });
    await saveSettings({ ...data, staffRoleId: roleIds[0]!, onShiftRoleId: roleIds[1]!, leaveRoleId: roleIds[2]!, managementRoleId: roleIds[3]!, shiftChannelId: shiftChannelId!.trim(), leaveChannelId: leaveChannelId!.trim(), resignationChannelId: resignationChannelId!.trim(), logsChannelId: logsChannelId!.trim(), reportChannelId: reportChannelId?.trim() || null });
    return i.reply({ content: '✅ انضبط نظام الستاف بنجاح.', flags: 64 });
  }

  if (i.customId.startsWith('rating_panel_modal:')) {
    if (handledRatingInteractions.has(i.id)) return;
    handledRatingInteractions.add(i.id);
    setTimeout(() => handledRatingInteractions.delete(i.id), 10 * 60 * 1000);
    const staffUserId = i.customId.split(':')[1];
    if (!staffUserId) return i.reply({ content: 'الإداري غير صحيح.', flags: 64 });
    const settings = await requireSettings(i.guild.id);
    const target = await i.guild.members.fetch(staffUserId).catch(() => null);
    if (!target || !target.roles.cache.has(settings.staffRoleId) || target.user.bot) return i.reply({ content: 'ما ينفع تقيّم هذا العضو.', flags: 64 });
    if (staffUserId === i.user.id) return i.reply({ content: 'ما تقدر تقيّم نفسك.', flags: 64 });
    const rating = Number(i.fields.getTextInputValue('rating_score').trim());
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return i.reply({ content: 'عدد النجوم لازم يكون من 1 إلى 5.', flags: 64 });
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
    const ratingTitle = rating === 5 ? 'إداري ممتاز' : rating === 4 ? 'إداري مميز' : rating === 3 ? 'إداري جيد' : rating === 2 ? 'يحتاج تحسين' : 'يحتاج متابعة';
    const ratingChannel = settings.ratingChannelId ? await i.guild.channels.fetch(settings.ratingChannelId).catch(() => null) : null;
    if (ratingChannel?.isTextBased()) await ratingChannel.send({ embeds: [new EmbedBuilder().setColor(0x8b6cff).setTitle('تقييم إداري جديد').addFields({ name: 'الإداري', value: `<@${staffUserId}>`, inline: true }, { name: 'التقييم', value: `${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}  ${rating}/5`, inline: true }, { name: 'المعدل', value: `${averageRating.toFixed(2)}/5 · ${ratingCount} تقييم`, inline: true }, { name: 'المقيّم', value: `<@${i.user.id}>`, inline: true }, { name: 'الملاحظة', value: comment || 'بدون ملاحظة' }).setFooter({ text: ratingTitle }).setTimestamp()] });
    return i.reply({ content: `انسجّل تقييمك بنجاح: ${rating}/5. معدل الإداري الحين ${averageRating.toFixed(2)}/5.`, flags: 64 });
  }

  if (i.customId.startsWith('complaint_penalty:')) {
    const complaint = await Complaint.findById(i.customId.split(':')[1]);
    if (!complaint || complaint.status !== 'pending') return i.reply({ content: 'هذي الشكوى ما عادت معلّقة.', flags: 64 });
    const target = await i.guild.members.fetch(complaint.staffUserId).catch(() => null);
    if (target?.permissions.has('Administrator')) return i.reply({ content: 'الشكاوى ما تنطبق على الأدمن.', flags: 64 });
    const penaltyPoints = Number(i.fields.getTextInputValue('penalty_points').trim());
    if (!Number.isInteger(penaltyPoints) || penaltyPoints < 0) return i.reply({ content: 'نقاط الخصم لازم تكون رقم صحيح من 0 وفوق.', flags: 64 });
    const decisionNote = i.fields.getTextInputValue('decision_note').trim();
    complaint.status = 'approved';
    complaint.penaltyPoints = penaltyPoints;
    complaint.reviewedBy = i.user.id;
    complaint.reviewedAt = new Date();
    complaint.decisionNote = decisionNote || `انعتمدت من ديسكورد؛ انخصم ${penaltyPoints} نقطة.`;
    await complaint.save();
    const staff = await Staff.findOne({ guildId: i.guild.id, userId: complaint.staffUserId });
    if (staff && penaltyPoints > 0) { staff.points = Math.max(0, staff.points - penaltyPoints); await staff.save(); }
    await createLog(i.guild.id, 'COMPLAINT_REVIEWED', complaint.staffUserId, i.user.id, { complaintId: complaint.id, status: 'approved', penaltyPoints });
    return i.reply({ content: `✅ انعتمدت الشكوى. انخصم ${penaltyPoints} نقطة من <@${complaint.staffUserId}>.`, flags: 64 });
  }

  if (i.customId.startsWith('complaint_modal:')) {
    if (handledComplaintInteractions.has(i.id)) return;
    handledComplaintInteractions.add(i.id);
    setTimeout(() => handledComplaintInteractions.delete(i.id), 10 * 60 * 1000);
    const staffUserId = i.customId.split(':')[1];
    if (!staffUserId) return i.reply({ content: 'الشخص المشتكى عليه غير صحيح.', flags: 64 });
    if (staffUserId === i.user.id) return i.reply({ content: 'ما تقدر تشتكي على نفسك.', flags: 64 });
    const settings = await requireSettings(i.guild.id);
    const member = await i.guild.members.fetch(staffUserId).catch(() => null);
    const registered = await Staff.findOne({ guildId: i.guild.id, userId: staffUserId, active: true });
    if (!member || !registered || member.user.bot) return i.reply({ content: 'ما ينفع تشتكي على هذا العضو.', flags: 64 });
    const result = await createComplaintOnce({ guildId: i.guild.id, staffUserId, reporterUserId: i.user.id, reason: i.fields.getTextInputValue('complaint_reason'), evidence: i.fields.getTextInputValue('complaint_evidence') });
    const complaint = result.complaint;
    if (!result.created) return i.reply({ content: 'نفس الشكوى انسجلت قبل شوي، فما أرسلنا نسخة مكررة.', flags: 64 });
    if (settings.complaintChannelId) {
      const channel = await i.guild.channels.fetch(settings.complaintChannelId).catch(() => null);
      if (channel?.isTextBased()) await channel.send({ embeds: [new EmbedBuilder().setColor(0x8175f5).setTitle('◇ شكوى جديدة على إداري').addFields({ name: 'الإداري', value: `<@${staffUserId}>`, inline: true }, { name: 'المشتكي', value: `<@${i.user.id}>`, inline: true }, { name: 'التفاصيل', value: complaint.reason }, { name: 'الدليل', value: complaint.evidence || 'ما فيه دليل مرفق.' }).setFooter({ text: `شكوى Rift #${String(complaint._id).slice(-6)}` })], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`complaint_approve:${complaint._id}`).setLabel('اعتماد وخصم نقطة').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId(`complaint_reject:${complaint._id}`).setLabel('رفض').setStyle(ButtonStyle.Secondary))] });
    }
    await sendLog(i.client, i.guild.id, `◇ **شكوى جديدة**\n<@${i.user.id}> قدّم شكوى على <@${staffUserId}> — رقم: ${complaint._id}`);
    return i.reply({ content: '✅ انرسلت شكواك للإدارة عشان يراجعونها.', flags: 64 });
  }

  if (i.customId.startsWith('complaint_panel_modal:')) {
    if (handledComplaintInteractions.has(i.id)) return;
    handledComplaintInteractions.add(i.id);
    setTimeout(() => handledComplaintInteractions.delete(i.id), 10 * 60 * 1000);
    const staffUserId = i.customId.split(':')[1];
    if (!staffUserId) return i.reply({ content: 'بيانات الإداري غير صحيحة.', flags: 64 });
    if (staffUserId === i.user.id) return i.reply({ content: 'ما تقدر تشتكي على نفسك.', flags: 64 });
    const settings = await requireSettings(i.guild.id);
    const member = await i.guild.members.fetch(staffUserId).catch(() => null);
    const registered = await Staff.findOne({ guildId: i.guild.id, userId: staffUserId, active: true });
    if (!member || !registered || member.user.bot) return i.reply({ content: 'ما ينفع تشتكي على هذا العضو.', flags: 64 });
    const result = await createComplaintOnce({ guildId: i.guild.id, staffUserId, reporterUserId: i.user.id, reason: i.fields.getTextInputValue('complaint_reason'), evidence: i.fields.getTextInputValue('complaint_evidence') });
    const complaint = result.complaint;
    if (!result.created) return i.reply({ content: 'نفس الشكوى انسجلت قبل شوي، فما أرسلنا نسخة مكررة.', flags: 64 });
    const channel = settings.complaintChannelId ? await i.guild.channels.fetch(settings.complaintChannelId).catch(() => null) : null;
    if (channel?.isTextBased()) await channel.send({ embeds: [new EmbedBuilder().setColor(0xef6f83).setTitle('⚠️ شكوى جديدة').addFields({ name: 'الإداري', value: `<@${staffUserId}>`, inline: true }, { name: 'المشتكي', value: `<@${i.user.id}>`, inline: true }, { name: 'المشكلة', value: complaint.reason }, { name: 'الدليل', value: complaint.evidence || 'ما فيه' }).setFooter({ text: `شكوى #${String(complaint._id).slice(-6)}` })], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`complaint_approve:${complaint._id}`).setLabel('اعتماد وخصم نقاط').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId(`complaint_reject:${complaint._id}`).setLabel('رفض').setStyle(ButtonStyle.Secondary))] });
    await sendLog(i.client, i.guild.id, `◇ **شكوى رسمية**\n<@${i.user.id}> اشتكى على <@${staffUserId}> — ${complaint._id}`);
    return i.reply({ content: '✅ انرسلت الشكوى لروم المراجعة.', flags: 64 });
  }

  if (i.customId.startsWith('report_modal_submit:')) {
    const member = await i.guild.members.fetch(i.user.id);
    if (!await isStaff(member)) return i.reply({ content: 'هذا للستاف فقط.', flags: 64 });
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
      .setTitle(`📝 تقرير ${REPORT_TYPE_AR[reportType] || 'عام'}`)
      .addFields(
        { name: 'العنوان', value: report.title },
        { name: 'المرسل', value: `<@${i.user.id}>`, inline: true },
        { name: 'النوع', value: REPORT_TYPE_AR[reportType] || reportType, inline: true },
        { name: 'التاريخ', value: discordDate(report.createdAt), inline: true },
        { name: 'الشكاوى المسجلة', value: approvedComplaints.length ? `${approvedComplaints.length} شكوى معتمدة` : 'ما فيه شكاوى معتمدة', inline: true },
        { name: 'التفاصيل', value: report.content.slice(0, 1024) || 'ما فيه تفاصيل.' }
      )
      .setFooter({ text: `رقم التقرير: ${String(report._id).slice(-6)}` });

    const dm = await member.createDM();
    await dm.send({ embeds: [embed] }).catch(() => undefined);

    if (settings.reportChannelId) {
      const channel = await i.guild.channels.fetch(settings.reportChannelId).catch(() => null);
      if (channel?.isTextBased()) {
        await channel.send({ embeds: [embed] }).catch(() => undefined);
      } else {
        await sendLog(i.client, i.guild.id, `⚠️ روم التقارير <#${settings.reportChannelId}> مو موجود أو مو روم كتابي.`);
      }
    } else {
      await sendLog(i.client, i.guild.id, `⚠️ روم التقارير مو محدد. التقرير انرسل لخاص صاحبه بس.`);
    }

    await sendLog(i.client, i.guild.id, `📝 **تقرير جديد**\n<@${i.user.id}> — ${report.title} (${REPORT_TYPE_AR[reportType] || reportType})`);
    return i.reply({ content: '✅ انرفع تقريرك. أرسلنا نسخة لخاصك ولروم التقارير.', flags: 64 });
  }
}
