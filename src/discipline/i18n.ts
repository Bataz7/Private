import type { CommandDictionary } from '../lib/djs/localization.js';

// أسماء أوامر التأديب واللوحة الأسبوعية بالعربي (src/i18n/commands.ts يدمج كل قاموس مُصدَّر هنا).
// الأسماء: حروف صغيرة، بدون مسافات ولا تشكيل، 32 حرف كحد أقصى.

const MEMBER = (description: string) => ({ name: 'العضو', description });

export const disciplineCommandsAr: CommandDictionary = {
  dismiss: {
    name: 'فصل', description: 'فصل إداري من الستاف (يطلب تأكيد)',
    options: {
      user: MEMBER('الإداري اللي بتفصله'),
      reason: { name: 'السبب', description: 'سبب الفصل (يوصله بالخاص)' },
      reset_points: { name: 'تصفير_النقاط', description: 'تصفّر نقاطه؟' },
    },
  },
  reinstate: {
    name: 'الغاء_فصل', description: 'ترجّع إداري مفصول للستاف',
    options: {
      user: MEMBER('العضو المفصول'),
      reason: { name: 'السبب', description: 'سبب إلغاء الفصل (اختياري)' },
      restore_role: { name: 'ارجاع_الرتبة', description: 'ترجّع له رتبة الستاف؟ (الافتراضي نعم)' },
    },
  },
  dismissed: { name: 'المفصولين', description: 'قائمة آخر المفصولين من الستاف' },
  warn: {
    name: 'انذار', description: 'إنذار إداري (لما توصل الإنذارات للحد ينفصل تلقائياً)',
    options: {
      user: MEMBER('الإداري'),
      reason: { name: 'السبب', description: 'سبب الإنذار' },
    },
  },
  'staff-sync': {
    name: 'مزامنة_الستاف', description: 'مزامنة قائمة الستاف مع رتبة الستاف في الديسكورد',
    options: {
      mode: { name: 'الطريقة', description: 'مزامنة عادية أو مسح كامل وإعادة تسجيل', choices: { sync: 'مزامنة (تحفظ النقاط)', wipe: 'مسح كامل وإعادة تسجيل' } },
    },
  },
};

export const leaderboardCommandsAr: CommandDictionary = {
  'weekly-board': {
    name: 'لوحة_الاسبوع', description: 'تحدد روم لوحة متصدرين الأسبوع (تتحدث كل 10 دقايق)',
    options: {
      channel: { name: 'الروم', description: 'الروم (الافتراضي: هذا الروم)' },
      off: { name: 'ايقاف', description: 'توقف اللوحة' },
    },
  },
  'weekly-top': { name: 'متصدرين_الاسبوع', description: 'أفضل 10 ستاف بنقاط هذا الأسبوع' },
};
