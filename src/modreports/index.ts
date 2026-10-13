import type { BotExtension } from '../extensions/types.js';
import { supabase } from '../supabase/client.js';
import { handleModReportButton, handleModReportModal } from './interactions.js';

const OWN_ID = /^mr_(open|retry|mine|approve|reject|note|reopen|modal|notemodal|rejectmodal):/;

/** Moderation reports: Submit report / My reports panels, the review card with Approve, Reject and Note, points, DMs. */
export const modReportsExtension: BotExtension = {
  name: 'modreports',
  button: async interaction => {
    if (!OWN_ID.test(interaction.customId)) return false;
    await handleModReportButton(interaction);
    return true;
  },
  modal: async interaction => {
    if (!OWN_ID.test(interaction.customId)) return false;
    await handleModReportModal(interaction);
    return true;
  },
  ready: async () => {
    // A missing table must never stop the bot: say what to run and carry on.
    const { error } = await supabase.from('mod_reports').select('id').limit(1);
    if (!error) return;
    const missing = error.code === 'PGRST205' || error.code === '42P01' || /schema cache|does not exist/i.test(error.message);
    console.warn(missing
      ? '[modreports] Table mod_reports is missing. Run supabase/migrations/032_mod_reports.sql in the Supabase SQL Editor; moderation reports stay unavailable until then.'
      : `[modreports] Could not check the mod_reports table: ${error.message}`);
  },
};
