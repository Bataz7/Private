import { ActivityType, type ActivitiesOptions, type Client, type PresenceStatusData } from '../lib/djs/index.js';
import { env } from '../config/env.js';
import { supabase } from '../supabase/client.js';

// One presence shared by every server, read from the main server's settings (GUILD_ID, or the first server).
// Used by the bot process (rotation) and by the dashboard (variables for the preview).
export const PRESENCE_TYPES = ['custom', 'playing', 'streaming', 'listening', 'watching', 'competing'] as const;
export type PresenceType = typeof PRESENCE_TYPES[number];
export type PresenceEntry = { text: string; type: PresenceType };
export type PresenceConfig = { status: PresenceStatusData; entries: PresenceEntry[]; interval: number; mode: 'sequence' | 'random'; url: string };
export const PRESENCE_VARIABLES = ['servers', 'members', 'staff', 'onshift', 'server'] as const;
const VARIABLE_PATTERN = /\{(servers|members|staff|onshift|server)\}/g;

const TYPE_MAP: Record<PresenceType, ActivityType> = { custom: ActivityType.Custom, playing: ActivityType.Playing, streaming: ActivityType.Streaming, listening: ActivityType.Listening, watching: ActivityType.Watching, competing: ActivityType.Competing };
const STATUSES = ['online', 'idle', 'dnd', 'invisible'] as const;

/** Lines from the dashboard ({ text, type }) or older plain strings (which take the single type saved before). */
export function cleanEntries(raw: unknown, fallbackType: string): PresenceEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 25).map(item => {
    const entry = typeof item === 'string' ? { text: item, type: fallbackType } : (item as Record<string, unknown>) || {};
    const type = PRESENCE_TYPES.includes(String(entry.type) as PresenceType) ? String(entry.type) as PresenceType : 'playing';
    return { text: String(entry.text ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 128), type };
  }).filter(entry => entry.text);
}

/** Presence settings from a raw guild_settings row. Columns from migration 034 (presence_entries, custom_status_mode) are optional. */
export function presenceConfig(row: Record<string, any> | null | undefined): PresenceConfig {
  const fallbackType = String(row?.custom_status_type || 'playing');
  let entries = cleanEntries(row?.presence_entries, fallbackType);
  if (!entries.length) entries = cleanEntries(row?.custom_statuses, fallbackType);
  return {
    status: (STATUSES as readonly string[]).includes(row?.bot_status) ? row!.bot_status : 'idle',
    entries,
    interval: Math.max(10, Math.min(3600, Number(row?.custom_status_interval) || 30)),
    mode: row?.custom_status_mode === 'random' ? 'random' : 'sequence',
    url: String(row?.custom_status_url || ''),
  };
}

export const hasVariables = (entries: PresenceEntry[]) => entries.some(entry => /\{(servers|members|staff|onshift|server)\}/.test(entry.text));

let cachedVars: { at: number; value: Record<string, string> } | null = null;
/** Live numbers for the {servers} {members} {staff} {onshift} {server} placeholders (cached for 20 seconds). */
export async function presenceVariables(client: Client): Promise<Record<string, string>> {
  if (cachedVars && Date.now() - cachedVars.at < 20_000) return cachedVars.value;
  const guilds = [...client.guilds.cache.values()];
  const main = (env.guildId && client.guilds.cache.get(env.guildId)) || guilds[0];
  const count = async (table: string, filters: Record<string, unknown>) => {
    let query = supabase.from(table).select('id', { count: 'exact', head: true });
    for (const [key, value] of Object.entries(filters)) query = query.eq(key, value as never);
    const { count: total } = await query;
    return total ?? 0;
  };
  const [staff, onshift] = main ? await Promise.all([count('staff', { guild_id: main.id, active: true }).catch(() => 0), count('shifts', { guild_id: main.id, status: 'active' }).catch(() => 0)]) : [0, 0];
  const format = (value: number) => value.toLocaleString('en-US');
  const value = { servers: format(guilds.length), members: format(guilds.reduce((sum, guild) => sum + (guild.memberCount || 0), 0)), staff: format(staff), onshift: format(onshift), server: main?.name || '' };
  cachedVars = { at: Date.now(), value };
  return value;
}

export function fillPresence(text: string, vars: Record<string, string>) {
  return text.replace(VARIABLE_PATTERN, (_, key: string) => vars[key] ?? '').slice(0, 128) || 'Rift Staff Operations';
}

export function activityFor(entry: PresenceEntry, config: PresenceConfig, vars: Record<string, string>): ActivitiesOptions {
  const text = fillPresence(entry.text, vars);
  const type = TYPE_MAP[entry.type] ?? ActivityType.Playing;
  // Custom statuses show `state` as the text; Discord ignores `name` for them.
  if (type === ActivityType.Custom) return { name: 'Custom Status', type, state: text };
  if (type === ActivityType.Streaming && config.url) return { name: text, type, url: config.url };
  // Streaming needs a Twitch or YouTube link; without one it shows as Playing.
  return { name: text, type: type === ActivityType.Streaming ? ActivityType.Playing : type };
}

export function validStreamUrl(value: string) {
  return !value || /^https:\/\/((www|m)\.)?(twitch\.tv|youtube\.com|youtu\.be)\/[\w\-./?=&%@]+$/i.test(value);
}

// ---- Bot process: apply and rotate ---------------------------------------------------------------
let rotationTimer: NodeJS.Timeout | undefined;
let appliedSignature = '';
let reapply: (() => Promise<void>) | null = null;
let lastApplied = 0;
let warned = false;

/**
 * Applies the saved presence to the bot. Called every couple of seconds: it only does work when the saved settings changed,
 * and it re-asserts the presence every 10 minutes (another session with the same token, such as the dashboard, can replace it).
 */
let syncing = false;
export async function syncBotPresence(bot: Client) {
  if (syncing) return;
  syncing = true;
  try { await syncOnce(bot); } finally { syncing = false; }
}

async function syncOnce(bot: Client) {
  const guildId = env.guildId || bot.guilds.cache.first()?.id;
  if (!guildId || !bot.user) return;
  const { data, error } = await supabase.from('guild_settings').select('*').eq('guild_id', guildId).maybeSingle();
  if (error) {
    // A failed read must never blank the presence: keep what is shown.
    if (!warned) { warned = true; console.error(`Presence sync skipped: ${error.message}`); }
    return;
  }
  warned = false;
  const config = presenceConfig(data);
  const signature = JSON.stringify(config);
  if (signature === appliedSignature) {
    if (reapply && Date.now() - lastApplied > 10 * 60_000) await reapply().catch(() => undefined);
    return;
  }
  appliedSignature = signature;
  if (rotationTimer) { clearInterval(rotationTimer); rotationTimer = undefined; }
  let index = 0;
  const apply = async () => {
    const vars = await presenceVariables(bot).catch(() => ({}) as Record<string, string>);
    const entry = config.entries[index % Math.max(1, config.entries.length)];
    bot.user?.setPresence({ status: config.status, activities: entry ? [activityFor(entry, config, vars)] : [] });
    lastApplied = Date.now();
  };
  reapply = apply;
  await apply();
  // A single line only needs refreshing when it shows live numbers.
  if (config.entries.length > 1 || hasVariables(config.entries)) {
    rotationTimer = setInterval(() => {
      if (config.entries.length > 1) index = config.mode === 'random' ? (index + 1 + Math.floor(Math.random() * (config.entries.length - 1))) % config.entries.length : (index + 1) % config.entries.length;
      apply().catch(error => console.error('Presence rotation failed:', error));
    }, Math.max(config.interval, config.entries.length > 1 ? 10 : 60) * 1000);
  }
}
