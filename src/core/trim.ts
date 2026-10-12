/**
 * تقليص الذاكرة (Linux): أغلب RSS في Bun هو كود البرنامج نفسه (صفحات ملف قابلة للاسترجاع) اللي تنقرأ وقت التشغيل
 * وما تُستخدم بعدها. نطلب من النظام يرجّعها بـ madvise(MADV_PAGEOUT) — وأي صفحة يحتاجها البوت لاحقاً ترجع تلقائياً.
 * ما يلمس ذاكرة البيانات (anonymous) أبداً، فما فيه أي خطر على البيانات.
 */
import { readFileSync } from "node:fs";
import { log } from "./log.ts";

const MADV_PAGEOUT = 21;
let madvise: ((addr: number, len: number, advice: number) => number) | null = null;
let failed = false;

async function load(): Promise<boolean> {
  if (madvise || failed) return !!madvise;
  if (process.platform !== "linux") return !(failed = true);
  try {
    const { dlopen, FFIType } = await import("bun:ffi");
    const lib = dlopen("libc.so.6", { madvise: { args: [FFIType.u64, FFIType.u64, FFIType.i32], returns: FFIType.i32 } });
    madvise = lib.symbols.madvise as any;
    return true;
  } catch (e) {
    failed = true;
    log.debug("trim", `ffi unavailable: ${(e as Error).message}`);
    return false;
  }
}

/** يرجّع صفحات الكود (الملفات المربوطة للقراءة فقط) للنظام. يرجع عدد الميقابايت اللي انطلبت. */
export async function trimCode(): Promise<number> {
  if (!(await load())) return 0;
  let bytes = 0;
  for (const line of readFileSync("/proc/self/maps", "utf8").split("\n")) {
    // start-end perms offset dev inode path — نختار الملفات فقط (inode ≠ 0) وغير القابلة للكتابة
    const m = /^([0-9a-f]+)-([0-9a-f]+) (r-[-x][ps]) \S+ \S+ (\d+)\s+(\/\S.*)$/.exec(line);
    if (!m || m[4] === "0" || m[5]!.startsWith("/dev/") || m[5]!.includes("(deleted)")) continue;
    const start = Number.parseInt(m[1]!, 16);
    const len = Number.parseInt(m[2]!, 16) - start;
    if (madvise!(start, len, MADV_PAGEOUT) === 0) bytes += len;
  }
  return bytes / 1048576;
}

/** يشغّل التقليص بعد التشغيل ثم كل فترة (الافتراضي كل 5 دقائق). */
export function startTrimming(everyMs = 300_000): void {
  if (/^(0|false|off|no)$/i.test(process.env.TRIM_MEMORY ?? "")) return;
  const run = () => void trimCode().then((mb) => mb && log.debug("trim", `advised ${mb.toFixed(0)} MB of code pages`)).catch(() => undefined);
  setTimeout(run, 15_000).unref();
  setInterval(run, everyMs).unref();
}
