// الستاف: جدول قابل للبحث والترتيب والفلترة، حالة كل عضو، إجراءات سريعة، ومزامنة/مسح من رتبة الستاف.
import { mount } from '#jsx/jsx-runtime';
import { api, errorText } from '../lib/api';
import { date, fixed, num } from '../lib/format';
import type { PageCtx } from '../shell/types';
import { Icon } from '../ui/Icon';
import { Avatar, Badge, Button, ErrorState, Kpi, PageHeader, PageSkeleton } from '../ui/kit';
import { createList } from '../ui/list';
import { confirmDialog, openMenu, toast, toastError } from '../ui/overlay';
import { STATE_LABEL, StateBadge, addStaffDialog, manageMenu, nameOf, openStaffDrawer, reinstateDialog, staffState, syncStaff, type StaffRow, type StaffState } from './staff-actions';

export default async function staffPage(ctx: PageCtx) {
  mount(ctx.root, <PageSkeleton />);
  let data: any;
  let extra: StaffRow[] = [];
  try {
    const [bootstrap, list] = await Promise.all([
      ctx.shared('bootstrap', () => api('/api/bootstrap')),
      api<{ staff: Array<StaffRow & { active?: boolean }> }>('/api/staff', { signal: ctx.signal }).catch(() => ({ staff: [] })),
    ]);
    data = bootstrap;
    const known = new Set((data.staff ?? []).map((member: StaffRow) => member.userId));
    // المفصولين ما يرجعون في bootstrap: نأخذهم من /api/staff (هناك active = عضوية الستاف، مو الشفت).
    extra = list.staff.filter(member => member.dismissed && !known.has(member.userId)).map(member => ({ ...member, active: false }));
    const flags = new Map(list.staff.map(member => [member.userId, member]));
    for (const member of data.staff ?? []) {
      const flag = flags.get(member.userId);
      if (flag?.dismissed) Object.assign(member, { dismissed: true, dismissedAt: flag.dismissedAt, dismissReason: flag.dismissReason });
    }
  } catch (error) {
    mount(ctx.root, <ErrorState message={errorText(error)} onRetry={ctx.refresh} />);
    return;
  }
  const reload = () => { ctx.invalidate('bootstrap'); ctx.refresh(); };
  const rows: StaffRow[] = [...(data.staff ?? []), ...extra];
  const states = new Map(rows.map(member => [member.userId, staffState(member, data.leaves)]));
  const stateOf = (member: StaffRow) => states.get(member.userId) ?? 'off';
  const counts = (state: StaffState) => rows.filter(member => stateOf(member) === state).length;
  const open = (member: StaffRow) => openStaffDrawer(member, data, { admin: ctx.admin, onChanged: reload });

  const list = createList<StaffRow>({
    rows,
    search: member => `${member.displayName ?? ''} ${member.username ?? ''} ${member.userId} ${member.rank ?? ''}`,
    searchPlaceholder: 'ابحث بالاسم أو اليوزر أو الآيدي…',
    segment: {
      label: 'فلترة الحالة',
      value: '',
      options: [
        { value: '', label: 'الكل', count: 0 },
        { value: 'shift', label: STATE_LABEL.shift[0], count: counts('shift') },
        { value: 'off', label: STATE_LABEL.off[0] },
        { value: 'leave', label: STATE_LABEL.leave[0], count: counts('leave') },
        { value: 'dismissed', label: STATE_LABEL.dismissed[0], count: counts('dismissed') },
      ],
      test: (member, value) => stateOf(member) === value,
    },
    defaultSort: { key: 'points', dir: -1 },
    onRowClick: open,
    rowClass: member => (member.dismissed ? 'is-dim' : ''),
    columns: [
      {
        key: 'name', label: 'العضو', sort: member => nameOf(member),
        render: member => <div class="who"><Avatar src={member.avatar} name={nameOf(member)} size={36} ring={member.active ? 'var(--success)' : undefined} /><span class="who-text"><b>{nameOf(member)}</b><small>@{member.username ?? member.userId}{member.rank ? ` · ${member.rank}` : ''}</small></span></div>,
      },
      { key: 'state', label: 'الحالة', sort: member => ['shift', 'off', 'leave', 'dismissed'].indexOf(stateOf(member)), render: member => <StateBadge state={stateOf(member)} /> },
      { key: 'points', label: 'النقاط', class: 'num', sort: member => member.points ?? 0, render: member => num(member.points) },
      { key: 'shift', label: 'ساعات الشفت', class: 'num', sort: member => member.shiftHours ?? 0, render: member => `${fixed(member.shiftHours)} س` },
      {
        key: 'rating', label: 'التقييم', sort: member => member.averageRating ?? 0,
        render: member => member.ratingCount ? <span class="rating-cell"><Icon name="star" size={15} bold /> {fixed(member.averageRating)} <small>({num(member.ratingCount)})</small></span> : <span class="muted">—</span>,
      },
      { key: 'messages', label: 'الرسائل', class: 'num', hideSm: true, sort: member => member.messageCount ?? 0, render: member => num(member.messageCount) },
      { key: 'joined', label: 'انضم', hideSm: true, sort: member => +new Date(member.joinedAt ?? 0), render: member => <span class="muted nowrap">{date(member.joinedAt)}</span> },
      {
        key: 'actions', label: '', class: 'actions',
        render: member => ctx.admin ? (
          <span class="row-actions">
            {member.dismissed ? <Button size="sm" variant="soft" icon="refresh-circle" onClick={() => reinstateDialog(member, reload)}>إلغاء الفصل</Button> : null}
            <Button size="sm" variant="ghost" icon="more" aria-label={`إدارة ${nameOf(member)}`} aria-haspopup="menu" onClick={(event: Event) => manageMenu(event.currentTarget as HTMLElement, member, reload, { openProfile: () => open(member) })} />
          </span>
        ) : null,
      },
    ],
    csv: { name: 'staff', header: ['الاسم', 'اليوزر', 'الآيدي', 'الحالة', 'النقاط', 'ساعات الشفت', 'التقييم', 'الرسائل', 'انضم'], row: member => [nameOf(member), member.username, member.userId, STATE_LABEL[stateOf(member)][0], member.points ?? 0, fixed(member.shiftHours), fixed(member.averageRating), member.messageCount ?? 0, member.joinedAt ?? ''] },
    empty: (
      <div class="empty">
        <span class="empty-art" aria-hidden="true"><i /><i /><span class="empty-icon"><Icon name="people" size={28} /></span></span>
        <b>ما فيه ستاف بعد</b><p>اضغط «مزامنة الستاف» عشان يتسجل كل اللي عندهم رتبة الستاف، أو أضف عضو يدويًا.</p>
        <div class="empty-action"><Button variant="primary" icon="sync" onClick={(event: Event) => void syncStaff('sync', reload, event.currentTarget as HTMLButtonElement)}>مزامنة الستاف</Button></div>
      </div>
    ),
  });

  const moreMenu = (anchor: HTMLElement) => openMenu(anchor, [
    { label: 'مسح جميع الستاف وإعادة تسجيلهم', icon: 'trash', danger: true, onClick: () => void syncStaff('wipe', reload) },
    { label: 'تصفير إحصائيات الجميع', icon: 'refresh-circle', danger: true, onClick: async () => {
      const ok = await confirmDialog({ title: 'تصفير إحصائيات كل الستاف؟', message: 'تنمسح الإحصائيات المحفوظة للفريق كامل، والأعضاء يبقون في الستاف.', details: ['النقاط والرسائل والفويس وسجل الشفتات', 'التقييمات والشكاوى والتقارير'], confirmText: 'تصفير الكل', typeToConfirm: 'تصفير الكل' });
      if (!ok) return;
      try { await api('/api/staff/reset-all', { method: 'POST' }); toast('انصفرت إحصائيات الجميع'); reload(); } catch (error) { toastError(error); }
    } },
  ]);

  mount(ctx.root, [
    <PageHeader
      title="الستاف"
      subtitle="ملفات الفريق، الحالة الحالية، النقاط والتقييمات. اضغط على أي عضو لملفه السريع."
      actions={ctx.admin ? [
        <Button variant="secondary" icon="sync" onClick={(event: Event) => void syncStaff('sync', reload, event.currentTarget as HTMLButtonElement)}>مزامنة الستاف</Button>,
        <Button variant="danger-soft" icon="trash" class="hide-mobile" onClick={() => void syncStaff('wipe', reload)}>مسح جميع الستاف وإعادة تسجيلهم</Button>,
        <Button variant="ghost" icon="more" aria-label="خيارات أكثر" aria-haspopup="menu" onClick={(event: Event) => moreMenu(event.currentTarget as HTMLElement)} />,
        <Button variant="primary" icon="user-add" onClick={() => addStaffDialog(reload)}>إضافة ستاف</Button>,
      ] : null}
    />,
    <div class="kpi-grid compact">
      <Kpi icon="people" label="كل الستاف" value={num(rows.length - counts('dismissed'))} />
      <Kpi icon="alarm" tone="success" label="في الشفت" value={num(counts('shift'))} />
      <Kpi icon="briefcase" tone="info" label="في إجازة" value={num(counts('leave'))} />
      <Kpi icon="user-remove" tone="danger" label="مفصولين" value={num(counts('dismissed'))} />
    </div>,
    list.node,
    rows.some(member => member.dismissed) ? null : <p class="foot-note"><Badge tone="muted" icon="info-circle">المفصولين يظهرون هنا مع فلتر «مفصول» أول ما يتفصل أحد.</Badge></p>,
  ]);
}
