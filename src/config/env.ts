import 'dotenv/config';

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
