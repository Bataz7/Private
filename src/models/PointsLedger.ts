import { SupabaseModel } from '../supabase/model.js';

export type PointsLedgerDoc = { id: number; guildId: string; userId: string; delta: number; pointsBefore: number; pointsAfter: number; source: string; reason: string; actorId: string | null; ref: string | null; createdAt: Date };
export const PointsLedger = new SupabaseModel<PointsLedgerDoc>({
  table: 'points_ledger',
  columns: { id: 'id', guildId: 'guild_id', userId: 'user_id', delta: 'delta', pointsBefore: 'points_before', pointsAfter: 'points_after', source: 'source', reason: 'reason', actorId: 'actor_id', ref: 'ref', createdAt: 'created_at' },
  dates: ['createdAt'],
  defaults: { reason: '', actorId: null, ref: null, source: 'manual' }
});
