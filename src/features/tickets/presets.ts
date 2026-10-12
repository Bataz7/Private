/**
 * قوالب أسئلة التذاكر (من core/ticket_presets.py).
 * كل قالب = أسئلة تظهر في نافذة قبل فتح التذكرة، وتُعرض إجاباتها داخل التذكرة للإدارة.
 * الحد: 5 أسئلة، عنوان السؤال ≤ 45 حرف، المثال ≤ 100 حرف (قيود ديسكورد).
 * السؤال: [مفتاح، العنوان، المثال، نوع: s قصير / p فقرة، إلزامي]
 */
import { E } from "../../core/emojis.ts";

type Q = [key: string, label: string, placeholder: string, style: "s" | "p", required: boolean];
export interface Preset { ar: string; emoji: string; fallback: string; q: Q[] }

export const PRESETS: Record<string, Preset> = {
  support: { ar: "الدعم الفني", emoji: "ticket_support", fallback: "🛟", q: [
    ["kind", "ما نوع المشكلة؟", "مثال: ما أقدر أدخل / خطأ في أمر", "s", true],
    ["desc", "اشرح مشكلتك بالتفصيل", "اكتب كل ما يساعدنا نفهم المشكلة", "p", true],
    ["when", "متى بدأت المشكلة؟", "اليوم / أمس / من أسبوع", "s", false],
    ["tried", "وش جربت لحلها؟", "إعادة تشغيل، تغيير الإعدادات…", "p", false]] },
  inquiry: { ar: "استفسار", emoji: "message", fallback: "💬", q: [
    ["q", "ما هو استفسارك؟", "اكتب سؤالك بوضوح", "p", true],
    ["topic", "القسم المعني بالاستفسار", "الرول بلاي / المتجر / التقديمات…", "s", false]] },
  complaint: { ar: "شكوى", emoji: "warning", fallback: "⚠️", q: [
    ["who", "اسم أو آيدي المشتكى عليه", "الاسم أو الآيدي أو المنشن", "s", true],
    ["what", "تفاصيل الشكوى", "وش صار بالضبط؟", "p", true],
    ["when", "وقت وتاريخ الحادثة", "مثال: أمس العصر", "s", false],
    ["proof", "الأدلة (روابط صور أو فيديو)", "https://…", "p", false]] },
  report: { ar: "بلاغ على لاعب", emoji: "alert", fallback: "🚨", q: [
    ["char", "اسم الشخصية أو الآيدي", "الاسم داخل الرول", "s", true],
    ["rule", "نوع المخالفة", "FRP / RDM / VDM / تجاوز…", "s", true],
    ["story", "اشرح ما حدث بالتفصيل", "رتّب الأحداث من البداية", "p", true],
    ["time", "وقت الحادثة", "مثال: 9:30 مساءً", "s", false],
    ["clip", "رابط الكليب / الدليل", "https://…", "s", false]] },
  purchase: { ar: "شراء / متجر", emoji: "money", fallback: "💰", q: [
    ["item", "وش تبي تشتري؟", "اسم المنتج أو الباقة", "s", true],
    ["pay", "طريقة الدفع المفضلة", "تحويل / بطاقة…", "s", true],
    ["ign", "اسمك داخل اللعبة", "الاسم الذي سنفعّل عليه الطلب", "s", true],
    ["note", "ملاحظات إضافية", "اختياري", "p", false]] },
  partner: { ar: "شراكة", emoji: "link", fallback: "🔗", q: [
    ["name", "اسم سيرفرك", "", "s", true],
    ["invite", "رابط السيرفر", "https://discord.gg/…", "s", true],
    ["members", "عدد الأعضاء", "مثال: 1500", "s", true],
    ["offer", "وش تقدم في الشراكة؟", "إعلانات، فعاليات، دعم…", "p", true]] },
  appeal: { ar: "تظلم / فك باند", emoji: "unban", fallback: "🔓", q: [
    ["id", "آيدي حسابك في ديسكورد", "18 رقم تقريباً", "s", true],
    ["reason", "سبب الباند حسب علمك", "", "s", true],
    ["why", "ليش نرفع عنك الباند؟", "كن صادقاً ومختصراً", "p", true],
    ["staff", "المشرف الذي طبّق العقوبة (إن عرفته)", "", "s", false]] },
  staff: { ar: "تقديم إدارة", emoji: "admin", fallback: "👑", q: [
    ["age", "عمرك", "", "s", true],
    ["exp", "خبراتك السابقة في الإدارة", "سيرفرات أدرتها / مدة الخبرة", "p", true],
    ["why", "ليش تبي تنضم لفريقنا؟", "", "p", true],
    ["time", "كم ساعة تتواجد يومياً؟", "مثال: 3 ساعات", "s", true]] },
  bug: { ar: "إبلاغ عن خلل", emoji: "bolt", fallback: "⚡", q: [
    ["bug", "وش الخلل؟", "وصف مختصر", "s", true],
    ["steps", "خطوات تكرار الخلل", "1) … 2) … 3) …", "p", true],
    ["impact", "تأثير الخلل", "يوقف اللعب؟ يخسّرك فلوس؟", "s", false],
    ["shot", "رابط صورة أو فيديو", "https://…", "s", false]] },
  suggest: { ar: "اقتراح", emoji: "star", fallback: "⭐", q: [
    ["title", "عنوان الاقتراح", "", "s", true],
    ["desc", "وصف الاقتراح", "كيف تتخيله يشتغل؟", "p", true],
    ["benefit", "وش الفائدة منه؟", "", "p", false]] },
  refund: { ar: "تعويض / استرجاع", emoji: "card", fallback: "💳", q: [
    ["lost", "وش اللي ضاع أو انسرق؟", "مبلغ / عنصر / ممتلكات", "s", true],
    ["how", "كيف ضاع؟", "اشرح بالتفصيل", "p", true],
    ["proof", "دليل", "روابط صور أو كليبات", "p", true]] },
  creator: { ar: "صناع المحتوى", emoji: "image", fallback: "🖼️", q: [
    ["channel", "رابط قناتك", "يوتيوب / تيك توك / تويتش", "s", true],
    ["followers", "عدد المتابعين", "", "s", true],
    ["content", "نوع المحتوى", "رول بلاي، ألعاب، ترفيه…", "s", true],
    ["plan", "كيف ستروّج لنا؟", "", "p", false]] },
};

export interface Question { id: string; label: string; ph: string; style: "s" | "p"; required: boolean }

/** الأسئلة الفعلية لتذكرة: الأسئلة المخصصة (من لوحة التحكم) تتقدم على القالب. */
export function questionsFor(cfg: Record<string, any>): Question[] {
  const custom = (Array.isArray(cfg.questions) ? cfg.questions : [])
    .filter((q: unknown): q is string => typeof q === "string" && !!q.trim()).map((q: string) => q.trim()).slice(0, 5);
  if (custom.length) {
    return custom.map((q: string, i: number) => ({ id: `c${i}`, label: q.slice(0, 45), ph: "", style: q.length > 30 ? "p" : "s", required: i === 0 }));
  }
  const p = PRESETS[cfg.preset || ""];
  if (!p) return [];
  return p.q.map(([id, label, ph, style, required]) => ({ id, label: label.slice(0, 45), ph: ph.slice(0, 100), style, required }));
}

/** إيموجي نوع التذكرة (إيموجي البوت الخاص أو بديل عادي). */
export function presetEmoji(preset: string | null | undefined): string {
  const p = PRESETS[preset || ""];
  if (!p) return E("ticket");
  const e = E(p.emoji);
  return e === "▫️" ? p.fallback : e;
}
