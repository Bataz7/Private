import { SupabaseModel } from '../supabase/model.js';

export type ReportDoc = { id: number; guildId: string; userId: string; title: string; content: string; type: 'shift_summary' | 'incident' | 'general'; shiftId: number | string | null; status: 'submitted' | 'reviewed'; reviewedBy: string | null; reviewedAt: Date | null; createdAt: Date };
export const Report = new SupabaseModel<ReportDoc>({ table: 'reports', columns: { id: 'id', guildId: 'guild_id', userId: 'user_id', title: 'title', content: 'content', type: 'type', shiftId: 'shift_id', status: 'status', reviewedBy: 'reviewed_by', reviewedAt: 'reviewed_at', createdAt: 'created_at' }, dates: ['reviewedAt', 'createdAt'], defaults: { shiftId: null, status: 'submitted', reviewedBy: null, reviewedAt: null } });
