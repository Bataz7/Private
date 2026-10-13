import { PermissionFlagsBits, type Role } from '../lib/djs/index.js';

// Roles that must never be handed out by a self-service button or menu: each of these lets the
// holder take over or wreck the server.
const DANGEROUS = [
  PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageWebhooks, PermissionFlagsBits.BanMembers, PermissionFlagsBits.KickMembers, PermissionFlagsBits.MentionEveryone,
  PermissionFlagsBits.ModerateMembers, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ManageNicknames,
];

export function isDangerousRole(role: Role) {
  return role.managed || role.id === role.guild.id || DANGEROUS.some(flag => role.permissions.has(flag));
}
