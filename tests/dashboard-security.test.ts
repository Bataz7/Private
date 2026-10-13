import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db, handleSupabase } from '../scripts/mock-supabase.ts';

// Integration tests for the dashboard server: a tiny in-process Discord REST mock + the PostgREST mock, then the real
// router (createDashboard) driven through its fetch handler.
// The modules read their configuration (DISCORD_API_BASE, SUPABASE_URL, SESSION_SECRET…) once at import, so the suite always
// runs in its own Bun process: in a shared `bun test` run this file spawns itself with RIFT_ISOLATED=1.

if (!process.env.RIFT_ISOLATED) {
  test('dashboard security suite (isolated process)', async () => {
    const child = Bun.spawn([process.execPath, 'test', import.meta.path], { env: { ...process.env, RIFT_ISOLATED: '1' }, stdout: 'pipe', stderr: 'pipe' });
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code !== 0) console.error(out, err);
    expect(code).toBe(0);
    expect(err).toMatch(/\b25 pass\b/);
  }, 120_000);
} else registerSuite();

function registerSuite() {

  const GUILD = '1300000000000000001';
  const STAFF_ROLE = '1300000000000000101';
  const ADMIN_ROLE = '1300000000000000102';
  const OWNER = '1300000000000000201';
  const ADMIN = '1300000000000000202';
  const STAFF = '1300000000000000203';
  const OUTSIDER = '1300000000000000204';
  const BOT = '1200000000000000001';
  const CHANNEL = '1300000000000000301';

  const roles = [
    { id: GUILD, name: '@everyone', position: 0, permissions: '0', color: 0, managed: false },
    { id: STAFF_ROLE, name: 'Staff', position: 1, permissions: '0', color: 0, managed: false },
    { id: ADMIN_ROLE, name: 'Admin', position: 2, permissions: '8', color: 0, managed: false },
    { id: '1300000000000000199', name: 'Bot', position: 3, permissions: '268435456', color: 0, managed: true },
  ];
  const members: Record<string, string[]> = { [OWNER]: [STAFF_ROLE], [ADMIN]: [STAFF_ROLE, ADMIN_ROLE], [STAFF]: [STAFF_ROLE], [OUTSIDER]: [], [BOT]: ['1300000000000000199'] };
  const user = (id: string) => ({ id, username: `user${id.slice(-3)}`, global_name: null, avatar: null, discriminator: '0', bot: id === BOT });
  const member = (id: string) => ({ user: user(id), roles: members[id], nick: null, joined_at: new Date().toISOString() });

  let mock: ReturnType<typeof Bun.serve>;
  let fetchApp: (req: Request) => Promise<Response>;
  let createTestSession: (data: Record<string, any>) => { cookie: string; csrf: string };
  let base = '';
  const ORIGIN = 'http://localhost:3999';

  function discordMock(req: Request, url: URL): Response {
    const path = url.pathname.replace(/^\/api\/v10/, '');
    const method = req.method;
    if (method === 'GET' && path === '/applications/@me') return Response.json({ id: BOT, name: 'Rift' });
    if (method === 'GET' && path === '/users/@me') return Response.json(user(BOT));
    if (method === 'GET' && path === '/users/@me/guilds') return Response.json([{ id: GUILD, name: 'Test' }]);
    if (method === 'GET' && path === `/guilds/${GUILD}`) return Response.json({ id: GUILD, name: 'سيرفر', icon: null, owner_id: OWNER, roles, approximate_member_count: 5 });
    if (method === 'GET' && path === `/guilds/${GUILD}/channels`) return Response.json([{ id: CHANNEL, name: 'general', type: 0, guild_id: GUILD, position: 0 }]);
    if (method === 'GET' && path === `/guilds/${GUILD}/roles`) return Response.json(roles);
    const one = new RegExp(`^/guilds/${GUILD}/members/(\\d+)$`).exec(path);
    if (method === 'GET' && one) return members[one[1]!] ? Response.json(member(one[1]!)) : Response.json({ message: 'Unknown Member', code: 10007 }, { status: 404 });
    if (method === 'GET' && path === `/guilds/${GUILD}/members`) return Response.json(Number(url.searchParams.get('after') || 0) > 0 ? [] : Object.keys(members).map(member));
    if (method === 'GET' && path.startsWith('/users/')) return Response.json(user(path.split('/')[2]!));
    if (method === 'POST' && path === '/users/@me/channels') return Response.json({ id: '1300000000000000999', type: 1 });
    if (method === 'POST' && /\/channels\/\d+\/messages$/.test(path)) return Response.json({ id: '1300000000000000998', channel_id: path.split('/')[2] });
    if (method === 'GET') return Response.json([]);
    return new Response(null, { status: 204 });
  }

  beforeAll(async () => {
    mock = Bun.serve({
      port: 0, hostname: '127.0.0.1',
      async fetch(req) {
        const url = new URL(req.url);
        return (await handleSupabase(req, url)) ?? discordMock(req, url);
      },
    });
    base = `http://127.0.0.1:${mock.port}`;
    const dist = join(tmpdir(), `rift-web-dist-${process.pid}`);
    mkdirSync(join(dist, 'a', 'd'), { recursive: true });
    mkdirSync(join(dist, 'a', 'p'), { recursive: true });
    writeFileSync(join(dist, 'a', 'd', 'app-abcdef12.js'), 'export {};');
    writeFileSync(join(dist, 'a', 'd', 'admin-abcdef12.js'), 'export {};');
    writeFileSync(join(dist, 'a', 'p', 'status-abcdef12.js'), 'export {};');
    writeFileSync(join(dist, 'manifest.json'), JSON.stringify({
      entries: { app: { js: '/a/d/app-abcdef12.js', css: [] }, login: { js: '', css: [] }, status: { js: '/a/p/status-abcdef12.js', css: [] }, apply: { js: '', css: [] }, profile: { js: '/a/d/app-abcdef12.js', css: [] } },
      adminFiles: ['/a/d/admin-abcdef12.js'], version: 'test',
    }));
    Object.assign(process.env, {
      DISCORD_API_BASE: `${base}/api/v10`, SUPABASE_URL: base, SUPABASE_SECRET_KEY: 'k', DISCORD_TOKEN: 'x.y.z', CLIENT_ID: BOT, DISCORD_CLIENT_SECRET: 's',
      DASHBOARD_URL: ORIGIN, SESSION_SECRET: 'a'.repeat(48), GUILD_ID: GUILD, STATUS_MONITOR: 'off', WEB_BUILD: 'off', WEB_DIST_DIR: dist,
    });
    db.seed('guild_settings', [{ guild_id: GUILD, staff_role_id: STAFF_ROLE, on_shift_role_id: null, leave_role_id: null, logs_channel_id: null, bot_language: 'ar' }]);

    const { Client } = await import('../src/lib/djs/index.ts');
    const { createDashboard } = await import('../src/dashboard/app.ts');
    const { loadWebManifest } = await import('../src/web/server/assets.ts');
    ({ createTestSession } = await import('../src/web/server/session.ts'));
    const discord = new Client({ intents: [], restOnly: true });
    await discord.login('x.y.z');
    await loadWebManifest({ build: false });
    const dashboard = createDashboard(discord);
    fetchApp = req => dashboard.fetch(req);
  });

  afterAll(() => { mock?.stop(true); });

  const sessionFor = (userId: string, admin = false) => createTestSession({
    user: { id: userId, username: `user${userId.slice(-3)}`, avatar: null, isOwner: false, isAdministrator: admin, isManagement: admin, isStaff: true, guilds: [{ id: GUILD, name: 'سيرفر', icon: null, owner: false }] },
    guildId: GUILD,
  });

  function call(path: string, init: RequestInit & { session?: { cookie: string; csrf: string }; csrf?: boolean; origin?: string | null } = {}) {
    const headers = new Headers(init.headers);
    if (init.session) headers.set('cookie', init.session.cookie);
    if (init.session && init.csrf !== false && init.method && init.method !== 'GET') headers.set('x-csrf-token', init.session.csrf);
    if (init.origin !== null && init.method && init.method !== 'GET') headers.set('origin', init.origin ?? ORIGIN);
    if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
    return fetchApp(new Request(`${ORIGIN}${path}`, { ...init, headers }));
  }

  describe('authentication', () => {
    test('unauthenticated /api routes answer 401 in Arabic', async () => {
      for (const path of ['/api/staff', '/api/bootstrap', '/api/points', '/api/leaves', '/api/studio', '/api/does-not-exist']) {
        const res = await call(path);
        expect(res.status).toBe(401);
        const body = await res.json() as { error: string };
        expect(body.error).toMatch(/[؀-ۿ]/);
      }
    });

    test('/api/me is public and returns no user', async () => {
      const res = await call('/api/me');
      expect(res.status).toBe(200);
      expect((await res.json() as any).user).toBeNull();
    });

    test('/auth/discord redirects to Discord with a state bound to a new session cookie', async () => {
      const res = await call('/auth/discord?next=https://evil.example');
      expect(res.status).toBe(302);
      const location = new URL(res.headers.get('location')!);
      expect(location.origin).toBe('https://discord.com');
      expect(location.searchParams.get('state')?.length).toBeGreaterThan(20);
      expect(location.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/auth/callback`);
      const cookie = res.headers.get('set-cookie') || '';
      expect(cookie).toContain('rift_sid=');
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
    });

    test('/auth/callback with a wrong state is refused', async () => {
      const res = await call('/auth/callback?code=abc&state=forged');
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/login?error=oauth');
    });

    test('signed-in pages redirect to /login without a session', async () => {
      const res = await call('/dashboard');
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/login');
    });

    test('a member without the staff role loses the session', async () => {
      const session = sessionFor(OUTSIDER);
      const res = await call('/api/guilds', { session });
      expect(res.status).toBe(403);
      const again = await call('/api/guilds', { session });
      expect(again.status).toBe(401);
    });
  });

  describe('authorization', () => {
    test('staff can use staff routes but not administrator routes', async () => {
      const session = sessionFor(STAFF);
      expect((await call('/api/guilds', { session })).status).toBe(200);
      for (const path of ['/api/staff', '/api/bootstrap', '/api/audit', '/api/setup/options', '/api/studio', '/api/applications/overview', '/api/mod-reports', '/api/health']) {
        const res = await call(path, { session });
        expect(res.status).toBe(403);
      }
      const sync = await call('/api/staff/sync', { method: 'POST', body: JSON.stringify({ mode: 'sync' }), session });
      expect(sync.status).toBe(403);
    });

    test('administrators (Administrator permission) pass the admin check', async () => {
      const session = sessionFor(ADMIN, true);
      const res = await call('/api/staff', { session });
      expect(res.status).toBe(200);
      expect(Array.isArray((await res.json() as any).staff)).toBe(true);
    });

    test('a guild that is not in the session list is refused', async () => {
      const session = sessionFor(ADMIN, true);
      const res = await call('/api/guilds/select', { method: 'POST', body: JSON.stringify({ guildId: '1399999999999999999' }), session });
      expect(res.status).toBe(403);
    });

    test('params are validated', async () => {
      const session = sessionFor(ADMIN, true);
      const res = await call('/api/staff/not-an-id', { method: 'DELETE', session });
      expect(res.status).toBe(400);
    });

    test('admin-only bundles are not served to staff, dashboard bundles not to visitors', async () => {
      expect((await call('/a/d/app-abcdef12.js')).status).toBe(404);
      expect((await call('/a/d/app-abcdef12.js', { session: sessionFor(STAFF) })).status).toBe(200);
      expect((await call('/a/d/admin-abcdef12.js', { session: sessionFor(STAFF) })).status).toBe(404);
      expect((await call('/a/d/admin-abcdef12.js', { session: sessionFor(ADMIN, true) })).status).toBe(200);
      const pub = await call('/a/p/status-abcdef12.js');
      expect(pub.status).toBe(200);
      expect(pub.headers.get('cache-control')).toContain('immutable');
      expect((await call('/a/p/../../manifest.json')).status).toBe(404);
    });
  });

  describe('CSRF and request hygiene', () => {
    test('non-GET without x-csrf-token is refused', async () => {
      const session = sessionFor(ADMIN, true);
      const res = await call('/api/staff/sync', { method: 'POST', body: JSON.stringify({ mode: 'sync' }), session, csrf: false });
      expect(res.status).toBe(403);
    });

    test('a wrong csrf token is refused', async () => {
      const session = sessionFor(ADMIN, true);
      const res = await call('/api/staff/sync', { method: 'POST', body: JSON.stringify({ mode: 'sync' }), session: { ...session, csrf: 'x'.repeat(43) } });
      expect(res.status).toBe(403);
    });

    test('cross-origin POST is refused even with a valid token', async () => {
      const session = sessionFor(ADMIN, true);
      const res = await call('/api/staff/sync', { method: 'POST', body: JSON.stringify({ mode: 'sync' }), session, origin: 'https://evil.example' });
      expect(res.status).toBe(403);
    });

    test('non-JSON bodies are refused', async () => {
      const session = sessionFor(ADMIN, true);
      const res = await call('/api/settings/language', { method: 'PATCH', body: 'language=ar', headers: { 'content-type': 'text/plain' }, session });
      expect(res.status).toBe(415);
    });

    test('oversized bodies are refused', async () => {
      const session = sessionFor(ADMIN, true);
      const res = await call('/api/settings/messages', { method: 'PATCH', body: JSON.stringify({ title: 'x'.repeat(2 * 1024 * 1024) }), session });
      expect(res.status).toBe(413);
    });
  });

  describe('staff sync', () => {
    test('wipe without the exact confirmation text is a 400 in Arabic', async () => {
      const session = sessionFor(ADMIN, true);
      const res = await call('/api/staff/sync', { method: 'POST', body: JSON.stringify({ mode: 'wipe', confirm: 'yes' }), session });
      expect(res.status).toBe(400);
      expect((await res.json() as any).error).toContain('مسح الكل');
    });

    test('sync registers role holders and returns a message', async () => {
      const session = sessionFor(OWNER, true);
      const res = await call('/api/staff/sync', { method: 'POST', body: JSON.stringify({ mode: 'sync' }), session });
      const body = await res.json() as any;
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.result.withRole).toBe(3);
      expect(typeof body.message).toBe('string');
    });

    test('dismiss requires a reason', async () => {
      const session = sessionFor(ADMIN, true);
      const res = await call(`/api/staff/${STAFF}/dismiss`, { method: 'POST', body: JSON.stringify({ reason: '' }), session });
      expect(res.status).toBe(400);
    });
  });

  describe('public pages and headers', () => {
    test('security headers on every response', async () => {
      for (const path of ['/login', '/api/me', '/status', '/does-not-exist']) {
        const res = await call(path);
        expect(res.headers.get('content-security-policy')).toContain("script-src 'self'");
        expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
        expect(res.headers.get('x-frame-options')).toBe('DENY');
        expect(res.headers.get('x-content-type-options')).toBe('nosniff');
        expect(res.headers.get('referrer-policy')).toBeTruthy();
      }
      expect((await call('/api/me')).headers.get('cache-control')).toBe('no-store');
    });

    test('login page is server-rendered Arabic RTL and works without JS', async () => {
      const res = await call('/login?error=forbidden');
      const html = await res.text();
      expect(res.status).toBe(200);
      expect(html).toStartWith('<!doctype html>');
      expect(html).toContain('<html lang="ar" dir="rtl">');
      expect(html).toContain('href="/auth/discord"');
      expect(html).toContain('تسجيل الدخول بديسكورد');
      expect(html).toContain('رتبة الستاف');
      expect(html).not.toMatch(/<script(?![^>]*type="(module|application\/json)")/);
    });

    test('dashboard shell has csrf meta, module script and escaped boot JSON', async () => {
      const session = sessionFor(STAFF);
      const res = await call('/dashboard', { session });
      const html = await res.text();
      expect(res.status).toBe(200);
      expect(html).toContain(`<meta name="csrf-token" content="${session.csrf}">`);
      expect(html).toContain('<script type="module" src="/a/d/app-abcdef12.js"></script>');
      expect(html).toContain('<script type="application/json" id="boot">');
      expect(html).toContain('<div id="root">');
      expect(res.headers.get('cache-control')).toBe('no-store');
    });

    test('/status works without login', async () => {
      const page = await call('/status');
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('/a/p/status-abcdef12.js');
      const json = await call('/api/status');
      expect(json.status).toBe(200);
      expect((await json.json() as any).overall).toBeTruthy();
      const badge = await call('/status/badge.svg');
      expect(badge.headers.get('content-type')).toContain('image/svg+xml');
      const rss = await call('/status.rss');
      expect(rss.status).toBe(200);
      expect(await rss.text()).toContain('<rss');
    });

    test('public apply form API validates ids and requires a session to submit', async () => {
      expect((await call('/apply/not-a-uuid')).status).toBe(404);
      expect((await call('/apply-api/forms/not-a-uuid')).status).toBe(404);
      const res = await call('/apply-api/forms/00000000-0000-4000-8000-000000000000/submit', { method: 'POST', body: JSON.stringify({ answers: {} }) });
      expect(res.status).toBe(403);
    });

    test('logout clears the server session', async () => {
      const session = sessionFor(STAFF);
      const res = await call('/auth/logout', { method: 'POST', session });
      expect(res.status).toBe(200);
      expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
      expect((await call('/api/guilds', { session })).status).toBe(401);
    });
  });
}
