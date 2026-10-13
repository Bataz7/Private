// ⚠️ TEMPORARY STUB written by the dashboard-server agent — the client agent owns this file and will REPLACE it.
// It only fixes the contract the server codes against: buildWeb() writes web-dist/manifest.json and returns it.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type WebEntry = 'app' | 'login' | 'status' | 'apply' | 'profile';
export type WebManifest = { entries: Record<WebEntry, { js: string; css: string[] }>; adminFiles: string[]; version: string };

export async function buildWeb(opts: { quiet?: boolean } = {}): Promise<WebManifest> {
  const out = fileURLToPath(new URL('../../web-dist/', import.meta.url));
  mkdirSync(out, { recursive: true });
  const empty = { js: '', css: [] as string[] };
  const manifest: WebManifest = { entries: { app: empty, login: empty, status: empty, apply: empty, profile: empty }, adminFiles: [], version: 'stub' };
  writeFileSync(`${out}manifest.json`, JSON.stringify(manifest));
  if (!opts.quiet) console.warn('[web] build stub: no client bundles yet.');
  return manifest;
}
