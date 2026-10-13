import { SupabaseModel } from '../supabase/model.js';

export type ResignationRequestDoc = {
  id: number; guildId: string; userId: string; lastWorkingDay: Date; reason: string; notes: string;
  /** pending -> approved (waiting for the last day) -> accepted (completed). rejected ends it early. */
  status: 'pending' | 'approved' | 'accepted' | 'rejected';
  reviewedBy: string | null; reviewedAt: Date | null; rejectionReason: string | null; decisionNote: string;
  dmMessageId: string | null; confirmationSentAt: Date | null;
  reviewChannelId: string | null; reviewMessageId: string | null;
  createdAt: Date;
};
export const ResignationRequest = new SupabaseModel<ResignationRequestDoc>({
  table: 'resignation_requests',
  columns: {
    id: 'id', guildId: 'guild_id', userId: 'user_id', lastWorkingDay: 'last_working_day', reason: 'reason', notes: 'notes', status: 'status', reviewedBy: 'reviewed_by', reviewedAt: 'reviewed_at', rejectionReason: 'rejection_reason',
    decisionNote: 'decision_note', dmMessageId: 'dm_message_id', confirmationSentAt: 'confirmation_sent_at', reviewChannelId: 'review_channel_id', reviewMessageId: 'review_message_id', createdAt: 'created_at',
  },
  dates: ['lastWorkingDay', 'reviewedAt', 'confirmationSentAt', 'createdAt'],
  defaults: { notes: '', status: 'pending', reviewedBy: null, reviewedAt: null, rejectionReason: null, decisionNote: '', dmMessageId: null, confirmationSentAt: null, reviewChannelId: null, reviewMessageId: null },
});
