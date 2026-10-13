// نظرة عامة: مؤشرات اليوم، نشاط الفريق، متصدرين الأسبوع، الطلبات المعلقة، من في الشفت، وآخر الأحداث.
import type { Child } from '#jsx/jsx-runtime';
import { mount } from '#jsx/jsx-runtime';
import { api, errorText } from '../lib/api';
import { avatarUrl } from '../lib/boot';
import { live } from '../lib/dom';
import { ago, count, duration, fixed, greeting, num, weekday } from '../lib/format';
import type { PageCtx } from '../shell/types';
import { BarChart, Ring } from '../ui/chart';
import { Icon } from '../ui/Icon';
import { Avatar, Badge, Button, Card, Empty, ErrorState, Kpi, PageSkeleton, Seg, Skeleton } from '../ui/kit';
import { confirmDialog, toast, toastError } from '../ui/overlay';
import { addStaffDialog, nameOf, openStaffDrawer, syncStaff, type StaffRow } from './staff-actions';

const ACTION_LABEL: Record<string, string> = {
  SHIFT_STARTED: 'بدأ شفت', SHIFT_STARTED_AUTOMATICALLY: 'بدأ شفت تلقائيًا', SHIFT_ENDED: 'أنهى شفت', SHIFT_AUTO_ENDED: 'انتهى شفته تلقائيًا', BREAK_STARTED: 'أخذ بريك', BREAK_RESUMED: 'رجع من البريك',
  LEAVE_REQUESTED: 'طلب إجازة', LEAVE_APPROVED: 'انقبلت إجازته', RETURNED_FROM_LEAVE: 'رجع من الإجازة', RESIGNATION_REQUESTED: 'قدّم استقالة', COMPLAINT_REVIEWED: 'انراجعت شكوى عليه',
  POINTS_ADJUSTED: 'تعديل نقاط', STAFF_DISMISSED: 'انفصل', STAFF_REINSTATED: 'انلغى فصله', STAFF_SYNCED: 'مزامنة الستاف', STAFF_WIPED: 'مسح الستاف وإعادة التسجيل', ASSISTANCE_RECORDED: 'ساعد عضو',
  MOD_REPORT_SUBMITTED: 'قدّم تقرير مود', REPORTS_SENT: 'أرسل التقارير', STAFF_NOTE_ADDED: 'ملاحظة جديدة', PRESENCE_CHECK_FAILED: 'ما رد على التحقق من التواجد', WARNING_ISSUED: 'أخذ إنذار',
};
export const actionText = (action: string) => ACTION_LABEL[action] ?? String(action || '').toLowerCase().replace(/_/g, ' ');
const ACTION_ICON: Record<string, string> = { SHIFT: 'alarm', BREAK: 'timer-pause', LEAVE: 'briefcase', RETURNED: 'briefcase', RESIGNATION: 'logout-01', REPORT: 'document-text', REPORTS: 'chart-2', MOD: 'shield-tick', COMPLAINT: 'danger', ASSISTANCE: 'people', POINTS: 'medal-star', STAFF: 'people', WARNING: 'warning-2', PRESENCE: 'radar' };
export const actionIcon = (action: string) => ACTION_ICON[String(action).split('_')[0]!] ?? 'activity';

const dayLabel = (iso: string) => { const d = new Date(`${iso}T00:00:00Z`); return `${d.getUTCDate()}/${d.getUTCMonth() + 1}`; };
const minutesSince = (value: string) => Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));

export default async function overview(ctx: PageCtx) {
  if (!ctx.admin) return personal(ctx);
  mount(ctx.root, <PageSkeleton />);
  let data: any;
  try {
    data = await ctx.shared('bootstrap', () => api('/api/bootstrap'));
  } catch (error) {
    mount(ctx.root, <ErrorState message={errorText(error)} onRetry={ctx.refresh} />);
    return;
  }
  const reload = () => { ctx.invalidate('bootstrap'); ctx.refresh(); };
  const staff: StaffRow[] = data.staff ?? [];
  const byId = new Map(staff.map(member => [member.userId, member]));
  const live_ = (data.shifts ?? []).filter((shift: any) => shift.status === 'active');
  const pending = (rows: any[] | undefined) => (rows ?? []).filter(row => row.status === 'pending');
  const queue = [
    ...pending(data.complaints).map((row: any) => ({ kind: 'complaints', icon: 'danger', tone: 'danger', id: row.id, who: row.staffUserId, title: `شكوى على ${nameOf(byId.get(row.staffUserId), row.staffUserId)}`, detail: row.reason, at: row.createdAt, yes: 'approved', no: 'rejected', yesLabel: 'اعتماد' })),
    ...pending(data.leaves).map((row: any) => ({ kind: 'leaves', icon: 'briefcase', tone: 'info', id: row.id, who: row.userId, title: `طلب إجازة من ${nameOf(byId.get(row.userId), row.userId)}`, detail: row.reason, at: row.createdAt, yes: 'approved', no: 'rejected', yesLabel: 'قبول' })),
    ...pending(data.resignations).map((row: any) => ({ kind: 'resignations', icon: 'logout-01', tone: 'warning', id: row.id, who: row.userId, title: `استقالة من ${nameOf(byId.get(row.userId), row.userId)}`, detail: row.reason, at: row.createdAt, yes: 'approved', no: 'rejected', yesLabel: 'قبول' })),
  ].sort((a, b) => +new Date(a.at) - +new Date(b.at));
  const me = staff.find(member => member.userId === ctx.user.id);
  const totalPoints = staff.reduce((sum, member) => sum + (member.points ?? 0), 0);
  const hasWeek = staff.some(member => typeof member.weekPoints === 'number');
  const weekPoints = staff.reduce((sum, member) => sum + (member.weekPoints ?? 0), 0);

  const decide = async (item: (typeof queue)[number], status: string, button: HTMLButtonElement) => {
    if (item.kind === 'complaints' && status === 'approved' && !(await confirmDialog({ title: 'اعتماد الشكوى؟', message: 'اعتماد الشكوى يخصم نقاط العقوبة من عضو الستاف.', confirmText: 'اعتماد' }))) return;
    if (item.kind === 'resignations' && status === 'approved' && !(await confirmDialog({ title: 'قبول الاستقالة؟', message: 'في آخر يوم عمل تنشال منه رتبة الستاف.', confirmText: 'قبول' }))) return;
    button.disabled = true;
    try {
      await api(`/api/${item.kind}/${encodeURIComponent(item.id)}`, { method: 'PATCH', body: { status } });
      toast('انحفظ القرار');
      reload();
    } catch (error) { toastError(error); button.disabled = false; }
  };

  const chart = live(() => <Skeleton lines={1} height={200} />);
  const board = live(() => <Skeleton lines={6} height={34} />);
  const activity = live(() => <Skeleton lines={5} height={30} />);

  mount(ctx.root, [
    <section class="hero">
      <div class="hero-text">
        <span class="hero-date">{weekday(new Date())}</span>
        <h1>{greeting()}، {me ? nameOf(me) : ctx.user.username} 👋</h1>
        <p>{queue.length ? `${count(queue.length, ['طلب واحد ينتظر', 'طلبين ينتظرون', 'طلبات تنتظر', 'طلب ينتظر'])} قرارك.` : 'كل شي تمام، ما فيه طلبات تنتظرك.'} {live_.length ? `و${count(live_.length, ['واحد', 'اثنين', 'أعضاء', 'عضو'])} في الشفت الحين.` : ''}</p>
      </div>
      <div class="hero-actions">
        <Button variant="secondary" icon="sync" onClick={(event: Event) => void syncStaff('sync', reload, event.currentTarget as HTMLButtonElement)}>مزامنة الستاف</Button>
        <Button variant="primary" icon="user-add" onClick={() => addStaffDialog(reload)}>إضافة ستاف</Button>
      </div>
    </section>,
    <div class="kpi-grid">
      <Kpi icon="alarm" tone="success" label="الشفتات النشطة" value={num(live_.length)} hint={live_.length ? 'شغالين الحين' : 'ما أحد في الشفت'} onClick={() => ctx.navigate('shifts')} />
      <Kpi icon="people" label="الستاف" value={num(staff.length)} hint={`${num(staff.filter(member => member.active).length)} في الشفت · ${num(staff.filter(member => (member.ratingCount ?? 0) > 0).length)} مقيّمين`} onClick={() => ctx.navigate('staff')} />
      <Kpi icon="medal-star" tone="info" label={hasWeek ? 'نقاط هذا الأسبوع' : 'نقاط الفريق'} value={num(hasWeek ? weekPoints : totalPoints)} hint={hasWeek ? `من ${num(totalPoints)} نقطة إجمالًا` : 'مجموع نقاط الستاف'} onClick={() => ctx.navigate('points')} />
      <Kpi icon="danger" tone={pending(data.complaints).length ? 'danger' : 'success'} label="الشكاوى المعلقة" value={num(pending(data.complaints).length)} hint={pending(data.complaints).length ? 'تحتاج مراجعة' : 'كله تمام'} onClick={() => ctx.navigate('complaints')} />
    </div>,
    <div class="grid-main">
      <Card title="نشاط الفريق" subtitle="آخر 14 يوم" icon="chart-2" actions={<Seg size="sm" label="المقياس" value="shiftHours" options={[{ value: 'shiftHours', label: 'ساعات الشفت' }, { value: 'minutes', label: 'دقائق النشاط' }, { value: 'messages', label: 'الرسائل' }]} onChange={value => { metric = value as typeof metric; chart.update(); }} />}>
        {chart.node}
      </Card>
      <Card title="متصدرين الأسبوع" subtitle="أفضل 10" icon="crown" actions={<Button variant="ghost" size="sm" iconEnd="arrow-right-01" flipIcon onClick={() => ctx.navigate('points')}>الكل</Button>} flush>
        {board.node}
      </Card>
    </div>,
    <div class="grid-2 mt">
      <Card title="يحتاج قرارك" subtitle={queue.length ? `${num(queue.length)} بالانتظار، الأقدم أول` : 'ما فيه طلبات مفتوحة'} icon="clipboard-text" flush>
        {queue.length ? (
          <div class="divided">
            {queue.slice(0, 7).map(item => (
              <div class="line-item queue-item">
                <span class={`q-icon tone-${item.tone}`}><Icon name={item.icon} size={18} /></span>
                <div class="row-main"><b>{item.title}</b><p dir="auto" class="clamp-2">{item.detail || '—'}</p><small>{ago(item.at)}</small></div>
                <div class="row-end">
                  <Button size="sm" variant="primary" onClick={(event: Event) => void decide(item, item.yes, event.currentTarget as HTMLButtonElement)}>{item.yesLabel}</Button>
                  <Button size="sm" variant="ghost" onClick={(event: Event) => void decide(item, item.no, event.currentTarget as HTMLButtonElement)}>رفض</Button>
                </div>
              </div>
            ))}
            {queue.length > 7 ? <p class="more-note">و{num(queue.length - 7)} زيادة في الشكاوى والإجازات والاستقالات.</p> : null}
          </div>
        ) : <Empty icon="tick-circle" title="ما فيه شي ينتظر" text="الشكاوى وطلبات الإجازة والاستقالة تطلع هنا." compact />}
      </Card>
      <Card title="في الشفت الحين" subtitle={`${num(live_.length)} نشط`} icon="alarm" actions={<Button variant="ghost" size="sm" iconEnd="arrow-right-01" flipIcon onClick={() => ctx.navigate('shifts')}>الشفتات</Button>} flush>
        {live_.length ? (
          <div class="divided">
            {live_.map((shift: any) => {
              const member = byId.get(shift.userId);
              const onBreak = Array.isArray(shift.breaks) && shift.breaks.length && !shift.breaks.at(-1)?.endedAt;
              return (
                <button type="button" class="line-item is-link" onClick={() => member && openStaffDrawer(member, data, { admin: true, onChanged: reload })}>
                  <Avatar src={member?.avatar} name={nameOf(member, shift.userId)} size={36} ring={onBreak ? 'var(--warning)' : 'var(--success)'} />
                  <div class="row-main"><b>{nameOf(member, shift.userId)}</b><small>{onBreak ? 'في بريك' : 'شغّال'} · {num(shift.interactionMessageCount ?? 0)} رسالة</small></div>
                  <Badge tone={onBreak ? 'warning' : 'success'} dot>{duration(minutesSince(shift.startedAt))}</Badge>
                </button>
              );
            })}
          </div>
        ) : <Empty icon="alarm" title="ما أحد في الشفت" text="الشفتات النشطة تطلع هنا مباشرة." compact />}
      </Card>
    </div>,
    <Card title="آخر الأحداث" subtitle="من سجل التدقيق" icon="activity" class="mt" actions={<Button variant="ghost" size="sm" iconEnd="arrow-right-01" flipIcon onClick={() => ctx.navigate('audit')}>السجل كامل</Button>} flush>
      {activity.node}
    </Card>,
  ]);

  // الرسم البياني
  let metric: 'shiftHours' | 'minutes' | 'messages' = 'shiftHours';
  let days: Array<{ date: string; minutes: number; messages: number; shiftHours: number }> | null = null;
  const paintChart = () => mount(chart.el!, days
    ? (days.some(day => day[metric]) ? <BarChart label="نشاط الفريق آخر 14 يوم" data={days.map(day => ({ label: dayLabel(day.date), value: day[metric] || 0, tip: weekday(`${day.date}T12:00:00Z`) }))} format={value => metric === 'shiftHours' ? `${fixed(value)}س` : num(value)} /> : <Empty compact icon="chart-2" title="ما فيه نشاط مسجّل" text="يبدأ يظهر أول ما الستاف يشتغلون." />)
    : <Skeleton lines={1} height={200} />);
  chart.update = paintChart;
  api<{ days: typeof days }>('/api/activity/weekly', { signal: ctx.signal }).then(result => { days = result.days ?? []; paintChart(); }).catch(error => { if (!ctx.signal.aborted && chart.el) mount(chart.el, <Empty compact icon="danger" title="بيانات النشاط مو متوفرة الحين" text={errorText(error)} />); });

  // المتصدرين: نقاط الأسبوع إن وجدت، وإلا درجة الأسبوع.
  Promise.all([api<any>('/api/points', { signal: ctx.signal }).catch(() => null), api<any>('/api/grades', { signal: ctx.signal }).catch(() => null)]).then(([points, grades]) => {
    if (!board.el) return;
    const weekly = (points?.leaderboard ?? []).some((row: any) => typeof row.weekPoints === 'number');
    let rows: Array<{ userId: string; name: string; avatar: string; value: Child; sub: Child }> = [];
    if (weekly) {
      rows = [...points.leaderboard].sort((a: any, b: any) => (b.weekPoints ?? 0) - (a.weekPoints ?? 0)).slice(0, 10).map((row: any) => ({ userId: row.userId, name: row.displayName, avatar: row.avatar, value: <b class="num">{num(row.weekPoints)}</b>, sub: `${num(row.points)} إجمالي` }));
    } else if (grades?.team?.length) {
      rows = grades.team.slice(0, 10).map((row: any) => ({ userId: row.userId, name: row.displayName, avatar: row.avatar, value: <span class="lb-score"><span class={`grade-pill g-${row.grade}`}>{row.grade}</span><b class="num">{row.score}</b></span>, sub: `${fixed(row.shiftHours)}س شفت · ${num(row.messages)} رسالة` }));
    } else if (points?.leaderboard?.length) {
      rows = points.leaderboard.slice(0, 10).map((row: any) => ({ userId: row.userId, name: row.displayName, avatar: row.avatar, value: <b class="num">{num(row.points)}</b>, sub: row.rank || 'نقطة' }));
    }
    mount(board.el, rows.length ? <ol class="leaderboard">{rows.map((row, index) => (
      <li><a class="lb-row" href={`/p/${encodeURIComponent(row.userId)}`}>
        <span class={`lb-place p${index + 1}`}>{index < 3 ? <Icon name="medal-star" size={18} bold /> : index + 1}</span>
        <Avatar src={row.avatar} name={row.name} size={32} />
        <span class="row-main"><b>{row.name}</b><small>{row.sub}</small></span>
        {row.value}
      </a></li>
    ))}</ol> : <Empty compact icon="crown" title="ما فيه ترتيب بعد" />);
  });

  // آخر الأحداث
  api<any>('/api/audit?page=1', { signal: ctx.signal }).then(result => {
    if (!activity.el) return;
    const rows = (result.rows ?? []).slice(0, 8);
    mount(activity.el, rows.length ? <ol class="timeline">{rows.map((row: any) => (
      <li><span class="tl-icon"><Icon name={actionIcon(row.action)} size={16} /></span><div class="tl-body"><b>{row.name || nameOf(byId.get(row.userId), row.userId)}</b> <span>{actionText(row.action)}</span>{row.actorName && row.actorId !== row.userId ? <small> · بواسطة {row.actorName}</small> : null}</div><time>{ago(row.createdAt)}</time></li>
    ))}</ol> : <Empty compact icon="activity" title="ما فيه أحداث بعد" />);
  }).catch(() => { if (activity.el) mount(activity.el, <Empty compact icon="activity" title="السجل مو متوفر الحين" />); });
}

// ───── نسخة الستاف (بدون صلاحيات إدارة) ─────
async function personal(ctx: PageCtx) {
  mount(ctx.root, <PageSkeleton />);
  const [points, grades] = await Promise.all([api<any>('/api/points').catch(() => null), api<any>('/api/grades').catch(() => null)]);
  const mine = points?.leaderboard?.find((row: any) => row.userId === ctx.user.id);
  const grade = grades?.me;
  mount(ctx.root, [
    <section class="hero">
      <div class="hero-text"><span class="hero-date">{weekday(new Date())}</span><h1>{greeting()}، {mine?.displayName ?? ctx.user.username} 👋</h1><p>هذا ملخصك هذا الأسبوع.</p></div>
      <div class="hero-actions"><Button variant="secondary" icon="user-square" href="/p/me">ملفي</Button><Button variant="primary" icon="briefcase" onClick={() => ctx.navigate('leaves')}>طلب إجازة</Button></div>
    </section>,
    <div class="kpi-grid">
      <Kpi icon="medal-star" label="نقاطي" value={num(points?.me?.total ?? mine?.points ?? 0)} hint={mine ? `المركز #${mine.place} من ${num(points.leaderboard.length)}` : 'لست في قائمة الستاف'} onClick={() => ctx.navigate('points')} />
      <Kpi icon="award" tone="info" label="درجة الأسبوع" value={grade ? `${grade.grade} · ${grade.score}` : '—'} hint={grade?.next ? `باقي ${grade.next.need} نقطة لـ ${grade.next.letter}` : grade ? 'أعلى درجة' : 'للستاف النشطين'} onClick={() => ctx.navigate('grades')} />
      <Kpi icon="crown" tone="warning" label="ترتيبي هذا الأسبوع" value={grade?.rank ? `#${grade.rank}` : '—'} hint={grade?.of ? `من ${num(grade.of)} ستاف` : ''} />
      <Kpi icon="notification" tone="success" label="الإشعارات" value="↗" hint="افتح صندوقك" onClick={() => ctx.navigate('notifications')} />
    </div>,
    <div class="grid-main">
      <Card title="الترتيب" subtitle="أفضل 10 بالنقاط" icon="crown" flush>
        {points?.leaderboard?.length ? <ol class="leaderboard">{points.leaderboard.slice(0, 10).map((row: any, index: number) => (
          <li><a class={`lb-row ${row.userId === ctx.user.id ? 'is-me' : ''}`} href={`/p/${encodeURIComponent(row.userId)}`}><span class={`lb-place p${index + 1}`}>{index < 3 ? <Icon name="medal-star" size={18} bold /> : index + 1}</span><Avatar src={row.avatar || (row.userId === ctx.user.id ? avatarUrl(ctx.user) : '')} name={row.displayName} size={32} /><span class="row-main"><b>{row.displayName}</b><small>{row.userId === ctx.user.id ? 'أنت' : row.rank || ''}</small></span><b class="num">{num(row.points)}</b></a></li>
        ))}</ol> : <Empty compact icon="crown" title="ما فيه ترتيب بعد" />}
      </Card>
      <Card title="درجتك" subtitle="من 100، تتجدد كل أسبوع" icon="award">
        {grade ? <div class="grade-mini"><Ring value={grade.score} size={120} stroke={10} tone={`g-${grade.grade}`}><b class="ring-big">{grade.grade}</b><small>{grade.score}/100</small></Ring><Button variant="soft" iconEnd="arrow-right-01" flipIcon onClick={() => ctx.navigate('grades')}>كيف أرفع درجتي؟</Button></div> : <Empty compact icon="award" title="ما فيه درجة بعد" />}
      </Card>
    </div>,
  ]);
}
