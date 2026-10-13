import type { Client } from '../lib/djs/index.js';
import { supabase } from '../supabase/client.js';
import { PointsLedger } from '../models/PointsLedger.js';
import { createLog } from '../services/log.service.js';
import { assertAdministrator } from '../utils/permissions.js';
import { fetchAll, isMissing, logDbIssue, MIGRATION_HINT, warnOnce } from './db.js';

// One place that describes how points work, so the dashboard, /help and the breakdown never disagree.
// The numbers mirror the code that awards them: shift.service (shifts, messages, voice), core/assistance (helps),
// core/ratings (ratings), complaint reviews and mod reports.
export const RATING_POINTS: Record<number, number> = { 5: 3, 4: 2, 3: 1, 2: 0, 1: 0 };
export const ratingPoints = (rating: number) => RATING_POINTS[rating] ?? 0;

export type PointSource = 'shift' | 'messages' | 'voice' | 'assist' | 'rating' | 'modreport' | 'complaint' | 'manual' | (string & {});
export type PointRule = { key: string; points: string; en: string; ar: string };

const RULES: PointRule[] = [
  { key: 'shift', points: '+1', en: 'every 30 minutes on shift (breaks do not count)', ar: 'كل 30 دقيقة في الشفت (البريك ما ينحسب)' },
  { key: 'messages', points: '+3', en: 'every 100 messages you send while on shift', ar: 'كل 100 رسالة ترسلها وأنت في الشفت' },
  { key: 'voice', points: '+1', en: 'every 30 minutes in voice while on shift', ar: 'كل 30 دقيقة فويس وأنت في الشفت' },
  { key: 'assist', points: '+1', en: 'every time you log that you helped a member (/assist)', ar: 'كل مرة تسجّل إنك ساعدت عضو (/ساعدت_عضو)' },
  { key: 'rating', points: '+1 to +3', en: 'a rating from a member: 5★ = +3, 4★ = +2, 3★ = +1', ar: 'تقييم من عضو: 5★ = +3، 4★ = +2، 3★ = +1' },
  { key: 'modreport', points: '±', en: 'a mod report that management approves or rejects (set in the mod report settings)', ar: 'تقرير مود توافق عليه الإدارة أو ترفضه (حسب إعدادات تقارير المود)' },
  { key: 'complaint', points: '−', en: 'an approved complaint against you (management chooses how many)', ar: 'شكوى عليك تنقبل (الإدارة تحدد كم نقطة)' },
  { key: 'manual', points: '±', en: 'manual changes by administrators, always with a reason', ar: 'تعديل يدوي من الإدارة، ودايم معه سبب' },
];
const extraRules: PointRule[] = [];
/** Lets another feature add its own line to the points table (dashboard and /help). */
export function registerPointRule(rule: PointRule) { if (!extraRules.some(item => item.key === rule.key)) extraRules.push(rule); }
export async function pointRules(_guildId?: string): Promise<PointRule[]> { return [...RULES, ...extraRules]; }

// ---- The single write path ------------------------------------------------------------------------

export type ChangePointsInput = {
  guildId: string; userId: string; delta: number; source: PointSource;
  reason?: string; actorId?: string | null; ref?: string | number | null;
  /** Also raise the "people helped" counter by this much in the same atomic update (used by /assist). */
  claimed?: number;
};
export type ChangePointsResult = { before: number; after: number };

/**
 * The one way to change a staff member's points: a single atomic update that never goes below zero and writes a ledger
 * row, so two changes at the same moment cannot lose or double points. Returns null when the member is not on staff.
 * Before migration 030 is applied it falls back to a compare-and-swap update without the ledger, and says so once.
 */
export async function changePoints(input: ChangePointsInput): Promise<ChangePointsResult | null> {
  const delta = Math.trunc(Number(input.delta) || 0);
  const claimed = Math.trunc(Number(input.claimed) || 0);
  if (!delta && !claimed) {
    const { data } = await supabase.from('staff').select('points').eq('guild_id', input.guildId).eq('user_id', input.userId).maybeSingle();
    return data ? { before: Number(data.points) || 0, after: Number(data.points) || 0 } : null;
  }
  const { data, error } = await supabase.rpc('change_staff_points', {
    p_guild: input.guildId, p_user: input.userId, p_delta: delta, p_source: input.source, p_reason: String(input.reason || '').slice(0, 300),
    p_actor: input.actorId ?? null, p_ref: input.ref === undefined || input.ref === null ? null : String(input.ref), p_claimed: claimed,
  });
  if (!error) {
    const row = data as { before?: number; after?: number } | null;
    return row && row.before !== undefined ? { before: Number(row.before) || 0, after: Number(row.after) || 0 } : null;
  }
  if (!isMissing(error)) throw new Error(`ما قدرنا نحدّث النقاط: ${error.message}`);
  warnOnce('points-rpc', `change_staff_points() is missing, so points are changed without the ledger. ${MIGRATION_HINT}`);
  return legacyChange({ ...input, delta, claimed });
}

async function legacyChange(input: ChangePointsInput & { delta: number; claimed: number }): Promise<ChangePointsResult | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: row, error } = await supabase.from('staff').select('id, points, claimed').eq('guild_id', input.guildId).eq('user_id', input.userId).maybeSingle();
    if (error) throw new Error(`ما قدرنا نحدّث النقاط: ${error.message}`);
    if (!row) return null;
    const before = Number(row.points) || 0;
    const after = Math.max(0, before + input.delta);
    // Only applies if the points are still the ones we read, so a concurrent change is retried instead of lost.
    const { data: updated, error: updateError } = await supabase.from('staff')
      .update({ points: after, claimed: Math.max(0, (Number(row.claimed) || 0) + input.claimed) })
      .eq('id', row.id).eq('points', before).select('id');
    if (updateError) throw new Error(`ما قدرنا نحدّث النقاط: ${updateError.message}`);
    if (!updated?.length) continue;
    if (after !== before) {
      await PointsLedger.create({ guildId: input.guildId, userId: input.userId, delta: after - before, pointsBefore: before, pointsAfter: after, source: input.source, reason: String(input.reason || '').slice(0, 300), actorId: input.actorId ?? null, ref: input.ref === undefined || input.ref === null ? null : String(input.ref) })
        .catch(error => logDbIssue(error, 'The points ledger'));
    }
    return { before, after };
  }
  throw new Error('النقاط تغيّرت بنفس اللحظة أكثر من مرة. جرّب مرة ثانية.');
}

/** A change made by an administrator (dashboard or command): checks the administrator again, applies it, and logs it. */
export async function adjustStaffPoints(client: Client, input: { guildId: string; userId: string; delta: number; actorId: string; reason: string }) {
  await assertAdministrator(client, input.guildId, input.actorId);
  if (input.actorId === input.userId) throw new Error('ما تقدر تعدّل نقاطك بنفسك.');
  const result = await changePoints({ guildId: input.guildId, userId: input.userId, delta: input.delta, source: 'manual', reason: input.reason, actorId: input.actorId });
  if (!result) return null;
  await createLog(input.guildId, 'POINTS_ADJUSTED', input.userId, input.actorId, { delta: input.delta, before: result.before, after: result.after, reason: input.reason }).catch(() => undefined);
  return result;
}

// ---- Breakdown ------------------------------------------------------------------------------------

export type BreakdownPart = { key: string; points: number; count: number };
export type Breakdown = { total: number; parts: BreakdownPart[] };
type RawBreakdown = { total: number | null; claimed: number; shift: number; shiftCount: number; messages: number; voice: number; ratingPoints: number; ratingCount: number; complaint: number; complaintCount: number; ledger: Record<string, { points: number; n: number }> };
const DERIVED = new Set(['shift', 'messages', 'voice', 'assist', 'rating', 'complaint', 'manual']);

async function rawBreakdown(guildId: string, userId: string): Promise<RawBreakdown | null> {
  const { data, error } = await supabase.rpc('staff_points_breakdown', { p_guild: guildId, p_user: userId });
  if (!error) {
    const raw = data as RawBreakdown | null;
    return raw && raw.total !== null && raw.total !== undefined ? raw : null;
  }
  if (!isMissing(error)) throw new Error(`ما قدرنا نجيب تفاصيل النقاط: ${error.message}`);
  warnOnce('points-breakdown-rpc', `staff_points_breakdown() is missing, so the breakdown is counted slowly. ${MIGRATION_HINT}`);
  const { data: staff } = await supabase.from('staff').select('points, claimed').eq('guild_id', guildId).eq('user_id', userId).maybeSingle();
  if (!staff) return null;
  const [shifts, ratings, complaints, ledger] = await Promise.all([
    fetchAll<{ points_awarded: number; interaction_points_awarded: number; voice_points_awarded: number }>((from, to) => supabase.from('shifts').select('points_awarded, interaction_points_awarded, voice_points_awarded').eq('guild_id', guildId).eq('user_id', userId).range(from, to)),
    fetchAll<{ rating: number }>((from, to) => supabase.from('staff_ratings').select('rating').eq('guild_id', guildId).eq('staff_user_id', userId).range(from, to)),
    fetchAll<{ penalty_points: number }>((from, to) => supabase.from('complaints').select('penalty_points').eq('guild_id', guildId).eq('staff_user_id', userId).eq('status', 'approved').range(from, to)),
    fetchAll<{ source: string; delta: number }>((from, to) => supabase.from('points_ledger').select('source, delta').eq('guild_id', guildId).eq('user_id', userId).range(from, to)).catch(() => []),
  ]);
  const ledgerBySource: RawBreakdown['ledger'] = {};
  for (const row of ledger) { const entry = ledgerBySource[row.source] ?? { points: 0, n: 0 }; entry.points += Number(row.delta) || 0; entry.n += 1; ledgerBySource[row.source] = entry; }
  return {
    total: Number(staff.points) || 0, claimed: Number(staff.claimed) || 0,
    shift: shifts.reduce((sum, row) => sum + (Number(row.points_awarded) || 0), 0), shiftCount: shifts.filter(row => Number(row.points_awarded) > 0).length,
    messages: shifts.reduce((sum, row) => sum + (Number(row.interaction_points_awarded) || 0), 0), voice: shifts.reduce((sum, row) => sum + (Number(row.voice_points_awarded) || 0), 0),
    ratingPoints: ratings.reduce((sum, row) => sum + ratingPoints(row.rating), 0), ratingCount: ratings.length,
    complaint: complaints.reduce((sum, row) => sum + (Number(row.penalty_points) || 0), 0), complaintCount: complaints.length, ledger: ledgerBySource,
  };
}

/**
 * Where a member's current total came from. Shifts, ratings, complaints and helps are counted from their own records (so
 * older points are explained too), other sources (mod reports...) come from the ledger, and whatever is left is shown as
 * "manual changes & older points", so the parts always add up to the real total.
 */
export async function pointsBreakdown(guildId: string, userId: string): Promise<Breakdown | null> {
  const raw = await rawBreakdown(guildId, userId);
  if (!raw) return null;
  const total = Number(raw.total) || 0;
  const parts: BreakdownPart[] = [
    { key: 'shift', points: Number(raw.shift) || 0, count: Number(raw.shiftCount) || 0 },
    { key: 'messages', points: Number(raw.messages) || 0, count: 0 },
    { key: 'voice', points: Number(raw.voice) || 0, count: 0 },
    { key: 'assist', points: Number(raw.claimed) || 0, count: Number(raw.claimed) || 0 },
    { key: 'rating', points: Number(raw.ratingPoints) || 0, count: Number(raw.ratingCount) || 0 },
    { key: 'complaint', points: -(Number(raw.complaint) || 0), count: Number(raw.complaintCount) || 0 },
  ];
  for (const [source, entry] of Object.entries(raw.ledger || {})) if (!DERIVED.has(source)) parts.push({ key: source, points: Number(entry.points) || 0, count: Number(entry.n) || 0 });
  const explained = parts.reduce((sum, part) => sum + part.points, 0);
  parts.push({ key: 'manual', points: total - explained, count: Number(raw.ledger?.manual?.n) || 0 });
  return { total, parts };
}

export type LedgerEntry = { id: number; userId: string; delta: number; before: number; after: number; source: string; reason: string; actorId: string | null; at: Date };

/** The latest point changes of any kind, newest first. Returns [] until migration 030 is applied. */
export async function recentPointChanges(guildId: string, options: { userId?: string; limit?: number } = {}): Promise<LedgerEntry[]> {
  try {
    const filters: Record<string, unknown> = { guildId };
    if (options.userId) filters.userId = options.userId;
    const rows = await PointsLedger.find(filters).sort({ createdAt: -1 }).limit(options.limit ?? 20);
    return rows.map(row => ({ id: row.id, userId: row.userId, delta: row.delta, before: row.pointsBefore, after: row.pointsAfter, source: row.source, reason: row.reason || '', actorId: row.actorId, at: row.createdAt }));
  } catch (error) {
    logDbIssue(error, 'The points ledger');
    return [];
  }
}

/** Forgets the ledger of a member (or the whole server) after their statistics were reset. */
export async function clearLedger(guildId: string, userId?: string) {
  try { await PointsLedger.deleteMany(userId ? { guildId, userId } : { guildId }); }
  catch (error) { logDbIssue(error, 'The points ledger'); }
}
