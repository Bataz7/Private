import { readFileSync } from 'node:fs';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type Client } from '../lib/djs/index.js';
import type { Context } from '../web/server/http.js';
import type { DashboardContext, DashboardExtension } from '../dashboard/extensions.js';
import { env } from '../config/env.js';
import { supabase } from '../supabase/client.js';
import { isSchemaError, MINUTE, warnSchema, MIGRATION_HINT } from './shared.js';
import { DOWN_AFTER_MS, buildMetrics, buildStatus, cached, lastAlive, loadHeartbeat, publicBase, statusBadge, statusMetaTags, statusRss, uptimeReport, validRange } from './status-data.js';
import { mountPresenceRoutes } from './presence-api.js';

const ALERT_AFTER_MS = 120_000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMPONENTS = ['bot', 'jobs', 'database', 'dashboard'];
const POST_KINDS = ['update', 'announcement', 'incident', 'resolved', 'maintenance'];
const cleanText = (value: unknown, max: number) => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
const startedAt = Date.now();

/** Small per-IP limiter for the public endpoints (no login, so anyone can hit them). Answers are cached, this just caps abuse. */
function rateLimit(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  setInterval(() => { const now = Date.now(); for (const [key, hit] of hits) if (hit.reset < now) hits.delete(key); }, windowMs).unref();
  return (req: Request, res: Response, next: () => void) => {
    const now = Date.now();
    const key = req.ip || 'unknown';
    const hit = hits.get(key);
    if (!hit || hit.reset < now) { hits.set(key, { n: 1, reset: now + windowMs }); return next(); }
    if (++hit.n > max) { c.headers.set('Retry-After', String(Math.ceil((hit.reset - now) / 1000))); return void c.status(429).type('text/plain').send('Too many requests. Try again in a moment.'); }
    next();
  };
}

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
  setInterval(() => sample().catch(error => console.error('Dashboard sample failed:', error)), 60_000);
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
      if (!covered.count) await supabase.from('bot_status_events').insert({ kind: 'downtime', started_at: since.toISOString(), ended_at: new Date(alive).toISOString(), note: 'Bot stopped responding and recovered on its own' });
    }
    const stale = Date.now() - alive > ALERT_AFTER_MS;
    const alertedFor = heartbeat.alerted_for ? new Date(heartbeat.alerted_for).getTime() : 0;
    if (stale && alertedFor !== alive) {
      await supabase.from('bot_heartbeats').update({ alerted_for: new Date(alive).toISOString() }).eq('key', 'main');
      await announce(discord, 'Rift bot is offline', `No heartbeat since <t:${Math.floor(alive / 1000)}:R>. A message will be posted here when it recovers.`, 0xe9697b);
    } else if (!stale && alertedFor) {
      await supabase.from('bot_heartbeats').update({ alerted_for: null }).eq('key', 'main');
      const minutes = Math.max(1, Math.round((Date.now() - alertedFor) / MINUTE));
      await announce(discord, 'Rift bot is back online', `The bot recovered after about ${minutes} minute${minutes === 1 ? '' : 's'} of downtime.`, 0x4fc08d);
    }
  };
  setInterval(() => tick().catch(error => console.error('Downtime monitor failed:', error)), 20_000);
}

/** The status page is global, so only administrators of the main server (GUILD_ID) may change it. Without GUILD_ID only a server owner may. */
async function requireStatusAdmin(ctx: DashboardContext, req: Request, res: Response) {
  if (!await ctx.requireAdministrator(c)) return false;
  const allowed = env.guildId ? ctx.selectedGuildId(c) === env.guildId : Boolean(ctx.sessionUser(c)?.isOwner);
  if (!allowed) { c.status(403).json({ error: 'Only administrators of the main server can manage the public status page.' }); return false; }
  return true;
}

const failure = (c: Context, error: unknown, fallback: string) => {
  const schema = error && typeof error === 'object' && isSchemaError(error as { message?: string; code?: string });
  c.status(schema ? 503 : 400).json({ error: schema ? `The status tables are missing. ${MIGRATION_HINT}` : error instanceof Error ? error.message : fallback });
};
const dbFailure = (c: Context, error: { message: string; code?: string }) => { warnSchema('status tables', error); failure(c, error, error.message); };

const postView = (row: any) => ({ id: String(row.id), title: row.title, body: row.body, kind: row.kind, pinned: row.pinned, authorName: row.author_name, authorAvatar: row.author_avatar, createdAt: row.created_at, updatedAt: row.updated_at });

export const statusDashboard: DashboardExtension = {
  name: 'status',

  // Public: the page, its JSON, the metrics, the RSS feed and the badge. No login.
  mountPublic(ctx) {
    const { app, discord } = ctx;
    startMonitor(discord);
    const statusIndex = `${ctx.publicDir}/status.html`;
    const limited = rateLimit(120, 60_000);
    app.use(['/status', '/status.rss', '/api/status'], limited);

    app.get('/status/badge.svg', async (c: Context) => {
      let state: 'operational' | 'degraded' | 'outage' | 'maintenance' = 'outage';
      try { state = ((await cached('status', 5000, buildStatus)) as any).overall.state; } catch { /* unknown means outage */ }
      c.headers.set('Cache-Control', 'public, max-age=60');
      res.type('image/svg+xml').send(statusBadge(state));
    });

    // The page itself is a static file; the head gets the live status for link previews and the browser colour.
    let template = '';
    app.get(['/status', '/status/:tab'], async (c: Context) => {
      try {
        template ||= readFileSync(statusIndex, 'utf8');
        let overall: any = null;
        try { overall = ((await cached('status', 5000, buildStatus)) as any).overall; } catch { /* the page shows its own error state */ }
        c.headers.set('Cache-Control', 'no-cache');
        res.type('html').send(template.replace('<!--meta-->', statusMetaTags(overall, publicBase(`${req.protocol}://${req.get('host')}`))));
      } catch { res.sendFile(statusIndex); }
    });

    app.get('/api/status', async (c: Context) => {
      try { c.headers.set('Cache-Control', 'public, max-age=5'); c.json(await cached('status', 5000, buildStatus)); }
      catch (error) { console.error('Status build failed:', error); c.status(503).json({ error: 'Status is temporarily unavailable.' }); }
    });

    app.get('/api/status/metrics', async (c: Context) => {
      const source = c.query.get("source") === 'dashboard' ? 'dashboard' : 'bot';
      const range = validRange(c.query.get("range"));
      try {
        const value = await cached(`metrics:${source}:${range}`, 15_000, () => buildMetrics(source, range));
        c.headers.set('Cache-Control', 'public, max-age=15');
        c.json(value);
      } catch (error) { console.error('Status metrics failed:', error instanceof Error ? error.message : error); c.status(503).json({ error: 'Metrics are temporarily unavailable.' }); }
    });

    app.get('/status.rss', async (c: Context) => {
      try { res.type('application/rss+xml').send(statusRss(await cached('status', 5000, buildStatus), publicBase(`${req.protocol}://${req.get('host')}`))); }
      catch { c.status(503).type('text/plain').send('Status feed is temporarily unavailable.'); }
    });
  },

  // Admin: System health, maintenance windows, status posts and the bot presence. These replace the older in-memory routes.
  mountApi(ctx) {
    const { app, discord } = ctx;

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
      } catch (error) { c.status(400).json({ error: error instanceof Error ? error.message : 'Could not load health.' }); }
    });

    // ---- Maintenance windows shown on the public status page ------------------------------------
    app.post('/api/maintenances', async (c: Context) => {
      if (!await requireStatusAdmin(ctx, req, res)) return;
      try {
        const body = (c.body || {}) as Record<string, any>;
        const title = cleanText(body.title, 90);
        const description = cleanText(body.description, 600);
        const startsAt = new Date(body.startsAt);
        const endsAt = new Date(body.endsAt);
        if (!title) throw new Error('Give the maintenance a title.');
        if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) throw new Error('Choose a start and an end time.');
        if (endsAt <= startsAt) throw new Error('The end must be after the start.');
        const affects = (Array.isArray(body.affects) ? body.affects : []).map(String).filter((key: string) => COMPONENTS.includes(key));
        const { data, error } = await supabase.from('status_maintenances').insert({ title, description, starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), affects, updates: [{ at: new Date().toISOString(), text: 'Maintenance scheduled.' }] }).select('id').single();
        if (error) return dbFailure(c, error);
        c.json({ ok: true, id: String(data.id) });
      } catch (error) { c.status(400).json({ error: error instanceof Error ? error.message : 'Invalid maintenance.' }); }
    });

    app.post('/api/maintenances/:id/end', async (c: Context) => {
      if (!await requireStatusAdmin(ctx, req, res)) return;
      const id = String(c.params.id || '');
      if (!uuid.test(id)) return c.status(400).json({ error: 'Invalid maintenance.' });
      const { data: row, error } = await supabase.from('status_maintenances').select('*').eq('id', id).maybeSingle();
      if (error) return dbFailure(c, error);
      if (!row) return c.status(404).json({ error: 'Maintenance not found.' });
      const started = new Date(row.starts_at).getTime() <= Date.now();
      const updates = [...(Array.isArray(row.updates) ? row.updates : []), { at: new Date().toISOString(), text: started ? 'Maintenance completed.' : 'Maintenance cancelled.' }];
      const saved = await supabase.from('status_maintenances').update({ ended_early: true, ended_at: new Date().toISOString(), updates }).eq('id', id);
      if (saved.error) return dbFailure(c, saved.error);
      c.json({ ok: true });
    });

    app.delete('/api/maintenances/:id', async (c: Context) => {
      if (!await requireStatusAdmin(ctx, req, res)) return;
      const id = String(c.params.id || '');
      if (!uuid.test(id)) return c.status(400).json({ error: 'Invalid maintenance.' });
      const { error } = await supabase.from('status_maintenances').delete().eq('id', id);
      if (error) return dbFailure(c, error);
      c.json({ ok: true });
    });

    // ---- Status posts ("tweets"): announcements shown on the public status page ------------------
    const postInput = (body: any) => {
      const title = cleanText(body?.title, 120);
      if (!title) throw new Error('Give the update a title.');
      return { title, body: cleanText(body?.body, 2000), kind: POST_KINDS.includes(String(body?.kind)) ? String(body.kind) : 'update', pinned: Boolean(body?.pinned) };
    };
    // Optional Discord copy of a post. The channel must belong to the server the admin is managing.
    const announcePost = async (req: Request, post: { kind: string; title: string; body: string; author_name: string }, channelId: string) => {
      if (!/^\d{15,22}$/.test(channelId)) return false;
      const channel: any = await discord.channels.fetch(channelId).catch(() => null);
      if (!channel?.isTextBased?.() || !('send' in channel) || channel.guildId !== ctx.selectedGuildId(c)) throw new Error('Choose a text channel in this server.');
      const color = ({ incident: 0xe9697b, resolved: 0x4fc08d, maintenance: 0xe0b04f, announcement: 0x8175f5, update: 0x8175f5 } as Record<string, number>)[post.kind] ?? 0x8175f5;
      const kindLabel = ({ incident: 'Incident', resolved: 'Resolved', maintenance: 'Maintenance', announcement: 'Announcement', update: 'Update' } as Record<string, string>)[post.kind] || 'Update';
      const statusUrl = `${env.dashboardUrl}/status`;
      const embed = new EmbedBuilder().setColor(color).setAuthor({ name: kindLabel }).setTitle(String(post.title).slice(0, 256)).setFooter({ text: `${post.author_name || 'Rift'} · Status page` });
      if (post.body) embed.setDescription(String(post.body).slice(0, 4000));
      await channel.send({
        allowedMentions: { parse: [] }, embeds: [embed],
        ...(statusUrl.startsWith('http') ? { components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(statusUrl).setLabel('Open status page').setEmoji('📡'))] } : {}),
      });
      return true;
    };
    const list = async () => {
      const { data, error } = await supabase.from('status_posts').select('*').order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      return (data ?? []).map(postView);
    };

    app.get('/api/status-posts', async (c: Context) => {
      if (!await requireStatusAdmin(ctx, req, res)) return;
      try { c.json({ posts: await list() }); } catch (error) { failure(c, error, 'Could not load the updates.'); }
    });
    app.post('/api/status-posts', async (c: Context) => {
      if (!await requireStatusAdmin(ctx, req, res)) return;
      try {
        const user = ctx.sessionUser(c);
        const input = postInput(c.body);
        const avatar = user?.avatar ? (String(user.avatar).startsWith('http') ? user.avatar : `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`) : '';
        const { data, error } = await supabase.from('status_posts').insert({ ...input, author_id: user?.id || '', author_name: user?.username || '', author_avatar: avatar }).select('*').single();
        if (error) return dbFailure(c, error);
        const announced = c.body?.channelId ? await announcePost(c, data, String(c.body.channelId)) : false;
        c.json({ post: postView(data), announced });
      } catch (error) { failure(c, error, 'Invalid update.'); }
    });
    app.patch('/api/status-posts/:id', async (c: Context) => {
      if (!await requireStatusAdmin(ctx, req, res)) return;
      const id = String(c.params.id || '');
      if (!uuid.test(id)) return c.status(400).json({ error: 'Invalid update.' });
      try {
        const { data, error } = await supabase.from('status_posts').update({ ...postInput(c.body), updated_at: new Date().toISOString() }).eq('id', id).select('*').maybeSingle();
        if (error) return dbFailure(c, error);
        if (!data) return c.status(404).json({ error: 'Update not found.' });
        c.json({ post: postView(data) });
      } catch (error) { failure(c, error, 'Invalid update.'); }
    });
    app.delete('/api/status-posts/:id', async (c: Context) => {
      if (!await requireStatusAdmin(ctx, req, res)) return;
      const id = String(c.params.id || '');
      if (!uuid.test(id)) return c.status(400).json({ error: 'Invalid update.' });
      const { error } = await supabase.from('status_posts').delete().eq('id', id);
      if (error) return dbFailure(c, error);
      c.json({ ok: true });
    });

    mountPresenceRoutes(ctx);
  },
};
