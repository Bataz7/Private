// Builds the Rift custom emoji set: 128x128 PNG badges drawn from Iconsax "bold" glyphs.
// Output: assets/emojis/<name>.png + assets/emojis/emojis.json (name, unicode it replaces, file hash).
// The bot uploads them as application emojis on start (src/utils/emoji.ts). Run: npm run emojis
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';

const root = resolve(import.meta.dirname, '..');
const pkg = resolve(root, 'node_modules/iconsax/dist');
const out = resolve(root, 'assets/emojis');
mkdirSync(out, { recursive: true });
const manifest = JSON.parse(readFileSync(resolve(pkg, 'manifest.json'), 'utf8'));
const cache = new Map();
const load = category => cache.get(category) ?? (cache.set(category, JSON.parse(readFileSync(resolve(pkg, 'data', `${category}.json`), 'utf8'))), cache.get(category));

const C = {
  green: ['#5ee08f', '#16a34a'], red: ['#ff7a8a', '#e11d48'], amber: ['#ffd66b', '#f59e0b'], blue: ['#6aaeff', '#2563eb'],
  indigo: ['#a9b6ff', '#5b5ff0'], violet: ['#c9b3ff', '#8b5cf6'], teal: ['#6ff0da', '#0d9488'], orange: ['#ffc07a', '#f97316'],
  pink: ['#ffa6d6', '#ec4899'], slate: ['#aab6c8', '#475569'], gold: ['#ffe58f', '#eab308'], cyan: ['#7cecff', '#0891b2'],
  silver: ['#f1f3f6', '#9ca3af'], bronze: ['#f7bf92', '#b45309'],
};

// Hand-drawn glyphs for the ones that must read instantly at 20px.
const DRAW = {
  check: '<path d="M38 66 L56 84 L91 45" fill="none" stroke="#fff" stroke-width="15" stroke-linecap="round" stroke-linejoin="round"/>',
  cross: '<path d="M44 44 L84 84 M84 44 L44 84" fill="none" stroke="#fff" stroke-width="15" stroke-linecap="round"/>',
  dot: '<circle cx="64" cy="64" r="22" fill="#fff"/><circle cx="64" cy="64" r="34" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="7"/>',
  stop: '<rect x="42" y="42" width="44" height="44" rx="10" fill="#fff"/>',
  play: '<path d="M50 38 L90 64 L50 90 Z" fill="#fff" stroke="#fff" stroke-width="10" stroke-linejoin="round"/>',
  star: '<path d="M64 27 L74 53.2 L102 54.6 L80.2 72.3 L87.5 99.4 L64 84 L40.5 99.4 L47.8 72.3 L26 54.6 L54 53.2 Z" fill="#fff" stroke="#fff" stroke-width="8" stroke-linejoin="round"/>',
  chart: '<rect x="34" y="62" width="16" height="32" rx="6" fill="#fff"/><rect x="56" y="38" width="16" height="56" rx="6" fill="#fff"/><rect x="78" y="50" width="16" height="44" rx="6" fill="#fff"/>',
  search: '<circle cx="58" cy="58" r="22" fill="none" stroke="#fff" stroke-width="12"/><path d="M75 75 L92 92" stroke="#fff" stroke-width="13" stroke-linecap="round"/>',
};

// name, glyph (iconsax bold name or DRAW key), colour, unicode characters it replaces
const SET = [
  ['check', 'DRAW:check', 'green', ['✅', '✔️', '☑️', '✔']],
  ['cross', 'DRAW:cross', 'red', ['❌', '✖️', '✖', '❎']],
  ['warn', 'danger', 'amber', ['⚠️', '⚠']],
  ['blocked', 'forbidden-2', 'red', ['⛔', '🚫']],
  ['edit', 'edit-2', 'blue', ['📝', '✏️', '✍️']],
  ['list', 'clipboard-text', 'indigo', ['📋', '📜', '🧾']],
  ['exit', 'logout-02', 'orange', ['🚪', '👋']],
  ['leave', 'sun', 'teal', ['🏖️', '🌴', '✈️']],
  ['online', 'DRAW:dot', 'green', ['🟢']],
  ['busy', 'DRAW:dot', 'red', ['🔴']],
  ['away', 'DRAW:dot', 'amber', ['🟡', '🟠']],
  ['play', 'DRAW:play', 'green', ['▶️']],
  ['stop', 'DRAW:stop', 'red', ['⏹️']],
  ['pause', 'pause', 'amber', ['⏸️', '💤']],
  ['down', 'arrow-circle-down', 'slate', ['👇', '⬇️']],
  ['up', 'arrow-circle-up', 'slate', ['👆', '⬆️']],
  ['shield', 'shield-tick', 'indigo', ['🛡️', '👮']],
  ['timer', 'timer', 'violet', ['⏱️', '⏳', '⌛', '⏰']],
  ['clock', 'clock', 'violet', ['🕒', '🕐', '🕑', '🕓', '🕔', '🕕']],
  ['chart', 'DRAW:chart', 'violet', ['📊']],
  ['trend', 'trend-up', 'green', ['📈']],
  ['trenddown', 'trend-down', 'red', ['📉']],
  ['star', 'DRAW:star', 'gold', ['⭐', '🌟']],
  ['chat', 'message-text', 'violet', ['💬', '🗨️']],
  ['help', 'heart-tick', 'pink', ['🤝']],
  ['mail', 'sms', 'indigo', ['📨', '📩', '📬', '📥', '✉️', '📧']],
  ['ban', 'judge', 'red', ['🔨']],
  ['kick', 'user-minus', 'orange', ['👢']],
  ['mute', 'volume-slash', 'slate', ['🔇']],
  ['idea', 'lamp-charge', 'gold', ['💡']],
  ['trophy', 'cup', 'gold', ['🏆']],
  ['globe', 'global', 'teal', ['🌐', '🌍']],
  ['party', 'magic-star', 'pink', ['🎉', '✨', '🥳']],
  ['people', 'profile-2user', 'indigo', ['👥']],
  ['user', 'user', 'indigo', ['👤']],
  ['like', 'like-1', 'green', ['👍']],
  ['dislike', 'dislike', 'red', ['👎']],
  ['announce', 'notification-bing', 'orange', ['📢', '📣', '🔔']],
  ['calendar', 'calendar-1', 'indigo', ['📅', '📆', '🗓️']],
  ['first', 'medal-star', 'gold', ['🥇']],
  ['second', 'medal-star', 'silver', ['🥈']],
  ['third', 'medal-star', 'bronze', ['🥉']],
  ['undo', 'undo-arrow', 'slate', ['↩️']],
  ['redo', 'redo-arrow', 'slate', ['↪️']],
  ['info', 'info-circle', 'indigo', ['ℹ️']],
  ['fire', 'flash', 'orange', ['🔥', '⚡']],
  ['points', 'diamonds', 'cyan', ['💎', '💙']],
  ['mic', 'microphone-2', 'violet', ['🎙️', '🎤']],
  ['role', 'user-tag', 'violet', ['🎭']],
  ['unlock', 'unlock', 'green', ['🔓']],
  ['lock', 'lock', 'slate', ['🔒', '🔐']],
  ['search', 'DRAW:search', 'blue', ['🔍', '🔎']],
  ['next', 'next', 'slate', ['⏭️']],
  ['folder', 'folder-open', 'amber', ['📂', '📁']],
  ['rocket', 'send-2', 'violet', ['🚀']],
  ['pin', 'location', 'red', ['📌', '📍']],
  ['settings', 'setting-2', 'slate', ['⚙️', '🛠️', '🔧']],
  ['radar', 'radar-2', 'teal', ['📡']],
  ['crown', 'crown', 'gold', ['👑']],
  ['link', 'link', 'blue', ['🔗']],
  ['gift', 'gift', 'pink', ['🎁']],
  ['document', 'document-text', 'indigo', ['📄', '📃']],
  ['tag', 'tag', 'violet', ['🏷️']],
  ['trash', 'trash', 'red', ['🗑️']],
  ['eye', 'eye', 'blue', ['👀', '👁️']],
  ['voice', 'headphone', 'violet', ['🎧', '🔊']],
  ['activity', 'activity', 'pink', ['💓']],
  ['moon', 'moon', 'indigo', ['🌙', '😴']],
  ['engage', 'status-up', 'violet', ['📶']],
  ['hourglass', 'hourglass', 'amber', ['🕰️']],
  ['shiftstart', 'play-circle', 'green', ['🟩']],
  ['shiftend', 'calendar-tick', 'slate', ['🟦']],
];

function glyph(name) {
  if (name.startsWith('DRAW:')) return DRAW[name.slice(5)];
  const meta = manifest[name];
  if (!meta) throw new Error(`Iconsax icon not found: ${name}`);
  const svg = load(meta.category)[name].bold ?? load(meta.category)[name][meta.styles[0]];
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/(fill|stroke)="(?!none)[^"]*"/g, '$1="#fff"').replace(/<defs>[\s\S]*?<\/defs>/g, '');
  // 24px glyph scaled to 72px, centred on the 128px badge.
  return `<g transform="translate(28 28) scale(3)">${inner}</g>`;
}

function badge([top, bottom], body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>
    <linearGradient id="shine" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".38"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <clipPath id="clip"><rect x="4" y="4" width="120" height="120" rx="34"/></clipPath>
    <filter id="drop" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000" flood-opacity=".28"/></filter>
  </defs>
  <rect x="4" y="4" width="120" height="120" rx="34" fill="url(#bg)"/>
  <g clip-path="url(#clip)"><ellipse cx="64" cy="10" rx="92" ry="54" fill="url(#shine)"/></g>
  <rect x="5.5" y="5.5" width="117" height="117" rx="32.5" fill="none" stroke="#fff" stroke-opacity=".22" stroke-width="3"/>
  <g filter="url(#drop)">${body}</g>
</svg>`;
}

// Progress bar pieces: left cap, middle, right cap; filled and empty. Placed side by side they read as one bar.
function barPiece(part, filled) {
  const fill = filled ? 'url(#fill)' : '#4b5263';
  const opacity = filled ? 1 : 0.55;
  const shape = part === 'l' ? '<path d="M128 40 H44 A24 24 0 0 0 44 88 H128 Z"/>' : part === 'r' ? '<path d="M0 40 H84 A24 24 0 0 1 84 88 H0 Z"/>' : '<rect x="0" y="40" width="128" height="48"/>';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c4b5fd"/><stop offset="1" stop-color="#7c5cf0"/></linearGradient></defs><g fill="${fill}" fill-opacity="${opacity}">${shape}</g>${filled ? `<g fill="#fff" fill-opacity=".25">${part === 'l' ? '<path d="M128 44 H46 A20 20 0 0 0 30 52 H128 Z"/>' : part === 'r' ? '<path d="M0 44 H82 A20 20 0 0 1 98 52 H0 Z"/>' : '<rect x="0" y="44" width="128" height="8"/>'}</g>` : ''}</svg>`;
}

const entries = [];
const write = async (name, svg, chars) => {
  const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  writeFileSync(resolve(out, `${name}.png`), png);
  entries.push({ name: `rf_${name}`, chars, file: `${name}.png`, hash: createHash('sha1').update(png).digest('hex').slice(0, 10) });
};

for (const [name, icon, colour, chars] of SET) await write(name, badge(C[colour], glyph(icon)), chars);
for (const part of ['l', 'm', 'r']) for (const filled of [true, false]) await write(`bar_${part}${filled ? 1 : 0}`, barPiece(part, filled), []);

writeFileSync(resolve(out, 'emojis.json'), `${JSON.stringify(entries, null, 1)}\n`);
console.log(`Built ${entries.length} emojis into assets/emojis`);
