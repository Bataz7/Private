import { StaffWarning, type StaffWarningDoc } from '../models/StaffWarning.js';
import { orSetupMissing } from './db.js';

export async function createWarning(data: { guildId: string; staffUserId: string; reason: string; issuedBy: string; automatic?: boolean }): Promise<StaffWarningDoc> {
  return StaffWarning.create({ guildId: data.guildId, staffUserId: data.staffUserId, reason: data.reason, issuedBy: data.issuedBy, automatic: data.automatic ?? false, active: true }).catch(error => orSetupMissing(error, 'Staff warnings')) as Promise<StaffWarningDoc>;
}

export async function getActiveWarnings(guildId: string, staffUserId: string): Promise<StaffWarningDoc[]> {
  return StaffWarning.find({ guildId, staffUserId, active: true }).sort({ createdAt: -1 }).catch(error => orSetupMissing(error, 'Staff warnings')) as Promise<StaffWarningDoc[]>;
}

export async function resolveAllWarnings(guildId: string, staffUserId: string): Promise<void> {
  const rows = await getActiveWarnings(guildId, staffUserId);
  await Promise.all(rows.map(row => StaffWarning.update(row.id, { active: false })));
}
