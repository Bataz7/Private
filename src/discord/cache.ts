/**
 * كاش صغير جداً: نحفظ بس اللي تحتاجه الأنظمة.
 * - السيرفرات: الاسم، الأيقونة، المالك، الرتب، الرومات (مع صلاحياتها)، ومين في أي روم صوتي.
 * - الأعضاء: كاش محدود (LRU) يتعبّى من الأحداث والتفاعلات، والباقي يُجلب من REST عند الحاجة.
 * - الرسائل: آخر N رسالة (للوق الحذف والتعديل) بنص مقصوص.
 */
import { config } from "../core/config.ts";

export interface Overwrite { id: string; type: number; allow: bigint; deny: bigint }
export interface CRole { id: string; name: string; position: number; permissions: bigint; color: number; managed: boolean; icon?: string | null }
export interface CChannel { id: string; name: string; type: number; parentId: string | null; position: number; overwrites: Overwrite[]; topic?: string | null; nsfw?: boolean }
export interface CGuild {
  id: string; name: string; icon: string | null; ownerId: string; memberCount: number; afkChannelId: string | null;
  roles: Map<string, CRole>; channels: Map<string, CChannel>;
  /** userId → channelId لكل اللي في رومات صوتية */
  voice: Map<string, string>;
  /** حالة الصوت الكاملة (mute/deaf…) لمن هو في روم */
  voiceFlags: Map<string, { selfMute: boolean; selfDeaf: boolean; mute: boolean; deaf: boolean }>;
}
export interface CUser { id: string; username: string; globalName: string | null; avatar: string | null; bot: boolean }
export interface CMember extends CUser {
  guildId: string; roles: string[]; nick: string | null; memberAvatar: string | null; joinedAt: string | null;
  communicationDisabledUntil: string | null; premiumSince?: string | null;
}
export interface CMessage {
  id: string; channelId: string; guildId: string | null; authorId: string; authorName: string; authorAvatar: string | null;
  bot: boolean; content: string; attachments: string[]; createdAt: number;
}

export const toUser = (u: any): CUser => ({ id: u.id, username: u.username, globalName: u.global_name ?? null, avatar: u.avatar ?? null, bot: !!u.bot });

export function toRole(r: any): CRole {
  return { id: r.id, name: r.name, position: r.position, permissions: BigInt(r.permissions ?? 0), color: r.color ?? 0, managed: !!r.managed, icon: r.icon ?? null };
}

export function toChannel(c: any): CChannel {
  return {
    id: c.id, name: c.name ?? "", type: c.type, parentId: c.parent_id ?? null, position: c.position ?? 0,
    overwrites: (c.permission_overwrites ?? []).map((o: any) => ({ id: o.id, type: o.type, allow: BigInt(o.allow), deny: BigInt(o.deny) })),
    topic: c.topic ?? null, nsfw: !!c.nsfw,
  };
}

export function toMember(guildId: string, m: any, user?: any): CMember {
  const u = user ?? m.user;
  return {
    ...toUser(u), guildId, roles: m.roles ?? [], nick: m.nick ?? null, memberAvatar: m.avatar ?? null,
    joinedAt: m.joined_at ?? null, communicationDisabledUntil: m.communication_disabled_until ?? null, premiumSince: m.premium_since ?? null,
  };
}

/** خريطة بحد أقصى: لما تمتلي تحذف الأقدم. */
export class LRU<K, V> extends Map<K, V> {
  constructor(private readonly max: number) {
    super();
  }
  override set(k: K, v: V): this {
    if (super.has(k)) super.delete(k);
    else if (this.size >= this.max) super.delete(super.keys().next().value as K);
    return super.set(k, v);
  }
}

export class Cache {
  readonly guilds = new Map<string, CGuild>();
  readonly members = new LRU<string, CMember>(config.MEMBER_CACHE); // key: guildId:userId
  readonly users = new LRU<string, CUser>(2000);
  readonly messages = new LRU<string, CMessage>(config.MESSAGE_CACHE);
  /** رومات الخاص المفتوحة: userId → channelId */
  readonly dms = new LRU<string, string>(500);
  /** sticky: سيرفرات ما وصلنا GUILD_CREATE حقها للحين */
  readonly unavailable = new Set<string>();

  guildFrom(d: any): CGuild {
    const g: CGuild = {
      id: d.id, name: d.name, icon: d.icon ?? null, ownerId: d.owner_id, memberCount: d.member_count ?? 0,
      afkChannelId: d.afk_channel_id ?? null, roles: new Map(), channels: new Map(), voice: new Map(), voiceFlags: new Map(),
    };
    for (const r of d.roles ?? []) g.roles.set(r.id, toRole(r));
    for (const c of d.channels ?? []) g.channels.set(c.id, toChannel(c));
    for (const c of d.threads ?? []) g.channels.set(c.id, toChannel(c));
    for (const v of d.voice_states ?? []) {
      if (v.channel_id) {
        g.voice.set(v.user_id, v.channel_id);
        g.voiceFlags.set(v.user_id, { selfMute: !!v.self_mute, selfDeaf: !!v.self_deaf, mute: !!v.mute, deaf: !!v.deaf });
      }
    }
    for (const m of d.members ?? []) if (m.user) this.members.set(`${d.id}:${m.user.id}`, toMember(d.id, m));
    return g;
  }

  member(guildId: string, userId: string): CMember | undefined {
    return this.members.get(`${guildId}:${userId}`);
  }

  putMember(m: CMember): CMember {
    this.members.set(`${m.guildId}:${m.id}`, m);
    this.users.set(m.id, { id: m.id, username: m.username, globalName: m.globalName, avatar: m.avatar, bot: m.bot });
    return m;
  }

  dropGuild(id: string): void {
    this.guilds.delete(id);
    for (const k of this.members.keys()) if (k.startsWith(`${id}:`)) this.members.delete(k);
  }
}
