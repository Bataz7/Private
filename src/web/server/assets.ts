import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import type { WebManifest } from '../build.js';
import type { Context } from './http.js';

// ملفات الواجهة المبنية (web-dist): المانيفست، وتقديم /a/* مع كاش طويل للملفات المهشّشة، وضغط gzip اختياري.
//   /a/d/*  للستاف المسجّلين فقط (والملفات في manifest.adminFiles للأدمن فقط)
//   /a/p/*  ملفات الصفحات العامة      /a/s/*  ملفات ثابتة عامة (خطوط، صور، svg)

export type { WebManifest };
export type WebEntry = keyof WebManifest['entries'];

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
export const webDist = process.env.WEB_DIST_DIR ? normalize(process.env.WEB_DIST_DIR) : join(projectRoot, 'web-dist');
const sources = [join(projectRoot, 'src/web/client'), join(projectRoot, 'src/web/static'), join(projectRoot, 'src/web/build.ts')];

const EMPTY: WebManifest = {
  entries: { app: { js: '', css: [] }, login: { js: '', css: [] }, status: { js: '', css: [] }, apply: { js: '', css: [] }, profile: { js: '', css: [] } },
  adminFiles: [], version: '0',
};

let manifest: WebManifest = EMPTY;
let adminFiles = new Set<string>();

function newest(path: string): number {
  if (!existsSync(path)) return 0;
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.mtimeMs;
  let latest = stat.mtimeMs;
  for (const entry of readdirSync(path)) latest = Math.max(latest, newest(join(path, entry)));
  return latest;
}

function readManifest(): WebManifest | null {
  try {
    const data = JSON.parse(readFileSync(join(webDist, 'manifest.json'), 'utf8')) as Partial<WebManifest>;
    return { entries: { ...EMPTY.entries, ...(data.entries ?? {}) }, adminFiles: Array.isArray(data.adminFiles) ? data.adminFiles : [], version: String(data.version ?? '0') };
  } catch { return null; }
}

/** يحمّل web-dist/manifest.json، ويبني الواجهة أول لو ناقص أو أقدم من الملفات المصدرية. */
export async function loadWebManifest(options: { build?: boolean } = {}): Promise<WebManifest> {
  const file = join(webDist, 'manifest.json');
  const stale = !existsSync(file) || statSync(file).mtimeMs < Math.max(...sources.map(newest));
  if (stale && options.build !== false && process.env.WEB_BUILD !== 'off') {
    try {
      const { buildWeb } = await import('../build.js');
      await buildWeb({ quiet: true });
    } catch (error) {
      console.error('[web] تعذّر بناء الواجهة:', error instanceof Error ? error.message : error);
    }
  }
  setManifest(readManifest() ?? EMPTY);
  return manifest;
}

export function setManifest(next: WebManifest) {
  manifest = next;
  adminFiles = new Set(next.adminFiles);
  gzipCache.clear();
}

export const currentManifest = () => manifest;
export const entryAssets = (entry: WebEntry) => manifest.entries[entry] ?? { js: '', css: [] };
export const isAdminFile = (url: string) => adminFiles.has(url);

// ---- تقديم الملفات --------------------------------------------------------------------------------
const TYPES: Record<string, string> = {
  js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg',
  jpeg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif', gif: 'image/gif', ico: 'image/x-icon', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', txt: 'text/plain; charset=utf-8',
};
const COMPRESSIBLE = new Set(['js', 'mjs', 'css', 'svg', 'txt']);
const SAFE_PATH = /^\/a\/[dps]\/(?:[\w-]+\/)*[\w-]+(?:\.[\w-]+)*\.([a-z0-9]+)$/i;
// اسم الملف فيه هاش (8 أحرف أو أكثر) = محتواه ما يتغير أبداً.
const HASHED = /[.-][A-Za-z0-9_]{8,}\.[a-z0-9]+$/;

const gzipCache = new Map<string, Uint8Array>();
const GZIP_MAX_ENTRIES = 80;
const GZIP_MAX_FILE = 2 * 1024 * 1024;

export type AssetAccess = { staff: boolean; admin: boolean };

/** يرد بملف من web-dist أو null. ملفات /a/d للستاف فقط؛ الرفض = 404 (ما نكشف إن الملف موجود). */
export async function serveAsset(c: Context, access: () => Promise<AssetAccess>): Promise<Response | null> {
  if (!c.path.startsWith('/a/')) return null;
  if (c.method !== 'GET' && c.method !== 'HEAD') return c.text('', 405);
  const match = SAFE_PATH.exec(c.path);
  if (!match || c.path.includes('..')) return c.text('', 404);
  const extension = match[1]!.toLowerCase();
  const type = TYPES[extension];
  if (!type) return c.text('', 404);
  const zone = c.path[3];
  if (zone === 'd') {
    const allowed = await access();
    if (!allowed.staff || (isAdminFile(c.path) && !allowed.admin)) return c.text('', 404);
  }
  const path = join(webDist, c.path);
  if (!path.startsWith(webDist)) return c.text('', 404);
  const file = Bun.file(path);
  if (!await file.exists()) return c.text('', 404);
  const headers = new Headers({ 'content-type': type, 'x-robots-tag': 'noindex' });
  headers.set('cache-control', HASHED.test(c.path) ? `${zone === 'd' ? 'private' : 'public'}, max-age=31536000, immutable` : `${zone === 'd' ? 'private' : 'public'}, max-age=3600`);
  if (COMPRESSIBLE.has(extension)) {
    headers.set('vary', 'Accept-Encoding');
    if (/\bgzip\b/.test(c.req.headers.get('accept-encoding') || '') && file.size <= GZIP_MAX_FILE) {
      let packed = gzipCache.get(path);
      if (!packed) {
        packed = new Uint8Array(gzipSync(new Uint8Array(await file.arrayBuffer())));
        if (gzipCache.size >= GZIP_MAX_ENTRIES) gzipCache.delete(gzipCache.keys().next().value!);
        gzipCache.set(path, packed);
      }
      headers.set('content-encoding', 'gzip');
      return c.send(new Response(c.method === 'HEAD' ? null : packed, { headers }));
    }
  }
  return c.send(new Response(c.method === 'HEAD' ? null : file, { headers }));
}
