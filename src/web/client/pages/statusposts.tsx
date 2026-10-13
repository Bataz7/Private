// تحديثات الحالة: منشورات قصيرة تظهر في صفحة الحالة العامة (وممكن تنرسل لديسكورد).
import { mount } from '#jsx/jsx-runtime';
import { api, errorText } from '../lib/api';
import { live } from '../lib/dom';
import { ago } from '../lib/format';
import type { PageCtx } from '../shell/types';
import { Icon } from '../ui/Icon';
import { Badge, Button, Card, ChannelSelect, Empty, ErrorState, Field, PageHeader, PageSkeleton, Toggle, busy, type Tone } from '../ui/kit';
import { confirmDialog, toast, toastError } from '../ui/overlay';

const KINDS: Array<[string, string, string, Tone]> = [['update', 'تحديث', 'notification', 'brand'], ['announcement', 'إعلان', 'flash', 'info'], ['incident', 'مشكلة', 'danger', 'danger'], ['resolved', 'انحلت', 'tick-circle', 'success'], ['maintenance', 'صيانة', 'setting-2', 'warning']];

export default async function statusposts(ctx: PageCtx) {
  mount(ctx.root, <PageSkeleton cards={0} />);
  let posts: any[] = [];
  let channels: any[] = [];
  try {
    const [list, options] = await Promise.all([api('/api/status-posts', { signal: ctx.signal }), api('/api/panel/options').catch(() => ({ channels: [] }))]);
    posts = list.posts ?? []; channels = options.channels ?? [];
  } catch (error) { mount(ctx.root, <ErrorState message={errorText(error)} onRetry={ctx.refresh} />); return; }
  let editing: any = null;
  const reload = async () => { posts = (await api('/api/status-posts')).posts ?? []; editing = null; form.update(); list.update(); };

  const form = live(() => {
    const state = { kind: editing?.kind ?? 'update', pinned: Boolean(editing?.pinned) };
    return (
      <Card title={editing ? 'تعديل التحديث' : 'تحديث جديد'} subtitle="الروابط و**العريض** تشتغل في النص." icon="edit-2">
        <form class="form-stack" onSubmit={async (event: Event) => {
          event.preventDefault();
          const el = event.currentTarget as HTMLFormElement;
          const values = Object.fromEntries(new FormData(el)) as Record<string, string>;
          const body = { title: values.title, body: values.body, kind: values.kind, pinned: state.pinned, channelId: values.channelId || '' };
          await busy(el.querySelector<HTMLButtonElement>('button[type=submit]'), async () => {
            try {
              if (editing) { await api(`/api/status-posts/${encodeURIComponent(editing.id)}`, { method: 'PATCH', body }); toast('انحفظ التعديل'); }
              else { const result = await api('/api/status-posts', { method: 'POST', body }); toast(result.announced ? 'انشر وانرسل في ديسكورد' : 'انشر في صفحة الحالة'); }
              await reload();
            } catch (error) { toastError(error); }
          });
        }}>
          <div class="kind-picker">{KINDS.map(([key, label, icon]) => <label class="kind"><input type="radio" name="kind" value={key} checked={state.kind === key} /><span><Icon name={icon} size={16} />{label}</span></label>)}</div>
          <Field label="العنوان"><input class="input" name="title" maxlength="120" required dir="auto" value={editing?.title ?? ''} placeholder="مثلاً: التقارير الأسبوعية صارت فيها ساعات الفويس" /></Field>
          <Field label="النص" optional><textarea class="input" name="body" rows="5" maxlength="2000" dir="auto" placeholder="وش تغيّر، مين يتأثر، ووش المطلوب.">{editing?.body ?? ''}</textarea></Field>
          <Toggle checked={state.pinned} label="تثبيت في الأعلى" hint="المثبّت يطلع أول في صفحة الحالة." onChange={checked => { state.pinned = checked; }} />
          {editing ? null : <Field label="انشره في ديسكورد بعد" optional><ChannelSelect name="channelId" channels={channels} placeholder="لا تنشر في ديسكورد" /></Field>}
          <div class="form-actions">{editing ? <Button variant="ghost" onClick={() => { editing = null; form.update(); }}>إلغاء</Button> : null}<Button type="submit" variant="primary" icon="send-2">{editing ? 'حفظ التعديل' : 'نشر التحديث'}</Button></div>
        </form>
      </Card>
    );
  });
  const list = live(() => (
    <Card title="المنشور" subtitle={`${posts.length} تحديث`} icon="notification">
      {posts.length ? <div class="stack">{posts.map(post => {
        const kind = KINDS.find(k => k[0] === post.kind) ?? KINDS[0]!;
        return (
          <article class="mini-card">
            <header><b dir="auto">{post.title}</b><Badge tone={kind[3]} icon={kind[2]}>{kind[1]}</Badge>{post.pinned ? <Badge icon="flag">مثبّت</Badge> : null}</header>
            {post.body ? <p dir="auto">{post.body}</p> : null}
            <footer class="post-foot"><small>{post.authorName} · {ago(post.createdAt)}</small>
              <Button size="sm" variant="ghost" onClick={async () => { try { await api(`/api/status-posts/${encodeURIComponent(post.id)}`, { method: 'PATCH', body: { title: post.title, body: post.body, kind: post.kind, pinned: !post.pinned } }); await reload(); } catch (error) { toastError(error); } }}>{post.pinned ? 'إلغاء التثبيت' : 'تثبيت'}</Button>
              <Button size="sm" variant="ghost" icon="edit-2" onClick={() => { editing = post; form.update(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>تعديل</Button>
              <Button size="sm" variant="ghost" icon="trash" class="danger-text" onClick={async () => { if (!await confirmDialog({ title: 'حذف هذا التحديث؟', message: 'يختفي من صفحة الحالة. النسخة اللي في ديسكورد تبقى.', confirmText: 'حذف' })) return; try { await api(`/api/status-posts/${encodeURIComponent(post.id)}`, { method: 'DELETE' }); await reload(); } catch (error) { toastError(error); } }}>حذف</Button>
            </footer>
          </article>
        );
      })}</div> : <Empty compact icon="notification" title="ما فيه منشورات بعد" />}
    </Card>
  ));
  mount(ctx.root, [
    <PageHeader title="تحديثات الحالة" subtitle="منشورات قصيرة تظهر في صفحة الحالة العامة: إعلانات، مشاكل، وحلول. للإدارة في السيرفر الرئيسي." actions={<Button icon="external" href="/status" external>صفحة الحالة</Button>} />,
    <div class="grid-2 align-start">{form.node}{list.node}</div>,
  ]);
}
