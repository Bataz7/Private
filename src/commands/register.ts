import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { Client } from '../lib/djs/index.js';
import { ROOT, env } from '../config/env.js';
import { allCommands } from './definitions.js';
import { homeGuildId } from '../config/home-guild.js';
import { localizeCommands } from '../lib/djs/localization.js';

// Registers the slash commands on start when the definitions changed since the last registration,
// so removed commands disappear from Discord and new ones show up without running `npm run register`.
const stampFile = `${ROOT}/.commands-hash`;

// البوت لسيرفر واحد: الأوامر تتسجّل كأوامر سيرفر (تظهر فوراً) على GUILD_ID، أو أول سيرفر لو GUILD_ID ناقص.
export async function registerCommandsIfChanged(client: Client, guildId = homeGuildId() || env.guildId) {
  const commands = allCommands();
  const target = guildId || 'global';
  // الهاش يشمل الأسماء العربية: أي تعديل على القاموس يعيد التسجيل
  const hash = createHash('sha1').update(JSON.stringify({ target, commands: localizeCommands(commands as any[]) })).digest('hex');
  const previous = existsSync(stampFile) ? readFileSync(stampFile, 'utf8').trim() : '';
  if (previous === hash || !client.application) return false;
  if (guildId) {
    await client.application.commands.set(commands as any, guildId);
    // لو كانت فيه أوامر عامة من تسجيل قديم: نشيلها عشان ما تطلع الأوامر مكررة.
    await client.application.commands.set([] as any).catch(() => undefined);
  } else await client.application.commands.set(commands as any);
  try { writeFileSync(stampFile, hash); } catch { /* read-only disk: it registers again next start, which is harmless */ }
  return true;
}
