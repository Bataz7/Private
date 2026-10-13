import { ActionRowBuilder, EmbedBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from 'discord.js';

export interface ShiftPanelOptions { messages?: number; windowMinutes?: number; idleMinutes?: number; enabled?: boolean }

export function buildShiftPanel(options: ShiftPanelOptions = {}) {
  const messages = options.messages ?? 20;
  const windowMinutes = options.windowMinutes ?? 10;
  const idleMinutes = options.idleMinutes ?? 30;
  const menu = new StringSelectMenuBuilder()
    .setCustomId('shift_panel_action')
    .setPlaceholder('Take control of your shift…')
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel('Start shift').setDescription('Clock in right now').setEmoji('▶️').setValue('start'),
      new StringSelectMenuOptionBuilder().setLabel('End shift').setDescription('Clock out and finish your session').setEmoji('⏹️').setValue('end'),
      new StringSelectMenuOptionBuilder().setLabel('Break / resume').setDescription('Pause or resume the current shift').setEmoji('⏸️').setValue('break'),
      new StringSelectMenuOptionBuilder().setLabel('My stats').setDescription('Your current shift and recent hours').setEmoji('📊').setValue('stats'),
      new StringSelectMenuOptionBuilder().setLabel('Who is on shift').setDescription('See the staff currently on duty').setEmoji('🛡️').setValue('active')
    );
  const automatic = options.enabled === false
    ? '⏸️ Automatic shifts are turned off on this server. Start and end your shift with the menu.'
    : [
      `▶️ **Starts by itself** when you send **${messages} messages** within **${windowMinutes} minutes**, or join an unmuted voice channel.`,
      `⏹️ **Ends by itself** after **${idleMinutes} minutes** without a message or voice activity. The idle wait is never counted.`,
    ].join('\n');
  return {
    embeds: [new EmbedBuilder()
      .setColor(0x8175f5)
      .setTitle('⏱️ Staff Shift Panel')
      .setDescription(`Your shifts run on their own. Use the menu only when you want to take control.\n\n${automatic}`)
      .addFields(
        { name: '🕒 Manual end', value: 'After at least 30 minutes', inline: true },
        { name: '⌛ Longest shift', value: '12 hours', inline: true },
        { name: '💎 Points', value: '1 per 30 min on shift · 3 per 100 messages · 1 per 30 min in voice', inline: false }
      )
      .setFooter({ text: 'Rift Staff Operations' })],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)]
  };
}
