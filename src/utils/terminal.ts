// Terminal look for Rift Staff: purple banner, badge-prefixed lines, boxed panels and event lines.
// 256-colour codes work in Windows Terminal, the classic console (Windows 10+) and macOS/Linux terminals.
export const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  purple: '\x1b[38;5;141m', lilac: '\x1b[38;5;183m', deep: '\x1b[38;5;99m', cyan: '\x1b[38;5;81m',
  green: '\x1b[38;5;78m', yellow: '\x1b[38;5;221m', red: '\x1b[38;5;204m', grey: '\x1b[38;5;245m', white: '\x1b[97m',
};
const fg = (n: number) => `\x1b[38;5;${n}m`;
const bg = (n: number) => `\x1b[48;5;${n}m`;
// eslint-disable-next-line no-control-regex
const strip = (value: string) => value.replace(/\x1b\[[0-9;]*m/g, '');
const width = (value: string) => [...strip(value)].length;

// "RIFT" and "STAFF" in the ANSI Shadow font, joined row by row.
const RIFT = [
  '██████╗ ██╗███████╗████████╗',
  '██╔══██╗██║██╔════╝╚══██╔══╝',
  '██████╔╝██║█████╗     ██║   ',
  '██╔══██╗██║██╔══╝     ██║   ',
  '██║  ██║██║██║        ██║   ',
  '╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ',
];
const STAFF = [
  '███████╗████████╗ █████╗ ███████╗███████╗',
  '██╔════╝╚══██╔══╝██╔══██╗██╔════╝██╔════╝',
  '███████╗   ██║   ███████║█████╗  █████╗  ',
  '╚════██║   ██║   ██╔══██║██╔══╝  ██╔══╝  ',
  '███████║   ██║   ██║  ██║██║     ██║     ',
  '╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝     ╚═╝     ',
];
// Light lilac to deep violet, one shade per row.
const SHADES = [225, 189, 183, 141, 135, 99];

export function banner(subtitle: string) {
  const columns = process.stdout.columns || 120;
  const wide = columns >= 80;
  const lines = RIFT.map((row, index) => `  ${fg(SHADES[index]!)}${row}${wide ? `  ${STAFF[index]}` : ''}${c.reset}`);
  if (process.stdout.isTTY) console.clear();
  console.log(`\n${lines.join('\n')}`);
  if (!wide) console.log(`  ${c.bold}${c.purple}S T A F F${c.reset}`);
  const rule = '─'.repeat(Math.min(wide ? 72 : 36, columns - 4));
  console.log(`  ${c.deep}${rule}${c.reset}`);
  console.log(`  ${c.lilac}${subtitle}${c.reset}\n`);
}

/** A coloured tag such as " BOT " or " WEB ". */
export const badge = (label: string, colour: number) => `${bg(colour)}${c.white}${c.bold} ${label} ${c.reset}`;
export const time = () => `${c.grey}${new Date().toTimeString().slice(0, 8)}${c.reset}`;

/** One status line: "✔ Discord    connected as Rift#0001". */
export function status(kind: 'ok' | 'wait' | 'fail' | 'info' | 'warn', label: string, message: string) {
  const mark = { ok: `${c.green}✔`, wait: `${c.yellow}●`, fail: `${c.red}✖`, info: `${c.purple}›`, warn: `${c.yellow}▲` }[kind];
  return `${mark}${c.reset} ${c.bold}${label.padEnd(10)}${c.reset} ${message}`;
}

// ---- Events: things that happen while the bot runs (shifts, reports, emoji sync). ---------------
const EVENTS = {
  shiftStart: { icon: '▶', colour: c.green, label: 'شفت' },
  shiftEnd: { icon: '■', colour: c.lilac, label: 'شفت' },
  report: { icon: '◆', colour: c.purple, label: 'تقرير' },
  voice: { icon: '♪', colour: c.cyan, label: 'فويس' },
  db: { icon: '⛁', colour: c.cyan, label: 'بيانات' },
  emoji: { icon: '✦', colour: c.lilac, label: 'إيموجي' },
  warn: { icon: '▲', colour: c.yellow, label: 'تنبيه' },
  error: { icon: '✖', colour: c.red, label: 'خطأ' },
  info: { icon: '›', colour: c.purple, label: 'معلومة' },
} as const;
export type EventKind = keyof typeof EVENTS;

/** "  ▶ SHIFT   @name started automatically (20 messages / 10 min)" */
export function event(kind: EventKind, message: string) {
  const style = EVENTS[kind];
  console.log(`  ${style.colour}${style.icon} ${c.bold}${style.label.padEnd(7)}${c.reset} ${message}`);
}

// ---- Boxed panels ---------------------------------------------------------------------------------
/** A rounded box with a title and "label  value" rows. */
export function panel(title: string, rows: Array<[string, string]>, colour = c.deep) {
  const labelWidth = Math.max(0, ...rows.map(([label]) => label.length));
  const body = rows.map(([label, value]) => `${c.grey}${label.padEnd(labelWidth)}${c.reset}  ${value}`);
  const inner = Math.max(width(title) + 4, ...body.map(width)) + 2;
  const line = (content: string) => `  ${colour}│${c.reset} ${content}${' '.repeat(Math.max(0, inner - width(content) - 1))}${colour}│${c.reset}`;
  const top = `  ${colour}╭─ ${c.reset}${c.bold}${c.lilac}${title}${c.reset}${colour} ${'─'.repeat(Math.max(0, inner - width(title) - 3))}╮${c.reset}`;
  return [top, ...body.map(line), `  ${colour}╰${'─'.repeat(inner)}╯${c.reset}`].join('\n');
}

export const formatUptime = (ms: number) => {
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86400); const hours = Math.floor((seconds % 86400) / 3600); const minutes = Math.floor((seconds % 3600) / 60);
  return days ? `${days}d ${hours}h ${minutes}m` : hours ? `${hours}h ${minutes}m` : minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
};
export const megabytes = (bytes: number) => `${Math.round(bytes / 1048576)} MB`;

/** A short coloured bar, for example for latency or memory: gauge(0.4) -> ▰▰▰▰▱▱▱▱▱▱ */
export function gauge(ratio: number, length = 10) {
  const filled = Math.max(0, Math.min(length, Math.round(ratio * length)));
  const colour = ratio > 0.85 ? c.red : ratio > 0.6 ? c.yellow : c.green;
  return `${colour}${'▰'.repeat(filled)}${c.grey}${'▱'.repeat(length - filled)}${c.reset}`;
}

// Child processes started by `npm run start:all` get RIFT_CHILD=1: the parent draws the banner and prefixes lines.
export const underControlCenter = () => process.env.RIFT_CHILD === '1';
