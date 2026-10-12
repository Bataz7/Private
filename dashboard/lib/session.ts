/**
 * جلسات موقّعة داخل كوكي (HMAC-SHA256) — بدون تخزين على السيرفر.
 * الشكل: base64url(JSON) "." base64url(HMAC)  ·  الحمولة فيها exp (انتهاء الصلاحية بالثواني).
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface SessionUser {
  id: string;
  name: string;
  global_name: string;
  avatar: string;
}

export interface SessionData {
  user?: SessionUser;
  /** السيرفرات اللي يقدر يديرها المستخدم (آيديات نصية). */
  guilds?: string[];
  /** حالة OAuth المؤقتة. */
  oauth_state?: string;
  /** رمز حماية CSRF لطلبات POST. */
  csrf?: string;
  exp?: number;
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

function mac(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

/** يوقّع بيانات الجلسة ويرجع قيمة الكوكي. */
export function signSession(data: SessionData, secret: string, maxAgeSec: number, now = Date.now()): string {
  const body = b64(JSON.stringify({ ...data, exp: Math.floor(now / 1000) + maxAgeSec }));
  return `${body}.${mac(secret, body)}`;
}

/** يتحقق من التوقيع والصلاحية؛ يرجع null لو الكوكي معدّل أو منتهي. */
export function verifySession(value: string | undefined, secret: string, now = Date.now()): SessionData | null {
  if (!value || value.length > 8192) return null;
  const i = value.lastIndexOf(".");
  if (i <= 0) return null;
  const body = value.slice(0, i);
  const sig = Buffer.from(value.slice(i + 1));
  const want = Buffer.from(mac(secret, body));
  if (sig.length !== want.length || !timingSafeEqual(sig, want)) return null;
  try {
    const d = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionData;
    if (!d || typeof d !== "object" || typeof d.exp !== "number" || d.exp * 1000 < now) return null;
    return d;
  } catch {
    return null;
  }
}

export const token = (bytes = 24) => randomBytes(bytes).toString("base64url");

/** مقارنة ثابتة الزمن لنصين. */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/* ---------- الكوكيز ---------- */
export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k || k in out) continue;
    let v = part.slice(i + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export function serializeCookie(name: string, value: string, o: { maxAge?: number; secure?: boolean; httpOnly?: boolean } = {}): string {
  let s = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax`;
  if (o.maxAge !== undefined) s += `; Max-Age=${o.maxAge}`;
  if (o.httpOnly !== false) s += "; HttpOnly";
  if (o.secure) s += "; Secure";
  return s;
}
