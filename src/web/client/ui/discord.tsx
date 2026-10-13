// معاينة رسائل ديسكورد (Components V2 والإمبد الكلاسيكي) بشكل قريب من تطبيق ديسكورد.
// النصوص تتحول لعناصر JSX (بدون innerHTML)، فأي محتوى من المستخدم يبقى نصًا آمنًا.
import type { Child } from '#jsx/jsx-runtime';
import { cx, safeUrl } from '../lib/dom';

export type PreviewCtx = {
  roles?: Array<{ id: string; name: string; color?: string }>;
  channels?: Array<{ id: string; name: string }>;
  users?: Record<string, string>;
  attachments?: Record<string, string>;
  interactive?: boolean;
  openSelect?: string;
  onButton?: (customId: string) => void;
  onSelect?: (customId: string) => void;
  botName?: string;
  botAvatar?: string;
  swap?: boolean;
};

type CustomEmoji = { name: string; id?: string; file?: string; chars?: string[] };
let custom: { map: Map<string, CustomEmoji>; rx: RegExp } | null = null;
const clean = (value: string) => value.replace(/️/g, '');
const emojiSrc = (item: CustomEmoji) => (item.id ? `https://cdn.discordapp.com/emojis/${item.id}.webp?size=44` : `/emoji-assets/${encodeURIComponent(item.file || '')}`);

/** إيموجيات ريفت المخصصة (من /api/studio/options): المعاينة تبدّل الإيموجي العادي بها مثل البوت. */
export function setCustomEmojis(list: CustomEmoji[] | undefined): void {
  const map = new Map<string, CustomEmoji>();
  for (const item of list ?? []) for (const char of item.chars ?? []) map.set(clean(char), item);
  const keys = [...map.keys()].sort((a, b) => b.length - a.length).map(key => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  custom = keys.length ? { map, rx: new RegExp(`(?:${keys.join('|')})\\uFE0F?`, 'gu') } : null;
}

const hex = (value: unknown) => (typeof value === 'number' ? `#${value.toString(16).padStart(6, '0')}` : '');

function swapText(text: string, ctx: PreviewCtx): Child[] {
  if (!ctx.swap || !custom) return [text];
  const out: Child[] = [];
  let last = 0;
  for (const match of text.matchAll(custom.rx)) {
    const item = custom.map.get(clean(match[0]));
    if (!item) continue;
    if (match.index! > last) out.push(text.slice(last, match.index));
    out.push(<img class="dp-emoji" alt={match[0]} src={emojiSrc(item)} />);
    last = match.index! + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function emojiNode(char: string): Child {
  const item = custom?.map.get(clean(String(char)));
  return item ? <img class="dp-emoji" alt={char} src={emojiSrc(item)} /> : char;
}

function timestamp(seconds: string, style: string): string {
  const date = new Date(Number(seconds) * 1000);
  if (Number.isNaN(date.getTime())) return '';
  if (style === 'R') {
    const diff = Math.round((date.getTime() - Date.now()) / 1000);
    const abs = Math.abs(diff);
    const [n, unit] = abs < 60 ? [abs, 'second'] : abs < 3600 ? [Math.round(abs / 60), 'minute'] : abs < 86400 ? [Math.round(abs / 3600), 'hour'] : abs < 2592000 ? [Math.round(abs / 86400), 'day'] : abs < 31536000 ? [Math.round(abs / 2592000), 'month'] : [Math.round(abs / 31536000), 'year'];
    return new Intl.RelativeTimeFormat('ar-u-nu-latn', { numeric: 'auto' }).format(diff < 0 ? -n : n, unit as Intl.RelativeTimeFormatUnit);
  }
  const options: Record<string, Intl.DateTimeFormatOptions> = { t: { timeStyle: 'short' }, T: { timeStyle: 'medium' }, d: { dateStyle: 'short' }, D: { dateStyle: 'long' }, f: { dateStyle: 'long', timeStyle: 'short' }, F: { dateStyle: 'full', timeStyle: 'short' } };
  return new Intl.DateTimeFormat('ar-SA-u-nu-latn-ca-gregory', options[style] ?? options.f).format(date);
}

const INLINE = /(`[^`\n]+`)|(<t:-?\d+(?::[tTdDfFR])?>)|(<a?:\w+:\d+>)|(<@&\d+>)|(<@!?\d+>)|(<#\d+>)|(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))|(https?:\/\/[^\s<]+)|(\*\*\*.+?\*\*\*)|(\*\*.+?\*\*)|(__.+?__)|(~~.+?~~)|(\|\|.+?\|\|)|(\*(?!\s).+?\*(?!\w))|((?<!\w)_(?!\s).+?_(?!\w))/g;

/** نص سطر واحد بتنسيق ديسكورد. */
export function inline(source: string, ctx: PreviewCtx = {}): Child[] {
  const text = String(source ?? '');
  const out: Child[] = [];
  let last = 0;
  INLINE.lastIndex = 0;
  const matches = [...text.matchAll(INLINE)];
  for (const match of matches) {
    const index = match.index!;
    if (index > last) out.push(...swapText(text.slice(last, index), ctx));
    const token = match[0];
    const inner = (start: number, end: number) => inline(token.slice(start, token.length - end), ctx);
    if (match[1]) out.push(<code class="dp-code">{token.slice(1, -1)}</code>);
    else if (match[2]) {
      const [, seconds = '0', style = 'f'] = /<t:(-?\d+)(?::(\w))?>/.exec(token) ?? [];
      out.push(<span class="dp-ts">{timestamp(seconds, style)}</span>);
    } else if (match[3]) {
      const [, animated, name, id] = /<(a?):(\w+):(\d+)>/.exec(token)!;
      out.push(<img class="dp-emoji" alt={`:${name}:`} src={`https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'webp'}?size=44`} />);
    } else if (match[4]) {
      const role = ctx.roles?.find(item => item.id === token.slice(3, -1));
      out.push(<span class="dp-mention" style={role?.color && role.color !== '#000000' && /^#[0-9a-f]{6}$/i.test(role.color) ? { '--mc': role.color } : undefined}>@{role?.name ?? 'رتبة'}</span>);
    } else if (match[5]) {
      const id = token.replace(/\D/g, '');
      out.push(<span class="dp-mention">@{ctx.users?.[id] ?? 'عضو'}</span>);
    } else if (match[6]) {
      const channel = ctx.channels?.find(item => item.id === token.slice(2, -1));
      out.push(<span class="dp-mention">#{channel?.name?.split(' / ').pop() ?? 'روم'}</span>);
    } else if (match[7]) {
      const [, label = '', url = ''] = /^\[([^\]]+)\]\((.+)\)$/.exec(token) ?? [];
      const href = safeUrl(url);
      out.push(href ? <a class="dp-link" href={href} target="_blank" rel="noopener noreferrer">{inline(label, ctx)}</a> : token);
    } else if (match[8]) {
      const href = safeUrl(token);
      out.push(href ? <a class="dp-link" href={href} target="_blank" rel="noopener noreferrer">{token}</a> : token);
    } else if (match[9]) out.push(<b><i>{inner(3, 3)}</i></b>);
    else if (match[10]) out.push(<b>{inner(2, 2)}</b>);
    else if (match[11]) out.push(<u>{inner(2, 2)}</u>);
    else if (match[12]) out.push(<s>{inner(2, 2)}</s>);
    else if (match[13]) out.push(<span class="dp-spoiler" tabindex="0" onClick={(event: Event) => (event.currentTarget as HTMLElement).classList.add('shown')}>{inner(2, 2)}</span>);
    else out.push(<i>{inner(1, 1)}</i>);
    last = index + token.length;
  }
  if (last < text.length) out.push(...swapText(text.slice(last), ctx));
  return out;
}

/** نص كامل: كتل الكود، العناوين، النص الصغير، الاقتباس والقوائم. */
export function markdown(source: string, context: PreviewCtx = {}): Child[] {
  const ctx = { ...context, swap: context.swap ?? true };
  const parts = String(source ?? '').split(/```(?:[\w+-]*\n)?([\s\S]*?)```/g);
  const out: Child[] = [];
  parts.forEach((part, index) => {
    if (index % 2) { out.push(<pre class="dp-pre"><code>{part.replace(/\n$/, '')}</code></pre>); return; }
    let quoteAll = false;
    const lines = part.split('\n');
    lines.forEach((raw, lineIndex) => {
      if (lineIndex === lines.length - 1 && !raw && index < parts.length - 1) return;
      let line = raw.replace(/^‏/, '');
      let quoted = quoteAll;
      if (/^>>> /.test(line)) { quoteAll = true; quoted = true; line = line.slice(4); }
      else if (/^> /.test(line) || line === '>') { quoted = true; line = line.replace(/^> ?/, ''); }
      const heading = /^(#{1,3}) (.+)$/.exec(line);
      const bullet = /^(\s*)[-*] (.+)$/.exec(line);
      const numbered = /^(\s*)(\d+)\. (.+)$/.exec(line);
      let body: Child;
      if (heading) body = <div class={`dp-h${heading[1]!.length}`}>{inline(heading[2]!, ctx)}</div>;
      else if (/^-# /.test(line)) body = <div class="dp-sub">{inline(line.slice(3), ctx)}</div>;
      else if (bullet) body = <div class="dp-li" style={{ '--indent': Math.min(3, Math.floor(bullet[1]!.length / 2)) }}><span>•</span><div>{inline(bullet[2]!, ctx)}</div></div>;
      else if (numbered) body = <div class="dp-li" style={{ '--indent': Math.min(3, Math.floor(numbered[1]!.length / 2)) }}><span>{numbered[2]}.</span><div>{inline(numbered[3]!, ctx)}</div></div>;
      else body = <div class="dp-line">{line ? inline(line, ctx) : ' '}</div>;
      out.push(quoted ? <div class="dp-quote">{body}</div> : body);
    });
  });
  return out;
}

const STYLE: Record<number, string> = { 1: 'primary', 2: 'secondary', 3: 'success', 4: 'danger', 5: 'link' };

function emojiOf(emoji: any): Child {
  if (!emoji) return null;
  if (emoji.id) return <img class="dp-emoji" alt="" src={`https://cdn.discordapp.com/emojis/${encodeURIComponent(emoji.id)}.${emoji.animated ? 'gif' : 'webp'}?size=44`} />;
  return emojiNode(String(emoji.name ?? ''));
}

function button(item: any, ctx: PreviewCtx): Child {
  const style = STYLE[item.style] ?? 'secondary';
  const clickable = ctx.interactive && item.custom_id && ctx.onButton;
  return (
    <span class={cx('dp-btn', style, item.disabled && 'disabled', clickable && 'clickable')} role={clickable ? 'button' : undefined} tabindex={clickable ? '0' : undefined}
      onClick={clickable ? () => ctx.onButton!(item.custom_id) : undefined}>
      {emojiOf(item.emoji)}
      {item.label ? <span>{item.label}</span> : null}
      {style === 'link' ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 3h7v7M10 14 21 3M21 14v7H3V3h7" /></svg> : null}
    </span>
  );
}

const media = (url: unknown, ctx: PreviewCtx) => (String(url ?? '').startsWith('attachment://') ? ctx.attachments?.[String(url).slice(13)] ?? '' : safeUrl(url));
const broken = (event: Event) => (event.currentTarget as HTMLElement).classList.add('broken');

function component(node: any, ctx: PreviewCtx): Child {
  switch (node?.type) {
    case 17:
      return <div class={cx('dp-container', node.spoiler && 'spoiler')} style={node.accent_color !== undefined && node.accent_color !== null ? { '--bar': hex(node.accent_color) } : undefined}>{(node.components ?? []).map((child: any) => component(child, ctx))}</div>;
    case 10:
      return <div class="dp-text">{markdown(node.content, ctx)}</div>;
    case 9: {
      const accessory = node.accessory?.type === 11
        ? (media(node.accessory.media?.url, ctx) ? <img class="dp-thumb" src={media(node.accessory.media?.url, ctx)} alt="" onError={broken} /> : <span class="dp-thumb broken" />)
        : node.accessory?.type === 2 ? button(node.accessory, ctx) : null;
      return <div class="dp-section"><div class="dp-section-text">{(node.components ?? []).map((child: any) => <div class="dp-text">{markdown(child.content, ctx)}</div>)}</div><div class="dp-accessory">{accessory}</div></div>;
    }
    case 12: {
      const items = (node.items ?? []).slice(0, 10);
      return <div class={`dp-gallery n${Math.min(items.length, 5)}`}>{items.map((item: any) => <div class={cx('dp-gallery-item', item.spoiler && 'spoiler')}>{media(item.media?.url, ctx) ? <img src={media(item.media?.url, ctx)} alt={item.description ?? ''} onError={broken} /> : null}</div>)}</div>;
    }
    case 13:
      return <div class="dp-file"><svg width="30" height="36" viewBox="0 0 30 36" aria-hidden="true"><path d="M3 0h17l10 10v23a3 3 0 0 1-3 3H3a3 3 0 0 1-3-3V3a3 3 0 0 1 3-3Z" fill="#5865f2" opacity=".85" /></svg><div><b>{String(node.file?.url ?? 'file').replace('attachment://', '')}</b><small>ملف</small></div></div>;
    case 14:
      return <div class={cx('dp-sep', node.divider === false && 'blank', node.spacing === 2 && 'large')} />;
    case 1: {
      const first = node.components?.[0];
      if (first?.type === 3) {
        const open = ctx.openSelect === first.custom_id;
        const clickable = ctx.interactive && ctx.onSelect;
        return (
          <div class="dp-row dp-row-select">
            <span class={cx('dp-select', first.disabled && 'disabled', clickable && 'clickable')} role={clickable ? 'button' : undefined} tabindex={clickable ? '0' : undefined} onClick={clickable ? () => ctx.onSelect!(first.custom_id) : undefined}>
              <span>{first.placeholder || 'اختر…'}</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
            </span>
            {open ? <div class="dp-options">{(first.options ?? []).map((option: any) => <div class="dp-option">{emojiOf(option.emoji)}<div><b>{option.label}</b>{option.description ? <small>{option.description}</small> : null}</div></div>)}</div> : null}
          </div>
        );
      }
      return <div class="dp-row">{(node.components ?? []).map((item: any) => button(item, ctx))}</div>;
    }
    default:
      return null;
  }
}

function embed(item: any, ctx: PreviewCtx): Child {
  const color = item.color !== undefined && item.color !== null ? hex(item.color) : '#1e1f22';
  const author = item.author?.name ? <div class="dp-embed-author">{safeUrl(item.author.icon_url) ? <img src={safeUrl(item.author.icon_url)} alt="" /> : null}<span>{item.author.name}</span></div> : null;
  const title = item.title ? <div class="dp-embed-title">{safeUrl(item.url) ? <a class="dp-link" href={safeUrl(item.url)} target="_blank" rel="noopener noreferrer">{inline(item.title, { ...ctx, swap: false })}</a> : inline(item.title, { ...ctx, swap: false })}</div> : null;
  const fields = (item.fields ?? []).length ? <div class="dp-embed-fields">{item.fields.map((field: any) => <div class={cx('dp-embed-field', field.inline && 'inline')}><b>{inline(field.name, { ...ctx, swap: false })}</b><div class="dp-text">{markdown(field.value, ctx)}</div></div>)}</div> : null;
  const footer = item.footer?.text || item.timestamp
    ? <div class="dp-embed-footer">{safeUrl(item.footer?.icon_url) ? <img src={safeUrl(item.footer.icon_url)} alt="" /> : null}<span>{item.footer?.text ?? ''}{item.footer?.text && item.timestamp ? ' • ' : ''}{item.timestamp ? `اليوم ${new Date().toLocaleTimeString('ar-SA-u-nu-latn', { hour: 'numeric', minute: '2-digit' })}` : ''}</span></div>
    : null;
  return (
    <div class="dp-embed" style={{ '--embed': color }}>
      <div class="dp-embed-body">
        {author}{title}
        {item.description ? <div class="dp-text">{markdown(item.description, ctx)}</div> : null}
        {fields}
        {safeUrl(item.image?.url) ? <img class="dp-embed-image" src={safeUrl(item.image.url)} alt="" onError={broken} /> : null}
        {footer}
      </div>
      {safeUrl(item.thumbnail?.url) ? <img class="dp-embed-thumb" src={safeUrl(item.thumbnail.url)} alt="" onError={broken} /> : null}
    </div>
  );
}

/** رسالة كاملة (بالصورة والاسم ووقت الإرسال). */
export function DiscordMessage({ message, ctx = {} }: { message: any; ctx?: PreviewCtx }) {
  const body: Child[] = [];
  if (message?.content) body.push(<div class="dp-text dp-content">{markdown(message.content, ctx)}</div>);
  for (const item of message?.embeds ?? []) body.push(embed(item, ctx));
  for (const item of message?.components ?? []) body.push(component(item, ctx));
  return (
    <div class="dp" dir="auto">
      <img class="dp-avatar" src={safeUrl(ctx.botAvatar) || '/a/s/logo-mark.svg'} alt="" />
      <div class="dp-main">
        <div class="dp-head"><b>{ctx.botName ?? 'Rift'}</b><span class="dp-app">APP</span><small>اليوم {new Date().toLocaleTimeString('ar-SA-u-nu-latn', { hour: 'numeric', minute: '2-digit' })}</small></div>
        {body.length ? body : <div class="dp-empty">ابدأ البناء وتطلع المعاينة هنا</div>}
      </div>
    </div>
  );
}
