// Builds the dashboard front end into web-dist/. The readable sources in src/dashboard/public are NEVER served once this exists.
//  - every script is bundled, minified and renamed to a hash: no readable file names, function names or comments, no source maps
//  - stylesheets become a few minified, hashed files
//  - files behind the login live in /a/d/ and are only sent to signed-in staff; code that only ADMINISTRATOR pages use is listed
//    in manifest.adminFiles and is only sent to administrators
//  - public pages (login, status, apply form) live in /a/p/ and contain nothing of the dashboard
// Run: npm run build:web   (start:all and the dashboard run it for you when the sources changed)
import { build, transform } from 'esbuild';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const src = join(root, 'src/dashboard/public');
const out = join(root, 'web-dist');
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'a', 'd'), { recursive: true });
mkdirSync(join(out, 'a', 'p'), { recursive: true });

// Pages that only administrators can open (matches the admin-only menu items). Their code is only sent to administrators.
const ADMIN_PAGES = new Set(['studio', 'modreports', 'applications', 'audit', 'health', 'statusposts', 'status', 'setup']);
const ADMIN_CSS = new Set(['discord-preview', 'studio', 'modreports', 'applications']);

const hash = text => createHash('sha256').update(text).digest('hex').slice(0, 12);
const map = { staff: new Map(), pub: new Map() }; // "/js/app.js" -> "/a/d/<hash>.js"
const adminFiles = new Set();
const norm = path => path.replace(/\\/g, '/');

// ---- scripts ----
async function bundle(group, dir, entries, into) {
  const result = await build({
    absWorkingDir: root,
    entryPoints: entries.map(name => join(src, 'js', name)), outdir: join(out, 'a', dir), bundle: true, splitting: true, format: 'esm', target: 'es2022',
    minify: true, legalComments: 'none', sourcemap: false, entryNames: '[hash]', chunkNames: '[hash]', drop: ['debugger'], metafile: true, logLevel: 'warning',
  });
  for (const [file, info] of Object.entries(result.metafile.outputs)) {
    if (info.entryPoint) into.set(`/js/${basename(info.entryPoint)}`, `/${norm(file).replace(/^.*?web-dist\//, '')}`);
  }
  return result.metafile;
}

const staffMeta = await bundle('staff', 'd', ['app.js', 'profile-page.js'], map.staff);
await bundle('public', 'p', ['status-page.js', 'apply-page.js'], map.pub);

// Which output files are used ONLY by administrator pages? Everything reachable from the shared shell and the non-admin pages is common.
{
  const inputs = staffMeta.inputs;
  const key = path => norm(path);
  const appKey = Object.keys(inputs).find(path => key(path).endsWith('/js/app.js'));
  const roots = [];
  for (const imp of inputs[appKey].imports) {
    const target = key(imp.path);
    if (imp.kind === 'import-statement') roots.push(target);
    else if (imp.kind === 'dynamic-import') {
      const name = basename(target, '.js');
      if (!ADMIN_PAGES.has(name)) roots.push(target);
    }
  }
  roots.push(appKey);
  const common = new Set();
  const visit = path => {
    if (common.has(path) || !inputs[path]) return;
    common.add(path);
    // The shell lazily loads every page; admin pages are handled by the roots above, so its dynamic imports are not followed here.
    for (const imp of inputs[path].imports) if (!(path === appKey && imp.kind === 'dynamic-import')) visit(key(imp.path));
  };
  for (const path of roots) visit(key(path));
  const profileKey = Object.keys(inputs).find(path => key(path).endsWith('/js/profile-page.js'));
  if (profileKey) visit(key(profileKey));
  for (const [file, info] of Object.entries(staffMeta.outputs)) {
    // Lazily loaded pages are reported as entry points too; only the two real page shells are always common.
    if (info.entryPoint && /(app|profile-page)\.js$/.test(info.entryPoint)) continue;
    const used = Object.keys(info.inputs).filter(path => !path.includes('node_modules'));
    if (used.length && used.every(path => !common.has(key(path)))) adminFiles.add(`/${norm(file).replace(/^.*?web-dist\//, '')}`);
  }
}

// ---- stylesheets ----
const server = readFileSync(join(root, 'src/dashboard/server.ts'), 'utf8');
const baseCss = [...(/const styles = \[([^\]]*)\]/.exec(server)?.[1] ?? '').matchAll(/'([\w-]+)'/g)].map(m => m[1]);
const extensionCss = [];
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => (entry.isDirectory() ? (entry.name === 'public' ? [] : walk(join(dir, entry.name))) : entry.name.endsWith('.ts') ? [join(dir, entry.name)] : []));
for (const file of walk(join(root, 'src'))) for (const match of readFileSync(file, 'utf8').matchAll(/^\s*styles:\s*\[([^\]]*)\]/gm)) for (const name of match[1].matchAll(/'([\w-]+)'/g)) if (!extensionCss.includes(name[1])) extensionCss.push(name[1]);

async function css(files, dir, urlPath, isAdmin = false) {
  const existing = files.filter(name => existsSync(join(src, `${name}.css`)));
  const source = existing.map(name => readFileSync(join(src, `${name}.css`), 'utf8')).join('\n');
  const { code } = await transform(source, { loader: 'css', minify: true, legalComments: 'none' });
  const file = `${hash(code)}.css`;
  writeFileSync(join(out, 'a', dir, file), code);
  const url = `/a/${dir}/${file}`;
  if (urlPath) (dir === 'p' ? map.pub : map.staff).set(urlPath, url);
  if (isAdmin) adminFiles.add(url);
  return url;
}
const staffExtension = extensionCss.filter(name => !ADMIN_CSS.has(name));
await css([...baseCss], 'p', '/app.css');                                   // public pages: the base look only
map.staff.set('/app.css', await css([...baseCss, ...staffExtension], 'd'));  // signed-in staff
const adminCss = await css([...ADMIN_CSS].filter(name => extensionCss.includes(name)), 'd', null, true);
for (const extra of ['login-rift', 'statuspage', 'apply']) if (existsSync(join(src, `${extra}.css`))) await css([extra], 'p', `/${extra}.css`);

// ---- static assets (images, fonts) ----
for (const file of readdirSync(src)) if (/\.(svg|png|jpg|jpeg|webp|ico|gif)$/i.test(file)) cpSync(join(src, file), join(out, file));
if (existsSync(join(src, 'fonts'))) cpSync(join(src, 'fonts'), join(out, 'fonts'), { recursive: true });

// ---- pages ----
const PUBLIC_PAGES = new Set(['login.html', 'status.html', 'apply.html']);
for (const file of readdirSync(src).filter(name => name.endsWith('.html'))) {
  const urls = PUBLIC_PAGES.has(file) ? map.pub : map.staff;
  let html = readFileSync(join(src, file), 'utf8');
  html = html.replace(/<link rel="modulepreload"[^>]*>\s*/g, '');
  html = html.replace(/<script>[^<]*\/js\/pages\/[^<]*<\/script>\s*/g, ''); // the inline page preloader points at source files
  for (const [from, to] of urls) html = html.split(`"${from}"`).join(`"${to}"`);
  if (/(src|href)="\/js\//.test(html)) throw new Error(`${file} still points at a source script`);
  if (/(src|href)="\/(app|login-rift|statuspage|apply)\.css"/.test(html)) throw new Error(`${file} still points at a source stylesheet`);
  writeFileSync(join(out, file), html);
}
writeFileSync(join(out, 'manifest.json'), JSON.stringify({ builtAt: new Date().toISOString(), adminFiles: [...adminFiles], adminCss, files: Object.fromEntries([...map.staff, ...map.pub]) }, null, 1));
console.log(`Front end built into web-dist/ (${map.staff.size + map.pub.size} entries, ${adminFiles.size} admin-only files, no source maps).`);
