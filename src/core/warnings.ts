import type { Client, Guild } from '../lib/djs/index.js';
import { StaffWarning, type StaffWarningDoc } from '../models/StaffWarning.js';
import { GuildSettings } from '../models/GuildSettings.js';
import { orSetupMissing } from './db.js';

// الإنذارات + حد الإنذارات: لما توصل الإنذارات النشطة لـ warn_limit (الافتراضي 3، و 0 = متوقف) ينفصل الإداري تلقائياً.

export const DEFAULT_WARN_LIMIT = 3;
let boundClient: Client | null = null;
/** البوت يربط الـ client هنا، عشان الإنذار من أي مكان يقدر يفصل (يحتاج السيرفر). */
export function bindWarningsClient(client: Client) { boundClient = client; }

export function warnLimitFrom(value: unknown) {
  const n = Number(value);
  return value === null || value === undefined || !Number.isFinite(n) ? DEFAULT_WARN_LIMIT : Math.max(0, Math.min(50, Math.round(n)));
}

export async function warnLimitOf(guildId: string) {
  const settings = await GuildSettings.findOne({ guildId }).catch(() => null);
  return warnLimitFrom(settings?.warnLimit);
}

export async function countActiveWarnings(guildId: string, staffUserId: string): Promise<number> {
  return StaffWarning.countDocuments({ guildId, staffUserId, active: true }).catch(() => 0);
}

/**
 * يفصل الإداري لو إنذاراته النشطة وصلت الحد. `guild` اختياري: بدونه يستخدم الـ client المربوط (البوت).
 * ما يرمي: يرجّع وش صار.
 */
export async function enforceWarnLimit(guildId: string, staffUserId: string, opts: { guild?: Guild | null; by?: string } = {}): Promise<{ count: number; limit: number; dismissed: boolean; error?: string }> {
  const [limit, count] = await Promise.all([warnLimitOf(guildId), countActiveWarnings(guildId, staffUserId)]);
  if (!limit || count < limit) return { count, limit, dismissed: false };
  const guild = opts.guild ?? boundClient?.guilds.cache.get(guildId) ?? null;
  if (!guild) return { count, limit, dismissed: false, error: 'السيرفر مو متاح للبوت الحين.' };
  const { dismissStaff, isDismissed } = await import('../services/dismissal.service.js');
  if (await isDismissed(guildId, staffUserId)) return { count, limit, dismissed: false };
  try {
    await dismissStaff(guild, staffUserId, { by: opts.by || guild.client.user?.id || 'system', reason: `وصل حد الإنذارات (${count}/${limit})`, source: 'warnings' });
    return { count, limit, dismissed: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Warn-limit dismissal failed for ${staffUserId}:`, message);
    return { count, limit, dismissed: false, error: message };
  }
}

export async function createWarning(data: { guildId: string; staffUserId: string; reason: string; issuedBy: string; automatic?: boolean }, opts: { guild?: Guild | null; enforce?: boolean } = {}): Promise<StaffWarningDoc & { limit?: { count: number; limit: number; dismissed: boolean; error?: string } }> {
  const warning = await StaffWarning.create({ guildId: data.guildId, staffUserId: data.staffUserId, reason: data.reason, issuedBy: data.issuedBy, automatic: data.automatic ?? false, active: true }).catch(error => orSetupMissing(error, 'Staff warnings')) as StaffWarningDoc;
  if (opts.enforce === false) return warning;
  const limit = await enforceWarnLimit(data.guildId, data.staffUserId, { guild: opts.guild, by: data.issuedBy }).catch(() => undefined);
  return Object.assign(warning, { limit });
}

export async function getActiveWarnings(guildId: string, staffUserId: string): Promise<StaffWarningDoc[]> {
  return StaffWarning.find({ guildId, staffUserId, active: true }).sort({ createdAt: -1 }).catch(error => orSetupMissing(error, 'Staff warnings')) as Promise<StaffWarningDoc[]>;
}

export async function resolveAllWarnings(guildId: string, staffUserId: string): Promise<void> {
  const rows = await getActiveWarnings(guildId, staffUserId);
  await Promise.all(rows.map(row => StaffWarning.update(row.id, { active: false })));
}
