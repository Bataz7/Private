// النقاط: نقاطك ومن وين جت، طريقة الاحتساب، الترتيب (الكل / هذا الأسبوع)، وللإدارة: إضافة أو خصم نقاط بسبب.
import type { Child } from '#jsx/jsx-runtime';
import { mount } from '#jsx/jsx-runtime';
import { api, errorText } from '../lib/api';
import { live } from '../lib/dom';
import { ago, count, num, signed } from '../lib/format';
import type { PageCtx } from '../shell/types';
import { Icon } from '../ui/Icon';
import { Avatar, Badge, Button, Card, Empty, ErrorState, Field, PageHeader, PageSkeleton, Seg, Select, busy } from '../ui/kit';
import { toast, toastError } from '../ui/overlay';

const PARTS: Record<string, [string, string]> = {
  shift: ['وقت الشفت', 'clock'], messages: ['الرسائل في الشفت', 'message-text'], voice: ['الفويس في الشفت', 'activity'], assist: ['مساعدة الأعضاء', 'people'],
  rating: ['التقييمات', 'star'], modreport: ['تقارير المود', 'shield-tick'], complaint: ['الشكاوى', 'danger'], manual: ['تعديلات يدوية ونقاط قديمة', 'edit-2'],
};
const COUNTS: Record<string, [string, string, string, string]> = { shift: ['شفت', 'شفتين', 'شفتات', 'شفت'], assist: ['مرة', 'مرتين', 'مرات', 'مرة'], rating: ['تقييم', 'تقييمين', 'تقييمات', 'تقييم'], modreport: ['تقرير', 'تقريرين', 'تقارير', 'تقرير'], complaint: ['شكوى', 'شكويين', 'شكاوى', 'شكوى'] };

export function Breakdown({ data, who }: { data: any; who?: string }): Child {
  if (!data) return <Empty compact icon="medal-star" title="مو في قائمة الستاف" text="ما عندك نقاط لأنك مو مسجّل في الستاف." />;
  const parts = (data.parts ?? []).filter((part: any) => part.points !== 0 || part.count);
  const max = Math.max(1, ...parts.map((part: any) => Math.abs(part.points)));
  return [
    <div class="pt-total"><b class="num">{num(data.total)}</b><span>{who ? `نقاط ${who}` : 'المجموع'}</span></div>,
    parts.length ? <ul class="parts">{parts.map((part: any) => {
      const [label, icon] = PARTS[part.key] ?? [part.key, 'star'];
      return <li class={part.points < 0 ? 'neg' : ''}><span class="part-ico"><Icon name={icon} size={16} /></span><span class="part-label">{label}{part.count && COUNTS[part.key] ? <small class="muted"> · {count(part.count, COUNTS[part.key]!)}</small> : null}</span><span class="part-bar"><i style={{ width: `${Math.round((Math.abs(part.points) / max) * 100)}%` }} /></span><b class="num">{signed(part.points)}</b></li>;
    })}</ul> : <p class="muted">—</p>,
  ];
}

export default async function points(ctx: PageCtx) {
  mount(ctx.root, <PageSkeleton cards={0} />);
  let data: any;
  try { data = await api('/api/points', { signal: ctx.signal }); } catch (error) { mount(ctx.root, <ErrorState message={errorText(error)} onRetry={ctx.refresh} />); return; }
  const me = ctx.user.id;
  const weekly = (data.leaderboard ?? []).some((row: any) => typeof row.weekPoints === 'number');
  let range: 'all' | 'week' = 'all';
  let viewing: { name: string; breakdown: any } | null = null;

  const mine = live(() => <Breakdown data={viewing ? viewing.breakdown : data.me} who={viewing?.name} />);
  const backBtn = live(() => (viewing ? <Button size="sm" variant="ghost" icon="arrow-right-01" onClick={() => { viewing = null; mine.update(); backBtn.update(); }}>نقاطي</Button> : null), { class: 'contents' }, 'span');
  const show = async (row: any) => {
    if (!data.admin) return;
    if (row.userId === me) { viewing = null; mine.update(); backBtn.update(); return; }
    try { const result = await api(`/api/points/${encodeURIComponent(row.userId)}`); viewing = { name: row.displayName, breakdown: result.breakdown }; mine.update(); backBtn.update(); document.querySelector('.pt-mine')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
    catch (error) { toastError(error); }
  };
  const board = live(() => {
    const rows = [...(data.leaderboard ?? [])];
    if (range === 'week') rows.sort((a, b) => (b.weekPoints ?? 0) - (a.weekPoints ?? 0));
    return rows.length ? <ol class="leaderboard">{rows.map((row: any, index: number) => (
      <li><button type="button" class={`lb-row ${row.userId === me ? 'is-me' : ''}`} disabled={!data.admin} onClick={() => void show(row)}>
        <span class={`lb-place p${index + 1}`}>{index < 3 ? <Icon name="medal-star" size={18} bold /> : index + 1}</span>
        <Avatar src={row.avatar} name={row.displayName} size={32} />
        <span class="row-main"><b>{row.displayName}</b><small>{row.userId === me ? 'أنت' : row.rank || ''}</small></span>
        <b class="num">{num(range === 'week' ? row.weekPoints ?? 0 : row.points)}</b>
      </button></li>
    ))}</ol> : <Empty compact icon="crown" title="ما فيه ستاف بعد" />;
  });

  let sign = 1;
  const adjust = data.admin ? (
    <Card title="إضافة أو خصم نقاط" subtitle="التعديل ينحفظ في السجل مع السبب، والعضو يشوف السبب." icon="edit-2">
      <form class="form-stack" onSubmit={async (event: Event) => {
        event.preventDefault();
        const form = event.currentTarget as HTMLFormElement;
        const values = Object.fromEntries(new FormData(form));
        await busy(form.querySelector<HTMLButtonElement>('button[type=submit]'), async () => {
          try {
            const result = await api('/api/points/adjust', { method: 'POST', body: { userId: values.userId, delta: sign * Math.abs(Number(values.amount) || 0), reason: values.reason, notify: values.notify === 'on' } });
            toast(`${num(result.before)} ← ${num(result.after)}${values.notify === 'on' ? (result.dmSent ? ' · وصله في الخاص' : ' · الخاص مقفل') : ''}`);
            ctx.refresh();
          } catch (error) { toastError(error); }
        });
      }}>
        <Field label="عضو الستاف"><Select name="userId" required placeholder="اختر…" options={(data.leaderboard ?? []).filter((row: any) => row.userId !== me).map((row: any) => ({ value: row.userId, label: `${row.displayName} · ${num(row.points)}` }))} /></Field>
        <div class="inline-fields">
          <Field label="النوع" as="div"><Seg value="1" label="إضافة أو خصم" options={[{ value: '1', label: 'إضافة', icon: 'add' }, { value: '-1', label: 'خصم', icon: 'minus-circle' }]} onChange={value => { sign = Number(value); }} /></Field>
          <Field label="العدد" class="small"><input class="input" name="amount" type="number" min="1" max="1000" value="1" required /></Field>
        </div>
        <Field label="السبب" hint="عضو الستاف يشوف السبب."><input class="input" name="reason" maxlength="300" minlength="3" required dir="auto" placeholder="مثلاً: مساعدة ممتازة في الفعالية" /></Field>
        <label class="check"><input type="checkbox" name="notify" checked /> أرسل له في الخاص</label>
        <Button type="submit" variant="primary" icon="tick-circle" block>حفظ</Button>
      </form>
      <h4 class="sub-title">آخر تغييرات النقاط</h4>
      {(data.recent ?? []).length ? <div class="divided bordered">{data.recent.map((item: any) => (
        <div class="line-item"><b class={`num delta ${item.delta < 0 ? 'neg' : 'pos'}`}>{signed(item.delta)}</b><div class="row-main"><b>{item.name}</b><small dir="auto">{PARTS[item.source]?.[0] ?? item.source}{item.reason ? ` · ${item.reason}` : ''}</small></div><small class="muted nowrap">{item.by ? `${item.by} · ` : ''}{ago(item.at)}</small></div>
      ))}</div> : <p class="muted">ما فيه تغييرات بعد.</p>}
    </Card>
  ) : null;

  mount(ctx.root, [
    <PageHeader title="النقاط والترتيب" subtitle="كم نقطة عندك، ومن وين جات، وكيف تجمع أكثر." />,
    <div class="grid-2 align-start">
      <div class="gap-section">
        <Card title={viewing ? 'نقاط العضو' : 'نقاطك'} icon="medal-star" class="pt-mine" actions={backBtn.node}>
          {mine.node}
          {data.admin ? <p class="field-hint mt-sm">اضغط على أي عضو في الترتيب عشان تشوف من وين جت نقاطه.</p> : null}
        </Card>
        <Card title="كيف تجمع نقاط" icon="info-circle">
          <ul class="rules">{(data.rules ?? []).map((rule: any) => <li><Badge tone={String(rule.points).startsWith('−') || rule.points === '−' ? 'danger' : rule.points === '±' ? 'warning' : 'success'}>{rule.points}</Badge><span>{rule.ar || rule.en}</span></li>)}</ul>
        </Card>
      </div>
      <div class="gap-section">
        <Card title="الترتيب" icon="crown" flush actions={weekly ? <Seg size="sm" label="الفترة" value={range} options={[{ value: 'all', label: 'الكل' }, { value: 'week', label: 'هذا الأسبوع' }]} onChange={value => { range = value as typeof range; board.update(); }} /> : <Badge>{num((data.leaderboard ?? []).length)}</Badge>}>{board.node}</Card>
        {adjust}
      </div>
    </div>,
  ]);
}
