import { SupabaseModel } from '../supabase/model.js';

export type StaffRatingDoc = { id: number; guildId: string; staffUserId: string; reviewerUserId: string; reviewerName?: string; rating: number; comment: string; createdAt: Date };
export const StaffRating = new SupabaseModel<StaffRatingDoc>({
  table: 'staff_ratings',
  columns: { id: 'id', guildId: 'guild_id', staffUserId: 'staff_user_id', reviewerUserId: 'reviewer_user_id', reviewerName: 'reviewer_name', rating: 'rating', comment: 'comment', createdAt: 'created_at' },
  dates: ['createdAt'],
  defaults: { comment: '' }
});