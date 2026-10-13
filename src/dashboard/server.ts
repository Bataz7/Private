import { Client, GatewayIntentBits } from '../lib/djs/index.js';
import { env } from '../config/env.js';
import { status } from '../utils/terminal.js';
import { installEmojiHook, waitForEmojis } from '../utils/emoji.js';
import { loadWebManifest } from '../web/server/assets.js';
import { assertSessionSecret } from '../web/server/security.js';
import { MB } from '../web/server/http.js';
import { createDashboard } from './app.js';

// تشغيل لوحة التحكم: عملية Bun منفصلة عن البوت. عميل ديسكورد REST فقط (بدون Gateway = ذاكرة أقل)،
// الواجهة من web-dist (تنبني تلقائياً لو ناقصة أو قديمة)، و Bun.serve بدل Express.

assertSessionSecret();
installEmojiHook();

const discord = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers], restOnly: true, memberCacheSize: 300 });
const { fetch, ctx } = createDashboard(discord);

await loadWebManifest();

const server = Bun.serve({
  port: env.dashboardPort,
  hostname: process.env.DASHBOARD_HOST || '0.0.0.0',
  maxRequestBodySize: 2 * MB,
  idleTimeout: 30,
  development: false,
  fetch: (req, srv) => fetch(req, srv),
  error(error) {
    console.error('[dashboard] unhandled:', error);
    return new Response(JSON.stringify({ error: 'صار خطأ في السيرفر.' }), { status: 500, headers: { 'content-type': 'application/json; charset=utf-8' } });
  },
});
console.log(`  ${status('ok', 'Dashboard', `listening on ${env.dashboardUrl} (port ${server.port})`)}`);

// تسجيل دخول REST؛ لو فشل (شبكة، ديسكورد واقف) نعيد المحاولة كل 30 ثانية بدل ما تبقى اللوحة بدون سيرفرات.
async function connect(attempt = 1): Promise<void> {
  try {
    await discord.login(env.token);
    console.log(`  ${status('ok', 'Discord', `REST client ready (${discord.guilds.cache.size} server(s))`)}`);
    void waitForEmojis(discord).catch(() => undefined);
    setInterval(() => { void ctx.refreshGuilds().catch(() => undefined); }, 5 * 60_000).unref?.();
  } catch (error) {
    console.error(`Dashboard Discord login failed (attempt ${attempt}):`, error instanceof Error ? error.message : error);
    setTimeout(() => { void connect(attempt + 1); }, Math.min(300_000, 30_000 * attempt)).unref?.();
  }
}
void connect();

const stop = () => { server.stop(true); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
