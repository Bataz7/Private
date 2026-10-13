import { banner, c, formatUptime, gauge, megabytes, panel, status, underControlCenter } from './terminal.js';

const startedAt = Date.now();
let lastStep = Date.now();

// Under `npm run start:all` the control center already drew the banner and adds the prefixes.
export function bootBanner() {
  if (underControlCenter()) return;
  banner('لوحة تشغيل إدارة الستاف');
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
  console.log(`  ${status('fail', 'فشل', `${c.red}${message}${c.reset}`)}`);
}

export interface ReadyInfo { tag?: string; guilds?: number; staff?: number; onShift?: number; pingMs?: number; emojis?: string; dashboardUrl?: string; autoShift?: string }

/** The boxed summary shown once the bot is fully started. */
export function bootReady(info: ReadyInfo | string = {}) {
  const data: ReadyInfo = typeof info === 'string' ? { dashboardUrl: info } : info;
  const rows: Array<[string, string]> = [];
  if (data.tag) rows.push(['البوت', `${c.bold}${data.tag}${c.reset}`]);
  if (data.guilds !== undefined) rows.push(['السيرفرات', String(data.guilds)]);
  if (data.staff !== undefined) rows.push(['الستاف', `${data.staff} مسجّل · ${c.green}${data.onShift ?? 0} في الشفت${c.reset}`]);
  if (data.pingMs !== undefined) rows.push(['الاستجابة', `${gauge(Math.min(1, data.pingMs / 400))} ${data.pingMs}ms`]);
  if (data.autoShift) rows.push(['الشفت التلقائي', data.autoShift]);
  if (data.emojis) rows.push(['الإيموجي', data.emojis]);
  rows.push(['الذاكرة', megabytes(process.memoryUsage().rss)]);
  rows.push(['وقت التشغيل', `${((Date.now() - startedAt) / 1000).toFixed(1)} ثانية`]);
  if (data.dashboardUrl) rows.push(['لوحة التحكم', `${c.lilac}${data.dashboardUrl}${c.reset}`]);
  console.log(`\n${panel('Rift شغّال', rows, c.purple)}`);
  if (!underControlCenter()) console.log(`  ${c.grey}اضغط Ctrl+C للإيقاف${c.reset}`);
  console.log('');
}

export { formatUptime };
