import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChatInputCommandInteraction, StringSelectMenuBuilder,
  EmbedBuilder, ModalBuilder, PermissionFlagsBits,
  TextInputBuilder, TextInputStyle, AttachmentBuilder
} from '../lib/djs/index.js';
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
import { staffCardData } from '../core/profile-stats.js';
import { buildComplaintPanel } from '../utils/complaint-panel.js';
import { buildRatingPanel } from '../utils/rating-panel.js';

const ratingPanelTimers = new Map<string, NodeJS.Timeout>();
const REPORT_STATUS: Record<string, string> = { pending: 'ينتظر', reviewed: 'تمت المراجعة', approved: 'مقبول', rejected: 'مرفوض' };
const complaintPanelPublishing = new Set<string>();

export async function handleCommand(i: ChatInputCommandInteraction) {
  if (!i.guild) return i.reply({ content: 'هذا البوت يشتغل في السيرفر بس.', flags: 64 });

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
  if (!await isStaff(member)) return i.reply({ content: 'هذا الدليل للستاف فقط.', flags: 64 });
  return i.reply({ flags: 64, embeds: [new EmbedBuilder().setColor(0x8175f5).setTitle('نظام نقاط ستاف Rift').setDescription('دليلك الخاص للنقاط والنشاط والتقرير الأسبوعي.').addFields(
    { name: 'الشفتات التلقائية والنقاط', value: 'الشفت يبدأ لحاله بعد **20 رسالة خلال 10 دقايق** (السيرفر يقدر يغيّرها)، أو لما تدخل روم صوتي. شفت الرسائل ينتهي بعد 30 دقيقة بدون نشاط، وفي الفويس يسألك البوت «هل انت موجود؟» كل ساعة بدون تفاعل.\n\n• **+1 نقطة** كل 30 دقيقة شفت\n• **+3 نقاط** كل 100 رسالة وأنت في الشفت\n• **+1 نقطة** كل 30 دقيقة فويس وأنت في الشفت\n• **-1 نقطة** لما تنقبل شكوى عليك', inline: false },
    { name: 'التقرير الأسبوعي', value: 'كل **أسبوع** يرسل Rift تقرير أداء فيه ساعات الشفت والنشاط والفويس والرسائل والتقييمات والنقاط والشكاوى المقبولة. الإدارة تقدر تراجع التقارير وتضيف ملاحظة خاصة.', inline: false },
    { name: 'أوامر خاصة', value: '`/points` نقاطك.\n`/staff leaderboard` الترتيب العام.\n`/report stats` بطاقة أداء كاملة.', inline: false }
  ).setFooter({ text: 'Rift · إدارة الستاف' }).setTimestamp()] });
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
  const modal = new ModalBuilder().setCustomId(`complaint_modal:${staff.id}`).setTitle('شكوى على إداري');
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('complaint_reason').setLabel('وش صار؟').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)),
    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('complaint_evidence').setLabel('دليل أو تفاصيل (اختياري)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1500))
  );
  return i.showModal(modal);
}

async function submitRating(i: ChatInputCommandInteraction) {
  const settings = await requireSettings(i.guild!.id);
  const staffUser = i.options.getUser('staff', true);
  if (staffUser.id === i.user.id) return i.reply({ content: 'لا يمكنك تقييم نفسك.', flags: 64 });
  const member = await i.guild!.members.fetch(staffUser.id).catch(() => null);
  if (!member || !member.roles.cache.has(settings.staffRoleId) || isAdministrator(member)) return i.reply({ content: 'التقييم ما ينطبق على هذا العضو (مو ستاف أو أدمن).', flags: 64 });
  const score = i.options.getInteger('score', true);
  const comment = i.options.getString('comment') ?? '';
  await StaffRating.create({ guildId: i.guild!.id, staffUserId: staffUser.id, reviewerUserId: i.user.id, rating: score, comment, createdAt: new Date() });
  return i.reply({ content: `✅ انرسل تقييمك ${score}/5 لـ ${staffUser}.`, flags: 64 });
}

async function ratingStats(i: ChatInputCommandInteraction) {
  const settings = await requireSettings(i.guild!.id);
  const staffUser = i.options.getUser('staff', true);
  if (!await isManagement(await i.guild!.members.fetch(i.user.id))) return i.reply({ content: 'هذا الأمر للإدارة فقط.', flags: 64 });
  const member = await i.guild!.members.fetch(staffUser.id).catch(() => null);
  if (!member || !member.roles.cache.has(settings.staffRoleId)) return i.reply({ content: 'ما لقيت هذا الإداري.', flags: 64 });
  const rows = await StaffRating.find({ guildId: i.guild!.id, staffUserId: staffUser.id }).sort({ createdAt: -1 }).limit(50);
  const average = rows.length ? rows.reduce((total, row) => total + row.rating, 0) / rows.length : 0;
  const breakdown = [5, 4, 3, 2, 1].map(score => `${'⭐'.repeat(score)} ${score}/5: ${rows.filter(row => row.rating === score).length}`).join('\n');
  return i.reply({ embeds: [new EmbedBuilder().setTitle(`تقييمات ${staffUser.tag}`).setDescription(`المعدل: **${average.toFixed(2)}/5**\nالعدد: **${rows.length}**\n\n${breakdown}`)], flags: 64 });
}

async function reportStats(i: ChatInputCommandInteraction) {
  const member = await i.guild!.members.fetch(i.user.id);
  const management = await isManagement(member);
  const user = i.options.getUser('user') ?? i.user;
  if (user.id !== i.user.id && !management) return i.reply({ content: 'بس الإدارة تقدر تشوف بطاقة إداري ثاني.', flags: 64 });
  await i.deferReply();
  const data = await staffCardData(i.guild!, user);
  if (!data) return i.editReply({ content: 'هذا العضو مو في قائمة الستاف بعد.' });
  return i.editReply(buildStaffCard(data));
}

async function staffSetup(i: ChatInputCommandInteraction) {
  const member = await i.guild!.members.fetch(i.user.id);
  if (!member.permissions.has(PermissionFlagsBits.Administrator)) return i.reply({ content: 'يلزمك صلاحية Administrator.', flags: 64 });

  const roles = i.guild!.roles.cache.filter(r => !r.managed).sort((a,b) => b.position - a.position).first(25);
  const channels = i.guild!.channels.cache.filter(c => c.isTextBased()).first(25);

  const roleOptions = [...roles].map(r => ({ label: r.name.slice(0,100), value: r.id }));
  const channelOptions = [...channels].map(c => ({ label: c.name.slice(0,100), value: c.id }));

  const modal = new ModalBuilder().setCustomId('setup_modal').setTitle('إعداد Rift للسيرفر');
  const staff = new TextInputBuilder().setCustomId('staff_role').setLabel('آيدي رتبة الستاف').setPlaceholder('رتبة الستاف المسجلين').setStyle(TextInputStyle.Short).setRequired(true);
  const onShift = new TextInputBuilder().setCustomId('on_shift_role').setLabel('آيدي رتبة الشفت').setPlaceholder('تنعطى وقت الشفت النشط').setStyle(TextInputStyle.Short).setRequired(true);
  const leave = new TextInputBuilder().setCustomId('leave_role').setLabel('آيدي رتبة الإجازة').setPlaceholder('تنعطى وقت الإجازة المقبولة').setStyle(TextInputStyle.Short).setRequired(true);
  const management = new TextInputBuilder().setCustomId('management_role').setLabel('آيدي رتبة الإدارة').setPlaceholder('رتبة الإدارة').setStyle(TextInputStyle.Short).setRequired(true);
  const channelsField = new TextInputBuilder().setCustomId('channels').setLabel('آيديات الرومات (بفواصل)').setPlaceholder('الشفت، الإجازات، الاستقالات، اللوق، التقارير').setStyle(TextInputStyle.Paragraph).setRequired(true);
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
  if (!await isManagement(await i.guild!.members.fetch(i.user.id))) return i.reply({ content: 'هذا الأمر للإدارة فقط.', flags: 64 });
  const embed = new EmbedBuilder().setTitle('🛡️ إدارة الستاف').setDescription('استخدم الأزرار تحت للوصول لأدوات الستاف.');
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('staff_stats').setLabel('إحصائيات الفريق').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('staff_config_info').setLabel('الإعدادات').setStyle(ButtonStyle.Secondary)
  );
  return i.reply({ embeds: [embed], components: [row], flags: 64 });
}

async function staffAdd(i: ChatInputCommandInteraction) {
  return i.reply({ content: 'إضافة الستاف متاحة من الداشبورد فقط.', flags: 64 });
}

async function staffRemove(i: ChatInputCommandInteraction) {
  const settings = await requireSettings(i.guild!.id);
  if (!await isManagement(await i.guild!.members.fetch(i.user.id))) return i.reply({ content: 'يلزمك صلاحية Administrator.', flags: 64 });
  const user = i.options.getUser('user', true);
  const staff = await Staff.findOne({ guildId: i.guild!.id, userId: user.id });
  if (!staff || !staff.active) return i.reply({ content: 'هذا العضو مو ستاف نشط.', flags: 64 });
  await Staff.update(staff.id, { active: false });
  const member = await i.guild!.members.fetch(user.id).catch(() => null);
  if (member) await member.roles.remove(settings.staffRoleId, `شاله ${i.user.tag} من الستاف`).catch(() => undefined);
  return i.reply({ content: `✅ انشال ${user} من فريق الستاف.`, flags: 64 });
}

async function staffList(i: ChatInputCommandInteraction) {
  if (!await isManagement(await i.guild!.members.fetch(i.user.id))) return i.reply({ content: 'هذا الأمر للإدارة فقط.', flags: 64 });
  const rows = await Staff.find({ guildId: i.guild!.id, active: true }).sort({ joinedAt: 1 });
  const text = rows.length ? rows.map(staff => `<@${staff.userId}> — انضم ${discordDate(staff.joinedAt, 'd')}`).join('\n').slice(0, 4000) : 'ما فيه ستاف مسجلين بعد.';
  return i.reply({ embeds: [new EmbedBuilder().setTitle('👥 أعضاء الستاف').setDescription(text)], flags: 64 });
}

async function staffPoints(i: ChatInputCommandInteraction) {
  const settings = await requireSettings(i.guild!.id);
  const member = await i.guild!.members.fetch(i.user.id);
  if (!await isStaff(member)) return i.reply({ content: 'هذا الأمر للستاف فقط.', flags: 64 });
  const staff = await Staff.findOne({ guildId: i.guild!.id, userId: i.user.id });
  return i.reply({ flags: 64, embeds: [new EmbedBuilder().setColor(0x8175f5).setTitle('💜 نقاطك في Rift').setDescription(`**${staff?.points ?? 0} نقطة**`).setThumbnail(i.user.displayAvatarURL({ extension: 'png', size: 128 })).setFooter({ text: 'تظهر لك بس' }).setTimestamp()] });
}

async function staffLeaderboard(i: ChatInputCommandInteraction) {
  await i.deferReply();
  const settings = await requireSettings(i.guild!.id);
  const member = await i.guild!.members.fetch(i.user.id);
  if (!await isStaff(member)) return i.editReply({ content: 'هذا الأمر متاح للستاف فقط.' });
  const ar = true;
  const rows = await Staff.find({ guildId: i.guild!.id, active: true }).sort({ points: -1 }).limit(10);
  const lines = rows.length ? rows.map((row, index) => {
    const medal = ['🥇', '🥈', '🥉'][index] || `**${index + 1}**`;
    return ar
      ? `${medal} <@${row.userId}>\n> **${row.points} نقطة**  •  ${row.messageCount} رسالة  •  ${(row.voiceMinutes / 60).toFixed(1)} ساعة فويس`
      : `${medal} <@${row.userId}>\n> **${row.points} points**  •  ${row.messageCount} messages  •  ${(row.voiceMinutes / 60).toFixed(1)}h voice`;
  }).join('\n\n') : (ar ? 'لا توجد بيانات ليدر بورد حتى الآن.' : 'No leaderboard data yet.');
  return i.editReply({ embeds: [new EmbedBuilder().setColor(0x8175f5).setTitle('🏆 ترتيب ستاف Rift').setDescription(`${ar ? 'ترتيب الستاف حسب النقاط' : 'Staff ranked by points'}\n\n${lines}`).addFields({ name: ar ? 'نظام النقاط' : 'How points work', value: ar ? 'نقطة لكل 30 دقيقة شفت، و3 نقاط لكل 100 رسالة خلال الشفت، ونقطة لكل 30 دقيقة فويس خلال الشفت.' : '1 point per 30 minutes on shift · 3 points per 100 messages during a shift · 1 point per 30 minutes in voice during a shift.', inline: false }).setFooter({ text: 'Rift · إدارة الستاف' }).setTimestamp()] });
}

async function shiftPanel(i: ChatInputCommandInteraction) {
  const settings = await requireSettings(i.guild!.id);
  if (!await isStaff(await i.guild!.members.fetch(i.user.id))) return i.reply({ content: 'هذا الأمر للستاف فقط.', flags: 64 });
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
  const embed = new EmbedBuilder().setTitle('🚪 استقالة من الستاف').setDescription('لو تبي تستقيل من فريق الستاف، قدّم طلبك من الزر تحت.');
  return i.reply({ embeds: [embed], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('resignation_request').setLabel('تقديم استقالة').setEmoji('🚪').setStyle(ButtonStyle.Danger))] });
}

async function staffStats(i: ChatInputCommandInteraction) {
  if (!await isManagement(await i.guild!.members.fetch(i.user.id))) return i.reply({ content: 'هذا الأمر للإدارة فقط.', flags: 64 });
  const staff = await Staff.countDocuments({ guildId: i.guild!.id, active: true });
  const active = await Shift.countDocuments({ guildId: i.guild!.id, status: 'active' });
  return i.reply({ embeds: [new EmbedBuilder().setTitle('📊 إحصائيات الفريق').setDescription(`👥 الستاف: ${staff}\n🟢 في الشفت: ${active}\n📅 إجازات مقبولة: ${await LeaveRequest.countDocuments({ guildId: i.guild!.id, status: 'approved' })}\n🚪 استقالات تنتظر: ${await ResignationRequest.countDocuments({ guildId: i.guild!.id, status: 'pending' })}`)] });
}

async function staffHistory(i: ChatInputCommandInteraction) {
  if (!await isManagement(await i.guild!.members.fetch(i.user.id))) return i.reply({ content: 'هذا الأمر للإدارة فقط.', flags: 64 });
  const user = i.options.getUser('user', true);
  return shiftHistoryFor(i, user.id, user.tag);
}

async function shiftHistory(i: ChatInputCommandInteraction) {
  const user = i.options.getUser('user') ?? i.user;
  if (user.id !== i.user.id && !await isManagement(await i.guild!.members.fetch(i.user.id))) return i.reply({ content: 'بس الإدارة تقدر تشوف شفتات غيرك.', flags: 64 });
  return shiftHistoryFor(i, user.id, user.tag);
}

async function shiftHistoryFor(i: ChatInputCommandInteraction, userId: string, label: string) {
  const rows = await Shift.find({ guildId: i.guild!.id, userId }).sort({ startedAt: -1 }).limit(10);
  const text = rows.length ? rows.map(s => `• ${discordDate(s.startedAt)} → ${s.endedAt ? discordDate(s.endedAt) : '🟢 نشط'} — ${duration(activeMs(s))}`).join('\n') : 'ما فيه شفتات.';
  return i.reply({ embeds: [new EmbedBuilder().setTitle(`📋 سجل الشفتات — ${label}`).setDescription(text)] });
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
  const embed = new EmbedBuilder().setTitle('📝 تقارير الستاف').setDescription('قدّم ملخص شفت أو بلاغ حادثة أو تقرير عام. التقرير يوصلك بالخاص وفي روم التقارير.');
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('report_submit').setLabel('تقديم تقرير').setEmoji('📝').setStyle(ButtonStyle.Primary)
  );
  return i.reply({ embeds: [embed], components: [row] });
}

async function reportSubmit(i: ChatInputCommandInteraction) {
  await requireSettings(i.guild!.id);
  const embed = new EmbedBuilder().setTitle('📝 تقديم تقرير').setDescription('اختر نوع التقرير تحت، وبعدها عبّي التفاصيل.');
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('report_modal:shift_summary').setLabel('ملخص شفت').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('report_modal:incident').setLabel('حادثة').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('report_modal:general').setLabel('عام').setStyle(ButtonStyle.Secondary)
  );
  return i.reply({ embeds: [embed], components: [row], flags: 64 });
}

async function reportHistory(i: ChatInputCommandInteraction) {
  const rows = await Report.find({ guildId: i.guild!.id, userId: i.user.id }).sort({ createdAt: -1 }).limit(20);
  if (!rows.length) return i.reply({ content: 'ما قدّمت أي تقرير بعد.', flags: 64 });
  const text = rows.map(r => `• ${discordDate(r.createdAt)} — **${r.title}** (${REPORT_STATUS[r.status] ?? r.status})`).join('\n');
  return i.reply({ embeds: [new EmbedBuilder().setTitle('📋 تقاريرك').setDescription(text)], flags: 64 });
}

async function reportReview(i: ChatInputCommandInteraction) {
  if (!await isManagement(await i.guild!.members.fetch(i.user.id))) return i.reply({ content: 'هذا الأمر للإدارة فقط.', flags: 64 });
  const rows = await getPendingReports(i.guild!.id);
  if (!rows.length) return i.reply({ content: 'ما فيه تقارير تنتظر مراجعة.', flags: 64 });
  const text = rows.map(r => `• ${discordDate(r.createdAt)} — **${r.title}** — <@${r.userId}>`).join('\n');
  const row = new ActionRowBuilder<ButtonBuilder>();
  for (const r of rows.slice(0, 5)) {
    row.addComponents(new ButtonBuilder().setCustomId(`report_review:${r._id}`).setLabel(`مراجعة #${String(r._id).slice(-6)}`).setStyle(ButtonStyle.Success));
  }
  return i.reply({ embeds: [new EmbedBuilder().setTitle('📋 تقارير تنتظر المراجعة').setDescription(text)], components: [row], flags: 64 });
}
