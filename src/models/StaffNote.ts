import { SupabaseModel } from '../supabase/model.js';

export type StaffNoteDoc = { id: number; guildId: string; userId: string; text: string; addedBy: string; addedById: string | null; createdAt: Date };
export const StaffNote = new SupabaseModel<StaffNoteDoc>({
  table: 'staff_notes',
  columns: { id: 'id', guildId: 'guild_id', userId: 'user_id', text: 'text', addedBy: 'added_by', addedById: 'added_by_id', createdAt: 'created_at' },
  dates: ['createdAt'],
  defaults: { addedBy: '', addedById: null }
});
