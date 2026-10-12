/** لوق خفيف للكونسول (بالإنجليزي عشان الطرفيات ما تعرض العربي صح). */
const tty = process.stdout.isTTY;
const c = (code: string, s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const time = () => new Date().toTimeString().slice(0, 8);
const DEBUG = /^(1|true|yes)$/i.test(process.env.DEBUG ?? "");

function out(level: string, color: string, scope: string, msg: string) {
  (level === "ERRO" ? console.error : console.log)(`  ${c("90", time())} ${c(color, level)} ${c("36", scope.padEnd(10))} ${msg}`);
}

export const log = {
  debug: (scope: string, msg: string) => DEBUG && out("DBUG", "90", scope, msg),
  info: (scope: string, msg: string) => out("INFO", "34", scope, msg),
  ok: (scope: string, msg: string) => out(" OK ", "32", scope, msg),
  warn: (scope: string, msg: string) => out("WARN", "33", scope, msg),
  error: (scope: string, msg: string) => out("ERRO", "31", scope, msg),
  /** خطأ مع الـ stack */
  err: (scope: string, e: unknown) => out("ERRO", "31", scope, (e as Error)?.stack ?? String(e)),
  banner(version: string) {
    console.log(c("34", "\n  ╦═╗╔═╗╦  ╦╦╦  ╦╔═╗\n  ╠╦╝║╣ ╚╗╔╝║╚╗╔╝║╣ \n  ╩╚═╚═╝ ╚╝ ╩ ╚╝ ╚═╝") + c("90", `  ${version} · TypeScript · ${typeof (globalThis as any).tjs === "object" ? "txiki.js" : "Bun"}\n`));
  },
  panel(rows: [string, string][]) {
    const w = Math.max(...rows.map(([k]) => k.length));
    console.log(c("32", "  ── REVIVE IS ONLINE ──"));
    for (const [k, v] of rows) console.log(`  ${c("90", k.padEnd(w))}  ${v}`);
    console.log();
  },
};

/** استهلاك الذاكرة الحالي بالميقابايت. */
export const memoryMB = () => process.memoryUsage().rss / 1048576;
