// يبني واجهة اللوحة (TSX) إلى web-dist/ بـ Bun.build: مضغوطة، بأسماء هاش، بدون source maps.
//   /a/d/<hash>.js|css  ملفات اللوحة (للستاف المسجّلين): مدخلا app وprofile وقطعهم المشتركة
//   /a/p/<hash>.js|css  الصفحات العامة: الدخول، الحالة، نموذج التقديم
//   /a/s/<path>         ملفات ثابتة (خطوط، svg)
// manifest.adminFiles: القطع اللي ما توصلها إلا صفحات الإدارة (تُحمّل بـ import() منفصل)، عشان السيرفر يحجبها عن غيرهم.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

export type WebManifest = { entries: Record<'app' | 'login' | 'status' | 'apply' | 'profile', { js: string; css: string[] }>; adminFiles: string[]; version: string };

const ROOT = resolve(import.meta.dir, '../..');
const CLIENT = join(ROOT, 'src/web/client');
const STATIC = join(ROOT, 'src/web/static');
const OUT = join(ROOT, 'web-dist');

/** صفحات الإدارة (نفس adminCode في shell/routes.ts). ملف كل صفحة: client/pages/<key>.tsx */
export const ADMIN_PAGES = ['studio', 'modreports', 'applications', 'audit', 'health', 'statusposts', 'status', 'settings'];

type Meta = { inputs: Record<string, { imports: Array<{ path: string; kind: string; external?: boolean }> }>; outputs: Record<string, { entryPoint?: string; imports: Array<{ path: string; kind: string }>; inputs: Record<string, unknown> }> };

const norm = (path: string) => resolve(ROOT, path).replace(/\\/g, '/');

async function bundle(entries: string[], dir: 'd' | 'p') {
  const result = await Bun.build({
    entrypoints: entries.map(name => join(CLIENT, name)),
    outdir: join(OUT, 'a', dir),
    root: CLIENT,
    target: 'browser',
    format: 'esm',
    splitting: true,
    minify: true,
    sourcemap: 'none',
    metafile: true,
    naming: { entry: '[hash].[ext]', chunk: '[hash].[ext]', asset: '[hash].[ext]' },
    define: { 'process.env.NODE_ENV': '"production"' },
    external: ['/a/s/*'],
  });
  if (!result.success) throw new AggregateError(result.logs, `web build failed (${dir}): ${result.logs.map(log => String(log)).join('\n')}`);
  return result;
}

const url = (dir: 'd' | 'p', file: string) => `/a/${dir}/${basename(file)}`;

export async function buildWeb(opts: { quiet?: boolean } = {}): Promise<WebManifest> {
  const started = performance.now();
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, 'a', 'd'), { recursive: true });
  mkdirSync(join(OUT, 'a', 'p'), { recursive: true });

  // ---- scripts ----
  const dash = await bundle(['entries/app.tsx', 'entries/profile.tsx'], 'd');
  const pub = await bundle(['entries/login.tsx', 'entries/status.tsx', 'entries/apply.tsx'], 'p');
  const entryUrl = (result: Awaited<ReturnType<typeof bundle>>, dir: 'd' | 'p', name: string) => {
    const meta = result.metafile as unknown as Meta;
    const out = Object.entries(meta.outputs).find(([, info]) => info.entryPoint && norm(info.entryPoint).endsWith(`/entries/${name}.tsx`));
    if (!out) throw new Error(`web build: no output for entry ${name}`);
    return url(dir, out[0]);
  };

  // ---- admin-only chunks ----
  const meta = dash.metafile as unknown as Meta;
  const outputs = Object.entries(meta.outputs).map(([path, info]) => ({ path, info, entry: info.entryPoint ? norm(info.entryPoint) : '' }));
  const byFile = new Map(outputs.map(item => [basename(item.path), item]));
  const adminEntry = (entry: string) => ADMIN_PAGES.some(key => entry.endsWith(`/pages/${key}.tsx`));
  const roots = outputs.filter(item => item.entry && !adminEntry(item.entry) && item.path.endsWith('.js'));
  const common = new Set<string>();
  const walk = (file: string, into: Set<string>, skipAdmin: boolean) => {
    if (into.has(file)) return;
    const item = byFile.get(file);
    if (!item) return;
    if (skipAdmin && adminEntry(item.entry)) return;
    into.add(file);
    for (const imp of item.info.imports) walk(basename(imp.path), into, skipAdmin);
  };
  for (const item of roots) walk(basename(item.path), common, true);
  const adminOnly = new Set<string>();
  for (const item of outputs.filter(entry => adminEntry(entry.entry))) walk(basename(item.path), adminOnly, false);
  const adminFiles = [...adminOnly].filter(file => !common.has(file)).map(file => url('d', file)).sort();
  const pagesFound = outputs.filter(item => adminEntry(item.entry)).length;
  if (pagesFound !== ADMIN_PAGES.length) throw new Error(`web build: expected ${ADMIN_PAGES.length} admin page chunks, found ${pagesFound}`);

  // ---- stylesheets ----
  const css = async (entry: string, dir: 'd' | 'p') => {
    const result = await Bun.build({ entrypoints: [join(CLIENT, 'styles', entry)], outdir: join(OUT, 'a', dir), minify: true, naming: '[hash].[ext]', external: ['/a/s/*'] });
    if (!result.success) throw new AggregateError(result.logs, `web css build failed: ${entry}`);
    const file = result.outputs.find(output => output.path.endsWith('.css'));
    if (!file) throw new Error(`web build: no css for ${entry}`);
    return url(dir, file.path);
  };
  const dashCss = await css('dashboard.css', 'd');
  const pubCss = await css('public.css', 'p');

  // ---- static ----
  if (existsSync(STATIC)) cpSync(STATIC, join(OUT, 'a', 's'), { recursive: true });

  const entries: WebManifest['entries'] = {
    app: { js: entryUrl(dash, 'd', 'app'), css: [dashCss] },
    profile: { js: entryUrl(dash, 'd', 'profile'), css: [dashCss] },
    login: { js: entryUrl(pub, 'p', 'login'), css: [pubCss] },
    status: { js: entryUrl(pub, 'p', 'status'), css: [pubCss] },
    apply: { js: entryUrl(pub, 'p', 'apply'), css: [pubCss] },
  };
  const hash = createHash('sha256');
  for (const item of [...dash.outputs, ...pub.outputs]) hash.update(readFileSync(item.path));
  hash.update(dashCss + pubCss);
  const manifest: WebManifest = { entries, adminFiles, version: hash.digest('hex').slice(0, 12) };
  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));

  if (!opts.quiet) {
    const rows = [...dash.outputs, ...pub.outputs].map(item => ({ file: relative(OUT, item.path), kb: (readFileSync(item.path).length / 1024).toFixed(1), admin: adminFiles.includes(url(item.path.includes('/a/p/') ? 'p' : 'd', item.path)) }));
    for (const file of [dashCss, pubCss]) rows.push({ file: file.slice(1), kb: (readFileSync(join(OUT, file)).length / 1024).toFixed(1), admin: false });
    console.log(`[web] built ${rows.length} files into web-dist/ in ${Math.round(performance.now() - started)} ms (${adminFiles.length} admin-only).`);
    for (const row of rows.sort((a, b) => Number(b.kb) - Number(a.kb))) console.log(`  ${row.file.padEnd(28)} ${row.kb.padStart(7)} KB${row.admin ? '  [admin]' : ''}`);
  }
  return manifest;
}

if (import.meta.main) await buildWeb();
