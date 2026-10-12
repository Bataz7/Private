/**
 * Discord REST مباشرة عبر fetch (بدون مكتبات):
 *  - توكن البوت: سيرفرات البوت، الرومات والرتب (كاش 60 ثانية لكل سيرفر)، الأعضاء، إرسال الايمبد.
 *  - توكن المستخدم (OAuth): بياناته وسيرفراته وقت تسجيل الدخول فقط.
 * يحترم 429 (retry_after) ولا يطبع أي توكن في اللوق.
 */
import { log } from "../../src/core/log.ts";
import { cfg } from "./config.ts";
import { HttpError } from "./errors.ts";

export interface DiscordResult<T> {
  status: number;
  data: T;
}

type Auth = { bot: true } | { bearer: string } | { none: true };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const UA = "DiscordBot (https://github.com/revive-dashboard, 3.0) Bun";
const NET_ERR = "تعذر الاتصال بديسكورد، حاول بعد شوي";

let warnedAuth = false;

export async function discord<T = any>(
  path: string,
  o: { auth: Auth; method?: string; json?: unknown; form?: Record<string, string> } = { auth: { bot: true } },
): Promise<DiscordResult<T>> {
  const headers: Record<string, string> = { "User-Agent": UA };
  if ("bot" in o.auth) headers.Authorization = `Bot ${cfg.BOT_TOKEN}`;
  else if ("bearer" in o.auth) headers.Authorization = `Bearer ${o.auth.bearer}`;
  let body: string | undefined;
  if (o.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(o.json);
  } else if (o.form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(o.form).toString();
  }
  for (let attempt = 0; ; attempt++) {
    let r: Response;
    try {
      r = await fetch(cfg.API + path, { method: o.method ?? "GET", headers, body, signal: AbortSignal.timeout(15_000) });
    } catch {
      if (attempt < 2) {
        await sleep(500 * (attempt + 1));
        continue;
      }
      throw new HttpError(502, NET_ERR);
    }
    if (r.status === 429 && attempt < 3) {
      let wait = Number(r.headers.get("retry-after")) || 1;
      try {
        const j = (await r.json()) as { retry_after?: number };
        if (typeof j.retry_after === "number") wait = j.retry_after;
      } catch {}
      if (wait > 15) throw new HttpError(503, NET_ERR);
      await sleep(Math.ceil(wait * 1000) + 50);
      continue;
    }
    if (r.status >= 500 && attempt < 1) {
      await sleep(800);
      continue;
    }
    let data: any = null;
    const text = await r.text();
    if (text) {
      try {
        // الآيديات تبقى نصوص (ديسكورد يرجعها نصوص أصلاً)
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (r.status === 401 && "bot" in o.auth && !warnedAuth) {
      warnedAuth = true;
      log.warn("dashboard", "Discord rejected the bot token (401) — check DISCORD_TOKEN");
    }
    return { status: r.status, data: data as T };
  }
}

/* ---------- كاش بسيط بوعود (يمنع تكرار نفس الطلب) ---------- */
class PromiseCache<V> {
  private m = new Map<string, { exp: number; p: Promise<V> }>();
  constructor(private ttl: number, private max = 500) {}
  get(key: string, load: () => Promise<V>): Promise<V> {
    const now = Date.now();
    const hit = this.m.get(key);
    if (hit && hit.exp > now) return hit.p;
    if (this.m.size >= this.max) {
      for (const [k, v] of this.m) if (v.exp <= now) this.m.delete(k);
      if (this.m.size >= this.max) this.m.delete(this.m.keys().next().value!);
    }
    const p = load();
    const entry = { exp: now + this.ttl, p };
    this.m.set(key, entry);
    // لا نخزن الأخطاء
    p.catch(() => {
      if (this.m.get(key) === entry) this.m.delete(key);
    });
    return p;
  }
  delete(key: string) {
    this.m.delete(key);
  }
}

/* ---------- OAuth ---------- */
export async function exchangeCode(code: string, redirectUri: string): Promise<string | null> {
  const r = await discord<{ access_token?: string }>("/oauth2/token", {
    auth: { none: true },
    method: "POST",
    form: { client_id: cfg.CLIENT_ID, client_secret: cfg.CLIENT_SECRET, grant_type: "authorization_code", code, redirect_uri: redirectUri },
  });
  return r.status === 200 && r.data?.access_token ? r.data.access_token : null;
}

export interface OAuthUser {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
}
export interface PartialGuild {
  id: string;
  name: string;
  icon?: string | null;
  owner?: boolean;
  permissions?: string;
}

export async function userInfo(token: string): Promise<{ user: OAuthUser; guilds: PartialGuild[] } | null> {
  const [u, g] = await Promise.all([
    discord<OAuthUser>("/users/@me", { auth: { bearer: token } }),
    discord<PartialGuild[]>("/users/@me/guilds", { auth: { bearer: token } }),
  ]);
  if (u.status !== 200 || !u.data?.id || g.status !== 200 || !Array.isArray(g.data)) return null;
  return { user: u.data, guilds: g.data };
}

/* ---------- البوت ---------- */
export interface BotGuild {
  id: string;
  name: string;
  icon: string | null;
}

const botGuildsCache = new PromiseCache<Map<string, BotGuild>>(60_000, 2);
/** كل سيرفرات البوت (id → اسم وأيقونة)، كاش 60 ثانية. */
export function botGuilds(): Promise<Map<string, BotGuild>> {
  return botGuildsCache.get("all", async () => {
    const out = new Map<string, BotGuild>();
    if (!cfg.BOT_TOKEN) return out;
    let after = "0";
    for (let page = 0; page < 100; page++) {
      const r = await discord<BotGuild[]>(`/users/@me/guilds?limit=200&after=${after}`);
      if (r.status !== 200 || !Array.isArray(r.data)) break;
      for (const g of r.data) out.set(String(g.id), { id: String(g.id), name: g.name, icon: g.icon ?? null });
      if (r.data.length < 200) break;
      after = String(r.data[r.data.length - 1]!.id);
    }
    return out;
  });
}

export interface Role {
  id: string;
  name: string;
  position: number;
  permissions: string;
  managed?: boolean;
}
export interface Guild {
  id: string;
  name: string;
  icon: string | null;
  owner_id: string;
  roles: Role[];
}
export interface Channel {
  id: string;
  name: string;
  type: number;
  position: number;
  parent_id?: string | null;
}

const guildCache = new PromiseCache<Guild | null>(60_000);
/** بيانات السيرفر (null لو البوت مو فيه). */
export function getGuild(gid: string): Promise<Guild | null> {
  return guildCache.get(gid, async () => {
    if (!cfg.BOT_TOKEN || !/^\d{1,25}$/.test(gid)) return null;
    const r = await discord<Guild>(`/guilds/${gid}`);
    if (r.status === 200 && r.data?.id) return r.data;
    if (r.status >= 500 || r.status === 429) throw new HttpError(502, NET_ERR);
    return null;
  });
}

const channelCache = new PromiseCache<Channel[]>(60_000);
export function getChannels(gid: string): Promise<Channel[]> {
  return channelCache.get(gid, async () => {
    const r = await discord<Channel[]>(`/guilds/${gid}/channels`);
    if (r.status === 200 && Array.isArray(r.data)) return r.data;
    if (r.status >= 500 || r.status === 429) throw new HttpError(502, NET_ERR);
    return [];
  });
}

const memberCache = new PromiseCache<{ roles: string[] } | null>(30_000, 2000);
export function getMember(gid: string, uid: string): Promise<{ roles: string[] } | null> {
  return memberCache.get(`${gid}:${uid}`, async () => {
    const r = await discord<{ roles: string[] }>(`/guilds/${gid}/members/${uid}`);
    if (r.status === 200 && r.data) return { roles: (r.data.roles ?? []).map(String) };
    if (r.status >= 500 || r.status === 429) throw new HttpError(502, NET_ERR);
    return null;
  });
}

/** يفرّغ كاش سيرفر (بعد إرسال رسالة مثلاً لا نحتاج، لكن مفيد بعد أخطاء). */
export function forgetGuild(gid: string) {
  guildCache.delete(gid);
  channelCache.delete(gid);
}

/* ---------- أدوات ---------- */
const TEXT = 0;
const NEWS = 5;
const CATEGORY = 4;
const ADMINISTRATOR = 0x8n;

const byPos = <T extends { position: number; id: string }>(a: T, b: T) => a.position - b.position || (BigInt(a.id) < BigInt(b.id) ? -1 : 1);

export interface GuildMeta {
  channels: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  roles: { id: string; name: string }[];
}

/** نفس شكل meta في النسخة القديمة: الرومات النصية والكاتجوريات والرتب (بدون @everyone والمُدارة). */
export function guildMeta(g: Guild, chans: Channel[]): GuildMeta {
  return {
    channels: chans.filter((c) => c.type === TEXT || c.type === NEWS).sort(byPos).map((c) => ({ id: String(c.id), name: c.name })),
    categories: chans.filter((c) => c.type === CATEGORY).sort(byPos).map((c) => ({ id: String(c.id), name: c.name })),
    roles: [...g.roles].filter((r) => r.id !== g.id && !r.managed).sort(byPos).map((r) => ({ id: String(r.id), name: r.name })),
  };
}

export const isTextChannel = (chans: Channel[], id: string) => chans.some((c) => c.id === id && c.type === TEXT);

/** هل العضو أدمن (مالك أو عنده Administrator في أي رتبة)؟ */
export async function isAdmin(g: Guild, uid: string): Promise<boolean> {
  if (g.owner_id === uid) return true;
  const m = await getMember(g.id, uid);
  if (!m) return false;
  let perms = 0n;
  for (const r of g.roles) if (r.id === g.id || m.roles.includes(r.id)) perms |= BigInt(r.permissions || "0");
  return (perms & ADMINISTRATOR) === ADMINISTRATOR;
}

/** أعلى رتبة للبوت في السيرفر (موقعها). */
export async function botTopPosition(g: Guild): Promise<number | null> {
  const m = await getMember(g.id, cfg.BOT_ID);
  if (!m) return null;
  let top = 0;
  for (const r of g.roles) if (m.roles.includes(r.id) && r.position > top) top = r.position;
  return top;
}

export const guildIcon = (id: string, hash: string | null | undefined) =>
  hash ? `https://cdn.discordapp.com/icons/${id}/${hash}.${hash.startsWith("a_") ? "gif" : "png"}?size=1024` : null;

export function avatarUrl(u: OAuthUser): string {
  if (u.avatar) return `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.${u.avatar.startsWith("a_") ? "gif" : "png"}?size=256`;
  return `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(u.id) >> 22n) % 6n)}.png`;
}

/** تاريخ إنشاء snowflake بصيغة YYYY/MM/DD. */
export function snowflakeDate(id: string): string | null {
  try {
    const d = new Date(Number((BigInt(id) >> 22n) + 1420070400000n));
    if (Number.isNaN(d.getTime())) return null;
    return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}`;
  } catch {
    return null;
  }
}
