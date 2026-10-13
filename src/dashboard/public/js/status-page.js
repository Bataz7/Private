import { esc } from './ui.js';
import { ic } from './icon.js';

// Public status page: one simple screen. Is the bot working, what does that mean for me, and what did the team post.
// Old links (/status/updates, /status/incidents, ...) open the same page and scroll to the matching part.
const ICON = { operational: 'tick-circle', degraded: 'warning-2', outage: 'close-circle', maintenance: 'setting-2' };
const ICON_COLOR = { operational: '#4fc08d', degraded: '#e0b04f', outage: '#e9697b', maintenance: '#8175f5' };

const T = {
  en: {
    title: { operational: 'Everything is working', degraded: 'Working, but slower than usual', outage: 'The bot is down right now', maintenance: 'Under maintenance' },
    means: {
      operational: 'Commands, buttons, panels, shifts and the dashboard all work normally.',
      degraded: 'You can keep using the bot. Some things may take a few extra seconds.',
      outage: 'Buttons and commands may not respond until it is back. The team already knows.',
      maintenance: 'Planned work is in progress. Some features may pause until it ends.',
    },
    state: { operational: 'Working', degraded: 'Slow', outage: 'Down', maintenance: 'Maintenance' },
    services: {
      bot: ['Discord bot', { operational: 'Answers commands and buttons normally', degraded: 'Slower or reconnecting', outage: 'Offline, not answering', maintenance: 'Under planned maintenance' }],
      jobs: ['Automatic tasks', { operational: 'Shift checks and weekly reports run on time', degraded: 'Some tasks are running late', outage: 'Paused while the bot is offline', maintenance: 'Paused for maintenance' }],
      database: ['Saving data', { operational: 'Everything saves and loads normally', degraded: 'Saving is slower than usual', outage: 'Changes may not save right now', maintenance: 'Under planned maintenance' }],
      dashboard: ['Dashboard', { operational: 'Website is online', degraded: 'Website is slower than usual', outage: 'Website is offline', maintenance: 'Under planned maintenance' }],
    },
    now: 'Right now', maintNow: 'Maintenance in progress', maintSoon: 'Planned maintenance', until: 'until {t}', starts: 'starts {t}',
    incidentNow: 'The bot stopped responding', incidentSince: 'since {t}',
    services_: 'Services', history: 'Last 30 days', historyNote: 'Each bar is one day.', legend: ['No problems', 'Short problem', 'Long problem', 'No data'],
    uptime: '{p} of the time online', noData: 'Not enough data yet',
    news: 'News from the team', noNews: 'No news yet. Updates from the team will show up here.', pinned: 'Pinned',
    kinds: { update: 'Update', announcement: 'Announcement', incident: 'Problem', resolved: 'Fixed', maintenance: 'Maintenance' },
    past: 'Past problems', pastNone: 'No problems in the last 90 days.', offlineFor: 'The bot was offline for {d}', maintDone: 'Maintenance',
    updated: 'Updated {t}', justNow: 'just now', stale: 'Could not refresh, showing the last known status',
    unavailable: 'Status is unavailable', unavailableSub: 'We could not load it right now. Try again in a moment.', retry: 'Try again',
    lang: 'العربية', min: '{n} min', under: 'less than a minute',
    daysAgo30: '30 days ago', today: 'Today', uptime24: '24 hours', uptime30: '30 days', online: 'online', details: 'Details', lastRan: 'Last ran {when}', neverRan: 'Has not run yet', copyLink: 'Copy link', copied: 'Copied', badge: 'Badge',
    perf: 'Speed', perfNone: 'No speed data yet. It appears after the bot has been running for a while.', pNow: 'Now', pAvg: 'Average', pBest: 'Best', pWorst: 'Worst', pFast: 'Fast', pOk: 'Normal', pSlow: 'Slow',
    perfBot: 'Bot response time', perfBotSub: 'How fast the bot answers Discord', perfDb: 'Saving speed', perfDbSub: 'How fast data is saved and loaded',
    ranges: { '24h': '24 hours', '7d': '7 days', '30d': '30 days' }, jobs: { shifts: 'Shift checks', roles: 'Role sync', weekly: 'Weekly reports' },
  },
  ar: {
    title: { operational: 'كل شي شغال تمام', degraded: 'شغال، بس أبطأ من العادة', outage: 'البوت متوقف حاليًا', maintenance: 'تحت الصيانة' },
    means: {
      operational: 'الأوامر والأزرار واللوحات والشفتات والداشبورد كلها تشتغل طبيعي.',
      degraded: 'تقدر تستخدم البوت عادي، بس بعض الأشياء ممكن تتأخر ثواني.',
      outage: 'الأزرار والأوامر ممكن ما تستجيب لين يرجع. الفريق عارف ويشتغل عليه.',
      maintenance: 'فيه صيانة مجدولة الحين، وبعض المزايا ممكن توقف لين تخلص.',
    },
    state: { operational: 'شغال', degraded: 'بطيء', outage: 'متوقف', maintenance: 'صيانة' },
    services: {
      bot: ['بوت ديسكورد', { operational: 'يرد على الأوامر والأزرار طبيعي', degraded: 'أبطأ أو يعيد الاتصال', outage: 'متوقف وما يرد', maintenance: 'تحت صيانة مجدولة' }],
      jobs: ['المهام التلقائية', { operational: 'فحص الشفتات والتقارير الأسبوعية في وقتها', degraded: 'بعض المهام متأخرة', outage: 'متوقفة لأن البوت متوقف', maintenance: 'متوقفة للصيانة' }],
      database: ['حفظ البيانات', { operational: 'كل شي ينحفظ ويتحمّل طبيعي', degraded: 'الحفظ أبطأ من العادة', outage: 'التغييرات ممكن ما تنحفظ الحين', maintenance: 'تحت صيانة مجدولة' }],
      dashboard: ['الداشبورد', { operational: 'الموقع شغال', degraded: 'الموقع أبطأ من العادة', outage: 'الموقع متوقف', maintenance: 'تحت صيانة مجدولة' }],
    },
    now: 'الحين', maintNow: 'صيانة جارية', maintSoon: 'صيانة قادمة', until: 'لين {t}', starts: 'تبدأ {t}',
    incidentNow: 'البوت وقف عن الاستجابة', incidentSince: 'من {t}',
    services_: 'الخدمات', history: 'آخر 30 يوم', historyNote: 'كل عمود = يوم.', legend: ['بدون مشاكل', 'مشكلة قصيرة', 'مشكلة طويلة', 'ما فيه بيانات'],
    uptime: 'شغال {p} من الوقت', noData: 'ما فيه بيانات كافية بعد',
    news: 'أخبار الفريق', noNews: 'ما فيه أخبار بعد. تحديثات الفريق بتطلع هنا.', pinned: 'مثبّت',
    kinds: { update: 'تحديث', announcement: 'إعلان', incident: 'مشكلة', resolved: 'انحلت', maintenance: 'صيانة' },
    past: 'المشاكل السابقة', pastNone: 'ما صار أي مشكلة في آخر 90 يوم.', offlineFor: 'البوت توقف لمدة {d}', maintDone: 'صيانة',
    updated: 'آخر تحديث {t}', justNow: 'الآن', stale: 'تعذّر التحديث، هذي آخر حالة معروفة',
    unavailable: 'الحالة غير متاحة', unavailableSub: 'ما قدرنا نحمّلها الحين. جرّب بعد شوي.', retry: 'حاول مرة ثانية',
    lang: 'English', min: '{n} دقيقة', under: 'أقل من دقيقة',
    daysAgo30: 'قبل 30 يوم', today: 'اليوم', uptime24: '24 ساعة', uptime30: '30 يوم', online: 'شغّال', details: 'التفاصيل', lastRan: 'آخر تشغيل {when}', neverRan: 'ما اشتغل بعد', copyLink: 'نسخ الرابط', copied: 'اننسخ', badge: 'شارة',
    perf: 'السرعة', perfNone: 'ما فيه بيانات سرعة بعد. تظهر بعد ما يشتغل البوت فترة.', pNow: 'الحين', pAvg: 'المتوسط', pBest: 'الأفضل', pWorst: 'الأسوأ', pFast: 'سريع', pOk: 'عادي', pSlow: 'بطيء',
    perfBot: 'سرعة استجابة البوت', perfBotSub: 'قد إيش يرد البوت بسرعة على ديسكورد', perfDb: 'سرعة الحفظ', perfDbSub: 'قد إيش البيانات تنحفظ وتنفتح بسرعة',
    ranges: { '24h': '24 ساعة', '7d': '7 أيام', '30d': '30 يوم' }, jobs: { shifts: 'فحص الشفتات', roles: 'مزامنة الرتب', weekly: 'التقارير الأسبوعية' },
  },
};

let lang = (() => { try { return localStorage.getItem('rift-status-lang') || (navigator.language?.startsWith('ar') ? 'ar' : 'en'); } catch { return 'en'; } })();
const L = (path, vars = {}) => String(path.split('.').reduce((obj, key) => obj?.[key], T[lang]) ?? path).replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? '');
const locale = () => (lang === 'ar' ? 'ar-SA-u-nu-latn-ca-gregory' : 'en-US');
const root = document.getElementById('sp');
let data = null;
let loadedAt = 0;
let scrolled = false;

const fmtDate = value => new Date(value).toLocaleString(locale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const fmtDay = value => new Date(value).toLocaleDateString(locale(), { month: 'short', day: 'numeric', timeZone: 'UTC' });
const long = ms => { const m = Math.round(ms / 60000); if (m < 1) return L('under'); if (m < 60) return L('min', { n: m }); const h = Math.floor(m / 60); return m < 1440 ? `${h}h ${m % 60}m` : `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`; };
// Times come from the server's clock. `skew` is how far this device's clock is from it, so a post never shows as
// being "in 11 minutes"; a small leftover difference in the future reads as "just now".
let skew = 0;
const relative = value => { let s = Math.round((new Date(value).getTime() - (Date.now() + skew)) / 1000); if (s > 0) s = 0; const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }); const a = Math.abs(s); return a < 60 ? L('justNow') : a < 3600 ? rtf.format(Math.round(s / 60), 'minute') : a < 86400 ? rtf.format(Math.round(s / 3600), 'hour') : a < 2592000 ? rtf.format(Math.round(s / 86400), 'day') : fmtDate(value); };
const pct = value => `${value.toFixed(value >= 99.995 ? 0 : 2)}%`;
// Post bodies: escaped text with http(s) links, **bold** and line breaks only.
const rich = value => esc(value).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener nofollow">$1</a>').replace(/\n/g, '<br>');
const tone = day => (day.pct === null ? 'none' : day.pct >= 99.9 ? 'up' : day.pct >= 95 ? 'part' : 'down');

function header() {
  const age = Math.max(0, Math.round((Date.now() - loadedAt) / 1000));
  return `<header class="st-head">
    <a class="st-brand" href="/status"><img src="/logo-mark.svg" alt=""><b>${esc(data?.name || 'Rift')}</b></a>
    <div class="st-head-end"><span class="st-updated" id="stUpdated">${L('updated', { t: `<b id="stAgo">${age < 5 ? L('justNow') : esc(relative(loadedAt))}</b>` })}</span><button type="button" class="st-lang" data-lang>${ic('translate', { size: 16 })} ${L('lang')}</button></div>
  </header>`;
}

function hero() {
  const state = data.overall.state;
  return `<section class="st-hero s-${state}">
    <span class="st-hero-icon">${ic(ICON[state], { size: 44, type: 'bold' })}</span>
    <h1>${L(`title.${state}`)}</h1>
    <p>${L(`means.${state}`)}</p>
    ${(data.uptime?.h24 != null || data.uptime?.d30 != null) ? `<div class="st-pills">${[[data.uptime.h24, 'uptime24'], [data.uptime.d30, 'uptime30']].filter(([value]) => value != null).map(([value, key]) => `<span class="st-pill"><b>${pct(value)}</b> ${L('online')} · ${L(key)}</span>`).join('')}</div>` : ''}
  </section>`;
}

// Anything happening right now: an ongoing outage or maintenance, plus maintenance planned in the next days.
function rightNow() {
  const cards = [];
  const ongoing = data.incidents.find(item => item.status !== 'resolved');
  if (ongoing) cards.push(`<article class="st-alert s-outage">${ic('close-circle', { size: 20 })}<div><b>${L('incidentNow')}</b><small>${L('incidentSince', { t: esc(fmtDate(ongoing.startedAt)) })}</small></div></article>`);
  for (const item of data.maintenances.ongoing) cards.push(`<article class="st-alert s-maintenance">${ic('setting-2', { size: 20 })}<div><b>${L('maintNow')}: ${esc(item.title)}</b>${item.description ? `<p dir="auto">${esc(item.description)}</p>` : ''}<small>${L('until', { t: esc(fmtDate(item.endsAt)) })}</small></div></article>`);
  for (const item of data.maintenances.upcoming.slice(0, 2)) cards.push(`<article class="st-alert s-planned">${ic('calendar', { size: 20 })}<div><b>${L('maintSoon')}: ${esc(item.title)}</b>${item.description ? `<p dir="auto">${esc(item.description)}</p>` : ''}<small>${L('starts', { t: esc(fmtDate(item.startsAt)) })}</small></div></article>`);
  return cards.length ? `<section class="st-block"><h2>${L('now')}</h2><div class="st-alerts">${cards.join('')}</div></section>` : '';
}

// Each service shows its own 30-day history; a click opens the details (what the check says, and the automatic tasks).
const openServices = new Set();
const dayBars = days => `<div class="st-bars" dir="ltr">${days.map(day => `<i class="t-${tone(day)}" title="${esc(`${fmtDay(day.date)}: ${day.pct === null ? L('noData') : day.downMs > 60000 ? L('offlineFor', { d: long(day.downMs) }) : L('legend.0')}`)}"></i>`).join('')}</div>`;

function serviceBody(item) {
  const jobs = (item.jobs || []).map(job => `<li class="s-${esc(job.state)}"><i class="st-dot"></i><span><b>${esc(T[lang].jobs[job.key] || job.name)}</b><small>${job.lastRun ? L('lastRan', { when: esc(relative(job.lastRun)) }) : L('neverRan')}</small></span><em>${L(`state.${job.state}`)}</em></li>`).join('');
  return `<div class="st-svc-body">${item.detail ? `<p class="st-tech" dir="ltr">${esc(item.detail)}</p>` : ''}${jobs ? `<ul class="st-jobs">${jobs}</ul>` : ''}</div>`;
}

function services() {
  const rows = data.components.map(item => {
    const [name, lines] = T[lang].services[item.key] || [item.name, {}];
    const days = item.days || [];
    const open = openServices.has(item.key);
    return `<li class="st-svc s-${esc(item.state)} ${open ? 'is-open' : ''}">
      <button type="button" class="st-svc-head" data-toggle-svc="${esc(item.key)}" aria-expanded="${open}"><i class="st-dot"></i><span class="st-svc-name"><b>${esc(name)}</b><small>${esc(lines[item.state] || item.detail || '')}</small></span><em>${L(`state.${item.state}`)}</em>${ic('arrow-down-01', { size: 16 })}</button>
      ${days.length ? `<div class="st-svc-bars">${dayBars(days)}<div class="st-svc-meta"><span>${L('daysAgo30')}</span><b>${item.uptime30 != null ? L('uptime', { p: pct(item.uptime30) }) : L('noData')}</b><span>${L('today')}</span></div></div>` : ''}
      ${open ? serviceBody(item) : ''}
    </li>`;
  }).join('');
  return `<section class="st-block" id="services"><h2>${L('services_')}</h2><ul class="st-svcs">${rows}</ul>
    <div class="st-legend"><span>${L('historyNote')}</span>${['up', 'part', 'down', 'none'].map((key, index) => `<span><i class="t-${key}"></i>${T[lang].legend[index]}</span>`).join('')}</div></section>`;
}

// ---- Speed: how fast the bot answers Discord and how fast data is saved, from the samples the bot records ----
const perf = { range: '24h', data: null, at: 0, loading: false, failed: false };
const level = (key, value) => (key === 'ping' ? (value < 150 ? 'fast' : value < 400 ? 'ok' : 'slow') : (value < 60 ? 'fast' : value < 300 ? 'ok' : 'slow'));
function spark(points, key) {
  const values = points.map(point => point[key]).filter(Number.isFinite);
  if (values.length < 2) return '';
  const W = 320; const H = 76; const pad = 4;
  const lo = Math.min(...values); const hi = Math.max(...values); const span = hi - lo || 1;
  const x = index => pad + (index / (values.length - 1)) * (W - pad * 2);
  const y = value => H - pad - ((value - lo) / span) * (H - pad * 2);
  const line = values.map((value, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)} ${y(value).toFixed(1)}`).join(' ');
  return `<svg class="st-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" dir="ltr" aria-hidden="true"><path class="area" d="${line} L${x(values.length - 1).toFixed(1)} ${H} L${x(0).toFixed(1)} ${H} Z"/><path class="line" d="${line}"/></svg>`;
}
function perfCard(key, titleKey, subKey) {
  const values = (perf.data?.points || []).map(point => point[key]).filter(Number.isFinite);
  if (!values.length) return '';
  const now = values.at(-1); const avg = Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  const state = level(key, now);
  return `<div class="st-perf-card"><div class="st-perf-top"><span><b>${L(titleKey)}</b><small>${L(subKey)}</small></span><em class="lv-${state}">${L(state === 'fast' ? 'pFast' : state === 'ok' ? 'pOk' : 'pSlow')}</em></div>
    <div class="st-perf-now"><strong>${Math.round(now)}</strong><span>ms · ${L('pNow')}</span></div>${spark(perf.data.points, key)}
    <div class="st-perf-stats"><span>${L('pBest')}<b>${Math.round(Math.min(...values))} ms</b></span><span>${L('pAvg')}<b>${avg} ms</b></span><span>${L('pWorst')}<b>${Math.round(Math.max(...values))} ms</b></span></div></div>`;
}
function perfBlock() {
  const cards = perf.data ? [perfCard('ping', 'perfBot', 'perfBotSub'), perfCard('dbMs', 'perfDb', 'perfDbSub')].join('') : '';
  const body = cards || `<p class="st-empty">${perf.loading || !perf.failed ? '...' : L('perfNone')}</p>`;
  if (perf.failed && !perf.data) return ''; // no samples or the database is unreachable: hide the panel instead of showing an error
  return `<section class="st-block" id="perf"><div class="st-perf-head"><h2>${L('perf')}</h2><div class="st-seg" data-perf-range>${['24h', '7d', '30d'].map(key => `<button type="button" data-range="${key}" aria-pressed="${perf.range === key}">${L(`ranges.${key}`)}</button>`).join('')}</div></div><div class="st-perf-grid">${body}</div></section>`;
}
async function loadPerf(force = false) {
  if (perf.loading || (!force && perf.data && Date.now() - perf.at < 60_000)) return;
  perf.loading = true;
  try {
    const response = await fetch(`/api/status/metrics?source=bot&range=${perf.range}`);
    if (!response.ok) throw new Error(String(response.status));
    const result = await response.json();
    perf.data = result.points?.length ? result : null; perf.failed = !perf.data; perf.at = Date.now();
  } catch { perf.data = null; perf.failed = true; perf.at = Date.now(); }
  perf.loading = false;
  const section = document.getElementById('perf');
  const html = perfBlock();
  if (section) { if (html) section.outerHTML = html; else section.remove(); }
  else if (html) document.getElementById('services')?.insertAdjacentHTML('afterend', html);
}

function news() {
  const posts = data.posts || [];
  const body = posts.length ? posts.map(post => `<article class="st-post k-${esc(post.kind)}" id="post-${esc(post.id)}">
      <header><em class="st-kind">${esc(L(`kinds.${post.kind}`) || post.kind)}</em>${post.pinned ? `<em class="st-pin">${ic('flag', { size: 12 })} ${L('pinned')}</em>` : ''}<time title="${esc(fmtDate(post.createdAt))}">${esc(relative(post.createdAt))}</time><button type="button" class="st-copy" data-copy-post="${esc(post.id)}" title="${esc(L('copyLink'))}" aria-label="${esc(L('copyLink'))}">${ic('link', { size: 14 })}</button></header>
      <h3 dir="auto">${esc(post.title)}</h3>
      ${post.body ? `<p dir="auto">${rich(post.body)}</p>` : ''}
    </article>`).join('') : `<p class="st-empty">${L('noNews')}</p>`;
  return `<section class="st-block" id="updates"><h2>${L('news')}</h2><div class="st-posts">${body}</div></section>`;
}

function past() {
  const items = [
    ...data.incidents.filter(item => item.status === 'resolved').map(item => ({ at: item.startedAt, text: L('offlineFor', { d: long(new Date(item.resolvedAt) - new Date(item.startedAt)) }), kind: 'outage' })),
    ...data.maintenances.completed.map(item => ({ at: item.startsAt, text: `${L('maintDone')}: ${item.title}`, kind: 'maintenance' })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at));
  return `<details class="st-block st-past" id="incidents" ${location.pathname.endsWith('/incidents') ? 'open' : ''}><summary><h2>${L('past')}</h2><span>${items.length}</span>${ic('arrow-down-01', { size: 16 })}</summary>
    ${items.length ? `<ul>${items.map(item => `<li class="s-${item.kind}"><i class="st-dot"></i><span dir="auto">${esc(item.text)}</span><time>${esc(fmtDate(item.at))}</time></li>`).join('')}</ul>` : `<p class="st-empty">${L('pastNone')}</p>`}
  </details>`;
}

function render() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  const openPast = document.querySelector('.st-past')?.open;
  root.innerHTML = `${header()}<main class="st-main">${hero()}${rightNow()}${news()}${services()}${perfBlock()}${past()}</main>
    <footer class="st-foot"><a href="/status.rss">RSS</a><span>·</span><a href="/api/status">JSON</a><span>·</span><a href="/status/badge.svg">${L('badge')}</a></footer>`;
  if (openPast) document.querySelector('.st-past').open = true;
  document.title = `${L(`title.${data.overall.state}`)} · ${data.name}`;
  // The tab icon takes the colour of the current state, so a pinned tab tells you at a glance.
  const icon = document.getElementById('stIcon');
  if (icon) { icon.type = 'image/svg+xml'; icon.href = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="${ICON_COLOR[data.overall.state] || '#8792a2'}"/><circle cx="16" cy="16" r="14" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="2"/></svg>`)}`; }
  loadPerf();
  if (!scrolled) {
    scrolled = true;
    const target = { updates: 'updates', incidents: 'incidents', metrics: 'services' }[location.pathname.split('/')[2] || ''];
    const post = location.hash.startsWith('#post-') ? document.getElementById(location.hash.slice(1)) : null;
    if (post) requestAnimationFrame(() => { post.scrollIntoView({ block: 'center' }); post.classList.add('is-target'); setTimeout(() => post.classList.remove('is-target'), 2600); });
    else if (target) requestAnimationFrame(() => document.getElementById(target)?.scrollIntoView());
  }
}

document.addEventListener('click', async event => {
  if (event.target.closest('[data-lang]')) {
    lang = lang === 'ar' ? 'en' : 'ar';
    try { localStorage.setItem('rift-status-lang', lang); } catch { /* storage blocked */ }
    render();
    return;
  }
  const service = event.target.closest('[data-toggle-svc]');
  if (service) {
    const key = service.dataset.toggleSvc;
    openServices.has(key) ? openServices.delete(key) : openServices.add(key);
    const scroll = scrollY; render(); scrollTo({ top: scroll });
    return;
  }
  const range = event.target.closest('[data-perf-range] [data-range]');
  if (range && range.dataset.range !== perf.range) { perf.range = range.dataset.range; perf.data = null; perf.failed = false; document.getElementById('perf').outerHTML = perfBlock(); loadPerf(true); return; }
  const copy = event.target.closest('[data-copy-post]');
  if (copy) {
    const link = `${location.origin}/status#post-${copy.dataset.copyPost}`;
    try { await navigator.clipboard.writeText(link); } catch { return; }
    copy.classList.add('is-done'); copy.title = L('copied');
    setTimeout(() => { copy.classList.remove('is-done'); copy.title = L('copyLink'); }, 1400);
  }
});

async function refresh() {
  try {
    const response = await fetch('/api/status', { cache: 'no-store' });
    if (!response.ok) throw new Error(String(response.status));
    data = await response.json(); loadedAt = Date.now();
    const serverNow = new Date(data.generatedAt).getTime();
    if (Number.isFinite(serverNow)) skew = serverNow - loadedAt;
    const scroll = scrollY; render(); if (scrolled) scrollTo({ top: scroll });
  } catch {
    if (!data) root.innerHTML = `<div class="st-error">${ic('danger', { size: 34 })}<h1>${L('unavailable')}</h1><p>${L('unavailableSub')}</p><button type="button" onclick="location.reload()">${L('retry')}</button></div>`;
  }
}
// If refreshes keep failing, say so instead of showing an old status as current.
setInterval(() => {
  const ago = document.getElementById('stAgo'); if (!ago || !loadedAt) return;
  const age = Math.round((Date.now() - loadedAt) / 1000);
  ago.textContent = age < 5 ? L('justNow') : relative(loadedAt);
  const stale = age > 90;
  const wrap = document.getElementById('stUpdated');
  wrap.classList.toggle('is-stale', stale); wrap.title = stale ? L('stale') : '';
}, 5000);
setInterval(refresh, 20000);
refresh();
