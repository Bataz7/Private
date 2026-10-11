/** حسابات الإحصائيات والأنماط — دوال صافية (pure) سهلة الاختبار. */
import type { Entry } from "./db.ts";
import { tagById } from "./moods.ts";
import { addDays, diffDays, weekdayOf } from "./time.ts";

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

/** معامل ارتباط بيرسون (-1 … 1)، أو null لو البيانات ما تكفي. */
export function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 4) return null;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i]! - mx, b = ys[i]! - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

/** ميل الاتجاه (نقاط مزاج لكل أسبوع) بالانحدار الخطي. */
export function trendPerWeek(entries: Entry[]): number | null {
  if (entries.length < 4) return null;
  const x0 = entries[0]!.day;
  const xs = entries.map((e) => diffDays(e.day, x0));
  const ys = entries.map((e) => e.mood);
  const mx = mean(xs), my = mean(ys);
  let num = 0, den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) ** 2;
  }
  return den === 0 ? null : (num / den) * 7;
}

/** السلسلة الحالية: أيام متتالية لين اليوم (أو أمس لو ما سجّل اليوم للحين). */
export function currentStreak(days: Set<string>, today: string): number {
  let d = days.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (days.has(d)) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

export function bestStreak(days: Set<string>): number {
  const sorted = [...days].sort();
  let best = 0, run = 0;
  let prev: string | null = null;
  for (const d of sorted) {
    run = prev && diffDays(d, prev) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

export interface TagImpact {
  id: string;
  label: string;
  emoji: string;
  count: number;
  avg: number;
  /** الفرق عن المتوسط العام */
  delta: number;
}

export function tagImpacts(entries: Entry[], minCount = 2): TagImpact[] {
  const overall = mean(entries.map((e) => e.mood));
  const by = new Map<string, number[]>();
  for (const e of entries) for (const t of e.tags) by.set(t, [...(by.get(t) ?? []), e.mood]);
  const out: TagImpact[] = [];
  for (const [id, moods] of by) {
    const def = tagById(id);
    if (!def || moods.length < minCount) continue;
    const avg = mean(moods);
    out.push({ id, label: def.label, emoji: def.emoji, count: moods.length, avg, delta: avg - overall });
  }
  return out.sort((a, b) => b.delta - a.delta);
}

export interface PeriodStats {
  start: string;
  end: string;
  days: number;
  entries: Entry[];
  count: number;
  coverage: number;
  avg: number;
  prevAvg: number | null;
  /** فرق المتوسط بالنقاط عن الفترة السابقة */
  delta: number | null;
  /** نسبة التغير % */
  changePct: number | null;
  best: Entry | null;
  worst: Entry | null;
  dist: Record<1 | 2 | 3 | 4 | 5, number>;
  goodPct: number;
  badPct: number;
  weekdayAvg: (number | null)[];
  bestWeekday: number | null;
  worstWeekday: number | null;
  tags: TagImpact[];
  sleepAvg: number | null;
  sleepGood: number | null;
  sleepBad: number | null;
  sleepCorr: number | null;
  energyAvg: number | null;
  energyCorr: number | null;
  trend: number | null;
  volatility: number;
  movingAvg: { day: string; value: number }[];
  streak: number;
  bestStreak: number;
}

export function computeStats(
  entries: Entry[],
  prev: Entry[],
  range: { start: string; end: string },
  allDays: Set<string>,
  today: string,
): PeriodStats {
  const days = diffDays(range.end, range.start) + 1;
  const moods = entries.map((e) => e.mood);
  const avg = mean(moods);
  const prevAvg = prev.length ? mean(prev.map((e) => e.mood)) : null;
  const delta = prevAvg !== null && entries.length ? avg - prevAvg : null;

  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<1 | 2 | 3 | 4 | 5, number>;
  for (const m of moods) dist[m as 1 | 2 | 3 | 4 | 5]++;

  const wd: number[][] = [[], [], [], [], [], [], []];
  for (const e of entries) wd[weekdayOf(e.day)]!.push(e.mood);
  const weekdayAvg = wd.map((v) => (v.length ? mean(v) : null));
  const ranked = weekdayAvg.map((v, i) => [v, i] as const).filter((x): x is readonly [number, number] => x[0] !== null);
  ranked.sort((a, b) => b[0] - a[0]);

  const withSleep = entries.filter((e) => e.sleep !== null);
  const withEnergy = entries.filter((e) => e.energy !== null);
  const goodSleep = withSleep.filter((e) => e.mood >= 4).map((e) => e.sleep!);
  const badSleep = withSleep.filter((e) => e.mood <= 2).map((e) => e.sleep!);

  // متوسط متحرك 7 أيام (على الأيام المسجلة)
  const movingAvg = entries.map((e) => {
    const win = entries.filter((x) => diffDays(e.day, x.day) >= 0 && diffDays(e.day, x.day) < 7);
    return { day: e.day, value: mean(win.map((x) => x.mood)) };
  });

  return {
    ...range,
    days,
    entries,
    count: entries.length,
    coverage: days ? entries.length / days : 0,
    avg,
    prevAvg,
    delta,
    changePct: delta !== null && prevAvg ? (delta / prevAvg) * 100 : null,
    best: entries.length ? entries.reduce((a, b) => (b.mood >= a.mood ? b : a)) : null,
    worst: entries.length ? entries.reduce((a, b) => (b.mood <= a.mood ? b : a)) : null,
    dist,
    goodPct: entries.length ? Math.round(((dist[4] + dist[5]) / entries.length) * 100) : 0,
    badPct: entries.length ? Math.round(((dist[1] + dist[2]) / entries.length) * 100) : 0,
    weekdayAvg,
    bestWeekday: ranked.length > 1 ? ranked[0]![1] : null,
    worstWeekday: ranked.length > 1 ? ranked[ranked.length - 1]![1] : null,
    tags: tagImpacts(entries),
    sleepAvg: withSleep.length ? mean(withSleep.map((e) => e.sleep!)) : null,
    sleepGood: goodSleep.length ? mean(goodSleep) : null,
    sleepBad: badSleep.length ? mean(badSleep) : null,
    sleepCorr: pearson(withSleep.map((e) => e.sleep!), withSleep.map((e) => e.mood)),
    energyAvg: withEnergy.length ? mean(withEnergy.map((e) => e.energy!)) : null,
    energyCorr: pearson(withEnergy.map((e) => e.energy!), withEnergy.map((e) => e.mood)),
    trend: trendPerWeek(entries),
    volatility: stddev(moods),
    movingAvg,
    streak: currentStreak(allDays, today),
    bestStreak: bestStreak(allDays),
  };
}

/** وصف عربي لقوة الارتباط. */
export function describeCorr(r: number | null): string | null {
  if (r === null) return null;
  const a = Math.abs(r);
  if (a < 0.2) return null;
  const strength = a >= 0.6 ? "قوي" : a >= 0.4 ? "واضح" : "خفيف";
  return `${r > 0 ? "ارتباط إيجابي" : "ارتباط عكسي"} ${strength}`;
}

/** أكثر الأشياء تكراراً في النصوص (للتحليل بدون AI). */
const STOP = new Set("في من على الى إلى عن مع و او أو ما لا انا أنا هو هي كان كانت اليوم يوم شي شيء بس مرة جداً جدا كثير وايد حيل".split(" "));
export function commonThemes(texts: string[], n = 4): string[] {
  const clean = texts.map((t) => t.trim()).filter(Boolean);
  const phrases = new Map<string, number>();
  for (const t of clean) if (t.length <= 60) phrases.set(t, (phrases.get(t) ?? 0) + 1);
  const out = [...phrases].filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]).slice(0, n).map(([t, c]) => `${t} (×${c})`);
  if (out.length < n) {
    const words = new Map<string, number>();
    for (const t of clean) for (const w of t.split(/\s+/)) {
      const x = w.replace(/[.,!؟?،]/g, "");
      if (x.length > 2 && !STOP.has(x)) words.set(x, (words.get(x) ?? 0) + 1);
    }
    for (const [w, c] of [...words].sort((a, b) => b[1] - a[1])) {
      if (out.length >= n) break;
      if (c > 1 && !out.some((o) => o.includes(w))) out.push(`تكرر ذكر «${w}» (×${c})`);
    }
  }
  return out;
}
