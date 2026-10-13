// Draws Discord Components V2 message JSON (the panel and the review card) the way the Discord client shows it.
// Small on purpose: only the parts the moderation-report messages use. Styles live in modreports.css (mr-dp-*).

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
const safeUrl = value => { try { const url = new URL(String(value)); return /^https?:$/.test(url.protocol) ? url.toString() : ''; } catch { return ''; } };
const hex = value => (typeof value === 'number' ? `#${value.toString(16).padStart(6, '0')}` : '');

function timestamp(seconds, style) {
  const date = new Date(Number(seconds) * 1000);
  if (Number.isNaN(date.getTime())) return '';
  if (style === 'R') {
    const diff = Math.round((date.getTime() - Date.now()) / 1000); const abs = Math.abs(diff);
    const [n, unit] = abs < 60 ? [abs, 'second'] : abs < 3600 ? [Math.round(abs / 60), 'minute'] : abs < 86400 ? [Math.round(abs / 3600), 'hour'] : [Math.round(abs / 86400), 'day'];
    return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(diff < 0 ? -n : n, unit);
  }
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeStyle: 'short' }).format(date);
}

function inline(source, ctx) {
  const tokens = [];
  const keep = html => { tokens.push(html); return `\u0000${tokens.length - 1}\u0000`; };
  let html = esc(source)
    .replace(/`([^`\n]+)`/g, (_, code) => keep(`<code>${code}</code>`))
    .replace(/&lt;t:(-?\d+)(?::([tTdDfFR]))?&gt;/g, (_, seconds, style) => keep(`<span class="mr-dp-chip">${esc(timestamp(seconds, style || 'f'))}</span>`))
    .replace(/&lt;a?:(\w+):(\d+)&gt;/g, (_, name) => keep(`<span class="mr-dp-chip">:${esc(name)}:</span>`))
    .replace(/&lt;@&amp;(\d+)&gt;/g, (_, id) => { const role = ctx.roles?.find(item => item.id === id); return keep(`<span class="mr-dp-mention" ${role?.color && role.color !== '#000000' ? `style="--mc:${esc(role.color)}"` : ''}>@${esc(role?.name || 'role')}</span>`); })
    .replace(/&lt;@!?(\d+)&gt;/g, () => keep('<span class="mr-dp-mention">@moderator</span>'))
    .replace(/&lt;#(\d+)&gt;/g, (_, id) => keep(`<span class="mr-dp-mention">#${esc(ctx.channels?.find(item => item.id === id)?.name || 'channel')}</span>`))
    .replace(/(^|[\s(])(https?:\/\/[^\s<\u0000]+)/g, (_, lead, url) => `${lead}${keep(`<span class="mr-dp-link">${url}</span>`)}`);
  html = html
    .replace(/\*\*\*(.+?)\*\*\*/g, '<b><i>$1</i></b>').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/__(.+?)__/g, '<u>$1</u>')
    .replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, '$1<i>$2</i>').replace(/~~(.+?)~~/g, '<s>$1</s>');
  return html.replace(/\u0000(\d+)\u0000/g, (_, index) => tokens[Number(index)]);
}

// Block level: headings, subtext, quotes and lists (one line at a time).
function markdown(source, ctx) {
  return String(source ?? '').split('\n').map(raw => {
    let line = raw.replace(/^‏/, '');
    const rtl = raw.startsWith('‏') || /^(#{1,3} |-# |> |- )?‏/.test(raw);
    let quoted = false;
    if (/^> ?/.test(line)) { quoted = true; line = line.replace(/^> ?/, ''); line = line.replace(/^‏/, ''); }
    const heading = /^(#{1,3}) (.+)$/.exec(line);
    const bullet = /^- (.+)$/.exec(line);
    let body;
    if (heading) body = `<div class="mr-dp-h${heading[1].length}">${inline(heading[2].replace(/^‏/, ''), ctx)}</div>`;
    else if (/^-# /.test(line)) body = `<div class="mr-dp-sub">${inline(line.slice(3).replace(/^‏/, ''), ctx)}</div>`;
    else if (bullet) body = `<div class="mr-dp-li"><span>•</span><div>${inline(bullet[1], ctx)}</div></div>`;
    else body = `<div class="mr-dp-line">${inline(line, ctx) || '&nbsp;'}</div>`;
    return `<div class="${quoted ? 'mr-dp-quote' : 'mr-dp-plain'}" ${rtl ? 'dir="rtl"' : ''}>${body}</div>`;
  }).join('');
}

const STYLE = { 1: 'primary', 2: 'secondary', 3: 'success', 4: 'danger', 5: 'link' };
const buttonHtml = button => `<span class="mr-dp-btn ${STYLE[button.style] || 'secondary'} ${button.disabled ? 'disabled' : ''}">${button.emoji?.name && !button.emoji.id ? `<span>${esc(button.emoji.name)}</span>` : ''}${button.label ? `<span>${esc(button.label)}</span>` : ''}</span>`;

function component(node, ctx) {
  switch (node?.type) {
    case 17: return `<div class="mr-dp-container" style="${node.accent_color !== undefined ? `--bar:${hex(node.accent_color)}` : ''}">${(node.components || []).map(child => component(child, ctx)).join('')}</div>`;
    case 10: return `<div class="mr-dp-text">${markdown(node.content, ctx)}</div>`;
    case 9: {
      const url = node.accessory?.type === 11 ? safeUrl(node.accessory.media?.url) : '';
      return `<div class="mr-dp-section"><div>${(node.components || []).map(child => `<div class="mr-dp-text">${markdown(child.content, ctx)}</div>`).join('')}</div>${url ? `<img class="mr-dp-thumb" src="${esc(url)}" alt="" onerror="this.classList.add('broken')">` : ''}</div>`;
    }
    case 14: return `<div class="mr-dp-sep ${node.divider === false ? 'blank' : ''} ${node.spacing === 2 ? 'large' : ''}"></div>`;
    case 1: return `<div class="mr-dp-row">${(node.components || []).map(buttonHtml).join('')}</div>`;
    default: return '';
  }
}

/** message: Discord API JSON. ctx: { roles, channels } for mention names. */
export function renderMessage(message, ctx = {}) {
  const time = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `<div class="mr-dp"><img class="mr-dp-avatar" src="/logo-mark.svg" alt=""><div class="mr-dp-main"><div class="mr-dp-head"><b>Rift</b><span>APP</span><small>Today at ${time}</small></div>${(message?.components || []).map(node => component(node, ctx)).join('') || '<div class="mr-dp-empty">Nothing to preview</div>'}</div></div>`;
}
