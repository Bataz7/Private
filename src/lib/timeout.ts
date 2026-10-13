/**
 * مهلة لطلب واحد تنلغي أول ما يخلص (AbortSignal.timeout يبقى عايش لين تنتهي المهلة = ذاكرة على txiki).
 * const t = deadline(15_000); try { await fetch(url, { signal: t.signal }) } finally { t.done() }
 */
export function deadline(ms: number) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`timed out after ${ms}ms`)), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(timer) };
}
