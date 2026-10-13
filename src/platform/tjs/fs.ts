/** node:fs (المتزامن) فوق __revive (وحدة C صغيرة مضافة لـ txiki — runtime/txiki/revive.patch). */
declare const __revive: any;
const R = __revive;

function enoent(path: string): Error {
  const e = new Error(`ENOENT: no such file or directory, '${path}'`) as Error & { code: string };
  e.code = "ENOENT";
  return e;
}

/** بايتات مع toString("base64"/"utf8") مثل Buffer. */
class Bytes extends Uint8Array {
  override toString(enc?: string): string {
    if (enc === "base64") {
      let s = "";
      for (let i = 0; i < this.length; i += 0x8000) s += String.fromCharCode(...this.subarray(i, i + 0x8000));
      return btoa(s);
    }
    return new TextDecoder().decode(this);
  }
}

export function readFileSync(path: string, enc?: string | { encoding?: string }): any {
  const encoding = typeof enc === "string" ? enc : enc?.encoding;
  if (encoding) {
    const s = R.readFile(String(path), false);
    if (s === null) throw enoent(path);
    return s;
  }
  const b = R.readFile(String(path), true);
  if (b === null) throw enoent(path);
  return new Bytes(b.buffer, b.byteOffset, b.byteLength);
}

export function writeFileSync(path: string, data: string | Uint8Array): void {
  if (!R.writeFile(String(path), typeof data === "string" ? data : new Uint8Array(data))) throw new Error(`EACCES: cannot write '${path}'`);
}

export function existsSync(path: string): boolean {
  return R.stat(String(path)) !== null;
}

export function statSync(path: string) {
  const s = R.stat(String(path));
  if (!s) throw enoent(path);
  return { mtimeMs: s.mtimeMs, size: s.size, isDirectory: () => s.isDir, isFile: () => !s.isDir };
}

export function mkdirSync(path: string, _o?: unknown): void {
  R.mkdirp(String(path));
}

export function renameSync(from: string, to: string): void {
  if (!R.rename(String(from), String(to))) throw new Error(`rename failed: '${from}' → '${to}'`);
}

export function unlinkSync(path: string): void {
  if (!R.unlink(String(path))) throw enoent(path);
}

export function readdirSync(path: string): string[] {
  const r = R.readDir(String(path));
  if (!r) throw enoent(path);
  return r;
}

export default { readFileSync, writeFileSync, existsSync, statSync, mkdirSync, renameSync, unlinkSync, readdirSync };
