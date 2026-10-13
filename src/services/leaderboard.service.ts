import { Message, type Client, type Guild } from '../lib/djs/index.js';
import { supabase } from '../supabase/client.js';
import { BRAND_COLOR, e } from '../utils/emoji.js';
import { V2_FLAG, container, rtl, separator, text } from '../utils/v2.js';
import { isMissingColumn, isMissingFunction, MIGRATION_036, warnMigration } from '../discipline/db.js';
import { isMissing } from '../core/db.js';

// لوحة المتصدرين الأسبوعية: رسالة Components V2 وحدة في الروم المحدد، تتعدّل كل 10 دقايق، فيها أفضل 10 بنقاط هذا الأسبوع
// (مجموع points_ledger.delta من بداية الأسبوع). الأسبوع يبدأ السبت 00:00 بتوقيت السعودية (UTC+3، بدون Intl).
// لما يخلص الأسبوع: رسالة «أبطال الأسبوع» (أفضل 3) جديدة، والرسالة الحية تبدأ من جديد.

const DAY = 86_400_000;
const KSA_OFFSET = 3 * 3_600_000;
export const LEADERBOARD_REFRESH_MS = 10 * 60_000;

/** بداية الأسبوع (السبت 00:00 بتوقيت السعودية) كوقت UTC. */
export function weekStartOf(now = Date.now()): Date {
  const local = now + KSA_OFFSET;
  const dayStart = Math.floor(local / DAY) * DAY;
  const sinceSaturday = (new Date(dayStart).getUTCDay() + 1) % 7; // السبت = 6 → 0
  return new Date(dayStart - sinceSaturday * DAY - KSA_OFFSET);
}
export const nextWeekStartOf = (now = Date.now()) => new Date(weekStartOf(now).getTime() + 7 * DAY);

let rpcMissing = false;

/** مجموع النقاط لكل عضو في الفترة. دالة weekly_points لو موجودة، وإلا صفحات من السجل (user_id,delta بس). */
export async function periodPoints(guildId: string, since: Date, until?: Date | null): Promise<Map<string, number>> {
  const sums = new Map<string, number>();
  if (!rpcMissing) {
    const { data, error } = await supabase.rpc('weekly_points', { p_guild: guildId, p_since: since.toISOString(), p_until: until ? until.toISOString() : null });
    if (!error && Array.isArray(data)) {
      for (const row of data as Array<{ user_id: string; points: number | string }>) sums.set(String(row.user_id), Number(row.points) || 0);
      return sums;
    }
    if (error && !isMissingFunction(error)) throw new Error(`weekly_points: ${error.message}`);
    rpcMissing = true;
    warnMigration('weekly_points()');
  }
  for (let from = 0; from < 200_000; from += 1000) {
    let query = supabase.from('points_ledger').select('user_id,delta').eq('guild_id', guildId).gte('created_at', since.toISOString());
    if (until) query = query.lt('created_at', until.toISOString());
    const { data, error } = await query.order('id').range(from, from + 999);
    if (error) { if (isMissing(error)) return sums; throw new Error(error.message); }
    for (const row of data ?? []) { const id = String(row.user_id); sums.set(id, (sums.get(id) ?? 0) + (Number(row.delta) || 0)); }
    if ((data?.length ?? 0) < 1000) break;
  }
  return sums;
}

/** نقاط عضو واحد هذا الأسبوع (لبطاقة الستاف). */
export async function weekPointsOf(guildId: string, userId: string, now = Date.now()) {
  let total = 0;
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await supabase.from('points_ledger').select('delta').eq('guild_id', guildId).eq('user_id', userId).gte('created_at', weekStartOf(now).toISOString()).order('id').range(from, from + 999);
    if (error) return 0;
    for (const row of data ?? []) total += Number(row.delta) || 0;
    if ((data?.length ?? 0) < 1000) break;
  }
  return total;
}

type ShiftRow = { user_id: string; started_at: string; ended_at: string | null; breaks: Array<{ startedAt?: string; started_at?: string; endedAt?: string | null; ended_at?: string | null }> | null };
/** وقت الشفت داخل [from, to] بدون البريكات. */
export function activeMsWithin(shift: { startedAt: number; endedAt: number | null; breaks: Array<{ startedAt: number; endedAt: number | null }> }, from: number, to: number) {
  const start = Math.max(shift.startedAt, from);
  const end = Math.min(shift.endedAt ?? to, to);
  if (end <= start) return 0;
  let ms = end - start;
  for (const b of shift.breaks) {
    const bs = Math.max(b.startedAt, start);
    const be = Math.min(b.endedAt ?? end, end);
    if (be > bs) ms -= be - bs;
  }
  return Math.max(0, ms);
}

export type WeeklyEntry = { userId: string; points: number; hours: number };

/** الترتيب للفترة: الستاف النشطين فقط، الأعلى أول. `all` = كل الترتيب (للمكان الشخصي). */
export async function weeklyTop(guildId: string, opts: { since: Date; until?: Date | null; limit?: number; hours?: boolean }) {
  const sums = await periodPoints(guildId, opts.since, opts.until);
  const candidates = [...sums].filter(([, points]) => points > 0);
  const active = new Set<string>();
  for (let i = 0; i < candidates.length; i += 200) {
    const { data } = await supabase.from('staff').select('user_id').eq('guild_id', guildId).eq('active', true).in('user_id', candidates.slice(i, i + 200).map(([id]) => id));
    for (const row of data ?? []) active.add(String(row.user_id));
  }
  const all = candidates.filter(([id]) => active.has(id)).sort((a, b) => b[1] - a[1]);
  const top: WeeklyEntry[] = all.slice(0, opts.limit ?? 10).map(([userId, points]) => ({ userId, points, hours: 0 }));
  if (opts.hours !== false && top.length) {
    const to = opts.until?.getTime() ?? Date.now();
    const from = opts.since.getTime();
    const { data } = await supabase.from('shifts').select('user_id,started_at,ended_at,breaks').eq('guild_id', guildId).in('user_id', top.map(row => row.userId))
      .lt('started_at', new Date(to).toISOString()).or(`ended_at.is.null,ended_at.gte.${opts.since.toISOString()}`).limit(2000);
    const byUser = new Map(top.map(row => [row.userId, row]));
    const at = (value: unknown) => (value ? Date.parse(String(value)) : NaN);
    for (const row of (data ?? []) as ShiftRow[]) {
      const entry = byUser.get(String(row.user_id));
      if (!entry) continue;
      const breaks = (row.breaks ?? []).map(b => ({ startedAt: at(b.startedAt ?? b.started_at), endedAt: Number.isFinite(at(b.endedAt ?? b.ended_at)) ? at(b.endedAt ?? b.ended_at) : null })).filter(b => Number.isFinite(b.startedAt));
      entry.hours += activeMsWithin({ startedAt: at(row.started_at), endedAt: row.ended_at ? at(row.ended_at) : null, breaks }, from, to) / 3_600_000;
    }
  }
  return { top, all };
}

const fmt = (v: number) => Math.round(v).toLocaleString('en-US');
const hrs = (v: number) => (Math.round(v * 10) / 10).toLocaleString('en-US');
const unix = (d: Date | number) => Math.floor(new Date(d).getTime() / 1000);
const medal = (index: number) => [e('first'), e('second'), e('third')][index] || `**${index + 1}.**`;

function rows(top: WeeklyEntry[]) {
  return top.map((row, index) => `${medal(index)} <@${row.userId}> · **${fmt(row.points)}** نقطة${row.hours >= 0.1 ? ` · ${hrs(row.hours)} ساعة شفت` : ''}`).join('\n');
}

/** الرسالة الحية (أو مخفية لأمر العرض). */
export function liveBoardPayload(top: WeeklyEntry[], weekStart: Date, now = Date.now(), options: { ephemeral?: boolean; mine?: { rank: number; points: number } | null } = {}) {
  const parts = [
    text(rtl(`## ${e('trophy')} متصدرين الأسبوع\n-# من السبت <t:${unix(weekStart)}:D> · الأسبوع الجاي يبدأ <t:${unix(weekStart.getTime() + 7 * DAY)}:R>`)),
    separator(),
    text(rtl(top.length ? rows(top) : `${e('hourglass')} ما أحد جمع نقاط هذا الأسبوع بعد. أول نقطة تحطك بالقائمة!`)),
  ];
  if (options.mine) parts.push(separator(false), text(rtl(`${e('user')} ترتيبك: **#${options.mine.rank}** بـ **${fmt(options.mine.points)}** نقطة`)));
  parts.push(separator(false), text(rtl(`-# ${e('clock')} آخر تحديث <t:${unix(now)}:R>${options.ephemeral ? '' : ' · يتحدث كل 10 دقايق'}`)));
  return { flags: V2_FLAG | (options.ephemeral ? 64 : 0), components: [container(parts, BRAND_COLOR)], allowedMentions: { parse: [] } };
}

/** «أبطال الأسبوع»: أفضل 3 للأسبوع اللي خلص. */
export function championsPayload(top: WeeklyEntry[], weekStart: Date, weekEnd: Date) {
  const lines = top.slice(0, 3).map((row, index) => `${medal(index)} <@${row.userId}> — **${fmt(row.points)}** نقطة${row.hours >= 0.1 ? ` · ${hrs(row.hours)} ساعة` : ''}`);
  return {
    flags: V2_FLAG,
    allowedMentions: { parse: [] },
    components: [container([
      text(rtl(`## ${e('crown')} أبطال الأسبوع\n-# <t:${unix(weekStart)}:D> ← <t:${unix(weekEnd.getTime() - 1000)}:D>`)),
      separator(),
      text(rtl(lines.length ? `${lines.join('\n')}\n\n${e('party')} مبروك للأبطال، وشكراً لكل الفريق على تعبهم!` : 'ما فيه نقاط انجمعت هذا الأسبوع.')),
    ], 0xf5c542)],
  };
}

type BoardRow = { guild_id: string; leaderboard_channel_id: string | null; leaderboard_message_id: string | null; leaderboard_week: string | null };

async function editOrSend(client: Client, channelId: string, messageId: string | null, payload: any): Promise<string | null> {
  if (messageId) {
    try {
      await new Message(client, { id: messageId, channel_id: channelId }).edit(payload);
      return messageId;
    } catch (error) {
      if ((error as { status?: number }).status !== 404) return messageId; // خطأ مؤقت: نحاول المرة الجاية بدون رسالة مكررة.
    }
  }
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return null;
  const sent = await channel.send(payload).catch(() => null);
  return sent?.id ?? null;
}

/** يحدّث لوحة سيرفر وحدة، وينشر «أبطال الأسبوع» لما يتغير الأسبوع. */
export async function updateGuildBoard(client: Client, row: BoardRow, now = Date.now()) {
  const channelId = row.leaderboard_channel_id;
  if (!channelId) return;
  const week = weekStartOf(now);
  const weekKey = week.toISOString();
  let messageId = row.leaderboard_message_id;
  if (row.leaderboard_week && row.leaderboard_week !== weekKey) {
    // نحجز التبديل (لو فيه نسختين من البوت ما ينشر مرتين).
    const { data: claimed } = await supabase.from('guild_settings').update({ leaderboard_week: weekKey, leaderboard_message_id: null })
      .eq('guild_id', row.guild_id).eq('leaderboard_week', row.leaderboard_week).select('guild_id');
    if (!claimed?.length) return;
    const previous = new Date(row.leaderboard_week);
    if (Number.isFinite(previous.getTime()) && previous < week) {
      const { top } = await weeklyTop(row.guild_id, { since: previous, until: week, limit: 3 });
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (channel?.isTextBased()) await channel.send(championsPayload(top, previous, week)).catch(() => undefined);
    }
    if (messageId) await client.rest.delete(`/channels/${channelId}/messages/${messageId}`).catch(() => undefined);
    messageId = null;
  }
  const { top } = await weeklyTop(row.guild_id, { since: week, limit: 10 });
  const id = await editOrSend(client, channelId, messageId, liveBoardPayload(top, week, now));
  if (id !== row.leaderboard_message_id || row.leaderboard_week !== weekKey) {
    await supabase.from('guild_settings').update({ leaderboard_message_id: id, leaderboard_week: weekKey }).eq('guild_id', row.guild_id);
  }
}

/** كل السيرفرات اللي لها روم لوحة. استعلام واحد. */
export async function runLeaderboards(client: Client, now = Date.now()) {
  const { data, error } = await supabase.from('guild_settings').select('guild_id,leaderboard_channel_id,leaderboard_message_id,leaderboard_week').not('leaderboard_channel_id', 'is', null);
  if (error) { if (isMissingColumn(error)) warnMigration('guild_settings.leaderboard_channel_id'); else console.error('Leaderboard settings read failed:', error.message); return; }
  for (const row of (data ?? []) as BoardRow[]) {
    if (!client.guilds.cache.has(String(row.guild_id))) continue;
    await updateGuildBoard(client, row, now).catch(error => console.error(`Leaderboard ${row.guild_id} failed:`, error instanceof Error ? error.message : error));
  }
}

/** يحدد روم اللوحة (null = يوقفها) ويرسل الرسالة الحية على طول. */
export async function setLeaderboardChannel(guild: Guild, channelId: string | null) {
  const { data: current, error: readError } = await supabase.from('guild_settings').select('leaderboard_channel_id,leaderboard_message_id').eq('guild_id', guild.id).maybeSingle();
  if (readError) {
    if (isMissingColumn(readError)) throw new Error(`لوحة المتصدرين تحتاج تحديث قاعدة البيانات: الأدمن يشغّل ملف ${MIGRATION_036} في Supabase.`);
    throw new Error(readError.message);
  }
  if (!current) throw new Error('Rift ما انضبط في هذا السيرفر بعد.');
  if (current.leaderboard_message_id && current.leaderboard_channel_id) await guild.client.rest.delete(`/channels/${current.leaderboard_channel_id}/messages/${current.leaderboard_message_id}`).catch(() => undefined);
  const weekKey = weekStartOf().toISOString();
  const { error } = await supabase.from('guild_settings').update({ leaderboard_channel_id: channelId, leaderboard_message_id: null, leaderboard_week: channelId ? weekKey : null }).eq('guild_id', guild.id);
  if (error) throw new Error(error.message);
  if (channelId) await updateGuildBoard(guild.client, { guild_id: guild.id, leaderboard_channel_id: channelId, leaderboard_message_id: null, leaderboard_week: weekKey });
}
