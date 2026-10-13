import { supabase } from '../supabase/client.js';
import { env } from '../config/env.js';
import { DAY, MINUTE, WATCHDOGS, isSchemaError, warnSchema, type State } from './shared.js';

// Public status page data. Nothing here identifies a server, a member or a token.
const RANGES: Record<string, { ms: number; bucket: number }> = {
  '1h': { ms: 3_600_000, bucket: MINUTE },
  '24h': { ms: DAY, bucket: 5 * MINUTE },
  '7d': { ms: 7 * DAY, bucket: 30 * MINUTE },
  '30d': { ms: 30 * DAY, bucket: 2 * 3_600_000 },
  '90d': { ms: 90 * DAY, bucket: 6 * 3_600_000 },
};
export const DOWN_AFTER_MS = 45_000;

const cache = new Map<string, { at: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();
/** Concurrent requests after expiry share one load, so a burst of public traffic runs the heavy queries once. */
export async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value as T;
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;
  const promise = load().then(value => { cache.set(key, { at: Date.now(), value }); return value; }).finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

/** Runs a query; a missing table or column logs one clear message and gives the fallback, any other error is thrown. */
async function safe<T>(scope: string, run: () => PromiseLike<{ data: T | null; error: { message: string; code?: string } | null }>, fallback: T): Promise<T> {
  const { data, error } = await run();
  if (error) {
    if (isSchemaError(error)) { warnSchema(scope, error); return fallback; }
    throw new Error(`${scope}: ${error.message}`);
  }
  return data ?? fallback;
}

export async function loadHeartbeat() {
  const started = performance.now();
  const { data, error } = await supabase.from('bot_heartbeats').select('*').eq('key', 'main').maybeSingle();
  return { row: (error ? null : data) as Record<string, any> | null, error, ms: Math.round(performance.now() - started) };
}
export const lastAlive = (heartbeat: Record<string, any>) => Math.max(new Date(heartbeat.updated_at).getTime(), heartbeat.stopped_at ? new Date(heartbeat.stopped_at).getTime() : 0);

// ---- Uptime history from heartbeats ---------------------------------------------------------------
type Interval = { start: number; end: number };
const overlap = (a: Interval, b: Interval) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));

function slot(intervals: Interval[], start: number, end: number, monitorStart: number, now: number) {
  const from = Math.max(start, monitorStart);
  const to = Math.min(end, now);
  if (to <= from) return { pct: null as number | null, downMs: 0 };
  const downMs = Math.min(to - from, intervals.reduce((sum, item) => sum + overlap(item, { start: from, end: to }), 0));
  return { pct: Math.round((1 - downMs / (to - from)) * 10000) / 100, downMs };
}

export async function uptimeReport(now = Date.now(), heartbeat?: Record<string, any> | null) {
  const beat = heartbeat === undefined ? (await loadHeartbeat()).row : heartbeat;
  const events = await safe<any[]>('bot_status_events', () => supabase.from('bot_status_events').select('*').gte('started_at', new Date(now - 31 * DAY).toISOString()).order('started_at', { ascending: false }).limit(300), []);
  const alive = beat ? lastAlive(beat) : 0;
  const ongoing = beat && now - alive > DOWN_AFTER_MS
    ? { kind: 'downtime', startedAt: new Date(alive).toISOString(), endedAt: null, ongoing: true, note: beat.stopped_at && new Date(beat.stopped_at).getTime() >= new Date(beat.updated_at).getTime() ? 'البوت موقّف' : 'البوت ما يستجيب' }
    : null;
  const down: Interval[] = events.filter(event => event.kind === 'downtime').map(event => ({ start: new Date(event.started_at).getTime(), end: new Date(event.ended_at ?? now).getTime() }));
  if (ongoing) down.push({ start: alive, end: now });
  const monitorStart = Math.min(...[beat?.first_seen_at, beat?.started_at, ...events.map(event => event.started_at)].filter(Boolean).map(value => new Date(value).getTime()), now);
  const todayStart = Math.floor(now / DAY) * DAY;
  const days = Array.from({ length: 30 }, (_, index) => {
    const start = todayStart - (29 - index) * DAY;
    return { date: new Date(start).toISOString().slice(0, 10), ...slot(down, start, start + DAY, monitorStart, now) };
  });
  const HALF = 1_800_000;
  const blockEnd = Math.ceil(now / HALF) * HALF;
  const halfHours = Array.from({ length: 48 }, (_, index) => {
    const start = blockEnd - (48 - index) * HALF;
    return { start: new Date(start).toISOString(), ...slot(down, start, start + HALF, monitorStart, now) };
  });
  const total = slot(down, now - 30 * DAY, now, monitorStart, now);
  const day = slot(down, now - DAY, now, monitorStart, now);
  const incidents = [ongoing, ...events.slice(0, 25).map(event => ({ kind: event.kind, startedAt: event.started_at, endedAt: event.ended_at, note: event.note, ongoing: false }))].filter(Boolean) as any[];
  return { since: new Date(monitorStart).toISOString(), uptime30: total.pct, uptime24h: day.pct, days, halfHours, incidents, ongoing: Boolean(ongoing) };
}

/** Daily "was a sample stored that minute" coverage. A process that is down writes nothing, so gaps are downtime. */
async function coverage(sources: string[], now: number) {
  const todayStart = Math.floor(now / DAY) * DAY;
  const [first, rpc] = await Promise.all([
    supabase.from('status_samples').select('t').in('source', sources).order('t', { ascending: true }).limit(1),
    supabase.rpc('status_coverage', { p_sources: sources, p_from: new Date(todayStart - 29 * DAY).toISOString() }),
  ]);
  const error = first.error || rpc.error;
  if (error) { if (!warnSchema('status_coverage', error)) console.error('Status coverage failed:', error.message); return []; }
  const start = first.data?.[0] ? new Date((first.data[0] as any).t).getTime() : now;
  const byDay = new Map<number, number>(((rpc.data ?? []) as Array<{ day: string; minutes: number }>).map(row => [Date.parse(`${row.day}T00:00:00Z`) / DAY, Number(row.minutes)]));
  return Array.from({ length: 30 }, (_, index) => {
    const dayStart = todayStart - (29 - index) * DAY;
    const window = Math.min(dayStart + DAY, Math.floor(now / MINUTE) * MINUTE) - Math.max(dayStart, start);
    const expected = window / MINUTE;
    const got = byDay.get(dayStart / DAY) ?? 0;
    const date = new Date(dayStart).toISOString().slice(0, 10);
    if (expected < 2) return { date, pct: null as number | null, downMs: 0 };
    const pct = Math.min(100, Math.round((got / expected) * 10000) / 100);
    // A missed sample or two is noise, not downtime; round those days up and report no downtime for them.
    return pct >= 99.5 ? { date, pct: 100, downMs: 0 } : { date, pct, downMs: Math.max(0, Math.round((expected - got) * MINUTE)) };
  });
}
const average30 = (days: Array<{ pct: number | null }>) => { const real = days.filter(day => day.pct !== null) as Array<{ pct: number }>; return real.length ? Math.round((real.reduce((sum, day) => sum + day.pct, 0) / real.length) * 100) / 100 : null; };

let lastGood: any = null;
export const NAME = 'Rift';

/** When the database is unreachable nothing can be queried, so answer from the last known snapshot instead of hanging. */
function databaseDown() {
  const base = lastGood ?? { name: NAME, uptime: { h24: null, d30: null, since: null }, components: [], incidents: [], maintenances: { ongoing: [], upcoming: [], completed: [] }, restarts: [], lastSampleAt: null };
  const components = base.components.length
    ? base.components.map((component: any) => (component.key === 'database' ? { ...component, state: 'outage', detail: 'انقطع الاتصال' } : { ...component, detail: `${component.detail} (آخر حالة معروفة)` }))
    : [{ key: 'database', name: 'قاعدة البيانات', description: 'تحفظ الستاف والشفتات والطلبات', state: 'outage', detail: 'انقطع الاتصال', uptime30: null, days: [] }];
  return { posts: [], ...base, generatedAt: new Date().toISOString(), overall: { state: 'outage' as State, title: 'عطل كبير', text: 'قاعدة البيانات ما تستجيب' }, components };
}

export async function buildStatus() {
  try {
    const built = await buildStatusLive();
    lastGood = built;
    return built;
  } catch (error) {
    console.error('Status build failed, serving the last snapshot:', error instanceof Error ? error.message : error);
    return databaseDown();
  }
}

async function buildStatusLive() {
  const now = Date.now();
  const beat = await loadHeartbeat();
  // A missing table is not an outage of the database; anything else means the database cannot be reached.
  if (beat.error && !isSchemaError(beat.error)) throw new Error(beat.error.message);
  if (beat.error) warnSchema('bot_heartbeats', beat.error);
  const heartbeat = beat.row;
  const dbMs = beat.ms;
  const [uptime, dashDays, dbDays, maintenanceRows, downtime, restarts, latest, postRows] = await Promise.all([
    uptimeReport(now, heartbeat),
    coverage(['dashboard'], now), coverage(['bot', 'dashboard'], now),
    safe<any[]>('status_maintenances', () => supabase.from('status_maintenances').select('*').gte('ends_at', new Date(now - 30 * DAY).toISOString()).order('starts_at', { ascending: false }).limit(40), []),
    safe<any[]>('bot_status_events', () => supabase.from('bot_status_events').select('*').eq('kind', 'downtime').gte('started_at', new Date(now - 90 * DAY).toISOString()).order('started_at', { ascending: false }).limit(40), []),
    safe<any[]>('bot_status_events', () => supabase.from('bot_status_events').select('*').eq('kind', 'restart').gte('started_at', new Date(now - 30 * DAY).toISOString()).order('started_at', { ascending: false }).limit(10), []),
    safe<any[]>('status_samples', () => supabase.from('status_samples').select('t').eq('source', 'bot').order('t', { ascending: false }).limit(1), []),
    safe<any[]>('status_posts', () => supabase.from('status_posts').select('*').order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(30), []),
  ]);

  const maintenances = maintenanceRows.map(row => {
    const startsAt = new Date(row.starts_at).getTime();
    const endedAt = row.ended_early ? new Date(row.ended_at || row.updated_at || now).getTime() : null;
    const endsAt = endedAt !== null ? Math.max(startsAt, Math.min(new Date(row.ends_at).getTime(), endedAt)) : new Date(row.ends_at).getTime();
    // Ending a maintenance early (or cancelling one that has not started) always closes it.
    const state = endedAt !== null ? 'completed' : now < startsAt ? 'scheduled' : now < endsAt ? 'in_progress' : 'completed';
    return { id: String(row.id), title: row.title, description: row.description ?? '', startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(), affects: Array.isArray(row.affects) ? row.affects : [], status: state, updates: (Array.isArray(row.updates) ? row.updates : []).map((update: any) => ({ at: update.at, text: update.text })) };
  });
  const under = new Set(maintenances.filter(item => item.status === 'in_progress').flatMap(item => item.affects));

  const beatAge = heartbeat ? now - lastAlive(heartbeat) : Infinity;
  const botAlive = beatAge < DOWN_AFTER_MS;
  const ping = heartbeat?.ping_ms ?? 0;
  let bot: { state: State; detail: string };
  if (!heartbeat) bot = { state: 'outage', detail: 'ما انسجّلت أي نبضة للحين' };
  else if (beatAge > DOWN_AFTER_MS) bot = { state: 'outage', detail: 'ما يستجيب' };
  else if (heartbeat.ready === false) bot = { state: 'degraded', detail: 'يعيد الاتصال بديسكورد' };
  else if (beatAge > 30_000) bot = { state: 'degraded', detail: 'النبضة متأخرة' };
  else if (ping > 400) bot = { state: 'degraded', detail: `تأخير عالي، ${ping} ms` };
  else bot = { state: 'operational', detail: `يستجيب، ${ping} ms لديسكورد` };

  const sinceStart = heartbeat?.started_at ? now - new Date(heartbeat.started_at).getTime() : Infinity;
  const jobs = WATCHDOGS.map(([key, name, every]) => {
    const last = heartbeat?.watchdogs?.[key];
    if (!botAlive) return { key, name, state: 'outage' as State, detail: 'متوقفة لأن البوت طافي', lastRun: last ? new Date(last).toISOString() : null };
    // Right after a restart a job has not had its first turn yet: that is not a problem.
    if (!last) return { key, name, state: (sinceStart < every * 1500 ? 'operational' : 'degraded') as State, detail: sinceStart < every * 1500 ? 'قاعدة تشتغل' : 'تنتظر أول تشغيل', lastRun: null };
    const age = now - last;
    return { key, name, state: (age > every * 2500 ? 'outage' : age > every * 1500 ? 'degraded' : 'operational') as State, detail: `تشتغل كل ${every >= 60 ? `${Math.round(every / 60)} دقيقة` : `${every} ثانية`}`, lastRun: new Date(last).toISOString() };
  });
  const jobsState: State = jobs.some(job => job.state === 'outage') ? 'outage' : jobs.some(job => job.state === 'degraded') ? 'degraded' : 'operational';
  const database: { state: State; detail: string } = dbMs > 300 ? { state: 'degraded', detail: `بطيئة، ${dbMs} ms لكل استعلام` } : { state: 'operational', detail: `متصلة، ${dbMs} ms لكل استعلام` };

  const apply = (key: string, base: { state: State; detail: string }) => (under.has(key) ? { state: 'maintenance' as State, detail: 'صيانة مجدولة شغّالة الحين' } : base);
  const components = [
    { key: 'bot', name: 'بوت ديسكورد', description: 'أوامر السلاش واللوحات وتتبّع الشفتات', ...apply('bot', bot), uptime30: uptime.uptime30, days: uptime.days.map(day => ({ date: day.date, pct: day.pct, downMs: day.downMs })) },
    { key: 'jobs', name: 'المهام الخلفية', description: 'فحص الشفتات ومزامنة الرتب والتقارير الأسبوعية', ...apply('jobs', { state: jobsState, detail: jobsState === 'operational' ? 'كل المهام تشتغل في وقتها' : `${jobs.filter(job => job.state !== 'operational').length} مهمة تحتاج انتباه` }), uptime30: null, days: [] as any[], jobs },
    { key: 'database', name: 'قاعدة البيانات', description: 'تحفظ الستاف والشفتات والطلبات', ...apply('database', database), uptime30: average30(dbDays), days: dbDays },
    { key: 'dashboard', name: 'لوحة التحكم', description: 'لوحة التحكم على الويب والبروفايلات العامة', ...apply('dashboard', { state: 'operational' as State, detail: 'تخدم الطلبات' }), uptime30: average30(dashDays), days: dashDays },
  ];

  const critical = components.filter(component => (component.key === 'bot' || component.key === 'database') && component.state === 'outage');
  const impacted = components.filter(component => component.state === 'degraded' || component.state === 'outage');
  const inMaintenance = components.filter(component => component.state === 'maintenance');
  const overall = critical.length ? { state: 'outage' as State, title: 'عطل كبير', text: `${critical.map(component => component.name).join(' و')} ما تستجيب` }
    : inMaintenance.length ? { state: 'maintenance' as State, title: 'صيانة مجدولة', text: `${inMaintenance.map(component => component.name).join('، ')} تحت الصيانة` }
    : impacted.length ? { state: 'degraded' as State, title: 'تراجع جزئي في الأداء', text: `${impacted.map(component => component.name).join('، ')} أداؤها متراجع` }
    : { state: 'operational' as State, title: 'كل الأنظمة شغّالة', text: 'كل الأنظمة تشتغل طبيعي' };

  const incidents = [
    ...(uptime.ongoing ? [{ id: `ongoing-${uptime.incidents[0]?.startedAt || now}`, title: 'بوت ديسكورد طافي', impact: 'outage', status: 'investigating', startedAt: uptime.incidents[0]?.startedAt, resolvedAt: null, updates: [{ status: 'investigating', at: uptime.incidents[0]?.startedAt, text: `${uptime.incidents[0]?.note || 'البوت وقف عن الاستجابة'}. انعلّم إنه طافي وانبلّغ الفريق.` }] }] : []),
    ...downtime.map(event => ({ id: String(event.id), title: 'بوت ديسكورد طفى', impact: 'outage', status: 'resolved', startedAt: new Date(event.started_at).toISOString(), resolvedAt: new Date(event.ended_at).toISOString(), updates: [{ status: 'investigating', at: new Date(event.started_at).toISOString(), text: `${event.note || 'البوت وقف عن الاستجابة'}. انعلّم إنه طافي.` }, { status: 'resolved', at: new Date(event.ended_at).toISOString(), text: 'البوت رجع شغّال. انحلّت المشكلة.' }] })),
  ];

  return {
    generatedAt: new Date(now).toISOString(), name: NAME, overall,
    uptime: { h24: uptime.uptime24h, d30: uptime.uptime30, since: uptime.since },
    components, incidents,
    maintenances: { ongoing: maintenances.filter(item => item.status === 'in_progress'), upcoming: maintenances.filter(item => item.status === 'scheduled').reverse(), completed: maintenances.filter(item => item.status === 'completed') },
    restarts: restarts.map(event => ({ at: new Date(event.started_at).toISOString(), note: event.note })),
    posts: postRows.map(row => ({ id: String(row.id), title: row.title, body: row.body || '', kind: row.kind, pinned: Boolean(row.pinned), authorName: '', authorAvatar: '', createdAt: row.created_at, updatedAt: row.updated_at })),
    lastSampleAt: latest[0] ? new Date(latest[0].t).toISOString() : null,
  };
}

// ---- Metrics: bot or dashboard response time over a range ----------------------------------------
export async function buildMetrics(source: 'bot' | 'dashboard', range: string) {
  const { ms, bucket } = RANGES[range] ?? RANGES['24h']!;
  const from = new Date(Date.now() - ms);
  const round = (n: number) => Math.round(n * 10) / 10;
  const rpc = await supabase.rpc('status_metrics', { p_source: source, p_from: from.toISOString(), p_bucket_seconds: Math.round(bucket / 1000) });
  if (!rpc.error) {
    const points = ((rpc.data ?? []) as any[]).map(row => ({ t: Number(row.bucket), cpu: round(Number(row.cpu)), mem: Math.round(Number(row.mem)), ping: Math.round(Number(row.ping)), dbMs: round(Number(row.db_ms)) }));
    return { source, range, bucketMs: bucket, from: from.toISOString(), points };
  }
  if (!warnSchema('status_metrics', rpc.error)) console.error('Status metrics RPC failed:', rpc.error.message);
  // Without the function, average the newest samples here (recent history only).
  const raw = await supabase.from('status_samples').select('t, cpu, mem, ping, db_ms').eq('source', source).gte('t', from.toISOString()).order('t', { ascending: false }).limit(10000);
  if (raw.error) throw new Error(raw.error.message);
  const buckets = new Map<number, { n: number; cpu: number; mem: number; ping: number; db: number }>();
  for (const row of raw.data ?? []) {
    const key = Math.floor(new Date((row as any).t).getTime() / bucket) * bucket;
    const item = buckets.get(key) ?? { n: 0, cpu: 0, mem: 0, ping: 0, db: 0 };
    item.n += 1; item.cpu += Number((row as any).cpu); item.mem += Number((row as any).mem); item.ping += Number((row as any).ping); item.db += Number((row as any).db_ms);
    buckets.set(key, item);
  }
  const points = [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([t, item]) => ({ t, cpu: round(item.cpu / item.n), mem: Math.round(item.mem / item.n), ping: Math.round(item.ping / item.n), dbMs: round(item.db / item.n) }));
  return { source, range, bucketMs: bucket, from: from.toISOString(), points };
}
export const validRange = (value: unknown) => (RANGES[String(value)] ? String(value) : '24h');

// ---- Badge, link-preview tags, RSS ---------------------------------------------------------------
const xml = (value: unknown) => String(value ?? '').replace(/[<>&'"]/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[char]!));
const STATE_COLOR: Record<State, string> = { operational: '#4fc08d', degraded: '#e0b04f', outage: '#e9697b', maintenance: '#8175f5' };

/** Small SVG badge ("rift | operational") for READMEs and websites. */
export function statusBadge(state: State) {
  const label = 'rift'; const value = state;
  const w1 = 12 + label.length * 6.4; const w2 = 14 + value.length * 6.4; const width = Math.round(w1 + w2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${label}: ${value}"><title>${label}: ${value}</title><clipPath id="r"><rect width="${width}" height="20" rx="4" fill="#fff"/></clipPath><g clip-path="url(#r)"><rect width="${Math.round(w1)}" height="20" fill="#2b2540"/><rect x="${Math.round(w1)}" width="${width - Math.round(w1)}" height="20" fill="${STATE_COLOR[state]}"/></g><g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11"><text x="${(w1 / 2).toFixed(1)}" y="14">${label}</text><text x="${(w1 + w2 / 2).toFixed(1)}" y="14" font-weight="bold">${value}</text></g></svg>`;
}

/** Link-preview tags (Discord, chat apps, search) carrying the live status, added to the page as it is served. */
export function statusMetaTags(overall: { state: State; title: string; text: string } | null, baseUrl: string) {
  const state = overall?.state || 'operational';
  const title = overall ? `${overall.title} · حالة Rift` : 'حالة Rift';
  const description = overall?.text || 'الحالة المباشرة لبوت ستاف Rift: هل هو شغّال، وش نشر الفريق، وكيف كان أداؤه.';
  const url = /^https?:\/\//.test(baseUrl) ? `${baseUrl.replace(/\/$/, '')}/status` : '';
  return [
    `<meta property="og:type" content="website">`, `<meta property="og:site_name" content="ستاف Rift">`, `<meta property="og:title" content="${xml(title)}">`, `<meta property="og:description" content="${xml(description)}">`,
    ...(url ? [`<meta property="og:url" content="${xml(url)}">`, `<link rel="canonical" href="${xml(url)}">`] : []),
    `<meta name="twitter:card" content="summary">`, `<meta name="twitter:title" content="${xml(title)}">`, `<meta name="twitter:description" content="${xml(description)}">`,
    `<meta name="theme-color" content="${STATE_COLOR[state]}">`,
  ].join('\n  ');
}

const MAINT_AR: Record<string, string> = { scheduled: 'مجدولة', in_progress: 'شغّالة', completed: 'مكتملة' };
const INCIDENT_AR: Record<string, string> = { investigating: 'قيد التحقيق', resolved: 'انحلّت' };
export function statusRss(data: any, base: string) {
  const items = [
    ...data.incidents.map((item: any) => ({ title: `${item.title} (${INCIDENT_AR[item.status] || item.status})`, at: item.resolvedAt || item.startedAt, text: item.updates.at(-1)?.text || '', id: item.id })),
    ...(data.posts || []).map((item: any) => ({ title: item.title, at: item.createdAt, text: item.body || '', id: `post-${item.id}` })),
    ...[...data.maintenances.ongoing, ...data.maintenances.upcoming, ...data.maintenances.completed.slice(0, 10)].map((item: any) => ({ title: `صيانة: ${item.title} (${MAINT_AR[item.status] || String(item.status).replace('_', ' ')})`, at: item.startsAt, text: item.description || '', id: `${item.id}-${item.status}` })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 30);
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>حالة Rift</title><link>${xml(base)}/status</link><description>الأعطال والأخبار والصيانة الخاصة بـ Rift</description>${items.map(item => `<item><title>${xml(item.title)}</title><link>${xml(base)}/status</link><guid isPermaLink="false">${xml(item.id)}</guid><pubDate>${new Date(item.at).toUTCString()}</pubDate><description>${xml(item.text)}</description></item>`).join('')}</channel></rss>`;
}

/** Public base URL. Never built from the Host header alone: a shared cache could be poisoned with a foreign address. */
export const publicBase = (fallback: string) => (/^https?:\/\//.test(env.dashboardUrl) ? env.dashboardUrl.replace(/\/$/, '') : fallback);
