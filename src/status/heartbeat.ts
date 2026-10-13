import type { Client } from '../lib/djs/index.js';
import { supabase } from '../supabase/client.js';
import { warnSchema } from './shared.js';

// Bot side of the public status page: a heartbeat every 15 seconds, a metrics sample every minute, and a record of
// restarts and downtime. The dashboard reads these rows; nothing here needs a manual step.

/** Last successful run of each background job (epoch ms), published inside the heartbeat. */
export const watchdogRuns: Record<string, number> = {};
const runningJobs = new Set<string>();

export const markJob = (name: string) => { watchdogRuns[name] = Date.now(); };

/** Runs a background job and remembers when it last succeeded. A run that is still going is skipped, never doubled. */
export async function tracked(name: string, job: () => Promise<unknown> | unknown) {
  if (runningJobs.has(name)) return;
  runningJobs.add(name);
  try { await job(); markJob(name); } finally { runningJobs.delete(name); }
}

const startedAt = new Date();
let firstSeenAt = new Date();
const DOWNTIME_GAP_MS = 45_000;

/** On every start, the last heartbeat of the previous run tells how long the bot was away. That gap is the downtime. */
export async function recordStartup() {
  const now = new Date();
  const { data: previous, error } = await supabase.from('bot_heartbeats').select('*').eq('key', 'main').maybeSingle();
  if (error) { warnSchema('bot_heartbeats', error); return; }
  if (previous?.first_seen_at) firstSeenAt = new Date(previous.first_seen_at);
  if (!previous?.updated_at) return;
  const stopped = previous.stopped_at ? new Date(previous.stopped_at) : null;
  const lastAlive = stopped && stopped > new Date(previous.updated_at) ? stopped : new Date(previous.updated_at);
  const gap = now.getTime() - lastAlive.getTime();
  const events: Array<Record<string, unknown>> = [{ kind: 'restart', started_at: now.toISOString(), ended_at: now.toISOString(), note: previous.stopped_at ? 'توقف بشكل سليم وانعاد تشغيله' : 'اشتغل بعد توقف مفاجئ' }];
  if (gap > DOWNTIME_GAP_MS) events.push({ kind: 'downtime', started_at: lastAlive.toISOString(), ended_at: now.toISOString(), note: previous.stopped_at ? 'البوت انوقف' : 'البوت وقف عن الاستجابة (تعطّل أو انقطع الاتصال)' });
  const saved = await supabase.from('bot_status_events').insert(events);
  if (saved.error) warnSchema('bot_status_events', saved.error) || console.error('Could not record the restart:', saved.error.message);
}

let lastCpu = process.cpuUsage();
let lastCpuAt = Date.now();
let lastSampleAt = 0;

/** Once a minute: process CPU (share of one core), memory, gateway ping and how long a database read takes. */
async function recordSample(bot: Client, dbMs: number) {
  const now = Date.now();
  if (now - lastSampleAt < 55_000) return;
  lastSampleAt = now;
  const usage = process.cpuUsage(lastCpu);
  const cpu = Math.min(100, ((usage.user + usage.system) / 1000 / Math.max(1, now - lastCpuAt)) * 100);
  lastCpu = process.cpuUsage(); lastCpuAt = now;
  const { error } = await supabase.from('status_samples').insert({ t: new Date(now).toISOString(), source: 'bot', cpu: Math.round(cpu * 10) / 10, mem: Math.round(process.memoryUsage().rss / 1048576), ping: Number.isFinite(bot.ws.ping) ? Math.max(0, Math.round(bot.ws.ping)) : 0, db_ms: Math.round(dbMs) });
  if (error && !warnSchema('status_samples', error)) console.error('Status sample failed:', error.message);
}

export async function publishHeartbeat(bot: Client) {
  const started = performance.now();
  const shifts = await supabase.from('shifts').select('id', { count: 'exact', head: true }).eq('status', 'active');
  const { error } = await supabase.from('bot_heartbeats').upsert({
    key: 'main', started_at: startedAt.toISOString(), updated_at: new Date().toISOString(), ping_ms: Math.max(0, Math.round(bot.ws.ping)), guilds: bot.guilds.cache.size,
    memory_mb: Math.round(process.memoryUsage().rss / 1048576), node_version: process.version, active_shifts: shifts.count ?? 0, watchdogs: watchdogRuns, first_seen_at: firstSeenAt.toISOString(), stopped_at: null,
    // A running process with a dead gateway is not healthy; the status page shows it as reconnecting.
    ready: bot.isReady() && bot.ws.status === 0,
  }, { onConflict: 'key' });
  if (error) { if (!warnSchema('bot_heartbeats', error)) console.error('Heartbeat failed:', error.message); return; }
  await recordSample(bot, performance.now() - started);
}

/** Written on a clean shutdown so the next start records "Bot was stopped" instead of a crash. Never waits long. */
export async function markBotStopped() {
  await Promise.race([
    Promise.resolve(supabase.from('bot_heartbeats').update({ stopped_at: new Date().toISOString() }).eq('key', 'main')).catch(() => null),
    new Promise(resolve => setTimeout(resolve, 1500)),
  ]);
}

/** Samples expire after 91 days. */
export async function pruneSamples() {
  const { error } = await supabase.from('status_samples').delete().lt('t', new Date(Date.now() - 91 * 86_400_000).toISOString());
  if (error) warnSchema('status_samples', error);
}

let signalsBound = false;
/** SIGTERM (a service manager stopping the bot) is recorded as a clean stop too. SIGINT is handled in index.ts. */
export function bindShutdown() {
  if (signalsBound) return;
  signalsBound = true;
  process.once('SIGTERM', () => { void markBotStopped().finally(() => process.exit(0)); });
}
