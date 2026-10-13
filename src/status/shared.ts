import { status } from '../utils/terminal.js';

export const MIGRATION_HINT = 'Run supabase/migrations/034_reports_status.sql and 035_status_posts.sql in the Supabase SQL editor.';

type DbError = { message?: string; code?: string } | null | undefined;

/** A missing table or column (the migrations have not been applied yet), as opposed to a real outage. */
export function isSchemaError(error: DbError) {
  if (!error) return false;
  return ['42P01', '42703', 'PGRST204', 'PGRST205', 'PGRST202', '42883'].includes(error.code || '') || /does not exist|schema cache|could not find the/i.test(error.message || '');
}

const warned = new Set<string>();
/** Logs a clear, one-time message when a status table or column is missing. */
export function warnSchema(scope: string, error: DbError) {
  if (!isSchemaError(error) || warned.has(scope)) return false;
  warned.add(scope);
  console.warn(`  ${status('warn', 'Status', `${scope} is not set up yet (${error?.message ?? 'missing table'}). ${MIGRATION_HINT}`)}`);
  return true;
}

export const DAY = 86_400_000;
export const MINUTE = 60_000;
export type State = 'operational' | 'degraded' | 'outage' | 'maintenance';

/** Background jobs the bot reports on: key, label, and how often they should run (seconds). */
export const WATCHDOGS: Array<[string, string, number]> = [['shifts', 'Shift watchdog', 60], ['roles', 'Role sync', 300], ['weekly', 'Weekly reports', 900]];
