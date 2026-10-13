import { api, esc, toast } from '../ui.js';
import { ic } from '../icon.js';
import { confirmAction } from '../confirm.js';
import { renderMessage, setCustomEmojis } from '../discord-preview.js';
// Values that end up inside a style attribute: encode/limit them so they cannot close the CSS value and add styles.
const cssUrl = value => String(value || '').replace(/['"()\\\s<>]/g, char => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`);
const safeColor = value => (/^#[0-9a-f]{3,8}$/i.test(String(value || '')) ? String(value) : '');

// ---- Model helpers -----------------------------------------------------------------------------

const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), byte => (byte % 36).toString(36)).join('');
const clone = value => structuredClone(value);
const STYLES = { primary: 1, secondary: 2, success: 3, danger: 4, link: 5 };
const PALETTE_V2 = [
  ['container', 'Container', 'category', 'Groups components in a card with an optional accent colour.'],
  ['text', 'Text', 'note-text', 'Markdown text: headings, lists, quotes, mentions.'],
  ['section', 'Section', 'user-square', 'Up to 3 text blocks with a thumbnail or button on the side.'],
  ['media', 'Media', 'monitor', 'A gallery of up to 10 images or videos.'],
  ['file', 'File', 'document-text', 'Attach a file from a link.'],
  ['separator', 'Separator', 'minus-circle', 'Spacing, with or without a divider line.'],
  ['buttons', 'Buttons', 'flash', 'A row of up to 5 buttons that run steps or open links.'],
  ['select', 'Select menu', 'sort', 'A dropdown where each option runs its own steps.'],
];
const PALETTE_EMBED = [['embed', 'Embed', 'clipboard-text', 'A classic Discord embed (up to 10).'], ['buttons', 'Buttons', 'flash', 'A row of up to 5 buttons.'], ['select', 'Select menu', 'sort', 'A dropdown menu.']];
const LABELS = Object.fromEntries([...PALETTE_V2, ...PALETTE_EMBED].map(([key, label, icon]) => [key, { label, icon }]));
const CATALOG = [
  ['reply', 'Send a message', 'message-text', 'Reply to the person who clicked'],
  ['form', 'Open question form', 'clipboard-text', 'Collect answers in a Discord modal'],
  ['addRoles', 'Add roles', 'user-add', 'Give roles to the member'],
  ['removeRoles', 'Remove roles', 'user-remove', 'Take roles from the member'],
  ['toggleRoles', 'Toggle roles', 'refresh-circle', 'Add if missing, remove if present'],
  ['dm', 'Send a direct message', 'send-2', 'DM the member'],
  ['channel', 'Post to a channel', 'global', 'Send a message into a chosen channel'],
];
const CATALOG_MAP = Object.fromEntries(CATALOG.map(([key, label, icon, text]) => [key, { label, icon, text }]));

const newButton = (style = 'primary') => ({ id: rid(), label: 'New button', emoji: '', style, url: '', disabled: false, actions: style === 'link' ? [] : [{ type: 'reply', content: 'Thanks!', ephemeral: true, messageId: '' }] });
const newEmbed = () => ({ title: 'New embed', url: '', description: '', color: '#8175f5', timestamp: false, author: { name: '', url: '', icon: '' }, footer: { text: '', icon: '' }, thumbnail: '', image: '', fields: [] });
function newNode(type) {
  const id = rid();
  switch (type) {
    case 'container': return { id, type, color: '#8175f5', spoiler: false, children: [{ id: rid(), type: 'text', content: '## Title\nWrite something here.' }] };
    case 'text': return { id, type, content: 'New text' };
    case 'section': return { id, type, texts: ['**Section title**\nSome text next to the image.'], accessory: { kind: 'thumbnail', url: 'https://cdn.discordapp.com/embed/avatars/0.png', description: '', spoiler: false } };
    case 'media': return { id, type, items: [{ url: '', description: '', spoiler: false }] };
    case 'file': return { id, type, url: '', name: '', spoiler: false };
    case 'separator': return { id, type, divider: true, spacing: 'small' };
    case 'buttons': return { id, type, buttons: [newButton()] };
    case 'select': return { id, type, select: { id: rid(), placeholder: 'Choose an option', min: 1, max: 1, disabled: false, options: [{ id: rid(), label: 'Option 1', description: '', emoji: '', actions: [{ type: 'reply', content: 'You picked {option}.', ephemeral: true, messageId: '' }] }] } };
  }
  return null;
}
function newAction(type) {
  if (type === 'reply') return { type, content: 'Thanks!', ephemeral: true, messageId: '' };
  if (type === 'form') return { type, title: 'Form', fields: [{ id: rid(), label: 'Your answer', description: '', style: 'short', required: true, placeholder: '', min: null, max: null }], submit: [{ type: 'reply', content: '✅ Thanks, your answers were sent.', ephemeral: true, messageId: '' }] };
  if (type === 'dm') return { type, content: 'Hello {user.name}!' };
  if (type === 'channel') return { type, channelId: '', content: '{user} used a button', format: 'text' };
  return { type, roleIds: [] };
}

const emojiJson = value => {
  const text = String(value || '').trim();
  if (!text) return undefined;
  const custom = /^<(a?):(\w{2,32}):(\d{15,22})>$/.exec(text);
  if (custom) return { id: custom[3], name: custom[2], animated: custom[1] === 'a' };
  return [...text].length <= 8 ? { name: text } : undefined;
};
const colorInt = value => (/^#[0-9a-f]{6}$/i.test(value || '') ? parseInt(value.slice(1), 16) : undefined);

// Client-side port of src/studio/schema.ts renderDoc, used for the preview and the JSON tab.
function toApi(doc, docId = 'preview') {
  const button = item => ({ type: 2, style: STYLES[item.style] || 2, ...(item.style === 'link' ? { url: item.url || 'https://discord.com' } : { custom_id: `es:${docId}:${item.id}` }), ...(item.label ? { label: item.label } : {}), ...(emojiJson(item.emoji) ? { emoji: emojiJson(item.emoji) } : {}), ...(item.disabled ? { disabled: true } : {}) });
  const node = item => {
    switch (item.type) {
      case 'container': return { type: 17, components: item.children.map(node), ...(item.color ? { accent_color: colorInt(item.color) } : {}), ...(item.spoiler ? { spoiler: true } : {}) };
      case 'text': return { type: 10, content: item.content };
      case 'section': return { type: 9, components: item.texts.map(content => ({ type: 10, content })), accessory: item.accessory.kind === 'button' ? button(item.accessory.button) : { type: 11, media: { url: item.accessory.url }, ...(item.accessory.description ? { description: item.accessory.description } : {}), ...(item.accessory.spoiler ? { spoiler: true } : {}) } };
      case 'media': return { type: 12, items: item.items.map(entry => ({ media: { url: entry.url }, ...(entry.description ? { description: entry.description } : {}), ...(entry.spoiler ? { spoiler: true } : {}) })) };
      case 'file': return { type: 13, file: { url: item.url?.startsWith('attachment://') ? item.url : `attachment://${item.name || (item.url || 'file').split('/').pop()?.split('?')[0] || 'file'}` }, ...(item.spoiler ? { spoiler: true } : {}) };
      case 'separator': return { type: 14, divider: item.divider, spacing: item.spacing === 'large' ? 2 : 1 };
      case 'buttons': return { type: 1, components: item.buttons.map(button) };
      case 'select': return { type: 1, components: [{ type: 3, custom_id: `es:${docId}:${item.select.id}`, placeholder: item.select.placeholder || undefined, min_values: item.select.min, max_values: item.select.max, ...(item.select.disabled ? { disabled: true } : {}), options: item.select.options.map(option => ({ label: option.label, value: option.id, ...(option.description ? { description: option.description } : {}), ...(emojiJson(option.emoji) ? { emoji: emojiJson(option.emoji) } : {}) })) }] };
    }
    return null;
  };
  if (doc.mode === 'v2') return { flags: 32768, components: doc.components.map(node).filter(Boolean) };
  return {
    ...(doc.content ? { content: doc.content } : {}),
    embeds: doc.embeds.map(embed => ({
      ...(embed.title ? { title: embed.title } : {}), ...(embed.url ? { url: embed.url } : {}), ...(embed.description ? { description: embed.description } : {}), ...(colorInt(embed.color) !== undefined ? { color: colorInt(embed.color) } : {}),
      ...(embed.timestamp ? { timestamp: new Date().toISOString() } : {}), ...(embed.author.name ? { author: { name: embed.author.name, ...(embed.author.url ? { url: embed.author.url } : {}), ...(embed.author.icon ? { icon_url: embed.author.icon } : {}) } } : {}),
      ...(embed.footer.text ? { footer: { text: embed.footer.text, ...(embed.footer.icon ? { icon_url: embed.footer.icon } : {}) } } : {}),
      ...(embed.thumbnail ? { thumbnail: { url: embed.thumbnail } } : {}), ...(embed.image ? { image: { url: embed.image } } : {}), ...(embed.fields.length ? { fields: embed.fields } : {}),
    })),
    components: doc.components.map(node).filter(Boolean),
  };
}

function countComponents(nodes) {
  let total = 0;
  for (const item of nodes) {
    total += 1;
    if (item.type === 'container') total += countComponents(item.children);
    if (item.type === 'section') total += item.texts.length + 1;
    if (item.type === 'buttons') total += item.buttons.length;
    if (item.type === 'select') total += 1;
  }
  return total;
}
function textLength(nodes) {
  return nodes.reduce((sum, item) => sum + (item.type === 'text' ? item.content.length : item.type === 'section' ? item.texts.join('').length : item.type === 'container' ? textLength(item.children) : 0), 0);
}
// Every node with the list that holds it, depth first.
function walk(nodes, visit, parent = null) { nodes.forEach((item, index) => { visit(item, nodes, index, parent); if (item.type === 'container') walk(item.children, visit, item); }); }
function locate(doc, id) { let hit = null; walk(doc.components, (item, list, index, parent) => { if (item.id === id) hit = { item, list, index, parent }; }); return hit; }
// Finds the button or select option with this id, wherever it lives.
function findOwner(doc, id) {
  let hit = null;
  walk(doc.components, item => {
    if (item.type === 'buttons') item.buttons.forEach(button => { if (button.id === id) hit = { kind: 'button', owner: button, node: item }; });
    if (item.type === 'section' && item.accessory.kind === 'button' && item.accessory.button.id === id) hit = { kind: 'button', owner: item.accessory.button, node: item };
    if (item.type === 'select') item.select.options.forEach(option => { if (option.id === id) hit = { kind: 'option', owner: option, node: item }; });
  });
  return hit;
}

// ---- State -------------------------------------------------------------------------------------

let state = null;
let keysBound = false;

const isAdmin = () => Boolean(window.me?.user?.isOwner || window.me?.user?.isAdministrator);

export function render() { if (!isAdmin()) return '<div class="st"><div class="empty"><div><b>Administrators only</b><span>Only the server owner and administrators can build and send bot messages.</span></div></div></div>'; return '<div class="st" id="st"><div class="page-loading"><span class="skeleton"></span><span class="skeleton"></span></div></div>'; }

export async function bind() {
  if (!isAdmin()) return;
  window.removeEventListener('beforeunload', guard);
  window.addEventListener('beforeunload', guard);
  state = { el: document.getElementById('st'), list: [], templates: [], options: { roles: [], channels: [], emojis: [] }, ed: null };
  const [library, options] = await Promise.all([api('/api/studio'), api('/api/studio/options').catch(() => ({ roles: [], channels: [], emojis: [] }))]).catch(error => {
    const setup = /not set up|033_embed_studio/i.test(error.message);
    state.el.innerHTML = setup
      ? `<div class="section-head"><div><h1>Embed studio</h1><p>Build Discord messages with buttons, menus and forms.</p></div></div><section class="panel st-setup"><div class="st-empty-icon">${ic('warning-2', { size: 28 })}</div><h3>One database step is missing</h3><p>Open the Supabase SQL editor, run <code>supabase/migrations/033_embed_studio.sql</code>, then reload this page.</p></section>`
      : `<div class="error-state">${ic('danger', { size: 28 })}<h3>Could not open the studio</h3><p>${esc(error.message)}</p></div>`;
    return [null, null];
  });
  if (!library) return;
  state.list = library.messages; state.templates = library.templates; state.options = options;
  setCustomEmojis(options.emojis || []);
  const id = new URLSearchParams(location.search).get('id');
  if (id && state.list.some(item => item.id === id)) openEditor(state.list.find(item => item.id === id)); else showLibrary();
  if (!keysBound) {
    keysBound = true;
    document.addEventListener('keydown', event => {
      if (!state?.ed || !document.getElementById('st')) return;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === 's') { event.preventDefault(); save(); }
      if ((event.ctrlKey || event.metaKey) && key === 'z' && !event.target.closest('input, textarea')) { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      if ((event.ctrlKey || event.metaKey) && key === 'y' && !event.target.closest('input, textarea')) { event.preventDefault(); redo(); }
    });
  }
}
function guard(event) { if (state?.ed?.dirty && document.getElementById('st')) { event.preventDefault(); event.returnValue = ''; } }
const setQuery = id => history.replaceState(history.state, '', `${location.pathname}${id ? `?id=${id}` : ''}`);

function dialog(title, body, { wide = false } = {}) {
  const root = document.createElement('div');
  root.className = 'modal-backdrop st-dialog-backdrop';
  root.innerHTML = `<section class="modal-card st-dialog ${wide ? 'wide' : ''}" role="dialog" aria-modal="true"><button class="st-icon-btn st-dialog-close" type="button" data-close aria-label="Close">${ic('close-circle', { size: 20 })}</button><h2>${esc(title)}</h2><div class="st-dialog-body">${body}</div></section>`;
  document.body.appendChild(root);
  const close = () => { root.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  root.addEventListener('click', event => { if (event.target === root || event.target.closest('[data-close]')) close(); });
  return { root, close };
}

const previewCtx = extra => ({ roles: state.options.roles, channels: state.options.channels, botName: 'Rift', ...extra });

// ---- Library -----------------------------------------------------------------------------------

function showLibrary() {
  state.ed = null; setQuery('');
  const cards = state.list.map(item => `<article class="st-card">
      <button type="button" class="st-card-preview" data-edit="${item.id}" aria-label="Edit ${esc(item.name)}"><div class="st-mini">${renderMessage(toApi(item.data, item.id), previewCtx())}</div></button>
      <div class="st-card-body"><div><b>${esc(item.name)}</b><small>${item.data.mode === 'v2' ? 'Components V2' : 'Classic embed'} · ${item.stats.components} component${item.stats.components === 1 ? '' : 's'} · ${item.sent.length ? `sent ${item.sent.length}×` : 'not sent'}</small></div>
      <div class="st-card-actions"><button type="button" class="st-icon-btn" data-duplicate="${item.id}" title="Duplicate">${ic('copy', { size: 16 })}</button><button type="button" class="st-icon-btn danger" data-delete="${item.id}" title="Delete">${ic('trash', { size: 16 })}</button><button type="button" class="secondary" data-edit="${item.id}">${ic('edit-2', { size: 15 })} Edit</button></div></div>
    </article>`).join('');
  state.el.innerHTML = `<div class="section-head st-head"><div><h1>Embed Studio</h1><p>Design messages with Components V2 or classic embeds, add buttons and menus that run steps, and send them to any channel.</p></div><div class="st-head-actions"><button type="button" class="secondary" data-import>${ic('document-text', { size: 16 })} Import</button><button type="button" class="primary" data-new>${ic('add', { size: 16 })} New message</button></div></div>
    ${state.list.length ? `<section class="st-grid">${cards}</section>` : `<section class="panel st-empty-card"><div class="st-empty-icon">${ic('message-text', { size: 30 })}</div><h3>No saved messages yet</h3><p>Start from a template or a blank canvas. Everything you build is saved here and can be sent again or updated later.</p><button type="button" class="primary" data-new>${ic('add', { size: 16 })} New message</button></section>`}`;
  const el = state.el;
  el.querySelectorAll('[data-new]').forEach(button => button.addEventListener('click', chooseTemplate));
  el.querySelector('[data-import]')?.addEventListener('click', () => importDialog(async data => { const { message } = await api('/api/studio', { method: 'POST', body: JSON.stringify({ name: 'Imported message', data }) }); state.list.unshift(message); openEditor(message); }));
  el.querySelectorAll('[data-edit]').forEach(button => button.addEventListener('click', () => openEditor(state.list.find(item => item.id === button.dataset.edit))));
  el.querySelectorAll('[data-duplicate]').forEach(button => button.addEventListener('click', async () => { try { const { message } = await api(`/api/studio/${button.dataset.duplicate}/duplicate`, { method: 'POST' }); state.list.unshift(message); showLibrary(); toast('Duplicated'); } catch (error) { toast(error.message); } }));
  el.querySelectorAll('[data-delete]').forEach(button => button.addEventListener('click', async () => {
    const item = state.list.find(entry => entry.id === button.dataset.delete);
    if (!await confirmAction({ title: `Delete “${item.name}”?`, message: 'Messages already sent stay in Discord, but their buttons and menus stop working.', confirmText: 'Delete message' })) return;
    try { await api(`/api/studio/${item.id}`, { method: 'DELETE' }); state.list = state.list.filter(entry => entry.id !== item.id); showLibrary(); } catch (error) { toast(error.message); }
  }));
}

function chooseTemplate() {
  const icons = { blank: 'add', announcement: 'notification', rules: 'shield-tick', roles: 'people', form: 'clipboard-text', embed: 'document-text' };
  const { root, close } = dialog('New message', `<div class="st-template-grid">${state.templates.map(item => `<button type="button" class="st-template" data-template="${item.key}">${ic(icons[item.key] || 'category', { size: 22 })}<b>${esc(item.name)}</b><span>${item.mode === 'v2' ? 'Components V2' : 'Classic embed'}</span></button>`).join('')}</div>`, { wide: true });
  root.querySelectorAll('[data-template]').forEach(button => button.addEventListener('click', async () => {
    close();
    try { const { message } = await api('/api/studio', { method: 'POST', body: JSON.stringify({ template: button.dataset.template }) }); state.list.unshift(message); openEditor(message); } catch (error) { toast(error.message); }
  }));
}

function importDialog(onData) {
  const { root, close } = dialog('Import a message', `<p class="st-muted">Paste a Discord message link from this server, or JSON from Discord, a webhook or discohook.</p>
    <label class="st-field"><span>Message link</span><input data-link placeholder="https://discord.com/channels/…/…/…" dir="ltr"></label>
    <label class="st-field"><span>or JSON</span><textarea class="st-bulk st-json-input" rows="9" data-json placeholder='{ "content": "…", "embeds": [ … ], "components": [ … ] }' dir="ltr"></textarea></label>
    <div class="st-dialog-actions"><button type="button" class="secondary" data-close>Cancel</button><button type="button" class="primary" data-ok>Import</button></div>`);
  root.querySelector('[data-ok]').addEventListener('click', async () => {
    const link = root.querySelector('[data-link]').value.trim();
    let json = null;
    if (!link) { try { json = JSON.parse(root.querySelector('[data-json]').value); } catch { return toast('That JSON is not valid.'); } }
    try { const { data } = await api('/api/studio/import', { method: 'POST', body: JSON.stringify(link ? { link } : { json }) }); close(); await onData(data); toast('Imported · buttons keep their look; add steps to make them work'); } catch (error) { toast(error.message); }
  });
}

// ---- Editor ------------------------------------------------------------------------------------

function openEditor(message) {
  state.ed = { id: message.id, name: message.name, doc: clone(message.data), sent: message.sent || [], dirty: false, past: [], future: [], selected: '', tab: 'preview', openSelect: '', lastSnap: 0 };
  setQuery(message.id);
  renderEditor();
}

function snapshot(force = false) {
  const ed = state.ed;
  const now = Date.now();
  // Typing within 600 ms coalesces into one step; a structural change always ends the current typing step.
  if (force || now - ed.lastSnap > 600) { ed.past.push(JSON.stringify({ doc: ed.doc, name: ed.name })); if (ed.past.length > 60) ed.past.shift(); ed.future = []; }
  ed.lastSnap = force ? 0 : now;
}
function change({ structural = false } = {}) {
  state.ed.dirty = true;
  const saveState = state.el.querySelector('.st-save-state');
  if (saveState) { saveState.textContent = 'Unsaved changes'; saveState.classList.add('dirty'); }
  if (structural) renderEditor(); else { renderPreview(); renderLimits(); }
}
function undo() { const ed = state.ed; if (!ed?.past.length) return; ed.future.push(JSON.stringify({ doc: ed.doc, name: ed.name })); const prev = JSON.parse(ed.past.pop()); ed.doc = prev.doc; ed.name = prev.name; ed.dirty = true; renderEditor(); }
function redo() { const ed = state.ed; if (!ed?.future.length) return; ed.past.push(JSON.stringify({ doc: ed.doc, name: ed.name })); const next = JSON.parse(ed.future.pop()); ed.doc = next.doc; ed.name = next.name; ed.dirty = true; renderEditor(); }

async function save() {
  const ed = state.ed; if (!ed) return false;
  const button = state.el.querySelector('[data-save]');
  if (button) button.disabled = true;
  try {
    const { message } = await api(`/api/studio/${ed.id}`, { method: 'PUT', body: JSON.stringify({ name: ed.name, data: ed.doc }) });
    ed.doc = clone(message.data); ed.dirty = false; ed.sent = message.sent;
    const index = state.list.findIndex(item => item.id === ed.id); if (index >= 0) state.list[index] = message;
    toast('Saved'); renderEditor(); return true;
  } catch (error) { toast(error.message); return false; }
  finally { if (button) button.disabled = false; }
}

function renderEditor() {
  const ed = state.ed; const doc = ed.doc;
  const palette = doc.mode === 'v2' ? PALETTE_V2 : PALETTE_EMBED;
  state.el.innerHTML = `<div class="st-editor">
    <div class="st-bar">
      <button type="button" class="st-icon-btn" data-back title="Back to library">${ic('arrow-right-01', { size: 18, cls: 'st-back-icon' })}</button>
      <input class="st-name" data-name value="${esc(ed.name)}" maxlength="80" aria-label="Message name">
      <small class="st-save-state st-save-state ${ed.dirty ? 'dirty' : ''}">${ed.dirty ? 'Unsaved changes' : 'Saved'}</small>
      <span class="st-spacer"></span>
      <button type="button" class="st-icon-btn" data-undo title="Undo (Ctrl+Z)" ${ed.past.length ? '' : 'disabled'}>${ic('refresh-arrow-01', { size: 16, cls: 'st-undo' })}</button>
      <button type="button" class="st-icon-btn" data-redo title="Redo (Ctrl+Y)" ${ed.future.length ? '' : 'disabled'}>${ic('refresh-arrow-01', { size: 16 })}</button>
      <div class="st-seg st-mode"><button type="button" data-mode="v2" aria-pressed="${doc.mode === 'v2'}">Components V2</button><button type="button" data-mode="embed" aria-pressed="${doc.mode === 'embed'}">Classic embed</button></div>
      <button type="button" class="secondary" data-import>${ic('document-text', { size: 15 })} Import</button>
      ${ed.sent.length ? `<button type="button" class="secondary" data-update-sent title="Edit the ${ed.sent.length} copy/copies already in Discord">${ic('refresh-circle', { size: 15 })} Update sent (${ed.sent.length})</button>` : ''}
      <button type="button" class="secondary" data-save>${ic('save-2', { size: 15 })} Save</button>
      <button type="button" class="primary" data-send>${ic('send-2', { size: 15 })} Save & send</button>
    </div>
    <div class="st-layout">
      <aside class="st-palette"><div class="st-palette-head"><b>Components</b><span data-limits></span></div>
        ${palette.map(([key, label, icon, text]) => `<button type="button" class="st-pal" data-add="${key}" title="${esc(text)}">${ic(icon, { size: 16 })}<span><b>${label}</b><small>${esc(text)}</small></span></button>`).join('')}
        <div class="st-vars"><b>Variables</b><code>{user}</code><code>{user.name}</code><code>{server}</code><code>{members}</code><code>{channel}</code><code>{date}</code><small>In steps also <code>{option}</code> and <code>{form.&lt;field&gt;}</code></small></div>
      </aside>
      <main class="st-tree" data-tree>${treeHtml()}</main>
      <aside class="st-preview"><div class="st-preview-tabs"><button type="button" data-tab="preview" aria-selected="${ed.tab === 'preview'}">${ic('eye', { size: 14 })} Preview</button><button type="button" data-tab="json" aria-selected="${ed.tab === 'json'}">{ } JSON</button></div><div class="st-preview-body" data-preview></div></aside>
    </div>
  </div>`;
  bindEditor();
  renderPreview(); renderLimits();
}

function renderLimits() {
  const doc = state.ed.doc; const el = state.el.querySelector('[data-limits]'); if (!el) return;
  if (doc.mode === 'v2') { const count = countComponents(doc.components); const chars = textLength(doc.components); el.innerHTML = `<span class="${count > 40 ? 'over' : ''}">${count}/40</span> · <span class="${chars > 4000 ? 'over' : ''}">${chars}/4000</span>`; }
  else el.innerHTML = `<span>${doc.embeds.length}/10 embeds</span>`;
}

function renderPreview() {
  const ed = state.ed; const el = state.el.querySelector('[data-preview]'); if (!el) return;
  const payload = toApi(ed.doc, ed.id);
  if (ed.tab === 'json') { el.innerHTML = `<div class="st-json"><button type="button" class="secondary st-copy" data-copy-json>${ic('copy', { size: 14 })} Copy</button><pre>${esc(JSON.stringify(payload, null, 2))}</pre></div>`; el.querySelector('[data-copy-json]').addEventListener('click', () => navigator.clipboard.writeText(JSON.stringify(payload, null, 2)).then(() => toast('JSON copied'))); return; }
  el.innerHTML = renderMessage(payload, previewCtx({ interactive: true, openSelect: ed.openSelect }));
}

// Tree ---------------------------------------------------------------------------------------------

const summary = item => {
  if (item.type === 'text') return item.content.split('\n')[0].slice(0, 70) || 'Empty text';
  if (item.type === 'container') return `${item.children.length} inside${item.color ? ` · ${item.color}` : ''}`;
  if (item.type === 'section') return item.texts[0]?.split('\n')[0].slice(0, 60) || 'Section';
  if (item.type === 'media') return `${item.items.length} item${item.items.length === 1 ? '' : 's'}`;
  if (item.type === 'file') return item.name || item.url || 'No file yet';
  if (item.type === 'separator') return `${item.divider ? 'Divider' : 'Space'} · ${item.spacing}`;
  if (item.type === 'buttons') return item.buttons.map(button => button.label || button.emoji).join(' · ');
  if (item.type === 'select') return `${item.select.options.length} option${item.select.options.length === 1 ? '' : 's'}`;
  return '';
};

function nodeCard(item, list, index, depth) {
  const open = state.ed.selected === item.id;
  const meta = LABELS[item.type];
  const children = item.type === 'container' ? `<div class="st-children">${item.children.map((child, childIndex) => nodeCard(child, item.children, childIndex, depth + 1)).join('') || '<div class="st-drop-hint">Empty container — pick components on the left while it is selected.</div>'}</div>` : '';
  return `<article class="st-node ${open ? 'open' : ''} t-${item.type}" data-node="${item.id}" style="${item.type === 'container' && item.color ? `--node-accent:${esc(safeColor(item.color))}` : ''}">
    <header class="st-node-head" data-select-node="${item.id}"><span class="st-node-icon">${ic(meta.icon, { size: 15 })}</span><b>${meta.label}</b><span class="st-node-sum" dir="auto">${esc(summary(item))}</span>
      <span class="st-node-tools"><button type="button" class="st-icon-btn" data-move="-1" title="Move up" ${index === 0 ? 'disabled' : ''}>${ic('arrow-up-04', { size: 14 })}</button><button type="button" class="st-icon-btn" data-move="1" title="Move down" ${index === list.length - 1 ? 'disabled' : ''}>${ic('arrow-down-01', { size: 14 })}</button><button type="button" class="st-icon-btn" data-dup title="Duplicate">${ic('copy', { size: 14 })}</button><button type="button" class="st-icon-btn danger" data-remove title="Delete">${ic('trash', { size: 14 })}</button></span></header>
    ${open ? `<div class="st-node-body">${nodeEditor(item)}</div>` : ''}
    ${children}
  </article>`;
}

function treeHtml() {
  const doc = state.ed.doc;
  if (doc.mode === 'embed') {
    return `<section class="st-node open st-content"><header class="st-node-head"><span class="st-node-icon">${ic('message-text', { size: 15 })}</span><b>Message content</b><span class="st-node-sum">Text above the embeds</span></header><div class="st-node-body">${mdField('content', doc.content, 2000, 'data-content')}</div></section>
      ${doc.embeds.map((embed, index) => embedCard(embed, index)).join('')}
      ${doc.components.map((item, index) => nodeCard(item, doc.components, index, 0)).join('')}
      ${doc.embeds.length || doc.components.length ? '' : '<div class="st-drop-hint">Add an embed from the left.</div>'}`;
  }
  return doc.components.map((item, index) => nodeCard(item, doc.components, index, 0)).join('') || '<div class="st-drop-hint big">Add a Container from the left to start building.</div>';
}

const toolbar = `<div class="st-md-tools">${[['**', 'B', 'Bold'], ['*', 'I', 'Italic'], ['__', 'U', 'Underline'], ['~~', 'S', 'Strikethrough'], ['`', '</>', 'Code'], ['||', '▒', 'Spoiler']].map(([wrap, label, title]) => `<button type="button" data-wrap="${esc(wrap)}" title="${title}">${esc(label)}</button>`).join('')}${[['# ', 'H1'], ['## ', 'H2'], ['### ', 'H3'], ['> ', '❝'], ['- ', '•'], ['-# ', 'sub']].map(([prefix, label]) => `<button type="button" data-prefix="${esc(prefix)}" title="Line: ${esc(prefix.trim())}">${esc(label)}</button>`).join('')}</div>`;
const mdField = (key, value, max, attr = '') => `<div class="st-md">${toolbar}<textarea dir="auto" rows="${Math.min(12, Math.max(3, String(value).split('\n').length + 1))}" maxlength="${max}" data-f="${key}" ${attr}>${esc(value)}</textarea><small class="st-count">${String(value).length}/${max}</small></div>`;
const field = (label, key, value, { type = 'text', placeholder = '', max = 500, small = false } = {}) => `<label class="st-field ${small ? 'small' : ''}"><span>${label}</span><input type="${type}" data-f="${key}" value="${esc(value ?? '')}" maxlength="${max}" placeholder="${esc(placeholder)}" ${type === 'url' ? 'dir="ltr"' : 'dir="auto"'}></label>`;
const check = (label, key, value) => `<label class="st-check"><input type="checkbox" data-f="${key}" ${value ? 'checked' : ''}><span>${label}</span></label>`;
const styleSelect = (key, value) => `<select data-f="${key}" class="st-style-select">${['primary', 'secondary', 'success', 'danger', 'link'].map(style => `<option value="${style}" ${value === style ? 'selected' : ''}>${style[0].toUpperCase()}${style.slice(1)}</option>`).join('')}</select>`;

function buttonEditor(button, path) {
  return `<div class="st-button-row" data-path="${path}">
    <span class="st-swatch s-${button.style}"></span>
    <input dir="auto" data-f="${path}.label" value="${esc(button.label)}" maxlength="80" placeholder="Label">
    <input class="st-emoji" data-f="${path}.emoji" value="${esc(button.emoji)}" maxlength="64" placeholder="Emoji or <:name:id>">
    ${styleSelect(`${path}.style`, button.style)}
    ${button.style === 'link' ? `<input class="st-url" dir="ltr" type="url" data-f="${path}.url" value="${esc(button.url)}" placeholder="https://…">` : `<button type="button" class="secondary st-steps-btn" data-steps="${button.id}">${ic('flash', { size: 14 })} Steps · ${button.actions.length}</button>`}
    <label class="st-check st-mini-check" title="Disabled"><input type="checkbox" data-f="${path}.disabled" ${button.disabled ? 'checked' : ''}><span>Off</span></label>
  </div>`;
}

function nodeEditor(item) {
  switch (item.type) {
    case 'container': return `<div class="st-inline"><label class="st-field small"><span>Accent colour</span><span class="st-color"><input type="color" data-f="color" value="${esc(item.color || '#8175f5')}" ${item.color ? '' : 'disabled'}><label class="st-check"><input type="checkbox" data-color-off ${item.color ? '' : 'checked'}><span>None</span></label></span></label></div>${check('Spoiler (blur until clicked)', 'spoiler', item.spoiler)}`;
    case 'text': return mdField('content', item.content, 4000);
    case 'section': return `${item.texts.map((value, index) => `<div class="st-sub"><div class="st-sub-head"><b>Text ${index + 1}</b>${item.texts.length > 1 ? `<button type="button" class="st-link-btn danger" data-text-remove="${index}">Remove</button>` : ''}</div>${mdField(`texts.${index}`, value, 4000)}</div>`).join('')}
      ${item.texts.length < 3 ? `<button type="button" class="st-link-btn" data-text-add>${ic('add', { size: 14 })} Add text block</button>` : ''}
      <div class="st-sub"><div class="st-sub-head"><b>Side accessory</b><div class="st-seg"><button type="button" data-accessory="thumbnail" aria-pressed="${item.accessory.kind === 'thumbnail'}">Thumbnail</button><button type="button" data-accessory="button" aria-pressed="${item.accessory.kind === 'button'}">Button</button></div></div>
      ${item.accessory.kind === 'thumbnail' ? `<div class="st-inline">${field('Image URL', 'accessory.url', item.accessory.url, { type: 'url', placeholder: 'https://…', max: 1000 })}${field('Alt text', 'accessory.description', item.accessory.description, { max: 1024 })}</div>${check('Spoiler', 'accessory.spoiler', item.accessory.spoiler)}` : buttonEditor(item.accessory.button, 'accessory.button')}</div>`;
    case 'media': return `${item.items.map((entry, index) => `<div class="st-media-row"><span class="st-thumb" style="${entry.url ? `background-image:url('${esc(cssUrl(entry.url))}')` : ''}"></span><input dir="ltr" type="url" data-f="items.${index}.url" value="${esc(entry.url)}" placeholder="https://… image, gif or video"><input dir="auto" data-f="items.${index}.description" value="${esc(entry.description)}" placeholder="Alt text" maxlength="1024"><label class="st-check st-mini-check"><input type="checkbox" data-f="items.${index}.spoiler" ${entry.spoiler ? 'checked' : ''}><span>Spoiler</span></label><button type="button" class="st-icon-btn danger" data-item-remove="${index}" ${item.items.length <= 1 ? 'disabled' : ''}>${ic('close-circle', { size: 15 })}</button></div>`).join('')}${item.items.length < 10 ? `<button type="button" class="st-link-btn" data-item-add>${ic('add', { size: 14 })} Add media</button>` : ''}`;
    case 'file': return `<div class="st-inline">${field('File URL', 'url', item.url, { type: 'url', placeholder: 'https://…/rules.pdf', max: 1000 })}${field('File name', 'name', item.name, { placeholder: 'rules.pdf', max: 100 })}</div><p class="st-muted">${ic('info-circle', { size: 13 })} The file is downloaded and attached when the message is sent (up to 10 MB).</p>${check('Spoiler', 'spoiler', item.spoiler)}`;
    case 'separator': return `<div class="st-inline">${check('Show divider line', 'divider', item.divider)}<div class="st-seg"><button type="button" data-spacing="small" aria-pressed="${item.spacing === 'small'}">Small gap</button><button type="button" data-spacing="large" aria-pressed="${item.spacing === 'large'}">Large gap</button></div></div>`;
    case 'buttons': return `${item.buttons.map((button, index) => `<div class="st-list-item">${buttonEditor(button, `buttons.${index}`)}<span class="st-list-tools"><button type="button" class="st-icon-btn" data-button-move="${index}:-1" ${index === 0 ? 'disabled' : ''}>${ic('arrow-up-04', { size: 13 })}</button><button type="button" class="st-icon-btn danger" data-button-remove="${index}" ${item.buttons.length <= 1 ? 'disabled' : ''}>${ic('close-circle', { size: 14 })}</button></span></div>`).join('')}${item.buttons.length < 5 ? `<div class="st-add-row"><button type="button" class="st-link-btn" data-button-add="primary">${ic('add', { size: 14 })} Add button</button><button type="button" class="st-link-btn" data-button-add="link">${ic('link', { size: 14 })} Add link button</button></div>` : ''}`;
    case 'select': return `<div class="st-inline">${field('Placeholder', 'select.placeholder', item.select.placeholder, { max: 150 })}<label class="st-field small"><span>Min picks</span><input type="number" min="0" max="${item.select.options.length}" data-f="select.min" value="${item.select.min}"></label><label class="st-field small"><span>Max picks</span><input type="number" min="1" max="${item.select.options.length}" data-f="select.max" value="${item.select.max}"></label></div>${check('Disabled', 'select.disabled', item.select.disabled)}
      ${item.select.options.map((option, index) => `<div class="st-option-row"><input class="st-emoji" data-f="select.options.${index}.emoji" value="${esc(option.emoji)}" placeholder="Emoji"><input dir="auto" data-f="select.options.${index}.label" value="${esc(option.label)}" maxlength="100" placeholder="Label"><input dir="auto" data-f="select.options.${index}.description" value="${esc(option.description)}" maxlength="100" placeholder="Description (optional)"><button type="button" class="secondary st-steps-btn" data-steps="${option.id}">${ic('flash', { size: 14 })} Steps · ${option.actions.length}</button><button type="button" class="st-icon-btn danger" data-option-remove="${index}" ${item.select.options.length <= 1 ? 'disabled' : ''}>${ic('close-circle', { size: 14 })}</button></div>`).join('')}
      ${item.select.options.length < 25 ? `<button type="button" class="st-link-btn" data-option-add>${ic('add', { size: 14 })} Add option</button>` : ''}`;
  }
  return '';
}

function embedCard(embed, index) {
  const open = state.ed.selected === `embed-${index}`;
  return `<article class="st-node ${open ? 'open' : ''} t-embed" data-embed="${index}" style="--node-accent:${esc(safeColor(embed.color) || '#1e1f22')}">
    <header class="st-node-head" data-select-node="embed-${index}"><span class="st-node-icon">${ic('clipboard-text', { size: 15 })}</span><b>Embed ${index + 1}</b><span class="st-node-sum" dir="auto">${esc(embed.title || embed.description.slice(0, 60) || 'Empty embed')}</span>
      <span class="st-node-tools"><button type="button" class="st-icon-btn" data-embed-move="${index}:-1" ${index === 0 ? 'disabled' : ''}>${ic('arrow-up-04', { size: 14 })}</button><button type="button" class="st-icon-btn" data-embed-dup="${index}">${ic('copy', { size: 14 })}</button><button type="button" class="st-icon-btn danger" data-embed-remove="${index}">${ic('trash', { size: 14 })}</button></span></header>
    ${open ? `<div class="st-node-body">
      <div class="st-inline">${field('Author', 'author.name', embed.author.name, { max: 256 })}${field('Author icon URL', 'author.icon', embed.author.icon, { type: 'url' })}${field('Author link', 'author.url', embed.author.url, { type: 'url' })}</div>
      <div class="st-inline">${field('Title', 'title', embed.title, { max: 256 })}${field('Title link', 'url', embed.url, { type: 'url' })}<label class="st-field small"><span>Colour</span><input type="color" data-f="color" value="${esc(embed.color || '#8175f5')}"></label></div>
      ${mdField('description', embed.description, 4096)}
      <div class="st-sub"><div class="st-sub-head"><b>Fields</b><small>${embed.fields.length}/25</small></div>${embed.fields.map((item, fieldIndex) => `<div class="st-field-row"><input dir="auto" data-f="fields.${fieldIndex}.name" value="${esc(item.name)}" maxlength="256" placeholder="Name"><textarea dir="auto" rows="1" data-f="fields.${fieldIndex}.value" maxlength="1024" placeholder="Value">${esc(item.value)}</textarea><label class="st-check st-mini-check"><input type="checkbox" data-f="fields.${fieldIndex}.inline" ${item.inline ? 'checked' : ''}><span>Inline</span></label><button type="button" class="st-icon-btn danger" data-field-remove="${fieldIndex}">${ic('close-circle', { size: 14 })}</button></div>`).join('')}${embed.fields.length < 25 ? `<button type="button" class="st-link-btn" data-field-add>${ic('add', { size: 14 })} Add field</button>` : ''}</div>
      <div class="st-inline">${field('Thumbnail URL', 'thumbnail', embed.thumbnail, { type: 'url' })}${field('Image URL', 'image', embed.image, { type: 'url' })}</div>
      <div class="st-inline">${field('Footer', 'footer.text', embed.footer.text, { max: 2048 })}${field('Footer icon URL', 'footer.icon', embed.footer.icon, { type: 'url' })}</div>
      ${check('Show timestamp', 'timestamp', embed.timestamp)}
    </div>` : ''}
  </article>`;
}

// Resolves "a.b.0.c" on an object for reading and writing.
function setPath(target, path, value) { const keys = path.split('.'); const last = keys.pop(); const holder = keys.reduce((obj, key) => obj[key], target); holder[last] = value; }
function getPath(target, path) { return path.split('.').reduce((obj, key) => obj?.[key], target); }

function bindEditor() {
  const el = state.el; const ed = state.ed;
  el.querySelector('[data-back]').addEventListener('click', async () => { if (ed.dirty && !await confirmAction({ title: 'Discard unsaved changes?', message: 'Your edits have not been saved.', confirmText: 'Discard' })) return; showLibrary(); });
  el.querySelector('[data-name]').addEventListener('input', event => { snapshot(); ed.name = event.target.value; change(); });
  el.querySelector('[data-undo]').addEventListener('click', undo);
  el.querySelector('[data-redo]').addEventListener('click', redo);
  el.querySelector('[data-save]').addEventListener('click', save);
  el.querySelector('[data-send]').addEventListener('click', sendDialog);
  el.querySelector('[data-update-sent]')?.addEventListener('click', updateSent);
  el.querySelector('[data-import]').addEventListener('click', () => importDialog(async data => { snapshot(true); ed.doc = data; ed.selected = ''; change({ structural: true }); }));
  el.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', async () => {
    const mode = button.dataset.mode; if (mode === ed.doc.mode) return;
    if (!await confirmAction({ title: `Switch to ${mode === 'v2' ? 'Components V2' : 'classic embed'}?`, message: mode === 'v2' ? 'Embeds are converted into containers. Buttons and menus are kept.' : 'Containers are flattened into one embed. Galleries, files and sections become plain text or images.', confirmText: 'Switch', danger: false })) return;
    snapshot(true); ed.doc = convertMode(ed.doc, mode); ed.selected = ''; change({ structural: true });
  }));
  el.querySelectorAll('.st-preview-tabs [data-tab]').forEach(button => button.addEventListener('click', () => { ed.tab = button.dataset.tab; el.querySelectorAll('.st-preview-tabs [data-tab]').forEach(item => item.setAttribute('aria-selected', String(item === button))); renderPreview(); }));
  el.querySelectorAll('[data-add]').forEach(button => button.addEventListener('click', () => addComponent(button.dataset.add)));

  // Preview is clickable: buttons open their steps, menus open their option list.
  el.querySelector('[data-preview]').addEventListener('click', event => {
    const buttonId = event.target.closest('[data-preview-button]')?.dataset.previewButton?.split(':')[2];
    if (buttonId) { const owner = findOwner(ed.doc, buttonId); if (owner) { ed.selected = owner.node.id; renderEditor(); stepsDialog(buttonId); } return; }
    const selectId = event.target.closest('[data-preview-select]')?.dataset.previewSelect;
    if (selectId) { ed.openSelect = ed.openSelect === selectId ? '' : selectId; renderPreview(); }
  });

  const tree = el.querySelector('[data-tree]');
  const target = element => {
    const embed = element.closest('[data-embed]');
    if (embed) return { kind: 'embed', index: Number(embed.dataset.embed), obj: ed.doc.embeds[Number(embed.dataset.embed)] };
    const card = element.closest('[data-node]');
    if (card) { const hit = locate(ed.doc, card.dataset.node); return hit ? { kind: 'node', ...hit, obj: hit.item } : null; }
    if (element.closest('.st-content')) return { kind: 'content', obj: ed.doc };
    return null;
  };

  tree.addEventListener('input', event => {
    const input = event.target; const key = input.dataset.f; if (!key) return;
    const hit = target(input); if (!hit) return;
    if (input.type === 'checkbox' || input.tagName === 'SELECT') return;
    snapshot();
    let value = input.value;
    if (input.type === 'number') value = Math.max(0, Math.round(Number(value) || 0));
    setPath(hit.obj, key, value);
    const counter = input.closest('.st-md')?.querySelector('.st-count'); if (counter) counter.textContent = `${input.value.length}/${input.maxLength}`;
    const sum = input.closest('.st-node')?.querySelector(':scope > .st-node-head .st-node-sum');
    if (sum && hit.kind === 'node') sum.textContent = summary(hit.obj);
    if (key.endsWith('.url') && input.closest('.st-media-row')) input.closest('.st-media-row').querySelector('.st-thumb').style.backgroundImage = `url('${input.value.replace(/'/g, '%27')}')`;
    change();
  });
  tree.addEventListener('change', event => {
    const input = event.target; const hit = target(input); if (!hit) return;
    if (input.matches('[data-color-off]')) { snapshot(true); hit.obj.color = input.checked ? '' : '#8175f5'; return change({ structural: true }); }
    const key = input.dataset.f; if (!key) return;
    if (input.type === 'checkbox') { snapshot(true); setPath(hit.obj, key, input.checked); return change(); }
    if (input.tagName === 'SELECT' && key.endsWith('.style')) {
      snapshot(true);
      const button = getPath(hit.obj, key.replace(/\.style$/, ''));
      button.style = input.value;
      if (input.value === 'link') { button.actions = []; button.url = button.url || 'https://'; } else { button.url = ''; if (!button.actions.length) button.actions = [newAction('reply')]; }
      return change({ structural: true });
    }
    if (input.type === 'number' && key.startsWith('select.')) { const select = hit.obj.select; select.min = Math.min(select.min, select.max); select.max = Math.max(1, Math.min(select.options.length, select.max)); return change({ structural: true }); }
  });
  tree.addEventListener('click', event => {
    const button = event.target.closest('button'); const hit = button ? target(button) : null;
    const head = event.target.closest('[data-select-node]');
    if (head && !event.target.closest('button')) { ed.selected = ed.selected === head.dataset.selectNode ? '' : head.dataset.selectNode; return renderEditor(); }
    if (!button) return;
    const md = button.closest('.st-md')?.querySelector('textarea');
    if (md && (button.dataset.wrap || button.dataset.prefix)) return formatText(md, button.dataset.wrap, button.dataset.prefix);
    if (!hit) return;
    const structural = () => { snapshot(true); change({ structural: true }); };
    if (button.dataset.steps) return stepsDialog(button.dataset.steps);
    if (hit.kind === 'node') {
      const { item, list, index } = hit;
      if (button.dataset.move && button.closest('.st-node-tools') && button.closest('.st-node') === event.target.closest(`[data-node="${item.id}"]`)) { const to = index + Number(button.dataset.move); if (to < 0 || to >= list.length) return; snapshot(true); list.splice(to, 0, list.splice(index, 1)[0]); return change({ structural: true }); }
      if (button.dataset.dup !== undefined && button.closest('.st-node-head')) { snapshot(true); const copy = reId(clone(item)); list.splice(index + 1, 0, copy); ed.selected = copy.id; return change({ structural: true }); }
      if (button.dataset.remove !== undefined && button.closest('.st-node-head')) { snapshot(true); list.splice(index, 1); if (ed.selected === item.id) ed.selected = ''; return change({ structural: true }); }
      if (button.dataset.textAdd !== undefined) { item.texts.push('New text'); return structural(); }
      if (button.dataset.textRemove !== undefined) { item.texts.splice(Number(button.dataset.textRemove), 1); return structural(); }
      if (button.dataset.accessory) { if (item.accessory.kind === button.dataset.accessory) return; item.accessory = button.dataset.accessory === 'button' ? { kind: 'button', button: newButton() } : { kind: 'thumbnail', url: 'https://cdn.discordapp.com/embed/avatars/0.png', description: '', spoiler: false }; return structural(); }
      if (button.dataset.itemAdd !== undefined) { item.items.push({ url: '', description: '', spoiler: false }); return structural(); }
      if (button.dataset.itemRemove !== undefined) { item.items.splice(Number(button.dataset.itemRemove), 1); return structural(); }
      if (button.dataset.spacing) { item.spacing = button.dataset.spacing; return structural(); }
      if (button.dataset.buttonAdd) { item.buttons.push(newButton(button.dataset.buttonAdd)); if (button.dataset.buttonAdd === 'link') { const last = item.buttons.at(-1); last.label = 'Open link'; last.url = 'https://'; } return structural(); }
      if (button.dataset.buttonRemove !== undefined) { item.buttons.splice(Number(button.dataset.buttonRemove), 1); return structural(); }
      if (button.dataset.buttonMove) { const [from, step] = button.dataset.buttonMove.split(':').map(Number); const to = from + step; if (to < 0) return; item.buttons.splice(to, 0, item.buttons.splice(from, 1)[0]); return structural(); }
      if (button.dataset.optionAdd !== undefined) { item.select.options.push({ id: rid(), label: `Option ${item.select.options.length + 1}`, description: '', emoji: '', actions: [newAction('reply')] }); return structural(); }
      if (button.dataset.optionRemove !== undefined) { item.select.options.splice(Number(button.dataset.optionRemove), 1); item.select.max = Math.min(item.select.max, item.select.options.length); item.select.min = Math.min(item.select.min, item.select.max); return structural(); }
    }
    if (hit.kind === 'embed') {
      const embeds = ed.doc.embeds; const index = hit.index;
      if (button.dataset.embedRemove !== undefined) { embeds.splice(index, 1); ed.selected = ''; return structural(); }
      if (button.dataset.embedDup !== undefined) { if (embeds.length >= 10) return toast('Up to 10 embeds.'); embeds.splice(index + 1, 0, clone(embeds[index])); return structural(); }
      if (button.dataset.embedMove) { const to = index - 1; if (to < 0) return; embeds.splice(to, 0, embeds.splice(index, 1)[0]); ed.selected = `embed-${to}`; return structural(); }
      if (button.dataset.fieldAdd !== undefined) { hit.obj.fields.push({ name: 'Field', value: 'Value', inline: true }); return structural(); }
      if (button.dataset.fieldRemove !== undefined) { hit.obj.fields.splice(Number(button.dataset.fieldRemove), 1); return structural(); }
    }
  });
}

function formatText(textarea, wrap, prefix) {
  const { selectionStart: start, selectionEnd: end, value } = textarea;
  if (wrap) {
    const selected = value.slice(start, end) || 'text';
    textarea.setRangeText(`${wrap}${selected}${wrap}`, start, end, 'end');
    textarea.setSelectionRange(start + wrap.length, start + wrap.length + selected.length);
  } else {
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    textarea.setRangeText(prefix, lineStart, lineStart, 'end');
  }
  textarea.focus();
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

const reId = item => { item.id = rid(); if (item.children) item.children.forEach(reId); if (item.buttons) item.buttons.forEach(button => { button.id = rid(); }); if (item.select) { item.select.id = rid(); item.select.options.forEach(option => { option.id = rid(); }); } if (item.accessory?.button) item.accessory.button.id = rid(); return item; };

function addComponent(type) {
  const ed = state.ed; const doc = ed.doc;
  snapshot(true);
  if (type === 'embed') { if (doc.embeds.length >= 10) return toast('Up to 10 embeds per message.'); doc.embeds.push(newEmbed()); ed.selected = `embed-${doc.embeds.length - 1}`; return change({ structural: true }); }
  const item = newNode(type);
  if (doc.mode === 'embed') { if (doc.components.length >= 5) return toast('Up to 5 rows of buttons or menus.'); doc.components.push(item); ed.selected = item.id; return change({ structural: true }); }
  // Insert into the selected container (or next to the selected node inside it); otherwise at the top level.
  const selected = ed.selected ? locate(doc, ed.selected) : null;
  if (type !== 'container' && selected?.item.type === 'container') selected.item.children.push(item);
  else if (type !== 'container' && selected?.parent) selected.list.splice(selected.index + 1, 0, item);
  else if (selected && !selected.parent) doc.components.splice(selected.index + 1, 0, item);
  else doc.components.push(item);
  ed.selected = item.id;
  if (countComponents(doc.components) > 40) toast('Heads up: Discord allows 40 components per message.');
  change({ structural: true });
  state.el.querySelector(`[data-node="${item.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function convertMode(doc, mode) {
  if (mode === 'v2') {
    const components = [];
    if (doc.content) components.push({ id: rid(), type: 'text', content: doc.content });
    doc.embeds.forEach(embed => {
      const children = [];
      const head = [embed.author.name ? `-# ${embed.author.name}` : '', embed.title ? `## ${embed.title}` : '', embed.description].filter(Boolean).join('\n');
      if (head && embed.thumbnail) children.push({ id: rid(), type: 'section', texts: [head], accessory: { kind: 'thumbnail', url: embed.thumbnail, description: '', spoiler: false } });
      else if (head) children.push({ id: rid(), type: 'text', content: head });
      if (embed.fields.length) children.push({ id: rid(), type: 'text', content: embed.fields.map(item => `**${item.name}**\n${item.value}`).join('\n\n') });
      if (embed.image) children.push({ id: rid(), type: 'media', items: [{ url: embed.image, description: '', spoiler: false }] });
      if (embed.footer.text) children.push({ id: rid(), type: 'separator', divider: true, spacing: 'small' }, { id: rid(), type: 'text', content: `-# ${embed.footer.text}` });
      components.push({ id: rid(), type: 'container', color: embed.color, spoiler: false, children: children.length ? children : [{ id: rid(), type: 'text', content: ' ' }] });
    });
    components.push(...doc.components);
    return { mode, content: '', embeds: [], components: components.length ? components : [newNode('container')] };
  }
  const embeds = []; const rows = []; let content = '';
  const flatten = (nodes, embed) => nodes.forEach(item => {
    if (item.type === 'text') embed.description += `${embed.description ? '\n' : ''}${item.content}`;
    if (item.type === 'section') { embed.description += `${embed.description ? '\n' : ''}${item.texts.join('\n')}`; if (item.accessory.kind === 'thumbnail') embed.thumbnail = item.accessory.url; else rows.push({ id: rid(), type: 'buttons', buttons: [item.accessory.button] }); }
    if (item.type === 'media' && !embed.image) embed.image = item.items[0]?.url || '';
    if (item.type === 'buttons' || item.type === 'select') rows.push(item);
  });
  doc.components.forEach(item => {
    if (item.type === 'container') { const embed = { ...newEmbed(), title: '', color: item.color || '#8175f5' }; flatten(item.children, embed); embeds.push(embed); }
    else if (item.type === 'text') content += `${content ? '\n' : ''}${item.content}`;
    else if (item.type === 'buttons' || item.type === 'select') rows.push(item);
    else { const embed = { ...newEmbed(), title: '' }; flatten([item], embed); if (embed.description || embed.image || embed.thumbnail) embeds.push(embed); }
  });
  return { mode, content: content.slice(0, 2000), embeds: embeds.slice(0, 10), components: rows.slice(0, 5) };
}

// ---- Steps dialog (button / option actions) ----------------------------------------------------

function stepsDialog(ownerId) {
  const ed = state.ed;
  const hit = findOwner(ed.doc, ownerId); if (!hit) return;
  const owner = hit.owner;
  const multi = hit.kind === 'option' && hit.node.select.max > 1;
  let selected = 0; let submitSelected = -1;
  const { root, close } = dialog(`${hit.kind === 'button' ? 'Button' : 'Menu option'} · ${owner.label || owner.emoji || 'Untitled'}`, '<div class="st-steps" data-steps-root></div>', { wide: true });
  root.querySelector('.st-dialog').classList.add('st-steps-dialog');
  const body = root.querySelector('[data-steps-root]');
  let changed = false;
  const commit = () => { changed = true; ed.dirty = true; renderPreview(); };

  const roleChips = (action, path) => `<div class="st-roles">${action.roleIds.map(id => { const role = state.options.roles.find(item => item.id === id); return `<span class="st-role-chip ${role && !role.manageable ? 'warn' : ''}"><i style="background:${esc(role?.color && role.color !== '#000000' ? role.color : 'var(--muted)')}"></i>${esc(role?.name || 'Deleted role')}<button type="button" data-role-remove="${path}:${id}">${ic('close-circle', { size: 13 })}</button></span>`; }).join('')}<select data-role-add="${path}"><option value="">+ Add role</option>${state.options.roles.filter(role => !action.roleIds.includes(role.id)).map(role => `<option value="${role.id}" ${role.manageable && (!role.dangerous || action.type === 'removeRoles') ? '' : 'disabled'}>${esc(role.name)}${!role.manageable ? ' (above the bot)' : role.dangerous && action.type !== 'removeRoles' ? ' (staff permissions)' : ''}</option>`).join('')}</select></div>`;
  const channelSelect = (action, path) => `<select data-step="${path}.channelId"><option value="">Choose a channel…</option>${state.options.channels.map(channel => `<option value="${channel.id}" ${action.channelId === channel.id ? 'selected' : ''}>#${esc(channel.name)}</option>`).join('')}</select>`;

  function stepSettings(action, path, { inForm = false, form = null } = {}) {
    const vars = `<small class="st-var-hint">Variables: <code>{user}</code> <code>{user.name}</code> <code>{server}</code>${hit.kind === 'option' ? ' <code>{option}</code>' : ''}${inForm ? form.fields.map(item => ` <code>{form.${item.id}}</code>`).join('') : ''}</small>`;
    switch (action.type) {
      case 'reply': return `<label class="st-field"><span>Reply</span><div class="st-seg"><button type="button" data-reply-kind="${path}:text" aria-pressed="${!action.messageId}">Text</button><button type="button" data-reply-kind="${path}:message" aria-pressed="${Boolean(action.messageId)}">Saved message</button></div></label>
        ${action.messageId ? `<label class="st-field"><span>Message to send</span><select data-step="${path}.messageId">${state.list.filter(item => item.id !== ed.id).map(item => `<option value="${item.id}" ${item.id === action.messageId ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select></label>` : `<label class="st-field"><span>Text</span><textarea dir="auto" rows="4" maxlength="2000" data-step="${path}.content">${esc(action.content)}</textarea>${vars}</label>`}
        <label class="st-toggle-row"><span class="st-switch"><input type="checkbox" data-step-bool="${path}.ephemeral" ${action.ephemeral ? 'checked' : ''}><span></span></span><span><b>Only visible to them</b><small>Ephemeral reply that nobody else sees.</small></span></label>`;
      case 'addRoles': case 'removeRoles': case 'toggleRoles': return `<div class="st-field"><span>Roles</span>${roleChips(action, path)}<small>The bot's role must be above these roles. Roles with moderator or admin permissions can never be given from a button, and you can only pick roles below your own.</small></div>`;
      case 'dm': return `<label class="st-field"><span>Direct message</span><textarea dir="auto" rows="4" maxlength="2000" data-step="${path}.content">${esc(action.content)}</textarea>${vars}</label>`;
      case 'channel': return `<label class="st-field"><span>Channel</span>${channelSelect(action, path)}</label>${inForm ? `<label class="st-field"><span>Format</span><div class="st-seg"><button type="button" data-format="${path}:answers" aria-pressed="${action.format === 'answers'}">Answers embed</button><button type="button" data-format="${path}:text" aria-pressed="${action.format === 'text'}">Custom text</button></div></label>` : ''}<label class="st-field"><span>${action.format === 'answers' && inForm ? 'Text above the answers (optional)' : 'Message'}</span><textarea dir="auto" rows="3" maxlength="2000" data-step="${path}.content">${esc(action.content)}</textarea>${vars}</label>`;
      case 'form': return formEditor(action, path);
    }
    return '';
  }

  function formEditor(form, path) {
    return `<label class="st-field"><span>Form title</span><input dir="auto" maxlength="45" data-step="${path}.title" value="${esc(form.title)}"></label>
      <div class="st-sub"><div class="st-sub-head"><b>Questions</b><small>${form.fields.length}/5</small></div>
      ${form.fields.map((item, index) => `<div class="st-form-field"><div class="st-inline"><label class="st-field"><span>Question</span><input dir="auto" maxlength="45" data-step="${path}.fields.${index}.label" value="${esc(item.label)}"></label><label class="st-field small"><span>Type</span><select data-step="${path}.fields.${index}.style"><option value="short" ${item.style === 'short' ? 'selected' : ''}>Short</option><option value="paragraph" ${item.style === 'paragraph' ? 'selected' : ''}>Paragraph</option></select></label></div>
        <div class="st-inline"><label class="st-field"><span>Hint</span><input dir="auto" maxlength="100" data-step="${path}.fields.${index}.description" value="${esc(item.description)}" placeholder="Shown under the question"></label><label class="st-field"><span>Placeholder</span><input dir="auto" maxlength="100" data-step="${path}.fields.${index}.placeholder" value="${esc(item.placeholder)}"></label></div>
        <div class="st-form-foot"><label class="st-check"><input type="checkbox" data-step-bool="${path}.fields.${index}.required" ${item.required ? 'checked' : ''}><span>Required</span></label><code title="Use this in submit steps">{form.${item.id}}</code><button type="button" class="st-link-btn danger" data-field-del="${path}:${index}" ${form.fields.length <= 1 ? 'disabled' : ''}>Remove</button></div></div>`).join('')}
      ${form.fields.length < 5 ? `<button type="button" class="st-link-btn" data-field-new="${path}">${ic('add', { size: 14 })} Add question</button>` : ''}</div>
      <div class="st-sub"><div class="st-sub-head"><b>After submit</b><small>${form.submit.length}/10</small></div>
        <div class="st-step-list">${form.submit.map((action, index) => `<button type="button" class="st-step ${submitSelected === index ? 'on' : ''}" data-submit-pick="${index}"><i>${index + 1}</i>${ic(CATALOG_MAP[action.type].icon, { size: 15 })}<span><b>${CATALOG_MAP[action.type].label}</b><small>${esc(stepSummary(action))}</small></span><em data-submit-del="${index}" title="Remove">${ic('trash', { size: 14 })}</em></button>`).join('') || '<p class="st-muted">Nothing runs after submit yet — people get a default “Thanks” reply.</p>'}</div>
        <div class="st-catalog mini">${CATALOG.filter(([key]) => key !== 'form').map(([key, label, icon]) => `<button type="button" data-submit-add="${key}">${ic(icon, { size: 14 })} ${label}</button>`).join('')}</div>
        ${form.submit[submitSelected] ? `<div class="st-step-settings">${stepSettings(form.submit[submitSelected], `${path}.submit.${submitSelected}`, { inForm: true, form })}</div>` : ''}
      </div>`;
  }

  const stepSummary = action => action.type === 'reply' ? (action.messageId ? `Saved message: ${state.list.find(item => item.id === action.messageId)?.name || '?'}` : action.content.slice(0, 50)) : action.roleIds ? `${action.roleIds.length} role(s)` : action.type === 'form' ? `${action.fields.length} question(s)` : action.type === 'channel' ? (state.options.channels.find(item => item.id === action.channelId)?.name ? `#${state.options.channels.find(item => item.id === action.channelId).name.split(' / ').pop()}` : 'No channel yet') : (action.content || '').slice(0, 50);

  function paint() {
    const hasForm = owner.actions[0]?.type === 'form';
    body.innerHTML = `<div class="st-steps-main">
        <div class="st-steps-head"><b>Steps</b><small>Run in order when ${hit.kind === 'button' ? 'the button is clicked' : 'this option is picked'}.</small></div>
        <div class="st-step-list">${owner.actions.map((action, index) => `<button type="button" class="st-step ${selected === index ? 'on' : ''}" data-pick="${index}"><i>${String(index + 1).padStart(2, '0')}</i>${ic(CATALOG_MAP[action.type].icon, { size: 15 })}<span><b>${CATALOG_MAP[action.type].label}</b><small>${esc(stepSummary(action))}</small></span><em>${index > 0 ? `<span data-up="${index}" title="Move up">${ic('arrow-up-04', { size: 13 })}</span>` : ''}<span data-del="${index}" title="Remove">${ic('trash', { size: 14 })}</span></em></button>`).join('') || '<div class="st-empty-card st-empty-steps"><b>No steps yet</b><span>Pick a step type from the catalog to start.</span></div>'}</div>
        <div class="st-step-settings">${owner.actions[selected] ? stepSettings(owner.actions[selected], `actions.${selected}`) : '<p class="st-muted">Select a step to configure it.</p>'}</div>
      </div>
      <aside class="st-catalog"><div class="st-steps-head"><b>Catalog</b></div>${CATALOG.map(([key, label, icon, text]) => { const disabled = key === 'form' && (owner.actions.length > 0 || multi) ; return `<button type="button" data-add-step="${key}" ${disabled ? 'disabled' : ''} title="${key === 'form' ? (multi ? 'Forms need a single-choice menu' : 'A form must be the first step') : ''}">${ic(icon, { size: 16 })}<span><b>${label}</b><small>${esc(text)}</small></span>${ic('add', { size: 14 })}</button>`; }).join('')}
        ${hasForm ? '<p class="st-muted st-note">A form opens a Discord modal first; its “After submit” steps run when it is sent.</p>' : ''}</aside>`;
  }

  body.addEventListener('click', event => {
    const el = event.target.closest('[data-pick],[data-del],[data-up],[data-add-step],[data-role-remove],[data-reply-kind],[data-format],[data-field-new],[data-field-del],[data-submit-pick],[data-submit-del],[data-submit-add]');
    if (!el) return;
    snapshot(true);
    if (el.dataset.del !== undefined) { event.stopPropagation(); owner.actions.splice(Number(el.dataset.del), 1); selected = Math.max(0, Math.min(selected, owner.actions.length - 1)); }
    else if (el.dataset.up !== undefined) { event.stopPropagation(); const index = Number(el.dataset.up); if (owner.actions[index - 1]?.type === 'form') return toast('The form must stay first.'); owner.actions.splice(index - 1, 0, owner.actions.splice(index, 1)[0]); selected = index - 1; }
    else if (el.dataset.pick !== undefined) { selected = Number(el.dataset.pick); submitSelected = -1; }
    else if (el.dataset.addStep) { if (owner.actions.length >= 10) return toast('Up to 10 steps.'); const action = newAction(el.dataset.addStep); if (action.type === 'form') owner.actions.unshift(action); else owner.actions.push(action); selected = action.type === 'form' ? 0 : owner.actions.length - 1; submitSelected = -1; }
    else if (el.dataset.roleRemove) { const [path, id] = el.dataset.roleRemove.split(':'); const action = getPath(owner, path); action.roleIds = action.roleIds.filter(item => item !== id); }
    else if (el.dataset.replyKind) { const [path, kind] = el.dataset.replyKind.split(':'); const action = getPath(owner, path); action.messageId = kind === 'message' ? (state.list.find(item => item.id !== ed.id)?.id || '') : ''; if (kind === 'message' && !action.messageId) toast('Save another message first to send it as a reply.'); }
    else if (el.dataset.format) { const [path, format] = el.dataset.format.split(':'); getPath(owner, path).format = format; }
    else if (el.dataset.fieldNew) { const form = getPath(owner, el.dataset.fieldNew); if (form.fields.length < 5) form.fields.push({ id: rid(), label: 'Question', description: '', style: 'short', required: true, placeholder: '', min: null, max: null }); }
    else if (el.dataset.fieldDel) { const [path, index] = el.dataset.fieldDel.split(':'); getPath(owner, path).fields.splice(Number(index), 1); }
    else if (el.dataset.submitDel !== undefined) { event.stopPropagation(); owner.actions[selected].submit.splice(Number(el.dataset.submitDel), 1); submitSelected = -1; }
    else if (el.dataset.submitPick !== undefined) submitSelected = Number(el.dataset.submitPick);
    else if (el.dataset.submitAdd) { const form = owner.actions[selected]; if (form.submit.length >= 10) return toast('Up to 10 steps.'); const action = newAction(el.dataset.submitAdd); if (action.type === 'channel') action.format = 'answers'; form.submit.push(action); submitSelected = form.submit.length - 1; }
    commit(); paint();
  });
  body.addEventListener('input', event => { const path = event.target.dataset.step; if (!path || event.target.tagName === 'SELECT') return; snapshot(); setPath(owner, path, event.target.value); commit(); });
  body.addEventListener('change', event => {
    const input = event.target;
    if (input.dataset.roleAdd) { if (!input.value) return; snapshot(true); const action = getPath(owner, input.dataset.roleAdd); if (action.roleIds.length < 10) action.roleIds.push(input.value); commit(); return paint(); }
    if (input.dataset.stepBool) { snapshot(true); setPath(owner, input.dataset.stepBool, input.checked); return commit(); }
    if (input.dataset.step && input.tagName === 'SELECT') { snapshot(true); setPath(owner, input.dataset.step, input.value); commit(); return paint(); }
  });
  paint();
  // Re-render the tree when the dialog closes so step counts stay correct.
  const observer = new MutationObserver(() => { if (!document.body.contains(root)) { observer.disconnect(); if (changed) change({ structural: true }); } });
  observer.observe(document.body, { childList: true });
  root.querySelector('[data-close]')?.addEventListener('click', close);
}

// ---- Sending -----------------------------------------------------------------------------------

function sendDialog() {
  const ed = state.ed;
  const channels = state.options.channels;
  const { root, close } = dialog('Send to Discord', `<label class="lt-search st-channel-search">${ic('search-normal', { size: 16 })}<input data-search placeholder="Search channels…"></label><div class="st-channel-list">${channels.map(channel => `<button type="button" class="st-channel" data-channel="${channel.id}"><span>#</span>${esc(channel.name)}</button>`).join('')}</div>
    <p class="st-muted">${ic('info-circle', { size: 13 })} The message is saved first. You can send it to more channels and update every copy later.</p>`);
  root.querySelector('[data-search]').addEventListener('input', event => { const q = event.target.value.toLowerCase(); root.querySelectorAll('[data-channel]').forEach(item => { item.hidden = !item.textContent.toLowerCase().includes(q); }); });
  root.querySelector('[data-search]').focus();
  root.querySelectorAll('[data-channel]').forEach(button => button.addEventListener('click', async () => {
    root.querySelectorAll('[data-channel]').forEach(item => { item.disabled = true; });
    if (ed.dirty && !await save()) { close(); return; }
    try {
      const result = await api(`/api/studio/${ed.id}/send`, { method: 'POST', body: JSON.stringify({ channelId: button.dataset.channel }) });
      close();
      ed.sent.push({ channelId: button.dataset.channel });
      toast('Sent to Discord');
      renderEditor();
      if (result.url) window.open(result.url, '_blank', 'noopener');
    } catch (error) { toast(error.message); root.querySelectorAll('[data-channel]').forEach(item => { item.disabled = false; }); }
  }));
}

async function updateSent() {
  const ed = state.ed;
  if (ed.dirty && !await save()) return;
  try {
    const result = await api(`/api/studio/${ed.id}/update-sent`, { method: 'POST' });
    toast(result.failed.length ? `Updated ${result.updated}/${result.total} · ${result.failed[0]}` : `Updated ${result.updated} message${result.updated === 1 ? '' : 's'} in Discord`);
    const { message } = await api(`/api/studio/${ed.id}`); ed.sent = message.sent; renderEditor();
  } catch (error) { toast(error.message); }
}
