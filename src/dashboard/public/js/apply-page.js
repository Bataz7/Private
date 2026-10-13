import { ic } from './icon.js';
import { bindPage, collect, isVisible, pageErrors, pagesOf, renderPage, tr } from './apply-form.js';

const root = document.getElementById('af');
const formId = location.pathname.split('/')[2] || '';
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));

const UI = {
  ar: { login: 'سجّل الدخول بديسكورد للتقديم', loginHint: 'نستخدم حسابك في ديسكورد فقط للتحقق من هويتك وعضويتك في السيرفر.', switch: 'ليس أنت؟ تبديل الحساب', signedIn: 'مسجّل الدخول باسم', closed: 'التقديم مغلق', notEligible: 'لا يمكنك التقديم حاليًا', pending: 'تقديمك قيد المراجعة', pendingHint: 'استلمنا تقديمك وسيراجعه فريق الإدارة. ستصلك النتيجة في رسائل ديسكورد الخاصة.', accepted: 'تم قبولك', acceptedHint: 'تهانينا! تم قبول تقديمك.', rejected: 'لم يتم قبول تقديمك السابق', reason: 'السبب', done: 'تم إرسال تقديمك بنجاح', doneHint: 'سيراجع فريق الإدارة تقديمك وستصلك النتيجة في رسائل ديسكورد الخاصة. تأكد أن رسائلك الخاصة مفتوحة.', reference: 'رقم التقديم', notFound: 'النموذج غير موجود', notFoundHint: 'قد يكون الرابط خاطئًا أو تم حذف النموذج.', error: 'حدث خطأ', retry: 'إعادة المحاولة', sending: 'جارٍ الإرسال...', draft: 'تم حفظ مسودتك تلقائيًا', oauth: 'تعذر تسجيل الدخول بديسكورد. حاول مرة أخرى.', members: 'عضو', closes: 'يغلق التقديم في', powered: 'مدعوم من Rift', questions: 'سؤال', noLogin: 'تسجيل الدخول غير مفعّل في لوحة التحكم.' },
  en: { login: 'Sign in with Discord to apply', loginHint: 'Your Discord account is only used to confirm who you are and that you are in the server.', switch: 'Not you? Switch account', signedIn: 'Signed in as', closed: 'Applications are closed', notEligible: 'You cannot apply right now', pending: 'Your application is under review', pendingHint: 'We received your application. You will get the result in your Discord DMs.', accepted: 'You were accepted', acceptedHint: 'Congratulations! Your application was accepted.', rejected: 'Your previous application was not accepted', reason: 'Reason', done: 'Application submitted', doneHint: 'The team will review it and send you the result in Discord DMs. Make sure your DMs are open.', reference: 'Reference', notFound: 'Form not found', notFoundHint: 'The link may be wrong or the form was deleted.', error: 'Something went wrong', retry: 'Try again', sending: 'Sending...', draft: 'Draft saved automatically', oauth: 'Discord sign-in failed. Please try again.', members: 'members', closes: 'Closes', powered: 'Powered by Rift', questions: 'questions', noLogin: 'Discord login is not configured on this dashboard.' },
};

let data = null;
let draftTimer;
let lang = 'en';
let page = 0;
let answers = {};
const u = key => UI[lang][key] ?? UI.en[key];
const draftKey = () => `rift-apply:${formId}:${data?.viewer?.id || 'anon'}`;
const saveDraft = () => { try { localStorage.setItem(draftKey(), JSON.stringify(answers)); } catch {} };
const loadDraft = () => { try { return JSON.parse(localStorage.getItem(draftKey()) || '{}') || {}; } catch { return {}; } };
const clearDraft = () => { try { localStorage.removeItem(draftKey()); } catch {} };

async function request(url, options = {}) {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error || `Request failed (${response.status})`), { status: response.status, body });
  return body;
}

function header() {
  const { form, guild } = data;
  const count = form.questions.filter(question => question.type !== 'section').length;
  return `<header class="af-card af-head">
    ${form.bannerUrl ? `<div class="af-banner"><img src="${esc(form.bannerUrl)}" alt="" onerror="this.parentElement.remove()"></div>` : '<div class="af-stripe"></div>'}
    <div class="af-head-body">
      ${guild ? `<div class="af-guild">${guild.icon ? `<img src="${esc(guild.icon)}" alt="">` : `<span>${esc(guild.name[0] || 'R')}</span>`}<div><b>${esc(guild.name)}</b><small>${guild.members.toLocaleString('en-US')} ${u('members')} · ${count} ${u('questions')}</small></div></div>` : ''}
      <h1>${esc(form.title)}</h1>
      ${form.description ? `<p class="af-lead">${esc(form.description)}</p>` : ''}
      ${form.closesAt && form.open ? `<p class="af-meta">${ic('calendar', { size: 16 })} ${u('closes')} ${new Date(form.closesAt).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' })}</p>` : ''}
    </div>
  </header>`;
}

function account() {
  const viewer = data.viewer;
  if (!viewer) return '';
  return `<div class="af-card af-account"><img src="${esc(viewer.avatar)}" alt=""><div><small>${u('signedIn')}</small><b>${esc(viewer.username)}</b></div><button type="button" class="af-link" data-switch>${u('switch')}</button></div>`;
}

function notice(kind, title, text, extra = '') {
  const icon = { good: 'tick-circle', bad: 'close-circle', warn: 'info-circle', wait: 'clock' }[kind] || 'info-circle';
  return `<section class="af-card af-notice af-${kind}"><span class="af-notice-icon">${ic(icon, { size: 28 })}</span><h2>${esc(title)}</h2>${text ? `<p>${esc(text)}</p>` : ''}${extra}</section>`;
}

const footer = () => `<footer class="af-foot"><img src="/logo-mark.svg" alt=""> ${u('powered')}</footer>`;

function renderForm(errors = {}) {
  const pages = pagesOf(data.form.questions);
  const total = pages.length;
  const last = page >= total - 1;
  const percent = Math.round(((page + 1) / total) * 100);
  root.innerHTML = `${header()}${account()}
    <form class="af-card af-form" novalidate>
      ${total > 1 ? `<div class="af-progress"><div class="af-progress-bar"><i style="width:${percent}%"></i></div><span>${tr(lang, 'page', { n: page + 1, total })}</span></div>` : ''}
      ${page === 0 ? `<p class="af-note">${tr(lang, 'requiredNote')}</p>` : ''}
      <div class="af-page">${renderPage(data.form, page, { answers, errors })}</div>
      <div class="af-actions">
        ${page > 0 ? `<button type="button" class="secondary" data-prev>${ic('arrow-right-01', { size: 16, cls: 'af-flip-back' })} ${tr(lang, 'back')}</button>` : '<span></span>'}
        ${last ? `<button type="submit" class="primary" data-submit>${ic('send-2', { size: 16 })} ${tr(lang, 'submit')}</button>` : `<button type="button" class="primary" data-next>${tr(lang, 'next')} ${ic('arrow-right-01', { size: 16, cls: 'af-flip' })}</button>`}
      </div>
      <p class="af-draft" hidden>${ic('save-2', { size: 14 })} ${u('draft')}</p>
    </form>${footer()}`;
  const form = root.querySelector('form');
  const pageEl = root.querySelector('.af-page');
  bindPage(pageEl, data.form, answers, () => { clearTimeout(draftTimer); draftTimer = setTimeout(() => { saveDraft(); const hint = root.querySelector('.af-draft'); if (hint) hint.hidden = false; }, 400); });
  root.querySelector('[data-switch]')?.addEventListener('click', switchAccount);
  const move = step => {
    collect(pageEl, data.form, answers);
    if (step > 0) {
      const found = pageErrors(data.form, page, answers);
      if (Object.keys(found).length) return showErrors(found);
    }
    let next = page + step;
    // Skip pages whose every question is hidden by earlier answers.
    while (next > 0 && next < total - 1 && pages[next].items.length && !pages[next].items.some(question => isVisible(question, answers))) next += step;
    page = Math.max(0, Math.min(total - 1, next));
    saveDraft();
    renderForm();
    root.querySelector('.af-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  root.querySelector('[data-next]')?.addEventListener('click', () => move(1));
  root.querySelector('[data-prev]')?.addEventListener('click', () => move(-1));
  form.addEventListener('submit', event => { event.preventDefault(); collect(pageEl, data.form, answers); submit(); });
  pageEl.querySelectorAll('input:not([type=radio]):not([type=checkbox])').forEach(item => item.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); (root.querySelector('[data-next]') || root.querySelector('[data-submit]'))?.click(); } }));
}

function showErrors(errors) {
  renderForm(errors);
  const first = root.querySelector('.af-q.has-error');
  first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  first?.querySelector('input, textarea, select')?.focus({ preventScroll: true });
}

async function submit() {
  const pages = pagesOf(data.form.questions);
  for (let index = 0; index < pages.length; index += 1) {
    const found = pageErrors(data.form, index, answers);
    if (Object.keys(found).length) { page = index; return showErrors(found); }
  }
  const button = root.querySelector('[data-submit]');
  if (button) { button.disabled = true; button.textContent = u('sending'); }
  const payload = {};
  for (const question of data.form.questions) if (question.type !== 'section' && isVisible(question, answers) && answers[question.id] !== undefined) payload[question.id] = answers[question.id];
  try {
    const result = await request(`/apply-api/forms/${formId}/submit`, { method: 'POST', body: JSON.stringify({ answers: payload }) });
    clearTimeout(draftTimer);
    clearDraft();
    root.innerHTML = `${header()}${notice('good', u('done'), u('doneHint'), `<div class="af-ref"><small>${u('reference')}</small><b>#${esc(result.reference)}</b></div>`)}${footer()}`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (error) {
    const fieldErrors = error.body?.fieldErrors;
    if (fieldErrors && Object.keys(fieldErrors).length) {
      const target = pages.findIndex(item => item.items.some(question => fieldErrors[question.id]));
      page = Math.max(0, target);
      return showErrors(fieldErrors);
    }
    if (error.status === 403 || error.status === 409) { await load(); return; }
    if (button) { button.disabled = false; button.textContent = tr(lang, 'submit'); }
    flash(error.message);
  }
}

function flash(message) {
  let bar = document.querySelector('.af-flash');
  if (!bar) { bar = document.createElement('div'); bar.className = 'af-flash'; bar.setAttribute('role', 'status'); document.body.appendChild(bar); }
  bar.textContent = message;
  bar.classList.add('show');
  clearTimeout(bar.timer);
  bar.timer = setTimeout(() => bar.classList.remove('show'), 4200);
}

async function switchAccount() {
  await request('/apply-api/logout', { method: 'POST' }).catch(() => {});
  location.href = `/apply/${formId}/login`;
}

function renderState() {
  const { form, viewer, eligibility, latest } = data;
  if (!form.open) { root.innerHTML = `${header()}${notice('bad', u('closed'), form.closedReason)}${footer()}`; return; }
  if (!viewer) {
    root.innerHTML = `${header()}<section class="af-card af-login"><span class="af-discord">${discordLogo}</span><h2>${u('login')}</h2><p>${u('loginHint')}</p>${data.loginReady ? `<a class="primary af-login-btn" href="/apply/${formId}/login">${discordLogo} ${u('login')}</a>` : `<p class="af-error-text">${u('noLogin')}</p>`}</section>${footer()}`;
    return;
  }
  if (!eligibility.ok) {
    if (latest?.status === 'pending') { root.innerHTML = `${header()}${account()}${notice('wait', u('pending'), u('pendingHint'))}${footer()}`; }
    else if (latest?.status === 'accepted') { root.innerHTML = `${header()}${account()}${notice('good', u('accepted'), u('acceptedHint'))}${footer()}`; }
    else root.innerHTML = `${header()}${account()}${notice('warn', u('notEligible'), eligibility.reason, latest?.status === 'rejected' && latest.reason ? `<blockquote class="af-reason"><small>${u('reason')}</small>${esc(latest.reason)}</blockquote>` : '')}${footer()}`;
    root.querySelector('[data-switch]')?.addEventListener('click', switchAccount);
    return;
  }
  answers = loadDraft();
  page = 0;
  renderForm();
}

async function load() {
  try {
    data = await request(`/apply-api/forms/${formId}`);
    lang = data.form.language === 'ar' ? 'ar' : 'en';
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.title = `${data.form.title} · ${data.guild?.name || 'Rift'}`;
    document.body.style.setProperty('--accent', data.form.color || '#8175f5');
    renderState();
    const error = new URLSearchParams(location.search).get('error');
    if (error) { flash(u('oauth')); history.replaceState(null, '', location.pathname); }
  } catch (error) {
    lang = navigator.language?.startsWith('ar') ? 'ar' : 'en';
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    const title = error.status === 404 ? u('notFound') : u('error');
    const text = error.status === 404 ? u('notFoundHint') : error.message;
    root.innerHTML = `${notice('bad', title, text, error.status === 404 ? '' : `<button class="secondary" type="button" data-retry>${u('retry')}</button>`)}${footer()}`;
    root.querySelector('[data-retry]')?.addEventListener('click', load);
  }
}

const discordLogo = '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.32 4.37a19.8 19.8 0 0 0-4.89-1.52.07.07 0 0 0-.08.04c-.21.38-.44.87-.61 1.25a18.27 18.27 0 0 0-5.49 0 12.64 12.64 0 0 0-.62-1.25.08.08 0 0 0-.08-.04 19.74 19.74 0 0 0-4.88 1.52.07.07 0 0 0-.03.03C.53 9.05-.32 13.58.1 18.06a.08.08 0 0 0 .03.06 19.9 19.9 0 0 0 5.99 3.03.08.08 0 0 0 .08-.03c.46-.63.87-1.3 1.23-1.99a.08.08 0 0 0-.04-.1 13.1 13.1 0 0 1-1.87-.9.08.08 0 0 1-.01-.12l.37-.29a.07.07 0 0 1 .08-.01c3.93 1.79 8.18 1.79 12.06 0a.07.07 0 0 1 .08.01l.37.3a.08.08 0 0 1-.01.12c-.6.35-1.22.65-1.87.9a.08.08 0 0 0-.04.1c.36.7.77 1.36 1.23 1.99a.08.08 0 0 0 .08.03 19.84 19.84 0 0 0 6-3.03.08.08 0 0 0 .03-.06c.5-5.18-.84-9.67-3.55-13.66a.06.06 0 0 0-.03-.03ZM8.02 15.33c-1.18 0-2.16-1.08-2.16-2.42 0-1.33.96-2.42 2.16-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.34-.96 2.42-2.16 2.42Zm7.97 0c-1.18 0-2.15-1.08-2.15-2.42 0-1.33.95-2.42 2.15-2.42 1.22 0 2.18 1.1 2.16 2.42 0 1.34-.94 2.42-2.16 2.42Z"/></svg>';

try { const theme = localStorage.getItem('rift-theme'); if (theme) document.body.className = `theme-${theme} af-body`; } catch {}
load();
