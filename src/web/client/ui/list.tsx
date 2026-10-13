// قائمة/جدول ببحث وفلاتر وترتيب وصفحات وتصدير CSV — على البيانات مباشرة (مو على عناصر الصفحة).
import type { Child } from '#jsx/jsx-runtime';
import { Icon } from './Icon';
import { Button, Seg, Select, type Option, type SegOption } from './kit';
import { cx, debounce, downloadCsv, live } from '../lib/dom';
import { num } from '../lib/format';

export type Column<T> = {
  key: string;
  label: Child;
  render: (row: T) => Child;
  sort?: (row: T) => number | string;
  class?: string;
  /** يختفي على الجوال (يبقى في البطاقة إذا عنده label). */
  hideSm?: boolean;
};

export type ListConfig<T> = {
  rows: T[];
  /** عرض قائمة: عنصر لكل صف. */
  render?: (row: T) => Child;
  /** أو عرض جدول. */
  columns?: Column<T>[];
  rowKey?: (row: T) => string;
  onRowClick?: (row: T) => void;
  rowClass?: (row: T) => string;
  search?: (row: T) => string;
  searchPlaceholder?: string;
  filters?: Array<{ key: string; label: string; options: Option[]; test: (row: T, value: string) => boolean; value?: string }>;
  segment?: { options: SegOption[]; value: string; test: (row: T, value: string) => boolean; label?: string };
  date?: (row: T) => number;
  defaultSort?: { key: string; dir: 1 | -1 };
  pageSize?: number;
  csv?: { name: string; header: string[]; row: (row: T) => unknown[] };
  empty: Child;
  noMatch?: Child;
  class?: string;
  toolbar?: Child;
  /** يخفي شريط الأدوات إذا الصفوف أقل من هذا العدد. */
  minForTools?: number;
};

export function createList<T>(config: ListConfig<T>) {
  const pageSize = config.pageSize ?? 25;
  const state = {
    rows: config.rows,
    q: '',
    filters: Object.fromEntries((config.filters ?? []).map(filter => [filter.key, filter.value ?? ''])) as Record<string, string>,
    segment: config.segment?.value ?? '',
    sortKey: config.defaultSort?.key ?? (config.date ? '__date' : ''),
    dir: (config.defaultSort?.dir ?? -1) as 1 | -1,
    limit: pageSize,
  };

  const matched = (): T[] => {
    const q = state.q.trim().toLowerCase();
    let rows = state.rows.filter(row => (!q || (config.search?.(row) ?? '').toLowerCase().includes(q))
      && (config.filters ?? []).every(filter => !state.filters[filter.key] || filter.test(row, state.filters[filter.key]!))
      && (!config.segment || !state.segment || config.segment.test(row, state.segment)));
    const column = config.columns?.find(item => item.key === state.sortKey);
    const sorter = state.sortKey === '__date' ? config.date : column?.sort;
    if (sorter) {
      rows = [...rows].sort((a, b) => {
        const x = sorter(a);
        const y = sorter(b);
        return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'ar')) * state.dir;
      });
    }
    return rows;
  };

  const header = (column: Column<T>) => {
    if (!column.sort) return <th class={column.class} scope="col">{column.label}</th>;
    const active = state.sortKey === column.key;
    return (
      <th class={cx(column.class, 'sortable')} scope="col" aria-sort={active ? (state.dir === 1 ? 'ascending' : 'descending') : 'none'}>
        <button type="button" onClick={() => {
          if (state.sortKey === column.key) state.dir = state.dir === 1 ? -1 : 1;
          else { state.sortKey = column.key; state.dir = -1; }
          body.update();
        }}>{column.label}<span class={cx('sort-ind', active && 'on', active && state.dir === 1 && 'asc')} aria-hidden="true">▾</span></button>
      </th>
    );
  };

  const rowView = (row: T) => {
    const click = config.onRowClick;
    if (config.columns) {
      return (
        <tr class={cx(click && 'is-link', config.rowClass?.(row))} tabindex={click ? '0' : undefined}
          onClick={click ? (event: Event) => { if (!(event.target as HTMLElement).closest('button, a, input, select')) click(row); } : undefined}
          onKeyDown={click ? (event: KeyboardEvent) => { if ((event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget) { event.preventDefault(); click(row); } } : undefined}>
          {config.columns.map(column => <td class={cx(column.class, column.hideSm && 'hide-sm')} data-label={typeof column.label === 'string' ? column.label : undefined}>{column.render(row)}</td>)}
        </tr>
      );
    }
    return config.render!(row);
  };

  const body = live(() => {
    const rows = matched();
    const shown = rows.slice(0, state.limit);
    const total = state.rows.length;
    if (countEl) countEl.textContent = rows.length === total ? `${num(total)} عنصر` : `${num(rows.length)} من ${num(total)}`;
    if (!total) return config.empty;
    if (!rows.length) return config.noMatch ?? <div class="list-nomatch"><Icon name="search-normal" size={20} /> ما فيه نتائج تطابق البحث أو الفلتر.</div>;
    const rest = rows.length - shown.length;
    return [
      config.columns
        ? <div class="table-wrap"><table class="table"><thead><tr>{config.columns.map(header)}</tr></thead><tbody>{shown.map(rowView)}</tbody></table></div>
        : <div class={cx('list', config.class)}>{shown.map(rowView)}</div>,
      rest > 0 ? <div class="list-more"><Button variant="soft" icon="arrow-down-01" onClick={() => { state.limit += pageSize; body.update(); }}>اعرض {num(Math.min(rest, pageSize))} زيادة (باقي {num(rest)})</Button></div> : null,
    ];
  });

  let countEl: HTMLElement | null = null;
  const onSearch = debounce((value: string) => { state.q = value; state.limit = pageSize; body.update(); }, 160);
  const showTools = () => state.rows.length >= (config.minForTools ?? 0);

  const tools = live(() => showTools() ? (
    <div class="list-tools">
      {config.search ? (
        <label class="search">
          <Icon name="search-normal" size={18} />
          <input type="search" value={state.q} placeholder={config.searchPlaceholder ?? 'بحث…'} aria-label={config.searchPlaceholder ?? 'بحث'} onInput={(event: Event) => onSearch((event.currentTarget as HTMLInputElement).value)} />
        </label>
      ) : null}
      {config.segment ? <Seg options={config.segment.options} value={state.segment} label={config.segment.label} size="sm" onChange={value => { state.segment = value; state.limit = pageSize; body.update(); }} /> : null}
      {(config.filters ?? []).map(filter => (
        <Select class="input-sm" aria-label={filter.label} options={filter.options} value={state.filters[filter.key]} placeholder={filter.label} onChange={(event: Event) => { state.filters[filter.key] = (event.currentTarget as HTMLSelectElement).value; state.limit = pageSize; body.update(); }} />
      ))}
      {config.toolbar}
      <span class="list-tools-end">
        {config.date && !config.columns ? (
          <Button variant="ghost" size="sm" icon="sort" onClick={(event: Event) => {
            state.sortKey = '__date';
            state.dir = state.dir === -1 ? 1 : -1;
            ((event.currentTarget as HTMLElement).querySelector('span') as HTMLElement).textContent = state.dir === -1 ? 'الأحدث أولًا' : 'الأقدم أولًا';
            body.update();
          }}>{state.dir === -1 ? 'الأحدث أولًا' : 'الأقدم أولًا'}</Button>
        ) : null}
        {config.csv ? <Button variant="ghost" size="sm" icon="download" onClick={() => { const csv = config.csv!; downloadCsv(csv.name, csv.header, matched().map(csv.row)); }}>تصدير CSV</Button> : null}
        <output class="list-count" aria-live="polite" ref={(el: HTMLElement) => { countEl = el; }} />
      </span>
    </div>
  ) : null);

  return {
    node: <div class="list-block">{tools.node}{body.node}</div>,
    setRows(rows: T[]) {
      const toolsBefore = showTools();
      state.rows = rows;
      if (toolsBefore !== showTools()) tools.update();
      body.update();
    },
    update: () => body.update(),
    get rows() {
      return state.rows;
    },
  };
}
