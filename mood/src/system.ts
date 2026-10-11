/** معلومات النظام: الذاكرة (RAM)، وقت التشغيل، والبانر الجميل في الترمنال. */
import { color } from "./log.ts";

export function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export interface MemoryInfo {
  rss: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
}

export function memory(): MemoryInfo {
  const m = process.memoryUsage();
  return { rss: m.rss, heapUsed: m.heapUsed, heapTotal: m.heapTotal, external: m.external };
}

/** "48.2 MB RAM (heap 21.3 / 32.0 MB)" */
export function memoryLine(m = memory()): string {
  return `${mb(m.rss)} RAM (heap ${mb(m.heapUsed).replace(" MB", "")} / ${mb(m.heapTotal)})`;
}

export function uptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h ${m}m`;
  if (h) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}

/** شريط الذاكرة الملون: أخضر تحت 150MB، أصفر تحت 300MB، أحمر فوق */
export function memoryBar(rss: number, width = 16): string {
  const ratio = Math.min(rss / (512 * 1024 * 1024), 1);
  const filled = Math.max(1, Math.round(ratio * width));
  const paint = rss < 150 * 1024 * 1024 ? color.green : rss < 300 * 1024 * 1024 ? color.yellow : color.red;
  return paint("█".repeat(filled)) + color.gray("░".repeat(width - filled));
}

const visible = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

/** صندوق بخط مرتب (عرض ثابت، بدون إيموجي داخل الصندوق عشان ما تختل المحاذاة). */
export function box(title: string, rows: [string, string][], footer?: string): string {
  const keyW = Math.max(...rows.map(([k]) => k.length));
  const lines = rows.map(([k, v]) => `${color.gray(k.padEnd(keyW))}  ${v}`);
  const inner = Math.max(visible(title).length + 2, ...lines.map((l) => visible(l).length), footer ? visible(footer).length : 0) + 2;
  const pad = (s: string) => s + " ".repeat(Math.max(0, inner - 2 - visible(s).length));
  const v = color.violet;
  const out = [
    v(`╭${"─".repeat(inner)}╮`),
    `${v("│")} ${pad(title)} ${v("│")}`,
    v(`├${"─".repeat(inner)}┤`),
    ...lines.map((l) => `${v("│")} ${pad(l)} ${v("│")}`),
  ];
  if (footer) out.push(v(`├${"─".repeat(inner)}┤`), `${v("│")} ${pad(footer)} ${v("│")}`);
  out.push(v(`╰${"─".repeat(inner)}╯`));
  return out.join("\n");
}

export const LOGO = [
  "  __  __                 _   ____        _   ",
  " |  \\/  | ___   ___   __| | | __ )  ___ | |_ ",
  " | |\\/| |/ _ \\ / _ \\ / _` | |  _ \\ / _ \\| __|",
  " | |  | | (_) | (_) | (_| | | |_) | (_) | |_ ",
  " |_|  |_|\\___/ \\___/ \\__,_| |____/ \\___/ \\__|",
];

/** شعار بتدرج ألوان (بنفسجي ← وردي) */
export function logo(): string {
  const shades = ["38;5;99", "38;5;105", "38;5;141", "38;5;177", "38;5;213"];
  const tty = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
  return LOGO.map((l, i) => (tty ? `\x1b[${shades[i]}m${l}\x1b[0m` : l)).join("\n");
}

/** حالات ديسكورد بالإنجليزي تتبدل كل كم دقيقة */
export const STATUSES = [
  "🌈 How was your day?",
  "💭 A new question every day",
  "📊 Tracking moods, one day at a time",
  "🫂 Here for you · /checkin",
  "🔥 Keep your streak alive",
  "✨ Small days matter too",
  "🌙 Rest well, talk tomorrow",
  "💛 Your feelings are valid",
];
