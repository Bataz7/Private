import type { ButtonInteraction, ChatInputCommandInteraction, Client, Message, ModalSubmitInteraction, StringSelectMenuInteraction } from '../lib/djs/index.js';
import type { BotExtension } from './types.js';
import { studioBot } from '../studio/index.js';
import { modReportsExtension } from '../modreports/index.js';
import { applications } from '../applications/index.js';
import { leaveExtension } from '../leave/index.js';
import { coreExtension } from '../core/index.js';
import { statusBot } from '../status/index.js';

// Register feature modules here, one import and one array entry each.
export const bot: BotExtension[] = [studioBot, modReportsExtension, applications, coreExtension, leaveExtension, statusBot];

export const extensionCommands = () => bot.flatMap(extension => extension.commands ?? []);

export async function dispatchCommand(interaction: ChatInputCommandInteraction) {
  const command = extensionCommands().find(item => item.json.name === interaction.commandName);
  if (!command) return false;
  await command.handle(interaction);
  return true;
}
export async function dispatchButton(interaction: ButtonInteraction) { for (const extension of bot) if (extension.button && await extension.button(interaction)) return true; return false; }
export async function dispatchModal(interaction: ModalSubmitInteraction) { for (const extension of bot) if (extension.modal && await extension.modal(interaction)) return true; return false; }
export async function dispatchSelect(interaction: StringSelectMenuInteraction) { for (const extension of bot) if (extension.select && await extension.select(interaction)) return true; return false; }
export async function dispatchMessage(message: Message) {
  for (const extension of bot) {
    if (!extension.message) continue;
    try { if (await extension.message(message)) return true; } catch (error) { console.error(`Extension ${extension.name} message handler failed:`, error); }
  }
  return false;
}
export async function readyExtensions(client: Client) {
  for (const extension of bot) {
    try { await extension.ready?.(client); } catch (error) { console.error(`Extension ${extension.name} failed to start:`, error); }
  }
}

/** setInterval that skips a tick while the previous run is still going and never crashes the process. */
export function extensionTimer(name: string, ms: number, job: () => Promise<unknown> | unknown) {
  let running = false;
  return setInterval(async () => {
    if (running) return;
    running = true;
    try { await job(); } catch (error) { console.error(`Job ${name} failed:`, error); } finally { running = false; }
  }, ms);
}
