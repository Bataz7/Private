import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder, type ButtonInteraction, type ChatInputCommandInteraction } from '../lib/djs/index.js';
import { getSettings } from '../services/settings.service.js';
import { isAdministrator } from '../utils/permissions.js';
import { dismissStaff, listDismissed, reinstateStaff } from '../services/dismissal.service.js';
import { describeSync, syncStaffFromRole, type StaffSyncMode } from '../services/staff-sync.service.js';
import { liveBoardPayload, setLeaderboardChannel, weekStartOf, weeklyTop } from '../services/leaderboard.service.js';
import { createWarning } from '../core/warnings.js';
import { SetupMissingError } from '../core/db.js';

// أوامر التأديب (فصل، إلغاء فصل، المفصولين، إنذار، مزامنة الستاف) ولوحة المتصدرين الأسبوعية.
// الأسماء الداخلية إنجليزية، والعربية من ./i18n.ts. الفصل والمسح الكامل يطلبون تأكيد بأزرار.

const RED = 0xe9697b;
const admin = <T extends SlashCommandBuilder>(builder: T) => builder.setContexts(InteractionContextType.Guild).setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export const disciplineCommandJson = [
  admin(new SlashCommandBuilder().setName('dismiss').setDescription('فصل إداري من الستاف (يطلب تأكيد)')
    .addUserOption(o => o.setName('user').setDescription('الإداري اللي بتفصله').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('سبب الفصل (يوصله بالخاص)').setRequired(true).setMaxLength(500))
    .addBooleanOption(o => o.setName('reset_points').setDescription('تصفّر نقاطه؟').setRequired(false))),
  admin(new SlashCommandBuilder().setName('reinstate').setDescription('ترجّع إداري مفصول للستاف')
    .addUserOption(o => o.setName('user').setDescription('العضو المفصول').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('سبب إلغاء الفصل (اختياري)').setRequired(false).setMaxLength(500))
    .addBooleanOption(o => o.setName('restore_role').setDescription('ترجّع له رتبة الستاف؟ (الافتراضي نعم)').setRequired(false))),
  admin(new SlashCommandBuilder().setName('dismissed').setDescription('قائمة آخر المفصولين من الستاف')),
  admin(new SlashCommandBuilder().setName('warn').setDescription('إنذار إداري (لما توصل الإنذارات للحد ينفصل تلقائياً)')
    .addUserOption(o => o.setName('user').setDescription('الإداري').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('سبب الإنذار').setRequired(true).setMaxLength(500))),
  admin(new SlashCommandBuilder().setName('staff-sync').setDescription('مزامنة قائمة الستاف مع رتبة الستاف في الديسكورد')
    .addStringOption(o => o.setName('mode').setDescription('مزامنة عادية أو مسح كامل وإعادة تسجيل').setRequired(false)
      .addChoices({ name: 'مزامنة (تحفظ النقاط)', value: 'sync' }, { name: 'مسح كامل وإعادة تسجيل', value: 'wipe' }))),
  admin(new SlashCommandBuilder().setName('weekly-board').setDescription('تحدد روم لوحة متصدرين الأسبوع (تتحدث كل 10 دقايق)')
    .addChannelOption(o => o.setName('channel').setDescription('الروم (الافتراضي: هذا الروم)').setRequired(false).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addBooleanOption(o => o.setName('off').setDescription('توقف اللوحة').setRequired(false))),
  new SlashCommandBuilder().setName('weekly-top').setDescription('أفضل 10 ستاف بنقاط هذا الأسبوع').setContexts(InteractionContextType.Guild),
].map(command => command.toJSON());

// ---- تأكيدات بالأزرار (في الذاكرة، 10 دقايق، بحد أقصى) ------------------------------------------------
type Pending =
  | { kind: 'dismiss'; guildId: string; actorId: string; userId: string; reason: string; resetPoints: boolean; at: number }
  | { kind: 'wipe'; guildId: string; actorId: string; at: number };
const pendingConfirms = new Map<string, Pending>();
const CONFIRM_TTL = 10 * 60_000;

function remember(token: string, entry: Pending) {
  const now = Date.now();
  for (const [key, value] of pendingConfirms) if (now - value.at > CONFIRM_TTL) pendingConfirms.delete(key);
  while (pendingConfirms.size >= 200) pendingConfirms.delete(pendingConfirms.keys().next().value!);
  pendingConfirms.set(token, entry);
}

const confirmRow = (token: string, label: string) => new ActionRowBuilder<ButtonBuilder>().addComponents(
  new ButtonBuilder().setCustomId(`disc:yes:${token}`).setLabel(label).setStyle(ButtonStyle.Danger),
  new ButtonBuilder().setCustomId(`disc:no:${token}`).setLabel('إلغاء').setStyle(ButtonStyle.Secondary));

async function reply(i: ChatInputCommandInteraction | ButtonInteraction, content: string) {
  if (i.deferred || i.replied) await i.editReply({ content, embeds: [], components: [] }).catch(() => undefined);
  else await i.reply({ content, flags: 64 }).catch(() => undefined);
}

async function adminOnly(i: ChatInputCommandInteraction) {
  if (!i.inCachedGuild()) { await i.reply({ content: 'هذا الأمر يشتغل في السيرفر بس.', flags: 64 }); return false; }
  if (isAdministrator(i.member)) return true;
  await i.reply({ content: '⛔ هذا الأمر للأدمن فقط.', flags: 64 });
  return false;
}

// ---- الأوامر ------------------------------------------------------------------------------------------
async function dismiss(i: ChatInputCommandInteraction) {
  if (!await adminOnly(i)) return;
  const user = i.options.getUser('user', true);
  const reason = i.options.getString('reason', true).trim();
  const resetPoints = i.options.getBoolean('reset_points') ?? false;
  if (user.bot) return void await i.reply({ content: 'ما ينفع تفصل بوت.', flags: 64 });
  if (user.id === i.user.id) return void await i.reply({ content: 'ما تقدر تفصل نفسك.', flags: 64 });
  remember(i.id, { kind: 'dismiss', guildId: i.guildId!, actorId: i.user.id, userId: user.id, reason, resetPoints, at: Date.now() });
  await i.reply({
    flags: 64, allowedMentions: { parse: [] },
    embeds: [new EmbedBuilder().setColor(RED).setTitle('تأكيد الفصل')
      .setDescription(`متأكد تبي تفصل ${user} من الستاف؟\n\n**السبب:** ${reason}\n**النقاط:** ${resetPoints ? 'تتصفّر' : 'تبقى'}\n\nبينتهي شفته (لو عنده)، وتنشال رتب الستاف، ويوصله السبب بالخاص.`)],
    components: [confirmRow(i.id, 'تأكيد الفصل')],
  });
}

async function reinstate(i: ChatInputCommandInteraction) {
  if (!await adminOnly(i)) return;
  const user = i.options.getUser('user', true);
  await i.deferReply({ flags: 64 });
  try {
    const result = await reinstateStaff(i.guild!, user.id, { by: i.user.id, reason: i.options.getString('reason') ?? undefined, restoreRole: i.options.getBoolean('restore_role') ?? true, source: 'command' });
    await i.editReply({ content: `✅ رجع ${user} للستاف${result.roleRestored ? ' ورجعت له الرتبة' : ''}. إنذاراته القديمة انقفلت.`, allowedMentions: { parse: [] } });
  } catch (error) { await reply(i, `⚠️ ${error instanceof Error ? error.message : 'صار خطأ.'}`); }
}

async function dismissedList(i: ChatInputCommandInteraction) {
  if (!await adminOnly(i)) return;
  await i.deferReply({ flags: 64 });
  const rows = await listDismissed(i.guildId!, 25);
  const lines = rows.map(row => `⛔ <@${row.userId}>${row.at ? ` · <t:${Math.floor(row.at.getTime() / 1000)}:d>` : ''}${row.by ? ` · بواسطة <@${row.by}>` : ''}${row.reason ? `\n> ${row.reason.slice(0, 120)}` : ''}`);
  await i.editReply({ allowedMentions: { parse: [] }, embeds: [new EmbedBuilder().setColor(RED).setTitle('المفصولين من الستاف')
    .setDescription(lines.length ? lines.join('\n').slice(0, 4000) : 'ما فيه أحد مفصول.').setFooter({ text: 'لإرجاع أحد: أمر إلغاء الفصل' })] });
}

async function warn(i: ChatInputCommandInteraction) {
  if (!await adminOnly(i)) return;
  const user = i.options.getUser('user', true);
  const reason = i.options.getString('reason', true).trim();
  if (user.bot || user.id === i.user.id) return void await i.reply({ content: 'اختر إداري غيرك.', flags: 64 });
  await i.deferReply({ flags: 64 });
  try {
    const warning = await createWarning({ guildId: i.guildId!, staffUserId: user.id, reason, issuedBy: i.user.id }, { guild: i.guild! });
    const limit = warning.limit;
    const counter = limit ? `${limit.count}${limit.limit ? `/${limit.limit}` : ''}` : '';
    const tail = limit?.dismissed ? `\n⛔ وصل حد الإنذارات وانفصل تلقائياً.` : limit?.error ? `\n⚠️ وصل الحد بس الفصل التلقائي ما تم: ${limit.error}` : '';
    await i.editReply({ content: `✅ تم إنذار ${user}${counter ? ` (الإنذارات النشطة: ${counter})` : ''}.${tail}`, allowedMentions: { parse: [] } });
    // الإداري يعرف إنه انذر (رسالة الفصل توصله من نظام الفصل).
    if (!limit?.dismissed) await user.send({ embeds: [new EmbedBuilder().setColor(0xf0ad4e).setTitle('وصلك إنذار').setDescription(`وصلك إنذار في **${i.guild!.name}**.\n\n**السبب:** ${reason}${limit?.limit ? `\nالإنذارات النشطة: **${limit.count}/${limit.limit}** (عند الحد يتم الفصل).` : ''}`)] }).catch(() => undefined);
  } catch (error) { await reply(i, `⚠️ ${error instanceof SetupMissingError ? 'الإنذارات تحتاج تحديث قاعدة البيانات.' : error instanceof Error ? error.message : 'صار خطأ.'}`); }
}

async function staffSync(i: ChatInputCommandInteraction) {
  if (!await adminOnly(i)) return;
  const mode = (i.options.getString('mode') ?? 'sync') as StaffSyncMode;
  if (mode === 'wipe') {
    remember(i.id, { kind: 'wipe', guildId: i.guildId!, actorId: i.user.id, at: Date.now() });
    return void await i.reply({
      flags: 64,
      embeds: [new EmbedBuilder().setColor(RED).setTitle('⚠️ مسح كامل للستاف')
        .setDescription('هذا يمسح **كل سجلات الستاف** في السيرفر (النقاط والإحصائيات ترجع صفر)، وبعدها يسجّل كل من عنده رتبة الستاف من جديد.\nالمفصولين يبقون مفصولين.\n\n**ما ينرجع عنه.** متأكد؟')],
      components: [confirmRow(i.id, 'امسح وسجّل من جديد')],
    });
  }
  await i.deferReply({ flags: 64 });
  try {
    const result = await syncStaffFromRole(i.guild!, 'sync');
    await i.editReply({ content: `✅ تمت المزامنة.\n${describeSync(result)}` });
  } catch (error) { await reply(i, `⚠️ ${error instanceof Error ? error.message : 'صار خطأ.'}`); }
}

async function weeklyBoard(i: ChatInputCommandInteraction) {
  if (!await adminOnly(i)) return;
  const off = i.options.getBoolean('off') ?? false;
  const channel = i.options.getChannel('channel') ?? i.channel;
  if (!off && (!channel || !channel.isTextBased())) return void await i.reply({ content: 'اختر روم كتابي.', flags: 64 });
  await i.deferReply({ flags: 64 });
  try {
    await setLeaderboardChannel(i.guild!, off ? null : channel!.id);
    await i.editReply({ content: off ? '✅ وقفت لوحة متصدرين الأسبوع.' : `✅ لوحة متصدرين الأسبوع صارت في <#${channel!.id}> وتتحدث كل 10 دقايق. بنهاية كل أسبوع (السبت 12 الليل بتوقيت السعودية) تنزل رسالة «أبطال الأسبوع».` });
  } catch (error) { await reply(i, `⚠️ ${error instanceof Error ? error.message : 'صار خطأ.'}`); }
}

async function weeklyTopCommand(i: ChatInputCommandInteraction) {
  if (!i.inCachedGuild()) return void await i.reply({ content: 'هذا الأمر يشتغل في السيرفر بس.', flags: 64 });
  await i.deferReply({ flags: 64 });
  const week = weekStartOf();
  const { top, all } = await weeklyTop(i.guildId, { since: week, limit: 10 });
  const index = all.findIndex(([id]) => id === i.user.id);
  const mine = index >= 10 ? { rank: index + 1, points: all[index]![1] } : null;
  await i.editReply(liveBoardPayload(top, week, Date.now(), { ephemeral: true, mine }));
}

const HANDLERS: Record<string, (i: ChatInputCommandInteraction) => Promise<void>> = {
  dismiss, reinstate, dismissed: dismissedList, warn, 'staff-sync': staffSync, 'weekly-board': weeklyBoard, 'weekly-top': weeklyTopCommand,
};

export const disciplineCommands = disciplineCommandJson.map(json => ({ json, handle: async (i: ChatInputCommandInteraction) => { await HANDLERS[json.name]!(i); } }));

// ---- الأزرار --------------------------------------------------------------------------------------------
export async function handleDisciplineButton(i: ButtonInteraction) {
  if (!i.customId.startsWith('disc:')) return false;
  const [, action, token] = i.customId.split(':');
  const entry = token ? pendingConfirms.get(token) : undefined;
  if (!entry || Date.now() - entry.at > CONFIRM_TTL) {
    await i.update({ content: 'انتهت صلاحية هذا التأكيد. أعد الأمر.', embeds: [], components: [] }).catch(() => undefined);
    return true;
  }
  if (entry.actorId !== i.user.id) { await i.reply({ content: 'هذا التأكيد مو لك.', flags: 64 }); return true; }
  pendingConfirms.delete(token!);
  if (action !== 'yes') { await i.update({ content: 'تم الإلغاء.', embeds: [], components: [] }); return true; }
  if (!i.guild || !i.member || !isAdministrator(i.member)) { await i.update({ content: '⛔ للأدمن فقط.', embeds: [], components: [] }); return true; }
  await i.update({ content: '⏳ جاري التنفيذ…', embeds: [], components: [] });
  try {
    if (entry.kind === 'dismiss') {
      const result = await dismissStaff(i.guild, entry.userId, { by: i.user.id, reason: entry.reason, resetPoints: entry.resetPoints, source: 'command' });
      await i.editReply({ allowedMentions: { parse: [] }, content: '', embeds: [new EmbedBuilder().setColor(RED).setTitle('⛔ تم الفصل')
        .setDescription([`<@${entry.userId}> انفصل من الستاف.`, `**السبب:** ${entry.reason}`,
          result.rolesRemoved.length ? `الرتب المشالة: ${result.rolesRemoved.map(id => `<@&${id}>`).join(' ')}` : 'ما كان عنده رتب ستاف.',
          result.shiftEnded ? 'انتهى شفته.' : '', entry.resetPoints ? 'تصفّرت نقاطه.' : '',
          result.dmSent ? 'وصلته رسالة بالسبب.' : 'ما وصلته رسالة الخاص (الخاص مقفل).'].filter(Boolean).join('\n'))] });
    } else {
      const result = await syncStaffFromRole(i.guild, 'wipe');
      await i.editReply({ content: `✅ ${describeSync(result)}`, embeds: [] });
    }
  } catch (error) {
    await i.editReply({ content: `⚠️ ${error instanceof Error ? error.message : 'صار خطأ.'}`, embeds: [] }).catch(() => undefined);
  }
  return true;
}
