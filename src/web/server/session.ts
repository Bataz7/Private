import { createHmac } from 'node:crypto';
import { env } from '../../config/env.js';
import type { Context, Session } from './http.js';
import { isHttps, randomToken, safeEqual } from './security.js';

// جلسات بالسيرفر: الكوكي (rift_sid) فيه رقم عشوائي موقّع بس، والبيانات في الذاكرة (Map محدودة الحجم).
// HttpOnly + SameSite=Lax (+ Secure على https). مهلة خمول ومهلة مطلقة، ورقم جديد عند تسجيل الدخول (منع تثبيت الجلسة).
// الجلسات بالذاكرة فقط: إعادة تشغيل اللوحة تطلب تسجيل دخول جديد (ما فيه أسرار تنحفظ على القرص أو في قاعدة البيانات).

export const SESSION_COOKIE = 'rift_sid';
const IDLE_MS = Number(process.env.SESSION_IDLE_MINUTES || 240) * 60_000;
const ABSOLUTE_MS = Number(process.env.SESSION_MAX_HOURS || 12) * 3_600_000;
const MAX_SESSIONS = Number(process.env.SESSION_MAX || 5000);

const sessions = new Map<string, Session>();

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) if (expired(session, now)) sessions.delete(id);
}, 5 * 60_000).unref?.();

const expired = (session: Session, now = Date.now()) => now - session.lastSeen > IDLE_MS || now - session.createdAt > ABSOLUTE_MS;
const sign = (id: string) => createHmac('sha256', env.sessionSecret).update(`sid:${id}`).digest('base64url');

function cookieOptions(maxAgeMs: number) {
  return { httpOnly: true, sameSite: 'Lax' as const, secure: isHttps(), path: '/', maxAge: maxAgeMs / 1000 };
}

function store(session: Session) {
  if (sessions.size >= MAX_SESSIONS) {
    // الأقدم استخداماً يطلع أول (الـ Map مرتّب حسب آخر لمسة). الجلسات المسجّلة لها أولوية على الزوار.
    let victim: string | undefined;
    for (const [id, item] of sessions) { if (!item.data.user) { victim = id; break; } }
    sessions.delete(victim ?? sessions.keys().next().value!);
  }
  sessions.set(session.id, session);
}

/** يقرأ الجلسة من الكوكي (لو صالحة) ويحطها في c.session. */
export function loadSession(c: Context): Session | null {
  const raw = c.cookies.get(SESSION_COOKIE);
  if (!raw) return null;
  const dot = raw.lastIndexOf('.');
  const id = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);
  if (dot < 1 || !safeEqual(signature, sign(id))) return null;
  const session = sessions.get(id);
  if (!session) return null;
  const now = Date.now();
  if (expired(session, now)) { sessions.delete(id); return null; }
  session.lastSeen = now;
  sessions.delete(id); sessions.set(id, session); // آخر استخدام = آخر الترتيب
  c.session = session;
  return session;
}

/** الجلسة الحالية أو جديدة (للزوار: حالة OAuth، المتقدّم على نموذج التقديم). */
export function ensureSession(c: Context): Session {
  if (c.session) return c.session;
  const now = Date.now();
  const session: Session = { id: randomToken(32), csrf: randomToken(32), createdAt: now, lastSeen: now, data: {} };
  store(session);
  c.session = session;
  c.setCookie(SESSION_COOKIE, `${session.id}.${sign(session.id)}`, cookieOptions(ABSOLUTE_MS));
  return session;
}

/** رقم جلسة جديد + توكن CSRF جديد مع نقل البيانات (يُستدعى عند تسجيل الدخول). */
export function rotateSession(c: Context): Session {
  const old = c.session;
  if (old) sessions.delete(old.id);
  c.session = null;
  const session = ensureSession(c);
  if (old) session.data = { ...old.data };
  return session;
}

export function destroySession(c: Context) {
  if (c.session) sessions.delete(c.session.id);
  c.session = null;
  c.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'Lax', secure: isHttps(), path: '/' });
}

/** يمسح كل جلسات مستخدم (مثلاً لما تنشال رتبته). */
export function destroyUserSessions(userId: string) {
  for (const [id, session] of sessions) if (session.data.user?.id === userId) sessions.delete(id);
}

export const sessionCount = () => sessions.size;

/** للاختبارات فقط: جلسة جاهزة بدون OAuth. غير متاحة إلا مع NODE_ENV=test. */
export function createTestSession(data: Record<string, any>): { cookie: string; csrf: string; session: Session } {
  if (process.env.NODE_ENV !== 'test') throw new Error('createTestSession is only available in tests.');
  const now = Date.now();
  const session: Session = { id: randomToken(32), csrf: randomToken(32), createdAt: now, lastSeen: now, data };
  store(session);
  return { cookie: `${SESSION_COOKIE}=${session.id}.${sign(session.id)}`, csrf: session.csrf, session };
}
