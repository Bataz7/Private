import type { BotExtension } from '../extensions/types.js';
import { extensionTimer } from '../extensions/index.js';
import { bindShutdown, markJob, pruneSamples, publishHeartbeat, recordStartup } from './heartbeat.js';

/** Publishes the bot heartbeat, metrics samples and restart/downtime records that the public status page and System health read. */
export const statusBot: BotExtension = {
  name: 'status',
  async ready(client) {
    bindShutdown();
    // Role sync already ran once during startup, before this hook.
    markJob('roles');
    await recordStartup().catch(error => console.error('Startup record failed:', error));
    await publishHeartbeat(client).catch(error => console.error('Heartbeat failed:', error));
    extensionTimer('status-heartbeat', 15_000, () => publishHeartbeat(client));
    extensionTimer('status-prune', 6 * 3_600_000, () => pruneSamples());
  },
};
