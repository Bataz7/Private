import { SlashCommandBuilder, type ChatInputCommandInteraction } from '../lib/djs/index.js';
import { getSettings } from '../services/settings.service.js';
import { isStaff } from '../utils/permissions.js';
import { MIGRATION_HINT, schemaReady } from './db.js';
import { findBlockingLeave, findBlockingResignation } from './requests.js';
import { leaveModal, myRequestsEmbed, resignationModal } from './panels.js';

// /leave and /resign open the same forms as the panel buttons; /requests shows the member's own requests.
async function context(i: ChatInputCommandInteraction) {
  if (!i.guild) { await i.reply({ content: 'This command only works in a server.', flags: 64 }); return null; }
  const settings = await getSettings(i.guild.id).catch(() => null);
  const ar = settings?.botLanguage === 'ar';
  const t = (en: string, arText: string) => (ar ? arText : en);
  if (!settings) { await i.reply({ content: t('Rift is not set up on this server yet. An administrator can set it up from the dashboard.', 'Rift ظ…ط§ ط§ظ†ط¶ط¨ط· ظپظٹ ظ‡ط°ط§ ط§ظ„ط³ظٹط±ظپط± ط¨ط¹ط¯. ط§ظ„ط£ط¯ظ…ظ† ظٹظ‚ط¯ط± ظٹط¶ط¨ط·ظ‡ ظ…ظ† ط§ظ„ط¯ط§ط´ط¨ظˆط±ط¯.'), flags: 64 }); return null; }
  if (!await schemaReady()) { await i.reply({ content: MIGRATION_HINT, flags: 64 }); return null; }
  const member = await i.guild.members.fetch(i.user.id).catch(() => null);
  if (!member || !await isStaff(member)) { await i.reply({ content: t('Only staff can use this command.', 'ظ‡ط°ط§ ط§ظ„ط£ظ…ط± ظ„ظ„ط³طھط§ظپ ظپظ‚ط·.'), flags: 64 }); return null; }
  return { ar, t };
}

async function openLeave(i: ChatInputCommandInteraction) {
  const ctx = await context(i); if (!ctx) return;
  if (await findBlockingLeave(i.guild!.id, i.user.id)) return i.reply({ content: ctx.t('You already have an open leave request. Wait until it is reviewed or finished.', 'ط¹ظ†ط¯ظƒ ط·ظ„ط¨ ط¥ط¬ط§ط²ط© ظ…ظپطھظˆط­. ط§ظ†طھط¸ط± ظ„ظٹظ† ظٹظ†ط±ط§ط¬ط¹ ط£ظˆ ظٹط®ظ„طµ.'), flags: 64 });
  return i.showModal(leaveModal(ctx.ar ? 'ar' : 'en'));
}

async function openResignation(i: ChatInputCommandInteraction) {
  const ctx = await context(i); if (!ctx) return;
  if (await findBlockingResignation(i.guild!.id, i.user.id)) return i.reply({ content: ctx.t('You already have an open resignation request.', 'ط¹ظ†ط¯ظƒ ط·ظ„ط¨ ط§ط³طھظ‚ط§ظ„ط© ظ…ظپطھظˆط­.'), flags: 64 });
  return i.showModal(resignationModal(ctx.ar ? 'ar' : 'en'));
}

async function showRequests(i: ChatInputCommandInteraction) {
  const ctx = await context(i); if (!ctx) return;
  return i.reply({ embeds: [await myRequestsEmbed(i.guild!.id, i.user.id, ctx.ar)], flags: 64 });
}

export const leaveCommands = [
  { json: new SlashCommandBuilder().setName('leave').setDescription('Request leave').setDMPermission(false).toJSON(), handle: async (i: ChatInputCommandInteraction) => { await openLeave(i); } },
  { json: new SlashCommandBuilder().setName('resign').setDescription('Submit a resignation').setDMPermission(false).toJSON(), handle: async (i: ChatInputCommandInteraction) => { await openResignation(i); } },
  { json: new SlashCommandBuilder().setName('requests').setDescription('Your leave and resignation requests').setDMPermission(false).toJSON(), handle: async (i: ChatInputCommandInteraction) => { await showRequests(i); } },
];
