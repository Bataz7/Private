import { setOutgoingTransform, type Client } from '../lib/djs/index.js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { status } from './terminal.js';

export const BRAND_COLOR = 0x8175f5;

// Rift custom emojis (built by scripts/build-emojis.mjs, uploaded as application emojis so they work in every
// server and in DMs). Every message the bot sends goes through emojifyBody, which swaps the standard emojis for
// ours where Discord can render them: message content, embed descriptions and field values, Components V2 text,
// and button / select emojis. Titles, footers, modals and the presence keep standard emojis (custom ones do not
// render there). If an emoji is not uploaded yet, the standard one stays, so nothing ever breaks.
type Entry = { name: string; chars: string[]; file: string; hash: string };
const dir = fileURLToPath(new URL('../../assets/emojis/', import.meta.url));
const entries: Entry[] = (() => { try { return JSON.parse(readFileSync(`${dir}emojis.json`, 'utf8')); } catch { return []; } })();
const ids = new Map<string, string>();
const byChar = new Map<string, string>();
for (const entry of entries) for (const char of entry.chars) byChar.set(char.replace(/️/g, ''), entry.name);
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Longest first so multi-codepoint emojis win over their first codepoint.
const pattern = byChar.size ? new RegExp(`(?:${[...byChar.keys()].sort((a, b) => b.length - a.length).map(escape).join('|')})\\uFE0F?`, 'gu') : null;

const fallback = (name: string) => entries.find(entry => entry.name === `rf_${name}` || entry.name === name)?.chars[0] || '';
const fullName = (name: string) => (name.startsWith('rf_') ? name : `rf_${name}`);

/** Inline markup for one of our emojis, e.g. e('check'); the standard emoji until ours is uploaded. */
export function e(name: string) {
  const id = ids.get(fullName(name));
  return id ? `<:${fullName(name)}:${id}>` : fallback(name);
}
/** Emoji object for buttons and select options. */
export function emojiObject(name: string) {
  const id = ids.get(fullName(name));
  return id ? { id, name: fullName(name) } : { name: fallback(name) };
}
export const emojisReady = () => ids.size > 0;
export const emojiList = () => entries.map(entry => ({ name: entry.name, id: ids.get(entry.name) || null, chars: entry.chars, file: entry.file }));

/** A progress bar made of our bar pieces; falls back to ▰▱. */
export function progressBar(ratio: number, length = 10) {
  const filled = Math.max(0, Math.min(length, Math.round(ratio * length)));
  if (!ids.get('rf_bar_m1')) return `${'▰'.repeat(filled)}${'▱'.repeat(length - filled)}`;
  return Array.from({ length }, (_, index) => e(`bar_${index === 0 ? 'l' : index === length - 1 ? 'r' : 'm'}${index < filled ? 1 : 0}`)).join('');
}

export function emojify(text: string) {
  if (!pattern || !ids.size || !text) return text;
  return text.replace(pattern, match => { const name = byChar.get(match.replace(/️/g, '')); const id = name && ids.get(name); return id ? `<:${name}:${id}>` : match; });
}

// One of our emojis at the very start of a text, e.g. "🏖️ New leave request".
function leadingEmoji(text: string) {
  if (!pattern) return null;
  const match = new RegExp(`^\\s*(${pattern.source})\\s*`, 'u').exec(text);
  if (!match) return null;
  const name = byChar.get(match[1]!.replace(/️/g, ''));
  const id = name && ids.get(name);
  return id ? { raw: match[0], name, id } : null;
}

function swapEmojiObject(emoji: any) {
  if (!emoji || emoji.id || !emoji.name) return emoji;
  const name = byChar.get(String(emoji.name).replace(/️/g, ''));
  const id = name && ids.get(name);
  return id ? { id, name, animated: false } : emoji;
}

function walkComponents(list: any[], texts: Array<{ node: any; before: string }>) {
  for (const node of list || []) {
    if (!node || typeof node !== 'object') continue;
    if (node.type === 10 && typeof node.content === 'string') { const before = node.content; node.content = emojify(before); texts.push({ node, before }); }
    if (node.type === 2) node.emoji = swapEmojiObject(node.emoji);
    if (node.type === 3 && Array.isArray(node.options)) for (const option of node.options) option.emoji = swapEmojiObject(option.emoji);
    if (node.accessory) walkComponents([node.accessory], texts);
    if (Array.isArray(node.components)) walkComponents(node.components, texts);
  }
}

// Custom emoji markup is longer than the character it replaces, so any part that would pass Discord's limit keeps the original.
export function emojifyBody(body: any) {
  if (!body || !ids.size) return body;
  if (typeof body.content === 'string') { const next = emojify(body.content); if (next.length <= 2000) body.content = next; }
  for (const embed of Array.isArray(body.embeds) ? body.embeds : []) {
    const original = JSON.stringify(embed);
    // Titles and footers cannot show custom emojis. A title that starts with one of ours becomes a heading at the
    // top of the description (same size, and the emoji renders); a footer emoji becomes the footer icon.
    const lead = typeof embed.title === 'string' ? leadingEmoji(embed.title) : null;
    if (lead && embed.title.length - lead.raw.length > 0) {
      const title = embed.title.slice(lead.raw.length).trim();
      const heading = `### <:${lead.name}:${lead.id}> ${embed.url ? `[${title}](${embed.url})` : title}`;
      const description = typeof embed.description === 'string' ? embed.description : '';
      if (heading.length + description.length + 1 <= 4096) {
        embed.description = description ? `${heading}\n${description}` : heading;
        delete embed.title; delete embed.url;
      }
    }
    const foot = embed.footer && typeof embed.footer.text === 'string' && !embed.footer.icon_url ? leadingEmoji(embed.footer.text) : null;
    if (foot && embed.footer.text.length > foot.raw.length) { embed.footer.text = embed.footer.text.slice(foot.raw.length).trim(); embed.footer.icon_url = `https://cdn.discordapp.com/emojis/${foot.id}.png`; }
    if (typeof embed.description === 'string') { const next = emojify(embed.description); if (next.length <= 4096) embed.description = next; }
    for (const field of Array.isArray(embed.fields) ? embed.fields : []) if (typeof field.value === 'string') { const next = emojify(field.value); if (next.length <= 1024) field.value = next; }
    // Custom emojis are much longer as text: Discord rejects an embed over 6000 characters in total, so keep the plain text then.
    const total = (embed.title?.length || 0) + (embed.description?.length || 0) + (embed.footer?.text?.length || 0) + (embed.author?.name?.length || 0) + (Array.isArray(embed.fields) ? embed.fields : []).reduce((sum: number, field: any) => sum + String(field.name || '').length + String(field.value || '').length, 0);
    if (total > 6000) { for (const key of Object.keys(embed)) delete embed[key]; Object.assign(embed, JSON.parse(original)); }
  }
  if (Array.isArray(body.components)) {
    const texts: Array<{ node: any; before: string }> = [];
    walkComponents(body.components, texts);
    // Components V2 allow 4000 characters of text per message in total.
    if (texts.reduce((sum, item) => sum + item.node.content.length, 0) > 4000) for (const item of texts) item.node.content = item.before;
  }
  return body;
}

let hooked = false;
/** Runs emojifyBody on every outgoing message (sends, DMs, replies, edits, webhooks). Call once per process. */
export function installEmojiHook() {
  if (hooked) return;
  hooked = true;
  setOutgoingTransform(body => {
    try {
      // Rift purple for every embed that has no colour of its own (red/green ones keep their meaning).
      if (Array.isArray(body.embeds)) for (const embed of body.embeds) if (embed && typeof embed === 'object' && embed.color === undefined) embed.color = BRAND_COLOR;
      emojifyBody(body);
    } catch (error) { console.error('Emoji swap failed:', error); }
  });
}

// Local record of which design (hash) was uploaded, so rebuilding the set replaces changed emojis.
const uploadedFile = `${dir}.uploaded.json`;
const readUploaded = (): Record<string, string> => { try { return existsSync(uploadedFile) ? JSON.parse(readFileSync(uploadedFile, 'utf8')) : {}; } catch { return {}; } };

async function fetchFound(client: Client) {
  const existing = await client.application!.emojis.fetch().catch(error => { console.error('Could not load application emojis:', error.message); return null; });
  return existing ? new Map([...existing.values()].map(emoji => [emoji.name!, emoji])) : null;
}

/**
 * Loads our emoji ids. With upload (the bot process only, so two processes never race), also creates missing
 * emojis and replaces redesigned ones. Returns how many are ready.
 */
export async function syncEmojis(client: Client, { upload = false, quiet = false } = {}) {
  if (!client.application || !entries.length) return 0;
  let found = await fetchFound(client);
  if (!found) return ids.size;
  let created = 0; let failed = 0;
  if (upload) {
    const uploaded = readUploaded();
    for (const entry of entries) {
      const current = found.get(entry.name);
      const changed = current && uploaded[entry.name] && uploaded[entry.name] !== entry.hash;
      if (current && !changed) { uploaded[entry.name] ??= entry.hash; continue; }
      try {
        if (current) await current.delete();
        const emoji = await client.application.emojis.create({ attachment: `${dir}${entry.file}`, name: entry.name });
        found.set(entry.name, emoji);
        uploaded[entry.name] = entry.hash;
        created += 1;
      } catch (error) { failed += 1; console.error(`Emoji upload failed for ${entry.name}:`, error instanceof Error ? error.message : error); }
    }
    try { writeFileSync(uploadedFile, JSON.stringify(uploaded, null, 1)); } catch { /* read-only disk: uploads still worked */ }
    // Something failed (for example a name another upload took first): read the real list again.
    if (failed) found = (await fetchFound(client)) || found;
  }
  ids.clear();
  for (const entry of entries) { const emoji = found.get(entry.name); if (emoji) ids.set(entry.name, emoji.id); }
  if (!quiet) console.log(`  ${status(ids.size === entries.length ? 'ok' : 'wait', 'Emojis', `${ids.size}/${entries.length} ready${created ? `, ${created} uploaded` : ''}${ids.size < entries.length ? ' (missing ones use standard emojis)' : ''}`)}`);
  return ids.size;
}

/** For processes that do not upload: waits until the bot has uploaded the set (or the time runs out). */
export async function waitForEmojis(client: Client, timeoutMs = 120_000) {
  const until = Date.now() + timeoutMs;
  let ready = await syncEmojis(client, { quiet: true });
  while (ready < entries.length && Date.now() < until) {
    await new Promise(done => setTimeout(done, 5_000));
    ready = await syncEmojis(client, { quiet: true });
  }
  console.log(`  ${status(ready === entries.length ? 'ok' : 'wait', 'Emojis', `${ready}/${entries.length} ready`)}`);
  return ready;
}
