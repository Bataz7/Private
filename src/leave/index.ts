import { Events } from 'discord.js';
import type { BotExtension } from '../extensions/types.js';
import { extensionTimer } from '../extensions/index.js';
import { leaveCommands } from './commands.js';
import { schemaReady } from './db.js';
import { handleLeaveButton, handleLeaveModal } from './interactions.js';
import { closeOpenLeaves, runLeaveWatchdog } from './lifecycle.js';
import { runResignationMonitor } from './resignation.js';

/**
 * Leave, resignation and "my requests" (ported from Melyx).
 *  - two channels per type: the panel channel (members press the button) and the requests channel (review cards for administrators)
 *  - approve / reject by administrators only, leave role + saved staff roles restored by the "I came back" button
 *  - end-of-leave reminders every day, "I need more time" requests, direct extension by an administrator
 *  - resignation: approve, then a confirmation DM on the last day that removes only the configured staff role
 */
export const leaveExtension: BotExtension = {
  name: 'leave',
  commands: leaveCommands,
  button: handleLeaveButton,
  modal: handleLeaveModal,
  async ready(client) {
    // A missing migration is reported (once) and never stops the bot; the jobs simply wait until the tables exist.
    await schemaReady(true);
    extensionTimer('leave-watchdog', 60_000, async () => { if (await schemaReady()) await runLeaveWatchdog(client); });
    extensionTimer('resignation-monitor', 60_000, async () => { if (await schemaReady()) await runResignationMonitor(client); });
    // Someone who leaves the server must not get roles back later through an old "I came back" button.
    client.on(Events.GuildMemberRemove, member => {
      schemaReady().then(ok => (ok ? closeOpenLeaves(member.guild.id, member.id) : undefined)).catch(error => console.error('Closing leaves of a departed member failed:', error));
    });
  },
};
