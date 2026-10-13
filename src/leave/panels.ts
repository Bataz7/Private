import { ActionRowBuilder, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, type Guild } from 'discord.js';
import { V2_FLAG, button, container, row, rtl, section, separator, text, thumbnail, type Raw } from '../utils/v2.js';
import { BRAND_COLOR } from '../utils/emoji.js';
import { leaveHistory, resignationHistory } from './requests.js';
import { stamp } from './util.js';

// ---- panels (Components V2) ------------------------------------------------------------------------
// 'leave_request' / 'resignation_request' open the forms; 'requests_mine' shows the member's own requests.
export const LEAVE_PANEL_TITLES = ['Staff Leave Panel', 'نظام الإجازات', 'Request leave', 'طلب إجازة'];
export const RESIGNATION_PANEL_TITLES = ['Staff Resignation', 'الاستقالة'];

export function buildLeavePanel(language: 'en' | 'ar' = 'en', guild?: Guild | null) {
  const ar = language === 'ar';
  const L = (en: string, arText: string) => (ar ? rtl(arText) : en);
  const icon = guild?.iconURL({ extension: 'png', size: 256 });
  const head = [`## 🏖️ ${ar ? 'طلب إجازة' : 'Request leave'}`, `-# ${guild?.name ? `${guild.name} · ` : ''}Rift Staff`];
  const parts: Raw[] = [
    icon ? section(head.map(line => (ar ? rtl(line) : line)), thumbnail(icon)) : text(L(head.join('\n'), head.join('\n'))),
    separator(),
    text(L('Need a break? Send a leave request here. Management reviews it and you get the answer in your DMs.', 'تحتاج إجازة؟ قدّم طلبك من هنا، والإدارة تراجعه ويوصلك الرد في الخاص.')),
    text(L(
      '**📋 How it works**\n1. Press **Request leave**\n2. Enter the dates and the reason\n3. Management approves or rejects it and tells you in DMs',
      '**📋 كيف تشتغل**\n1. اضغط **طلب إجازة**\n2. اكتب التاريخ والسبب\n3. الإدارة توافق أو ترفض وتعلمك في الخاص',
    )),
    text(L(
      '**⏸️ While you are away**\n- Your staff roles are paused and come back when you press **I came back** in your DMs\n- If you need more time after your leave ends, you can ask for an extension there',
      '**⏸️ وأنت في إجازة**\n- رتب الستاف توقف مؤقتًا وترجع لك لما تضغط زر **رجعت من الإجازة** في الخاص\n- لو احتجت وقتًا أطول بعد انتهاء الإجازة تقدر تطلب تمديد من نفس الرسالة',
    )),
    separator(true, true),
    row([
      button({ id: 'leave_request', label: ar ? 'طلب إجازة' : 'Request leave', style: 'primary', emoji: '🏖️' }),
      button({ id: 'requests_mine', label: ar ? 'طلباتي' : 'My requests', style: 'secondary', emoji: '📋' }),
    ]),
  ];
  return { flags: V2_FLAG, components: [container(parts, BRAND_COLOR)], allowedMentions: { parse: [] as never[] } };
}

export function buildResignationPanel(language: 'en' | 'ar' = 'en', guild?: Guild | null) {
  const ar = language === 'ar';
  const L = (en: string, arText: string) => (ar ? rtl(arText) : en);
  const icon = guild?.iconURL({ extension: 'png', size: 256 });
  const head = [`## 🚪 ${ar ? 'الاستقالة' : 'Resignation'}`, `-# ${guild?.name ? `${guild.name} · ` : ''}Rift Staff`];
  const parts: Raw[] = [
    icon ? section(head.map(line => (ar ? rtl(line) : line)), thumbnail(icon)) : text(L(head.join('\n'), head.join('\n'))),
    separator(),
    text(L('Leaving the team is a big decision, so take your time. If it is only for a while, a leave may suit you better.', 'قرار الاستقالة مهم، فخذ وقتك. ولو ظرفك مؤقت، يمكن الإجازة تناسبك أكثر.')),
    text(L(
      '**📋 Steps**\n1. Press **Submit resignation**\n2. Enter your last working day and the reason\n3. Management reviews it and replies in your DMs',
      '**📋 الخطوات**\n1. اضغط **تقديم استقالة**\n2. اكتب آخر يوم لك والسبب\n3. الإدارة تراجع طلبك وترد عليك في الخاص',
    )),
    text(L(
      '**💡 Good to know**\n- Only your staff role is removed; your other roles stay\n- On your last day you confirm the resignation in your DMs\n- You can have one open request at a time',
      '**💡 حلو تعرف**\n- تنشال رتبة الستاف بس، وباقي رتبك تبقى\n- في آخر يوم لك تأكد الاستقالة من رسالة الخاص\n- يكون عندك طلب واحد مفتوح بكل مرة',
    )),
    separator(true, true),
    row([
      button({ id: 'resignation_request', label: ar ? 'تقديم استقالة' : 'Submit resignation', style: 'danger', emoji: '🚪' }),
      button({ id: 'leave_request', label: ar ? 'طلب إجازة بدلها' : 'Request leave instead', style: 'secondary', emoji: '🏖️' }),
      button({ id: 'requests_mine', label: ar ? 'طلباتي' : 'My requests', style: 'secondary', emoji: '📋' }),
    ]),
  ];
  return { flags: V2_FLAG, components: [container(parts, BRAND_COLOR)], allowedMentions: { parse: [] as never[] } };
}

// ---- forms -----------------------------------------------------------------------------------------
// Field ids are read by the 'leave_modal' and 'resignation_modal' handlers in interactions.ts.
const today = () => new Date().toISOString().slice(0, 10);
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const input = (id: string, label: string, style: TextInputStyle, required: boolean, placeholder: string, max: number) =>
  new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required).setPlaceholder(placeholder).setMaxLength(max));

export function leaveModal(language: string) {
  const ar = language === 'ar';
  return new ModalBuilder().setCustomId('leave_modal').setTitle(ar ? 'طلب إجازة' : 'Request leave').addComponents(
    input('start', ar ? 'من تاريخ (سنة-شهر-يوم)' : 'From (YYYY-MM-DD)', TextInputStyle.Short, true, today(), 10),
    input('end', ar ? 'إلى تاريخ (سنة-شهر-يوم)' : 'To (YYYY-MM-DD)', TextInputStyle.Short, true, inDays(3), 10),
    input('reason', ar ? 'السبب' : 'Reason', TextInputStyle.Paragraph, true, ar ? 'مثال: سفر، اختبارات، ظرف عائلي' : 'e.g. travel, exams, family', 1000),
  );
}

export function resignationModal(language: string) {
  const ar = language === 'ar';
  return new ModalBuilder().setCustomId('resignation_modal').setTitle(ar ? 'تقديم استقالة' : 'Submit resignation').addComponents(
    input('last_day', ar ? 'آخر يوم لك (سنة-شهر-يوم)' : 'Last working day (YYYY-MM-DD)', TextInputStyle.Short, true, inDays(7), 10),
    input('reason', ar ? 'السبب' : 'Reason', TextInputStyle.Paragraph, true, ar ? 'ليش حاب تستقيل؟' : 'Why are you resigning?', 1000),
    input('notes', ar ? 'ملاحظات (اختياري)' : 'Notes (optional)', TextInputStyle.Paragraph, false, ar ? 'أي شي تحب الإدارة تعرفه' : 'Anything management should know', 1000),
  );
}

export function extendModal(id: number | string, ar: boolean) {
  return new ModalBuilder().setCustomId(`leave_extend_modal:${id}`).setTitle(ar ? 'طلب وقت إضافي' : 'Ask for more time')
    .addComponents(input('end_date', ar ? 'تاريخ الانتهاء الجديد (YYYY-MM-DD)' : 'New end date (YYYY-MM-DD)', TextInputStyle.Short, true, inDays(3), 10));
}

export function adminExtendModal(id: number | string) {
  return new ModalBuilder().setCustomId(`leave_admin_extend_modal:${id}`).setTitle('Extend leave').addComponents(
    input('end_date', 'New end date (YYYY-MM-DD)', TextInputStyle.Short, true, inDays(3), 10),
    input('note', 'Note for the member (optional)', TextInputStyle.Paragraph, false, 'Shown to the member in the DM', 500),
  );
}

// ---- a member's own requests: /requests and the "My requests" panel button -------------------------
const STATUS: Record<string, [string, string, string]> = {
  pending: ['⏳', 'Waiting for review', 'بانتظار المراجعة'], approved: ['✅', 'Approved', 'مقبول'], accepted: ['✅', 'Completed', 'اكتمل'], rejected: ['❌', 'Rejected', 'مرفوض'],
  returned: ['🟢', 'Returned', 'عاد'],
};
const statusText = (status: string, ar: boolean) => { const item = STATUS[status] || ['•', status, status]; return `${item[0]} ${ar ? item[2] : item[1]}`; };

export async function myRequestsEmbed(guildId: string, userId: string, ar: boolean) {
  const t = (en: string, arText: string) => (ar ? arText : en);
  const [leaves, resignations] = await Promise.all([leaveHistory(guildId, userId, 5), resignationHistory(guildId, userId, 3)]);
  return new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`📋 ${t('Your requests', 'طلباتك')}`).addFields(
    { name: t('Leave', 'الإجازات'), value: leaves.length ? leaves.map(item => `🏖️ ${stamp(item.startDate, 'd')} → ${stamp(item.endDate, 'd')} · ${statusText(item.status, ar)}`).join('\n') : t('None yet.', 'ما فيه بعد.') },
    { name: t('Resignation', 'الاستقالة'), value: resignations.length ? resignations.map(item => `🚪 ${t('Last day', 'آخر يوم')} ${stamp(item.lastWorkingDay, 'd')} · ${statusText(item.status, ar)}`).join('\n') : t('None.', 'ما فيه.') },
  );
}
