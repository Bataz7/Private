/** بناء الأزرار والقوائم والنوافذ. */
import { ButtonStyle, ComponentType, TextInputStyle } from "./discord/constants.ts";
import type { ComponentEmoji } from "./emojis.ts";

export interface Button {
  type: 2;
  style: number;
  label?: string;
  emoji?: ComponentEmoji;
  custom_id?: string;
  url?: string;
  disabled?: boolean;
}

export const row = (...components: unknown[]) => ({ type: ComponentType.ActionRow, components });

export function button(custom_id: string, label: string, opts: { emoji?: ComponentEmoji; style?: number; disabled?: boolean } = {}): Button {
  return {
    type: ComponentType.Button,
    style: opts.style ?? ButtonStyle.Secondary,
    custom_id,
    ...(label ? { label } : {}),
    ...(opts.emoji ? { emoji: opts.emoji } : {}),
    ...(opts.disabled ? { disabled: true } : {}),
  };
}

export function select(custom_id: string, placeholder: string, options: { label: string; value: string; emoji?: ComponentEmoji; default?: boolean; description?: string }[], min = 0, max = options.length) {
  return {
    type: ComponentType.StringSelect,
    custom_id,
    placeholder,
    min_values: min,
    max_values: Math.min(max, options.length, 25),
    options: options.slice(0, 25),
  };
}

export function textInput(custom_id: string, label: string, opts: { paragraph?: boolean; required?: boolean; max?: number; min?: number; placeholder?: string; value?: string } = {}) {
  return row({
    type: ComponentType.TextInput,
    custom_id,
    label: label.slice(0, 45),
    style: opts.paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short,
    required: opts.required ?? false,
    ...(opts.max ? { max_length: opts.max } : {}),
    ...(opts.min ? { min_length: opts.min } : {}),
    ...(opts.placeholder ? { placeholder: opts.placeholder.slice(0, 100) } : {}),
    ...(opts.value ? { value: opts.value.slice(0, opts.max ?? 4000) } : {}),
  });
}

/** يقص النص لحد ديسكورد. */
export function clip(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

export function bulletList(items: string[], max = 4, limit = 1024): string {
  return clip(items.slice(0, max).map((x) => `• ${x}`).join("\n"), limit);
}

/** شريط تقدم نصي ▰▰▰▱▱ */
export function progressBar(value: number, max: number, width = 10): string {
  const filled = Math.round((Math.max(0, Math.min(value, max)) / max) * width);
  return "▰".repeat(filled) + "▱".repeat(width - filled);
}
