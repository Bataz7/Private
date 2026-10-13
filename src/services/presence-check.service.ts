import { EmbedBuilder, type ButtonInteraction, type Client, type Guild, type GuildMember } from '../lib/djs/index.js';
import { Shift, type ShiftDoc } from '../models/Shift.js';
import type { GuildSettingsDoc } from '../models/GuildSettings.js';
import { supabase } from '../supabase/client.js';
import { createLog } from './log.service.js';
import { activeMs, duration, endShift, onShiftChange } from './shift.service.js';
import { isMissingColumn, tolerantUpdate, warnMigration } from '../discipline/db.js';
import { event } from '../utils/terminal.js';
import { V2_FLAG, button, container, row, rtl, text, ts } from '../utils/v2.js';

// تحقق التواجد في الفويس («هل انت موجود؟»):
//   - الإداري في شفت وقاعد في الفويس، وصار له `ساعة` من آخر تفاعل مؤكد (رسالة، تفاعل، تأكيد، دخول الفويس) → نرسل له
//     «هل انت موجود؟» بالخاص مع زر «موجود ✅» (ولو الخاص مقفل: في شات روم الفويس مع منشن).
//   - أي تفاعل خلال `30 دقيقة` يؤكد: الزر، رسالة في السيرفر أو رد بالخاص، أي تفاعل مع البوت، رياكشن على رسالة التحقق،
//     أو تغيير منه في الفويس (ميوت/ديفن/كاميرا/تنقّل).
//   - بدون رد: الشفت يوقف بصمت عند وقت إرسال السؤال (الانتظار ما ينحسب)، تنشال رتبة الشفت وتنحذف رسالة التحقق،
//     ويتسجّل في سجل الستاف وروم اللوق (للإدارة). ما يوصل للعضو أي رسالة إن شفته وقف.
//   - بعدها ما يبدأ له شفت تلقائي من الفويس لين يطلع من الفويس ويرجع (بالرسائل أو يدوي عادي).
// الفحص يصير داخل مراقب الشفتات (كل دقيقة) بنفس الاستعلام، بدون مؤقتات إضافية.

const MINUTE = 60_000;
const MAX_PENDING = 2_000;
const MAX_STOPPED = 5_000;
const STOP_MEMORY_MS = 24 * 60 * MINUTE;
export const PRESENCE_BUTTON = 'presence:confirm';
export const PRESENCE_QUESTION = 'هل انت موجود؟';

export interface PresenceConfig { enabled: boolean; afterMs: number; timeoutMs: number }
const clamp = (value: unknown, min: number, max: number, fallback: number) => { const n = Number(value); return value !== null && value !== undefined && value !== '' && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback; };

export function presenceConfig(settings: Partial<GuildSettingsDoc> | null | undefined): PresenceConfig {
  return {
    enabled: settings?.presenceCheckEnabled !== false,
    afterMs: clamp(settings?.presenceCheckMinutes, 5, 720, 60) * MINUTE,
    timeoutMs: clamp(settings?.presenceCheckTimeoutMinutes, 2, 240, 30) * MINUTE,
  };
}

export type PresenceStep = 'none' | 'send' | 'wait' | 'timeout';
export type PresenceInput = { now: number; startedAt: number; lastActivityAt?: number | null; voiceJoinedAt?: number | null; checkSentAt?: number | null; inVoice: boolean; onBreak: boolean };

/**
 * وش نسوي بهذا الشفت الحين (بدون أي I/O، عشان الاختبارات):
 *   timeout → فيه سؤال من `timeout` أو أكثر بدون رد · wait → سؤال ينتظر رد · send → صار له `after` بالفويس بدون تفاعل.
 */
export function presenceStep(input: PresenceInput, cfg: PresenceConfig): PresenceStep {
  if (input.checkSentAt) return input.now - input.checkSentAt >= cfg.timeoutMs ? 'timeout' : 'wait';
  if (!cfg.enabled || !input.inVoice || input.onBreak) return 'none';
  const base = Math.max(input.lastActivityAt ?? 0, input.voiceJoinedAt ?? 0, input.startedAt);
  return input.now - base >= cfg.afterMs ? 'send' : 'none';
}

type Pending = { guildId: string; userId: string; shiftId: number; channelId: string | null; messageId: string | null; sentAt: number };
const pending = new Map<string, Pending>();
const stopped = new Map<string, number>();
const key = (guildId: string, userId: string) => `${guildId}:${userId}`;
let boundClient: Client | null = null;

// الشفت انتهى من أي مكان (يدوي، داشبورد، 12 ساعة): نشيل السؤال المعلّق ورسالته بصمت.
onShiftChange((guildId, userId, kind) => {
  if (kind !== 'end') return;
  const entry = pending.get(key(guildId, userId));
  if (!entry) return;
  pending.delete(key(guildId, userId));
  if (boundClient) void deleteMessage(boundClient, entry.channelId, entry.messageId);
});

function cap<K, V>(map: Map<K, V>, max: number) {
  while (map.size > max) { const first = map.keys().next(); if (first.done) break; map.delete(first.value); }
}

export const hasPendingCheck = (guildId: string, userId: string) => pending.has(key(guildId, userId));
export const pendingCount = () => pending.size;

// ---- «ما يرجع شفت من الفويس» بعد الإيقاف ----------------------------------------------------------
export function isPresenceStopped(guildId: string, userId: string, now = Date.now()) {
  const at = stopped.get(key(guildId, userId));
  if (at === undefined) return false;
  if (now - at > STOP_MEMORY_MS) { stopped.delete(key(guildId, userId)); return false; }
  return true;
}
export function clearPresenceStop(guildId: string, userId: string) { stopped.delete(key(guildId, userId)); }
function markStopped(guildId: string, userId: string, at = Date.now()) {
  stopped.delete(key(guildId, userId));
  stopped.set(key(guildId, userId), at);
  cap(stopped, MAX_STOPPED);
}

/** بعد إعادة التشغيل: اللي وقف شفتهم خلال آخر 12 ساعة ما يرجع لهم شفت من الفويس لين يطلعون ويرجعون. */
export async function loadRecentPresenceStops(now = Date.now()) {
  const { data, error } = await supabase.from('staff_logs').select('guild_id,user_id,created_at').eq('action', 'SHIFT_PRESENCE_TIMEOUT')
    .gte('created_at', new Date(now - 12 * 60 * MINUTE).toISOString()).order('created_at', { ascending: true }).limit(MAX_STOPPED);
  if (error) return 0;
  for (const row of data ?? []) markStopped(String(row.guild_id), String(row.user_id), Date.parse(String(row.created_at)) || now);
  return data?.length ?? 0;
}

// ---- الرسالة ---------------------------------------------------------------------------------------
/** رسالة «هل انت موجود؟»: حاوية CV2 صغيرة، السؤال، سطر توضيح، المهلة كوقت نسبي، وزر «موجود». */
export function presenceMessage(guildId: string, shiftId: number, deadline: number, mention?: string) {
  const card = container([
    text(rtl(`### ${mention ? `${mention} ` : ''}${PRESENCE_QUESTION}`)),
    text(rtl(`اضغط الزر عشان يستمر شفتك\n-# قبل ${ts(deadline, 'R')}`)),
    row([button({ id: `${PRESENCE_BUTTON}:${guildId}:${shiftId}`, label: 'موجود', emoji: '✅', style: 'success' })]),
  ], 0x5865f2);
  return { flags: V2_FLAG, components: [card] };
}

/** متى يجي «هل انت موجود؟» القادم (أو مهلته لو انرسل). null = ما فيه تحقق (مو في الفويس، بريك، أو مقفل). */
export function nextPresenceAt(input: Omit<PresenceInput, 'now'>, cfg: PresenceConfig): { kind: 'check' | 'deadline'; at: number } | null {
  if (input.checkSentAt) return { kind: 'deadline', at: input.checkSentAt + cfg.timeoutMs };
  if (!cfg.enabled || !input.inVoice || input.onBreak) return null;
  return { kind: 'check', at: Math.max(input.lastActivityAt ?? 0, input.voiceJoinedAt ?? 0, input.startedAt) + cfg.afterMs };
}

// متى صار فويس كل عضو «فعّال» (يحطه index.ts)، عشان /الشفت حالة يعرف موعد التحقق القادم.
const voiceJoined = new Map<string, number>();
export function setVoiceJoined(guildId: string, userId: string, at: number | null) {
  if (at === null) voiceJoined.delete(key(guildId, userId)); else { voiceJoined.set(key(guildId, userId), at); cap(voiceJoined, MAX_PENDING); }
}
export const voiceJoinedAt = (guildId: string, userId: string) => voiceJoined.get(key(guildId, userId)) ?? null;

async function deleteMessage(client: Client, channelId: string | null, messageId: string | null) {
  if (!channelId || !messageId) return;
  await client.rest.delete(`/channels/${channelId}/messages/${messageId}`).catch(() => undefined);
}

async function savePresence(shiftId: number, data: { checkSentAt: Date | null; lastActivityAt?: Date; channelId: string | null; messageId: string | null }) {
  const body: Record<string, unknown> = { check_sent_at: data.checkSentAt ? data.checkSentAt.toISOString() : null, presence_channel_id: data.channelId, presence_message_id: data.messageId };
  if (data.lastActivityAt) body.last_activity_at = data.lastActivityAt.toISOString();
  await tolerantUpdate('shifts', { id: shiftId }, body, ['presence_channel_id', 'presence_message_id']).catch(error => console.error('Presence check save failed:', error instanceof Error ? error.message : error));
}

/** يرسل «هل انت موجود؟» (خاص، وإلا شات روم الفويس) ويسجّل وقت الإرسال. */
export async function sendPresenceCheck(client: Client, guild: Guild, member: GuildMember, shift: ShiftDoc, now = Date.now(), settingsFor?: Partial<GuildSettingsDoc> | null) {
  const id = key(guild.id, member.id);
  if (pending.has(id)) return false;
  boundClient = client;
  const deadline = now + presenceConfig(settingsFor ?? null).timeoutMs;
  let message = await member.send(presenceMessage(guild.id, shift.id, deadline) as never).catch(() => null);
  if (!message && member.voice.channelId) {
    const channel = guild.channels.cache.get(member.voice.channelId);
    if (channel?.isTextBased()) message = await channel.send({ ...presenceMessage(guild.id, shift.id, deadline, `<@${member.id}>`), allowedMentions: { users: [member.id] } } as never).catch(() => null);
  }
  const sentAt = new Date(now);
  const entry: Pending = { guildId: guild.id, userId: member.id, shiftId: shift.id, channelId: message?.channelId ?? null, messageId: message?.id ?? null, sentAt: now };
  pending.set(id, entry);
  cap(pending, MAX_PENDING);
  shift.checkSentAt = sentAt;
  await savePresence(shift.id, { checkSentAt: sentAt, channelId: entry.channelId, messageId: entry.messageId });
  event('voice', `${member.displayName}: انرسل «هل انت موجود؟»${message ? '' : ' (ما وصل لا خاص ولا شات الفويس)'}`);
  return true;
}

/**
 * يرجّع حالة التحقق للذاكرة من قاعدة البيانات (بعد إعادة تشغيل)، ويقفل التحقق اللي انمسح من مكان ثاني.
 * يُستدعى من مراقب الشفتات لكل شفت نشط.
 */
export async function syncPendingCheck(client: Client, shift: ShiftDoc) {
  const id = key(shift.guildId, shift.userId);
  const entry = pending.get(id);
  if (!shift.checkSentAt) {
    // انمسح في القاعدة (رسالة أو بريك) والرسالة باقية: نشيلها.
    if (entry) { pending.delete(id); await deleteMessage(client, entry.channelId, entry.messageId); }
    return;
  }
  if (entry && entry.shiftId === shift.id) return;
  let channelId: string | null = null;
  let messageId: string | null = null;
  const { data, error } = await supabase.from('shifts').select('presence_channel_id,presence_message_id').eq('id', shift.id).maybeSingle();
  if (!error) { channelId = (data?.presence_channel_id as string) || null; messageId = (data?.presence_message_id as string) || null; }
  else if (isMissingColumn(error)) warnMigration('shifts.presence_message_id');
  pending.set(id, { guildId: shift.guildId, userId: shift.userId, shiftId: shift.id, channelId, messageId, sentAt: shift.checkSentAt.getTime() });
  cap(pending, MAX_PENDING);
}

/** العضو تفاعل: يلغي التحقق المعلّق (لو فيه) ويحسب آخر تفاعل الحين. يرجّع true لو كان فيه تحقق. */
export async function confirmPresence(client: Client, guildId: string, userId: string, now = Date.now(), { keepMessage = false } = {}) {
  const id = key(guildId, userId);
  const entry = pending.get(id);
  if (!entry) return false;
  pending.delete(id);
  await savePresence(entry.shiftId, { checkSentAt: null, lastActivityAt: new Date(now), channelId: null, messageId: null });
  if (!keepMessage) await deleteMessage(client, entry.channelId, entry.messageId);
  event('voice', `${userId}: أكّد تواجده`);
  return true;
}

/** رد بالخاص (ما نعرف السيرفر): يأكد كل تحقق معلّق لهذا العضو. */
export async function confirmPresenceAnywhere(client: Client, userId: string, now = Date.now()) {
  let any = false;
  for (const entry of [...pending.values()]) if (entry.userId === userId) any = (await confirmPresence(client, entry.guildId, userId, now)) || any;
  return any;
}

/** رياكشن على رسالة التحقق (من حدث MESSAGE_REACTION_ADD الخام). */
export async function onPresenceReaction(client: Client, data: { user_id?: string; message_id?: string }) {
  if (!pending.size || !data?.message_id || !data.user_id) return false;
  for (const entry of pending.values()) {
    if (entry.messageId === data.message_id && entry.userId === data.user_id) return confirmPresence(client, entry.guildId, entry.userId);
  }
  return false;
}

/** زر «موجود ✅». بس صاحب الشفت يقدر يضغطه. */
export async function handlePresenceButton(i: ButtonInteraction) {
  if (!i.customId.startsWith(`${PRESENCE_BUTTON}:`)) return false;
  const [, , guildId, rawShiftId] = i.customId.split(':');
  const shiftId = Number(rawShiftId);
  if (!guildId || !Number.isFinite(shiftId)) { await i.reply({ content: 'هذا الزر قديم.', flags: 64 }); return true; }
  const shift = await Shift.findOne({ id: shiftId }).catch(() => null);
  if (shift && shift.userId !== i.user.id) { await i.reply({ content: 'هذا الزر مو لك.', flags: 64 }); return true; }
  // الشفت انتهى (توقف بصمت أو أنهاه): ما نقول شي، بس نشيل الرسالة.
  if (!shift || shift.status !== 'active') {
    await i.deferUpdate().catch(() => undefined);
    if (i.message?.id) await deleteMessage(i.client, i.channelId, i.message.id);
    return true;
  }
  const confirmed = await confirmPresence(i.client, guildId, i.user.id, Date.now(), { keepMessage: true });
  // بعد إعادة التشغيل (قبل ما يرجع التحقق للذاكرة) نأكد من القاعدة مباشرة.
  if (!confirmed && shift.checkSentAt) await savePresence(shift.id, { checkSentAt: null, lastActivityAt: new Date(), channelId: null, messageId: null });
  await i.update({ flags: V2_FLAG, components: [container([text(rtl('✅ تمام، شفتك مستمر. شكراً!'))], 0x4fc08d)] } as never).catch(() => undefined);
  // في شات روم الفويس نشيل الرسالة بعد شوي عشان ما تزحم الشات.
  if (i.guildId && i.message?.id) {
    const channelId = i.channelId;
    const messageId = i.message.id;
    setTimeout(() => { void deleteMessage(i.client, channelId, messageId); }, 15_000);
  }
  return true;
}

/**
 * ما رد خلال المهلة: يوقف الشفت بصمت عند وقت السؤال. ما يوصل للعضو شي.
 * يرجّع true لو انتهى الشفت.
 */
export async function stopForPresence(client: Client, _guild: Guild | null, shift: ShiftDoc, settings: GuildSettingsDoc, member: GuildMember | null) {
  const id = key(shift.guildId, shift.userId);
  const entry = pending.get(id);
  // تأكد بين قراءة الشفت والحين.
  if (!entry || !shift.checkSentAt) return false;
  const sentAt = shift.checkSentAt;
  const ended = await endShift(shift.guildId, shift.userId, { endedAt: sentAt }).catch(() => null);
  if (!ended) return false;
  pending.delete(id);
  await deleteMessage(client, entry.channelId, entry.messageId);
  await tolerantUpdate('shifts', { id: shift.id }, { check_sent_at: null, presence_channel_id: null, presence_message_id: null }, ['presence_channel_id', 'presence_message_id']).catch(() => undefined);
  markStopped(shift.guildId, shift.userId);
  if (member && settings.onShiftRoleId) await member.roles.remove(settings.onShiftRoleId, 'ما رد على تحقق التواجد').catch(() => undefined);
  const cfg = presenceConfig(settings);
  const worked = duration(activeMs(ended));
  await createLog(shift.guildId, 'SHIFT_PRESENCE_TIMEOUT', shift.userId, null, {
    shiftId: String(ended._id), duration: worked, checkSentAt: sentAt.toISOString(), timeoutMinutes: Math.round(cfg.timeoutMs / MINUTE), afterMinutes: Math.round(cfg.afterMs / MINUTE),
  }).catch(() => undefined);
  // للإدارة فقط (روم اللوق)، مو للعضو.
  const channel = settings.logsChannelId ? await client.channels.fetch(settings.logsChannelId).catch(() => null) : null;
  if (channel?.isTextBased()) {
    await channel.send({ allowedMentions: { parse: [] }, embeds: [new EmbedBuilder().setColor(0xf0ad4e)
      .setDescription(`⏱️ **شفت تلقائي توقف** · <@${shift.userId}>\n-# ما رد على «${PRESENCE_QUESTION}» خلال ${Math.round(cfg.timeoutMs / MINUTE)} دقيقة · انحسب لين ${ts(sentAt, 't')} · المحسوب **${worked}**`)] }).catch(() => undefined);
  }
  event('shiftEnd', `${member?.displayName ?? shift.userId} وقف شفته: ما رد على تحقق التواجد، المحسوب ${worked}`);
  return true;
}

/** الشفت انتهى من مكان ثاني (فصل، إنهاء يدوي): يشيل التحقق ورسالته بدون ما يلمس الشفت. */
export async function dropPresenceCheck(client: Client, guildId: string, userId: string) {
  const entry = pending.get(key(guildId, userId));
  if (!entry) return;
  pending.delete(key(guildId, userId));
  await deleteMessage(client, entry.channelId, entry.messageId);
}

/** للاختبارات. */
export function _resetPresenceState() { pending.clear(); stopped.clear(); voiceJoined.clear(); }
