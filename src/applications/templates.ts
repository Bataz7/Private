import { DEFAULT_SETTINGS, newQuestionId, type FormDefinition, type Question } from './questions.js';

const q = (partial: Partial<Question> & Pick<Question, 'type' | 'label'>): Question => ({
  id: newQuestionId(), description: '', required: true, placeholder: '', options: [], min: null, max: null, minLabel: '', maxLabel: '', showIf: null, ...partial,
});

// Arabic templates first (Arabic form language), then the English ones, then a blank form.
export const TEMPLATE_KEYS = ['staff', 'support', 'staff-en', 'support-en', 'blank'] as const;
export type TemplateKey = typeof TEMPLATE_KEYS[number];

export function buildTemplate(key: string): FormDefinition {
  const arabic = { ...DEFAULT_SETTINGS, language: 'ar' as const };
  const english = { ...DEFAULT_SETTINGS, language: 'en' as const };
  if (key === 'blank') {
    return { title: 'تقديم بدون عنوان', description: '', open: false, settings: arabic, questions: [q({ type: 'short', label: 'سؤال بدون عنوان' })] };
  }
  if (key === 'support-en') {
    const helped = q({ type: 'yesno', label: 'Have you worked on a support team before?' });
    return {
      title: 'Support team application', open: false, settings: english,
      description: 'Join the support team and help members solve their problems. Answer honestly and clearly.',
      questions: [
        q({ type: 'short', label: 'What is your name, or the name you prefer we call you?', max: 60 }),
        q({ type: 'number', label: 'How old are you?', min: 13, max: 80 }),
        helped,
        q({ type: 'paragraph', label: 'Describe your support experience', showIf: { questionId: helped.id, values: ['yes'] }, min: 30 }),
        q({ type: 'checkbox', label: 'When are you usually online?', options: ['Morning', 'Afternoon', 'Evening', 'Late night'], min: 1 }),
        q({ type: 'paragraph', label: 'A member angrily complains about a problem that has been open for two days. How do you handle it?', min: 50 }),
        q({ type: 'scale', label: 'Rate your patience when dealing with members', min: 1, max: 10, minLabel: 'Low', maxLabel: 'Very high' }),
      ],
    };
  }
  if (key === 'staff-en') {
    const experience = q({ type: 'yesno', label: 'Do you have previous moderation experience?' });
    return {
      title: 'Staff application', open: false, settings: english,
      description: 'Thank you for your interest in joining the staff team. Please answer every question honestly and in detail; very short answers lower your chances.',
      questions: [
        q({ type: 'section', label: 'About you', required: false }),
        q({ type: 'short', label: 'What is your name?', max: 60, placeholder: 'e.g. Alex' }),
        q({ type: 'number', label: 'How old are you?', min: 13, max: 80 }),
        q({ type: 'dropdown', label: 'Which region are you in?', options: ['North America', 'South America', 'Europe', 'Middle East', 'Africa', 'Asia', 'Oceania', 'Other'] }),
        q({ type: 'checkbox', label: 'When are you usually online?', options: ['Morning', 'Afternoon', 'Evening', 'Late night'], min: 1 }),
        q({ type: 'number', label: 'How many hours per day can you be active?', min: 1, max: 24 }),
        q({ type: 'section', label: 'Experience', required: false }),
        experience,
        q({ type: 'paragraph', label: 'List the servers you moderated and your role in each', showIf: { questionId: experience.id, values: ['yes'] }, min: 20 }),
        q({ type: 'paragraph', label: 'Why do you want to join the staff team?', min: 50, placeholder: 'Write a detailed answer...' }),
        q({ type: 'paragraph', label: 'What sets you apart from other applicants?', min: 30 }),
        q({ type: 'section', label: 'Scenarios', required: false, description: 'Tell us how you would act in these situations.' }),
        q({ type: 'paragraph', label: 'A member is insulting others in the general chat. What do you do?', min: 30 }),
        q({ type: 'paragraph', label: 'Another staff member is abusing their permissions. How do you react?', min: 30 }),
        q({ type: 'scale', label: 'How well do you know the server rules?', min: 1, max: 10, minLabel: 'Weak', maxLabel: 'Excellent' }),
        q({ type: 'yesno', label: 'Do you promise to follow the staff rules and keep private information confidential?' }),
      ],
    };
  }
  if (key === 'support') {
    const helped = q({ type: 'yesno', label: 'هل سبق لك العمل في فريق دعم فني؟' });
    return {
      title: 'التقديم على فريق الدعم', open: false, settings: arabic,
      description: 'انضم لفريق الدعم وساعد الأعضاء في حل مشاكلهم. أجب بصدق ووضوح.',
      questions: [
        q({ type: 'short', label: 'ما اسمك أو الاسم الذي تفضل أن نناديك به؟', max: 60 }),
        q({ type: 'number', label: 'كم عمرك؟', min: 13, max: 80 }),
        helped,
        q({ type: 'paragraph', label: 'اذكر خبرتك في الدعم الفني', showIf: { questionId: helped.id, values: ['yes'] }, min: 30 }),
        q({ type: 'checkbox', label: 'في أي أوقات تكون متواجدًا؟', options: ['الصباح', 'الظهر', 'المساء', 'منتصف الليل'], min: 1 }),
        q({ type: 'paragraph', label: 'عضو يشتكي بغضب من مشكلة لم تُحل منذ يومين. كيف ستتعامل معه؟', min: 50 }),
        q({ type: 'scale', label: 'قيّم صبرك في التعامل مع الأعضاء', min: 1, max: 10, minLabel: 'قليل', maxLabel: 'عالٍ جدًا' }),
      ],
    };
  }
  const experience = q({ type: 'yesno', label: 'هل لديك خبرة سابقة في الإدارة؟' });
  return {
    title: 'التقديم على الإدارة', open: false, settings: arabic,
    description: 'شكرًا لاهتمامك بالانضمام لفريق الإدارة. يرجى الإجابة على جميع الأسئلة بصدق وبتفصيل، فالإجابات المختصرة جدًا تقلل فرص القبول.',
    questions: [
      q({ type: 'section', label: 'معلومات عامة', required: false }),
      q({ type: 'short', label: 'ما اسمك؟', max: 60, placeholder: 'مثال: محمد' }),
      q({ type: 'number', label: 'كم عمرك؟', min: 13, max: 80 }),
      q({ type: 'dropdown', label: 'من أي دولة أنت؟', options: ['السعودية', 'الإمارات', 'الكويت', 'قطر', 'البحرين', 'عُمان', 'مصر', 'الأردن', 'العراق', 'المغرب', 'الجزائر', 'أخرى'] }),
      q({ type: 'checkbox', label: 'في أي أوقات تكون متواجدًا؟', options: ['الصباح', 'الظهر', 'المساء', 'منتصف الليل'], min: 1 }),
      q({ type: 'number', label: 'كم ساعة تستطيع التواجد يوميًا؟', min: 1, max: 24 }),
      q({ type: 'section', label: 'الخبرة', required: false }),
      experience,
      q({ type: 'paragraph', label: 'اذكر السيرفرات التي عملت فيها ومنصبك فيها', showIf: { questionId: experience.id, values: ['yes'] }, min: 20 }),
      q({ type: 'paragraph', label: 'لماذا تريد الانضمام لفريق الإدارة؟', min: 50, placeholder: 'اكتب إجابة مفصلة...' }),
      q({ type: 'paragraph', label: 'ما الذي يميزك عن باقي المتقدمين؟', min: 30 }),
      q({ type: 'section', label: 'مواقف', required: false, description: 'أخبرنا كيف تتصرف في هذه المواقف.' }),
      q({ type: 'paragraph', label: 'عضو يسب الأعضاء في الشات العام. ماذا تفعل؟', min: 30 }),
      q({ type: 'paragraph', label: 'إداري آخر يسيء استخدام صلاحياته. كيف تتصرف؟', min: 30 }),
      q({ type: 'scale', label: 'كيف تقيّم معرفتك بقوانين السيرفر؟', min: 1, max: 10, minLabel: 'ضعيفة', maxLabel: 'ممتازة' }),
      q({ type: 'yesno', label: 'هل تتعهد بالالتزام بقوانين الإدارة وسرية المعلومات؟' }),
    ],
  };
}
