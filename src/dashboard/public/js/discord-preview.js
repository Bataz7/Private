// Renders Discord API message JSON (Components V2 or classic embeds) as HTML that looks like the Discord client.
// Used by the Embed Studio; shared, so other pages can render message previews with it too.

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
const safeUrl = value => { try { const url = new URL(String(value)); return /^https?:$/.test(url.protocol) ? url.toString() : ''; } catch { return ''; } };
const hex = value => (typeof value === 'number' ? `#${value.toString(16).padStart(6, '0')}` : '');

// Rift custom emojis (GET /api/studio/options). Like the bot, the preview swaps standard emojis for ours where Discord renders
// custom ones: message content, descriptions, field values, V2 text and button emojis; never titles or field names.
let customEmoji = null;
export function setCustomEmojis(list) {
  const map = new Map();
  for (const item of list || []) for (const char of item.chars || []) map.set(char.replace(/️/g, ''), item);
  const keys = [...map.keys()].sort((a, b) => b.length - a.length).map(key => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  customEmoji = keys.length ? { map, rx: new RegExp(`(?:${keys.join('|')})️?`, 'gu') } : null;
}
/** One emoji as Discord will show it in text or on a button: ours when we have it, else the standard one. */
export function emojiTag(char) {
  const item = customEmoji?.map.get(String(char).replace(/️/g, ''));
  return item ? `<img class="dp-emoji" alt="" src="${customSrc(item)}">` : esc(char);
}
const customSrc = item => (item.id ? `https://cdn.discordapp.com/emojis/${item.id}.webp?size=44` : `/emoji-assets/${item.file}`);
const swapUnicode = text => (!customEmoji ? text : text.replace(customEmoji.rx, match => { const item = customEmoji.map.get(match.replace(/️/g, '')); return item ? `\u0001${item.name}\u0001` : match; }));

function formatTimestamp(seconds, style) {
  const date = new Date(Number(seconds) * 1000);
  if (Number.isNaN(date.getTime())) return '';
  if (style === 'R') {
    const diff = Math.round((date.getTime() - Date.now()) / 1000);
    const abs = Math.abs(diff);
    const [n, unit] = abs < 60 ? [abs, 'second'] : abs < 3600 ? [Math.round(abs / 60), 'minute'] : abs < 86400 ? [Math.round(abs / 3600), 'hour'] : abs < 2592000 ? [Math.round(abs / 86400), 'day'] : abs < 31536000 ? [Math.round(abs / 2592000), 'month'] : [Math.round(abs / 31536000), 'year'];
    return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(diff < 0 ? -n : n, unit);
  }
  const options = { t: { timeStyle: 'short' }, T: { timeStyle: 'medium' }, d: { dateStyle: 'short' }, D: { dateStyle: 'long' }, f: { dateStyle: 'long', timeStyle: 'short' }, F: { dateStyle: 'full', timeStyle: 'short' } }[style] || { dateStyle: 'long', timeStyle: 'short' };
  return new Intl.DateTimeFormat('en-US', options).format(date);
}

function inline(source, ctx) {
  // Generated HTML (code, mentions, links, emoji) is swapped for tokens so the formatting pass below can't touch it.
  const tokens = [];
  const keep = html => { tokens.push(html); return `\u0000${tokens.length - 1}\u0000`; };
  let html = esc(ctx.swap ? swapUnicode(String(source ?? '')) : source)
    .replace(/\u0001(rf_\w+)\u0001/g, (_, name) => { const item = [...(customEmoji?.map.values() || [])].find(entry => entry.name === name); return item ? keep(`<img class="dp-emoji" alt=":${name}:" src="${customSrc(item)}">`) : ''; })
    .replace(/`([^`\n]+)`/g, (_, code) => keep(`<code class="dp-code">${code}</code>`))
    .replace(/&lt;t:(-?\d+)(?::([tTdDfFR]))?&gt;/g, (_, seconds, style) => keep(`<span class="dp-ts">${esc(formatTimestamp(seconds, style || 'f'))}</span>`))
    .replace(/&lt;(a?):(\w+):(\d+)&gt;/g, (_, animated, name, id) => keep(`<img class="dp-emoji" alt=":${name}:" src="https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'webp'}?size=44">`))
    .replace(/&lt;@&amp;(\d+)&gt;/g, (_, id) => { const role = ctx.roles?.find(item => item.id === id); return keep(`<span class="dp-mention" ${role?.color && role.color !== '#000000' ? `style="--mc:${esc(role.color)}"` : ''}>@${esc(role?.name || 'role')}</span>`); })
    .replace(/&lt;@!?(\d+)&gt;/g, (_, id) => keep(`<span class="dp-mention">@${esc(ctx.users?.[id] || 'user')}</span>`))
    .replace(/&lt;#(\d+)&gt;/g, (_, id) => { const channel = ctx.channels?.find(item => item.id === id); return keep(`<span class="dp-mention">#${esc(channel?.name?.split(' / ').pop() || 'channel')}</span>`); })
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => keep(`<a class="dp-link" href="${url}" target="_blank" rel="noopener">${label}</a>`))
    .replace(/(^|[\s(])(https?:\/\/[^\s<\u0000]+)/g, (_, lead, url) => `${lead}${keep(`<a class="dp-link" href="${url}" target="_blank" rel="noopener">${url}</a>`)}`);
  html = html
    .replace(/\*\*\*(.+?)\*\*\*/g, '<b><i>$1</i></b>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/__(.+?)__/g, '<u>$1</u>')
    .replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, '$1<i>$2</i>')
    .replace(/(^|[^_\w])_(?!\s)(.+?)_(?!\w)/g, '$1<i>$2</i>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>')
    .replace(/\|\|(.+?)\|\|/g, '<span class="dp-spoiler" tabindex="0">$1</span>');
  return html.replace(/\u0000(\d+)\u0000/g, (_, index) => tokens[Number(index)]);
}

// Block-level Discord markdown: code blocks, headings, subtext, quotes and lists.
export function markdown(source, context = {}) {
  const ctx = { ...context, swap: true };
  const text = String(source ?? '');
  const parts = text.split(/```(?:[\w+-]*\n)?([\s\S]*?)```/g);
  let html = '';
  parts.forEach((part, index) => {
    if (index % 2) { html += `<pre class="dp-pre"><code>${esc(part.replace(/\n$/, ''))}</code></pre>`; return; }
    const lines = part.split('\n');
    let quoteAll = false;
    lines.forEach((raw, lineIndex) => {
      let line = raw;
      let quoted = quoteAll;
      if (/^>>> /.test(line)) { quoteAll = true; quoted = true; line = line.slice(4); }
      else if (/^> /.test(line) || line === '>') { quoted = true; line = line.replace(/^> ?/, ''); }
      let body;
      const heading = /^(#{1,3}) (.+)$/.exec(line);
      const list = /^(\s*)[-*] (.+)$/.exec(line);
      const numbered = /^(\s*)(\d+)\. (.+)$/.exec(line);
      if (heading) body = `<div class="dp-h${heading[1].length}">${inline(heading[2], ctx)}</div>`;
      else if (/^-# /.test(line)) body = `<div class="dp-sub">${inline(line.slice(3), ctx)}</div>`;
      else if (list) body = `<div class="dp-li" style="--indent:${Math.min(3, Math.floor(list[1].length / 2))}"><span>•</span><div>${inline(list[2], ctx)}</div></div>`;
      else if (numbered) body = `<div class="dp-li" style="--indent:${Math.min(3, Math.floor(numbered[1].length / 2))}"><span>${numbered[2]}.</span><div>${inline(numbered[3], ctx)}</div></div>`;
      else body = `<div class="dp-line">${inline(line, ctx) || '&nbsp;'}</div>`;
      html += quoted ? `<div class="dp-quote">${body}</div>` : body;
      if (lineIndex === lines.length - 1 && !line && index < parts.length - 1) html = html.replace(/<div class="dp-line">&nbsp;<\/div>$/, '');
    });
  });
  return html;
}

const STYLE = { 1: 'primary', 2: 'secondary', 3: 'success', 4: 'danger', 5: 'link' };
const emojiHtml = emoji => { const item = emoji && !emoji.id && customEmoji?.map.get(String(emoji.name || '').replace(/️/g, '')); return item ? `<img class="dp-emoji" alt="" src="${customSrc(item)}">` : emojiHtmlPlain(emoji); };
const emojiHtmlPlain = emoji => (!emoji ? '' : emoji.id ? `<img class="dp-emoji" alt="" src="https://cdn.discordapp.com/emojis/${esc(emoji.id)}.${emoji.animated ? 'gif' : 'webp'}?size=44">` : `<span>${esc(emoji.name)}</span>`);

function buttonHtml(button, ctx) {
  const style = STYLE[button.style] || 'secondary';
  const attrs = ctx.interactive && button.custom_id ? ` data-preview-button="${esc(button.custom_id)}"` : '';
  return `<span class="dp-btn ${style} ${button.disabled ? 'disabled' : ''}"${attrs}>${emojiHtml(button.emoji)}${button.label ? `<span>${esc(button.label)}</span>` : ''}${style === 'link' ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 3h7v7M10 14 21 3M21 14v7H3V3h7"/></svg>' : ''}</span>`;
}

function mediaUrl(url, ctx) {
  if (String(url).startsWith('attachment://')) return ctx.attachments?.[String(url).slice(13)] || '';
  return safeUrl(url);
}

function componentHtml(component, ctx) {
  switch (component?.type) {
    case 17: return `<div class="dp-container ${component.spoiler ? 'spoiler' : ''}" style="${component.accent_color !== undefined ? `--accent-bar:${hex(component.accent_color)}` : ''}">${(component.components || []).map(child => componentHtml(child, ctx)).join('')}</div>`;
    case 10: return `<div class="dp-text">${markdown(component.content, ctx)}</div>`;
    case 9: {
      const accessory = component.accessory?.type === 11
        ? (mediaUrl(component.accessory.media?.url, ctx) ? `<img class="dp-thumb" src="${esc(mediaUrl(component.accessory.media.url, ctx))}" alt="" onerror="this.classList.add('broken')">` : '<span class="dp-thumb broken"></span>')
        : component.accessory?.type === 2 ? buttonHtml(component.accessory, ctx) : '';
      return `<div class="dp-section"><div class="dp-section-text">${(component.components || []).map(child => `<div class="dp-text">${markdown(child.content, ctx)}</div>`).join('')}</div><div class="dp-accessory">${accessory}</div></div>`;
    }
    case 12: {
      const items = component.items || [];
      return `<div class="dp-gallery n${Math.min(items.length, 5)}">${items.slice(0, 10).map(item => { const url = mediaUrl(item.media?.url, ctx); return `<div class="dp-gallery-item ${item.spoiler ? 'spoiler' : ''}">${url ? `<img src="${esc(url)}" alt="${esc(item.description || '')}" onerror="this.classList.add('broken')">` : ''}</div>`; }).join('')}</div>`;
    }
    case 13: return `<div class="dp-file"><svg width="30" height="36" viewBox="0 0 30 36"><path d="M3 0h17l10 10v23a3 3 0 0 1-3 3H3a3 3 0 0 1-3-3V3a3 3 0 0 1 3-3Z" fill="#5865f2" opacity=".85"/></svg><div><b>${esc(String(component.file?.url || 'file').replace('attachment://', ''))}</b><small>File</small></div></div>`;
    case 14: return `<div class="dp-sep ${component.divider === false ? 'blank' : ''} ${component.spacing === 2 ? 'large' : ''}"></div>`;
    case 1: {
      const first = component.components?.[0];
      if (first?.type === 3) {
        const options = first.options || [];
        return `<div class="dp-row"><span class="dp-select ${first.disabled ? 'disabled' : ''}" ${ctx.interactive ? `data-preview-select="${esc(first.custom_id)}"` : ''}><span>${esc(first.placeholder || 'Make a selection')}</span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg></span>${ctx.openSelect === first.custom_id ? `<div class="dp-options">${options.map(option => `<div class="dp-option">${emojiHtml(option.emoji)}<div><b>${esc(option.label)}</b>${option.description ? `<small>${esc(option.description)}</small>` : ''}</div></div>`).join('')}</div>` : ''}</div>`;
      }
      return `<div class="dp-row">${(component.components || []).map(button => buttonHtml(button, ctx)).join('')}</div>`;
    }
    default: return '';
  }
}

function embedHtml(embed, ctx) {
  const color = embed.color !== undefined ? hex(embed.color) : '#1e1f22';
  const fields = embed.fields || [];
  return `<div class="dp-embed2" style="--embed-color:${color}"><div class="dp-embed-body">
    ${embed.author?.name ? `<div class="dp-embed-author">${safeUrl(embed.author.icon_url) ? `<img src="${esc(embed.author.icon_url)}" alt="">` : ''}<span>${esc(embed.author.name)}</span></div>` : ''}
    ${embed.title ? `<div class="dp-embed-title">${safeUrl(embed.url) ? `<a class="dp-link" href="${esc(embed.url)}" target="_blank" rel="noopener">${inline(embed.title, ctx)}</a>` : inline(embed.title, ctx)}</div>` : ''}
    ${embed.description ? `<div class="dp-text">${markdown(embed.description, ctx)}</div>` : ''}
    ${fields.length ? `<div class="dp-embed-fields">${fields.map(field => `<div class="dp-embed-field ${field.inline ? 'inline' : ''}"><b>${inline(field.name, ctx)}</b><div class="dp-text">${markdown(field.value, ctx)}</div></div>`).join('')}</div>` : ''}
    ${safeUrl(embed.image?.url) ? `<img class="dp-embed-image" src="${esc(embed.image.url)}" alt="" onerror="this.remove()">` : ''}
    ${embed.footer?.text || embed.timestamp ? `<div class="dp-embed-footer">${safeUrl(embed.footer?.icon_url) ? `<img src="${esc(embed.footer.icon_url)}" alt="">` : ''}<span>${esc(embed.footer?.text || '')}${embed.footer?.text && embed.timestamp ? ' • ' : ''}${embed.timestamp ? 'Today at ' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''}</span></div>` : ''}
  </div>${safeUrl(embed.thumbnail?.url) ? `<img class="dp-embed-thumb" src="${esc(embed.thumbnail.url)}" alt="" onerror="this.remove()">` : ''}</div>`;
}

// ctx: { roles, channels, users, attachments, interactive, openSelect, botName, botAvatar }
export function renderMessage(message, ctx = {}) {
  const time = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const body = (message.content ? `<div class="dp-text dp-content">${markdown(message.content, ctx)}</div>` : '')
    + (message.embeds || []).map(embed => embedHtml(embed, ctx)).join('')
    + (message.components || []).map(component => componentHtml(component, ctx)).join('');
  return `<div class="dpv"><img class="dpv-avatar" src="${esc(ctx.botAvatar || '/logo-mark.svg')}" alt=""><div class="dpv-main"><div class="dpv-head"><b>${esc(ctx.botName || 'Rift')}</b><span class="dpv-app">APP</span><small>Today at ${time}</small></div>${body || '<div class="dp-empty">Start building to see a preview</div>'}</div></div>`;
}
