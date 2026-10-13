/**
 * حد أقصى للطلبات المتزامنة: كل طلب HTTP على txiki يحجز ذاكرة أصلية (curl) — الدفعات الكبيرة ترفع
 * الذاكرة وما ترجع كلها للنظام. نخليها طابور صغير بدل 30 طلب بنفس اللحظة.
 */
export function limiter(max: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    if (active >= max) return;
    const run = queue.shift();
    if (run) {
      active++;
      run();
    }
  };
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    await new Promise<void>((resolve) => {
      queue.push(resolve);
      next();
    });
    try {
      return await fn();
    } finally {
      active--;
      next();
    }
  };
}
