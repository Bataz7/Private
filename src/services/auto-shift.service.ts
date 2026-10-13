import { EmbedBuilder, type Client, type Guild, type GuildMember } from '../lib/djs/index.js';
import { Shift, type ShiftDoc } from '../models/Shift.js';
import type { GuildSettingsDoc } from '../models/GuildSettings.js';
import { createLog } from './log.service.js';
import { activeMs, DismissedError, duration, endShift, ensureStaff, getActiveShift, isOnBreak, startShift } from './shift.service.js';
import { clearPresenceStop, isPresenceStopped } from './presence-check.service.js';
import { BRAND_COLOR, e } from '../utils/emoji.js';
import { event } from '../utils/terminal.js';

// Automatic shifts.
//   Start: a staff member sends `messages` messages inside a rolling `window` (default 20 in 10 minutes), or sits in an
//          unmuted voice channel. The shift is back-dated to the first message of that burst.
//   End:   message-only shifts: no message for `idle` minutes (default 30), closed at the last activity so the idle wait
//          is never counted. Voice shifts: the presence check («هل انت موجود؟», presence-check.service.ts) decides.
// Manual start/end buttons keep working; a member who ends a shift by hand is left alone for a while.

export interface AutoShiftConfig { enabled: boolean; messages: number; windowMs: number; idleMs: number }
const clamp = (value: unknown, min: number, max: number, fallback: number) => { const n = Number(value); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback; };

export function autoShiftConfig(settings: Partial<GuildSettingsDoc> | null | undefined): AutoShiftConfig {
  return {
    enabled: settings?.autoShiftEnabled !== false,
    messages: clamp(settings?.autoShiftMessages, 3, 200, 20),
    windowMs: clamp(settings?.autoShiftWindowMinutes, 1, 120, 10) * 60_000,
    idleMs: clamp(settings?.autoShiftIdleMinutes, 5, 240, 30) * 60_000,
  };
}

const MANUAL_END_COOLDOWN_MS = 5 * 60_000;
const TOUCH_INTERVAL_MS = 15_000;
const SHIFT_CACHE_MS = 20_000;
const MAX_TRACKED_KEYS = 5_000;

const key = (guildId: string, userId: string) => `${guildId}:${userId}`;
const bursts = new Map<string, number[]>();
const starting = new Set<string>();
const suppressedUntil = new Map<string, number>();
const lastTouch = new Map<string, number>();
const shiftCache = new Map<string, { shift: ShiftDoc | null; at: number }>();

/** Called after a member ends a shift by hand, so the engine does not immediately start another. */
export function suppressAutoStart(guildId: string, userId: string, ms = MANUAL_END_COOLDOWN_MS) {
  const id = key(guildId, userId);
  suppressedUntil.set(id, Date.now() + ms);
  bursts.delete(id);
  shiftCache.delete(id);
}

/** ينسى كاش العضو بعد ما ينتهي شفته من مكان ثاني (تحقق التواجد، الفصل). */
export function forgetShift(guildId: string, userId: string) {
  const id = key(guildId, userId);
  shiftCache.delete(id); bursts.delete(id); lastTouch.delete(id);
}

async function cachedShift(guildId: string, userId: string, now: number) {
  const id = key(guildId, userId);
  const cached = shiftCache.get(id);
  if (cached && now - cached.at < SHIFT_CACHE_MS) return cached.shift;
  const shift = await getActiveShift(guildId, userId).catch(() => null) as ShiftDoc | null;
  shiftCache.set(id, { shift, at: now });
  return shift;
}

/** Records that the member is active right now. Written at most every 15 seconds per member. */
export async function touchShift(shift: ShiftDoc, now = Date.now()) {
  if (isOnBreak(shift)) return;
  const id = key(shift.guildId, shift.userId);
  shift.lastActivityAt = new Date(now);
  if (now - (lastTouch.get(id) ?? 0) < TOUCH_INTERVAL_MS) return;
  lastTouch.set(id, now);
  await Shift.update(shift.id, { lastActivityAt: new Date(now), checkSentAt: null }).catch(() => undefined);
}

function prune() {
  if (bursts.size < MAX_TRACKED_KEYS) return;
  const now = Date.now();
  for (const [id, list] of bursts) if (!list.length || now - list[list.length - 1]! > 3_600_000) bursts.delete(id);
  for (const [id, until] of suppressedUntil) if (until < now) suppressedUntil.delete(id);
  for (const [id, entry] of shiftCache) if (now - entry.at > 60_000) shiftCache.delete(id);
  for (const [id, at] of lastTouch) if (now - at > 3_600_000) lastTouch.delete(id);
}

export async function announce(client: Client, settings: GuildSettingsDoc, embed: EmbedBuilder) {
  const channel = settings.logsChannelId ? await client.channels.fetch(settings.logsChannelId).catch(() => null) : null;
  if (channel?.isTextBased() && 'send' in channel) await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => undefined);
}

async function begin(guild: Guild, member: GuildMember, settings: GuildSettingsDoc, startedAt: Date, reason: string, detail: Record<string, unknown>) {
  const id = key(guild.id, member.id);
  if (starting.has(id)) return null;
  if ((suppressedUntil.get(id) ?? 0) > Date.now()) return null;
  // Someone on approved leave is not working, even if they chat.
  if (settings.leaveRoleId && member.roles.cache.has(settings.leaveRoleId)) return null;
  starting.add(id);
  try {
    const staff = await ensureStaff(guild.id, member.id).catch(error => { if (!(error instanceof DismissedError)) console.error(`Automatic shift registration failed for ${member.id}:`, error); return null; });
    if (!staff?.active) return null;
    const shift = await startShift(guild.id, member.id, { startedAt }).catch(error => {
      const message = error instanceof Error ? error.message : '';
      if (!/active shift|نشط/.test(message)) console.error(`Automatic shift start failed for ${member.id}:`, error);
      return null;
    });
    if (!shift) return null;
    bursts.delete(id);
    clearPresenceStop(guild.id, member.id);
    shiftCache.set(id, { shift: shift as ShiftDoc, at: Date.now() });
    if (settings.onShiftRoleId) await member.roles.add(settings.onShiftRoleId, 'بدأ الشفت تلقائياً من نشاط الإداري').catch(() => undefined);
    await createLog(guild.id, 'SHIFT_STARTED_AUTOMATICALLY', member.id, member.id, { shiftId: String(shift._id), reason, ...detail });
    await announce(guild.client, settings, new EmbedBuilder().setColor(BRAND_COLOR)
      .setDescription(`### ${e('shiftstart')} بدأ شفت تلقائياً\n${member} — ${reason}\nبدأ <t:${Math.floor(startedAt.getTime() / 1000)}:R>`));
    event('shiftStart', `${member.displayName} بدأ شفته تلقائياً (${detail.voice ? 'فويس' : `${detail.messages} رسالة`})`);
    return shift as ShiftDoc;
  } finally {
    starting.delete(id);
  }
}

/**
 * Feed every message of a staff member (or administrator) through here.
 * Returns the member's active shift afterwards: the running one, or the one this message just started.
 */
export async function onStaffMessage(guild: Guild, member: GuildMember, settings: GuildSettingsDoc, at = Date.now()): Promise<ShiftDoc | null> {
  const cfg = autoShiftConfig(settings);
  const id = key(guild.id, member.id);
  const burst = (bursts.get(id) ?? []).filter(time => at - time <= cfg.windowMs);
  burst.push(at);
  bursts.set(id, burst);
  prune();

  const shift = await cachedShift(guild.id, member.id, at);
  if (shift) {
    await touchShift(shift, at);
    return shift;
  }
  if (!cfg.enabled || burst.length < cfg.messages) return null;
  return begin(guild, member, settings, new Date(burst[0]!), `${burst.length} رسالة خلال ${Math.round(cfg.windowMs / 60_000)} دقيقة`, { messages: burst.length, windowMinutes: Math.round(cfg.windowMs / 60_000) });
}

/**
 * Joining an unmuted voice channel counts as being on duty straight away. `touch: false` (bot restart) does not count
 * as activity. Someone whose shift the presence check stopped is not restarted from voice until they leave and rejoin.
 */
export async function onStaffVoice(guild: Guild, member: GuildMember, settings: GuildSettingsDoc, { touch = true } = {}): Promise<ShiftDoc | null> {
  const cfg = autoShiftConfig(settings);
  const now = Date.now();
  const shift = await cachedShift(guild.id, member.id, now);
  if (shift) { if (touch) await touchShift(shift, now); return shift; }
  if (!cfg.enabled || isPresenceStopped(guild.id, member.id, now)) return null;
  return begin(guild, member, settings, new Date(now), 'دخل روم صوتي', { voice: true });
}

/** Closes a shift that has been idle for too long. Returns true when it was ended. */
export async function endIfIdle(client: Client, shift: ShiftDoc, settings: GuildSettingsDoc, member: GuildMember | null, now = Date.now()) {
  const cfg = autoShiftConfig(settings);
  const lastActivity = Math.max(shift.lastActivityAt?.getTime() ?? 0, shift.startedAt.getTime());
  if (now - lastActivity < cfg.idleMs) return false;
  const ended = await endShift(shift.guildId, shift.userId, { endedAt: new Date(lastActivity) }).catch(() => null);
  if (!ended) return false;
  const id = key(shift.guildId, shift.userId);
  shiftCache.delete(id); bursts.delete(id); lastTouch.delete(id);
  if (member && settings.onShiftRoleId) await member.roles.remove(settings.onShiftRoleId, 'انتهى الشفت تلقائياً بسبب عدم النشاط').catch(() => undefined);
  const worked = duration(activeMs(ended));
  event('shiftEnd', `${member?.displayName ?? shift.userId} انتهى شفته تلقائياً بعد ${Math.round(cfg.idleMs / 60_000)} دقيقة خمول، المحسوب ${worked}`);
  await createLog(shift.guildId, 'SHIFT_AUTO_ENDED', shift.userId, null, { shiftId: String(ended._id), duration: worked, idleMinutes: Math.round(cfg.idleMs / 60_000) });
  await announce(client, settings, new EmbedBuilder().setColor(BRAND_COLOR)
    .setDescription(`### ${e('shiftend')} انتهى شفت تلقائياً\n<@${shift.userId}> — ما فيه نشاط من ${Math.round(cfg.idleMs / 60_000)} دقيقة\nالوقت المحسوب: **${worked}**`));
  // No DM to the member: the shift closing on its own is silent (it is still written to the staff log and the logs channel).
  return true;
}
