// إعدادات السيرفر: الرتب والرومات، التحقق من التواجد في الفويس وحد الإنذارات، لوحة المتصدرين، نص رسالة النقاط، لغة البوت ولوحة التقييم.
import { mount } from '#jsx/jsx-runtime';
import { api, ApiError, errorText } from '../lib/api';
import { live } from '../lib/dom';
import type { PageCtx } from '../shell/types';
import { Button, Card, ChannelSelect, ErrorState, Field, Notice, PageHeader, PageSkeleton, Select, Toggle, busy, roleColor, type Channel, type Role } from '../ui/kit';
import { toast, toastError } from '../ui/overlay';

const ROLES: Array<[string, string, string, boolean]> = [
  ['staffRoleId', 'staff_role_id', 'رتبة الستاف', true],
  ['onShiftRoleId', 'on_shift_role_id', 'رتبة «في الشفت»', true],
  ['leaveRoleId', 'leave_role_id', 'رتبة «في إجازة»', true],
];
const CHANNELS: Array<[string, string, string, boolean, string?]> = [
  ['shiftChannelId', 'shift_channel_id', 'روم لوحة الشفت', true],
  ['leaveChannelId', 'leave_channel_id', 'روم طلبات الإجازة', true],
  ['resignationChannelId', 'resignation_channel_id', 'روم طلبات الاستقالة', true],
  ['logsChannelId', 'logs_channel_id', 'روم السجلات', true],
  ['reportChannelId', 'report_channel_id', 'روم التقارير', false],
  ['complaintChannelId', 'complaint_channel_id', 'روم الشكاوى', false],
  ['ratingChannelId', 'rating_channel_id', 'روم التقييمات', false],
];

export default async function settings(ctx: PageCtx) {
  mount(ctx.root, <PageSkeleton cards={0} />);
  let options: { roles: Role[]; channels: Channel[]; presenceCheck?: any };
  let row: Record<string, any> = {};
  let board = { channelId: '', migrated: true };
  try {
    const [opts, boot, lb] = await Promise.all([
      api('/api/setup/options', { signal: ctx.signal }),
      ctx.shared('bootstrap', () => api('/api/bootstrap')).catch(() => null) as Promise<any>,
      api('/api/leaderboard/settings', { signal: ctx.signal }).catch(() => null),
    ]);
    options = opts;
    row = boot?.settings ?? {};
    if (lb) board = lb;
    else board.channelId = row.leaderboard_channel_id ?? '';
  } catch (error) { mount(ctx.root, <ErrorState message={errorText(error)} onRetry={ctx.refresh} />); return; }
  const value = (camel: string, snake: string) => String(row[camel] ?? row[snake] ?? '');
  const pc = options.presenceCheck ?? { enabled: row.presence_check_enabled !== false, minutes: Number(row.presence_check_minutes) || 60, timeoutMinutes: Number(row.presence_check_timeout_minutes) || 30, warnLimit: row.warn_limit ?? 3, migrated: 'presence_check_enabled' in row };
  const presence = { enabled: pc.enabled !== false, minutes: Number(pc.minutes) || 60, timeout: Number(pc.timeoutMinutes) || 30, warnLimit: pc.warnLimit === undefined || pc.warnLimit === null ? 3 : Number(pc.warnLimit) };
  const configured = Boolean(row.staff_role_id || row.guild_id);
  let roleQuery = '';
  let channelQuery = '';
  const match = (name: string, query: string) => !query || name.toLowerCase().includes(query.toLowerCase());

  const roleFields = live(() => (
    <div class="form-grid">{ROLES.map(([key, snake, label]) => {
      const current = value(key, snake);
      const role = options.roles.find(item => item.id === current);
      return <Field label={<span class="role-label"><i class="chip-dot" style={{ background: roleColor(role) }} />{label}</span>}><Select name={key} required value={current} placeholder="اختر رتبة…" options={options.roles.filter(item => item.id === current || match(item.name, roleQuery)).map(item => ({ value: item.id, label: `@${item.name}` }))} onChange={(event: Event) => { row[snake] = (event.currentTarget as HTMLSelectElement).value; roleFields.update(); }} /></Field>;
    })}</div>
  ));
  const channelFields = live(() => (
    <div class="form-grid">
      {CHANNELS.map(([key, snake, label, required]) => {
        const current = value(key, snake);
        return <Field label={label} optional={!required}><ChannelSelect name={key} required={required} value={current} placeholder={required ? 'اختر روم…' : 'بدون'} channels={options.channels.filter(item => item.id === current || match(item.name, channelQuery))} onChange={(event: Event) => { row[snake] = (event.currentTarget as HTMLSelectElement).value; }} /></Field>;
      })}
      <Field label="روم لوحة المتصدرين الأسبوعية" optional hint="رسالة وحدة تتحدث كل 10 دقايق بأفضل 10 هذا الأسبوع."><ChannelSelect name="leaderboardChannelId" value={board.channelId} placeholder="بدون" channels={options.channels.filter(item => item.id === board.channelId || match(item.name, channelQuery))} onChange={(event: Event) => { board.channelId = (event.currentTarget as HTMLSelectElement).value; }} /></Field>
    </div>
  ));

  const save = async (button: HTMLButtonElement) => busy(button, async () => {
    const body: Record<string, unknown> = {};
    for (const [key, snake] of [...ROLES, ...CHANNELS]) body[key] = value(key, snake);
    const missing = [...ROLES, ...CHANNELS].filter(([key, , , required]) => required && !body[key]).map(([, , label]) => label);
    if (missing.length) return toast(`كمّل: ${missing.join('، ')}`, 'warning');
    Object.assign(body, {
      presenceCheck: { enabled: presence.enabled, minutes: presence.minutes, timeoutMinutes: presence.timeout, warnLimit: presence.warnLimit },
      presence_check_enabled: presence.enabled, presence_check_minutes: presence.minutes, presence_check_timeout_minutes: presence.timeout, warn_limit: presence.warnLimit,
      leaderboard_channel_id: board.channelId || null,
    });
    try {
      const result = await api('/api/setup', { method: 'POST', body });
      const lb = await api('/api/leaderboard/settings', { method: 'PATCH', body: { channelId: board.channelId } }).then(() => '', (error: unknown) => (error instanceof ApiError && error.status === 404 ? '' : errorText(error)));
      ctx.invalidate('bootstrap');
      if (result.warning || lb) toast([result.warning, lb].filter(Boolean).join(' · '), 'warning', 'انحفظت الإعدادات');
      else toast('انحفظت إعدادات السيرفر');
    } catch (error) { toastError(error); }
  });

  let language = row.bot_language === 'en' ? 'en' : 'ar';
  let ratingChannel = '';
  mount(ctx.root, [
    <PageHeader title={configured ? 'إعدادات السيرفر' : 'جهّز ريفت لسيرفرك'} subtitle="اختر الرتب والرومات اللي يستخدمها ريفت، وكيف يتصرف في الشفتات والإنذارات." actions={<Button variant="primary" icon="tick-circle" onClick={(event: Event) => void save(event.currentTarget as HTMLButtonElement)}>حفظ الإعدادات</Button>} />,
    <Notice tone="info" title="قبل الحفظ">رتبة البوت لازم تكون فوق رتب الستاف و«في الشفت» و«في إجازة» عشان يقدر يعطيها ويشيلها.</Notice>,
    <div class="settings-grid">
      <Card title="الرتب" subtitle="رتبة الستاف تحدد مين يقدر يدخل اللوحة ويستخدم أدوات الستاف." icon="shield-tick" actions={<input class="input input-sm" type="search" placeholder="ابحث في الرتب…" aria-label="ابحث في الرتب" onInput={(event: Event) => { roleQuery = (event.currentTarget as HTMLInputElement).value; roleFields.update(); }} />}>{roleFields.node}</Card>
      <Card title="الرومات" icon="message-text" actions={<input class="input input-sm" type="search" placeholder="ابحث في الرومات…" aria-label="ابحث في الرومات" onInput={(event: Event) => { channelQuery = (event.currentTarget as HTMLInputElement).value; channelFields.update(); }} />}>{channelFields.node}</Card>
      <Card title="التحقق من التواجد والإنذارات" subtitle="يتأكد إن اللي في الشفت موجود فعلًا في الفويس." icon="radar">
        {pc.migrated === false ? <Notice tone="warning">هذي الإعدادات تحتاج تحديث قاعدة البيانات (migration 036) عشان تنحفظ.</Notice> : null}
        <div class="form-stack">
          <Toggle checked={presence.enabled} label="تفعيل سؤال «هل انت موجود؟»" hint="البوت يسأل اللي في الشفت وهو في الفويس، ولو ما رد ينتهي شفته." onChange={checked => { presence.enabled = checked; }} />
          <div class="form-grid">
            <Field label="يسأل «هل انت موجود؟» بعد كم دقيقة في الفويس" hint="من 5 لين 720 دقيقة (الافتراضي 60)."><div class="input-unit"><input class="input" type="number" min="5" max="720" value={String(presence.minutes)} onInput={(event: Event) => { presence.minutes = Number((event.currentTarget as HTMLInputElement).value) || 60; }} /><span>دقيقة</span></div></Field>
            <Field label="يوقف الشفت إذا ما رد خلال" hint="من 2 لين 240 دقيقة (الافتراضي 30)."><div class="input-unit"><input class="input" type="number" min="2" max="240" value={String(presence.timeout)} onInput={(event: Event) => { presence.timeout = Number((event.currentTarget as HTMLInputElement).value) || 30; }} /><span>دقيقة</span></div></Field>
            <Field label="عدد الإنذارات قبل الفصل التلقائي" hint="0 = بدون فصل تلقائي (الافتراضي 3)."><div class="input-unit"><input class="input" type="number" min="0" max="20" value={String(presence.warnLimit)} onInput={(event: Event) => { const n = Number((event.currentTarget as HTMLInputElement).value); presence.warnLimit = Number.isFinite(n) ? Math.max(0, Math.round(n)) : 3; }} /><span>إنذار</span></div></Field>
          </div>
        </div>
      </Card>
      <Card title="نص رسالة النقاط" subtitle="النص اللي يوصل العضو لما تتعدل نقاطه. الأزرار والمنطق محمية." icon="note-text">
        <form class="form-stack" onSubmit={async (event: Event) => {
          event.preventDefault();
          const form = event.currentTarget as HTMLFormElement;
          await busy(form.querySelector<HTMLButtonElement>('button[type=submit]'), async () => {
            try { await api('/api/settings/messages', { method: 'PATCH', body: Object.fromEntries(new FormData(form)) }); toast('انحفظ نص الرسالة'); } catch (error) { toastError(error); }
          });
        }}>
          <Field label="العنوان"><input class="input" name="title" dir="auto" maxlength="400" value={row.points_message_title ?? ''} placeholder="💜 Rift • نقاطك الخاصة" /></Field>
          <Field label="الوصف" hint="تقدر تستخدم {points}"><input class="input" name="description" dir="auto" maxlength="400" value={row.points_message_description ?? ''} placeholder="هذا التقرير خاص بك ولا يظهر لباقي الأعضاء." /></Field>
          <Field label="التذييل"><input class="input" name="footer" dir="auto" maxlength="400" value={row.points_message_footer ?? ''} placeholder="Rift Staff Operations" /></Field>
          <div class="form-actions"><Button type="submit" variant="secondary" icon="save-2">حفظ النص</Button></div>
        </form>
      </Card>
      <Card title="لغة البوت" subtitle="لغة لوحات ورسائل ريفت الجديدة في ديسكورد." icon="translate">
        <div class="inline-fields">
          <Field label="اللغة"><Select value={language} options={[{ value: 'ar', label: 'العربية' }, { value: 'en', label: 'English' }]} onChange={(event: Event) => { language = (event.currentTarget as HTMLSelectElement).value; }} /></Field>
          <Button variant="secondary" icon="save-2" onClick={(event: Event) => void busy(event.currentTarget as HTMLButtonElement, async () => { try { await api('/api/settings/language', { method: 'PATCH', body: { language } }); toast('انحفظت اللغة'); } catch (error) { toastError(error); } })}>حفظ</Button>
        </div>
      </Card>
      <Card title="لوحة التقييم" subtitle="ترسل لوحة تقييم الستاف للروم المختار، والتقييمات الجديدة تطلع فيه." icon="star">
        <div class="inline-fields">
          <Field label="الروم"><ChannelSelect channels={options.channels} value={value('ratingChannelId', 'rating_channel_id')} onChange={(event: Event) => { ratingChannel = (event.currentTarget as HTMLSelectElement).value; }} /></Field>
          <Button variant="secondary" icon="send-2" onClick={(event: Event) => void busy(event.currentTarget as HTMLButtonElement, async () => {
            const channelId = ratingChannel || value('ratingChannelId', 'rating_channel_id');
            if (!channelId) return toast('اختر الروم أول.', 'warning');
            try { const result = await api('/api/ratings/panel', { method: 'POST', body: { channelId } }); toast(result.updated ? 'تحدثت لوحة التقييم' : 'انرسلت لوحة التقييم'); } catch (error) { toastError(error); }
          })}>إرسال اللوحة</Button>
        </div>
      </Card>
    </div>,
    <div class="sticky-save"><span class="muted">تأكد من الرتب والرومات ثم احفظ.</span><Button variant="primary" icon="tick-circle" onClick={(event: Event) => void save(event.currentTarget as HTMLButtonElement)}>حفظ إعدادات السيرفر</Button></div>,
  ]);
}
