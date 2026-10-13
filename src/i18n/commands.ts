import { setCommandLocalization, type CommandDictionary, type OptionL10n } from '../lib/djs/localization.js';
import * as discipline from '../discipline/i18n.js';

/**
 * أسماء أوامر السلاش وأوصافها بالعربي.
 * الكود يعرّف الأوامر بأسماء داخلية إنجليزية (src/commands/definitions.ts وموديولات src/extensions) ويقارن عليها؛
 * هذا القاموس يبدّلها للعربي وقت التسجيل في Discord ويرجّعها للأسماء الداخلية لما يوصل التفاعل.
 * قواعد الاسم: ^[-_\p{L}\p{N}]{1,32}$ بدون مسافات ولا تشكيل (الشدّة والحركات مو مسموحة)، و _ بين الكلمات.
 * الوصف 100 حرف كحد أقصى.
 */

// خيارات تتكرر في أكثر من أمر.
const STAFF_MEMBER: OptionL10n = { name: 'الإداري', description: 'الإداري المقصود' };
const ADMIN_TARGET = (description: string): OptionL10n => ({ name: 'العضو', description });

export const commandsAr: CommandDictionary = {
  // ---- أوامر أساسية (src/commands/definitions.ts) -------------------------------------------------
  staff: {
    name: 'الستاف',
    description: 'ترتيب الستاف وإعداد السيرفر',
    options: {
      leaderboard: { name: 'الترتيب', description: 'ترتيب الستاف حسب النقاط' },
      setup: { name: 'إعداد', description: 'للأدمن: حدد رتب ورومات Rift في هذا السيرفر' },
    },
  },
  shift: {
    name: 'الشفت',
    description: 'شفتك وشفتات الفريق',
    options: {
      status: { name: 'حالة', description: 'شفتك الحالي واستراحاتك ووقتك لين الحين' },
      break: { name: 'استراحة', description: 'تبدأ أو تنهي استراحة (توقف 30 دقيقة وتنتهي تلقائيًا)' },
      history: {
        name: 'سجل_الشفتات',
        description: 'آخر 10 شفتات لك (الأدمن يقدر يشوف شفتات غيره)',
        options: { user: ADMIN_TARGET('للأدمن: شفتات مين تبي تشوف') },
      },
      stats: { name: 'المتواجدين', description: 'مين في الشفت الحين' },
      panel: { name: 'لوحة', description: 'ترسل لوحة الشفتات في هذا الروم' },
    },
  },
  rating: {
    name: 'التقييمات',
    description: 'تقييم الستاف',
    options: {
      panel: { name: 'لوحة', description: 'للأدمن: ترسل لوحة تقييم الستاف' },
      submit: {
        name: 'تقييم',
        description: 'تقيّم إداري من 1 إلى 5 نجوم',
        options: {
          staff: STAFF_MEMBER,
          score: { name: 'النجوم', description: 'عدد النجوم من 1 إلى 5' },
          comment: { name: 'تعليق', description: 'تعليق خاص (اختياري)' },
        },
      },
      stats: { name: 'ملخص', description: 'ملخص تقييمات إداري', options: { staff: STAFF_MEMBER } },
    },
  },
  complaint: {
    name: 'شكوى',
    description: 'الشكاوى على الستاف',
    options: {
      panel: { name: 'لوحة', description: 'للأدمن: ترسل لوحة الشكاوى' },
      submit: { name: 'تقديم', description: 'تقدّم شكوى سرية على إداري', options: { staff: STAFF_MEMBER } },
    },
  },
  report: {
    name: 'تقرير',
    description: 'تقارير الستاف',
    options: {
      submit: { name: 'رفع', description: 'تكتب تقرير: ملخص شفت أو حادثة أو تقرير عام' },
      history: { name: 'تقاريري', description: 'التقارير اللي رفعتها' },
      stats: { name: 'الأداء', description: 'كرت أداء فيه الساعات والفويس والرسائل والتقييم', options: { user: ADMIN_TARGET('للأدمن: كرت مين تبي تشوف') } },
      review: { name: 'مراجعة', description: 'للأدمن: التقارير اللي تنتظر مراجعة' },
      panel: { name: 'لوحة', description: 'للأدمن: ترسل لوحة التقارير في هذا الروم' },
    },
  },

  // ---- النواة (src/core/commands.ts) ----------------------------------------------------------------
  points: { name: 'النقاط', description: 'نقاطك ومن وين جات', options: { user: ADMIN_TARGET('إداري ثاني (للأدمن فقط)') } },
  leaderboard: { name: 'المتصدرين', description: 'أفضل 10 ستاف بالنقاط' },
  profile: { name: 'البروفايل', description: 'كرت أدائك', options: { user: ADMIN_TARGET('إداري ثاني (للأدمن فقط)') } },
  assist: {
    name: 'ساعدت_عضو',
    description: 'تسجّل إنك ساعدت عضو (+1 نقطة)',
    options: {
      member: { name: 'العضو', description: 'العضو اللي ساعدته' },
      type: {
        name: 'النوع',
        description: 'نوع المساعدة',
        choices: { 'General Support': 'دعم عام', Question: 'سؤال', Technical: 'مشكلة تقنية', Moderation: 'بلاغ / إشراف', Other: 'أخرى' },
      },
      note: { name: 'ملاحظة', description: 'ملاحظة قصيرة للإدارة' },
    },
  },
  rate: {
    name: 'تقييم',
    description: 'تقيّم إداري من 1 إلى 5 نجوم',
    options: {
      staff: STAFF_MEMBER,
      stars: {
        name: 'النجوم',
        description: 'كم نجمة تعطيه؟',
        choices: { 5: '★★★★★  ممتاز', 4: '★★★★  جيد جدًا', 3: '★★★  جيد', 2: '★★  يحتاج تحسين', 1: '★  ضعيف' },
      },
      comment: { name: 'تعليق', description: 'تعليق (اختياري)' },
    },
  },
  team: { name: 'الفريق', description: 'نظرة على الفريق: مين في الشفت ووش ينتظر مراجعة' },
  help: { name: 'مساعدة', description: 'وش تقدر تسوي مع Rift' },

  // ---- الإجازات والاستقالة (src/leave/commands.ts) ---------------------------------------------------
  leave: { name: 'إجازة', description: 'تطلب إجازة' },
  resign: { name: 'استقالة', description: 'تقدّم استقالتك' },
  requests: { name: 'طلباتي', description: 'طلبات الإجازة والاستقالة حقتك' },
};

// قواميس وكيل التأديب (src/discipline/i18n.ts): أي قاموس مُصدَّر هناك ينضم هنا.
const isDictionary = (value: unknown): value is CommandDictionary =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  && Object.values(value as Record<string, unknown>).every(entry => Boolean(entry) && typeof entry === 'object' && ('name' in (entry as object) || 'description' in (entry as object) || 'options' in (entry as object)));

const extra: CommandDictionary = Object.assign({}, ...Object.values(discipline as Record<string, unknown>).filter(isDictionary));

export const allCommandsAr: CommandDictionary = { ...commandsAr, ...extra };

setCommandLocalization(allCommandsAr);

/**
 * يحوّل مسار أمر داخلي ('shift status') لشكله العربي في Discord ('/الشفت حالة').
 * مفيد للنصوص اللي تذكر الأوامر (/help، رسائل الإرشاد).
 */
export function slashName(path: string) {
  const parts = path.trim().split(/\s+/);
  const out: string[] = [];
  let node: Record<string, OptionL10n> | undefined = allCommandsAr;
  for (const part of parts) {
    const entry: OptionL10n | undefined = node?.[part];
    out.push(entry?.name || part);
    node = entry?.options;
  }
  return `/${out.join(' ')}`;
}
