/** bun:ffi غير موجود في txiki — trim.ts يتجاهل التقليص (ما نحتاجه: txiki خفيف أصلاً). */
export function dlopen(): never {
  throw new Error("ffi not available on txiki");
}
export const FFIType = {} as Record<string, number>;
