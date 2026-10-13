import { EmbedBuilder } from 'discord.js';

// The card posted to the ratings channel for every new (or updated) rating. A normal embed, one language only.
const LABELS = {
  5: { ar: 'ممتاز', en: 'Excellent', color: 0x4fc08d },
  4: { ar: 'جيد جدًا', en: 'Very good', color: 0x7cc46b },
  3: { ar: 'مقبول', en: 'Fair', color: 0xe0b04f },
  2: { ar: 'ضعيف', en: 'Poor', color: 0xe98a4f },
  1: { ar: 'سيئ', en: 'Bad', color: 0xe9697b },
} as const;

const TEXT = {
  newTitle: { ar: 'تقييم جديد', en: 'New rating' },
  updatedTitle: { ar: 'تقييم محدّث', en: 'Updated rating' },
  staff: { ar: 'عضو الفريق', en: 'Staff member' },
  comment: { ar: 'التعليق', en: 'Comment' },
  noComment: { ar: 'بدون تعليق', en: 'No comment' },
  average: { ar: 'المعدل', en: 'Average' },
  total: { ar: 'عدد التقييمات', en: 'Ratings' },
  points: { ar: 'النقاط', en: 'Points' },
  discord: { ar: 'عبر ديسكورد', en: 'via Discord' },
  web: { ar: 'عبر صفحة الدعم', en: 'via the support page' },
  by: { ar: 'من', en: 'From' },
} as const;

const say = (key: keyof typeof TEXT, ar: boolean) => TEXT[key][ar ? 'ar' : 'en'];
const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);
export const starsOf = (rating: number) => `${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}`;
const bar = (average: number) => { const filled = Math.max(0, Math.min(5, Math.round(average))); return `${'▰'.repeat(filled)}${'▱'.repeat(5 - filled)}`; };

export type RatingCardInput = {
  rating: number; comment?: string; updated?: boolean; ar: boolean;
  staffId: string; staffAvatar?: string | null;
  reviewerName: string; reviewerAvatar?: string | null;
  average?: number; count?: number; pointsDelta?: number;
  source: 'discord' | 'web';
};

export function buildRatingCard(input: RatingCardInput) {
  const rating = Math.max(1, Math.min(5, Math.round(input.rating))) as 1 | 2 | 3 | 4 | 5;
  const label = LABELS[rating];
  const { ar } = input;
  const comment = (input.comment || '').trim();
  const embed = new EmbedBuilder().setColor(label.color)
    .setAuthor({ name: clip(`${say(input.updated ? 'updatedTitle' : 'newTitle', ar)} · ${say('by', ar)} ${input.reviewerName}`, 256), iconURL: input.reviewerAvatar || undefined })
    .setTitle(`${starsOf(rating)}  ${rating}/5 · ${ar ? label.ar : label.en}`)
    .setDescription(`**${say('staff', ar)}:** <@${input.staffId}>\n\n**${say('comment', ar)}**\n${comment ? clip(comment, 900).replace(/\n/g, '\n> ').replace(/^/, '> ') : `*${say('noComment', ar)}*`}`)
    .setFooter({ text: say(input.source === 'web' ? 'web' : 'discord', ar) }).setTimestamp();
  if (input.staffAvatar) embed.setThumbnail(input.staffAvatar);
  const fields: { name: string; value: string; inline: boolean }[] = [];
  if (input.average !== undefined && input.count) fields.push({ name: `📈 ${say('average', ar)}`, value: `${bar(input.average)}  **${input.average.toFixed(2)}**/5`, inline: true }, { name: `🗂️ ${say('total', ar)}`, value: `**${input.count}**`, inline: true });
  if (input.pointsDelta) fields.push({ name: `🎯 ${say('points', ar)}`, value: `**${input.pointsDelta > 0 ? '+' : ''}${input.pointsDelta}**`, inline: true });
  if (fields.length) embed.addFields(fields);
  return embed;
}
