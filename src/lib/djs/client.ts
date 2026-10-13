/**
 * Client بنفس واجهة discord.js لكن خفيف جداً: اتصال Gateway وREST بدون مكتبات، كاش أعضاء محدود،
 * ورسائل ما تنحفظ. الأحداث بنفس الأسماء: clientReady, interactionCreate, messageCreate, voiceStateUpdate…
 */
import { readFileSync } from "node:fs";
import { Gateway } from "../discord/gateway.ts";
import { REST } from "../discord/rest.ts";
import { log } from "../log.ts";
import { Collection, LimitedCollection } from "./collection.ts";
import { Events } from "./enums.ts";
import { Interaction } from "./interactions.ts";
import { localizeCommands } from "./localization.ts";
import { BaseChannel, ClientUser, Guild, GuildMember, Message, User, VoiceState } from "./structures.ts";

type Listener = (...args: any[]) => unknown;

export interface ClientOptions {
  intents: number | number[];
  partials?: unknown[];
  allowedMentions?: { parse?: string[]; users?: string[]; roles?: string[]; repliedUser?: boolean } | null;
  /** حجم كاش الأعضاء لكل سيرفر (الافتراضي من MEMBER_CACHE أو 400). */
  memberCacheSize?: number;
  presence?: { status?: string; activities?: any[]; afk?: boolean };
  /** بدون اتصال Gateway (REST فقط) — للوحة التحكم. */
  restOnly?: boolean;
}

class Emitter {
  private listeners = new Map<string, Listener[]>();
  on(event: string, fn: Listener) {
    const l = this.listeners.get(event);
    if (l) l.push(fn);
    else this.listeners.set(event, [fn]);
    return this;
  }
  once(event: string, fn: Listener) {
    const wrap: Listener = (...a) => {
      this.off(event, wrap);
      return fn(...a);
    };
    return this.on(event, wrap);
  }
  off(event: string, fn: Listener) {
    const l = this.listeners.get(event);
    if (l) this.listeners.set(event, l.filter((x) => x !== fn));
    return this;
  }
  removeListener(event: string, fn: Listener) {
    return this.off(event, fn);
  }
  removeAllListeners(event?: string) {
    if (event) this.listeners.delete(event);
    else this.listeners.clear();
    return this;
  }
  listenerCount(event: string) {
    return this.listeners.get(event)?.length ?? 0;
  }
  emit(event: string, ...args: unknown[]) {
    const l = this.listeners.get(event);
    if (!l?.length) return false;
    for (const fn of [...l]) {
      try {
        const r = fn(...args);
        if (r instanceof Promise) r.catch((e) => (event === "error" ? log.err("client", e) : this.emit("error", e)));
      } catch (e) {
        if (event === "error") log.err("client", e);
        else this.emit("error", e);
      }
    }
    return true;
  }
}

export class GuildManager {
  cache = new Collection<string, Guild>();
  constructor(readonly client: Client) {}
  async fetch(id?: string | { force?: boolean }): Promise<any> {
    if (typeof id === "string") {
      const g = this.cache.get(id);
      if (g) return g;
      const d = await this.client.rest.get(`/guilds/${id}`, { query: { with_counts: true } });
      const guild = new Guild(this.client, d);
      return guild;
    }
    return this.cache;
  }
  resolve(x: any) {
    return typeof x === "string" ? this.cache.get(x) ?? null : x ?? null;
  }
}

export class UserManager {
  cache: LimitedCollection<string, User>;
  constructor(readonly client: Client) {
    this.cache = new LimitedCollection(Number(process.env.USER_CACHE) || 500);
  }
  _add(d: any): User {
    if (!d?.id) return new User(this.client, { id: "0", username: "unknown" });
    if (this.client.user && d.id === this.client.user.id) return this.client.user._patch(d);
    const u = this.cache.get(d.id);
    if (u) return u._patch(d);
    const nu = new User(this.client, d);
    this.cache.set(nu.id, nu);
    return nu;
  }
  async fetch(id: string, o: { force?: boolean; cache?: boolean } = {}): Promise<User> {
    if (!o.force) {
      const u = this.cache.get(id) ?? (id === this.client.user?.id ? this.client.user : undefined);
      if (u) return u;
    }
    return this._add(await this.client.rest.get(`/users/${id}`));
  }
  resolve(x: any) {
    return typeof x === "string" ? this.cache.get(x) ?? null : x ?? null;
  }
  async send(id: string, options: any) {
    return (await this.fetch(id)).send(options);
  }
}

export class ChannelManager {
  /** رومات الخاص (محدودة) — رومات السيرفرات داخل كل Guild. */
  private dms = new LimitedCollection<string, BaseChannel>(300);
  private dmByUser = new LimitedCollection<string, string>(300);
  constructor(readonly client: Client) {}
  get cache(): { get: (id: string) => BaseChannel | undefined; has: (id: string) => boolean } {
    return {
      get: (id: string) => {
        const gid = this.client.guildOfChannel(id);
        return (gid ? this.client.guilds.cache.get(gid)?.channels.cache.get(id) : undefined) ?? this.dms.get(id);
      },
      has: (id: string) => !!this.cache.get(id),
    };
  }
  _add(d: any): BaseChannel {
    const gid = d.guild_id;
    const guild = gid ? this.client.guilds.cache.get(gid) : undefined;
    if (guild) return guild.channels._add(d);
    const c = new BaseChannel(this.client, d);
    this.dms.set(c.id, c);
    if (c.recipientId) this.dmByUser.set(c.recipientId, c.id);
    return c;
  }
  /** روم بدون بيانات (نعرف الآيدي بس) — يكفي للإرسال. */
  _lite(id: string, guildId: string | null): BaseChannel {
    return new BaseChannel(this.client, { id, type: guildId ? 0 : 1, guild_id: guildId });
  }
  async fetch(id: string, _o: { force?: boolean } = {}): Promise<BaseChannel | null> {
    const c = this.cache.get(id);
    if (c && !_o.force) return c;
    const d = await this.client.rest.get(`/channels/${id}`);
    return this._add(d);
  }
  async createDM(userId: string): Promise<BaseChannel> {
    const cached = this.dmByUser.get(userId);
    if (cached) {
      const c = this.dms.get(cached);
      if (c) return c;
    }
    const d = await this.client.rest.post("/users/@me/channels", { body: { recipient_id: userId } });
    return this._add(d);
  }
}

export class ApplicationCommandManager {
  constructor(readonly client: Client) {}
  /** يسجّل الأوامر (بأسمائها العربية من القاموس). */
  async set(commands: any[], guildId?: string) {
    const body = localizeCommands(commands.map((c) => (typeof c?.toJSON === "function" ? c.toJSON() : c)));
    const path = guildId ? `/applications/${this.client.application!.id}/guilds/${guildId}/commands` : `/applications/${this.client.application!.id}/commands`;
    const list: any[] = await this.client.rest.put(path, { body });
    return new Collection(list.map((c) => [c.id, c] as [string, any]));
  }
  async fetch(o: { guildId?: string } = {}) {
    const path = o.guildId ? `/applications/${this.client.application!.id}/guilds/${o.guildId}/commands` : `/applications/${this.client.application!.id}/commands`;
    const list: any[] = await this.client.rest.get(path);
    return new Collection(list.map((c) => [c.id, c] as [string, any]));
  }
}

export class ApplicationEmojiManager {
  cache = new Collection<string, { id: string; name: string; animated: boolean; toString: () => string; delete: () => Promise<void> }>();
  constructor(readonly client: Client) {}
  private wrap(e: any) {
    if (!e?.id) throw new Error("emoji response has no id");
    const em = {
      id: e.id as string, name: e.name as string, animated: !!e.animated,
      toString: () => `<${e.animated ? "a" : ""}:${e.name}:${e.id}>`,
      delete: () => this.delete(e.id),
    };
    this.cache.set(em.id, em);
    return em;
  }
  async fetch() {
    const r: { items: any[] } = await this.client.rest.get(`/applications/${this.client.application!.id}/emojis`);
    this.cache.clear();
    for (const e of r.items ?? []) this.wrap(e);
    return this.cache;
  }
  async create(o: { attachment: Uint8Array | string; name: string }) {
    let image = typeof o.attachment === "string" ? o.attachment : "";
    let bytes: Uint8Array | null = o.attachment instanceof Uint8Array ? o.attachment : null;
    if (typeof o.attachment === "string" && !o.attachment.startsWith("data:")) bytes = new Uint8Array(readFileSync(o.attachment));
    if (bytes) {
      o = { ...o, attachment: bytes };
      let s = "";
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      image = `data:image/png;base64,${btoa(s)}`;
    }
    return this.wrap(await this.client.rest.post(`/applications/${this.client.application!.id}/emojis`, { body: { name: o.name, image } }));
  }
  async delete(id: string) {
    await this.client.rest.delete(`/applications/${this.client.application!.id}/emojis/${id}`);
    this.cache.delete(id);
  }
}

export class ClientApplication {
  commands: ApplicationCommandManager;
  emojis: ApplicationEmojiManager;
  name = "";
  constructor(readonly client: Client, public id: string) {
    this.commands = new ApplicationCommandManager(client);
    this.emojis = new ApplicationEmojiManager(client);
  }
  async fetch() {
    const d = await this.client.rest.get("/applications/@me");
    this.id = d.id;
    this.name = d.name;
    return this;
  }
}

export class Client extends Emitter {
  readonly options: Required<Pick<ClientOptions, "memberCacheSize">> & ClientOptions;
  rest!: REST;
  gateway: Gateway | null = null;
  token: string | null = null;
  user: ClientUser | null = null;
  application: ClientApplication | null = null;
  readyAt: Date | null = null;
  readonly guilds = new GuildManager(this);
  readonly users = new UserManager(this);
  readonly channels = new ChannelManager(this);
  readonly ws = { ping: -1, status: 5 as number };
  private readonly channelGuild = new Map<string, string>();
  private pending = new Set<string>();
  private readyTimer: ReturnType<typeof setTimeout> | null = null;
  private presence: { status: string; activities: any[]; afk: boolean; since: null } = { status: "online", activities: [], afk: false, since: null };

  constructor(options: ClientOptions) {
    super();
    this.options = { ...options, memberCacheSize: options.memberCacheSize ?? (Number(process.env.MEMBER_CACHE) || 400) };
    if (options.presence) this.presence = { ...this.presence, ...options.presence } as any;
  }

  get readyTimestamp() { return this.readyAt?.getTime() ?? null; }
  get uptime() { return this.readyAt ? Date.now() - this.readyAt.getTime() : null; }
  isReady() { return !!this.readyAt; }
  guildOfChannel(id: string) { return this.channelGuild.get(id); }
  _indexChannel(channelId: string, guildId: string) { this.channelGuild.set(channelId, guildId); }

  async login(token: string) {
    this.token = token.replace(/^Bot\s+/i, "").trim();
    this.rest = new REST(this.token);
    const app = await this.rest.get("/applications/@me");
    this.application = new ClientApplication(this, app.id);
    this.application.name = app.name;
    if (this.options.restOnly) {
      this.user = new ClientUser(this, await this.rest.get("/users/@me"));
      const guilds: any[] = await this.rest.get("/users/@me/guilds");
      for (const g of guilds) {
        try {
          const full = await this.rest.get(`/guilds/${g.id}`, { query: { with_counts: true } });
          const channels = await this.rest.get(`/guilds/${g.id}/channels`).catch(() => []);
          this.guilds.cache.set(g.id, new Guild(this, { ...full, channels }));
          for (const c of channels) this._indexChannel(c.id, g.id);
        } catch (e) {
          log.warn("client", `guild ${g.id}: ${(e as Error).message}`);
        }
      }
      this.readyAt = new Date();
      this.ws.status = 0;
      this.emit(Events.ClientReady, this);
      this.emit("ready", this);
      return this.token;
    }
    const intents = Array.isArray(this.options.intents) ? this.options.intents.reduce((a, b) => a | b, 0) : this.options.intents;
    this.gateway = new Gateway({
      token: this.token,
      intents,
      presence: this.presence,
      onDispatch: (t, d) => this.dispatch(t, d),
      onFatal: (code, reason) => {
        const hint = code === 4014 ? "enable SERVER MEMBERS and MESSAGE CONTENT intents in the Developer Portal" : code === 4004 ? "invalid token" : reason;
        this.emit("error", Object.assign(new Error(`Gateway closed (${code}): ${hint}`), { code }));
        if (!this.listenerCount("error")) process.exit(1);
      },
    });
    this.gateway.connect();
    return this.token;
  }

  async destroy() {
    this.gateway?.destroy();
    this.readyAt = null;
    this.ws.status = 5;
  }

  _setPresence(p: { status?: string; activities?: any[]; afk?: boolean }) {
    this.presence = {
      ...this.presence,
      ...(p.status ? { status: p.status } : {}),
      ...(p.activities ? { activities: p.activities.map((a) => ({ name: a.name ?? "", type: a.type ?? 0, url: a.url, state: a.state })) } : {}),
      ...(p.afk !== undefined ? { afk: p.afk } : {}),
    };
    this.gateway?.send({ op: 3, d: this.presence });
  }

  private markReady() {
    if (this.readyAt) return;
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.readyAt = new Date();
    this.ws.status = 0;
    this.emit(Events.ClientReady, this);
    this.emit("ready", this);
  }

  private dispatch(t: string, d: any) {
    if (this.gateway) this.ws.ping = this.gateway.ping;
    switch (t) {
      case "READY": {
        this.user = new ClientUser(this, d.user);
        if (d.application?.id && this.application) this.application.id = d.application.id;
        this.pending = new Set(d.guilds.map((g: any) => g.id));
        if (!this.readyAt) {
          this.readyTimer = setTimeout(() => this.markReady(), 20_000);
          if (!this.pending.size) this.markReady();
        }
        return;
      }
      case "RESUMED":
        this.ws.status = 0;
        return;
      case "GUILD_CREATE": {
        if (d.unavailable) return;
        const g = new Guild(this, d);
        this.guilds.cache.set(g.id, g);
        for (const c of g.channels.cache.keys()) this.channelGuild.set(c, g.id);
        const wasPending = this.pending.delete(g.id);
        if (!this.readyAt && wasPending && !this.pending.size) this.markReady();
        else if (this.readyAt && !wasPending) this.emit(Events.GuildCreate, g);
        return;
      }
      case "GUILD_UPDATE": {
        const g = this.guilds.cache.get(d.id);
        if (g) {
          g._patch(d);
          for (const r of d.roles ?? []) g.roles._add(r);
        }
        return;
      }
      case "GUILD_DELETE": {
        if (d.unavailable) return;
        const g = this.guilds.cache.get(d.id);
        this.guilds.cache.delete(d.id);
        if (g) {
          for (const c of g.channels.cache.keys()) this.channelGuild.delete(c);
          this.emit(Events.GuildDelete, g);
        }
        return;
      }
      case "CHANNEL_CREATE":
      case "CHANNEL_UPDATE":
      case "THREAD_CREATE":
      case "THREAD_UPDATE": {
        if (d.guild_id) this.guilds.cache.get(d.guild_id)?.channels._add(d);
        return;
      }
      case "CHANNEL_DELETE":
      case "THREAD_DELETE": {
        this.guilds.cache.get(d.guild_id)?.channels.cache.delete(d.id);
        this.channelGuild.delete(d.id);
        return;
      }
      case "GUILD_ROLE_CREATE":
      case "GUILD_ROLE_UPDATE":
        this.guilds.cache.get(d.guild_id)?.roles._add(d.role);
        return;
      case "GUILD_ROLE_DELETE":
        this.guilds.cache.get(d.guild_id)?.roles.cache.delete(d.role_id);
        return;
      case "GUILD_MEMBER_ADD": {
        const g = this.guilds.cache.get(d.guild_id);
        if (!g) return;
        g.memberCount++;
        this.emit(Events.GuildMemberAdd, g.members._add(d));
        return;
      }
      case "GUILD_MEMBER_UPDATE": {
        const g = this.guilds.cache.get(d.guild_id);
        if (!g) return;
        const old = g.members.cache.get(d.user.id);
        const before = old ? Object.assign(Object.create(Object.getPrototypeOf(old)), old, { _roles: [...old._roles] }) : null;
        const now = g.members._add(d);
        this.emit(Events.GuildMemberUpdate, before ?? now, now);
        return;
      }
      case "GUILD_MEMBER_REMOVE": {
        const g = this.guilds.cache.get(d.guild_id);
        if (!g) return;
        g.memberCount = Math.max(0, g.memberCount - 1);
        g.voiceStates.cache.delete(d.user.id);
        const m = g.members.cache.get(d.user.id) ?? new GuildMember(g, { user: d.user, roles: [] });
        g.members.cache.delete(d.user.id);
        this.emit(Events.GuildMemberRemove, m);
        return;
      }
      case "VOICE_STATE_UPDATE": {
        const g = d.guild_id ? this.guilds.cache.get(d.guild_id) : undefined;
        if (!g) return;
        if (d.member) g.members._add(d.member);
        const old = g.voiceStates.cache.get(d.user_id) ?? new VoiceState(g, { user_id: d.user_id });
        const now = new VoiceState(g, d);
        if (now.channelId) g.voiceStates.cache.set(d.user_id, now);
        else g.voiceStates.cache.delete(d.user_id);
        this.emit(Events.VoiceStateUpdate, old, now);
        return;
      }
      case "MESSAGE_CREATE": {
        if (!d.guild_id && d.channel_id && d.author && !d.author.bot) this.channels._add({ id: d.channel_id, type: 1, recipients: [d.author] });
        this.emit(Events.MessageCreate, new Message(this, d));
        return;
      }
      case "MESSAGE_DELETE":
        this.emit(Events.MessageDelete, { id: d.id, channelId: d.channel_id, guildId: d.guild_id ?? null, partial: true });
        return;
      case "INTERACTION_CREATE":
        this.emit(Events.InteractionCreate, new Interaction(this, d));
        return;
    }
    this.emit("raw", { t, d });
  }
}

export { User, GuildMember, Guild, Message, VoiceState, BaseChannel };
