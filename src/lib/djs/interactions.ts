/**
 * التفاعلات بنفس واجهة discord.js (أوامر سلاش، أزرار، قوائم، نوافذ).
 * كلاس واحد يغطي كل الأنواع — دوال isButton() وغيرها تحدد النوع.
 */
import type { Client } from "./client.ts";
import { Collection } from "./collection.ts";
import { ApplicationCommandOptionType, ComponentType, InteractionResponseType, InteractionType, MessageFlags, PermissionsBitField } from "./enums.ts";
import { toJSON } from "./builders.ts";
import { toPayload, type MessageOptions } from "./payload.ts";
import { BaseChannel, GuildMember, Message, Role, User } from "./structures.ts";
import { delocalizeInteractionData } from "./localization.ts";

export class CommandInteractionOptionResolver {
  private sub: string | null = null;
  private group: string | null = null;
  readonly hoisted: any[];
  constructor(private readonly i: Interaction, readonly data: any[]) {
    let opts = data ?? [];
    if (opts[0]?.type === ApplicationCommandOptionType.SubcommandGroup) {
      this.group = opts[0].name;
      opts = opts[0].options ?? [];
    }
    if (opts[0]?.type === ApplicationCommandOptionType.Subcommand) {
      this.sub = opts[0].name;
      opts = opts[0].options ?? [];
    }
    this.hoisted = opts;
  }
  get(name: string, required = false) {
    const o = this.hoisted.find((x) => x.name === name) ?? null;
    if (!o && required) throw new TypeError(`Missing required option "${name}"`);
    return o;
  }
  getSubcommand(required?: true): string;
  getSubcommand(required: boolean): string | null;
  getSubcommand(required = true): string | null {
    if (!this.sub && required) throw new TypeError("No subcommand");
    return this.sub;
  }
  getSubcommandGroup(required = false): string | null {
    if (!this.group && required) throw new TypeError("No subcommand group");
    return this.group;
  }
  private value<T>(name: string, required: boolean): T | null {
    const o = this.get(name, required);
    return o ? (o.value as T) : null;
  }
  getString(name: string, required?: false): string | null;
  getString(name: string, required: true): string;
  getString(name: string, required = false) { return this.value<string>(name, required); }
  getInteger(name: string, required?: false): number | null;
  getInteger(name: string, required: true): number;
  getInteger(name: string, required = false) { return this.value<number>(name, required); }
  getNumber(name: string, required?: false): number | null;
  getNumber(name: string, required: true): number;
  getNumber(name: string, required = false) { return this.value<number>(name, required); }
  getBoolean(name: string, required?: false): boolean | null;
  getBoolean(name: string, required: true): boolean;
  getBoolean(name: string, required = false) { return this.value<boolean>(name, required); }
  getUser(name: string, required?: false): User | null;
  getUser(name: string, required: true): User;
  getUser(name: string, required = false) {
    const id = this.value<string>(name, required);
    return id ? this.i._resolvedUser(id) : null;
  }
  getMember(name: string): GuildMember | null {
    const id = this.value<string>(name, false);
    return id ? this.i._resolvedMember(id) : null;
  }
  getRole(name: string, required?: false): Role | null;
  getRole(name: string, required: true): Role;
  getRole(name: string, required = false) {
    const id = this.value<string>(name, required);
    return id ? this.i._resolvedRole(id) : null;
  }
  getChannel(name: string, required?: false, _types?: number[]): BaseChannel | null;
  getChannel(name: string, required: true, _types?: number[]): BaseChannel;
  getChannel(name: string, required = false) {
    const id = this.value<string>(name, required);
    return id ? this.i._resolvedChannel(id) : null;
  }
  getMentionable(name: string) {
    const id = this.value<string>(name, false);
    if (!id) return null;
    return this.i._resolvedMember(id) ?? this.i._resolvedRole(id) ?? this.i._resolvedUser(id);
  }
  getAttachment(name: string, required = false) {
    const id = this.value<string>(name, required);
    const a = id ? this.i.raw.data?.resolved?.attachments?.[id] : null;
    return a ? { id: a.id, url: a.url, proxyURL: a.proxy_url, name: a.filename, contentType: a.content_type ?? null, size: a.size } : null;
  }
  getFocused(full = false) {
    const f = this.hoisted.find((o) => o.focused);
    return full ? f : f?.value;
  }
}

export class ModalSubmitFields {
  readonly fields = new Collection<string, { customId: string; type: number; value: string; values?: string[] }>();
  constructor(components: any[]) {
    const walk = (list: any[]) => {
      for (const c of list ?? []) {
        if (c.component) walk([c.component]);
        if (c.components) walk(c.components);
        if (c.custom_id) this.fields.set(c.custom_id, { customId: c.custom_id, type: c.type, value: c.value ?? "", values: c.values });
      }
    };
    walk(components);
  }
  getField(id: string) {
    const f = this.fields.get(id);
    if (!f) throw new TypeError(`No field "${id}"`);
    return f;
  }
  getTextInputValue(id: string): string {
    return this.fields.get(id)?.value ?? "";
  }
  getStringSelectValues(id: string): string[] {
    return this.fields.get(id)?.values ?? [];
  }
  getSelectedUsers(id: string) { return this.fields.get(id)?.values ?? []; }
  getSelectedRoles(id: string) { return this.fields.get(id)?.values ?? []; }
  getSelectedChannels(id: string) { return this.fields.get(id)?.values ?? []; }
}

export class Interaction {
  readonly id: string;
  readonly token: string;
  readonly type: number;
  readonly applicationId: string;
  readonly guildId: string | null;
  readonly channelId: string;
  readonly user: User;
  readonly member: GuildMember | null;
  readonly locale: string;
  readonly guildLocale: string | null;
  readonly appPermissions: PermissionsBitField;
  readonly memberPermissions: PermissionsBitField | null;
  readonly createdTimestamp: number;
  readonly commandName: string;
  readonly commandId: string | null;
  readonly commandType: number | null;
  readonly customId: string;
  readonly componentType: number | null;
  readonly values: string[];
  /** رسالة الزر/القائمة (null في أوامر السلاش — مثل discord.js أنواعها مفصولة). */
  readonly message: Message;
  readonly options: CommandInteractionOptionResolver;
  readonly fields: ModalSubmitFields;
  readonly context: number | null;
  replied = false;
  deferred = false;
  ephemeral: boolean | null = null;
  webhook: { id: string };

  constructor(readonly client: Client, readonly raw: any) {
    const d = raw;
    const data = delocalizeInteractionData(d.type, d.data ?? {});
    this.id = d.id;
    this.token = d.token;
    this.type = d.type;
    this.applicationId = d.application_id;
    this.guildId = d.guild_id ?? null;
    this.channelId = d.channel_id ?? d.channel?.id ?? "";
    if (d.channel && d.guild_id) this.guild?.channels._add(d.channel);
    const u = d.member?.user ?? d.user;
    this.user = client.users._add(u);
    this.member = d.member && this.guild ? this.guild.members._add(d.member) : null;
    this.locale = d.locale ?? "en-US";
    this.guildLocale = d.guild_locale ?? null;
    this.appPermissions = new PermissionsBitField(BigInt(d.app_permissions ?? 0));
    this.memberPermissions = d.member?.permissions ? new PermissionsBitField(BigInt(d.member.permissions)) : null;
    this.createdTimestamp = Date.now();
    this.commandName = data.name ?? "";
    this.commandId = data.id ?? null;
    this.commandType = data.type ?? null;
    this.customId = data.custom_id ?? "";
    this.componentType = data.component_type ?? null;
    this.values = data.values ?? [];
    this.message = (d.message ? new Message(client, { ...d.message, guild_id: d.guild_id }) : null) as Message;
    this.options = new CommandInteractionOptionResolver(this, data.options ?? []);
    this.fields = new ModalSubmitFields(data.components ?? []);
    this.context = d.context ?? null;
    this.webhook = { id: this.applicationId };
  }

  get guild() { return this.guildId ? this.client.guilds.cache.get(this.guildId) ?? null : null; }
  get channel(): BaseChannel | null {
    if (!this.channelId) return null;
    return this.client.channels.cache.get(this.channelId) ?? this.client.channels._lite(this.channelId, this.guildId);
  }
  get createdAt() { return new Date(this.createdTimestamp); }

  // ─────────── أنواع ───────────
  isCommand() { return this.type === InteractionType.ApplicationCommand; }
  isChatInputCommand() { return this.type === InteractionType.ApplicationCommand && this.commandType === 1; }
  isContextMenuCommand() { return this.type === InteractionType.ApplicationCommand && this.commandType !== 1; }
  isUserContextMenuCommand() { return this.isCommand() && this.commandType === 2; }
  isMessageContextMenuCommand() { return this.isCommand() && this.commandType === 3; }
  isAutocomplete() { return this.type === InteractionType.ApplicationCommandAutocomplete; }
  isMessageComponent() { return this.type === InteractionType.MessageComponent; }
  isButton() { return this.isMessageComponent() && this.componentType === ComponentType.Button; }
  isStringSelectMenu() { return this.isMessageComponent() && this.componentType === ComponentType.StringSelect; }
  isUserSelectMenu() { return this.isMessageComponent() && this.componentType === ComponentType.UserSelect; }
  isRoleSelectMenu() { return this.isMessageComponent() && this.componentType === ComponentType.RoleSelect; }
  isChannelSelectMenu() { return this.isMessageComponent() && this.componentType === ComponentType.ChannelSelect; }
  isMentionableSelectMenu() { return this.isMessageComponent() && this.componentType === ComponentType.MentionableSelect; }
  isAnySelectMenu() { return this.isMessageComponent() && (this.componentType ?? 0) >= 3 && this.componentType !== ComponentType.TextInput; }
  /** @deprecated */ isSelectMenu() { return this.isStringSelectMenu(); }
  isModalSubmit() { return this.type === InteractionType.ModalSubmit; }
  isFromMessage() { return !!this.message; }
  isRepliable() { return this.type !== InteractionType.Ping && this.type !== InteractionType.ApplicationCommandAutocomplete; }
  inGuild(): this is this & { guildId: string } { return !!this.guildId; }
  inCachedGuild(): this is this & { guildId: string; guild: import("./structures.ts").Guild; member: GuildMember } { return !!this.guild && !!this.member; }
  inRawGuild() { return !!this.guildId && !this.guild; }

  // ─────────── resolved ───────────
  _resolvedUser(id: string): User | null {
    const u = this.raw.data?.resolved?.users?.[id];
    return u ? this.client.users._add(u) : this.client.users.cache.get(id) ?? null;
  }
  _resolvedMember(id: string): GuildMember | null {
    const m = this.raw.data?.resolved?.members?.[id];
    const u = this.raw.data?.resolved?.users?.[id];
    if (m && u && this.guild) return this.guild.members._add({ ...m, user: u });
    return this.guild?.members.cache.get(id) ?? null;
  }
  _resolvedRole(id: string): Role | null {
    const cached = this.guild?.roles.cache.get(id);
    if (cached) return cached;
    const r = this.raw.data?.resolved?.roles?.[id];
    return r && this.guild ? this.guild.roles._add(r) : null;
  }
  _resolvedChannel(id: string): BaseChannel | null {
    const cached = this.client.channels.cache.get(id);
    if (cached) return cached;
    const c = this.raw.data?.resolved?.channels?.[id];
    return c ? this.client.channels._add({ ...c, guild_id: this.guildId }) : null;
  }
  /** الأعضاء المختارين في قائمة أعضاء (UserSelect). */
  get members() {
    const out = new Collection<string, GuildMember>();
    for (const v of this.values) {
      const m = this._resolvedMember(v);
      if (m) out.set(v, m);
    }
    return out;
  }
  get users() {
    const out = new Collection<string, User>();
    for (const v of this.values) {
      const u = this._resolvedUser(v);
      if (u) out.set(v, u);
    }
    return out;
  }
  get roles() {
    const out = new Collection<string, Role>();
    for (const v of this.values) {
      const r = this._resolvedRole(v);
      if (r) out.set(v, r);
    }
    return out;
  }

  // ─────────── الردود ───────────
  private async callback(type: number, data?: any, files?: any) {
    await this.client.rest.post(`/interactions/${this.id}/${this.token}/callback`, {
      body: data === undefined ? { type } : { type, data }, files, auth: false, direct: true, retries: 1,
    });
  }
  private async afterReply(o: MessageOptions | string) {
    const opt = typeof o === "object" ? o : {};
    if (opt.fetchReply || opt.withResponse) {
      const msg = await this.fetchReply();
      return opt.withResponse ? { resource: { message: msg }, interaction: this } : msg;
    }
    return { interaction: this, id: this.id };
  }
  async reply(options: MessageOptions | string): Promise<any> {
    if (this.deferred || this.replied) throw Object.assign(new Error("The reply to this interaction has already been sent or deferred."), { code: "InteractionAlreadyReplied" });
    const { body, files } = toPayload(this.client, options, { interaction: true });
    this.ephemeral = ((body.flags ?? 0) & MessageFlags.Ephemeral) !== 0;
    await this.callback(InteractionResponseType.ChannelMessageWithSource, body, files);
    this.replied = true;
    return this.afterReply(options);
  }
  async deferReply(options: { ephemeral?: boolean; flags?: number; fetchReply?: boolean; withResponse?: boolean } = {}): Promise<any> {
    if (this.deferred || this.replied) throw Object.assign(new Error("The reply to this interaction has already been sent or deferred."), { code: "InteractionAlreadyReplied" });
    let flags = typeof options.flags === "number" ? options.flags : 0;
    if (options.ephemeral) flags |= MessageFlags.Ephemeral;
    this.ephemeral = (flags & MessageFlags.Ephemeral) !== 0;
    await this.callback(InteractionResponseType.DeferredChannelMessageWithSource, { flags });
    this.deferred = true;
    return this.afterReply(options as MessageOptions);
  }
  async editReply(options: MessageOptions | string): Promise<Message> {
    const { body, files } = toPayload(this.client, options, { edit: true });
    const target = typeof options === "object" && options.message ? (typeof options.message === "string" ? options.message : options.message.id) : "@original";
    const d = await this.client.rest.patch(`/webhooks/${this.applicationId}/${this.token}/messages/${target}`, { body, files, auth: false });
    this.replied = true;
    return new Message(this.client, { ...d, guild_id: this.guildId });
  }
  async fetchReply(id = "@original"): Promise<Message> {
    const d = await this.client.rest.get(`/webhooks/${this.applicationId}/${this.token}/messages/${id}`, { auth: false });
    return new Message(this.client, { ...d, guild_id: this.guildId });
  }
  async deleteReply(id: string | Message = "@original") {
    await this.client.rest.delete(`/webhooks/${this.applicationId}/${this.token}/messages/${typeof id === "string" ? id : id.id}`, { auth: false });
  }
  async followUp(options: MessageOptions | string): Promise<Message> {
    const { body, files } = toPayload(this.client, options, { interaction: true });
    const d = await this.client.rest.post(`/webhooks/${this.applicationId}/${this.token}`, { body, files, auth: false, query: { wait: true } });
    return new Message(this.client, { ...d, guild_id: this.guildId });
  }
  async update(options: MessageOptions | string): Promise<any> {
    if (this.deferred || this.replied) {
      await this.editReply(options);
      return this.afterReply(options);
    }
    const { body, files } = toPayload(this.client, options, { edit: true });
    await this.callback(InteractionResponseType.UpdateMessage, body, files);
    this.replied = true;
    return this.afterReply(options);
  }
  async deferUpdate(options: { fetchReply?: boolean; withResponse?: boolean } = {}): Promise<any> {
    if (this.deferred || this.replied) return { interaction: this, id: this.id };
    await this.callback(InteractionResponseType.DeferredMessageUpdate);
    this.deferred = true;
    return this.afterReply(options as MessageOptions);
  }
  async showModal(modal: any) {
    if (this.deferred || this.replied) throw Object.assign(new Error("The reply to this interaction has already been sent or deferred."), { code: "InteractionAlreadyReplied" });
    await this.callback(InteractionResponseType.Modal, toJSON(modal));
    this.replied = true;
  }
  async respond(choices: { name: string; value: string | number }[]) {
    await this.callback(InteractionResponseType.ApplicationCommandAutocompleteResult, { choices: choices.slice(0, 25) });
    this.replied = true;
  }
  toString() { return `/${this.commandName}`; }
}

// أسماء الأنواع حق discord.js — كلها نفس الكلاس
export type BaseInteraction = Interaction;
export type CommandInteraction = Interaction;
export type ChatInputCommandInteraction = Interaction;
export type ButtonInteraction = Interaction;
export type StringSelectMenuInteraction = Interaction;
export type UserSelectMenuInteraction = Interaction;
export type RoleSelectMenuInteraction = Interaction;
export type ChannelSelectMenuInteraction = Interaction;
export type AnySelectMenuInteraction = Interaction;
export type MessageComponentInteraction = Interaction;
export type ModalSubmitInteraction = Interaction;
export type AutocompleteInteraction = Interaction;
export type RepliableInteraction = Interaction;
export type InteractionResponse = { interaction: Interaction; id: string };
export type CacheType = "cached" | "raw" | undefined;
