import type { Client } from '../lib/djs/index.js';
import { supabase } from '../supabase/client.js';
import { LeaveRequest } from '../models/LeaveRequest.js';
import { ResignationRequest } from '../models/ResignationRequest.js';
import { createLog } from '../services/log.service.js';
import type { RequestTable } from './db.js';
import { postRequestCard } from './cards.js';
import type { RequestKind } from './util.js';

const TABLE: Record<RequestKind, RequestTable> = { leave: 'leave_requests', resignation: 'resignation_requests' };
// Requests that are finished for good. `approved` is never listed: an approved leave is running and an approved
// resignation is still waiting for its last day.
const CLOSED: Record<RequestKind, string[]> = { leave: ['rejected', 'returned'], resignation: ['rejected', 'accepted'] };

/** Sends every request still waiting for a decision to the requests channel again, as a fresh card. Nothing is deleted from the database. */
export async function resendPendingRequests(client: Client, kind: RequestKind, guildId: string) {
  const rows = kind === 'leave'
    ? await LeaveRequest.find({ guildId, status: 'pending' }).sort({ createdAt: 1 }).limit(100)
    : await ResignationRequest.find({ guildId, status: 'pending' }).sort({ createdAt: 1 }).limit(100);
  let sent = 0; let failed = 0;
  for (const row of rows) {
    const oldChannelId = row.reviewChannelId; const oldMessageId = row.reviewMessageId;
    const message = await postRequestCard(client, kind, row);
    if (!message) { failed++; continue; }
    sent++;
    // The bot's own earlier card is replaced by the new one, so the old buttons do not stay around.
    if (oldChannelId && oldMessageId && oldMessageId !== message.id) {
      const channel: any = await client.channels.fetch(oldChannelId).catch(() => null);
      await channel?.messages?.delete?.(oldMessageId).catch(() => undefined);
    }
  }
  return { pending: rows.length, sent, failed };
}

function closedQuery(query: any, kind: RequestKind, guildId: string, olderThanDays: number) {
  const days = Math.max(0, Math.min(3650, Math.floor(Number(olderThanDays) || 0)));
  let scoped = query.eq('guild_id', guildId).in('status', CLOSED[kind]);
  if (days) scoped = scoped.lt('created_at', new Date(Date.now() - days * 86_400_000).toISOString());
  return scoped;
}

export async function countClosedRequests(kind: RequestKind, guildId: string, olderThanDays = 0) {
  const { count, error } = await closedQuery(supabase.from(TABLE[kind]).select('id', { count: 'exact', head: true }), kind, guildId, olderThanDays);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Deletes finished requests (rejected, returned, completed). Pending and running ones are never touched. */
export async function clearClosedRequests(kind: RequestKind, guildId: string, actorId: string, olderThanDays = 0) {
  const removed = await countClosedRequests(kind, guildId, olderThanDays);
  if (removed) {
    const { error } = await closedQuery(supabase.from(TABLE[kind]).delete(), kind, guildId, olderThanDays);
    if (error) throw new Error(error.message);
  }
  await createLog(guildId, kind === 'leave' ? 'LEAVE_REQUESTS_CLEARED' : 'RESIGNATION_REQUESTS_CLEARED', actorId, actorId, { removed, olderThanDays });
  return { removed };
}
