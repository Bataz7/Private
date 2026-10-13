// صفحة الحالة العامة (/status): هل البوت شغال، وش يعني هذا لك، وأخبار الفريق. تتحدث كل 20 ثانية.
import type { Child } from '#jsx/jsx-runtime';
import { mount } from '#jsx/jsx-runtime';
import { copyText, live, safeUrl } from '../lib/dom';
import { dateTime, dayUTC, num } from '../lib/format';
import { resolvedTheme, toggleTheme } from '../lib/theme';
import { Sparkline } from '../ui/chart';
import { Icon } from '../ui/Icon';
import { Button, Empty, Seg, Skeleton } from '../ui/kit';

type State = 'operational' | 'degraded' | 'outage' | 'maintenance';
const ICON: Record<State, string> = { operational: 'tick-circle', degraded: 'warning-2', outage: 'close-circle', maintenance: 'setting-2' };
const COLOR: Record<State, string> = { operational: '#2fb67c', degraded: '#e0a43a', outage: '#e5566b', maintenance: '#7b6cf6' };
const TITLE: Record<State, string> = { operational: 'كل شي شغال تمام', degraded: 'شغال، بس أبطأ من العادة', outage: 'البوت متوقف حاليًا', maintenance: 'تحت الصيانة' };
const MEANS: Record<State, string> = {
  operational: 'الأوامر والأزرار واللوحات والشفتات والداشبورد كلها تشتغل طبيعي.',
  degraded: 'تقدر تستخدم البوت عادي، بس بعض الأشياء ممكن تتأخر ثواني.',
  outage: 'الأزرار والأوامر ممكن ما تستجيب لين يرجع. الفريق عارف ويشتغل عليه.',
  maintenance: 'فيه صيانة مجدولة الحين، وبعض المزايا ممكن توقف لين تخلص.',
};
const STATE: Record<State, string> = { operational: 'شغال', degraded: 'بطيء', outage: 'متوقف', maintenance: 'صيانة' };
const SERVICES: Record<string, [string, Record<State, string>]> = {
  bot: ['بوت ديسكورد', { operational: 'يرد على الأوامر والأزرار طبيعي', degraded: 'أبطأ أو يعيد الاتصال', outage: 'متوقف وما يرد', maintenance: 'تحت صيانة مجدولة' }],
  discord: ['اتصال ديسكورد', { operational: 'الاتصال بديسكورد سليم', degraded: 'الاتصال أبطأ من العادة', outage: 'الاتصال مقطوع', maintenance: 'تحت صيانة مجدولة' }],
  jobs: ['المهام التلقائية', { operational: 'فحص الشفتات والتقارير الأسبوعية في وقتها', degraded: 'بعض المهام متأخرة', outage: 'متوقفة لأن البوت متوقف', maintenance: 'متوقفة للصيانة' }],
  database: ['حفظ البيانات', { operational: 'كل شي ينحفظ ويتحمّل طبيعي', degraded: 'الحفظ أبطأ من العادة', outage: 'التغييرات ممكن ما تنحفظ الحين', maintenance: 'تحت صيانة مجدولة' }],
  dashboard: ['الداشبورد', { operational: 'الموقع شغال', degraded: 'الموقع أبطأ من العادة', outage: 'الموقع متوقف', maintenance: 'تحت صيانة مجدولة' }],
};
const KINDS: Record<string, string> = { update: 'تحديث', announcement: 'إعلان', incident: 'مشكلة', resolved: 'انحلت', maintenance: 'صيانة' };
const JOBS: Record<string, string> = { shifts: 'فحص الشفتات', roles: 'مزامنة الرتب', weekly: 'التقارير الأسبوعية', presence: 'التحقق من التواجد', leaderboard: 'لوحة المتصدرين' };
const RANGES: Record<string, string> = { '24h': '24 ساعة', '7d': '7 أيام', '30d': '30 يوم' };

let skew = 0;
const rtf = new Intl.RelativeTimeFormat('ar-u-nu-latn', { numeric: 'auto' });
function relative(value: unknown): string {
  let s = Math.round((new Date(value as string).getTime() - (Date.now() + skew)) / 1000);
  if (s > 0) s = 0;
  const a = Math.abs(s);
  if (a < 60) return 'الحين';
  if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (a < 2592000) return rtf.format(Math.round(s / 86400), 'day');
  return dateTime(value);
}
const pct = (value: number) => `${value.toFixed(value >= 99.995 ? 0 : 2)}%`;
const long = (ms: number) => { const m = Math.round(ms / 60000); if (m < 1) return 'أقل من دقيقة'; if (m < 60) return `${m} دقيقة`; const h = Math.floor(m / 60); return m < 1440 ? `${h}س ${m % 60}د` : `${Math.floor(m / 1440)}ي ${Math.floor((m % 1440) / 60)}س`; };
const tone = (day: any) => (day.pct === null || day.pct === undefined ? 'none' : day.pct >= 99.9 ? 'up' : day.pct >= 95 ? 'part' : 'down');

/** نص المنشور: روابط http(s) و**عريض** وأسطر فقط. */
function rich(text: string): Child[] {
  const out: Child[] = [];
  String(text ?? '').split('\n').forEach((line, index) => {
    if (index) out.push(<br />);
    for (const part of line.split(/(\*\*.+?\*\*|https?:\/\/[^\s<]+)/g)) {
      if (!part) continue;
      if (/^\*\*.+\*\*$/.test(part)) out.push(<b>{part.slice(2, -2)}</b>);
      else if (/^https?:\/\//.test(part) && safeUrl(part)) out.push(<a href={safeUrl(part)} target="_blank" rel="noopener noreferrer nofollow">{part}</a>);
      else out.push(part);
    }
  });
  return out;
}

export function startStatusPage(host: HTMLElement) {
  let data: any = null;
  let loadedAt = 0;
  const open = new Set<string>();
  const perf = { range: '24h', data: null as any, failed: false, loading: false };
  let scrolled = false;

  const updated = live(() => {
    const age = Math.round((Date.now() - loadedAt) / 1000);
    return <span class={age > 90 ? 'is-stale' : ''} title={age > 90 ? 'تعذّر التحديث، هذي آخر حالة معروفة' : undefined}>آخر تحديث <b>{age < 5 ? 'الحين' : relative(loadedAt)}</b></span>;
  }, { class: 'sp-updated' }, 'span');

  const perfBlock = live(() => {
    if (perf.failed && !perf.data) return null;
    const card = (key: 'ping' | 'dbMs', title: string, sub: string) => {
      const values = (perf.data?.points ?? []).map((point: any) => point[key]).filter(Number.isFinite) as number[];
      if (!values.length) return null;
      const now = values.at(-1)!;
      const level = key === 'ping' ? (now < 150 ? 'fast' : now < 400 ? 'ok' : 'slow') : now < 60 ? 'fast' : now < 300 ? 'ok' : 'slow';
      return (
        <div class="sp-perf-card">
          <div class="sp-perf-top"><span><b>{title}</b><small>{sub}</small></span><em class={`lv-${level}`}>{level === 'fast' ? 'سريع' : level === 'ok' ? 'عادي' : 'بطيء'}</em></div>
          <div class="sp-perf-now"><strong class="num">{Math.round(now)}</strong><span>ms · الحين</span></div>
          <Sparkline values={values} />
          <div class="sp-perf-stats"><span>الأفضل<b>{Math.round(Math.min(...values))} ms</b></span><span>المتوسط<b>{Math.round(values.reduce((s, v) => s + v, 0) / values.length)} ms</b></span><span>الأسوأ<b>{Math.round(Math.max(...values))} ms</b></span></div>
        </div>
      );
    };
    const cards = perf.data ? [card('ping', 'سرعة استجابة البوت', 'قد إيش يرد البوت على ديسكورد'), card('dbMs', 'سرعة الحفظ', 'قد إيش البيانات تنحفظ وتنفتح')].filter(Boolean) : [];
    return (
      <section class="sp-block" id="perf">
        <div class="sp-block-head"><h2>السرعة</h2><Seg size="sm" label="الفترة" value={perf.range} options={Object.entries(RANGES).map(([value, label]) => ({ value, label }))} onChange={value => { perf.range = value; perf.data = null; perf.failed = false; perfBlock.update(); void loadPerf(); }} /></div>
        <div class="sp-perf-grid">{cards.length ? cards : perf.loading || !perf.failed ? <Skeleton lines={2} height={60} /> : <p class="muted">ما فيه بيانات سرعة بعد.</p>}</div>
      </section>
    );
  });

  async function loadPerf() {
    if (perf.loading) return;
    perf.loading = true;
    try {
      const response = await fetch(`/api/status/metrics?source=bot&range=${perf.range}`);
      if (!response.ok) throw new Error(String(response.status));
      const result = await response.json();
      perf.data = result.points?.length > 1 ? result : null;
      perf.failed = !perf.data;
    } catch { perf.data = null; perf.failed = true; }
    perf.loading = false;
    perfBlock.update();
  }

  const main = live(() => {
    if (!data) return <div class="sp-loading"><Skeleton lines={1} height={180} /><Skeleton lines={4} height={56} /></div>;
    const state = (data.overall?.state ?? 'operational') as State;
    const cards: Child[] = [];
    const ongoing = (data.incidents ?? []).find((item: any) => item.status !== 'resolved');
    if (ongoing) cards.push(<article class="sp-alert s-outage"><Icon name="close-circle" size={20} /><div><b>البوت وقف عن الاستجابة</b><small>من {dateTime(ongoing.startedAt)}</small></div></article>);
    for (const item of data.maintenances?.ongoing ?? []) cards.push(<article class="sp-alert s-maintenance"><Icon name="setting-2" size={20} /><div><b>صيانة جارية: {item.title}</b>{item.description ? <p dir="auto">{item.description}</p> : null}<small>لين {dateTime(item.endsAt)}</small></div></article>);
    for (const item of (data.maintenances?.upcoming ?? []).slice(0, 2)) cards.push(<article class="sp-alert s-planned"><Icon name="calendar" size={20} /><div><b>صيانة قادمة: {item.title}</b>{item.description ? <p dir="auto">{item.description}</p> : null}<small>تبدأ {dateTime(item.startsAt)}</small></div></article>);
    const pastItems = [
      ...(data.incidents ?? []).filter((item: any) => item.status === 'resolved').map((item: any) => ({ at: item.startedAt, text: `البوت توقف لمدة ${long(new Date(item.resolvedAt).getTime() - new Date(item.startedAt).getTime())}`, kind: 'outage' })),
      ...(data.maintenances?.completed ?? []).map((item: any) => ({ at: item.startsAt, text: `صيانة: ${item.title}`, kind: 'maintenance' })),
    ].sort((a, b) => +new Date(b.at) - +new Date(a.at));
    return [
      <section class={`sp-hero s-${state}`}>
        <span class="sp-hero-icon"><Icon name={ICON[state]} size={44} bold /></span>
        <h1>{TITLE[state]}</h1>
        <p>{MEANS[state]}</p>
        {data.uptime?.h24 != null || data.uptime?.d30 != null ? <div class="sp-pills">{[[data.uptime.h24, '24 ساعة'], [data.uptime.d30, '30 يوم']].filter(([value]) => value != null).map(([value, label]) => <span class="sp-pill"><b class="num">{pct(value)}</b> شغّال · {label}</span>)}</div> : null}
      </section>,
      cards.length ? <section class="sp-block"><h2>الحين</h2><div class="sp-alerts">{cards}</div></section> : null,
      <section class="sp-block" id="updates"><h2>أخبار الفريق</h2>
        {(data.posts ?? []).length ? <div class="sp-posts">{data.posts.map((post: any) => (
          <article class={`sp-post k-${post.kind}`} id={`post-${post.id}`}>
            <header><em class="sp-kind">{KINDS[post.kind] ?? post.kind}</em>{post.pinned ? <em class="sp-pin"><Icon name="flag" size={12} /> مثبّت</em> : null}<time title={dateTime(post.createdAt)}>{relative(post.createdAt)}</time>
              <button type="button" class="btn btn-ghost btn-icon btn-sm" title="نسخ الرابط" aria-label="نسخ رابط المنشور" onClick={async (event: Event) => { const button = event.currentTarget as HTMLElement; if (await copyText(`${location.origin}/status#post-${post.id}`)) { button.classList.add('is-done'); setTimeout(() => button.classList.remove('is-done'), 1400); } }}><Icon name="link" size={14} /></button></header>
            <h3 dir="auto">{post.title}</h3>
            {post.body ? <p dir="auto">{rich(post.body)}</p> : null}
          </article>
        ))}</div> : <p class="sp-empty">ما فيه أخبار بعد. تحديثات الفريق بتطلع هنا.</p>}
      </section>,
      <section class="sp-block" id="services"><h2>الخدمات</h2>
        <ul class="sp-svcs">{(data.components ?? []).map((item: any) => {
          const [name, lines] = SERVICES[item.key] ?? [item.name, {} as Record<State, string>];
          const isOpen = open.has(item.key);
          const days: any[] = item.days ?? [];
          return (
            <li class={`sp-svc s-${item.state} ${isOpen ? 'is-open' : ''}`}>
              <button type="button" class="sp-svc-head" aria-expanded={String(isOpen)} onClick={() => { if (isOpen) open.delete(item.key); else open.add(item.key); main.update(); }}>
                <i class="sp-dot" /><span class="sp-svc-name"><b>{name}</b><small>{lines[item.state as State] || item.detail || ''}</small></span><em>{STATE[item.state as State] ?? item.state}</em><Icon name="arrow-down-01" size={16} class="sp-chev" />
              </button>
              {days.length ? <div class="sp-svc-bars"><div class="sp-bars" dir="ltr">{days.map(day => <i class={`t-${tone(day)}`} title={`${dayUTC(day.date)}: ${day.pct === null ? 'ما فيه بيانات' : day.downMs > 60000 ? `توقف ${long(day.downMs)}` : 'بدون مشاكل'}`} />)}</div><div class="sp-svc-meta"><span>قبل 30 يوم</span><b>{item.uptime30 != null ? `شغال ${pct(item.uptime30)} من الوقت` : 'ما فيه بيانات كافية'}</b><span>اليوم</span></div></div> : null}
              {isOpen ? <div class="sp-svc-body">{item.detail ? <p class="sp-tech ltr">{item.detail}</p> : null}{(item.jobs ?? []).length ? <ul class="sp-jobs">{item.jobs.map((job: any) => <li class={`s-${job.state}`}><i class="sp-dot" /><span><b>{JOBS[job.key] ?? job.name}</b><small>{job.lastRun ? `آخر تشغيل ${relative(job.lastRun)}` : 'ما اشتغل بعد'}</small></span><em>{STATE[job.state as State] ?? job.state}</em></li>)}</ul> : null}</div> : null}
            </li>
          );
        })}</ul>
        <div class="sp-legend"><span>كل عمود = يوم.</span>{(['up', 'part', 'down', 'none'] as const).map((key, index) => <span><i class={`t-${key}`} />{['بدون مشاكل', 'مشكلة قصيرة', 'مشكلة طويلة', 'ما فيه بيانات'][index]}</span>)}</div>
      </section>,
      perfBlock.node,
      <details class="sp-block sp-past" id="incidents" open={location.pathname.endsWith('/incidents') || undefined}>
        <summary><h2>المشاكل السابقة</h2><span class="badge">{num(pastItems.length)}</span><Icon name="arrow-down-01" size={16} /></summary>
        {pastItems.length ? <ul>{pastItems.map(item => <li class={`s-${item.kind}`}><i class="sp-dot" /><span dir="auto">{item.text}</span><time>{dateTime(item.at)}</time></li>)}</ul> : <p class="sp-empty">ما صار أي مشكلة في آخر 90 يوم.</p>}
      </details>,
    ];
  }, { class: 'sp-main' }, 'main');

  const themeBtn = live(() => <Icon name={resolvedTheme() === 'dark' ? 'sun' : 'moon'} size={18} />, { class: 'contents' }, 'span');
  window.addEventListener('rift:theme', () => themeBtn.update());

  mount(host, (
    <div class="sp">
      <header class="sp-head">
        <a class="sp-brand" href="/status"><img src="/a/s/logo-mark.svg" width="30" height="30" alt="" /><b>{'Rift'}</b><span>حالة الخدمة</span></a>
        <div class="sp-head-end">{updated.node}<button type="button" class="btn btn-ghost btn-icon" aria-label="تبديل الثيم" onClick={() => toggleTheme()}>{themeBtn.node}</button></div>
      </header>
      {main.node}
      <footer class="sp-foot"><a href="/status.rss">RSS</a><span>·</span><a href="/api/status">JSON</a><span>·</span><a href="/status/badge.svg">شارة</a><span>·</span><a href="/login">لوحة التحكم</a></footer>
    </div>
  ));

  async function refresh() {
    try {
      const response = await fetch('/api/status', { cache: 'no-store', headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error(String(response.status));
      data = await response.json();
      loadedAt = Date.now();
      const serverNow = new Date(data.generatedAt).getTime();
      if (Number.isFinite(serverNow)) skew = serverNow - loadedAt;
      const y = scrollY;
      main.update();
      updated.update();
      if (scrolled) scrollTo({ top: y });
      const state = (data.overall?.state ?? 'operational') as State;
      document.title = `${TITLE[state]} · ${data.name ?? 'Rift'}`;
      setFavicon(COLOR[state] ?? '#8792a2');
      if (!perf.data && !perf.loading && !perf.failed) void loadPerf();
      if (!scrolled) {
        scrolled = true;
        const target = { updates: 'updates', incidents: 'incidents', metrics: 'services' }[location.pathname.split('/')[2] ?? ''];
        const post = location.hash.startsWith('#post-') ? document.getElementById(location.hash.slice(1)) : null;
        requestAnimationFrame(() => { if (post) { post.scrollIntoView({ block: 'center' }); post.classList.add('is-target'); } else if (target) document.getElementById(target)?.scrollIntoView(); });
      }
    } catch {
      if (!data) mount(main.el!, <Empty icon="danger" title="الحالة غير متاحة" text="ما قدرنا نحمّلها الحين. جرّب بعد شوي." action={<Button icon="refresh-arrow-01" onClick={() => void refresh()}>حاول مرة ثانية</Button>} />);
    }
  }

  function setFavicon(color: string) {
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
    link.type = 'image/svg+xml';
    link.href = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="${color}"/></svg>`)}`;
  }

  void refresh();
  setInterval(() => { if (!document.hidden) void refresh(); }, 20_000);
  setInterval(() => updated.update(), 5000);
}
