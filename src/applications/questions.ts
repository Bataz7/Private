// Shared application-form engine: question types, form sanitising, answer validation and visibility.
// Used by the bot (DM applications), the dashboard API (form builder) and the public web form.

export const QUESTION_TYPES = ['section', 'short', 'paragraph', 'number', 'url', 'date', 'choice', 'dropdown', 'checkbox', 'yesno', 'scale'] as const;
export type QuestionType = typeof QUESTION_TYPES[number];

export interface ShowIf { questionId: string; values: string[] }
export interface Question {
  id: string;
  type: QuestionType;
  label: string;
  description: string;
  required: boolean;
  placeholder: string;
  options: string[];
  min: number | null;
  max: number | null;
  minLabel: string;
  maxLabel: string;
  showIf: ShowIf | null;
}

export type Language = 'ar' | 'en';
export type DeliveryMode = 'dm' | 'web' | 'both';

export interface FormSettings {
  mode: DeliveryMode;
  language: Language;
  color: string;
  bannerUrl: string;
  reviewChannelId: string;
  pingRoleId: string;
  reviewerRoleIds: string[];
  reviewThread: boolean;
  acceptRoleIds: string[];
  removeRoleIds: string[];
  addAsStaff: boolean;
  requiredRoleIds: string[];
  blockedRoleIds: string[];
  minAccountAgeDays: number;
  minMemberDays: number;
  cooldownDays: number;
  maxResponses: number;
  closesAt: string | null;
  dmTimeoutMinutes: number;
  acceptMessage: string;
  rejectMessage: string;
  shareRejectReason: boolean;
  confirmationMessage: string;
  panelTitle: string;
  panelDescription: string;
  panelButtonLabel: string;
}

export interface FormDefinition {
  title: string;
  description: string;
  open: boolean;
  questions: Question[];
  settings: FormSettings;
}

export const LIMITS = { questions: 40, options: 25, label: 300, description: 1000, short: 300, paragraph: 4000, title: 100, formDescription: 2000, message: 1500 };

const ID_RE = /^[a-z0-9]{4,16}$/i;
const SNOWFLAKE = /^\d{15,22}$/;

export function newQuestionId() {
  return Array.from({ length: 8 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
}

const text = (value: unknown, max: number) => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
const int = (value: unknown, fallback: number, min: number, max: number) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const optionalNumber = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const snowflakes = (value: unknown) => [...new Set((Array.isArray(value) ? value : []).map(item => String(item)).filter(item => SNOWFLAKE.test(item)))].slice(0, 15);
const snowflake = (value: unknown) => (SNOWFLAKE.test(String(value ?? '')) ? String(value) : '');

export const DEFAULT_SETTINGS: FormSettings = {
  mode: 'both', language: 'ar', color: '#8175f5', bannerUrl: '',
  reviewChannelId: '', pingRoleId: '', reviewerRoleIds: [], reviewThread: true,
  acceptRoleIds: [], removeRoleIds: [], addAsStaff: true,
  requiredRoleIds: [], blockedRoleIds: [], minAccountAgeDays: 0, minMemberDays: 0, cooldownDays: 7, maxResponses: 0, closesAt: null,
  dmTimeoutMinutes: 30,
  acceptMessage: '', rejectMessage: '', shareRejectReason: true, confirmationMessage: '',
  panelTitle: '', panelDescription: '', panelButtonLabel: '',
};

// Turns whatever the dashboard sent into a valid form. Never throws for cosmetic problems; throws for structural ones.
export function sanitizeForm(input: any): FormDefinition {
  const raw = input && typeof input === 'object' ? input : {};
  const title = text(raw.title, LIMITS.title);
  if (!title) throw new Error('اكتب عنوان للنموذج.');
  const rawQuestions = Array.isArray(raw.questions) ? raw.questions.slice(0, LIMITS.questions) : [];
  const seen = new Set<string>();
  const questions: Question[] = [];
  for (const item of rawQuestions) {
    const type = (QUESTION_TYPES as readonly string[]).includes(item?.type) ? item.type as QuestionType : 'short';
    let id = String(item?.id || '');
    if (!ID_RE.test(id) || seen.has(id)) id = newQuestionId();
    seen.add(id);
    const label = text(item?.label, LIMITS.label);
    if (!label) throw new Error(`السؤال ${questions.length + 1} يحتاج عنوان.`);
    const choiceType = type === 'choice' || type === 'dropdown' || type === 'checkbox';
    const options = choiceType ? [...new Set((Array.isArray(item?.options) ? item.options : []).map((option: unknown) => text(option, 100)).filter(Boolean))].slice(0, LIMITS.options) as string[] : [];
    if (choiceType && options.length < 2) throw new Error(`"${label.slice(0, 40)}" يحتاج خيارين على الأقل.`);
    let min = optionalNumber(item?.min);
    let max = optionalNumber(item?.max);
    if (type === 'scale') { min = int(min ?? 1, 1, 0, 1); max = int(max ?? 5, 5, 2, 10); }
    if (type === 'short' || type === 'paragraph') {
      const cap = type === 'short' ? LIMITS.short : LIMITS.paragraph;
      min = min === null ? null : int(min, 0, 0, cap);
      max = max === null ? null : int(max, cap, 1, cap);
    }
    if (type === 'checkbox') { min = min === null ? null : int(min, 0, 0, options.length); max = max === null ? null : int(max, options.length, 1, options.length); }
    if (min !== null && max !== null && min > max) [min, max] = [max, min];
    questions.push({
      id, type, label,
      description: text(item?.description, LIMITS.description),
      required: type === 'section' ? false : Boolean(item?.required),
      placeholder: text(item?.placeholder, 100),
      options, min, max,
      minLabel: type === 'scale' ? text(item?.minLabel, 40) : '',
      maxLabel: type === 'scale' ? text(item?.maxLabel, 40) : '',
      showIf: null,
    });
    const rawShowIf = item?.showIf;
    if (rawShowIf && typeof rawShowIf === 'object') questions[questions.length - 1]!.showIf = { questionId: String(rawShowIf.questionId || ''), values: (Array.isArray(rawShowIf.values) ? rawShowIf.values : []).map((value: unknown) => text(value, 100)).filter(Boolean).slice(0, LIMITS.options) };
  }
  // Conditions may only point backwards, at a question whose answer is one of a fixed set.
  questions.forEach((question, index) => {
    if (!question.showIf) return;
    const target = questions.slice(0, index).find(item => item.id === question.showIf!.questionId);
    const allowed = target ? answerChoices(target) : [];
    const values = question.showIf.values.filter(value => allowed.includes(value));
    question.showIf = target && values.length ? { questionId: target.id, values } : null;
  });
  if (!questions.some(question => question.type !== 'section')) throw new Error('أضف سؤال واحد على الأقل.');
  const s = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
  const color = /^#[0-9a-f]{6}$/i.test(String(s.color || '')) ? String(s.color).toLowerCase() : DEFAULT_SETTINGS.color;
  let bannerUrl = text(s.bannerUrl, 500);
  if (bannerUrl) { try { const url = new URL(bannerUrl); if (url.protocol !== 'https:') bannerUrl = ''; } catch { bannerUrl = ''; } }
  let closesAt: string | null = null;
  if (s.closesAt) { const date = new Date(s.closesAt); if (!Number.isNaN(date.getTime())) closesAt = date.toISOString(); }
  const settings: FormSettings = {
    mode: (['dm', 'web', 'both'] as const).includes(s.mode) ? s.mode : DEFAULT_SETTINGS.mode,
    language: s.language === 'en' ? 'en' : 'ar',
    color, bannerUrl,
    reviewChannelId: snowflake(s.reviewChannelId),
    pingRoleId: snowflake(s.pingRoleId),
    reviewerRoleIds: snowflakes(s.reviewerRoleIds),
    reviewThread: s.reviewThread !== false,
    acceptRoleIds: snowflakes(s.acceptRoleIds),
    removeRoleIds: snowflakes(s.removeRoleIds),
    addAsStaff: Boolean(s.addAsStaff),
    requiredRoleIds: snowflakes(s.requiredRoleIds),
    blockedRoleIds: snowflakes(s.blockedRoleIds),
    minAccountAgeDays: int(s.minAccountAgeDays, 0, 0, 3650),
    minMemberDays: int(s.minMemberDays, 0, 0, 3650),
    cooldownDays: int(s.cooldownDays, 7, 0, 365),
    maxResponses: int(s.maxResponses, 0, 0, 100000),
    closesAt,
    dmTimeoutMinutes: int(s.dmTimeoutMinutes, 30, 5, 1440),
    acceptMessage: text(s.acceptMessage, LIMITS.message),
    rejectMessage: text(s.rejectMessage, LIMITS.message),
    shareRejectReason: s.shareRejectReason !== false,
    confirmationMessage: text(s.confirmationMessage, LIMITS.message),
    panelTitle: text(s.panelTitle, 200),
    panelDescription: text(s.panelDescription, 2000),
    panelButtonLabel: text(s.panelButtonLabel, 60),
  };
  return { title, description: text(raw.description, LIMITS.formDescription), open: raw.open !== false, questions, settings };
}

// The fixed answers a question can have, for conditions.
export function answerChoices(question: Question): string[] {
  if (question.type === 'yesno') return ['yes', 'no'];
  if (question.type === 'choice' || question.type === 'dropdown' || question.type === 'checkbox') return question.options;
  return [];
}

export type Answers = Record<string, unknown>;

export function isVisible(question: Question, answers: Answers) {
  if (!question.showIf) return true;
  const value = answers[question.showIf.questionId];
  const given = Array.isArray(value) ? value.map(String) : value === undefined || value === null ? [] : [String(value)];
  return given.some(item => question.showIf!.values.includes(item));
}

export const answerable = (questions: Question[]) => questions.filter(question => question.type !== 'section');

// Questions the applicant still has to see, in order, given the answers so far.
export function visibleQuestions(questions: Question[], answers: Answers) {
  return answerable(questions).filter(question => isVisible(question, answers));
}

const toLatinDigits = (value: string) => value.replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));

export type Validation = { ok: true; value: unknown } | { ok: false; error: string };

// Validates one raw answer. `empty` answers are allowed for optional questions and come back as null.
// البوت عربي دائمًا: رسائل التحقق بالعربي مهما كانت اللغة الممرّرة.
export function validateAnswer(question: Question, raw: unknown, _lang: Language = 'ar'): Validation {
  const fail = (arText: string, _enText: string): Validation => ({ ok: false, error: arText });
  const isEmpty = raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim()) || (Array.isArray(raw) && !raw.length);
  if (isEmpty) return question.required ? fail('هذا السؤال مطلوب.', 'This question is required.') : { ok: true, value: null };
  switch (question.type) {
    case 'section': return { ok: true, value: null };
    case 'short':
    case 'paragraph': {
      const cap = question.type === 'short' ? LIMITS.short : LIMITS.paragraph;
      const value = String(raw).replace(/\r\n/g, '\n').trim();
      const max = Math.min(cap, question.max ?? cap);
      if (value.length > max) return fail(`الإجابة طويلة مرة (الحد الأقصى ${max} حرف).`, `Answer is too long (max ${max} characters).`);
      if (question.min && value.length < question.min) return fail(`الإجابة قصيرة مرة (الحد الأدنى ${question.min} حرف).`, `Answer is too short (min ${question.min} characters).`);
      return { ok: true, value: question.type === 'short' ? value.replace(/\s*\n\s*/g, ' ') : value };
    }
    case 'number': {
      const value = Number(toLatinDigits(String(raw)).replace(/,/g, '').trim());
      if (!Number.isFinite(value)) return fail('اكتب رقم صحيح.', 'Enter a valid number.');
      if (question.min !== null && value < question.min) return fail(`الرقم لازم يكون ${question.min} أو أكثر.`, `Number must be at least ${question.min}.`);
      if (question.max !== null && value > question.max) return fail(`الرقم لازم يكون ${question.max} أو أقل.`, `Number must be at most ${question.max}.`);
      return { ok: true, value };
    }
    case 'url': {
      const value = String(raw).trim();
      try { const url = new URL(value); if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(); return { ok: true, value: url.toString().slice(0, 500) }; }
      catch { return fail('اكتب رابط صحيح يبدأ بـ https://', 'Enter a valid link starting with https://'); }
    }
    case 'date': {
      const value = toLatinDigits(String(raw)).trim().replace(/\//g, '-');
      const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
      const date = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
      if (!match || !date || date.getUTCDate() !== Number(match[3])) return fail('اكتب التاريخ بصيغة سنة-شهر-يوم مثل 2026-09-28.', 'Use YYYY-MM-DD, for example 2026-09-28.');
      return { ok: true, value: date.toISOString().slice(0, 10) };
    }
    case 'choice':
    case 'dropdown': {
      const value = String(Array.isArray(raw) ? raw[0] : raw);
      if (!question.options.includes(value)) return fail('اختر أحد الخيارات المتاحة.', 'Choose one of the options.');
      return { ok: true, value };
    }
    case 'checkbox': {
      const values = [...new Set((Array.isArray(raw) ? raw : [raw]).map(String))];
      if (values.some(value => !question.options.includes(value))) return fail('اختر من الخيارات المتاحة فقط.', 'Choose only from the listed options.');
      if (question.min && values.length < question.min) return fail(`اختر ${question.min} خيارات على الأقل.`, `Choose at least ${question.min} options.`);
      if (question.max && values.length > question.max) return fail(`اختر ${question.max} خيارات كحد أقصى.`, `Choose at most ${question.max} options.`);
      return { ok: true, value: question.options.filter(option => values.includes(option)) };
    }
    case 'yesno': {
      const value = String(raw).toLowerCase();
      if (!['yes', 'no'].includes(value)) return fail('اختر نعم أو لا.', 'Choose yes or no.');
      return { ok: true, value };
    }
    case 'scale': {
      const value = Math.round(Number(toLatinDigits(String(raw))));
      const min = question.min ?? 1; const max = question.max ?? 5;
      if (!Number.isFinite(value) || value < min || value > max) return fail(`اختر رقم من ${min} إلى ${max}.`, `Choose a number from ${min} to ${max}.`);
      return { ok: true, value };
    }
  }
}

// Validates a full submission. Hidden questions are dropped so stale answers never leak into a response.
export function validateSubmission(questions: Question[], raw: Answers, lang: Language = 'ar') {
  const answers: Answers = {};
  const errors: Record<string, string> = {};
  for (const question of answerable(questions)) {
    if (!isVisible(question, answers)) continue;
    const result = validateAnswer(question, raw?.[question.id], lang);
    if (!result.ok) errors[question.id] = result.error;
    else if (result.value !== null) answers[question.id] = result.value;
  }
  return { answers, errors, ok: !Object.keys(errors).length };
}

export function formatAnswer(question: Pick<Question, 'type' | 'max'>, value: unknown, _lang: Language = 'ar') {
  if (value === undefined || value === null || value === '') return '— ما فيه إجابة';
  if (question.type === 'yesno') return value === 'yes' ? 'نعم' : 'لا';
  if (question.type === 'checkbox' && Array.isArray(value)) return value.map(item => `• ${item}`).join('\n');
  if (question.type === 'scale') return `${value} / ${question.max ?? 5}`;
  return String(value);
}

export const TYPE_LABELS: Record<QuestionType, { ar: string; en: string }> = {
  section: { ar: 'قسم', en: 'Section' },
  short: { ar: 'إجابة قصيرة', en: 'Short answer' },
  paragraph: { ar: 'فقرة', en: 'Paragraph' },
  number: { ar: 'رقم', en: 'Number' },
  url: { ar: 'رابط', en: 'Link' },
  date: { ar: 'تاريخ', en: 'Date' },
  choice: { ar: 'اختيار واحد', en: 'Multiple choice' },
  dropdown: { ar: 'قائمة منسدلة', en: 'Dropdown' },
  checkbox: { ar: 'مربعات اختيار', en: 'Checkboxes' },
  yesno: { ar: 'نعم / لا', en: 'Yes / No' },
  scale: { ar: 'مقياس', en: 'Linear scale' },
};
