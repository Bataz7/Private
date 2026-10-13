import { api, esc, toast } from '../ui.js';
import { ic } from '../icon.js';
import { confirmAction } from '../confirm.js';
import { renderMessage } from '../modreports-preview.js';

const ACTIONS = { warn: ['warning-2', 'Warn'], mute: ['timer-pause', 'Mute / Timeout'], kick: ['logout-01', 'Kick'], ban: ['lock', 'Ban'], unban: ['security-user', 'Unban'], other: ['flag', 'Other'] };
const STATUS = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' };
const pad = n => `#${String(n).padStart(4, '0')}`;
const ago = value => { const s = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000)); if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; if (s < 2592000) return `${Math.floor(s / 86400)}d ago`; return new Date(value).toLocaleDateString('en-US', { dateStyle: 'medium' }); };
const full = value => (value ? new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '-');
const tag = status => `<span class="tag ${status}">${STATUS[status]}</span>`;
const avatar = (url, name, cls = '') => (url ? `<img class="mr-avatar ${cls}" src="${esc(url)}" alt="" onerror="this.classList.add('broken')">` : `<span class="mr-avatar ${cls}">${esc((name || '?')[0])}</span>`);
// action() is plain text (options, dialog titles); actionHtml() adds the icon where HTML is allowed.
const action = key => ACTIONS[key]?.[1] || key;
const actionHtml = key => `<span class="mr-act">${ACTIONS[key] ? ic(ACTIONS[key][0], { size: 15 }) : ''}${esc(action(key))}</span>`;

let state = null;

export function render() { return '<div class="mr" id="mr"><div class="page-loading"><span class="skeleton"></span><span class="skeleton"></span></div></div>'; }

export async function bind() {
  document.querySelector('.mr-drawer')?.remove();
  state = { el: document.getElementById('mr'), overview: null, options: null, tab: 'reports', filter: { status: 'pending', action: '', q: '', page: 1 }, rows: [], hasMore: false, drawer: '' };
  try { [state.overview, state.options] = await Promise.all([api('/api/mod-reports/overview'), api('/api/mod-reports/options').catch(() => ({ roles: [], channels: [] }))]); }
  catch (error) { state.el.innerHTML = `<div class="error-state">${ic('danger', { size: 28 })}<h3>Could not load moderation reports</h3><p>${esc(error.message)}</p></div>`; return; }
  const id = new URLSearchParams(location.search).get('id');
  if (id) state.filter.status = 'all';
  paint();
  if (id) openReport(id);
}

function paint() {
  const { totals } = state.overview;
  state.el.innerHTML = `<div class="section-head"><div><h1>Mod reports</h1><p>Moderators report every mute, kick and ban from the Discord panel. Administrators approve or reject them here or in the review channel.</p></div></div>
    <div class="mr-tabs" role="tablist"><button type="button" role="tab" data-tab="reports" aria-selected="${state.tab === 'reports'}">${ic('shield-tick', { size: 16 })} Reports ${totals.pending ? `<b class="mr-count">${totals.pending}</b>` : ''}</button><button type="button" role="tab" data-tab="settings" aria-selected="${state.tab === 'settings'}">${ic('setting-2', { size: 16 })} Settings &amp; panel</button></div>
    <div data-body></div>`;
  state.el.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => { state.tab = button.dataset.tab; paint(); }));
  const nav = document.getElementById('modReportCount'); if (nav) { nav.textContent = totals.pending; nav.classList.toggle('hidden', !totals.pending); }
  if (state.tab === 'reports') reportsTab(); else settingsTab();
}

// ---- Reports -----------------------------------------------------------------------------------

function reportsTab() {
  const { totals, actions, top, settings } = state.overview;
  const f = state.filter;
  const body = state.el.querySelector('[data-body]');
  body.innerHTML = `<div class="mr">${settings.reviewChannelId ? '' : `<div class="mr-alert">${ic('warning-2', { size: 18 })}<span><b>No review channel yet.</b> Reports are posted to the audit log channel until you choose one in <b>Settings &amp; panel</b>.</span></div>`}
    <section class="mr-stats">
      ${[['pending', 'Waiting for review', 'clock'], ['approved', 'Approved', 'tick-circle'], ['rejected', 'Rejected', 'close-circle']].map(([key, label, icon]) => `<button type="button" class="mr-stat ${key}" data-stat="${key}">${ic(icon, { size: 18 })}<b>${totals[key]}</b><span>${label}</span></button>`).join('')}
      <div class="mr-stat wide"><span>Last 30 days</span><div class="mr-chips">${Object.entries(actions).filter(([, n]) => n).map(([key, n]) => `<span class="mr-chip">${ic(ACTIONS[key][0], { size: 14 })} ${ACTIONS[key][1]} <b>${n}</b></span>`).join('') || '<small class="mr-muted">No reports yet</small>'}</div></div>
      <div class="mr-stat wide"><span>Most active this week</span><div class="mr-top">${top.slice(0, 4).map(item => `<span class="mr-top-item">${avatar(item.avatar, item.displayName)}<b>${esc(item.displayName || item.userId)}</b><small>${item.n} sent · ${item.approved} approved</small></span>`).join('') || '<small class="mr-muted">Nobody yet</small>'}</div></div>
    </section>
    <div class="list-tools">
      <label class="lt-search">${ic('search-normal', { size: 18 })}<input type="search" data-q value="${esc(f.q)}" placeholder="#number, user ID, moderator or reason" aria-label="Search reports"></label>
      <select data-action aria-label="Action"><option value="">All actions</option>${Object.keys(ACTIONS).map(key => `<option value="${key}" ${f.action === key ? 'selected' : ''}>${action(key)}</option>`).join('')}</select>
      <div class="mr-seg">${[['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['all', 'All']].map(([key, label]) => `<button type="button" data-status="${key}" aria-pressed="${f.status === key}">${label}</button>`).join('')}</div>
    </div>
    <section class="panel"><div data-rows><div class="page-loading"><span class="skeleton"></span></div></div><div class="mr-foot"><button type="button" class="secondary" data-more hidden>Load more</button></div></section></div>`;
  let timer;
  body.querySelector('[data-q]').addEventListener('input', event => { clearTimeout(timer); timer = setTimeout(() => { f.q = event.target.value; load(true); }, 250); });
  body.querySelector('[data-action]').addEventListener('change', event => { f.action = event.target.value; load(true); });
  body.querySelectorAll('[data-status]').forEach(button => button.addEventListener('click', () => { f.status = button.dataset.status; body.querySelectorAll('[data-status]').forEach(item => item.setAttribute('aria-pressed', String(item === button))); load(true); }));
  body.querySelectorAll('[data-stat]').forEach(button => button.addEventListener('click', () => { f.status = button.dataset.stat; reportsTab(); }));
  body.querySelector('[data-more]').addEventListener('click', () => { f.page += 1; load(false); });
  load(true);
}

async function load(reset) {
  const f = state.filter;
  if (reset) { f.page = 1; state.rows = []; }
  const el = state.el.querySelector('[data-rows]'); if (!el) return;
  try {
    const data = await api(`/api/mod-reports?${new URLSearchParams({ status: f.status, action: f.action, q: f.q, page: String(f.page) })}`);
    state.rows = state.rows.concat(data.rows); state.hasMore = data.hasMore;
    el.innerHTML = state.rows.length ? `<div class="mr-head mr-grid"><span>Report</span><span>User</span><span>Moderator</span><span>When</span><span>Status</span></div>${state.rows.map(row => `<button type="button" class="mr-row mr-grid ${state.drawer === row.id ? 'active' : ''}" data-open="${row.id}">
        <span class="mr-cell"><b>${pad(row.number)} ${actionHtml(row.action)}</b><small dir="auto">${esc(row.reason)}</small></span>
        <span class="mr-person">${avatar(row.targetAvatar, row.targetTag)}<span><b>${esc(row.targetTag || row.targetUserId)}</b><small>${esc(row.targetUserId)}</small></span></span>
        <span class="mr-person">${avatar(row.moderatorAvatar, row.moderator)}<span><b>${esc(row.moderator)}</b><small class="mr-meta">${row.notes ? `<span>${ic('note-text', { size: 12 })} ${row.notes}</span>` : ''}${row.flags ? `<span class="mr-warn">${ic('warning-2', { size: 12 })} ${row.flags}</span>` : ''}</small></span></span>
        <span class="mr-time">${ago(row.createdAt)}</span><span>${tag(row.status)}</span></button>`).join('')}` : `<div class="empty"><div><b>No reports here</b><span>${f.status === 'pending' ? 'New reports appear here as soon as moderators submit them.' : 'Try another filter.'}</span></div></div>`;
    el.querySelectorAll('[data-open]').forEach(button => button.addEventListener('click', () => openReport(button.dataset.open)));
    state.el.querySelector('[data-more]').hidden = !state.hasMore;
  } catch (error) { el.innerHTML = `<div class="error-state">${ic('danger', { size: 28 })}<h3>Could not load reports</h3><p>${esc(error.message)}</p></div>`; }
}

function closeDrawer() { document.querySelector('.mr-drawer')?.remove(); state.drawer = ''; history.replaceState(history.state, '', location.pathname); state.el.querySelectorAll('.mr-row.active').forEach(row => row.classList.remove('active')); }

async function openReport(id) {
  document.querySelector('.mr-drawer')?.remove();
  state.drawer = id;
  history.replaceState(history.state, '', `${location.pathname}?id=${encodeURIComponent(id)}`);
  state.el.querySelectorAll('.mr-row').forEach(row => row.classList.toggle('active', row.dataset.open === id));
  const drawer = document.createElement('div');
  drawer.className = 'mr-drawer';
  drawer.innerHTML = '<div class="mr-scrim" data-close></div><aside class="mr-drawer-card"><div class="page-loading"><span class="skeleton"></span><span class="skeleton"></span></div></aside>';
  document.body.appendChild(drawer);
  const onKey = event => { if (event.key === 'Escape' && !document.querySelector('.mr-dialog-backdrop, .confirm-backdrop')) { closeDrawer(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
  drawer.querySelector('[data-close]').addEventListener('click', () => { closeDrawer(); document.removeEventListener('keydown', onKey); });
  try { const { report } = await api(`/api/mod-reports/${encodeURIComponent(id)}`); if (state.drawer === id) drawerContent(drawer.querySelector('.mr-drawer-card'), report); }
  catch (error) { drawer.querySelector('.mr-drawer-card').innerHTML = `<div class="error-state"><p>${esc(error.message)}</p></div>`; }
}

function reasonDialog(title, label, confirmText, danger) {
  return new Promise(resolve => {
    const root = document.createElement('div');
    root.className = 'modal-backdrop mr-dialog-backdrop';
    root.innerHTML = `<section class="modal-card mr-dialog" role="dialog" aria-modal="true"><h2>${esc(title)}</h2><label class="mr-field"><span>${esc(label)}</span><textarea rows="4" maxlength="1000" data-text dir="auto"></textarea></label><div class="mr-actions"><button class="secondary" type="button" data-no>Cancel</button><button class="${danger ? 'danger' : 'primary'}" type="button" data-yes>${esc(confirmText)}</button></div></section>`;
    document.body.appendChild(root);
    const done = value => { root.remove(); resolve(value); };
    root.querySelector('[data-no]').addEventListener('click', () => done(null));
    root.querySelector('[data-yes]').addEventListener('click', () => done(root.querySelector('[data-text]').value.trim()));
    root.addEventListener('click', event => { if (event.target === root) done(null); });
    root.querySelector('[data-text]').focus();
  });
}

function drawerContent(card, r) {
  const decision = r.status === 'pending'
    ? `<div class="mr-decide"><button type="button" class="primary" data-decide="approved">${ic('tick-circle', { size: 16 })} Approve</button><button type="button" class="danger" data-decide="rejected">${ic('close-circle', { size: 16 })} Reject</button></div>`
    : `<div class="mr-decision ${r.status}">${ic(r.status === 'approved' ? 'tick-circle' : 'close-circle', { size: 20 })}<div><b>${STATUS[r.status]} by ${esc(r.reviewer || 'unknown')}</b><small>${full(r.reviewedAt)}${r.pointsApplied ? ` · ${r.pointsApplied > 0 ? '+' : ''}${r.pointsApplied} point(s)` : ''}</small></div><button type="button" class="secondary" data-reopen>${ic('refresh-circle', { size: 15 })} Reopen</button></div>`;
  card.innerHTML = `<header class="mr-drawer-head">${avatar(r.targetAvatar, r.targetTag, 'lg')}<div><h2>${pad(r.number)} ${actionHtml(r.action)}</h2><small>${esc(r.targetTag || 'Unknown user')} · <code>${esc(r.targetUserId)}</code></small></div>${tag(r.status)}<button type="button" class="mr-icon-btn" data-x aria-label="Close">${ic('close-circle', { size: 20 })}</button></header>
    ${decision}
    <dl class="mr-meta-grid"><div><dt>Moderator</dt><dd>${esc(r.moderator)}</dd></div><div><dt>Action</dt><dd>${actionHtml(r.action)}</dd></div><div><dt>Duration</dt><dd>${esc(r.duration || '-')}</dd></div><div><dt>Submitted</dt><dd title="${esc(full(r.createdAt))}">${ago(r.createdAt)}</dd></div><div><dt>Earlier reports</dt><dd>${r.history.length}</dd></div><div><dt>Notes</dt><dd>${r.notes.length}</dd></div></dl>
    ${r.flags.length ? `<div class="mr-alert">${ic('warning-2', { size: 18 })}<span>${r.flags.map(esc).join('<br>')}</span></div>` : ''}
    <section class="mr-block"><span>Reason</span><div class="mr-text" dir="auto">${esc(r.reason)}</div></section>
    ${r.evidence ? `<section class="mr-block"><span>Evidence</span><div class="mr-text" dir="auto">${esc(r.evidence).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')}</div></section>` : ''}
    <section class="mr-section"><h4>${ic('note-text', { size: 16 })} Notes</h4>${r.notes.map(note => `<div class="mr-note"><b>${esc(note.name)}</b><small>${ago(note.createdAt)}</small><p dir="auto">${esc(note.text)}</p></div>`).join('')}<form class="mr-note-form" data-note><textarea rows="2" maxlength="1000" placeholder="Add a note (also shown on the Discord card)..." dir="auto" required></textarea><button class="secondary" type="submit">Add note</button></form></section>
    ${r.history.length ? `<section class="mr-section"><h4>${ic('clock', { size: 16 })} Earlier reports on this user</h4>${r.history.map(item => `<button type="button" class="mr-history" data-history="${item.id}"><span>${pad(item.number)} · ${action(item.action)} · ${esc(item.moderator)}</span><small>${ago(item.createdAt)}</small>${tag(item.status)}</button>`).join('')}</section>` : ''}
    <footer class="mr-drawer-foot">${r.jumpUrl ? `<a class="secondary" href="${esc(r.jumpUrl)}" target="_blank" rel="noopener">${ic('message-text', { size: 15 })} Open in Discord</a>` : '<span></span>'}<button type="button" class="mr-link-danger" data-delete>${ic('trash', { size: 14 })} Delete</button></footer>`;
  const refresh = async () => { state.overview = await api('/api/mod-reports/overview').catch(() => state.overview); const count = state.el.querySelector('.mr-tabs .mr-count'); if (count) { count.textContent = state.overview.totals.pending; count.hidden = !state.overview.totals.pending; } const nav = document.getElementById('modReportCount'); if (nav) { nav.textContent = state.overview.totals.pending; nav.classList.toggle('hidden', !state.overview.totals.pending); } await load(true); openReport(r.id); };
  card.querySelector('[data-x]').addEventListener('click', closeDrawer);
  card.querySelectorAll('[data-history]').forEach(button => button.addEventListener('click', () => openReport(button.dataset.history)));
  card.querySelectorAll('[data-decide]').forEach(button => button.addEventListener('click', async () => {
    const approved = button.dataset.decide === 'approved';
    const note = await reasonDialog(approved ? `Approve ${pad(r.number)}?` : `Reject ${pad(r.number)}?`, approved ? 'Note (optional)' : 'Reason for the moderator (optional)', approved ? 'Approve' : 'Reject', !approved);
    if (note === null) return;
    try { const result = await api(`/api/mod-reports/${r.id}/decision`, { method: 'POST', body: JSON.stringify({ decision: button.dataset.decide, note }) }); toast(`${approved ? 'Approved' : 'Rejected'}${result.dmSent ? '' : ' · moderator DMs are closed'}`); refresh(); } catch (error) { toast(error.message); }
  }));
  card.querySelector('[data-reopen]')?.addEventListener('click', async () => { try { await api(`/api/mod-reports/${r.id}/reopen`, { method: 'POST' }); toast('Reopened · points were reverted'); refresh(); } catch (error) { toast(error.message); } });
  card.querySelector('[data-note]').addEventListener('submit', async event => { event.preventDefault(); const text = event.currentTarget.querySelector('textarea').value.trim(); if (!text) return; try { await api(`/api/mod-reports/${r.id}/notes`, { method: 'POST', body: JSON.stringify({ text }) }); openReport(r.id); } catch (error) { toast(error.message); } });
  card.querySelector('[data-delete]').addEventListener('click', async () => { if (!await confirmAction({ title: `Delete ${pad(r.number)}?`, message: 'The report is removed permanently. Points already applied are not changed.', confirmText: 'Delete report' })) return; try { await api(`/api/mod-reports/${r.id}`, { method: 'DELETE' }); closeDrawer(); refresh(); } catch (error) { toast(error.message); } });
}

// ---- Settings ----------------------------------------------------------------------------------

function settingsTab() {
  const s = structuredClone(state.overview.settings);
  const { roles = [], channels = [] } = state.options;
  const body = state.el.querySelector('[data-body]');
  const picker = (value, key, hint = '') => `<div class="mr-field"><div class="mr-roles">${value.map(id => { const role = roles.find(item => item.id === id); return `<span class="mr-role"><i style="background:${esc(role?.color && role.color !== '#000000' ? role.color : 'var(--muted)')}"></i>${esc(role?.name || 'Deleted role')}<button type="button" data-role-remove="${key}:${id}" aria-label="Remove">${ic('close-circle', { size: 13 })}</button></span>`; }).join('')}<select data-role-add="${key}" aria-label="Add role"><option value="">+ Add role</option>${roles.filter(role => !value.includes(role.id)).map(role => `<option value="${role.id}">${esc(role.name)}</option>`).join('')}</select></div>${hint ? `<small>${hint}</small>` : ''}</div>`;
  const channelSelect = (key, value, none = 'None') => `<select data-key="${key}"><option value="">${none}</option>${channels.map(channel => `<option value="${channel.id}" ${value === channel.id ? 'selected' : ''}>#${esc(channel.name)}</option>`).join('')}</select>`;
  const group = (icon, title, text, content) => `<section class="panel mr-group"><div class="panel-head">${ic(icon, { size: 18 })}<div><h3>${title}</h3><p>${text}</p></div></div><div class="panel-body">${content}</div></section>`;
  const toggle = (key, title, hint) => `<label class="mr-toggle"><span class="mr-switch"><input type="checkbox" data-bool="${key}" ${s[key] ? 'checked' : ''}><span></span></span><span><b>${title}</b><small>${hint}</small></span></label>`;
  const get = key => key.split('.').reduce((obj, part) => obj?.[part], s);
  let previewTab = 'panelEn'; let previewTimer; let previewData = null;
  const draw = () => {
    body.innerHTML = `<div class="mr-settings-wrap"><div class="mr-settings">
      ${group('send-2', 'Discord panels', 'Two separate panels, one Arabic and one English. Post one or both. Saving settings refreshes them automatically.', [['ar', 'Arabic panel'], ['en', 'English panel']].map(([lang, label]) => `<div class="mr-inline"><label class="mr-field"><span>${label}</span>${channelSelect(`panelChannel-${lang}`, s.panels[lang].channelId, 'Select a channel...')}</label><button type="button" class="${s.panels[lang].messageId ? 'secondary' : 'primary'}" data-publish="${lang}">${ic('send-2', { size: 15 })} ${s.panels[lang].messageId ? 'Update' : 'Send'}</button></div>`).join(''))}
      ${group('translate', 'General', 'Language and look of the review cards and panels.', `${toggle('enabled', 'Accept new reports', 'When off, the panel button is disabled.')}
        <div class="mr-inline"><label class="mr-field small"><span>Review card language</span><select data-key="language"><option value="en" ${s.language === 'en' ? 'selected' : ''}>English</option><option value="ar" ${s.language === 'ar' ? 'selected' : ''}>Arabic</option></select></label><label class="mr-field small"><span>Panel colour</span><input type="color" data-key="color" value="${esc(s.color)}"></label></div>`)}
      ${group('eye', 'Review', 'Where reports go and who can submit them.', `<label class="mr-field"><span>Review channel</span>${channelSelect('reviewChannelId', s.reviewChannelId)}<small>Falls back to the audit log channel.</small></label>
        <label class="mr-field"><span>Ping role on new report</span><select data-key="pingRoleId"><option value="">None</option>${roles.map(role => `<option value="${role.id}" ${s.pingRoleId === role.id ? 'selected' : ''}>@${esc(role.name)}</option>`).join('')}</select></label>
        <div class="mr-field"><span>Who can approve or reject</span><small>Only the server owner and administrators. No role can be given this power.</small></div>
        <div class="mr-field"><span>Who can submit</span>${picker(s.reporterRoleIds, 'reporterRoleIds', 'Empty means the staff role from server settings.')}</div>
        ${toggle('dmModerator', 'DM the moderator with the result', "Includes the reviewer's note.")}`)}
      ${group('ranking', 'Rank rules', 'Shown on the panel. A report from a rank that is not listed is still accepted but flagged for reviewers.', `${['mute', 'kick', 'ban'].map(key => `<div class="mr-field"><span>${actionHtml(key)}</span>${picker(s.actionRoles[key], `actionRoles.${key}`, key === 'mute' ? 'Leave empty to allow all moderators.' : '')}</div>`).join('')}
        <div class="mr-field"><span>Evidence required for</span><div class="mr-evidence">${Object.keys(ACTIONS).map(key => `<label class="mr-check"><input type="checkbox" data-evidence="${key}" ${s.requireEvidence.includes(key) ? 'checked' : ''}><span>${action(key)}</span></label>`).join('')}</div></div>`)}
      ${group('star', 'Points', 'Staff points for the moderator. Reopening a report reverts them.', `<div class="mr-inline"><label class="mr-field small"><span>Approved report (add)</span><input type="number" min="0" max="100" data-num="approvePoints" value="${s.approvePoints}"></label><label class="mr-field small"><span>Rejected report (deduct)</span><input type="number" min="0" max="100" data-num="rejectPoints" value="${s.rejectPoints}"></label></div>`)}
      <div class="mr-save"><button type="button" class="primary" data-save>${ic('save-2', { size: 15 })} Save settings</button></div>
    </div><aside class="mr-preview"><div class="mr-seg">${[['panelEn', 'English panel'], ['panelAr', 'Arabic panel'], ['card', 'Review card']].map(([key, label]) => `<button type="button" data-preview-tab="${key}" aria-pressed="${previewTab === key}">${label}</button>`).join('')}</div><div class="mr-preview-body" data-preview>Loading preview...</div></aside></div>`;
    preview();
  };
  // Server-rendered with the bot's own builders, so this is exactly what Discord will show.
  const paintPreview = () => { const el = body.querySelector('[data-preview]'); if (el && previewData) el.innerHTML = renderMessage(previewData[previewTab], { roles, channels }); };
  const preview = () => { clearTimeout(previewTimer); previewTimer = setTimeout(async () => { previewData = await api('/api/mod-reports-preview', { method: 'POST', body: JSON.stringify(s) }).catch(() => previewData); paintPreview(); }, 250); };
  draw();
  body.addEventListener('change', event => {
    const input = event.target;
    if (input.dataset.roleAdd) { if (!input.value) return; get(input.dataset.roleAdd).push(input.value); return draw(); }
    if (input.dataset.bool) s[input.dataset.bool] = input.checked;
    if (input.dataset.num) s[input.dataset.num] = Number(input.value) || 0;
    if (input.dataset.evidence) s.requireEvidence = input.checked ? [...new Set([...s.requireEvidence, input.dataset.evidence])] : s.requireEvidence.filter(item => item !== input.dataset.evidence);
    if (input.dataset.key && !input.dataset.key.startsWith('panelChannel')) s[input.dataset.key] = input.value;
    preview();
  });
  body.addEventListener('input', event => { if (event.target.dataset.key === 'color') { s.color = event.target.value; preview(); } });
  body.addEventListener('click', async event => {
    const tab = event.target.closest('[data-preview-tab]');
    if (tab) { previewTab = tab.dataset.previewTab; body.querySelectorAll('[data-preview-tab]').forEach(item => item.setAttribute('aria-pressed', String(item === tab))); return paintPreview(); }
    const remove = event.target.closest('[data-role-remove]');
    if (remove) { const [key, id] = remove.dataset.roleRemove.split(':'); const list = get(key); list.splice(list.indexOf(id), 1); return draw(); }
    if (event.target.closest('[data-save]')) {
      try { const result = await api('/api/mod-reports-settings', { method: 'PUT', body: JSON.stringify(s) }); state.overview.settings = result.settings; toast(result.panelUpdated ? 'Saved · Discord panel updated' : 'Settings saved'); } catch (error) { toast(error.message); }
    }
    const publish = event.target.closest('[data-publish]');
    if (publish) {
      const lang = publish.dataset.publish;
      const channelId = body.querySelector(`[data-key="panelChannel-${lang}"]`).value;
      if (!channelId) return toast('Choose a channel first.');
      try {
        await api('/api/mod-reports-settings', { method: 'PUT', body: JSON.stringify(s) });
        const result = await api('/api/mod-reports-panel', { method: 'POST', body: JSON.stringify({ channelId, lang }) });
        state.overview = await api('/api/mod-reports/overview');
        toast(`${lang === 'ar' ? 'Arabic' : 'English'} panel ${result.updated ? 'updated' : 'sent'}`); paint();
      } catch (error) { toast(error.message); }
    }
  });
}
