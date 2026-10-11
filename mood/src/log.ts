/** لوقر خفيف: مستويات + وقت + ألوان في الترمنال. */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
export type Level = keyof typeof LEVELS;

const COLORS: Record<Level, string> = { debug: "\x1b[90m", info: "\x1b[36m", warn: "\x1b[33m", error: "\x1b[31m" };
const tty = process.stdout.isTTY;
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

export function createLogger(scope = "mood"): Logger {
  const write = (level: Level, args: unknown[]) => {
    if (LEVELS[level] < threshold) return;
    const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
    const tag = level.toUpperCase().padEnd(5);
    const head = tty ? `${COLORS[level]}${ts} ${tag}\x1b[0m \x1b[1m${scope}\x1b[0m` : `${ts} ${tag} ${scope}`;
    (level === "error" || level === "warn" ? console.error : console.log)(head, ...args);
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
