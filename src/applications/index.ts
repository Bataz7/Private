import type { ButtonInteraction, ModalSubmitInteraction, StringSelectMenuInteraction } from '../lib/djs/index.js';
import type { BotExtension } from '../extensions/types.js';
import { extensionTimer } from '../extensions/index.js';
import { applicationsReady, ApplicationsSetupError } from '../services/application.service.js';
import { expireApplications, handleApplicationButton, handleApplicationMessage, handleApplicationModal, handleApplicationSelect } from './dm-flow.js';

const SETUP_HINT = 'التقديمات: جداول قاعدة البيانات ناقصة. افتح محرر SQL في Supabase وشغّل supabase/migrations/031_applications.sql، وبعدين أعد تشغيل البوت.';
let warned = false;
function warnOnce() { if (warned) return; warned = true; console.error(SETUP_HINT); }

type AnyInteraction = ButtonInteraction | ModalSubmitInteraction | StringSelectMenuInteraction;

// Runs an application handler; a missing-tables error becomes a clear message for the user and one log line, never a crash.
async function guarded(interaction: AnyInteraction, run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    if (!(error instanceof ApplicationsSetupError)) throw error;
    warnOnce();
    const payload = { content: '⚠️ التقديمات مو جاهزة للحين. اطلب من أحد الأدمن يكمّل إعداد قاعدة البيانات.', flags: 64 as const };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => undefined);
    else await interaction.reply(payload).catch(() => undefined);
  }
}

export const applications: BotExtension = {
  name: 'applications',
  async button(interaction) {
    if (!interaction.customId.startsWith('app_')) return false;
    await guarded(interaction, () => handleApplicationButton(interaction));
    return true;
  },
  async select(interaction) {
    if (!interaction.customId.startsWith('app_')) return false;
    await guarded(interaction, () => handleApplicationSelect(interaction));
    return true;
  },
  async modal(interaction) {
    if (!interaction.customId.startsWith('app_')) return false;
    await guarded(interaction, () => handleApplicationModal(interaction));
    return true;
  },
  // Typed answers in DMs. Returns true only when the message belonged to an application in progress.
  async message(message) {
    if (message.guild || message.author.bot) return false;
    try {
      return await handleApplicationMessage(message);
    } catch (error) {
      if (error instanceof ApplicationsSetupError) { warnOnce(); return false; }
      throw error;
    }
  },
  async ready(client) {
    const status = await applicationsReady();
    if (!status.ok) {
      if (status.missing) warnOnce(); else console.error(`Applications: could not reach the database (${status.message}).`);
    }
    // DM sessions that went quiet are closed by this watchdog.
    extensionTimer('applications', 60_000, async () => {
      try { await expireApplications(client); } catch (error) { if (!(error instanceof ApplicationsSetupError)) throw error; }
    });
  },
};
