/**
 * أدوات بناء الرسائل: إيمبد، أزرار، قوائم، نوافذ، و Components V2 (حاويات وبطاقات).
 * كلها ترجع كائنات JSON جاهزة لـ Discord بدون أي كلاسات ثقيلة.
 */
import { ButtonStyle, ChannelType, ComponentType, MessageFlags, TextInputStyle } from "../discord/constants.ts";

export const COLORS = {
  brand: 0x2f6bff, success: 0x1fc46a, error: 0xf23d4f, warn: 0xffa51f, info: 0x22b8f0, gold: 0xf6c445,
  orange: 0xff8a3d, gray: 0x7b8bab, purple: 0x8b5cf6, teal: 0x14c8b0, navy: 0x003264, red: 0xc0392b, blue: 0x3498db,
  green: 0x2ecc71, dark: 0x2b2d31,
} as const;

/** أسماء الألوان العربية المخزّنة من لوحة التحكم والأوامر القديمة. */
export const COLOR_NAMES: Record<string, number> = {
  "أزرق": 0x3498db, "أخضر": 0x2ecc71, "أحمر": 0xe74c3c, "أصفر": 0xf1c40f, "بنفسجي": 0x9b59b6,
  "برتقالي": 0xe67e22, "أبيض": 0xffffff, "أسود": 0x010101,
};

export function colorOf(v: unknown, fallback: number = COLORS.brand): number {
  if (typeof v === "number") return v;
  if (typeof v !== "string" || !v) return fallback;
  if (v in COLOR_NAMES) return COLOR_NAMES[v]!;
  const m = /^#?([0-9a-f]{6})$/i.exec(v.trim());
  return m ? parseInt(m[1]!, 16) : fallback;
}

export interface Field { name: string; value: string; inline?: boolean }
export interface Embed {
  title?: string; description?: string; color?: number; url?: string; timestamp?: string;
  fields?: Field[]; footer?: { text: string; icon_url?: string }; author?: { name: string; icon_url?: string; url?: string };
  thumbnail?: { url: string }; image?: { url: string };
}

/** قص النص لحد معيّن مع … */
export const clip = (s: unknown, n = 1024): string => {
  const t = String(s ?? "");
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
};

/** إيمبد مع الوقت تلقائياً. القيم الفاضية تنشال عشان ديسكورد ما يرفض. */
export function embed(o: Omit<Embed, "fields" | "thumbnail" | "image" | "timestamp"> & {
  fields?: (Field | false | null | undefined)[]; thumbnail?: string | null; image?: string | null; now?: boolean;
}): Embed {
  const e: Embed = { color: o.color ?? COLORS.brand };
  if (o.title) e.title = clip(o.title, 256);
  if (o.description) e.description = clip(o.description, 4096);
  if (o.url) e.url = o.url;
  if (o.author) e.author = { ...o.author, name: clip(o.author.name, 256) };
  if (o.footer?.text) e.footer = { ...o.footer, text: clip(o.footer.text, 2048) };
  if (o.thumbnail) e.thumbnail = { url: o.thumbnail };
  if (o.image) e.image = { url: o.image };
  const fields = (o.fields ?? []).filter((f): f is Field => !!f && !!f.name).slice(0, 25);
  if (fields.length) e.fields = fields.map((f) => ({ name: clip(f.name, 256), value: clip(f.value || "—", 1024), inline: f.inline ?? true }));
  if (o.now !== false) e.timestamp = new Date().toISOString();
  return e;
}

export const field = (name: string, value: unknown, inline = true): Field => ({ name, value: String(value ?? "—") || "—", inline });

// ─────────── الإيموجي ───────────
export type Emoji = { id?: string; name?: string; animated?: boolean };
/** يحوّل "<:name:id>" أو "<a:name:id>" أو إيموجي عادي لصيغة المكونات. */
export function emo(s?: string | null): Emoji | undefined {
  if (!s) return undefined;
  const m = /^<(a)?:(\w+):(\d+)>$/.exec(s.trim());
  if (m) return { id: m[3], name: m[2], animated: !!m[1] };
  return { name: s.trim() };
}

// ─────────── المكونات الكلاسيكية ───────────
export const row = (...components: any[]) => ({ type: ComponentType.Row, components: components.filter(Boolean) });

export function button(customId: string, label: string, style: number = ButtonStyle.Secondary, o: { emoji?: string | null; disabled?: boolean } = {}) {
  return { type: ComponentType.Button, custom_id: customId, label: label ? clip(label, 80) : undefined, style, emoji: emo(o.emoji), disabled: o.disabled || undefined };
}

export const linkButton = (url: string, label: string, emoji?: string) => ({ type: ComponentType.Button, style: ButtonStyle.Link, url, label: clip(label, 80), emoji: emo(emoji) });

export interface Option { label: string; value: string; description?: string; emoji?: string | null; default?: boolean }
export function select(customId: string, options: Option[], o: { placeholder?: string; min?: number; max?: number; disabled?: boolean } = {}) {
  const opts = options.slice(0, 25).map((x) => ({
    label: clip(x.label, 100), value: clip(x.value, 100), description: x.description ? clip(x.description, 100) : undefined,
    emoji: emo(x.emoji), default: x.default || undefined,
  }));
  return { type: ComponentType.StringSelect, custom_id: customId, options: opts, placeholder: o.placeholder ? clip(o.placeholder, 150) : undefined, min_values: o.min, max_values: o.max, disabled: o.disabled || undefined };
}

export const userSelect = (customId: string, placeholder?: string, o: { min?: number; max?: number } = {}) =>
  ({ type: ComponentType.UserSelect, custom_id: customId, placeholder, min_values: o.min, max_values: o.max });
export const roleSelect = (customId: string, placeholder?: string, o: { min?: number; max?: number } = {}) =>
  ({ type: ComponentType.RoleSelect, custom_id: customId, placeholder, min_values: o.min, max_values: o.max });
export const channelSelect = (customId: string, placeholder?: string, types: number[] = [ChannelType.Text], o: { min?: number; max?: number } = {}) =>
  ({ type: ComponentType.ChannelSelect, custom_id: customId, placeholder, channel_types: types, min_values: o.min, max_values: o.max });

/** حقل نص في نافذة (يُغلّف في Row تلقائياً عبر modal()). */
export function input(customId: string, label: string, o: { paragraph?: boolean; placeholder?: string; required?: boolean; value?: string; min?: number; max?: number } = {}) {
  return {
    type: ComponentType.TextInput, custom_id: customId, label: clip(label, 45), style: o.paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short,
    placeholder: o.placeholder ? clip(o.placeholder, 100) : undefined, required: o.required ?? true, value: o.value ? clip(o.value, 4000) : undefined,
    min_length: o.min, max_length: o.max,
  };
}

export function modal(customId: string, title: string, inputs: any[]) {
  return { custom_id: customId, title: clip(title, 45), components: inputs.slice(0, 5).map((c) => row(c)) };
}

// ─────────── Components V2 ───────────
export const V2 = MessageFlags.ComponentsV2;
export const text = (content: string) => ({ type: ComponentType.TextDisplay, content: clip(content, 4000) });
export const thumb = (url: string, description?: string) => ({ type: ComponentType.Thumbnail, media: { url }, description });
export const section = (texts: string[], accessory: any) => ({ type: ComponentType.Section, components: texts.slice(0, 3).map(text), accessory });
export const sep = (divider = true, large = false) => ({ type: ComponentType.Separator, divider, spacing: large ? 2 : 1 });
export const gallery = (...urls: string[]) => ({ type: ComponentType.MediaGallery, items: urls.slice(0, 10).map((url) => ({ media: { url } })) });
export const container = (accent: number | null, ...components: any[]) =>
  ({ type: ComponentType.Container, accent_color: accent ?? undefined, components: components.filter(Boolean) });

/** شريط تقدّم نصي: ▰▰▰▱▱ */
export function bar(value: number, max: number, width = 12): string {
  const n = max > 0 ? Math.max(0, Math.min(width, Math.round((value / max) * width))) : 0;
  return "▰".repeat(n) + "▱".repeat(width - n);
}

// ─────────── منشن وتنسيق ───────────
export const mention = { user: (id: string) => `<@${id}>`, role: (id: string) => `<@&${id}>`, channel: (id: string) => `<#${id}>` };
/** وقت ديسكورد: <t:unix:style> */
export const ts = (unixSeconds: number, style: "t" | "T" | "d" | "D" | "f" | "F" | "R" = "f") => `<t:${Math.floor(unixSeconds)}:${style}>`;
export const now = () => Math.floor(Date.now() / 1000);

/** مدة مقروءة: 2 ساعة و 5 دقيقة */
export function dur(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds / 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return `${h} ساعة و ${m} دقيقة`;
  if (h) return `${h} ساعة`;
  return `${m} دقيقة`;
}

export const fmt = (n: number) => n.toLocaleString("en-US");
