import type { Context } from '../web/server/http.js';
import { ChannelType, type Client } from '../lib/djs/index.js';
import type { DashboardContext, DashboardExtension } from './extensions.js';
import {
  StudioError, countComponents, fileRefs, importApi, renderDoc, sanitizeDoc, textLength, UUID,
  type Action, type Node, type StudioDoc,
} from '../studio/schema.js';
import { STUDIO_TEMPLATES } from '../studio/templates.js';
import { StudioSetupError, countStudio, createStudio, deleteStudio, getStudio, listStudio, updateStudio, type SentRef, type StudioRow } from '../studio/store.js';
import { isDangerousRole } from '../studio/roles.js';
import { createLog } from '../services/log.service.js';
import { safeFetchBuffer } from '../utils/safe-fetch.js';
import { emojiList } from '../utils/emoji.js';
import type { Mount } from '../web/server/router.js';
import { publicMessage } from '../web/server/errors.js';
import { rateLimit } from '../web/server/security.js';

const MAX_MESSAGES = 100;
const fail = (c: Context, status: number, error: string) => c.status(status).json({ error });
const userIdOf = (context: DashboardContext, c: Context) => context.sessionUser(c)?.id ?? '';

const view = (row: StudioRow) => ({
  id: row.id, name: row.name, data: row.data, sent: row.sent || [], createdAt: row.createdAt, updatedAt: row.updatedAt,
  stats: { components: row.data.mode === 'v2' ? countComponents(row.data.components) : row.data.components.length, characters: row.data.mode === 'v2' ? textLength(row.data.components) : row.data.content.length },
});

async function downloadFiles(doc: StudioDoc) {
  const files: Array<{ attachment: Buffer; name: string }> = [];
  for (const ref of fileRefs(doc)) {
    try { files.push({ attachment: await safeFetchBuffer(ref.url), name: ref.name }); }
    catch (error) { throw new StudioError(`Could not attach ${ref.name}: ${error instanceof Error ? error.message : 'download failed'}`); }
  }
  return files;
}

async function textChannel(discord: Client, guildId: string, channelId: string) {
  const channel: any = await discord.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.() || !('send' in channel) || channel.guildId !== guildId) throw new StudioError('اختر روم كتابي في هذا السيرفر.');
  return channel;
}

// Every role a button or menu option can add or toggle must be safe to self-assign and below the editor's own top role.
function roleIdsIn(doc: StudioDoc) {
  const ids = new Set<string>();
  const fromActions = (actions: Action[]) => actions.forEach(action => { if ('roleIds' in action && action.type !== 'removeRoles') action.roleIds.forEach(id => ids.add(id)); if (action.type === 'form') fromActions(action.submit); });
  const walk = (nodes: Node[]) => nodes.forEach(node => {
    if (node.type === 'buttons') node.buttons.forEach(button => fromActions(button.actions));
    if (node.type === 'section' && node.accessory.kind === 'button') fromActions(node.accessory.button.actions);
    if (node.type === 'select') node.select.options.forEach(option => fromActions(option.actions));
    if (node.type === 'container') walk(node.children);
  });
  walk(doc.components);
  return [...ids];
}

async function assertSafeRoles(context: DashboardContext, guildId: string, editorId: string, doc: StudioDoc) {
  const ids = roleIdsIn(doc);
  if (!ids.length) return;
  const guild = await context.getGuild(guildId).catch(() => null);
  if (!guild) return;
  await guild.roles.fetch().catch(() => undefined);
  const editor = await guild.members.fetch(editorId).catch(() => null);
  for (const id of ids) {
    const role = guild.roles.cache.get(id);
    if (!role) continue;
    if (isDangerousRole(role)) throw new StudioError(`@${role.name} has moderator or admin permissions, so buttons and menus cannot give it out.`);
    if (editor && guild.ownerId !== editorId && role.position >= editor.roles.highest.position) throw new StudioError(`@${role.name} is at or above your highest role, so you cannot hand it out.`);
  }
}

export const studioDashboard: DashboardExtension = {
  name: 'studio',
  mountApi(context, app: Mount) {
    const { discord, selectedGuildId, requireAdministrator } = context;
    const writeLimit = rateLimit('studio-writes', 60_000, 40);

    // Every studio route is administrator-only; errors become clear JSON messages instead of crashes.
    const route = (handler: (c: Context, guildId: string) => Promise<unknown>) => (c: Context) =>
      (async () => {
        if (!await requireAdministrator(c)) return;
        await handler(c, selectedGuildId(c));
      })().catch(error => {
        if (c.sent) return;
        if (error instanceof StudioSetupError) return fail(c, 503, error.message);
        if (error instanceof StudioError) return fail(c, 400, publicMessage(error, error.message));
        // أخطاء التحقق من ديسكورد (حقول الرسالة) مفيدة للمحرر؛ غيرها رسالة عامة.
        const details = (error as any)?.rawError?.errors ? JSON.stringify((error as any).rawError.errors).slice(0, 400) : '';
        console.error(`Studio API ${c.method} ${c.path}:`, error instanceof Error ? error.message : error, details);
        fail(c, 400, details ? `ديسكورد رفض الرسالة: ${details}` : publicMessage(error, 'تعذّر تنفيذ العملية.'));
      });

    const own = async (c: Context, guildId: string) => {
      const id = String(c.params.id || '');
      const row = UUID.test(id) ? await getStudio(id) : null;
      if (!row || row.guildId !== guildId) { fail(c, 404, 'الرسالة مو موجودة.'); return null; }
      return row;
    };
    const varsFor = (guildId: string, channelId: string) => {
      const guild = discord.guilds.cache.get(guildId);
      return { server: guild?.name || '', members: String(guild?.memberCount ?? ''), date: new Date().toISOString().slice(0, 10), channel: `<#${channelId}>` };
    };

    // Roles, text channels and the bot's custom emojis, for pickers and the preview.
    app.get('/api/studio/options', route(async (c, guildId) => {
      const guild = await context.getGuild(guildId);
      const [roles, channels, me] = await Promise.all([guild.roles.fetch(), guild.channels.fetch(), guild.members.fetchMe().catch(() => null)]);
      const top = me?.roles.highest.position ?? 0;
      c.json({
        roles: [...roles.values()].filter(role => role.id !== guild.id && !role.managed).sort((a, b) => b.position - a.position)
          .map(role => ({ id: role.id, name: role.name, color: role.hexColor, manageable: role.position < top, dangerous: isDangerousRole(role) })),
        channels: [...channels.values()].filter(channel => channel && (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement))
          .sort((a, b) => (a!.position ?? 0) - (b!.position ?? 0))
          .map(channel => ({ id: channel!.id, name: `${channel!.parent?.name ? `${channel!.parent.name} / ` : ''}${channel!.name}` })),
        emojis: emojiList().filter(item => item.id).map(item => ({ name: item.name, id: item.id, chars: item.chars })),
      });
    }));

    app.get('/api/studio', route(async (c, guildId) => {
      const rows = await listStudio(guildId);
      c.json({ messages: rows.map(view), templates: Object.entries(STUDIO_TEMPLATES).map(([key, item]) => ({ key, name: item.name, mode: item.doc.mode })) });
    }));

    app.post('/api/studio', route(async (c, guildId) => {
      if (await countStudio(guildId) >= MAX_MESSAGES) return fail(c, 400, `السيرفر يقدر يحفظ ${MAX_MESSAGES} رسالة كحد أقصى.`);
      const template = STUDIO_TEMPLATES[String(c.body?.template || 'blank')] || STUDIO_TEMPLATES.blank!;
      const data = c.body?.data ? sanitizeDoc(c.body.data) : sanitizeDoc(structuredClone(template.doc));
      await assertSafeRoles(context, guildId, userIdOf(context, c), data);
      const row = await createStudio({ guildId, name: String(c.body?.name || template.name).slice(0, 80), data, userId: userIdOf(context, c) });
      c.json({ message: view(row) });
    }), { guards: [writeLimit] });

    app.post('/api/studio/import', route(async (c, guildId) => {
      const link = String(c.body?.link || '').trim();
      if (link) {
        const match = /channels\/(\d+)\/(\d+)\/(\d+)/.exec(link);
        if (!match || match[1] !== guildId) return fail(c, 400, 'الصق رابط رسالة من هذا السيرفر.');
        const channel = await textChannel(discord, match[1], match[2]!);
        const message = await channel.messages.fetch(match[3]).catch(() => null);
        if (!message) return fail(c, 404, 'ما قدرت أقرأ الرسالة. تأكد من الرابط ومن صلاحياتي في الروم.');
        return c.json({ data: importApi({ content: message.content, embeds: message.embeds.map((embed: any) => embed.toJSON()), components: message.components.map((component: any) => component.toJSON()), flags: message.flags.bitfield }) });
      }
      c.json({ data: importApi(c.body?.json) });
    }), { guards: [writeLimit] });

    app.get('/api/studio/:id', route(async (c, guildId) => { const row = await own(c, guildId); if (row) c.json({ message: view(row) }); }));

    app.put('/api/studio/:id', route(async (c, guildId) => {
      const row = await own(c, guildId); if (!row) return;
      const data = sanitizeDoc(c.body?.data);
      await assertSafeRoles(context, guildId, userIdOf(context, c), data);
      const updated = await updateStudio(row.id, { data, name: String(c.body?.name || row.name).trim().slice(0, 80) || 'رسالة بدون عنوان', userId: userIdOf(context, c) });
      c.json({ message: view(updated) });
    }), { guards: [writeLimit] });

    app.post('/api/studio/:id/duplicate', route(async (c, guildId) => {
      const row = await own(c, guildId); if (!row) return;
      if (await countStudio(guildId) >= MAX_MESSAGES) return fail(c, 400, `السيرفر يقدر يحفظ ${MAX_MESSAGES} رسالة كحد أقصى.`);
      const copy = await createStudio({ guildId, name: `${row.name} (copy)`.slice(0, 80), data: sanitizeDoc(row.data), userId: userIdOf(context, c) });
      c.json({ message: view(copy) });
    }), { guards: [writeLimit] });

    app.delete('/api/studio/:id', route(async (c, guildId) => {
      const row = await own(c, guildId); if (!row) return;
      await deleteStudio(row.id);
      c.json({ ok: true });
    }), { guards: [writeLimit] });

    app.post('/api/studio/:id/send', route(async (c, guildId) => {
      const row = await own(c, guildId); if (!row) return;
      const channel = await textChannel(discord, guildId, String(c.body?.channelId || ''));
      const payload = renderDoc(row.data, row.id, varsFor(guildId, channel.id));
      const files = await downloadFiles(row.data);
      const message = await channel.send({ ...payload, ...(files.length ? { files } : {}) });
      const sent: SentRef[] = [...(row.sent || []), { channelId: channel.id, messageId: message.id, at: new Date().toISOString() }].slice(-20);
      await updateStudio(row.id, { sent });
      await createLog(guildId, 'STUDIO_MESSAGE_SENT', userIdOf(context, c), userIdOf(context, c), { messageId: row.id, channelId: channel.id }).catch(() => undefined);
      c.json({ ok: true, url: `https://discord.com/channels/${guildId}/${channel.id}/${message.id}` });
    }), { guards: [writeLimit] });

    // Re-renders every copy that was sent. Messages deleted in Discord are dropped from the list.
    app.post('/api/studio/:id/update-sent', route(async (c, guildId) => {
      const row = await own(c, guildId); if (!row) return;
      let updated = 0; const failed: string[] = []; const keep: SentRef[] = [];
      for (const ref of row.sent || []) {
        const channel: any = await discord.channels.fetch(ref.channelId).catch(() => null);
        const message = channel?.messages ? await channel.messages.fetch(ref.messageId).catch(() => null) : null;
        if (!message) continue;
        keep.push(ref);
        const { flags: _flags, ...payload } = renderDoc(row.data, row.id, varsFor(guildId, ref.channelId));
        const wasV2 = Boolean(message.flags?.has?.(1 << 15));
        if (wasV2 !== (row.data.mode === 'v2')) { failed.push(`#${channel.name}: ما ينفع التحويل بين V2 والعادي في رسالة موجودة`); continue; }
        const files = await downloadFiles(row.data);
        await message.edit({ ...payload, ...(row.data.mode === 'embed' ? {} : { content: null, embeds: [] }), ...(files.length ? { files, attachments: [] } : {}) }).then(() => { updated += 1; }).catch((error: any) => failed.push(`#${channel.name}: ${publicMessage(error, 'فشل التعديل')}`));
      }
      await updateStudio(row.id, { sent: keep });
      c.json({ ok: true, updated, failed, total: keep.length });
    }), { guards: [writeLimit] });
  },
};

export default studioDashboard;
