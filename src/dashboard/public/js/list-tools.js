import { ic } from './icon.js';
import { esc } from './ui.js';

const PAGE = 20;
const csvCell = value => { let text = String(value ?? '').replace(/\s+/g, ' ').trim(); if (/^[=+\-@]/.test(text)) text = `'${text}`; return `"${text.replace(/"/g, '""')}"`; };

// Adds search, a status filter, newest/oldest order, paging and CSV export to an existing list of
// rendered rows. Works on the DOM, so every page that renders a list gets it without extra markup.
export function enhanceList(container, { name = 'export', item = ':scope > *', input = null, min = 4 } = {}) {
  if (!container || container.dataset.tools) return;
  const rows = [...container.querySelectorAll(item)].filter(el => el.parentElement === container);
  if (rows.length < min) return;
  container.dataset.tools = '1';
  const info = rows.map((el, index) => ({
    el, index, text: el.textContent.toLowerCase(),
    status: (el.querySelector('.tag')?.textContent || '').trim().toLowerCase(),
    cells: [el.querySelector('b')?.textContent, el.querySelector('p')?.textContent, el.querySelector('small')?.textContent, el.querySelector('.tag')?.textContent],
  }));
  const statuses = [...new Set(info.map(row => row.status).filter(Boolean))];
  const state = { q: '', status: '', reverse: false, limit: PAGE };

  const bar = document.createElement('div');
  bar.className = 'list-tools';
  bar.innerHTML = `${input ? '' : `<label class="lt-search">${ic('search-normal', { size: 18 })}<input type="search" placeholder="Search" aria-label="Search list"></label>`}
    ${statuses.length > 1 ? `<select aria-label="Filter by status"><option value="">All statuses</option>${statuses.map(value => `<option value="${esc(value)}">${esc(value.replace(/^./, c => c.toUpperCase()))}</option>`).join('')}</select>` : ''}
    <button type="button" class="secondary" data-sort>${ic('sort', { size: 18 })}<span>Newest first</span></button>
    <button type="button" class="secondary" data-export>${ic('document-text', { size: 18 })}<span>Export CSV</span></button>
    <output class="lt-count" aria-live="polite"></output>`;
  const more = document.createElement('button');
  more.type = 'button'; more.className = 'secondary list-more';
  // Wrap so the toolbar never becomes an extra cell in a grid parent (the staff page is a two-column grid).
  const wrap = document.createElement('div');
  wrap.className = 'list-wrap';
  container.replaceWith(wrap);
  wrap.append(bar, container, more);

  const searchInput = input ? document.querySelector(input) : bar.querySelector('input');
  const sortLabel = bar.querySelector('[data-sort] span');
  const count = bar.querySelector('.lt-count');

  function apply() {
    const q = state.q.trim().toLowerCase();
    const matched = info.filter(row => (!q || row.text.includes(q)) && (!state.status || row.status === state.status));
    matched.sort((a, b) => (state.reverse ? b.index - a.index : a.index - b.index));
    const shown = new Set(matched.slice(0, state.limit));
    for (const row of info) row.el.hidden = !shown.has(row);
    matched.forEach(row => container.appendChild(row.el));
    count.textContent = matched.length === info.length ? `${info.length} items` : `${matched.length} of ${info.length}`;
    const rest = matched.length - shown.size;
    more.hidden = rest <= 0;
    more.textContent = `Show ${Math.min(rest, PAGE)} more (${rest} left)`;
    state.matched = matched;
    container.dataset.empty = matched.length ? '' : 'true';
  }
  searchInput?.addEventListener('input', () => { state.q = searchInput.value; state.limit = PAGE; apply(); });
  bar.querySelector('select')?.addEventListener('change', event => { state.status = event.target.value; state.limit = PAGE; apply(); });
  bar.querySelector('[data-sort]').addEventListener('click', () => { state.reverse = !state.reverse; sortLabel.textContent = state.reverse ? 'Oldest first' : 'Newest first'; apply(); });
  more.addEventListener('click', () => { state.limit += PAGE; apply(); });
  bar.querySelector('[data-export]').addEventListener('click', () => {
    const lines = [['Title', 'Details', 'Meta', 'Status'].map(csvCell).join(','), ...state.matched.map(row => row.cells.map(csvCell).join(','))];
    const url = URL.createObjectURL(new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: `${name}-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  });
  apply();
}
