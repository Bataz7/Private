// التقديمات: إنشاء نماذج التقديم، نشرها في ديسكورد أو الموقع، ومراجعة كل الردود في مكان واحد.
import type { Child } from '#jsx/jsx-runtime';
import { mount } from '#jsx/jsx-runtime';
import { api, errorText } from '../lib/api';
import { copyText, debounce, live, rid, safeColor, safeUrl } from '../lib/dom';
import { ago, dateTime, num } from '../lib/format';
import type { PageCtx } from '../shell/types';
import { FormPage, pageErrors, pagesOf, tr, type Answers, type Question } from '../public/apply-form';
import { MiniBars } from '../ui/chart';
import { DiscordMessage } from '../ui/discord';
import { Icon } from '../ui/Icon';
import { Avatar, Badge, Button, Card, ChannelSelect, Empty, ErrorState, Field, Kpi, Meta, Notice, PageHeader, PageSkeleton, RolePicker, RoleSelect, SearchInput, Seg, Select, Switch, Tabs, Toggle, busy, type Tone } from '../ui/kit';
import { confirmDialog, openDrawer, openModal, promptDialog, toast, toastError } from '../ui/overlay';

const TYPES: Array<[Question['type'], string, string]> = [
  ['short', 'إجابة قصيرة', 'edit'], ['paragraph', 'فقرة', 'note-text'], ['number', 'رقم', 'sort'], ['url', 'رابط', 'link'], ['date', 'تاريخ', 'calendar'],
  ['choice', 'اختيار واحد', 'tick-circle'], ['checkbox', 'اختيارات متعددة', 'clipboard-text'], ['dropdown', 'قائمة منسدلة', 'arrow-down-01'], ['yesno', 'نعم / لا', 'like'], ['scale', 'مقياس', 'chart-2'], ['section', 'فاصل قسم', 'category'],
];
const TYPE = Object.fromEntries(TYPES.map(([key, label, icon]) => [key, { label, icon }])) as Record<string, { label: string; icon: string }>;
const CHOICE = new Set(['choice', 'dropdown', 'checkbox']);
const STATUS: Record<string, [string, Tone]> = { pending: ['بالانتظار', 'warning'], accepted: ['مقبول', 'success'], rejected: ['مرفوض', 'danger'], in_progress: ['يقدّم الحين', 'info'], cancelled: ['ملغي', 'muted'], expired: ['منتهي', 'muted'] };
const MODES: Record<string, [string, string, string]> = { dm: ['خاص ديسكورد', 'message-text', 'البوت يسأل كل سؤال في الخاص.'], web: ['الموقع', 'global', 'المتقدم يعبي نموذج ويب بعد ما يدخل بديسكورد.'], both: ['الخاص + الموقع', 'flash', 'المتقدم يختار، واللوحة فيها الزرين.'] };
const TEMPLATES: Array<[string, string, string, string]> = [
  ['staff', 'تقديم إدارة (عربي)', 'crown', 'معلومات، خبرة، مواقف وأسئلة مشروطة.'],
  ['support', 'فريق الدعم (عربي)', 'message-circle', 'الأوقات المتاحة ومقياس الصبر.'],
  ['staff-en', 'Staff application', 'crown', 'English form with sections and scenarios.'],
  ['support-en', 'Support team', 'message-circle', 'A shorter English form.'],
  ['blank', 'نموذج فاضي', 'add', 'ابدأ من الصفر وأضف أسئلتك.'],
];
const StatusBadge = ({ status }: { status: string }) => <Badge tone={STATUS[status]?.[1] ?? 'muted'} dot>{STATUS[status]?.[0] ?? status}</Badge>;
const clone = <T,>(value: T): T => structuredClone(value);

export default async function applications(ctx: PageCtx) {
  const params = new URLSearchParams(location.search);
  let overview: any = null;
  let options: any = null;
  const responses = { formId: '', status: 'pending', q: '', page: 1, rows: [] as any[], hasMore: false };
  let builderDirty = false;
  const guard = (event: BeforeUnloadEvent) => { if (builderDirty) { event.preventDefault(); event.returnValue = ''; } };
  window.addEventListener('beforeunload', guard);
  ctx.onCleanup(() => window.removeEventListener('beforeunload', guard));
  const setQuery = (query: Record<string, string>) => history.replaceState(history.state, '', `${location.pathname}${new URLSearchParams(query).toString() ? `?${new URLSearchParams(query)}` : ''}`);
  const loadOverview = async () => { overview = await api('/api/applications/overview'); ctx.setBadge('applications', overview.totals?.pending ?? 0); return overview; };
  const loadOptions = async () => (options ??= await api('/api/applications/options').catch(() => ({ roles: [], channels: [] })));

  const header = (tab: string) => [
    <PageHeader title="التقديمات" subtitle="سوّ نماذج تقديم، انشرها في ديسكورد أو الموقع، وراجع كل الردود في مكان واحد." actions={<Button variant="primary" icon="add" onClick={chooseTemplate}>نموذج جديد</Button>} />,
    <Tabs value={tab} tabs={[{ value: 'forms', label: 'النماذج', icon: 'clipboard-text' }, { value: 'responses', label: 'الردود', icon: 'people', count: overview?.totals?.pending }]} onChange={v => (v === 'forms' ? void showForms() : void showResponses())} />,
  ];

  function chooseTemplate() {
    openModal({
      title: 'نموذج تقديم جديد', description: 'اختر نقطة البداية، وكل شي يتعدل بعدين.', icon: 'clipboard-text', size: 'lg',
      body: close => <div class="template-grid">{TEMPLATES.map(([key, title, icon, text]) => <button type="button" class="template" onClick={() => { close(); void createForm(key); }}><Icon name={icon} size={22} /><b>{title}</b><span>{text}</span></button>)}</div>,
    });
  }
  async function createForm(template: string) {
    try { const { form } = await api('/api/applications/forms', { method: 'POST', body: { template } }); toast('انشأ النموذج · يبقى مقفل لين تفتحه'); void openBuilder(form.id); } catch (error) { toastError(error); }
  }

  // ───── النماذج ─────
  async function showForms() {
    setQuery({});
    ctx.setCrumb(null);
    builderDirty = false;
    mount(ctx.root, <PageSkeleton />);
    try { await loadOverview(); } catch (error) { mount(ctx.root, <ErrorState message={errorText(error)} onRetry={() => void showForms()} />); return; }
    const { forms, totals, daily, oauthReady } = overview;
    mount(ctx.root, [
      ...header('forms'),
      oauthReady ? null : <Notice tone="warning" title="نماذج الموقع تحتاج دخول ديسكورد">أضف DISCORD_CLIENT_SECRET في .env عشان المتقدمين يقدرون يدخلون. التقديم في الخاص يشتغل بدونه.</Notice>,
      <div class="kpi-grid">
        <Kpi icon="clock" tone="warning" label="بانتظار المراجعة" value={num(totals.pending)} onClick={() => { responses.formId = ''; responses.status = 'pending'; void showResponses(); }} />
        <Kpi icon="tick-circle" tone="success" label="مقبولين" value={num(totals.accepted)} onClick={() => { responses.formId = ''; responses.status = 'accepted'; void showResponses(); }} />
        <Kpi icon="close-circle" tone="danger" label="مرفوضين" value={num(totals.rejected)} onClick={() => { responses.formId = ''; responses.status = 'rejected'; void showResponses(); }} />
        <div class="kpi"><div class="kpi-top"><span class="kpi-icon"><Icon name="chart-2" size={20} /></span><span class="kpi-label">التقديمات · 14 يوم</span></div><MiniBars values={(daily ?? []).map((d: any) => d.count)} label="التقديمات اليومية" /><small class="kpi-hint">{num(totals.in_progress ?? 0)} يقدّمون في الخاص الحين</small></div>
      </div>,
      forms.length ? <div class="form-cards">{forms.map((form: any) => {
        const counts = form.counts ?? {};
        const total = (counts.pending || 0) + (counts.accepted || 0) + (counts.rejected || 0);
        const mode = MODES[form.settings?.mode] ?? MODES.both!;
        const questions = form.questions.filter((q: any) => q.type !== 'section').length;
        return (
          <article class="form-card" style={{ '--form': safeColor(form.settings?.color) || 'var(--brand)' }}>
            <button type="button" class="form-card-main" onClick={() => void openBuilder(form.id)}>
              <span class="form-card-top"><Badge tone={form.open ? 'success' : 'muted'} dot>{form.open ? 'مفتوح' : 'مقفل'}</Badge><Badge icon={mode[1]}>{mode[0]}</Badge></span>
              <b dir="auto">{form.title}</b><small>{num(questions)} سؤال · تعدّل {ago(form.updatedAt)}</small>
            </button>
            <div class="form-card-stats">
              <button type="button" onClick={() => { responses.formId = form.id; responses.status = 'pending'; void showResponses(); }}><b>{num(counts.pending || 0)}</b><span>بالانتظار</span></button>
              <button type="button" onClick={() => { responses.formId = form.id; responses.status = 'all'; void showResponses(); }}><b>{num(total)}</b><span>الكل</span></button>
              <span><b>{total ? Math.round(((counts.accepted || 0) / total) * 100) : 0}%</b><span>قبول</span></span>
            </div>
            <footer>
              <Switch label={form.open ? 'قفل التقديم' : 'فتح التقديم'} checked={form.open} onChange={async checked => { try { const r = await api(`/api/applications/forms/${form.id}/open`, { method: 'PATCH', body: { open: checked } }); toast(`${checked ? 'انفتح التقديم' : 'انقفل التقديم'}${r.panelUpdated ? ' · اللوحة تحدثت' : ''}`); void showForms(); } catch (error) { toastError(error); void showForms(); } }} />
              <Button size="sm" variant="ghost" icon="link" aria-label="نسخ رابط النموذج" disabled={form.settings?.mode === 'dm'} onClick={async () => toast((await copyText(form.applyUrl)) ? 'انسخ الرابط' : form.applyUrl, 'info')} />
              <Button size="sm" variant="ghost" icon="copy" aria-label="نسخة" onClick={async () => { try { await api(`/api/applications/forms/${form.id}/duplicate`, { method: 'POST' }); toast('انسخ النموذج'); void showForms(); } catch (error) { toastError(error); } }} />
              <Button size="sm" variant="ghost" icon="trash" aria-label="حذف" class="danger-text" onClick={async () => {
                const ok = await confirmDialog({ title: `حذف «${form.title}»؟`, message: 'النموذج ولوحته في ديسكورد وكل الردود تنحذف نهائيًا.', confirmText: 'حذف النموذج', typeToConfirm: total ? 'حذف' : '', details: [`${num(total)} رد بينحذف`, 'المقبولين يبقون برتبهم'] });
                if (!ok) return;
                try { await api(`/api/applications/forms/${form.id}`, { method: 'DELETE' }); toast('انحذف النموذج'); void showForms(); } catch (error) { toastError(error); }
              }} />
              <Button size="sm" variant="secondary" icon="edit-2" onClick={() => void openBuilder(form.id)}>تعديل</Button>
            </footer>
          </article>
        );
      })}</div> : <Card><Empty icon="clipboard-text" title="ما فيه نماذج تقديم بعد" text="ابدأ من نموذج جاهز وعدّله، أو ابنِ واحد من الصفر." action={<div class="template-grid">{TEMPLATES.map(([key, title, icon, text]) => <button type="button" class="template" onClick={() => void createForm(key)}><Icon name={icon} size={22} /><b>{title}</b><span>{text}</span></button>)}</div>} /></Card>,
    ]);
  }

  // ───── المنشئ ─────
  async function openBuilder(id: string) {
    mount(ctx.root, <PageSkeleton cards={0} />);
    let form: any;
    try { [{ form }] = await Promise.all([api(`/api/applications/forms/${encodeURIComponent(id)}`), loadOptions()]); }
    catch (error) { mount(ctx.root, <ErrorState title="ما قدرنا نفتح النموذج" message={errorText(error)} onRetry={() => void showForms()} />); return; }
    setQuery({ form: id });
    let draft = clone({ title: form.title, description: form.description, open: form.open, questions: form.questions as Question[], settings: form.settings });
    let pane = 'questions';
    let active = '';
    let preview = { page: 0, answers: {} as Answers, errors: {} as Record<string, string> };
    builderDirty = false;
    ctx.setCrumb(draft.title || 'نموذج بدون عنوان');
    const saveState = live(() => <Badge tone={builderDirty ? 'warning' : 'success'} dot>{builderDirty ? 'فيه تغييرات ما انحفظت' : `محفوظ · ${ago(form.updatedAt)}`}</Badge>, { class: 'contents' }, 'span');
    const dirty = () => { if (!builderDirty) { builderDirty = true; saveState.update(); } };
    const paneView = live(() => (pane === 'questions' ? questionsPane() : pane === 'settings' ? settingsPane() : pane === 'publish' ? publishPane() : previewPane()));
    const rerender = () => { repair(); paneView.update(); };

    function issues(): Array<[string, string]> {
      const out: Array<[string, string]> = [];
      if (!draft.title.trim()) out.push(['النموذج يحتاج عنوان.', '']);
      let n = 0;
      for (const q of draft.questions) {
        if (q.type !== 'section') n += 1;
        const name = q.type === 'section' ? 'قسم' : `السؤال ${n}`;
        if (!q.label.trim()) out.push([`${name} يحتاج عنوان.`, q.id]);
        if (CHOICE.has(q.type) && q.options.filter(o => o.trim()).length < 2) out.push([`«${q.label || name}» يحتاج خيارين على الأقل.`, q.id]);
      }
      if (!draft.questions.some(q => q.type !== 'section')) out.push(['أضف سؤال واحد على الأقل.', '']);
      return out;
    }
    async function save(): Promise<boolean> {
      const found = issues();
      if (found.length) { toast(found[0]![0], 'warning'); if (found[0]![1]) { active = found[0]![1]; pane = 'questions'; paneView.update(); } return false; }
      try {
        const payload = clone(draft);
        payload.questions.forEach(q => { q.options = q.options.map(o => o.trim()).filter(Boolean); });
        const result = await api(`/api/applications/forms/${encodeURIComponent(form.id)}`, { method: 'PUT', body: payload });
        form = result.form;
        draft = clone({ title: form.title, description: form.description, open: form.open, questions: form.questions, settings: form.settings });
        builderDirty = false; saveState.update(); paneView.update();
        toast(result.panelUpdated ? 'انحفظ · لوحة ديسكورد تحدثت' : 'انحفظ النموذج');
        return true;
      } catch (error) { toastError(error); return false; }
    }
    const onKey = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save(); } };
    document.addEventListener('keydown', onKey);
    ctx.onCleanup(() => document.removeEventListener('keydown', onKey));

    const choicesOf = (q: Question): Array<[string, string]> => (q.type === 'yesno' ? [['yes', 'نعم'], ['no', 'لا']] : q.options.filter(Boolean).map(o => [o, o]));
    function repair() {
      draft.questions.forEach((q, index) => {
        if (!q.showIf) return;
        const target = draft.questions.slice(0, index).find(item => item.id === q.showIf!.questionId);
        const allowed = target ? choicesOf(target).map(([v]) => v) : [];
        q.showIf = target && (CHOICE.has(target.type) || target.type === 'yesno') ? { questionId: target.id, values: q.showIf.values.filter(v => allowed.includes(v)) } : null;
      });
    }
    const newQuestion = (type: Question['type']): Question => ({ id: rid(), type, label: type === 'section' ? 'قسم جديد' : '', description: '', required: type !== 'section', placeholder: '', options: CHOICE.has(type) ? ['الخيار 1', 'الخيار 2'] : [], min: type === 'scale' ? 1 : null, max: type === 'scale' ? 5 : null, minLabel: '', maxLabel: '', showIf: null });
    const retype = (q: Question, type: Question['type']): Question => {
      const next = { ...newQuestion(type), id: q.id, label: q.label, description: q.description, required: type === 'section' ? false : q.required, showIf: type === 'section' ? null : q.showIf };
      if (CHOICE.has(type) && CHOICE.has(q.type)) next.options = q.options;
      if ((type === 'short' || type === 'paragraph') && (q.type === 'short' || q.type === 'paragraph')) { next.placeholder = q.placeholder; next.min = q.min; }
      return next;
    };
    const numInput = (q: Question, key: 'min' | 'max', label: string, attrs: Record<string, unknown> = {}) => <Field label={label} class="small"><input class="input" type="number" value={q[key] ?? ''} {...attrs} onInput={(e: Event) => { const v = (e.currentTarget as HTMLInputElement).value; q[key] = v === '' ? null : Number(v); dirty(); }} /></Field>;

    function questionCard(q: Question, index: number, number: number): Child {
      const open = q.id === active;
      const meta = TYPE[q.type] ?? TYPE.short!;
      const move = (to: number) => { if (to < 0 || to >= draft.questions.length) return; draft.questions.splice(to, 0, draft.questions.splice(index, 1)[0]!); dirty(); rerender(); };
      const headClick = (e: Event) => { if ((e.target as HTMLElement).closest('button, input, select')) return; active = open ? '' : q.id; paneView.update(); };
      const targets = draft.questions.slice(0, index).filter(item => CHOICE.has(item.type) || item.type === 'yesno');
      const target = q.showIf ? targets.find(item => item.id === q.showIf!.questionId) : undefined;
      return (
        <article class={`q-card ${open ? 'open' : ''} ${q.type === 'section' ? 'is-section' : ''}`} data-qid={q.id} draggable="true"
          onDragStart={(e: DragEvent) => { e.dataTransfer?.setData('text/plain', q.id); (e.currentTarget as HTMLElement).classList.add('dragging'); }}
          onDragEnd={(e: Event) => (e.currentTarget as HTMLElement).classList.remove('dragging')}
          onDragOver={(e: DragEvent) => e.preventDefault()}
          onDrop={(e: DragEvent) => { e.preventDefault(); const from = draft.questions.findIndex(item => item.id === e.dataTransfer?.getData('text/plain')); if (from < 0 || from === index) return; const [moved] = draft.questions.splice(from, 1); draft.questions.splice(draft.questions.findIndex(item => item.id === q.id) + (from < index ? 1 : 0), 0, moved!); dirty(); rerender(); }}>
          <header class="q-head" onClick={headClick}>
            <span class="q-grip" aria-hidden="true"><Icon name="grip" size={16} /></span>
            <span class="q-num">{q.type === 'section' ? <Icon name="category" size={14} /> : number}</span>
            <span class="q-title" dir="auto">{q.label || <em class="muted">بدون عنوان</em>}</span>
            <span class="q-meta"><Badge icon={meta.icon}>{meta.label}</Badge>{q.required ? <Badge tone="danger">مطلوب</Badge> : null}{q.showIf ? <Badge tone="info" icon="hierarchy-2">مشروط</Badge> : null}</span>
            <span class="q-tools">
              <Button size="sm" variant="ghost" icon="arrow-up-04" aria-label="لفوق" disabled={index === 0} onClick={() => move(index - 1)} />
              <Button size="sm" variant="ghost" icon="arrow-down-01" aria-label="لتحت" disabled={index === draft.questions.length - 1} onClick={() => move(index + 1)} />
              <Button size="sm" variant="ghost" icon="copy" aria-label="نسخة" onClick={() => { if (draft.questions.length >= 40) return toast('40 سؤال كحد أقصى.', 'warning'); const copy = { ...clone(q), id: rid() }; draft.questions.splice(index + 1, 0, copy); active = copy.id; dirty(); rerender(); }} />
              <Button size="sm" variant="ghost" icon="trash" aria-label="حذف" class="danger-text" onClick={() => { const deps = draft.questions.filter(item => item.showIf?.questionId === q.id).length; draft.questions.splice(index, 1); if (active === q.id) active = ''; dirty(); rerender(); toast(deps ? `انحذف السؤال · انشال ${deps} شرط كان يعتمد عليه` : 'انحذف السؤال', 'info'); }} />
            </span>
          </header>
          {open ? (
            <div class="q-body">
              <div class="q-row">
                <input class="input q-label" dir="auto" maxlength="300" value={q.label} placeholder={q.type === 'section' ? 'عنوان القسم' : 'السؤال'} autofocus onInput={(e: Event) => { q.label = (e.currentTarget as HTMLInputElement).value; const t = (e.currentTarget as HTMLElement).closest('.q-card')?.querySelector('.q-title'); if (t) t.textContent = q.label || 'بدون عنوان'; dirty(); }} />
                <Select value={q.type} aria-label="نوع السؤال" options={TYPES.map(([value, label]) => ({ value, label }))} onChange={(e: Event) => { draft.questions[index] = retype(q, (e.currentTarget as HTMLSelectElement).value as Question['type']); dirty(); rerender(); }} />
              </div>
              <textarea class="input" rows="2" maxlength="1000" dir="auto" placeholder={q.type === 'section' ? 'وصف القسم (اختياري)' : 'نص مساعد تحت السؤال (اختياري)'} onInput={(e: Event) => { q.description = (e.currentTarget as HTMLTextAreaElement).value; dirty(); }}>{q.description ?? ''}</textarea>
              {CHOICE.has(q.type) ? <div class="q-options">
                {q.options.map((option, oi) => <div class="q-option"><span class={`q-mark ${q.type}`}>{q.type === 'dropdown' ? oi + 1 : ''}</span><input class="input" dir="auto" maxlength="100" value={option} placeholder={`الخيار ${oi + 1}`} onInput={(e: Event) => { q.options[oi] = (e.currentTarget as HTMLInputElement).value; dirty(); }} onKeyDown={(e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); if (q.options.length < 25) { q.options.splice(oi + 1, 0, ''); dirty(); rerender(); } } }} /><Button size="sm" variant="ghost" icon="x" aria-label="حذف الخيار" disabled={q.options.length <= 2} onClick={() => { q.options.splice(oi, 1); dirty(); rerender(); }} /></div>)}
                <div class="row-actions">{q.options.length < 25 ? <Button size="sm" variant="ghost" icon="add" onClick={() => { q.options.push(''); dirty(); rerender(); }}>إضافة خيار</Button> : null}<Button size="sm" variant="ghost" icon="note-text" onClick={async () => {
                  const text = await promptDialog({ title: 'لصق قائمة خيارات', message: 'خيار في كل سطر. يستبدل الخيارات الحالية (لين 25).', label: 'الخيارات', value: q.options.join('\n'), confirmText: 'استبدال' });
                  if (text === null) return;
                  const list = [...new Set(text.split('\n').map(line => line.trim()).filter(Boolean))].slice(0, 25);
                  if (list.length < 2) return toast('أضف خيارين على الأقل.', 'warning');
                  q.options = list; dirty(); rerender();
                }}>لصق قائمة</Button></div>
                {q.type === 'checkbox' ? <div class="inline-fields">{numInput(q, 'min', 'أقل عدد اختيارات', { min: 0, max: q.options.length })}{numInput(q, 'max', 'أكثر عدد', { min: 1, max: q.options.length })}</div> : null}
              </div> : null}
              {q.type === 'short' || q.type === 'paragraph' ? <div class="inline-fields">{numInput(q, 'min', 'أقل عدد حروف', { min: 0 })}{numInput(q, 'max', 'أكثر عدد حروف', { min: 1, max: q.type === 'short' ? 300 : 4000 })}<Field label="نص داخل الخانة"><input class="input" dir="auto" maxlength="100" value={q.placeholder ?? ''} onInput={(e: Event) => { q.placeholder = (e.currentTarget as HTMLInputElement).value; dirty(); }} /></Field></div> : null}
              {q.type === 'number' ? <div class="inline-fields">{numInput(q, 'min', 'أقل قيمة', { step: 'any' })}{numInput(q, 'max', 'أكبر قيمة', { step: 'any' })}</div> : null}
              {q.type === 'scale' ? <div class="inline-fields">
                <Field label="من" class="small"><Select value={String(q.min ?? 1)} options={['0', '1'].map(v => ({ value: v, label: v }))} onChange={(e: Event) => { q.min = Number((e.currentTarget as HTMLSelectElement).value); dirty(); }} /></Field>
                <Field label="إلى" class="small"><Select value={String(q.max ?? 5)} options={['2', '3', '4', '5', '6', '7', '8', '9', '10'].map(v => ({ value: v, label: v }))} onChange={(e: Event) => { q.max = Number((e.currentTarget as HTMLSelectElement).value); dirty(); }} /></Field>
                <Field label="وصف الأقل"><input class="input" maxlength="40" dir="auto" value={q.minLabel ?? ''} placeholder="ضعيف" onInput={(e: Event) => { q.minLabel = (e.currentTarget as HTMLInputElement).value; dirty(); }} /></Field>
                <Field label="وصف الأعلى"><input class="input" maxlength="40" dir="auto" value={q.maxLabel ?? ''} placeholder="ممتاز" onInput={(e: Event) => { q.maxLabel = (e.currentTarget as HTMLInputElement).value; dirty(); }} /></Field>
              </div> : null}
              {q.type !== 'section' ? <div class={`q-condition ${q.showIf ? 'on' : ''}`}>
                <Field label={<span><Icon name="hierarchy-2" size={14} /> اعرض هذا السؤال</span>}><Select value={target?.id ?? ''} disabled={!targets.length} placeholder="دائمًا" options={targets.map(item => ({ value: item.id, label: `فقط إذا «${(item.label || 'بدون عنوان').slice(0, 60)}» كان…` }))} onChange={(e: Event) => { const chosen = draft.questions.find(item => item.id === (e.currentTarget as HTMLSelectElement).value); q.showIf = chosen ? { questionId: chosen.id, values: choicesOf(chosen).slice(0, 1).map(([v]) => v) } : null; dirty(); rerender(); }} /></Field>
                {target ? <div class="check-group">{choicesOf(target).map(([v, label]) => <label class="check"><input type="checkbox" checked={q.showIf!.values.includes(v)} onChange={(e: Event) => { const on = (e.currentTarget as HTMLInputElement).checked; const values = on ? [...q.showIf!.values, v] : q.showIf!.values.filter(x => x !== v); if (!values.length) { (e.currentTarget as HTMLInputElement).checked = true; return toast('اختر إجابة وحدة على الأقل، أو «دائمًا».', 'warning'); } q.showIf = { ...q.showIf!, values }; dirty(); }} /> {label}</label>)}</div> : targets.length ? null : <small class="field-hint">أضف سؤال اختيار أو نعم/لا قبله عشان تستخدم الشروط.</small>}
              </div> : null}
              {q.type !== 'section' ? <Toggle checked={Boolean(q.required)} label="مطلوب" onChange={v => { q.required = v; dirty(); rerender(); }} /> : null}
            </div>
          ) : null}
        </article>
      );
    }
    function questionsPane(): Child {
      let n = 0;
      const addMenu = live(() => null);
      return (
        <div class="q-list">
          <section class="q-card meta" style={{ '--form': safeColor(draft.settings.color) || 'var(--brand)' }}>
            <input class="input q-form-title" dir="auto" maxlength="100" value={draft.title} placeholder="عنوان النموذج" onInput={(e: Event) => { draft.title = (e.currentTarget as HTMLInputElement).value; ctx.setCrumb(draft.title || 'نموذج بدون عنوان'); dirty(); }} />
            <textarea class="input" rows="3" maxlength="2000" dir="auto" placeholder="وصف يشوفه المتقدم (اختياري)" onInput={(e: Event) => { draft.description = (e.currentTarget as HTMLTextAreaElement).value; dirty(); }}>{draft.description ?? ''}</textarea>
          </section>
          {draft.questions.map((q, index) => { if (q.type !== 'section') n += 1; return questionCard(q, index, n); })}
          <div class="q-add"><Button variant="soft" icon="add" onClick={() => { if (addMenu.el) mount(addMenu.el, addMenu.el.childElementCount ? null : <div class="type-menu">{TYPES.map(([type, label, icon]) => <button type="button" onClick={() => {
            if (draft.questions.length >= 40) return toast('40 سؤال كحد أقصى.', 'warning');
            const q = newQuestion(type);
            const at = draft.questions.findIndex(item => item.id === active);
            draft.questions.splice(at >= 0 ? at + 1 : draft.questions.length, 0, q);
            active = q.id; dirty(); rerender();
          }}><Icon name={icon} size={16} />{label}</button>)}</div>); }}>إضافة سؤال</Button>{addMenu.node}</div>
          <p class="field-hint"><Icon name="info-circle" size={14} /> اسحب البطاقة لترتيبها. فواصل الأقسام تقسم نموذج الموقع لصفحات. 40 سؤال كحد أقصى.</p>
        </div>
      );
    }
    function settingsPane(): Child {
      const s = draft.settings;
      const set = (key: string, value: unknown) => { s[key] = value; dirty(); };
      const text = (key: string, label: string, hint?: string, placeholder = '') => <Field label={label} hint={hint} optional><textarea class="input" rows="3" maxlength="1500" dir="auto" placeholder={placeholder} onInput={(e: Event) => set(key, (e.currentTarget as HTMLTextAreaElement).value)}>{s[key] ?? ''}</textarea></Field>;
      const numF = (key: string, label: string, hint: string, min: number, max: number) => <Field label={label} hint={hint || undefined} class="small"><input class="input" type="number" min={min} max={max} value={String(s[key] ?? 0)} onInput={(e: Event) => set(key, Number((e.currentTarget as HTMLInputElement).value) || 0)} /></Field>;
      const roles = (key: string, label: string, hint = '', manageableOnly = false) => <Field label={label} hint={hint || undefined} as="div"><RolePicker roles={options.roles} value={s[key] ?? []} manageableOnly={manageableOnly} onChange={ids => set(key, ids)} /></Field>;
      const ph = 'المتغيرات: {user} {server} {form}';
      const closes = s.closesAt ? new Date(new Date(s.closesAt).getTime() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '';
      return (
        <div class="settings-grid">
          <Card title="طريقة التقديم" subtitle="وين ينجاوب على الأسئلة." icon="flash">
            <div class="form-stack">
              <div class="mode-picker">{Object.entries(MODES).map(([key, [label, icon, text]]) => <label class="mode"><input type="radio" name="mode" value={key} checked={s.mode === key} onChange={() => set('mode', key)} /><span><Icon name={icon} size={20} /><b>{label}</b><small>{text}</small></span></label>)}</div>
              <div class="inline-fields">
                <Field label="لغة المتقدم" class="small"><Select value={s.language} options={[{ value: 'ar', label: 'العربية' }, { value: 'en', label: 'English' }]} onChange={(e: Event) => set('language', (e.currentTarget as HTMLSelectElement).value)} /></Field>
                {numF('dmTimeoutMinutes', 'مهلة الخاص (دقيقة)', 'يلغي التقديم في الخاص بعد هالمدة بدون رد.', 5, 1440)}
                <Field label="اللون" class="small"><input class="input" type="color" value={safeColor(s.color) || '#8175f5'} onInput={(e: Event) => set('color', (e.currentTarget as HTMLInputElement).value)} /></Field>
              </div>
              <Field label="رابط صورة البانر" optional hint="يظهر في اللوحة وأول رسالة الخاص وأعلى نموذج الموقع."><input class="input ltr" type="url" maxlength="500" value={s.bannerUrl ?? ''} placeholder="https://…" onInput={(e: Event) => set('bannerUrl', (e.currentTarget as HTMLInputElement).value)} /></Field>
            </div>
          </Card>
          <Card title="المراجعة" subtitle="وين تطلع التقديمات الجديدة ومين يقرر." icon="eye">
            <div class="form-stack">
              <Field label="روم المراجعة" hint="كل تقديم ينرسل هنا بأزرار قبول/رفض/تصويت. بدونه يروح لروم السجلات."><ChannelSelect channels={options.channels} value={s.reviewChannelId} placeholder="بدون" onChange={(e: Event) => set('reviewChannelId', (e.currentTarget as HTMLSelectElement).value)} /></Field>
              <Field label="منشن رتبة مع كل تقديم" optional><RoleSelect roles={options.roles} value={s.pingRoleId} onChange={(e: Event) => set('pingRoleId', (e.currentTarget as HTMLSelectElement).value)} /></Field>
              {roles('reviewerRoleIds', 'رتب تقدر تصوّت', 'يقدرون يعجبون أو ما يعجبون. القبول والرفض للمالك والأدمن فقط.')}
              <Toggle checked={s.reviewThread} label="افتح ثريد نقاش" hint="ثريد تحت كل تقديم للمراجعين." onChange={v => set('reviewThread', v)} />
            </div>
          </Card>
          <Card title="عند القبول" icon="tick-circle" tone="success">
            <div class="form-stack">
              {roles('acceptRoleIds', 'أعطه هالرتب', '', true)}
              {roles('removeRoleIds', 'شيل هالرتب', 'مثلاً رتبة «متقدم».', true)}
              <Toggle checked={s.addAsStaff} label="ضيفه للستاف" hint="يعطيه رتبة الستاف ويسوي ملفه، فيطلع في اللوحة والشفتات والنقاط." onChange={v => set('addAsStaff', v)} />
              {text('acceptMessage', 'رسالة القبول في الخاص', ph, 'فاضي = الرسالة الافتراضية')}
            </div>
          </Card>
          <Card title="عند الرفض" icon="close-circle" tone="danger">
            <div class="form-stack">
              {text('rejectMessage', 'رسالة الرفض في الخاص', ph, 'فاضي = الرسالة الافتراضية')}
              <Toggle checked={s.shareRejectReason} label="أرسل السبب للمتقدم" hint="السبب اللي يكتبه المراجع ينضاف للرسالة وللموقع." onChange={v => set('shareRejectReason', v)} />
              <div class="inline-fields">{numF('cooldownDays', 'مدة الانتظار قبل يقدم مرة ثانية (يوم)', '0 = يقدر يقدّم على طول.', 0, 365)}</div>
            </div>
          </Card>
          <Card title="الشروط" subtitle="تنفحص قبل ما أحد يبدأ النموذج." icon="shield-tick">
            <div class="form-stack">
              {roles('requiredRoleIds', 'لازم عنده وحدة من هالرتب', 'فاضي = الكل يقدر.')}
              {roles('blockedRoleIds', 'ما يقدر يقدّم وعنده هالرتب', 'مثلاً الستاف الحاليين أو بلاك ليست.')}
              <div class="inline-fields">{numF('minAccountAgeDays', 'أقل عمر للحساب (يوم)', '', 0, 3650)}{numF('minMemberDays', 'أقل مدة في السيرفر (يوم)', '', 0, 3650)}{numF('maxResponses', 'حد الردود', '0 = بدون حد.', 0, 100000)}</div>
              <Field label="يقفل تلقائيًا في" optional class="small"><input class="input" type="datetime-local" value={closes} onChange={(e: Event) => { const v = (e.currentTarget as HTMLInputElement).value; set('closesAt', v ? new Date(v).toISOString() : null); }} /></Field>
            </div>
          </Card>
          <Card title="الرسائل واللوحة" subtitle="النصوص اللي يشوفها المتقدم." icon="message-text">
            <div class="form-stack">
              {text('confirmationMessage', 'بعد الإرسال', `تظهر في الخاص وبعد تقديم الموقع. ${ph}`, 'فاضي = الرسالة الافتراضية')}
              <Field label="عنوان اللوحة" optional><input class="input" dir="auto" maxlength="200" value={s.panelTitle ?? ''} placeholder="الافتراضي عنوان النموذج" onInput={(e: Event) => set('panelTitle', (e.currentTarget as HTMLInputElement).value)} /></Field>
              <Field label="وصف اللوحة" optional><textarea class="input" rows="3" maxlength="2000" dir="auto" placeholder="الافتراضي وصف النموذج" onInput={(e: Event) => set('panelDescription', (e.currentTarget as HTMLTextAreaElement).value)}>{s.panelDescription ?? ''}</textarea></Field>
              <Field label="نص الزر" optional class="small"><input class="input" dir="auto" maxlength="60" value={s.panelButtonLabel ?? ''} placeholder={s.language === 'en' ? 'Apply now' : 'قدّم الآن'} onInput={(e: Event) => set('panelButtonLabel', (e.currentTarget as HTMLInputElement).value)} /></Field>
            </div>
          </Card>
        </div>
      );
    }
    function panelMessage() {
      const s = draft.settings;
      const ar = s.language !== 'en';
      const n = draft.questions.filter(q => q.type !== 'section').length;
      const color = safeColor(s.color) ? parseInt(s.color.slice(1), 16) : 0x8175f5;
      const buttons = [s.mode !== 'web' ? { type: 2, style: 1, label: s.panelButtonLabel || (ar ? 'قدّم الآن' : 'Apply now'), emoji: { name: '📝' }, custom_id: 'apply' } : null, s.mode !== 'dm' ? { type: 2, style: 5, label: ar ? 'التقديم عبر الموقع' : 'Apply on the website', emoji: { name: '🌐' }, url: form.applyUrl } : null].filter(Boolean);
      return { embeds: [{ color, title: `📝 ${s.panelTitle || draft.title}`, description: s.panelDescription || draft.description || (ar ? 'اضغط الزر بالأسفل لبدء التقديم…' : 'Press the button below to apply…'), fields: [{ name: ar ? 'عدد الأسئلة' : 'Questions', value: String(n), inline: true }, { name: ar ? 'الحالة' : 'Status', value: draft.open ? (ar ? '🟢 مفتوح' : '🟢 Open') : (ar ? '🔴 مغلق' : '🔴 Closed'), inline: true }], image: safeUrl(s.bannerUrl) ? { url: s.bannerUrl } : undefined }], components: buttons.length ? [{ type: 1, components: buttons }] : [] };
    }
    function publishPane(): Child {
      const webOff = draft.settings.mode === 'dm';
      const channel = options.channels.find((c: any) => c.id === form.panel?.channelId);
      let chosen = form.panel?.channelId ?? '';
      return (
        <div class="grid-2 align-start">
          <Card title="لوحة ديسكورد" subtitle="رسالة التقديم في روم. الإرسال مرة ثانية يحدّث نفس الرسالة." icon="send-2">
            <div class="form-stack">
              <div class="inline-fields"><Field label="الروم"><ChannelSelect channels={options.channels} value={chosen} onChange={(e: Event) => { chosen = (e.currentTarget as HTMLSelectElement).value; }} /></Field>
                <Button variant="primary" icon="send-2" onClick={(e: Event) => void busy(e.currentTarget as HTMLButtonElement, async () => {
                  if (!chosen) return toast('اختر الروم أول.', 'warning');
                  if (builderDirty && !await save()) return;
                  try { const r = await api(`/api/applications/forms/${encodeURIComponent(form.id)}/panel`, { method: 'POST', body: { channelId: chosen } }); toast(r.updated ? 'تحدثت اللوحة' : 'انرسلت اللوحة'); form = (await api(`/api/applications/forms/${encodeURIComponent(form.id)}`)).form; paneView.update(); } catch (error) { toastError(error); }
                })}>{form.panel?.messageId ? 'تحديث اللوحة' : 'إرسال اللوحة'}</Button></div>
              {channel && form.panel?.messageId ? <p class="field-hint"><Icon name="tick-circle" size={14} /> شغّالة في <b>#{channel.name}</b> · تتحدث تلقائيًا لما تحفظ أو تفتح/تقفل النموذج.</p> : null}
              {draft.open ? null : <Notice tone="info">النموذج <b>مقفل</b>، فزر اللوحة بيكون معطّل. فعّل «يستقبل ردود» فوق لما تكون جاهز.</Notice>}
              <h4 class="sub-title">المعاينة</h4>
              <DiscordMessage message={panelMessage()} />
            </div>
          </Card>
          <Card title="نموذج الموقع" subtitle="شارك الرابط بأي مكان. المتقدم يدخل بديسكورد فتعرف دايم مين قدّم." icon="global">
            {webOff ? <Notice tone="info">النموذج مضبوط على <b>خاص ديسكورد فقط</b>. غيّر «طريقة التقديم» من الإعدادات عشان تفعّل الموقع.</Notice> : null}
            <div class="link-box"><input class="input ltr" readonly value={form.applyUrl} /><Button icon="copy" disabled={webOff} onClick={async () => toast((await copyText(form.applyUrl)) ? 'انسخ الرابط' : form.applyUrl, 'info')}>نسخ</Button><Button icon="external" href={safeUrl(form.applyUrl) || '#'} external>فتح</Button></div>
          </Card>
        </div>
      );
    }
    function previewPane(): Child {
      const f = { ...draft, language: draft.settings.language };
      const pages = pagesOf(f.questions);
      const page = Math.min(preview.page, Math.max(0, pages.length - 1));
      const step = (dir: number) => {
        if (dir > 0 || dir === 0) { const errors = pageErrors(f, page, preview.answers); if (Object.keys(errors).length) { preview.errors = errors; return paneView.update(); } }
        preview.errors = {};
        if (dir === 0) return toast('تمام! في النموذج الحقيقي هنا ينرسل التقديم.', 'info');
        preview.page = Math.max(0, page + dir); paneView.update();
      };
      return (
        <div class="af-preview">
          <p class="field-hint"><Icon name="eye" size={14} /> كذا يشوف المتقدم نموذج الموقع. الإجابات هنا ما تنحفظ.</p>
          <div class="af-shell" dir={f.language === 'en' ? 'ltr' : 'rtl'} style={{ '--brand': safeColor(draft.settings.color) || undefined }}>
            <div class="af-card af-head">{safeUrl(draft.settings.bannerUrl) ? <div class="af-banner"><img src={safeUrl(draft.settings.bannerUrl)} alt="" /></div> : <div class="af-stripe" />}<div class="af-head-body"><h1 dir="auto">{draft.title}</h1>{draft.description ? <p class="af-lead" dir="auto">{draft.description}</p> : null}</div></div>
            {pages.length ? <form class="af-card af-form" novalidate onSubmit={(e: Event) => e.preventDefault()}>
              {pages.length > 1 ? <div class="af-progress"><div class="progress"><i style={{ width: `${Math.round(((page + 1) / pages.length) * 100)}%` }} /></div><span>{tr(f.language, 'page', { n: page + 1, total: pages.length })}</span></div> : null}
              <div class="af-page" ref={(el: HTMLElement) => { previewEl = el; }}><FormPage form={f} page={page} answers={preview.answers} errors={preview.errors} onChange={() => { if (previewEl) import('../public/apply-form').then(m => m.syncVisibility(previewEl!, f, preview.answers)); }} /></div>
              <div class="af-actions">{page > 0 ? <Button onClick={() => step(-1)}>{tr(f.language, 'back')}</Button> : <span />}{page < pages.length - 1 ? <Button variant="primary" onClick={() => step(1)}>{tr(f.language, 'next')}</Button> : <Button variant="primary" onClick={() => step(0)}>{tr(f.language, 'submit')}</Button>}</div>
            </form> : <Empty compact icon="clipboard-text" title="أضف أسئلة عشان تشوف المعاينة" />}
          </div>
        </div>
      );
    }
    let previewEl: HTMLElement | null = null;
    const back = async () => { if (builderDirty && !await confirmDialog({ title: 'تتجاهل التغييرات؟', message: 'تعديلاتك على النموذج ما انحفظت.', confirmText: 'تجاهل' })) return; builderDirty = false; void showForms(); };

    mount(ctx.root, (
      <div class="builder" style={{ '--form': safeColor(draft.settings.color) || 'var(--brand)' }}>
        <div class="builder-bar">
          <Button variant="ghost" icon="arrow-right-01" aria-label="رجوع للنماذج" onClick={() => void back()} />
          <div class="builder-title"><b dir="auto">{draft.title || 'نموذج بدون عنوان'}</b>{saveState.node}</div>
          <label class="open-toggle"><span>{draft.open ? 'يستقبل ردود' : 'مقفل'}</span><Switch label="فتح/قفل" checked={draft.open} onChange={v => { draft.open = v; dirty(); }} /></label>
          <Button icon="people" onClick={async () => { if (builderDirty && !await confirmDialog({ title: 'تتجاهل التغييرات؟', message: 'احفظ أول إذا تبي تحتفظ بها.', confirmText: 'تجاهل وكمّل' })) return; builderDirty = false; responses.formId = form.id; responses.status = 'pending'; void showResponses(); }}>الردود</Button>
          <Button variant="primary" icon="save-2" onClick={(e: Event) => void busy(e.currentTarget as HTMLButtonElement, save)}>حفظ</Button>
        </div>
        <Tabs value={pane} tabs={[{ value: 'questions', label: 'الأسئلة', icon: 'clipboard-text' }, { value: 'settings', label: 'الإعدادات', icon: 'setting-2' }, { value: 'publish', label: 'النشر', icon: 'send-2' }, { value: 'preview', label: 'المعاينة', icon: 'eye' }]} onChange={v => { pane = v; paneView.update(); }} />
        {paneView.node}
      </div>
    ));
  }

  // ───── الردود ─────
  async function showResponses() {
    setQuery({ tab: 'responses' });
    ctx.setCrumb('الردود');
    if (!overview) await loadOverview().catch(() => null);
    const r = responses;
    const rowsView = live(() => <PageSkeleton cards={0} />);
    const moreView = live(() => null);
    async function loadRows(reset: boolean) {
      if (reset) { r.page = 1; r.rows = []; }
      try {
        const data = await api(`/api/applications/responses?${new URLSearchParams({ formId: r.formId, status: r.status, q: r.q, page: String(r.page) })}`);
        r.rows = r.rows.concat(data.rows ?? []); r.hasMore = Boolean(data.hasMore);
        if (rowsView.el) mount(rowsView.el, r.rows.length ? (
          <div class="table-wrap"><table class="table">
            <thead><tr><th>المتقدم</th><th>النموذج</th><th>أُرسل</th><th>الأصوات</th><th>الحالة</th></tr></thead>
            <tbody>{r.rows.map(row => (
              <tr class="is-link" tabindex="0" onClick={() => void openResponse(row.id)} onKeyDown={(e: KeyboardEvent) => { if (e.key === 'Enter') void openResponse(row.id); }}>
                <td><div class="who"><Avatar src={row.avatar} name={row.displayName || row.username} size={32} /><span class="who-text"><b>{row.displayName || row.username}</b><small>@{row.username} · {row.source === 'web' ? 'الموقع' : 'الخاص'}</small></span></div></td>
                <td data-label="النموذج"><span dir="auto">{row.formTitle}</span><small class="muted"> · {row.answered}/{row.questionCount}</small></td>
                <td data-label="أُرسل" class="muted nowrap" title={dateTime(row.submittedAt || row.createdAt)}>{row.status === 'in_progress' ? `بدأ ${ago(row.createdAt)}` : ago(row.submittedAt)}</td>
                <td data-label="الأصوات" class="nowrap"><span class="votes"><Icon name="like-1" size={14} /> {num(row.up)} <Icon name="like-1" size={14} class="thumb-down" /> {num(row.down)}</span></td>
                <td data-label="الحالة"><StatusBadge status={row.status} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty icon="people" title="ما فيه تقديمات هنا" text={r.status === 'pending' ? 'التقديمات الجديدة تطلع هنا للمراجعة.' : 'جرّب فلتر ثاني.'} />);
        if (moreView.el) mount(moreView.el, r.hasMore ? <div class="list-more"><Button variant="soft" icon="arrow-down-01" onClick={() => { r.page += 1; void loadRows(false); }}>تحميل المزيد</Button></div> : null);
      } catch (error) { if (rowsView.el) mount(rowsView.el, <ErrorState message={errorText(error)} />); }
    }
    async function openResponse(id: string) {
      setQuery({ tab: 'responses', id });
      let app: any = null;
      const body = live(() => (app ? drawer(app) : <PageSkeleton cards={0} />));
      const handle = openDrawer({ label: 'تقديم', size: 'lg', body: () => body.node, onClose: () => setQuery({ tab: 'responses' }) });
      function drawer(a: any): Child {
        const up = a.votes.filter((v: any) => v.value === 'up');
        const down = a.votes.filter((v: any) => v.value === 'down');
        const mine = a.votes.find((v: any) => v.userId === ctx.user.id)?.value;
        const sections = new Map((a.sections ?? []).map((s: any) => [s.before, s.label]));
        const vote = (value: string) => async () => { try { await api(`/api/applications/responses/${a.id}/vote`, { method: 'POST', body: { value } }); handle.close(); void openResponse(a.id); } catch (error) { toastError(error); } };
        const decide = (decision: 'accepted' | 'rejected') => async (e: Event) => {
          const accepted = decision === 'accepted';
          const reason = await promptDialog(accepted ? { title: `قبول ${a.displayName || a.username}؟`, label: 'ملاحظة داخلية', confirmText: 'قبول التقديم', placeholder: 'تنعطى الرتب من إعدادات النموذج ويوصله خاص.' } : { title: `رفض ${a.displayName || a.username}؟`, label: 'السبب', confirmText: 'رفض التقديم', danger: true, placeholder: 'ينرسل للمتقدم إذا «أرسل السبب» مفعّل.' });
          if (reason === null) return;
          await busy(e.currentTarget as HTMLButtonElement, async () => {
            try {
              const result = await api(`/api/applications/responses/${a.id}/decision`, { method: 'POST', body: { decision, reason } });
              toast(`${accepted ? 'انقبل' : 'انرفض'}${result.warnings?.length ? ` · ${result.warnings[0]}` : ''}`);
              await loadOverview().catch(() => null);
              const index = r.rows.findIndex(row => row.id === a.id);
              handle.close();
              await loadRows(true);
              const next = r.status === 'pending' ? r.rows[Math.min(Math.max(index, 0), r.rows.length - 1)] : null;
              void openResponse(next?.id ?? a.id);
            } catch (error) { toastError(error); }
          });
        };
        return (
          <div class="app-drawer">
            <header class="mr-head"><Avatar src={a.avatar} name={a.displayName || a.username} size={52} /><div class="row-main"><h2>{a.displayName || a.username}</h2><small>@{a.username} · <button type="button" class="link-btn ltr" onClick={async () => toast((await copyText(a.userId)) ? 'انسخ الآيدي' : a.userId, 'info')}>{a.userId}</button></small></div><StatusBadge status={a.status} /><Button variant="ghost" icon="x" aria-label="إغلاق" onClick={handle.close} /></header>
            {a.status === 'pending' ? <div class="mr-decide"><Button variant="primary" icon="tick-circle" onClick={decide('accepted')}>قبول</Button><Button variant="danger" icon="close-circle" onClick={decide('rejected')}>رفض</Button><span class="votes-btns"><Button size="sm" variant={mine === 'up' ? 'soft' : 'ghost'} icon="like-1" title={up.map((v: any) => v.name).join('، ') || 'ما فيه أصوات'} onClick={vote('up')}>{num(up.length)}</Button><Button size="sm" variant={mine === 'down' ? 'soft' : 'ghost'} title={down.map((v: any) => v.name).join('، ') || 'ما فيه أصوات'} onClick={vote('down')}><Icon name="like-1" size={16} class="thumb-down" /> {num(down.length)}</Button></span></div> : null}
            {a.status === 'accepted' || a.status === 'rejected' ? <Notice tone={a.status === 'accepted' ? 'success' : 'danger'} title={`${a.status === 'accepted' ? 'قبله' : 'رفضه'} ${a.reviewerName || 'غير معروف'}`}>{dateTime(a.reviewedAt)}{a.decisionReason ? <p dir="auto">{a.decisionReason}</p> : null}</Notice> : null}
            <Meta items={[['النموذج', <span dir="auto">{a.formTitle}</span>], ['المصدر', a.source === 'web' ? 'الموقع' : 'خاص ديسكورد'], ['أُرسل', a.submittedAt ? ago(a.submittedAt) : 'ما انرسل'], ['عمر الحساب', a.accountCreatedAt ? ago(a.accountCreatedAt) : '—'], ['دخل السيرفر', a.memberJoinedAt ? ago(a.memberJoinedAt) : '—'], ['في السيرفر', a.stillMember ? <span class="pos">نعم</span> : <span class="neg">طلع</span>]]} />
            {(a.roles ?? []).length ? <div class="role-picker">{a.roles.map((role: any) => <span class="chip"><i class="chip-dot" style={{ background: safeColor(role.color) && role.color !== '#000000' ? role.color : 'var(--text-3)' }} />{role.name}</span>)}</div> : null}
            <section class="answers">{(a.items ?? []).map((item: any, index: number) => [
              sections.has(item.id) ? <h4 class="answer-section" dir="auto">{sections.get(item.id) as string}</h4> : null,
              <div class={`answer ${item.answered ? '' : 'empty'}`}><span class="answer-q"><i>{index + 1}</i><span dir="auto">{item.label}</span></span><div class="answer-a" dir="auto">{item.text}</div></div>,
            ])}{(a.items ?? []).length ? null : <p class="muted">ما فيه إجابات بعد.</p>}</section>
            <section class="mr-block"><h4><Icon name="note-text" size={16} /> ملاحظات خاصة <small class="muted">للمراجعين فقط</small></h4>
              {(a.notes ?? []).map((note: any) => <div class="mini-card"><header><b>{note.name}</b><small>{ago(note.createdAt)}</small></header><p dir="auto">{note.text}</p></div>)}
              <form class="note-form" onSubmit={async (e: Event) => { e.preventDefault(); const text = ((e.currentTarget as HTMLFormElement).elements.namedItem('text') as HTMLTextAreaElement).value.trim(); if (!text) return; try { await api(`/api/applications/responses/${a.id}/notes`, { method: 'POST', body: { text } }); handle.close(); void openResponse(a.id); } catch (error) { toastError(error); } }}><textarea class="input" name="text" rows="2" maxlength="1000" dir="auto" required placeholder="ملاحظة لباقي المراجعين…" /><Button type="submit" variant="secondary">إضافة</Button></form>
            </section>
            {(a.history ?? []).length ? <section class="mr-block"><h4><Icon name="clock" size={16} /> تقديمات ثانية</h4>{a.history.map((item: any) => <button type="button" class="line-item is-link bordered" onClick={() => { handle.close(); void openResponse(item.id); }}><span class="row-main" dir="auto">{item.formTitle}</span><small class="muted">{ago(item.submittedAt)}</small><StatusBadge status={item.status} /></button>)}</section> : null}
            <footer class="mr-foot">{a.reviewUrl && safeUrl(a.reviewUrl) ? <Button icon="message-text" href={safeUrl(a.reviewUrl)} external>فتح في ديسكورد</Button> : <span />}<Button variant="ghost" icon="trash" class="danger-text" onClick={async () => { if (!await confirmDialog({ title: 'حذف هذا التقديم؟', message: 'الرد وملاحظاته تنحذف نهائيًا. الرتب اللي انعطت ما تتغير.', confirmText: 'حذف' })) return; try { await api(`/api/applications/responses/${a.id}`, { method: 'DELETE' }); toast('انحذف التقديم'); handle.close(); void loadRows(true); } catch (error) { toastError(error); } }}>حذف</Button></footer>
          </div>
        );
      }
      try { app = (await api(`/api/applications/responses/${encodeURIComponent(id)}`)).application; body.update(); }
      catch (error) { if (body.el) mount(body.el, <ErrorState message={errorText(error)} />); }
    }
    const forms = overview?.forms ?? [];
    const onSearch = debounce((value: string) => { r.q = value; void loadRows(true); }, 250);
    mount(ctx.root, [
      ...header('responses'),
      <div class="list-tools">
        <SearchInput placeholder="ابحث بالاسم أو اليوزر أو الآيدي" value={r.q} onInput={onSearch} />
        <Select class="input-sm" aria-label="النموذج" value={r.formId} placeholder="كل النماذج" options={forms.map((f: any) => ({ value: f.id, label: f.title }))} onChange={(e: Event) => { r.formId = (e.currentTarget as HTMLSelectElement).value; void showResponses(); }} />
        <Seg size="sm" label="الحالة" value={r.status} options={[{ value: 'pending', label: 'بالانتظار' }, { value: 'accepted', label: 'مقبول' }, { value: 'rejected', label: 'مرفوض' }, { value: 'in_progress', label: 'يقدّم الحين' }, { value: 'all', label: 'الكل' }]} onChange={v => { r.status = v; void loadRows(true); }} />
        {r.formId ? <span class="list-tools-end"><Button size="sm" variant="ghost" icon="download" href={`/api/applications/forms/${encodeURIComponent(r.formId)}/export.csv`}>تصدير CSV</Button></span> : null}
      </div>,
      <div class="mt-sm">{rowsView.node}{moreView.node}</div>,
    ]);
    await loadRows(true);
    const id = new URLSearchParams(location.search).get('id') ?? params.get('id');
    if (id) { params.delete('id'); void openResponse(id); }
  }

  if (params.get('form')) return openBuilder(params.get('form')!);
  if (params.get('id') || params.get('tab') === 'responses') { if (params.get('id')) responses.status = 'all'; return showResponses(); }
  return showForms();
}
