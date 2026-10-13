/** لوق داخلي صغير للمكتبات الخفيفة (src/lib). */
const DEBUG = /^(1|true|yes)$/i.test(process.env.DEBUG ?? "");
const time = () => new Date().toTimeString().slice(0, 8);
export const log = {
  debug: (scope: string, msg: string) => { if (DEBUG) console.log(`  ${time()} DBUG ${scope.padEnd(10)} ${msg}`); },
  info: (scope: string, msg: string) => console.log(`  ${time()} INFO ${scope.padEnd(10)} ${msg}`),
  warn: (scope: string, msg: string) => console.warn(`  ${time()} WARN ${scope.padEnd(10)} ${msg}`),
  error: (scope: string, msg: string) => console.error(`  ${time()} ERRO ${scope.padEnd(10)} ${msg}`),
  err: (scope: string, e: unknown) => console.error(`  ${time()} ERRO ${scope.padEnd(10)} ${(e as Error)?.stack ?? String(e)}`),
};
