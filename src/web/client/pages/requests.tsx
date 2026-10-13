// الإجازات والاستقالات: كل ستاف يشوف طلباته ويقدّم طلب، والإدارة تشوف الكل وتقرر وتمدد وتدير اللوحة والروم.
import { mount } from '#jsx/jsx-runtime';
import { api, errorText } from '../lib/api';
import { live } from '../lib/dom';
import { count, date, num, shortId } from '../lib/format';
import type { PageCtx } from '../shell/types';
import { Avatar, Badge, Button, Card, ChannelSelect, Empty, ErrorState, Field, Kpi, Notice, PageHeader, PageSkeleton, Select, busy, type Tone } from '../ui/kit';
import { createList } from '../ui/list';
import { confirmDialog, openModal, promptDialog, toast, toastError } from '../ui/overlay';

const DAY = 86_400_000;
type Kind = 'leaves' | 'resignations';
const KIND = {
  leaves: { title: 'الإجازات', one: 'إجازة', api: '/api/leaves', panel: '/api/leaves/panel', key: 'leave', icon: 'briefcase', intro: 'الستاف يطلبون الإجازة من اللوحة أو /leave أو من هنا. الإدارة تقبل أو ترفض والعضو يوصله الرد في الخاص.', running: 'شغّالة', closed: 'المرفوضة أو المنتهية' },
  resignations: { title: 'الاستقالات', one: 'استقالة', api: '/api/resignations', panel: '/api/resignations/panel', key: 'resignation', icon: 'logout-01', intro: 'الستاف يقدمون الاستقالة من اللوحة أو /resign أو من هنا. الإدارة تقبل أو ترفض، وفي آخر يوم عمل يأكدها العضو في الخاص.', running: 'مقبولة', closed: 'المرفوضة أو المكتملة' },
} as const;
const group = (status: string) => (status === 'pending' ? 'pending' : status === 'approved' ? 'approved' : 'closed');

function statusOf(kind: Kind, row: any): [string, Tone] {
  if (kind === 'leaves') {
    if (row.status === 'approved') return new Date(row.startDate).getTime() > Date.now() ? ['مقبولة · تبدأ قريب', 'info'] : ['مقبولة · في إجازة', 'success'];
    return ({ pending: ['بانتظار القرار', 'warning'], rejected: ['مرفوضة', 'danger'], returned: ['رجع', 'muted'] } as Record<string, [string, Tone]>)[row.status] ?? [row.status, 'muted'];
  }
  return ({ pending: ['بانتظار القرار', 'warning'], approved: ['مقبولة · بانتظار آخر يوم', 'info'], accepted: ['مكتملة', 'success'], rejected: ['مرفوضة', 'danger'] } as Record<string, [string, Tone]>)[row.status] ?? [row.status, 'muted'];
}

export async function requestsPage(ctx: PageCtx, kind: Kind) {
  const meta = KIND[kind];
  mount(ctx.root, <PageSkeleton cards={4} />);
  let data: any;
  try { data = await api(meta.api, { signal: ctx.signal }); }
  catch (error) { mount(ctx.root, <ErrorState message={errorText(error)} onRetry={ctx.refresh} />); return; }
  const admin = Boolean(data.admin);
  const rows: any[] = [...(data.rows ?? [])].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  const person = (id: string) => data.people?.[id];
  const nameOf = (id: string) => person(id)?.displayName || person(id)?.username || `عضو ${shortId(id)}`;
  const n = (g: string) => rows.filter(row => group(row.status) === g).length;
  if (admin) ctx.setBadge(kind, n('pending'));

  const done = (message: string) => { toast(message); ctx.refresh(); };
  const decide = async (row: any, status: 'approved' | 'rejected') => {
    const note = await promptDialog({ title: status === 'approved' ? `قبول ${meta.one} ${nameOf(row.userId)}؟` : `رفض ${meta.one} ${nameOf(row.userId)}؟`, label: 'ملاحظة للعضو', confirmText: status === 'approved' ? 'قبول' : 'رفض', danger: status === 'rejected', icon: status === 'approved' ? 'tick-circle' : 'close-circle' });
    if (note === null) return;
    try { const result = await api(`${meta.api}/${encodeURIComponent(row.id)}`, { method: 'PATCH', body: { status, note } }); done(result.dmSent === false ? 'انحفظ القرار، بس الخاص مقفل عند العضو. بلّغه بنفسك.' : 'انحفظ القرار ووصل العضو'); }
    catch (error) { toastError(error); }
  };
  const extend = (row: any) => openModal({
    title: 'تمديد الإجازة', description: `الإجازة الحالية تنتهي ${date(row.endDate)}.`, icon: 'calendar',
    body: close => (
      <form class="form-stack" id="extendForm" onSubmit={async (event: Event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget as HTMLFormElement);
        await busy(document.querySelector<HTMLButtonElement>('[data-submit]'), async () => {
          try { const result = await api(`${meta.api}/${encodeURIComponent(row.id)}/extend`, { method: 'POST', body: { endDate: form.get('endDate'), note: form.get('note') } }); close(); done(result.dmSent ? 'تمددت الإجازة ووصل العضو' : 'تمددت الإجازة، بس الخاص مقفل عند العضو'); }
          catch (error) { toastError(error); }
        });
      }}>
        <Field label="تاريخ النهاية الجديد"><input class="input" type="date" name="endDate" required min={new Date(new Date(row.endDate).getTime() + DAY).toISOString().slice(0, 10)} value={row.extensionEndDate ? new Date(row.extensionEndDate).toISOString().slice(0, 10) : ''} /></Field>
        <Field label="ملاحظة للعضو" optional><textarea class="input" name="note" rows="3" maxlength="500" dir="auto" /></Field>
      </form>
    ),
    footer: close => [<Button variant="ghost" onClick={close}>إلغاء</Button>, <Button variant="primary" data-submit onClick={() => (document.getElementById('extendForm') as HTMLFormElement).requestSubmit()}>تمديد وإبلاغ العضو</Button>],
  });

  const metaLine = (row: any) => {
    if (kind === 'leaves') {
      const days = Math.max(1, Math.round((new Date(row.endDate).getTime() - new Date(row.startDate).getTime()) / DAY) + 1);
      const left = Math.ceil((new Date(row.endDate).getTime() + DAY - Date.now()) / DAY);
      return [<span>📅 {date(row.startDate)} ← {date(row.endDate)}</span>, <span>{count(days, ['يوم', 'يومين', 'أيام', 'يوم'])}</span>, row.status === 'approved' ? <span class={left > 0 ? 'pos' : 'neg'}>{left > 0 ? `باقي ${count(left, ['يوم', 'يومين', 'أيام', 'يوم'])}` : 'انتهت المدة'}</span> : null, row.extensionEndDate ? <span class="neg">طلب تمديد لـ {date(row.extensionEndDate)}</span> : null];
    }
    const left = Math.ceil((new Date(row.lastWorkingDay).getTime() - Date.now()) / DAY);
    return [<span>📅 آخر يوم {date(row.lastWorkingDay)}</span>, row.status === 'approved' || row.status === 'pending' ? <span class={left <= 3 ? 'neg' : ''}>{left > 0 ? `باقي ${count(left, ['يوم', 'يومين', 'أيام', 'يوم'])}` : left === 0 ? 'اليوم' : 'فات التاريخ'}</span> : null];
  };

  const list = createList<any>({
    rows,
    search: row => `${nameOf(row.userId)} ${person(row.userId)?.username ?? ''} ${row.reason ?? ''} ${String(row.id).slice(-6)}`,
    searchPlaceholder: 'ابحث بالاسم أو السبب أو الرقم…',
    segment: { label: 'الحالة', value: '', options: [{ value: '', label: 'الكل' }, { value: 'pending', label: 'بالانتظار', count: n('pending') }, { value: 'approved', label: meta.running }, { value: 'closed', label: 'منتهية' }], test: (row, value) => group(row.status) === value },
    date: row => +new Date(row.createdAt),
    csv: { name: kind, header: ['الاسم', 'السبب', 'الحالة', 'التاريخ'], row: row => [nameOf(row.userId), row.reason, statusOf(kind, row)[0], row.createdAt] },
    render: row => {
      const [label, tone] = statusOf(kind, row);
      return (
        <article class="req-card">
          <header><Avatar src={person(row.userId)?.avatar} name={nameOf(row.userId)} size={38} /><div class="row-main"><a href={`/p/${encodeURIComponent(row.userId)}`}><b>{nameOf(row.userId)}</b></a><small>#{String(row.id).slice(-6).toUpperCase()} · أرسل {date(row.createdAt)}</small></div><Badge tone={tone} dot>{label}</Badge></header>
          <div class="req-meta">{metaLine(row)}</div>
          {row.reason ? <p class="req-reason" dir="auto">{row.reason}</p> : null}
          {kind === 'resignations' && row.notes ? <p class="req-reason muted" dir="auto">ملاحظات: {row.notes}</p> : null}
          {row.status !== 'pending' && row.reviewedBy ? <div class="req-decision"><b>{row.status === 'rejected' ? 'رفضها' : 'قبلها'} {nameOf(row.reviewedBy)}</b>{row.reviewedAt ? ` · ${date(row.reviewedAt)}` : ''}{row.decisionNote ? <p dir="auto">{row.decisionNote}</p> : null}</div> : null}
          {admin && row.status === 'pending' ? <div class="req-actions"><Button variant="primary" size="sm" icon="tick-circle" onClick={() => void decide(row, 'approved')}>قبول</Button><Button variant="danger-soft" size="sm" icon="close-circle" onClick={() => void decide(row, 'rejected')}>رفض</Button></div> : null}
          {admin && kind === 'leaves' && row.status === 'approved' ? (
            <div class="req-actions">
              {row.extensionEndDate ? [
                <Button variant="primary" size="sm" onClick={async (event: Event) => busy(event.currentTarget as HTMLButtonElement, async () => { try { await api(`${meta.api}/${encodeURIComponent(row.id)}/extension`, { method: 'POST', body: { decision: 'approved' } }); done('انقبل التمديد'); } catch (error) { toastError(error); } })}>قبول التمديد</Button>,
                <Button variant="danger-soft" size="sm" onClick={async (event: Event) => busy(event.currentTarget as HTMLButtonElement, async () => { try { await api(`${meta.api}/${encodeURIComponent(row.id)}/extension`, { method: 'POST', body: { decision: 'rejected' } }); done('انرفض التمديد'); } catch (error) { toastError(error); } })}>رفض التمديد</Button>,
              ] : null}
              <Button variant="secondary" size="sm" icon="calendar" onClick={() => extend(row)}>تمديد</Button>
              <Button variant="ghost" size="sm" icon="tick-circle" onClick={async () => {
                if (!await confirmDialog({ title: 'تسجيل رجوعه من الإجازة؟', message: 'الإجازة تنقفل الحين وترجع رتبه. استخدمها لما ما يقدر يضغط الزر بنفسه.', confirmText: 'تسجيل الرجوع', danger: false })) return;
                try { const result = await api(`${meta.api}/${encodeURIComponent(row.id)}/close`, { method: 'POST', body: {} }); done(result.rolesOk === false ? 'انقفلت الإجازة، بس بعض الرتب ما تغيرت. تأكد من ترتيب الرتب.' : 'انقفلت الإجازة ورجعت الرتب'); } catch (error) { toastError(error); }
              }}>رجع</Button>
            </div>
          ) : null}
        </article>
      );
    },
    empty: <Empty icon={meta.icon} title="ما فيه طلبات بعد" text={`طلبات ال${meta.one} تطلع هنا.`} />,
  });

  const createForm = () => openModal({
    title: `طلب ${meta.one} جديد`, description: 'لحسابك أنت. الإدارة يوصلها إشعار في روم الطلبات.', icon: meta.icon,
    body: close => (
      <form class="form-grid" id="reqForm" onSubmit={async (event: Event) => {
        event.preventDefault();
        const values = Object.fromEntries(new FormData(event.currentTarget as HTMLFormElement));
        await busy(document.querySelector<HTMLButtonElement>('[data-submit]'), async () => {
          try { const result = await api(meta.api, { method: 'POST', body: values }); close(); done(result.sentToManagement === false ? 'انحفظ الطلب، بس ما فيه روم طلبات محدد' : 'انرسل طلبك للإدارة'); }
          catch (error) { toastError(error); }
        });
      }}>
        {kind === 'leaves'
          ? [<Field label="من"><input class="input" type="date" name="startDate" required /></Field>, <Field label="إلى"><input class="input" type="date" name="endDate" required /></Field>, <Field label="السبب" full><textarea class="input" name="reason" required maxlength="1000" dir="auto" /></Field>]
          : [<Field label="آخر يوم عمل" full><input class="input" type="date" name="lastWorkingDay" required /></Field>, <Field label="السبب" full><textarea class="input" name="reason" required maxlength="1000" dir="auto" /></Field>, <Field label="ملاحظات" optional full><textarea class="input" name="notes" maxlength="1000" dir="auto" /></Field>]}
      </form>
    ),
    footer: close => [<Button variant="ghost" onClick={close}>إلغاء</Button>, <Button variant="primary" icon="send-2" data-submit onClick={() => (document.getElementById('reqForm') as HTMLFormElement).requestSubmit()}>إرسال الطلب</Button>],
  });

  const tools = admin ? adminTools(kind, n('pending'), ctx) : null;
  mount(ctx.root, [
    <PageHeader title={meta.title} subtitle={meta.intro} actions={[<Button icon="refresh-arrow-01" onClick={ctx.refresh}>تحديث</Button>, <Button variant="primary" icon="add" disabled={data.ready === false} onClick={createForm}>طلب {meta.one}</Button>]} />,
    data.ready === false ? <Notice tone="warning" title="قاعدة البيانات تحتاج تحديث">{data.message || 'شغّل ملف migration الخاص بالإجازات والاستقالات ثم أعد تشغيل البوت.'}</Notice> : null,
    <div class="kpi-grid compact">
      <Kpi icon="clock" tone="warning" label="بالانتظار" value={num(n('pending'))} />
      <Kpi icon="tick-circle" tone="success" label={meta.running} value={num(n('approved'))} />
      <Kpi icon="calendar-tick" label="منتهية" value={num(n('closed'))} />
      <Kpi icon="document-text" tone="info" label="الإجمالي" value={num(rows.length)} />
    </div>,
    <h3 class="section-title">{admin ? `كل طلبات ال${meta.one}` : `طلباتي`}</h3>,
    list.node,
    tools,
  ]);
}

function adminTools(kind: Kind, pending: number, ctx: PageCtx) {
  const meta = KIND[kind];
  let options: any = null;
  let panel = '';
  let requests = '';
  let age = '0';
  const closed = live(() => null, { class: 'field-hint' }, 'small');
  const refreshCount = () => api(`/api/requests/${kind}/closed-count?olderThanDays=${age}`).then(r => { if (closed.el) closed.el.textContent = `${count(r.closed, ['طلب واحد', 'طلبين', 'طلبات', 'طلب'])} بينحذف.`; }).catch(() => undefined);
  const selects = live(() => options ? (
    <div class="form-grid">
      <Field label="روم اللوحة" hint="المكان اللي يضغط فيه الأعضاء الزر."><ChannelSelect channels={options.channels ?? []} value={panel} onChange={(e: Event) => { panel = (e.currentTarget as HTMLSelectElement).value; }} /></Field>
      <Field label="روم الطلبات (للمراجعة)" hint="كل طلب يوصل هنا للإدارة."><ChannelSelect channels={options.channels ?? []} value={requests} onChange={(e: Event) => { requests = (e.currentTarget as HTMLSelectElement).value; }} /></Field>
    </div>
  ) : <p class="muted">جار تحميل الرومات…</p>);
  api(`/api/requests-workflow/options`).then(result => { options = result; panel = result[meta.key]?.panelChannelId ?? ''; requests = result[meta.key]?.requestsChannelId ?? ''; selects.update(); }).catch(() => undefined);
  setTimeout(refreshCount);
  const action = (fn: () => Promise<void>) => (event: Event) => void busy(event.currentTarget as HTMLButtonElement, async () => { try { await fn(); } catch (error) { toastError(error); } });
  return (
    <Card title="اللوحة وروم الطلبات" subtitle="اللوحة وروم المراجعة ممكن يكونون رومين مختلفين." icon="setting-2" class="mt">
      <div class="form-stack">
        {selects.node}
        <div class="form-actions start">
          <Button variant="primary" icon="send-2" onClick={action(async () => {
            if (!panel || !requests) return toast('اختر روم اللوحة وروم الطلبات أول.', 'warning');
            const result = await api(meta.panel, { method: 'POST', body: { channelId: panel, requestsChannelId: requests } });
            toast(result.updated ? 'تحدثت اللوحة' : 'انرسلت اللوحة');
          })}>إرسال اللوحة</Button>
          <Button variant="secondary" onClick={action(async () => { if (!requests) return toast('اختر روم الطلبات أول.', 'warning'); await api(`/api/requests/${kind}/channel`, { method: 'POST', body: { channelId: requests } }); toast('انحفظ روم الطلبات'); })}>حفظ روم الطلبات فقط</Button>
        </div>
        <div class="maint-row"><div><b>إعادة إرسال الطلبات المنتظرة</b><small>يرسل كل طلب منتظر لروم الطلبات من جديد ويحذف البطاقة القديمة.</small></div><Button variant="secondary" icon="refresh-arrow-01" onClick={action(async () => { const r = await api(`/api/requests/${kind}/resend-pending`, { method: 'POST', body: {} }); toast(r.pending ? `انرسل ${r.sent} من ${r.pending}${r.failed ? ` (فشل ${r.failed})` : ''}` : 'ما فيه طلبات منتظرة'); ctx.refresh(); })}>إعادة إرسال {num(pending)}</Button></div>
        <div class="maint-row danger"><div><b>حذف الطلبات المنتهية</b><small>يحذف نهائيًا الطلبات {meta.closed}. المنتظرة والشغّالة ما تنلمس.</small>
          <Select class="input-sm" value={age} options={[{ value: '0', label: 'كل المنتهية' }, { value: '30', label: 'أقدم من 30 يوم' }, { value: '90', label: 'أقدم من 90 يوم' }, { value: '365', label: 'أقدم من سنة' }]} onChange={(e: Event) => { age = (e.currentTarget as HTMLSelectElement).value; void refreshCount(); }} />{closed.node}</div>
          <Button variant="danger-soft" icon="trash" onClick={action(async () => {
            const preview = await api(`/api/requests/${kind}/closed-count?olderThanDays=${age}`);
            if (!preview.closed) return toast('ما فيه طلبات منتهية للحذف.', 'info');
            if (!await confirmDialog({ title: `حذف ${count(preview.closed, ['طلب منتهي', 'طلبين منتهيين', 'طلبات منتهية', 'طلب منتهي'])}؟`, message: 'تنحذف نهائيًا وما ترجع.', confirmText: 'حذف' })) return;
            const r = await api(`/api/requests/${kind}/clear-closed`, { method: 'POST', body: { confirm: true, olderThanDays: Number(age) } });
            toast(`انحذف ${num(r.removed)}`); ctx.refresh();
          })}>حذف المنتهية</Button></div>
      </div>
    </Card>
  );
}
