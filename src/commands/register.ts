import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Client } from 'discord.js';
import { env } from '../config/env.js';
import { allCommands } from './definitions.js';

// Registers the slash commands on start when the definitions changed since the last registration,
// so removed commands disappear from Discord and new ones show up without running `npm run register`.
const stampFile = fileURLToPath(new URL('../../.commands-hash', import.meta.url));

export async function registerCommandsIfChanged(client: Client) {
  const commands = allCommands();
  const target = env.guildId || 'global';
  const hash = createHash('sha1').update(JSON.stringify({ target, commands })).digest('hex');
  const previous = existsSync(stampFile) ? readFileSync(stampFile, 'utf8').trim() : '';
  if (previous === hash || !client.application) return false;
  if (env.guildId) await client.application.commands.set(commands as any, env.guildId);
  else await client.application.commands.set(commands as any);
  try { writeFileSync(stampFile, hash); } catch { /* read-only disk: it registers again next start, which is harmless */ }
  return true;
}
