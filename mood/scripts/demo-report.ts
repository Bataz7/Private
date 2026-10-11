/**
 * يصنع تقرير تجريبي ببيانات وهمية عشان تشوف شكل التقرير بدون ما تشغل البوت.
 *   npm run demo              → data/reports/demo-ar-30d.html
 *   npm run demo -- 90 en     → تقرير 90 يوم بالإنجليزي
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ACHIEVEMENTS, evaluate } from "../src/achievements.ts";
import { localInsight } from "../src/ai.ts";
import { isLang } from "../src/i18n.ts";
import { questionFor } from "../src/questions.ts";
import { buildReportHTML } from "../src/report.ts";
import { computeStats } from "../src/stats.ts";
import { createStore } from "../src/store/index.ts";
import { addDays, zoned } from "../src/time.ts";

const days = Number(process.argv[2] ?? 30);
const lang = isLang(process.argv[3]) ? process.argv[3] : "ar";
const db = await createStore(":memory:", "data");
const uid = "100000000000000001";
const today = zoned(new Date(), "Asia/Riyadh").day;

let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = <T>(a: readonly T[]) => a[Math.floor(rand() * a.length)]!;

const en = lang === "en";
const good = en ? ["Went out with friends", "Finished my project", "Gym session", "Great morning coffee", "Nice dinner with family"] : ["طلعت مع الربع", "خلصت مشروعي", "رحت الجيم", "قهوة حلوة الصبح", "جلسة حلوة مع أهلي"];
const bad = en ? ["Traffic", "Work pressure", "Argument with my manager", "Late for an appointment"] : ["زحمة الدوام", "ضغط شغل", "مشكلة مع المدير", "تأخرت على موعد"];
const answers = en ? ["My brother's joke", "Sunset on the way home", "A call with grandma", "Solved a hard bug"] : ["نكتة أخوي", "الغروب وأنا راجع", "مكالمة مع جدتي", "حليت مشكلة صعبة"];

for (let i = days + 6; i >= 1; i--) {
  if (rand() < 0.08) continue; // أيام بدون تسجيل
  const day = addDays(today, -i);
  const tags: string[] = [];
  let m = 3 + (days - i) / (days * 1.4);
  if (rand() < 0.4) { tags.push("sport"); m += 0.8; }
  if (rand() < 0.5) { tags.push("work"); m -= 0.3; }
  if (rand() < 0.3) { tags.push("friends"); m += 0.7; }
  if (rand() < 0.25) { tags.push("stress"); m -= 1.1; }
  if (rand() < 0.2) { tags.push("poor_sleep"); m -= 0.8; }
  if (rand() < 0.2) tags.push("family");
  const sleep = Math.round((5 + rand() * 3.5 + (tags.includes("poor_sleep") ? -1.5 : 0.5)) * 2) / 2;
  m += (sleep - 6.5) * 0.3 + (rand() - 0.5) * 1.2;
  const mood = Math.max(1, Math.min(5, Math.round(m)));
  const q = questionFor(uid, day);
  const ans = rand() < 0.6 ? pick(answers) : "";
  await db.upsertEntry({
    user_id: uid, day, mood,
    energy: Math.max(1, Math.min(10, Math.round(mood * 2 + (rand() - 0.5) * 3))),
    sleep,
    highlight: mood >= 3 ? pick(good) : "",
    problems: mood <= 3 && rand() < 0.7 ? pick(bad) : "",
    question: q.id,
    gratitude: q.id === "gratitude" ? ans : "",
    answer: q.id === "gratitude" ? "" : ans,
    tags,
  });
}

const start = addDays(today, -(days - 1));
const entries = await db.entriesBetween(uid, start, today);
const prev = await db.entriesBetween(uid, addDays(start, -days), addDays(start, -1));
const st = computeStats(entries, prev, { start, end: today }, await db.allDays(uid), today);
const unlocked = evaluate({ entries: await db.allEntries(uid), streak: st.streak, bestStreak: st.bestStreak }).map((a) => a.code);

const html = buildReportHTML({
  name: en ? "Sara" : "سارة",
  stats: st,
  lang,
  insight: { ...localInsight(st, lang), source: "local" },
  unlocked,
  generatedAt: new Date().toISOString().slice(0, 16).replace("T", " "),
});
const out = resolve("data/reports");
mkdirSync(out, { recursive: true });
const file = join(out, `demo-${lang}-${days}d.html`);
writeFileSync(file, html);
await db.close();
console.log(`✅ ${file} (${(html.length / 1024).toFixed(0)} KB) — ${entries.length} entries, ${unlocked.length}/${ACHIEVEMENTS.length} badges`);
