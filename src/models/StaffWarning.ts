import { SupabaseModel } from '../supabase/model.js';

export type StaffWarningDoc = { id: number; guildId: string; staffUserId: string; reason: string; issuedBy: string; automatic: boolean; active: boolean; createdAt: Date };
export const StaffWarning = new SupabaseModel<StaffWarningDoc>({
  table: 'staff_warnings',
  columns: { id: 'id', guildId: 'guild_id', staffUserId: 'staff_user_id', reason: 'reason', issuedBy: 'issued_by', automatic: 'automatic', active: 'active', createdAt: 'created_at' },
  dates: ['createdAt'],
  defaults: { automatic: false, active: true }
});
