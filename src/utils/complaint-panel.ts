import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

export function buildComplaintPanel(language: 'en' | 'ar' = 'en') {
  const ar = language === 'ar';
  return {
    embeds: [new EmbedBuilder()
      .setColor(0x8175f5)
      .setTitle(ar ? '📩 مركز الشكاوى والإبلاغ' : '📩 Complaints & Reports Center')
      .setDescription(ar
        ? 'استخدم هذا المركز لإرسال بلاغ رسمي وسري إلى الإدارة. سيتم التعامل مع البلاغ بجدية ووفق الإجراءات المعتمدة.\n\n**قبل الإرسال**\n• اختر الإداري المسجّل المعني بالبلاغ\n• اشرح الواقعة بالتفصيل والوقت التقريبي\n• أرفق الدليل أو رابط الرسالة إن وجد\n\nسيتم تحويل البلاغ إلى الإدارة للمراجعة واتخاذ الإجراء المناسب.'
        : 'Use this center to submit a private report to management. Every report is handled seriously and reviewed through the official process.\n\n**Before submitting**\n• Select the registered staff member involved\n• Describe what happened and when\n• Add evidence or a message link if available\n\nYour report will be forwarded to management for review and appropriate action.')
      .setFooter({ text: ar ? 'Rift Staff Operations • بلاغك يبقى خاصًا' : 'Rift Staff Operations • Your report stays private' })],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('complaint_panel_submit')
        .setLabel(ar ? 'إرسال بلاغ جديد' : 'Submit a Report')
        .setEmoji('📝')
        .setStyle(ButtonStyle.Primary)
    )]
  };
}
