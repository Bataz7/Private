import { api, esc, toast } from '../ui.js';
import { ic } from '../icon.js';
import { confirmAction } from '../confirm.js';
import { bindPage, collect, pageErrors, pagesOf, renderPage, tr } from '../apply-form.js';

// ---- Constants ---------------------------------------------------------------------------------

const TYPES = [
  ['short', 'Short answer', 'edit'], ['paragraph', 'Paragraph', 'note-text'], ['number', 'Number', 'sort'], ['url', 'Link', 'link'], ['date', 'Date', 'calendar'],
  ['choice', 'Multiple choice', 'tick-circle'], ['checkbox', 'Checkboxes', 'clipboard-text'], ['dropdown', 'Dropdown', 'arrow-down-01'], ['yesno', 'Yes / No', 'like'], ['scale', 'Linear scale', 'chart-2'],
  ['section', 'Section break', 'category'],
];
const TYPE = Object.fromEntries(TYPES.map(([key, label, icon]) => [key, { label, icon }]));
const CHOICE = new Set(['choice', 'dropdown', 'checkbox']);
const STATUS = { pending: 'Pending', accepted: 'Accepted', rejected: 'Rejected', in_progress: 'In progress', cancelled: 'Cancelled', expired: 'Expired' };
const MODES = { dm: ['Discord DMs', 'message-text', 'The bot asks each question in private messages.'], web: ['Website', 'global', 'Applicants fill a web form after signing in with Discord.'], both: ['DMs + Website', 'flash', 'Applicants choose. The panel shows both buttons.'] };
const TEMPLATES = [
  ['staff-en', 'Staff application', 'crown', 'English form with sections, scenarios and conditional follow-ups.'],
  ['support-en', 'Support team', 'message-circle', 'A shorter English form with availability and a patience scale.'],
  ['staff', 'Staff application (Arabic)', 'crown', 'نموذج إدارة بالعربية: معلومات، خبرة، مواقف وأسئلة مشروطة.'],
  ['support', 'Support team (Arabic)', 'message-circle', 'نموذج فريق الدعم بالعربية مع الأوقات ومقياس الصبر.'],
  ['blank', 'Blank form', 'add', 'Start from an empty form and add your own questions.'],
];

// The dashboard has no Discord emoji renderer: standard emojis are shown as they are (the bot swaps them for Rift emojis in Discord).
const emojiTag = value => `<span class="dp-emoji">${esc(value)}</span>`;
const thumbDown = size => ic('like-1', { size, cls: 'ap-thumb-down' });

const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), byte => (byte % 36).toString(36)).join('');
const clone = value => structuredClone(value);
const ago = value => {
  if (!value) return '-';
  const s = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(value).toLocaleDateString('en-US', { dateStyle: 'medium' });
};
const fullDate = value => (value ? new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '-');
const statusTag = status => `<span class="ap-status s-${esc(status)}">${esc(STATUS[status] || status)}</span>`;
const avatarImg = (url, name, cls = '') => (url ? `<img class="ap-avatar ${cls}" src="${esc(url)}" alt="" loading="lazy" onerror="this.classList.add('broken')">` : `<span class="ap-avatar ap-avatar-fallback ${cls}">${esc((name || '?')[0])}</span>`);

let state = null;
let keysBound = false;

// Each pane render gets a fresh container, so delegated listeners never stack up.
function freshPane() {
  const old = state.el.querySelector('[data-pane-body]');
  const next = old.cloneNode(false);
  old.replaceWith(next);
  return next;
}

// ---- Small dialog helpers ----------------------------------------------------------------------

function openDialog({ title, body, wide = false }) {
  const root = document.createElement('div');
  root.className = 'modal-backdrop ap-dialog-backdrop';
  root.innerHTML = `<section class="modal-card ap-dialog ${wide ? 'wide' : ''}" role="dialog" aria-modal="true"><button class="ap-icon-btn ap-dialog-close" type="button" data-close aria-label="Close">${ic('close-circle', { size: 20 })}</button><h2>${esc(title)}</h2><div class="ap-dialog-body">${body}</div></section>`;
  document.body.appendChild(root);
  const close = () => { root.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = event => { if (event.key === 'Escape') { event.preventDefault(); close(); } };
  document.addEventListener('keydown', onKey, true);
  root.addEventListener('click', event => { if (event.target === root || event.target.closest('[data-close]')) close(); });
  return { root, close };
}

function promptReason({ title, label, confirmText, danger, placeholder = '' }) {
  return new Promise(resolve => {
    const { root, close } = openDialog({ title, body: `<label class="ap-field"><span>${esc(label)}</span><textarea rows="4" maxlength="1000" placeholder="${esc(placeholder)}" data-reason></textarea></label><div class="ap-dialog-actions"><button class="secondary" type="button" data-close>Cancel</button><button class="${danger ? 'danger' : 'primary'}" type="button" data-ok>${esc(confirmText)}</button></div>` });
    let done = false;
    const finish = value => { if (done) return; done = true; close(); resolve(value); };
    root.querySelector('[data-ok]').addEventListener('click', () => finish(root.querySelector('[data-reason]').value.trim()));
    root.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => finish(null)));
    root.addEventListener('click', event => { if (event.target === root) finish(null); });
    root.querySelector('[data-reason]').focus();
  });
}

// ---- Page entry --------------------------------------------------------------------------------

export function render() {
  return '<div class="ap" id="ap"><div class="page-loading"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div></div>';
}

export function bind() {
  window.removeEventListener('beforeunload', guardUnload);
  window.addEventListener('beforeunload', guardUnload);
  state = { el: document.getElementById('ap'), overview: null, options: null, builder: null, responses: { formId: '', status: 'pending', q: '', page: 1, rows: [], total: 0, hasMore: false }, drawerId: '' };
  const params = new URLSearchParams(location.search);
  if (params.get('form')) return openBuilder(params.get('form'));
  if (params.get('id')) { state.responses.status = 'all'; return showResponses().then(() => openResponse(params.get('id'))); }
  if (params.get('tab') === 'responses') return showResponses();
  return showForms();
}

function guardUnload(event) {
  if (state?.builder?.dirty && document.getElementById('ap')) { event.preventDefault(); event.returnValue = ''; }
}

function setQuery(params) {
  const search = new URLSearchParams(params).toString();
  history.replaceState(history.state, '', `${location.pathname}${search ? `?${search}` : ''}`);
}

async function loadOverview() {
  state.overview = await api('/api/applications/overview');
  const badge = document.getElementById('applicationCount');
  if (badge) badge.textContent = String(state.overview.totals.pending || 0);
  return state.overview;
}

async function loadOptions() {
  if (!state.options) state.options = await api('/api/applications/options').catch(() => ({ roles: [], channels: [] }));
  return state.options;
}

function shell(tab, body) {
  const pending = state.overview?.totals?.pending || 0;
  return `<div class="section-head ap-head"><div><h1>Applications</h1><p>Build staff application forms, publish them in Discord or on the web, and review every response in one place.</p></div><div class="ap-head-actions"><button class="primary" type="button" data-new>${ic('add', { size: 16 })} New form</button></div></div>
    <div class="ap-tabs" role="tablist"><button type="button" role="tab" data-tab="forms" aria-selected="${tab === 'forms'}">${ic('clipboard-text', { size: 16 })} Forms</button><button type="button" role="tab" data-tab="responses" aria-selected="${tab === 'responses'}">${ic('people', { size: 16 })} Responses ${pending ? `<b class="ap-count">${pending}</b>` : ''}</button></div>
    <div class="ap-body">${body}</div>`;
}

function bindShell() {
  state.el.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => (button.dataset.tab === 'forms' ? showForms() : showResponses())));
  state.el.querySelector('[data-new]')?.addEventListener('click', chooseTemplate);
}

// ---- Forms tab ---------------------------------------------------------------------------------

function sparkline(daily) {
  const max = Math.max(1, ...daily.map(day => day.count));
  return `<div class="ap-spark" role="img" aria-label="Submissions in the last 14 days">${daily.map(day => `<i style="height:${Math.max(6, Math.round((day.count / max) * 100))}%" class="${day.count ? '' : 'zero'}" title="${esc(day.date)}: ${day.count}"></i>`).join('')}</div>`;
}

function formCard(form) {
  const counts = form.counts || {};
  const total = (counts.pending || 0) + (counts.accepted || 0) + (counts.rejected || 0);
  const questions = form.questions.filter(question => question.type !== 'section').length;
  const mode = MODES[form.settings.mode] || MODES.both;
  return `<article class="ap-form-card" style="--form-color:${esc(form.settings.color)}">
    <button type="button" class="ap-form-main" data-edit="${form.id}">
      <span class="ap-form-top"><span class="ap-form-status ${form.open ? 'open' : ''}">${form.open ? 'Open' : 'Closed'}</span><span class="ap-chip">${ic(mode[1], { size: 13 })} ${mode[0]}</span></span>
      <b>${esc(form.title)}</b>
      <small>${questions} question${questions === 1 ? '' : 's'} · updated ${ago(form.updatedAt)}</small>
    </button>
    <div class="ap-form-stats"><button type="button" data-responses="${form.id}"><b>${counts.pending || 0}</b><span>pending</span></button><button type="button" data-responses="${form.id}" data-status="all"><b>${total}</b><span>total</span></button><span><b>${total ? Math.round(((counts.accepted || 0) / total) * 100) : 0}%</b><span>accepted</span></span></div>
    <div class="ap-form-actions">
      <label class="ap-switch" title="${form.open ? 'Close applications' : 'Open applications'}"><input type="checkbox" data-open-toggle="${form.id}" ${form.open ? 'checked' : ''}><span></span></label>
      <button type="button" class="ap-icon-btn" data-copy="${esc(form.applyUrl)}" title="Copy web form link" ${form.settings.mode === 'dm' ? 'disabled' : ''}>${ic('link', { size: 16 })}</button>
      <button type="button" class="ap-icon-btn" data-duplicate="${form.id}" title="Duplicate">${ic('copy', { size: 16 })}</button>
      <button type="button" class="ap-icon-btn danger" data-delete="${form.id}" title="Delete">${ic('trash', { size: 16 })}</button>
      <button type="button" class="secondary ap-edit-btn" data-edit="${form.id}">${ic('edit-2', { size: 15 })} Edit</button>
    </div>
  </article>`;
}

async function showForms() {
  setQuery({});
  state.builder = null;
  try { await loadOverview(); } catch (error) { state.el.innerHTML = `<div class="error-state">${ic('danger', { size: 28 })}<h3>Could not load applications</h3><p>${esc(error.message)}</p></div>`; return; }
  const { forms, totals, daily, oauthReady } = state.overview;
  const tiles = [['pending', 'Waiting for review', 'clock'], ['accepted', 'Accepted', 'tick-circle'], ['rejected', 'Rejected', 'close-circle'], ['in_progress', 'Applying in DMs now', 'message-text']];
  const body = `${oauthReady ? '' : `<div class="ap-alert">${ic('warning-2', { size: 18 })}<span><b>Web forms need Discord login.</b> Add <code>DISCORD_CLIENT_SECRET</code> to <code>.env</code> so applicants can sign in on the website. DM applications work without it.</span></div>`}
    <section class="ap-stats">${tiles.map(([key, label, icon]) => `<button type="button" class="ap-stat s-${key}" data-stat="${key}">${ic(icon, { size: 18 })}<b>${totals[key] || 0}</b><span>${label}</span></button>`).join('')}<div class="ap-stat ap-stat-chart"><span>Submissions · 14 days</span>${sparkline(daily)}</div></section>
    ${forms.length ? `<section class="ap-form-grid">${forms.map(formCard).join('')}</section>` : `<section class="panel ap-empty"><div class="ap-empty-icon">${ic('clipboard-text', { size: 30 })}</div><h3>No application forms yet</h3><p>Start from a ready-made staff application and customise it, or build one from scratch.</p><div class="ap-template-grid">${TEMPLATES.map(([key, title, icon, text]) => `<button type="button" class="ap-template" data-template="${key}">${ic(icon, { size: 22 })}<b>${title}</b><span>${text}</span></button>`).join('')}</div></section>`}`;
  state.el.innerHTML = shell('forms', body);
  bindShell();
  const el = state.el;
  el.querySelectorAll('[data-template]').forEach(button => button.addEventListener('click', () => createForm(button.dataset.template)));
  el.querySelectorAll('[data-edit]').forEach(button => button.addEventListener('click', () => openBuilder(button.dataset.edit)));
  el.querySelectorAll('[data-responses]').forEach(button => button.addEventListener('click', () => { state.responses.formId = button.dataset.responses; state.responses.status = button.dataset.status || 'pending'; showResponses(); }));
  el.querySelectorAll('[data-stat]').forEach(button => button.addEventListener('click', () => { state.responses.formId = ''; state.responses.status = button.dataset.stat; showResponses(); }));
  el.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', () => copy(button.dataset.copy)));
  el.querySelectorAll('[data-duplicate]').forEach(button => button.addEventListener('click', async () => {
    try { await api(`/api/applications/forms/${button.dataset.duplicate}/duplicate`, { method: 'POST' }); toast('Form duplicated'); showForms(); } catch (error) { toast(error.message); }
  }));
  el.querySelectorAll('[data-delete]').forEach(button => button.addEventListener('click', async () => {
    const form = forms.find(item => item.id === button.dataset.delete);
    const total = Object.values(form?.counts || {}).reduce((sum, n) => sum + n, 0);
    const ok = await confirmAction({ title: `Delete "${form?.title}"?`, message: 'The form, its Discord panel and every response are removed permanently.', confirmText: 'Delete form', typeToConfirm: total ? 'DELETE' : '', details: [`${total} response(s) will be deleted`, 'Applicants already accepted keep their roles'] });
    if (!ok) return;
    try { await api(`/api/applications/forms/${form.id}`, { method: 'DELETE' }); toast('Form deleted'); showForms(); } catch (error) { toast(error.message); }
  }));
  el.querySelectorAll('[data-open-toggle]').forEach(input => input.addEventListener('change', async () => {
    try { const result = await api(`/api/applications/forms/${input.dataset.openToggle}/open`, { method: 'PATCH', body: JSON.stringify({ open: input.checked }) }); toast(`${input.checked ? 'Applications opened' : 'Applications closed'}${result.panelUpdated ? ' · Discord panel updated' : ''}`); showForms(); }
    catch (error) { input.checked = !input.checked; toast(error.message); }
  }));
}

function chooseTemplate() {
  const { root, close } = openDialog({ title: 'Create an application form', wide: true, body: `<p class="ap-muted">Pick a starting point. Everything can be changed afterwards.</p><div class="ap-template-grid">${TEMPLATES.map(([key, title, icon, text]) => `<button type="button" class="ap-template" data-template="${key}">${ic(icon, { size: 22 })}<b>${title}</b><span>${text}</span></button>`).join('')}</div>` });
  root.querySelectorAll('[data-template]').forEach(button => button.addEventListener('click', () => { close(); createForm(button.dataset.template); }));
}

async function createForm(template) {
  try { const { form } = await api('/api/applications/forms', { method: 'POST', body: JSON.stringify({ template }) }); toast('Form created · it stays closed until you open it'); openBuilder(form.id); }
  catch (error) { toast(error.message); }
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Link copied'); } catch { toast(text); }
}

// ---- Builder -----------------------------------------------------------------------------------

async function openBuilder(id) {
  state.el.innerHTML = '<div class="page-loading"><span class="skeleton"></span><span class="skeleton"></span></div>';
  try {
    const [{ form }] = await Promise.all([api(`/api/applications/forms/${id}`), loadOptions()]);
    state.builder = { form, draft: clone({ title: form.title, description: form.description, open: form.open, questions: form.questions, settings: form.settings }), dirty: false, pane: 'questions', active: '', previewPage: 0, previewAnswers: {} };
    setQuery({ form: id });
    renderBuilder();
  } catch (error) {
    state.el.innerHTML = `<div class="error-state">${ic('danger', { size: 28 })}<h3>Could not open this form</h3><p>${esc(error.message)}</p><button class="secondary" data-back type="button">Back to forms</button></div>`;
    state.el.querySelector('[data-back]')?.addEventListener('click', showForms);
  }
}

function markDirty() {
  const builder = state.builder;
  if (!builder) return;
  builder.dirty = true;
  const saveState = state.el.querySelector('.ap-save-state');
  if (saveState) { saveState.textContent = 'Unsaved changes'; saveState.classList.add('dirty'); }
}

function renderBuilder() {
  const { form, draft, pane } = state.builder;
  const panes = [['questions', 'Questions', 'clipboard-text'], ['settings', 'Settings', 'setting-2'], ['publish', 'Publish', 'send-2'], ['preview', 'Preview', 'eye']];
  state.el.innerHTML = `<div class="ap-builder" style="--form-color:${esc(draft.settings.color)}">
    <div class="ap-bar">
      <button type="button" class="ap-icon-btn" data-back title="Back to forms">${ic('arrow-right-01', { size: 18, cls: 'ap-back-icon' })}</button>
      <div class="ap-bar-title"><b>${esc(draft.title || 'Untitled form')}</b><small class="ap-save-state ${state.builder.dirty ? 'dirty' : ''}">${state.builder.dirty ? 'Unsaved changes' : `Saved · ${ago(form.updatedAt)}`}</small></div>
      <label class="ap-open-toggle"><span>${draft.open ? 'Accepting responses' : 'Closed'}</span><span class="ap-switch"><input type="checkbox" data-builder-open ${draft.open ? 'checked' : ''}><span></span></span></label>
      <button type="button" class="secondary" data-view-responses>${ic('people', { size: 15 })} Responses</button>
      <button type="button" class="primary" data-save>${ic('save-2', { size: 15 })} Save</button>
    </div>
    <nav class="ap-subtabs">${panes.map(([key, label, icon]) => `<button type="button" data-pane="${key}" aria-selected="${pane === key}">${ic(icon, { size: 15 })} ${label}</button>`).join('')}</nav>
    <div class="ap-pane" data-pane-body></div>
  </div>`;
  const el = state.el;
  el.querySelector('[data-back]').addEventListener('click', async () => { if (state.builder.dirty && !await confirmAction({ title: 'Discard unsaved changes?', message: 'Your edits to this form have not been saved.', confirmText: 'Discard changes' })) return; showForms(); });
  el.querySelector('[data-view-responses]').addEventListener('click', async () => { if (state.builder.dirty && !await confirmAction({ title: 'Discard unsaved changes?', message: 'Save first if you want to keep your edits.', confirmText: 'Discard and continue' })) return; state.responses.formId = form.id; state.responses.status = 'pending'; state.builder = null; showResponses(); });
  el.querySelector('[data-save]').addEventListener('click', saveForm);
  el.querySelector('[data-builder-open]').addEventListener('change', event => { draft.open = event.target.checked; event.target.closest('.ap-open-toggle').querySelector('span').textContent = draft.open ? 'Accepting responses' : 'Closed'; markDirty(); });
  el.querySelectorAll('[data-pane]').forEach(button => button.addEventListener('click', () => { state.builder.pane = button.dataset.pane; el.querySelectorAll('[data-pane]').forEach(item => item.setAttribute('aria-selected', String(item === button))); renderPane(); }));
  if (!keysBound) {
    keysBound = true;
    document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && state?.builder && document.getElementById('ap')) { event.preventDefault(); saveForm(); } });
  }
  renderPane();
}

function renderPane() {
  const scroll = window.scrollY;
  const body = freshPane();
  const pane = state.builder.pane;
  requestAnimationFrame(() => window.scrollTo(0, scroll));
  if (pane === 'questions') { body.innerHTML = questionsPane(); bindQuestions(body); }
  if (pane === 'settings') { body.innerHTML = settingsPane(); bindSettings(body); }
  if (pane === 'publish') { body.innerHTML = publishPane(); bindPublish(body); }
  if (pane === 'preview') { body.innerHTML = previewPane(); bindPreview(body); }
}

// Returns [message, questionId] pairs, numbered the way the builder shows them.
function localIssues(draft) {
  const issues = [];
  if (!draft.title.trim()) issues.push(['The form needs a title.', '']);
  let number = 0;
  draft.questions.forEach(question => {
    if (question.type !== 'section') number += 1;
    const name = question.type === 'section' ? 'A section' : `Question ${number}`;
    if (!question.label.trim()) issues.push([`${name} needs a title.`, question.id]);
    if (CHOICE.has(question.type) && question.options.filter(option => option.trim()).length < 2) issues.push([`"${question.label || name}" needs at least two options.`, question.id]);
  });
  if (!draft.questions.some(question => question.type !== 'section')) issues.push(['Add at least one question.', '']);
  return issues;
}

async function saveForm() {
  const builder = state.builder;
  if (!builder) return false;
  const issues = localIssues(builder.draft);
  if (issues.length) {
    const [message, questionId] = issues[0];
    toast(message);
    if (questionId) {
      builder.active = questionId;
      builder.pane = 'questions';
      renderBuilder();
      const card = state.el.querySelector(`[data-qid="${questionId}"]`);
      card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card?.querySelector('[data-q="label"]')?.focus({ preventScroll: true });
    }
    return false;
  }
  const button = state.el.querySelector('[data-save]');
  if (button) button.disabled = true;
  try {
    const payload = clone(builder.draft);
    payload.questions.forEach(question => { question.options = question.options.map(option => option.trim()).filter(Boolean); });
    const { form, panelUpdated } = await api(`/api/applications/forms/${builder.form.id}`, { method: 'PUT', body: JSON.stringify(payload) });
    builder.form = form;
    builder.draft = clone({ title: form.title, description: form.description, open: form.open, questions: form.questions, settings: form.settings });
    builder.dirty = false;
    toast(panelUpdated ? 'Saved · Discord panel updated' : 'Form saved');
    renderBuilder();
    return true;
  } catch (error) { toast(error.message); return false; }
  finally { if (button) button.disabled = false; }
}

// Questions pane ---------------------------------------------------------------------------------

function questionsPane() {
  const { draft, active } = state.builder;
  let number = 0;
  return `<div class="ap-qlist">
    <section class="ap-card ap-form-meta"><div class="ap-stripe"></div>
      <input dir="auto" class="ap-title-input" data-meta="title" maxlength="100" value="${esc(draft.title)}" placeholder="Form title">
      <textarea dir="auto" class="ap-desc-input" data-meta="description" rows="3" maxlength="2000" placeholder="Description shown to applicants (optional)">${esc(draft.description)}</textarea>
    </section>
    ${draft.questions.map((question, index) => { if (question.type !== 'section') number += 1; return questionCard(question, index, question.type === 'section' ? 0 : number, question.id === active); }).join('')}
    <div class="ap-add-row"><button type="button" class="ap-add" data-add-menu>${ic('add', { size: 18 })} Add question</button><div class="ap-type-menu" hidden>${TYPES.map(([key, label, icon]) => `<button type="button" data-add="${key}">${ic(icon, { size: 16 })}<span>${label}</span></button>`).join('')}</div></div>
    <p class="ap-hint">${ic('info-circle', { size: 14 })} Drag the handle to reorder. Section breaks split the web form into pages. Up to 40 questions.</p>
  </div>`;
}

function conditionTargets(index) {
  return state.builder.draft.questions.slice(0, index).filter(question => CHOICE.has(question.type) || question.type === 'yesno');
}
const choicesOf = question => (question.type === 'yesno' ? [['yes', 'Yes'], ['no', 'No']] : question.options.filter(Boolean).map(option => [option, option]));

function questionCard(question, index, number, open) {
  const meta = TYPE[question.type] || TYPE.short;
  const head = `<header class="ap-qhead" data-toggle>
      <span class="ap-grip" draggable="true" title="Drag to reorder" aria-hidden="true">${ic('more', { size: 16 })}</span>
      <span class="ap-qnum">${question.type === 'section' ? ic('category', { size: 15 }) : number}</span>
      <span class="ap-qtitle">${esc(question.label) || '<em>Untitled</em>'}</span>
      <span class="ap-qmeta"><span class="ap-chip">${ic(meta.icon, { size: 12 })} ${meta.label}</span>${question.required ? '<span class="ap-chip req">Required</span>' : ''}${question.showIf ? `<span class="ap-chip cond">${ic('hierarchy-2', { size: 12 })} Conditional</span>` : ''}</span>
      <span class="ap-qtools">
        <button type="button" class="ap-icon-btn" data-move="-1" title="Move up" ${index === 0 ? 'disabled' : ''}>${ic('arrow-up-04', { size: 15 })}</button>
        <button type="button" class="ap-icon-btn" data-move="1" title="Move down" ${index === state.builder.draft.questions.length - 1 ? 'disabled' : ''}>${ic('arrow-down-01', { size: 15 })}</button>
        <button type="button" class="ap-icon-btn" data-dup title="Duplicate">${ic('copy', { size: 15 })}</button>
        <button type="button" class="ap-icon-btn danger" data-remove title="Delete">${ic('trash', { size: 15 })}</button>
      </span>
    </header>`;
  if (!open) return `<article class="ap-card ap-qcard ${question.type === 'section' ? 'is-section' : ''}" data-qid="${question.id}">${head}</article>`;
  const typeSelect = `<select data-q="type" class="ap-type-select">${TYPES.map(([key, label]) => `<option value="${key}" ${key === question.type ? 'selected' : ''}>${label}</option>`).join('')}</select>`;
  let specific = '';
  if (CHOICE.has(question.type)) {
    specific = `<div class="ap-options">${question.options.map((option, optionIndex) => `<div class="ap-option"><span class="ap-option-mark ${question.type}">${question.type === 'dropdown' ? optionIndex + 1 : ''}</span><input dir="auto" data-opt="${optionIndex}" maxlength="100" value="${esc(option)}" placeholder="Option ${optionIndex + 1}"><button type="button" class="ap-icon-btn" data-opt-remove="${optionIndex}" title="Remove option" ${question.options.length <= 2 ? 'disabled' : ''}>${ic('close-circle', { size: 15 })}</button></div>`).join('')}
      ${question.options.length < 25 ? `<button type="button" class="ap-link-btn" data-opt-add>${ic('add', { size: 14 })} Add option</button>` : ''}<button type="button" class="ap-link-btn" data-opt-bulk>${ic('note-text', { size: 14 })} Paste a list</button></div>`;
    if (question.type === 'checkbox') specific += `<div class="ap-inline"><label class="ap-field small"><span>Min selections</span><input type="number" min="0" max="${question.options.length}" data-q="min" value="${question.min ?? ''}" placeholder="0"></label><label class="ap-field small"><span>Max selections</span><input type="number" min="1" max="${question.options.length}" data-q="max" value="${question.max ?? ''}" placeholder="${question.options.length}"></label></div>`;
  }
  if (question.type === 'short' || question.type === 'paragraph') {
    const cap = question.type === 'short' ? 300 : 4000;
    specific = `<div class="ap-inline"><label class="ap-field small"><span>Min characters</span><input type="number" min="0" max="${cap}" data-q="min" value="${question.min ?? ''}" placeholder="0"></label><label class="ap-field small"><span>Max characters</span><input type="number" min="1" max="${cap}" data-q="max" value="${question.max ?? ''}" placeholder="${cap}"></label><label class="ap-field"><span>Placeholder</span><input data-q="placeholder" maxlength="100" value="${esc(question.placeholder)}" placeholder="Hint shown inside the box"></label></div>`;
  }
  if (question.type === 'number') specific = `<div class="ap-inline"><label class="ap-field small"><span>Minimum</span><input type="number" step="any" data-q="min" value="${question.min ?? ''}"></label><label class="ap-field small"><span>Maximum</span><input type="number" step="any" data-q="max" value="${question.max ?? ''}"></label></div>`;
  if (question.type === 'scale') specific = `<div class="ap-inline"><label class="ap-field small"><span>From</span><select data-q="min">${[0, 1].map(n => `<option ${Number(question.min ?? 1) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label><label class="ap-field small"><span>To</span><select data-q="max">${[2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => `<option ${Number(question.max ?? 5) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label><label class="ap-field"><span>Low label</span><input data-q="minLabel" maxlength="40" value="${esc(question.minLabel)}" placeholder="e.g. Poor"></label><label class="ap-field"><span>High label</span><input data-q="maxLabel" maxlength="40" value="${esc(question.maxLabel)}" placeholder="e.g. Excellent"></label></div>`;
  const targets = conditionTargets(index);
  const target = question.showIf ? targets.find(item => item.id === question.showIf.questionId) : null;
  const condition = question.type === 'section' ? '' : `<div class="ap-condition ${question.showIf ? 'on' : ''}">
      <label class="ap-field"><span>${ic('hierarchy-2', { size: 14 })} Show this question</span><select data-cond-target ${targets.length ? '' : 'disabled'}><option value="">Always</option>${targets.map(item => `<option value="${item.id}" ${target?.id === item.id ? 'selected' : ''}>Only if “${esc(item.label.slice(0, 60) || 'Untitled')}” is…</option>`).join('')}</select></label>
      ${target ? `<div class="ap-cond-values">${choicesOf(target).map(([value, label]) => `<label class="ap-check"><input type="checkbox" data-cond-value="${esc(value)}" ${question.showIf.values.includes(value) ? 'checked' : ''}><span>${esc(label)}</span></label>`).join('')}</div>` : targets.length ? '' : '<small class="ap-muted">Add a multiple choice, dropdown, checkbox or yes/no question above this one to use conditions.</small>'}
    </div>`;
  return `<article class="ap-card ap-qcard open ${question.type === 'section' ? 'is-section' : ''}" data-qid="${question.id}">${head}
    <div class="ap-qbody">
      <div class="ap-qrow"><input dir="auto" class="ap-label-input" data-q="label" maxlength="300" value="${esc(question.label)}" placeholder="${question.type === 'section' ? 'Section title' : 'Question'}">${typeSelect}</div>
      <textarea dir="auto" data-q="description" rows="2" maxlength="1000" placeholder="${question.type === 'section' ? 'Section description (optional)' : 'Help text shown under the question (optional)'}">${esc(question.description)}</textarea>
      ${specific}
      ${condition}
      ${question.type === 'section' ? '' : `<footer class="ap-qfoot"><label class="ap-toggle"><span class="ap-switch"><input type="checkbox" data-q="required" ${question.required ? 'checked' : ''}><span></span></span> Required</label></footer>`}
    </div>
  </article>`;
}

function newQuestion(type) {
  const base = { id: rid(), type, label: type === 'section' ? 'New section' : '', description: '', required: type !== 'section', placeholder: '', options: [], min: null, max: null, minLabel: '', maxLabel: '', showIf: null };
  if (CHOICE.has(type)) base.options = ['Option 1', 'Option 2'];
  if (type === 'scale') { base.min = 1; base.max = 5; }
  return base;
}

// Changing a question's type keeps what still makes sense and drops the rest.
function retype(question, type) {
  const next = { ...newQuestion(type), id: question.id, label: question.label, description: question.description, required: type === 'section' ? false : question.required, showIf: type === 'section' ? null : question.showIf };
  if (CHOICE.has(type) && CHOICE.has(question.type)) next.options = question.options;
  if ((type === 'short' || type === 'paragraph') && (question.type === 'short' || question.type === 'paragraph')) { next.placeholder = question.placeholder; next.min = question.min; }
  return next;
}

// Drop conditions that no longer point at an earlier choice question with a valid value.
function repairConditions() {
  const questions = state.builder.draft.questions;
  questions.forEach((question, index) => {
    if (!question.showIf) return;
    const target = questions.slice(0, index).find(item => item.id === question.showIf.questionId);
    const allowed = target ? choicesOf(target).map(([value]) => value) : [];
    const values = question.showIf.values.filter(value => allowed.includes(value));
    question.showIf = target && (CHOICE.has(target.type) || target.type === 'yesno') ? { questionId: target.id, values } : null;
  });
}

function bindQuestions(body) {
  const builder = state.builder;
  const { draft } = builder;
  const find = element => { const card = element.closest('[data-qid]'); return card ? { card, index: draft.questions.findIndex(item => item.id === card.dataset.qid) } : null; };
  const rerender = () => { repairConditions(); renderPane(); };
  const focusActive = selector => state.el.querySelector(`[data-qid="${builder.active}"] ${selector}`)?.focus();

  body.addEventListener('input', event => {
    const target = event.target;
    if (target.dataset.meta) { draft[target.dataset.meta] = target.value; if (target.dataset.meta === 'title') { const title = state.el.querySelector('.ap-bar-title b'); if (title) title.textContent = target.value || 'Untitled form'; } return markDirty(); }
    const hit = find(target); if (!hit) return;
    const question = draft.questions[hit.index];
    if (target.dataset.opt !== undefined) { question.options[Number(target.dataset.opt)] = target.value; return markDirty(); }
    const field = target.dataset.q;
    if (!field || field === 'type' || field === 'required' || target.tagName === 'SELECT') return;
    if (field === 'min' || field === 'max') question[field] = target.value === '' ? null : Number(target.value);
    else question[field] = target.value;
    if (field === 'label') hit.card.querySelector('.ap-qtitle').innerHTML = esc(target.value) || '<em>Untitled</em>';
    markDirty();
  });

  body.addEventListener('change', event => {
    const target = event.target;
    const hit = find(target); if (!hit) return;
    const question = draft.questions[hit.index];
    if (target.dataset.q === 'type') { draft.questions[hit.index] = retype(question, target.value); markDirty(); return rerender(); }
    if (target.dataset.q === 'required') { question.required = target.checked; markDirty(); return rerender(); }
    if (target.tagName === 'SELECT' && (target.dataset.q === 'min' || target.dataset.q === 'max')) { question[target.dataset.q] = Number(target.value); return markDirty(); }
    if (target.matches('[data-cond-target]')) {
      const chosen = draft.questions.find(item => item.id === target.value);
      question.showIf = chosen ? { questionId: chosen.id, values: choicesOf(chosen).slice(0, 1).map(([value]) => value) } : null;
      markDirty(); return rerender();
    }
    if (target.matches('[data-cond-value]')) {
      const values = [...hit.card.querySelectorAll('[data-cond-value]:checked')].map(input => input.dataset.condValue);
      if (!values.length) { target.checked = true; return toast('Pick at least one answer, or choose “Always”.'); }
      question.showIf = { ...question.showIf, values };
      return markDirty();
    }
  });

  body.addEventListener('keydown', event => {
    const target = event.target;
    if (target.dataset.opt !== undefined && event.key === 'Enter') {
      event.preventDefault();
      const hit = find(target); const question = draft.questions[hit.index];
      if (question.options.length >= 25) return;
      question.options.splice(Number(target.dataset.opt) + 1, 0, '');
      markDirty(); rerender();
      state.el.querySelector(`[data-qid="${question.id}"] [data-opt="${Number(target.dataset.opt) + 1}"]`)?.focus();
    }
  });

  body.addEventListener('click', event => {
    const target = event.target;
    const addMenu = target.closest('[data-add-menu]');
    if (addMenu) { const menu = body.querySelector('.ap-type-menu'); menu.hidden = !menu.hidden; return; }
    const add = target.closest('[data-add]');
    if (add) {
      if (draft.questions.length >= 40) return toast('A form can have up to 40 questions.');
      const question = newQuestion(add.dataset.add);
      const activeIndex = draft.questions.findIndex(item => item.id === builder.active);
      draft.questions.splice(activeIndex >= 0 ? activeIndex + 1 : draft.questions.length, 0, question);
      builder.active = question.id; markDirty(); rerender(); focusActive('[data-q="label"]');
      return;
    }
    const hit = find(target); if (!hit) return;
    const question = draft.questions[hit.index];
    if (target.closest('[data-move]')) {
      const to = hit.index + Number(target.closest('[data-move]').dataset.move);
      if (to < 0 || to >= draft.questions.length) return;
      draft.questions.splice(to, 0, draft.questions.splice(hit.index, 1)[0]);
      markDirty(); return rerender();
    }
    if (target.closest('[data-dup]')) {
      if (draft.questions.length >= 40) return toast('A form can have up to 40 questions.');
      const copyOf = { ...clone(question), id: rid() };
      draft.questions.splice(hit.index + 1, 0, copyOf); builder.active = copyOf.id; markDirty(); return rerender();
    }
    if (target.closest('[data-remove]')) {
      const dependants = draft.questions.filter(item => item.showIf?.questionId === question.id).length;
      draft.questions.splice(hit.index, 1);
      if (builder.active === question.id) builder.active = '';
      markDirty(); rerender();
      return toast(dependants ? `Question deleted · ${dependants} condition(s) that used it were removed` : 'Question deleted');
    }
    if (target.closest('[data-opt-add]')) { question.options.push(''); markDirty(); rerender(); return state.el.querySelector(`[data-qid="${question.id}"] [data-opt="${question.options.length - 1}"]`)?.focus(); }
    if (target.closest('[data-opt-remove]')) { question.options.splice(Number(target.closest('[data-opt-remove]').dataset.optRemove), 1); markDirty(); return rerender(); }
    if (target.closest('[data-opt-bulk]')) return bulkOptions(question, rerender);
    if (target.closest('[data-toggle]') && !target.closest('button, input, select')) { builder.active = builder.active === question.id ? '' : question.id; rerender(); if (builder.active) focusActive('[data-q="label"]'); }
  });

  // Drag and drop by the grip handle.
  let dragging = null;
  body.querySelectorAll('.ap-grip').forEach(grip => {
    grip.addEventListener('dragstart', event => { dragging = grip.closest('[data-qid]'); dragging.classList.add('dragging'); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', dragging.dataset.qid); });
    grip.addEventListener('dragend', () => { dragging?.classList.remove('dragging'); body.querySelectorAll('.drop-before, .drop-after').forEach(item => item.classList.remove('drop-before', 'drop-after')); dragging = null; });
  });
  body.querySelectorAll('.ap-qcard').forEach(card => {
    card.addEventListener('dragover', event => {
      if (!dragging || card === dragging) return;
      event.preventDefault();
      const after = event.clientY > card.getBoundingClientRect().top + card.offsetHeight / 2;
      card.classList.toggle('drop-after', after); card.classList.toggle('drop-before', !after);
    });
    card.addEventListener('dragleave', () => card.classList.remove('drop-before', 'drop-after'));
    card.addEventListener('drop', event => {
      if (!dragging || card === dragging) return;
      event.preventDefault();
      const from = draft.questions.findIndex(item => item.id === dragging.dataset.qid);
      const [moved] = draft.questions.splice(from, 1);
      let to = draft.questions.findIndex(item => item.id === card.dataset.qid);
      if (card.classList.contains('drop-after')) to += 1;
      draft.questions.splice(to, 0, moved);
      markDirty(); rerender();
    });
  });
}

function bulkOptions(question, rerender) {
  const { root, close } = openDialog({ title: 'Paste options', body: `<p class="ap-muted">One option per line. This replaces the current options (up to 25).</p><textarea class="ap-bulk" rows="10" data-bulk>${esc(question.options.join('\n'))}</textarea><div class="ap-dialog-actions"><button class="secondary" type="button" data-close>Cancel</button><button class="primary" type="button" data-ok>Replace options</button></div>` });
  root.querySelector('[data-ok]').addEventListener('click', () => {
    const options = [...new Set(root.querySelector('[data-bulk]').value.split('\n').map(line => line.trim()).filter(Boolean))].slice(0, 25);
    if (options.length < 2) return toast('Add at least two options.');
    question.options = options; markDirty(); close(); rerender();
  });
}

// Settings pane ----------------------------------------------------------------------------------

function roleOptions(selected, { manageableOnly = false } = {}) {
  return state.options.roles.filter(role => !selected.includes(role.id)).map(role => `<option value="${role.id}" ${manageableOnly && !role.manageable ? 'disabled' : ''}>${esc(role.name)}${manageableOnly && !role.manageable ? ' (above the bot)' : ''}</option>`).join('');
}

function rolePicker(key, label, hint, { manageableOnly = false } = {}) {
  const selected = state.builder.draft.settings[key] || [];
  const chips = selected.map(id => {
    const role = state.options.roles.find(item => item.id === id);
    const warn = manageableOnly && role && !role.manageable;
    return `<span class="ap-role-chip ${warn ? 'warn' : ''}" title="${warn ? 'The bot role is below this role, so it cannot assign it.' : ''}"><i style="background:${esc(role?.color && role.color !== '#000000' ? role.color : 'var(--muted)')}"></i>${esc(role?.name || 'Deleted role')}${warn ? ic('warning-2', { size: 12 }) : ''}<button type="button" data-role-remove="${key}:${id}" aria-label="Remove">${ic('close-circle', { size: 13 })}</button></span>`;
  }).join('');
  return `<div class="ap-field"><span>${label}</span><div class="ap-roles">${chips}<select data-role-add="${key}"><option value="">+ Add role</option>${roleOptions(selected, { manageableOnly })}</select></div>${hint ? `<small>${hint}</small>` : ''}</div>`;
}

function channelSelect(key, label, hint, optional = true) {
  const value = state.builder.draft.settings[key] || '';
  return `<label class="ap-field"><span>${label}</span><select data-setting="${key}"><option value="">${optional ? 'None' : 'Select a channel'}</option>${state.options.channels.map(channel => `<option value="${channel.id}" ${value === channel.id ? 'selected' : ''}>#${esc(channel.name)}</option>`).join('')}</select>${hint ? `<small>${hint}</small>` : ''}</label>`;
}

function roleSelect(key, label, hint) {
  const value = state.builder.draft.settings[key] || '';
  return `<label class="ap-field"><span>${label}</span><select data-setting="${key}"><option value="">None</option>${state.options.roles.map(role => `<option value="${role.id}" ${value === role.id ? 'selected' : ''}>@${esc(role.name)}</option>`).join('')}</select>${hint ? `<small>${hint}</small>` : ''}</label>`;
}

const numberField = (key, label, hint, min, max) => `<label class="ap-field small"><span>${label}</span><input type="number" min="${min}" max="${max}" data-setting="${key}" data-number value="${esc(state.builder.draft.settings[key] ?? 0)}">${hint ? `<small>${hint}</small>` : ''}</label>`;
const textArea = (key, label, hint, placeholder = '') => `<label class="ap-field"><span>${label}</span><textarea dir="auto" rows="3" maxlength="1500" data-setting="${key}" placeholder="${esc(placeholder)}">${esc(state.builder.draft.settings[key] || '')}</textarea>${hint ? `<small>${hint}</small>` : ''}</label>`;
const toggle = (key, label, hint) => `<label class="ap-toggle-row"><span class="ap-switch"><input type="checkbox" data-setting="${key}" data-bool ${state.builder.draft.settings[key] ? 'checked' : ''}><span></span></span><span><b>${label}</b>${hint ? `<small>${hint}</small>` : ''}</span></label>`;
const group = (icon, title, text, content) => `<section class="ap-card ap-group"><header>${ic(icon, { size: 18 })}<div><h3>${title}</h3><p>${text}</p></div></header><div class="ap-group-body">${content}</div></section>`;

function settingsPane() {
  const s = state.builder.draft.settings;
  const closesLocal = s.closesAt ? new Date(new Date(s.closesAt).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
  const placeholders = '<small>Placeholders: <code>{user}</code> <code>{server}</code> <code>{form}</code></small>';
  return `<div class="ap-settings">
    ${group('flash', 'How people apply', 'Choose where the questions are answered.', `<div class="ap-modes">${Object.entries(MODES).map(([key, [label, icon, text]]) => `<label class="ap-mode"><input type="radio" name="mode" data-setting="mode" value="${key}" ${s.mode === key ? 'checked' : ''}><span>${ic(icon, { size: 20 })}<b>${label}</b><small>${text}</small></span></label>`).join('')}</div>
      <div class="ap-inline"><label class="ap-field small"><span>Applicant language</span><select data-setting="language"><option value="ar" ${s.language === 'ar' ? 'selected' : ''}>العربية</option><option value="en" ${s.language === 'en' ? 'selected' : ''}>English</option></select></label>${numberField('dmTimeoutMinutes', 'DM timeout (minutes)', 'Cancel a DM application after this long without a reply.', 5, 1440)}<label class="ap-field small"><span>Accent colour</span><input type="color" data-setting="color" value="${esc(s.color)}"></label></div>
      <label class="ap-field"><span>Banner image URL <em>optional</em></span><input type="url" data-setting="bannerUrl" maxlength="500" placeholder="https://..." value="${esc(s.bannerUrl)}"><small>Shown on the Discord panel, the DM intro and the top of the web form.</small></label>`)}
    ${group('eye', 'Review', 'Where new applications appear and who can decide.', `${channelSelect('reviewChannelId', 'Review channel', 'Each new application is posted here with Accept / Reject / vote buttons. Falls back to the audit log channel.')}
      <div class="ap-inline">${roleSelect('pingRoleId', 'Ping role on new application', 'Optional.')}</div>
      ${rolePicker('reviewerRoleIds', 'Roles that can vote', 'They can like or dislike an application in Discord. Only owners and administrators can accept or reject.')}
      ${toggle('reviewThread', 'Open a discussion thread', 'Creates a thread under each application so reviewers can discuss it.')}`)}
    ${group('tick-circle', 'When accepted', 'Roles and message for accepted applicants.', `${rolePicker('acceptRoleIds', 'Give these roles', '', { manageableOnly: true })}
      ${rolePicker('removeRoleIds', 'Remove these roles', 'For example an “Applicant” role.', { manageableOnly: true })}
      ${toggle('addAsStaff', 'Add as staff member', 'Gives the configured Staff role and creates their staff profile, so they appear in the dashboard, shifts and points.')}
      ${textArea('acceptMessage', 'Acceptance DM', placeholders, 'Leave empty for the default message.')}`)}
    ${group('close-circle', 'When rejected', 'What rejected applicants see and when they can try again.', `${textArea('rejectMessage', 'Rejection DM', placeholders, 'Leave empty for the default message.')}
      ${toggle('shareRejectReason', 'Send the reason to the applicant', 'The reason reviewers type is included in the DM and on the web form.')}
      <div class="ap-inline">${numberField('cooldownDays', 'Re-apply cooldown (days)', '0 lets them apply again right away.', 0, 365)}</div>`)}
    ${group('shield-tick', 'Requirements', 'Checked before anyone can start the form.', `${rolePicker('requiredRoleIds', 'Must have one of these roles', 'Leave empty to allow everyone.')}
      ${rolePicker('blockedRoleIds', 'Cannot apply with these roles', 'For example existing staff, or a blacklist role.')}
      <div class="ap-inline">${numberField('minAccountAgeDays', 'Min account age (days)', '', 0, 3650)}${numberField('minMemberDays', 'Min days in server', '', 0, 3650)}${numberField('maxResponses', 'Response limit', '0 = unlimited.', 0, 100000)}</div>
      <label class="ap-field small"><span>Close automatically at <em>optional</em></span><input type="datetime-local" data-setting="closesAt" value="${closesLocal}"></label>`)}
    ${group('message-text', 'Messages & panel', 'Customise the text applicants see.', `${textArea('confirmationMessage', 'After submitting', `Shown in DMs and sent after web submissions. ${placeholders.replace(/<\/?small>/g, '')}`, 'Leave empty for the default message.')}
      <label class="ap-field"><span>Panel title <em>optional</em></span><input data-setting="panelTitle" maxlength="200" value="${esc(s.panelTitle)}" placeholder="Defaults to the form title"></label>
      <label class="ap-field"><span>Panel description <em>optional</em></span><textarea rows="3" maxlength="2000" data-setting="panelDescription" placeholder="Defaults to the form description">${esc(s.panelDescription)}</textarea></label>
      <label class="ap-field small"><span>Button label <em>optional</em></span><input data-setting="panelButtonLabel" maxlength="60" value="${esc(s.panelButtonLabel)}" placeholder="${s.language === 'ar' ? 'قدّم الآن' : 'Apply now'}"></label>`)}
  </div>`;
}

function bindSettings(body) {
  const settings = state.builder.draft.settings;
  const apply = target => {
    const key = target.dataset.setting; if (!key) return;
    if (target.dataset.bool !== undefined) settings[key] = target.checked;
    else if (target.dataset.number !== undefined) settings[key] = Number(target.value) || 0;
    else if (key === 'closesAt') settings[key] = target.value ? new Date(target.value).toISOString() : null;
    else if (target.type === 'radio') { if (target.checked) settings[key] = target.value; }
    else settings[key] = target.value;
    if (key === 'color') state.el.querySelector('.ap-builder')?.style.setProperty('--form-color', target.value);
    markDirty();
  };
  body.addEventListener('input', event => { if (event.target.matches('input[type=text], input:not([type]), input[type=url], input[type=number], input[type=color], textarea')) apply(event.target); });
  body.addEventListener('change', event => {
    const target = event.target;
    if (target.dataset.roleAdd) { if (!target.value) return; settings[target.dataset.roleAdd] = [...(settings[target.dataset.roleAdd] || []), target.value]; markDirty(); return renderPane(); }
    apply(target);
  });
  body.addEventListener('click', event => {
    const remove = event.target.closest('[data-role-remove]');
    if (!remove) return;
    const [key, id] = remove.dataset.roleRemove.split(':');
    settings[key] = (settings[key] || []).filter(item => item !== id);
    markDirty(); renderPane();
  });
}

// Publish pane -----------------------------------------------------------------------------------

function discordPreview(draft) {
  const s = draft.settings;
  const ar = s.language === 'ar';
  const count = draft.questions.filter(question => question.type !== 'section').length;
  const buttons = [s.mode !== 'web' ? `<span class="dp-btn primary">${emojiTag('📝')} ${esc(s.panelButtonLabel || (ar ? 'قدّم الآن' : 'Apply now'))}</span>` : '', s.mode !== 'dm' ? `<span class="dp-btn">${emojiTag('🌐')} ${ar ? 'التقديم عبر الموقع' : 'Apply on the website'} ${ic('arrow-up-04', { size: 12 })}</span>` : ''].join('');
  return `<div class="dp" dir="ltr"><div class="dp-avatar"><img src="/logo-mark.svg" alt=""></div><div class="dp-main"><div class="dp-name">Rift <span>APP</span></div>
    <div class="dp-embed" style="border-inline-start-color:${esc(s.color)}"><b dir="auto">📝 ${esc(s.panelTitle || draft.title)}</b><p dir="auto">${esc(s.panelDescription || draft.description || (ar ? 'اضغط الزر بالأسفل لبدء التقديم...' : 'Press the button below to apply...'))}</p>
      <div class="dp-fields" dir="auto"><span><small>${ar ? 'عدد الأسئلة' : 'Questions'}</small>${count}</span><span><small>${ar ? 'الحالة' : 'Status'}</small>${draft.open ? `${emojiTag('🟢')} ${ar ? 'مفتوح' : 'Open'}` : `${emojiTag('🔴')} ${ar ? 'مغلق' : 'Closed'}`}</span></div>
      ${s.bannerUrl ? `<img class="dp-banner" src="${esc(s.bannerUrl)}" alt="" onerror="this.remove()">` : ''}</div>
    <div class="dp-buttons">${buttons}</div></div></div>`;
}

function publishPane() {
  const { form, draft } = state.builder;
  const panelChannel = state.options.channels.find(channel => channel.id === form.panel?.channelId);
  const webOff = draft.settings.mode === 'dm';
  return `<div class="ap-publish">
    <section class="ap-card ap-group"><header>${ic('send-2', { size: 18 })}<div><h3>Discord panel</h3><p>Post the apply message in a channel. Sending again updates the same message.</p></div></header><div class="ap-group-body">
      <div class="ap-inline ap-panel-row"><label class="ap-field"><span>Channel</span><select data-panel-channel><option value="">Select a channel...</option>${state.options.channels.map(channel => `<option value="${channel.id}" ${form.panel?.channelId === channel.id ? 'selected' : ''}>#${esc(channel.name)}</option>`).join('')}</select></label><button type="button" class="primary" data-send-panel>${ic('send-2', { size: 15 })} ${form.panel?.messageId ? 'Update panel' : 'Send panel'}</button></div>
      ${panelChannel && form.panel?.messageId ? `<p class="ap-muted">${ic('tick-circle', { size: 14 })} Live in <b>#${esc(panelChannel.name)}</b> · it refreshes automatically when you save or open/close the form.</p>` : ''}
      ${draft.open ? '' : `<div class="ap-alert">${ic('info-circle', { size: 18 })}<span>The form is <b>closed</b>, so the panel button will be disabled. Turn on “Accepting responses” at the top when you are ready.</span></div>`}
      <div class="ap-preview-label">Preview</div>${discordPreview(draft)}
    </div></section>
    <section class="ap-card ap-group"><header>${ic('global', { size: 18 })}<div><h3>Web form</h3><p>Share this link anywhere. Applicants sign in with Discord, so you always know who applied.</p></div></header><div class="ap-group-body">
      ${webOff ? `<div class="ap-alert">${ic('info-circle', { size: 18 })}<span>This form is set to <b>Discord DMs only</b>. Switch “How people apply” in Settings to enable the website.</span></div>` : ''}
      <div class="ap-link-box"><input readonly value="${esc(form.applyUrl)}" dir="ltr"><button type="button" class="secondary" data-copy-link ${webOff ? 'disabled' : ''}>${ic('copy', { size: 15 })} Copy</button><a class="secondary" href="${esc(form.applyUrl)}" target="_blank" rel="noopener">${ic('arrow-up-04', { size: 15 })} Open</a></div>
    </div></section>
  </div>`;
}

function bindPublish(body) {
  const { form } = state.builder;
  body.querySelector('[data-copy-link]')?.addEventListener('click', () => copy(form.applyUrl));
  body.querySelector('[data-send-panel]')?.addEventListener('click', async event => {
    const channelId = body.querySelector('[data-panel-channel]').value;
    if (!channelId) return toast('Choose a channel first.');
    const button = event.currentTarget;
    if (state.builder.dirty && !await saveForm()) return;
    button.disabled = true;
    try {
      const result = await api(`/api/applications/forms/${form.id}/panel`, { method: 'POST', body: JSON.stringify({ channelId }) });
      toast(result.updated ? 'Panel updated' : 'Panel sent');
      const { form: fresh } = await api(`/api/applications/forms/${form.id}`);
      state.builder.form = fresh;
      if (state.builder.pane === 'publish') renderPane();
    } catch (error) { toast(error.message); }
    finally { button.disabled = false; }
  });
}

// Preview pane -----------------------------------------------------------------------------------

function previewPane() {
  const { draft, previewPage } = state.builder;
  const lang = draft.settings.language;
  const form = { ...draft, language: lang };
  const pages = pagesOf(draft.questions);
  const page = Math.min(previewPage, pages.length - 1);
  return `<div class="ap-preview-wrap"><p class="ap-muted ap-preview-note">${ic('eye', { size: 14 })} This is how the web form looks to applicants. Answers here are not saved.</p>
    <div class="af-preview" dir="${lang === 'ar' ? 'rtl' : 'ltr'}" style="--accent:${esc(draft.settings.color)}">
      <div class="af-card af-head">${draft.settings.bannerUrl ? `<div class="af-banner"><img src="${esc(draft.settings.bannerUrl)}" alt="" onerror="this.parentElement.remove()"></div>` : '<div class="af-stripe"></div>'}<div class="af-head-body"><h1>${esc(draft.title)}</h1>${draft.description ? `<p class="af-lead">${esc(draft.description)}</p>` : ''}</div></div>
      <form class="af-card af-form" novalidate>${pages.length > 1 ? `<div class="af-progress"><div class="af-progress-bar"><i style="width:${Math.round(((page + 1) / pages.length) * 100)}%"></i></div><span>${tr(lang, 'page', { n: page + 1, total: pages.length })}</span></div>` : ''}
        <div class="af-page">${renderPage(form, page, { answers: state.builder.previewAnswers, errors: state.builder.previewErrors || {} })}</div>
        <div class="af-actions">${page > 0 ? `<button type="button" class="secondary" data-pprev>${tr(lang, 'back')}</button>` : '<span></span>'}${page < pages.length - 1 ? `<button type="button" class="primary" data-pnext>${tr(lang, 'next')}</button>` : `<button type="button" class="primary" data-pcheck>${tr(lang, 'submit')}</button>`}</div>
      </form>
    </div></div>`;
}

function bindPreview(body) {
  const builder = state.builder;
  const form = { ...builder.draft, language: builder.draft.settings.language };
  const pageEl = body.querySelector('.af-page');
  bindPage(pageEl, form, builder.previewAnswers);
  const pages = pagesOf(form.questions);
  const page = Math.min(builder.previewPage, pages.length - 1);
  builder.previewErrors = {};
  const errorsOrMove = step => {
    collect(pageEl, form, builder.previewAnswers);
    const errors = pageErrors(form, page, builder.previewAnswers);
    if (Object.keys(errors).length) { builder.previewErrors = errors; return renderPane(); }
    if (step === 0) return toast('Looks good. On the real form this would submit the application.');
    builder.previewPage = page + step; renderPane();
  };
  body.querySelector('[data-pnext]')?.addEventListener('click', () => errorsOrMove(1));
  body.querySelector('[data-pprev]')?.addEventListener('click', () => { collect(pageEl, form, builder.previewAnswers); builder.previewPage = Math.max(0, page - 1); renderPane(); });
  body.querySelector('[data-pcheck]')?.addEventListener('click', () => errorsOrMove(0));
}

// ---- Responses tab -----------------------------------------------------------------------------

async function showResponses() {
  state.builder = null;
  if (!state.overview) await loadOverview().catch(() => null);
  const r = state.responses;
  setQuery({ tab: 'responses' });
  const forms = state.overview?.forms || [];
  const statuses = [['pending', 'Pending'], ['accepted', 'Accepted'], ['rejected', 'Rejected'], ['in_progress', 'In progress'], ['all', 'All decided']];
  const body = `<div class="list-tools ap-filters">
      <label class="lt-search">${ic('search-normal', { size: 18 })}<input type="search" data-filter="q" value="${esc(r.q)}" placeholder="Search name, username or ID" aria-label="Search applicants"></label>
      <select data-filter="formId" aria-label="Form"><option value="">All forms</option>${forms.map(form => `<option value="${form.id}" ${r.formId === form.id ? 'selected' : ''}>${esc(form.title)}</option>`).join('')}</select>
      <div class="ap-seg" role="radiogroup">${statuses.map(([key, label]) => `<button type="button" data-status="${key}" aria-pressed="${r.status === key}">${label}</button>`).join('')}</div>
      ${r.formId ? `<a class="secondary ap-export" href="/api/applications/forms/${r.formId}/export.csv">${ic('document-text', { size: 16 })} Export CSV</a>` : ''}
    </div>
    <section class="panel ap-list-panel"><div class="ap-rows" data-rows><div class="page-loading"><span class="skeleton"></span><span class="skeleton"></span></div></div><div class="au-foot"><button type="button" class="secondary" data-more hidden>Load more</button></div></section>`;
  state.el.innerHTML = shell('responses', body);
  bindShell();
  let timer;
  state.el.querySelector('[data-filter="q"]').addEventListener('input', event => { clearTimeout(timer); timer = setTimeout(() => { r.q = event.target.value; loadRows(true); }, 250); });
  state.el.querySelector('[data-filter="formId"]').addEventListener('change', event => { r.formId = event.target.value; showResponses(); });
  state.el.querySelectorAll('[data-status]').forEach(button => button.addEventListener('click', () => { r.status = button.dataset.status; state.el.querySelectorAll('[data-status]').forEach(item => item.setAttribute('aria-pressed', String(item === button))); loadRows(true); }));
  state.el.querySelector('[data-more]').addEventListener('click', () => { r.page += 1; loadRows(false); });
  await loadRows(true);
}

async function loadRows(reset) {
  const r = state.responses;
  if (reset) { r.page = 1; r.rows = []; }
  const rowsEl = state.el.querySelector('[data-rows]');
  if (!rowsEl) return;
  try {
    const data = await api(`/api/applications/responses?${new URLSearchParams({ formId: r.formId, status: r.status, q: r.q, page: String(r.page) })}`);
    r.rows = r.rows.concat(data.rows); r.total = data.total; r.hasMore = data.hasMore;
    rowsEl.innerHTML = r.rows.length ? `<div class="ap-rows-head"><span>Applicant</span><span>Form</span><span>Submitted</span><span>Votes</span><span>Status</span></div>${r.rows.map(row => `<button type="button" class="ap-row ${state.drawerId === row.id ? 'active' : ''}" data-open="${row.id}">
        <span class="ap-row-user">${avatarImg(row.avatar, row.displayName)}<span><b>${esc(row.displayName || row.username)}</b><small>@${esc(row.username)} · ${row.source === 'web' ? `${ic('global', { size: 12 })} Web` : `${ic('message-text', { size: 12 })} DM`}</small></span></span>
        <span class="ap-row-form">${esc(row.formTitle)}<small>${row.answered}/${row.questionCount} answered</small></span>
        <span class="ap-row-time" title="${esc(fullDate(row.submittedAt || row.createdAt))}">${row.status === 'in_progress' ? `started ${ago(row.createdAt)}` : ago(row.submittedAt)}</span>
        <span class="ap-row-votes"><span>${ic('like-1', { size: 13 })} ${row.up}</span><span>${thumbDown(13)} ${row.down}</span></span>
        <span>${statusTag(row.status)}</span>
      </button>`).join('')}` : `<div class="empty"><div><b>No applications here</b><span>${r.status === 'pending' ? 'New submissions will appear here for review.' : 'Try another filter.'}</span></div></div>`;
    rowsEl.querySelectorAll('[data-open]').forEach(button => button.addEventListener('click', () => openResponse(button.dataset.open)));
    const more = state.el.querySelector('[data-more]');
    if (more) more.hidden = !r.hasMore;
  } catch (error) { rowsEl.innerHTML = `<div class="error-state">${ic('danger', { size: 28 })}<h3>Could not load applications</h3><p>${esc(error.message)}</p></div>`; }
}

// ---- Response drawer ---------------------------------------------------------------------------

function closeDrawer() {
  document.querySelector('.ap-drawer')?.remove();
  state.drawerId = '';
  state.el?.querySelectorAll('.ap-row.active').forEach(row => row.classList.remove('active'));
  if (new URLSearchParams(location.search).get('id')) setQuery({ tab: 'responses' });
}

async function openResponse(id) {
  document.querySelector('.ap-drawer')?.remove();
  state.drawerId = id;
  state.el.querySelectorAll('.ap-row').forEach(row => row.classList.toggle('active', row.dataset.open === id));
  const drawer = document.createElement('div');
  drawer.className = 'ap-drawer';
  drawer.innerHTML = `<div class="ap-drawer-scrim" data-dclose></div><aside class="ap-drawer-card" role="dialog" aria-modal="true" aria-label="Application"><div class="page-loading"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div></aside>`;
  document.body.appendChild(drawer);
  const onKey = event => { if (event.key === 'Escape' && !document.querySelector('.ap-dialog-backdrop, .confirm-backdrop')) { closeDrawer(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
  drawer.querySelector('[data-dclose]').addEventListener('click', () => { closeDrawer(); document.removeEventListener('keydown', onKey); });
  setQuery({ tab: 'responses', id });
  try {
    const { application: app } = await api(`/api/applications/responses/${id}`);
    if (state.drawerId !== id) return;
    renderDrawer(drawer.querySelector('.ap-drawer-card'), app, () => { closeDrawer(); document.removeEventListener('keydown', onKey); });
  } catch (error) {
    drawer.querySelector('.ap-drawer-card').innerHTML = `<div class="error-state">${ic('danger', { size: 28 })}<h3>Could not open this application</h3><p>${esc(error.message)}</p></div>`;
  }
}

function renderDrawer(card, app, close) {
  const up = app.votes.filter(vote => vote.value === 'up');
  const down = app.votes.filter(vote => vote.value === 'down');
  const mine = app.votes.find(vote => vote.userId === window.me?.user?.id)?.value;
  const sectionBefore = new Map(app.sections.map(section => [section.before, section.label]));
  const meta = [
    ['Form', esc(app.formTitle)], ['Source', app.source === 'web' ? `${ic('global', { size: 13 })} Website` : `${ic('message-text', { size: 13 })} Discord DM`],
    ['Submitted', app.submittedAt ? `<span title="${esc(fullDate(app.submittedAt))}">${ago(app.submittedAt)}</span>` : 'Not yet'],
    ['Account created', app.accountCreatedAt ? `<span title="${esc(fullDate(app.accountCreatedAt))}">${ago(app.accountCreatedAt)}</span>` : '-'],
    ['Joined server', app.memberJoinedAt ? `<span title="${esc(fullDate(app.memberJoinedAt))}">${ago(app.memberJoinedAt)}</span>` : '-'],
    ['In server', app.stillMember ? '<span class="ap-good">Yes</span>' : '<span class="ap-bad">Left the server</span>'],
  ];
  card.innerHTML = `<header class="ap-drawer-head">
      ${avatarImg(app.avatar, app.displayName, 'lg')}
      <div><h2>${esc(app.displayName || app.username)}</h2><small>@${esc(app.username)} · <button type="button" class="ap-link-btn" data-copy-id>${esc(app.userId)}</button></small></div>
      ${statusTag(app.status)}
      <button type="button" class="ap-icon-btn" data-close-drawer aria-label="Close">${ic('close-circle', { size: 20 })}</button>
    </header>
    ${app.status === 'pending' ? `<div class="ap-decide">
      <button type="button" class="primary ap-accept" data-decide="accepted">${ic('tick-circle', { size: 16 })} Accept</button>
      <button type="button" class="danger" data-decide="rejected">${ic('close-circle', { size: 16 })} Reject</button>
      <span class="ap-votes"><button type="button" class="ap-vote ${mine === 'up' ? 'on' : ''}" data-vote="up" title="${esc(up.map(vote => vote.name).join(', ') || 'No votes')}">${ic('like-1', { size: 15 })} ${up.length}</button><button type="button" class="ap-vote ${mine === 'down' ? 'on' : ''}" data-vote="down" title="${esc(down.map(vote => vote.name).join(', ') || 'No votes')}">${thumbDown(15)} ${down.length}</button></span>
    </div>` : ''}
    ${app.status === 'accepted' || app.status === 'rejected' ? `<div class="ap-decision s-${app.status}">${ic(app.status === 'accepted' ? 'tick-circle' : 'close-circle', { size: 18 })}<div><b>${app.status === 'accepted' ? 'Accepted' : 'Rejected'} by ${esc(app.reviewerName || 'unknown')}</b><small>${fullDate(app.reviewedAt)}</small>${app.decisionReason ? `<p>${esc(app.decisionReason)}</p>` : ''}</div></div>` : ''}
    <dl class="ap-meta">${meta.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl>
    ${app.roles.length ? `<div class="ap-member-roles">${app.roles.map(role => `<span class="ap-role-chip"><i style="background:${esc(role.color !== '#000000' ? role.color : 'var(--muted)')}"></i>${esc(role.name)}</span>`).join('')}</div>` : ''}
    <section class="ap-answers">${app.items.map((item, index) => `${sectionBefore.has(item.id) ? `<h4 class="ap-answer-section">${esc(sectionBefore.get(item.id))}</h4>` : ''}<div class="ap-answer ${item.answered ? '' : 'empty'}"><span class="ap-answer-q"><i>${index + 1}</i>${esc(item.label)}</span><div class="ap-answer-a">${esc(item.text)}</div></div>`).join('') || '<p class="ap-muted">No answers yet.</p>'}</section>
    <section class="ap-notes"><h4>${ic('note-text', { size: 16 })} Private notes <small>Only visible to reviewers</small></h4>
      ${app.notes.map(note => `<div class="ap-note"><b>${esc(note.name)}</b><small>${ago(note.createdAt)}</small><p>${esc(note.text)}</p></div>`).join('')}
      <form class="ap-note-form" data-note><textarea rows="2" maxlength="1000" placeholder="Add a note for other reviewers..." required></textarea><button class="secondary" type="submit">Add note</button></form>
    </section>
    ${app.history.length ? `<section class="ap-history"><h4>${ic('clock', { size: 16 })} Other applications</h4>${app.history.map(item => `<button type="button" class="ap-history-item" data-history="${item.id}"><span>${esc(item.formTitle)}</span><small>${ago(item.submittedAt)}</small>${statusTag(item.status)}</button>`).join('')}</section>` : ''}
    <footer class="ap-drawer-foot">${app.reviewUrl ? `<a class="secondary" href="${esc(app.reviewUrl)}" target="_blank" rel="noopener">${ic('message-text', { size: 15 })} Open in Discord</a>` : '<span></span>'}<button type="button" class="ap-link-btn danger" data-delete-app>${ic('trash', { size: 14 })} Delete</button></footer>`;

  card.querySelector('[data-close-drawer]').addEventListener('click', close);
  card.querySelector('[data-copy-id]').addEventListener('click', () => copy(app.userId));
  card.querySelectorAll('[data-history]').forEach(button => button.addEventListener('click', () => openResponse(button.dataset.history)));
  card.querySelectorAll('[data-vote]').forEach(button => button.addEventListener('click', async () => {
    try { await api(`/api/applications/responses/${app.id}/vote`, { method: 'POST', body: JSON.stringify({ value: button.dataset.vote }) }); openResponse(app.id); } catch (error) { toast(error.message); }
  }));
  card.querySelectorAll('[data-decide]').forEach(button => button.addEventListener('click', async () => {
    const accepted = button.dataset.decide === 'accepted';
    const reason = await promptReason(accepted
      ? { title: `Accept ${app.displayName || app.username}?`, label: 'Internal note (optional)', confirmText: 'Accept application', placeholder: 'Roles from the form settings are given and the applicant gets a DM.' }
      : { title: `Reject ${app.displayName || app.username}?`, label: 'Reason (optional)', confirmText: 'Reject application', danger: true, placeholder: 'Sent to the applicant if “Send the reason” is on.' });
    if (reason === null) return;
    card.querySelectorAll('[data-decide]').forEach(item => { item.disabled = true; });
    try {
      const result = await api(`/api/applications/responses/${app.id}/decision`, { method: 'POST', body: JSON.stringify({ decision: button.dataset.decide, reason }) });
      toast(`${accepted ? 'Accepted' : 'Rejected'}${result.warnings?.length ? ` · ${result.warnings[0]}` : ''}`);
      const r = state.responses;
      const index = r.rows.findIndex(row => row.id === app.id);
      if (index >= 0 && r.status === 'pending') r.rows.splice(index, 1);
      else if (index >= 0) r.rows[index].status = button.dataset.decide;
      if (state.overview) state.overview.totals.pending = Math.max(0, (state.overview.totals.pending || 0) - 1);
      const badge = document.getElementById('applicationCount'); if (badge && state.overview) badge.textContent = String(state.overview.totals.pending);
      const tabCount = state.el.querySelector('.ap-tabs .ap-count');
      if (tabCount && state.overview) { tabCount.textContent = String(state.overview.totals.pending); tabCount.hidden = !state.overview.totals.pending; }
      await loadRowsView();
      const next = r.status === 'pending' ? r.rows[Math.min(index, r.rows.length - 1)] : null;
      if (next) openResponse(next.id); else openResponse(app.id);
    } catch (error) { toast(error.message); card.querySelectorAll('[data-decide]').forEach(item => { item.disabled = false; }); }
  }));
  card.querySelector('[data-note]').addEventListener('submit', async event => {
    event.preventDefault();
    const text = event.currentTarget.querySelector('textarea').value.trim();
    if (!text) return;
    try { await api(`/api/applications/responses/${app.id}/notes`, { method: 'POST', body: JSON.stringify({ text }) }); openResponse(app.id); } catch (error) { toast(error.message); }
  });
  card.querySelector('[data-delete-app]').addEventListener('click', async () => {
    const ok = await confirmAction({ title: 'Delete this application?', message: 'The response and its notes are removed permanently. Roles already given are not changed.', confirmText: 'Delete application' });
    if (!ok) return;
    try { await api(`/api/applications/responses/${app.id}`, { method: 'DELETE' }); toast('Application deleted'); close(); state.responses.rows = state.responses.rows.filter(row => row.id !== app.id); loadRowsView(); } catch (error) { toast(error.message); }
  });
}

// Re-renders the current list without refetching the pages already loaded.
async function loadRowsView() {
  const r = state.responses;
  const pages = r.page;
  r.page = 1; r.rows = [];
  for (let page = 1; page <= pages; page += 1) { r.page = page; await loadRows(false); }
}
