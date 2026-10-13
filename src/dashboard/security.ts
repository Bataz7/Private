import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';

// Security building blocks for the dashboard: response headers, cross-site request guard, rate limits, OAuth state.

const DEFAULT_SECRET = 'change-this-session-secret';

/** Refuses to start with a missing, default or short session secret (it signs the login cookie, so a known value lets anyone forge an admin login). */
export function assertSessionSecret() {
  if (env.sessionSecret === DEFAULT_SECRET || env.sessionSecret.length < 32) {
    console.error('SESSION_SECRET is missing, still the default, or shorter than 32 characters. Set a long random value in .env (for example: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))") and start again.');
    process.exit(1);
  }
}

const isHttps = () => env.dashboardUrl.startsWith('https://');

export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.removeHeader('X-Powered-By');
  // Pages use inline scripts and styles, so those stay allowed; everything else is locked to this site (images may come from any https host: Discord CDN, avatars).
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob: https:",
    "font-src 'self' data:", "connect-src 'self'", "media-src 'self' https:", "object-src 'none'", "base-uri 'self'", "form-action 'self' https://discord.com", "frame-ancestors 'none'",
  ].join('; '));
  if (isHttps()) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

/** Blocks state-changing API calls that come from another site (checks Origin / Referer against the dashboard URL). */
export function originGuard(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  let allowed = env.dashboardUrl;
  try { allowed = new URL(env.dashboardUrl).origin; } catch { return res.status(500).json({ error: 'DASHBOARD_URL is not a valid address.' }); }
  const origin = req.headers.origin;
  const source = typeof origin === 'string' && origin ? origin : (() => { try { return new URL(String(req.headers.referer || '')).origin; } catch { return ''; } })();
  // Same-origin browser calls always send Origin or Referer; tools without either (curl) are only allowed on local development.
  const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(allowed);
  if (source ? source === allowed || (local && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(source)) : local) return next();
  res.status(403).json({ error: 'Cross-site request blocked.' });
}

/** Small in-memory rate limiter, per client IP (and per session when there is one). */
export function rateLimit(name: string, windowMs: number, max: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  setInterval(() => { const now = Date.now(); for (const [key, entry] of hits) if (entry.resetAt < now) hits.delete(key); }, Math.max(30_000, windowMs)).unref();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${name}:${req.ip || req.socket.remoteAddress || 'unknown'}:${(req.session as any)?.user?.id ?? ''}`;
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.resetAt < now) { hits.set(key, { count: 1, resetAt: now + windowMs }); return next(); }
    entry.count += 1;
    if (entry.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ error: 'Too many requests. Slow down and try again in a moment.' });
    }
    next();
  };
}

// ---- OAuth state: a random value bound to the browser session, so a login link cannot be forced on someone else. ----
export function newOAuthState(req: Request) {
  const state = randomBytes(24).toString('base64url');
  (req.session as any).oauthState = state;
  return state;
}
export function checkOAuthState(req: Request, received: unknown) {
  const expected = (req.session as any)?.oauthState as string | undefined;
  delete (req.session as any).oauthState;
  if (!expected || typeof received !== 'string' || received.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

/** Escapes text for the few places that build HTML on the server. */
export const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
