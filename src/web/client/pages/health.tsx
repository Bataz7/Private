// صحة النظام: حالة البوت وقاعدة البيانات واللوحة، وقت التشغيل، زمن الاستجابة الحي، الصيانة المجدولة.
import type { Child } from '#jsx/jsx-runtime';
import { mount } from '#jsx/jsx-runtime';
import { api, errorText } from '../lib/api';
import { actionText } from '../lib/actions';
import { live } from '../lib/dom';
import { ago, dateTime, dayUTC, num, span } from '../lib/format';
import type { PageCtx } from '../shell/types';
import type { RouteKey } from '../shell/routes';
import { BarChart } from '../ui/chart';
import { Icon } from '../ui/Icon';
import { Badge, Button, Card, Empty, ErrorState, Field, Kpi, PageHeader, PageSkeleton, busy, type Tone } from '../ui/kit';
import { confirmDialog, toast, toastError } from '../ui/overlay';

const WATCHDOGS: Array<[string, string, number]> = [['shifts', 'مراقب الشفتات', 60], ['roles', 'مزامنة الرتب', 300], ['weekly', 'التقارير الأسبوعية', 900]];
type Check = { name: string; icon: string; state: 'ok' | 'warn' | 'bad'; detail: string };
const TONE: Record<Check['state'], Tone> = { ok: 'success', warn: 'warning', bad: 'danger' };
const LABEL: Record<Check['state'], string> = { ok: 'شغّال', warn: 'متأثر', bad: 'متوقف' };

function checks(data: any): Check[] {
  const now = data.now;
  const beat = data.bot;
  const age = beat ? now - new Date(beat.updatedAt).getTime() : Infinity;
  const online = beat && age < 120_000;
  const list: Check[] = [];
  if (!beat) list.push({ name: 'عملية البوت', icon: 'cpu', state: 'bad', detail: 'ما فيه نبض مسجّل بعد. شغّل البوت.' });
  else if (age > 120_000) list.push({ name: 'عملية البوت', icon: 'cpu', state: 'bad', detail: `متوقف. آخر نبض ${ago(now - age)}.` });
  else if (age > 45_000) list.push({ name: 'عملية البوت', icon: 'cpu', state: 'warn', detail: `النبض متأخر. آخر مرة ${ago(now - age)}.` });
  else list.push({ name: 'عملية البوت', icon: 'cpu', state: 'ok', detail: `شغّال من ${span((new Date(beat.updatedAt).getTime() - new Date(beat.startedAt).getTime()) / 1000)} · ${beat.nodeVersion ?? ''}` });
  list.push(online ? { name: 'اتصال ديسكورد', icon: 'global', state: beat.pingMs > 400 ? 'warn' : 'ok', detail: `${beat.pingMs} ms · ${num(beat.guilds)} سيرفر` } : { name: 'اتصال ديسكورد', icon: 'global', state: 'bad', detail: 'غير معروف والبوت متوقف.' });
  list.push({ name: 'قاعدة البيانات', icon: 'category', state: !data.database.connected ? 'bad' : data.database.latencyMs > 300 ? 'warn' : 'ok', detail: data.database.connected ? `متصلة، الاستعلام ${data.database.latencyMs} ms` : 'الاتصال مقطوع' });
  list.push({ name: 'اللوحة', icon: 'monitor', state: data.dashboard.gatewayReady ? 'ok' : 'warn', detail: `شغّالة من ${span(data.dashboard.uptimeSec)} · ${data.dashboard.memoryMb} MB` });
  for (const [key, label, every] of WATCHDOGS) {
    const last = beat?.watchdogs?.[key];
    if (!last) list.push({ name: label, icon: 'timer-start', state: online ? 'warn' : 'bad', detail: online ? `ما كمل أول تشغيل، المفروض كل ${span(every)}.` : 'متوقف.' });
    else { const a = now - last; list.push({ name: label, icon: 'timer-start', state: a > every * 2500 ? 'bad' : a > every * 1500 ? 'warn' : 'ok', detail: `آخر تشغيل ${ago(now - a)}، كل ${span(every)}` }); }
  }
  return list;
}

export default async function health(ctx: PageCtx) {
  mount(ctx.root, <PageSkeleton />);
  let data: any;
  try { data = await api('/api/health', { signal: ctx.signal }); } catch (error) { mount(ctx.root, <ErrorState message={errorText(error)} onRetry={ctx.refresh} />); return; }
  const pings: number[] = data.bot ? [data.bot.pingMs] : [];
  const tone = (pct: number | null) => (pct === null || pct === undefined ? 'none' : pct >= 99.9 ? 'up' : pct >= 95 ? 'part' : 'down');
  const pctText = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v.toFixed(v === 100 ? 0 : 2)}%`);

  const live_ = live(() => {
    const list = checks(data);
    const bad = list.filter(item => item.state === 'bad');
    const warn = list.filter(item => item.state === 'warn');
    const sum: [Check['state'], string] = list[0]!.state === 'bad' ? ['bad', 'البوت متوقف'] : bad.length ? ['bad', `${bad.map(i => i.name).join('، ')} متوقف`] : warn.length ? ['warn', `${warn.map(i => i.name).join('، ')} متأثر`] : ['ok', 'كل الأنظمة شغالة'];
    const beat = data.bot;
    const online = beat && data.now - new Date(beat.updatedAt).getTime() < 120_000;
    const q = data.queue ?? {};
    const u = data.uptime;
    const go = (key: RouteKey) => () => ctx.navigate(key);
    return [
      <div class={`health-summary h-${sum[0]}`}><span class="hs-icon"><Icon name={sum[0] === 'ok' ? 'tick-circle' : sum[0] === 'warn' ? 'warning-2' : 'close-circle'} size={28} bold /></span><div><b>{sum[1]}</b><small>تحدّث {ago(data.now)} · يتحدث كل 5 ثواني</small></div></div>,
      <div class="kpi-grid">
        <Kpi icon="timer-start" label="تشغيل البوت" value={online ? span((new Date(beat.updatedAt).getTime() - new Date(beat.startedAt).getTime()) / 1000) : 'متوقف'} hint={online ? `من ${dateTime(beat.startedAt)}` : 'ما فيه نبض'} tone={online ? 'success' : 'danger'} />
        <Kpi icon="flash" label="زمن ديسكورد" value={online ? `${beat.pingMs} ms` : '—'} tone="info" />
        <Kpi icon="category" label="قاعدة البيانات" value={data.database.connected ? `${data.database.latencyMs} ms` : 'متوقفة'} tone={data.database.connected ? 'brand' : 'danger'} />
        <Kpi icon="cpu" label="ذاكرة البوت" value={online ? `${beat.memoryMb} MB` : '—'} tone="warning" />
      </div>,
      u && (u.days ?? []).length ? <Card title="وقت التشغيل" subtitle="يتسجل تلقائيًا من نبض البوت" icon="activity" actions={<div class="ut-figures"><span><b>{pctText(u.uptime24h)}</b>24 ساعة</span><span><b>{pctText(u.uptime30)}</b>30 يوم</span></div>}>
        <div class="ut-label"><span>آخر 30 يوم</span><span>{num(u.days.filter((d: any) => d.pct !== null && d.pct < 100).length)} يوم فيه توقف</span></div>
        <div class="sp-bars ut-bars" dir="ltr">{u.days.map((d: any) => <i class={`t-${tone(d.pct)}`} title={`${dayUTC(`${d.date}T00:00:00Z`)}: ${d.pct === null ? 'ما فيه بيانات' : pctText(d.pct)}`} />)}</div>
        {(u.halfHours ?? []).length ? [<div class="ut-label mt-sm"><span>آخر 24 ساعة</span><span>كل نص ساعة</span></div>, <div class="sp-bars ut-bars thin" dir="ltr">{u.halfHours.map((d: any) => <i class={`t-${tone(d.pct)}`} title={`${dateTime(d.start)}: ${pctText(d.pct)}`} />)}</div>] : null}
        <div class="sp-legend"><span><i class="t-up" />شغّال</span><span><i class="t-part" />جزئي</span><span><i class="t-down" />متوقف أغلب الوقت</span><span><i class="t-none" />بدون مراقبة</span></div>
        <h4 class="sub-title">إعادة التشغيل والتوقفات</h4>
        {(u.incidents ?? []).length ? <div class="stack">{u.incidents.map((item: any) => <div class="mini-card row"><Icon name={item.kind === 'downtime' ? 'close-circle' : 'refresh-arrow-01'} size={18} /><div class="row-main"><b>{item.ongoing ? 'البوت متوقف' : item.kind === 'downtime' ? 'توقف' : 'إعادة تشغيل'}</b><small dir="auto">{item.note}{item.kind === 'downtime' ? ` · ${span(((item.endedAt ? new Date(item.endedAt).getTime() : data.now) - new Date(item.startedAt).getTime()) / 1000)}` : ''}</small></div><small class="muted">{ago(item.startedAt)}</small></div>)}</div> : <p class="muted">ما فيه توقفات مسجّلة.</p>}
      </Card> : null,
      <div class="grid-main mt">
        <Card title="الخدمات" subtitle={`${list.filter(i => i.state === 'ok').length} من ${list.length} سليمة`} icon="shield-tick" flush>
          <div class="divided">{list.map(item => <div class="line-item"><span class={`q-icon tone-${TONE[item.state]}`}><Icon name={item.icon} size={18} /></span><div class="row-main"><b>{item.name}</b><small>{item.detail}</small></div><Badge tone={TONE[item.state]} dot>{LABEL[item.state]}</Badge></div>)}</div>
        </Card>
        <div class="gap-section">
          <Card title="زمن ديسكورد" subtitle="عينات حية" icon="flash">{pings.length > 1 ? <BarChart height={150} label="زمن الاستجابة" data={pings.map((v, i) => ({ label: String(i + 1), value: v, tip: `عينة ${i + 1}` }))} format={v => `${Math.round(v)} ms`} axisFormat={v => `${Math.round(v)}`} every={10} /> : <p class="muted">نجمع العينات…</p>}</Card>
          <Card title="الشغل المفتوح" icon="clipboard-text" flush>
            <div class="divided">{([['الستاف النشطين', q.staff, 'staff'], ['الشفتات الحية', beat?.activeShifts ?? 0, 'shifts'], ['شكاوى معلقة', q.pendingComplaints, 'complaints'], ['إجازات معلقة', q.pendingLeaves, 'leaves'], ['استقالات معلقة', q.pendingResignations, 'resignations']] as Array<[string, number, RouteKey]>).map(([label, value, key]) => <button type="button" class="line-item is-link" onClick={go(key)}><span class="row-main">{label}</span><b class="num">{num(value)}</b><Icon name="arrow-right-01" size={16} flip /></button>)}</div>
          </Card>
        </div>
      </div>,
      (data.logs ?? []).length ? <Card title="آخر النشاط" icon="note-text" class="mt" flush><ol class="timeline">{data.logs.map((log: any) => <li><span class="tl-icon"><Icon name="activity" size={15} /></span><div class="tl-body"><b>{log.name || log.userId}</b> <span>{actionText(log.action)}</span></div><time>{ago(log.createdAt)}</time></li>)}</ol></Card> : null,
    ];
  });

  const maint = live(() => <p class="muted">جار التحميل…</p>);
  const loadMaint = async () => {
    try {
      const status = await api('/api/status');
      const rows = [...(status.maintenances?.ongoing ?? []), ...(status.maintenances?.upcoming ?? []), ...(status.maintenances?.completed ?? []).slice(0, 5)];
      const label: Record<string, [string, Tone]> = { in_progress: ['جارية', 'warning'], scheduled: ['مجدولة', 'info'], completed: ['انتهت', 'muted'] };
      if (maint.el) mount(maint.el, rows.length ? <div class="stack">{rows.map((item: any) => (
        <div class="mini-card row"><div class="row-main"><b dir="auto">{item.title}</b><small>{dateTime(item.startsAt)} ← {dateTime(item.endsAt)}{item.affects?.length ? ` · ${item.affects.join('، ')}` : ''}</small></div><Badge tone={label[item.status]?.[1] ?? 'muted'}>{label[item.status]?.[0] ?? item.status}</Badge>
          {item.status !== 'completed' ? <Button size="sm" variant="secondary" onClick={async (e: Event) => busy(e.currentTarget as HTMLButtonElement, async () => { try { await api(`/api/maintenances/${encodeURIComponent(item.id)}/end`, { method: 'POST' }); toast('تحدثت الصيانة'); void loadMaint(); } catch (error) { toastError(error); } })}>{item.status === 'in_progress' ? 'إنهاء الحين' : 'إلغاء'}</Button> : null}
          <Button size="sm" variant="ghost" icon="trash" aria-label="حذف" onClick={async () => { if (!await confirmDialog({ title: 'حذف الصيانة؟', confirmText: 'حذف' })) return; try { await api(`/api/maintenances/${encodeURIComponent(item.id)}`, { method: 'DELETE' }); void loadMaint(); } catch (error) { toastError(error); } }} />
        </div>
      ))}</div> : <Empty compact icon="setting-2" title="ما فيه صيانة مجدولة" />);
    } catch { if (maint.el) mount(maint.el, <p class="muted">ما قدرنا نحمّل الصيانة.</p>); }
  };
  const local = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

  mount(ctx.root, [
    <PageHeader title="صحة النظام" subtitle="الحالة الحية للبوت وقاعدة البيانات واللوحة." actions={[<Button icon="global" href="/status" external>صفحة الحالة العامة</Button>, <Button icon="refresh-arrow-01" onClick={ctx.refresh}>تحديث</Button>]} />,
    live_.node,
    <Card title="الصيانة" subtitle="أعمال مجدولة تظهر في صفحة الحالة العامة، والخدمات المتأثرة تنعرض «تحت الصيانة» وقتها." icon="setting-2" class="mt">
      <form class="form-grid" onSubmit={async (event: Event) => {
        event.preventDefault();
        const form = event.currentTarget as HTMLFormElement;
        const data_ = new FormData(form);
        await busy(form.querySelector<HTMLButtonElement>('button[type=submit]'), async () => {
          try {
            await api('/api/maintenances', { method: 'POST', body: { title: data_.get('title'), description: data_.get('description'), startsAt: new Date(String(data_.get('startsAt'))).toISOString(), endsAt: new Date(String(data_.get('endsAt'))).toISOString(), affects: data_.getAll('affects') } });
            toast('انجدولت الصيانة'); form.reset(); void loadMaint();
          } catch (error) { toastError(error); }
        });
      }}>
        <Field label="العنوان" full><input class="input" name="title" maxlength="90" required placeholder="نقل الاستضافة" dir="auto" /></Field>
        <Field label="الوصف" optional full><textarea class="input" name="description" rows="2" maxlength="600" dir="auto" placeholder="وش بيتغير ووش ممكن يلاحظ الأعضاء" /></Field>
        <Field label="تبدأ"><input class="input" type="datetime-local" name="startsAt" required value={local(new Date(Date.now() + 15 * 60_000))} /></Field>
        <Field label="تنتهي"><input class="input" type="datetime-local" name="endsAt" required value={local(new Date(Date.now() + 75 * 60_000))} /></Field>
        <Field label="تأثر على" full as="div"><div class="check-group">{[['bot', 'بوت ديسكورد'], ['jobs', 'المهام التلقائية'], ['database', 'قاعدة البيانات'], ['dashboard', 'اللوحة']].map(([key, label]) => <label class="check"><input type="checkbox" name="affects" value={key} /> {label}</label>)}</div></Field>
        <div class="form-actions full"><Button type="submit" variant="primary" icon="add">جدولة الصيانة</Button></div>
      </form>
      <h4 class="sub-title">المجدولة والأخيرة</h4>
      {maint.node}
    </Card> as Child,
  ]);
  void loadMaint();
  const timer = setInterval(async () => {
    if (document.hidden) return;
    try {
      data = await api('/api/health', { signal: ctx.signal });
      if (data.bot && data.now - new Date(data.bot.updatedAt).getTime() < 120_000) { pings.push(data.bot.pingMs); if (pings.length > 40) pings.shift(); }
      live_.update();
    } catch { /* نحتفظ بآخر عرض */ }
  }, 5000);
  ctx.onCleanup(() => clearInterval(timer));
}
