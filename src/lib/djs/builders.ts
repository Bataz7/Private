/**
 * Builders بنفس واجهة discord.js — كلها تطلع JSON جاهز لـ Discord عبر toJSON().
 * خفيفة: كائن بيانات واحد بدون تحقق ثقيل.
 */
import { ApplicationCommandOptionType, ButtonStyle, ComponentType, PermissionsBitField, type PermissionResolvable } from "./enums.ts";

type Json = Record<string, any>;
const NAMED_COLORS: Record<string, number> = {
  Default: 0, White: 0xffffff, Aqua: 0x1abc9c, Green: 0x57f287, Blue: 0x3498db, Yellow: 0xfee75c, Purple: 0x9b59b6,
  LuminousVividPink: 0xe91e63, Fuchsia: 0xeb459e, Gold: 0xf1c40f, Orange: 0xe67e22, Red: 0xed4245, Grey: 0x95a5a6,
  Navy: 0x34495e, DarkAqua: 0x11806a, DarkGreen: 0x1f8b4c, DarkBlue: 0x206694, DarkPurple: 0x71368a,
  DarkVividPink: 0xad1457, DarkGold: 0xc27c0e, DarkOrange: 0xa84300, DarkRed: 0x992d22, DarkGrey: 0x979c9f,
  DarkerGrey: 0x7f8c8d, LightGrey: 0xbcc0c0, DarkNavy: 0x2c3e50, Blurple: 0x5865f2, Greyple: 0x99aab5,
  DarkButNotBlack: 0x2c2f33, NotQuiteBlack: 0x23272a,
};
export type ColorResolvable = number | string | [number, number, number] | null;

export function resolveColor(color: ColorResolvable | undefined): number | undefined {
  if (color === null || color === undefined) return undefined;
  if (typeof color === "number") return color;
  if (Array.isArray(color)) return (color[0] << 16) + (color[1] << 8) + color[2];
  if (color === "Random") return Math.floor(Math.random() * 0xffffff);
  if (color in NAMED_COLORS) return NAMED_COLORS[color];
  const hex = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(color.trim());
  if (hex) {
    const h = hex[1]!.length === 3 ? hex[1]!.split("").map((c) => c + c).join("") : hex[1]!;
    return Number.parseInt(h, 16);
  }
  return undefined;
}

export type EmojiResolvable = string | { id?: string | null; name?: string | null; animated?: boolean };
export function resolveEmoji(e: EmojiResolvable | undefined | null): Json | undefined {
  if (!e) return undefined;
  if (typeof e === "object") return { id: e.id ?? undefined, name: e.name ?? undefined, animated: e.animated || undefined };
  const t = e.trim();
  const m = /^<(a)?:(\w+):(\d+)>$/.exec(t);
  if (m) return { id: m[3], name: m[2], animated: !!m[1] };
  if (/^\d{15,22}$/.test(t)) return { id: t };
  return t ? { name: t } : undefined;
}

/** يحوّل أي builder أو كائن JSON لـ JSON. */
export function toJSON(x: any): any {
  if (x && typeof x.toJSON === "function") return x.toJSON();
  return x;
}

// ─────────── Embed ───────────
export interface APIEmbedField { name: string; value: string; inline?: boolean }
export class EmbedBuilder {
  data: Json;
  constructor(data: Json = {}) {
    this.data = { ...data, fields: data.fields ? [...data.fields] : undefined };
  }
  static from(other: any): EmbedBuilder {
    return new EmbedBuilder(other?.data ?? toJSON(other) ?? {});
  }
  setTitle(title: string | null) { this.data.title = title ?? undefined; return this; }
  setDescription(description: string | null) { this.data.description = description ?? undefined; return this; }
  setURL(url: string | null) { this.data.url = url ?? undefined; return this; }
  setColor(color: ColorResolvable) { this.data.color = resolveColor(color); return this; }
  setTimestamp(ts: Date | number | null = Date.now()) {
    this.data.timestamp = ts === null ? undefined : new Date(ts).toISOString();
    return this;
  }
  setFooter(footer: { text: string; iconURL?: string | null; icon_url?: string } | null) {
    this.data.footer = footer ? { text: footer.text, icon_url: footer.iconURL ?? footer.icon_url ?? undefined } : undefined;
    return this;
  }
  setAuthor(author: { name: string; iconURL?: string | null; url?: string | null; icon_url?: string } | null) {
    this.data.author = author ? { name: author.name, icon_url: author.iconURL ?? author.icon_url ?? undefined, url: author.url ?? undefined } : undefined;
    return this;
  }
  setThumbnail(url: string | null) { this.data.thumbnail = url ? { url } : undefined; return this; }
  setImage(url: string | null) { this.data.image = url ? { url } : undefined; return this; }
  addFields(...fields: (APIEmbedField | APIEmbedField[])[]) {
    this.data.fields = [...(this.data.fields ?? []), ...fields.flat()];
    return this;
  }
  setFields(...fields: (APIEmbedField | APIEmbedField[])[]) {
    this.data.fields = fields.flat();
    return this;
  }
  spliceFields(index: number, deleteCount: number, ...fields: APIEmbedField[]) {
    const f = [...(this.data.fields ?? [])];
    f.splice(index, deleteCount, ...fields);
    this.data.fields = f;
    return this;
  }
  toJSON(): Json {
    const out: Json = {};
    for (const [k, v] of Object.entries(this.data)) if (v !== undefined && v !== null) out[k] = v;
    if (out.fields) out.fields = out.fields.map((f: APIEmbedField) => ({ name: String(f.name), value: String(f.value), inline: f.inline ?? false }));
    return out;
  }
}
export type APIEmbed = Json;

// ─────────── Components ───────────
export class ButtonBuilder {
  data: Json;
  constructor(data: Json = {}) {
    this.data = { type: ComponentType.Button, ...data };
  }
  static from(other: any) { return new ButtonBuilder(other?.data ?? toJSON(other)); }
  setCustomId(id: string) { this.data.custom_id = id; return this; }
  setLabel(label: string) { this.data.label = label; return this; }
  setStyle(style: ButtonStyle | number) { this.data.style = style; return this; }
  setEmoji(emoji: EmojiResolvable) { this.data.emoji = resolveEmoji(emoji); return this; }
  setURL(url: string) { this.data.url = url; return this; }
  setDisabled(disabled = true) { this.data.disabled = disabled; return this; }
  setSKUId(sku: string) { this.data.sku_id = sku; return this; }
  toJSON(): Json {
    const d = { ...this.data };
    if (d.style === ButtonStyle.Link) delete d.custom_id;
    for (const k of Object.keys(d)) if (d[k] === undefined) delete d[k];
    return d;
  }
}

export class StringSelectMenuOptionBuilder {
  data: Json;
  constructor(data: Json = {}) { this.data = { ...data }; }
  setLabel(label: string) { this.data.label = label; return this; }
  setValue(value: string) { this.data.value = value; return this; }
  setDescription(description: string) { this.data.description = description; return this; }
  setEmoji(emoji: EmojiResolvable) { this.data.emoji = resolveEmoji(emoji); return this; }
  setDefault(isDefault = true) { this.data.default = isDefault; return this; }
  toJSON(): Json {
    const d = { ...this.data };
    for (const k of Object.keys(d)) if (d[k] === undefined) delete d[k];
    return d;
  }
}

type SelectOption = StringSelectMenuOptionBuilder | Json;
export class StringSelectMenuBuilder {
  data: Json;
  options: StringSelectMenuOptionBuilder[];
  constructor(data: Json = {}) {
    const { options, ...rest } = data;
    this.data = { type: ComponentType.StringSelect, ...rest };
    this.options = (options ?? []).map((o: SelectOption) => (o instanceof StringSelectMenuOptionBuilder ? o : new StringSelectMenuOptionBuilder(toJSON(o))));
  }
  static from(other: any) { return new StringSelectMenuBuilder(other?.data ? { ...other.data, options: other.options } : toJSON(other)); }
  setCustomId(id: string) { this.data.custom_id = id; return this; }
  setPlaceholder(p: string) { this.data.placeholder = p; return this; }
  setMinValues(n: number) { this.data.min_values = n; return this; }
  setMaxValues(n: number) { this.data.max_values = n; return this; }
  setDisabled(d = true) { this.data.disabled = d; return this; }
  setRequired(r = true) { this.data.required = r; return this; }
  addOptions(...opts: (SelectOption | SelectOption[])[]) {
    for (const o of opts.flat()) this.options.push(o instanceof StringSelectMenuOptionBuilder ? o : new StringSelectMenuOptionBuilder(toJSON(o)));
    return this;
  }
  setOptions(...opts: (SelectOption | SelectOption[])[]) {
    this.options = [];
    return this.addOptions(...opts);
  }
  spliceOptions(index: number, deleteCount: number, ...opts: SelectOption[]) {
    this.options.splice(index, deleteCount, ...opts.map((o) => (o instanceof StringSelectMenuOptionBuilder ? o : new StringSelectMenuOptionBuilder(toJSON(o)))));
    return this;
  }
  toJSON(): Json {
    const d: Json = { ...this.data, options: this.options.map((o) => o.toJSON()) };
    for (const k of Object.keys(d)) if (d[k] === undefined) delete d[k];
    return d;
  }
}

class SelectBase {
  data: Json;
  constructor(type: number, data: Json = {}) { this.data = { type, ...data }; }
  setCustomId(id: string) { this.data.custom_id = id; return this; }
  setPlaceholder(p: string) { this.data.placeholder = p; return this; }
  setMinValues(n: number) { this.data.min_values = n; return this; }
  setMaxValues(n: number) { this.data.max_values = n; return this; }
  setDisabled(d = true) { this.data.disabled = d; return this; }
  toJSON(): Json { return { ...this.data }; }
}
export class UserSelectMenuBuilder extends SelectBase { constructor(d: Json = {}) { super(ComponentType.UserSelect, d); } }
export class RoleSelectMenuBuilder extends SelectBase { constructor(d: Json = {}) { super(ComponentType.RoleSelect, d); } }
export class ChannelSelectMenuBuilder extends SelectBase {
  constructor(d: Json = {}) { super(ComponentType.ChannelSelect, d); }
  addChannelTypes(...types: number[]) { this.data.channel_types = [...(this.data.channel_types ?? []), ...types.flat()]; return this; }
  setChannelTypes(...types: number[]) { this.data.channel_types = types.flat(); return this; }
}

export class TextInputBuilder {
  data: Json;
  constructor(data: Json = {}) { this.data = { type: ComponentType.TextInput, ...data }; }
  setCustomId(id: string) { this.data.custom_id = id; return this; }
  setLabel(label: string) { this.data.label = label; return this; }
  setStyle(style: number) { this.data.style = style; return this; }
  setPlaceholder(p: string) { this.data.placeholder = p; return this; }
  setRequired(r = true) { this.data.required = r; return this; }
  setValue(v: string) { this.data.value = v; return this; }
  setMinLength(n: number) { this.data.min_length = n; return this; }
  setMaxLength(n: number) { this.data.max_length = n; return this; }
  toJSON(): Json {
    const d = { ...this.data };
    if (!d.style) d.style = 1;
    for (const k of Object.keys(d)) if (d[k] === undefined) delete d[k];
    return d;
  }
}

/** مكوّن Label (للنوافذ الحديثة): عنوان + وصف + حقل نص أو قائمة. */
export class LabelBuilder {
  data: Json = { type: ComponentType.Label };
  setLabel(label: string) { this.data.label = label; return this; }
  setDescription(d: string) { this.data.description = d; return this; }
  private comp(c: any, Ctor: any) { return typeof c === "function" ? c(new Ctor()) : c; }
  setTextInputComponent(c: TextInputBuilder | ((b: TextInputBuilder) => TextInputBuilder)) { this.data.component = this.comp(c, TextInputBuilder); return this; }
  setStringSelectMenuComponent(c: StringSelectMenuBuilder | ((b: StringSelectMenuBuilder) => StringSelectMenuBuilder)) { this.data.component = this.comp(c, StringSelectMenuBuilder); return this; }
  setUserSelectMenuComponent(c: any) { this.data.component = this.comp(c, UserSelectMenuBuilder); return this; }
  setRoleSelectMenuComponent(c: any) { this.data.component = this.comp(c, RoleSelectMenuBuilder); return this; }
  setChannelSelectMenuComponent(c: any) { this.data.component = this.comp(c, ChannelSelectMenuBuilder); return this; }
  toJSON(): Json {
    const c = toJSON(this.data.component);
    if (c && c.type === ComponentType.TextInput) delete c.label;
    return { ...this.data, component: c };
  }
}

export class ActionRowBuilder<T = any> {
  data: Json = { type: ComponentType.ActionRow };
  components: T[];
  constructor(data: { components?: any[] } & Json = {}) {
    const { components, ...rest } = data;
    this.data = { type: ComponentType.ActionRow, ...rest };
    this.components = (components ?? []) as T[];
  }
  static from(other: any) { return new ActionRowBuilder({ components: (other?.components ?? []).map((c: any) => toJSON(c)) }); }
  addComponents(...components: (T | T[])[]) {
    this.components.push(...(components.flat() as T[]));
    return this;
  }
  setComponents(...components: (T | T[])[]) {
    this.components = components.flat() as T[];
    return this;
  }
  toJSON(): Json {
    return { ...this.data, components: this.components.map(toJSON) };
  }
}

export class ModalBuilder {
  data: Json = {};
  components: any[] = [];
  constructor(data: Json = {}) {
    const { components, ...rest } = data;
    this.data = { ...rest };
    if (components) this.components = [...components];
  }
  setCustomId(id: string) { this.data.custom_id = id; return this; }
  setTitle(title: string) { this.data.title = title; return this; }
  addComponents(...rows: any[]) { this.components.push(...rows.flat()); return this; }
  setComponents(...rows: any[]) { this.components = rows.flat(); return this; }
  addLabelComponents(...labels: any[]) {
    for (const l of labels.flat()) this.components.push(typeof l === "function" ? l(new LabelBuilder()) : l);
    return this;
  }
  addTextDisplayComponents(...texts: any[]) {
    for (const t of texts.flat()) this.components.push(typeof t === "string" ? { type: ComponentType.TextDisplay, content: t } : t);
    return this;
  }
  toJSON(): Json {
    return { ...this.data, components: this.components.map(toJSON) };
  }
}

export class AttachmentBuilder {
  attachment: Uint8Array | string;
  name: string;
  description?: string;
  constructor(attachment: Uint8Array | ArrayBuffer | string, data: { name?: string; description?: string } = {}) {
    this.attachment = attachment instanceof ArrayBuffer ? new Uint8Array(attachment) : attachment;
    this.name = data.name ?? "file.bin";
    this.description = data.description;
  }
  setName(name: string) { this.name = name; return this; }
  setDescription(d: string) { this.description = d; return this; }
  setFile(attachment: Uint8Array | string, name?: string) {
    this.attachment = attachment;
    if (name) this.name = name;
    return this;
  }
}

// ─────────── Slash commands ───────────
class OptionBuilder {
  data: Json;
  constructor(type: number) { this.data = { type, required: false }; }
  setName(name: string) { this.data.name = name; return this; }
  setDescription(d: string) { this.data.description = d; return this; }
  setRequired(r = true) { this.data.required = r; return this; }
  setNameLocalizations(l: Json) { this.data.name_localizations = l; return this; }
  setDescriptionLocalizations(l: Json) { this.data.description_localizations = l; return this; }
  toJSON(): Json {
    const d = { ...this.data };
    for (const k of Object.keys(d)) if (d[k] === undefined) delete d[k];
    return d;
  }
}
class ChoiceOption extends OptionBuilder {
  addChoices(...choices: ({ name: string; value: string | number } | { name: string; value: string | number }[])[]) {
    this.data.choices = [...(this.data.choices ?? []), ...choices.flat()];
    return this;
  }
  setChoices(...choices: ({ name: string; value: string | number } | { name: string; value: string | number }[])[]) {
    this.data.choices = choices.flat();
    return this;
  }
  setAutocomplete(a = true) { this.data.autocomplete = a; return this; }
}
export class SlashCommandStringOption extends ChoiceOption {
  constructor() { super(ApplicationCommandOptionType.String); }
  setMinLength(n: number) { this.data.min_length = n; return this; }
  setMaxLength(n: number) { this.data.max_length = n; return this; }
}
export class SlashCommandIntegerOption extends ChoiceOption {
  constructor() { super(ApplicationCommandOptionType.Integer); }
  setMinValue(n: number) { this.data.min_value = n; return this; }
  setMaxValue(n: number) { this.data.max_value = n; return this; }
}
export class SlashCommandNumberOption extends SlashCommandIntegerOption {
  constructor() { super(); this.data.type = ApplicationCommandOptionType.Number; }
}
export class SlashCommandBooleanOption extends OptionBuilder { constructor() { super(ApplicationCommandOptionType.Boolean); } }
export class SlashCommandUserOption extends OptionBuilder { constructor() { super(ApplicationCommandOptionType.User); } }
export class SlashCommandRoleOption extends OptionBuilder { constructor() { super(ApplicationCommandOptionType.Role); } }
export class SlashCommandMentionableOption extends OptionBuilder { constructor() { super(ApplicationCommandOptionType.Mentionable); } }
export class SlashCommandAttachmentOption extends OptionBuilder { constructor() { super(ApplicationCommandOptionType.Attachment); } }
export class SlashCommandChannelOption extends OptionBuilder {
  constructor() { super(ApplicationCommandOptionType.Channel); }
  addChannelTypes(...types: (number | number[])[]) { this.data.channel_types = [...(this.data.channel_types ?? []), ...types.flat()]; return this; }
}

type Fn<T> = T | ((b: T) => T);
const build = <T>(x: Fn<T>, Ctor: new () => T): T => (typeof x === "function" ? (x as (b: T) => T)(new Ctor()) : x);

class OptionsHolder {
  options: OptionBuilder[] = [];
  addStringOption(f: Fn<SlashCommandStringOption>) { this.options.push(build(f, SlashCommandStringOption)); return this; }
  addIntegerOption(f: Fn<SlashCommandIntegerOption>) { this.options.push(build(f, SlashCommandIntegerOption)); return this; }
  addNumberOption(f: Fn<SlashCommandNumberOption>) { this.options.push(build(f, SlashCommandNumberOption)); return this; }
  addBooleanOption(f: Fn<SlashCommandBooleanOption>) { this.options.push(build(f, SlashCommandBooleanOption)); return this; }
  addUserOption(f: Fn<SlashCommandUserOption>) { this.options.push(build(f, SlashCommandUserOption)); return this; }
  addRoleOption(f: Fn<SlashCommandRoleOption>) { this.options.push(build(f, SlashCommandRoleOption)); return this; }
  addChannelOption(f: Fn<SlashCommandChannelOption>) { this.options.push(build(f, SlashCommandChannelOption)); return this; }
  addMentionableOption(f: Fn<SlashCommandMentionableOption>) { this.options.push(build(f, SlashCommandMentionableOption)); return this; }
  addAttachmentOption(f: Fn<SlashCommandAttachmentOption>) { this.options.push(build(f, SlashCommandAttachmentOption)); return this; }
}
const sortRequired = (opts: Json[]) => [...opts.filter((o) => o.required), ...opts.filter((o) => !o.required)];

export class SlashCommandSubcommandBuilder extends OptionsHolder {
  data: Json = { type: ApplicationCommandOptionType.Subcommand };
  setName(name: string) { this.data.name = name; return this; }
  setDescription(d: string) { this.data.description = d; return this; }
  toJSON(): Json { return { ...this.data, options: sortRequired(this.options.map((o) => o.toJSON())) }; }
}
export class SlashCommandSubcommandGroupBuilder {
  data: Json = { type: ApplicationCommandOptionType.SubcommandGroup };
  options: SlashCommandSubcommandBuilder[] = [];
  setName(name: string) { this.data.name = name; return this; }
  setDescription(d: string) { this.data.description = d; return this; }
  addSubcommand(f: Fn<SlashCommandSubcommandBuilder>) { this.options.push(build(f, SlashCommandSubcommandBuilder)); return this; }
  toJSON(): Json { return { ...this.data, options: this.options.map((o) => o.toJSON()) }; }
}

export class SlashCommandBuilder extends OptionsHolder {
  data: Json = { type: 1 };
  private subs: (SlashCommandSubcommandBuilder | SlashCommandSubcommandGroupBuilder)[] = [];
  get name(): string { return this.data.name; }
  get description(): string { return this.data.description; }
  setName(name: string) { this.data.name = name; return this; }
  setDescription(d: string) { this.data.description = d; return this; }
  setNameLocalizations(l: Json) { this.data.name_localizations = l; return this; }
  setDescriptionLocalizations(l: Json) { this.data.description_localizations = l; return this; }
  setDefaultMemberPermissions(p: PermissionResolvable | null | undefined) {
    this.data.default_member_permissions = p === null || p === undefined ? null : String(PermissionsBitField.resolve(p));
    return this;
  }
  setDMPermission(allowed: boolean | null) {
    if (allowed === false) this.data.contexts = [0];
    return this;
  }
  setContexts(...contexts: (number | number[])[]) { this.data.contexts = contexts.flat(); return this; }
  setIntegrationTypes(...types: (number | number[])[]) { this.data.integration_types = types.flat(); return this; }
  setNSFW(n = true) { this.data.nsfw = n; return this; }
  addSubcommand(f: Fn<SlashCommandSubcommandBuilder>) { this.subs.push(build(f, SlashCommandSubcommandBuilder)); return this; }
  addSubcommandGroup(f: Fn<SlashCommandSubcommandGroupBuilder>) { this.subs.push(build(f, SlashCommandSubcommandGroupBuilder)); return this; }
  toJSON(): Json {
    const options = this.subs.length ? this.subs.map((s) => s.toJSON()) : sortRequired(this.options.map((o) => o.toJSON()));
    return { ...this.data, options };
  }
}
export type RESTPostAPIChatInputApplicationCommandsJSONBody = Json;
