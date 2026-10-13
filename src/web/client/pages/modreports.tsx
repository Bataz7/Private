// تقارير المود: المشرفين يبلّغون عن كل كتم/طرد/باند من لوحة ديسكورد، والإدارة تقبل أو ترفض هنا. مع الإعدادات واللوحات والمعاينة.
import type { Child } from '#jsx/jsx-runtime';
import { mount } from '#jsx/jsx-runtime';
import { api, errorText } from '../lib/api';
import { debounce, live, safeUrl } from '../lib/dom';
import { ago, dateTime, num } from '../lib/format';
import type { PageCtx } from '../shell/types';
import { DiscordMessage } from '../ui/discord';
import { Icon } from '../ui/Icon';
import { Avatar, Badge, Button, Card, ChannelSelect, Empty, ErrorState, Field, Kpi, Meta, Notice, PageHeader, PageSkeleton, RolePicker, RoleSelect, SearchInput, Seg, Select, Tabs, Toggle, busy, type Tone } from '../ui/kit';
import { confirmDialog, openDrawer, promptDialog, toast, toastError } from '../ui/overlay';

const ACTIONS: Record<string, [string, string]> = { warn: ['warning-2', 'تحذير'], mute: ['timer-pause', 'كتم / تايم أوت'], kick: ['logout-01', 'طرد'], ban: ['lock', 'باند'], unban: ['security-user', 'فك باند'], other: ['flag', 'أخرى'] };
const STATUS: Record<string, [string, Tone]> = { pending: ['بالانتظار', 'warning'], approved: ['مقبول', 'success'], rejected: ['مرفوض', 'danger'] };
const pad = (n: number) => `#${String(n).padStart(4, '0')}`;
const Act = ({ action }: { action: string }) => <span class="act"><Icon name={ACTIONS[action]?.[0] ?? 'flag'} size={15} />{ACTIONS[action]?.[1] ?? action}</span>;
const linkify = (text: string): Child[] => String(text ?? '').split(/(https?:\/\/[^\s<]+)/g).map(part => (/^https?:\/\//.test(part) && safeUrl(part) ? <a href={safeUrl(part)} target="_blank" rel="noopener noreferrer">{part}</a> : part));

export default async function modreports(ctx: PageCtx) {
  mount(ctx.root, <PageSkeleton />);
  let overview: any;
  let options: any;
  try { [overview, options] = await Promise.all([api('/api/mod-reports/overview', { signal: ctx.signal }), api('/api/mod-reports/options').catch(() => ({ roles: [], channels: [] }))]); }
  catch (error) { mount(ctx.root, <ErrorState message={errorText(error)} onRetry={ctx.refresh} />); return; }
  const params = new URLSearchParams(location.search);
  let tab = 'reports';
  const filter = { status: params.get('id') ? 'all' : 'pending', action: '', q: '', page: 1 };
  let rows: any[] = [];
  let more = false;
  const body = live(() => (tab === 'reports' ? reportsTab() : settingsTab()));
  const refreshOverview = async () => { overview = await api('/api/mod-reports/overview').catch(() => overview); ctx.setBadge('modreports', overview.totals?.pending ?? 0); };
  ctx.setBadge('modreports', overview.totals?.pending ?? 0);

  const table = live(() => rows.length ? (
    <div class="table-wrap"><table class="table">
      <thead><tr><th>التقرير</th><th>العضو</th><th>المشرف</th><th>الوقت</th><th>الحالة</th></tr></thead>
      <tbody>{rows.map(row => (
        <tr class="is-link" tabindex="0" onClick={() => void open(row.id)} onKeyDown={(e: KeyboardEvent) => { if (e.key === 'Enter') void open(row.id); }}>
          <td><div class="mr-cell"><b>{pad(row.number)} <Act action={row.action} /></b><small dir="auto" class="clamp-2">{row.reason}</small></div></td>
          <td data-label="العضو"><div class="who"><Avatar src={row.targetAvatar} name={row.targetTag} size={28} /><span class="who-text"><b>{row.targetTag || row.targetUserId}</b><small class="ltr">{row.targetUserId}</small></span></div></td>
          <td data-label="المشرف"><div class="who"><Avatar src={row.moderatorAvatar} name={row.moderator} size={28} /><span class="who-text"><b>{row.moderator}</b><small>{row.notes ? `📝 ${row.notes}` : ''}{row.flags ? ` ⚠️ ${row.flags}` : ''}</small></span></div></td>
          <td data-label="الوقت" class="muted nowrap">{ago(row.createdAt)}</td>
          <td data-label="الحالة"><Badge tone={STATUS[row.status]?.[1] ?? 'muted'} dot>{STATUS[row.status]?.[0] ?? row.status}</Badge></td>
        </tr>
      ))}</tbody>
    </table></div>
  ) : <Empty icon="shield-tick" title="ما فيه تقارير هنا" text={filter.status === 'pending' ? 'التقارير الجديدة تطلع هنا أول ما يرسلها المشرفين.' : 'جرّب فلتر ثاني.'} />);
  const moreBtn = live(() => (more ? <div class="list-more"><Button variant="soft" icon="arrow-down-01" onClick={() => { filter.page += 1; void load(false); }}>تحميل المزيد</Button></div> : null));
  async function load(reset: boolean) {
    if (reset) { filter.page = 1; rows = []; }
    try {
      const data = await api(`/api/mod-reports?${new URLSearchParams({ status: filter.status, action: filter.action, q: filter.q, page: String(filter.page) })}`);
      rows = rows.concat(data.rows ?? []); more = Boolean(data.hasMore);
    } catch (error) { toastError(error); }
    table.update(); moreBtn.update();
  }

  function reportsTab(): Child {
    const { totals, actions, top, settings } = overview;
    void load(true);
    const onSearch = debounce((value: string) => { filter.q = value; void load(true); }, 250);
    return [
      settings.reviewChannelId ? null : <Notice tone="warning" title="ما فيه روم مراجعة">التقارير تنرسل لروم السجلات لين تختار روم من «الإعدادات واللوحات».</Notice>,
      <div class="kpi-grid">
        <Kpi icon="clock" tone="warning" label="بانتظار المراجعة" value={num(totals.pending)} onClick={() => { filter.status = 'pending'; body.update(); }} />
        <Kpi icon="tick-circle" tone="success" label="مقبولة" value={num(totals.approved)} onClick={() => { filter.status = 'approved'; body.update(); }} />
        <Kpi icon="close-circle" tone="danger" label="مرفوضة" value={num(totals.rejected)} onClick={() => { filter.status = 'rejected'; body.update(); }} />
        <div class="kpi"><div class="kpi-top"><span class="kpi-icon"><Icon name="crown" size={20} /></span><span class="kpi-label">الأنشط هذا الأسبوع</span></div>
          <div class="mr-top">{(top ?? []).slice(0, 3).map((item: any) => <span class="who"><Avatar src={item.avatar} name={item.displayName} size={26} /><span class="who-text"><b>{item.displayName || item.userId}</b><small>{num(item.n)} تقرير · {num(item.approved)} مقبول</small></span></span>)}{(top ?? []).length ? null : <small class="muted">ما أحد بعد</small>}</div></div>
      </div>,
      <div class="chips-row"><span class="muted">آخر 30 يوم:</span>{Object.entries(actions ?? {}).filter(([, n]) => n).map(([key, n]) => <Badge icon={ACTIONS[key]?.[0]}>{ACTIONS[key]?.[1] ?? key} <b>{num(n as number)}</b></Badge>)}</div>,
      <div class="list-tools">
        <SearchInput placeholder="#الرقم، آيدي العضو، المشرف أو السبب" value={filter.q} onInput={onSearch} />
        <Select class="input-sm" aria-label="الإجراء" value={filter.action} placeholder="كل الإجراءات" options={Object.entries(ACTIONS).map(([value, [, label]]) => ({ value, label }))} onChange={(e: Event) => { filter.action = (e.currentTarget as HTMLSelectElement).value; void load(true); }} />
        <Seg size="sm" label="الحالة" value={filter.status} options={[{ value: 'pending', label: 'بالانتظار' }, { value: 'approved', label: 'مقبولة' }, { value: 'rejected', label: 'مرفوضة' }, { value: 'all', label: 'الكل' }]} onChange={v => { filter.status = v; void load(true); }} />
      </div>,
      <div class="mt-sm">{table.node}{moreBtn.node}</div>,
    ];
  }

  async function open(id: string) {
    history.replaceState(history.state, '', `${location.pathname}?id=${encodeURIComponent(id)}`);
    let report: any = null;
    const content = live(() => (report ? drawerBody(report) : <PageSkeleton cards={0} />));
    const handle = openDrawer({ label: 'تقرير مود', body: () => content.node, onClose: () => history.replaceState(history.state, '', location.pathname) });
    const after = async () => { await refreshOverview(); await load(true); handle.close(); void open(id); };
    function drawerBody(r: any): Child {
      return (
        <div class="mr-drawer">
          <header class="mr-head"><Avatar src={r.targetAvatar} name={r.targetTag} size={52} /><div class="row-main"><h2>{pad(r.number)} <Act action={r.action} /></h2><small>{r.targetTag || 'عضو غير معروف'} · <code class="ltr">{r.targetUserId}</code></small></div><Badge tone={STATUS[r.status]?.[1] ?? 'muted'} dot>{STATUS[r.status]?.[0]}</Badge><Button variant="ghost" icon="x" aria-label="إغلاق" onClick={handle.close} /></header>
          {r.status === 'pending' ? <div class="mr-decide">
            {(['approved', 'rejected'] as const).map(decision => <Button variant={decision === 'approved' ? 'primary' : 'danger'} icon={decision === 'approved' ? 'tick-circle' : 'close-circle'} onClick={async () => {
              const note = await promptDialog({ title: decision === 'approved' ? `قبول ${pad(r.number)}؟` : `رفض ${pad(r.number)}؟`, label: decision === 'approved' ? 'ملاحظة' : 'السبب للمشرف', confirmText: decision === 'approved' ? 'قبول' : 'رفض', danger: decision === 'rejected' });
              if (note === null) return;
              try { const result = await api(`/api/mod-reports/${encodeURIComponent(r.id)}/decision`, { method: 'POST', body: { decision, note } }); toast(`${decision === 'approved' ? 'انقبل' : 'انرفض'}${result.dmSent ? '' : ' · خاص المشرف مقفل'}`); await after(); } catch (error) { toastError(error); }
            }}>{decision === 'approved' ? 'قبول' : 'رفض'}</Button>)}
          </div> : <Notice tone={r.status === 'approved' ? 'success' : 'danger'} title={`${STATUS[r.status]?.[0]} بواسطة ${r.reviewer || 'غير معروف'}`}>{dateTime(r.reviewedAt)}{r.pointsApplied ? ` · ${r.pointsApplied > 0 ? '+' : ''}${r.pointsApplied} نقطة` : ''} <Button size="sm" variant="secondary" icon="refresh-circle" onClick={async () => { try { await api(`/api/mod-reports/${encodeURIComponent(r.id)}/reopen`, { method: 'POST' }); toast('انفتح من جديد · النقاط رجعت'); await after(); } catch (error) { toastError(error); } }}>إعادة فتح</Button></Notice>}
          <Meta items={[['المشرف', r.moderator], ['الإجراء', <Act action={r.action} />], ['المدة', r.duration || '—'], ['أُرسل', ago(r.createdAt)], ['تقارير سابقة', num(r.history?.length ?? 0)], ['ملاحظات', num(r.notes?.length ?? 0)]]} />
          {(r.flags ?? []).length ? <Notice tone="warning">{r.flags.map((flag: string) => <div>{flag}</div>)}</Notice> : null}
          <section class="mr-block"><h4>السبب</h4><p dir="auto">{r.reason}</p></section>
          {r.evidence ? <section class="mr-block"><h4>الدليل</h4><p dir="auto">{linkify(r.evidence)}</p></section> : null}
          <section class="mr-block"><h4><Icon name="note-text" size={16} /> الملاحظات</h4>
            {(r.notes ?? []).map((note: any) => <div class="mini-card"><header><b>{note.name}</b><small>{ago(note.createdAt)}</small></header><p dir="auto">{note.text}</p></div>)}
            <form class="note-form" onSubmit={async (e: Event) => { e.preventDefault(); const text = ((e.currentTarget as HTMLFormElement).elements.namedItem('text') as HTMLTextAreaElement).value.trim(); if (!text) return; try { await api(`/api/mod-reports/${encodeURIComponent(r.id)}/notes`, { method: 'POST', body: { text } }); handle.close(); void open(r.id); } catch (error) { toastError(error); } }}><textarea class="input" name="text" rows="2" maxlength="1000" dir="auto" required placeholder="أضف ملاحظة (تظهر في بطاقة ديسكورد بعد)…" /><Button type="submit" variant="secondary">إضافة</Button></form>
          </section>
          {(r.history ?? []).length ? <section class="mr-block"><h4><Icon name="clock" size={16} /> تقارير سابقة على العضو</h4>{r.history.map((item: any) => <button type="button" class="line-item is-link bordered" onClick={() => { handle.close(); void open(item.id); }}><span class="row-main">{pad(item.number)} · {ACTIONS[item.action]?.[1] ?? item.action} · {item.moderator}</span><small class="muted">{ago(item.createdAt)}</small><Badge tone={STATUS[item.status]?.[1] ?? 'muted'}>{STATUS[item.status]?.[0]}</Badge></button>)}</section> : null}
          <footer class="mr-foot">{r.jumpUrl && safeUrl(r.jumpUrl) ? <Button icon="message-text" href={safeUrl(r.jumpUrl)} external>فتح في ديسكورد</Button> : <span />}<Button variant="ghost" icon="trash" class="danger-text" onClick={async () => { if (!await confirmDialog({ title: `حذف ${pad(r.number)}؟`, message: 'ينحذف نهائيًا. النقاط اللي انطبقت ما تتغير.', confirmText: 'حذف' })) return; try { await api(`/api/mod-reports/${encodeURIComponent(r.id)}`, { method: 'DELETE' }); handle.close(); await refreshOverview(); await load(true); } catch (error) { toastError(error); } }}>حذف</Button></footer>
        </div>
      );
    }
    try { report = (await api(`/api/mod-reports/${encodeURIComponent(id)}`)).report; content.update(); }
    catch (error) { if (content.el) mount(content.el, <ErrorState message={errorText(error)} />); }
  }

  function settingsTab(): Child {
    const s = structuredClone(overview.settings);
    const roles = options.roles ?? [];
    const channels = options.channels ?? [];
    let previewTab = 'panelAr';
    let previewData: any = null;
    const preview = live(() => (previewData?.[previewTab] ? <DiscordMessage message={previewData[previewTab]} ctx={{ roles, channels }} /> : <p class="muted">جار تحميل المعاينة…</p>));
    const refreshPreview = debounce(async () => { previewData = await api('/api/mod-reports-preview', { method: 'POST', body: s }).catch(() => previewData); preview.update(); }, 300);
    const change = () => refreshPreview();
    const panelChannels: Record<string, string> = { ar: s.panels?.ar?.channelId ?? '', en: s.panels?.en?.channelId ?? '' };
    refreshPreview();
    return (
      <div class="mr-settings">
        <div class="gap-section">
          <Card title="لوحات ديسكورد" subtitle="لوحتين منفصلة: عربي وإنجليزي. حفظ الإعدادات يحدثها تلقائيًا." icon="send-2">
            {(['ar', 'en'] as const).map(lang => <div class="inline-fields"><Field label={lang === 'ar' ? 'اللوحة العربية' : 'اللوحة الإنجليزية'}><ChannelSelect channels={channels} value={panelChannels[lang]} onChange={(e: Event) => { panelChannels[lang] = (e.currentTarget as HTMLSelectElement).value; }} /></Field>
              <Button variant={s.panels?.[lang]?.messageId ? 'secondary' : 'primary'} icon="send-2" onClick={(e: Event) => void busy(e.currentTarget as HTMLButtonElement, async () => {
                if (!panelChannels[lang]) return toast('اختر الروم أول.', 'warning');
                try { await api('/api/mod-reports-settings', { method: 'PUT', body: s }); const result = await api('/api/mod-reports-panel', { method: 'POST', body: { channelId: panelChannels[lang], lang } }); await refreshOverview(); toast(`${lang === 'ar' ? 'اللوحة العربية' : 'اللوحة الإنجليزية'} ${result.updated ? 'تحدثت' : 'انرسلت'}`); } catch (error) { toastError(error); }
              })}>{s.panels?.[lang]?.messageId ? 'تحديث' : 'إرسال'}</Button></div>)}
          </Card>
          <Card title="عام" icon="translate">
            <div class="form-stack">
              <Toggle checked={s.enabled} label="استقبال تقارير جديدة" hint="لما يكون مطفي، زر اللوحة يتعطل." onChange={v => { s.enabled = v; change(); }} />
              <div class="inline-fields"><Field label="لغة بطاقة المراجعة"><Select value={s.language} options={[{ value: 'ar', label: 'العربية' }, { value: 'en', label: 'English' }]} onChange={(e: Event) => { s.language = (e.currentTarget as HTMLSelectElement).value; change(); }} /></Field><Field label="لون اللوحة" class="small"><input class="input" type="color" value={s.color} onInput={(e: Event) => { s.color = (e.currentTarget as HTMLInputElement).value; change(); }} /></Field></div>
            </div>
          </Card>
          <Card title="المراجعة" subtitle="وين تروح التقارير ومين يقدر يرسلها." icon="eye">
            <div class="form-stack">
              <Field label="روم المراجعة" hint="إذا فاضي تروح لروم السجلات."><ChannelSelect channels={channels} value={s.reviewChannelId} placeholder="بدون" onChange={(e: Event) => { s.reviewChannelId = (e.currentTarget as HTMLSelectElement).value; change(); }} /></Field>
              <Field label="منشن رتبة مع كل تقرير"><RoleSelect roles={roles} value={s.pingRoleId} onChange={(e: Event) => { s.pingRoleId = (e.currentTarget as HTMLSelectElement).value; change(); }} /></Field>
              <Notice tone="info">القبول والرفض لمالك السيرفر والأدمن فقط، وما ينعطى لأي رتبة.</Notice>
              <Field label="مين يقدر يرسل" hint="فاضي = رتبة الستاف من الإعدادات." as="div"><RolePicker roles={roles} value={s.reporterRoleIds ?? []} onChange={ids => { s.reporterRoleIds = ids; change(); }} /></Field>
              <Toggle checked={s.dmModerator} label="أرسل النتيجة للمشرف في الخاص" hint="مع ملاحظة المراجع." onChange={v => { s.dmModerator = v; }} />
            </div>
          </Card>
          <Card title="قواعد الرتب" subtitle="تظهر في اللوحة. التقرير من رتبة مو مسموحة ينقبل بس يتعلّم للمراجعين." icon="ranking">
            <div class="form-stack">
              {(['mute', 'kick', 'ban'] as const).map(key => <Field label={<Act action={key} />} hint={key === 'mute' ? 'فاضي = كل المشرفين.' : undefined} as="div"><RolePicker roles={roles} value={s.actionRoles?.[key] ?? []} onChange={ids => { s.actionRoles[key] = ids; change(); }} /></Field>)}
              <Field label="الدليل مطلوب لـ" as="div"><div class="check-group">{Object.entries(ACTIONS).map(([key, [, label]]) => <label class="check"><input type="checkbox" checked={(s.requireEvidence ?? []).includes(key)} onChange={(e: Event) => { const on = (e.currentTarget as HTMLInputElement).checked; s.requireEvidence = on ? [...new Set([...(s.requireEvidence ?? []), key])] : (s.requireEvidence ?? []).filter((x: string) => x !== key); change(); }} /> {label}</label>)}</div></Field>
            </div>
          </Card>
          <Card title="النقاط" subtitle="نقاط الستاف للمشرف. إعادة فتح التقرير ترجعها." icon="star">
            <div class="inline-fields"><Field label="تقرير مقبول (إضافة)"><input class="input" type="number" min="0" max="100" value={String(s.approvePoints)} onInput={(e: Event) => { s.approvePoints = Number((e.currentTarget as HTMLInputElement).value) || 0; }} /></Field><Field label="تقرير مرفوض (خصم)"><input class="input" type="number" min="0" max="100" value={String(s.rejectPoints)} onInput={(e: Event) => { s.rejectPoints = Number((e.currentTarget as HTMLInputElement).value) || 0; }} /></Field></div>
          </Card>
          <div class="sticky-save"><span class="muted">التغييرات تنطبق على اللوحات بعد الحفظ.</span><Button variant="primary" icon="save-2" onClick={(e: Event) => void busy(e.currentTarget as HTMLButtonElement, async () => { try { const result = await api('/api/mod-reports-settings', { method: 'PUT', body: s }); overview.settings = result.settings ?? s; toast(result.panelUpdated ? 'انحفظ · لوحة ديسكورد تحدثت' : 'انحفظت الإعدادات'); } catch (error) { toastError(error); } })}>حفظ الإعدادات</Button></div>
        </div>
        <aside class="mr-preview">
          <Seg size="sm" label="المعاينة" value={previewTab} options={[{ value: 'panelAr', label: 'اللوحة العربية' }, { value: 'panelEn', label: 'اللوحة الإنجليزية' }, { value: 'card', label: 'بطاقة المراجعة' }]} onChange={v => { previewTab = v; preview.update(); }} />
          {preview.node}
        </aside>
      </div>
    );
  }

  mount(ctx.root, [
    <PageHeader title="تقارير المود" subtitle="المشرفين يبلّغون عن كل كتم وطرد وباند من لوحة ديسكورد، والإدارة تقبل أو ترفض هنا أو في روم المراجعة." />,
    <Tabs value={tab} tabs={[{ value: 'reports', label: 'التقارير', icon: 'shield-tick', count: overview.totals?.pending }, { value: 'settings', label: 'الإعدادات واللوحات', icon: 'setting-2' }]} onChange={v => { tab = v; body.update(); }} />,
    body.node,
  ]);
  const id = params.get('id');
  if (id) void open(id);
}
