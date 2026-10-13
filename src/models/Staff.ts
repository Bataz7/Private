import { SupabaseModel } from '../supabase/model.js';

export type StaffDoc = { id: number; guildId: string; userId: string; joinedAt: Date; active: boolean; points: number; claimed: number; closed: number; messageCount: number; voiceMinutes: number };
export const Staff = new SupabaseModel<StaffDoc>({ table: 'staff', columns: { id: 'id', guildId: 'guild_id', userId: 'user_id', joinedAt: 'joined_at', active: 'active', points: 'points', claimed: 'claimed', closed: 'closed', messageCount: 'message_count', voiceMinutes: 'voice_minutes' }, dates: ['joinedAt'], defaults: { active: true, points: 0, claimed: 0, closed: 0, messageCount: 0, voiceMinutes: 0 } });
