// لوحة الأوامر (Ctrl/⌘ + K أو /): انتقل لأي صفحة، افتح ملف أي عضو، أو نفّذ إجراء.
import type { Child } from '#jsx/jsx-runtime';
import { toDOM } from '#jsx/jsx-runtime';
import { Icon } from '../ui/Icon';
import { Avatar, Kbd } from '../ui/kit';
import { cx, live } from '../lib/dom';

export type PaletteItem = { label: string; hint?: string; icon?: string; avatar?: string; keywords?: string; run: () => void };
export type PaletteSource = { pages: () => PaletteItem[]; staff: () => PaletteItem[]; actions: () => PaletteItem[] };

const norm = (value: string) => value.toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').trim();

function score(item: PaletteItem, query: string): number {
  if (!query) return 1;
  const label = norm(item.label);
  const extra = norm(`${item.hint ?? ''} ${item.keywords ?? ''}`);
  if (label.startsWith(query)) return 4;
  if (label.split(/\s+/).some(word => word.startsWith(query))) return 3;
  if (label.includes(query)) return 2;
  return extra.includes(query) ? 1 : 0;
}

export function initPalette(source: PaletteSource) {
  let root: HTMLElement | null = null;
  let input: HTMLInputElement | null = null;
  let previous: HTMLElement | null = null;
  let list: PaletteItem[] = [];
  let active = 0;
  let query = '';

  const results = live(() => {
    const q = norm(query);
    const groups: Array<[string, PaletteItem[], number]> = [['الصفحات', source.pages(), 12], ['الستاف', q ? source.staff() : source.staff().slice(0, 5), 8], ['الإجراءات', source.actions(), 10]];
    list = [];
    const out: Child[] = [];
    for (const [title, items, max] of groups) {
      const found = items.map(item => ({ item, s: score(item, q) })).filter(entry => entry.s).sort((a, b) => b.s - a.s).slice(0, max).map(entry => entry.item);
      if (!found.length) continue;
      out.push(<div class="pal-group" role="presentation">{title}</div>);
      for (const item of found) {
        const index = list.length;
        list.push(item);
        out.push(
          <button type="button" role="option" id={`pal-${index}`} class={cx('pal-row', index === active && 'active')} aria-selected={String(index === active)}
            onClick={() => run(index)} onPointerMove={() => { if (active !== index) { active = index; paint(); } }}>
            {item.avatar !== undefined ? <Avatar src={item.avatar} name={item.label} size={28} /> : <span class="pal-ico"><Icon name={item.icon ?? 'arrow-right-01'} size={18} /></span>}
            <span class="pal-label">{item.label}</span>
            {item.hint ? <small>{item.hint}</small> : null}
          </button>,
        );
      }
    }
    if (active >= list.length) active = 0;
    return out.length ? out : <div class="pal-empty"><Icon name="search-normal" size={22} /><span>ما فيه نتائج لـ «{query}»</span></div>;
  }, { class: 'pal-list', role: 'listbox', id: 'palList' });

  function paint(scroll = false) {
    root?.querySelectorAll<HTMLElement>('.pal-row').forEach((row, index) => {
      const on = index === active;
      row.classList.toggle('active', on);
      row.setAttribute('aria-selected', String(on));
      if (on && scroll) row.scrollIntoView({ block: 'nearest' });
    });
    input?.setAttribute('aria-activedescendant', `pal-${active}`);
  }

  function run(index: number) {
    const item = list[index];
    if (!item) return;
    close();
    item.run();
  }

  function build() {
    root = toDOM(
      <div class="overlay is-modal palette-overlay" hidden>
        <div class="ov-scrim" onClick={() => close()} />
        <section class="palette" role="dialog" aria-modal="true" aria-label="لوحة الأوامر">
          <label class="pal-input">
            <Icon name="search-normal" size={20} />
            <input type="text" placeholder="ابحث عن صفحة أو عضو أو إجراء…" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="palList"
              ref={(el: HTMLInputElement) => { input = el; }}
              onInput={(event: Event) => { query = (event.currentTarget as HTMLInputElement).value; active = 0; results.update(); paint(); }} />
            <Kbd>Esc</Kbd>
          </label>
          {results.node}
          <footer class="pal-foot"><span><Kbd>↑</Kbd><Kbd>↓</Kbd> للتنقل</span><span><Kbd>Enter</Kbd> للفتح</span><span><Kbd>Ctrl</Kbd>+<Kbd>K</Kbd> للفتح من أي مكان</span></footer>
        </section>
      </div>,
    ) as HTMLElement;
    root.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      else if (event.key === 'ArrowDown') { event.preventDefault(); active = Math.min(list.length - 1, active + 1); paint(true); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); active = Math.max(0, active - 1); paint(true); }
      else if (event.key === 'Enter') { event.preventDefault(); run(active); }
      else if (event.key === 'Tab') event.preventDefault();
    });
    document.body.appendChild(root);
  }

  function open() {
    if (!root) build();
    previous = document.activeElement as HTMLElement | null;
    root!.hidden = false;
    document.documentElement.classList.add('scroll-locked');
    query = '';
    active = 0;
    if (input) input.value = '';
    results.update();
    paint();
    requestAnimationFrame(() => input?.focus());
  }

  function close() {
    if (!root || root.hidden) return;
    root.hidden = true;
    if (!document.querySelector('.overlay:not(.palette-overlay)')) document.documentElement.classList.remove('scroll-locked');
    previous?.focus?.({ preventScroll: true });
  }

  document.addEventListener('keydown', event => {
    const target = document.activeElement as HTMLElement | null;
    const typing = target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable);
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (root && !root.hidden) close(); else open();
    } else if (event.key === '/' && !typing && !document.querySelector('.overlay:not([hidden])')) {
      event.preventDefault();
      open();
    }
  });

  return { open, close };
}
