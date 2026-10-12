/**
 * Ctx — غلاف التفاعل (أمر سلاش / زر / قائمة / نافذة / إكمال تلقائي) مع أدوات الرد.
 *
 *   ctx.str("السبب") · ctx.int("العدد") · ctx.memberOpt("العضو") · ctx.roleOpt("الرتبة") · ctx.channelOpt("الروم")
 *   ctx.reply("تم", true)  ← true = مخفي (ephemeral)
 *   ctx.defer(true) ثم ctx.followup({...}) · ctx.update({...}) لتعديل رسالة الزر · ctx.showModal(modal(...))
 */
import { InteractionType, MessageFlags, OptionType, P, ResponseType } from "./constants.ts";
import type { Bot } from "./client.ts";
import { toMember, toRole, toUser, type CMember, type CRole, type CUser } from "./cache.ts";
import type { FileUpload } from "./rest.ts";
import type { Embed } from "../core/ui.ts";

export interface Payload {
  content?: string;
  embeds?: Embed[];
  components?: any[];
  flags?: number;
  allowed_mentions?: unknown;
  files?: FileUpload[];
  attachments?: unknown[];
}

export type Reply = string | Payload;

export interface ResolvedChannel { id: string; name: string; type: number; parentId: string | null }

export class Ctx {
  readonly type: number;
  readonly guildId: string | undefined;
  readonly channelId: string;
  readonly user: CUser;
  readonly member: CMember | undefined;
  /** صلاحيات العضو في هذا الروم (من ديسكورد مباشرة). */
  readonly perms: bigint;
  /** صلاحيات البوت في هذا الروم. */
  readonly appPerms: bigint;
  readonly name: string;
  readonly group: string | undefined;
  readonly sub: string | undefined;
  readonly opts = new Map<string, any>();
  readonly customId: string;
  readonly values: string[];
  readonly fields = new Map<string, string>();
  readonly resolved: any;
  acked = false;

  constructor(readonly bot: Bot, readonly i: any) {
    this.type = i.type;
    this.guildId = i.guild_id;
    this.channelId = i.channel_id ?? i.channel?.id;
    const u = i.member?.user ?? i.user;
    this.user = toUser(u);
    if (i.member && i.guild_id) this.member = bot.cache.putMember(toMember(i.guild_id, i.member));
    this.perms = BigInt(i.member?.permissions ?? 0);
    this.appPerms = BigInt(i.app_permissions ?? 0);
    const data = i.data ?? {};
    this.name = data.name ?? "";
    this.customId = data.custom_id ?? "";
    this.values = data.values ?? [];
    this.resolved = data.resolved ?? {};
    let options: any[] = data.options ?? [];
    if (options[0]?.type === OptionType.Group) {
      this.group = options[0].name;
      options = options[0].options ?? [];
    }
    if (options[0]?.type === OptionType.Subcommand) {
      this.sub = options[0].name;
      options = options[0].options ?? [];
    }
    for (const o of options) this.opts.set(o.name, o);
    if (i.type === InteractionType.Modal) {
      for (const r of data.components ?? []) {
        const children = r.components ?? (r.component ? [r.component] : []);
        for (const c of children) if (c.custom_id) this.fields.set(c.custom_id, c.value ?? (c.values ?? []).join(","));
      }
    }
  }

  // ─────────── قراءة الخيارات ───────────
  has(name: string): boolean {
    return this.opts.has(name);
  }
  str(name: string): string | undefined {
    const v = this.opts.get(name)?.value;
    return v === undefined ? undefined : String(v);
  }
  int(name: string): number | undefined {
    const v = this.opts.get(name)?.value;
    return v === undefined ? undefined : Number(v);
  }
  bool(name: string): boolean | undefined {
    return this.opts.get(name)?.value;
  }
  /** آيدي الخيار (عضو/رتبة/روم). */
  id(name: string): string | undefined {
    return this.opts.get(name)?.value;
  }
  userOpt(name: string): CUser | undefined {
    const id = this.id(name);
    const u = id && this.resolved.users?.[id];
    return u ? toUser(u) : undefined;
  }
  memberOpt(name: string): CMember | undefined {
    const id = this.id(name);
    return id ? this.resolvedMember(id) : undefined;
  }
  roleOpt(name: string): CRole | undefined {
    const id = this.id(name);
    const r = id && this.resolved.roles?.[id];
    return r ? toRole(r) : undefined;
  }
  channelOpt(name: string): ResolvedChannel | undefined {
    const id = this.id(name);
    const c = id && this.resolved.channels?.[id];
    return c ? { id: c.id, name: c.name, type: c.type, parentId: c.parent_id ?? null } : undefined;
  }
  attachment(name: string): { url: string; filename: string; size: number; content_type?: string } | undefined {
    const id = this.id(name);
    return id ? this.resolved.attachments?.[id] : undefined;
  }
  /** عضو من resolved (أوامر وقوائم الأعضاء). */
  resolvedMember(id: string): CMember | undefined {
    const m = this.resolved.members?.[id];
    const u = this.resolved.users?.[id];
    if (m && u && this.guildId) return this.bot.cache.putMember(toMember(this.guildId, m, u));
    return undefined;
  }
  /** الأعضاء المختارين من UserSelect. */
  selectedMembers(): CMember[] {
    return this.values.map((v) => this.resolvedMember(v)).filter((m): m is CMember => !!m);
  }
  focused(): { name: string; value: string } | undefined {
    for (const o of this.opts.values()) if (o.focused) return { name: o.name, value: String(o.value ?? "") };
    return undefined;
  }
  /** الرسالة اللي فيها الزر/القائمة. */
  get message(): any {
    return this.i.message;
  }

  // ─────────── صلاحيات ───────────
  get isAdmin(): boolean {
    return (this.perms & P.Administrator) === P.Administrator || (!!this.guildId && this.bot.cache.guilds.get(this.guildId)?.ownerId === this.user.id);
  }
  can(perm: bigint): boolean {
    return this.isAdmin || (this.perms & perm) === perm;
  }
  hasRole(roleId: string | null | undefined): boolean {
    return !!roleId && !!this.member?.roles.includes(String(roleId));
  }

  // ─────────── الردود ───────────
  private body(r: Reply, ephemeral = false): Payload {
    const p: Payload = typeof r === "string" ? { content: r } : { ...r };
    p.flags = (p.flags ?? 0) | (ephemeral ? MessageFlags.Ephemeral : 0);
    p.allowed_mentions ??= { parse: [] };
    return p;
  }

  private callback(type: number, data?: Payload | object) {
    this.acked = true;
    const files = (data as Payload | undefined)?.files;
    if (files) delete (data as Payload).files;
    return this.bot.rest.post(`/interactions/${this.i.id}/${this.i.token}/callback`, {
      body: data === undefined ? { type } : { type, data }, files, auth: false, direct: true, retries: 1,
    });
  }

  /** يرد (أو يرسل followup لو سبق الرد). ephemeral = مخفي. */
  reply(r: Reply, ephemeral = false) {
    if (this.acked) return this.followup(r, ephemeral);
    return this.callback(ResponseType.Message, this.body(r, ephemeral));
  }
  /** رد مخفي. */
  hidden(r: Reply) {
    return this.reply(r, true);
  }
  defer(ephemeral = false) {
    if (this.acked) return Promise.resolve();
    return this.callback(ResponseType.DeferredMessage, { flags: ephemeral ? MessageFlags.Ephemeral : 0 });
  }
  deferUpdate() {
    if (this.acked) return Promise.resolve();
    return this.callback(ResponseType.DeferredUpdate);
  }
  /** يعدّل الرسالة اللي فيها الزر/القائمة. */
  update(r: Reply) {
    const p = typeof r === "string" ? { content: r } : { ...r };
    if (this.acked) return this.edit(p);
    return this.callback(ResponseType.Update, p);
  }
  showModal(m: { custom_id: string; title: string; components: unknown[] }) {
    return this.callback(ResponseType.Modal, m);
  }
  autocomplete(choices: { name: string; value: string | number }[]) {
    return this.callback(ResponseType.Autocomplete, { choices: choices.slice(0, 25).map((c) => ({ ...c, name: c.name.slice(0, 100) })) });
  }
  followup(r: Reply, ephemeral = false) {
    const p = this.body(r, ephemeral);
    const files = p.files;
    delete p.files;
    return this.bot.rest.post(`/webhooks/${this.bot.appId}/${this.i.token}`, { body: p, files, auth: false });
  }
  /** يعدّل الرد الأصلي (بعد defer). */
  edit(r: Reply) {
    const p: Payload = typeof r === "string" ? { content: r } : { ...r };
    const files = p.files;
    delete p.files;
    return this.bot.rest.patch(`/webhooks/${this.bot.appId}/${this.i.token}/messages/@original`, { body: p, files, auth: false });
  }
  deleteOriginal() {
    return this.bot.rest.delete(`/webhooks/${this.bot.appId}/${this.i.token}/messages/@original`, { auth: false }).catch(() => undefined);
  }
  /** رسالة خطأ مخفية (تشتغل قبل وبعد الرد). */
  fail(msg: string) {
    return this.reply(msg.startsWith("❌") || msg.startsWith("⚠️") ? msg : `❌ ${msg}`, true);
  }
}
