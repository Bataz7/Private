import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { c, status } from '../utils/terminal.js';

// Where the browser files come from. The dashboard serves ONLY web-dist/: minified, hashed, no source maps, and the readable
// sources in src/dashboard/public are not reachable. The build runs by itself when it is missing or older than the sources.
// WEB_SOURCE=on serves the readable sources instead (local development only).
const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const built = `${projectRoot}web-dist`;
const source = fileURLToPath(new URL('./public', import.meta.url));

function newestChange(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    newest = Math.max(newest, entry.isDirectory() ? newestChange(path) : statSync(path).mtimeMs);
  }
  return newest;
}

function ensureBuilt() {
  const manifest = `${built}/manifest.json`;
  const inputs = Math.max(newestChange(source), statSync(`${projectRoot}scripts/build-web.mjs`).mtimeMs, statSync(fileURLToPath(new URL('./server.ts', import.meta.url))).mtimeMs);
  if (existsSync(manifest) && statSync(manifest).mtimeMs >= inputs) return;
  try {
    execFileSync(process.execPath, [`${projectRoot}scripts/build-web.mjs`], { cwd: projectRoot, stdio: 'pipe' });
    console.log(`  ${status('ok', 'Front end', 'built into web-dist (minified, hashed, no source maps)')}`);
  } catch (error) {
    console.error(`  ${status('fail', 'Front end', `${c.red}build failed: ${String((error as any)?.stderr || error).slice(0, 300)}${c.reset}`)}`);
  }
}

const developmentSource = process.env.WEB_SOURCE === 'on';
if (!developmentSource) ensureBuilt();
export const useBuiltWeb = !developmentSource && existsSync(`${built}/manifest.json`);
export const webRoot = useBuiltWeb ? built : source;
export const webFile = (name: string) => `${webRoot}/${name}`;
if (!useBuiltWeb) console.warn(`  ${status('warn', 'Front end', 'serving the READABLE sources (WEB_SOURCE=on or the build failed). Do not use this in production.')}`);

/** Files (by URL) that only administrators may download, and the admin stylesheet. */
export const webManifest = (() => {
  try {
    const data = JSON.parse(readFileSync(`${built}/manifest.json`, 'utf8')) as { adminFiles?: string[]; adminCss?: string };
    return { adminFiles: new Set(data.adminFiles ?? []), adminCss: data.adminCss ?? '' };
  } catch { return { adminFiles: new Set<string>(), adminCss: '' }; }
})();
