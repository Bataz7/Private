import { StaffLog } from '../models/StaffLog.js';
import type { Client, TextChannel } from '../lib/djs/index.js';
import { requireSettings } from './settings.service.js';

export async function createLog(guildId: string, action: string, userId: string, actorId: string | null, details: Record<string, unknown> = {}) {
  const log = await StaffLog.create({ guildId, action, userId, actorId, details });
  return log;
}

export async function sendLog(client: Client, guildId: string, content: string) {
  const settings = await requireSettings(guildId);
  const channel = await client.channels.fetch(settings.logsChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  await (channel as TextChannel).send({ content }).catch(() => undefined);
}
