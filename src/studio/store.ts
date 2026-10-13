import { supabase } from '../supabase/client.js';
import { UUID, type StudioDoc } from './schema.js';

export interface SentRef { channelId: string; messageId: string; at: string }
export interface StudioRow { id: string; guildId: string; name: string; data: StudioDoc; sent: SentRef[]; createdBy: string; updatedBy: string; createdAt: string; updatedAt: string }

/** The migration has not been applied yet. */
export class StudioSetupError extends Error {
  constructor() { super('استوديو الرسائل ما انضبط للحين: شغّل supabase/migrations/033_embed_studio.sql في محرر SQL في Supabase.'); }
}

const TABLE = 'studio_messages';
let warned = false;
const isMissing = (error: { code?: string; message?: string } | null) => Boolean(error && (error.code === '42P01' || error.code === 'PGRST205' || /studio_messages/.test(error.message || '') && /(does not exist|schema cache)/i.test(error.message || '')));

function check(error: { code?: string; message?: string } | null) {
  if (!error) return;
  if (isMissing(error)) {
    if (!warned) { warned = true; console.error('[studio] The studio_messages table is missing. Run supabase/migrations/033_embed_studio.sql in Supabase; Embed Studio stays unavailable until then.'); }
    throw new StudioSetupError();
  }
  throw new Error(`Supabase ${TABLE} failed: ${error.message}`);
}

const fromDb = (row: Record<string, any>): StudioRow => ({
  id: row.id, guildId: row.guild_id, name: row.name, data: row.data, sent: Array.isArray(row.sent) ? row.sent : [],
  createdBy: row.created_by || '', updatedBy: row.updated_by || '', createdAt: row.created_at, updatedAt: row.updated_at,
});

export async function listStudio(guildId: string) {
  const { data, error } = await supabase.from(TABLE).select('*').eq('guild_id', guildId).order('updated_at', { ascending: false }).limit(200);
  check(error);
  return (data ?? []).map(fromDb);
}

export async function countStudio(guildId: string) {
  const { count, error } = await supabase.from(TABLE).select('id', { count: 'exact', head: true }).eq('guild_id', guildId);
  check(error);
  return count ?? 0;
}

export async function getStudio(id: string) {
  if (!UUID.test(id)) return null;
  const { data, error } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle();
  check(error);
  return data ? fromDb(data) : null;
}

export async function createStudio(input: { guildId: string; name: string; data: StudioDoc; userId: string }) {
  const { data, error } = await supabase.from(TABLE).insert({ guild_id: input.guildId, name: input.name, data: input.data, created_by: input.userId, updated_by: input.userId }).select('*').single();
  check(error);
  return fromDb(data!);
}

export async function updateStudio(id: string, patch: { name?: string; data?: StudioDoc; sent?: SentRef[]; userId?: string }) {
  const values: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) values.name = patch.name;
  if (patch.data !== undefined) values.data = patch.data;
  if (patch.sent !== undefined) values.sent = patch.sent;
  if (patch.userId) values.updated_by = patch.userId;
  const { data, error } = await supabase.from(TABLE).update(values).eq('id', id).select('*').single();
  check(error);
  return fromDb(data!);
}

export async function deleteStudio(id: string) {
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  check(error);
}

/** True when the table exists (used once at startup so the bot can say clearly what is missing). */
export async function studioTableReady() {
  const { error } = await supabase.from(TABLE).select('id', { head: true, count: 'exact' }).limit(1);
  if (isMissing(error)) return false;
  return true;
}
