/** ترجمة واجهة اللوحة (عربي / English) — النصوص في i18n-data.ts. */
import { TEXT } from "./i18n-data.ts";

export type Lang = "ar" | "en";

function lookup(lang: Lang, path: string): unknown {
  let o: any = TEXT[lang];
  for (const k of path.split(".")) {
    if (o == null || typeof o !== "object" || !(k in o)) return undefined;
    o = o[k];
  }
  return o;
}

/** النص (أو القائمة) للمسار؛ يرجع للعربي لو ما فيه ترجمة، وإلا المسار نفسه. */
export function t(lang: Lang, path: string, vars?: Record<string, string | number>): any {
  let v = lookup(lang, path);
  if (v === undefined && lang !== "ar") v = lookup("ar", path);
  if (v === undefined) return path;
  if (typeof v === "string" && vars) for (const [k, x] of Object.entries(vars)) v = (v as string).split(`{${k}}`).join(String(x));
  return v;
}

export const has = (lang: Lang, path: string) => lookup(lang, path) !== undefined;

let bundle = "";
/** نفس النصوص للمتصفح (التنبيهات والرسائل الديناميكية). */
export function jsBundle(): string {
  return (bundle ||= "window.I18N=" + JSON.stringify(TEXT).replace(/</g, "\\u003c") + ";");
}

export function pickLang(cookie: string | undefined, accept: string | null): Lang {
  if (cookie === "ar" || cookie === "en") return cookie;
  if (accept) return accept.split(",")[0]!.trim().toLowerCase().startsWith("ar") ? "ar" : "en";
  return "ar";
}
