import { createClient } from '../lib/supabase/index.js';
import { env } from '../config/env.js';

export const supabase = createClient(env.supabaseUrl, env.supabaseKey, {
  global: { headers: { 'x-client-info': 'rift-staff-management-bot' } }
});
