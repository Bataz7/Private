// Renders an application form (public web form and the builder preview share this file).
// Sections split the form into pages, like Google Forms.

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));

const STRINGS = {
  ar: { required: 'مطلوب', next: 'التالي', back: 'السابق', submit: 'إرسال التقديم', choose: 'اختر...', yes: 'نعم', no: 'لا', page: 'الصفحة {n} من {total}', requiredError: 'هذا السؤال مطلوب.', tooShort: 'الإجابة قصيرة جدًا (الحد الأدنى {n} حرف).', tooLong: 'الإجابة طويلة جدًا (الحد الأقصى {n} حرف).', number: 'اكتب رقمًا صحيحًا.', min: 'الرقم يجب أن يكون {n} أو أكثر.', max: 'الرقم يجب أن يكون {n} أو أقل.', url: 'اكتب رابطًا صحيحًا يبدأ بـ https://', pickMin: 'اختر {n} خيارات على الأقل.', pickMax: 'اختر {n} خيارات كحد أقصى.', clear: 'مسح الاختيار', requiredNote: '* يشير إلى سؤال مطلوب' },
  en: { required: 'Required', next: 'Next', back: 'Back', submit: 'Submit application', choose: 'Choose...', yes: 'Yes', no: 'No', page: 'Page {n} of {total}', requiredError: 'This question is required.', tooShort: 'Answer is too short (min {n} characters).', tooLong: 'Answer is too long (max {n} characters).', number: 'Enter a valid number.', min: 'Number must be at least {n}.', max: 'Number must be at most {n}.', url: 'Enter a valid link starting with https://', pickMin: 'Choose at least {n} options.', pickMax: 'Choose at most {n} options.', clear: 'Clear selection', requiredNote: '* Indicates a required question' },
};
export const tr = (lang, key, vars = {}) => (STRINGS[lang]?.[key] ?? STRINGS.en[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? '');

export function isVisible(question, answers) {
  if (!question.showIf) return true;
  const value = answers[question.showIf.questionId];
  const given = Array.isArray(value) ? value.map(String) : value === undefined || value === null || value === '' ? [] : [String(value)];
  return given.some(item => question.showIf.values.includes(item));
}

// [[section|null, [questions]]] — one entry per page.
export function pagesOf(questions) {
  const pages = [{ section: null, items: [] }];
  for (const question of questions) {
    if (question.type === 'section') pages.push({ section: question, items: [] });
    else pages.at(-1).items.push(question);
  }
  return pages.filter((page, index) => index === 0 ? page.items.length : true);
}

const caps = { short: 300, paragraph: 4000 };

function input(question, value, lang) {
  const name = `q_${question.id}`;
  const ph = question.placeholder ? ` placeholder="${esc(question.placeholder)}"` : '';
  switch (question.type) {
    case 'short': return `<input class="af-input" type="text" name="${name}" maxlength="${question.max || caps.short}" value="${esc(value ?? '')}"${ph}>`;
    case 'paragraph': return `<textarea class="af-input af-textarea" name="${name}" rows="4" maxlength="${question.max || caps.paragraph}"${ph}>${esc(value ?? '')}</textarea><div class="af-count"><span>${String(value ?? '').length}</span> / ${question.max || caps.paragraph}</div>`;
    case 'number': return `<input class="af-input af-narrow" type="number" step="any" inputmode="decimal" name="${name}" value="${esc(value ?? '')}"${question.min !== null && question.min !== undefined ? ` min="${question.min}"` : ''}${question.max !== null && question.max !== undefined ? ` max="${question.max}"` : ''}${ph}>`;
    case 'url': return `<input class="af-input" type="url" name="${name}" dir="ltr" value="${esc(value ?? '')}" placeholder="${esc(question.placeholder || 'https://')}">`;
    case 'date': return `<input class="af-input af-narrow" type="date" name="${name}" value="${esc(value ?? '')}">`;
    case 'dropdown': return `<select class="af-input af-narrow" name="${name}"><option value="">${tr(lang, 'choose')}</option>${question.options.map(option => `<option ${value === option ? 'selected' : ''}>${esc(option)}</option>`).join('')}</select>`;
    case 'choice': return `<div class="af-options">${question.options.map(option => `<label class="af-opt"><input type="radio" name="${name}" value="${esc(option)}" ${value === option ? 'checked' : ''}><span class="af-mark"></span><span>${esc(option)}</span></label>`).join('')}</div>${question.required ? '' : `<button type="button" class="af-clear" data-clear="${esc(question.id)}">${tr(lang, 'clear')}</button>`}`;
    case 'checkbox': return `<div class="af-options">${question.options.map(option => `<label class="af-opt af-check"><input type="checkbox" name="${name}" value="${esc(option)}" ${Array.isArray(value) && value.includes(option) ? 'checked' : ''}><span class="af-mark"></span><span>${esc(option)}</span></label>`).join('')}</div>`;
    case 'yesno': return `<div class="af-pills">${['yes', 'no'].map(option => `<label class="af-pill"><input type="radio" name="${name}" value="${option}" ${value === option ? 'checked' : ''}><span>${tr(lang, option)}</span></label>`).join('')}</div>`;
    case 'scale': {
      const min = question.min ?? 1; const max = question.max ?? 5;
      return `<div class="af-scale"><span class="af-scale-label">${esc(question.minLabel || '')}</span><div class="af-scale-row">${Array.from({ length: max - min + 1 }, (_, index) => min + index).map(n => `<label class="af-scale-item"><input type="radio" name="${name}" value="${n}" ${Number(value) === n && value !== undefined && value !== null && value !== '' ? 'checked' : ''}><span>${n}</span></label>`).join('')}</div><span class="af-scale-label">${esc(question.maxLabel || '')}</span></div>`;
    }
    default: return '';
  }
}

export function renderQuestion(question, { value, error = '', lang = 'ar', number = 0 } = {}) {
  return `<div class="af-q ${error ? 'has-error' : ''}" data-q="${esc(question.id)}" data-type="${question.type}">
    <div class="af-label">${number ? `<span class="af-num">${number}</span>` : ''}<span>${esc(question.label)}</span>${question.required ? `<b class="af-req" title="${tr(lang, 'required')}">*</b>` : ''}</div>
    ${question.description ? `<p class="af-desc">${esc(question.description)}</p>` : ''}
    <div class="af-field">${input(question, value, lang)}</div>
    <p class="af-error" role="alert">${esc(error)}</p>
  </div>`;
}

export function renderPage(form, pageIndex, { answers = {}, errors = {} } = {}) {
  const lang = form.language || 'ar';
  const pages = pagesOf(form.questions);
  const page = pages[pageIndex] || pages[0];
  const offset = pages.slice(0, pageIndex).reduce((sum, item) => sum + item.items.length, 0);
  return `${page.section ? `<div class="af-section"><h2>${esc(page.section.label)}</h2>${page.section.description ? `<p>${esc(page.section.description)}</p>` : ''}</div>` : ''}
    ${page.items.map((question, index) => renderQuestion(question, { value: answers[question.id], error: errors[question.id], lang, number: offset + index + 1 })).join('')}`;
}

export function readValue(root, question) {
  const name = `q_${question.id}`;
  if (question.type === 'checkbox') return [...root.querySelectorAll(`[name="${name}"]:checked`)].map(input => input.value);
  if (['choice', 'yesno', 'scale'].includes(question.type)) return root.querySelector(`[name="${name}"]:checked`)?.value ?? '';
  return root.querySelector(`[name="${name}"]`)?.value ?? '';
}

// Reads every rendered question into `answers` (questions not on screen keep their stored value).
export function collect(root, form, answers) {
  for (const question of form.questions) {
    if (question.type === 'section' || !root.querySelector(`[data-q="${question.id}"]`)) continue;
    const value = readValue(root, question);
    if (value === '' || (Array.isArray(value) && !value.length)) delete answers[question.id];
    else answers[question.id] = question.type === 'scale' ? Number(value) : value;
  }
  return answers;
}

export function syncVisibility(root, form, answers) {
  for (const question of form.questions) {
    const element = root.querySelector(`[data-q="${question.id}"]`);
    if (element) element.hidden = !isVisible(question, answers);
  }
}

export function validate(question, value, lang) {
  const empty = value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length);
  if (empty) return question.required ? tr(lang, 'requiredError') : '';
  const text = String(value);
  if (question.type === 'short' || question.type === 'paragraph') {
    if (question.min && text.trim().length < question.min) return tr(lang, 'tooShort', { n: question.min });
    const max = question.max || caps[question.type];
    if (text.trim().length > max) return tr(lang, 'tooLong', { n: max });
  }
  if (question.type === 'number') {
    const n = Number(text);
    if (!Number.isFinite(n)) return tr(lang, 'number');
    if (question.min !== null && question.min !== undefined && n < question.min) return tr(lang, 'min', { n: question.min });
    if (question.max !== null && question.max !== undefined && n > question.max) return tr(lang, 'max', { n: question.max });
  }
  if (question.type === 'url') { try { const url = new URL(text); if (!/^https?:$/.test(url.protocol)) throw 0; } catch { return tr(lang, 'url'); } }
  if (question.type === 'checkbox') {
    if (question.min && value.length < question.min) return tr(lang, 'pickMin', { n: question.min });
    if (question.max && value.length > question.max) return tr(lang, 'pickMax', { n: question.max });
  }
  return '';
}

export function pageErrors(form, pageIndex, answers) {
  const lang = form.language || 'ar';
  const errors = {};
  for (const question of pagesOf(form.questions)[pageIndex]?.items || []) {
    if (!isVisible(question, answers)) continue;
    const error = validate(question, answers[question.id], lang);
    if (error) errors[question.id] = error;
  }
  return errors;
}

// Live behaviour for a rendered page: counters, visibility, clearing radios, removing errors while typing.
export function bindPage(root, form, answers, onChange) {
  const update = event => {
    collect(root, form, answers);
    syncVisibility(root, form, answers);
    const box = event?.target?.closest?.('.af-q');
    if (box?.classList.contains('has-error')) { box.classList.remove('has-error'); box.querySelector('.af-error').textContent = ''; }
    const counter = event?.target?.matches?.('textarea') ? event.target.closest('.af-field')?.querySelector('.af-count span') : null;
    if (counter) counter.textContent = String(event.target.value.length);
    onChange?.(answers);
  };
  root.addEventListener('input', update);
  root.addEventListener('change', update);
  root.addEventListener('click', event => {
    const clear = event.target.closest('[data-clear]');
    if (!clear) return;
    root.querySelectorAll(`[name="q_${clear.dataset.clear}"]`).forEach(item => { item.checked = false; });
    update({ target: clear });
  });
  syncVisibility(root, form, answers);
}
