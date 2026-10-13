import type { Guild } from 'discord.js';
import { supabase } from '../supabase/client.js';
import { StaffRating, type StaffRatingDoc } from '../models/StaffRating.js';
import { getSettings } from '../services/settings.service.js';
import { buildRatingCard } from '../utils/rating-card.js';
import { changePoints, ratingPoints } from './points.js';

type RatingRow = StaffRatingDoc;
const findByReviewer = async (guildId: string, staffUserId: string, reviewerUserId: string): Promise<RatingRow | null> => await StaffRating.findOne({ guildId, staffUserId, reviewerUserId });

// One rating per member per staff member. Used by the rating panel (modal) and /rate, so both award points the same way.
export async function submitStaffRating(guild: Guild, reviewerId: string, staffUserId: string, rating: number, rawComment: string) {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error('Choose 1 to 5 stars.');
  if (reviewerId === staffUserId) throw new Error('You cannot rate yourself.');
  const comment = String(rawComment ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, 1000);
  let previous = await findByReviewer(guild.id, staffUserId, reviewerId);
  // The update only applies if the stored rating is still the one we read: two submissions at the same moment can no longer
  // both count their points from the same old value (which used to pay the difference twice).
  let replaced = false;
  for (let attempt = 0; previous && attempt < 3; attempt++) {
    const { data, error } = await supabase.from('staff_ratings').update({ rating, comment, created_at: new Date().toISOString() }).eq('id', previous.id).eq('rating', previous.rating).select('id');
    if (error) throw new Error(`Saving the rating failed: ${error.message}`);
    if (data?.length) { replaced = true; break; }
    previous = await findByReviewer(guild.id, staffUserId, reviewerId);
  }
  if (previous && !replaced) throw new Error('Your rating could not be saved because it changed at the same moment. Try again.');
  if (!previous) {
    try { await StaffRating.create({ guildId: guild.id, staffUserId, reviewerUserId: reviewerId, rating, comment, createdAt: new Date() }); }
    catch (error) {
      // Two submissions at once: the unique index lets only one create, the other updates it.
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('staff_ratings_one_per_reviewer_idx') && !message.includes('duplicate key')) throw error;
      previous = await findByReviewer(guild.id, staffUserId, reviewerId);
      if (!previous) throw error;
      await StaffRating.update(previous.id, { rating, comment, createdAt: new Date() });
    }
  }
  const delta = ratingPoints(rating) - (previous ? ratingPoints(previous.rating) : 0);
  if (delta) await changePoints({ guildId: guild.id, userId: staffUserId, delta, source: 'rating', reason: `${rating}/5 rating`, actorId: reviewerId });

  const all = await StaffRating.find({ guildId: guild.id, staffUserId });
  const ratingCount = all.length;
  const averageRating = ratingCount ? all.reduce((sum, item) => sum + item.rating, 0) / ratingCount : rating;
  const settings = await getSettings(guild.id).catch(() => null);
  const channel = settings?.ratingChannelId ? await guild.channels.fetch(settings.ratingChannelId).catch(() => null) : null;
  if (channel?.isTextBased()) {
    const [staff, reviewer] = await Promise.all([guild.members.fetch(staffUserId).catch(() => null), guild.members.fetch(reviewerId).catch(() => null)]);
    await channel.send({
      allowedMentions: { parse: [] },
      embeds: [buildRatingCard({
        rating, comment, updated: Boolean(previous), ar: settings?.botLanguage === 'ar', staffId: staffUserId, staffAvatar: staff?.displayAvatarURL({ extension: 'png', size: 128 }),
        reviewerName: reviewer?.displayName || 'Member', reviewerAvatar: reviewer?.displayAvatarURL({ extension: 'png', size: 64 }), average: averageRating, count: ratingCount, pointsDelta: delta, source: 'discord',
      })],
    }).catch(() => undefined);
  }
  return { averageRating, ratingCount, updated: Boolean(previous), pointsDelta: delta };
}
