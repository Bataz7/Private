import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChatInputCommandInteraction, StringSelectMenuBuilder,
  EmbedBuilder, ModalBuilder, PermissionFlagsBits,
  TextInputBuilder, TextInputStyle, AttachmentBuilder
} from 'discord.js';
import { requireSettings } from '../services/settings.service.js';
import { Shift } from '../models/Shift.js';
import { LeaveRequest } from '../models/LeaveRequest.js';
import { ResignationRequest } from '../models/ResignationRequest.js';
import { Report } from '../models/Report.js';
import { Staff } from '../models/Staff.js';
import { StaffRating } from '../models/StaffRating.js';
import { Complaint } from '../models/Complaint.js';
import { isAdministrator, isManagement, isStaff } from '../utils/permissions.js';
import { activeMs, breakMs, duration, getActiveShift, isOnBreak, resumeShift, startBreak } from '../services/shift.service.js';
import { getPendingReports } from '../services/report.service.js';
import { discordDate } from '../utils/format.js';
import { buildShiftPanel } from '../utils/shift-panel.js';
import { autoShiftConfig } from '../services/auto-shift.service.js';
import { buildLeavePanel } from '../utils/leave-panel.js';
import { buildStaffCard } from '../utils/staff-card.js';
import { buildComplaintPanel } from '../utils/complaint-panel.js';
import { buildRatingPanel } from '../utils/rating-panel.js';

const ratingPanelTimers = new Map<string, NodeJS.Timeout>();
const complaintPanelPublishing = new Set<string>();

export async function handleCommand(i: ChatInputCommandInteraction) {
  if (!i.guild) return i.reply({ content: 'This bot can only be used in a server.', flags: 64 });

  if (i.commandName === 'staff') {
    const sub = i.options.getSubcommand();
    if (sub === 'setup') return staffSetup(i);
    if (sub === 'stats') return staffStats(i);
    if (sub === 'history') return staffHistory(i);
    if (sub === 'panel') return staffPanel(i);
    if (sub === 'add') return staffAdd(i);
    if (sub === 'remove') return staffRemove(i);
    if (sub === 'list') return staffList(i);
    if (sub === 'points') return staffPoints(i);
    if (sub === 'leaderboard') return staffLeaderboard(i);
  }

  if (i.commandName === 'shift') {
    const sub = i.options.getSubcommand();
    if (sub === 'panel') return shiftPanel(i);
    if (sub === 'history') return shiftHistory(i);
    if (sub === 'stats') return shiftStats(i);
    if (sub === 'break') return shiftBreak(i);
    if (sub === 'status') return shiftStatus(i);
  }

  if (i.commandName === 'report') {
    const sub = i.options.getSubcommand();
    if (sub === 'panel') return reportPanel(i);
    if (sub === 'submit') return reportSubmit(i);
    if (sub === 'history') return reportHistory(i);
    if (sub === 'stats') return reportStats(i);
    if (sub === 'review') return reportReview(i);
  }

  if (i.commandName === 'rating') {
    const sub = i.options.getSubcommand();
    if (sub === 'panel') return ratingPanel(i);
    if (sub === 'submit') return submitRating(i);
    if (sub === 'stats') return ratingStats(i);
  }

  if (i.commandName === 'complaint') {
    const sub = i.options.getSubcommand();
    if (sub === 'panel') return complaintPanel(i);
    if (sub === 'submit') return complaintSubmit(i);
  }
  if (i.commandName === 'points') return staffPoints(i);
  if (i.commandName === 'help') return pointsHelp(i);
}

async function ratingPanel(i: ChatInputCommandInteraction) {
  await i.deferReply();
  const member = await i.guild!.members.fetch(i.user.id);
  if (!isAdministrator(member)) return i.editReply({ content: 'يلزمك صلاحية Administrator.' });
  const settings = await requireSettings(i.guild!.id);
  const payload = await buildRatingPanel(i.guild!);
  if (!payload) return i.editReply({ content: 'لا يوجد ستاف مسجل مؤهل للتقييم.' });
  const channel = settings.ratingChannelId ? await i.guild!.channels.fetch(settings.ratingChannelId).catch(() => null) : null;
  if (channel?.isTextBased()) {
    const message = await channel.send(payload);
    const timerKey = `${i.guild!.id}:${channel.id}`;
    const oldTimer = ratingPanelTimers.get(timerKey); if (oldTimer) clearInterval(oldTimer);
    ratingPanelTimers.set(timerKey, setInterval(async () => { const updated = await buildRatingPanel(i.guild!).catch(() => null); if (updated) await message.edit(updated).catch(() => undefined); }, 30_000));
    return i.editReply({ content: `✅ تم إرسال بانل التقييم وتحديث الستاف كل 30 ثانية في <#${channel.id}>.` });
  }
  return i.editReply(payload);
}


async function pointsHelp(i: ChatInputCommandInteraction) {
  const member = await i.guild!.members.fetch(i.user.id);
  if (!await isStaff(member)) return i.reply({ content: 'This help guide is available to staff members only.', flags: 64 });
  return i.reply({ flags: 64, embeds: [new EmbedBuilder().setColor(0x8175f5).setTitle('Rift Staff Points System').setDescription('Your private guide to points, activity, and the weekly report.').addFields(
    { name: 'Automatic shifts and points', value: 'A shift begins by itself after **20 messages within 10 minutes** (the server can change this), or when a staff member joins an unmuted voice channel. It ends after 30 minutes without activity.\n\n• **+1 point** for every 30 active shift minutes\n• **+3 points** for every 100 chat messages during a shift\n• **+1 point** for every 30 voice minutes during a shift\n• **-1 point** when a complaint is approved', inline: false },
    { name: 'Weekly report', value: 'Every **week**, Rift sends a performance report with shift hours, activity hours, voice time, messages, ratings, points, and approved complaints. Administrators can review reports and add a private note.', inline: false },
    { name: 'Private commands', value: '`/points` shows your private card.\n`/staff leaderboard` shows the public ranking.\n`/report stats` shows a full performance card.', inline: false }
  ).setFooter({ text: 'Rift Staff Operations' }).setTimestamp()] });
}

async function complaintPanel(i: ChatInputCommandInteraction) {
  await i.deferReply();
  const settings = await requireSettings(i.guild!.id);
  if (!await isManagement(await i.guild!.members.fetch(i.user.id))) return i.editReply({ content: 'هذا الأمر متاح للإدارة فقط.' });
  const payload = buildComplaintPanel(settings.botLanguage === 'ar' ? 'ar' : 'en');
  const channel = settings.complaintChannelId ? await i.guild!.channels.fetch(settings.complaintChannelId).catch(() => null) : null;
  if (channel?.isTextBased()) {
    if (complaintPanelPublishing.has(channel.id)) return i.editReply({ content: '⏳ بانل الشكاوى قيد التحديث بالفعل.' });
    complaintPanelPublishing.add(channel.id);
    const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    const panels = [...(messages?.filter(message => message.author.id === i.client.user?.id && message.components.some(row => 'components' in row && row.components.some(component => 'customId' in component && component.customId === 'complaint_panel_submit'))).values() ?? [])].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    const existing = panels[0];
    if (existing) await existing.edit(payload);
    else await channel.send(payload);
    for (const duplicate of panels.slice(1)) await duplicate.delete().catch(() => undefined);
    complaintPanelPublishing.delete(channel.id);
    return i.editReply({ content: `✅ تم تحديث بانل الشكاوى وتنظيف النسخ المكررة في <#${channel.id}>.` });
  }
  return i.editReply(payload);
}

async function complaintSubmit(i: ChatInputCommandInteraction) {
  const settings = await requireSettings(i.guild!.id);
  const staff = i.options.getUser('staff', true);
  if (staff.id === i.user.id) return i.reply({ content: 'لا يمكنك تقديم شكوى على نفسك.', flags: 64 });
  const member = await i.guild!.members.fetch(staff.id).catch(() => null);
  const registered = await Staff.findOne({ guildId: i.guild!.id, userId: staff.id, active: true });
  if (!member || !registered || staff.bot) return i.reply({ content: 'لا يمكن تقديم الشكوى على هذا العضو.', flags: 64 });
  const modal = new ModalBuilder().setCustomId(`complaint_modal:${staff.id}`).setTitle('Submit Staff Complaint');
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('complaint_reason').setLabel('What happened?').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)),
    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('complaint_evidence').setLabel('Evidence or context (optional)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1500))
  );
  return i.showModal(modal);
}

async function submitRating(i: ChatInputCommandInteraction) {
  const settings = await requireSettings(i.guild!.id);
  const staffUser = i.options.getUser('staff', true);
  if (staffUser.id === i.user.id) return i.reply({ content: 'لا يمكنك تقييم نفسك.', flags: 64 });
  const member = await i.guild!.members.fetch(staffUser.id).catch(() => null);
  if (!member || !member.roles.cache.has(settings.staffRoleId) || isAdministrator(member)) return i.reply({ content: 'Ratings do not apply to Administrators.', flags: 64 });
  if (staffUser.id === i.user.id) return i.reply({ content: 'You cannot rate yourself.', flags: 64 });
  const score = i.options.getInteger('score', true);
  const comment = i.options.getString('comment') ?? '';
  await StaffRating.create({ guildId: i.guild!.id, staffUserId: staffUser.id, reviewerUserId: i.user.id, rating: score, comment, createdAt: new Date() });
  return i.reply({ content: `✅ Your ${score}/5 rating for ${staffUser} was submitted.`, flags: 64 });
}

async function ratingStats(i: ChatInputCommandInteraction) {
  const settings = await requireSettings(i.guild!.id);
  const staffUser = i.options.getUser('staff', true);
  if (!await isManagement(await i.guild!.members.fetch(i.user.id))) return i.reply({ content: 'Management only.', flags: 64 });
  const member = await i.guild!.members.fetch(staffUser.id).catch(() => null);
  if (!member || !member.roles.cache.has(settings.staffRoleId)) return i.reply({ content: 'Staff member not found.', flags: 64 });
  const rows = await StaffRating.find({ guildId: i.guild!.id, staffUserId: staffUser.id }).sort({ createdAt: -1 }).limit(50);
  const average = rows.length ? rows.reduce((total, row) => total + row.rating, 0) / rows.length : 0;
  const breakdown = [5, 4, 3, 2, 1].map(score => `Rift ${score}/5: ${rows.filter(row => row.rating === score).length}`).join('\n');
  return i.reply({ embeds: [new EmbedBuilder().setTitle(`Rift Ratings — ${staffUser.tag}`).setDescription(`Average: **${average.toFixed(2)}/5**\nTotal: **${rows.length}**\n\n${breakdown}`)], flags: 64 });
}

async function reportStats(i: ChatInputCommandInteraction) {
  const member = await i.guild!.members.fetch(i.user.id);
  const management = await isManagement(member);
  const user = i.options.getUser('user') ?? i.user;
  if (user.id !== i.user.id && !management) return i.reply({ content: 'Management only for other staff reports.', flags: 64 });
  const staff = await Staff.findOne({ guildId: i.guild!.id, userId: user.id });
  const shifts = await Shift.find({ guildId: i.guild!.id, userId: user.id });
  const approvedComplaints = await Complaint.find({ guildId: i.guild!.id, staffUserId: user.id, status: 'approved' });
  const totalHours = shifts.reduce((total, shift) => total + activeMs(shift), 0) / 3600000;
  const points = staff?.points ?? 0;
  const image = await buildStaffCard({ name: user.username, avatar: user.displayAvatarURL({ extension: 'png', size: 256 }), points, complaints: approvedComplaints.length, shiftHours: totalHours, voiceHours: (staff?.voiceMinutes ?? 0) / 60, messages: staff?.messageCount ?? 0 });
  return i.reply({ files: [new AttachmentBuilder(image, { name: 'rift-staff-report.png' })] });
}

async function staffSetup(i: ChatInputCommandInteraction) {
  const member = await i.guild!.members.fetch(i.user.id);
  if (!member.permissions.has(PermissionFlagsBits.Administrator)) return i.reply({ content: 'Administrator permission is required.', flags: 64 });

  const roles = i.guild!.roles.cache.filter(r => !r.managed).sort((a,b) => b.position - a.position).first(25);
  const channels = i.guild!.channels.cache.filter(c => c.isTextBased()).first(25);

  const roleOptions = [...roles].map(r => ({ label: r.name.slice(0,100), value: r.id }));
  const channelOptions = [...channels].map(c => ({ label: c.name.slice(0,100), value: c.id }));

  const modal = new ModalBuilder().setCustomId('setup_modal').setTitle('Rift Server Setup');
  const staff = new TextInputBuilder().setCustomId('staff_role').setLabel('Staff role ID').setPlaceholder('Role ID for registered staff').setStyle(TextInputStyle.Short).setRequired(true);
  const onShift = new TextInputBuilder().setCustomId('on_shift_role').setLabel('On-shift role ID').setPlaceholder('Role ID applied during an active shift').setStyle(TextInputStyle.Short).setRequired(true);
  const leave = new TextInputBuilder().setCustomId('leave_role').setLabel('Leave role ID').setPlaceholder('Role ID applied during approved leave').setStyle(TextInputStyle.Short).setRequired(true);
  const management = new TextInputBuilder().setCustomId('management_role').setLabel('Management role ID').setPlaceholder('Optional management role ID').setStyle(TextInputStyle.Short).setRequired(true);
  const channelsField = new TextInputBuilder().setCustomId('channels').setLabel('Channel IDs: shift, leave, logs, reports').setPlaceholder('shift, leave, resignation, logs, reports').setStyle(TextInputStyle.Paragraph).setRequired(true);
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(staff),
    new ActionRowBuilder<TextInputBuilder>().addComponents(onShift),
    new ActionRowBuilder<TextInputBuilder>().addComponents(leave),
    new ActionRowBuilder<TextInputBuilder>().addComponents(management),
    new ActionRowBuilder<TextInputBuilder>().addComponents(channelsField)
  );
  await i.showModal(modal);
}

async function staffPanel(i: ChatInputCommandInteraction) {
  const settings = await requireSettings(i.guild!.id);
  if (!await isManagement(await i.guild!.members.fetch(i.user.id))) return i.reply({ content: 'Management only.', flags: 64 });
  const embed = new EmbedBuilder().setTitle('🛡️ Staff Management').setDescription('Use the buttons below to access staff tools.');
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('staff_stats').setLabel('Team Stats').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('staff_config_info').setLabel('Configuration').setStyle(ButtonStyle.Secondary)
  );
  return i.reply({ embeds: [embed], components: [row], flags: 64 });
}

async function staffAdd(i: ChatInputCommandInteraction) {
  return i.reply({ content: 'إضافة الستاف متاحة من الداشبورد فقط.', flags: 64 });
}

async function staffRemove(i: ChatInputCommandInteraction) {
  const settings = await requireSettings(i.guild!.id);
  if (!await isManagement(await i.guild!.members.fetch(i.user.id))) return i.reply({ content: 'Administrator permission required.', flags: 64 });
  const user = i.options.getUser('user', true);
  const staff = await Staff.findOne({ guildId: i.guild!.id, userId: user.id });
  if (!staff || !staff.active) return i.reply({ content: 'This member is not an active staff member.', flags: 64 });
  staff.active = false;
  await staff.save();
  const member = await i.guild!.members.fetch(user.id).catch(() => null);
  if (member) await member.roles.remove(settings.staffRoleId, `Staff removed by ${i.user.tag}`).catch(() => undefined);
  return i.reply({ content: `✅ ${user} has been removed from the staff team.`, flags: 64 });
}

async function staffList(i: ChatInputCommandInteraction) {
  if (!await isManagement(await i.guild!.members.fetch(i.user.id))) return i.reply({ content: 'Management only.', flags: 64 });
  const rows = await Staff.find({ guildId: i.guild!.id, active: true }).sort({ joinedAt: 1 });
  const text = rows.length ? rows.map(staff => `<@${staff.userId}> — joined ${discordDate(staff.joinedAt, 'd')}`).join('\n') : 'No staff members have been registered yet.';
  return i.reply({ embeds: [new EmbedBuilder().setTitle('👥 Staff Members').setDescription(text)], flags: 64 });
}

async function staffPoints(i: ChatInputCommandInteraction) {
  const settings = await requireSettings(i.guild!.id);
  const member = await i.guild!.members.fetch(i.user.id);
  if (!await isStaff(member)) return i.reply({ content: 'Staff only.', flags: 64 });
  const staff = await Staff.findOne({ guildId: i.guild!.id, userId: i.user.id });
  return i.reply({ flags: 64, embeds: [new EmbedBuilder().setColor(0x8175f5).setTitle('💜 Your Rift Points').setDescription(`**${staff?.points ?? 0} points**`).setThumbnail(i.user.displayAvatarURL({ extension: 'png', size: 128 })).setFooter({ text: 'Private to you' }).setTimestamp()] });
}

async function staffLeaderboard(i: ChatInputCommandInteraction) {
  await i.deferReply();
  const settings = await requireSettings(i.guild!.id);
  const member = await i.guild!.members.fetch(i.user.id);
  if (!await isStaff(member)) return i.editReply({ content: settings.botLanguage === 'ar' ? 'هذا الأمر متاح للستاف فقط.' : 'This command is for staff only.' });
  const ar = settings.botLanguage === 'ar';
  const rows = await Staff.find({ guildId: i.guild!.id, active: true }).sort({ points: -1 }).limit(10);
  const lines = rows.length ? rows.map((row, index) => {
    const medal = ['🥇', '🥈', '🥉'][index] || `**${index + 1}**`;
    return ar
      ? `${medal} <@${row.userId}>\n> **${row.points} نقطة**  •  ${row.messageCount} رسالة  •  ${(row.voiceMinutes / 60).toFixed(1)} ساعة فويس`
      : `${medal} <@${row.userId}>\n> **${row.points} points**  •  ${row.messageCount} messages  •  ${(row.voiceMinutes / 60).toFixed(1)}h voice`;
  }).join('\n\n') : (ar ? 'لا توجد بيانات ليدر بورد حتى الآن.' : 'No leaderboard data yet.');
  return i.editReply({ embeds: [new EmbedBuilder().setColor(0x8175f5).setTitle('🏆 Rift Staff Leaderboard').setDescription(`${ar ? 'ترتيب الستاف حسب النقاط' : 'Staff ranked by points'}\n\n${lines}`).addFields({ name: ar ? 'نظام النقاط' : 'How points work', value: ar ? 'نقطة لكل 30 دقيقة شفت، و3 نقاط لكل 100 رسالة خلال الشفت، ونقطة لكل 30 دقيقة فويس خلال الشفت.' : '1 point per 30 minutes on shift · 3 points per 100 messages during a shift · 1 point per 30 minutes in voice during a shift.', inline: false }).setFooter({ text: 'Rift Staff Operations' }).setTimestamp()] });
}

async function shiftPanel(i: ChatInputCommandInteraction) {
  const settings = await requireSettings(i.guild!.id);
  if (!await isStaff(await i.guild!.members.fetch(i.user.id))) return i.reply({ content: 'Staff only.', flags: 64 });
  const active = await Shift.findOne({ guildId: i.guild!.id, userId: i.user.id, status: 'active' });
  const auto = autoShiftConfig(settings);
  return i.reply(buildShiftPanel({ messages: auto.messages, windowMinutes: Math.round(auto.windowMs / 60_000), idleMinutes: Math.round(auto.idleMs / 60_000), enabled: auto.enabled }));
}

async function shiftBreak(i: ChatInputCommandInteraction) {
  const member = await i.guild!.members.fetch(i.user.id);
  if (!await isStaff(member)) return i.reply({ content: 'هذا الأمر متاح للستاف فقط.', flags: 64 });
  const shift = await getActiveShift(i.guild!.id, i.user.id);
  if (!shift) return i.reply({ content: 'لا يوجد لديك شفت نشط.', flags: 64 });
  if (isOnBreak(shift)) {
    await resumeShift(i.guild!.id, i.user.id);
    return i.reply({ content: '▶️ تم إنهاء البريك واستؤنف احتساب وقت الشفت والتفاعل.', flags: 64 });
  }
  await startBreak(i.guild!.id, i.user.id);
  return i.reply({ content: '⏸️ بدأ البريك. مدته القصوى 30 دقيقة، ولن يتم احتساب نقاط أو تفاعل حتى تعود.', flags: 64 });
}

async function shiftStatus(i: ChatInputCommandInteraction) {
  const shift = await getActiveShift(i.guild!.id, i.user.id);
  if (!shift) return i.reply({ content: '🔴 ما عندك شفت نشط حاليًا.', flags: 64 });
  const onBreak = isOnBreak(shift);
  const currentBreak = shift.breaks.at(-1);
  const breakRemaining = onBreak && currentBreak
    ? Math.max(0, 30 - Math.floor((Date.now() - new Date(currentBreak.startedAt).getTime()) / 60000))
    : 0;
  const messages = Number(shift.interactionMessageCount ?? 0);
  const messagesToNextReward = messages % 100 === 0 ? 100 : 100 - (messages % 100);
  return i.reply({
    embeds: [new EmbedBuilder()
      .setColor(onBreak ? 0xf0ad4e : 0x43b581)
      .setTitle('⏱️ حالتك الحالية في الشفت')
      .addFields(
        { name: 'الحالة', value: onBreak ? `⏸️ بريك — متبقي تقريبًا ${breakRemaining} دقيقة` : '🟢 الشفت يعمل', inline: false },
        { name: 'مدة الشفت', value: duration(activeMs(shift)), inline: true },
        { name: 'رسائل الشفت', value: String(messages), inline: true },
        { name: 'نقاط الوقت', value: String(shift.pointsAwarded ?? 0), inline: true },
        { name: 'نقاط التفاعل', value: String(shift.interactionPointsAwarded ?? 0), inline: true },
        { name: 'المتبقي للنقاط القادمة', value: `${messagesToNextReward} رسالة = 3 نقاط`, inline: true }
      )
      .setFooter({ text: 'يتم تحديث الحالة عند استخدام الأمر مرة أخرى' })],
    flags: 64
  });
}

async function leavePanel(i: ChatInputCommandInteraction) {
  const settings = await requireSettings(i.guild!.id);
  return i.reply(buildLeavePanel(settings.botLanguage));
}

async function resignationPanel(i: ChatInputCommandInteraction) {
  await requireSettings(i.guild!.id);
  const embed = new EmbedBuilder().setTitle('🚪 Staff Resignation').setDescription('If you wish to resign from the staff team, submit your request below.');
  return i.reply({ embeds: [embed], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('resignation_request').setLabel('Submit Resignation').setEmoji('🚪').setStyle(ButtonStyle.Danger))] });
}

async function staffStats(i: ChatInputCommandInteraction) {
  if (!await isManagement(await i.guild!.members.fetch(i.user.id))) return i.reply({ content: 'Management only.', flags: 64 });
  const settings = await requireSettings(i.guild!.id);
  const members = await i.guild!.members.fetch();
  const staff = members.filter(m => m.roles.cache.has(settings.staffRoleId));
  const active = await Shift.countDocuments({ guildId: i.guild!.id, status: 'active' });
  return i.reply({ embeds: [new EmbedBuilder().setTitle('📊 Team Statistics').setDescription(`👥 Staff: ${staff.size}\n🟢 On Shift: ${active}\n📅 Active Leave Requests: ${await LeaveRequest.countDocuments({ guildId: i.guild!.id, status: 'approved' })}\n🚪 Pending Resignations: ${await ResignationRequest.countDocuments({ guildId: i.guild!.id, status: 'pending' })}`)] });
}

async function staffHistory(i: ChatInputCommandInteraction) {
  if (!await isManagement(await i.guild!.members.fetch(i.user.id))) return i.reply({ content: 'Management only.', flags: 64 });
  const user = i.options.getUser('user', true);
  return shiftHistoryFor(i, user.id, user.tag);
}

async function shiftHistory(i: ChatInputCommandInteraction) {
  const user = i.options.getUser('user') ?? i.user;
  if (user.id !== i.user.id && !await isManagement(await i.guild!.members.fetch(i.user.id))) return i.reply({ content: 'Management only.', flags: 64 });
  return shiftHistoryFor(i, user.id, user.tag);
}

async function shiftHistoryFor(i: ChatInputCommandInteraction, userId: string, label: string) {
  const rows = await Shift.find({ guildId: i.guild!.id, userId }).sort({ startedAt: -1 }).limit(10);
  const text = rows.length ? rows.map(s => `• ${discordDate(s.startedAt)} → ${s.endedAt ? discordDate(s.endedAt) : '🟢 Active'} — ${duration(activeMs(s))}`).join('\n') : 'No shifts found.';
  return i.reply({ embeds: [new EmbedBuilder().setTitle(`📋 Shift History — ${label}`).setDescription(text)] });
}

async function shiftStats(i: ChatInputCommandInteraction) {
  await i.deferReply();
  const staffRows = await Staff.find({ guildId: i.guild!.id });
  const activeShifts = await Shift.find({ guildId: i.guild!.id, status: 'active' });
  const activeByUser = new Map(activeShifts.map(shift => [shift.userId, shift]));
  const text = staffRows.length ? staffRows.map(staff => {
    const active = activeByUser.get(staff.userId);
    const status = !staff.active ? 'متوقف' : active ? `مفعل (${duration(activeMs(active))})` : 'غير مفعل';
    return `<@${staff.userId}> — **${status}**`;
  }).join('\n') : 'لا يوجد ستاف مسجل من الداشبورد.';
  return i.editReply({ embeds: [new EmbedBuilder().setColor(0x8175f5).setTitle('📊 حالات الشفتات').setDescription(text).setFooter({ text: 'مفعل = لديه شفت نشط · غير مفعل = لا يوجد شفت نشط · متوقف = تمت إزالته من الستاف' })] });
}

async function reportPanel(i: ChatInputCommandInteraction) {
  await requireSettings(i.guild!.id);
  const embed = new EmbedBuilder().setTitle('📝 Staff Reports').setDescription('Submit a shift summary, incident report, or general report. Reports are sent to your DMs and the report channel.');
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('report_submit').setLabel('Submit Report').setEmoji('📝').setStyle(ButtonStyle.Primary)
  );
  return i.reply({ embeds: [embed], components: [row] });
}

async function reportSubmit(i: ChatInputCommandInteraction) {
  await requireSettings(i.guild!.id);
  const embed = new EmbedBuilder().setTitle('📝 Submit a Report').setDescription('Select the report type below, then fill in the details in the modal.');
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('report_modal:shift_summary').setLabel('Shift Summary').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('report_modal:incident').setLabel('Incident').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('report_modal:general').setLabel('General').setStyle(ButtonStyle.Secondary)
  );
  return i.reply({ embeds: [embed], components: [row], flags: 64 });
}

async function reportHistory(i: ChatInputCommandInteraction) {
  const rows = await Report.find({ guildId: i.guild!.id, userId: i.user.id }).sort({ createdAt: -1 }).limit(20);
  if (!rows.length) return i.reply({ content: 'You have no submitted reports.', flags: 64 });
  const text = rows.map(r => `• ${discordDate(r.createdAt)} — **${r.title}** (${r.status})`).join('\n');
  return i.reply({ embeds: [new EmbedBuilder().setTitle('📋 Your Reports').setDescription(text)], flags: 64 });
}

async function reportReview(i: ChatInputCommandInteraction) {
  if (!await isManagement(await i.guild!.members.fetch(i.user.id))) return i.reply({ content: 'Management only.', flags: 64 });
  const rows = await getPendingReports(i.guild!.id);
  if (!rows.length) return i.reply({ content: 'No pending reports.', flags: 64 });
  const text = rows.map(r => `• ${discordDate(r.createdAt)} — **${r.title}** — <@${r.userId}>`).join('\n');
  const row = new ActionRowBuilder<ButtonBuilder>();
  for (const r of rows.slice(0, 5)) {
    row.addComponents(new ButtonBuilder().setCustomId(`report_review:${r._id}`).setLabel(`Review #${String(r._id).slice(-6)}`).setStyle(ButtonStyle.Success));
  }
  return i.reply({ embeds: [new EmbedBuilder().setTitle('📋 Pending Reports').setDescription(text)], components: [row], flags: 64 });
}
