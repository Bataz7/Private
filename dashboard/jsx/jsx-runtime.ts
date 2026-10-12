/**
 * JSX runtime صغير يرسم إلى نص HTML على السيرفر (بدون React).
 * - كل النصوص والقيم تُهرَّب (escape) تلقائياً.
 * - raw(html) لمحتوى موثوق فقط (أيقونات SVG ثابتة).
 */

/** نص HTML جاهز (لا يُهرَّب مرة ثانية). */
export class Html {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

/** يعلّم نص HTML موثوق (لا تمرر له أي مدخلات من المستخدم). */
export const raw = (html: string): Html => new Html(html);

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c]!);

export type Child = Html | string | number | bigint | boolean | null | undefined | Child[];

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

function renderChildren(c: Child, out: string[]): void {
  if (c == null || c === false || c === true) return;
  if (c instanceof Html) out.push(c.value);
  else if (Array.isArray(c)) for (const x of c) renderChildren(x, out);
  else out.push(escapeHtml(String(c)));
}

/** يحوّل أي ابن إلى HTML (مهرَّب). */
export function render(c: Child): Html {
  const out: string[] = [];
  renderChildren(c, out);
  return new Html(out.join(""));
}

const ATTR_NAME = /^[a-zA-Z_:][a-zA-Z0-9_.:-]*$/;

function attrs(props: Record<string, unknown>): string {
  let s = "";
  for (const k in props) {
    if (k === "children" || k === "key") continue;
    const v = props[k];
    if (v == null || v === false) continue;
    const name = k === "className" ? "class" : k === "htmlFor" ? "for" : k;
    if (!ATTR_NAME.test(name)) continue;
    if (v === true) s += ` ${name}`;
    else s += ` ${name}="${escapeHtml(v instanceof Html ? v.value : String(v))}"`;
  }
  return s;
}

type Component = (props: any) => Html | string | null;

export function jsx(type: string | Component, props: Record<string, any>): Html {
  if (typeof type === "function") {
    const r = type(props);
    return r instanceof Html ? r : render(r as Child);
  }
  const open = `<${type}${attrs(props)}>`;
  if (VOID.has(type)) return new Html(open);
  return new Html(`${open}${render(props.children).value}</${type}>`);
}

export const jsxs = jsx;
export const jsxDEV = jsx;

export function Fragment(props: { children?: Child }): Html {
  return render(props.children);
}

export namespace JSX {
  export type Element = Html;
  export interface ElementChildrenAttribute {
    children: {};
  }
  export interface IntrinsicElements {
    [tag: string]: Record<string, unknown> & { children?: Child };
  }
}
