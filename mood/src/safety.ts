/**
 * كشف بسيط لعبارات الخطر (إيذاء النفس) بالعربي والإنجليزي.
 * الهدف: لو انكتب شي مقلق، البوت يرد بلطف بأرقام المساعدة وينبّه المالك.
 * مو تشخيص — مجرد شبكة أمان.
 */

/** توحيد الحروف العربية: نشيل التشكيل والتطويل ونوحد الألف والياء والتاء المربوطة. */
export function normalizeArabic(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/\s+/g, " ");
}

const PATTERNS: RegExp[] = [
  /انتحر/, /انتحار/,
  /(اقتل|اذبح|اذي|اوذي|اضر) ?نفسي/,
  /(ابي|ابغي|ابغى|ودي|اريد|بدي|نفسي) ?(اموت|انتحر|اختفي من الدنيا)/,
  /(ما|مو|مب|ماني) ?(ابي|ابغي|ودي|اريد) ?(اعيش|احيا)/,
  /(انهي|اخلص|انهاء) ?(حياتي|عمري)/,
  /(تعبت|زهقت) من (الحياه|حياتي|العيشه)/,
  /الموت ارحم/, /ليتني (مت|ميت)/,
  /\bkill(ing)? myself\b/, /\bsuicid/, /\bend (my|it all|my life)\b/, /\bself[- ]?harm/, /\bwant(ed)? to die\b/, /\bcut(ting)? myself\b/,
];

export function detectRisk(...texts: (string | undefined | null)[]): boolean {
  const s = normalizeArabic(texts.filter(Boolean).join(" \n "));
  if (!s.trim()) return false;
  return PATTERNS.some((p) => p.test(s));
}
