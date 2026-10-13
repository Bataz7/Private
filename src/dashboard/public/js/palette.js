import { ic } from './icon.js';
import { esc } from './ui.js';

// Command palette (Ctrl/Cmd+K): jump to pages and staff profiles, or run common actions.
export function initPalette({ pages, staff, actions, open: openTarget }) {
  let root; let list = []; let active = 0;

  const build = () => {
    root = document.createElement('div');
    root.className = 'modal-backdrop palette-backdrop hidden';
    root.innerHTML = `<section class="palette" role="dialog" aria-modal="true" aria-label="Command palette">
      <label class="palette-input">${ic('search-normal', { size: 20 })}<input type="text" placeholder="Search pages, staff and actions" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="paletteList"><kbd>Esc</kbd></label>
      <div class="palette-list" id="paletteList" role="listbox"></div>
      <footer><span><kbd>Up</kbd><kbd>Down</kbd> move</span><span><kbd>Enter</kbd> open</span></footer></section>`;
    document.body.appendChild(root);
    root.addEventListener('mousedown', event => { if (event.target === root) close(); });
    root.querySelector('input').addEventListener('input', render);
    root.querySelector('.palette-list').addEventListener('click', event => { const row = event.target.closest('[data-i]'); if (row) run(Number(row.dataset.i)); });
    root.querySelector('.palette-list').addEventListener('mousemove', event => { const row = event.target.closest('[data-i]'); if (row && Number(row.dataset.i) !== active) { active = Number(row.dataset.i); paint(); } });
    root.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      else if (event.key === 'ArrowDown') { event.preventDefault(); active = Math.min(list.length - 1, active + 1); paint(true); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); active = Math.max(0, active - 1); paint(true); }
      else if (event.key === 'Enter') { event.preventDefault(); run(active); }
    });
  };

  const score = (label, query) => { const l = label.toLowerCase(); if (!query) return 1; if (l.startsWith(query)) return 3; if (l.split(/\s+/).some(word => word.startsWith(query))) return 2; return l.includes(query) ? 1 : 0; };

  function render() {
    const query = root.querySelector('input').value.trim().toLowerCase();
    const groups = [['Pages', pages()], ['Staff', query ? staff() : staff().slice(0, 5)], ['Actions', actions()]];
    list = [];
    let html = '';
    for (const [title, items] of groups) {
      const found = items.map(item => ({ item, s: score(`${item.label} ${item.hint || ''}`, query) })).filter(x => x.s).sort((a, b) => b.s - a.s).slice(0, title === 'Staff' ? 8 : 12).map(x => x.item);
      if (!found.length) continue;
      html += `<div class="palette-group">${title}</div>`;
      for (const item of found) { html += `<button type="button" role="option" class="palette-row" data-i="${list.length}">${item.avatar ? `<img src="${esc(item.avatar)}" alt="" loading="lazy">` : `<span class="palette-ico">${ic(item.icon || 'arrow-right-01', { size: 20 })}</span>`}<span class="palette-label">${esc(item.label)}</span>${item.hint ? `<small>${esc(item.hint)}</small>` : ''}</button>`; list.push(item); }
    }
    root.querySelector('.palette-list').innerHTML = html || '<div class="palette-empty">No results</div>';
    active = 0; paint();
  }
  function paint(scroll) {
    root.querySelectorAll('.palette-row').forEach(row => { const on = Number(row.dataset.i) === active; row.classList.toggle('active', on); row.setAttribute('aria-selected', String(on)); if (on && scroll) row.scrollIntoView({ block: 'nearest' }); });
  }
  function run(index) { const item = list[index]; if (!item) return; close(); item.run(); }
  function open() { if (!root) build(); root.classList.remove('hidden'); const input = root.querySelector('input'); input.value = ''; render(); input.focus(); document.body.classList.add('palette-open'); }
  function close() { root?.classList.add('hidden'); document.body.classList.remove('palette-open'); }

  document.addEventListener('keydown', event => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); root && !root.classList.contains('hidden') ? close() : open(); }
    else if (event.key === '/' && !typing && !document.querySelector('.modal-backdrop:not(.hidden)')) { event.preventDefault(); open(); }
  });
  return { open, close };
}
