/**
 * ينقل كل البيانات من قاعدة بيانات لثانية (مثلاً من SQLite إلى MongoDB أو PostgreSQL).
 *
 *   npm run migrate -- <من> <إلى>
 *
 * أمثلة:
 *   npm run migrate -- sqlite:./data/mood.db "mongodb+srv://user:pass@cluster.mongodb.net/mood"
 *   npm run migrate -- sqlite:./data/mood.db postgres://user:pass@localhost/mood
 *   npm run migrate -- backup:./data/backups/mood-2026-10-11.json sqlite:./data/mood.db   ← استرجاع من نسخة JSON
 *
 * بعدها غيّر DATABASE_URL في .env للقاعدة الجديدة.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createStore, redact } from "../src/store/index.ts";
import type { Dump } from "../src/store/types.ts";

const [from, to] = process.argv.slice(2);
if (!from || !to) {
  console.error("الاستخدام: npm run migrate -- <من> <إلى>\nمثال: npm run migrate -- sqlite:./data/mood.db mongodb://localhost/mood");
  process.exit(1);
}

let dump: Dump;
if (from.startsWith("backup:")) {
  dump = JSON.parse(readFileSync(resolve(from.slice(7)), "utf8")) as Dump;
  console.log(`📦 قرأت النسخة ${from.slice(7)}`);
} else {
  const src = await createStore(from, resolve("data"));
  dump = await src.exportAll();
  await src.close();
  console.log(`📤 صدّرت من ${redact(from)}`);
}
console.log(`   ${dump.users.length} مستخدم · ${dump.entries.length} تسجيل · ${dump.chat.length} رسالة · ${dump.achievements.length} إنجاز`);

const dst = await createStore(to, resolve("data"));
await dst.importAll(dump);
const counts = await Promise.all(dump.users.map((u) => dst.countEntries(u.id)));
await dst.close();
console.log(`📥 استوردت إلى ${redact(to)} — ${counts.reduce((a, b) => a + b, 0)} تسجيل ✅`);
console.log("   لا تنسى تغيّر DATABASE_URL في ملف .env");
