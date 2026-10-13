import { GuildSettings } from '../models/GuildSettings.js';

/** لغة البوت: عربي دائمًا، مهما كان المحفوظ في الإعدادات. */
export const BOT_LANGUAGE = 'ar' as const;

export async function getSettings(guildId: string) {
  const settings = await GuildSettings.findOne({ guildId });
  if (settings) settings.botLanguage = BOT_LANGUAGE;
  return settings;
}

export async function requireSettings(guildId: string) {
  const settings = await getSettings(guildId);
  if (!settings) throw new Error('نظام الستاف مو مضبوط في السيرفر. استخدم أمر الإعداد أو لوحة التحكم أول.');
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
