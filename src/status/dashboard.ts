import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type Client } from '../lib/djs/index.js';
import type { Context } from '../web/server/http.js';
import type { DashboardContext, DashboardExtension } from '../dashboard/extensions.js';
import { env } from '../config/env.js';
import { supabase } from '../supabase/client.js';
import { isSchemaError, MINUTE, warnSchema, MIGRATION_HINT } from './shared.js';
import { DOWN_AFTER_MS, buildMetrics, buildStatus, cached, lastAlive, loadHeartbeat, publicBase, statusBadge, statusMeta, statusRss, uptimeReport, validRange } from './status-data.js';
import type { Mount } from '../web/server/router.js';
import { publicMessage } from '../web/server/errors.js';
import { rateLimit } from '../web/server/security.js';
import { renderStatusPage } from '../web/server/shells.js';
import { mountPresenceRoutes } from './presence-api.js';

const ALERT_AFTER_MS = 120_000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMPONENTS = ['bot', 'jobs', 'database', 'dashboard'];
const POST_KINDS = ['update', 'announcement', 'incident', 'resolved', 'maintenance'];
const cleanText = (value: unknown, max: number) => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
const startedAt = Date.now();

// ---- Downtime monitor: runs in the dashboard process, so it can still speak when the bot process is the thing that died ----
async function announce(discord: Client, title: string, description: string, color: number) {
  const { data } = await supabase.from('guild_settings').select('guild_id, logs_channel_id');
  await Promise.all((data ?? []).filter((item: any) => item.logs_channel_id).map(async (item: any) => {
    const channel: any = discord.channels.cache.get(item.logs_channel_id) || await discord.channels.fetch(item.logs_channel_id).catch(() => null);
    // The channel must belong to the server whose settings name it.
    if (channel?.isTextBased?.() && 'send' in channel && channel.guildId === item.guild_id) await channel.send({ embeds: [new EmbedBuilder().setTitle(title).setDescription(description).setColor(color).setTimestamp()] }).catch(() => null);
  }));
}

let monitorStarted = false;
function startMonitor(discord: Client) {
  if (monitorStarted) return;
  monitorStarted = true;
  let lastCpu = process.cpuUsage();
  let lastCpuAt = Date.now();
  // Dashboard-side sample once a minute: process load, gateway ping and how long a database read takes.
  const sample = async () => {
    const beat = await loadHeartbeat();
    const now = Date.now();
    const usage = process.cpuUsage(lastCpu);
    const cpu = Math.min(100, ((usage.user + usage.system) / 1000 / Math.max(1, now - lastCpuAt)) * 100);
    lastCpu = process.cpuUsage(); lastCpuAt = now;
    const { error } = await supabase.from('status_samples').insert({ t: new Date(now).toISOString(), source: 'dashboard', cpu: Math.round(cpu * 10) / 10, mem: Math.round(process.memoryUsage().rss / 1048576), ping: Number.isFinite(discord.ws.ping) ? Math.max(0, Math.round(discord.ws.ping)) : 0, db_ms: beat.ms });
    if (error && !warnSchema('status_samples', error)) console.error('Dashboard sample failed:', error.message);
  };
  setInterval(() => sample().catch(error => console.error('Dashboard sample failed:', error)), 60_000).unref?.();
  sample().catch(() => null);
  const tick = async () => {
    if (!discord.isReady()) return;
    const { row: heartbeat } = await loadHeartbeat();
    if (!heartbeat) return;
    const alive = lastAlive(heartbeat);
    // A stall longer than the limit that recovers without a restart (database blip, blocked event loop) would leave no trace.
    // Remember when it started and record it on recovery.
    const stalled = Date.now() - alive > DOWN_AFTER_MS;
    if (stalled && !heartbeat.stall_since) await supabase.from('bot_heartbeats').update({ stall_since: new Date(alive).toISOString() }).eq('key', 'main');
    if (!stalled && heartbeat.stall_since) {
      const since = new Date(heartbeat.stall_since);
      await supabase.from('bot_heartbeats').update({ stall_since: null }).eq('key', 'main');
      // A restart already wrote its own downtime row (recordStartup); only record stalls nobody else covered.
      const covered = await supabase.from('bot_status_events').select('id', { count: 'exact', head: true }).eq('kind', 'downtime').gte('started_at', new Date(since.getTime() - 60_000).toISOString());
      if (!covered.count) await supabase.from('bot_status_events').insert({ kind: 'downtime', started_at: since.toISOString(), ended_at: new Date(alive).toISOString(), note: 'البوت توقف عن الاستجابة ورجع لحاله' });
    }
    const stale = Date.now() - alive > ALERT_AFTER_MS;
    const alertedFor = heartbeat.alerted_for ? new Date(heartbeat.alerted_for).getTime() : 0;
    if (stale && alertedFor !== alive) {
      await supabase.from('bot_heartbeats').update({ alerted_for: new Date(alive).toISOString() }).eq('key', 'main');
      await announce(discord, 'بوت Rift طافي', `ما وصل نبض من البوت من <t:${Math.floor(alive / 1000)}:R>. بننشر رسالة هنا لما يرجع.`, 0xe9697b);
    } else if (!stale && alertedFor) {
      await supabase.from('bot_heartbeats').update({ alerted_for: null }).eq('key', 'main');
      const minutes = Math.max(1, Math.round((Date.now() - alertedFor) / MINUTE));
      await announce(discord, 'بوت Rift رجع يشتغل', `البوت رجع بعد توقف تقريباً ${minutes} دقيقة.`, 0x4fc08d);
    }
  };
  setInterval(() => tick().catch(error => console.error('Downtime monitor failed:', error)), 20_000).unref?.();
}

/** The status page is global, so only administrators of the main server (GUILD_ID) may change it. Without GUILD_ID only a server owner may. */
async function requireStatusAdmin(ctx: DashboardContext, c: Context) {
  if (!await ctx.requireAdministrator(c)) return false;
  const allowed = env.guildId ? ctx.selectedGuildId(c) === env.guildId : Boolean(ctx.sessionUser(c)?.isOwner);
  if (!allowed) { c.status(403).json({ error: 'صفحة الحالة العامة يديرها أدمن السيرفر الرئيسي فقط.' }); return false; }
  return true;
}

const failure = (c: Context, error: unknown, fallback: string) => {
  const schema = error && typeof error === 'object' && isSchemaError(error as { message?: string; code?: string });
  c.status(schema ? 503 : 400).json({ error: schema ? `جداول صفحة الحالة ناقصة. ${MIGRATION_HINT}` : publicMessage(error, fallback) });
};
const dbFailure = (c: Context, error: { message: string; code?: string }) => { warnSchema('status tables', error); failure(c, error, error.message); };

const postView = (row: any) => ({ id: String(row.id), title: row.title, body: row.body, kind: row.kind, pinned: row.pinned, authorName: row.author_name, authorAvatar: row.author_avatar, createdAt: row.created_at, updatedAt: row.updated_at });

export const statusDashboard: DashboardExtension = {
  name: 'status',

  // Public: the page, its JSON, the metrics, the RSS feed and the badge. No login.
  mountPublic(ctx, app: Mount) {
    const { discord } = ctx;
    if (process.env.STATUS_MONITOR !== 'off') startMonitor(discord);
    const limited = rateLimit('status-public', 60_000, 120, 'طلبات كثيرة. حاول بعد لحظات.');
    const guards = { guards: [limited] };
    const base = () => publicBase(env.dashboardUrl);
    const overallNow = async () => { try { return ((await cached('status', 5000, buildStatus)) as any).overall ?? null; } catch { return null; } };

    app.get('/status/badge.svg', async (c: Context) => {
      const overall = await overallNow();
      c.headers.set('Cache-Control', 'public, max-age=60');
      c.headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
      return c.text(statusBadge(overall?.state ?? 'outage'), 200, 'image/svg+xml; charset=utf-8');
    }, guards);

    // الصفحة من السيرفر (TSX) مع الحالة الحالية في وسوم المعاينة، وبيانات البداية للواجهة.
    app.get(['/status', '/status/:tab'], async (c: Context) => {
      if (c.params.tab !== undefined && !/^[\w-]{1,30}$/.test(c.params.tab)) return c.text('', 404);
      let snapshot: any = null;
      try { snapshot = await cached('status', 5000, buildStatus); } catch { /* الصفحة تعرض حالة الخطأ بنفسها */ }
      c.headers.set('Cache-Control', 'no-cache');
      return c.html(renderStatusPage(statusMeta(snapshot?.overall ?? null, base()), { status: snapshot, tab: c.params.tab ?? null }));
    }, guards);

    app.get('/api/status', async (c: Context) => {
      try { c.headers.set('Cache-Control', 'public, max-age=5'); return c.json(await cached('status', 5000, buildStatus)); }
      catch (error) { console.error('Status build failed:', error); return c.status(503).json({ error: 'الحالة غير متاحة مؤقتاً.' }); }
    }, guards);

    app.get('/api/status/metrics', async (c: Context) => {
      const source = c.q('source') === 'dashboard' ? 'dashboard' : 'bot';
      const range = validRange(c.q('range'));
      try {
        const value = await cached(`metrics:${source}:${range}`, 15_000, () => buildMetrics(source, range));
        c.headers.set('Cache-Control', 'public, max-age=15');
        return c.json(value);
      } catch (error) { console.error('Status metrics failed:', error instanceof Error ? error.message : error); return c.status(503).json({ error: 'القياسات غير متاحة مؤقتاً.' }); }
    }, guards);

    app.get('/status.rss', async (c: Context) => {
      try { return c.text(statusRss(await cached('status', 5000, buildStatus), base()), 200, 'application/rss+xml; charset=utf-8'); }
      catch { return c.text('خلاصة الحالة غير متاحة مؤقتاً.', 503); }
    }, guards);
  },

  // Admin: System health, maintenance windows, status posts and the bot presence. These replace the older in-memory routes.
  mountApi(ctx, app: Mount) {
    const { discord } = ctx;
    const writeLimit = rateLimit('status-writes', 60_000, 30);

    app.get('/api/health', async (c: Context) => {
      if (!await ctx.requireAdministrator(c)) return;
      try {
        const guildId = ctx.selectedGuildId(c);
        const now = Date.now();
        const beat = await loadHeartbeat();
        const connected = !beat.error || isSchemaError(beat.error);
        const count = async (table: string, filters: Record<string, unknown>) => {
          let query = supabase.from(table).select('id', { count: 'exact', head: true });
          for (const [key, value] of Object.entries(filters)) query = query.eq(key, value as never);
          const { count: total } = await query;
          return total ?? 0;
        };
        const guild = await ctx.getGuild(guildId).catch(() => null);
        const [staff, pendingComplaints, pendingLeaves, pendingResignations, logRows, uptime] = await Promise.all([
          count('staff', { guild_id: guildId, active: true }).catch(() => 0),
          count('complaints', { guild_id: guildId, status: 'pending' }).catch(() => 0),
          count('leave_requests', { guild_id: guildId, status: 'pending' }).catch(() => 0),
          count('resignation_requests', { guild_id: guildId, status: 'pending' }).catch(() => 0),
          supabase.from('staff_logs').select('action, user_id, created_at').eq('guild_id', guildId).order('created_at', { ascending: false }).limit(12).then(result => result.data ?? []),
          uptimeReport(now, beat.row).catch(() => ({ since: null, uptime30: null, uptime24h: null, days: [], halfHours: [], incidents: [], ongoing: false })),
        ]);
        const row = beat.row;
        const logs = logRows.map((log: any) => ({ action: log.action, userId: log.user_id, createdAt: log.created_at, name: guild?.members.cache.get(log.user_id)?.displayName || undefined }));
        c.json({
          now,
          bot: row ? { startedAt: row.started_at, updatedAt: row.updated_at, pingMs: row.ping_ms ?? 0, guilds: row.guilds ?? 0, memoryMb: row.memory_mb ?? 0, nodeVersion: row.node_version ?? '', activeShifts: row.active_shifts ?? 0, watchdogs: row.watchdogs || {} } : null,
          database: { connected, latencyMs: beat.ms },
          dashboard: { uptimeSec: Math.floor((now - startedAt) / 1000), memoryMb: Math.round(process.memoryUsage().rss / 1_048_576), gatewayReady: discord.isReady(), gatewayPingMs: Math.max(0, Math.round(discord.ws.ping)) },
          queue: { staff, pendingComplaints, pendingLeaves, pendingResignations },
          logs, uptime,
        });
      } catch (error) { c.status(400).json({ error: publicMessage(error, 'تعذّر تنفيذ العملية.') }); }
    });

    // ---- Maintenance windows shown on the public status page ------------------------------------
    app.post('/api/maintenances', async (c: Context) => {
      if (!await requireStatusAdmin(ctx, c)) return;
      try {
        const body = (c.body || {}) as Record<string, any>;
        const title = cleanText(body.title, 90);
        const description = cleanText(body.description, 600);
        const startsAt = new Date(body.startsAt);
        const endsAt = new Date(body.endsAt);
        if (!title) throw new Error('اكتب عنوان للصيانة.');
        if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) throw new Error('اختر وقت البداية والنهاية.');
        if (endsAt <= startsAt) throw new Error('النهاية لازم تكون بعد البداية.');
        const affects = (Array.isArray(body.affects) ? body.affects : []).map(String).filter((key: string) => COMPONENTS.includes(key));
        const { data, error } = await supabase.from('status_maintenances').insert({ title, description, starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), affects, updates: [{ at: new Date().toISOString(), text: 'تمت جدولة الصيانة.' }] }).select('id').single();
        if (error) return dbFailure(c, error);
        c.json({ ok: true, id: String(data.id) });
      } catch (error) { c.status(400).json({ error: publicMessage(error, 'تعذّر تنفيذ العملية.') }); }
    }, { guards: [writeLimit] });

    app.post('/api/maintenances/:id/end', async (c: Context) => {
      if (!await requireStatusAdmin(ctx, c)) return;
      const id = String(c.params.id || '');
      if (!uuid.test(id)) return c.status(400).json({ error: 'الصيانة غير صحيحة.' });
      const { data: row, error } = await supabase.from('status_maintenances').select('*').eq('id', id).maybeSingle();
      if (error) return dbFailure(c, error);
      if (!row) return c.status(404).json({ error: 'الصيانة مو موجودة.' });
      const started = new Date(row.starts_at).getTime() <= Date.now();
      const updates = [...(Array.isArray(row.updates) ? row.updates : []), { at: new Date().toISOString(), text: started ? 'انتهت الصيانة.' : 'انلغت الصيانة.' }];
      const saved = await supabase.from('status_maintenances').update({ ended_early: true, ended_at: new Date().toISOString(), updates }).eq('id', id);
      if (saved.error) return dbFailure(c, saved.error);
      c.json({ ok: true });
    }, { guards: [writeLimit] });

    app.delete('/api/maintenances/:id', async (c: Context) => {
      if (!await requireStatusAdmin(ctx, c)) return;
      const id = String(c.params.id || '');
      if (!uuid.test(id)) return c.status(400).json({ error: 'الصيانة غير صحيحة.' });
      const { error } = await supabase.from('status_maintenances').delete().eq('id', id);
      if (error) return dbFailure(c, error);
      c.json({ ok: true });
    }, { guards: [writeLimit] });

    // ---- Status posts ("tweets"): announcements shown on the public status page ------------------
    const postInput = (body: any) => {
      const title = cleanText(body?.title, 120);
      if (!title) throw new Error('اكتب عنوان للتحديث.');
      return { title, body: cleanText(body?.body, 2000), kind: POST_KINDS.includes(String(body?.kind)) ? String(body.kind) : 'update', pinned: Boolean(body?.pinned) };
    };
    // Optional Discord copy of a post. The channel must belong to the server the admin is managing.
    const announcePost = async (c: Context, post: { kind: string; title: string; body: string; author_name: string }, channelId: string) => {
      if (!/^\d{15,22}$/.test(channelId)) return false;
      const channel: any = await discord.channels.fetch(channelId).catch(() => null);
      if (!channel?.isTextBased?.() || !('send' in channel) || channel.guildId !== ctx.selectedGuildId(c)) throw new Error('اختر روم كتابي في هذا السيرفر.');
      const color = ({ incident: 0xe9697b, resolved: 0x4fc08d, maintenance: 0xe0b04f, announcement: 0x8175f5, update: 0x8175f5 } as Record<string, number>)[post.kind] ?? 0x8175f5;
      const kindLabel = ({ incident: 'Incident', resolved: 'Resolved', maintenance: 'Maintenance', announcement: 'Announcement', update: 'Update' } as Record<string, string>)[post.kind] || 'Update';
      const statusUrl = `${env.dashboardUrl}/status`;
      const embed = new EmbedBuilder().setColor(color).setAuthor({ name: kindLabel }).setTitle(String(post.title).slice(0, 256)).setFooter({ text: `${post.author_name || 'Rift'} · Status page` });
      if (post.body) embed.setDescription(String(post.body).slice(0, 4000));
      await channel.send({
        allowedMentions: { parse: [] }, embeds: [embed],
        ...(statusUrl.startsWith('http') ? { components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(statusUrl).setLabel('صفحة الحالة').setEmoji('📡'))] } : {}),
      });
      return true;
    };
    const list = async () => {
      const { data, error } = await supabase.from('status_posts').select('*').order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      return (data ?? []).map(postView);
    };

    app.get('/api/status-posts', async (c: Context) => {
      if (!await requireStatusAdmin(ctx, c)) return;
      try { c.json({ posts: await list() }); } catch (error) { failure(c, error, 'تعذّر تحميل التحديثات.'); }
    });
    app.post('/api/status-posts', async (c: Context) => {
      if (!await requireStatusAdmin(ctx, c)) return;
      try {
        const user = ctx.sessionUser(c);
        const input = postInput(c.body);
        const avatar = user?.avatar ? (String(user.avatar).startsWith('http') ? user.avatar : `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`) : '';
        const { data, error } = await supabase.from('status_posts').insert({ ...input, author_id: user?.id || '', author_name: user?.username || '', author_avatar: avatar }).select('*').single();
        if (error) return dbFailure(c, error);
        const announced = c.body?.channelId ? await announcePost(c, data, String(c.body.channelId)) : false;
        c.json({ post: postView(data), announced });
      } catch (error) { failure(c, error, 'التحديث غير صحيح.'); }
    }, { guards: [writeLimit] });
    app.patch('/api/status-posts/:id', async (c: Context) => {
      if (!await requireStatusAdmin(ctx, c)) return;
      const id = String(c.params.id || '');
      if (!uuid.test(id)) return c.status(400).json({ error: 'التحديث غير صحيح.' });
      try {
        const { data, error } = await supabase.from('status_posts').update({ ...postInput(c.body), updated_at: new Date().toISOString() }).eq('id', id).select('*').maybeSingle();
        if (error) return dbFailure(c, error);
        if (!data) return c.status(404).json({ error: 'التحديث مو موجود.' });
        c.json({ post: postView(data) });
      } catch (error) { failure(c, error, 'التحديث غير صحيح.'); }
    }, { guards: [writeLimit] });
    app.delete('/api/status-posts/:id', async (c: Context) => {
      if (!await requireStatusAdmin(ctx, c)) return;
      const id = String(c.params.id || '');
      if (!uuid.test(id)) return c.status(400).json({ error: 'التحديث غير صحيح.' });
      const { error } = await supabase.from('status_posts').delete().eq('id', id);
      if (error) return dbFailure(c, error);
      c.json({ ok: true });
    }, { guards: [writeLimit] });

    mountPresenceRoutes(ctx, app);
  },
};
