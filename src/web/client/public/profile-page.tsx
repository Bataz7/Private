// صفحة ملف عضو الستاف (/p/:name): الغلاف والهوية، الأرقام، النشاط، الأوسمة، التقييمات، الشفتات والتعليقات.
import type { Child } from '#jsx/jsx-runtime';
import { mount } from '#jsx/jsx-runtime';
import { api, errorText } from '../lib/api';
import { copyText, cssUrl, live, safeColor, safeUrl } from '../lib/dom';
import { ago, count, date, dateTime, dayUTC, duration, fixed, num, signed, time, weekday } from '../lib/format';
import { Heatmap, MiniBars, BarChart } from '../ui/chart';
import { Icon } from '../ui/Icon';
import { Avatar, Badge, Button, Card, Empty, ErrorState, Field, PageSkeleton, Progress, Seg, Tabs, Toggle, busy } from '../ui/kit';
import { openMenu, openModal, toast, toastError } from '../ui/overlay';
import { logout } from '../shell/shell';

const SWATCHES = ['#8175f5', '#5b9be0', '#d9a441', '#6db4d4', '#8ea6f2', '#38c4b5', '#6fcf8a', '#f0866a', '#ff7a2f', '#e86ab0'];
const BADGES: Record<string, [string, string, string]> = {
  top: ['الأول على الفريق', 'المركز الأول في ترتيب الستاف', 'crown'],
  streak: ['ما يوقف', 'نشيط 7 أيام ورا بعض', 'flash'],
  marathon: ['ماراثون', 'شفت واحد 4 ساعات أو أكثر', 'timer-start'],
  helper: ['المساعد', 'ساعد 25 عضو', 'people'],
  loved: ['محبوب', '5 تقييمات أو أكثر بمعدل 4.5', 'like-1'],
  reporter: ['عين ساهرة', '10 تقارير مود مقبولة', 'shield-tick'],
  chatty: ['موجود دايم', '1,000 رسالة في السيرفر', 'message-text'],
  veteran: ['من القدامى', '90 يوم في الفريق', 'award'],
};
const PARTS: Record<string, [string, string]> = {
  shift: ['وقت الشفت', 'clock'], messages: ['الرسائل في الشفت', 'message-text'], voice: ['الفويس في الشفت', 'activity'], assist: ['مساعدة الأعضاء', 'people'],
  rating: ['التقييمات', 'star'], modreport: ['تقارير المود', 'shield-tick'], complaint: ['الشكاوى', 'danger'], manual: ['تعديلات يدوية ونقاط قديمة', 'edit-2'],
};
const ACTIONS: Record<string, string> = {
  SHIFT_STARTED: 'بدأ شفت', SHIFT_STARTED_AUTOMATICALLY: 'بدأ الشفت تلقائيًا', SHIFT_ENDED: 'أنهى شفت', SHIFT_AUTO_ENDED: 'انتهى الشفت تلقائيًا (خمول)', BREAK_STARTED: 'بدأ بريك', BREAK_RESUMED: 'رجع من البريك', BREAK_AUTO_ENDED: 'انتهى البريك تلقائيًا',
  ASSISTANCE_RECORDED: 'ساعد عضو', MOD_REPORT_SUBMITTED: 'قدّم تقرير مود', LEAVE_REQUESTED: 'طلب إجازة', LEAVE_APPROVED: 'انقبلت إجازته', LEAVE_STARTED: 'بدأت إجازته', LEAVE_EXTENDED: 'مدّد الإجازة', RETURNED_FROM_LEAVE: 'رجع من الإجازة',
  RESIGNATION_REQUESTED: 'قدّم استقالة', RESIGNATION_CONFIRMED: 'تأكدت الاستقالة', RESIGNATION_WITHDRAWN: 'سحب الاستقالة', COMPLAINT_REVIEWED: 'انراجعت شكوى', REPORT_SUBMITTED: 'قدّم تقرير', REPORT_REVIEWED: 'انراجع تقرير', POINTS_ADJUSTED: 'تعديل نقاط',
  STAFF_DISMISSED: 'فصل', STAFF_REINSTATED: 'الغاء فصل', STAFF_SYNCED: 'مزامنة الستاف', STAFF_WIPED: 'مسح وإعادة تسجيل الستاف', SHIFT_PRESENCE_TIMEOUT: 'انتهى الشفت لعدم الرد على «هل انت موجود؟»', WARNING_ISSUED: 'أخذ إنذار',
};
const ACTION_ICON: Record<string, string> = { SHIFT: 'alarm', BREAK: 'timer-pause', LEAVE: 'briefcase', RETURNED: 'briefcase', RESIGNATION: 'logout-01', REPORT: 'document-text', MOD: 'shield-tick', COMPLAINT: 'danger', ASSISTANCE: 'people', POINTS: 'medal-star', STAFF: 'user-remove', WARNING: 'warning-2' };
const BRAND_ICON_FALLBACK: Record<string, string> = { xbox: 'game', battlenet: 'game', domain: 'global' };

const onAccent = (hex: string) => { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.6 ? '#0a0d12' : '#ffffff'; };
const Stars = ({ value }: { value: number }) => { const on = Math.round(value); return <span class="stars" role="img" aria-label={`${fixed(value)} من 5`}>{'★'.repeat(on)}<i>{'★'.repeat(5 - on)}</i></span>; };

type TabKey = 'overview' | 'feedback' | 'activity' | 'shifts';

export async function renderProfile(root: HTMLElement, identifier: string, viewerId: string) {
  mount(root, <PageSkeleton />);
  let data: any;
  try {
    data = await api(`/api/profile/${encodeURIComponent(identifier || 'me')}`);
  } catch (error) {
    mount(root, <ErrorState title="ما قدرنا نفتح هذا الملف" message={errorText(error)} onRetry={() => void renderProfile(root, identifier, viewerId)} />);
    return;
  }
  if (data.member?.username && location.pathname.toLowerCase() !== `/p/${String(data.member.username).toLowerCase()}`) history.replaceState(null, '', `/p/${encodeURIComponent(data.member.username)}${location.hash}`);
  draw(root, data, viewerId);
}

function draw(root: HTMLElement, data: any, viewerId: string) {
  const { member, profile, stats, level, social } = data;
  document.title = `${member.displayName} (@${member.username}) · Rift`;
  const accent = safeColor(profile.accent);
  root.setAttribute('style', accent ? `--brand:${accent};--chart:${accent};--brand-ink:${accent};--on-brand:${onAccent(accent)};--brand-soft:color-mix(in srgb, ${accent} 16%, transparent);--brand-softer:color-mix(in srgb, ${accent} 8%, transparent)` : '');
  const banner = cssUrl(profile.bannerUrl || member.discordBanner);
  let tab: TabKey = (['overview', 'feedback', 'activity', 'shifts'] as const).find(key => `#${key}` === location.hash) ?? 'overview';
  let metric: 'shift' | 'messages' = 'shift';
  const status = data.status ?? {};
  const reload = () => void renderProfile(root, member.userId, viewerId);

  const pill = status.onShift
    ? <Badge tone={status.onBreak ? 'warning' : 'success'} dot>{status.onBreak ? 'في بريك' : 'في الشفت الحين'}</Badge>
    : status.lastSeenAt ? <Badge tone="muted" dot>آخر نشاط {ago(status.lastSeenAt)}</Badge> : null;

  const rep = live(() => (
    <Button variant={social.hasRep ? 'primary' : 'secondary'} icon="like-1" aria-pressed={String(Boolean(social.hasRep))} disabled={data.isSelf} title={data.isSelf ? 'ما تقدر تعطي نفسك ريب' : 'أعطه ريب'}
      onClick={async (event: Event) => {
        await busy(event.currentTarget as HTMLButtonElement, async () => {
          try { const result = await api(`/api/profile/${encodeURIComponent(member.userId)}/rep`, { method: 'POST' }); social.hasRep = result.hasRep; social.reps = result.reps; rep.update(); }
          catch (error) { toastError(error, 'ما قدرنا نحدّث الريب'); }
        });
      }}>ريب {num(social.reps)}</Button>
  ), { class: 'contents' }, 'span');

  const chart = live(() => chartBody(data, metric));
  const panel = live(() => (tab === 'overview' ? overview() : tab === 'feedback' ? feedback(data) : tab === 'activity' ? activity(data) : shifts(data)));

  function overview(): Child {
    const mod = stats.modReports ?? { total: 0, approved: 0, approvalRate: null };
    return [
      <div class="pp-tiles">
        <div class="pp-tile"><span class="pp-tile-label">النقاط</span><strong>{num(stats.points)}</strong><Progress value={Math.max(4, Math.round((level?.progress ?? 0) * 100))} label="التقدم للمستوى التالي" /><small>باقي {num(level?.toNext ?? 0)} للمستوى {num((level?.level ?? 1) + 1)}</small></div>
        <div class="pp-tile"><span class="pp-tile-label">وقت الشفت</span><strong>{fixed(stats.shiftHours)}<small>س</small></strong><small>{stats.shiftCount ? `${count(stats.shiftCount, ['شفت واحد', 'شفتين', 'شفتات', 'شفت'])} · المتوسط ${duration(stats.avgShiftMinutes)}` : 'ما فيه شفتات بعد'}</small></div>
        <div class="pp-tile"><span class="pp-tile-label">التقييم</span><strong>{stats.ratingCount ? fixed(stats.averageRating) : '—'}</strong><Stars value={stats.averageRating ?? 0} /><small>{count(stats.ratingCount ?? 0, ['تقييم واحد', 'تقييمين', 'تقييمات', 'تقييم'])}</small></div>
        <div class="pp-tile"><span class="pp-tile-label">الرسائل</span><strong>{num(stats.messages)}</strong><MiniBars values={(data.days ?? []).slice(-14).map((day: any) => day.messages ?? 0)} /><small>آخر 30 يوم: {num(stats.messages30)}</small></div>
      </div>,
      <div class="pp-stats">
        {stat('flash', 'أيام متواصلة', num(stats.streak), 'يوم')}
        {stat('calendar-tick', 'أيام النشاط', `${num(stats.activeDays30)}/30`, 'من آخر 30 يوم')}
        {stat('people', 'مساعدة الأعضاء', num(stats.assists))}
        {stat('shield-tick', 'تقارير المود', num(mod.total), mod.total ? (mod.approvalRate === null || mod.approvalRate === undefined ? '' : `${mod.approved} مقبول · ${mod.approvalRate}%`) : 'ما فيه بعد')}
        {stat('timer-start', 'أطول شفت', duration(stats.longestShiftMinutes), stats.shiftCount ? `المتوسط ${duration(stats.avgShiftMinutes)}` : '')}
        {stat('activity', 'وقت الفويس', `${fixed(stats.voiceHours)} س`)}
        {stats.complaints === null || stats.complaints === undefined ? stat('calendar', 'المدة في الفريق', num(stats.tenureDays), 'يوم') : stat('danger', 'الشكاوى المقبولة', num(stats.complaints))}
        {stat('crown', 'الترتيب', stats.position ? `#${stats.position}` : '—', stats.totalStaff ? `من ${num(stats.totalStaff)} ستاف` : '')}
        {typeof stats.weekPoints === 'number' ? stat('medal-star', 'نقاط هذا الأسبوع', num(stats.weekPoints)) : null}
        {typeof stats.warnings === 'number' ? stat('warning-2', 'الإنذارات', `${num(stats.warnings)}${stats.warnLimit ? `/${stats.warnLimit}` : ''}`) : null}
      </div>,
      <Card title="النشاط" icon="chart-2" actions={<Seg size="sm" label="المقياس" value={metric} options={[{ value: 'shift', label: 'وقت الشفت' }, { value: 'messages', label: 'الرسائل' }]} onChange={value => { metric = value as typeof metric; chart.update(); }} />}>{chart.node}</Card>,
      pointsPanel(data),
      <Card title="الأوسمة" icon="award" actions={<Badge tone="brand">{num((data.badges ?? []).filter((b: any) => b.value >= b.goal).length)}/{num((data.badges ?? []).length)}</Badge>}>
        <div class="pp-badges">{(data.badges ?? []).map((badge: any) => {
          const [name, text, icon] = BADGES[badge.key] ?? [badge.key, '', 'award'];
          const earned = badge.value >= badge.goal;
          return <div class={`pp-badge ${earned ? 'is-earned' : ''}`} title={text}><span class="pp-badge-ico"><Icon name={icon} size={20} bold={earned} /></span><b>{name}</b><small>{text}</small>{earned ? <Badge tone="success" icon="tick-circle">مكتسب</Badge> : <><Progress value={Math.min(100, (badge.value / badge.goal) * 100)} /><em class="num">{num(Math.min(badge.value, badge.goal))}/{num(badge.goal)}</em></>}</div>;
        })}</div>
      </Card>,
    ];
  }

  const connections = [
    ...(data.connections ?? []).map((item: any) => ({ type: item.type, title: item.type, sub: item.name, url: safeUrl(item.url), verified: item.verified })),
    ...(profile.links ?? []).map((item: any) => { const url = safeUrl(item.url); return url ? { type: 'link', title: item.label || new URL(url).hostname.replace(/^www\./, ''), sub: new URL(url).hostname.replace(/^www\./, ''), url, verified: false } : null; }).filter(Boolean),
  ];
  const brands = live(() => null);

  mount(root, [
    <section class="pp-hero">
      <div class="pp-banner" style={banner ? { backgroundImage: banner } : undefined}>
        <span class="pp-views"><Icon name="eye" size={15} /> {num(social.views)} مشاهدة</span>
      </div>
      <div class="pp-id">
        <Avatar src={member.avatar} name={member.displayName} size={112} class="pp-avatar" ring={status.onShift ? (status.onBreak ? 'var(--warning)' : 'var(--success)') : undefined} />
        <div class="pp-name">
          <h1>{member.displayName}</h1>
          <p class="pp-handle">@{member.username}{member.rank ? <span> · {member.rank}</span> : null}</p>
          <div class="pp-pills">{pill}{data.dismissed || member.dismissed ? <Badge tone="danger" icon="user-remove">مفصول</Badge> : null}</div>
          {profile.tagline ? <p class="pp-tagline" dir="auto">{profile.tagline}</p> : null}
        </div>
        <div class="pp-actions">
          {rep.node}
          {data.isSelf ? <Button variant="secondary" icon="edit-2" onClick={() => editDialog(data, reload)}>تعديل الملف</Button> : null}
          <Button variant="ghost" icon="more" aria-label="المزيد" aria-haspopup="menu" onClick={(event: Event) => openMenu(event.currentTarget as HTMLElement, [
            { label: 'نسخ رابط الملف', icon: 'link', onClick: async () => toast((await copyText(`${location.origin}/p/${encodeURIComponent(member.username)}`)) ? 'انسخ رابط الملف' : 'ما قدرنا ننسخ الرابط', 'info') },
            { label: 'قائمة الستاف', icon: 'people', onClick: () => location.assign('/dashboard/staff') },
            { label: 'تسجيل الخروج', icon: 'logout-01', danger: true, onClick: () => void logout() },
          ])} />
        </div>
      </div>
      <div class="pp-counts">
        <span><b>{num(stats.points)}</b>نقطة</span>
        <span><b>{stats.ratingCount ? fixed(stats.averageRating) : '—'}</b>التقييم</span>
        <span><b>{num(level?.level ?? 1)}</b>المستوى</span>
        {stats.position ? <span><b>#{stats.position}</b>الترتيب</span> : null}
        <span><b>{num(social.reps)}</b>ريب</span>
      </div>
    </section>,
    <div class="pp-grid">
      <div class="pp-main">
        <Card title="نبذة" icon="user-square" class="pp-about" actions={connections.length ? <div class="pp-conns">{connections.map((item: any) => {
          const label = `${item.title}: ${item.sub}${item.verified ? ' (موثّق)' : ''}`;
          const icon = <BrandIcon type={item.type} />;
          return item.url ? <a class="pp-conn" href={item.url} target="_blank" rel="noopener noreferrer nofollow" aria-label={label} title={label}>{icon}</a> : <span class="pp-conn" tabindex="0" aria-label={label} title={label}>{icon}</span>;
        })}</div> : null}>
          {profile.bio ? <p class="pp-bio" dir="auto">{profile.bio}</p> : <p class="pp-bio muted">{data.isSelf ? 'اكتب نبذة قصيرة عشان فريقك يعرفك.' : 'ما فيه نبذة بعد.'}</p>}
          <div class="pp-meta"><span><Icon name="calendar" size={16} /> انضم {member.joinedAt ? date(member.joinedAt) : '—'}</span><span><Icon name="clock" size={16} /> {num(stats.tenureDays)} يوم في الفريق</span></div>
          {data.isSelf && !(data.connections ?? []).length && data.connectionsRequiresAuth ? <p class="pp-hint"><Icon name="link" size={15} /> ما انربطت حساباتك بعد. <a href="/auth/discord">سجّل دخول من جديد</a> واسمح بالوصول للحسابات المربوطة.</p> : null}
          {data.connectionsHidden ? <p class="pp-hint">هذا العضو أخفى حساباته المربوطة.</p> : null}
          {brands.node}
        </Card>
        <Tabs value={tab} tabs={[{ value: 'overview', label: 'نظرة عامة', icon: 'home' }, { value: 'feedback', label: 'التقييمات', icon: 'star', count: stats.ratingCount }, { value: 'activity', label: 'النشاط', icon: 'activity' }, { value: 'shifts', label: 'الشفتات', icon: 'alarm' }]} onChange={value => { tab = value as TabKey; history.replaceState(null, '', `${location.pathname}#${tab}`); panel.update(); }} />
        {panel.node}
      </div>
      <aside class="pp-side">{comments(data)}</aside>
    </div>,
  ]);
  if (location.hash === '#edit' && data.isSelf) { history.replaceState(null, '', location.pathname); editDialog(data, reload); }
}

const stat = (icon: string, label: string, value: Child, sub?: Child) => (
  <div class="pp-stat"><span class="pp-stat-ico"><Icon name={icon} size={18} /></span><div><strong>{value}</strong><span>{label}</span>{sub ? <small>{sub}</small> : null}</div></div>
);

function BrandIcon({ type }: { type: string }) {
  return <span class="brand-ico" data-brand={type}>{brandSvg(type)}</span>;
}
let brandData: Record<string, [string, string]> | null = null;
function brandSvg(type: string): Child {
  if (type === 'link') return <Icon name="link" size={18} />;
  if (!brandData) {
    void import('../ui/brand-data').then(module => { brandData = module.BRANDS; document.querySelectorAll<HTMLElement>('.brand-ico[data-brand]').forEach(el => { const svg = brandSvg(el.dataset.brand!); mount(el, svg); }); });
    return <Icon name={BRAND_ICON_FALLBACK[type] ?? 'link'} size={18} />;
  }
  const brand = brandData[type];
  return brand ? <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={brand[1]} /></svg> : <Icon name={BRAND_ICON_FALLBACK[type] ?? 'link'} size={18} />;
}

function chartBody(data: any, metric: 'shift' | 'messages'): Child {
  const days: any[] = data.days ?? [];
  if (!days.length) return <Empty compact icon="chart-2" title="ما فيه نشاط بعد" />;
  const value = (day: any) => (metric === 'shift' ? day.shiftMinutes ?? 0 : day.messages ?? 0);
  const show = (amount: number) => (metric === 'shift' ? duration(amount) : `${num(amount)} رسالة`);
  const last = days.slice(-14);
  const total = last.reduce((sum, day) => sum + value(day), 0);
  return [
    <BarChart label="آخر 14 يوم" height={190} data={last.map(day => { const d = new Date(`${day.date}T00:00:00Z`); return { label: `${d.getUTCDate()}/${d.getUTCMonth() + 1}`, value: metric === 'shift' ? value(day) / 60 : value(day), tip: weekday(`${day.date}T12:00:00Z`) }; })} format={amount => (metric === 'shift' ? `${fixed(amount)}س` : num(amount))} />,
    <p class="chart-foot">المجموع خلال 14 يوم: <b>{show(total)}</b></p>,
    <h4 class="sub-title">آخر 12 أسبوع</h4>,
    <Heatmap days={days} value={value} tip={(day: any) => `${dayUTC(`${day.date}T00:00:00Z`)}: ${show(value(day))}`} />,
  ];
}

function pointsPanel(data: any): Child {
  const breakdown = data.pointsBreakdown;
  if (!breakdown) return null;
  const parts = (breakdown.parts ?? []).filter((part: any) => part.points !== 0);
  const max = Math.max(1, ...parts.map((part: any) => Math.abs(part.points)));
  return (
    <Card title={data.isSelf ? 'من وين جت نقاطك' : `من وين جت نقاط ${data.member.displayName}`} icon="medal-star" actions={<Button variant="ghost" size="sm" href="/dashboard/points" iconEnd="arrow-right-01" flipIcon>التفاصيل</Button>}>
      {parts.length ? <ul class="parts">{parts.map((part: any) => {
        const [label, icon] = PARTS[part.key] ?? [part.key, 'star'];
        return <li class={part.points < 0 ? 'neg' : ''}><span class="part-ico"><Icon name={icon} size={16} /></span><span class="part-label">{label}</span><span class="part-bar"><i style={{ width: `${Math.round((Math.abs(part.points) / max) * 100)}%` }} /></span><b class="num">{signed(part.points)}</b></li>;
      })}</ul> : <Empty compact icon="medal-star" title="ما فيه نقاط بعد" />}
    </Card>
  );
}

function feedback(data: any): Child {
  const { stats } = data;
  if (data.feedbackHidden) return <Empty icon="lock" title="التقييمات خاصة" text={`${data.member.displayName} اختار ما يعرض التقييمات للجميع.`} />;
  if (!stats.ratingCount) return <Empty icon="star" title="ما فيه تقييمات بعد" text="تقييمات الأعضاء بتطلع هنا." />;
  const dist = stats.distribution ?? {};
  return [
    <Card class="pp-rating">
      <div class="pp-rating-main"><strong>{fixed(stats.averageRating)}</strong><Stars value={stats.averageRating} /><small>{count(stats.ratingCount, ['تقييم واحد', 'تقييمين', 'تقييمات', 'تقييم'])}</small></div>
      <div class="rating-bars">{[5, 4, 3, 2, 1].map(n => <div class="rating-bar"><span>{n} ★</span><Progress value={((dist[n] ?? 0) / stats.ratingCount) * 100} tone={n >= 4 ? 'success' : n === 3 ? 'warning' : 'danger'} /><b>{num(dist[n] ?? 0)}</b></div>)}</div>
    </Card>,
    <div class="stack mt-sm">{(data.feedback ?? []).map((item: any) => (
      <article class="mini-card"><header><b>{item.reviewerName || 'عضو'}</b><Stars value={item.rating} /><time title={dateTime(item.createdAt)}>{ago(item.createdAt)}</time></header>{item.comment ? <p dir="auto">{item.comment}</p> : <p class="muted">قيّم بدون تعليق.</p>}</article>
    ))}</div>,
  ];
}

function activity(data: any): Child {
  if (!(data.activity ?? []).length) return <Empty icon="activity" title="ما فيه نشاط بعد" text="الشفتات والبريكات ومساعدة الأعضاء تبني الخط الزمني هنا." />;
  return (
    <Card flush>
      <ol class="timeline">{data.activity.map((item: any) => (
        <li><span class="tl-icon"><Icon name={ACTION_ICON[String(item.action).split('_')[0]!] ?? 'activity'} size={16} /></span>
          <div class="tl-body"><b>{ACTIONS[item.action] ?? String(item.action).toLowerCase().replace(/_/g, ' ')}</b>{item.action === 'POINTS_ADJUSTED' ? <small class={item.delta < 0 ? 'neg' : 'pos'}> · {signed(item.delta)} نقطة{item.reason ? <> · <span dir="auto">{item.reason}</span></> : null}</small> : null}</div>
          <time title={dateTime(item.createdAt)}>{ago(item.createdAt)}</time></li>
      ))}</ol>
    </Card>
  );
}

function shifts(data: any): Child {
  if (!(data.shifts ?? []).length) return <Empty icon="alarm" title="ما فيه شفتات بعد" text="الشفتات المنتهية تنعرض هنا مع مدتها." />;
  return (
    <Card flush>
      <div class="divided">{data.shifts.map((shift: any) => (
        <div class="line-item">
          <span class={`status-dot ${shift.status === 'active' ? 'd-success pulse' : ''}`} />
          <div class="row-main"><b>{weekday(shift.startedAt)}</b><small>{time(shift.startedAt)}{shift.messages ? ` · ${num(shift.messages)} رسالة` : ''}{shift.points ? ` · ${num(shift.points)} نقطة` : ''}</small></div>
          <b class="num">{duration(shift.minutes)}</b>
          <Badge tone={shift.status === 'active' ? 'success' : 'muted'}>{shift.status === 'active' ? 'شغّال الحين' : 'منتهي'}</Badge>
        </div>
      ))}</div>
    </Card>
  );
}

function comments(data: any): Child {
  let rows: any[] = [...(data.comments ?? [])];
  const list = live(() => rows.length ? rows.map(comment => (
    <article class="comment">
      <Avatar src={comment.authorAvatar} name={comment.authorName} size={34} />
      <div class="comment-body">
        <header>{comment.authorUsername ? <a href={`/p/${encodeURIComponent(comment.authorUsername)}`}>{comment.authorName}</a> : <b>{comment.authorName}</b>}<time title={dateTime(comment.createdAt)}>{ago(comment.createdAt)}</time>
          {comment.canDelete ? <button type="button" class="btn btn-ghost btn-icon btn-sm" aria-label="حذف التعليق" title="حذف" onClick={async (event: Event) => {
            await busy(event.currentTarget as HTMLButtonElement, async () => {
              try { await api(`/api/profile/comments/${encodeURIComponent(comment.id)}`, { method: 'DELETE' }); rows = rows.filter(item => item.id !== comment.id); data.social.commentCount = Math.max(0, data.social.commentCount - 1); list.update(); counter.update(); }
              catch (error) { toastError(error, 'ما قدرنا نحذف التعليق'); }
            });
          }}><Icon name="trash" size={15} /></button> : null}
        </header>
        <p dir="auto">{comment.text}</p>
      </div>
    </article>
  )) : <Empty compact icon="message-text" title="ما فيه تعليقات بعد" text="كن أول واحد يكتب شي لطيف." />, { class: 'comments-list' });
  const counter = live(() => num(data.social.commentCount), { class: 'badge b-brand' }, 'span');
  let box: HTMLTextAreaElement | null = null;
  let len: HTMLElement | null = null;
  return (
    <Card title="التعليقات" icon="message-text" actions={counter.node} class="pp-comments">
      <form class="comment-form" onSubmit={async (event: Event) => {
        event.preventDefault();
        const text = box?.value.trim();
        if (!text) return;
        await busy((event.currentTarget as HTMLFormElement).querySelector('button[type=submit]'), async () => {
          try {
            const { comment } = await api(`/api/profile/${encodeURIComponent(data.member.userId)}/comments`, { method: 'POST', body: { text } });
            rows = [comment, ...rows];
            data.social.commentCount += 1;
            if (box) box.value = '';
            if (len) len.textContent = '0/500';
            list.update();
            counter.update();
          } catch (error) { toastError(error, 'ما قدرنا ننشر التعليق'); }
        });
      }}>
        <Avatar src={data.viewer?.avatar} name={data.viewer?.name} size={34} />
        <div class="comment-input">
          <textarea class="input" name="text" rows="2" maxlength="500" dir="auto" placeholder="اكتب تعليق…" aria-label="اكتب تعليق" ref={(el: HTMLTextAreaElement) => { box = el; }}
            onInput={() => { if (len && box) len.textContent = `${box.value.length}/500`; }}
            onKeyDown={(event: KeyboardEvent) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); (event.currentTarget as HTMLTextAreaElement).form?.requestSubmit(); } }} />
          <div class="comment-foot"><small class="muted" ref={(el: HTMLElement) => { len = el; }}>0/500</small><Button type="submit" variant="primary" size="sm" icon="send-2">نشر</Button></div>
        </div>
      </form>
      {list.node}
    </Card>
  );
}

function editDialog(data: any, onSaved: () => void) {
  const { profile } = data;
  let accent = safeColor(profile.accent);
  const links = [...(profile.links ?? []), {}, {}, {}, {}].slice(0, 4);
  const root = document.querySelector<HTMLElement>('.page-profile');
  const preview = (color: string) => { if (!root) return; root.style.setProperty('--brand', color || ''); root.style.setProperty('--chart', color || ''); if (!color) root.removeAttribute('style'); };
  const swatches = live(() => (
    <div class="swatches" role="radiogroup" aria-label="لون الملف">
      <button type="button" role="radio" class="swatch none" aria-checked={String(!accent)} title="لون ريفت الافتراضي" onClick={() => { accent = ''; swatches.update(); preview(''); }}><Icon name="x" size={14} /></button>
      {SWATCHES.map(color => <button type="button" role="radio" class="swatch" aria-checked={String(accent === color)} title={color} style={{ background: color }} onClick={() => { accent = color; swatches.update(); preview(color); }} />)}
    </div>
  ));
  let error: HTMLElement | null = null;
  openModal({
    title: 'تعديل الملف',
    description: 'بس أنت تقدر تغيّره، وكل الستاف يشوفه.',
    icon: 'edit-2',
    size: 'lg',
    onClose: () => onSaved,
    body: close => (
      <form class="form-grid" id="profileEdit" onSubmit={async (event: Event) => {
        event.preventDefault();
        const form = event.currentTarget as HTMLFormElement;
        const value = (name: string) => String((form.elements.namedItem(name) as HTMLInputElement | null)?.value ?? '');
        const checked = (name: string) => Boolean((form.elements.namedItem(name) as HTMLInputElement | null)?.checked);
        const body = { tagline: value('tagline'), bio: value('bio'), accent, bannerUrl: value('bannerUrl'), showFeedback: checked('showFeedback'), showConnections: checked('showConnections'), links: [0, 1, 2, 3].map(i => ({ label: value(`linkLabel${i}`), url: value(`linkUrl${i}`) })) };
        await busy(form.closest('.ov-panel')?.querySelector<HTMLButtonElement>('[data-submit]'), async () => {
          try { await api('/api/profile', { method: 'PATCH', body }); close(); toast('انحفظ ملفك'); onSaved(); }
          catch (failure) { if (error) { error.textContent = errorText(failure, 'ما قدرنا نحفظ الملف.'); error.hidden = false; } }
        });
      }}>
        <Field label="العبارة التعريفية" full><input class="input" name="tagline" maxlength="60" dir="auto" value={profile.tagline ?? ''} placeholder="شفت الليل، دعم الأعضاء" autofocus /></Field>
        <Field label="نبذة" full hint="6 أسطر كحد أقصى."><textarea class="input" name="bio" rows="4" maxlength="300" dir="auto" placeholder="عرّف الفريق على نفسك">{profile.bio ?? ''}</textarea></Field>
        <Field label="لون الملف" full as="div">{swatches.node}</Field>
        <Field label="رابط صورة الغلاف" full optional hint="اتركه فاضي عشان يستخدم غلاف ديسكورد."><input class="input ltr" name="bannerUrl" type="url" maxlength="500" value={profile.bannerUrl ?? ''} placeholder="https://…" /></Field>
        <Field label="روابط إضافية" full as="div">
          <div class="link-rows">{links.map((item: any, i: number) => <div class="link-row"><input class="input" name={`linkLabel${i}`} maxlength="24" dir="auto" value={item?.label ?? ''} placeholder="الاسم" /><input class="input ltr" name={`linkUrl${i}`} type="url" maxlength="200" value={item?.url ?? ''} placeholder="https://" /></div>)}</div>
        </Field>
        <div class="full stack">
          <Toggle name="showConnections" checked={profile.showConnections !== false} label="اعرض حساباتي المربوطة في ديسكورد" hint="GitHub وSteam وXbox وأي حساب خليته ظاهر في ديسكورد." />
          <Toggle name="showFeedback" checked={profile.showFeedback !== false} label="اعرض التقييمات في ملفي" hint="تقييمات وتعليقات الأعضاء. الإدارة تشوفها دايمًا." />
        </div>
        <p class="field-error full" role="alert" hidden ref={(el: HTMLElement) => { error = el; }} />
      </form>
    ),
    footer: close => [<Button variant="ghost" onClick={() => { preview(safeColor(profile.accent)); close(); }}>إلغاء</Button>, <Button variant="primary" icon="tick-circle" data-submit onClick={() => (document.getElementById('profileEdit') as HTMLFormElement | null)?.requestSubmit()}>حفظ الملف</Button>],
  });
}
