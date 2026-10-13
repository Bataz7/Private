// يسجّل أوامر السلاش يدوياً (البوت يسجّلها تلقائياً عند التشغيل لو تغيّرت).  bun run register
import { REST } from '../src/lib/discord/rest.ts';
import { localizeCommands } from '../src/lib/djs/localization.ts';
import { env } from '../src/config/env.js';
import { allCommands } from '../src/commands/definitions.js';
import '../src/i18n/commands.js';

if (!env.guildId) console.warn('تنبيه: GUILD_ID ناقص في .env. البوت لسيرفر واحد، حط آيدي السيرفر عشان الأوامر تظهر فوراً (التسجيل العام ياخذ وقت).');
const commands = localizeCommands(allCommands() as any[]);
const rest = new REST(env.token);
const path = env.guildId ? `/applications/${env.clientId}/guilds/${env.guildId}/commands` : `/applications/${env.clientId}/commands`;
await rest.put(path, { body: commands });
if (env.guildId) await rest.put(`/applications/${env.clientId}/commands`, { body: [] }).catch(() => undefined); // نشيل أي أوامر عامة قديمة
console.log(`تم تسجيل ${commands.length} أمر ${env.guildId ? 'في السيرفر' : 'عام'}.`);
