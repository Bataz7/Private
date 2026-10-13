// Embed Studio document model: sanitising builder input, rendering Discord API payloads, importing API JSON.
// A document is either Components V2 (`mode: 'v2'`) or classic content + embeds (`mode: 'embed'`).
import { STYLE, T, V2_FLAG, parseEmoji, type Raw } from '../utils/v2.js';

export type ButtonStyle = 'primary' | 'secondary' | 'success' | 'danger' | 'link';
export interface FormField { id: string; label: string; description: string; style: 'short' | 'paragraph'; required: boolean; placeholder: string; min: number | null; max: number | null }
export type Action =
  | { type: 'reply'; content: string; ephemeral: boolean; messageId: string }
  | { type: 'addRoles' | 'removeRoles' | 'toggleRoles'; roleIds: string[] }
  | { type: 'dm'; content: string }
  | { type: 'channel'; channelId: string; content: string; format: 'text' | 'answers' }
  | { type: 'form'; title: string; fields: FormField[]; submit: Action[] };
export interface Button { id: string; label: string; emoji: string; style: ButtonStyle; url: string; disabled: boolean; actions: Action[] }
export interface SelectOption { id: string; label: string; description: string; emoji: string; actions: Action[] }
export interface Select { id: string; placeholder: string; min: number; max: number; disabled: boolean; options: SelectOption[] }
export type Node =
  | { id: string; type: 'container'; color: string; spoiler: boolean; children: Node[] }
  | { id: string; type: 'text'; content: string }
  | { id: string; type: 'section'; texts: string[]; accessory: { kind: 'thumbnail'; url: string; description: string; spoiler: boolean } | { kind: 'button'; button: Button } }
  | { id: string; type: 'media'; items: Array<{ url: string; description: string; spoiler: boolean }> }
  | { id: string; type: 'file'; url: string; name: string; spoiler: boolean }
  | { id: string; type: 'separator'; divider: boolean; spacing: 'small' | 'large' }
  | { id: string; type: 'buttons'; buttons: Button[] }
  | { id: string; type: 'select'; select: Select };
export interface Embed {
  title: string; url: string; description: string; color: string; timestamp: boolean;
  author: { name: string; url: string; icon: string }; footer: { text: string; icon: string };
  thumbnail: string; image: string; fields: Array<{ name: string; value: string; inline: boolean }>;
}
export interface StudioDoc { mode: 'v2' | 'embed'; content: string; embeds: Embed[]; components: Node[] }

export const LIMITS = { components: 40, textTotal: 4000, content: 2000, embeds: 10, embedTotal: 6000, rows: 5, buttons: 5, options: 25, actions: 10, fields: 5, roles: 10, media: 10 };
const ID = /^[a-z0-9]{4,16}$/i;
const SNOWFLAKE = /^\d{15,22}$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const newId = () => Array.from({ length: 8 }, () => Math.floor(Math.random() * 36).toString(36)).join('');

const str = (value: unknown, max: number) => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max);
const trim = (value: unknown, max: number) => str(value, max).trim();
const hexColor = (value: unknown) => (/^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value).toLowerCase() : '');
const snowflakes = (value: unknown, max = LIMITS.roles) => [...new Set((Array.isArray(value) ? value : []).map(String).filter(item => SNOWFLAKE.test(item)))].slice(0, max);
// URLs may be https links, or attachment:// references that the sender resolves.
function url(value: unknown, { allowAttachment = false } = {}) {
  const text = trim(value, 1000);
  if (!text) return '';
  if (allowAttachment && /^attachment:\/\/[\w.-]{1,100}$/.test(text)) return text;
  try { const parsed = new URL(text); return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : ''; } catch { return ''; }
}

export class StudioError extends Error {}
const fail = (message: string): never => { throw new StudioError(message); };

function makeId(value: unknown, seen: Set<string>) {
  let id = String(value || '');
  if (!ID.test(id) || seen.has(id)) id = newId();
  seen.add(id);
  return id;
}

function sanitizeActions(raw: unknown, seen: Set<string>, { allowForm, inForm = false }: { allowForm: boolean; inForm?: boolean }): Action[] {
  const list = Array.isArray(raw) ? raw.slice(0, LIMITS.actions) : [];
  const actions: Action[] = [];
  list.forEach((item: any, index: number) => {
    const type = String(item?.type || '');
    if (type === 'reply') actions.push({ type, content: str(item.content, 2000), ephemeral: item.ephemeral !== false, messageId: UUID.test(String(item.messageId || '')) ? String(item.messageId) : '' });
    else if (type === 'addRoles' || type === 'removeRoles' || type === 'toggleRoles') actions.push({ type, roleIds: snowflakes(item.roleIds) });
    else if (type === 'dm') actions.push({ type, content: str(item.content, 2000) });
    else if (type === 'channel') actions.push({ type, channelId: SNOWFLAKE.test(String(item.channelId || '')) ? String(item.channelId) : '', content: str(item.content, 2000), format: item.format === 'answers' ? 'answers' : 'text' });
    else if (type === 'form' && allowForm && !inForm) {
      // A modal must be the interaction's first response, so a form can only be the first step.
      if (index !== 0) fail('“فتح نموذج الأسئلة” لازم يكون أول خطوة في الزر أو الخيار.');
      const fields: FormField[] = (Array.isArray(item.fields) ? item.fields : []).slice(0, LIMITS.fields).map((field: any) => {
        const style = field?.style === 'paragraph' ? 'paragraph' as const : 'short' as const;
        const cap = style === 'paragraph' ? 4000 : 400;
        const max = field?.max === null || field?.max === undefined || field?.max === '' ? null : Math.max(1, Math.min(cap, Math.round(Number(field.max)) || cap));
        const min = field?.min === null || field?.min === undefined || field?.min === '' ? null : Math.max(0, Math.min(max ?? cap, Math.round(Number(field.min)) || 0));
        return { id: makeId(field?.id, seen), label: trim(field?.label, 45) || 'سؤال', description: trim(field?.description, 100), style, required: field?.required !== false, placeholder: trim(field?.placeholder, 100), min, max };
      });
      if (!fields.length) fail('نموذج الأسئلة يحتاج حقل واحد على الأقل.');
      actions.push({ type, title: trim(item.title, 45) || 'نموذج', fields, submit: sanitizeActions(item.submit, seen, { allowForm: false, inForm: true }) });
    }
  });
  return actions;
}

function sanitizeButton(raw: any, seen: Set<string>): Button {
  const style = (['primary', 'secondary', 'success', 'danger', 'link'] as const).includes(raw?.style) ? raw.style as ButtonStyle : 'secondary';
  const button: Button = { id: makeId(raw?.id, seen), label: trim(raw?.label, 80), emoji: trim(raw?.emoji, 64), style, url: style === 'link' ? url(raw?.url) : '', disabled: Boolean(raw?.disabled), actions: style === 'link' ? [] : sanitizeActions(raw?.actions, seen, { allowForm: true }) };
  if (!button.label && !parseEmoji(button.emoji)) button.label = 'زر';
  if (style === 'link' && !button.url) fail(`زر الرابط “${button.label || 'زر'}” يحتاج رابط صحيح.`);
  return button;
}

function sanitizeSelect(raw: any, seen: Set<string>): Select {
  const options: SelectOption[] = (Array.isArray(raw?.options) ? raw.options : []).slice(0, LIMITS.options).map((option: any) => ({
    id: makeId(option?.id, seen), label: trim(option?.label, 100) || 'خيار', description: trim(option?.description, 100), emoji: trim(option?.emoji, 64),
    actions: sanitizeActions(option?.actions, seen, { allowForm: true }),
  }));
  if (!options.length) fail('القائمة المنسدلة تحتاج خيار واحد على الأقل.');
  const max = Math.max(1, Math.min(options.length, Math.round(Number(raw?.max)) || 1));
  const min = Math.max(0, Math.min(max, Math.round(Number(raw?.min ?? 1))));
  if (max > 1 && options.some(option => option.actions[0]?.type === 'form')) fail('نماذج الأسئلة تشتغل بس في القوائم ذات الاختيار الواحد (أقصى اختيار 1).');
  return { id: makeId(raw?.id, seen), placeholder: trim(raw?.placeholder, 150), min: Number.isFinite(min) ? min : 1, max, disabled: Boolean(raw?.disabled), options };
}

const TOP_TYPES = new Set(['container', 'text', 'section', 'media', 'file', 'separator', 'buttons', 'select']);
const CHILD_TYPES = new Set(['text', 'section', 'media', 'file', 'separator', 'buttons', 'select']);

function sanitizeNode(raw: any, seen: Set<string>, nested: boolean): Node | null {
  const type = String(raw?.type || '');
  if (!(nested ? CHILD_TYPES : TOP_TYPES).has(type)) return null;
  const id = makeId(raw?.id, seen);
  switch (type) {
    case 'container': return { id, type, color: hexColor(raw.color), spoiler: Boolean(raw.spoiler), children: (Array.isArray(raw.children) ? raw.children : []).map((child: any) => sanitizeNode(child, seen, true)).filter(Boolean) as Node[] };
    case 'text': return { id, type, content: str(raw.content, 4000) };
    case 'section': {
      const texts = (Array.isArray(raw.texts) ? raw.texts : [raw.content]).slice(0, 3).map((item: unknown) => str(item, 4000)).filter((item: string) => item.trim());
      if (!texts.length) texts.push(' ');
      const accessory = raw.accessory?.kind === 'button'
        ? { kind: 'button' as const, button: sanitizeButton(raw.accessory.button, seen) }
        : { kind: 'thumbnail' as const, url: url(raw.accessory?.url, { allowAttachment: true }), description: trim(raw.accessory?.description, 1024), spoiler: Boolean(raw.accessory?.spoiler) };
      if (accessory.kind === 'thumbnail' && !accessory.url) fail('الصورة المصغّرة في القسم تحتاج رابط صورة.');
      return { id, type, texts, accessory };
    }
    case 'media': {
      const items = (Array.isArray(raw.items) ? raw.items : []).slice(0, LIMITS.media).map((item: any) => ({ url: url(item?.url, { allowAttachment: true }), description: trim(item?.description, 1024), spoiler: Boolean(item?.spoiler) })).filter((item: { url: string }) => item.url);
      if (!items.length) fail('معرض الوسائط يحتاج رابط صورة واحد على الأقل.');
      return { id, type, items };
    }
    case 'file': {
      const fileUrl = url(raw.url, { allowAttachment: true });
      if (!fileUrl) fail('عنصر الملف يحتاج رابط ملف.');
      const name = trim(raw.name, 100).replace(/[^\w.-]/g, '_') || fileUrl.split('/').pop()?.split('?')[0]?.replace(/[^\w.-]/g, '_') || 'file';
      return { id, type, url: fileUrl, name, spoiler: Boolean(raw.spoiler) };
    }
    case 'separator': return { id, type, divider: raw.divider !== false, spacing: raw.spacing === 'large' ? 'large' : 'small' };
    case 'buttons': {
      const buttons = (Array.isArray(raw.buttons) ? raw.buttons : []).slice(0, LIMITS.buttons).map((item: any) => sanitizeButton(item, seen));
      if (!buttons.length) fail('صف الأزرار يحتاج زر واحد على الأقل.');
      return { id, type, buttons };
    }
    case 'select': return { id, type, select: sanitizeSelect(raw.select, seen) };
  }
  return null;
}

function sanitizeEmbed(raw: any): Embed {
  return {
    title: trim(raw?.title, 256), url: url(raw?.url), description: str(raw?.description, 4096).trim(), color: hexColor(raw?.color), timestamp: Boolean(raw?.timestamp),
    author: { name: trim(raw?.author?.name, 256), url: url(raw?.author?.url), icon: url(raw?.author?.icon) },
    footer: { text: trim(raw?.footer?.text, 2048), icon: url(raw?.footer?.icon) },
    thumbnail: url(raw?.thumbnail), image: url(raw?.image),
    fields: (Array.isArray(raw?.fields) ? raw.fields : []).slice(0, 25).map((field: any) => ({ name: trim(field?.name, 256), value: str(field?.value, 1024).trim(), inline: Boolean(field?.inline) })).filter((field: { name: string; value: string }) => field.name || field.value),
  };
}

// Counts components the way Discord does (every nested component counts toward the 40 limit).
export function countComponents(nodes: Node[]): number {
  let total = 0;
  for (const node of nodes) {
    total += 1;
    if (node.type === 'container') total += countComponents(node.children);
    if (node.type === 'section') total += node.texts.length + 1;
    if (node.type === 'buttons') total += node.buttons.length;
    if (node.type === 'select') total += 1;
  }
  return total;
}

export function textLength(nodes: Node[]): number {
  let total = 0;
  for (const node of nodes) {
    if (node.type === 'text') total += node.content.length;
    if (node.type === 'section') total += node.texts.reduce((sum, item) => sum + item.length, 0);
    if (node.type === 'container') total += textLength(node.children);
  }
  return total;
}

const embedLength = (embed: Embed) => embed.title.length + embed.description.length + embed.author.name.length + embed.footer.text.length + embed.fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0);

export function sanitizeDoc(raw: any): StudioDoc {
  const seen = new Set<string>();
  const mode = raw?.mode === 'embed' ? 'embed' : 'v2';
  if (mode === 'v2') {
    const components = (Array.isArray(raw?.components) ? raw.components : []).map((node: any) => sanitizeNode(node, seen, false)).filter(Boolean) as Node[];
    if (!components.length) fail('أضف عنصر واحد على الأقل.');
    const count = countComponents(components);
    if (count > LIMITS.components) fail(`ديسكورد يسمح بـ ${LIMITS.components} عنصر في الرسالة؛ هذي فيها ${count}.`);
    const chars = textLength(components);
    if (chars > LIMITS.textTotal) fail(`نص الرسالة كامل حده ${LIMITS.textTotal} حرف؛ هذي فيها ${chars}.`);
    if (!textLength(components) && !components.some(node => ['media', 'file', 'container', 'section'].includes(node.type))) fail('أضف نص أو وسائط — ديسكورد يرفض الرسائل اللي فيها أزرار بس.');
    return { mode, content: '', embeds: [], components };
  }
  const content = str(raw?.content, LIMITS.content).trim();
  const embeds = (Array.isArray(raw?.embeds) ? raw.embeds : []).slice(0, LIMITS.embeds).map(sanitizeEmbed).filter((embed: Embed) => embed.title || embed.description || embed.fields.length || embed.image || embed.thumbnail || embed.author.name || embed.footer.text);
  const total = embeds.reduce((sum: number, embed: Embed) => sum + embedLength(embed), 0);
  if (total > LIMITS.embedTotal) fail(`الإمبدات حدها ${LIMITS.embedTotal} حرف بالمجموع؛ هذي فيها ${total}.`);
  const components = (Array.isArray(raw?.components) ? raw.components : []).filter((node: any) => node?.type === 'buttons' || node?.type === 'select').slice(0, LIMITS.rows).map((node: any) => sanitizeNode(node, seen, false)).filter(Boolean) as Node[];
  if (!content && !embeds.length) fail('اكتب محتوى أو أضف إمبد.');
  return { mode, content, embeds, components };
}

// ---- Rendering ---------------------------------------------------------------------------------

export type Vars = Record<string, string>;
export const fill = (value: string, vars: Vars) => value.replace(/\{([\w.]+)\}/g, (match, key) => (Object.hasOwn(vars, key) ? vars[key] : undefined) ?? match);
const color = (value: string) => (value ? parseInt(value.slice(1), 16) : undefined);

export function buttonJson(button: Button, docId: string, vars: Vars): Raw {
  const emoji = parseEmoji(button.emoji);
  return {
    type: T.button, style: STYLE[button.style],
    ...(button.style === 'link' ? { url: button.url } : { custom_id: `es:${docId}:${button.id}` }),
    ...(button.label ? { label: fill(button.label, vars).slice(0, 80) } : {}),
    ...(emoji ? { emoji } : {}), ...(button.disabled ? { disabled: true } : {}),
  };
}

function selectJson(select: Select, docId: string, vars: Vars): Raw {
  return {
    type: T.row, components: [{
      type: T.stringSelect, custom_id: `es:${docId}:${select.id}`, min_values: select.min, max_values: select.max, disabled: select.disabled || undefined,
      ...(select.placeholder ? { placeholder: fill(select.placeholder, vars).slice(0, 150) } : {}),
      options: select.options.map(option => ({ label: fill(option.label, vars).slice(0, 100), value: option.id, ...(option.description ? { description: fill(option.description, vars).slice(0, 100) } : {}), ...(parseEmoji(option.emoji) ? { emoji: parseEmoji(option.emoji) } : {}) })),
    }],
  };
}

function nodeJson(node: Node, docId: string, vars: Vars): Raw {
  switch (node.type) {
    case 'container': return { type: T.container, components: node.children.map(child => nodeJson(child, docId, vars)), ...(node.color ? { accent_color: color(node.color) } : {}), ...(node.spoiler ? { spoiler: true } : {}) };
    case 'text': return { type: T.text, content: fill(node.content, vars) || ' ' };
    case 'section': return { type: T.section, components: node.texts.map(item => ({ type: T.text, content: fill(item, vars) || ' ' })), accessory: node.accessory.kind === 'button' ? buttonJson(node.accessory.button, docId, vars) : { type: T.thumbnail, media: { url: node.accessory.url }, ...(node.accessory.description ? { description: node.accessory.description } : {}), ...(node.accessory.spoiler ? { spoiler: true } : {}) } };
    case 'media': return { type: T.media, items: node.items.map(item => ({ media: { url: item.url }, ...(item.description ? { description: item.description } : {}), ...(item.spoiler ? { spoiler: true } : {}) })) };
    case 'file': return { type: T.file, file: { url: node.url.startsWith('attachment://') ? node.url : `attachment://${node.name}` }, ...(node.spoiler ? { spoiler: true } : {}) };
    case 'separator': return { type: T.separator, divider: node.divider, spacing: node.spacing === 'large' ? 2 : 1 };
    case 'buttons': return { type: T.row, components: node.buttons.map(button => buttonJson(button, docId, vars)) };
    case 'select': return selectJson(node.select, docId, vars);
  }
}

// Files referenced by https URL are downloaded at send time and attached by name.
export function fileRefs(doc: StudioDoc) {
  const refs: Array<{ url: string; name: string }> = [];
  const walk = (nodes: Node[]) => nodes.forEach(node => { if (node.type === 'file' && !node.url.startsWith('attachment://')) refs.push({ url: node.url, name: node.name }); if (node.type === 'container') walk(node.children); });
  walk(doc.components);
  return refs;
}

export function renderDoc(doc: StudioDoc, docId: string, vars: Vars = {}): Raw {
  if (doc.mode === 'v2') return { flags: V2_FLAG, components: doc.components.map(node => nodeJson(node, docId, vars)), allowedMentions: { parse: ['users'] } };
  return {
    content: fill(doc.content, vars) || undefined,
    embeds: doc.embeds.map(embed => ({
      ...(embed.title ? { title: fill(embed.title, vars) } : {}), ...(embed.url ? { url: embed.url } : {}), ...(embed.description ? { description: fill(embed.description, vars) } : {}),
      ...(embed.color ? { color: color(embed.color) } : {}), ...(embed.timestamp ? { timestamp: new Date().toISOString() } : {}),
      ...(embed.author.name ? { author: { name: fill(embed.author.name, vars), ...(embed.author.url ? { url: embed.author.url } : {}), ...(embed.author.icon ? { icon_url: embed.author.icon } : {}) } } : {}),
      ...(embed.footer.text ? { footer: { text: fill(embed.footer.text, vars), ...(embed.footer.icon ? { icon_url: embed.footer.icon } : {}) } } : {}),
      ...(embed.thumbnail ? { thumbnail: { url: embed.thumbnail } } : {}), ...(embed.image ? { image: { url: embed.image } } : {}),
      ...(embed.fields.length ? { fields: embed.fields.map(field => ({ name: fill(field.name, vars) || '​', value: fill(field.value, vars) || '​', inline: field.inline })) } : {}),
    })),
    components: doc.components.map(node => nodeJson(node, docId, vars)),
    allowedMentions: { parse: ['users'] },
  };
}

export function findInteractive(doc: StudioDoc, componentId: string): { button?: Button; select?: Select; option?: SelectOption } {
  const walk = (nodes: Node[]): ReturnType<typeof findInteractive> | null => {
    for (const node of nodes) {
      if (node.type === 'buttons') { const button = node.buttons.find(item => item.id === componentId); if (button) return { button }; }
      if (node.type === 'section' && node.accessory.kind === 'button' && node.accessory.button.id === componentId) return { button: node.accessory.button };
      if (node.type === 'select') {
        if (node.select.id === componentId) return { select: node.select };
        const option = node.select.options.find(item => item.id === componentId);
        if (option) return { select: node.select, option };
      }
      if (node.type === 'container') { const hit = walk(node.children); if (hit) return hit; }
    }
    return null;
  };
  return walk(doc.components) || {};
}

// ---- Import (Discord API / discohook JSON) -----------------------------------------------------

const hexOf = (value: unknown) => (typeof value === 'number' ? `#${value.toString(16).padStart(6, '0')}` : '');
const emojiText = (emoji: any) => (emoji?.id ? `<${emoji.animated ? 'a' : ''}:${emoji.name || 'e'}:${emoji.id}>` : emoji?.name || '');
const styleName = (style: number): ButtonStyle => (({ 1: 'primary', 2: 'secondary', 3: 'success', 4: 'danger', 5: 'link' } as Record<number, ButtonStyle>)[style] || 'secondary');

function importButton(raw: any): Button {
  return { id: newId(), label: raw?.label || '', emoji: emojiText(raw?.emoji), style: styleName(raw?.style), url: raw?.url || '', disabled: Boolean(raw?.disabled), actions: [] };
}

function importComponent(raw: any): Node | null {
  switch (raw?.type) {
    case T.container: return { id: newId(), type: 'container', color: hexOf(raw.accent_color), spoiler: Boolean(raw.spoiler), children: (raw.components || []).map(importComponent).filter(Boolean) };
    case T.text: return { id: newId(), type: 'text', content: raw.content || '' };
    case T.section: return { id: newId(), type: 'section', texts: (raw.components || []).map((item: any) => item.content || ''), accessory: raw.accessory?.type === T.button ? { kind: 'button', button: importButton(raw.accessory) } : { kind: 'thumbnail', url: raw.accessory?.media?.url || '', description: raw.accessory?.description || '', spoiler: Boolean(raw.accessory?.spoiler) } };
    case T.media: return { id: newId(), type: 'media', items: (raw.items || []).map((item: any) => ({ url: item.media?.url || '', description: item.description || '', spoiler: Boolean(item.spoiler) })) };
    case T.file: return { id: newId(), type: 'file', url: raw.file?.url || '', name: String(raw.file?.url || 'file').split('/').pop() || 'file', spoiler: Boolean(raw.spoiler) };
    case T.separator: return { id: newId(), type: 'separator', divider: raw.divider !== false, spacing: raw.spacing === 2 ? 'large' : 'small' };
    case T.row: {
      const first = raw.components?.[0];
      if (first?.type === T.stringSelect) return { id: newId(), type: 'select', select: { id: newId(), placeholder: first.placeholder || '', min: first.min_values ?? 1, max: first.max_values ?? 1, disabled: Boolean(first.disabled), options: (first.options || []).map((option: any) => ({ id: newId(), label: option.label || 'خيار', description: option.description || '', emoji: emojiText(option.emoji), actions: [] })) } };
      return { id: newId(), type: 'buttons', buttons: (raw.components || []).filter((item: any) => item.type === T.button).map(importButton) };
    }
  }
  return null;
}

// Accepts a Discord message object, a webhook/discohook payload ({ content, embeds, components }) or { messages: [{ data }] }.
export function importApi(input: any): StudioDoc {
  const data = input?.messages?.[0]?.data || input?.data || input;
  const isV2 = Boolean((Number(data?.flags) & V2_FLAG) || (data?.components || []).some((item: any) => item?.type && item.type !== T.row));
  const components = (data?.components || []).map(importComponent).filter(Boolean) as Node[];
  if (isV2) return sanitizeDoc({ mode: 'v2', components });
  return sanitizeDoc({
    mode: 'embed', content: data?.content || '', components,
    embeds: (data?.embeds || []).map((embed: any) => ({
      title: embed.title, url: embed.url, description: embed.description, color: hexOf(embed.color), timestamp: Boolean(embed.timestamp),
      author: { name: embed.author?.name, url: embed.author?.url, icon: embed.author?.icon_url }, footer: { text: embed.footer?.text, icon: embed.footer?.icon_url },
      thumbnail: embed.thumbnail?.url, image: embed.image?.url, fields: embed.fields || [],
    })),
  });
}
