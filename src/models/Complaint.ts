import { SupabaseModel } from '../supabase/model.js';

export type ComplaintDoc = {
  id: number;
  guildId: string;
  staffUserId: string;
  reporterUserId: string;
  reason: string;
  evidence: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy: string | null;
  reviewedAt: Date | null;
  decisionNote: string;
  penaltyPoints: number;
  dedupeKey: string | null;
  createdAt: Date;
};

export const Complaint = new SupabaseModel<ComplaintDoc>({
  table: 'complaints',
  columns: { id: 'id', guildId: 'guild_id', staffUserId: 'staff_user_id', reporterUserId: 'reporter_user_id', reason: 'reason', evidence: 'evidence', status: 'status', reviewedBy: 'reviewed_by', reviewedAt: 'reviewed_at', decisionNote: 'decision_note', penaltyPoints: 'penalty_points', dedupeKey: 'dedupe_key', createdAt: 'created_at' },
  dates: ['reviewedAt', 'createdAt'],
  defaults: { evidence: '', status: 'pending', reviewedBy: null, reviewedAt: null, decisionNote: '', penaltyPoints: 0, dedupeKey: null }
});