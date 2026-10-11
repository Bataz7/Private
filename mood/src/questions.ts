/**
 * أسئلة اليوم 💭 — سؤال جديد كل يوم يخلي التسجيل ممتع ويساعد الشخص يلاحظ يومه.
 * كل سؤال ≤ 45 حرف (حد ديسكورد لعنوان الحقل في النافذة).
 * الترتيب يختلف لكل شخص وما يتكرر السؤال لين تخلص كل الأسئلة. سؤال الامتنان يجي كل أسبوع.
 */
import { createHash } from "node:crypto";
import type { Lang } from "./i18n.ts";
import { diffDays } from "./time.ts";

export interface Question {
  id: string;
  ar: string;
  en: string;
}

export const GRATITUDE: Question = { id: "gratitude", ar: "شي واحد ممتن له اليوم؟ 🙏", en: "One thing you're grateful for today? 🙏" };

export const QUESTIONS: readonly Question[] = [
  { id: "laugh", ar: "وش أكثر شي ضحّكك اليوم؟ 😂", en: "What made you laugh today? 😂" },
  { id: "replay", ar: "لو تعيد لحظة من اليوم، وش تكون؟", en: "Which moment would you replay? 🔁" },
  { id: "proud", ar: "شي صغير فخور فيه اليوم؟ 🏅", en: "Something small you're proud of? 🏅" },
  { id: "kind", ar: "مين سوّى لك شي حلو اليوم؟ 💛", en: "Who was kind to you today? 💛" },
  { id: "learned", ar: "وش تعلّمت اليوم؟ 📚", en: "What did you learn today? 📚" },
  { id: "tomorrow", ar: "وش ودّك يصير بكرة؟ 🌅", en: "What do you hope happens tomorrow? 🌅" },
  { id: "energy", ar: "وش أكثر شي عطاك طاقة اليوم؟ ⚡", en: "What gave you energy today? ⚡" },
  { id: "drain", ar: "وش أكثر شي سحب طاقتك؟ 🪫", en: "What drained your energy most? 🪫" },
  { id: "song", ar: "لو يومك أغنية، وش اسمها؟ 🎵", en: "If today were a song, what's it called? 🎵" },
  { id: "food", ar: "وش أحلى شي أكلته اليوم؟ 🍽️", en: "Best thing you ate today? 🍽️" },
  { id: "change", ar: "لو تغيّر شي واحد باليوم، وش هو؟", en: "If you could change one thing today?" },
  { id: "peace", ar: "متى حسّيت براحة اليوم؟ 🍃", en: "When did you feel calm today? 🍃" },
  { id: "word", ar: "وصف يومك بكلمة وحدة؟ ✍️", en: "Describe today in one word ✍️" },
  { id: "helped", ar: "ساعدت أحد اليوم؟ كيف؟ 🤝", en: "Did you help anyone today? How? 🤝" },
  { id: "surprise", ar: "وش أكثر شي فاجأك اليوم؟ 😮", en: "What surprised you today? 😮" },
  { id: "self", ar: "وش سويت لنفسك اليوم؟ 🧖", en: "What did you do for yourself today? 🧖" },
  { id: "message", ar: "رسالة لنفسك بكرة؟ 💌", en: "A note to tomorrow's you? 💌" },
  { id: "worry", ar: "شي يشغل بالك؟ خلّه هنا 🫧", en: "Something on your mind? Leave it here 🫧" },
  { id: "smile", ar: "مين خلّاك تبتسم اليوم؟ 😊", en: "Who made you smile today? 😊" },
  { id: "place", ar: "وين كان أحلى مكان رحته اليوم؟ 📍", en: "Best place you were today? 📍" },
  { id: "small_win", ar: "وش أصغر إنجاز سويته اليوم؟ ✅", en: "Your smallest win today? ✅" },
  { id: "phone", ar: "كم ساعة جوال تقريباً اليوم؟ 📱", en: "Roughly how much phone time today? 📱" },
  { id: "move", ar: "تحرّكت اليوم؟ وش سويت؟ 🚶", en: "Did you move today? What did you do? 🚶" },
  { id: "nature", ar: "طلعت للشمس أو الهوا اليوم؟ ☀️", en: "Did you get sun or fresh air? ☀️" },
  { id: "hard", ar: "وش أصعب شي واجهته اليوم؟ 🧗", en: "Hardest thing you faced today? 🧗" },
  { id: "handled", ar: "شي تعاملت معه أحسن من قبل؟ 💪", en: "Something you handled better than before? 💪" },
  { id: "miss", ar: "اشتقت لأحد اليوم؟ 🫶", en: "Did you miss anyone today? 🫶" },
  { id: "look_forward", ar: "وش تنتظره هالأسبوع؟ 🎁", en: "What are you looking forward to? 🎁" },
  { id: "idea", ar: "جاتك فكرة حلوة اليوم؟ 💡", en: "Had a good idea today? 💡" },
  { id: "color", ar: "لو يومك لون، وش لونه؟ 🎨", en: "If today were a color? 🎨" },
  { id: "talk", ar: "مع مين سولفت أكثر اليوم؟ 🗣️", en: "Who did you talk to most today? 🗣️" },
  { id: "rest", ar: "أخذت وقت راحة كافي اليوم؟ 🛋️", en: "Did you rest enough today? 🛋️" },
  { id: "thank", ar: "مين ودك تشكره اليوم؟ 🙏", en: "Who would you like to thank today? 🙏" },
  { id: "advice", ar: "وش نصيحتك لنفسك من اليوم؟ 🧭", en: "Advice from today to yourself? 🧭" },
  { id: "fun", ar: "وش أمتع شي سويته اليوم؟ 🎉", en: "Most fun thing you did today? 🎉" },
  { id: "stress", ar: "وش اللي توترك اليوم؟ وكيف تعاملت؟", en: "What stressed you, and how did you cope?" },
  { id: "goal", ar: "قرّبت من هدف اليوم؟ وش هو؟ 🎯", en: "Got closer to a goal today? 🎯" },
  { id: "weather_in", ar: "لو مزاجك جو، كيف بيكون؟ 🌦️", en: "If your mood were weather? 🌦️" },
  { id: "notice", ar: "شي حلو لاحظته وما أحد انتبه له؟", en: "A small beautiful thing you noticed?" },
  { id: "easier", ar: "وش يخلي بكرة أسهل؟ 🛠️", en: "What would make tomorrow easier? 🛠️" },
  { id: "music", ar: "وش آخر شي سمعته وعجبك؟ 🎧", en: "Last thing you listened to and liked? 🎧" },
  { id: "brave", ar: "سويت شي يحتاج شجاعة اليوم؟ 🦁", en: "Did something brave today? 🦁" },
  { id: "body", ar: "كيف حاس بجسمك اليوم؟ 🩺", en: "How does your body feel today? 🩺" },
  { id: "highlight3", ar: "3 أشياء حلوة صارت اليوم؟ ✨", en: "Three good things from today? ✨" },
  { id: "family", ar: "وش آخر شي حلو صار مع أهلك؟ 🏠", en: "A recent nice moment with family? 🏠" },
  { id: "free", ar: "لو عندك ساعة فاضية بكرة، وش تسوي؟", en: "A free hour tomorrow — what would you do?" },
  { id: "kind_self", ar: "كنت لطيف مع نفسك اليوم؟ 🤍", en: "Were you kind to yourself today? 🤍" },
  { id: "memory", ar: "ذكرى حلوة تذكرتها اليوم؟ 📸", en: "A good memory that came up today? 📸" },
];

export const ALL_QUESTIONS = [GRATITUDE, ...QUESTIONS];

export const questionById = (id: string) => ALL_QUESTIONS.find((q) => q.id === id);

export const questionText = (q: Question, lang: Lang) => (lang === "en" ? q.en : q.ar);

/** خلط ثابت لكل شخص (نفس الترتيب دايماً). */
function orderFor(userId: string): Question[] {
  const score = (q: Question) => createHash("sha1").update(`${userId}:${q.id}`).digest().readUInt32BE(0);
  return [...QUESTIONS].sort((a, b) => score(a) - score(b));
}

/** سؤال يوم معيّن لشخص معيّن: الامتنان كل 7 أيام، والباقي بالدور بدون تكرار. */
export function questionFor(userId: string, day: string): Question {
  const n = diffDays(day, "2024-01-01");
  if (((n % 7) + 7) % 7 === 3) return GRATITUDE;
  const order = orderFor(userId);
  const k = n - Math.floor((n + 4) / 7); // نشيل أيام الامتنان من العدّ عشان ما نتخطى أسئلة
  return order[((k % order.length) + order.length) % order.length]!;
}
