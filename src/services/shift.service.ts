import { Shift } from '../models/Shift.js';
import { Staff } from '../models/Staff.js';
import { changePoints } from './staff-points.js';
import { DismissedError, isDismissed } from '../discipline/dismissed.js';

export { DismissedError };

/** يسجّل الإداري أو يرجّع سجله. المفصول ما يرجع نشط تلقائياً: يرمي DismissedError لين أحد يلغي فصله. */
export async function ensureStaff(guildId: string, userId: string) {
  try {
    const existing = await Staff.findOne({ guildId, userId });
    if (existing) {
      if (!existing.active) {
        if (await isDismissed(guildId, userId)) throw new DismissedError();
        await Staff.update(existing.id, { active: true });
        existing.active = true;
      }
      return existing;
    }
    try {
      return await Staff.create({ guildId, userId, joinedAt: new Date(), active: true, points: 0, claimed: 0, closed: 0 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('staff_guild_id_user_id_key') && !message.includes('duplicate key')) throw error;
      const raced = await Staff.findOne({ guildId, userId });
      if (!raced) throw error;
      if (!raced.active) {
        if (await isDismissed(guildId, userId)) throw new DismissedError();
        await Staff.update(raced.id, { active: true });
        raced.active = true;
      }
      return raced;
    }
  } catch (error) {
    if (error instanceof DismissedError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`تعذر تسجيل الإداري تلقائيًا في قاعدة البيانات: ${message}`);
  }
}

export async function getActiveShift(guildId: string, userId: string) {
  return Shift.findOne({ guildId, userId, status: 'active' });
}

/** `startedAt` lets the automatic engine back-date a shift to the first message that triggered it. */
export async function startShift(guildId: string, userId: string, options: { startedAt?: Date } = {}) {
  const existing = await getActiveShift(guildId, userId);
  if (existing) throw new Error('عندك شفت نشط بالفعل.');
  try {
    return await Shift.create({ guildId, userId, startedAt: options.startedAt ?? new Date(), lastActivityAt: new Date(), checkSentAt: null, status: 'active', breaks: [], pointsAwarded: 0, interactionPointsAwarded: 0 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('shifts_active_per_user') || message.includes('duplicate key')) {
      throw new Error('لديك شفت نشط بالفعل. أنهِ الشفت الحالي قبل بدء شفت جديد.');
    }
    throw error;
  }
}

export async function startBreak(guildId: string, userId: string) {
  const shift = await getActiveShift(guildId, userId);
  if (!shift) throw new Error('ما عندك شفت نشط.');
  const current = shift.breaks.at(-1);
  if (current && !current.endedAt) throw new Error('أنت في بريك بالفعل.');
  shift.breaks.push({ startedAt: new Date(), endedAt: null } as never);
  shift.lastActivityAt = new Date();
  shift.checkSentAt = null;
  await shift.save();
  return shift;
}

export async function resumeShift(guildId: string, userId: string) {
  const shift = await getActiveShift(guildId, userId);
  if (!shift) throw new Error('ما عندك شفت نشط.');
  const current = shift.breaks.at(-1);
  if (!current || current.endedAt) throw new Error('أنت مو في بريك الحين.');
  current.endedAt = new Date();
  shift.lastActivityAt = new Date();
  shift.checkSentAt = null;
  await shift.save();
  return shift;
}

export function isOnBreak(shift: { breaks: Array<{ startedAt: Date; endedAt?: Date | null }> }) {
  const current = shift.breaks.at(-1);
  return Boolean(current && !current.endedAt);
}

/** `endedAt` lets the automatic engine close an idle shift at the member's last activity, so idle time is not counted. */
export async function endShift(guildId: string, userId: string, options: { endedAt?: Date } = {}) {
  const shift = await getActiveShift(guildId, userId);
  if (!shift) throw new Error('ما عندك شفت نشط.');
  const finishedAt = options.endedAt && options.endedAt > shift.startedAt && options.endedAt <= new Date() ? options.endedAt : new Date();
  const current = shift.breaks.at(-1);
  if (current && !current.endedAt) current.endedAt = finishedAt;
  shift.endedAt = finishedAt;
  shift.status = 'ended';
  shift.lastActivityAt = finishedAt;
  await awardShiftPoints(shift);
  await shift.save();
  return shift;
}

export async function awardShiftPoints(shift: { id: number; guildId: string; userId: string; pointsAwarded: number; startedAt: Date; endedAt: Date | null; breaks: Array<{ startedAt: Date; endedAt: Date | null }> }) {
  const earnedPoints = Math.floor(activeMs(shift) / (30 * 60 * 1000));
  const previousPoints = Number(shift.pointsAwarded || 0);
  const newPoints = Math.max(previousPoints, earnedPoints);
  const additionalPoints = newPoints - previousPoints;
  if (additionalPoints <= 0) return 0;
  await changePoints({ guildId: shift.guildId, userId: shift.userId, delta: additionalPoints, source: 'shift', ref: shift.id });
  shift.pointsAwarded = newPoints;
  return additionalPoints;
}

export async function awardInteractionPoints(shift: { id: number; guildId: string; userId: string; startedAt: Date; endedAt: Date | null; breaks: Array<{ startedAt: Date; endedAt: Date | null }>; interactionPointsAwarded: number; interactionMessageCount: number }) {
  const messageCount = Number(shift.interactionMessageCount || 0) + 1;
  const maximumInteractionPoints = Math.floor(messageCount / 100) * 3;
  const previousPoints = Number(shift.interactionPointsAwarded || 0);
  const additionalPoints = Math.max(0, maximumInteractionPoints - previousPoints);
  shift.interactionMessageCount = messageCount;
  if (!additionalPoints) {
    await Shift.update(shift.id, { interactionMessageCount: messageCount });
    return 0;
  }
  await changePoints({ guildId: shift.guildId, userId: shift.userId, delta: additionalPoints, source: 'messages', ref: shift.id });
  shift.interactionPointsAwarded = previousPoints + additionalPoints;
  await Shift.update(shift.id, { interactionMessageCount: messageCount, interactionPointsAwarded: shift.interactionPointsAwarded });
  return additionalPoints;
}

export async function awardVoiceInteractionPoints(shift: { id: number; guildId: string; userId: string; voiceMinutes: number; voicePointsAwarded: number }, addedMinutes: number) {
  const voiceMinutes = Number(shift.voiceMinutes || 0) + addedMinutes;
  const earnedPoints = Math.floor(voiceMinutes / 30);
  const previousPoints = Number(shift.voicePointsAwarded || 0);
  const additionalPoints = Math.max(0, earnedPoints - previousPoints);
  shift.voiceMinutes = voiceMinutes;
  shift.voicePointsAwarded = previousPoints + additionalPoints;
  if (additionalPoints) {
    await changePoints({ guildId: shift.guildId, userId: shift.userId, delta: additionalPoints, source: 'voice', ref: shift.id });
  }
  await Shift.update(shift.id, { voiceMinutes, voicePointsAwarded: shift.voicePointsAwarded });
  return additionalPoints;
}

export function breakMs(shift: { breaks: Array<{ startedAt: Date; endedAt?: Date | null }> }, now = new Date()) {
  return shift.breaks.reduce((sum, b) => sum + (new Date(b.endedAt ?? now).getTime() - new Date(b.startedAt).getTime()), 0);
}

export function activeMs(shift: { startedAt: Date; endedAt?: Date | null; breaks: Array<{ startedAt: Date; endedAt?: Date | null }> }) {
  const end = new Date(shift.endedAt ?? new Date()).getTime();
  return Math.max(0, end - new Date(shift.startedAt).getTime() - breakMs(shift, new Date(shift.endedAt ?? new Date())));
}

export function duration(ms: number) {
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days) return `${days} يوم ${hours} ساعة ${minutes} دقيقة`;
  return hours ? `${hours} ساعة ${minutes} دقيقة` : `${minutes} دقيقة`;
}
