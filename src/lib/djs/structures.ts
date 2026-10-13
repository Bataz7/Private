/**
 * الكائنات الأساسية بنفس واجهة discord.js (Guild, GuildMember, User, Role, Channel, Message, VoiceState)
 * لكن خفيفة: كل كائن يحمل الحقول اللي نحتاجها بس، والأعضاء في كاش محدود الحجم.
 */
import type { Client } from "./client.ts";
import { Collection, LimitedCollection } from "./collection.ts";
import { ALL_PERMISSIONS, ChannelType, PermissionFlagsBits, PermissionsBitField } from "./enums.ts";
import { toPayload, type MessageOptions } from "./payload.ts";

export const CDN = "https://cdn.discordapp.com";
export type ImageURLOptions = { size?: number; extension?: string; forceStatic?: boolean };

const url = (path: string, hash: string, o: ImageURLOptions = {}) => {
  const animated = hash.startsWith("a_") && !o.forceStatic;
  const ext = o.extension ?? (animated ? "gif" : "png");
  return `${CDN}/${path}/${hash}.${ext === "gif" && !animated ? "png" : ext}${o.size ? `?size=${o.size}` : ""}`;
};
export const snowflakeTime = (id: string) => {
  try {
    return Number((BigInt(id) >> 22n) + 1420070400000n);
  } catch {
    return 0;
  }
};

// ─────────── User ───────────
export class User {
  id: string;
  username: string;
  globalName: string | null;
  discriminator: string;
  avatar: string | null;
  banner: string | null | undefined;
  accentColor: number | null | undefined;
  bot: boolean;
  system: boolean;
  constructor(readonly client: Client, d: any) {
    this.id = d.id;
    this.username = d.username ?? "";
    this.globalName = d.global_name ?? null;
    this.discriminator = d.discriminator ?? "0";
    this.avatar = d.avatar ?? null;
    this.banner = d.banner;
    this.accentColor = d.accent_color;
    this.bot = !!d.bot;
    this.system = !!d.system;
  }
  _patch(d: any) {
    if (d.username !== undefined) this.username = d.username;
    if (d.global_name !== undefined) this.globalName = d.global_name;
    if (d.avatar !== undefined) this.avatar = d.avatar;
    if (d.banner !== undefined) this.banner = d.banner;
    if (d.accent_color !== undefined) this.accentColor = d.accent_color;
    return this;
  }
  get tag() { return this.discriminator && this.discriminator !== "0" ? `${this.username}#${this.discriminator}` : this.username; }
  get displayName() { return this.globalName ?? this.username; }
  get createdTimestamp() { return snowflakeTime(this.id); }
  get createdAt() { return new Date(this.createdTimestamp); }
  get defaultAvatarURL() {
    const index = this.discriminator && this.discriminator !== "0" ? Number(this.discriminator) % 5 : Number((BigInt(this.id) >> 22n) % 6n);
    return `${CDN}/embed/avatars/${index}.png`;
  }
  avatarURL(o: ImageURLOptions = {}) { return this.avatar ? url(`avatars/${this.id}`, this.avatar, o) : null; }
  displayAvatarURL(o: ImageURLOptions = {}) { return this.avatarURL(o) ?? this.defaultAvatarURL; }
  bannerURL(o: ImageURLOptions = {}) { return this.banner ? url(`banners/${this.id}`, this.banner, o) : this.banner === null ? null : undefined; }
  async createDM() { return this.client.channels.createDM(this.id); }
  async send(options: MessageOptions | string) { return (await this.createDM()).send(options); }
  async fetch(_force = true) { return this.client.users.fetch(this.id, { force: true }); }
  toString() { return `<@${this.id}>`; }
}

export class ClientUser extends User {
  setPresence(p: { status?: string; activities?: any[]; afk?: boolean }) {
    this.client._setPresence(p);
    return p;
  }
  setActivity(name: string | any, o: { type?: number; url?: string; state?: string } = {}) {
    const activity = typeof name === "string" ? { name, ...o } : name;
    this.client._setPresence({ activities: activity ? [activity] : [] });
  }
  setStatus(status: string) {
    this.client._setPresence({ status });
  }
}

// ─────────── Role ───────────
export class Role {
  id: string;
  name: string;
  color: number;
  hoist: boolean;
  position: number;
  rawPosition: number;
  permissions: PermissionsBitField;
  managed: boolean;
  mentionable: boolean;
  icon: string | null;
  unicodeEmoji: string | null;
  tags: any;
  constructor(readonly guild: Guild, d: any) {
    this.id = d.id;
    this.name = d.name;
    this.color = d.colors?.primary_color ?? d.color ?? 0;
    this.hoist = !!d.hoist;
    this.position = this.rawPosition = d.position ?? 0;
    this.permissions = new PermissionsBitField(BigInt(d.permissions ?? 0));
    this.managed = !!d.managed;
    this.mentionable = !!d.mentionable;
    this.icon = d.icon ?? null;
    this.unicodeEmoji = d.unicode_emoji ?? null;
    this.tags = d.tags ?? null;
  }
  get client() { return this.guild.client; }
  get hexColor() { return `#${this.color.toString(16).padStart(6, "0")}`; }
  get createdTimestamp() { return snowflakeTime(this.id); }
  /** الأعضاء المحفوظين في الكاش اللي عندهم الرتبة (مثل discord.js: من الكاش فقط). */
  get members() { return this.guild.members.cache.filter((m) => m._roles.includes(this.id)); }
  get editable() {
    const me = this.guild.members.me;
    if (!me || this.managed) return false;
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) return false;
    return me.roles.highest.position > this.position;
  }
  comparePositionTo(role: Role | string) {
    const other = typeof role === "string" ? this.guild.roles.cache.get(role) : role;
    return this.position - (other?.position ?? 0);
  }
  iconURL(o: ImageURLOptions = {}) { return this.icon ? url(`role-icons/${this.id}`, this.icon, o) : null; }
  toString() { return this.id === this.guild.id ? "@everyone" : `<@&${this.id}>`; }
}

// ─────────── Channels ───────────
export class MessageManager {
  constructor(readonly channel: BaseChannel) {}
  get client() { return this.channel.client; }
  fetch(q: string | { message: string }): Promise<Message>;
  fetch(q?: { limit?: number; before?: string; after?: string; around?: string; cache?: boolean }): Promise<Collection<string, Message>>;
  async fetch(q?: string | { message?: string; limit?: number; before?: string; after?: string; around?: string; cache?: boolean }): Promise<any> {
    const id = typeof q === "string" ? q : q?.message;
    if (id) return new Message(this.client, await this.client.rest.get(`/channels/${this.channel.id}/messages/${id}`));
    const list: any[] = await this.client.rest.get(`/channels/${this.channel.id}/messages`, {
      query: { limit: Math.min(100, (q as any)?.limit ?? 50), before: (q as any)?.before, after: (q as any)?.after, around: (q as any)?.around },
    });
    return new Collection(list.map((m) => [m.id, new Message(this.client, m)] as [string, Message]));
  }
  async delete(id: string) {
    await this.client.rest.delete(`/channels/${this.channel.id}/messages/${id}`);
  }
}

export class BaseChannel {
  id: string;
  type: number;
  name: string;
  guildId: string | null;
  parentId: string | null;
  position: number;
  topic: string | null;
  nsfw: boolean;
  permissionOverwrites: { cache: Collection<string, { id: string; type: number; allow: PermissionsBitField; deny: PermissionsBitField }> };
  messages: MessageManager;
  recipientId?: string;
  constructor(readonly client: Client, d: any) {
    this.id = d.id;
    this.type = d.type;
    this.name = d.name ?? "";
    this.guildId = d.guild_id ?? null;
    this.parentId = d.parent_id ?? null;
    this.position = d.position ?? 0;
    this.topic = d.topic ?? null;
    this.nsfw = !!d.nsfw;
    this.recipientId = d.recipients?.[0]?.id;
    this.permissionOverwrites = {
      cache: new Collection((d.permission_overwrites ?? []).map((o: any) => [o.id, { id: o.id, type: o.type, allow: new PermissionsBitField(BigInt(o.allow)), deny: new PermissionsBitField(BigInt(o.deny)) }])),
    };
    this.messages = new MessageManager(this);
  }
  _patch(d: any) {
    const fresh = new BaseChannel(this.client, { ...d, guild_id: d.guild_id ?? this.guildId });
    Object.assign(this, { name: fresh.name, type: fresh.type, parentId: fresh.parentId, position: fresh.position, topic: fresh.topic, nsfw: fresh.nsfw, permissionOverwrites: fresh.permissionOverwrites });
    return this;
  }
  get guild(): Guild | null { return this.guildId ? this.client.guilds.cache.get(this.guildId) ?? null : null; }
  get parent(): BaseChannel | null { return this.parentId ? this.guild?.channels.cache.get(this.parentId) ?? null : null; }
  get createdTimestamp() { return snowflakeTime(this.id); }
  get url() { return `https://discord.com/channels/${this.guildId ?? "@me"}/${this.id}`; }
  isTextBased() { return [ChannelType.GuildText, ChannelType.DM, ChannelType.GuildVoice, ChannelType.GroupDM, ChannelType.GuildAnnouncement, 10, 11, 12, ChannelType.GuildStageVoice].includes(this.type as any); }
  isSendable() { return this.isTextBased(); }
  isThread() { return this.type === 10 || this.type === 11 || this.type === 12; }
  isVoiceBased() { return this.type === ChannelType.GuildVoice || this.type === ChannelType.GuildStageVoice; }
  isDMBased() { return this.type === ChannelType.DM || this.type === ChannelType.GroupDM; }
  isTextChannel() { return this.type === ChannelType.GuildText; }
  /** صلاحيات عضو/رتبة داخل الروم (مع الـ overwrites). */
  permissionsFor(target: GuildMember | Role | string): PermissionsBitField | null {
    const guild = this.guild;
    if (!guild) return null;
    let member: GuildMember | undefined;
    let roles: string[] = [];
    let userId = "";
    if (typeof target === "string") {
      member = guild.members.cache.get(target);
      if (!member) {
        const role = guild.roles.cache.get(target);
        if (!role) return null;
        roles = [role.id];
      }
    } else if (target instanceof Role) roles = [target.id];
    else member = target;
    if (member) {
      roles = member._roles;
      userId = member.id;
      if (guild.ownerId === userId) return new PermissionsBitField(ALL_PERMISSIONS);
    }
    let p = guild.roles.everyone?.permissions.bitfield ?? 0n;
    for (const r of roles) p |= guild.roles.cache.get(r)?.permissions.bitfield ?? 0n;
    if ((p & PermissionFlagsBits.Administrator) === PermissionFlagsBits.Administrator) return new PermissionsBitField(ALL_PERMISSIONS);
    const ow = this.permissionOverwrites.cache;
    const every = ow.get(guild.id);
    if (every) p = (p & ~every.deny.bitfield) | every.allow.bitfield;
    let allow = 0n;
    let deny = 0n;
    for (const o of ow.values()) if (o.type === 0 && roles.includes(o.id)) {
      allow |= o.allow.bitfield;
      deny |= o.deny.bitfield;
    }
    p = (p & ~deny) | allow;
    const mine = userId ? ow.get(userId) : undefined;
    if (mine) p = (p & ~mine.deny.bitfield) | mine.allow.bitfield;
    return new PermissionsBitField(p);
  }
  async send(options: MessageOptions | string): Promise<Message> {
    const { body, files } = toPayload(this.client, options);
    return new Message(this.client, await this.client.rest.post(`/channels/${this.id}/messages`, { body, files }));
  }
  async sendTyping() {
    await this.client.rest.post(`/channels/${this.id}/typing`).catch(() => undefined);
  }
  async bulkDelete(messages: string[] | number) {
    let ids: string[];
    if (typeof messages === "number") {
      const list = await this.messages.fetch({ limit: messages });
      ids = [...list.keys()];
    } else ids = messages;
    if (ids.length === 1) await this.messages.delete(ids[0]!);
    else if (ids.length) await this.client.rest.post(`/channels/${this.id}/messages/bulk-delete`, { body: { messages: ids.slice(0, 100) } });
    return ids;
  }
  async delete(reason?: string) {
    await this.client.rest.delete(`/channels/${this.id}`, { reason });
  }
  async edit(data: any, reason?: string) {
    return this._patch(await this.client.rest.patch(`/channels/${this.id}`, { body: data, reason }));
  }
  async fetch() {
    return this._patch(await this.client.rest.get(`/channels/${this.id}`));
  }
  toString() { return `<#${this.id}>`; }
}
export type GuildChannel = BaseChannel;
export type TextChannel = BaseChannel;
export type TextBasedChannel = BaseChannel;
export type GuildTextBasedChannel = BaseChannel;
export type DMChannel = BaseChannel;
export type VoiceChannel = BaseChannel;
export type NewsChannel = BaseChannel;
export type ThreadChannel = BaseChannel;
export type Channel = BaseChannel;
export type SendableChannels = BaseChannel;

// ─────────── Message ───────────
export class Embed {
  constructor(readonly data: any) {}
  get title() { return this.data.title ?? null; }
  get description() { return this.data.description ?? null; }
  get url() { return this.data.url ?? null; }
  get color() { return this.data.color ?? null; }
  get hexColor() { return this.data.color === undefined ? null : `#${this.data.color.toString(16).padStart(6, "0")}`; }
  get timestamp() { return this.data.timestamp ?? null; }
  get fields() { return this.data.fields ?? []; }
  get footer() { return this.data.footer ? { text: this.data.footer.text, iconURL: this.data.footer.icon_url } : null; }
  get author() { return this.data.author ? { name: this.data.author.name, iconURL: this.data.author.icon_url, url: this.data.author.url } : null; }
  get thumbnail() { return this.data.thumbnail ?? null; }
  get image() { return this.data.image ?? null; }
  toJSON() { return this.data; }
}

/** مكوّن من رسالة (زر/قائمة/صف) — يقبل الوصول بأسلوب discord.js (customId, label…) ويرجع JSON. */
export class MessageComponent {
  constructor(readonly data: any) {}
  get type() { return this.data.type; }
  get customId() { return this.data.custom_id ?? null; }
  get label() { return this.data.label ?? null; }
  get style() { return this.data.style ?? null; }
  get url() { return this.data.url ?? null; }
  get disabled() { return !!this.data.disabled; }
  get emoji() { return this.data.emoji ?? null; }
  get placeholder() { return this.data.placeholder ?? null; }
  get options() { return this.data.options ?? []; }
  get content() { return this.data.content ?? null; }
  get components(): MessageComponent[] { return (this.data.components ?? []).map((c: any) => new MessageComponent(c)); }
  toJSON() { return this.data; }
}

export class Message {
  id: string;
  channelId: string;
  guildId: string | null;
  author: User;
  member: GuildMember | null;
  content: string;
  embeds: Embed[];
  components: MessageComponent[];
  attachments: Collection<string, { id: string; url: string; proxyURL: string; name: string; contentType: string | null; size: number }>;
  flags: { bitfield: number; has: (f: number) => boolean };
  createdTimestamp: number;
  editedTimestamp: number | null;
  pinned: boolean;
  type: number;
  webhookId: string | null;
  reference: { messageId?: string; channelId?: string; guildId?: string } | null;
  interactionMetadata: any;
  constructor(readonly client: Client, d: any) {
    this.id = d.id;
    this.channelId = d.channel_id;
    this.guildId = d.guild_id ?? client.guildOfChannel(d.channel_id) ?? null;
    this.author = d.author ? client.users._add(d.author) : new User(client, { id: "0", username: "unknown" });
    this.member = d.member && this.guildId ? (this.guild?.members._add({ ...d.member, user: d.author }) ?? null) : null;
    this.content = d.content ?? "";
    this.embeds = (d.embeds ?? []).map((e: any) => new Embed(e));
    this.components = (d.components ?? []).map((c: any) => new MessageComponent(c));
    this.attachments = new Collection((d.attachments ?? []).map((a: any) => [a.id, { id: a.id, url: a.url, proxyURL: a.proxy_url, name: a.filename, contentType: a.content_type ?? null, size: a.size }]));
    const bits = d.flags ?? 0;
    this.flags = { bitfield: bits, has: (f: number) => (bits & f) === f };
    this.createdTimestamp = d.timestamp ? Date.parse(d.timestamp) : snowflakeTime(this.id);
    this.editedTimestamp = d.edited_timestamp ? Date.parse(d.edited_timestamp) : null;
    this.pinned = !!d.pinned;
    this.type = d.type ?? 0;
    this.webhookId = d.webhook_id ?? null;
    this.reference = d.message_reference ? { messageId: d.message_reference.message_id, channelId: d.message_reference.channel_id, guildId: d.message_reference.guild_id } : null;
    this.interactionMetadata = d.interaction_metadata ?? null;
  }
  get guild(): Guild | null { return this.guildId ? this.client.guilds.cache.get(this.guildId) ?? null : null; }
  get channel(): BaseChannel { return this.client.channels.cache.get(this.channelId) ?? this.client.channels._lite(this.channelId, this.guildId); }
  get createdAt() { return new Date(this.createdTimestamp); }
  get url() { return `https://discord.com/channels/${this.guildId ?? "@me"}/${this.channelId}/${this.id}`; }
  get system() { return this.type !== 0 && this.type !== 19 && this.type !== 20; }
  async edit(options: MessageOptions | string) {
    const { body, files } = toPayload(this.client, options, { edit: true });
    return new Message(this.client, await this.client.rest.patch(`/channels/${this.channelId}/messages/${this.id}`, { body, files }));
  }
  async reply(options: MessageOptions | string) {
    const o = typeof options === "string" ? { content: options } : options;
    return this.channel.send({ ...o, reply: { messageReference: this.id, failIfNotExists: false } } as MessageOptions);
  }
  async delete() {
    await this.client.rest.delete(`/channels/${this.channelId}/messages/${this.id}`);
    return this;
  }
  async react(emoji: string) {
    const e = /^<a?:(\w+:\d+)>$/.exec(emoji)?.[1] ?? emoji;
    await this.client.rest.put(`/channels/${this.channelId}/messages/${this.id}/reactions/${encodeURIComponent(e)}/@me`);
  }
  async pin() { await this.client.rest.put(`/channels/${this.channelId}/pins/${this.id}`); return this; }
  async unpin() { await this.client.rest.delete(`/channels/${this.channelId}/pins/${this.id}`); return this; }
  async fetch() { return new Message(this.client, await this.client.rest.get(`/channels/${this.channelId}/messages/${this.id}`)); }
  async startThread(o: { name: string; autoArchiveDuration?: number; reason?: string }) {
    const d = await this.client.rest.post(`/channels/${this.channelId}/messages/${this.id}/threads`, { body: { name: o.name.slice(0, 100), auto_archive_duration: o.autoArchiveDuration ?? 1440 }, reason: o.reason });
    return this.client.channels._add(d);
  }
  toString() { return this.content; }
}

// ─────────── Voice ───────────
export class VoiceState {
  id: string;
  channelId: string | null;
  sessionId: string | null;
  selfDeaf: boolean;
  selfMute: boolean;
  serverDeaf: boolean;
  serverMute: boolean;
  streaming: boolean;
  selfVideo: boolean;
  suppress: boolean;
  constructor(readonly guild: Guild, d: any) {
    this.id = d.user_id;
    this.channelId = d.channel_id ?? null;
    this.sessionId = d.session_id ?? null;
    this.selfDeaf = !!d.self_deaf;
    this.selfMute = !!d.self_mute;
    this.serverDeaf = !!d.deaf;
    this.serverMute = !!d.mute;
    this.streaming = !!d.self_stream;
    this.selfVideo = !!d.self_video;
    this.suppress = !!d.suppress;
  }
  get client() { return this.guild.client; }
  get deaf() { return this.selfDeaf || this.serverDeaf; }
  get mute() { return this.selfMute || this.serverMute; }
  get channel() { return this.channelId ? this.guild.channels.cache.get(this.channelId) ?? null : null; }
  get member() { return this.guild.members.cache.get(this.id) ?? null; }
  async disconnect(reason?: string) { await this.guild.members.edit(this.id, { channel_id: null }, reason); }
  async setChannel(channel: string | null, reason?: string) { await this.guild.members.edit(this.id, { channel_id: channel }, reason); }
}

// ─────────── Members ───────────
export class GuildMemberRoleManager {
  constructor(readonly member: GuildMember) {}
  get guild() { return this.member.guild; }
  get cache(): Collection<string, Role> {
    const out = new Collection<string, Role>();
    const everyone = this.guild.roles.everyone;
    if (everyone) out.set(everyone.id, everyone);
    for (const id of this.member._roles) {
      const r = this.guild.roles.cache.get(id);
      if (r) out.set(id, r);
    }
    return out;
  }
  get highest(): Role {
    let best = this.guild.roles.everyone!;
    for (const id of this.member._roles) {
      const r = this.guild.roles.cache.get(id);
      if (r && (!best || r.position > best.position)) best = r;
    }
    return best;
  }
  get hoist() { return this.cache.filter((r) => r.hoist).sort((a, b) => b.position - a.position).first() ?? null; }
  get color() { return this.cache.filter((r) => r.color !== 0).sort((a, b) => b.position - a.position).first() ?? null; }
  private ids(x: any): string[] {
    if (!x) return [];
    if (typeof x === "string") return [x];
    if (x instanceof Role) return [x.id];
    if (x instanceof Collection) return [...x.keys()] as string[];
    if (Array.isArray(x)) return x.flatMap((y) => this.ids(y));
    return [];
  }
  async add(roles: string | Role | (string | Role)[] | Collection<string, Role>, reason?: string) {
    for (const id of this.ids(roles)) {
      await this.member.client.rest.put(`/guilds/${this.guild.id}/members/${this.member.id}/roles/${id}`, { reason });
      if (!this.member._roles.includes(id)) this.member._roles.push(id);
    }
    return this.member;
  }
  async remove(roles: string | Role | (string | Role)[] | Collection<string, Role>, reason?: string) {
    for (const id of this.ids(roles)) {
      await this.member.client.rest.delete(`/guilds/${this.guild.id}/members/${this.member.id}/roles/${id}`, { reason });
      this.member._roles = this.member._roles.filter((r) => r !== id);
    }
    return this.member;
  }
  async set(roles: string[] | Collection<string, Role>, reason?: string) {
    const ids = this.ids(roles);
    await this.guild.members.edit(this.member.id, { roles: ids }, reason);
    this.member._roles = ids;
    return this.member;
  }
}

export class GuildMember {
  id: string;
  user: User;
  nickname: string | null;
  avatar: string | null;
  banner: string | null;
  _roles: string[];
  joinedTimestamp: number | null;
  premiumSinceTimestamp: number | null;
  communicationDisabledUntilTimestamp: number | null;
  pending: boolean;
  constructor(readonly guild: Guild, d: any) {
    this.user = guild.client.users._add(d.user);
    this.id = this.user.id;
    this.nickname = d.nick ?? null;
    this.avatar = d.avatar ?? null;
    this.banner = d.banner ?? null;
    this._roles = d.roles ?? [];
    this.joinedTimestamp = d.joined_at ? Date.parse(d.joined_at) : null;
    this.premiumSinceTimestamp = d.premium_since ? Date.parse(d.premium_since) : null;
    this.communicationDisabledUntilTimestamp = d.communication_disabled_until ? Date.parse(d.communication_disabled_until) : null;
    this.pending = !!d.pending;
  }
  _patch(d: any) {
    if (d.user) this.user._patch(d.user);
    if (d.nick !== undefined) this.nickname = d.nick;
    if (d.avatar !== undefined) this.avatar = d.avatar;
    if (d.roles) this._roles = d.roles;
    if (d.joined_at) this.joinedTimestamp = Date.parse(d.joined_at);
    if (d.communication_disabled_until !== undefined) this.communicationDisabledUntilTimestamp = d.communication_disabled_until ? Date.parse(d.communication_disabled_until) : null;
    return this;
  }
  get client() { return this.guild.client; }
  get displayName() { return this.nickname ?? this.user.globalName ?? this.user.username; }
  get joinedAt() { return this.joinedTimestamp ? new Date(this.joinedTimestamp) : null; }
  get premiumSince() { return this.premiumSinceTimestamp ? new Date(this.premiumSinceTimestamp) : null; }
  get communicationDisabledUntil() { return this.communicationDisabledUntilTimestamp ? new Date(this.communicationDisabledUntilTimestamp) : null; }
  isCommunicationDisabled() { return !!this.communicationDisabledUntilTimestamp && this.communicationDisabledUntilTimestamp > Date.now(); }
  get roles() { return new GuildMemberRoleManager(this); }
  get permissions(): PermissionsBitField {
    if (this.guild.ownerId === this.id) return new PermissionsBitField(ALL_PERMISSIONS);
    let p = this.guild.roles.everyone?.permissions.bitfield ?? 0n;
    for (const id of this._roles) p |= this.guild.roles.cache.get(id)?.permissions.bitfield ?? 0n;
    return new PermissionsBitField((p & PermissionFlagsBits.Administrator) === PermissionFlagsBits.Administrator ? ALL_PERMISSIONS : p);
  }
  get voice(): VoiceState { return this.guild.voiceStates.cache.get(this.id) ?? new VoiceState(this.guild, { user_id: this.id }); }
  get presence() { return null; }
  /** يقدر البوت يعدّل هذا العضو (رتبته أعلى ومو المالك). */
  get manageable() {
    if (this.id === this.guild.ownerId) return false;
    if (this.id === this.client.user?.id) return false;
    const me = this.guild.members.me;
    if (!me) return false;
    if (me.id === this.guild.ownerId) return true;
    return me.roles.highest.position > this.roles.highest.position;
  }
  get kickable() { return this.manageable && !!this.guild.members.me?.permissions.has(PermissionFlagsBits.KickMembers); }
  get bannable() { return this.manageable && !!this.guild.members.me?.permissions.has(PermissionFlagsBits.BanMembers); }
  get moderatable() { return this.manageable && !!this.guild.members.me?.permissions.has(PermissionFlagsBits.ModerateMembers); }
  avatarURL(o: ImageURLOptions = {}) { return this.avatar ? url(`guilds/${this.guild.id}/users/${this.id}/avatars`, this.avatar, o) : null; }
  displayAvatarURL(o: ImageURLOptions = {}) { return this.avatarURL(o) ?? this.user.displayAvatarURL(o); }
  bannerURL(o: ImageURLOptions = {}) { return this.banner ? url(`guilds/${this.guild.id}/users/${this.id}/banners`, this.banner, o) : null; }
  displayBannerURL(o: ImageURLOptions = {}) { return this.bannerURL(o) ?? this.user.bannerURL(o) ?? null; }
  permissionsIn(channel: BaseChannel | string) {
    const ch = typeof channel === "string" ? this.guild.channels.cache.get(channel) : channel;
    return ch?.permissionsFor(this) ?? this.permissions;
  }
  async createDM() { return this.user.createDM(); }
  async send(options: MessageOptions | string) { return this.user.send(options); }
  async fetch(_force = true) { return this.guild.members.fetch({ user: this.id, force: true }); }
  async setNickname(nick: string | null, reason?: string) { await this.guild.members.edit(this.id, { nick }, reason); this.nickname = nick; return this; }
  async kick(reason?: string) { await this.client.rest.delete(`/guilds/${this.guild.id}/members/${this.id}`, { reason }); return this; }
  async ban(o: { reason?: string; deleteMessageSeconds?: number } = {}) { await this.guild.bans.create(this.id, o); return this; }
  async timeout(ms: number | null, reason?: string) {
    await this.guild.members.edit(this.id, { communication_disabled_until: ms ? new Date(Date.now() + ms).toISOString() : null }, reason);
    return this;
  }
  async edit(data: any, reason?: string) { return this.guild.members.edit(this.id, data, reason); }
  toString() { return `<@${this.id}>`; }
}

export class GuildMemberManager {
  cache: LimitedCollection<string, GuildMember>;
  constructor(readonly guild: Guild, size: number) {
    this.cache = new LimitedCollection(size);
  }
  get client() { return this.guild.client; }
  get me(): GuildMember | null {
    const id = this.client.user?.id;
    return id ? this.cache.get(id) ?? this.guild._me ?? null : null;
  }
  _add(d: any): GuildMember {
    const id = d.user?.id;
    const existing = id ? this.cache.get(id) : undefined;
    if (existing) return existing._patch(d);
    const m = new GuildMember(this.guild, d);
    if (m.id === this.client.user?.id) this.guild._me = m;
    else this.cache.set(m.id, m);
    return m;
  }
  async fetchMe() {
    const m = await this.fetch({ user: this.client.user!.id, force: true });
    return m;
  }
  /**
   * fetch(id) → عضو · fetch({ user, force }) → عضو · fetch() → كل الأعضاء (من REST، بدون تخزينهم كلهم في الكاش)
   * fetch({ query, limit }) → بحث بالاسم.
   */
  fetch(q: string): Promise<GuildMember>;
  fetch(q: { user: string; force?: boolean; cache?: boolean }): Promise<GuildMember>;
  fetch(q?: { query?: string; limit?: number; user?: string[] } | undefined): Promise<Collection<string, GuildMember>>;
  async fetch(q?: any): Promise<any> {
    if (typeof q === "string" || (q && typeof q.user === "string")) {
      const id = typeof q === "string" ? q : q.user;
      if (!(q && q.force)) {
        const c = this.cache.get(id) ?? (id === this.client.user?.id ? this.guild._me : undefined);
        if (c) return c;
      }
      const d = await this.client.rest.get(`/guilds/${this.guild.id}/members/${id}`);
      return this._add(d);
    }
    if (q?.query !== undefined) {
      const list: any[] = await this.client.rest.get(`/guilds/${this.guild.id}/members/search`, { query: { query: q.query, limit: q.limit ?? 50 } });
      return new Collection(list.map((d) => [d.user.id, this._add(d)] as [string, GuildMember]));
    }
    if (Array.isArray(q?.user)) {
      const out = new Collection<string, GuildMember>();
      for (const id of q.user) {
        const m = await this.fetch(id).catch(() => null);
        if (m) out.set(id, m);
      }
      return out;
    }
    const out = new Collection<string, GuildMember>();
    for await (const m of this.list()) out.set(m.id, m);
    return out;
  }
  /** كل الأعضاء صفحة صفحة (1000 بكل طلب) — بدون ما ينحفظون في الكاش. */
  async *list(): AsyncGenerator<GuildMember> {
    let after = "0";
    for (;;) {
      const page: any[] = await this.client.rest.get(`/guilds/${this.guild.id}/members`, { query: { limit: 1000, after } });
      for (const d of page) yield this.cache.get(d.user.id)?._patch(d) ?? new GuildMember(this.guild, d);
      if (page.length < 1000) return;
      after = page[page.length - 1].user.id;
    }
  }
  /** أعضاء عندهم رتبة معيّنة (يمشي على كل الأعضاء من REST ويحتفظ بس بالمطابقين). */
  async withRole(roleId: string): Promise<Collection<string, GuildMember>> {
    const out = new Collection<string, GuildMember>();
    for await (const m of this.list()) if (m._roles.includes(roleId)) out.set(m.id, m);
    return out;
  }
  async edit(id: string, data: any, reason?: string) {
    const d = await this.client.rest.patch(`/guilds/${this.guild.id}/members/${id}`, { body: data, reason });
    return d ? this._add(d) : null;
  }
  async kick(id: string, reason?: string) { await this.client.rest.delete(`/guilds/${this.guild.id}/members/${id}`, { reason }); }
  resolve(x: any): GuildMember | null { return typeof x === "string" ? this.cache.get(x) ?? null : x instanceof GuildMember ? x : null; }
}

export class RoleManager {
  cache = new Collection<string, Role>();
  constructor(readonly guild: Guild) {}
  get everyone() { return this.cache.get(this.guild.id) ?? null; }
  get highest() { return this.cache.reduce<Role | null>((a, r) => (!a || r.position > a.position ? r : a), null); }
  _add(d: any) {
    const r = new Role(this.guild, d);
    this.cache.set(r.id, r);
    return r;
  }
  fetch(id: string): Promise<Role | null>;
  fetch(): Promise<Collection<string, Role>>;
  async fetch(id?: string): Promise<any> {
    if (id) {
      const c = this.cache.get(id);
      if (c) return c;
    }
    const list: any[] = await this.guild.client.rest.get(`/guilds/${this.guild.id}/roles`);
    this.cache.clear();
    for (const d of list) this._add(d);
    return id ? this.cache.get(id) ?? null : this.cache;
  }
  resolve(x: any) { return typeof x === "string" ? this.cache.get(x) ?? null : x instanceof Role ? x : null; }
  async create(o: { name?: string; color?: number; permissions?: bigint | string; hoist?: boolean; mentionable?: boolean; reason?: string } = {}) {
    const d = await this.guild.client.rest.post(`/guilds/${this.guild.id}/roles`, {
      body: { name: o.name, color: o.color, permissions: o.permissions !== undefined ? String(o.permissions) : undefined, hoist: o.hoist, mentionable: o.mentionable },
      reason: o.reason,
    });
    return this._add(d);
  }
}

export class GuildChannelManager {
  cache = new Collection<string, BaseChannel>();
  constructor(readonly guild: Guild) {}
  _add(d: any) {
    const existing = this.cache.get(d.id);
    if (existing) return existing._patch(d);
    const c = new BaseChannel(this.guild.client, { ...d, guild_id: this.guild.id });
    this.cache.set(c.id, c);
    this.guild.client._indexChannel(c.id, this.guild.id);
    return c;
  }
  fetch(id: string): Promise<BaseChannel | null>;
  fetch(): Promise<Collection<string, BaseChannel>>;
  async fetch(id?: string): Promise<any> {
    if (id) {
      const c = this.cache.get(id);
      if (c) return c;
      const d = await this.guild.client.rest.get(`/channels/${id}`);
      return d.guild_id === this.guild.id ? this._add(d) : null;
    }
    const list: any[] = await this.guild.client.rest.get(`/guilds/${this.guild.id}/channels`);
    for (const d of list) this._add(d);
    return this.cache;
  }
  resolve(x: any) { return typeof x === "string" ? this.cache.get(x) ?? null : x ?? null; }
  async create(o: { name: string; type?: number; parent?: string; topic?: string; permissionOverwrites?: any[]; reason?: string }) {
    const d = await this.guild.client.rest.post(`/guilds/${this.guild.id}/channels`, {
      body: {
        name: o.name, type: o.type ?? 0, parent_id: o.parent, topic: o.topic,
        permission_overwrites: o.permissionOverwrites?.map((p) => ({ id: p.id, type: p.type ?? 0, allow: String(PermissionsBitField.resolve(p.allow ?? 0n)), deny: String(PermissionsBitField.resolve(p.deny ?? 0n)) })),
      },
      reason: o.reason,
    });
    return this._add(d);
  }
}

export class Guild {
  id: string;
  name: string;
  icon: string | null;
  banner: string | null;
  splash: string | null;
  description: string | null;
  ownerId: string;
  memberCount: number;
  afkChannelId: string | null;
  systemChannelId: string | null;
  preferredLocale: string;
  premiumTier: number;
  joinedTimestamp: number;
  available = true;
  roles: RoleManager;
  channels: GuildChannelManager;
  members: GuildMemberManager;
  voiceStates: { cache: Collection<string, VoiceState> };
  bans: { create: (id: string, o?: { reason?: string; deleteMessageSeconds?: number }) => Promise<void>; remove: (id: string, reason?: string) => Promise<void> };
  _me: GuildMember | null = null;
  constructor(readonly client: Client, d: any) {
    this.id = d.id;
    this.name = d.name;
    this.icon = d.icon ?? null;
    this.banner = d.banner ?? null;
    this.splash = d.splash ?? null;
    this.description = d.description ?? null;
    this.ownerId = d.owner_id;
    this.memberCount = d.member_count ?? d.approximate_member_count ?? 0;
    this.afkChannelId = d.afk_channel_id ?? null;
    this.systemChannelId = d.system_channel_id ?? null;
    this.preferredLocale = d.preferred_locale ?? "en-US";
    this.premiumTier = d.premium_tier ?? 0;
    this.joinedTimestamp = d.joined_at ? Date.parse(d.joined_at) : Date.now();
    this.roles = new RoleManager(this);
    this.channels = new GuildChannelManager(this);
    this.members = new GuildMemberManager(this, client.options.memberCacheSize);
    this.voiceStates = { cache: new Collection() };
    this.bans = {
      create: async (id, o = {}) => { await client.rest.put(`/guilds/${this.id}/bans/${id}`, { body: { delete_message_seconds: o.deleteMessageSeconds ?? 0 }, reason: o.reason }); },
      remove: async (id, reason) => { await client.rest.delete(`/guilds/${this.id}/bans/${id}`, { reason }); },
    };
    for (const r of d.roles ?? []) this.roles._add(r);
    for (const c of d.channels ?? []) this.channels._add(c);
    for (const c of d.threads ?? []) this.channels._add(c);
    for (const v of d.voice_states ?? []) if (v.channel_id) this.voiceStates.cache.set(v.user_id, new VoiceState(this, v));
    for (const m of d.members ?? []) if (m.user) this.members._add(m);
  }
  _patch(d: any) {
    if (d.name !== undefined) this.name = d.name;
    if (d.icon !== undefined) this.icon = d.icon;
    if (d.banner !== undefined) this.banner = d.banner;
    if (d.owner_id !== undefined) this.ownerId = d.owner_id;
    if (d.description !== undefined) this.description = d.description;
    if (d.afk_channel_id !== undefined) this.afkChannelId = d.afk_channel_id;
    if (d.member_count !== undefined) this.memberCount = d.member_count;
    return this;
  }
  get createdTimestamp() { return snowflakeTime(this.id); }
  get createdAt() { return new Date(this.createdTimestamp); }
  get joinedAt() { return new Date(this.joinedTimestamp); }
  iconURL(o: ImageURLOptions = {}) { return this.icon ? url(`icons/${this.id}`, this.icon, o) : null; }
  bannerURL(o: ImageURLOptions = {}) { return this.banner ? url(`banners/${this.id}`, this.banner, o) : null; }
  async fetchOwner() { return this.members.fetch(this.ownerId); }
  async fetch() { return this._patch(await this.client.rest.get(`/guilds/${this.id}`, { query: { with_counts: true } })); }
  async leave() { await this.client.rest.delete(`/users/@me/guilds/${this.id}`); }
  toString() { return this.name; }
}
