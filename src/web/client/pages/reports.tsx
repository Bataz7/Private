// التقارير: التقارير الأسبوعية التلقائية (الإعدادات)، إرسال تقارير لأي فترة، وسجل التقارير.
import type { Child } from '#jsx/jsx-runtime';
import { mount } from '#jsx/jsx-runtime';
import { api, errorText } from '../lib/api';
import { live } from '../lib/dom';
import { count, dayUTC, fixed, num } from '../lib/format';
import type { PageCtx } from '../shell/types';
import { Avatar, Badge, Button, Card, ChannelSelect, Empty, ErrorState, Field, Notice, PageHeader, Progress, Seg, Select, Skeleton, Toggle, busy } from '../ui/kit';
import { confirmDialog, promptDialog, toast, toastError } from '../ui/overlay';

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const nameOf = (p: any) => p.displayName || p.username || p.userId;

function periods() {
  const today = Math.floor(Date.now() / DAY) * DAY;
  const monday = today - ((new Date(today).getUTCDay() + 6) % 7) * DAY;
  return { lastWeek: ['الأسبوع الماضي', monday - 7 * DAY, monday - DAY], thisWeek: ['هذا الأسبوع لين الحين', monday, today], last7: ['آخر 7 أيام', today - 6 * DAY, today], last30: ['آخر 30 يوم', today - 29 * DAY, today] } as Record<string, [string, number, number]>;
}

/** اختيار عدة ستاف مع بحث وتحديد الكل. */
function picker(staff: any[], selected: Set<string>, onChange: () => void) {
  let q = '';
  const list = live(() => (
    <div class="pk-list">{staff.filter(m => !q || nameOf(m).toLowerCase().includes(q)).map(member => (
      <label class="pk-item"><input type="checkbox" checked={selected.has(member.userId)} onChange={(e: Event) => { if ((e.currentTarget as HTMLInputElement).checked) selected.add(member.userId); else selected.delete(member.userId); counter.update(); onChange(); }} /><Avatar src={member.avatar} name={nameOf(member)} size={26} /><span class="who-text"><b>{nameOf(member)}</b><small>@{member.username}</small></span></label>
    ))}{staff.length ? null : <p class="muted">ما فيه ستاف نشطين.</p>}</div>
  ));
  const counter = live(() => `${num(selected.size)} محدد`, { class: 'list-count' }, 'output');
  return (
    <div class="picker">
      <div class="pk-bar"><input class="input input-sm" type="search" placeholder="ابحث عن عضو…" onInput={(e: Event) => { q = (e.currentTarget as HTMLInputElement).value.trim().toLowerCase(); list.update(); }} />
        <Button size="sm" variant="ghost" onClick={() => { staff.filter(m => !q || nameOf(m).toLowerCase().includes(q)).forEach(m => selected.add(m.userId)); list.update(); counter.update(); onChange(); }}>تحديد الكل</Button>
        <Button size="sm" variant="ghost" onClick={() => { selected.clear(); list.update(); counter.update(); onChange(); }}>مسح</Button>{counter.node}</div>
      {list.node}
    </div>
  );
}

function reportCard(report: any, admin: boolean, reload: () => void): Child {
  const score = typeof report.score === 'number' ? report.score : null;
  const metrics: Array<[string, string]> = [[`${fixed(report.shiftHours)}س`, 'شفت'], [`${fixed(report.voiceHours)}س`, 'فويس'], [`${Math.round(report.engagement || 0)}%`, 'تفاعل'], [num(report.messageCount), 'رسائل'], [num(report.activeDays), 'أيام نشاط'], [report.ratingAverage ? `${fixed(report.ratingAverage)}/5` : '—', 'تقييم'], [num(report.complaints), 'شكاوى'], [num(report.points), 'نقاط']];
  return (
    <article class="report-card">
      <header><Avatar src={report.avatar} name={report.displayName || report.staffUserId} size={40} /><div class="row-main"><b>{report.displayName || report.staffUserId}</b><small>{dayUTC(report.periodStart)} ← {dayUTC(report.periodEnd)} · {report.automated ? 'أسبوعي' : 'من الإدارة'}{report.rank ? ` · المركز #${report.rank}` : ''}</small></div>{score !== null ? <span class="report-grade"><span class={`grade-pill big g-${report.grade || 'D'}`}>{report.grade || '-'}</span><small>{score}/100</small></span> : null}</header>
      {score !== null ? <Progress value={score} /> : null}
      <div class="report-metrics">{metrics.map(([value, label]) => <span><b class="num">{value}</b><small>{label}</small></span>)}</div>
      {report.note ? <p class="report-note" dir="auto">{report.note}</p> : null}
      {admin ? <footer><Button size="sm" variant="ghost" icon="edit-2" onClick={async () => {
        const note = await promptDialog({ title: 'ملاحظة التقرير', label: 'ملاحظة خاصة تظهر مع التقرير', value: report.note ?? '', maxLength: 1500 });
        if (note === null) return;
        try { await api(`/api/staff-reports/${report.id}`, { method: 'PATCH', body: { note } }); reload(); } catch (error) { toastError(error); }
      }}>ملاحظة</Button><Button size="sm" variant="ghost" icon="trash" class="danger-text" onClick={async () => {
        if (!await confirmDialog({ title: 'حذف التقرير؟', message: 'ينشال من اللوحة. اللي انرسل في الخاص يبقى.', confirmText: 'حذف' })) return;
        try { await api(`/api/staff-reports/${report.id}`, { method: 'DELETE' }); reload(); } catch (error) { toastError(error); }
      }}>حذف</Button></footer> : null}
    </article>
  );
}

export default function reports(ctx: PageCtx) {
  const history = live(() => <Skeleton lines={3} height={120} />, { class: 'report-grid' });
  const loadHistory = () => api('/api/staff-reports', { signal: ctx.signal }).then(({ reports, canCreate }) => {
    if (history.el) mount(history.el, reports.length ? reports.map((r: any) => reportCard(r, Boolean(canCreate), loadHistory)) : <Empty icon="chart-2" title="ما فيه تقارير بعد" text="أول تقرير أسبوعي ينرسل الاثنين الجاي." />);
  }).catch(error => { if (history.el) mount(history.el, <ErrorState message={errorText(error)} />); });
  const weekly = live(() => <Skeleton lines={4} height={40} />);
  const send = live(() => null);
  mount(ctx.root, [
    <PageHeader title="التقارير" subtitle={ctx.admin ? 'كل اثنين يوصل كل ستاف تقريره في الخاص. حدد مين يستلم، عدّل الأهداف، أو أرسل تقرير الحين.' : 'تقارير أدائك الخاصة.'} actions={<Button icon="award" onClick={() => ctx.navigate('grades')}>كيف تنحسب الدرجات</Button>} />,
    ctx.admin ? <div class="grid-2 align-start">{weekly.node}{send.node}</div> : null,
    <h3 class="section-title">{ctx.admin ? 'التقارير المرسلة' : 'تقاريري'}</h3>,
    history.node,
  ]);
  void loadHistory();
  if (!ctx.admin) return;
  api('/api/weekly-reports/settings', { signal: ctx.signal }).then(info => {
    const s = info.settings;
    const staff: any[] = info.staff ?? [];
    let mode = s.recipients === 'selected' ? 'selected' : 'all';
    const chosen = new Set<string>(s.staffIds ?? []);
    const targets = { ...s.targets };
    const flags = { enabled: s.enabled, dmStaff: s.dmStaff, dmSummary: s.dmSummary };
    let channelId = s.channelId ?? '';
    let language = s.language ?? 'ar';
    let previewFor = '';
    const recipients = live(() => (mode === 'selected' ? picker(staff, chosen, () => note.update()) : null));
    const note = live(() => (mode === 'all' ? `كل الستاف النشطين (${num(staff.length)}) يستلمونه، وحتى اللي ينضافون بعدين.` : `${num(chosen.size)} من ${num(staff.length)} بيستلمونه. الجدد ما ينضافون تلقائيًا.`), { class: 'field-hint' }, 'small');
    if (weekly.el) mount(weekly.el, (
      <Card title="التقارير الأسبوعية التلقائية" subtitle="كل اثنين (UTC) ينقاس الأسبوع الماضي وينرسل لحاله." icon="chart-2" actions={<Badge tone="brand">{info.lastRun ? `آخر إرسال: ${dayUTC(info.lastRun)}` : 'ما انرسل بعد'} · الجاي: {dayUTC(info.nextRun)}</Badge>}>
        {info.migrated ? null : <Notice tone="warning">إعدادات التقارير الجديدة ما انضافت لقاعدة البيانات. شغّل migration 034 ثم أعد تحميل الصفحة. لين ذاك تنستخدم الافتراضية.</Notice>}
        <div class="form-stack">
          <Toggle checked={flags.enabled} label="إرسال التقارير تلقائيًا" hint="أطفيه عشان توقفها مؤقتًا. تقدر ترسل يدوي تحت." onChange={v => { flags.enabled = v; }} />
          <Toggle checked={flags.dmStaff} label="خاص لكل ستاف" hint="بطاقة تقريره الشخصية." onChange={v => { flags.dmStaff = v; }} />
          <Toggle checked={flags.dmSummary} label="تقرير الفريق كمان" hint="الكل يوصله تقرير الفريق بعد تقريره." onChange={v => { flags.dmSummary = v; }} />
          <Field label="مين يستلم" as="div"><Seg value={mode} label="المستلمين" options={[{ value: 'all', label: 'كل الستاف', icon: 'people' }, { value: 'selected', label: 'اللي أختارهم', icon: 'user-add' }]} onChange={v => { mode = v; recipients.update(); note.update(); }} />{note.node}</Field>
          {recipients.node}
          <div class="form-grid">
            <Field label="روم ملخص الفريق"><ChannelSelect channels={info.channels ?? []} value={channelId} placeholder="بدون ملخص" onChange={(e: Event) => { channelId = (e.currentTarget as HTMLSelectElement).value; }} /></Field>
            <Field label="لغة التقرير"><Select value={language} options={[{ value: 'ar', label: 'العربية' }, { value: 'en', label: 'English' }]} onChange={(e: Event) => { language = (e.currentTarget as HTMLSelectElement).value; }} /></Field>
          </div>
          <Field label="أهداف الأسبوع" hint="اللي يوصل كل الأهداف ياخذ قريب من 100." as="div"><div class="form-grid four">{([['shiftHours', 'ساعات الشفت', 1, 100], ['activeDays', 'أيام النشاط', 1, 7], ['voiceHours', 'ساعات الفويس', 1, 100], ['messages', 'الرسائل', 10, 20000]] as Array<[string, string, number, number]>).map(([key, label, min, max]) => <Field label={label}><input class="input" type="number" min={min} max={max} value={String(targets[key])} onInput={(e: Event) => { targets[key] = Number((e.currentTarget as HTMLInputElement).value); }} /></Field>)}</div></Field>
          <div class="form-actions start">
            <Button variant="primary" icon="save-2" onClick={(e: Event) => void busy(e.currentTarget as HTMLButtonElement, async () => {
              if (mode === 'selected' && !chosen.size) return toast('اختر عضو واحد على الأقل، أو اختر كل الستاف.', 'warning');
              try { await api('/api/weekly-reports/settings', { method: 'PUT', body: { ...flags, recipients: mode, staffIds: mode === 'selected' ? [...chosen] : [], channelId, language, targets } }); toast(mode === 'selected' ? `انحفظ. التقارير تروح لـ ${count(chosen.size, ['عضو واحد', 'عضوين', 'أعضاء', 'عضو'])}.` : 'انحفظ. التقارير تروح لكل الستاف.'); }
              catch (error) { toastError(error); }
            })}>حفظ</Button>
            <Select class="input-sm" value="" placeholder="معاينة: تقريري" options={staff.map(m => ({ value: m.userId, label: `معاينة: ${nameOf(m)}` }))} onChange={(e: Event) => { previewFor = (e.currentTarget as HTMLSelectElement).value; }} />
            <Button variant="secondary" icon="send-2" onClick={(e: Event) => void busy(e.currentTarget as HTMLButtonElement, async () => {
              try { const { metrics } = await api('/api/weekly-reports/preview', { method: 'POST', body: { staffUserId: previewFor || undefined } }); toast(`انرسلت المعاينة لخاصك · ${metrics.score} (${metrics.grade}) لين الحين`); } catch (error) { toastError(error); }
            })}>أرسل معاينة لخاصي</Button>
          </div>
        </div>
      </Card>
    ));
    // الإرسال الحين
    const presets = periods();
    let preset = 'lastWeek';
    let from = iso(presets.last7![1]);
    let to = iso(presets.last7![2]);
    const selected = new Set<string>();
    let noteText = '';
    let summary = false;
    let dmSummary = true;
    const range = () => (preset === 'custom' ? { from, to } : { from: iso(presets[preset]![1]), to: iso(presets[preset]![2]) });
    const rangeText = live(() => { const r = range(); return r.from && r.to ? `${dayUTC(r.from)} ← ${dayUTC(r.to)}` : ''; }, { class: 'field-hint' }, 'small');
    const custom = live(() => (preset === 'custom' ? <div class="form-grid"><Field label="من"><input class="input" type="date" value={from} onChange={(e: Event) => { from = (e.currentTarget as HTMLInputElement).value; rangeText.update(); }} /></Field><Field label="إلى"><input class="input" type="date" value={to} onChange={(e: Event) => { to = (e.currentTarget as HTMLInputElement).value; rangeText.update(); }} /></Field></div> : null));
    const sendLabel = live(() => (selected.size ? `إرسال لـ ${count(selected.size, ['عضو واحد', 'عضوين', 'أعضاء', 'عضو'])}` : 'اختر مين تبي ترسل له'), { class: 'contents' }, 'span');
    const result = live(() => null);
    if (send.el) mount(send.el, (
      <Card title="إرسال التقارير الحين" subtitle="اختر الستاف والفترة، والأرقام تنقاس لك. كل واحد يوصله تقرير خاص." icon="send-2">
        <div class="form-stack">
          <Field label="الستاف" as="div">{picker(staff, selected, () => sendLabel.update())}</Field>
          <Field label="الفترة" as="div"><Seg value={preset} label="الفترة" options={[...Object.entries(presets).map(([value, [label]]) => ({ value, label })), { value: 'custom', label: 'مخصص' }]} onChange={v => { preset = v; custom.update(); rangeText.update(); }} />{rangeText.node}</Field>
          {custom.node}
          <Field label="ملاحظة مع التقرير" optional><textarea class="input" rows="2" maxlength="1500" dir="auto" placeholder="شغل ممتاز هذا الأسبوع، كملوا كذا." onInput={(e: Event) => { noteText = (e.currentTarget as HTMLTextAreaElement).value; }} /></Field>
          <label class="check"><input type="checkbox" checked onChange={(e: Event) => { dmSummary = (e.currentTarget as HTMLInputElement).checked; }} /> أرسل تقرير الفريق في الخاص كمان</label>
          <label class="check"><input type="checkbox" onChange={(e: Event) => { summary = (e.currentTarget as HTMLInputElement).checked; }} /> انشر ملخص الفريق في روم الملخص</label>
          <Button variant="primary" icon="send-2" onClick={(e: Event) => void busy(e.currentTarget as HTMLButtonElement, async () => {
            if (!selected.size) return toast('اختر عضو واحد على الأقل.', 'warning');
            const r = range();
            if (!r.from || !r.to) return toast('اختر الفترة أول.', 'warning');
            if (!await confirmDialog({ title: `إرسال تقارير لـ ${count(selected.size, ['عضو واحد', 'عضوين', 'أعضاء', 'عضو'])}؟`, message: `كل واحد يوصله تقرير خاص للفترة ${dayUTC(r.from)} ← ${dayUTC(r.to)}. ما تقدر تتراجع.`, confirmText: 'إرسال', danger: false })) return;
            try {
              const answer = await api('/api/staff-reports/send', { method: 'POST', timeout: 120_000, body: { staffUserIds: [...selected], periodStart: r.from, periodEnd: r.to, note: noteText, summary, dmSummary } });
              const missed: string[] = answer.unreachable ?? [];
              if (result.el) mount(result.el, <Notice tone={missed.length ? 'warning' : 'success'} title={`وصل ${num(answer.dms)} من ${num(answer.staff)}`}>متوسط الدرجة {answer.average}/100{answer.posted ? ' · انشر ملخص الفريق' : ''}{missed.length ? ` · ما قدرنا نوصل: ${missed.slice(0, 8).join('، ')}${missed.length > 8 ? ` و${missed.length - 8} غيرهم` : ''}` : ''}</Notice>);
              toast(`انرسلت التقارير: ${answer.dms} من ${answer.staff}`);
              void loadHistory();
            } catch (error) { toastError(error); }
          })}>{sendLabel.node}</Button>
          {result.node}
        </div>
      </Card>
    ));
  }).catch(error => { if (weekly.el) mount(weekly.el, <ErrorState message={errorText(error)} />); });
}
