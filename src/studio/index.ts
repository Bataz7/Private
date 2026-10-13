import type { BotExtension } from '../extensions/types.js';
import { handleStudioComponent, handleStudioModal } from './runtime.js';
import { studioTableReady } from './store.js';

// Buttons and select menus of Embed Studio messages have custom ids "es:<message>:<component>";
// question forms (modals) use "esf:<message>:<owner>".
export const studioBot: BotExtension = {
  name: 'studio',
  button: async interaction => {
    if (!interaction.customId.startsWith('es:')) return false;
    await handleStudioComponent(interaction);
    return true;
  },
  select: async interaction => {
    if (!interaction.customId.startsWith('es:')) return false;
    await handleStudioComponent(interaction);
    return true;
  },
  modal: async interaction => {
    if (!interaction.customId.startsWith('esf:')) return false;
    await handleStudioModal(interaction);
    return true;
  },
  ready: async () => {
    if (!await studioTableReady().catch(() => true)) console.error('[studio] استوديو الرسائل متوقف: جدول studio_messages ناقص. شغّل supabase/migrations/033_embed_studio.sql في Supabase.');
  },
};

export default studioBot;
