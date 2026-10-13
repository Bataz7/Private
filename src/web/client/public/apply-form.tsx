// نموذج التقديم (الصفحة العامة ومعاينة المنشئ يستخدمونه). الأقسام تقسم النموذج لصفحات.
// نصوص المتقدم تتبع لغة النموذج (اللي تختارها الإدارة) لأن المتقدمين ممكن ما يقرون عربي.
import type { Child } from '#jsx/jsx-runtime';
import { cx } from '../lib/dom';

export type Question = {
  id: string;
  type: 'short' | 'paragraph' | 'number' | 'url' | 'date' | 'choice' | 'checkbox' | 'dropdown' | 'yesno' | 'scale' | 'section';
  label: string;
  description?: string;
  required?: boolean;
  placeholder?: string;
  options: string[];
  min?: number | null;
  max?: number | null;
  minLabel?: string;
  maxLabel?: string;
  showIf?: { questionId: string; values: string[] } | null;
};
export type FormDef = { title: string; description?: string; questions: Question[]; language?: string };
export type Answers = Record<string, string | number | string[]>;

const STRINGS = {
  ar: { required: 'مطلوب', next: 'التالي', back: 'السابق', submit: 'إرسال التقديم', choose: 'اختر…', yes: 'نعم', no: 'لا', page: 'الصفحة {n} من {total}', requiredError: 'هذا السؤال مطلوب.', tooShort: 'الإجابة قصيرة (الحد الأدنى {n} حرف).', tooLong: 'الإجابة طويلة (الحد الأقصى {n} حرف).', number: 'اكتب رقم صحيح.', min: 'الرقم لازم يكون {n} أو أكثر.', max: 'الرقم لازم يكون {n} أو أقل.', url: 'اكتب رابط صحيح يبدأ بـ https://', pickMin: 'اختر {n} خيارات على الأقل.', pickMax: 'اختر {n} خيارات كحد أقصى.', clear: 'مسح الاختيار', requiredNote: '* يعني السؤال مطلوب' },
  en: { required: 'Required', next: 'Next', back: 'Back', submit: 'Submit application', choose: 'Choose…', yes: 'Yes', no: 'No', page: 'Page {n} of {total}', requiredError: 'This question is required.', tooShort: 'Answer is too short (min {n} characters).', tooLong: 'Answer is too long (max {n} characters).', number: 'Enter a valid number.', min: 'Number must be at least {n}.', max: 'Number must be at most {n}.', url: 'Enter a valid link starting with https://', pickMin: 'Choose at least {n} options.', pickMax: 'Choose at most {n} options.', clear: 'Clear selection', requiredNote: '* Indicates a required question' },
};
export type ApplyString = keyof typeof STRINGS.ar;
export const tr = (lang: string | undefined, key: ApplyString, vars: Record<string, string | number> = {}) =>
  (STRINGS[lang === 'en' ? 'en' : 'ar'][key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ''));

const CAPS = { short: 300, paragraph: 4000 };

export function isVisible(question: Question, answers: Answers): boolean {
  if (!question.showIf) return true;
  const value = answers[question.showIf.questionId];
  const given = Array.isArray(value) ? value.map(String) : value === undefined || value === null || value === '' ? [] : [String(value)];
  return given.some(item => question.showIf!.values.includes(item));
}

export function pagesOf(questions: Question[]) {
  const pages: Array<{ section: Question | null; items: Question[] }> = [{ section: null, items: [] }];
  for (const question of questions) {
    if (question.type === 'section') pages.push({ section: question, items: [] });
    else pages.at(-1)!.items.push(question);
  }
  return pages.filter((page, index) => (index === 0 ? page.items.length : true));
}

export function validate(question: Question, value: unknown, lang?: string): string {
  const empty = value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length);
  if (empty) return question.required ? tr(lang, 'requiredError') : '';
  const text = String(value);
  if (question.type === 'short' || question.type === 'paragraph') {
    if (question.min && text.trim().length < question.min) return tr(lang, 'tooShort', { n: question.min });
    const max = question.max || CAPS[question.type];
    if (text.trim().length > max) return tr(lang, 'tooLong', { n: max });
  }
  if (question.type === 'number') {
    const n = Number(text);
    if (!Number.isFinite(n)) return tr(lang, 'number');
    if (question.min !== null && question.min !== undefined && n < question.min) return tr(lang, 'min', { n: question.min });
    if (question.max !== null && question.max !== undefined && n > question.max) return tr(lang, 'max', { n: question.max });
  }
  if (question.type === 'url') {
    try { if (!/^https?:$/.test(new URL(text).protocol)) return tr(lang, 'url'); } catch { return tr(lang, 'url'); }
  }
  if (question.type === 'checkbox' && Array.isArray(value)) {
    if (question.min && value.length < question.min) return tr(lang, 'pickMin', { n: question.min });
    if (question.max && value.length > question.max) return tr(lang, 'pickMax', { n: question.max });
  }
  return '';
}

export function pageErrors(form: FormDef, pageIndex: number, answers: Answers): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const question of pagesOf(form.questions)[pageIndex]?.items ?? []) {
    if (!isVisible(question, answers)) continue;
    const error = validate(question, answers[question.id], form.language);
    if (error) errors[question.id] = error;
  }
  return errors;
}

type PageProps = { form: FormDef; page: number; answers: Answers; errors?: Record<string, string>; onChange: () => void };

/** صفحة واحدة من النموذج. أي تغيير يكتب في answers ثم يستدعي onChange (لإظهار الأسئلة المشروطة). */
export function FormPage({ form, page, answers, errors = {}, onChange }: PageProps) {
  const lang = form.language;
  const pages = pagesOf(form.questions);
  const current = pages[page] ?? pages[0];
  if (!current) return null;
  const offset = pages.slice(0, page).reduce((sum, item) => sum + item.items.length, 0);
  const set = (question: Question, value: unknown, box?: HTMLElement | null) => {
    if (value === '' || value === null || value === undefined || (Array.isArray(value) && !value.length)) delete answers[question.id];
    else answers[question.id] = question.type === 'scale' ? Number(value) : (value as string);
    if (box?.classList.contains('has-error')) { box.classList.remove('has-error'); box.querySelector('.af-error')!.textContent = ''; }
    onChange();
  };
  const boxOf = (event: Event) => (event.currentTarget as HTMLElement).closest<HTMLElement>('.af-q');
  const input = (question: Question): Child => {
    const name = `q_${question.id}`;
    const value = answers[question.id];
    const text = (event: Event) => set(question, (event.currentTarget as HTMLInputElement).value, boxOf(event));
    switch (question.type) {
      case 'short': return <input class="input" type="text" name={name} maxlength={question.max || CAPS.short} value={String(value ?? '')} placeholder={question.placeholder || undefined} dir="auto" onInput={text} />;
      case 'paragraph': return [
        <textarea class="input" name={name} rows="4" maxlength={question.max || CAPS.paragraph} placeholder={question.placeholder || undefined} dir="auto" onInput={(event: Event) => { text(event); const counter = (event.currentTarget as HTMLElement).nextElementSibling?.querySelector('span'); if (counter) counter.textContent = String((event.currentTarget as HTMLTextAreaElement).value.length); }}>{String(value ?? '')}</textarea>,
        <div class="af-count"><span>{String(value ?? '').length}</span> / {question.max || CAPS.paragraph}</div>,
      ];
      case 'number': return <input class="input af-narrow" type="number" step="any" inputmode="decimal" name={name} value={String(value ?? '')} min={question.min ?? undefined} max={question.max ?? undefined} placeholder={question.placeholder || undefined} onInput={text} />;
      case 'url': return <input class="input ltr" type="url" name={name} value={String(value ?? '')} placeholder={question.placeholder || 'https://'} onInput={text} />;
      case 'date': return <input class="input af-narrow" type="date" name={name} value={String(value ?? '')} onInput={text} />;
      case 'dropdown': return (
        <select class="input af-narrow" name={name} onChange={text}>
          <option value="">{tr(lang, 'choose')}</option>
          {question.options.map(option => <option value={option} selected={value === option}>{option}</option>)}
        </select>
      );
      case 'choice': return [
        <div class="af-options">{question.options.map(option => <label class="af-opt"><input type="radio" name={name} value={option} checked={value === option} onChange={text} /><span class="af-mark" /><span dir="auto">{option}</span></label>)}</div>,
        question.required ? null : <button type="button" class="af-clear" onClick={(event: Event) => { boxOf(event)?.querySelectorAll<HTMLInputElement>('input').forEach(item => { item.checked = false; }); set(question, '', boxOf(event)); }}>{tr(lang, 'clear')}</button>,
      ];
      case 'checkbox': return (
        <div class="af-options">{question.options.map(option => (
          <label class="af-opt af-check"><input type="checkbox" name={name} value={option} checked={Array.isArray(value) && value.includes(option)} onChange={(event: Event) => {
            const box = boxOf(event);
            set(question, [...(box?.querySelectorAll<HTMLInputElement>('input:checked') ?? [])].map(item => item.value), box);
          }} /><span class="af-mark" /><span dir="auto">{option}</span></label>
        ))}</div>
      );
      case 'yesno': return <div class="af-pills">{(['yes', 'no'] as const).map(option => <label class="af-pill"><input type="radio" name={name} value={option} checked={value === option} onChange={text} /><span>{tr(lang, option)}</span></label>)}</div>;
      case 'scale': {
        const min = question.min ?? 1;
        const max = question.max ?? 5;
        return (
          <div class="af-scale">
            <span class="af-scale-label">{question.minLabel ?? ''}</span>
            <div class="af-scale-row">{Array.from({ length: max - min + 1 }, (_, index) => min + index).map(n => <label class="af-scale-item"><input type="radio" name={name} value={String(n)} checked={value !== undefined && value !== '' && Number(value) === n} onChange={text} /><span>{n}</span></label>)}</div>
            <span class="af-scale-label">{question.maxLabel ?? ''}</span>
          </div>
        );
      }
      default: return null;
    }
  };
  return [
    current.section ? <div class="af-section"><h2 dir="auto">{current.section.label}</h2>{current.section.description ? <p dir="auto">{current.section.description}</p> : null}</div> : null,
    current.items.map((question, index) => (
      <div class={cx('af-q', errors[question.id] && 'has-error')} data-q={question.id} hidden={!isVisible(question, answers)}>
        <div class="af-label"><span class="af-num">{offset + index + 1}</span><span dir="auto">{question.label}</span>{question.required ? <b class="af-req" title={tr(lang, 'required')}>*</b> : null}</div>
        {question.description ? <p class="af-desc" dir="auto">{question.description}</p> : null}
        <div class="af-field">{input(question)}</div>
        <p class="af-error" role="alert">{errors[question.id] ?? ''}</p>
      </div>
    )),
  ];
}

/** يحدّث إظهار الأسئلة المشروطة بدون إعادة رسم (عشان التركيز ما يضيع). */
export function syncVisibility(root: HTMLElement, form: FormDef, answers: Answers) {
  for (const question of form.questions) {
    const element = root.querySelector<HTMLElement>(`[data-q="${CSS.escape(question.id)}"]`);
    if (element) element.hidden = !isVisible(question, answers);
  }
}
