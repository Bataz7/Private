/** الإنجازات (badges) — تحفيز بسيط يخلي التسجيل اليومي عادة. */
import type { Lang } from "./i18n.ts";
import type { Entry } from "./store/types.ts";
import { diffDays } from "./time.ts";

export interface AchievementDef {
  code: string;
  emoji: string;
  title: Record<Lang, string>;
  description: Record<Lang, string>;
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

const A = (code: string, emoji: string, ar: [string, string], en: [string, string], check: AchievementDef["check"]): AchievementDef =>
  ({ code, emoji, title: { ar: ar[0], en: en[0] }, description: { ar: ar[1], en: en[1] }, check });

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  A("first", "🌱", ["أول خطوة", "سجّلت أول يوم"], ["First step", "Logged your first day"], (c) => c.entries.length >= 1),
  A("streak3", "🔥", ["بداية نار", "3 أيام ورا بعض"], ["On fire", "3 days in a row"], (c) => c.bestStreak >= 3),
  A("streak7", "⚡", ["أسبوع كامل", "7 أيام ورا بعض"], ["Full week", "7 days in a row"], (c) => c.bestStreak >= 7),
  A("streak14", "💪", ["ثابت", "14 يوم ورا بعض"], ["Steady", "14 days in a row"], (c) => c.bestStreak >= 14),
  A("streak30", "🏅", ["شهر بدون انقطاع", "30 يوم ورا بعض"], ["Unbroken month", "30 days in a row"], (c) => c.bestStreak >= 30),
  A("streak100", "👑", ["أسطورة", "100 يوم ورا بعض"], ["Legend", "100 days in a row"], (c) => c.bestStreak >= 100),
  A("entries10", "📒", ["مذكرات", "10 تسجيلات"], ["Journal", "10 entries"], (c) => c.entries.length >= 10),
  A("entries50", "📚", ["كتاب أيامك", "50 تسجيل"], ["Book of days", "50 entries"], (c) => c.entries.length >= 50),
  A("entries100", "🏛️", ["أرشيف", "100 تسجيل"], ["Archive", "100 entries"], (c) => c.entries.length >= 100),
  A("great5", "🌟", ["أيام ذهبية", "5 أيام ممتازة"], ["Golden days", "5 great days"], (c) => count(c, (e) => e.mood === 5) >= 5),
  A("goodweek", "☀️", ["أسبوع مشمس", "7 أيام حلوة ورا بعض"], ["Sunny week", "7 good days in a row"], (c) => goodRun(c.entries, 7)),
  A("comeback", "🌈", ["رجعة قوية", "من يوم سيء ليوم حلو مباشرة"], ["Comeback", "From a bad day straight to a good one"], (c) => hasComeback(c.entries)),
  A("grateful", "🙏", ["قلب ممتن", "كتبت شي ممتن له 4 مرات"], ["Grateful heart", "Wrote what you're grateful for 4 times"], (c) => count(c, (e) => e.gratitude.length > 0) >= 4),
  A("thinker", "💭", ["فيلسوف", "جاوبت على سؤال اليوم 10 مرات"], ["Deep thinker", "Answered the daily question 10 times"], (c) => count(c, (e) => e.answer.length > 0 || e.gratitude.length > 0) >= 10),
  A("storyteller", "✍️", ["حكواتي", "كتبت تفاصيل يومك 20 مرة"], ["Storyteller", "Wrote about your day 20 times"], (c) => count(c, (e) => e.highlight.length + e.problems.length > 40) >= 20),
  A("sleeper", "😴", ["نوم ملوكي", "نمت 7 ساعات أو أكثر 7 مرات"], ["Royal sleep", "Slept 7+ hours 7 times"], (c) => count(c, (e) => (e.sleep ?? 0) >= 7) >= 7),
  A("tagger", "🏷️", ["منظم", "حددت أنشطة يومك 10 مرات"], ["Organized", "Tagged your activities 10 times"], (c) => count(c, (e) => e.tags.length > 0) >= 10),
];

export const achievementByCode = (code: string) => ACHIEVEMENTS.find((a) => a.code === code);

/** يرجع الإنجازات اللي تحققت (كلها)، والمستدعي يحدد الجديد منها. */
export function evaluate(ctx: AchievementContext): AchievementDef[] {
  return ACHIEVEMENTS.filter((a) => a.check(ctx));
}
