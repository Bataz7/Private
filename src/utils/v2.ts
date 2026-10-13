import { MessageFlags } from 'discord.js';

// Raw Discord Components V2 payload helpers. discord.js passes these API objects through unchanged.
export const V2_FLAG = MessageFlags.IsComponentsV2 as MessageFlags.IsComponentsV2;
export const T = { row: 1, button: 2, stringSelect: 3, textInput: 4, section: 9, text: 10, thumbnail: 11, media: 12, file: 13, separator: 14, container: 17, label: 18 } as const;
export const STYLE = { primary: 1, secondary: 2, success: 3, danger: 4, link: 5 } as const;
export type ButtonStyleName = keyof typeof STYLE;

// Loosely typed on purpose: these objects go straight to the API, and discord.js's unions reject partial literals.
export type Raw = any;

// Accepts "✅", "<:name:id>" or "<a:name:id>". Returns undefined for empty or unusable input.
export function parseEmoji(value: unknown): Raw | undefined {
  const text = String(value ?? '').trim();
  if (!text) return undefined;
  const custom = /^<(a?):(\w{2,32}):(\d{15,22})>$/.exec(text);
  if (custom) return { id: custom[3], name: custom[2], animated: custom[1] === 'a' };
  if (/^\d{15,22}$/.test(text)) return { id: text };
  return [...text].length <= 8 ? { name: text } : undefined;
}

export const text = (content: string): Raw => ({ type: T.text, content });
export const separator = (divider = true, large = false): Raw => ({ type: T.separator, divider, spacing: large ? 2 : 1 });
export const thumbnail = (url: string, description?: string): Raw => ({ type: T.thumbnail, media: { url }, ...(description ? { description } : {}) });
export const section = (texts: string[], accessory: Raw): Raw => ({ type: T.section, components: texts.slice(0, 3).map(text), accessory });
export const container = (components: Raw[], accent?: number | null, spoiler = false): Raw => ({ type: T.container, components, ...(accent !== undefined && accent !== null ? { accent_color: accent } : {}), ...(spoiler ? { spoiler } : {}) });
export const row = (components: Raw[]): Raw => ({ type: T.row, components });
export function button(options: { id?: string; url?: string; label?: string; style?: ButtonStyleName; emoji?: string; disabled?: boolean }): Raw {
  const style = options.url ? STYLE.link : STYLE[options.style || 'secondary'];
  return {
    type: T.button, style,
    ...(options.url ? { url: options.url } : { custom_id: options.id }),
    ...(options.label ? { label: options.label.slice(0, 80) } : {}),
    ...(parseEmoji(options.emoji) ? { emoji: parseEmoji(options.emoji) } : {}),
    ...(options.disabled ? { disabled: true } : {}),
  };
}

// Discord lays every message out left-to-right. A right-to-left mark at the start of each Arabic line (after any
// markdown prefix such as "# " or "> ") makes punctuation like "!" and "." land on the correct side.
const RLM = '‏';
export const rtl = (value: string) => value.split('\n').map(line => {
  const prefix = /^(#{1,3} |-# |> |>>> |- |\d+\. )*/.exec(line)?.[0] || '';
  return line.trim() ? `${prefix}${RLM}${line.slice(prefix.length)}` : line;
}).join('\n');

export const clip =(value: string, max: number) => (value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value);
export const quote = (value: string) => value.split('\n').map(line => `> ${line}`).join('\n');
export const ts = (date: Date | string | number, style = 'R') => `<t:${Math.floor(new Date(date).getTime() / 1000)}:${style}>`;
