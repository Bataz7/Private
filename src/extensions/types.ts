import type { ButtonInteraction, ChatInputCommandInteraction, Client, Message, ModalSubmitInteraction, RESTPostAPIChatInputApplicationCommandsJSONBody, StringSelectMenuInteraction } from 'discord.js';

/**
 * A feature module of the bot. Each ported Melyx feature exports one BotExtension and adds it to `bot` in
 * `src/extensions/index.ts`. Every handler returns true when it handled the interaction, so the next module (and finally
 * the built-in handlers) only see what nobody claimed.
 */
export interface BotExtension {
  name: string;
  /** Slash commands this module owns. A command with the same name as a built-in one replaces it. */
  commands?: Array<{ json: RESTPostAPIChatInputApplicationCommandsJSONBody; handle: (interaction: ChatInputCommandInteraction) => Promise<void> | void }>;
  button?: (interaction: ButtonInteraction) => Promise<boolean> | boolean;
  modal?: (interaction: ModalSubmitInteraction) => Promise<boolean> | boolean;
  select?: (interaction: StringSelectMenuInteraction) => Promise<boolean> | boolean;
  /** Every non-bot guild or DM message. Return true to stop other modules from seeing it (used by DM flows). */
  message?: (message: Message) => Promise<boolean | void> | boolean | void;
  /** Called once the bot is connected and the database checked. Start timers here (use extensionTimer). */
  ready?: (client: Client) => Promise<void> | void;
}
