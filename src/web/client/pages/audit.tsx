// سجل التدقيق: كل حدث (شفتات، إجازات، فصل، مزامنة…) ومن سواه، مع فلاتر وتصدير.
import { mount } from '#jsx/jsx-runtime';
import { api, errorText } from '../lib/api';
import { actionIcon, actionText } from '../lib/actions';
import { debounce, downloadCsv, live } from '../lib/dom';
import { ago, dateTime, num, shortId } from '../lib/format';
import type { PageCtx } from '../shell/types';
import { Icon } from '../ui/Icon';
import { Button, Empty, ErrorState, Field, PageHeader, SearchInput, Select, Skeleton } from '../ui/kit';
import { toast } from '../ui/overlay';

export default function audit(ctx: PageCtx) {
  const filters = { q: '', action: '', from: '', to: '' };
  let page = 1;
  let rows: any[] = [];
  let total = 0;
  let more = false;
  let actions: string[] = [];
  let error = '';
  let loading = true;
  let token = 0;

  const body = live(() => {
    if (loading && !rows.length) return <Skeleton lines={8} height={42} />;
    if (error) return <ErrorState title="ما قدرنا نحمّل السجل" message={error} onRetry={() => void load(true)} />;
    if (!rows.length) return <Empty icon="note-text" title="ما فيه أحداث تطابق" text="جرّب فترة أوسع أو نوع حدث ثاني." />;
    return [
      <div class="table-wrap"><table class="table">
        <thead><tr><th>الحدث</th><th>العضو</th><th>بواسطة</th><th>الوقت</th></tr></thead>
        <tbody>{rows.map(row => (
          <tr>
            <td><span class="au-event"><span class="tl-icon"><Icon name={actionIcon(row.action)} size={15} /></span>{actionText(row.action)}</span></td>
            <td data-label="العضو">{row.userId && /^\d+$/.test(row.userId) ? <a href={`/p/${encodeURIComponent(row.userId)}`}>{row.name || `عضو ${shortId(row.userId)}`}</a> : row.name || '—'}</td>
            <td data-label="بواسطة" class="muted">{row.actorName || (row.actorId ? `عضو ${shortId(row.actorId)}` : 'النظام')}</td>
            <td data-label="الوقت" class="nowrap muted" title={dateTime(row.createdAt)}>{ago(row.createdAt)}</td>
          </tr>
        ))}</tbody>
      </table></div>,
      more ? <div class="list-more"><Button variant="soft" icon="arrow-down-01" onClick={() => { page += 1; void load(false); }}>تحميل المزيد</Button></div> : null,
    ];
  });
  const countEl = live(() => (total ? `${num(rows.length)} من ${num(total)}` : ''), { class: 'list-count' }, 'output');
  const actionSelect = live(() => <Select class="input-sm" aria-label="نوع الحدث" value={filters.action} placeholder="كل الأحداث" options={actions.map(action => ({ value: action, label: actionText(action) }))} onChange={(event: Event) => { filters.action = (event.currentTarget as HTMLSelectElement).value; void load(true); }} />, { class: 'contents' }, 'span');

  async function load(reset: boolean) {
    const mine = ++token;
    if (reset) { page = 1; rows = []; loading = true; body.update(); }
    try {
      const data = await api(`/api/audit?${new URLSearchParams({ ...filters, page: String(page) })}`, { signal: ctx.signal });
      if (mine !== token) return;
      if (!actions.length && data.actions?.length) { actions = data.actions; actionSelect.update(); }
      rows = rows.concat(data.rows ?? []); total = data.total ?? rows.length; more = Boolean(data.hasMore); error = '';
    } catch (failure) { if (mine === token) error = errorText(failure); }
    loading = false;
    body.update(); countEl.update();
  }
  const onSearch = debounce((value: string) => { filters.q = value; void load(true); }, 250);

  mount(ctx.root, [
    <PageHeader title="سجل التدقيق" subtitle="كل حدث في الشفتات والإجازات والاستقالات والفصل والمزامنة، ومن سواه." actions={<Button icon="download" onClick={() => {
      if (!rows.length) return toast('ما فيه شي للتصدير', 'info');
      downloadCsv('audit', ['الحدث', 'العضو', 'بواسطة', 'الوقت'], rows.map(row => [actionText(row.action), row.name || row.userId, row.actorName || row.actorId || 'النظام', row.createdAt]));
    }}>تصدير CSV</Button>} />,
    <div class="list-tools audit-tools">
      <SearchInput placeholder="ابحث عن عضو…" onInput={onSearch} />
      {actionSelect.node}
      <Field label="من" class="inline"><input class="input input-sm" type="date" onChange={(event: Event) => { filters.from = (event.currentTarget as HTMLInputElement).value; void load(true); }} /></Field>
      <Field label="إلى" class="inline"><input class="input input-sm" type="date" onChange={(event: Event) => { filters.to = (event.currentTarget as HTMLInputElement).value; void load(true); }} /></Field>
      <span class="list-tools-end">{countEl.node}</span>
    </div>,
    <div class="mt-sm">{body.node}</div>,
  ]);
  void load(true);
}
