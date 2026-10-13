import { SupabaseModel } from '../supabase/model.js';

export type AssistanceFeedback = 'good' | 'neutral' | 'bad' | null;
export type AssistanceDoc = { id: number; guildId: string; staffUserId: string; memberUserId: string; type: string; note: string; feedback: AssistanceFeedback; feedbackReason: string | null; createdAt: Date };
export const Assistance = new SupabaseModel<AssistanceDoc>({
  table: 'assistances',
  columns: { id: 'id', guildId: 'guild_id', staffUserId: 'staff_user_id', memberUserId: 'member_user_id', type: 'type', note: 'note', feedback: 'feedback', feedbackReason: 'feedback_reason', createdAt: 'created_at' },
  dates: ['createdAt'],
  defaults: { type: 'General Support', note: '', feedback: null, feedbackReason: null }
});
