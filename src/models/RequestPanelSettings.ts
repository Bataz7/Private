import { SupabaseModel } from '../supabase/model.js';

/** Where the leave and resignation panels were sent. The requests (review) channels live in guild_settings. */
export type RequestPanelSettingsDoc = { id: string; guildId: string; leavePanelChannelId: string | null; resignationPanelChannelId: string | null };
export const RequestPanelSettings = new SupabaseModel<RequestPanelSettingsDoc>({
  table: 'request_panel_settings',
  primaryKey: 'guild_id',
  columns: { id: 'guild_id', guildId: 'guild_id', leavePanelChannelId: 'leave_panel_channel_id', resignationPanelChannelId: 'resignation_panel_channel_id' },
  defaults: { leavePanelChannelId: null, resignationPanelChannelId: null },
});
