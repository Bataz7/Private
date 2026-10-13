import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Guild, StringSelectMenuBuilder } from '../lib/djs/index.js';
import { GuildSettings } from '../models/GuildSettings.js';

const TEXT = {
  en: {
    placeholder: (page: number, pages: number) => `Choose a staff member (${page}/${pages})`,
    user: (name: string) => `@${name}`,
    previous: 'Previous', next: 'Next',
    title: '⭐ Rate our staff',
    description: 'Tell us how a staff member treated you. Pick them from the menu, give 1 to 5 stars and add an optional comment.\nYour rating helps keep the team at its best.',
    staff: 'Staff members', page: 'Page', how: 'How points work',
    points: '⭐⭐⭐⭐⭐  5 stars = **3 points**\n⭐⭐⭐⭐  4 stars = **2 points**\n⭐⭐⭐  3 stars = **1 point**',
    footer: 'Rift Staff · this list refreshes every 30 seconds',
  },
  ar: {
    placeholder: (page: number, pages: number) => `اختر الإداري (${page}/${pages})`,
    user: (name: string) => `يوزر: @${name}`,
    previous: 'السابق', next: 'التالي',
    title: '⭐ قيّم فريق الستاف',
    description: 'شاركنا رأيك في تعامل الإداري معك. اختره من القائمة، ثم أعطه من 1 إلى 5 نجوم واكتب ملاحظة اختيارية.\nتقييمك يساعد على إبقاء الفريق في أفضل مستوى.',
    staff: 'عدد الستاف', page: 'الصفحة', how: 'طريقة احتساب النقاط',
    points: '⭐⭐⭐⭐⭐  5 نجوم = **3 نقاط**\n⭐⭐⭐⭐  4 نجوم = **نقطتان**\n⭐⭐⭐  3 نجوم = **نقطة**',
    footer: 'Rift Staff · تتحدث القائمة تلقائيًا كل 30 ثانية',
  },
} as const;

export async function buildRatingPanel(guild: Guild, page = 0) {
  const settings = await GuildSettings.findOne({ guildId: guild.id });
  if (!settings) return null;
  const t = TEXT[settings.botLanguage === 'ar' ? 'ar' : 'en'];
  const membersCache = guild.members.cache.size ? guild.members.cache : await guild.members.fetch();
  const allMembers = membersCache.filter(member => member.roles.cache.has(settings.staffRoleId) && !member.user.bot);
  const members = [...allMembers.values()];
  if (!members.length) return null;
  const pageSize = 25;
  const pageCount = Math.max(1, Math.ceil(members.length / pageSize));
  const safePage = Math.min(Math.max(page, 0), pageCount - 1);
  const pageMembers = members.slice(safePage * pageSize, (safePage + 1) * pageSize);
  const menu = new StringSelectMenuBuilder().setCustomId('rating_panel_staff').setPlaceholder(t.placeholder(safePage + 1, pageCount)).addOptions(pageMembers.map(member => ({ label: member.displayName.slice(0, 100), value: member.id, description: t.user(member.user.username).slice(0, 100) })));
  const components: ActionRowBuilder<any>[] = [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)];
  if (pageCount > 1) components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`rating_panel_page:${safePage - 1}`).setLabel(t.previous).setStyle(ButtonStyle.Secondary).setDisabled(safePage === 0),
    new ButtonBuilder().setCustomId(`rating_panel_page:${safePage + 1}`).setLabel(t.next).setStyle(ButtonStyle.Primary).setDisabled(safePage === pageCount - 1)
  ));
  return {
    embeds: [new EmbedBuilder().setColor(0x8175f5).setTitle(t.title).setDescription(t.description)
      .addFields({ name: t.staff, value: String(members.length), inline: true }, { name: t.page, value: `${safePage + 1} / ${pageCount}`, inline: true }, { name: t.how, value: t.points, inline: false })
      .setFooter({ text: t.footer }).setTimestamp()],
    components
  };
}
