/**
 * JSX خفيف بدون React (صفر مكتبات): نفس ملفات .tsx تشتغل على السيرفر (renderToString → HTML)
 * وفي المتصفح (toDOM → عناصر DOM مع الأحداث). مربوط في tsconfig: jsxImportSource "#jsx".
 *
 *   const Card = (p: { title: string; children?: Child }) => <div class="card"><h2>{p.title}</h2>{p.children}</div>;
 *   renderToString(<Card title="مرحبا">نص</Card>)            // السيرفر
 *   mount(document.body, <Card title="مرحبا" />)            // المتصفح
 *
 * المكوّنات دوال تُستدعى فوراً (بدون حالة داخلية) — للتحديث: أعد رسم الجزء بـ mount().
 */

export type Child = VNode | string | number | bigint | boolean | null | undefined | Child[];
export type Props = Record<string, any> & { children?: Child };
export type Component<P = Props> = (props: P) => Child;

export const Fragment = Symbol.for("rift.fragment");
const RAW = Symbol.for("rift.raw");

export interface VNode {
  type: string | typeof Fragment | typeof RAW;
  props: Props;
}

export function jsx(type: string | typeof Fragment | Component<any>, props: Props | null, _key?: unknown): Child {
  const p = props ?? {};
  if (typeof type === "function") return type(p);
  return { type, props: p };
}
export const jsxs = jsx;
export const jsxDEV = jsx;

/** HTML جاهز بدون تهريب (لمحتوى موثوق فقط). */
export function raw(html: string): VNode {
  return { type: RAW, props: { html } };
}

// ───────────── السيرفر ─────────────

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]!);

const ATTR_ALIAS: Record<string, string> = { className: "class", htmlFor: "for", httpEquiv: "http-equiv", acceptCharset: "accept-charset" };
const kebab = (k: string) => (k.startsWith("--") ? k : k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`));

export function styleToString(style: Record<string, string | number | null | undefined>): string {
  return Object.entries(style)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${kebab(k)}:${v}`)
    .join(";");
}

function attrs(props: Props): string {
  let out = "";
  for (const [k, v] of Object.entries(props)) {
    if (k === "children" || k === "dangerouslySetInnerHTML" || k === "ref" || k === "key" || /^on[A-Z]/.test(k)) continue;
    if (v === null || v === undefined || v === false) continue;
    const name = ATTR_ALIAS[k] ?? k;
    if (v === true) out += ` ${name}`;
    else if (name === "style" && typeof v === "object") out += ` style="${escapeHtml(styleToString(v))}"`;
    else out += ` ${name}="${escapeHtml(String(v))}"`;
  }
  return out;
}

export function renderToString(node: Child): string {
  if (node === null || node === undefined || node === false || node === true) return "";
  if (Array.isArray(node)) return node.map(renderToString).join("");
  if (typeof node !== "object") return escapeHtml(String(node));
  if (node.type === RAW) return String(node.props.html ?? "");
  if (node.type === Fragment) return renderToString(node.props.children);
  const tag = node.type as string;
  const open = `<${tag}${attrs(node.props)}>`;
  if (VOID.has(tag)) return open;
  const inner = node.props.dangerouslySetInnerHTML?.__html ?? renderToString(node.props.children);
  return `${open}${inner}</${tag}>`;
}

/** صفحة HTML كاملة مع doctype. */
export function renderDocument(node: Child): string {
  return `<!doctype html>${renderToString(node)}`;
}

// ───────────── المتصفح ─────────────

const SVG_NS = "http://www.w3.org/2000/svg";
const SVG_TAGS = new Set(["svg", "path", "circle", "rect", "line", "polyline", "polygon", "g", "defs", "linearGradient", "radialGradient", "stop", "text", "tspan", "use", "symbol", "clipPath", "mask", "ellipse", "title", "desc", "pattern", "filter", "feGaussianBlur", "feOffset", "feBlend", "foreignObject"]);

export function toDOM(node: Child, svg = false): Node {
  const doc = (globalThis as any).document as Document;
  if (node === null || node === undefined || node === false || node === true) return doc.createTextNode("");
  if (Array.isArray(node)) {
    const frag = doc.createDocumentFragment();
    for (const c of node) frag.appendChild(toDOM(c, svg));
    return frag;
  }
  if (typeof node !== "object") return doc.createTextNode(String(node));
  if (node.type === RAW) {
    const t = doc.createElement("template");
    t.innerHTML = String(node.props.html ?? "");
    return t.content;
  }
  if (node.type === Fragment) return toDOM(node.props.children, svg);
  const tag = node.type as string;
  const isSvg = svg || SVG_TAGS.has(tag);
  const el = isSvg ? doc.createElementNS(SVG_NS, tag) : doc.createElement(tag);
  // value/checked/selected و ref بعد إضافة الأبناء: <select value> يحتاج خياراته موجودة، والـ ref يشوف العنصر كامل.
  const late: Array<() => void> = [];
  for (const [k, v] of Object.entries(node.props)) {
    if (k === "children" || k === "key") continue;
    if (k === "ref") {
      if (typeof v === "function") late.push(() => v(el));
      continue;
    }
    if (k === "dangerouslySetInnerHTML") {
      el.innerHTML = v?.__html ?? "";
      continue;
    }
    if (/^on[A-Z]/.test(k) && typeof v === "function") {
      el.addEventListener(k.slice(2).toLowerCase(), v);
      continue;
    }
    if (v === null || v === undefined || v === false) continue;
    const name = ATTR_ALIAS[k] ?? k;
    if (name === "style" && typeof v === "object") el.setAttribute("style", styleToString(v));
    else if (!isSvg && (name === "value" || name === "checked" || name === "selected") && name in el) late.unshift(() => { (el as any)[name] = v; });
    else el.setAttribute(name, v === true ? "" : String(v));
  }
  if (!node.props.dangerouslySetInnerHTML) el.appendChild(toDOM(node.props.children, isSvg));
  for (const run of late) run();
  return el;
}

/** يستبدل محتوى العنصر بالـ JSX المعطى. */
export function mount(target: Element, node: Child): void {
  target.replaceChildren(toDOM(node));
}

// ───────────── الأنواع ─────────────

export namespace JSX {
  export type Element = Child;
  export interface ElementChildrenAttribute {
    children: {};
  }
  export interface IntrinsicElements {
    [tag: string]: Record<string, any>;
  }
}
