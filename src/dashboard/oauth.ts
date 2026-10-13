import { API_BASE } from '../lib/discord/constants.js';
import { env } from '../config/env.js';

// OAuth2 مع ديسكورد: رابط التفويض، تبديل الكود بتوكن، وقراءة بيانات المستخدم. مهلة 10 ثواني لكل طلب.

export async function discordJson<T>(path: string, token: string): Promise<T | null> {
  const response = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!response?.ok) return null;
  return response.json().catch(() => null) as Promise<T | null>;
}

export async function exchangeCode(code: string): Promise<{ access_token?: string; error?: string; error_description?: string } | null> {
  const response = await fetch(`${API_BASE}/oauth2/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(10_000),
    body: new URLSearchParams({ client_id: env.clientId, client_secret: env.discordClientSecret, grant_type: 'authorization_code', code, redirect_uri: `${env.dashboardUrl}/auth/callback` }),
  }).catch(() => null);
  if (!response) return null;
  const token = await response.json().catch(() => ({})) as { access_token?: string; error?: string; error_description?: string };
  return response.ok ? token : { error: token.error || String(response.status), error_description: token.error_description };
}

export function authorizeUrl(scope: string, state: string) {
  const params = new URLSearchParams({ client_id: env.clientId, redirect_uri: `${env.dashboardUrl}/auth/callback`, response_type: 'code', scope, prompt: 'consent', state });
  return `https://discord.com/oauth2/authorize?${params}`;
}
