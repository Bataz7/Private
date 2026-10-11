/** الإنجازات (badges) — تحفيز بسيط يخلي التسجيل اليومي عادة. */
import type { Entry } from "./db.ts";
import { diffDays } from "./time.ts";

export interface AchievementDef {
  code: string;
  emoji: string;
  title: string;
  description: string;
  check(ctx: AchievementContext): boolean;
}

export interface AchievementContext {
  entries: Entry[];
  streak: number;
  bestStreak: number;
}

const count = (ctx: AchievementContext, f: (e: Entry) => boolean) => ctx.entries.filter(f).length;

function hasComeback(entries: Entry[]): boolean {
  for (let i = 1; i < entries.length; i++) {
    const a = entries[i - 1]!, b = entries[i]!;
    if (diffDays(b.day, a.day) === 1 && a.mood <= 2 && b.mood >= 4) return true;
  }
  return false;
}

function goodRun(entries: Entry[], len: number): boolean {
  let run = 0;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    const consecutive = i > 0 && diffDays(e.day, entries[i - 1]!.day) === 1;
    run = e.mood >= 4 ? (consecutive ? run + 1 : 1) : 0;
    if (run >= len) return true;
  }
  return false;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { code: "first", emoji: "🌱", title: "أول خطوة", description: "سجّلت أول يوم", check: (c) => c.entries.length >= 1 },
  { code: "streak3", emoji: "🔥", title: "بداية نار", description: "3 أيام ورا بعض", check: (c) => c.bestStreak >= 3 },
  { code: "streak7", emoji: "⚡", title: "أسبوع كامل", description: "7 أيام ورا بعض", check: (c) => c.bestStreak >= 7 },
  { code: "streak14", emoji: "💪", title: "ثابت", description: "14 يوم ورا بعض", check: (c) => c.bestStreak >= 14 },
  { code: "streak30", emoji: "🏅", title: "شهر بدون انقطاع", description: "30 يوم ورا بعض", check: (c) => c.bestStreak >= 30 },
  { code: "streak100", emoji: "👑", title: "أسطورة", description: "100 يوم ورا بعض", check: (c) => c.bestStreak >= 100 },
  { code: "entries10", emoji: "📒", title: "مذكرات", description: "10 تسجيلات", check: (c) => c.entries.length >= 10 },
  { code: "entries50", emoji: "📚", title: "كتاب أيامك", description: "50 تسجيل", check: (c) => c.entries.length >= 50 },
  { code: "entries100", emoji: "🏛️", title: "أرشيف", description: "100 تسجيل", check: (c) => c.entries.length >= 100 },
  { code: "great5", emoji: "🌟", title: "أيام ذهبية", description: "5 أيام ممتازة", check: (c) => count(c, (e) => e.mood === 5) >= 5 },
  { code: "goodweek", emoji: "☀️", title: "أسبوع مشمس", description: "7 أيام حلوة ورا بعض", check: (c) => goodRun(c.entries, 7) },
  { code: "comeback", emoji: "🌈", title: "رجعة قوية", description: "من يوم سيء ليوم حلو مباشرة", check: (c) => hasComeback(c.entries) },
  { code: "grateful7", emoji: "🙏", title: "قلب ممتن", description: "كتبت شي ممتن له 7 مرات", check: (c) => count(c, (e) => e.gratitude.length > 0) >= 7 },
  { code: "storyteller", emoji: "✍️", title: "حكواتي", description: "كتبت تفاصيل يومك 20 مرة", check: (c) => count(c, (e) => e.highlight.length + e.problems.length > 40) >= 20 },
  { code: "sleeper", emoji: "😴", title: "نوم ملوكي", description: "نمت 7 ساعات أو أكثر 7 مرات", check: (c) => count(c, (e) => (e.sleep ?? 0) >= 7) >= 7 },
  { code: "tagger", emoji: "🏷️", title: "منظم", description: "حددت أنشطة يومك 10 مرات", check: (c) => count(c, (e) => e.tags.length > 0) >= 10 },
];

export const achievementByCode = (code: string) => ACHIEVEMENTS.find((a) => a.code === code);

/** يرجع الإنجازات اللي تحققت (كلها)، والمستدعي يحدد الجديد منها. */
export function evaluate(ctx: AchievementContext): AchievementDef[] {
  return ACHIEVEMENTS.filter((a) => a.check(ctx));
}
