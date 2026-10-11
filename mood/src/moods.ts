/** تعريفات المزاج والتاقات (الأنشطة). */

export interface MoodDef {
  value: 1 | 2 | 3 | 4 | 5;
  key: string;
  label: string;
  fallback: string;
  /** لون الشريط الجانبي في ديسكورد */
  embed: number;
}

/**
 * سلم المزاج "متباعد" (diverging): أحمر ← رمادي محايد ← أزرق.
 * ما استخدمنا أحمر/أخضر لأنها ما تنفرق عند عمى الألوان؛ الوجوه نفسها تعطي معنى إضافي.
 */
export const MOODS: readonly MoodDef[] = [
  { value: 5, key: "mood_great", label: "ممتاز", fallback: "😄", embed: 0x1c5cab },
  { value: 4, key: "mood_good", label: "كويس", fallback: "🙂", embed: 0x6da7ec },
  { value: 3, key: "mood_okay", label: "عادي", fallback: "😐", embed: 0xa9a8a0 },
  { value: 2, key: "mood_bad", label: "سيء", fallback: "😕", embed: 0xec8f86 },
  { value: 1, key: "mood_awful", label: "سيء جداً", fallback: "😢", embed: 0xc53a3a },
];

export const ACCENT = 0x6c5ce7;

export function mood(v: number): MoodDef {
  const r = Math.max(1, Math.min(5, Math.round(v)));
  return MOODS.find((m) => m.value === r)!;
}

export interface TagDef {
  id: string;
  label: string;
  emoji: string;
}

/** حد ديسكورد 25 خيار في القائمة. */
export const TAGS: readonly TagDef[] = [
  { id: "work", label: "شغل", emoji: "💼" },
  { id: "study", label: "دراسة", emoji: "📚" },
  { id: "family", label: "عائلة", emoji: "🏠" },
  { id: "friends", label: "أصحاب", emoji: "🫂" },
  { id: "love", label: "علاقة", emoji: "❤️" },
  { id: "sport", label: "رياضة", emoji: "🏃" },
  { id: "outing", label: "طلعة", emoji: "🌳" },
  { id: "food", label: "أكل حلو", emoji: "🍔" },
  { id: "rest", label: "راحة", emoji: "🛋️" },
  { id: "gaming", label: "ألعاب", emoji: "🎮" },
  { id: "worship", label: "عبادة", emoji: "🤲" },
  { id: "reading", label: "قراءة", emoji: "📖" },
  { id: "achievement", label: "إنجاز", emoji: "🏆" },
  { id: "travel", label: "سفر", emoji: "✈️" },
  { id: "screen", label: "جوال كثير", emoji: "📱" },
  { id: "stress", label: "ضغط", emoji: "😤" },
  { id: "money", label: "فلوس", emoji: "💸" },
  { id: "sick", label: "مرض/تعب", emoji: "🤒" },
  { id: "poor_sleep", label: "نوم سيء", emoji: "🥱" },
  { id: "conflict", label: "زعل/مشكلة", emoji: "⚡" },
  { id: "lonely", label: "وحدة", emoji: "🌧️" },
  { id: "weather", label: "جو حلو", emoji: "☀️" },
];

export const tagById = (id: string) => TAGS.find((t) => t.id === id);
