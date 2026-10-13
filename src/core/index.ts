import type { ModalSubmitInteraction } from '../lib/djs/index.js';
import type { BotExtension } from '../extensions/types.js';
import { requireSettings } from '../services/settings.service.js';
import { coreCommandJson, handleCoreCommand } from './commands.js';
import { submitStaffRating } from './ratings.js';
import { SetupMissingError } from './db.js';
import { handleCardButton } from './card-buttons.js';

export { changePoints, adjustStaffPoints, pointsBreakdown, registerPointRule, ratingPoints } from './points.js';

// Staff core: points (with the ledger), assists, ratings, /points /leaderboard /profile /assist /rate /team /help.
// The dashboard side (points page, notifications, profile page, staff notes) is in ./dashboard.ts.

const handledRatingInteractions = new Set<string>();

// The rating panel's modal. It replaces the built-in handler so panel ratings use the same code as /rate:
// one rating per member per staff member, points through the ledger, and the same card in the ratings channel.
async function ratingPanelModal(i: ModalSubmitInteraction) {
  if (!i.customId.startsWith('rating_panel_modal:')) return false;
  if (!i.guild) { await i.reply({ content: 'هذا داخل السيرفر فقط.', flags: 64 }); return true; }
  if (handledRatingInteractions.has(i.id)) return true;
  handledRatingInteractions.add(i.id);
  setTimeout(() => handledRatingInteractions.delete(i.id), 10 * 60 * 1000);
  const staffUserId = i.customId.split(':')[1];
  if (!staffUserId) { await i.reply({ content: 'الإداري غير صحيح.', flags: 64 }); return true; }
  const settings = await requireSettings(i.guild.id);
  const target = await i.guild.members.fetch(staffUserId).catch(() => null);
  if (!target || !target.roles.cache.has(settings.staffRoleId) || target.user.bot) { await i.reply({ content: 'ما ينفع تقيّم هذا العضو.', flags: 64 }); return true; }
  if (staffUserId === i.user.id) { await i.reply({ content: 'ما تقدر تقيّم نفسك.', flags: 64 }); return true; }
  const rating = Number(i.fields.getTextInputValue('rating_score').trim());
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) { await i.reply({ content: 'عدد النجوم لازم يكون من 1 إلى 5.', flags: 64 }); return true; }
  const comment = i.fields.getTextInputValue('rating_comment').trim();
  await i.deferReply({ flags: 64 });
  try {
    const result = await submitStaffRating(i.guild, i.user.id, staffUserId, rating, comment);
    await i.editReply({ content: `انسجّل تقييمك بنجاح: ${rating}/5. معدل الإداري الحين ${result.averageRating.toFixed(2)}/5.` });
  } catch (error) {
    await i.editReply({ content: `⚠️ ${error instanceof SetupMissingError || error instanceof Error ? error.message : 'ما قدرنا نحفظ التقييم.'}` });
  }
  return true;
}

export const coreExtension: BotExtension = {
  name: 'core',
  commands: coreCommandJson.map(json => ({ json, handle: handleCoreCommand })),
  modal: ratingPanelModal,
  button: handleCardButton,
};
