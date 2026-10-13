import { api, esc, toast } from '../ui.js';
import { ic } from '../icon.js';

const ICON = { SHIFT: 'alarm', BREAK: 'timer-pause', LEAVE: 'briefcase', RESIGNATION: 'logout-01', REPORT: 'document-text', COMPLAINT: 'danger', RATING: 'star' };
const label = value => String(value || '').toLowerCase().replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
const ago = value => {
  const s = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
const csv = value => { let text = String(value ?? '').replace(/\s+/g, ' ').trim(); if (/^[=+\-@]/.test(text)) text = `'${text}`; return `"${text.replace(/"/g, '""')}"`; };

export function render() {
  return `<div class="section-head"><div><h1>Audit log</h1><p>Every shift, leave, resignation and report event, with who did it.</p></div><button class="secondary" data-audit-export>${ic('document-text', { size: 18 })} Export CSV</button></div>
  <div class="list-tools audit-filters"><label class="lt-search">${ic('search-normal', { size: 18 })}<input type="search" name="q" placeholder="Search member" aria-label="Search member"></label>
    <select name="action" aria-label="Event type"><option value="">All events</option></select>
    <label class="au-date"><span>From</span><input type="date" name="from"></label><label class="au-date"><span>To</span><input type="date" name="to"></label>
    <output class="lt-count" aria-live="polite"></output></div>
  <section class="panel"><div class="au-head"><span>Event</span><span>Member</span><span>Done by</span><span>When</span></div><div id="auditRows"><div class="page-loading"><span class="skeleton"></span></div></div><div class="au-foot"><button class="secondary" data-audit-more hidden>Load more</button></div></section>`;
}

export function bind() {
  const view = document.getElementById('view');
  const rowsEl = document.getElementById('auditRows');
  const more = view.querySelector('[data-audit-more]');
  const count = view.querySelector('.lt-count');
  const filters = { q: '', action: '', from: '', to: '' };
  let page = 1; let loaded = []; let token = 0; let timer;

  async function load(reset) {
    const mine = ++token;
    if (reset) { page = 1; loaded = []; rowsEl.innerHTML = '<div class="page-loading"><span class="skeleton"></span></div>'; }
    const params = new URLSearchParams({ ...filters, page: String(page) });
    try {
      const data = await api(`/api/audit?${params}`);
      if (mine !== token) return;
      const select = view.querySelector('[name="action"]');
      if (select.options.length === 1) data.actions.forEach(action => select.add(new Option(label(action), action)));
      loaded = loaded.concat(data.rows);
      rowsEl.innerHTML = loaded.length ? loaded.map(row => `<div class="au-row"><span class="au-event">${ic(ICON[String(row.action).split('_')[0]] || 'activity', { size: 18 })}${esc(label(row.action))}</span><span class="au-member">${row.userId ? `<a href="/p/${encodeURIComponent(row.userId)}" data-profile="${esc(row.userId)}">${esc(row.name || `User ${String(row.userId).slice(-4)}`)}</a>` : '-'}</span><span class="au-actor">${esc(row.actorName || (row.actorId ? `User ${String(row.actorId).slice(-4)}` : 'System'))}</span><time title="${esc(new Date(row.createdAt).toLocaleString())}">${ago(row.createdAt)}</time></div>`).join('') : `<div class="empty"><div><b>No events match</b><span>Try a wider date range or another event type.</span></div></div>`;
      count.textContent = `${loaded.length} of ${data.total}`;
      more.hidden = !data.hasMore;
    } catch (error) { if (mine === token) rowsEl.innerHTML = `<div class="error-state">${ic('danger', { size: 28 })}<h3>Could not load the audit log</h3><p>${esc(error.message)}</p></div>`; }
  }

  view.querySelector('.audit-filters').addEventListener('input', event => {
    const target = event.target; if (!target.name) return;
    filters[target.name] = target.value;
    clearTimeout(timer); timer = setTimeout(() => load(true), target.name === 'q' ? 250 : 0);
  });
  more.addEventListener('click', () => { page += 1; load(false); });
  view.querySelector('[data-audit-export]').addEventListener('click', () => {
    if (!loaded.length) return toast('Nothing to export');
    const lines = ['Event,Member,Done by,When', ...loaded.map(row => [label(row.action), row.name || row.userId, row.actorName || row.actorId || 'System', new Date(row.createdAt).toISOString()].map(csv).join(','))];
    const url = URL.createObjectURL(new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: `audit-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  });
  load(true);
}
