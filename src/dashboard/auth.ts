import { PermissionFlagsBits } from '../lib/djs/index.js';
import { env } from '../config/env.js';
import { status } from '../utils/terminal.js';
import type { Context } from '../web/server/http.js';
import type { Router } from '../web/server/router.js';
import { csrfGuard, originGuard, rateLimit, randomToken, safeEqual, safeLocalPath } from '../web/server/security.js';
import { destroySession, ensureSession, rotateSession } from '../web/server/session.js';
import { readBodyText } from '../web/server/http.js';
import { handleApplyCallback } from '../applications/dashboard.js';
import { authorizeUrl, discordJson, exchangeCode } from './oauth.js';
import type { DashboardContext, SessionGuild, SessionUser } from './context.js';

// تسجيل الدخول بديسكورد (OAuth2): state عشوائي مربوط بجلسة المتصفح، رقم جلسة جديد بعد الدخول، وخروج يمسح الجلسة من السيرفر.

const authLimit = rateLimit('auth', 60_000, 30, 'محاولات دخول كثيرة. انتظر دقيقة وحاول مرة ثانية.');
const NO_STORE = 'no-store, no-cache, must-revalidate';

/** وجهة ما بعد الدخول: صفحات اللوحة أو البروفايل فقط (ما نسمح بتحويل مفتوح لموقع ثاني). */
const nextAfterLogin = (value: unknown) => {
  const path = safeLocalPath(value, '/dashboard');
  return /^\/(dashboard(\/[\w-]+)?|p\/[\w.@-]{1,40})$/.test(path) ? path : '/dashboard';
};

export function mountAuth(router: Router, ctx: DashboardContext) {
  const pub = router.scope('auth', [authLimit]);

  pub.get('/auth/discord', (c: Context) => {
    if (!env.discordClientSecret) return c.redirect('/login?error=config');
    const session = ensureSession(c);
    const state = randomToken(24);
    session.data.oauthState = state;
    session.data.oauthNext = nextAfterLogin(c.q('next'));
    c.headers.set('Cache-Control', NO_STORE);
    return c.redirect(authorizeUrl('identify guilds connections', state));
  });

  // المتقدمين على نموذج التقديم العام يرجعون لنفس الرابط، والـ state يبدأ بـ "apply.".
  pub.get('/auth/callback', async (c: Context) => {
    c.headers.set('Cache-Control', NO_STORE);
    const state = c.q('state');
    if (state.startsWith('apply.')) return handleApplyCallback(c);
    const expected = c.session?.data.oauthState as string | undefined;
    const next = nextAfterLogin(c.session?.data.oauthNext);
    if (c.session) { delete c.session.data.oauthState; delete c.session.data.oauthNext; }
    // لازم الـ state يطابق اللي انعطى لنفس المتصفح، وإلا الدخول بدأ من مكان ثاني (login CSRF).
    if (!expected || !state || !safeEqual(state, expected)) return c.redirect('/login?error=oauth');
    const code = c.q('code');
    if (!code || !env.discordClientSecret) return c.redirect('/login?error=oauth');
    try {
      const token = await exchangeCode(code);
      if (!token?.access_token) {
        console.error('Discord OAuth token exchange failed:', token?.error_description || token?.error || 'no response');
        return c.redirect('/login?error=oauth_token');
      }
      const user = await discordJson<{ id: string; username: string; global_name?: string | null; avatar: string | null }>('/users/@me', token.access_token);
      if (!user?.id) return c.redirect('/login?error=oauth_user');
      const oauthGuilds = await discordJson<Array<{ id: string; name: string; icon: string | null; owner: boolean }>>('/users/@me/guilds', token.access_token);
      if (!Array.isArray(oauthGuilds)) return c.redirect('/login?error=oauth_guilds');

      // نفحص فقط السيرفرات اللي فيها المستخدم والبوت معاً.
      const available: SessionGuild[] = [];
      for (const candidate of oauthGuilds.slice(0, 200)) {
        if (!ctx.discord.guilds.cache.has(candidate.id)) continue;
        const guild = await ctx.getGuild(candidate.id).catch(() => null);
        if (!guild) continue;
        const [member, settings] = await Promise.all([ctx.getMember(guild.id, user.id, 0), ctx.settingsRow(guild.id).catch(() => null)]);
        if (!member || !settings?.staff_role_id || !member.roles.cache.has(settings.staff_role_id)) continue;
        available.push({ id: guild.id, name: guild.name, icon: guild.icon ?? candidate.icon ?? null, owner: guild.ownerId === user.id });
      }
      const selected = (env.guildId && available.some(item => item.id === env.guildId) ? env.guildId : available[0]?.id) || '';
      if (!selected) {
        console.error(`OAuth login rejected: no compatible server (user in ${oauthGuilds.length}, bot in ${ctx.discord.guilds.cache.size}).`);
        return c.redirect('/login?error=forbidden');
      }
      const guild = await ctx.getGuild(selected);
      const member = await ctx.getMember(selected, user.id);
      if (!member) return c.redirect('/login?error=member');
      const isOwner = guild.ownerId === user.id;
      const isAdministrator = member.permissions.has(PermissionFlagsBits.Administrator);
      const sessionUser: SessionUser = { id: user.id, username: user.username, avatar: user.avatar, isOwner, isAdministrator, isManagement: isOwner || isAdministrator, isStaff: true, guilds: available };
      // رقم جلسة جديد بعد الدخول: أي رقم قديم (مسروق أو مثبّت) ما يصير مسجّل.
      const session = rotateSession(c);
      session.data = { user: sessionUser, guildId: selected, discordAccessToken: token.access_token, staffOkUntil: Date.now() + 30_000 };
      console.log(`  ${status('ok', 'Login', `${user.username} signed in (owner=${isOwner}, admin=${isAdministrator})`)}`);
      return c.redirect(next);
    } catch (error) {
      console.error('Discord OAuth callback failed:', error instanceof Error ? error.message : error);
      return c.redirect('/login?error=oauth_user');
    }
  });

  // الخروج: من الواجهة (fetch مع x-csrf-token) أو من نموذج HTML عادي (حقل csrf) عشان يشتغل بدون JavaScript.
  router.scope('auth-logout', [originGuard]).post('/auth/logout', async (c: Context) => {
    const isForm = /^application\/x-www-form-urlencoded/i.test(c.req.headers.get('content-type') || '');
    if (isForm) {
      const form = new URLSearchParams(await readBodyText(c.req, 4096));
      const token = form.get('csrf') || '';
      if (!c.session || !token || !safeEqual(token, c.session.csrf)) return c.redirect('/login?error=expired', 303);
      destroySession(c);
      return c.redirect('/login?error=logout', 303);
    }
    const refused = csrfGuard(c);
    if (refused) return refused;
    destroySession(c);
    return c.json({ ok: true });
  }, { body: false });

  // من أنا؟ (عام: يرجع null لو مو مسجّل)
  router.scope('session', []).get('/api/me', async (c: Context) => {
    c.headers.set('Cache-Control', 'no-store');
    const user = ctx.sessionUser(c);
    if (user && c.session?.data.guildId) {
      const guildId = c.session.data.guildId as string;
      const [guild, member, settings] = await Promise.all([ctx.getGuild(guildId).catch(() => null), ctx.getMember(guildId, user.id), ctx.settingsRow(guildId).catch(() => null)]);
      if (guild && member) {
        user.isOwner = guild.ownerId === user.id;
        user.isAdministrator = member.permissions.has(PermissionFlagsBits.Administrator);
        user.isManagement = user.isOwner || user.isAdministrator;
        user.isStaff = Boolean(settings?.staff_role_id && member.roles.cache.has(settings.staff_role_id));
      }
    }
    return c.json({ user, guildId: user ? c.session?.data.guildId ?? null : null, configured: Boolean(env.discordClientSecret), csrf: user ? c.session?.csrf : undefined });
  });
}
