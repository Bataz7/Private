import { renderDocument } from '#jsx/jsx-runtime';
import { env } from '../config/env.js';
import { currentManifest } from '../web/server/assets.js';
import type { Context } from '../web/server/http.js';
import type { Router } from '../web/server/router.js';
import { destroySession } from '../web/server/session.js';
import { LoginPage, renderShell, Shell } from '../web/server/shells.js';
import type { DashboardContext } from './context.js';

// صفحات HTML: الدخول (كاملة من السيرفر)، اللوحة والبروفايل (للستاف فقط)، وأيقونة الموقع.

const NO_STORE = 'no-store';
const FAVICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect x="4" y="4" width="40" height="40" rx="12" fill="#7b6cf6"/><path d="M17 34V14h9.5a6 6 0 0 1 1.6 11.8L33 34h-5.2l-4.4-7.6H21.6V34z M21.6 22.6h4.6a2.3 2.3 0 0 0 0-4.6h-4.6z" fill="#fff"/></svg>';
const LOGIN_CODES = /^[a-z_]{1,24}$/;

export function mountPages(router: Router, ctx: DashboardContext & { checkStaff: (c: Context) => Promise<Response | void> }) {
  const pages = router.scope('pages', []);

  /** صفحة للستاف فقط: نفس فحص /api، ولو مرفوض يرجع لصفحة الدخول. */
  async function staffPage(c: Context): Promise<boolean> {
    if (!ctx.sessionUser(c)) { c.redirect('/login'); return false; }
    const refused = await ctx.checkStaff(c);
    if (refused) {
      destroySession(c);
      c.res = null;
      c.redirect('/login?error=forbidden');
      return false;
    }
    return true;
  }

  function appBoot(c: Context, extra: Record<string, unknown> = {}) {
    const user = ctx.sessionUser(c)!;
    return {
      user: { id: user.id, username: user.username, avatar: user.avatar, isOwner: user.isOwner, isAdministrator: user.isAdministrator, isManagement: user.isManagement, isStaff: user.isStaff },
      guilds: user.guilds, guildId: c.session?.data.guildId ?? null, admin: user.isManagement, version: currentManifest().version, ...extra,
    };
  }

  pages.get('/', (c: Context) => c.redirect(ctx.sessionUser(c) ? '/dashboard' : '/login'));

  pages.get(['/login', '/login/'], (c: Context) => {
    if (ctx.sessionUser(c)) return c.redirect('/dashboard');
    const error = LOGIN_CODES.test(c.q('error')) ? c.q('error') : '';
    c.headers.set('Cache-Control', NO_STORE);
    return c.html(renderDocument(
      <Shell title="تسجيل الدخول · Rift" entry="login" description="لوحة تحكم Rift لإدارة الستاف." bodyClass="page-login">
        <LoginPage error={error} configured={Boolean(env.discordClientSecret)} />
      </Shell>,
    ));
  });

  pages.get(['/dashboard', '/dashboard/:page'], async (c: Context) => {
    if (c.params.page !== undefined && !/^[\w-]{1,40}$/.test(c.params.page)) return c.text('', 404);
    if (!await staffPage(c)) return;
    c.headers.set('Cache-Control', NO_STORE);
    const user = ctx.sessionUser(c)!;
    return c.html(renderShell({ title: 'لوحة التحكم · Rift', entry: 'app', csrf: c.session!.csrf, admin: user.isManagement, boot: appBoot(c, { page: c.params.page ?? 'overview' }) }));
  });

  pages.get('/p', (c: Context) => c.redirect('/p/me'));
  pages.get('/p/:name', async (c: Context) => {
    if (!/^@?[\w.-]{1,40}$/.test(c.params.name ?? '')) return c.text('', 404);
    if (!await staffPage(c)) return;
    c.headers.set('Cache-Control', NO_STORE);
    const user = ctx.sessionUser(c)!;
    return c.html(renderShell({ title: 'البروفايل · Rift', entry: 'profile', csrf: c.session!.csrf, admin: user.isManagement, boot: appBoot(c, { identifier: c.params.name }) }));
  });

  pages.get(['/favicon.ico', '/favicon.svg'], (c: Context) => c.text(FAVICON, 200, 'image/svg+xml', { 'cache-control': 'public, max-age=86400' }));
  pages.get('/robots.txt', (c: Context) => c.text('User-agent: *\nAllow: /status\nDisallow: /\n'));
}
