import { EmbedBuilder, type ButtonInteraction } from '../lib/djs/index.js';
import { Shift } from '../models/Shift.js';
import { activeMs, duration } from '../services/shift.service.js';
import { shiftAutoKind } from '../services/auto-shift.service.js';
import { discordDate } from '../utils/format.js';
import { isManagement } from '../utils/permissions.js';
import { CARD_BUTTON, staffTier } from '../utils/staff-card.js';
import { rtl } from '../utils/v2.js';
import { pointsBreakdown } from './points.js';

// أزرار بطاقة الستاف: «سجل الشفتات» و«النقاط». الرد مخفي، وبس صاحب البطاقة أو الإدارة يشوفونه.
const PART: Record<string, string> = { shift: '⏱️ وقت الشفت', messages: '💬 الرسائل في الشفت', voice: '🎧 الفويس في الشفت', assist: '🤝 مساعدة الأعضاء', rating: '⭐ التقييمات', modreport: '🛡️ تقارير المود', complaint: '⚠️ الشكاوى', manual: '📝 تعديلات يدوية ونقاط قديمة' };

export async function handleCardButton(i: ButtonInteraction) {
  if (!i.customId.startsWith(`${CARD_BUTTON}:`)) return false;
  const [, action, userId] = i.customId.split(':');
  if (!i.guild || !userId || (action !== 'shifts' && action !== 'points')) { await i.reply({ content: 'هذا الزر قديم.', flags: 64 }); return true; }
  if (userId !== i.user.id) {
    const viewer = await i.guild.members.fetch(i.user.id).catch(() => null);
    if (!viewer || !await isManagement(viewer)) { await i.reply({ content: 'بس صاحب البطاقة أو الإدارة يقدرون يشوفون هذا.', flags: 64 }); return true; }
  }
  if (action === 'shifts') {
    const rows = await Shift.find({ guildId: i.guild.id, userId }).sort({ startedAt: -1 }).limit(10);
    const active = rows.find(row => row.status === 'active');
    const kind = active ? await shiftAutoKind(active).catch(() => null) : null;
    const lines = rows.map(s => `• ${discordDate(s.startedAt)} → ${s.endedAt ? discordDate(s.endedAt) : `🟢 نشط${kind && s === active ? ' · 🤖 تلقائي' : ''}`} — **${duration(activeMs(s))}**`);
    const total = rows.reduce((sum, s) => sum + activeMs(s), 0);
    await i.reply({ flags: 64, allowedMentions: { parse: [] }, embeds: [new EmbedBuilder().setColor(0x8175f5).setTitle('📋 سجل الشفتات')
      .setDescription(rtl(rows.length ? `<@${userId}> · آخر ${rows.length} شفت · المجموع **${duration(total)}**\n\n${lines.join('\n')}` : 'ما فيه شفتات بعد.'))] });
    return true;
  }
  const breakdown = await pointsBreakdown(i.guild.id, userId).catch(() => null);
  if (!breakdown) { await i.reply({ content: 'هذا العضو مو في قائمة الستاف بعد.', flags: 64 }); return true; }
  const tier = staffTier(breakdown.total);
  const lines = breakdown.parts.filter(part => part.points).map(part => `${PART[part.key] || `• ${part.key}`}: **${part.points > 0 ? '+' : ''}${part.points}**`);
  await i.reply({ flags: 64, allowedMentions: { parse: [] }, embeds: [new EmbedBuilder().setColor(tier.color).setTitle('💎 النقاط')
    .setDescription(rtl([`<@${userId}>`, `## ${tier.emoji} ${breakdown.total} نقطة · ${tier.name}`, tier.next ? `-# باقي ${tier.remaining} نقطة للـ ${tier.next.emoji} ${tier.next.name}` : '-# 👑 أعلى درجة', '', '**من وين جات**', ...(lines.length ? lines : ['ما فيه شي بعد.'])].join('\n')))] });
  return true;
}
