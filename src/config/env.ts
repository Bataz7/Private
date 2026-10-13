import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// قارئ .env بدون مكتبات (Bun يقرأ .env تلقائياً، وهذا للتشغيل كملف تنفيذي أو على txiki.js)
function findRoot() {
  const here = (import.meta as { dir?: string }).dir;
  const script = process.argv[1] && /\.m?js$/.test(process.argv[1]) ? dirname(resolve(process.argv[1])) : '';
  const candidates = [process.cwd(), dirname(process.execPath), here ? resolve(here, '../..') : '', script, script && dirname(script)].filter(Boolean);
  return candidates.find(d => existsSync(join(d, '.env')) || existsSync(join(d, 'package.json'))) ?? process.cwd();
}
export const ROOT = findRoot();
try {
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([\w.]+)\s*=\s*(.*)$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2]!.trim();
    if (/^["'`]/.test(v) && v.indexOf(v[0]!, 1) > 0) v = v.slice(1, v.indexOf(v[0]!, 1));
    else v = v.split(/\s#/)[0]!.trim();
    if (v && !process.env[m[1]!]) process.env[m[1]!] = v;
  }
} catch { /* no .env: the host's environment variables are used */ }

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable: ${name}. Create a .env file from .env.example and fill in the required value.`);
  return value;
}

/** DASHBOARD_URL may be typed as "rift.example.com", "https://rift.example.com/" or with a path: always end up with "https://host" (http only for localhost) and no trailing slash. */
function normalizeUrl(value: string | undefined, fallback: string) {
  let text = (value || '').trim().replace(/\/+$/, '');
  if (!text) return fallback;
  if (!/^https?:\/\//i.test(text)) text = `${/^(localhost|127\.0\.0\.1|\[::1\])(:|$)/i.test(text) ? 'http' : 'https'}://${text}`;
  try { const url = new URL(text); return url.origin; } catch { return fallback; }
}

export const env = {
  token: required('DISCORD_TOKEN'),
  clientId: required('CLIENT_ID'),
  guildId: process.env.GUILD_ID?.trim() || '',
  supabaseUrl: required('SUPABASE_URL'),
  supabaseKey: required('SUPABASE_SECRET_KEY'),
  supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY?.trim() || '',
  supabaseJwksUrl: process.env.SUPABASE_JWKS_URL?.trim() || '',
  discordClientSecret: process.env.DISCORD_CLIENT_SECRET?.trim() || '',
  dashboardUrl: normalizeUrl(process.env.DASHBOARD_URL, 'http://localhost:3000'),
  dashboardPort: Number(process.env.DASHBOARD_PORT || 3000),
  sessionSecret: process.env.SESSION_SECRET?.trim() || 'change-this-session-secret'
};
