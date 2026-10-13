// استوديو الرسائل: صمّم رسائل Components V2 أو إمبد كلاسيكي، أزرار وقوائم تشغّل خطوات، معاينة مثل ديسكورد، وإرسال لأي روم.
import type { Child } from '#jsx/jsx-runtime';
import { mount } from '#jsx/jsx-runtime';
import { api, errorText } from '../lib/api';
import { copyText, live, rid, safeColor } from '../lib/dom';
import type { PageCtx } from '../shell/types';
import { DiscordMessage, setCustomEmojis } from '../ui/discord';
import { Icon } from '../ui/Icon';
import { Badge, Button, Card, ChannelSelect, Empty, ErrorState, Field, Notice, PageHeader, PageSkeleton, Seg, Select, Toggle, busy, roleColor } from '../ui/kit';
import { confirmDialog, openModal, toast, toastError } from '../ui/overlay';

type Any = any;
const STYLES: Record<string, number> = { primary: 1, secondary: 2, success: 3, danger: 4, link: 5 };
const STYLE_LABEL: Record<string, string> = { primary: 'أساسي', secondary: 'ثانوي', success: 'أخضر', danger: 'أحمر', link: 'رابط' };
const PALETTE_V2: Array<[string, string, string, string]> = [
  ['container', 'حاوية', 'category', 'تجمع العناصر في بطاقة بلون جانبي.'], ['text', 'نص', 'note-text', 'ماركداون: عناوين وقوائم واقتباس ومنشن.'], ['section', 'قسم', 'user-square', 'لين 3 نصوص مع صورة أو زر جانبي.'],
  ['media', 'وسائط', 'monitor', 'معرض لين 10 صور أو فيديو.'], ['file', 'ملف', 'document-text', 'إرفاق ملف من رابط.'], ['separator', 'فاصل', 'minus-circle', 'مسافة مع خط أو بدونه.'],
  ['buttons', 'أزرار', 'flash', 'صف لين 5 أزرار تشغّل خطوات أو روابط.'], ['select', 'قائمة', 'sort', 'قائمة منسدلة كل خيار له خطواته.'],
];
const PALETTE_EMBED: Array<[string, string, string, string]> = [['embed', 'إمبد', 'clipboard-text', 'إمبد ديسكورد كلاسيكي (لين 10).'], ['buttons', 'أزرار', 'flash', 'صف لين 5 أزرار.'], ['select', 'قائمة', 'sort', 'قائمة منسدلة.']];
const LABELS = Object.fromEntries([...PALETTE_V2, ...PALETTE_EMBED].map(([key, label, icon]) => [key, { label, icon }])) as Record<string, { label: string; icon: string }>;
const CATALOG: Array<[string, string, string, string]> = [
  ['reply', 'إرسال رسالة', 'message-text', 'رد على اللي ضغط'], ['form', 'نموذج أسئلة', 'clipboard-text', 'يجمع إجابات في نافذة ديسكورد'], ['addRoles', 'إعطاء رتب', 'user-add', 'يعطي العضو رتب'],
  ['removeRoles', 'سحب رتب', 'user-remove', 'يشيل رتب من العضو'], ['toggleRoles', 'تبديل رتب', 'refresh-circle', 'يعطي إذا ناقصة ويشيل إذا موجودة'], ['dm', 'رسالة خاصة', 'send-2', 'يرسل للعضو في الخاص'], ['channel', 'رسالة في روم', 'global', 'يرسل رسالة لروم محدد'],
];
const CAT = Object.fromEntries(CATALOG.map(([key, label, icon, text]) => [key, { label, icon, text }])) as Record<string, { label: string; icon: string; text: string }>;

const newButton = (style = 'primary') => ({ id: rid(), label: style === 'link' ? 'افتح الرابط' : 'زر جديد', emoji: '', style, url: style === 'link' ? 'https://' : '', disabled: false, actions: style === 'link' ? [] : [{ type: 'reply', content: 'شكرًا!', ephemeral: true, messageId: '' }] });
const newEmbed = () => ({ title: 'إمبد جديد', url: '', description: '', color: '#8175f5', timestamp: false, author: { name: '', url: '', icon: '' }, footer: { text: '', icon: '' }, thumbnail: '', image: '', fields: [] as Any[] });
function newNode(type: string): Any {
  const id = rid();
  switch (type) {
    case 'container': return { id, type, color: '#8175f5', spoiler: false, children: [{ id: rid(), type: 'text', content: '## العنوان\nاكتب هنا.' }] };
    case 'text': return { id, type, content: 'نص جديد' };
    case 'section': return { id, type, texts: ['**عنوان القسم**\nنص جنب الصورة.'], accessory: { kind: 'thumbnail', url: 'https://cdn.discordapp.com/embed/avatars/0.png', description: '', spoiler: false } };
    case 'media': return { id, type, items: [{ url: '', description: '', spoiler: false }] };
    case 'file': return { id, type, url: '', name: '', spoiler: false };
    case 'separator': return { id, type, divider: true, spacing: 'small' };
    case 'buttons': return { id, type, buttons: [newButton()] };
    case 'select': return { id, type, select: { id: rid(), placeholder: 'اختر خيار', min: 1, max: 1, disabled: false, options: [{ id: rid(), label: 'الخيار 1', description: '', emoji: '', actions: [{ type: 'reply', content: 'اخترت {option}.', ephemeral: true, messageId: '' }] }] } };
  }
  return null;
}
function newAction(type: string): Any {
  if (type === 'reply') return { type, content: 'شكرًا!', ephemeral: true, messageId: '' };
  if (type === 'form') return { type, title: 'نموذج', fields: [{ id: rid(), label: 'إجابتك', description: '', style: 'short', required: true, placeholder: '', min: null, max: null }], submit: [{ type: 'reply', content: '✅ شكرًا، انرسلت إجاباتك.', ephemeral: true, messageId: '' }] };
  if (type === 'dm') return { type, content: 'هلا {user.name}!' };
  if (type === 'channel') return { type, channelId: '', content: '{user} استخدم زر', format: 'text' };
  return { type, roleIds: [] };
}
const emojiJson = (value: string) => {
  const text = String(value || '').trim();
  if (!text) return undefined;
  const custom = /^<(a?):(\w{2,32}):(\d{15,22})>$/.exec(text);
  if (custom) return { id: custom[3], name: custom[2], animated: custom[1] === 'a' };
  return [...text].length <= 8 ? { name: text } : undefined;
};
const colorInt = (value: string) => (/^#[0-9a-f]{6}$/i.test(value || '') ? parseInt(value.slice(1), 16) : undefined);

/** نفس renderDoc في السيرفر: للمعاينة وتبويب JSON. */
export function toApi(doc: Any, docId = 'preview'): Any {
  const button = (item: Any) => ({ type: 2, style: STYLES[item.style] ?? 2, ...(item.style === 'link' ? { url: item.url || 'https://discord.com' } : { custom_id: `es:${docId}:${item.id}` }), ...(item.label ? { label: item.label } : {}), ...(emojiJson(item.emoji) ? { emoji: emojiJson(item.emoji) } : {}), ...(item.disabled ? { disabled: true } : {}) });
  const node = (item: Any): Any => {
    switch (item.type) {
      case 'container': return { type: 17, components: item.children.map(node), ...(item.color ? { accent_color: colorInt(item.color) } : {}), ...(item.spoiler ? { spoiler: true } : {}) };
      case 'text': return { type: 10, content: item.content };
      case 'section': return { type: 9, components: item.texts.map((content: string) => ({ type: 10, content })), accessory: item.accessory.kind === 'button' ? button(item.accessory.button) : { type: 11, media: { url: item.accessory.url }, ...(item.accessory.description ? { description: item.accessory.description } : {}), ...(item.accessory.spoiler ? { spoiler: true } : {}) } };
      case 'media': return { type: 12, items: item.items.map((entry: Any) => ({ media: { url: entry.url }, ...(entry.description ? { description: entry.description } : {}), ...(entry.spoiler ? { spoiler: true } : {}) })) };
      case 'file': return { type: 13, file: { url: item.url?.startsWith('attachment://') ? item.url : `attachment://${item.name || (item.url || 'file').split('/').pop()?.split('?')[0] || 'file'}` }, ...(item.spoiler ? { spoiler: true } : {}) };
      case 'separator': return { type: 14, divider: item.divider, spacing: item.spacing === 'large' ? 2 : 1 };
      case 'buttons': return { type: 1, components: item.buttons.map(button) };
      case 'select': return { type: 1, components: [{ type: 3, custom_id: `es:${docId}:${item.select.id}`, placeholder: item.select.placeholder || undefined, min_values: item.select.min, max_values: item.select.max, ...(item.select.disabled ? { disabled: true } : {}), options: item.select.options.map((o: Any) => ({ label: o.label, value: o.id, ...(o.description ? { description: o.description } : {}), ...(emojiJson(o.emoji) ? { emoji: emojiJson(o.emoji) } : {}) })) }] };
    }
    return null;
  };
  if (doc.mode === 'v2') return { flags: 32768, components: doc.components.map(node).filter(Boolean) };
  return {
    ...(doc.content ? { content: doc.content } : {}),
    embeds: doc.embeds.map((e: Any) => ({ ...(e.title ? { title: e.title } : {}), ...(e.url ? { url: e.url } : {}), ...(e.description ? { description: e.description } : {}), ...(colorInt(e.color) !== undefined ? { color: colorInt(e.color) } : {}), ...(e.timestamp ? { timestamp: new Date().toISOString() } : {}), ...(e.author.name ? { author: { name: e.author.name, ...(e.author.url ? { url: e.author.url } : {}), ...(e.author.icon ? { icon_url: e.author.icon } : {}) } } : {}), ...(e.footer.text ? { footer: { text: e.footer.text, ...(e.footer.icon ? { icon_url: e.footer.icon } : {}) } } : {}), ...(e.thumbnail ? { thumbnail: { url: e.thumbnail } } : {}), ...(e.image ? { image: { url: e.image } } : {}), ...(e.fields.length ? { fields: e.fields } : {}) })),
    components: doc.components.map(node).filter(Boolean),
  };
}
const countComponents = (nodes: Any[]): number => nodes.reduce((total, item) => total + 1 + (item.type === 'container' ? countComponents(item.children) : 0) + (item.type === 'section' ? item.texts.length + 1 : 0) + (item.type === 'buttons' ? item.buttons.length : 0) + (item.type === 'select' ? 1 : 0), 0);
const textLength = (nodes: Any[]): number => nodes.reduce((sum, item) => sum + (item.type === 'text' ? item.content.length : item.type === 'section' ? item.texts.join('').length : item.type === 'container' ? textLength(item.children) : 0), 0);
function walk(nodes: Any[], visit: (item: Any, list: Any[], index: number, parent: Any) => void, parent: Any = null) { nodes.forEach((item, index) => { visit(item, nodes, index, parent); if (item.type === 'container') walk(item.children, visit, item); }); }
function locate(doc: Any, id: string) { let hit: Any = null; walk(doc.components, (item, list, index, parent) => { if (item.id === id) hit = { item, list, index, parent }; }); return hit; }
function findOwner(doc: Any, id: string) {
  let hit: Any = null;
  walk(doc.components, item => {
    if (item.type === 'buttons') item.buttons.forEach((b: Any) => { if (b.id === id) hit = { kind: 'button', owner: b, node: item }; });
    if (item.type === 'section' && item.accessory.kind === 'button' && item.accessory.button.id === id) hit = { kind: 'button', owner: item.accessory.button, node: item };
    if (item.type === 'select') item.select.options.forEach((o: Any) => { if (o.id === id) hit = { kind: 'option', owner: o, node: item }; });
  });
  return hit;
}
const reId = (item: Any): Any => { item.id = rid(); item.children?.forEach(reId); item.buttons?.forEach((b: Any) => { b.id = rid(); }); if (item.select) { item.select.id = rid(); item.select.options.forEach((o: Any) => { o.id = rid(); }); } if (item.accessory?.button) item.accessory.button.id = rid(); return item; };
const summary = (item: Any): string => {
  if (item.type === 'text') return item.content.split('\n')[0].slice(0, 70) || 'نص فاضي';
  if (item.type === 'container') return `${item.children.length} عنصر${item.color ? ` · ${item.color}` : ''}`;
  if (item.type === 'section') return item.texts[0]?.split('\n')[0].slice(0, 60) || 'قسم';
  if (item.type === 'media') return `${item.items.length} وسائط`;
  if (item.type === 'file') return item.name || item.url || 'بدون ملف';
  if (item.type === 'separator') return `${item.divider ? 'خط' : 'مسافة'} · ${item.spacing === 'large' ? 'كبيرة' : 'صغيرة'}`;
  if (item.type === 'buttons') return item.buttons.map((b: Any) => b.label || b.emoji).join(' · ');
  if (item.type === 'select') return `${item.select.options.length} خيار`;
  return '';
};

function convertMode(doc: Any, mode: string): Any {
  if (mode === 'v2') {
    const components: Any[] = [];
    if (doc.content) components.push({ id: rid(), type: 'text', content: doc.content });
    doc.embeds.forEach((embed: Any) => {
      const children: Any[] = [];
      const head = [embed.author.name ? `-# ${embed.author.name}` : '', embed.title ? `## ${embed.title}` : '', embed.description].filter(Boolean).join('\n');
      if (head && embed.thumbnail) children.push({ id: rid(), type: 'section', texts: [head], accessory: { kind: 'thumbnail', url: embed.thumbnail, description: '', spoiler: false } });
      else if (head) children.push({ id: rid(), type: 'text', content: head });
      if (embed.fields.length) children.push({ id: rid(), type: 'text', content: embed.fields.map((f: Any) => `**${f.name}**\n${f.value}`).join('\n\n') });
      if (embed.image) children.push({ id: rid(), type: 'media', items: [{ url: embed.image, description: '', spoiler: false }] });
      if (embed.footer.text) children.push({ id: rid(), type: 'separator', divider: true, spacing: 'small' }, { id: rid(), type: 'text', content: `-# ${embed.footer.text}` });
      components.push({ id: rid(), type: 'container', color: embed.color, spoiler: false, children: children.length ? children : [{ id: rid(), type: 'text', content: ' ' }] });
    });
    components.push(...doc.components);
    return { mode, content: '', embeds: [], components: components.length ? components : [newNode('container')] };
  }
  const embeds: Any[] = []; const rows: Any[] = []; let content = '';
  const flatten = (nodes: Any[], embed: Any) => nodes.forEach(item => {
    if (item.type === 'text') embed.description += `${embed.description ? '\n' : ''}${item.content}`;
    if (item.type === 'section') { embed.description += `${embed.description ? '\n' : ''}${item.texts.join('\n')}`; if (item.accessory.kind === 'thumbnail') embed.thumbnail = item.accessory.url; else rows.push({ id: rid(), type: 'buttons', buttons: [item.accessory.button] }); }
    if (item.type === 'media' && !embed.image) embed.image = item.items[0]?.url || '';
    if (item.type === 'buttons' || item.type === 'select') rows.push(item);
  });
  doc.components.forEach((item: Any) => {
    if (item.type === 'container') { const embed = { ...newEmbed(), title: '', color: item.color || '#8175f5' }; flatten(item.children, embed); embeds.push(embed); }
    else if (item.type === 'text') content += `${content ? '\n' : ''}${item.content}`;
    else if (item.type === 'buttons' || item.type === 'select') rows.push(item);
    else { const embed = { ...newEmbed(), title: '' }; flatten([item], embed); if (embed.description || embed.image || embed.thumbnail) embeds.push(embed); }
  });
  return { mode, content: content.slice(0, 2000), embeds: embeds.slice(0, 10), components: rows.slice(0, 5) };
}

export default async function studio(ctx: PageCtx) {
  mount(ctx.root, <PageSkeleton cards={0} />);
  let list: Any[] = [];
  let templates: Any[] = [];
  let options: Any = { roles: [], channels: [], emojis: [] };
  try {
    const [library, opts] = await Promise.all([api('/api/studio', { signal: ctx.signal }), api('/api/studio/options').catch(() => options)]);
    list = library.messages ?? []; templates = library.templates ?? []; options = opts;
  } catch (error) {
    const setup = /not set up|033_embed_studio/i.test(errorText(error));
    mount(ctx.root, [<PageHeader title="استوديو الرسائل" subtitle="ابنِ رسائل ديسكورد بأزرار وقوائم ونماذج." />, setup ? <Card><Empty icon="warning-2" title="ناقص خطوة في قاعدة البيانات" text="افتح محرر SQL في Supabase وشغّل supabase/migrations/033_embed_studio.sql ثم أعد تحميل الصفحة." /></Card> : <ErrorState message={errorText(error)} onRetry={ctx.refresh} />]);
    return;
  }
  setCustomEmojis(options.emojis);
  let ed: Any = null;
  const guard = (event: BeforeUnloadEvent) => { if (ed?.dirty) { event.preventDefault(); event.returnValue = ''; } };
  window.addEventListener('beforeunload', guard);
  const onKey = (event: KeyboardEvent) => {
    if (!ed) return;
    const key = event.key.toLowerCase();
    const typing = (event.target as HTMLElement).closest('input, textarea');
    if ((event.ctrlKey || event.metaKey) && key === 's') { event.preventDefault(); void save(); }
    if ((event.ctrlKey || event.metaKey) && key === 'z' && !typing) { event.preventDefault(); event.shiftKey ? redo() : undo(); }
    if ((event.ctrlKey || event.metaKey) && key === 'y' && !typing) { event.preventDefault(); redo(); }
  };
  document.addEventListener('keydown', onKey);
  ctx.onCleanup(() => { window.removeEventListener('beforeunload', guard); document.removeEventListener('keydown', onKey); });
  const setQuery = (id: string) => history.replaceState(history.state, '', `${location.pathname}${id ? `?id=${encodeURIComponent(id)}` : ''}`);
  const pctx = (extra: Any = {}) => ({ roles: options.roles, channels: options.channels, botName: 'Rift', ...extra });

  // ───── المكتبة ─────
  function showLibrary() {
    ed = null; setQuery(''); ctx.setCrumb(null);
    mount(ctx.root, [
      <PageHeader title="استوديو الرسائل" subtitle="صمّم رسائل Components V2 أو إمبد كلاسيكي، أضف أزرار وقوائم تشغّل خطوات، وأرسلها لأي روم." actions={[<Button icon="document-text" onClick={() => importDialog(async data => { const { message } = await api('/api/studio', { method: 'POST', body: { name: 'رسالة مستوردة', data } }); list.unshift(message); openEditor(message); })}>استيراد</Button>, <Button variant="primary" icon="add" onClick={chooseTemplate}>رسالة جديدة</Button>]} />,
      list.length ? <div class="st-grid">{list.map(item => (
        <article class="st-card">
          <button type="button" class="st-card-preview" aria-label={`تعديل ${item.name}`} onClick={() => openEditor(item)}><div class="st-mini"><DiscordMessage message={toApi(item.data, item.id)} ctx={pctx()} /></div></button>
          <div class="st-card-body"><div class="row-main"><b dir="auto">{item.name}</b><small>{item.data.mode === 'v2' ? 'Components V2' : 'إمبد كلاسيكي'} · {item.stats?.components ?? 0} عنصر · {item.sent?.length ? `انرسلت ${item.sent.length}×` : 'ما انرسلت'}</small></div>
            <div class="row-actions">
              <Button size="sm" variant="ghost" icon="copy" aria-label="نسخة" onClick={async () => { try { const { message } = await api(`/api/studio/${item.id}/duplicate`, { method: 'POST' }); list.unshift(message); showLibrary(); toast('انسخت'); } catch (error) { toastError(error); } }} />
              <Button size="sm" variant="ghost" icon="trash" aria-label="حذف" class="danger-text" onClick={async () => { if (!await confirmDialog({ title: `حذف «${item.name}»؟`, message: 'الرسائل المرسلة تبقى في ديسكورد بس أزرارها وقوائمها توقف.', confirmText: 'حذف' })) return; try { await api(`/api/studio/${item.id}`, { method: 'DELETE' }); list = list.filter(x => x.id !== item.id); showLibrary(); } catch (error) { toastError(error); } }} />
              <Button size="sm" variant="secondary" icon="edit-2" onClick={() => openEditor(item)}>تعديل</Button>
            </div></div>
        </article>
      ))}</div> : <Card><Empty icon="message-text" title="ما فيه رسائل محفوظة بعد" text="ابدأ من قالب أو صفحة فاضية. كل شي تبنيه ينحفظ هنا وتقدر ترسله مرة ثانية أو تحدّثه بعدين." action={<Button variant="primary" icon="add" onClick={chooseTemplate}>رسالة جديدة</Button>} /></Card>,
    ]);
  }
  function chooseTemplate() {
    const icons: Record<string, string> = { blank: 'add', announcement: 'notification', rules: 'shield-tick', roles: 'people', form: 'clipboard-text', embed: 'document-text' };
    openModal({ title: 'رسالة جديدة', icon: 'message-text', size: 'lg', body: close => <div class="template-grid">{templates.map(t => <button type="button" class="template" onClick={async () => { close(); try { const { message } = await api('/api/studio', { method: 'POST', body: { template: t.key } }); list.unshift(message); openEditor(message); } catch (error) { toastError(error); } }}><Icon name={icons[t.key] ?? 'category'} size={22} /><b>{t.name}</b><span>{t.mode === 'v2' ? 'Components V2' : 'إمبد كلاسيكي'}</span></button>)}</div> });
  }
  function importDialog(onData: (data: Any) => Promise<void>) {
    let link = ''; let json = '';
    openModal({
      title: 'استيراد رسالة', description: 'الصق رابط رسالة من هذا السيرفر، أو JSON من ديسكورد أو ويب هوك أو discohook.', icon: 'document-text',
      body: () => [<Field label="رابط الرسالة"><input class="input ltr" placeholder="https://discord.com/channels/…" onInput={(e: Event) => { link = (e.currentTarget as HTMLInputElement).value.trim(); }} /></Field>, <Field label="أو JSON"><textarea class="input ltr mono" rows="8" placeholder='{ "content": "…", "embeds": [ … ] }' onInput={(e: Event) => { json = (e.currentTarget as HTMLTextAreaElement).value; }} /></Field>],
      footer: close => [<Button variant="ghost" onClick={close}>إلغاء</Button>, <Button variant="primary" onClick={(e: Event) => void busy(e.currentTarget as HTMLButtonElement, async () => {
        let parsed: Any = null;
        if (!link) { try { parsed = JSON.parse(json); } catch { return toast('الـ JSON مو صحيح.', 'error'); } }
        try { const { data } = await api('/api/studio/import', { method: 'POST', body: link ? { link } : { json: parsed } }); close(); await onData(data); toast('انستوردت · الأزرار تحتفظ بشكلها، أضف لها خطوات عشان تشتغل'); } catch (error) { toastError(error); }
      })}>استيراد</Button>],
    });
  }

  // ───── المحرر ─────
  function openEditor(message: Any) {
    ed = { id: message.id, name: message.name, doc: structuredClone(message.data), sent: message.sent ?? [], dirty: false, past: [] as string[], future: [] as string[], selected: '', tab: 'preview', openSelect: '', lastSnap: 0 };
    setQuery(message.id); ctx.setCrumb(message.name);
    renderEditor();
  }
  function snapshot(force = false) {
    const now = Date.now();
    if (force || now - ed.lastSnap > 600) { ed.past.push(JSON.stringify({ doc: ed.doc, name: ed.name })); if (ed.past.length > 60) ed.past.shift(); ed.future = []; }
    ed.lastSnap = force ? 0 : now;
  }
  function undo() { if (!ed?.past.length) return; ed.future.push(JSON.stringify({ doc: ed.doc, name: ed.name })); const prev = JSON.parse(ed.past.pop()); ed.doc = prev.doc; ed.name = prev.name; ed.dirty = true; renderEditor(); }
  function redo() { if (!ed?.future.length) return; ed.past.push(JSON.stringify({ doc: ed.doc, name: ed.name })); const next = JSON.parse(ed.future.pop()); ed.doc = next.doc; ed.name = next.name; ed.dirty = true; renderEditor(); }
  async function save(): Promise<boolean> {
    if (!ed) return false;
    try {
      const { message } = await api(`/api/studio/${ed.id}`, { method: 'PUT', body: { name: ed.name, data: ed.doc } });
      ed.doc = structuredClone(message.data); ed.dirty = false; ed.sent = message.sent ?? ed.sent;
      const index = list.findIndex(item => item.id === ed.id); if (index >= 0) list[index] = message;
      toast('انحفظت'); renderEditor(); return true;
    } catch (error) { toastError(error); return false; }
  }
  let preview: ReturnType<typeof live> | null = null;
  let limits: ReturnType<typeof live> | null = null;
  let stateBadge: ReturnType<typeof live> | null = null;
  const changed = (structural = false) => { ed.dirty = true; if (structural) renderEditor(); else { preview?.update(); limits?.update(); stateBadge?.update(); } };

  function renderEditor() {
    const doc = ed.doc;
    const palette = doc.mode === 'v2' ? PALETTE_V2 : PALETTE_EMBED;
    stateBadge = live(() => <Badge tone={ed.dirty ? 'warning' : 'success'} dot>{ed.dirty ? 'تغييرات ما انحفظت' : 'محفوظ'}</Badge>, { class: 'contents' }, 'span');
    limits = live(() => (doc.mode === 'v2' ? <small class={countComponents(ed.doc.components) > 40 || textLength(ed.doc.components) > 4000 ? 'neg' : 'muted'}>{countComponents(ed.doc.components)}/40 عنصر · {textLength(ed.doc.components)}/4000 حرف</small> : <small class="muted">{ed.doc.embeds.length}/10 إمبد</small>), { class: 'contents' }, 'span');
    preview = live(() => {
      const payload = toApi(ed.doc, ed.id);
      if (ed.tab === 'json') return <div class="st-json"><Button size="sm" icon="copy" onClick={async () => toast((await copyText(JSON.stringify(payload, null, 2))) ? 'انسخ الـ JSON' : 'ما قدرنا ننسخ', 'info')}>نسخ</Button><pre class="ltr">{JSON.stringify(payload, null, 2)}</pre></div>;
      return <DiscordMessage message={payload} ctx={pctx({ interactive: true, openSelect: ed.openSelect, onButton: (customId: string) => { const id = customId.split(':')[2] ?? ''; const owner = findOwner(ed.doc, id); if (owner) { ed.selected = owner.node.id; renderEditor(); stepsDialog(id); } }, onSelect: (customId: string) => { ed.openSelect = ed.openSelect === customId ? '' : customId; preview?.update(); } })} />;
    });
    mount(ctx.root, (
      <div class="st-editor">
        <div class="builder-bar">
          <Button variant="ghost" icon="arrow-right-01" aria-label="رجوع للمكتبة" onClick={async () => { if (ed.dirty && !await confirmDialog({ title: 'تتجاهل التغييرات؟', message: 'تعديلاتك ما انحفظت.', confirmText: 'تجاهل' })) return; showLibrary(); }} />
          <input class="input st-name" dir="auto" maxlength="80" value={ed.name} aria-label="اسم الرسالة" onInput={(e: Event) => { snapshot(); ed.name = (e.currentTarget as HTMLInputElement).value; ctx.setCrumb(ed.name); changed(); }} />
          {stateBadge.node}
          <span class="spacer" />
          <Button size="sm" variant="ghost" icon="refresh-arrow-01" class="flip-x" aria-label="تراجع (Ctrl+Z)" disabled={!ed.past.length} onClick={undo} />
          <Button size="sm" variant="ghost" icon="refresh-arrow-01" aria-label="إعادة (Ctrl+Y)" disabled={!ed.future.length} onClick={redo} />
          <Seg size="sm" label="النوع" value={doc.mode} options={[{ value: 'v2', label: 'Components V2' }, { value: 'embed', label: 'إمبد كلاسيكي' }]} onChange={async mode => {
            if (mode === ed.doc.mode) return;
            if (!await confirmDialog({ title: `تحويل لـ ${mode === 'v2' ? 'Components V2' : 'إمبد كلاسيكي'}؟`, message: mode === 'v2' ? 'الإمبدات تتحول لحاويات. الأزرار والقوائم تبقى.' : 'الحاويات تتحول لإمبد واحد. المعارض والملفات والأقسام تصير نص أو صور.', confirmText: 'تحويل', danger: false })) { renderEditor(); return; }
            snapshot(true); ed.doc = convertMode(ed.doc, mode); ed.selected = ''; changed(true);
          }} />
          <Button size="sm" icon="document-text" onClick={() => importDialog(async data => { snapshot(true); ed.doc = data; ed.selected = ''; changed(true); })}>استيراد</Button>
          {ed.sent.length ? <Button size="sm" icon="refresh-circle" title="تعديل النسخ المرسلة في ديسكورد" onClick={(e: Event) => void busy(e.currentTarget as HTMLButtonElement, async () => {
            if (ed.dirty && !await save()) return;
            try { const r = await api(`/api/studio/${ed.id}/update-sent`, { method: 'POST' }); toast(r.failed?.length ? `تحدث ${r.updated}/${r.total} · ${r.failed[0]}` : `تحدثت ${r.updated} رسالة في ديسكورد`); const { message } = await api(`/api/studio/${ed.id}`); ed.sent = message.sent; renderEditor(); } catch (error) { toastError(error); }
          })}>تحديث المرسلة ({ed.sent.length})</Button> : null}
          <Button size="sm" icon="save-2" onClick={(e: Event) => void busy(e.currentTarget as HTMLButtonElement, save)}>حفظ</Button>
          <Button size="sm" variant="primary" icon="send-2" onClick={sendDialog}>حفظ وإرسال</Button>
        </div>
        <div class="st-layout">
          <aside class="st-palette">
            <div class="st-palette-head"><b>العناصر</b>{limits.node}</div>
            {palette.map(([key, label, icon, text]) => <button type="button" class="st-pal" title={text} onClick={() => addComponent(key)}><Icon name={icon} size={16} /><span><b>{label}</b><small>{text}</small></span></button>)}
            <div class="st-vars"><b>المتغيرات</b><div>{['{user}', '{user.name}', '{server}', '{members}', '{channel}', '{date}'].map(v => <code class="ltr">{v}</code>)}</div><small>في الخطوات كمان <code class="ltr">{'{option}'}</code> و<code class="ltr">{'{form.<field>}'}</code></small></div>
          </aside>
          <main class="st-tree">{tree()}</main>
          <aside class="st-preview"><Seg size="sm" label="العرض" value={ed.tab} options={[{ value: 'preview', label: 'المعاينة', icon: 'eye' }, { value: 'json', label: 'JSON' }]} onChange={v => { ed.tab = v; preview?.update(); }} /><div class="st-preview-body">{preview.node}</div></aside>
        </div>
      </div>
    ));
  }

  function addComponent(type: string) {
    const doc = ed.doc;
    snapshot(true);
    if (type === 'embed') { if (doc.embeds.length >= 10) return toast('10 إمبد كحد أقصى.', 'warning'); doc.embeds.push(newEmbed()); ed.selected = `embed-${doc.embeds.length - 1}`; return changed(true); }
    const item = newNode(type);
    if (doc.mode === 'embed') { if (doc.components.length >= 5) return toast('5 صفوف أزرار أو قوائم كحد أقصى.', 'warning'); doc.components.push(item); ed.selected = item.id; return changed(true); }
    const selected = ed.selected ? locate(doc, ed.selected) : null;
    if (type !== 'container' && selected?.item.type === 'container') selected.item.children.push(item);
    else if (type !== 'container' && selected?.parent) selected.list.splice(selected.index + 1, 0, item);
    else if (selected && !selected.parent) doc.components.splice(selected.index + 1, 0, item);
    else doc.components.push(item);
    ed.selected = item.id;
    if (countComponents(doc.components) > 40) toast('انتبه: ديسكورد يسمح بـ 40 عنصر للرسالة.', 'warning');
    changed(true);
    requestAnimationFrame(() => document.querySelector(`[data-node="${item.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }

  // حقول المحرر: تكتب في الكائن مباشرة.
  const textInput = (obj: Any, key: string, label: string, opts: { max?: number; url?: boolean; placeholder?: string; small?: boolean } = {}) => (
    <Field label={label} class={opts.small ? 'small' : undefined}><input class={`input ${opts.url ? 'ltr' : ''}`} type={opts.url ? 'url' : 'text'} dir={opts.url ? undefined : 'auto'} maxlength={opts.max ?? 500} value={obj[key] ?? ''} placeholder={opts.placeholder} onInput={(e: Event) => { snapshot(); obj[key] = (e.currentTarget as HTMLInputElement).value; changed(); }} /></Field>
  );
  const check = (obj: Any, key: string, label: string, structural = false) => <label class="check"><input type="checkbox" checked={Boolean(obj[key])} onChange={(e: Event) => { snapshot(true); obj[key] = (e.currentTarget as HTMLInputElement).checked; changed(structural); }} /> {label}</label>;
  function mdField(obj: Any, key: string, max: number) {
    let area: HTMLTextAreaElement | null = null;
    const counter = live(() => `${String(obj[key] ?? '').length}/${max}`, { class: 'st-count' }, 'small');
    const format = (wrap?: string, prefix?: string) => {
      if (!area) return;
      const { selectionStart: start, selectionEnd: end, value } = area;
      if (wrap) { const sel = value.slice(start, end) || 'نص'; area.setRangeText(`${wrap}${sel}${wrap}`, start, end, 'end'); area.setSelectionRange(start + wrap.length, start + wrap.length + sel.length); }
      else if (prefix) { const lineStart = value.lastIndexOf('\n', start - 1) + 1; area.setRangeText(prefix, lineStart, lineStart, 'end'); }
      area.focus(); area.dispatchEvent(new Event('input', { bubbles: true }));
    };
    return (
      <div class="st-md">
        <div class="st-md-tools">{[['**', 'B', 'عريض'], ['*', 'I', 'مائل'], ['__', 'U', 'تسطير'], ['~~', 'S', 'شطب'], ['`', '</>', 'كود'], ['||', '▒', 'مخفي']].map(([w, l, t]) => <button type="button" title={t} onClick={() => format(w)}>{l}</button>)}{[['# ', 'H1'], ['## ', 'H2'], ['### ', 'H3'], ['> ', '❝'], ['- ', '•'], ['-# ', 'صغير']].map(([p, l]) => <button type="button" title={`سطر: ${p!.trim()}`} onClick={() => format(undefined, p)}>{l}</button>)}</div>
        <textarea class="input" dir="auto" rows={Math.min(12, Math.max(3, String(obj[key] ?? '').split('\n').length + 1))} maxlength={max} ref={(el: HTMLTextAreaElement) => { area = el; }} onInput={(e: Event) => { snapshot(); obj[key] = (e.currentTarget as HTMLTextAreaElement).value; counter.update(); changed(); }}>{obj[key] ?? ''}</textarea>
        {counter.node}
      </div>
    );
  }
  function buttonEditor(button: Any) {
    return (
      <div class="st-button-row">
        <span class={`st-swatch s-${button.style}`} />
        <input class="input" dir="auto" maxlength="80" value={button.label} placeholder="النص" aria-label="نص الزر" onInput={(e: Event) => { snapshot(); button.label = (e.currentTarget as HTMLInputElement).value; changed(); }} />
        <input class="input st-emoji" maxlength="64" value={button.emoji} placeholder="إيموجي أو <:name:id>" aria-label="إيموجي" onInput={(e: Event) => { snapshot(); button.emoji = (e.currentTarget as HTMLInputElement).value; changed(); }} />
        <Select value={button.style} aria-label="اللون" options={Object.entries(STYLE_LABEL).map(([value, label]) => ({ value, label }))} onChange={(e: Event) => { snapshot(true); button.style = (e.currentTarget as HTMLSelectElement).value; if (button.style === 'link') { button.actions = []; button.url = button.url || 'https://'; } else { button.url = ''; if (!button.actions.length) button.actions = [newAction('reply')]; } changed(true); }} />
        {button.style === 'link' ? <input class="input ltr" type="url" value={button.url} placeholder="https://…" aria-label="الرابط" onInput={(e: Event) => { snapshot(); button.url = (e.currentTarget as HTMLInputElement).value; changed(); }} /> : <Button size="sm" variant="soft" icon="flash" onClick={() => stepsDialog(button.id)}>خطوات · {button.actions.length}</Button>}
        <label class="check" title="معطّل"><input type="checkbox" checked={button.disabled} onChange={(e: Event) => { snapshot(true); button.disabled = (e.currentTarget as HTMLInputElement).checked; changed(); }} /> معطّل</label>
      </div>
    );
  }
  function nodeEditor(item: Any): Child {
    const structural = () => { snapshot(true); changed(true); };
    switch (item.type) {
      case 'container': return [<div class="inline-fields"><Field label="لون الحافة" class="small"><input class="input" type="color" value={safeColor(item.color) || '#8175f5'} disabled={!item.color} onInput={(e: Event) => { snapshot(); item.color = (e.currentTarget as HTMLInputElement).value; changed(); }} /></Field><label class="check"><input type="checkbox" checked={!item.color} onChange={(e: Event) => { item.color = (e.currentTarget as HTMLInputElement).checked ? '' : '#8175f5'; structural(); }} /> بدون لون</label></div>, check(item, 'spoiler', 'مخفي (ضبابي لين يضغط عليه)')];
      case 'text': return mdField(item, 'content', 4000);
      case 'section': return [
        item.texts.map((_: string, index: number) => <div class="st-sub"><div class="st-sub-head"><b>النص {index + 1}</b>{item.texts.length > 1 ? <Button size="sm" variant="ghost" class="danger-text" onClick={() => { item.texts.splice(index, 1); structural(); }}>حذف</Button> : null}</div>{mdField(item.texts, String(index), 4000)}</div>),
        item.texts.length < 3 ? <Button size="sm" variant="ghost" icon="add" onClick={() => { item.texts.push('نص جديد'); structural(); }}>إضافة نص</Button> : null,
        <div class="st-sub"><div class="st-sub-head"><b>الجانب</b><Seg size="sm" label="نوع الجانب" value={item.accessory.kind} options={[{ value: 'thumbnail', label: 'صورة' }, { value: 'button', label: 'زر' }]} onChange={v => { if (v === item.accessory.kind) return; item.accessory = v === 'button' ? { kind: 'button', button: newButton() } : { kind: 'thumbnail', url: 'https://cdn.discordapp.com/embed/avatars/0.png', description: '', spoiler: false }; structural(); }} /></div>
          {item.accessory.kind === 'thumbnail' ? [<div class="inline-fields">{textInput(item.accessory, 'url', 'رابط الصورة', { url: true, max: 1000 })}{textInput(item.accessory, 'description', 'نص بديل', { max: 1024 })}</div>, check(item.accessory, 'spoiler', 'مخفي')] : buttonEditor(item.accessory.button)}</div>,
      ];
      case 'media': return [item.items.map((entry: Any, index: number) => <div class="st-media-row"><input class="input ltr" type="url" value={entry.url} placeholder="https://… صورة أو gif أو فيديو" onInput={(e: Event) => { snapshot(); entry.url = (e.currentTarget as HTMLInputElement).value; changed(); }} /><input class="input" dir="auto" maxlength="1024" value={entry.description} placeholder="نص بديل" onInput={(e: Event) => { snapshot(); entry.description = (e.currentTarget as HTMLInputElement).value; changed(); }} />{check(entry, 'spoiler', 'مخفي')}<Button size="sm" variant="ghost" icon="x" aria-label="حذف" disabled={item.items.length <= 1} onClick={() => { item.items.splice(index, 1); structural(); }} /></div>), item.items.length < 10 ? <Button size="sm" variant="ghost" icon="add" onClick={() => { item.items.push({ url: '', description: '', spoiler: false }); structural(); }}>إضافة وسائط</Button> : null];
      case 'file': return [<div class="inline-fields">{textInput(item, 'url', 'رابط الملف', { url: true, max: 1000, placeholder: 'https://…/rules.pdf' })}{textInput(item, 'name', 'اسم الملف', { max: 100, placeholder: 'rules.pdf' })}</div>, <p class="field-hint"><Icon name="info-circle" size={13} /> الملف ينزل وينرفق وقت الإرسال (لين 10 ميقا).</p>, check(item, 'spoiler', 'مخفي')];
      case 'separator': return <div class="inline-fields">{check(item, 'divider', 'اعرض خط فاصل')}<Seg size="sm" label="المسافة" value={item.spacing} options={[{ value: 'small', label: 'صغيرة' }, { value: 'large', label: 'كبيرة' }]} onChange={v => { item.spacing = v; structural(); }} /></div>;
      case 'buttons': return [item.buttons.map((button: Any, index: number) => <div class="st-list-item">{buttonEditor(button)}<span class="row-actions"><Button size="sm" variant="ghost" icon="arrow-up-04" aria-label="لفوق" disabled={index === 0} onClick={() => { item.buttons.splice(index - 1, 0, item.buttons.splice(index, 1)[0]); structural(); }} /><Button size="sm" variant="ghost" icon="x" aria-label="حذف" disabled={item.buttons.length <= 1} onClick={() => { item.buttons.splice(index, 1); structural(); }} /></span></div>), item.buttons.length < 5 ? <div class="row-actions"><Button size="sm" variant="ghost" icon="add" onClick={() => { item.buttons.push(newButton()); structural(); }}>إضافة زر</Button><Button size="sm" variant="ghost" icon="link" onClick={() => { item.buttons.push(newButton('link')); structural(); }}>زر رابط</Button></div> : null];
      case 'select': return [
        <div class="inline-fields">{textInput(item.select, 'placeholder', 'النص الظاهر', { max: 150 })}
          <Field label="أقل اختيار" class="small"><input class="input" type="number" min="0" max={item.select.options.length} value={String(item.select.min)} onChange={(e: Event) => { item.select.min = Math.max(0, Number((e.currentTarget as HTMLInputElement).value) || 0); item.select.min = Math.min(item.select.min, item.select.max); structural(); }} /></Field>
          <Field label="أكثر اختيار" class="small"><input class="input" type="number" min="1" max={item.select.options.length} value={String(item.select.max)} onChange={(e: Event) => { item.select.max = Math.max(1, Math.min(item.select.options.length, Number((e.currentTarget as HTMLInputElement).value) || 1)); item.select.min = Math.min(item.select.min, item.select.max); structural(); }} /></Field></div>,
        check(item.select, 'disabled', 'معطّلة'),
        item.select.options.map((option: Any, index: number) => <div class="st-option-row"><input class="input st-emoji" value={option.emoji} placeholder="إيموجي" onInput={(e: Event) => { snapshot(); option.emoji = (e.currentTarget as HTMLInputElement).value; changed(); }} /><input class="input" dir="auto" maxlength="100" value={option.label} placeholder="النص" onInput={(e: Event) => { snapshot(); option.label = (e.currentTarget as HTMLInputElement).value; changed(); }} /><input class="input" dir="auto" maxlength="100" value={option.description} placeholder="وصف (اختياري)" onInput={(e: Event) => { snapshot(); option.description = (e.currentTarget as HTMLInputElement).value; changed(); }} /><Button size="sm" variant="soft" icon="flash" onClick={() => stepsDialog(option.id)}>خطوات · {option.actions.length}</Button><Button size="sm" variant="ghost" icon="x" aria-label="حذف" disabled={item.select.options.length <= 1} onClick={() => { item.select.options.splice(index, 1); item.select.max = Math.min(item.select.max, item.select.options.length); item.select.min = Math.min(item.select.min, item.select.max); structural(); }} /></div>),
        item.select.options.length < 25 ? <Button size="sm" variant="ghost" icon="add" onClick={() => { item.select.options.push({ id: rid(), label: `الخيار ${item.select.options.length + 1}`, description: '', emoji: '', actions: [newAction('reply')] }); structural(); }}>إضافة خيار</Button> : null,
      ];
    }
    return null;
  }
  function nodeCard(item: Any, listRef: Any[], index: number): Child {
    const open = ed.selected === item.id;
    const meta = LABELS[item.type] ?? { label: item.type, icon: 'category' };
    const structural = () => { snapshot(true); changed(true); };
    return (
      <article class={`st-node t-${item.type} ${open ? 'open' : ''}`} data-node={item.id} style={item.type === 'container' && safeColor(item.color) ? { '--node': item.color } : undefined}>
        <header class="st-node-head" onClick={(e: Event) => { if ((e.target as HTMLElement).closest('button')) return; ed.selected = open ? '' : item.id; renderEditor(); }}>
          <span class="st-node-icon"><Icon name={meta.icon} size={15} /></span><b>{meta.label}</b><span class="st-node-sum" dir="auto">{summary(item)}</span>
          <span class="row-actions">
            <Button size="sm" variant="ghost" icon="arrow-up-04" aria-label="لفوق" disabled={index === 0} onClick={() => { listRef.splice(index - 1, 0, listRef.splice(index, 1)[0]); structural(); }} />
            <Button size="sm" variant="ghost" icon="arrow-down-01" aria-label="لتحت" disabled={index === listRef.length - 1} onClick={() => { listRef.splice(index + 1, 0, listRef.splice(index, 1)[0]); structural(); }} />
            <Button size="sm" variant="ghost" icon="copy" aria-label="نسخة" onClick={() => { const copy = reId(structuredClone(item)); listRef.splice(index + 1, 0, copy); ed.selected = copy.id; structural(); }} />
            <Button size="sm" variant="ghost" icon="trash" aria-label="حذف" class="danger-text" onClick={() => { listRef.splice(index, 1); if (ed.selected === item.id) ed.selected = ''; structural(); }} />
          </span>
        </header>
        {open ? <div class="st-node-body">{nodeEditor(item)}</div> : null}
        {item.type === 'container' ? <div class="st-children">{item.children.length ? item.children.map((child: Any, i: number) => nodeCard(child, item.children, i)) : <div class="st-hint">حاوية فاضية — حددها واختر عناصر من اليمين.</div>}</div> : null}
      </article>
    );
  }
  function embedCard(embed: Any, index: number): Child {
    const key = `embed-${index}`;
    const open = ed.selected === key;
    const embeds = ed.doc.embeds;
    const structural = () => { snapshot(true); changed(true); };
    return (
      <article class={`st-node t-embed ${open ? 'open' : ''}`} style={{ '--node': safeColor(embed.color) || '#1e1f22' }}>
        <header class="st-node-head" onClick={(e: Event) => { if ((e.target as HTMLElement).closest('button')) return; ed.selected = open ? '' : key; renderEditor(); }}>
          <span class="st-node-icon"><Icon name="clipboard-text" size={15} /></span><b>إمبد {index + 1}</b><span class="st-node-sum" dir="auto">{embed.title || embed.description.slice(0, 60) || 'إمبد فاضي'}</span>
          <span class="row-actions">
            <Button size="sm" variant="ghost" icon="arrow-up-04" aria-label="لفوق" disabled={index === 0} onClick={() => { embeds.splice(index - 1, 0, embeds.splice(index, 1)[0]); ed.selected = `embed-${index - 1}`; structural(); }} />
            <Button size="sm" variant="ghost" icon="copy" aria-label="نسخة" onClick={() => { if (embeds.length >= 10) return toast('10 إمبد كحد أقصى.', 'warning'); embeds.splice(index + 1, 0, structuredClone(embed)); structural(); }} />
            <Button size="sm" variant="ghost" icon="trash" aria-label="حذف" class="danger-text" onClick={() => { embeds.splice(index, 1); ed.selected = ''; structural(); }} />
          </span>
        </header>
        {open ? <div class="st-node-body">
          <div class="inline-fields">{textInput(embed.author, 'name', 'الكاتب', { max: 256 })}{textInput(embed.author, 'icon', 'صورة الكاتب', { url: true })}{textInput(embed.author, 'url', 'رابط الكاتب', { url: true })}</div>
          <div class="inline-fields">{textInput(embed, 'title', 'العنوان', { max: 256 })}{textInput(embed, 'url', 'رابط العنوان', { url: true })}<Field label="اللون" class="small"><input class="input" type="color" value={safeColor(embed.color) || '#8175f5'} onInput={(e: Event) => { snapshot(); embed.color = (e.currentTarget as HTMLInputElement).value; changed(); }} /></Field></div>
          {mdField(embed, 'description', 4096)}
          <div class="st-sub"><div class="st-sub-head"><b>الحقول</b><small>{embed.fields.length}/25</small></div>
            {embed.fields.map((f: Any, fi: number) => <div class="st-field-row"><input class="input" dir="auto" maxlength="256" value={f.name} placeholder="الاسم" onInput={(e: Event) => { snapshot(); f.name = (e.currentTarget as HTMLInputElement).value; changed(); }} /><textarea class="input" dir="auto" rows="1" maxlength="1024" placeholder="القيمة" onInput={(e: Event) => { snapshot(); f.value = (e.currentTarget as HTMLTextAreaElement).value; changed(); }}>{f.value}</textarea>{check(f, 'inline', 'سطر')}<Button size="sm" variant="ghost" icon="x" aria-label="حذف" onClick={() => { embed.fields.splice(fi, 1); structural(); }} /></div>)}
            {embed.fields.length < 25 ? <Button size="sm" variant="ghost" icon="add" onClick={() => { embed.fields.push({ name: 'حقل', value: 'قيمة', inline: true }); structural(); }}>إضافة حقل</Button> : null}</div>
          <div class="inline-fields">{textInput(embed, 'thumbnail', 'صورة مصغرة', { url: true })}{textInput(embed, 'image', 'صورة كبيرة', { url: true })}</div>
          <div class="inline-fields">{textInput(embed.footer, 'text', 'التذييل', { max: 2048 })}{textInput(embed.footer, 'icon', 'صورة التذييل', { url: true })}</div>
          {check(embed, 'timestamp', 'اعرض الوقت')}
        </div> : null}
      </article>
    );
  }
  function tree(): Child {
    const doc = ed.doc;
    if (doc.mode === 'embed') return [
      <section class="st-node open"><header class="st-node-head"><span class="st-node-icon"><Icon name="message-text" size={15} /></span><b>نص الرسالة</b><span class="st-node-sum">النص فوق الإمبدات</span></header><div class="st-node-body">{mdField(doc, 'content', 2000)}</div></section>,
      doc.embeds.map(embedCard),
      doc.components.map((item: Any, index: number) => nodeCard(item, doc.components, index)),
      doc.embeds.length || doc.components.length ? null : <div class="st-hint">أضف إمبد من القائمة.</div>,
    ];
    return doc.components.length ? doc.components.map((item: Any, index: number) => nodeCard(item, doc.components, index)) : <div class="st-hint big">أضف «حاوية» من القائمة عشان تبدأ.</div>;
  }

  // ───── الخطوات (أزرار وخيارات) ─────
  function stepsDialog(ownerId: string) {
    const hit = findOwner(ed.doc, ownerId);
    if (!hit) return;
    const owner = hit.owner;
    const multi = hit.kind === 'option' && hit.node.select.max > 1;
    let selected = 0;
    let submitSelected = -1;
    let touched = false;
    const commit = () => { touched = true; ed.dirty = true; preview?.update(); stateBadge?.update(); body.update(); };
    const others = () => list.filter(item => item.id !== ed.id);
    const stepSummary = (a: Any) => a.type === 'reply' ? (a.messageId ? `رسالة محفوظة: ${list.find(i => i.id === a.messageId)?.name ?? '?'}` : a.content.slice(0, 50)) : a.roleIds ? `${a.roleIds.length} رتبة` : a.type === 'form' ? `${a.fields.length} سؤال` : a.type === 'channel' ? (options.channels.find((c: Any) => c.id === a.channelId) ? `#${options.channels.find((c: Any) => c.id === a.channelId).name.split(' / ').pop()}` : 'بدون روم') : (a.content || '').slice(0, 50);
    const vars = (inForm?: Any) => <small class="field-hint">المتغيرات: <code class="ltr">{'{user}'}</code> <code class="ltr">{'{user.name}'}</code> <code class="ltr">{'{server}'}</code>{hit.kind === 'option' ? <code class="ltr">{' {option}'}</code> : null}{inForm ? inForm.fields.map((f: Any) => <code class="ltr">{` {form.${f.id}}`}</code>) : null}</small>;
    const text = (a: Any, key: string, label: string, inForm?: Any) => <Field label={label}><textarea class="input" dir="auto" rows="3" maxlength="2000" onInput={(e: Event) => { a[key] = (e.currentTarget as HTMLTextAreaElement).value; touched = true; ed.dirty = true; preview?.update(); }}>{a[key] ?? ''}</textarea>{vars(inForm)}</Field>;
    function settings(a: Any, inForm?: Any): Child {
      switch (a.type) {
        case 'reply': return [
          <Field label="الرد" as="div"><Seg size="sm" label="نوع الرد" value={a.messageId ? 'message' : 'text'} options={[{ value: 'text', label: 'نص' }, { value: 'message', label: 'رسالة محفوظة' }]} onChange={v => { a.messageId = v === 'message' ? others()[0]?.id ?? '' : ''; if (v === 'message' && !a.messageId) toast('احفظ رسالة ثانية أول عشان ترسلها كرد.', 'warning'); commit(); }} /></Field>,
          a.messageId ? <Field label="الرسالة"><Select value={a.messageId} options={others().map(i => ({ value: i.id, label: i.name }))} onChange={(e: Event) => { a.messageId = (e.currentTarget as HTMLSelectElement).value; commit(); }} /></Field> : text(a, 'content', 'النص', inForm),
          <Toggle checked={a.ephemeral} label="يشوفها هو بس" hint="رد مخفي ما يشوفه غيره." onChange={v => { a.ephemeral = v; commit(); }} />,
        ];
        case 'addRoles': case 'removeRoles': case 'toggleRoles': return (
          <Field label="الرتب" as="div" hint="رتبة البوت لازم تكون فوقها. الرتب اللي فيها صلاحيات إشراف أو أدمن ما تنعطى من زر، وتختار بس رتب تحت رتبتك.">
            <div class="role-picker">{a.roleIds.map((id: string) => { const role = options.roles.find((r: Any) => r.id === id); return <span class={`chip ${role && role.manageable === false ? 'warn' : ''}`}><i class="chip-dot" style={{ background: roleColor(role) }} />{role?.name ?? 'رتبة محذوفة'}<button type="button" class="chip-x" aria-label="إزالة" onClick={() => { a.roleIds = a.roleIds.filter((x: string) => x !== id); commit(); }}><Icon name="x" size={12} /></button></span>; })}
              {a.roleIds.length < 10 ? <select class="input chip-add" aria-label="إضافة رتبة" onChange={(e: Event) => { const v = (e.currentTarget as HTMLSelectElement).value; if (v) { a.roleIds.push(v); commit(); } }}><option value="">+ إضافة رتبة</option>{options.roles.filter((r: Any) => !a.roleIds.includes(r.id)).map((r: Any) => <option value={r.id} disabled={!(r.manageable !== false && (!r.dangerous || a.type === 'removeRoles'))}>{r.name}{r.manageable === false ? ' (فوق البوت)' : r.dangerous && a.type !== 'removeRoles' ? ' (صلاحيات إشراف)' : ''}</option>)}</select> : null}</div>
          </Field>
        );
        case 'dm': return text(a, 'content', 'الرسالة الخاصة', inForm);
        case 'channel': return [
          <Field label="الروم"><ChannelSelect channels={options.channels} value={a.channelId} onChange={(e: Event) => { a.channelId = (e.currentTarget as HTMLSelectElement).value; commit(); }} /></Field>,
          inForm ? <Field label="الشكل" as="div"><Seg size="sm" label="الشكل" value={a.format} options={[{ value: 'answers', label: 'إمبد الإجابات' }, { value: 'text', label: 'نص مخصص' }]} onChange={v => { a.format = v; commit(); }} /></Field> : null,
          text(a, 'content', a.format === 'answers' && inForm ? 'نص فوق الإجابات (اختياري)' : 'الرسالة', inForm),
        ];
        case 'form': return formEditor(a);
      }
      return null;
    }
    function formEditor(f: Any): Child {
      return [
        <Field label="عنوان النموذج"><input class="input" dir="auto" maxlength="45" value={f.title} onInput={(e: Event) => { f.title = (e.currentTarget as HTMLInputElement).value; touched = true; ed.dirty = true; }} /></Field>,
        <div class="st-sub"><div class="st-sub-head"><b>الأسئلة</b><small>{f.fields.length}/5</small></div>
          {f.fields.map((q: Any, i: number) => (
            <div class="st-form-field">
              <div class="inline-fields"><Field label="السؤال"><input class="input" dir="auto" maxlength="45" value={q.label} onInput={(e: Event) => { q.label = (e.currentTarget as HTMLInputElement).value; touched = true; }} /></Field><Field label="النوع" class="small"><Select value={q.style} options={[{ value: 'short', label: 'قصير' }, { value: 'paragraph', label: 'فقرة' }]} onChange={(e: Event) => { q.style = (e.currentTarget as HTMLSelectElement).value; touched = true; }} /></Field></div>
              <div class="inline-fields"><Field label="تلميح"><input class="input" dir="auto" maxlength="100" value={q.description} placeholder="يظهر تحت السؤال" onInput={(e: Event) => { q.description = (e.currentTarget as HTMLInputElement).value; touched = true; }} /></Field><Field label="نص داخل الخانة"><input class="input" dir="auto" maxlength="100" value={q.placeholder} onInput={(e: Event) => { q.placeholder = (e.currentTarget as HTMLInputElement).value; touched = true; }} /></Field></div>
              <div class="st-form-foot"><label class="check"><input type="checkbox" checked={q.required} onChange={(e: Event) => { q.required = (e.currentTarget as HTMLInputElement).checked; touched = true; }} /> مطلوب</label><code class="ltr" title="استخدمه في خطوات بعد الإرسال">{`{form.${q.id}}`}</code><Button size="sm" variant="ghost" class="danger-text" disabled={f.fields.length <= 1} onClick={() => { f.fields.splice(i, 1); commit(); }}>حذف</Button></div>
            </div>
          ))}
          {f.fields.length < 5 ? <Button size="sm" variant="ghost" icon="add" onClick={() => { f.fields.push({ id: rid(), label: 'سؤال', description: '', style: 'short', required: true, placeholder: '', min: null, max: null }); commit(); }}>إضافة سؤال</Button> : null}</div>,
        <div class="st-sub"><div class="st-sub-head"><b>بعد الإرسال</b><small>{f.submit.length}/10</small></div>
          <div class="st-steps-list">{f.submit.map((a: Any, i: number) => <div class={`st-step ${submitSelected === i ? 'on' : ''}`} role="button" tabindex="0" onClick={() => { submitSelected = i; body.update(); }}><i>{i + 1}</i><Icon name={CAT[a.type]!.icon} size={15} /><span><b>{CAT[a.type]!.label}</b><small>{stepSummary(a)}</small></span><Button size="sm" variant="ghost" icon="trash" aria-label="حذف" onClick={(e: Event) => { e.stopPropagation(); f.submit.splice(i, 1); submitSelected = -1; commit(); }} /></div>)}{f.submit.length ? null : <p class="muted">ما فيه شي بعد الإرسال — بيوصلهم رد «شكرًا» افتراضي.</p>}</div>
          <div class="st-catalog mini">{CATALOG.filter(([key]) => key !== 'form').map(([key, label, icon]) => <Button size="sm" variant="ghost" icon={icon} onClick={() => { if (f.submit.length >= 10) return toast('10 خطوات كحد أقصى.', 'warning'); const a = newAction(key); if (a.type === 'channel') a.format = 'answers'; f.submit.push(a); submitSelected = f.submit.length - 1; commit(); }}>{label}</Button>)}</div>
          {f.submit[submitSelected] ? <div class="st-step-settings">{settings(f.submit[submitSelected], f)}</div> : null}
        </div>,
      ];
    }
    const body = live(() => (
      <div class="st-steps">
        <div class="st-steps-main">
          <div class="st-sub-head"><b>الخطوات</b><small class="muted">تشتغل بالترتيب لما {hit.kind === 'button' ? 'ينضغط الزر' : 'ينختار هالخيار'}.</small></div>
          <div class="st-steps-list">{owner.actions.map((a: Any, i: number) => (
            <div class={`st-step ${selected === i ? 'on' : ''}`} role="button" tabindex="0" onClick={() => { selected = i; submitSelected = -1; body.update(); }}>
              <i>{String(i + 1).padStart(2, '0')}</i><Icon name={CAT[a.type]!.icon} size={15} /><span><b>{CAT[a.type]!.label}</b><small>{stepSummary(a)}</small></span>
              {i > 0 ? <Button size="sm" variant="ghost" icon="arrow-up-04" aria-label="لفوق" onClick={(e: Event) => { e.stopPropagation(); if (owner.actions[i - 1].type === 'form') return toast('النموذج لازم يبقى أول.', 'warning'); owner.actions.splice(i - 1, 0, owner.actions.splice(i, 1)[0]); selected = i - 1; commit(); }} /> : null}
              <Button size="sm" variant="ghost" icon="trash" aria-label="حذف" onClick={(e: Event) => { e.stopPropagation(); owner.actions.splice(i, 1); selected = Math.max(0, Math.min(selected, owner.actions.length - 1)); commit(); }} />
            </div>
          ))}{owner.actions.length ? null : <Empty compact icon="flash" title="ما فيه خطوات بعد" text="اختر نوع خطوة من الكتالوج." />}</div>
          <div class="st-step-settings">{owner.actions[selected] ? settings(owner.actions[selected]) : <p class="muted">اختر خطوة عشان تضبطها.</p>}</div>
        </div>
        <aside class="st-catalog"><b>الكتالوج</b>{CATALOG.map(([key, label, icon, text]) => {
          const disabled = key === 'form' && (owner.actions.length > 0 || multi);
          return <button type="button" class="st-cat" disabled={disabled} title={key === 'form' ? (multi ? 'النماذج تحتاج قائمة اختيار واحد' : 'النموذج لازم يكون أول خطوة') : ''} onClick={() => { if (owner.actions.length >= 10) return toast('10 خطوات كحد أقصى.', 'warning'); const a = newAction(key); if (a.type === 'form') owner.actions.unshift(a); else owner.actions.push(a); selected = a.type === 'form' ? 0 : owner.actions.length - 1; submitSelected = -1; commit(); }}><Icon name={icon} size={16} /><span><b>{label}</b><small>{text}</small></span><Icon name="add" size={14} /></button>;
        })}{owner.actions[0]?.type === 'form' ? <p class="field-hint">النموذج يفتح نافذة ديسكورد أول، وخطوات «بعد الإرسال» تشتغل لما ينرسل.</p> : null}</aside>
      </div>
    ));
    snapshot(true);
    openModal({ title: `${hit.kind === 'button' ? 'زر' : 'خيار'} · ${owner.label || owner.emoji || 'بدون اسم'}`, icon: 'flash', size: 'xl', body: () => body.node, onClose: () => { if (touched) changed(true); }, footer: close => <Button variant="primary" onClick={close}>تم</Button> });
  }

  function sendDialog() {
    let q = '';
    const channels = live(() => <div class="st-channels">{options.channels.filter((c: Any) => !q || c.name.toLowerCase().includes(q)).map((c: Any) => <button type="button" class="st-channel" onClick={(e: Event) => void busy(e.currentTarget as HTMLButtonElement, async () => {
      if (ed.dirty && !await save()) return;
      try { const result = await api(`/api/studio/${ed.id}/send`, { method: 'POST', body: { channelId: c.id } }); handle.close(); ed.sent.push({ channelId: c.id }); toast('انرسلت لديسكورد'); renderEditor(); if (result.url) window.open(result.url, '_blank', 'noopener,noreferrer'); } catch (error) { toastError(error); }
    })}><span>#</span>{c.name}</button>)}</div>);
    const handle = openModal({ title: 'إرسال لديسكورد', description: 'الرسالة تنحفظ أول. تقدر ترسلها لرومات زيادة وتحدّث كل النسخ بعدين.', icon: 'send-2', body: () => [<input class="input" type="search" placeholder="ابحث عن روم…" autofocus onInput={(e: Event) => { q = (e.currentTarget as HTMLInputElement).value.toLowerCase(); channels.update(); }} />, channels.node] });
  }

  const id = new URLSearchParams(location.search).get('id');
  const found = id ? list.find(item => item.id === id) : null;
  if (found) openEditor(found); else showLibrary();
  void Notice;
}
