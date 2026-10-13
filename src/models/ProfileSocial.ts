import { SupabaseModel } from '../supabase/model.js';

// Comments, reputation and views on the staff profile page.
export type ProfileCommentDoc = { id: number; guildId: string; profileUserId: string; authorUserId: string; authorName: string; text: string; createdAt: Date };
export const ProfileComment = new SupabaseModel<ProfileCommentDoc>({
  table: 'profile_comments',
  columns: { id: 'id', guildId: 'guild_id', profileUserId: 'profile_user_id', authorUserId: 'author_user_id', authorName: 'author_name', text: 'text', createdAt: 'created_at' },
  dates: ['createdAt'],
  defaults: { authorName: '' }
});

export type ProfileRepDoc = { id: number; guildId: string; profileUserId: string; fromUserId: string; createdAt: Date };
export const ProfileRep = new SupabaseModel<ProfileRepDoc>({
  table: 'profile_reps',
  columns: { id: 'id', guildId: 'guild_id', profileUserId: 'profile_user_id', fromUserId: 'from_user_id', createdAt: 'created_at' },
  dates: ['createdAt']
});

export type ProfileViewDoc = { id: number; guildId: string; profileUserId: string; viewerUserId: string; day: string };
export const ProfileView = new SupabaseModel<ProfileViewDoc>({
  table: 'profile_views',
  columns: { id: 'id', guildId: 'guild_id', profileUserId: 'profile_user_id', viewerUserId: 'viewer_user_id', day: 'day' }
});
