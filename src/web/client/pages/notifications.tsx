// الإشعارات: صندوقك الخاص، وللإدارة: إرسال إشعار لعضو أو كل الستاف أو رتبة (في اللوحة و/أو خاص ديسكورد).
import { mount } from '#jsx/jsx-runtime';
import { api, errorText } from '../lib/api';
import { live } from '../lib/dom';
import { ago, count, num } from '../lib/format';
import type { PageCtx } from '../shell/types';
import { Icon } from '../ui/Icon';
import { Avatar, Badge, Button, Card, Empty, ErrorState, Field, PageHeader, PageSkeleton, Seg, Select, busy, type Tone } from '../ui/kit';
import { toast, toastError } from '../ui/overlay';

const LEVELS: Array<[string, string, string, Tone, string]> = [['info', 'رسالة', 'message-text', 'brand', 'رسالة من الإدارة'], ['warning', 'تنبيه', 'warning-2', 'warning', 'تنبيه من الإدارة'], ['important', 'مهم', 'danger', 'danger', 'إشعار مهم']];

export default async function notifications(ctx: PageCtx) {
  mount(ctx.root, <PageSkeleton cards={0} />);
  let inbox: any;
  try { inbox = await api('/api/notifications', { signal: ctx.signal }); } catch (error) { mount(ctx.root, <ErrorState message={errorText(error)} onRetry={ctx.refresh} />); return; }
  const isRead = (item: any) => (item.readBy ?? []).some((read: any) => read.userId === ctx.user.id);
  const list = live(() => (inbox.notifications ?? []).length ? <div class="stack">{inbox.notifications.map((item: any) => {
    const level = LEVELS.find(entry => entry[0] === item.level) ?? LEVELS[0]!;
    return (
      <article class={`note-card lv-${level[0]} ${isRead(item) ? '' : 'is-unread'}`}>
        <header><Avatar src={item.senderAvatar} name={item.senderName} size={36} /><div class="row-main"><b>{item.senderName || 'Rift'}</b><small>{ago(item.createdAt)} · {level[1]}</small></div>{isRead(item) ? <small class="muted">مقروء</small> : <Badge tone="brand" dot>جديد</Badge>}</header>
        {item.title ? <h4 dir="auto">{item.title}</h4> : null}
        <p dir="auto">{item.message}</p>
        {isRead(item) ? null : <Button size="sm" variant="soft" icon="tick-circle" onClick={async (event: Event) => busy(event.currentTarget as HTMLButtonElement, async () => {
          try { await api(`/api/notifications/${encodeURIComponent(item.id)}/read`, { method: 'PATCH' }); item.readBy = [...(item.readBy ?? []), { userId: ctx.user.id }]; inbox.unread = Math.max(0, (inbox.unread ?? 1) - 1); ctx.setBadge('notifications', inbox.unread); list.update(); } catch (error) { toastError(error); }
        })}>تحديد كمقروء</Button>}
      </article>
    );
  })}</div> : <Empty icon="notification" title="صندوقك فاضي" text="الإشعارات والملاحظات من الإدارة تطلع هنا." />);

  mount(ctx.root, [
    <PageHeader title="الإشعارات" subtitle={ctx.admin ? 'أرسل ملاحظات وإعلانات لفريقك، واقرأ صندوقك.' : 'ملاحظاتك الخاصة وتحديثات الستاف.'} />,
    <div class={ctx.admin ? 'grid-2 align-start' : ''}>
      {ctx.admin ? composer(ctx) : null}
      <Card title="صندوقك" subtitle={inbox.unread ? `${count(inbox.unread, ['غير مقروء', 'اثنين غير مقروءة', 'غير مقروءة', 'غير مقروء'])}` : 'كله مقروء'} icon="notification" actions={<Button size="sm" variant="ghost" icon="refresh-arrow-01" onClick={ctx.refresh}>تحديث</Button>}>{list.node}</Card>
    </div>,
  ]);
}

function composer(ctx: PageCtx) {
  let target = 'user';
  let options: any = { staff: [], roles: [] };
  const state = { level: 'info', title: '', message: '' };
  const fields = live(() => target === 'user'
    ? <Field label="العضو"><Select name="recipientUserId" placeholder="اختر عضو…" options={options.staff.map((m: any) => ({ value: m.userId, label: `${m.displayName}${m.username ? ` (@${m.username})` : ''}` }))} /></Field>
    : target === 'role' ? <Field label="الرتبة" hint="يوصل بس للستاف والإدارة اللي عندهم هذي الرتبة."><Select name="roleId" placeholder="اختر رتبة…" options={options.roles.map((r: any) => ({ value: r.id, label: `@${r.name}` }))} /></Field> : <p class="field-hint">يوصل لكل الستاف النشطين.</p>);
  const preview = live(() => {
    const level = LEVELS.find(entry => entry[0] === state.level) ?? LEVELS[0]!;
    return <div class={`dm-preview lv-${level[0]}`}><small><Icon name={level[2]} size={14} /> {level[4]}</small><b dir="auto">{state.title || level[4]}</b><p dir="auto">{state.message || 'رسالتك تطلع هنا.'}</p><em>من {ctx.user.username} · Rift</em></div>;
  });
  api('/api/notifications/options').then(result => { options = { staff: result.staff ?? [], roles: result.roles ?? [] }; fields.update(); }).catch(() => undefined);
  return (
    <Card title="إرسال إشعار" subtitle="لعضو أو كل الستاف أو رتبة. يوصل في اللوحة أو خاص البوت أو الاثنين." icon="send-2">
      <form class="form-stack" onInput={(event: Event) => { const el = event.target as HTMLInputElement; if (el.name === 'title' || el.name === 'message') { (state as any)[el.name] = el.value; preview.update(); } }} onSubmit={async (event: Event) => {
        event.preventDefault();
        const form = event.currentTarget as HTMLFormElement;
        const values = Object.fromEntries(new FormData(form)) as Record<string, string>;
        if (target === 'user' && !values.recipientUserId) return toast('اختر العضو أول.', 'warning');
        if (target === 'role' && !values.roleId) return toast('اختر الرتبة أول.', 'warning');
        await busy(form.querySelector<HTMLButtonElement>('button[type=submit]'), async () => {
          try {
            const result = await api('/api/notifications/admin-note', { method: 'POST', body: { ...values, level: state.level, target } });
            const dm = result.delivery === 'dashboard' || result.recipients === undefined ? '' : ` · وصل ${num(result.sent)}/${num(result.recipients)} في الخاص`;
            toast(`انرسل${result.recipients !== undefined ? ` لـ ${count(result.recipients, ['شخص واحد', 'شخصين', 'أشخاص', 'شخص'])}` : ''}${dm}`);
            (form.elements.namedItem('message') as HTMLTextAreaElement).value = '';
            (form.elements.namedItem('title') as HTMLInputElement).value = '';
            state.title = ''; state.message = ''; preview.update();
          } catch (error) { toastError(error); }
        });
      }}>
        <Seg value="user" label="المستلم" options={[{ value: 'user', label: 'عضو', icon: 'user' }, { value: 'staff', label: 'كل الستاف', icon: 'people' }, { value: 'role', label: 'رتبة', icon: 'shield-tick' }]} onChange={value => { target = value; fields.update(); }} />
        {fields.node}
        <Field label="النوع" as="div"><Seg value="info" label="نوع الإشعار" options={LEVELS.map(([value, label, icon]) => ({ value, label, icon }))} onChange={value => { state.level = value; preview.update(); }} /></Field>
        <Field label="العنوان" optional><input class="input" name="title" maxlength="120" dir="auto" placeholder="مثلاً: اجتماع الستاف الجمعة" /></Field>
        <Field label="الرسالة"><textarea class="input" name="message" rows="5" maxlength="2000" required dir="auto" placeholder="اكتب الإشعار…" /></Field>
        <Field label="طريقة الإرسال"><Select name="delivery" value="both" options={[{ value: 'both', label: 'اللوحة + خاص ديسكورد' }, { value: 'discord', label: 'خاص ديسكورد فقط' }, { value: 'dashboard', label: 'اللوحة فقط' }]} /></Field>
        <Field label="معاينة الخاص" as="div">{preview.node}</Field>
        <Button type="submit" variant="primary" icon="send-2" block>إرسال الإشعار</Button>
      </form>
    </Card>
  );
}
