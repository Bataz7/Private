import { Client, GatewayIntentBits, Partials, Events, type Guild, type GuildMember, type VoiceState } from './lib/djs/index.js';
import { env } from './config/env.js';
import { handleCommand } from './commands/index.js';
import { handleButton } from './interactions/buttons.js';
import { handleModal } from './interactions/modals.js';
import { handleSelectMenu } from './interactions/selects.js';
import { Shift, type ShiftDoc } from './models/Shift.js';
import { GuildSettings, type GuildSettingsDoc } from './models/GuildSettings.js';
import { createLog } from './services/log.service.js';
import { Staff } from './models/Staff.js';
import { StaffRating } from './models/StaffRating.js';
import { StaffDailyActivity } from './models/StaffDailyActivity.js';
import { activeMs, awardInteractionPoints, awardShiftPoints, awardVoiceInteractionPoints, DismissedError, endShift, ensureStaff, getActiveShift, isOnBreak, resumeShift } from './services/shift.service.js';
import { supabase } from './supabase/client.js';
import { bootBanner, bootFailure, bootReady, bootStep } from './utils/startup.js';
import { autoShiftConfig, endIfIdle, forgetShift, onStaffMessage, onStaffVoice, touchShift } from './services/auto-shift.service.js';
import { clearPresenceStop, confirmPresence, confirmPresenceAnywhere, hasPendingCheck, isPresenceStopped, loadRecentPresenceStops, onPresenceReaction, PRESENCE_BUTTON, presenceConfig, presenceStep, sendPresenceCheck, stopForPresence, syncPendingCheck } from './services/presence-check.service.js';
import { emojiList, installEmojiHook, syncEmojis } from './utils/emoji.js';
import { runWeeklyReports } from './services/weekly-report.service.js';
import { syncBotPresence } from './services/presence.service.js';
import { markBotStopped, tracked } from './status/heartbeat.js';
import { dispatchButton, dispatchCommand, dispatchMessage, dispatchModal, dispatchSelect, readyExtensions } from './extensions/index.js';
import { registerCommandsIfChanged } from './commands/register.js';

installEmojiHook();

const client = new Client({
  // الرياكشنات: رياكشن على رسالة «هل انت موجود؟» يأكد التواجد.
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.DirectMessageReactions],
  partials: [Partials.Channel],
  // User text (notes, reasons, titles) is echoed in many messages; never let it ping @everyone, @here or roles.
  allowedMentions: { parse: ['users'], repliedUser: false }
});

let reconcilingShiftRoles = false;

if (process.env.RIFT_MEMDEBUG) setInterval(() => {
  const g = [...client.guilds.cache.values()];
  console.log(`[cache] users=${client.users.cache.size} members=${g.reduce((a, x) => a + x.members.cache.size, 0)} channels=${g.reduce((a, x) => a + x.channels.cache.size, 0)} roles=${g.reduce((a, x) => a + x.roles.cache.size, 0)} voice=${g.reduce((a, x) => a + x.voiceStates.cache.size, 0)} sessions=${voiceSessions.size}`);
}, 10_000);

// الذاكرة: جمع قمامة دوري يرجّع الذاكرة للنظام (يبقي البوت تحت 20 ميقا على txiki)
setInterval(() => { (globalThis as { Bun?: { gc?: (sync?: boolean) => void } }).Bun?.gc?.(true); }, Number(process.env.GC_INTERVAL_MS) || 30_000);

bootBanner();
bootStep('BOOT', 'تشغيل نظام ستاف Rift');
// صوت كل إداري: آخر مرة انحسبت دقائقه + متى دخل (لتحقق التواجد). ينحذف لما يطلع، فحجمه = اللي في الفويس.
const voiceSessions = new Map<string, { lastAt: number; remainderMs: number; joinedAt?: number }>();
// Presence (status, rotating lines, per-line types, {servers} {members} {staff} {onshift} {server}): src/services/presence.service.ts

client.once(Events.ClientReady, async ready => {
  try {
    bootStep('DISCORD', `متصل باسم ${ready.user.tag}`);
    await syncEmojis(client, { upload: true }).catch(error => console.error('Emoji sync failed:', error));
    setInterval(() => { void syncEmojis(client, { quiet: true }).catch(() => undefined); }, 30 * 60_000);
    await registerCommandsIfChanged(client).then(changed => { if (changed) bootStep('COMMANDS', 'تحدّثت أوامر السلاش'); }).catch(error => console.error('Command registration failed:', error));
    const { error } = await supabase.from('guild_settings').select('guild_id').limit(1);
    if (error) {
      bootFailure(`Supabase schema unavailable: ${error.message}`);
      if (error.code === 'PGRST205') {
        bootStep('ACTION', 'افتح Supabase SQL Editor وشغّل ملفات التحديث من 001 لآخر ملف.');
        bootStep('CHECK', 'تأكد إن SUPABASE_URL في .env يأشر لنفس مشروع Supabase.');
      } else {
        bootStep('ACTION', 'راجع رابط/مفتاح Supabase وطبّق ملفات التحديث.');
      }
      await client.destroy();
      return;
    }
    bootStep('DATABASE', 'Supabase متصل والجداول سليمة');
    await deduplicateRatings();

    await reconcileShiftRoles(client);
    // اللي وقف شفتهم تحقق التواجد قبل إعادة التشغيل ما يرجع لهم شفت من الفويس.
    await loadRecentPresenceStops().catch(() => 0);
    // Staff already sitting in voice when the bot (re)starts should be on shift too (a restart is not activity).
    for (const guild of client.guilds.cache.values()) {
      for (const state of guild.voiceStates.cache.values()) {
        if (state.member?.user.bot || !activeVoice(state)) continue;
        void ensureVoiceShift(guild, state.id, false).catch(() => undefined);
      }
    }
    await syncBotPresence(client);
    // تغييرات الحالة من الداشبورد توصل خلال 15 ثانية (كانت كل ثانيتين = قراءة قاعدة بيانات بلا داعي)
    setInterval(() => { void syncBotPresence(client); }, Number(process.env.PRESENCE_POLL_MS) || 15_000);
    const [staffCount, onShiftCount] = await Promise.all([Staff.countDocuments({ active: true }).catch(() => 0), Shift.countDocuments({ status: 'active' }).catch(() => 0)]);
    const firstSettings = await GuildSettings.findOne({ guildId: env.guildId || client.guilds.cache.first()?.id || '' }).catch(() => null);
    const auto = autoShiftConfig(firstSettings);
    await readyExtensions(client);
    bootReady({
      tag: ready.user.tag, guilds: client.guilds.cache.size, staff: staffCount, onShift: onShiftCount, pingMs: Math.max(0, Math.round(client.ws.ping)),
      autoShift: auto.enabled ? `يبدأ بـ ${auto.messages} رسالة خلال ${Math.round(auto.windowMs / 60_000)} دقيقة · ينتهي بعد ${Math.round(auto.idleMs / 60_000)} دقيقة خمول` : 'متوقف',
      emojis: `${emojiList().filter(item => item.id).length}/${emojiList().length} ready`,
      dashboardUrl: env.dashboardUrl,
    });
    setInterval(() => { void tracked('shifts', () => monitorShifts(client)).catch(error => console.error('Shift monitor failed:', error)); }, 60_000);
    setInterval(() => { void tracked('roles', () => reconcileShiftRoles(client)).catch(() => undefined); }, 5 * 60_000);
    // Weekly reports: checked every 15 minutes; each server is claimed once per week, so the dashboard running the same job never doubles them.
    setInterval(() => { void tracked('weekly', () => runWeeklyReports(client)).catch(error => console.error('Weekly reports failed:', error)); }, 15 * 60_000);
    setTimeout(() => { void tracked('weekly', () => runWeeklyReports(client)).catch(error => console.error('Weekly reports failed:', error)); }, 20_000);
  } catch (error) {
    bootFailure(error instanceof Error ? error.message : 'خطأ غير معروف وقت التشغيل');
    await client.destroy();
  }
});

async function deduplicateRatings() {
  const ratings = await StaffRating.find({}).catch(() => []);
  const groups = new Map<string, typeof ratings>();
  for (const rating of ratings) {
    const key = `${rating.guildId}:${rating.staffUserId}:${rating.reviewerUserId}`;
    const group = groups.get(key) ?? [];
    group.push(rating);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const latest = group.slice().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    if (!latest) continue;
    await StaffRating.deleteMany({ guildId: latest.guildId, staffUserId: latest.staffUserId, reviewerUserId: latest.reviewerUserId });
    await StaffRating.create({ guildId: latest.guildId, staffUserId: latest.staffUserId, reviewerUserId: latest.reviewerUserId, rating: latest.rating, comment: latest.comment, createdAt: latest.createdAt });
  }
}

async function reconcileShiftRoles(bot: Client) {
  if (reconcilingShiftRoles) return;
  reconcilingShiftRoles = true;
  try {
  for (const guild of bot.guilds.cache.values()) {
    const settings = await GuildSettings.findOne({ guildId: guild.id }).catch(() => null);
    if (!settings?.onShiftRoleId) continue;
    const activeShifts = await Shift.find({ guildId: guild.id, status: 'active' }).catch(() => []);
    const activeUserIds = new Set(activeShifts.map(shift => shift.userId));
    const members = guild.members.cache;
    if (!members) continue;
    for (const member of members.values()) {
      const hasShiftRole = member.roles.cache.has(settings.onShiftRoleId);
      const shouldHaveRole = activeUserIds.has(member.id);
      if (shouldHaveRole && !hasShiftRole) await member.roles.add(settings.onShiftRoleId, 'مزامنة رتبة الشفت النشط').catch(() => undefined);
      if (!shouldHaveRole && hasShiftRole) await member.roles.remove(settings.onShiftRoleId, 'ما عنده شفت نشط').catch(() => undefined);
    }
  }
  } finally {
    reconcilingShiftRoles = false;
  }
}

/** في الفويس ومو ديفن ومو في روم الـ AFK. */
function activeVoice(state: VoiceState | null | undefined) {
  return Boolean(state?.channelId && !state.selfDeaf && !state.serverDeaf && state.channelId !== state.guild.afkChannelId);
}

async function monitorShifts(bot: Client) {
  const active = await Shift.find({ status: 'active' }).catch(() => []);
  const now = Date.now();
  // إعدادات كل سيرفر مرة وحدة بكل دورة.
  const settingsOf = new Map<string, GuildSettingsDoc | null>();
  for (const shift of active) {
    const id = `${shift.guildId}:${shift.userId}`;
    const currentBreak = shift.breaks.at(-1);
    if (currentBreak && !currentBreak.endedAt) {
      const breakMs = now - new Date(currentBreak.startedAt).getTime();
      if (breakMs >= 30 * 60 * 1000) {
        const resumed = await resumeShift(shift.guildId, shift.userId).catch(() => null);
        if (resumed) await createLog(shift.guildId, 'BREAK_AUTO_ENDED', shift.userId, shift.userId, { shiftId: String(shift._id) }).catch(() => undefined);
      }
      continue;
    }
    const guild: Guild | null = bot.guilds.cache.get(shift.guildId) ?? await bot.guilds.fetch(shift.guildId).catch(() => null);
    if (!settingsOf.has(shift.guildId)) settingsOf.set(shift.guildId, await GuildSettings.findOne({ guildId: shift.guildId }).catch(() => null));
    const settings = settingsOf.get(shift.guildId);
    if (!guild || !settings) continue;
    const member = await guild.members.fetch(shift.userId).catch(() => null);
    const inVoice = activeVoice(member?.voice);

    // تحقق التواجد: «هل انت موجود؟» بعد ساعة فويس بدون تفاعل، وإيقاف صامت بعد 30 دقيقة بدون رد.
    const presence = presenceConfig(settings);
    await syncPendingCheck(bot, shift);
    const step = presenceStep({
      now, startedAt: shift.startedAt.getTime(), lastActivityAt: shift.lastActivityAt?.getTime() ?? null, voiceJoinedAt: voiceSessions.get(id)?.joinedAt ?? null,
      checkSentAt: shift.checkSentAt?.getTime() ?? null, inVoice, onBreak: false,
    }, presence);
    if (step === 'timeout') {
      if (await stopForPresence(bot, guild, shift, settings, member)) { forgetShift(shift.guildId, shift.userId); voiceSessions.delete(id); }
      continue;
    }
    // ينتظر رد: لا نقاط ولا إنهاء خمول (لو ما رد، الشفت ينقفل عند وقت السؤال).
    if (step === 'wait') continue;
    if (inVoice) {
      await recordVoiceActivity(shift, now);
      if (!presence.enabled) {
        // التحقق مقفل: الفويس يبقي الشفت شغال مثل قبل.
        shift.lastActivityAt = new Date(now);
        await Shift.update(shift.id, { lastActivityAt: shift.lastActivityAt }).catch(() => undefined);
      } else if (step === 'send' && member) await sendPresenceCheck(bot, guild, member, shift, now).catch(error => console.error('Presence check failed:', error));
    }
    if (activeMs(shift) >= 12 * 60 * 60 * 1000) {
      const ended = await endShift(shift.guildId, shift.userId).catch(() => null);
      if (ended) forgetShift(shift.guildId, shift.userId);
      if (ended && member) { await member.roles.remove(settings.onShiftRoleId, 'وصل الحد الأقصى للشفت (12 ساعة)').catch(() => undefined); } // بصمت: ما يوصل العضو أي رسالة
      continue;
    }
    // تحديث جزئي: حفظ كامل ممكن يرجّع check_sent_at قديم فوق تأكيد صار في نفس اللحظة.
    const awardedPoints = await awardShiftPoints(shift).catch(() => 0);
    if (awardedPoints > 0) await Shift.update(shift.id, { pointsAwarded: shift.pointsAwarded }).catch(() => undefined);
    // اللي في الفويس يمشي عليهم تحقق التواجد؛ شفتات الرسائل تنتهي بعد الخمول. A member who left the server (member is null)
    // is closed the same way, at their last activity.
    if (!inVoice) await endIfIdle(bot, shift, settings, member, now);
  }
}

async function recordVoiceMinutes(guildId: string, userId: string, minutes: number, at: Date, shift?: ShiftDoc) {
  if (minutes <= 0) return;
  const staff = await Staff.findOne({ guildId, userId }).catch(() => null);
  // Partial update: a full save() would write back a stale points value over the ledger's atomic changes.
  if (staff) { staff.voiceMinutes += minutes; await Staff.update(staff.id, { voiceMinutes: staff.voiceMinutes }).catch(() => undefined); }
  const day = new Date(at); day.setHours(0, 0, 0, 0);
  const activity = await StaffDailyActivity.findOne({ guildId, userId, activityDate: day }).catch(() => null);
  if (activity) {
    activity.activeMinutes += minutes;
    activity.voiceMinutes += minutes;
    await activity.save().catch(() => undefined);
  } else {
    await StaffDailyActivity.create({ guildId, userId, activityDate: day, activeMinutes: minutes, messageCount: 0, voiceMinutes: minutes, lastMessageAt: null }).catch(() => undefined);
  }
  if (shift) await awardVoiceInteractionPoints(shift, minutes).catch(() => 0);
}

async function recordVoiceActivity(shift: ShiftDoc, now = Date.now()) {
  const key = `${shift.guildId}:${shift.userId}`;
  const session = voiceSessions.get(key) ?? { lastAt: now, remainderMs: 0 };
  const elapsedMs = Math.max(0, now - session.lastAt) + session.remainderMs;
  const minutes = Math.floor(elapsedMs / 60_000);
  voiceSessions.set(key, { lastAt: now, remainderMs: elapsedMs % 60_000, joinedAt: session.joinedAt });
  await recordVoiceMinutes(shift.guildId, shift.userId, minutes, new Date(now), shift);
}

client.on(Events.InteractionCreate, async interaction => {
  // أي تفاعل مع البوت في السيرفر = موجود (زر التحقق نفسه يتعامل معه الزر).
  if (interaction.guildId && !interaction.customId.startsWith(`${PRESENCE_BUTTON}:`)) void confirmPresence(client, interaction.guildId, interaction.user.id).catch(() => undefined);
  try {
    if (interaction.isChatInputCommand()) { if (!await dispatchCommand(interaction)) await handleCommand(interaction); }
    else if (interaction.isButton()) { if (!await dispatchButton(interaction)) await handleButton(interaction); }
    else if (interaction.isStringSelectMenu()) { if (!await dispatchSelect(interaction)) await handleSelectMenu(interaction); }
    else if (interaction.isModalSubmit()) { if (!await dispatchModal(interaction)) await handleModal(interaction); }
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code === 10062 || code === 40060) return;
    if (!(error instanceof DismissedError)) console.error(error);
    const message = error instanceof Error ? error.message : 'صار خطأ غير متوقع.';
    if (interaction.isRepliable()) {
      const payload = { content: `⚠️ ${message}`, flags: 64 as const };
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => undefined);
      else await interaction.reply(payload).catch(() => undefined);
    }
  }
});

// رياكشن على رسالة التحقق = موجود. (الحدث ما له معالج في الـ client، فيوصل كـ raw.)
client.on('raw', (packet: { t: string; d: { user_id?: string; message_id?: string } }) => {
  if (packet.t === 'MESSAGE_REACTION_ADD') void onPresenceReaction(client, packet.d).catch(() => undefined);
});

client.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;
  // أي رسالة في السيرفر (أو رد بالخاص) تأكد التواجد لو فيه «هل انت موجود؟» معلّق.
  if (message.guildId) await confirmPresence(client, message.guildId, message.author.id).catch(() => undefined);
  else await confirmPresenceAnywhere(client, message.author.id).catch(() => undefined);
  if (await dispatchMessage(message)) return;
  if (!message.guild) return;
  const authorMember = await message.guild.members.fetch(message.author.id).catch(() => null);
  const settings = await GuildSettings.findOne({ guildId: message.guild.id }).catch(() => null);
  if (authorMember && settings && (authorMember.roles.cache.has(settings.staffRoleId) || authorMember.permissions.has('Administrator'))) {
    const authorStaff = await ensureStaff(message.guild.id, message.author.id).catch(error => {
      if (!(error instanceof DismissedError)) console.error(`Automatic staff registration failed for ${message.author.id}:`, error);
      return null;
    });
    if (!authorStaff) return;
    authorStaff.messageCount += 1;
    await Staff.update(authorStaff.id, { messageCount: authorStaff.messageCount }).catch(() => undefined);
    // The engine counts the burst, starts the shift when the threshold is reached, and keeps a running one alive.
    const activeShift = authorStaff.active ? await onStaffMessage(message.guild, authorMember, settings).catch(error => { console.error('Automatic shift engine failed:', error); return null; }) : null;
    if (activeShift && authorMember && !authorMember.permissions.has('Administrator') && !isOnBreak(activeShift)) await awardInteractionPoints(activeShift).catch(() => undefined);
    if (!activeShift || !isOnBreak(activeShift)) {
      const date = new Date(); const day = new Date(date); day.setHours(0, 0, 0, 0);
      const activity = await StaffDailyActivity.findOne({ guildId: message.guild.id, userId: message.author.id, activityDate: day }).catch(() => null);
      if (activity) { activity.activeMinutes += 1; activity.messageCount += 1; activity.lastMessageAt = date; await activity.save().catch(() => undefined); }
      else await StaffDailyActivity.create({ guildId: message.guild.id, userId: message.author.id, activityDate: day, activeMinutes: 1, messageCount: 1, lastMessageAt: date }).catch(() => undefined);
    }
  }
});

/** Starts a shift for a staff member who joined voice. Returns nothing when they are not staff or auto shifts are off. */
async function ensureVoiceShift(guild: Guild, userId: string, touch = true) {
  const settings = await GuildSettings.findOne({ guildId: guild.id }).catch(() => null);
  if (!settings) return;
  const member: GuildMember | null = await guild.members.fetch(userId).catch(() => null);
  if (!member || (!member.roles.cache.has(settings.staffRoleId) && !member.permissions.has('Administrator'))) return;
  await onStaffVoice(guild, member, settings, { touch });
}

/** تغيير سوّاه العضو بنفسه في الفويس (دخول، تنقّل، ميوت، ديفن، كاميرا، بث) — مو ميوت من السيرفر ولا نقل للـ AFK. */
function voiceAction(oldState: VoiceState, newState: VoiceState) {
  if (!newState.channelId || newState.channelId === newState.guild.afkChannelId) return false;
  return oldState.channelId !== newState.channelId || oldState.selfMute !== newState.selfMute || oldState.selfDeaf !== newState.selfDeaf
    || oldState.selfVideo !== newState.selfVideo || oldState.streaming !== newState.streaming;
}

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  if (newState.member?.user.bot) return;
  const guildId = newState.guild.id;
  const key = `${guildId}:${newState.id}`;
  const now = Date.now();
  const wasActive = activeVoice(oldState);
  const isActive = activeVoice(newState);
  // طلع من الفويس كلياً: يقدر يرجع له شفت تلقائي من الفويس لما يدخل من جديد.
  if (!newState.channelId) clearPresenceStop(guildId, newState.id);
  const acted = voiceAction(oldState, newState);
  if (acted) await confirmPresence(client, guildId, newState.id, now).catch(() => undefined);
  const pendingCheck = hasPendingCheck(guildId, newState.id);
  const shift = await getActiveShift(guildId, newState.id).catch(() => null);
  if (wasActive && shift && !isOnBreak(shift) && !pendingCheck) await recordVoiceActivity(shift, now);
  if (!isActive) {
    voiceSessions.delete(key);
    // آخر لحظة نعرف إنه كان موجود فيها (إلا لو فيه سؤال ينتظر رد: وقتها يحسم التحقق).
    if (wasActive && shift && !isOnBreak(shift) && !pendingCheck) await touchShift(shift, now).catch(() => undefined);
    return;
  }
  if (!wasActive) {
    const session = voiceSessions.get(key);
    voiceSessions.set(key, { lastAt: session?.lastAt ?? now, remainderMs: session?.remainderMs ?? 0, joinedAt: now });
  }
  if (!acted || isPresenceStopped(guildId, newState.id, now) && !shift) return;
  await ensureVoiceShift(newState.guild, newState.id);
  const activeShift = shift ?? await getActiveShift(guildId, newState.id).catch(() => null);
  if (activeShift && !isOnBreak(activeShift) && !wasActive) await recordVoiceActivity(activeShift, now);
});

process.on('SIGINT', async () => {
  await markBotStopped();
  client.destroy();
  process.exit(0);
});

client.login(env.token);
