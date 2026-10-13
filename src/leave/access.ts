import type { Client, GuildMember, Interaction } from 'discord.js';
import { getSettings } from '../services/settings.service.js';

// Two levels exist: staff (the Staff role) and administrator (the server owner, or anyone with the Administrator permission).
// Only administrators decide leave, extension and resignation requests.
export const isAdmin = (member: GuildMember) => member.guild.ownerId === member.id || member.permissions.has('Administrator');

export const ADMIN_ONLY_TEXT = { en: 'Only administrators can do this.', ar: 'هذا الأمر للأدمن فقط، ما تقدر تسويه.' };

export class AdminOnlyError extends Error {
  constructor() { super(ADMIN_ONLY_TEXT.en); this.name = 'AdminOnlyError'; }
}

/** The second lock: every decision service calls this with the person acting. It looks them up in Discord right now. */
export async function assertAdministrator(client: Client, guildId: string, userId: string) {
  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
  if (!member || !isAdmin(member)) throw new AdminOnlyError();
}

export async function replyAdminOnly(interaction: Interaction & { reply: (options: any) => Promise<unknown>; guildId: string | null }) {
  const settings = interaction.guildId ? await getSettings(interaction.guildId).catch(() => null) : null;
  return interaction.reply({ content: `⛔ ${settings?.botLanguage === 'ar' ? ADMIN_ONLY_TEXT.ar : ADMIN_ONLY_TEXT.en}`, flags: 64 });
}
