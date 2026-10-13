import { randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';
import type { Context } from './http.js';

// لبنات الحماية: هيدرات الأمان، منع الطلبات من مواقع ثانية (Origin + توكن CSRF)، حدود الطلبات، IP العميل، فحص المدخلات.

const DEFAULT_SECRET = 'change-this-session-secret';

/** يرفض التشغيل بسر جلسات ناقص أو افتراضي أو قصير (يوقّع كوكي الدخول، ولو انعرف يقدر أي أحد يزوّر دخول أدمن). */
export function assertSessionSecret() {
  if (env.sessionSecret === DEFAULT_SECRET || env.sessionSecret.length < 32) {
    console.error('SESSION_SECRET ناقص أو افتراضي أو أقصر من 32 حرف. حط قيمة عشوائية طويلة في .env (مثال: bun -e "console.log(crypto.randomUUID()+crypto.randomUUID())") وشغّل من جديد.');
    process.exit(1);
  }
}

export const isHttps = () => env.dashboardUrl.startsWith('https://');

export const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob: https:", "font-src 'self' data:",
  "connect-src 'self'", "media-src 'self' https:", "object-src 'none'", "base-uri 'self'", "form-action 'self' https://discord.com", "frame-ancestors 'none'",
].join('; ');

/** هيدرات الأمان على كل رد. */
export function applySecurityHeaders(headers: Headers) {
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  headers.set('X-DNS-Prefetch-Control', 'off');
  headers.set('X-Permitted-Cross-Domain-Policies', 'none');
  headers.set('Content-Security-Policy', CSP);
  if (isHttps()) headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  headers.delete('X-Powered-By');
}

// ---- IP العميل -----------------------------------------------------------------------------------
// خلف بروكسي (Nginx, Cloudflare, لوحة الاستضافة) الـ IP الحقيقي في X-Forwarded-For. نثق فيه فقط لما TRUST_PROXY مضبوط
// (أو الرابط https، لأنه أكيد خلف بروكسي)، ونأخذ العنوان اللي أضافه آخر بروكسي موثوق — ما نقدر ننخدع بقيمة يكتبها العميل.
const trustedHops = (() => {
  const raw = process.env.TRUST_PROXY?.trim();
  if (raw) return /^\d+$/.test(raw) ? Number(raw) : raw === 'true' ? 1 : 0;
  return isHttps() ? 1 : 0;
})();

export function clientIp(req: Request, socketIp: string) {
  if (!trustedHops) return socketIp || 'unknown';
  const chain = (req.headers.get('x-forwarded-for') || '').split(',').map(item => item.trim()).filter(Boolean);
  return chain[Math.max(0, chain.length - trustedHops)] || socketIp || 'unknown';
}

// ---- Origin / CSRF ------------------------------------------------------------------------------
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** الطلبات اللي تغيّر شي لازم تجي من نفس الموقع (Origin أو Referer). */
export function originAllowed(c: Context) {
  if (SAFE_METHODS.has(c.method)) return true;
  let allowed: string;
  try { allowed = new URL(env.dashboardUrl).origin; } catch { return false; }
  const origin = c.req.headers.get('origin');
  let source = origin && origin !== 'null' ? origin : '';
  if (!source) { try { source = new URL(c.req.headers.get('referer') || '').origin; } catch { source = ''; } }
  const local = LOCAL.test(allowed);
  // المتصفح دايماً يرسل Origin أو Referer لنفس الموقع؛ أدوات بدونهم (curl) مسموحة بس على التطوير المحلي.
  if (!source) return local && origin !== 'null';
  return source === allowed || (local && LOCAL.test(source));
}

export function originGuard(c: Context) {
  if (!originAllowed(c)) return c.fail(403, 'تم رفض الطلب لأنه جاي من موقع ثاني.');
}

export function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** كل طلب يغيّر شي لازم يرسل x-csrf-token المطابق لتوكن الجلسة (موجود في <meta name="csrf-token">). */
export function csrfGuard(c: Context) {
  if (SAFE_METHODS.has(c.method)) return;
  const sent = c.req.headers.get('x-csrf-token') || '';
  if (!c.session || !sent || !safeEqual(sent, c.session.csrf)) return c.fail(403, 'انتهت صلاحية الصفحة. حدّث الصفحة وحاول مرة ثانية.');
}

// ---- حدود الطلبات --------------------------------------------------------------------------------
type Hit = { count: number; resetAt: number };
const limiters: Array<Map<string, Hit>> = [];
const MAX_KEYS = 20_000;
setInterval(() => {
  const now = Date.now();
  for (const hits of limiters) for (const [key, hit] of hits) if (hit.resetAt < now) hits.delete(key);
}, 60_000).unref?.();

/** حد طلبات بالذاكرة لكل IP (ولكل مستخدم لو مسجّل). الحجم محدود حتى لو انهجم السيرفر. */
export function rateLimit(name: string, windowMs: number, max: number, message = 'طلبات كثيرة. خفف شوي وحاول بعد لحظات.') {
  const hits = new Map<string, Hit>();
  limiters.push(hits);
  return (c: Context) => {
    const key = `${c.ip}:${c.session?.data.user?.id ?? ''}`;
    const now = Date.now();
    const hit = hits.get(key);
    if (!hit || hit.resetAt < now) {
      if (hits.size >= MAX_KEYS) hits.delete(hits.keys().next().value!);
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }
    hit.count += 1;
    if (hit.count > max) {
      c.headers.set('Retry-After', String(Math.ceil((hit.resetAt - now) / 1000)));
      const wantsJson = c.path.startsWith('/api') || c.path.startsWith('/apply-api') || c.method !== 'GET';
      return wantsJson ? c.fail(429, message) : c.text(message, 429);
    }
  };
}

// ---- OAuth state ---------------------------------------------------------------------------------
export const randomToken = (bytes = 24) => randomBytes(bytes).toString('base64url');

// ---- فحص المدخلات ---------------------------------------------------------------------------------
export const SNOWFLAKE = /^\d{15,22}$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const INT_ID = /^\d{1,18}$/;
export const isSnowflake = (value: unknown): value is string => SNOWFLAKE.test(String(value ?? ''));
export const isUuid = (value: unknown): value is string => UUID.test(String(value ?? ''));
export const isIntId = (value: unknown): value is string => INT_ID.test(String(value ?? ''));

/** يقبل مسار داخلي فقط (يبدأ بـ / ومو //) — ما يصير الدخول تحويل مفتوح لموقع ثاني. */
export function safeLocalPath(value: unknown, fallback = '/dashboard') {
  const text = String(value ?? '');
  if (!/^\/(?![/\\])[\w\-./%?=&]*$/.test(text) || text.includes('..') || text.length > 200) return fallback;
  return text;
}

const HTML_ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, ch => HTML_ESC[ch]!);
const XML_ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
/** XML (RSS, SVG): يهرّب الرموز ويشيل أحرف التحكم اللي تخرب الملف. */
export const escapeXml = (value: unknown) => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"']/g, ch => XML_ESC[ch]!);
