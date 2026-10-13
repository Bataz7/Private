import type { Client } from '../lib/djs/index.js';
import { serveAsset } from '../web/server/assets.js';
import { Context, HttpError } from '../web/server/http.js';
import { Router } from '../web/server/router.js';
import { applySecurityHeaders, clientIp, csrfGuard, originGuard, rateLimit } from '../web/server/security.js';
import { loadSession } from '../web/server/session.js';
import { isExpected, publicMessage, statusFor } from '../web/server/errors.js';
import { createContext } from './context.js';
import { mountAuth } from './auth.js';
import { mountPages } from './pages.js';
import { mountStaffRoutes } from './staff-routes.js';
import { mountStaffOverview } from './staff-overview.js';
import { dashboard as extensions } from './extensions.js';

// يركّب اللوحة: الراوتر، الحراس، الملفات الثابتة، الأخطاء الموحّدة، وهيدرات الأمان على كل رد.

/** مسارات /api العامة الوحيدة (بدون دخول). أي مسار /api ثاني بدون حارس الستاف يوقف التشغيل. */
export const PUBLIC_API = new Set(['GET /api/me', 'GET /api/status', 'GET /api/status/metrics']);

export function createDashboard(discord: Client) {
  const ctx = createContext(discord);
  const router = new Router('root');

  mountAuth(router, ctx);
  mountPages(router, ctx);

  // عامة: صفحة الحالة، نموذج التقديم. كل وحدة تحط حد الطلبات حقها.
  const publicScope = router.scope('public', []);
  for (const extension of extensions) extension.mountPublic?.(ctx, publicScope);

  // /api للستاف: Origin + CSRF + حد طلبات + مستخدم مسجّل عنده رتبة الستاف في السيرفر المختار (الحين).
  const api = router.scope('staff', [originGuard, rateLimit('api', 60_000, 600), ctx.checkStaff, csrfGuard]);
  for (const extension of extensions) extension.mountApi?.(ctx, api);
  mountStaffRoutes(api, ctx);
  mountStaffOverview(api, ctx);

  assertProtected(router);

  async function access(c: Context) {
    const user = ctx.sessionUser(c);
    if (!user || !c.session) return { staff: false, admin: false };
    const refused = await ctx.checkStaff(c);
    c.res = null;
    if (refused) return { staff: false, admin: false };
    return { staff: true, admin: Boolean(ctx.sessionUser(c)?.isManagement) };
  }

  async function handle(c: Context): Promise<Response> {
    try {
      const asset = await serveAsset(c, () => access(c));
      if (asset) return asset;
      const response = await router.dispatch(c);
      if (response) return response;
      if (c.path.startsWith('/api/') || c.path.startsWith('/apply-api/')) {
        // ما نكشف المسارات الموجودة لغير المسجّلين.
        return ctx.sessionUser(c) ? c.fail(404, 'المسار مو موجود.') : c.fail(401, 'سجّل دخولك أول.');
      }
      return c.html('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>غير موجود</title><p>الصفحة مو موجودة. <a href="/">الرئيسية</a></p></html>', 404);
    } catch (error) {
      c.res = null;
      if (error instanceof HttpError) return c.fail(error.status, error.message, error.extra);
      if (isExpected(error)) return c.fail(statusFor(error), publicMessage(error));
      console.error(`[dashboard] ${c.method} ${c.path}:`, error instanceof Error ? error.stack || error.message : error);
      return c.fail(500, 'صار خطأ في السيرفر. حاول مرة ثانية بعد لحظات.');
    }
  }

  async function fetch(req: Request, server?: { requestIP(req: Request): { address: string } | null }) {
    const c = new Context(req, clientIp(req, server?.requestIP(req)?.address ?? ''));
    loadSession(c);
    const response = await handle(c);
    return finalize(c, response);
  }

  return { fetch, router, ctx };
}

function finalize(c: Context, response: Response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of c.headers) {
    if (name === 'set-cookie') headers.append(name, value);
    else headers.set(name, value);
  }
  applySecurityHeaders(headers);
  const isApi = c.path.startsWith('/api/') || c.path.startsWith('/apply-api/') || c.path.startsWith('/auth/');
  if (!headers.has('cache-control') && (isApi || (headers.get('content-type') || '').startsWith('text/html'))) headers.set('cache-control', 'no-store');
  return new Response(c.method === 'HEAD' ? null : response.body, { status: response.status, statusText: response.statusText, headers });
}

function assertProtected(router: Router) {
  for (const route of router.table()) {
    if (!route.path.startsWith('/api/')) continue;
    const key = `${route.method} ${route.path}`;
    if (route.scope !== 'staff' && !PUBLIC_API.has(key)) throw new Error(`Unprotected API route: ${key} (scope ${route.scope})`);
  }
}
