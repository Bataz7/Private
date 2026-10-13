import { commandLocalization, EmbedBuilder, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction, type GuildMember, type User } from '../lib/djs/index.js';
import { env } from '../config/env.js';
import { supabase } from '../supabase/client.js';
import { Staff } from '../models/Staff.js';
import { Shift } from '../models/Shift.js';
import { getSettings } from '../services/settings.service.js';
import { activeMs, duration, isOnBreak } from '../services/shift.service.js';
import { isAdministrator, isStaff } from '../utils/permissions.js';
import { buildStaffCard } from '../utils/staff-card.js';
import { staffCardData } from './profile-stats.js';
import { slashName } from '../i18n/commands.js';
import { pointRules, pointsBreakdown } from './points.js';
import { AssistanceLimitError, createAssistance, RepeatAssistanceError } from './assistance.js';
import { submitStaffRating } from './ratings.js';
import { SetupMissingError } from './db.js';

// Slash commands of the staff core. الردود كلها بالعربي (t يرجّع النص العربي)؛ كل شي شخصي مخفي.
const PURPLE = 0x8175f5;
const GREEN = 0x4fc08d;
type Ctx = { i: ChatInputCommandInteraction; ar: boolean; me: GuildMember; t: (en: string, ar: string) => string };
const dashboard = (path: string) => (/^https?:\/\//.test(env.dashboardUrl) ? `${env.dashboardUrl}${path}` : '');

type Audience = 'everyone' | 'staff' | 'admin';
type HelpItem = { name: string; audience: Audience; en: string; ar: string };
// /help reads these texts, so the list and the guide never disagree. Commands other modules register are added automatically.
const HELP: HelpItem[] = [
  { name: 'shift status', audience: 'staff', en: 'Your current shift: time, messages and points so far', ar: 'حالة شفتك الحين: الوقت والرسائل والنقاط' },
  { name: 'shift break', audience: 'staff', en: 'Start or end a break (up to 30 minutes)', ar: 'تبدأ أو تنهي بريك (أقصى شي 30 دقيقة)' },
  { name: 'points', audience: 'staff', en: 'Your points and where they came from', ar: 'نقاطك ومن وين جات' },
  { name: 'leaderboard', audience: 'staff', en: 'Top 10 staff by points', ar: 'أفضل 10 ستاف بالنقاط' },
  { name: 'profile', audience: 'staff', en: 'Your performance card', ar: 'كرت أدائك' },
  { name: 'assist', audience: 'staff', en: 'Log that you helped a member (+1 point)', ar: 'تسجّل إنك ساعدت عضو (+1 نقطة)' },
  { name: 'report stats', audience: 'staff', en: 'A full performance report', ar: 'تقرير أداء كامل' },
  { name: 'rate', audience: 'everyone', en: 'Rate a staff member from 1 to 5 stars', ar: 'تقيّم عضو ستاف من 1 لـ 5 نجوم' },
  { name: 'complaint submit', audience: 'everyone', en: 'File a complaint about a staff member', ar: 'تقدّم شكوى على عضو ستاف' },
  { name: 'team', audience: 'admin', en: 'Team overview: who is on shift and what is waiting', ar: 'نظرة على الفريق: مين في الشفت ووش ينتظر مراجعة' },
  { name: 'staff setup', audience: 'admin', en: 'Configure roles and channels', ar: 'ضبط الرتب والقنوات' },
  { name: 'rating panel', audience: 'admin', en: 'Post the staff rating panel', ar: 'إرسال لوحة تقييم الستاف' },
  { name: 'complaint panel', audience: 'admin', en: 'Post the complaint panel', ar: 'إرسال لوحة الشكاوى' },
  { name: 'help', audience: 'everyone', en: 'This list', ar: 'هذي القائمة' },
];
const MODULE_AUDIENCE: Record<string, Audience> = { rate: 'everyone', complaint: 'everyone', help: 'everyone', team: 'admin', 'weekly-top': 'everyone' };

const guildOnly = <T extends { setContexts(...contexts: InteractionContextType[]): unknown; toJSON(): unknown }>(builder: T) => { builder.setContexts(InteractionContextType.Guild); return builder; };

// الأسماء الداخلية إنجليزية (للمطابقة)، والأوصاف عربية. الأسماء العربية من قاموس src/i18n/commands.ts.
export const coreCommandJson = [
  guildOnly(new SlashCommandBuilder().setName('points').setDescription('نقاطك ومن وين جات')
    .addUserOption(o => o.setName('user').setDescription('إداري ثاني (للأدمن فقط)').setRequired(false))),
  guildOnly(new SlashCommandBuilder().setName('leaderboard').setDescription('أفضل 10 ستاف بالنقاط')),
  guildOnly(new SlashCommandBuilder().setName('profile').setDescription('بطاقة أدائك')
    .addUserOption(o => o.setName('user').setDescription('إداري ثاني (للأدمن فقط)').setRequired(false))),
  guildOnly(new SlashCommandBuilder().setName('assist').setDescription('تسجّل إنك ساعدت عضو (+1 نقطة)')
    .addUserOption(o => o.setName('member').setDescription('العضو اللي ساعدته').setRequired(true))
    .addStringOption(o => o.setName('type').setDescription('نوع المساعدة').setRequired(false).addChoices(
      { name: 'دعم عام', value: 'General Support' }, { name: 'سؤال', value: 'Question' }, { name: 'مشكلة تقنية', value: 'Technical' },
      { name: 'بلاغ / إشراف', value: 'Moderation' }, { name: 'غير ذلك', value: 'Other' }))
    .addStringOption(o => o.setName('note').setDescription('ملاحظة قصيرة للإدارة').setRequired(false).setMaxLength(300))),
  guildOnly(new SlashCommandBuilder().setName('rate').setDescription('تقيّم إداري من 1 لـ 5 نجوم')
    .addUserOption(o => o.setName('staff').setDescription('الإداري').setRequired(true))
    .addIntegerOption(o => o.setName('stars').setDescription('كم نجمة').setRequired(true).addChoices(
      { name: '★★★★★  ممتاز', value: 5 }, { name: '★★★★  جيد جداً', value: 4 }, { name: '★★★  جيد', value: 3 }, { name: '★★  يحتاج تحسين', value: 2 }, { name: '★  ضعيف', value: 1 }))
    .addStringOption(o => o.setName('comment').setDescription('تعليق (اختياري)').setRequired(false).setMaxLength(500))),
  guildOnly(new SlashCommandBuilder().setName('team').setDescription('نظرة على الفريق: مين في الشفت ووش ينتظر مراجعة')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)),
  guildOnly(new SlashCommandBuilder().setName('help').setDescription('وش تقدر تسوي مع Rift')),
].map(command => command.toJSON());

const shownName = (path: string) => slashName(path).replace(/^\//, '');

export async function handleCoreCommand(i: ChatInputCommandInteraction) {
  if (!i.inCachedGuild()) return void await i.reply({ content: 'هذا الأمر يشتغل في السيرفر بس.', flags: 64 });
  const settings = await getSettings(i.guild.id).catch(() => null);
  // البوت عربي بالكامل (طلب المالك)، بغض النظر عن bot_language.
  const ar = true;
  const t = (en: string, arText: string) => (ar ? arText : en);
  if (!settings) return void await i.reply({ content: t('Rift is not set up on this server yet. An administrator can set it up from the dashboard.', 'Rift ما انضبط في هذا السيرفر بعد. الأدمن يقدر يضبطه من الداشبورد.'), flags: 64 });
  const ctx: Ctx = { i, ar, me: i.member, t };
  try {
    switch (i.commandName) {
      case 'points': return await points(ctx);
      case 'leaderboard': return await leaderboard(ctx);
      case 'profile': return await profile(ctx);
      case 'assist': return await assist(ctx);
      case 'rate': return await rate(ctx);
      case 'team': return await team(ctx);
      case 'help': return await help(ctx);
    }
  } catch (error) {
    // A missing migration is explained to the person; anything else goes to the shared error handler.
    if (error instanceof SetupMissingError) {
      const payload = { content: `⚠️ ${error.message}`, flags: 64 as const };
      if (i.deferred || i.replied) await i.editReply({ content: payload.content }).catch(() => undefined); else await i.reply(payload).catch(() => undefined);
      return;
    }
    throw error;
  }
}

async function staffOnly({ i, me, t }: Ctx) {
  if (await isStaff(me)) return true;
  await i.reply({ content: t('This command is for staff only.', 'هذا الأمر للستاف فقط.'), flags: 64 });
  return false;
}

// Staff see their own data; administrators may pass another member.
async function targetOf(ctx: Ctx): Promise<User | null> {
  const other = ctx.i.options.getUser('user');
  if (!other || other.id === ctx.i.user.id) return ctx.i.user;
  if (isAdministrator(ctx.me)) return other;
  await ctx.i.reply({ content: ctx.t('Only administrators can view another member.', 'بس الأدمن يقدر يشوف بيانات عضو ثاني.'), flags: 64 });
  return null;
}

// ---- Points ---------------------------------------------------------------------------------------
const PART_EMOJI: Record<string, string> = { shift: '⏱️', messages: '💬', voice: '🎧', assist: '🤝', rating: '⭐', modreport: '🛡️', complaint: '⚠️', manual: '📝' };
const PART_NAME: Record<string, [string, string]> = {
  shift: ['Shift time', 'وقت الشفت'], messages: ['Messages on shift', 'الرسائل في الشفت'], voice: ['Voice on shift', 'الفويس في الشفت'], assist: ['Members helped', 'مساعدة الأعضاء'],
  rating: ['Ratings', 'التقييمات'], modreport: ['Mod reports', 'تقارير المود'], complaint: ['Complaints', 'الشكاوى'], manual: ['Manual changes & older points', 'تعديلات يدوية ونقاط قديمة'],
};

async function points(ctx: Ctx) {
  if (!await staffOnly(ctx)) return;
  const user = await targetOf(ctx); if (!user) return;
  const { i, t, ar } = ctx;
  const breakdown = await pointsBreakdown(i.guild!.id, user.id);
  if (!breakdown) return void await i.reply({ content: t('This member is not on the staff list yet.', 'هذا العضو مو في قائمة الستاف بعد.'), flags: 64 });
  const ranked = await Staff.find({ guildId: i.guild!.id, active: true }).sort({ points: -1 });
  const place = ranked.findIndex(row => row.userId === user.id) + 1;
  const lines = breakdown.parts.filter(part => part.points).map(part => `${PART_EMOJI[part.key] || '•'} ${PART_NAME[part.key]?.[ar ? 1 : 0] || part.key}: **${part.points > 0 ? '+' : ''}${part.points}**`);
  const link = dashboard('/dashboard/points');
  return void await i.reply({ flags: 64, embeds: [new EmbedBuilder().setColor(PURPLE).setTitle(user.id === i.user.id ? t('Your points', 'نقاطك') : t(`Points · ${user.username}`, `نقاط · ${user.username}`)).setThumbnail(user.displayAvatarURL({ extension: 'png', size: 128 }))
    .setDescription([`## 💎 ${breakdown.total}`, place ? t(`🏆 **#${place}** of ${ranked.length} staff`, `🏆 **#${place}** من ${ranked.length} ستاف`) : '', '', `**${t('Where they came from', 'من وين جات')}**`, ...(lines.length ? lines : [t('Nothing yet. Be active in the server and shifts start on their own.', 'ما فيه شي بعد. تفاعل في السيرفر والشفت يبدأ لحاله.')]), link ? `\n🔗 ${t('Full details', 'التفاصيل كاملة')}: ${link}` : ''].join('\n'))
    .setFooter({ text: t('Use /help to see how points are earned.', 'استخدم /help تعرف كيف تنجمع النقاط.') })] });
}

async function leaderboard(ctx: Ctx) {
  if (!await staffOnly(ctx)) return;
  const { i, t } = ctx;
  const rows = await Staff.find({ guildId: i.guild!.id, active: true }).sort({ points: -1 });
  const medal = (index: number) => ['🥇', '🥈', '🥉'][index] || `\`${String(index + 1).padStart(2, ' ')}\``;
  const top = rows.slice(0, 10).map((row, index) => `${medal(index)} <@${row.userId}> · **${row.points}**`);
  const mine = rows.findIndex(row => row.userId === i.user.id);
  if (mine >= 10) top.push('', t(`You: **#${mine + 1}** with **${rows[mine]!.points}** points`, `أنت: **#${mine + 1}** بـ **${rows[mine]!.points}** نقطة`));
  return void await i.reply({ allowedMentions: { parse: [] }, embeds: [new EmbedBuilder().setColor(PURPLE).setTitle(t('Rift Staff Leaderboard', 'ترتيب ستاف Rift'))
    .setDescription(top.length ? top.join('\n') : t('No staff yet.', 'ما فيه ستاف بعد.')).setFooter({ text: t('Ranked by points', 'مرتّب بالنقاط') }).setTimestamp()] });
}

async function profile(ctx: Ctx) {
  if (!await staffOnly(ctx)) return;
  const user = await targetOf(ctx); if (!user) return;
  const { i, t } = ctx;
  await i.deferReply({ flags: 64 });
  const data = await staffCardData(i.guild!, user);
  if (!data) return void await i.editReply({ content: t('This member is not on the staff list yet.', 'هذا العضو مو في قائمة الستاف بعد.') });
  // editReply ما يغيّر الـ flags (المخفي محدد من deferReply)، فنرسل علم Components V2 بس.
  const card = buildStaffCard(data, false);
  return void await i.editReply(card);
}

// ---- Assist ---------------------------------------------------------------------------------------
async function assist(ctx: Ctx) {
  if (!await staffOnly(ctx)) return;
  const { i, t, ar } = ctx;
  const settings = await getSettings(i.guild!.id);
  const target = i.options.getUser('member', true);
  if (target.bot || target.id === i.user.id) return void await i.reply({ content: t('Choose the member you helped (not yourself or a bot).', 'اختر العضو اللي ساعدته (مو نفسك ولا بوت).'), flags: 64 });
  // The helped person has to be in this server.
  if (!await i.guild!.members.fetch(target.id).catch(() => null)) return void await i.reply({ content: t('Choose a member of this server.', 'اختر عضو من هذا السيرفر.'), flags: 64 });
  const type = i.options.getString('type') || 'General Support';
  const note = i.options.getString('note') || '';
  let assistance;
  try { assistance = await createAssistance({ guildId: i.guild!.id, staffUserId: i.user.id, memberUserId: target.id, type, note }); }
  catch (error) {
    if (error instanceof RepeatAssistanceError) return void await i.reply({ content: t('You already logged help for this member in the last 10 minutes.', 'سجّلت مساعدة لهذا العضو خلال آخر 10 دقايق.'), flags: 64 });
    if (error instanceof AssistanceLimitError) return void await i.reply({ content: t('You reached the daily limit of credited helps. Try again tomorrow.', 'وصلت الحد اليومي للمساعدات المسجلة. جرب بكرة.'), flags: 64 });
    throw error;
  }
  const channelId = settings?.logsChannelId || settings?.shiftChannelId;
  const channel = channelId ? await i.guild!.channels.fetch(channelId).catch(() => null) : null;
  if (channel?.isTextBased() && 'send' in channel) {
    await channel.send({
      allowedMentions: { parse: [] },
      embeds: [new EmbedBuilder().setColor(GREEN).setTitle(t('Help logged', 'تسجيل مساعدة'))
        .setDescription(`🤝 ${i.user} ${t('helped', 'ساعد')} ${target} · **+1**\n${t('Type', 'النوع')}: ${type}${note ? `\n> ${note}` : ''}`)
        .setFooter({ text: `#${assistance.id}` }).setTimestamp()],
    }).catch(() => undefined);
  }
  return void await i.reply({ content: ar ? `✅ تم تسجيل مساعدتك لـ ${target} وانضافت لك نقطة.` : `✅ Logged your help for ${target}. +1 point.`, flags: 64, allowedMentions: { parse: [] } });
}

// ---- Rate -----------------------------------------------------------------------------------------
async function rate(ctx: Ctx) {
  const { i, t, ar } = ctx;
  const settings = await getSettings(i.guild!.id);
  const staffUser = i.options.getUser('staff', true);
  if (staffUser.id === i.user.id) return void await i.reply({ content: t('You cannot rate yourself.', 'ما تقدر تقيّم نفسك.'), flags: 64 });
  const target = await i.guild!.members.fetch(staffUser.id).catch(() => null);
  const registered = await Staff.findOne({ guildId: i.guild!.id, userId: staffUser.id, active: true });
  if (!target || staffUser.bot || !settings || !target.roles.cache.has(settings.staffRoleId) || !registered) return void await i.reply({ content: t('That member is not on the staff team.', 'هذا العضو مو من فريق الستاف.'), flags: 64 });
  if (isAdministrator(target)) return void await i.reply({ content: t('Ratings do not apply to administrators.', 'التقييم ما ينطبق على الأدمن.'), flags: 64 });
  const stars = i.options.getInteger('stars', true);
  const result = await submitStaffRating(i.guild!, i.user.id, staffUser.id, stars, (i.options.getString('comment') || '').trim());
  return void await i.reply({ flags: 64, allowedMentions: { parse: [] }, content: ar
    ? `✅ ${result.updated ? 'حدّثت' : 'سجّلت'} تقييمك لـ ${staffUser}: ${'⭐'.repeat(stars)} ${stars}/5. شكرًا لك!`
    : `✅ ${result.updated ? 'Updated' : 'Saved'} your rating for ${staffUser}: ${'⭐'.repeat(stars)} ${stars}/5. Thank you!` });
}

// ---- Admin ----------------------------------------------------------------------------------------
/** Pending items of another feature. Zero when that feature's table does not exist yet. */
async function pending(table: string, guildId: string) {
  const { count, error } = await supabase.from(table).select('id', { count: 'exact', head: true }).eq('guild_id', guildId).eq('status', 'pending');
  return error ? 0 : count ?? 0;
}

async function team(ctx: Ctx) {
  const { i, t, me } = ctx;
  if (!isAdministrator(me)) return void await i.reply({ content: t('This command is for administrators only.', 'هذا الأمر للأدمن فقط.'), flags: 64 });
  await i.deferReply({ flags: 64 });
  const guildId = i.guild!.id;
  const [staff, onShift, leaves, resignations, complaints, modReports, applications] = await Promise.all([
    Staff.countDocuments({ guildId, active: true }),
    Shift.find({ guildId, status: 'active' }).sort({ startedAt: 1 }),
    pending('leave_requests', guildId), pending('resignation_requests', guildId), pending('complaints', guildId), pending('mod_reports', guildId), pending('applications', guildId),
  ]);
  const shiftLines = onShift.slice(0, 15).map(shift => `${isOnBreak(shift) ? '⏸️' : '🟢'} <@${shift.userId}> · ${duration(activeMs(shift))}`);
  if (onShift.length > 15) shiftLines.push(t(`…and ${onShift.length - 15} more`, `…و ${onShift.length - 15} غيرهم`));
  const waiting = [[leaves, '🏖️', 'Leave requests', 'طلبات إجازة'], [resignations, '🚪', 'Resignations', 'استقالات'], [complaints, '⚠️', 'Complaints', 'شكاوى'], [modReports, '🛡️', 'Mod reports', 'تقارير مود'], [applications, '📝', 'Applications', 'تقديمات']] as const;
  const link = dashboard('/dashboard');
  return void await i.editReply({ allowedMentions: { parse: [] }, embeds: [new EmbedBuilder().setColor(PURPLE).setTitle(t('Team overview', 'نظرة على الفريق'))
    .setDescription(`👥 **${staff}** ${t('staff', 'ستاف')} · 🟢 **${onShift.length}** ${t('on shift now', 'في الشفت الحين')}${link ? `\n🔗 ${link}` : ''}`)
    .addFields(
      { name: t('On shift', 'في الشفت'), value: shiftLines.length ? shiftLines.join('\n') : t('Nobody right now.', 'ما فيه أحد الحين.') },
      { name: t('Waiting for review', 'ينتظر المراجعة'), value: waiting.map(([n, emoji, en, arText]) => `${emoji} ${t(en, arText)}: **${n}**`).join('\n') },
    ).setTimestamp()] });
}

// ---- Help -----------------------------------------------------------------------------------------
async function help({ i, t, ar, me }: Ctx) {
  const staff = await isStaff(me);
  const admin = isAdministrator(me);
  // Commands other modules registered that this file does not know about are listed too.
  const { extensionCommands } = await import('../extensions/index.js');
  const known = new Set(HELP.map(item => item.name.split(' ')[0]));
  const extra: HelpItem[] = extensionCommands().map(command => command.json).filter(json => !known.has(json.name)).map(json => ({
    name: json.name, audience: json.default_member_permissions ? 'admin' as const : MODULE_AUDIENCE[json.name] ?? 'staff' as const, en: json.description, ar: commandLocalization()[json.name]?.description || json.description,
  }));
  const mine = [...HELP, ...extra].filter(item => item.audience === 'everyone' || (item.audience === 'staff' && staff) || (item.audience === 'admin' && admin));
  const group = (audience: Audience) => mine.filter(item => item.audience === audience).map(item => `\`/${shownName(item.name)}\` · ${ar ? item.ar : item.en}`).join('\n').slice(0, 1024);
  const embed = new EmbedBuilder().setColor(PURPLE).setTitle(t('Rift commands', 'أوامر Rift'));
  if (staff && group('staff')) embed.addFields({ name: t('For staff', 'للستاف'), value: group('staff') });
  if (group('everyone')) embed.addFields({ name: t('For everyone', 'للجميع'), value: group('everyone') });
  if (admin && group('admin')) embed.addFields({ name: t('For administrators', 'للأدمن'), value: `${group('admin')}${dashboard('/dashboard') ? `\n🔗 ${dashboard('/dashboard')}` : ''}`.slice(0, 1024) });
  if (staff) {
    const rules = (await pointRules(i.guild!.id)).map(rule => `**${rule.points}** ${ar ? rule.ar : rule.en}`).join('\n');
    embed.addFields({ name: t('How points work', 'كيف تنجمع النقاط'), value: rules.slice(0, 1024) });
  }
  return void await i.reply({ embeds: [embed], flags: 64 });
}
