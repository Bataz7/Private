import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createInterface, emitKeypressEvents } from 'node:readline';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConnection } from 'node:net';
import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { badge, banner, c, formatUptime, megabytes, panel, status, time } from '../src/utils/terminal.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const tsx = resolve(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const lockPath = resolve(root, '.rift-runtime.lock');
const startedAt = Date.now();

function acquireRuntimeLock() {
  if (existsSync(lockPath)) {
    const previousPid = Number(readFileSync(lockPath, 'utf8'));
    if (previousPid && previousPid !== process.pid) {
      try { process.kill(previousPid, 0); console.error('Rift is already running from this workspace. Stop the existing runtime before starting another one.'); process.exit(1); } catch { unlinkSync(lockPath); }
    } else unlinkSync(lockPath);
  }
  const descriptor = openSync(lockPath, 'wx');
  writeFileSync(descriptor, String(process.pid));
  closeSync(descriptor);
}

acquireRuntimeLock();

type Label = 'BOT' | 'DASHBOARD';
// Badge colours (256-colour backgrounds): the bot in violet, the dashboard in teal, the control center in deep purple.
const BADGES: Record<string, string> = { BOT: badge('BOT', 98), DASHBOARD: badge('WEB', 30), CENTER: badge('RIFT', 54) };
const NAMES: Record<Label, string> = { BOT: 'Bot', DASHBOARD: 'Dashboard' };
const say = (line: string) => console.log(`  ${time()}  ${BADGES.CENTER}  ${line}`);

interface Service { label: Label; script: string; child?: ChildProcess; startedAt: number; restarts: number; stopping: boolean; lastLines: string[] }
const services: Service[] = [];
let quiet = false; // hides routine lines (press "q") so only warnings and errors show

banner(`Control center · bot + dashboard · Node ${process.version}`);

if (process.env.REGISTER_COMMANDS_ON_START === '1') {
  try {
    execFileSync(process.execPath, [tsx, 'scripts/register-commands.ts'], { cwd: root, env: process.env, stdio: 'pipe' });
    say(status('ok', 'Commands', 'Slash commands registered'));
  } catch {
    say(status('fail', 'Commands', 'Could not register slash commands'));
  }
} else {
  say(status('info', 'Commands', 'Using registered commands (run npm run register after command changes)'));
}

// Lines a child prints to stderr are errors or warnings; show them in red so they stand out.
function launch(service: Service) {
  const child = spawn(process.execPath, [tsx, service.script], {
    cwd: root,
    env: { ...process.env, RIFT_CHILD: '1', FORCE_COLOR: '1' },
    stdio: ['inherit', 'pipe', 'pipe'],
    windowsHide: false
  });
  service.child = child; service.startedAt = Date.now(); service.stopping = false;
  const prefix = BADGES[service.label];
  const print = (line: string, error: boolean) => {
    const clean = line.replace(/^\s{2}/, '');
    if (!clean.trim()) return;
    service.lastLines = [...service.lastLines.slice(-19), clean];
    const important = error || /✖|▲|fail|error|warn/i.test(clean);
    if (quiet && !important) return;
    console.log(`  ${time()}  ${prefix}  ${error ? `${c.red}${clean}${c.reset}` : clean}`);
  };
  if (child.stdout) createInterface({ input: child.stdout }).on('line', line => print(line, false));
  if (child.stderr) createInterface({ input: child.stderr }).on('line', line => print(line, true));
  child.on('error', error => print(error.message, true));
  child.on('close', code => {
    if (service.stopping || shuttingDown) { say(status('info', NAMES[service.label], 'stopped')); return; }
    if (code === 0) { say(status('info', NAMES[service.label], 'exited')); return; }
    // Crash: restart with a growing delay (2s, 4s, ... max 30s). A run that stayed up for a minute resets the counter.
    if (Date.now() - service.startedAt > 60_000) service.restarts = 0;
    service.restarts += 1;
    if (service.restarts > 8) { say(status('fail', NAMES[service.label], `crashed ${service.restarts} times in a row, giving up. Fix the error above and press "r".`)); return; }
    const delay = Math.min(30_000, 2000 * 2 ** (service.restarts - 1));
    say(status('warn', NAMES[service.label], `stopped with code ${code}. Restarting in ${Math.round(delay / 1000)}s (attempt ${service.restarts}/8)`));
    setTimeout(() => { if (!shuttingDown && !service.stopping) launch(service); }, delay);
  });
}

function start(label: Label, script: string) {
  const service: Service = { label, script, startedAt: Date.now(), restarts: 0, stopping: false, lastLines: [] };
  services.push(service);
  launch(service);
}

function restart(label: Label) {
  const service = services.find(item => item.label === label);
  if (!service) return say(status('warn', NAMES[label], 'is not managed by this control center'));
  say(status('wait', NAMES[label], 'restarting…'));
  service.restarts = 0;
  service.stopping = true;
  const old = service.child;
  if (!old || old.exitCode !== null) return launch(service);
  old.once('close', () => setTimeout(() => launch(service), 300));
  old.kill();
}

function portInUse(port: number) {
  return new Promise<boolean>(resolvePort => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); resolvePort(true); });
    socket.once('error', () => resolvePort(false));
  });
}

start('BOT', 'src/index.ts');
const dashboardPort = Number(process.env.DASHBOARD_PORT || 3000);
if (await portInUse(dashboardPort)) {
  say(status('ok', 'Dashboard', `Port ${dashboardPort} is already in use; using the existing dashboard process`));
} else {
  start('DASHBOARD', 'src/dashboard/server.ts');
}

// ---- Hotkeys -------------------------------------------------------------------------------------
function showStatus() {
  const rows: Array<[string, string]> = [['Control uptime', formatUptime(Date.now() - startedAt)], ['Control memory', megabytes(process.memoryUsage().rss)]];
  for (const service of services) {
    const running = service.child && service.child.exitCode === null && !service.stopping;
    rows.push([NAMES[service.label], `${running ? `${c.green}running${c.reset} for ${formatUptime(Date.now() - service.startedAt)}` : `${c.red}stopped${c.reset}`}${service.restarts ? ` · ${service.restarts} restart${service.restarts === 1 ? '' : 's'}` : ''}`]);
  }
  console.log(`\n${panel('Rift status', rows)}\n`);
}

function showHelp() {
  const keys: Array<[string, string]> = [['r', 'restart the bot'], ['d', 'restart the dashboard'], ['s', 'show status'], ['l', 'show last lines of the bot'], ['q', 'quiet mode on/off (only warnings and errors)'], ['c', 'clear the screen'], ['h', 'this help'], ['Ctrl+C', 'stop everything']];
  console.log(`\n${panel('Hotkeys', keys.map(([key, text]) => [key, text] as [string, string]))}\n`);
}

if (process.stdin.isTTY) {
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.on('keypress', (_text, key) => {
    if (key.ctrl && key.name === 'c') return stopAll();
    switch (key.name) {
      case 'r': return restart('BOT');
      case 'd': return restart('DASHBOARD');
      case 's': return showStatus();
      case 'h': return showHelp();
      case 'c': console.clear(); return banner(`Control center · bot + dashboard · Node ${process.version}`);
      case 'q': quiet = !quiet; return say(status('info', 'Output', quiet ? 'quiet mode on: only warnings and errors' : 'quiet mode off'));
      case 'l': { const bot = services.find(item => item.label === 'BOT'); return console.log(`\n${(bot?.lastLines ?? []).map(line => `  ${c.grey}│${c.reset} ${line}`).join('\n') || '  (no output yet)'}\n`); }
    }
  });
  say(status('info', 'Hotkeys', `${c.bold}r${c.reset} restart bot · ${c.bold}d${c.reset} dashboard · ${c.bold}s${c.reset} status · ${c.bold}q${c.reset} quiet · ${c.bold}h${c.reset} help`));
}

// Every 30 minutes, one quiet status line so a long-running window shows the system is alive.
setInterval(() => {
  if (quiet) return;
  const running = services.filter(service => service.child && service.child.exitCode === null).length;
  say(status('info', 'Heartbeat', `${running}/${services.length} services up · ${formatUptime(Date.now() - startedAt)} uptime`));
}, 30 * 60_000).unref();

let shuttingDown = false;
function stopAll() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('');
  say(status('wait', 'Stopping', 'Rift Staff is shutting down…'));
  for (const service of services) { service.stopping = true; if (service.child && !service.child.killed) service.child.kill(); }
  if (existsSync(lockPath)) unlinkSync(lockPath);
  setTimeout(() => process.exit(0), 400);
}

process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);
process.on('exit', () => { if (existsSync(lockPath)) unlinkSync(lockPath); });
