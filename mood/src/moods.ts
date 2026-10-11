/** تعريفات المزاج والأنشطة (بالعربي والإنجليزي). */
import type { Lang } from "./i18n.ts";

export interface MoodDef {
  value: 1 | 2 | 3 | 4 | 5;
  key: string;
  label: Record<Lang, string>;
  fallback: string;
  /** لون الشريط الجانبي في ديسكورد */
  embed: number;
}

/**
 * سلم المزاج "متباعد" (diverging): أحمر ← رمادي محايد ← أزرق.
 * ما استخدمنا أحمر/أخضر لأنها ما تنفرق عند عمى الألوان؛ الوجوه نفسها تعطي معنى إضافي.
 */
export const MOODS: readonly MoodDef[] = [
  { value: 5, key: "mood_great", label: { ar: "ممتاز", en: "Great" }, fallback: "😄", embed: 0x1c5cab },
  { value: 4, key: "mood_good", label: { ar: "كويس", en: "Good" }, fallback: "🙂", embed: 0x6da7ec },
  { value: 3, key: "mood_okay", label: { ar: "عادي", en: "Okay" }, fallback: "😐", embed: 0xa9a8a0 },
  { value: 2, key: "mood_bad", label: { ar: "سيء", en: "Bad" }, fallback: "😕", embed: 0xec8f86 },
  { value: 1, key: "mood_awful", label: { ar: "سيء جداً", en: "Awful" }, fallback: "😢", embed: 0xc53a3a },
];

export const ACCENT = 0x6c5ce7;

export function mood(v: number): MoodDef {
  const r = Math.max(1, Math.min(5, Math.round(v)));
  return MOODS.find((m) => m.value === r)!;
}

export interface TagDef {
  id: string;
  label: Record<Lang, string>;
  emoji: string;
}

/** حد ديسكورد 25 خيار في القائمة. */
export const TAGS: readonly TagDef[] = [
  { id: "work", label: { ar: "شغل", en: "Work" }, emoji: "💼" },
  { id: "study", label: { ar: "دراسة", en: "Study" }, emoji: "📚" },
  { id: "family", label: { ar: "عائلة", en: "Family" }, emoji: "🏠" },
  { id: "friends", label: { ar: "أصحاب", en: "Friends" }, emoji: "🫂" },
  { id: "love", label: { ar: "علاقة", en: "Relationship" }, emoji: "❤️" },
  { id: "sport", label: { ar: "رياضة", en: "Exercise" }, emoji: "🏃" },
  { id: "outing", label: { ar: "طلعة", en: "Going out" }, emoji: "🌳" },
  { id: "food", label: { ar: "أكل حلو", en: "Good food" }, emoji: "🍔" },
  { id: "rest", label: { ar: "راحة", en: "Rest" }, emoji: "🛋️" },
  { id: "gaming", label: { ar: "ألعاب", en: "Gaming" }, emoji: "🎮" },
  { id: "worship", label: { ar: "عبادة", en: "Prayer" }, emoji: "🤲" },
  { id: "reading", label: { ar: "قراءة", en: "Reading" }, emoji: "📖" },
  { id: "achievement", label: { ar: "إنجاز", en: "Achievement" }, emoji: "🏆" },
  { id: "travel", label: { ar: "سفر", en: "Travel" }, emoji: "✈️" },
  { id: "screen", label: { ar: "جوال كثير", en: "Too much phone" }, emoji: "📱" },
  { id: "stress", label: { ar: "ضغط", en: "Stress" }, emoji: "😤" },
  { id: "money", label: { ar: "فلوس", en: "Money" }, emoji: "💸" },
  { id: "sick", label: { ar: "مرض/تعب", en: "Sick/tired" }, emoji: "🤒" },
  { id: "poor_sleep", label: { ar: "نوم سيء", en: "Poor sleep" }, emoji: "🥱" },
  { id: "conflict", label: { ar: "زعل/مشكلة", en: "Conflict" }, emoji: "⚡" },
  { id: "lonely", label: { ar: "وحدة", en: "Lonely" }, emoji: "🌧️" },
  { id: "weather", label: { ar: "جو حلو", en: "Nice weather" }, emoji: "☀️" },
];

export const tagById = (id: string) => TAGS.find((t) => t.id === id);
