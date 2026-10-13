// لوحة ملف عضو الستاف (من صفحة الستاف): غلاف بلون فئته، مؤشرات، تقدم للفئة التالية، نشاط 14 يوم، وتبويبات.
import type { Child } from '#jsx/jsx-runtime';
import { mount } from '#jsx/jsx-runtime';
import { api, ApiError, errorText } from '../lib/api';
import { live } from '../lib/dom';
import { ago, count, date, dateTime, duration, fixed, num, signed, weekday } from '../lib/format';
import { BarChart } from '../ui/chart';
import { Icon } from '../ui/Icon';
import { Avatar, Badge, Button, Empty, Progress, Seg, Skeleton, Tabs, busy } from '../ui/kit';
import { openDrawer, promptDialog, toast, toastError } from '../ui/overlay';
import { adjustDialog, dismissDialog, nameOf, noteDialog, reinstateDialog, resetStats, staffState, StateBadge, type StaffRow } from './staff-actions';
import { actionIcon, actionText } from '../lib/actions';

export const TIERS = [
  { name: 'برونزي', min: 0, color: '#b87333', to: '#8a4f22' },
  { name: 'فضي', min: 500, color: '#9aa4b5', to: '#5f6b80' },
  { name: 'ذهبي', min: 1500, color: '#e0b04f', to: '#b07a12' },
  { name: 'بلاتيني', min: 3000, color: '#5fc6c9', to: '#2d8a99' },
  { name: 'ماسي', min: 6000, color: '#8d80ff', to: '#5f4fe6' },
];
export function tierOf(points: number) {
  let index = 0;
  TIERS.forEach((tier, i) => { if (points >= tier.min) index = i; });
  const tier = TIERS[index]!;
  const next = TIERS[index + 1] ?? null;
  const progress = next ? ((points - tier.min) / (next.min - tier.min)) * 100 : 100;
  return { tier, next, progress };
}

const END: Record<string, [string, string]> = {
  SHIFT_ENDED: ['يدوي', 'muted'],
  SHIFT_AUTO_ENDED: ['تلقائي (خمول)', 'warning'],
  SHIFT_PRESENCE_TIMEOUT: ['لعدم الرد على «هل انت موجود؟»', 'danger'],
};

type Tab = 'overview' | 'shifts' | 'points' | 'notes' | 'log';

export function openStaffProfile(member: StaffRow, data: any, opts: { admin: boolean; onChanged: () => void }) {
  let profile: any = null;
  let failed = '';
  let tab: Tab = 'overview';
  let metric: 'shift' | 'messages' = 'shift';
  const state = staffState(member, data.leaves);
  const { tier, next, progress } = tierOf(member.points ?? 0);
  const changed = (close: () => void) => () => { close(); opts.onChanged(); };

  const kpis = live(() => {
    const s = profile?.stats ?? {};
    const tile = (icon: string, label: string, value: Child, tone = '') => <div class={`sp-kpi ${tone}`}><Icon name={icon} size={17} /><b class="num">{value}</b><small>{label}</small></div>;
    return [
      tile('medal-star', 'مجموع النقاط', num(member.points)),
      tile('calendar-tick', 'نقاط الأسبوع', profile ? num(s.weekPoints ?? member.weekPoints ?? 0) : '…'),
      tile('crown', 'الترتيب', profile && s.position ? `#${s.position}` : '—'),
      tile('alarm', 'ساعات الشفت', fixed(member.shiftHours)),
      tile('activity', 'ساعات الفويس', fixed((member.voiceMinutes ?? 0) / 60)),
      tile('message-text', 'الرسائل', num(member.messageCount)),
      tile('star', 'التقييم', member.ratingCount ? `${fixed(member.averageRating)}★` : '—'),
      tile('danger', 'الشكاوى', num(member.complaintCount ?? s.complaints ?? 0), (member.complaintCount ?? 0) > 0 ? 'warn' : ''),
      tile('warning-2', 'الإنذارات', profile ? `${num(s.warnings ?? 0)}/${num(s.warnLimit ?? 3)}` : '…', (s.warnings ?? 0) > 0 ? 'bad' : ''),
    ];
  }, { class: 'sp-kpis' });

  const chart = live(() => {
    if (!profile) return failed ? <Empty compact icon="chart-2" title="ما قدرنا نحمّل النشاط" text={failed} /> : <Skeleton lines={1} height={170} />;
    const days = (profile.days ?? []).slice(-14);
    if (!days.length) return <Empty compact icon="chart-2" title="ما فيه نشاط بعد" />;
    return <BarChart label="آخر 14 يوم" height={170} data={days.map((day: any) => { const d = new Date(`${day.date}T00:00:00Z`); return { label: `${d.getUTCDate()}/${d.getUTCMonth() + 1}`, value: metric === 'shift' ? (day.shiftMinutes ?? 0) / 60 : day.messages ?? 0, tip: weekday(`${day.date}T12:00:00Z`) }; })} format={v => (metric === 'shift' ? `${fixed(v)}س` : num(v))} />;
  });

  const endOf = (shift: any): [string, string] | null => {
    if (shift.status === 'active') return null;
    const key = shift.endReason || shift.endedBy;
    if (key && END[key]) return END[key];
    if (key === 'presence') return END.SHIFT_PRESENCE_TIMEOUT!;
    if (key === 'auto' || key === 'idle') return END.SHIFT_AUTO_ENDED!;
    const end = shift.endedAt ? new Date(shift.endedAt).getTime() : 0;
    const hit = (profile?.activity ?? []).find((item: any) => END[item.action] && end && Math.abs(new Date(item.createdAt).getTime() - end) < 5 * 60_000);
    return hit ? END[hit.action]! : END.SHIFT_ENDED!;
  };

  const panel = live(() => {
    if (!profile) return failed ? null : <Skeleton lines={4} height={44} />;
    if (tab === 'overview') {
      const b = profile.pointsBreakdown;
      return [
        <div class="sp-card"><div class="sp-card-head"><h4>النشاط</h4><Seg size="sm" label="المقياس" value={metric} options={[{ value: 'shift', label: 'الشفت' }, { value: 'messages', label: 'الرسائل' }]} onChange={v => { metric = v as typeof metric; chart.update(); }} /></div>{chart.node}</div>,
        profile.profile?.bio ? <div class="sp-card"><h4>نبذة</h4><p dir="auto">{profile.profile.bio}</p></div> : null,
        b?.parts?.length ? <div class="sp-card"><h4>من وين جت النقاط</h4>{parts(b.parts)}</div> : null,
      ];
    }
    if (tab === 'shifts') {
      const rows = profile.shifts ?? [];
      return rows.length ? <div class="sp-list">{rows.map((shift: any) => { const end = endOf(shift); return (
        <div class="sp-row"><span class={`status-dot ${shift.status === 'active' ? 'd-success pulse' : ''}`} /><div class="row-main"><b>{weekday(shift.startedAt)}</b><small>{dateTime(shift.startedAt)}{shift.messages ? ` · ${num(shift.messages)} رسالة` : ''}{shift.points ? ` · ${num(shift.points)} نقطة` : ''}</small></div><b class="num">{duration(shift.minutes)}</b>{end ? <Badge tone={end[1] as any}>{end[0]}</Badge> : <Badge tone="success" dot>شغّال</Badge>}</div>
      ); })}</div> : <Empty compact icon="alarm" title="ما فيه شفتات بعد" />;
    }
    if (tab === 'points') {
      const ledger = (profile.activity ?? []).filter((item: any) => item.action === 'POINTS_ADJUSTED');
      return [
        profile.pointsBreakdown?.parts?.length ? <div class="sp-card"><h4>التوزيع</h4>{parts(profile.pointsBreakdown.parts)}</div> : null,
        <div class="sp-card"><h4>سجل التعديلات</h4>{ledger.length ? <div class="sp-list">{ledger.map((item: any) => <div class="sp-row"><b class={`num ${item.delta < 0 ? 'neg' : 'pos'}`}>{signed(item.delta)}</b><div class="row-main"><span dir="auto">{item.reason || 'بدون سبب'}</span><small>{ago(item.createdAt)}</small></div></div>)}</div> : <Empty compact icon="medal-star" title="ما فيه تعديلات يدوية" />}</div>,
      ];
    }
    if (tab === 'notes') {
      const warns = (profile.activity ?? []).filter((item: any) => item.action === 'WARNING_ISSUED' || item.action === 'STAFF_DISMISSED');
      const notes = [...(member.notes ?? [])];
      return [
        <div class="sp-card"><h4>الإنذارات <small>{num(profile.stats?.warnings ?? 0)}/{num(profile.stats?.warnLimit ?? 3)}</small></h4>{warns.length ? <div class="sp-list">{warns.map((item: any) => <div class="sp-row"><Icon name="warning-2" size={16} /><div class="row-main"><b>{actionText(item.action)}</b>{item.reason ? <span dir="auto">{item.reason}</span> : null}<small>{ago(item.createdAt)}</small></div></div>)}</div> : <Empty compact icon="shield-tick" title="سجله نظيف" />}</div>,
        opts.admin ? <div class="sp-card"><h4>ملاحظات الإدارة</h4>{notes.length ? <div class="sp-list">{notes.map(note => <div class="sp-row"><Icon name="note-text" size={16} /><div class="row-main"><span dir="auto">{note.text}</span><small>{note.addedBy} · {ago(note.createdAt)}</small></div></div>)}</div> : <Empty compact icon="note-text" title="ما فيه ملاحظات" />}</div> : null,
      ];
    }
    const log = profile.activity ?? [];
    return log.length ? <ol class="timeline">{log.map((item: any) => <li><span class="tl-icon"><Icon name={actionIcon(item.action)} size={15} /></span><div class="tl-body"><b>{actionText(item.action)}</b>{item.delta ? <small> · {signed(item.delta)} نقطة</small> : null}</div><time title={dateTime(item.createdAt)}>{ago(item.createdAt)}</time></li>)}</ol> : <Empty compact icon="activity" title="ما فيه أحداث" />;
  }, { class: 'sp-panel' });

  const warn = async (close: () => void) => {
    const reason = await promptDialog({ title: `إنذار ${nameOf(member)}`, message: 'ينحسب في عدد الإنذارات، وعند الحد يتفصل تلقائيًا.', label: 'سبب الإنذار', required: true, confirmText: 'إرسال الإنذار', danger: true, icon: 'warning-2' });
    if (reason === null) return;
    try { await api(`/api/staff/${encodeURIComponent(member.userId)}/warn`, { method: 'POST', body: { reason } }); toast('انرسل الإنذار'); changed(close)(); }
    catch (error) { toastError(error instanceof ApiError && error.status === 404 ? new Error('الإنذار من اللوحة مو متاح في السيرفر بعد. استخدم أمر /warn في ديسكورد.') : error); }
  };

  openDrawer({
    label: `ملف ${nameOf(member)}`,
    class: 'staff-sheet',
    size: 'lg',
    body: close => (
      <div class="sp-sheet">
        <div class="sp-cover" style={{ background: `linear-gradient(135deg, ${tier.color}, ${tier.to})` }}>
          <span class="sp-tier"><Icon name="crown" size={14} bold /> {tier.name}</span>
          <button type="button" class="btn btn-ghost btn-icon sp-close" aria-label="إغلاق" onClick={close}><Icon name="x" size={20} /></button>
        </div>
        <div class="sp-id">
          <Avatar src={member.avatar} name={nameOf(member)} size={84} class="sp-avatar" ring={member.active ? 'var(--success)' : undefined} />
          <div class="sp-name"><h2>{nameOf(member)}</h2><small>@{member.username ?? member.userId} · في الستاف من {date(member.joinedAt)}</small>
            <div class="sp-badges"><StateBadge state={state} />{member.rank ? <Badge tone="brand" icon="shield-tick">{member.rank}</Badge> : null}{member.dismissed && member.dismissReason ? <Badge tone="danger">{member.dismissReason}</Badge> : null}</div></div>
        </div>
        <div class="sp-progress"><div><b>{tier.name}</b><span>{next ? `باقي ${count(next.min - (member.points ?? 0), ['نقطة', 'نقطتين', 'نقاط', 'نقطة'])} لـ ${next.name}` : 'أعلى فئة'}</span></div><Progress value={progress} label="التقدم للفئة التالية" /></div>
        {kpis.node}
        <Tabs value={tab} class="sp-tabs" tabs={[{ value: 'overview', label: 'نظرة عامة' }, { value: 'shifts', label: 'الشفتات' }, { value: 'points', label: 'النقاط' }, { value: 'notes', label: 'الإنذارات والملاحظات' }, { value: 'log', label: 'السجل' }]} onChange={v => { tab = v as Tab; panel.update(); }} />
        {failed ? <Empty compact icon="danger" title="ما قدرنا نحمّل التفاصيل" text={failed} /> : null}
        {panel.node}
      </div>
    ),
    footer: close => opts.admin ? [
      <Button variant="secondary" size="sm" icon="sort" onClick={() => adjustDialog(member, changed(close))}>تعديل النقاط</Button>,
      <Button variant="secondary" size="sm" icon="warning-2" onClick={() => void warn(close)}>إنذار</Button>,
      <Button variant="secondary" size="sm" icon="note-text" onClick={() => noteDialog(member, changed(close))}>ملاحظة</Button>,
      <Button variant="secondary" size="sm" icon="refresh-circle" onClick={() => void resetStats(member, changed(close))}>تصفير</Button>,
      member.dismissed ? <Button variant="primary" size="sm" icon="refresh-circle" onClick={() => reinstateDialog(member, changed(close))}>الغاء فصل</Button> : <Button variant="danger" size="sm" icon="user-remove" onClick={() => dismissDialog(member, changed(close))}>فصل</Button>,
      <Button variant="ghost" size="sm" icon="user-square" href={`/p/${encodeURIComponent(member.userId)}`}>الملف الكامل</Button>,
    ] : [<Button variant="primary" icon="user-square" href={`/p/${encodeURIComponent(member.userId)}`}>الملف الكامل</Button>],
  });

  api(`/api/profile/${encodeURIComponent(member.userId)}`).then(result => { profile = result; kpis.update(); panel.update(); }).catch(error => { failed = errorText(error); panel.update(); chart.update(); });
  void busy;
}

function parts(list: any[]): Child {
  const NAMES: Record<string, string> = { shift: 'وقت الشفت', messages: 'الرسائل في الشفت', voice: 'الفويس', assist: 'مساعدة الأعضاء', rating: 'التقييمات', modreport: 'تقارير المود', complaint: 'الشكاوى', manual: 'تعديلات يدوية' };
  const items = list.filter(part => part.points !== 0);
  const max = Math.max(1, ...items.map(part => Math.abs(part.points)));
  return <ul class="parts">{items.map(part => <li class={part.points < 0 ? 'neg' : ''}><span class="part-label">{NAMES[part.key] ?? part.key}</span><span class="part-bar"><i style={{ width: `${Math.round((Math.abs(part.points) / max) * 100)}%` }} /></span><b class="num">{signed(part.points)}</b></li>)}</ul>;
}

export { mount };
