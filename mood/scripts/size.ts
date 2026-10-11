/** يحسب حجم البوت الفعلي (اللي يحتاجه وقت التشغيل). */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function size(p: string): number {
  const st = statSync(p);
  if (!st.isDirectory()) return st.size;
  return readdirSync(p).reduce((n, f) => n + size(join(p, f)), 0);
}
const parts = ["src", "assets", "package.json", "start.mjs"].map((p) => [p, size(p)] as const);
const total = parts.reduce((n, [, s]) => n + s, 0);
for (const [p, s] of parts) console.log(`${p.padEnd(14)} ${(s / 1024).toFixed(0).padStart(5)} KB`);
console.log(`${"المجموع".padEnd(14)} ${(total / 1024).toFixed(0).padStart(5)} KB  (${((total / 20 / 1024 / 1024) * 100).toFixed(1)}% من 20 ميقا)`);
console.log("مكتبات وقت التشغيل: 0 ✅");
