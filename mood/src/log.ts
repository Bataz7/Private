/** لوقر خفيف وواضح: وقت + أيقونة المستوى + القسم بلون ثابت. */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
export type Level = keyof typeof LEVELS;

const tty = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const c = (code: string) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
export const color = {
  dim: c("2"), bold: c("1"), gray: c("90"), red: c("31"), green: c("32"), yellow: c("33"),
  blue: c("34"), magenta: c("35"), cyan: c("36"), violet: c("38;5;141"), pink: c("38;5;211"),
};

const ICONS: Record<Level, string> = {
  debug: color.gray("·"),
  info: color.cyan("●"),
  warn: color.yellow("▲"),
  error: color.red("✖"),
};

/** كل قسم له لون ثابت عشان تفرقها بسرعة */
const SCOPE_COLORS = [color.violet, color.cyan, color.green, color.pink, color.blue, color.magenta, color.yellow];
function scopeColor(scope: string): (s: string) => string {
  let h = 0;
  for (const ch of scope) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return SCOPE_COLORS[h % SCOPE_COLORS.length]!;
}

let threshold: number = LEVELS.info;

export function setLogLevel(level: string): void {
  if (level in LEVELS) threshold = LEVELS[level as Level];
}

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  child(scope: string): Logger;
}

function time(): string {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
}

export function createLogger(scope = "mood"): Logger {
  const name = scope.replace(/^mood:?/, "") || "bot";
  const tag = scopeColor(name)(name.padEnd(8).slice(0, 8));
  const write = (level: Level, args: unknown[]) => {
    if (LEVELS[level] < threshold) return;
    const head = `${color.gray(time())} ${ICONS[level]} ${tag}`;
    const body = args.map((a) => (typeof a === "string" ? (level === "error" ? color.red(a) : level === "warn" ? color.yellow(a) : a) : a));
    (level === "error" || level === "warn" ? console.error : console.log)(head, ...body);
  };
  return {
    debug: (...a) => write("debug", a),
    info: (...a) => write("info", a),
    warn: (...a) => write("warn", a),
    error: (...a) => write("error", a),
    child: (s) => createLogger(`${scope}:${s}`),
  };
}

/** لوقر صامت للاختبارات. */
export const silentLogger: Logger = {
  debug() {}, info() {}, warn() {}, error() {},
  child() { return silentLogger; },
};
