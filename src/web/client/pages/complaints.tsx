// الشكاوى: مراجعة الشكاوى المعلقة (اعتماد بخصم نقاط أو رفض مع ملاحظة) وسجل كل الشكاوى.
import { mount } from '#jsx/jsx-runtime';
import { api, errorText } from '../lib/api';
import { ago, dateTime, num } from '../lib/format';
import type { PageCtx } from '../shell/types';
import { Avatar, Badge, Button, ErrorState, Field, Kpi, PageHeader, PageSkeleton, Empty, ChannelSelect, Card, busy, type Tone } from '../ui/kit';
import { createList } from '../ui/list';
import { openModal, toast, toastError } from '../ui/overlay';
import { safeUrl } from '../lib/dom';
import { nameOf } from './staff-actions';

const STATUS: Record<string, [string, Tone]> = { pending: ['بانتظار المراجعة', 'warning'], approved: ['معتمدة', 'danger'], rejected: ['مرفوضة', 'muted'] };

export default async function complaints(ctx: PageCtx) {
  mount(ctx.root, <PageSkeleton />);
  let data: any;
  try { data = await ctx.shared('bootstrap', () => api('/api/bootstrap')); } catch (error) { mount(ctx.root, <ErrorState message={errorText(error)} onRetry={ctx.refresh} />); return; }
  const reload = () => { ctx.invalidate('bootstrap'); ctx.refresh(); };
  const byId = new Map((data.staff ?? []).map((member: any) => [member.userId, member]));
  const rows: any[] = [...(data.complaints ?? [])].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  const count = (status: string) => rows.filter(row => row.status === status).length;

  const decide = (row: any, status: 'approved' | 'rejected') => openModal({
    title: status === 'approved' ? 'اعتماد الشكوى' : 'رفض الشكوى',
    description: `على ${nameOf(byId.get(row.staffUserId) as any, row.staffUserId)} — يوصله القرار في الخاص.`,
    icon: status === 'approved' ? 'danger' : 'close-circle',
    tone: status === 'approved' ? 'danger' : 'brand',
    body: close => (
      <form class="form-stack" id="decideForm" onSubmit={async (event: Event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget as HTMLFormElement);
        await busy((event.currentTarget as HTMLElement).closest('.ov-panel')?.querySelector<HTMLButtonElement>('[data-submit]'), async () => {
          try { await api(`/api/complaints/${encodeURIComponent(row.id)}`, { method: 'PATCH', body: { status, penaltyPoints: Number(form.get('penalty') || 0), note: form.get('note') } }); close(); toast('انحفظ القرار'); reload(); }
          catch (error) { toastError(error); }
        });
      }}>
        {status === 'approved' ? <Field label="نقاط العقوبة" hint="تنخصم من نقاط العضو."><input class="input" name="penalty" type="number" min="0" max="1000" value={String(row.penaltyPoints ?? 5)} autofocus /></Field> : null}
        <Field label="ملاحظة للعضو" optional><textarea class="input" name="note" rows="3" maxlength="1500" dir="auto" /></Field>
      </form>
    ),
    footer: close => [<Button variant="ghost" onClick={close}>إلغاء</Button>, <Button variant={status === 'approved' ? 'danger' : 'primary'} data-submit onClick={() => (document.getElementById('decideForm') as HTMLFormElement).requestSubmit()}>{status === 'approved' ? 'اعتماد' : 'رفض'}</Button>],
  });

  const list = createList<any>({
    rows,
    search: row => `${nameOf(byId.get(row.staffUserId) as any, row.staffUserId)} ${row.reason} ${row.id}`,
    searchPlaceholder: 'ابحث بالاسم أو السبب…',
    segment: { label: 'الحالة', value: 'pending', options: [{ value: 'pending', label: 'بالانتظار', count: count('pending') }, { value: 'approved', label: 'معتمدة' }, { value: 'rejected', label: 'مرفوضة' }, { value: '', label: 'الكل' }], test: (row, value) => row.status === value },
    date: row => +new Date(row.createdAt),
    csv: { name: 'complaints', header: ['على', 'السبب', 'الدليل', 'الحالة', 'التاريخ'], row: row => [nameOf(byId.get(row.staffUserId) as any, row.staffUserId), row.reason, row.evidence, STATUS[row.status]?.[0], row.createdAt] },
    render: row => {
      const member: any = byId.get(row.staffUserId);
      const reporter: any = byId.get(row.reporterUserId);
      const [label, tone] = STATUS[row.status] ?? [row.status, 'muted' as Tone];
      const evidence = safeUrl(row.evidence);
      return (
        <article class="req-card">
          <header><Avatar src={member?.avatar} name={nameOf(member, row.staffUserId)} size={38} /><div class="row-main"><b>شكوى على {nameOf(member, row.staffUserId)}</b><small>من {nameOf(reporter, row.reporterUserId)} · {ago(row.createdAt)}</small></div><Badge tone={tone} dot>{label}</Badge></header>
          <p class="req-reason" dir="auto">{row.reason}</p>
          {row.evidence ? <div class="req-evidence"><b>الدليل:</b> {evidence ? <a href={evidence} target="_blank" rel="noopener noreferrer">{row.evidence}</a> : <span dir="auto">{row.evidence}</span>}</div> : null}
          {row.status !== 'pending' && row.reviewedBy ? <div class="req-decision"><b>{label} بواسطة {nameOf(byId.get(row.reviewedBy) as any, row.reviewedBy)}</b> · {dateTime(row.reviewedAt)}{row.penaltyPoints ? ` · خصم ${num(row.penaltyPoints)} نقطة` : ''}{row.decisionNote ? <p dir="auto">{row.decisionNote}</p> : null}</div> : null}
          {row.status === 'pending' && ctx.admin ? <div class="req-actions"><Button variant="danger" size="sm" icon="tick-circle" onClick={() => decide(row, 'approved')}>اعتماد وخصم</Button><Button variant="secondary" size="sm" icon="close-circle" onClick={() => decide(row, 'rejected')}>رفض</Button></div> : null}
        </article>
      );
    },
    empty: <Empty icon="tick-circle" title="ما فيه شكاوى" text="الشكاوى اللي يرفعها الأعضاء من لوحة الشكاوى تطلع هنا." />,
    noMatch: <Empty compact icon="tick-circle" title="ما فيه شكاوى بهذا الفلتر" />,
  });

  let panelChannel = '';
  mount(ctx.root, [
    <PageHeader title="الشكاوى" subtitle="راجع الشكاوى واتخذ القرار. الشكوى المعتمدة تخصم نقاط عقوبة من العضو." actions={<Button icon="refresh-arrow-01" onClick={reload}>تحديث</Button>} />,
    <div class="kpi-grid compact">
      <Kpi icon="clock" tone="warning" label="بالانتظار" value={num(count('pending'))} />
      <Kpi icon="danger" tone="danger" label="معتمدة" value={num(count('approved'))} />
      <Kpi icon="close-circle" label="مرفوضة" value={num(count('rejected'))} />
      <Kpi icon="document-text" tone="info" label="الإجمالي" value={num(rows.length)} />
    </div>,
    list.node,
    ctx.admin ? <Card title="لوحة الشكاوى" subtitle="انشر لوحة رسمية وحدة؛ النسخ المكررة في نفس الروم تنمسح تلقائيًا." icon="send-2" class="mt">
      <div class="inline-fields"><div class="field" ref={(el: HTMLElement) => void api('/api/panel/options').then(r => mount(el, <ChannelSelect channels={r.channels ?? []} onChange={(e: Event) => { panelChannel = (e.currentTarget as HTMLSelectElement).value; }} />)).catch(() => undefined)} /><Button variant="primary" icon="send-2" onClick={(event: Event) => void busy(event.currentTarget as HTMLButtonElement, async () => {
        if (!panelChannel) return toast('اختر الروم أول.', 'warning');
        try { const result = await api('/api/complaints/panel', { method: 'POST', body: { channelId: panelChannel } }); toast(result.removedDuplicates ? `تحدثت اللوحة وانحذفت ${result.removedDuplicates} نسخ مكررة` : result.updated ? 'تحدثت لوحة الشكاوى' : 'انرسلت لوحة الشكاوى'); } catch (error) { toastError(error); }
      })}>نشر اللوحة</Button></div>
    </Card> : null,
  ]);
}
