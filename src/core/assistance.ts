import { supabase } from '../supabase/client.js';
import { Assistance, type AssistanceDoc } from '../models/Assistance.js';
import { ensureStaff } from '../services/shift.service.js';
import { createLog } from '../services/log.service.js';
import { changePoints } from './points.js';
import { orSetupMissing } from './db.js';

const REPEAT_WINDOW_MS = 10 * 60 * 1000;
// Points from help are member-driven, so one staff member can only be credited so many times a day (bounds alt-account farming).
export const MAX_ASSISTS_PER_DAY = 30;
const inFlight = new Set<string>();

export class RepeatAssistanceError extends Error {}
export class AssistanceLimitError extends Error {}

export async function createAssistance(data: { guildId: string; staffUserId: string; memberUserId: string; type?: string; note?: string }): Promise<AssistanceDoc> {
  // Two credits for the same pair at the same moment used to both pass the check below.
  const lockKey = `${data.guildId}:${data.staffUserId}:${data.memberUserId}`;
  if (inFlight.has(lockKey)) throw new RepeatAssistanceError('This help is already being credited.');
  inFlight.add(lockKey);
  try { return await credit(data); } finally { inFlight.delete(lockKey); }
}

async function countSince(guildId: string, staffUserId: string, since: Date, memberUserId?: string) {
  let query = supabase.from('assistances').select('id', { count: 'exact', head: true }).eq('guild_id', guildId).eq('staff_user_id', staffUserId).gte('created_at', since.toISOString());
  if (memberUserId) query = query.eq('member_user_id', memberUserId);
  const { count, error } = await query;
  if (error) orSetupMissing(new Error(error.message), 'Assist logging');
  return count ?? 0;
}

async function credit(data: { guildId: string; staffUserId: string; memberUserId: string; type?: string; note?: string }): Promise<AssistanceDoc> {
  if (await countSince(data.guildId, data.staffUserId, new Date(Date.now() - 24 * 3_600_000)) >= MAX_ASSISTS_PER_DAY) throw new AssistanceLimitError(`This staff member reached the daily limit of ${MAX_ASSISTS_PER_DAY} credited helps.`);
  // The same member can be credited for the same staff member once per 10 minutes, so points cannot be farmed.
  if (await countSince(data.guildId, data.staffUserId, new Date(Date.now() - REPEAT_WINDOW_MS), data.memberUserId)) throw new RepeatAssistanceError('This help was already credited in the last 10 minutes.');
  await ensureStaff(data.guildId, data.staffUserId);
  const assistance = await Assistance.create({ ...data, type: data.type || 'General Support', note: String(data.note || '').slice(0, 300) }).catch(error => orSetupMissing(error, 'Assist logging'));
  await changePoints({ guildId: data.guildId, userId: data.staffUserId, delta: 1, claimed: 1, source: 'assist', reason: `Helped <@${data.memberUserId}>`, ref: assistance.id });
  await createLog(data.guildId, 'ASSISTANCE_RECORDED', data.staffUserId, data.staffUserId, { assistanceId: assistance.id, memberUserId: data.memberUserId, type: assistance.type }).catch(() => undefined);
  return assistance;
}
