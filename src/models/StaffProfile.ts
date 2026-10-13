import { SupabaseModel } from '../supabase/model.js';

export type ProfileLink = { label: string; url: string };
export type ProfileConnection = { type: string; id: string; name: string; verified: boolean };
export type StaffProfileDoc = {
  id: number; guildId: string; userId: string; tagline: string; bio: string; accent: string; bannerUrl: string;
  showFeedback: boolean; showConnections: boolean; links: ProfileLink[]; connections: ProfileConnection[]; connectionsSyncedAt: Date | null; updatedAt: Date;
};
export const StaffProfile = new SupabaseModel<StaffProfileDoc>({
  table: 'staff_profiles',
  columns: { id: 'id', guildId: 'guild_id', userId: 'user_id', tagline: 'tagline', bio: 'bio', accent: 'accent', bannerUrl: 'banner_url', showFeedback: 'show_feedback', showConnections: 'show_connections', links: 'links', connections: 'connections', connectionsSyncedAt: 'connections_synced_at', updatedAt: 'updated_at' },
  dates: ['connectionsSyncedAt', 'updatedAt'],
  defaults: { tagline: '', bio: '', accent: '', bannerUrl: '', showFeedback: true, showConnections: true, links: [], connections: [], connectionsSyncedAt: null }
});
