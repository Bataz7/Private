// الشفتات: من في الشفت الحين، إرسال لوحة الشفت، وكل الستاف بساعاتهم. تتحدث كل 30 ثانية.
import { mount } from '#jsx/jsx-runtime';
import { api, errorText } from '../lib/api';
import { live } from '../lib/dom';
import { duration, fixed, num } from '../lib/format';
import type { PageCtx } from '../shell/types';
import { Avatar, Badge, Button, Card, ChannelSelect, Empty, ErrorState, Kpi, PageHeader, PageSkeleton, busy } from '../ui/kit';
import { createList } from '../ui/list';
import { toast, toastError } from '../ui/overlay';

export default async function shifts(ctx: PageCtx) {
  mount(ctx.root, <PageSkeleton />);
  let data: any;
  const load = async () => { data = await api('/api/shifts', { signal: ctx.signal }); };
  try { await load(); } catch (error) { mount(ctx.root, <ErrorState message={errorText(error)} onRetry={ctx.refresh} />); return; }
  let channels: Array<{ id: string; name: string }> = [];
  let channel = '';

  const view = live(() => {
    const all: any[] = data.shifts ?? [];
    const staff: any[] = data.staff ?? [];
    const active = all.filter(shift => shift.status === 'active');
    const byId = new Map(staff.map(member => [member.userId, member]));
    const onShift = new Set(active.map(shift => shift.userId));
    const avg = staff.length ? staff.reduce((sum, member) => sum + Number(member.shiftHours || 0), 0) / staff.length : 0;
    return [
      <div class="kpi-grid">
        <Kpi icon="timer-start" tone="success" label="الشفتات النشطة" value={num(active.length)} hint="شغالين الحين" />
        <Kpi icon="people" label="الستاف المسجّلين" value={num(staff.length)} />
        <Kpi icon="tick-circle" tone="info" label="متاحين" value={num(staff.filter(member => !onShift.has(member.userId)).length)} hint="خارج الشفت" />
        <Kpi icon="clock" tone="warning" label="متوسط الساعات" value={`${fixed(avg)} س`} hint="لكل عضو" />
      </div>,
      <div class="grid-main">
        <Card title="في الشفت الحين" subtitle="البريكات تظهر بلون مختلف" icon="alarm" actions={<Badge tone="success" dot>{num(active.length)} مباشر</Badge>} flush>
          {active.length ? <div class="divided">{active.map(shift => {
            const member = byId.get(shift.userId);
            const onBreak = Array.isArray(shift.breaks) && shift.breaks.length && !shift.breaks.at(-1)?.endedAt;
            const minutes = Math.max(0, (Date.now() - new Date(shift.startedAt).getTime()) / 60_000);
            return <a class="line-item is-link" href={`/p/${encodeURIComponent(shift.userId)}`}><Avatar src={member?.avatar} name={member?.displayName ?? shift.userId} size={36} ring={onBreak ? 'var(--warning)' : 'var(--success)'} /><div class="row-main"><b>{member?.displayName ?? shift.userId}</b><small>{onBreak ? 'في بريك' : 'شغّال'} · {num(shift.interactionMessageCount ?? 0)} رسالة</small></div><Badge tone={onBreak ? 'warning' : 'success'} dot>{duration(minutes)}</Badge></a>;
          })}</div> : <Empty compact icon="alarm" title="ما أحد في الشفت الحين" />}
        </Card>
        <Card title="إرسال لوحة الشفت" subtitle="لوحة ثابتة في روم، وأزرار الستاف خاصة لهم." icon="send-2">
          <div class="form-stack">
            <ChannelSelect channels={channels} value={channel} placeholder={channels.length ? 'اختر روم…' : 'جار تحميل الرومات…'} onChange={(event: Event) => { channel = (event.currentTarget as HTMLSelectElement).value; }} />
            <Button variant="primary" icon="send-2" onClick={(event: Event) => void busy(event.currentTarget as HTMLButtonElement, async () => {
              if (!channel) return toast('اختر الروم أول.', 'warning');
              try { await api('/api/shifts/panel', { method: 'POST', body: { channelId: channel } }); toast('انرسلت لوحة الشفت'); } catch (error) { toastError(error); }
            })}>إرسال اللوحة</Button>
          </div>
        </Card>
      </div>,
    ];
  });
  const list = createList<any>({
    rows: data.staff ?? [],
    search: member => `${member.displayName} ${member.username}`,
    searchPlaceholder: 'ابحث عن عضو…',
    defaultSort: { key: 'hours', dir: -1 },
    columns: [
      { key: 'name', label: 'العضو', sort: member => member.displayName, render: member => <a class="who" href={`/p/${encodeURIComponent(member.userId)}`}><Avatar name={member.displayName} size={32} /><span class="who-text"><b>{member.displayName}</b><small>@{member.username}</small></span></a> },
      { key: 'state', label: 'الحالة', render: member => ((data.shifts ?? []).some((shift: any) => shift.userId === member.userId && shift.status === 'active') ? <Badge tone="success" dot>في الشفت</Badge> : <Badge dot>متاح</Badge>) },
      { key: 'hours', label: 'إجمالي الساعات', class: 'num', sort: member => member.shiftHours ?? 0, render: member => `${fixed(member.shiftHours)} س` },
    ],
    csv: { name: 'shifts', header: ['الاسم', 'اليوزر', 'الساعات'], row: member => [member.displayName, member.username, fixed(member.shiftHours)] },
    empty: <Empty icon="people" title="ما فيه ستاف مسجّلين" />,
  });

  mount(ctx.root, [
    <PageHeader title="الشفتات" subtitle="التوفر والشفتات النشطة والبريكات. تتحدث كل 30 ثانية." actions={<Button icon="refresh-arrow-01" onClick={ctx.refresh}>تحديث</Button>} />,
    view.node,
    <h3 class="section-title">كل الستاف</h3>,
    list.node,
  ]);
  api<{ channels: typeof channels }>('/api/panel/options', { signal: ctx.signal }).then(result => { channels = result.channels ?? []; view.update(); }).catch(() => undefined);
  const timer = setInterval(async () => { try { await load(); view.update(); list.setRows(data.staff ?? []); } catch { /* نجرّب بعدين */ } }, 30_000);
  ctx.onCleanup(() => clearInterval(timer));
}
