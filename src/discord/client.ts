/**
 * Bot — يجمع الاتصال (Gateway) و REST والكاش والأوامر والأحداث.
 *
 * الأنظمة تسجّل نفسها:
 *   bot.command({ name: "نقاطي", description: "...", run: (ctx) => ... })
 *   bot.component("police:here:", (ctx) => ...)     ← أي custom_id يبدأ بهذا
 *   bot.modal("police:pts:", (ctx) => ...)
 *   bot.on("VOICE_STATE_UPDATE", (d, extra) => ...) ← أحداث Gateway الخام + الحالة القديمة من الكاش
 *   bot.on("ready", () => ...)                       ← مرة وحدة بعد ما توصل كل السيرفرات
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ALL_PERMS, CDN, ErrorCode, InteractionType, P } from "./constants.ts";
import { Gateway } from "./gateway.ts";
import { DiscordAPIError, REST, type FileUpload } from "./rest.ts";
import { Cache, toChannel, toMember, toRole, toUser, type CGuild, type CMember, type CMessage, type CRole, type CUser } from "./cache.ts";
import { Ctx, type Payload } from "./ctx.ts";
import { config } from "../core/config.ts";
import { log } from "../core/log.ts";
import { sortRequired } from "../core/opts.ts";

export interface Command {
  name: string;
  description: string;
  options?: any[];
  /** default_member_permissions — من يشوف الأمر افتراضياً (null = الكل). */
  perms?: bigint | null;
  /** يشتغل في الخاص؟ الافتراضي لا. */
  dm?: boolean;
  /** أمر خاص بسيرفر معيّن (مثل سيرفر المالك). */
  guildId?: string;
  run: (ctx: Ctx) => unknown;
  autocomplete?: (ctx: Ctx) => unknown;
}

type Handler = (ctx: Ctx) => unknown;
type EventFn = (d: any, extra: any) => unknown;

export class Bot {
  readonly rest: REST;
  readonly gateway: Gateway;
  readonly cache = new Cache();
  appId = "";
  user: CUser = { id: "", username: "", globalName: null, avatar: null, bot: true };
  ready = false;
  readonly startedAt = Date.now();
  private readonly events = new Map<string, EventFn[]>();
  readonly commands = new Map<string, Command>();
  private readonly components: [string, Handler][] = [];
  private readonly modals: [string, Handler][] = [];
  /** channelId → guildId */
  private readonly channelGuild = new Map<string, string>();
  private pendingGuilds = new Set<string>();
  private readyTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(readonly token: string, intents: number) {
    this.rest = new REST(token);
    this.gateway = new Gateway({
      token, intents,
      presence: { status: "online", activities: [{ type: 3, name: "السيرفر 👮" }], since: null, afk: false },
      onDispatch: (t, d) => this.dispatch(t, d),
      onFatal: (code, reason) => {
        log.error("gateway", `fatal close ${code} ${reason} — ${code === 4014 ? "enable SERVER MEMBERS + MESSAGE CONTENT intents in the Developer Portal" : code === 4004 ? "invalid token" : "check settings"}`);
        process.exit(1);
      },
    });
  }

  // ─────────── التسجيل ───────────
  on(event: string, fn: EventFn): void {
    const list = this.events.get(event);
    if (list) list.push(fn);
    else this.events.set(event, [fn]);
  }
  command(c: Command): void {
    if (this.commands.has(c.name)) throw new Error(`duplicate command ${c.name}`);
    this.commands.set(c.name, c);
  }
  component(prefix: string, fn: Handler): void {
    this.components.push([prefix, fn]);
    this.components.sort((a, b) => b[0].length - a[0].length);
  }
  modal(prefix: string, fn: Handler): void {
    this.modals.push([prefix, fn]);
    this.modals.sort((a, b) => b[0].length - a[0].length);
  }

  private emit(event: string, d: any, extra: any = {}): void {
    const list = this.events.get(event);
    if (!list) return;
    for (const fn of list) {
      try {
        const r = fn(d, extra);
        if (r instanceof Promise) r.catch((e) => log.err(event, e));
      } catch (e) {
        log.err(event, e);
      }
    }
  }

  /** يبلّغ الأنظمة إن البوت بيطفي (عشان تحفظ حالتها). */
  shutdown(): void {
    this.emit("shutdown", null, {});
  }

  async start(): Promise<void> {
    const app = await this.rest.get("/applications/@me");
    this.appId = app.id;
    this.gateway.connect();
  }

  // ─────────── الأحداث ───────────
  private dispatch(t: string, d: any): void {
    const c = this.cache;
    switch (t) {
      case "READY": {
        this.user = toUser(d.user);
        this.pendingGuilds = new Set(d.guilds.map((g: any) => g.id));
        if (!this.ready) {
          this.readyTimer = setTimeout(() => this.markReady(), 20_000);
          if (!this.pendingGuilds.size) this.markReady();
        }
        break;
      }
      case "GUILD_CREATE": {
        if (d.unavailable) return;
        const g = c.guildFrom(d);
        c.guilds.set(g.id, g);
        for (const id of g.channels.keys()) this.channelGuild.set(id, g.id);
        const wasPending = this.pendingGuilds.delete(g.id);
        if (!this.ready && wasPending && !this.pendingGuilds.size) this.markReady();
        else if (this.ready && !wasPending) this.emit("GUILD_JOIN", d, { guild: g });
        this.emit(t, d, { guild: g });
        return;
      }
      case "GUILD_UPDATE": {
        const g = c.guilds.get(d.id);
        const before = g && { name: g.name, icon: g.icon, ownerId: g.ownerId, afkChannelId: g.afkChannelId };
        if (g) Object.assign(g, { name: d.name, icon: d.icon ?? null, ownerId: d.owner_id, afkChannelId: d.afk_channel_id ?? null });
        this.emit(t, d, { before, guild: g });
        return;
      }
      case "GUILD_DELETE": {
        if (d.unavailable) return;
        const g = c.guilds.get(d.id);
        c.dropGuild(d.id);
        this.emit(t, d, { guild: g });
        return;
      }
      case "CHANNEL_CREATE":
      case "CHANNEL_UPDATE":
      case "THREAD_CREATE":
      case "THREAD_UPDATE": {
        const g = d.guild_id && c.guilds.get(d.guild_id);
        const before = g ? g.channels.get(d.id) : undefined;
        if (g) {
          g.channels.set(d.id, toChannel(d));
          this.channelGuild.set(d.id, g.id);
        }
        this.emit(t, d, { before, guild: g });
        return;
      }
      case "CHANNEL_DELETE":
      case "THREAD_DELETE": {
        const g = d.guild_id && c.guilds.get(d.guild_id);
        const before = g ? g.channels.get(d.id) : undefined;
        if (g) g.channels.delete(d.id);
        this.channelGuild.delete(d.id);
        this.emit(t, d, { before, guild: g });
        return;
      }
      case "GUILD_ROLE_CREATE":
      case "GUILD_ROLE_UPDATE": {
        const g = c.guilds.get(d.guild_id);
        const before = g?.roles.get(d.role.id);
        g?.roles.set(d.role.id, toRole(d.role));
        this.emit(t, d, { before, guild: g });
        return;
      }
      case "GUILD_ROLE_DELETE": {
        const g = c.guilds.get(d.guild_id);
        const before = g?.roles.get(d.role_id);
        g?.roles.delete(d.role_id);
        this.emit(t, d, { before, guild: g });
        return;
      }
      case "GUILD_MEMBER_ADD": {
        const g = c.guilds.get(d.guild_id);
        if (g) g.memberCount++;
        const m = c.putMember(toMember(d.guild_id, d));
        this.emit(t, d, { member: m, guild: g });
        return;
      }
      case "GUILD_MEMBER_UPDATE": {
        const before = c.member(d.guild_id, d.user.id);
        const m = c.putMember(toMember(d.guild_id, d));
        this.emit(t, d, { before: before ? { ...before, roles: [...before.roles] } : undefined, member: m });
        return;
      }
      case "GUILD_MEMBER_REMOVE": {
        const g = c.guilds.get(d.guild_id);
        if (g) {
          g.memberCount = Math.max(0, g.memberCount - 1);
          g.voice.delete(d.user.id);
        }
        const before = c.member(d.guild_id, d.user.id);
        c.members.delete(`${d.guild_id}:${d.user.id}`);
        this.emit(t, d, { before, guild: g });
        return;
      }
      case "VOICE_STATE_UPDATE": {
        const g = d.guild_id && c.guilds.get(d.guild_id);
        if (!g) return;
        const before = g.voice.get(d.user_id) ?? null;
        const beforeFlags = g.voiceFlags.get(d.user_id);
        if (d.channel_id) {
          g.voice.set(d.user_id, d.channel_id);
          g.voiceFlags.set(d.user_id, { selfMute: !!d.self_mute, selfDeaf: !!d.self_deaf, mute: !!d.mute, deaf: !!d.deaf });
        } else {
          g.voice.delete(d.user_id);
          g.voiceFlags.delete(d.user_id);
        }
        const member = d.member ? c.putMember(toMember(d.guild_id, d.member)) : c.member(d.guild_id, d.user_id);
        this.emit(t, d, { before, after: d.channel_id ?? null, beforeFlags, member, guild: g });
        return;
      }
      case "MESSAGE_CREATE": {
        const m = this.toMessage(d);
        if (d.guild_id && d.member) c.putMember(toMember(d.guild_id, d.member, d.author));
        if (!d.guild_id && !d.author?.bot) c.dms.set(d.author.id, d.channel_id);
        if (d.guild_id && !d.author?.bot) c.messages.set(d.id, m);
        this.emit(t, d, { message: m });
        return;
      }
      case "MESSAGE_UPDATE": {
        const before = c.messages.get(d.id);
        if (before && typeof d.content === "string") c.messages.set(d.id, { ...before, content: d.content.slice(0, 1500) });
        this.emit(t, d, { before });
        return;
      }
      case "MESSAGE_DELETE": {
        const before = c.messages.get(d.id);
        c.messages.delete(d.id);
        this.emit(t, d, { before });
        return;
      }
      case "MESSAGE_DELETE_BULK": {
        const before = (d.ids as string[]).map((id) => c.messages.get(id)).filter(Boolean);
        for (const id of d.ids) c.messages.delete(id);
        this.emit(t, d, { before });
        return;
      }
      case "INTERACTION_CREATE":
        void this.onInteraction(d);
        return;
    }
    this.emit(t, d, {});
  }

  private markReady(): void {
    if (this.ready) return;
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.ready = true;
    void this.syncCommands().catch((e) => log.err("commands", e));
    this.emit("ready", null, {});
  }

  private toMessage(d: any): CMessage {
    return {
      id: d.id, channelId: d.channel_id, guildId: d.guild_id ?? null, authorId: d.author?.id, authorName: d.author?.global_name ?? d.author?.username ?? "",
      authorAvatar: d.author?.avatar ?? null, bot: !!d.author?.bot, content: String(d.content ?? "").slice(0, 1500),
      attachments: (d.attachments ?? []).slice(0, 5).map((a: any) => a.url), createdAt: Date.now(),
    };
  }

  // ─────────── التفاعلات ───────────
  private async onInteraction(i: any): Promise<void> {
    const ctx = new Ctx(this, i);
    let fn: Handler | undefined;
    if (i.type === InteractionType.Command || i.type === InteractionType.Autocomplete) {
      const cmd = this.commands.get(ctx.name);
      fn = i.type === InteractionType.Autocomplete ? cmd?.autocomplete : cmd?.run;
    } else if (i.type === InteractionType.Component) {
      fn = this.components.find(([p]) => ctx.customId === p || ctx.customId.startsWith(p))?.[1];
    } else if (i.type === InteractionType.Modal) {
      fn = this.modals.find(([p]) => ctx.customId === p || ctx.customId.startsWith(p))?.[1];
    }
    if (!fn) {
      if (i.type === InteractionType.Component) await ctx.deferUpdate().catch(() => undefined);
      return;
    }
    try {
      await fn(ctx);
    } catch (e) {
      if (e instanceof DiscordAPIError && e.code === ErrorCode.UnknownInteraction) return;
      log.err(`interaction ${ctx.name || ctx.customId}`, e);
      if (i.type !== InteractionType.Autocomplete) {
        const msg = e instanceof DiscordAPIError && e.code === ErrorCode.MissingPermissions
          ? "❌ البوت ما عنده صلاحية كافية لهذا (تأكد إن رتبة البوت فوق الرتب المطلوبة)."
          : "❌ صار خطأ غير متوقع، حاول مرة ثانية.";
        await ctx.reply(msg, true).catch(() => undefined);
      }
    }
  }

  /** يرفع الأوامر لديسكورد بس لو تغيّرت (يحفظ بصمة في data/). */
  async syncCommands(force = false): Promise<number> {
    const toJSON = (c: Command) => ({
      name: c.name, description: c.description.slice(0, 100), options: sortRequired(c.options ?? []), type: 1,
      default_member_permissions: c.perms == null ? null : String(c.perms),
      contexts: c.dm ? [0, 1] : [0], integration_types: [0],
    });
    const global = [...this.commands.values()].filter((c) => !c.guildId).map(toJSON);
    const byGuild = new Map<string, any[]>();
    for (const c of this.commands.values()) if (c.guildId) byGuild.set(c.guildId, [...(byGuild.get(c.guildId) ?? []), toJSON(c)]);
    const hash = createHash("sha1").update(JSON.stringify([global, [...byGuild]])).digest("hex");
    const file = join(config.DATA_DIR, ".commands-hash");
    if (!force && existsSync(file) && readFileSync(file, "utf8") === `${this.appId}:${hash}`) return global.length;
    await this.rest.put(`/applications/${this.appId}/commands`, { body: global });
    for (const [gid, cmds] of byGuild) await this.rest.put(`/applications/${this.appId}/guilds/${gid}/commands`, { body: cmds }).catch((e) => log.warn("commands", `guild ${gid}: ${e.message}`));
    writeFileSync(file, `${this.appId}:${hash}`);
    log.ok("commands", `${global.length} global commands synced`);
    return global.length;
  }

  // ─────────── الرسائل ───────────
  send(channelId: string, p: Payload | string, files?: FileUpload[]): Promise<any> {
    const body = typeof p === "string" ? { content: p } : { ...p };
    const f = files ?? body.files;
    delete body.files;
    return this.rest.post(`/channels/${channelId}/messages`, { body: { allowed_mentions: { parse: [] }, ...body }, files: f });
  }
  /** يرسل بدون ما يرمي خطأ (يرجع null لو فشل). */
  trySend(channelId: string | null | undefined, p: Payload | string, files?: FileUpload[]): Promise<any> {
    if (!channelId) return Promise.resolve(null);
    return this.send(String(channelId), p, files).catch((e) => {
      log.debug("send", `${channelId}: ${e.message}`);
      return null;
    });
  }
  async dmChannel(userId: string): Promise<string> {
    const cached = this.cache.dms.get(userId);
    if (cached) return cached;
    const ch = await this.rest.post("/users/@me/channels", { body: { recipient_id: userId } });
    this.cache.dms.set(userId, ch.id);
    return ch.id;
  }
  /** رسالة خاص (null لو خاصه مقفل). */
  async dm(userId: string, p: Payload | string, files?: FileUpload[]): Promise<any> {
    try {
      return await this.send(await this.dmChannel(userId), p, files);
    } catch {
      return null;
    }
  }
  edit(channelId: string, messageId: string, p: Payload | string): Promise<any> {
    const body = typeof p === "string" ? { content: p } : { ...p };
    const files = body.files;
    delete body.files;
    return this.rest.patch(`/channels/${channelId}/messages/${messageId}`, { body, files });
  }
  deleteMessage(channelId: string, messageId: string, reason?: string): Promise<void> {
    return this.rest.delete(`/channels/${channelId}/messages/${messageId}`, { reason }).catch(() => undefined);
  }
  react(channelId: string, messageId: string, emoji: string): Promise<void> {
    const e = /^<a?:(\w+:\d+)>$/.exec(emoji)?.[1] ?? emoji;
    return this.rest.put(`/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(e)}/@me`).catch(() => undefined);
  }

  // ─────────── السيرفرات والأعضاء ───────────
  guild(id: string | null | undefined): CGuild | undefined {
    return id ? this.cache.guilds.get(String(id)) : undefined;
  }
  role(guildId: string, roleId: string | null | undefined): CRole | undefined {
    return roleId ? this.cache.guilds.get(guildId)?.roles.get(String(roleId)) : undefined;
  }
  channel(id: string | null | undefined) {
    if (!id) return undefined;
    const gid = this.channelGuild.get(String(id));
    return gid ? this.cache.guilds.get(gid)?.channels.get(String(id)) : undefined;
  }
  guildOfChannel(id: string): string | undefined {
    return this.channelGuild.get(id);
  }
  /** العضو من الكاش أو من REST (null لو مو موجود). */
  async member(guildId: string, userId: string, fresh = false): Promise<CMember | null> {
    if (!fresh) {
      const m = this.cache.member(guildId, userId);
      if (m) return m;
    }
    try {
      return this.cache.putMember(toMember(guildId, await this.rest.get(`/guilds/${guildId}/members/${userId}`)));
    } catch {
      return null;
    }
  }
  async userById(id: string): Promise<CUser | null> {
    const u = this.cache.users.get(id);
    if (u) return u;
    try {
      const r = toUser(await this.rest.get(`/users/${id}`));
      this.cache.users.set(id, r);
      return r;
    } catch {
      return null;
    }
  }
  /** يجيب أعضاء السيرفر صفحة صفحة (للأوامر اللي تحتاج كل الأعضاء — بدون ما نخزنهم). */
  async *allMembers(guildId: string): AsyncGenerator<CMember> {
    let after = "0";
    for (;;) {
      const page: any[] = await this.rest.get(`/guilds/${guildId}/members`, { query: { limit: 1000, after } });
      for (const m of page) yield toMember(guildId, m);
      if (page.length < 1000) return;
      after = page[page.length - 1].user.id;
    }
  }
  /** أعضاء رتبة معيّنة (من REST، بدون تخزين الكل). */
  async membersWithRole(guildId: string, roleId: string, limit = 1000): Promise<CMember[]> {
    const out: CMember[] = [];
    for await (const m of this.allMembers(guildId)) {
      if (m.roles.includes(roleId)) out.push(m);
      if (out.length >= limit) break;
    }
    return out;
  }

  addRole(guildId: string, userId: string, roleId: string, reason?: string) {
    return this.rest.put(`/guilds/${guildId}/members/${userId}/roles/${roleId}`, { reason }).then(() => this.touchRoles(guildId, userId, roleId, true));
  }
  removeRole(guildId: string, userId: string, roleId: string, reason?: string) {
    return this.rest.delete(`/guilds/${guildId}/members/${userId}/roles/${roleId}`, { reason }).then(() => this.touchRoles(guildId, userId, roleId, false));
  }
  private touchRoles(guildId: string, userId: string, roleId: string, add: boolean) {
    const m = this.cache.member(guildId, userId);
    if (m) m.roles = add ? [...new Set([...m.roles, roleId])] : m.roles.filter((r) => r !== roleId);
  }
  editMember(guildId: string, userId: string, body: Record<string, unknown>, reason?: string) {
    return this.rest.patch(`/guilds/${guildId}/members/${userId}`, { body, reason });
  }
  setNick(guildId: string, userId: string, nick: string | null, reason?: string) {
    return this.editMember(guildId, userId, { nick }, reason);
  }
  timeout(guildId: string, userId: string, seconds: number | null, reason?: string) {
    const until = seconds ? new Date(Date.now() + seconds * 1000).toISOString() : null;
    return this.editMember(guildId, userId, { communication_disabled_until: until }, reason);
  }
  kick(guildId: string, userId: string, reason?: string) {
    return this.rest.delete(`/guilds/${guildId}/members/${userId}`, { reason });
  }
  ban(guildId: string, userId: string, reason?: string, deleteSeconds = 0) {
    return this.rest.put(`/guilds/${guildId}/bans/${userId}`, { body: { delete_message_seconds: deleteSeconds }, reason });
  }
  unban(guildId: string, userId: string, reason?: string) {
    return this.rest.delete(`/guilds/${guildId}/bans/${userId}`, { reason });
  }

  // ─────────── الصلاحيات والرتب ───────────
  /** صلاحيات العضو العامة في السيرفر (بدون صلاحيات الروم). */
  basePerms(guildId: string, roles: string[], userId?: string): bigint {
    const g = this.cache.guilds.get(guildId);
    if (!g) return 0n;
    if (userId && g.ownerId === userId) return ALL_PERMS;
    let p = g.roles.get(guildId)?.permissions ?? 0n;
    for (const r of roles) p |= g.roles.get(r)?.permissions ?? 0n;
    return (p & P.Administrator) === P.Administrator ? ALL_PERMS : p;
  }
  /** صلاحيات العضو داخل روم معيّن (مع الـ overwrites). */
  channelPerms(guildId: string, channelId: string, roles: string[], userId: string): bigint {
    let p = this.basePerms(guildId, roles, userId);
    if (p === ALL_PERMS) return p;
    const ch = this.cache.guilds.get(guildId)?.channels.get(channelId);
    if (!ch) return p;
    const every = ch.overwrites.find((o) => o.id === guildId);
    if (every) p = (p & ~every.deny) | every.allow;
    let allow = 0n;
    let deny = 0n;
    for (const o of ch.overwrites) if (o.type === 0 && roles.includes(o.id)) {
      allow |= o.allow;
      deny |= o.deny;
    }
    p = (p & ~deny) | allow;
    const mine = ch.overwrites.find((o) => o.type === 1 && o.id === userId);
    if (mine) p = (p & ~mine.deny) | mine.allow;
    return p;
  }
  /** أعلى موضع رتبة. */
  topPosition(guildId: string, roles: string[]): number {
    const g = this.cache.guilds.get(guildId);
    let top = 0;
    for (const r of roles) top = Math.max(top, g?.roles.get(r)?.position ?? 0);
    return top;
  }
  /** أعلى رتبة (بالاسم واللون) أو undefined. */
  topRole(guildId: string, roles: string[]): CRole | undefined {
    const g = this.cache.guilds.get(guildId);
    let best: CRole | undefined;
    for (const r of roles) {
      const role = g?.roles.get(r);
      if (role && (!best || role.position > best.position)) best = role;
    }
    return best;
  }
  /** عضو البوت نفسه في السيرفر. */
  me(guildId: string): Promise<CMember | null> {
    return this.member(guildId, this.user.id);
  }
  /** هل يقدر البوت يدير (يعطي/يسحب) هذي الرتبة؟ */
  async canManageRole(guildId: string, roleId: string): Promise<boolean> {
    const me = await this.me(guildId);
    const role = this.role(guildId, roleId);
    if (!me || !role || role.managed) return false;
    return this.topPosition(guildId, me.roles) > role.position && (this.basePerms(guildId, me.roles) & P.ManageRoles) === P.ManageRoles;
  }
  /** هل يقدر البوت يعاقب هذا العضو (رتبته أعلى)؟ */
  async canModerate(guildId: string, target: CMember): Promise<boolean> {
    const g = this.guild(guildId);
    if (!g || target.id === g.ownerId) return false;
    const me = await this.me(guildId);
    return !!me && this.topPosition(guildId, me.roles) > this.topPosition(guildId, target.roles);
  }

  // ─────────── الصور والأسماء ───────────
  avatar(u: Pick<CUser, "id" | "avatar"> & { memberAvatar?: string | null; guildId?: string }, size = 256): string {
    if (u.memberAvatar && u.guildId) return `${CDN}/guilds/${u.guildId}/users/${u.id}/avatars/${u.memberAvatar}.png?size=${size}`;
    if (u.avatar) return `${CDN}/avatars/${u.id}/${u.avatar}.${u.avatar.startsWith("a_") ? "gif" : "png"}?size=${size}`;
    return `${CDN}/embed/avatars/${Number((BigInt(u.id) >> 22n) % 6n)}.png`;
  }
  guildIcon(g: CGuild | undefined, size = 256): string | undefined {
    return g?.icon ? `${CDN}/icons/${g.id}/${g.icon}.${g.icon.startsWith("a_") ? "gif" : "png"}?size=${size}` : undefined;
  }
  name(u: { nick?: string | null; globalName: string | null; username: string }): string {
    return u.nick || u.globalName || u.username;
  }
}
