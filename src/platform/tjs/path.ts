/** node:path (POSIX) — الأجزاء اللي يستخدمها البوت. */
declare const tjs: any;
export const sep = "/";

function normalize(p: string): string {
  const abs = p.startsWith("/");
  const out: string[] = [];
  for (const part of p.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (out.length && out[out.length - 1] !== "..") out.pop();
      else if (!abs) out.push("..");
    } else out.push(part);
  }
  return (abs ? "/" : "") + out.join("/") || (abs ? "/" : ".");
}

export function join(...parts: string[]): string {
  return normalize(parts.filter((x) => x !== undefined && x !== "").join("/"));
}

export function resolve(...parts: string[]): string {
  let p = "";
  for (let i = parts.length - 1; i >= 0 && !p.startsWith("/"); i--) {
    const part = parts[i];
    if (part) p = p ? `${part}/${p}` : part;
  }
  if (!p.startsWith("/")) p = `${typeof tjs.cwd === "function" ? tjs.cwd() : tjs.cwd}/${p}`;
  return normalize(p);
}

export function dirname(p: string): string {
  const n = normalize(p);
  const i = n.lastIndexOf("/");
  return i < 0 ? "." : i === 0 ? "/" : n.slice(0, i);
}

export function basename(p: string, ext?: string): string {
  const b = normalize(p).split("/").pop() ?? "";
  return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b;
}

export function extname(p: string): string {
  const b = basename(p);
  const i = b.lastIndexOf(".");
  return i <= 0 ? "" : b.slice(i);
}

export default { sep, join, resolve, dirname, basename, extname };
