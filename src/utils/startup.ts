import { banner, c, formatUptime, gauge, megabytes, panel, status, underControlCenter } from './terminal.js';

const startedAt = Date.now();
let lastStep = Date.now();

// Under `npm run start:all` the control center already drew the banner and adds the prefixes.
export function bootBanner() {
  if (underControlCenter()) return;
  banner('Staff operations control plane');
}

/** A finished startup step, with how long it took since the previous one. */
export function bootStep(label: string, message: string) {
  const now = Date.now();
  const took = now - lastStep; lastStep = now;
  console.log(`  ${status('ok', label.charAt(0) + label.slice(1).toLowerCase(), message)} ${c.grey}${took >= 50 ? `${took}ms` : ''}${c.reset}`);
}

export function bootWait(label: string, message: string) {
  console.log(`  ${status('wait', label.charAt(0) + label.slice(1).toLowerCase(), message)}`);
}

export function bootWarn(label: string, message: string) {
  console.log(`  ${status('warn', label.charAt(0) + label.slice(1).toLowerCase(), message)}`);
}

export function bootFailure(message: string) {
  console.log(`  ${status('fail', 'Failed', `${c.red}${message}${c.reset}`)}`);
}

export interface ReadyInfo { tag?: string; guilds?: number; staff?: number; onShift?: number; pingMs?: number; emojis?: string; dashboardUrl?: string; autoShift?: string }

/** The boxed summary shown once the bot is fully started. */
export function bootReady(info: ReadyInfo | string = {}) {
  const data: ReadyInfo = typeof info === 'string' ? { dashboardUrl: info } : info;
  const rows: Array<[string, string]> = [];
  if (data.tag) rows.push(['Bot', `${c.bold}${data.tag}${c.reset}`]);
  if (data.guilds !== undefined) rows.push(['Servers', String(data.guilds)]);
  if (data.staff !== undefined) rows.push(['Staff', `${data.staff} registered · ${c.green}${data.onShift ?? 0} on shift${c.reset}`]);
  if (data.pingMs !== undefined) rows.push(['Latency', `${gauge(Math.min(1, data.pingMs / 400))} ${data.pingMs}ms`]);
  if (data.autoShift) rows.push(['Auto shifts', data.autoShift]);
  if (data.emojis) rows.push(['Emojis', data.emojis]);
  rows.push(['Memory', megabytes(process.memoryUsage().rss)]);
  rows.push(['Started in', `${((Date.now() - startedAt) / 1000).toFixed(1)}s`]);
  if (data.dashboardUrl) rows.push(['Dashboard', `${c.lilac}${data.dashboardUrl}${c.reset}`]);
  console.log(`\n${panel('Rift is online', rows, c.purple)}`);
  if (!underControlCenter()) console.log(`  ${c.grey}Press Ctrl+C to stop${c.reset}`);
  console.log('');
}

export { formatUptime };
