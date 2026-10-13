// حالة البوت: حالة الظهور، عبارات النشاط المتغيرة (كل وحدة بنوعها)، قيم حية، والتدوير — مع معاينة مثل ديسكورد.
import { mount } from '#jsx/jsx-runtime';
import { api, errorText } from '../lib/api';
import { cx, live } from '../lib/dom';
import type { PageCtx } from '../shell/types';
import { Icon } from '../ui/Icon';
import { Avatar, Badge, Button, Card, ErrorState, Field, Notice, PageHeader, PageSkeleton, Seg, Select, busy } from '../ui/kit';
import { toast, toastError } from '../ui/overlay';

const STATES: Array<[string, string, string]> = [['online', 'متصل', 'نقطة خضراء، متاح بالكامل'], ['idle', 'خامل', 'هلال، بعيد بس ظاهر'], ['dnd', 'عدم الإزعاج', 'نقطة حمراء، مشغول'], ['invisible', 'مخفي', 'يبان أوفلاين وهو شغّال']];
const TYPES: Array<[string, string, string]> = [['custom', 'مخصص', ''], ['playing', 'يلعب', 'يلعب'], ['watching', 'يشاهد', 'يشاهد'], ['listening', 'يستمع', 'يستمع إلى'], ['competing', 'ينافس', 'ينافس في'], ['streaming', 'بث', 'يبث']];
const VARS: Array<[string, string]> = [['servers', 'عدد السيرفرات'], ['members', 'الأعضاء'], ['staff', 'الستاف النشطين'], ['onshift', 'اللي في الشفت'], ['server', 'اسم السيرفر']];
const IDEAS = [{ type: 'watching', text: '{onshift} ستاف في الشفت' }, { type: 'watching', text: 'أكثر من {members} عضو' }, { type: 'playing', text: 'مع {staff} ستاف' }, { type: 'custom', text: 'نخلي {server} شغّال تمام' }, { type: 'listening', text: 'تقاريركم' }, { type: 'competing', text: 'ستاف الأسبوع' }];
const MAX = 128;
const verb = (type: string) => TYPES.find(item => item[0] === type)?.[2] ?? '';

export default async function status(ctx: PageCtx) {
  mount(ctx.root, <PageSkeleton cards={0} />);
  let data: any;
  try { data = await api('/api/bot/status', { signal: ctx.signal }); } catch (error) { mount(ctx.root, <ErrorState message={errorText(error)} onRetry={ctx.refresh} />); return; }
  const config = data.config ?? { status: 'idle', entries: [{ text: 'Rift Staff Operations', type: 'playing' }], interval: 30, mode: 'sequence', url: '' };
  const editable = data.editable !== false;
  const state = { status: config.status, entries: (config.entries?.length ? config.entries : [{ text: '', type: 'playing' }]).map((e: any) => ({ ...e })), interval: config.interval ?? 30, mode: config.mode ?? 'sequence', url: config.url ?? '' };
  const initial = JSON.stringify(state);
  let showing = 0;
  let countdown = state.interval;
  let focused: HTMLInputElement | null = null;
  const fill = (text: string) => String(text || '').replace(/\{(servers|members|staff|onshift|server)\}/g, (_, key) => data.vars?.[key] ?? '');

  const preview = live(() => {
    const entry = state.entries[showing % state.entries.length] ?? { text: '', type: 'playing' };
    const streaming = entry.type === 'streaming' && state.url;
    const label = entry.type === 'custom' ? '' : entry.type === 'streaming' && !state.url ? 'يلعب' : verb(entry.type);
    return (
      <div class="bp-profile">
        <div class="bp-banner" />
        <div class="bp-avatar"><Avatar src={data.bot?.avatar} name={data.bot?.username ?? 'Rift'} size={76} /><i class={`presence p-${streaming ? 'streaming' : state.status}`} /></div>
        <div class="bp-body"><b>{data.bot?.username ?? 'Rift'}</b><span class="dp-app">APP</span>
          <div class="bp-activity">{label ? <small>{label}</small> : null}<p dir="auto" class={cx(streaming && 'is-stream')}>{fill(entry.text) || '…'}</p></div></div>
        <div class="bp-meta"><span>يعرض <b class="num">{(showing % state.entries.length) + 1} / {state.entries.length}</b></span><span>التغيير الجاي <b>{state.entries.length > 1 ? `بعد ${countdown}ث` : 'ثابت'}</b></span></div>
      </div>
    );
  });
  const dirty = live(() => <span class={JSON.stringify(state) !== initial ? 'is-dirty' : ''}>{JSON.stringify(state) !== initial ? 'فيه تغييرات ما انحفظت' : 'كل التغييرات محفوظة'}</span>, { class: 'contents' }, 'span');
  const changed = () => { preview.update(); dirty.update(); };

  const lines = live(() => (
    <div class="bp-lines">{state.entries.map((entry: any, index: number) => (
      <div class="bp-line">
        <span class="bp-num">{index + 1}</span>
        <Select class="bp-type" value={entry.type} disabled={!editable} options={TYPES.map(([value, label]) => ({ value, label }))} aria-label="نوع النشاط" onChange={(e: Event) => { entry.type = (e.currentTarget as HTMLSelectElement).value; showing = index; streamField.update(); changed(); }} />
        <div class="bp-input"><input class="input" value={entry.text} maxlength={MAX} dir="auto" disabled={!editable} placeholder="وش يعرض البوت؟" onFocus={(e: Event) => { focused = e.currentTarget as HTMLInputElement; }} onInput={(e: Event) => { const el = e.currentTarget as HTMLInputElement; entry.text = el.value; showing = index; countdown = state.interval; (el.nextElementSibling as HTMLElement).textContent = `${el.value.length}/${MAX}`; changed(); }} /><small>{entry.text.length}/{MAX}</small></div>
        <Button size="sm" variant="ghost" icon="arrow-up-04" aria-label="لفوق" disabled={!editable || index === 0} onClick={() => { [state.entries[index - 1], state.entries[index]] = [state.entries[index], state.entries[index - 1]]; lines.update(); changed(); }} />
        <Button size="sm" variant="ghost" icon="trash" aria-label="حذف" disabled={!editable || state.entries.length === 1} onClick={() => { state.entries.splice(index, 1); showing = 0; lines.update(); changed(); }} />
      </div>
    ))}</div>
  ));
  const addLine = (entry: { type: string; text: string }) => {
    if (!editable) return;
    if (state.entries.length >= 25) return toast('25 عبارة كحد أقصى.', 'warning');
    state.entries.push({ ...entry }); showing = state.entries.length - 1; lines.update(); streamField.update(); changed();
  };
  const streamField = live(() => (state.entries.some((e: any) => e.type === 'streaming') ? <Field label="رابط البث" hint="Twitch أو YouTube فقط. بدونه البث يطلع «يلعب»."><input class="input ltr" type="url" value={state.url} placeholder="https://twitch.tv/…" onInput={(e: Event) => { state.url = (e.currentTarget as HTMLInputElement).value.trim(); changed(); }} /></Field> : null));

  mount(ctx.root, [
    <PageHeader title="حالة البوت" subtitle="كيف يظهر ريفت في قائمة الأعضاء. نفس الحالة لكل السيرفرات." />,
    editable ? null : <Notice tone="info" icon="lock">الحالة تتغير من السيرفر الرئيسي بس. أنت تشوفها للقراءة.</Notice>,
    data.migrated === false && data.configured ? <Notice tone="warning">أنواع العبارات المختلفة والترتيب العشوائي تحتاج migration 034. لين ذاك كل العبارات تستخدم نوع أول وحدة.</Notice> : null,
    <div class="bp-grid">
      <div class="gap-section">
        <Card title="حالة الاتصال" subtitle="النقطة جنب اسم البوت." icon="radar">
          <div class="bp-states">{STATES.map(([value, label, text]) => (
            <button type="button" class="bp-state" aria-pressed={String(state.status === value)} disabled={!editable} onClick={(e: Event) => { state.status = value; (e.currentTarget as HTMLElement).parentElement?.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === e.currentTarget))); changed(); }}>
              <i class={`presence p-${value}`} /><span><b>{label}</b><small>{text}</small></span>
            </button>
          ))}</div>
        </Card>
        <Card title="عبارات النشاط" subtitle="كل عبارة بنوعها. مع أكثر من وحدة البوت يدوّر بينها." icon="message-text" actions={<Button size="sm" icon="add" disabled={!editable} onClick={() => addLine({ type: 'playing', text: '' })}>إضافة عبارة</Button>}>
          {lines.node}
          <div class="bp-chips"><span class="muted">أضف قيمة حية:</span>{VARS.map(([key, label]) => <button type="button" class="chip" title={label} onPointerDown={(e: Event) => e.preventDefault()} onClick={() => {
            if (!editable) return;
            const input = focused && document.body.contains(focused) ? focused : document.querySelector<HTMLInputElement>('.bp-input input');
            if (!input) return;
            const token = `{${key}}`;
            const start = input.selectionStart ?? input.value.length;
            input.setRangeText(token, start, input.selectionEnd ?? start, 'end');
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.focus();
          }}><code class="ltr">{`{${key}}`}</code><em>{data.vars?.[key] ?? ''}</em></button>)}</div>
          <div class="bp-chips"><span class="muted">أفكار:</span>{IDEAS.map(idea => <button type="button" class="chip ghost" onClick={() => addLine(idea)}>{verb(idea.type) ? `${verb(idea.type)} ` : ''}{idea.text}</button>)}</div>
        </Card>
        <Card title="التدوير" subtitle="كل كم وبأي ترتيب تتغير العبارات." icon="refresh-arrow-01">
          <div class="form-stack">
            <Field label="غيّر كل" hint="ديسكورد يحدّ تحديثات الحالة، فالأفضل 15 ثانية أو أكثر."><div class="input-unit"><input class="input" type="number" min="10" max="3600" value={String(state.interval)} disabled={!editable} onInput={(e: Event) => { state.interval = Math.max(10, Math.min(3600, Number((e.currentTarget as HTMLInputElement).value) || 30)); countdown = state.interval; changed(); }} /><span>ثانية</span></div></Field>
            <Field label="الترتيب" as="div"><Seg value={state.mode} label="الترتيب" options={[{ value: 'sequence', label: 'بالترتيب', icon: 'arrow-right-01' }, { value: 'random', label: 'عشوائي', icon: 'refresh-arrow-01' }]} onChange={value => { state.mode = value; changed(); }} /></Field>
            {streamField.node}
          </div>
        </Card>
      </div>
      <aside class="bp-side">
        {preview.node}
        <p class="field-hint"><Icon name="info-circle" size={14} /> المعاينة بأرقام اليوم الحقيقية.</p>
        <div class="bp-save"><Badge tone="muted">{dirty.node}</Badge><Button variant="primary" icon="tick-circle" disabled={!editable} onClick={(e: Event) => void busy(e.currentTarget as HTMLButtonElement, async () => {
          const entries = state.entries.map((entry: any) => ({ type: entry.type, text: entry.text.trim() })).filter((entry: any) => entry.text);
          if (!entries.length) return toast('أضف عبارة وحدة على الأقل.', 'warning');
          try { const result = await api('/api/bot/custom-status', { method: 'PATCH', body: { status: state.status, entries, interval: state.interval, mode: state.mode, ...(entries.some((x: any) => x.type === 'streaming') ? { streamUrl: state.url } : {}) } }); toast(result.warning || 'انحفظت الحالة وتطبقت'); ctx.refresh(); }
          catch (error) { toastError(error); }
        })}>حفظ وتطبيق</Button></div>
      </aside>
    </div>,
  ]);
  const timer = setInterval(() => {
    countdown -= 1;
    if (countdown <= 0) { countdown = state.interval; if (state.entries.length > 1) showing = state.mode === 'random' ? (showing + 1 + Math.floor(Math.random() * (state.entries.length - 1))) % state.entries.length : (showing + 1) % state.entries.length; }
    preview.update();
  }, 1000);
  ctx.onCleanup(() => clearInterval(timer));
}
