/**
 * أسماء الأوامر بالعربي بدون ما نغيّر الكود:
 *   - الكود يعرّف الأوامر بأسماء داخلية إنجليزية (staff, setup, user…) ويقارن عليها.
 *   - عند التسجيل في Discord: localizeCommands() يبدّل الأسماء والأوصاف والاختيارات للعربي من القاموس.
 *   - عند وصول تفاعل: delocalizeInteractionData() يرجّع الأسماء العربية للأسماء الداخلية قبل ما يوصل للكود.
 * القاموس في src/i18n/commands.ts.
 */
import { ApplicationCommandOptionType, InteractionType } from "./enums.ts";

export interface OptionL10n {
  name?: string;
  description?: string;
  /** قيمة الاختيار (value) → الاسم العربي الظاهر */
  choices?: Record<string, string>;
  options?: Record<string, OptionL10n>;
}
export type CommandDictionary = Record<string, OptionL10n>;

let dict: CommandDictionary = {};
export function setCommandLocalization(d: CommandDictionary) {
  dict = d;
}
export function commandLocalization() {
  return dict;
}

const NAME_RX = /^[-_\p{L}\p{N}]{1,32}$/u;
const safeName = (n: string | undefined, fallback: string) => (n && NAME_RX.test(n) && n === n.toLowerCase() ? n : fallback);

function localizeOptions(options: any[] | undefined, node: Record<string, OptionL10n> | undefined): any[] | undefined {
  if (!options) return options;
  return options.map((o) => {
    const t = node?.[o.name];
    const out = { ...o, name: safeName(t?.name, o.name), description: (t?.description ?? o.description ?? "").slice(0, 100) };
    if (o.choices && t?.choices) out.choices = o.choices.map((c: any) => ({ ...c, name: (t.choices![String(c.value)] ?? c.name).slice(0, 100) }));
    if (o.options) out.options = localizeOptions(o.options, t?.options);
    return out;
  });
}

/** يبدّل أسماء الأوامر وأوصافها للعربي (للتسجيل في Discord). */
export function localizeCommands<T extends { name: string; description?: string; options?: any[] }>(commands: T[]): T[] {
  return commands.map((c) => {
    const t = dict[c.name];
    if (!t) return c;
    return { ...c, name: safeName(t.name, c.name), description: (t.description ?? c.description ?? "").slice(0, 100), options: localizeOptions(c.options, t.options) };
  });
}

function delocalizeOptions(options: any[] | undefined, node: Record<string, OptionL10n> | undefined): any[] | undefined {
  if (!options) return options;
  return options.map((o) => {
    let internal = o.name;
    let t: OptionL10n | undefined;
    if (node) {
      for (const [k, v] of Object.entries(node)) {
        if (safeName(v.name, k) === o.name) {
          internal = k;
          t = v;
          break;
        }
      }
    }
    const out = { ...o, name: internal };
    if (o.options && (o.type === ApplicationCommandOptionType.Subcommand || o.type === ApplicationCommandOptionType.SubcommandGroup)) out.options = delocalizeOptions(o.options, t?.options);
    return out;
  });
}

/** يرجّع الأسماء العربية في التفاعل لأسمائها الداخلية. */
export function delocalizeInteractionData(type: number, data: any): any {
  if (type !== InteractionType.ApplicationCommand && type !== InteractionType.ApplicationCommandAutocomplete) return data;
  if (!data?.name) return data;
  for (const [internal, t] of Object.entries(dict)) {
    if (safeName(t.name, internal) === data.name) return { ...data, name: internal, options: delocalizeOptions(data.options, t.options) };
  }
  return data;
}
