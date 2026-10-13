import type { Context } from '../web/server/http.js';
import type { DashboardContext } from '../dashboard/extensions.js';
import { env } from '../config/env.js';
import { supabase } from '../supabase/client.js';
import { PRESENCE_TYPES, cleanEntries, presenceConfig, presenceVariables, validStreamUrl } from '../services/presence.service.js';
import { isSchemaError } from './shared.js';
import type { Mount } from '../web/server/router.js';
import { rateLimit } from '../web/server/security.js';

const STATUSES = ['online', 'idle', 'dnd', 'invisible'];

/** The presence is shared by every server, so only the main server (GUILD_ID) can change it. */
function ownsPresence(ctx: DashboardContext, c: Context) {
  if (!env.guildId || ctx.selectedGuildId(c) === env.guildId) return true;
  c.status(403).json({ error: 'حالة البوت مشتركة بين كل السيرفرات، وتتغيّر من السيرفر الرئيسي بس.' });
  return false;
}

export function mountPresenceRoutes(ctx: DashboardContext, app: Mount) {
  const { discord } = ctx;
  const writeLimit = rateLimit('presence-writes', 60_000, 20);

  app.get('/api/bot/status', async (c: Context) => {
    if (!await ctx.requireAdministrator(c)) return;
    try {
      const guildId = ctx.selectedGuildId(c);
      const { data } = await supabase.from('guild_settings').select('*').eq('guild_id', guildId).maybeSingle();
      const config = presenceConfig(data);
      const vars = await presenceVariables(discord).catch(() => ({}));
      const bot = discord.user ? { username: discord.user.username, avatar: discord.user.displayAvatarURL({ extension: 'png', size: 128 }) } : null;
      c.json({
        botStatus: config.status, config, vars, bot, editable: !env.guildId || guildId === env.guildId, online: discord.isReady(),
        settings: { customStatusUrl: config.url }, configured: Boolean(data), migrated: Boolean(data) && 'presence_entries' in data,
      });
    } catch (error) { c.status(400).json({ error: 'تعذّر تحميل حالة البوت.' }); }
  });

  app.patch('/api/bot/status', async (c: Context) => {
    if (!await ctx.requireAdministrator(c) || !ownsPresence(ctx, c)) return;
    const status = String(c.body?.status || '');
    if (!STATUSES.includes(status)) return c.status(400).json({ error: 'اختر حالة ديسكورد صحيحة.' });
    const { error } = await supabase.from('guild_settings').update({ bot_status: status }).eq('guild_id', ctx.selectedGuildId(c));
    if (error) return c.status(400).json({ error: 'تعذّر حفظ حالة البوت.' });
    c.json({ ok: true, status });
  }, { guards: [writeLimit] });

  // The bot process notices the change within a few seconds and applies it.
  app.patch('/api/bot/custom-status', async (c: Context) => {
    if (!await ctx.requireAdministrator(c) || !ownsPresence(ctx, c)) return;
    const guildId = ctx.selectedGuildId(c);
    const body = (typeof c.body === 'object' && c.body ? c.body : {}) as Record<string, any>;
    const updates: Record<string, unknown> = {};
    let entries: ReturnType<typeof cleanEntries> | null = null;
    if (body.entries !== undefined) {
      entries = cleanEntries(body.entries, 'playing');
      updates.presence_entries = entries;
      updates.custom_statuses = entries.map(entry => entry.text);
      if (entries[0]) updates.custom_status_type = entries[0].type;
    } else if (Array.isArray(body.statuses)) updates.custom_statuses = (body.statuses as unknown[]).map(item => String(item).trim().slice(0, 128)).filter(Boolean).slice(0, 25);
    if (body.interval !== undefined) updates.custom_status_interval = Math.max(10, Math.min(3600, Number(body.interval) || 30));
    if (body.mode !== undefined) updates.custom_status_mode = body.mode === 'random' ? 'random' : 'sequence';
    if (body.activityType !== undefined) updates.custom_status_type = PRESENCE_TYPES.includes(String(body.activityType) as never) ? String(body.activityType) : 'playing';
    if (body.streamUrl !== undefined) {
      const url = String(body.streamUrl || '').trim().slice(0, 300);
      const streaming = Boolean(entries?.some(entry => entry.type === 'streaming'));
      // The link only matters for Streaming lines; an old saved link must not block saving anything else.
      if (!validStreamUrl(url)) {
        if (streaming) return c.status(400).json({ error: 'رابط البث لازم يكون من Twitch أو YouTube، مثل https://twitch.tv/yourchannel.' });
      } else updates.custom_status_url = url;
    }
    if (body.status !== undefined) {
      if (!STATUSES.includes(String(body.status))) return c.status(400).json({ error: 'اختر حالة ديسكورد صحيحة.' });
      updates.bot_status = String(body.status);
    }
    if (!Object.keys(updates).length) return c.json({ ok: true });
    let { error } = await supabase.from('guild_settings').update(updates).eq('guild_id', guildId);
    let warning: string | undefined;
    if (error && isSchemaError(error)) {
      // Migration 034 is missing: save what the old columns can hold (lines share the first line's type).
      console.warn('[status] Per-line bot status types need migration 034_reports_status.sql; saved the lines without them.');
      delete updates.presence_entries; delete updates.custom_status_mode;
      warning = 'انحفظ، بس نوع لكل سطر والترتيب العشوائي يحتاجون تحديث قاعدة البيانات 034_reports_status.sql.';
      ({ error } = await supabase.from('guild_settings').update(updates).eq('guild_id', guildId));
    }
    if (error) return c.status(400).json({ error: 'تعذّر حفظ حالة البوت.' });
    c.json({ ok: true, warning });
  }, { guards: [writeLimit] });
}
