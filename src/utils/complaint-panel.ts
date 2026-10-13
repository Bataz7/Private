import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from '../lib/djs/index.js';

export function buildComplaintPanel(language: 'en' | 'ar' = 'ar') {
  const ar = language !== 'en';
  return {
    embeds: [new EmbedBuilder()
      .setColor(0x8175f5)
      .setTitle(ar ? '📩 مركز الشكاوى' : '📩 Complaints & Reports Center')
      .setDescription(ar
        ? 'من هنا تقدر ترسل شكوى رسمية وسرية للإدارة، وكل شكوى تنعامل بجدية وحسب الإجراءات المعتمدة.\n\n**قبل ما ترسل**\n• اختر الإداري المعني بالشكوى\n• اشرح وش صار بالتفصيل والوقت التقريبي\n• أرفق الدليل أو رابط الرسالة إن وجد\n\nبتتحول شكواك للإدارة عشان يراجعونها ويتخذون الإجراء المناسب.'
        : 'Use this center to submit a private report to management. Every report is handled seriously and reviewed through the official process.\n\n**Before submitting**\n• Select the registered staff member involved\n• Describe what happened and when\n• Add evidence or a message link if available\n\nYour report will be forwarded to management for review and appropriate action.')
      .setFooter({ text: ar ? 'عمليات ستاف Rift • شكواك تبقى سرية' : 'Rift Staff Operations • Your report stays private' })],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('complaint_panel_submit')
        .setLabel(ar ? 'إرسال شكوى جديدة' : 'Submit a Report')
        .setEmoji('📝')
        .setStyle(ButtonStyle.Primary)
    )]
  };
}
