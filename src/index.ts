import { ActionRowBuilder, ActivityType, ButtonBuilder, ButtonStyle, Client, EmbedBuilder, GatewayIntentBits, Partials, Events } from './lib/djs/index.js';
import { env } from './config/env.js';
import { handleCommand } from './commands/index.js';
import { handleButton } from './interactions/buttons.js';
import { handleModal } from './interactions/modals.js';
import { handleSelectMenu } from './interactions/selects.js';
import { Shift } from './models/Shift.js';
import { GuildSettings } from './models/GuildSettings.js';
import { createLog } from './services/log.service.js';
import { Staff } from './models/Staff.js';
import { StaffRating } from './models/StaffRating.js';
import { StaffDailyActivity } from './models/StaffDailyActivity.js';
import { activeMs, awardInteractionPoints, awardShiftPoints, awardVoiceInteractionPoints, endShift, ensureStaff, getActiveShift, isOnBreak, resumeShift, startShift, duration } from './services/shift.service.js';
import { supabase } from './supabase/client.js';
import { bootBanner, bootFailure, bootReady, bootStep } from './utils/startup.js';
import { autoShiftConfig, endIfIdle, onStaffMessage, onStaffVoice } from './services/auto-shift.service.js';
import { emojiList, installEmojiHook, syncEmojis } from './utils/emoji.js';
import { runWeeklyReports } from './services/weekly-report.service.js';
import { syncBotPresence } from './services/presence.service.js';
import { markBotStopped, tracked } from './status/heartbeat.js';
import { dispatchButton, dispatchCommand, dispatchMessage, dispatchModal, dispatchSelect, readyExtensions } from './extensions/index.js';
import { registerCommandsIfChanged } from './commands/register.js';

installEmojiHook();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel],
  // User text (notes, reasons, titles) is echoed in many messages; never let it ping @everyone, @here or roles.
  allowedMentions: { parse: ['users'], repliedUser: false }
});

let reconcilingShiftRoles = false;

bootBanner();
bootStep('BOOT', 'Loading Rift staff operations');
const voiceSessions = new Map<string, { lastAt: number; remainderMs: number }>();
// Presence (status, rotating lines, per-line types, {servers} {members} {staff} {onshift} {server}): src/services/presence.service.ts

client.once(Events.ClientReady, async ready => {
  try {
    bootStep('DISCORD', `Connected as ${ready.user.tag}`);
    await syncEmojis(client, { upload: true }).catch(error => console.error('Emoji sync failed:', error));
    setInterval(() => { void syncEmojis(client, { quiet: true }).catch(() => undefined); }, 30 * 60_000);
    await registerCommandsIfChanged(client).then(changed => { if (changed) bootStep('COMMANDS', 'Slash commands updated'); }).catch(error => console.error('Command registration failed:', error));
    const { error } = await supabase.from('guild_settings').select('guild_id').limit(1);
    if (error) {
      bootFailure(`Supabase schema unavailable: ${error.message}`);
      if (error.code === 'PGRST205') {
        bootStep('ACTION', 'Open Supabase SQL Editor and run migrations 001 through 005.');
        bootStep('CHECK', 'Confirm .env SUPABASE_URL points to the same Supabase project.');
      } else {
        bootStep('ACTION', 'Check Supabase URL/key and apply migrations 001 through 005.');
      }
      await client.destroy();
      return;
    }
    bootStep('DATABASE', 'Supabase connected and schema verified');
    await deduplicateRatings();

    await reconcileShiftRoles(client);
    // Staff already sitting in voice when the bot (re)starts should be on shift too.
    for (const guild of client.guilds.cache.values()) {
      for (const state of guild.voiceStates.cache.values()) {
        if (state.member?.user.bot || !state.channelId || state.selfDeaf || state.serverDeaf) continue;
        void ensureVoiceShift(guild, state.id).catch(() => undefined);
      }
    }
  await syncBotPresence(client);
  setInterval(() => { void syncBotPresence(client); }, 2000);
    const [staffCount, onShiftCount] = await Promise.all([Staff.countDocuments({ active: true }).catch(() => 0), Shift.countDocuments({ status: 'active' }).catch(() => 0)]);
    const firstSettings = await GuildSettings.findOne({ guildId: env.guildId || client.guilds.cache.first()?.id || '' }).catch(() => null);
    const auto = autoShiftConfig(firstSettings);
    await readyExtensions(client);
    bootReady({
      tag: ready.user.tag, guilds: client.guilds.cache.size, staff: staffCount, onShift: onShiftCount, pingMs: Math.max(0, Math.round(client.ws.ping)),
      autoShift: auto.enabled ? `${auto.messages} msgs / ${Math.round(auto.windowMs / 60_000)}m starts · ${Math.round(auto.idleMs / 60_000)}m idle ends` : 'off',
      emojis: `${emojiList().filter(item => item.id).length}/${emojiList().length} ready`,
      dashboardUrl: env.dashboardUrl,
    });
    setInterval(() => { void tracked('shifts', () => monitorShifts(client)).catch(error => console.error('Shift monitor failed:', error)); }, 60_000);
    setInterval(() => { void tracked('roles', () => reconcileShiftRoles(client)).catch(() => undefined); }, 5 * 60_000);
    // Weekly reports: checked every 15 minutes; each server is claimed once per week, so the dashboard running the same job never doubles them.
    setInterval(() => { void tracked('weekly', () => runWeeklyReports(client)).catch(error => console.error('Weekly reports failed:', error)); }, 15 * 60_000);
    setTimeout(() => { void tracked('weekly', () => runWeeklyReports(client)).catch(error => console.error('Weekly reports failed:', error)); }, 20_000);
  } catch (error) {
    bootFailure(error instanceof Error ? error.message : 'Unknown startup error');
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
      if (shouldHaveRole && !hasShiftRole) await member.roles.add(settings.onShiftRoleId, 'Active shift role synchronization').catch(() => undefined);
      if (!shouldHaveRole && hasShiftRole) await member.roles.remove(settings.onShiftRoleId, 'No active shift found').catch(() => undefined);
    }
  }
  } finally {
    reconcilingShiftRoles = false;
  }
}

async function monitorShifts(bot: Client) {
  const active = await Shift.find({ status: 'active' }).catch(() => []);
  const now = Date.now();
  for (const shift of active) {
    const currentBreak = shift.breaks.at(-1);
    if (currentBreak && !currentBreak.endedAt) {
      const breakMs = now - new Date(currentBreak.startedAt).getTime();
      if (breakMs >= 30 * 60 * 1000) {
        const resumed = await resumeShift(shift.guildId, shift.userId).catch(() => null);
        if (resumed) {
          const guild = await bot.guilds.fetch(shift.guildId).catch(() => null);
          await createLog(shift.guildId, 'BREAK_AUTO_ENDED', shift.userId, shift.userId, { shiftId: String(shift._id) });
        }
      }
      continue;
    }
    const guild = await bot.guilds.fetch(shift.guildId).catch(() => null);
    const settings = await GuildSettings.findOne({ guildId: shift.guildId }).catch(() => null);
    if (!guild || !settings) continue;
    const member = await guild.members.fetch(shift.userId).catch(() => null);
    // Sitting in an unmuted voice channel keeps the shift alive.
    if (member?.voice.channelId && !member.voice.selfDeaf && !member.voice.serverDeaf) {
      await recordShiftActivity(shift.guildId, shift.userId);
      await recordVoiceActivity(shift, now);
      shift.lastActivityAt = new Date(now);
    }
    if (activeMs(shift) >= 12 * 60 * 60 * 1000) {
      const ended = await endShift(shift.guildId, shift.userId).catch(() => null);
      if (ended && member) { await member.roles.remove(settings.onShiftRoleId, 'Maximum 12-hour shift reached').catch(() => undefined); await member.send({ content: 'Your shift was ended automatically after reaching the 12-hour maximum.' }).catch(() => undefined); }
      continue;
    }
    const awardedPoints = await awardShiftPoints(shift).catch(() => 0);
    if (awardedPoints > 0) await shift.save().catch(() => undefined);
    // A member who left the server (member is null) is closed the same way, at their last activity.
    await endIfIdle(bot, shift, settings, member, now);
  }
}

async function recordShiftActivity(guildId: string, userId: string) {
  const shift = await Shift.findOne({ guildId, userId, status: 'active' }).catch(() => null);
  if (!shift || isOnBreak(shift)) return;
  shift.lastActivityAt = new Date();
  if (shift.checkSentAt) shift.checkSentAt = null;
  await shift.save().catch(() => undefined);
}

async function recordVoiceMinutes(guildId: string, userId: string, minutes: number, at: Date, shift?: import('./models/Shift.js').ShiftDoc) {
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

async function recordVoiceActivity(shift: import('./models/Shift.js').ShiftDoc, now = Date.now()) {
  const key = `${shift.guildId}:${shift.userId}`;
  const session = voiceSessions.get(key) ?? { lastAt: now, remainderMs: 0 };
  const elapsedMs = Math.max(0, now - session.lastAt) + session.remainderMs;
  const minutes = Math.floor(elapsedMs / 60_000);
  voiceSessions.set(key, { lastAt: now, remainderMs: elapsedMs % 60_000 });
  await recordVoiceMinutes(shift.guildId, shift.userId, minutes, new Date(now), shift);
}

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) { if (!await dispatchCommand(interaction)) await handleCommand(interaction); }
    else if (interaction.isButton()) { if (!await dispatchButton(interaction)) await handleButton(interaction); }
    else if (interaction.isStringSelectMenu()) { if (!await dispatchSelect(interaction)) await handleSelectMenu(interaction); }
    else if (interaction.isModalSubmit()) { if (!await dispatchModal(interaction)) await handleModal(interaction); }
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code === 10062 || code === 40060) return;
    console.error(error);
    const message = error instanceof Error ? error.message : 'Unexpected error.';
    if (interaction.isRepliable()) {
      const payload = { content: `⚠️ ${message}`, flags: 64 as const };
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => undefined);
      else await interaction.reply(payload).catch(() => undefined);
    }
  }
});

client.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;
  if (await dispatchMessage(message)) return;
  if (!message.guild) return;
  const authorMember = await message.guild.members.fetch(message.author.id).catch(() => null);
  const settings = await GuildSettings.findOne({ guildId: message.guild.id }).catch(() => null);
  if (authorMember && settings && (authorMember.roles.cache.has(settings.staffRoleId) || authorMember.permissions.has('Administrator'))) {
    const authorStaff = await ensureStaff(message.guild.id, message.author.id).catch(error => {
      console.error(`Automatic staff registration failed for ${message.author.id}:`, error);
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
async function ensureVoiceShift(guild: import('./lib/djs/index.js').Guild, userId: string) {
  const settings = await GuildSettings.findOne({ guildId: guild.id }).catch(() => null);
  if (!settings) return;
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member || (!member.roles.cache.has(settings.staffRoleId) && !member.permissions.has('Administrator'))) return;
  await onStaffVoice(guild, member, settings);
}

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  if (newState.member?.user.bot) return;
  const key = `${newState.guild.id}:${newState.id}`;
  const now = Date.now();
  const wasActive = Boolean(oldState.channelId && !oldState.selfDeaf && !oldState.serverDeaf);
  const isActive = Boolean(newState.channelId && !newState.selfDeaf && !newState.serverDeaf);
  const shift = await getActiveShift(newState.guild.id, newState.id).catch(() => null);
  if (wasActive && shift && !isOnBreak(shift)) await recordVoiceActivity(shift, now);
  if (!isActive) { voiceSessions.delete(key); return; }
  await ensureVoiceShift(newState.guild, newState.id);
  const activeShift = await getActiveShift(newState.guild.id, newState.id).catch(() => null);
  if (activeShift && !isOnBreak(activeShift)) {
    await recordShiftActivity(newState.guild.id, newState.id);
    await recordVoiceActivity(activeShift, now);
  }
});

process.on('SIGINT', async () => {
  await markBotStopped();
  client.destroy();
  process.exit(0);
});

client.login(env.token);
