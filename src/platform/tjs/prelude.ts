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
  // وقت المعالج من /proc/self/stat (ticks = 1/100 ثانية) بالمايكروثانية مثل Node
  cpuUsage(prev?: { user: number; system: number }) {
    let user = 0;
    let system = 0;
    try {
      const f = String(R.readFile("/proc/self/stat", false) ?? "").split(") ")[1]?.split(" ") ?? [];
      user = Number(f[11] ?? 0) * 10_000;
      system = Number(f[12] ?? 0) * 10_000;
    } catch { /* غير متوفر */ }
    return prev ? { user: user - prev.user, system: system - prev.system } : { user, system };
  },
  once(event: string, fn: (...a: any[]) => void) {
    let done = false;
    return g.process.on(event, (...a: any[]) => {
      if (done) return;
      done = true;
      fn(...a);
    });
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
// Intl.DateTimeFormat مبسّط (QuickJS ما فيه Intl): يكفي اللي يستخدمه البوت (شهر/يوم/اسم اليوم بالعربي أو الإنجليزي)
if (typeof g.Intl === "undefined") {
  const MONTHS: Record<string, string[]> = {
    ar: ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"],
    en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  };
  const DAYS: Record<string, string[]> = {
    ar: ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"],
    en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  };
  class DateTimeFormat {
    private lang: string;
    constructor(locale?: string | string[], private o: Record<string, string> = {}) {
      this.lang = String(Array.isArray(locale) ? locale[0] : locale ?? "en").startsWith("ar") ? "ar" : "en";
    }
    format(d: Date | number = new Date()) {
      const date = new Date(d);
      const utc = this.o.timeZone === "UTC";
      const day = utc ? date.getUTCDate() : date.getDate();
      const month = utc ? date.getUTCMonth() : date.getMonth();
      const wd = utc ? date.getUTCDay() : date.getDay();
      const parts: string[] = [];
      if (this.o.weekday) parts.push(DAYS[this.lang]![wd]!);
      if (this.o.month) parts.push(this.lang === "ar" ? `${day} ${MONTHS.ar![month]}` : `${MONTHS.en![month]} ${day}`);
      else if (this.o.day) parts.push(String(day));
      return parts.join(this.lang === "ar" ? "، " : ", ") || date.toISOString().slice(0, 10);
    }
  }
  g.Intl = { DateTimeFormat };
}
BigInt.prototype.toLocaleString = function (this: bigint) {
  return group(this.toString());
} as any;
export {};

// RIFT_MEMDEBUG=1: يطبع تفاصيل ذاكرة QuickJS كل 10 ثواني (للتشخيص فقط)
if (tjs.env.RIFT_MEMDEBUG) {
  let peak = 0;
  setInterval(() => { peak = Math.max(peak, R.memoryUsage().mallocSize); }, 200);
  setInterval(() => {
    const m = R.memoryUsage();
    console.log(`[mem] rss=${(R.rss() / 1048576).toFixed(1)}MB peak=${(peak / 1048576).toFixed(1)}MB ${JSON.stringify(m)}`);
    peak = 0;
  }, 10_000);
}
