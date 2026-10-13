import type { Client, GuildMember, Interaction } from 'discord.js';
import { requireSettings, getSettings } from '../services/settings.service.js';

// Who may do what. Two levels only:
//   - staff: the Staff role (or an administrator). Can use their own tools.
//   - administrator: the server owner, or anyone with the Administrator permission. The ONLY people who decide
//     things: edit points, send notifications, approve or reject requests.
// The management role never grants those powers.

export function isAdministrator(member: GuildMember) {
  return member.guild.ownerId === member.id || member.permissions.has('Administrator');
}

/** Kept for older call sites: management is the same as administrator. */
export async function isManagement(member: GuildMember) {
  await requireSettings(member.guild.id);
  return isAdministrator(member);
}

export async function isStaff(member: GuildMember) {
  const settings = await requireSettings(member.guild.id);
  return member.roles.cache.has(settings.staffRoleId) || isAdministrator(member);
}

export const ADMIN_ONLY_TEXT = { en: 'Only administrators can do this.', ar: 'هذا الأمر للأدمن فقط، ما تقدر تسويه.' };

export class AdminOnlyError extends Error {
  constructor() { super(ADMIN_ONLY_TEXT.en); this.name = 'AdminOnlyError'; }
}

/**
 * The second lock. Every decision (edit points, send a notification, approve, reject) ends in a service function that
 * calls this with the person who is acting, so a button or a route that forgot its own check still cannot decide anything.
 * It looks the person up in Discord right now, so a role removed a moment ago no longer counts.
 */
export async function assertAdministrator(client: Client, guildId: string, userId: string) {
  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
  if (!member || !isAdministrator(member)) throw new AdminOnlyError();
}

/** Ephemeral "only administrators" reply, in the server's bot language. */
export async function replyAdminOnly(interaction: Interaction & { reply: (options: any) => Promise<unknown>; guildId: string | null }) {
  const settings = interaction.guildId ? await getSettings(interaction.guildId).catch(() => null) : null;
  return interaction.reply({ content: `⛔ ${settings?.botLanguage === 'ar' ? ADMIN_ONLY_TEXT.ar : ADMIN_ONLY_TEXT.en}`, flags: 64 });
}
