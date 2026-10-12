/**
 * تهيئة بيئة txiki.js: نوفّر process و Bun وتوقيتات unref وتنسيق الأرقام، عشان نفس كود البوت
 * (المكتوب لـ Bun) يشتغل على txiki بذاكرة أقل بكثير. يُستورد أول شي في main.ts.
 */
declare const tjs: any;
declare const __revive: any;
const g = globalThis as any;
const R = __revive;

const signals = new Set(["SIGINT", "SIGTERM", "SIGHUP"]);
const args: string[] = [...(tjs.args ?? [])];
const scriptAt = args.findIndex((a) => /\.m?js$/.test(a));
g.process = {
  env: tjs.env,
  platform: "linux",
  arch: "x64",
  argv: scriptAt >= 0 ? [tjs.exePath, ...args.slice(scriptAt)] : [tjs.exePath, ...args.slice(1)],
  execPath: tjs.exePath,
  pid: tjs.pid,
  version: `txiki-${tjs.version}`,
  versions: { txiki: tjs.version },
  cwd: () => (typeof tjs.cwd === "function" ? tjs.cwd() : tjs.cwd),
  exit: (code?: number) => tjs.exit(code ?? 0),
  stdout: { isTTY: !!tjs.stdout?.isTerminal },
  memoryUsage: () => {
    const m = R.memoryUsage();
    return { rss: R.rss(), heapTotal: m.mallocSize, heapUsed: m.memoryUsed, external: 0, arrayBuffers: 0 };
  },
  on(event: string, fn: (...a: any[]) => void) {
    if (signals.has(event)) tjs.addSignalListener(event, fn);
    else if (event === "unhandledRejection" && typeof g.addEventListener === "function") {
      g.addEventListener("unhandledrejection", (e: any) => {
        e.preventDefault?.();
        fn(e.reason);
      });
    }
    return g.process;
  },
};

g.Bun = {
  version: `txiki ${tjs.version}`,
  gc: () => R.gc(),
  sleep: (ms: number) => new Promise((r) => setTimeout(r, ms)),
};

// التوقيتات في txiki ترجع رقم — نغلفها بكائن فيه unref() مثل Node/Bun
class Timer {
  constructor(readonly id: number) {}
  unref() { return this; }
  ref() { return this; }
  hasRef() { return true; }
  [Symbol.toPrimitive]() { return this.id; }
}
const unwrap = (t: any) => (t instanceof Timer ? t.id : t);
for (const name of ["setTimeout", "setInterval"]) {
  const orig = g[name];
  g[name] = (fn: any, ms?: number, ...args: any[]) => new Timer(orig(fn, ms, ...args));
}
for (const name of ["clearTimeout", "clearInterval"]) {
  const orig = g[name];
  g[name] = (t: any) => orig(unwrap(t));
}

// QuickJS ما فيه Intl: تنسيق الأرقام بالفواصل مثل en-US
const group = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
Number.prototype.toLocaleString = function (this: number, _l?: unknown, o?: { maximumFractionDigits?: number; minimumFractionDigits?: number }) {
  const n = Number(this);
  if (!Number.isFinite(n)) return String(n);
  const max = o?.maximumFractionDigits ?? Math.max(o?.minimumFractionDigits ?? 0, 3);
  let [i, d = ""] = Math.abs(n).toFixed(max).split(".") as [string, string?];
  d = d.replace(/0+$/, "");
  if (o?.minimumFractionDigits) d = d.padEnd(o.minimumFractionDigits, "0");
  return (n < 0 ? "-" : "") + group(i) + (d ? `.${d}` : "");
} as any;
BigInt.prototype.toLocaleString = function (this: bigint) {
  return group(this.toString());
} as any;
export {};
