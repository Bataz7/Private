import type { BotExtension } from '../extensions/types.js';
import { extensionTimer } from '../extensions/index.js';
import { disciplineCommands, handleDisciplineButton } from './commands.js';
import { handlePresenceButton } from '../services/presence-check.service.js';
import { LEADERBOARD_REFRESH_MS, runLeaderboards } from '../services/leaderboard.service.js';
import { bindWarningsClient } from '../core/warnings.js';

// التأديب (فصل/إنذار/مزامنة)، زر «موجود ✅» لتحقق التواجد، ولوحة المتصدرين الأسبوعية (كل 10 دقايق).
export const disciplineExtension: BotExtension = {
  name: 'discipline',
  commands: disciplineCommands,
  async button(i) { return (await handlePresenceButton(i)) || (await handleDisciplineButton(i)); },
  ready(client) {
    bindWarningsClient(client);
    setTimeout(() => { void runLeaderboards(client).catch(error => console.error('Leaderboard failed:', error)); }, 30_000);
    extensionTimer('leaderboard', LEADERBOARD_REFRESH_MS, () => runLeaderboards(client));
  },
};
