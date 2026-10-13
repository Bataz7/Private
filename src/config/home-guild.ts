import { env } from './env.js';

// البوت لسيرفر واحد بس. GUILD_ID هو الإعداد الأساسي؛ لو ناقص نعتمد أول سيرفر يوصل من ديسكورد (مع تحذير).
let home = env.guildId;

export const homeGuildId = () => home;

/** يختار السيرفر الرئيسي بعد الاتصال. يرجّع true لو اعتمدنا أول سيرفر لأن GUILD_ID ناقص أو البوت مو فيه. */
export function resolveHomeGuild(guildIds: string[]): { id: string; fallback: boolean } {
  if (env.guildId && guildIds.includes(env.guildId)) { home = env.guildId; return { id: home, fallback: false }; }
  if (env.guildId && !guildIds.length) { home = env.guildId; return { id: home, fallback: false }; }
  home = guildIds[0] || env.guildId || '';
  return { id: home, fallback: true };
}

/** حدث من السيرفر الرئيسي (أو من الخاص). قبل ما نعرف السيرفر الرئيسي كل شي مسموح. */
export const isHomeGuild = (guildId: string | null | undefined) => !guildId || !home || guildId === home;

export const OTHER_GUILD_REPLY = 'هذا البوت خاص بسيرفر واحد';

/** للاختبارات. */
export function _setHomeGuild(id: string) { home = id; }
