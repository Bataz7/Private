import { GuildSettings } from '../models/GuildSettings.js';

export async function getSettings(guildId: string) {
  return GuildSettings.findOne({ guildId });
}

export async function requireSettings(guildId: string) {
  const settings = await getSettings(guildId);
  if (!settings) throw new Error('Staff system is not configured. Use /staff setup first.');
  return settings;
}

export async function saveSettings(data: {
  guildId: string;
  staffRoleId: string;
  onShiftRoleId: string;
  leaveRoleId: string;
  managementRoleId: string;
  shiftChannelId: string;
  leaveChannelId: string;
  resignationChannelId: string;
  logsChannelId: string;
  reportChannelId?: string | null;
  complaintChannelId?: string | null;
}) {
  return GuildSettings.findOneAndUpdate(
    { guildId: data.guildId },
    data,
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}
