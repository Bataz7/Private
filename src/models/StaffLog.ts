import { SupabaseModel } from '../supabase/model.js';

export type StaffLogDoc = { id: number; guildId: string; action: string; userId: string; actorId: string | null; details: Record<string, unknown>; createdAt: Date };
export const StaffLog = new SupabaseModel<StaffLogDoc>({ table: 'staff_logs', columns: { id: 'id', guildId: 'guild_id', action: 'action', userId: 'user_id', actorId: 'actor_id', details: 'details', createdAt: 'created_at' }, dates: ['createdAt'], defaults: { actorId: null, details: {} } });
