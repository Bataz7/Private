import {
  LabelBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  type ButtonInteraction, type GuildMember, type ModalSubmitInteraction, type StringSelectMenuInteraction,
} from 'discord.js';
import { getSettings } from '../services/settings.service.js';
import { createLog } from '../services/log.service.js';
import { BRAND_COLOR } from '../utils/emoji.js';
import { isDangerousRole } from './roles.js';
import { getStudio, type StudioRow } from './store.js';
import { UUID, fill, findInteractive, renderDoc, type Action, type Vars } from './schema.js';

type Interaction = ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction;
const cache = new Map<string, { at: number; row: StudioRow | null }>();
const ephemeral = 64 as const;
// Any member can press a studio button, so each person gets a short cooldown per message (no log or channel flooding).
const lastPress = new Map<string, number>();
function tooFast(userId: string, docId: string) {
  const key = `${docId}:${userId}`; const now = Date.now();
  if (now - (lastPress.get(key) || 0) < 3000) return true;
  lastPress.set(key, now);
  if (lastPress.size > 5000) lastPress.clear();
  return false;
}
// Roles that decide who is staff or management can never be handed out by a button, whoever built the message.
async function protectedRoleIds(guildId: string) {
  const settings = await getSettings(guildId).catch(() => null);
  return new Set([settings?.staffRoleId, settings?.managementRoleId, settings?.onShiftRoleId, settings?.leaveRoleId].filter(Boolean) as string[]);
}

async function load(id: string) {
  if (!UUID.test(id)) return null;
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < 15_000) return hit.row;
  const row = await getStudio(id).catch(() => null);
  cache.set(id, { at: Date.now(), row });
  return row;
}

function varsFor(i: Interaction, extra: Vars = {}): Vars {
  const member = i.member as GuildMember | null;
  return {
    user: `<@${i.user.id}>`, 'user.id': i.user.id, 'user.name': member?.displayName || i.user.globalName || i.user.username, 'user.username': i.user.username,
    server: i.guild?.name || '', members: String(i.guild?.memberCount ?? ''), channel: i.channelId ? `<#${i.channelId}>` : '', date: new Date().toISOString().slice(0, 10), ...extra,
  };
}

// Runs every non-form step. Returns what to show the clicker; the caller has already deferred the reply.
async function runActions(i: Interaction, row: StudioRow, actions: Action[], vars: Vars, answers?: Array<{ label: string; value: string }>) {
  const replies: Array<{ content?: string; messageId?: string }> = [];
  const notes: string[] = [];
  const member = i.inCachedGuild() ? i.member : null;
  const protectedRoles = await protectedRoleIds(row.guildId);
  for (const action of actions) {
    if (action.type === 'reply') replies.push(action.messageId ? { messageId: action.messageId } : { content: fill(action.content, vars) });
    if ((action.type === 'addRoles' || action.type === 'removeRoles' || action.type === 'toggleRoles') && member) {
      for (const roleId of action.roleIds) {
        const role = member.guild.roles.cache.get(roleId);
        if (!role) continue;
        if (protectedRoles.has(roleId)) { notes.push(`⚠️ **${role.name}** is a staff role, so it cannot be given from a button.`); continue; }
        if (!role.editable) { notes.push(`⚠️ I cannot manage **${role.name}** (it is above my role).`); continue; }
        if (isDangerousRole(role)) { notes.push(`⚠️ **${role.name}** has moderator or admin permissions, so it cannot be given from a button.`); continue; }
        const has = member.roles.cache.has(roleId);
        const add = action.type === 'addRoles' || (action.type === 'toggleRoles' && !has);
        if (add && !has) await member.roles.add(roleId, `Studio: ${row.name}`).then(() => notes.push(`✅ Added **${role.name}**`)).catch(() => notes.push(`⚠️ Could not add **${role.name}**`));
        if (!add && has) await member.roles.remove(roleId, `Studio: ${row.name}`).then(() => notes.push(`➖ Removed **${role.name}**`)).catch(() => notes.push(`⚠️ Could not remove **${role.name}**`));
      }
    }
    if (action.type === 'dm') await i.user.send({ content: fill(action.content, vars).slice(0, 2000) || '​', allowedMentions: { parse: [] } }).catch(() => notes.push('⚠️ Your DMs are closed.'));
    if (action.type === 'channel' && action.channelId) {
      const channel: any = await i.client.channels.fetch(action.channelId).catch(() => null);
      if (channel?.isTextBased?.() && 'send' in channel && channel.guildId === row.guildId) {
        const payload = action.format === 'answers' && answers
          ? { content: fill(action.content, vars).slice(0, 2000) || undefined, embeds: [{ color: BRAND_COLOR, author: { name: `${i.user.username} · ${row.name}`.slice(0, 256), icon_url: i.user.displayAvatarURL({ extension: 'png', size: 64 }) }, fields: answers.slice(0, 25).map(item => ({ name: item.label.slice(0, 256), value: (item.value || '—').slice(0, 1024) })), footer: { text: `User ID ${i.user.id}` }, timestamp: new Date().toISOString() }] }
          : { content: fill(action.content, vars).slice(0, 2000) || '​' };
        // Form answers are member text: only the person who pressed the button can be mentioned, nobody else.
        await channel.send({ ...payload, allowedMentions: { parse: [], users: [i.user.id] } }).catch(() => notes.push('⚠️ Could not post to the configured channel.'));
      }
    }
  }
  return { replies, notes };
}

async function respond(i: Interaction, row: StudioRow, result: { replies: Array<{ content?: string; messageId?: string }>; notes: string[] }) {
  const text = [...result.replies.filter(item => item.content).map(item => item.content!), ...result.notes].join('\n').slice(0, 2000);
  const template = result.replies.find(item => item.messageId);
  if (template?.messageId) {
    const other = await load(template.messageId);
    if (other && other.guildId === row.guildId) {
      const payload = renderDoc(other.data, other.id, varsFor(i));
      // A deferred reply cannot switch to Components V2, so templates go out as a follow-up.
      await i.followUp({ ...payload, flags: (payload.flags || 0) | ephemeral }).catch(error => console.error('Studio template reply failed:', error));
      if (text) await i.editReply({ content: text, allowedMentions: { parse: [] } }).catch(() => undefined);
      else await i.deleteReply().catch(() => undefined);
      return;
    }
  }
  await i.editReply({ content: text || '✅', allowedMentions: { parse: [] } }).catch(() => undefined);
}

function formModal(docId: string, ownerId: string, action: Extract<Action, { type: 'form' }>) {
  const modal = new ModalBuilder().setCustomId(`esf:${docId}:${ownerId}`).setTitle(action.title.slice(0, 45) || 'Form');
  modal.addLabelComponents(...action.fields.map(field => {
    const input = new TextInputBuilder().setCustomId(field.id).setStyle(field.style === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short).setRequired(field.required);
    if (field.max) input.setMaxLength(field.max);
    if (field.min) input.setMinLength(field.min);
    if (field.placeholder) input.setPlaceholder(field.placeholder);
    const label = new LabelBuilder().setLabel(field.label.slice(0, 45)).setTextInputComponent(input);
    if (field.description) label.setDescription(field.description.slice(0, 100));
    return label;
  }));
  return modal;
}

export async function handleStudioComponent(i: ButtonInteraction | StringSelectMenuInteraction) {
  const [, docId = '', componentId = ''] = i.customId.split(':');
  const row = await load(docId);
  if (!row || row.guildId !== i.guildId) return i.reply({ content: 'This message is no longer active.', flags: ephemeral });
  if (tooFast(i.user.id, docId)) return i.reply({ content: 'Slow down a little.', flags: ephemeral });
  const hit = findInteractive(row.data, componentId);
  let actions: Action[] = [];
  let ownerId = componentId;
  const extra: Vars = {};
  if (i.isButton() && hit.button) actions = hit.button.actions;
  else if (i.isStringSelectMenu() && hit.select) {
    const chosen = hit.select.options.filter(option => i.values.includes(option.id));
    extra.option = chosen.map(option => option.label).join(', ');
    actions = chosen.flatMap(option => option.actions);
    if (chosen.length === 1) ownerId = chosen[0]!.id;
  }
  if (!actions.length) return i.reply({ content: '✅', flags: ephemeral });
  const first = actions[0]!;
  if (first.type === 'form') return i.showModal(formModal(docId, ownerId, first));
  const publicReply = actions.some(action => action.type === 'reply' && !action.ephemeral);
  await i.deferReply(publicReply ? {} : { flags: ephemeral });
  const result = await runActions(i, row, actions, varsFor(i, extra));
  await respond(i, row, result);
  await createLog(row.guildId, 'STUDIO_INTERACTION', i.user.id, i.user.id, { messageId: row.id, componentId }).catch(() => undefined);
}

export async function handleStudioModal(i: ModalSubmitInteraction) {
  const [, docId = '', ownerId = ''] = i.customId.split(':');
  const row = await load(docId);
  if (!row || row.guildId !== i.guildId) return i.reply({ content: 'This form is no longer active.', flags: ephemeral });
  if (tooFast(i.user.id, `${docId}:form`)) return i.reply({ content: 'Slow down a little.', flags: ephemeral });
  const hit = findInteractive(row.data, ownerId);
  const actions = hit.option?.actions || hit.button?.actions || [];
  const form = actions[0]?.type === 'form' ? actions[0] : null;
  if (!form) return i.reply({ content: 'This form is no longer active.', flags: ephemeral });
  const answers = form.fields.map(field => ({ id: field.id, label: field.label, value: (() => { try { return i.fields.getTextInputValue(field.id).trim(); } catch { return ''; } })() }));
  const vars = varsFor(i, Object.fromEntries(answers.map(item => [`form.${item.id}`, item.value])));
  const submit = form.submit.length ? form.submit : [{ type: 'reply', content: '✅ Thanks, your answers were sent.', ephemeral: true, messageId: '' } as Action];
  await i.deferReply(submit.some(action => action.type === 'reply' && !action.ephemeral) ? {} : { flags: ephemeral });
  const result = await runActions(i, row, submit, vars, answers);
  await respond(i, row, result);
  await createLog(row.guildId, 'STUDIO_FORM_SUBMITTED', i.user.id, i.user.id, { messageId: row.id, componentId: ownerId }).catch(() => undefined);
}

export function forgetStudioCache(id: string) { cache.delete(id); }
