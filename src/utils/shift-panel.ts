import { ActionRowBuilder, EmbedBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from '../lib/djs/index.js';
import { rtl } from './v2.js';

export interface ShiftPanelOptions { messages?: number; windowMinutes?: number; idleMinutes?: number; enabled?: boolean }

export function buildShiftPanel(options: ShiftPanelOptions = {}) {
  const messages = options.messages ?? 20;
  const windowMinutes = options.windowMinutes ?? 10;
  const idleMinutes = options.idleMinutes ?? 30;
  const menu = new StringSelectMenuBuilder()
    .setCustomId('shift_panel_action')
    .setPlaceholder('تحكّم في شفتك…')
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel('ابدأ الشفت').setDescription('سجّل دخولك الحين').setEmoji('▶️').setValue('start'),
      new StringSelectMenuOptionBuilder().setLabel('أنهِ الشفت').setDescription('سجّل خروجك وخلّص شفتك').setEmoji('⏹️').setValue('end'),
      new StringSelectMenuOptionBuilder().setLabel('استراحة / استئناف').setDescription('وقّف شفتك مؤقتًا أو كمّله').setEmoji('⏸️').setValue('break'),
      new StringSelectMenuOptionBuilder().setLabel('إحصائياتي').setDescription('شفتك الحالي وساعاتك الأخيرة').setEmoji('📊').setValue('stats'),
      new StringSelectMenuOptionBuilder().setLabel('مين في الشفت').setDescription('شوف الستاف اللي في الشفت الحين').setEmoji('🛡️').setValue('active')
    );
  const automatic = options.enabled === false
    ? '⏸️ الشفت التلقائي مقفل في هذا السيرفر. ابدأ شفتك وأنهه من القائمة.'
    : [
      `▶️ **يبدأ تلقائيًا** لما ترسل **${messages} رسالة** خلال **${windowMinutes} دقيقة**، أو تدخل روم صوتي وأنت مو ميوت.`,
      `⏹️ **ينتهي تلقائيًا** بعد **${idleMinutes} دقيقة** بدون رسائل أو نشاط صوتي. وقت الخمول ما ينحسب أبد.`,
    ].join('\n');
  return {
    embeds: [new EmbedBuilder()
      .setColor(0x8175f5)
      .setTitle('⏱️ لوحة شفتات الستاف')
      .setDescription(rtl(`شفتاتك تشتغل لحالها. استخدم القائمة بس لما تبي تتحكم بنفسك.\n\n${automatic}`))
      .addFields(
        { name: '🕒 الإنهاء اليدوي', value: 'بعد 30 دقيقة على الأقل', inline: true },
        { name: '⌛ أطول شفت', value: '12 ساعة', inline: true },
        { name: '💎 النقاط', value: 'نقطة لكل 30 دقيقة شفت · 3 نقاط لكل 100 رسالة · نقطة لكل 30 دقيقة في الفويس', inline: false }
      )
      .setFooter({ text: 'عمليات ستاف Rift' })],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)]
  };
}
