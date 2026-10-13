import { supabase } from '../supabase/client.js';

// Raw Supabase helpers for what SupabaseModel cannot do (conditional updates that must win only once, range and "in" filters).
// Column names follow one rule (camelCase -> snake_case), which is how every column of the leave tables is named.
export type RequestTable = 'leave_requests' | 'resignation_requests';
const snake = (key: string) => key.replace(/[A-Z]/g, char => `_${char.toLowerCase()}`);
const unwrap = (value: unknown) => (value instanceof Date ? value.toISOString() : value);

export function toDbPatch(patch: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(patch).map(([key, value]) => [snake(key), unwrap(value)]));
}

/**
 * Updates the row only while it still matches `expect` (for example `{ status: 'pending' }`), in one statement.
 * Returns false when nobody matched, so two administrators pressing together can never both decide the same request.
 */
export async function claim(table: RequestTable, id: number | string, expect: Record<string, unknown>, patch: Record<string, unknown>) {
  let query: any = supabase.from(table).update(toDbPatch(patch)).eq('id', id);
  for (const [key, value] of Object.entries(expect)) query = value === null ? query.is(snake(key), null) : query.eq(snake(key), unwrap(value));
  const { data, error } = await query.select('id');
  if (error) throw new Error(`Supabase ${table} update failed: ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}

/** Plain update by id (no condition). */
export async function patchRow(table: RequestTable, id: number | string, patch: Record<string, unknown>) {
  const { error } = await supabase.from(table).update(toDbPatch(patch)).eq('id', id);
  if (error) throw new Error(`Supabase ${table} update failed: ${error.message}`);
}

/** A numeric id from a button, route or command, or null when it cannot be one. */
export function toId(value: unknown) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// ---- schema guard: a missing migration is reported clearly instead of crashing the bot ---------------
let schemaOk: boolean | null = null;
let schemaChecked = 0;
const NEEDED: Array<[string, string]> = [
  ['leave_requests', 'id,activated_at,dm_message_id,decision_note,extension_end_date,end_reminder_count,review_channel_id,review_message_id'],
  ['resignation_requests', 'id,dm_message_id,decision_note,confirmation_sent_at,review_channel_id,review_message_id'],
  ['request_panel_settings', 'guild_id,leave_panel_channel_id,resignation_panel_channel_id'],
];

export const MIGRATION_HINT = 'The leave system needs the database update 029_leave_resignation_system.sql. Run it in the Supabase SQL editor, then restart.';

/** Checks (at most once a minute while failing) that migration 029 has been applied. */
export async function schemaReady(force = false) {
  if (!force && schemaOk === true) return true;
  if (!force && schemaOk === false && Date.now() - schemaChecked < 60_000) return false;
  schemaChecked = Date.now();
  for (const [table, columns] of NEEDED) {
    const { error } = await supabase.from(table).select(columns).limit(1);
    if (error) {
      if (schemaOk !== false) console.error(`[leave] ${MIGRATION_HINT} (${table}: ${error.message})`);
      schemaOk = false;
      return false;
    }
  }
  schemaOk = true;
  return true;
}
