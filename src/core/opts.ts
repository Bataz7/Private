/**
 * بناء خيارات أوامر السلاش بأسماء عربية.
 *   o.str("السبب", "سبب الإنذار")                 ← مطلوب افتراضياً
 *   o.int("العدد", "عدد النقاط", { min: 1, required: false })
 *   o.choice("العملية", "…", [["اضافة","add"], ["ازالة","remove"]])
 *   o.sub("اعداد", "…", [o.role(...), ...])          ← أمر فرعي
 */
import { ChannelType, OptionType } from "../discord/constants.ts";

interface Base { required?: boolean }
type Choice = [name: string, value: string | number];

const base = (type: number, name: string, description: string, o: Base = {}) => ({
  type, name, description: description.slice(0, 100), required: o.required ?? true,
});
const choices = (list?: Choice[]) => list?.map(([name, value]) => ({ name, value }));

export const o = {
  str: (name: string, d: string, x: Base & { choices?: Choice[]; min?: number; max?: number; autocomplete?: boolean } = {}) =>
    ({ ...base(OptionType.String, name, d, x), choices: choices(x.choices), min_length: x.min, max_length: x.max, autocomplete: x.autocomplete || undefined }),
  int: (name: string, d: string, x: Base & { choices?: Choice[]; min?: number; max?: number; autocomplete?: boolean } = {}) =>
    ({ ...base(OptionType.Integer, name, d, x), choices: choices(x.choices), min_value: x.min, max_value: x.max, autocomplete: x.autocomplete || undefined }),
  num: (name: string, d: string, x: Base & { min?: number; max?: number } = {}) =>
    ({ ...base(OptionType.Number, name, d, x), min_value: x.min, max_value: x.max }),
  bool: (name: string, d: string, x: Base = {}) => base(OptionType.Boolean, name, d, x),
  user: (name: string, d: string, x: Base = {}) => base(OptionType.User, name, d, x),
  role: (name: string, d: string, x: Base = {}) => base(OptionType.Role, name, d, x),
  mentionable: (name: string, d: string, x: Base = {}) => base(OptionType.Mentionable, name, d, x),
  attachment: (name: string, d: string, x: Base = {}) => base(OptionType.Attachment, name, d, x),
  channel: (name: string, d: string, x: Base & { types?: number[] } = {}) =>
    ({ ...base(OptionType.Channel, name, d, x), channel_types: x.types ?? [ChannelType.Text, ChannelType.News] }),
  /** خيار نصي بقائمة ثابتة. */
  choice: (name: string, d: string, list: Choice[], x: Base = {}) => ({ ...base(OptionType.String, name, d, x), choices: choices(list) }),
  sub: (name: string, d: string, options: any[] = []) => ({ type: OptionType.Subcommand, name, description: d.slice(0, 100), options: sortRequired(options) }),
  group: (name: string, d: string, subs: any[]) => ({ type: OptionType.Group, name, description: d.slice(0, 100), options: subs }),
};

/** ديسكورد يشترط إن الخيارات المطلوبة تجي قبل الاختيارية. */
export function sortRequired(options: any[]): any[] {
  return [...options.filter((x) => x.required), ...options.filter((x) => !x.required)];
}

export { ChannelType };
