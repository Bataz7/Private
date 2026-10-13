// إجراءات الستاف المشتركة: إضافة، مزامنة/مسح وإعادة تسجيل، فصل وإلغاء فصل، تعديل، ملاحظات، تصفير، ودرج الملف السريع.
import type { Child } from '#jsx/jsx-runtime';
import { api } from '../lib/api';
import { cssUrl } from '../lib/dom';
import { ago, date, duration, fixed, num } from '../lib/format';
import { Icon } from '../ui/Icon';
import { Avatar, Badge, Button, Empty, Field, Meta, Progress, Select, busy, type Tone } from '../ui/kit';
import { confirmDialog, openDrawer, openMenu, openModal, toast, toastError } from '../ui/overlay';

export type StaffRow = {
  userId: string;
  username?: string;
  displayName?: string;
  avatar?: string;
  banner?: string;
  joinedAt?: string;
  points?: number;
  messageCount?: number;
  voiceMinutes?: number;
  activityHours?: number;
  complaintCount?: number;
  ratingCount?: number;
  averageRating?: number;
  shiftHours?: number;
  active?: boolean;
  status?: string;
  rank?: string;
  notes?: Array<{ text: string; addedBy: string; createdAt: string }>;
  claimed?: number;
  dismissed?: boolean;
  dismissedAt?: string | null;
  dismissReason?: string | null;
  onLeave?: boolean;
  weekPoints?: number;
};

export type StaffState = 'shift' | 'off' | 'dismissed' | 'leave';

export function staffState(member: StaffRow, leaves: any[] = []): StaffState {
  if (member.dismissed) return 'dismissed';
  if (member.active) return 'shift';
  if (member.onLeave || member.status === 'on_leave') return 'leave';
  const now = Date.now();
  if (leaves.some(leave => leave.userId === member.userId && leave.status === 'approved' && new Date(leave.startDate).getTime() <= now && new Date(leave.endDate).getTime() + 86_400_000 >= now)) return 'leave';
  return 'off';
}

export const STATE_LABEL: Record<StaffState, [string, Tone]> = {
  shift: ['في الشفت', 'success'],
  off: ['خارج الشفت', 'muted'],
  leave: ['إجازة', 'info'],
  dismissed: ['مفصول', 'danger'],
};

export const StateBadge = ({ state }: { state: StaffState }) => <Badge tone={STATE_LABEL[state][1]} dot>{STATE_LABEL[state][0]}</Badge>;

export const nameOf = (member: Partial<StaffRow> | undefined, id = '') => member?.displayName || member?.username || `عضو ${String(id || member?.userId || '').slice(-4)}`;

const done = (onDone: () => void, message: string) => {
  toast(message);
  onDone();
};

// ───── إضافة ─────
export function addStaffDialog(onDone: () => void) {
  openModal({
    title: 'إضافة عضو للستاف',
    description: 'يعطيه رتبة الستاف في ديسكورد (إذا البوت يقدر) ويبدأ ملفه في ريفت.',
    icon: 'user-add',
    body: close => (
      <form class="form-grid" id="addStaffForm" onSubmit={async (event: Event) => {
        event.preventDefault();
        const form = event.currentTarget as HTMLFormElement;
        const data = new FormData(form);
        const button = form.closest('.ov-panel')?.querySelector<HTMLButtonElement>('[data-submit]');
        await busy(button, async () => {
          try {
            const result = await api<{ roleAssigned?: boolean }>('/api/staff', { method: 'POST', body: { userId: String(data.get('userId') || '').trim(), username: data.get('username') || '', rank: data.get('rank') || '', points: Number(data.get('points') || 0) } });
            close();
            done(onDone, result.roleAssigned === false ? 'انضاف للستاف، بس البوت ما قدر يعطيه الرتبة (رتبته أعلى من البوت).' : 'انضاف العضو للستاف');
          } catch (error) { toastError(error); }
        });
      }}>
        <Field label="آيدي ديسكورد" full hint="كلك يمين على العضو ← نسخ معرّف المستخدم (لازم وضع المطوّر مفعّل).">
          <input class="input ltr" name="userId" required inputmode="numeric" pattern="[0-9]{15,22}" placeholder="931011044598489108" autofocus />
        </Field>
        <Field label="الرتبة" optional><input class="input" name="rank" placeholder="مثلاً: مشرف" /></Field>
        <Field label="نقاط البداية" optional><input class="input" name="points" type="number" min="0" value="0" /></Field>
      </form>
    ),
    footer: close => [<Button variant="ghost" onClick={close}>إلغاء</Button>, <Button variant="primary" icon="user-add" data-submit onClick={() => (document.getElementById('addStaffForm') as HTMLFormElement | null)?.requestSubmit()}>إضافة</Button>],
  });
}

// ───── مزامنة / مسح الكل ─────
type SyncResult = { mode: 'sync' | 'wipe'; withRole?: number; added?: number; reactivated?: number; deactivated?: number; wiped?: number; skippedDismissed?: number };

function syncSummary(result: SyncResult, message?: string) {
  const items: Array<[string, number | undefined, string, Tone]> = [
    ['عندهم رتبة الستاف', result.withRole, 'people', 'brand'],
    ['انضافوا', result.added, 'user-add', 'success'],
    ['رجعوا نشطين', result.reactivated, 'refresh-circle', 'info'],
    ['صاروا غير نشطين', result.deactivated, 'user-remove', 'warning'],
    ['انمسحت سجلاتهم', result.wiped, 'trash', 'danger'],
    ['مفصولين تم تخطيهم', result.skippedDismissed, 'user-remove', 'muted'],
  ];
  openModal({
    title: result.mode === 'wipe' ? 'تم المسح وإعادة التسجيل' : 'تمت مزامنة الستاف',
    description: message || (result.mode === 'wipe' ? 'انمسحت كل سجلات الستاف وانسجل كل اللي عندهم الرتبة من جديد.' : 'قائمة الستاف الحين مطابقة لرتبة الستاف في ديسكورد.'),
    icon: 'tick-circle',
    tone: 'success',
    size: 'sm',
    body: () => (
      <div class="sync-summary">
        {items.filter(([, value]) => typeof value === 'number').map(([label, value, icon, tone]) => (
          <div class={`sync-cell tone-${tone}`}><span class="kpi-icon"><Icon name={icon} size={18} /></span><b>{num(value)}</b><small>{label}</small></div>
        ))}
      </div>
    ),
    footer: close => <Button variant="primary" onClick={close}>تمام</Button>,
  });
}

export async function syncStaff(mode: 'sync' | 'wipe', onDone: () => void, button?: HTMLButtonElement | null) {
  if (mode === 'wipe') {
    const ok = await confirmDialog({
      title: 'مسح جميع الستاف وإعادة تسجيلهم؟',
      message: 'هذا يحذف كل سجلات الستاف في هذا السيرفر نهائيًا، وبعدها يسجّل من جديد كل عضو عنده رتبة الستاف.',
      details: ['النقاط والإحصائيات ترجع صفر للجميع', 'سجل الشفتات والرسائل والفويس ينمسح', 'المفصولين يرجعون إذا عندهم الرتبة', 'ما يمديك تتراجع بعدها'],
      confirmText: 'مسح الكل وإعادة التسجيل',
      typeToConfirm: 'مسح الكل',
    });
    if (!ok) return;
  }
  await busy(button, async () => {
    try {
      const response = await api<{ ok?: boolean; result: SyncResult; message?: string }>('/api/staff/sync', { method: 'POST', body: mode === 'wipe' ? { mode: 'wipe', confirm: 'مسح الكل' } : { mode: 'sync' }, timeout: 60_000 });
      syncSummary({ ...response.result, mode }, response.message);
      onDone();
    } catch (error) { toastError(error); }
  });
}

// ───── فصل وإلغاء فصل ─────
export function dismissDialog(member: StaffRow, onDone: () => void) {
  openModal({
    title: `فصل ${nameOf(member)}؟`,
    description: 'ينشال من الستاف وتنسحب منه رتبة الستاف. ما يقدر يرجع بالمزامنة لين أحد من الإدارة يلغي فصله.',
    icon: 'user-remove',
    tone: 'danger',
    body: close => (
      <form class="form-stack" id="dismissForm" onSubmit={async (event: Event) => {
        event.preventDefault();
        const form = event.currentTarget as HTMLFormElement;
        const data = new FormData(form);
        const button = form.closest('.ov-panel')?.querySelector<HTMLButtonElement>('[data-submit]');
        await busy(button, async () => {
          try {
            await api(`/api/staff/${encodeURIComponent(member.userId)}/dismiss`, { method: 'POST', body: { reason: String(data.get('reason') || '').trim(), resetPoints: data.get('resetPoints') === 'on' } });
            close();
            done(onDone, `تم فصل ${nameOf(member)}`);
          } catch (error) { toastError(error); }
        });
      }}>
        <Field label="سبب الفصل" hint="ينحفظ في السجل ويوصله في الخاص.">
          <textarea class="input" name="reason" rows="3" maxlength="500" dir="auto" required placeholder="مثلاً: غياب متكرر بدون عذر" autofocus />
        </Field>
        <label class="check-row"><input type="checkbox" name="resetPoints" /><span><b>تصفير النقاط</b><small>تنمسح كل نقاطه الحالية مع الفصل.</small></span></label>
      </form>
    ),
    footer: close => [<Button variant="ghost" onClick={close}>إلغاء</Button>, <Button variant="danger" icon="user-remove" data-submit onClick={() => (document.getElementById('dismissForm') as HTMLFormElement | null)?.requestSubmit()}>فصل</Button>],
  });
}

export function reinstateDialog(member: StaffRow, onDone: () => void) {
  openModal({
    title: `إلغاء فصل ${nameOf(member)}؟`,
    description: member.dismissReason ? `سبب الفصل: ${member.dismissReason}` : 'يرجع يقدر ينضاف للستاف من جديد.',
    icon: 'refresh-circle',
    body: close => (
      <form class="form-stack" id="reinstateForm" onSubmit={async (event: Event) => {
        event.preventDefault();
        const form = event.currentTarget as HTMLFormElement;
        const data = new FormData(form);
        const button = form.closest('.ov-panel')?.querySelector<HTMLButtonElement>('[data-submit]');
        await busy(button, async () => {
          try {
            await api(`/api/staff/${encodeURIComponent(member.userId)}/reinstate`, { method: 'POST', body: { reason: String(data.get('reason') || '').trim() || undefined, restoreRole: data.get('restoreRole') === 'on' } });
            close();
            done(onDone, `تم إلغاء فصل ${nameOf(member)}`);
          } catch (error) { toastError(error); }
        });
      }}>
        <Field label="ملاحظة" optional><textarea class="input" name="reason" rows="3" maxlength="500" dir="auto" placeholder="ليش رجع؟" autofocus /></Field>
        <label class="check-row"><input type="checkbox" name="restoreRole" checked /><span><b>رجّع له رتبة الستاف</b><small>البوت يعطيه الرتبة في ديسكورد مباشرة.</small></span></label>
      </form>
    ),
    footer: close => [<Button variant="ghost" onClick={close}>إلغاء</Button>, <Button variant="primary" icon="refresh-circle" data-submit onClick={() => (document.getElementById('reinstateForm') as HTMLFormElement | null)?.requestSubmit()}>إلغاء الفصل</Button>],
  });
}

// ───── التعديلات الأخرى ─────
function formModal(options: { title: string; description: string; icon: string; submit: string; tone?: Tone; fields: Child; onSubmit: (data: FormData) => Promise<void> }) {
  const id = `fm-${Math.random().toString(36).slice(2, 7)}`;
  openModal({
    title: options.title,
    description: options.description,
    icon: options.icon,
    tone: options.tone,
    body: close => (
      <form class="form-stack" id={id} onSubmit={async (event: Event) => {
        event.preventDefault();
        const form = event.currentTarget as HTMLFormElement;
        const button = form.closest('.ov-panel')?.querySelector<HTMLButtonElement>('[data-submit]');
        await busy(button, async () => {
          try { await options.onSubmit(new FormData(form)); close(); } catch (error) { toastError(error); }
        });
      }}>{options.fields}</form>
    ),
    footer: close => [<Button variant="ghost" onClick={close}>إلغاء</Button>, <Button variant={options.tone === 'danger' ? 'danger' : 'primary'} data-submit onClick={() => (document.getElementById(id) as HTMLFormElement | null)?.requestSubmit()}>{options.submit}</Button>],
  });
}

export function editProfileDialog(member: StaffRow, onDone: () => void) {
  formModal({
    title: 'تعديل الملف', description: 'الرتبة والحالة اللي تظهر في ملفه.', icon: 'edit-2', submit: 'حفظ',
    fields: [
      <Field label="الرتبة"><input class="input" name="rank" value={member.rank ?? ''} placeholder="مثلاً: مشرف" autofocus /></Field>,
      <Field label="الحالة"><Select name="status" value={member.status ?? 'active'} options={[{ value: 'active', label: 'نشط' }, { value: 'on_leave', label: 'في إجازة' }, { value: 'retired', label: 'متقاعد' }, { value: 'suspended', label: 'موقوف' }]} /></Field>,
    ],
    onSubmit: async data => { await api(`/api/staff/${encodeURIComponent(member.userId)}`, { method: 'PATCH', body: { rank: data.get('rank'), status: data.get('status') } }); done(onDone, 'انحفظ الملف'); },
  });
}

export function noteDialog(member: StaffRow, onDone: () => void) {
  formModal({
    title: `ملاحظة خاصة على ${nameOf(member)}`, description: 'تنحفظ في ملفه وتشوفها الإدارة فقط.', icon: 'note-text', submit: 'إضافة الملاحظة',
    fields: <Field label="الملاحظة"><textarea class="input" name="text" rows="5" maxlength="1000" required dir="auto" placeholder="اكتب ملاحظتك…" autofocus /></Field>,
    onSubmit: async data => { await api(`/api/staff/${encodeURIComponent(member.userId)}/notes`, { method: 'POST', body: { text: data.get('text') } }); done(onDone, 'انضافت الملاحظة'); },
  });
}

export function adjustDialog(member: StaffRow, onDone: () => void) {
  formModal({
    title: 'تعديل الإحصائيات', description: 'تحديد النقاط وساعات الشفت يدويًا. (لإضافة أو خصم نقاط مع سبب استخدم صفحة النقاط.)', icon: 'sort', submit: 'حفظ',
    fields: (
      <div class="form-grid">
        <Field label="النقاط"><input class="input" name="points" type="number" min="0" value={String(member.points ?? 0)} /></Field>
        <Field label="ساعات الشفت" hint="ينحذف سجل الشفتات ويتحول لرقم واحد."><input class="input" name="shiftHours" type="number" min="0" step="0.1" value={fixed(member.shiftHours ?? 0)} /></Field>
      </div>
    ),
    onSubmit: async data => {
      const body: Record<string, number> = { points: Number(data.get('points') || 0) };
      if (Number(data.get('shiftHours')) !== Number(fixed(member.shiftHours ?? 0))) body.shiftHours = Number(data.get('shiftHours') || 0);
      await api(`/api/staff/${encodeURIComponent(member.userId)}`, { method: 'PATCH', body });
      done(onDone, 'انحفظت الإحصائيات');
    },
  });
}

export async function resetStats(member: StaffRow, onDone: () => void) {
  const ok = await confirmDialog({ title: `تصفير كل بيانات ${nameOf(member)}؟`, message: 'تنمسح إحصائياته المحفوظة نهائيًا.', details: ['النقاط ونشاط الستاف', 'الرسائل والفويس وسجل الشفتات', 'الشكاوى والتقييمات'], confirmText: 'تصفير', typeToConfirm: 'تصفير' });
  if (!ok) return;
  try { await api(`/api/staff/${encodeURIComponent(member.userId)}/reset`, { method: 'POST' }); done(onDone, 'تم التصفير'); } catch (error) { toastError(error); }
}

export async function resetShiftHours(member: StaffRow, onDone: () => void) {
  const ok = await confirmDialog({ title: 'تصفير ساعات الشفت؟', message: `ينحذف سجل شفتات ${nameOf(member)} المحفوظ نهائيًا.`, confirmText: 'تصفير الساعات' });
  if (!ok) return;
  try { await api(`/api/staff/${encodeURIComponent(member.userId)}/reset-shift-hours`, { method: 'POST' }); done(onDone, 'انمسحت ساعات الشفت'); } catch (error) { toastError(error); }
}

export async function removeStaff(member: StaffRow, onDone: () => void) {
  const ok = await confirmDialog({ title: `إزالة ${nameOf(member)} من الستاف؟`, message: 'تنشال رتبة الستاف في ديسكورد ويتعطل ملفه.', details: ['سجله ونقاطه وتقييماته تبقى محفوظة', 'تقدر ترجعه بعدين'], confirmText: 'إزالة' });
  if (!ok) return;
  try { await api(`/api/staff/${encodeURIComponent(member.userId)}`, { method: 'DELETE' }); done(onDone, 'انشال العضو من الستاف'); } catch (error) { toastError(error); }
}

/** قائمة الإدارة لعضو (زر "⋯"). */
export function manageMenu(anchor: HTMLElement, member: StaffRow, onDone: () => void, extra: { openProfile?: () => void } = {}) {
  openMenu(anchor, [
    ...(extra.openProfile ? [{ label: 'الملف السريع', icon: 'eye', onClick: extra.openProfile }] : []),
    { label: 'الملف الكامل', icon: 'user-square', onClick: () => location.assign(`/p/${encodeURIComponent(member.userId)}`) },
    'sep' as const,
    { label: 'تعديل الملف', icon: 'edit-2', onClick: () => editProfileDialog(member, onDone) },
    { label: 'إضافة ملاحظة', icon: 'note-text', onClick: () => noteDialog(member, onDone) },
    { label: 'تعديل الإحصائيات', icon: 'sort', onClick: () => adjustDialog(member, onDone) },
    { label: 'تصفير ساعات الشفت', icon: 'timer-pause', onClick: () => void resetShiftHours(member, onDone) },
    { label: 'تصفير كل البيانات', icon: 'refresh-circle', danger: true, onClick: () => void resetStats(member, onDone) },
    'sep' as const,
    member.dismissed
      ? { label: 'إلغاء الفصل', icon: 'refresh-circle', onClick: () => reinstateDialog(member, onDone) }
      : { label: 'فصل', icon: 'user-remove', danger: true, onClick: () => dismissDialog(member, onDone) },
    { label: 'إزالة من الستاف', icon: 'trash', danger: true, onClick: () => void removeStaff(member, onDone) },
  ]);
}

// ───── الملف السريع (درج) ─────
const shiftHoursOf = (shift: any) => {
  const start = new Date(shift.startedAt).getTime();
  const end = new Date(shift.endedAt || Date.now()).getTime();
  const breaks = (shift.breaks ?? []).reduce((sum: number, item: any) => sum + Math.max(0, new Date(item.endedAt || shift.endedAt || Date.now()).getTime() - new Date(item.startedAt).getTime()), 0);
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start - breaks) / 3_600_000 : 0;
};

export function openStaffDrawer(member: StaffRow, data: any, opts: { admin: boolean; onChanged: () => void }) {
  const ratings = (data.ratings ?? []).filter((item: any) => item.staffUserId === member.userId);
  const shifts = (data.shifts ?? []).filter((item: any) => item.userId === member.userId).sort((a: any, b: any) => +new Date(b.startedAt) - +new Date(a.startedAt)).slice(0, 12);
  const assists = (data.assistances ?? []).filter((item: any) => item.staffUserId === member.userId).slice(0, 12);
  const notes = [...(member.notes ?? [])].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  const state = staffState(member, data.leaves);
  const banner = cssUrl(member.banner);
  openDrawer({
    label: `ملف ${nameOf(member)}`,
    class: 'staff-drawer',
    body: close => (
      <div class="sd">
        <div class="sd-cover" style={banner ? { backgroundImage: banner } : undefined}>
          <button type="button" class="btn btn-ghost btn-icon sd-close" aria-label="إغلاق" onClick={close}><Icon name="x" size={20} /></button>
        </div>
        <div class="sd-id">
          <Avatar src={member.avatar} name={nameOf(member)} size={76} class="sd-avatar" />
          <div class="sd-name"><h2>{nameOf(member)}</h2><small>@{member.username ?? member.userId} · في الستاف من {date(member.joinedAt)}</small></div>
          <div class="sd-badges"><StateBadge state={state} />{member.rank ? <Badge tone="brand">{member.rank}</Badge> : null}{member.dismissed && member.dismissReason ? <Badge tone="danger" icon="info-circle">{member.dismissReason}</Badge> : null}</div>
        </div>
        <Meta items={[
          ['النقاط', <b class="num">{num(member.points)}</b>],
          ['ساعات الشفت', `${fixed(member.shiftHours)} س`],
          ['ساعات النشاط', `${fixed(member.activityHours)} س`],
          ['الفويس', `${fixed((member.voiceMinutes ?? 0) / 60)} س`],
          ['الرسائل', num(member.messageCount)],
          ['ساعد', `${num(member.claimed)} عضو`],
          ['التقييم', member.ratingCount ? `${fixed(member.averageRating)} / 5` : '—'],
          ['المقيّمين', num(member.ratingCount)],
        ]} />
        <section class="sd-section">
          <h3>توزيع التقييم</h3>
          <div class="rating-bars">{[5, 4, 3, 2, 1].map(score => {
            const n = ratings.filter((item: any) => item.rating === score).length;
            return <div class="rating-bar"><span>{score} ★</span><Progress value={ratings.length ? (n / ratings.length) * 100 : 0} tone={score >= 4 ? 'success' : score === 3 ? 'warning' : 'danger'} /><b>{n}</b></div>;
          })}</div>
        </section>
        <section class="sd-section">
          <h3>آخر التقييمات <small>{num(ratings.length)}</small></h3>
          {ratings.length ? <div class="stack">{ratings.slice(0, 8).map((rating: any) => (
            <div class="mini-card"><header><b>{rating.reviewerName || 'عضو'}</b><span class="stars" aria-label={`${rating.rating} من 5`}>{'★'.repeat(rating.rating)}<i>{'★'.repeat(5 - rating.rating)}</i></span></header><p dir="auto">{rating.comment || 'بدون تعليق.'}</p><small>{ago(rating.createdAt)}</small></div>
          ))}</div> : <Empty compact icon="star" title="ما فيه تقييمات بعد" />}
        </section>
        {opts.admin ? (
          <section class="sd-section">
            <h3>ملاحظات الإدارة <small>{num(notes.length)}</small></h3>
            {notes.length ? <div class="stack">{notes.map(note => <div class="mini-card"><p dir="auto">{note.text}</p><small>{note.addedBy} · {ago(note.createdAt)}</small></div>)}</div> : <Empty compact icon="note-text" title="ما فيه ملاحظات" />}
            <Button variant="soft" size="sm" icon="add" onClick={() => noteDialog(member, () => { close(); opts.onChanged(); })}>إضافة ملاحظة</Button>
          </section>
        ) : null}
        <section class="sd-section">
          <h3>مساعدة الأعضاء <small>{num(assists.length)}</small></h3>
          {assists.length ? <div class="stack">{assists.map((item: any) => <div class="mini-card"><header><b>ساعد {item.memberName || item.memberUserId}</b><small>{ago(item.createdAt)}</small></header>{item.note || item.type ? <p dir="auto">{item.note || item.type}</p> : null}</div>)}</div> : <Empty compact icon="people" title="ما فيه سجل مساعدة" />}
        </section>
        <section class="sd-section">
          <h3>آخر الشفتات</h3>
          {shifts.length ? <div class="stack">{shifts.map((shift: any) => (
            <div class="mini-card row"><span class={`status-dot ${shift.status === 'active' ? 'd-success pulse' : ''}`} /><div class="row-main"><b>{shift.status === 'active' ? 'شفت شغّال' : 'شفت منتهي'}</b><small>{date(shift.startedAt)} · {duration(shiftHoursOf(shift) * 60)} · {num(Number(shift.pointsAwarded || 0))} نقطة</small></div></div>
          ))}</div> : <Empty compact icon="alarm" title="ما فيه شفتات بعد" />}
        </section>
      </div>
    ),
    footer: close => [
      <Button variant="secondary" icon="user-square" href={`/p/${encodeURIComponent(member.userId)}`}>الملف الكامل</Button>,
      opts.admin ? <Button variant="primary" icon="setting-2" aria-haspopup="menu" onClick={(event: Event) => manageMenu(event.currentTarget as HTMLElement, member, () => { close(); opts.onChanged(); })}>إدارة</Button> : null,
    ],
  });
}
