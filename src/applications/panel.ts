import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { answerable } from './questions.js';
import { t } from './i18n.js';
import { applyUrl, colorOf, formSettings } from '../services/application.service.js';
import type { ApplicationFormDoc } from '../models/Application.js';

// The public "Apply" message posted in a server channel. Its buttons start a DM application or open the web form.
export function buildApplicationPanel(form: ApplicationFormDoc) {
  const s = formSettings(form);
  const lang = s.language;
  const closed = !form.open || Boolean(s.closesAt && new Date(s.closesAt).getTime() < Date.now());
  const embed = new EmbedBuilder()
    .setColor(colorOf(s))
    .setTitle(`📝 ${s.panelTitle || form.title}`.slice(0, 256))
    .setDescription((s.panelDescription || form.description || t(lang, 'panelDefault')).slice(0, 4000))
    .addFields(
      { name: t(lang, 'panelQuestions'), value: String(answerable(form.questions).length), inline: true },
      { name: t(lang, 'panelStatus'), value: closed ? t(lang, 'closed') : t(lang, 'open'), inline: true },
    )
    .setFooter({ text: s.mode === 'web' ? t(lang, 'panelFooterWeb') : t(lang, 'panelFooter') });
  if (s.closesAt && !closed) embed.addFields({ name: lang === 'ar' ? 'يغلق' : 'Closes', value: `<t:${Math.floor(new Date(s.closesAt).getTime() / 1000)}:R>`, inline: true });
  if (s.bannerUrl) embed.setImage(s.bannerUrl);
  const row = new ActionRowBuilder<ButtonBuilder>();
  if (s.mode !== 'web') row.addComponents(new ButtonBuilder().setCustomId(`app_apply:${form.id}`).setLabel((s.panelButtonLabel || t(lang, 'apply')).slice(0, 80)).setEmoji('📝').setStyle(ButtonStyle.Primary).setDisabled(closed));
  if (s.mode !== 'dm' && /^https?:\/\//.test(applyUrl(form.id))) row.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(t(lang, 'applyWeb')).setEmoji('🌐').setURL(applyUrl(form.id)));
  return { embeds: [embed], components: row.components.length ? [row] : [] };
}
