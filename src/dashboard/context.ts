import { Client, Guild, PermissionFlagsBits, type GuildMember } from '../lib/djs/index.js';
import { supabase } from '../supabase/client.js';
import { Context, HttpError } from '../web/server/http.js';
import type { Mount } from '../web/server/router.js';
import { destroySession } from '../web/server/session.js';

// ما تحتاجه مسارات اللوحة: عميل ديسكورد (REST فقط)، كاش محدود للسيرفرات والأعضاء والإعدادات، وفحوصات الصلاحيات.
// الصلاحيات تنفحص من ديسكورد مباشرة (بكاش قصير) — ما نثق في أي شي يرسله المتصفح.

export type SessionGuild = { id: string; name: string; icon: string | null; owner: boolean };
export type SessionUser = {
  id: string; username: string; avatar: string | null;
  isOwner: boolean; isAdministrator: boolean; isManagement: boolean; isStaff: boolean;
  guilds: SessionGuild[];
};

export interface DashboardContext {
  discord: Client;
  supabase: typeof supabase;
  /** السيرفر المختار (لازم يكون من سيرفرات المستخدم والبوت فيه). يرمي 400/403 لو لا. */
  selectedGuildId: (c: Context) => string;
  /** أدمن (مالك السيرفر أو صلاحية Administrator)، فحص مباشر. يرد 403 بنفسه ويرجع false لو مرفوض. */
  requireAdministrator: (c: Context) => Promise<boolean>;
  requireManagement: (c: Context) => Promise<boolean>;
  /** نفس الفحص بدون رد. */
  isAdmin: (c: Context) => Promise<boolean>;
  sessionUser: (c: Context) => SessionUser | null;
  getGuild: (guildId: string) => Promise<Guild>;
  /** عضو من ديسكورد، يتحدّث لو أقدم من maxAgeMs (الافتراضي 30 ثانية). null لو مو عضو. */
  getMember: (guildId: string, userId: string, maxAgeMs?: number) => Promise<GuildMember | null>;
  /** صف guild_settings الخام (snake_case) بكاش قصير. */
  settingsRow: (guildId: string) => Promise<Record<string, any> | null>;
  invalidateSettings: (guildId: string) => void;
}

export interface DashboardExtension {
  name: string;
  /** مسارات عامة بدون دخول (حدود طلبات خاصة فيها). */
  mountPublic?: (ctx: DashboardContext, app: Mount) => void;
  /** مسارات /api للستاف: الدخول + رتبة الستاف + Origin + CSRF + حد الطلبات مفحوصة قبلها. */
  mountApi?: (ctx: DashboardContext, app: Mount) => void;
}

const MEMBER_TTL = 30_000;
const ROLES_TTL = 60_000;
const SETTINGS_TTL = 15_000;
const CACHE_CAP = 4000;

function bounded<K, V>(map: Map<K, V>, key: K, value: V) {
  if (map.has(key)) map.delete(key);
  else if (map.size >= CACHE_CAP) map.delete(map.keys().next().value as K);
  map.set(key, value);
}

export function createContext(discord: Client): DashboardContext & { refreshGuilds: () => Promise<void>; checkStaff: (c: Context) => Promise<Response | void> } {
  const memberFetchedAt = new Map<string, number>();
  const memberMissing = new Map<string, number>();
  const rolesFetchedAt = new Map<string, number>();
  const settingsCache = new Map<string, { at: number; row: Record<string, any> | null }>();
  const guildLoads = new Map<string, Promise<Guild>>();

  async function loadGuild(guildId: string): Promise<Guild> {
    const cached = discord.guilds.cache.get(guildId);
    if (cached) return cached;
    let pending = guildLoads.get(guildId);
    if (!pending) {
      pending = (async () => {
        const data = await discord.rest.get(`/guilds/${guildId}`, { query: { with_counts: true } });
        const channels = await discord.rest.get(`/guilds/${guildId}/channels`).catch(() => []);
        const guild = new Guild(discord, { ...data, channels });
        discord.guilds.cache.set(guild.id, guild);
        for (const channel of channels) discord._indexChannel(channel.id, guild.id);
        return guild;
      })().finally(() => guildLoads.delete(guildId));
      guildLoads.set(guildId, pending);
    }
    return pending;
  }

  async function getGuild(guildId: string): Promise<Guild> {
    if (!/^\d{15,22}$/.test(guildId)) throw new HttpError(404, 'السيرفر مو موجود.');
    const guild = await loadGuild(guildId);
    // بدون Gateway ما توصلنا تحديثات الرتب: نحدّثها كل دقيقة (الصلاحيات تعتمد عليها).
    const last = rolesFetchedAt.get(guildId) ?? 0;
    if (Date.now() - last > ROLES_TTL) {
      bounded(rolesFetchedAt, guildId, Date.now());
      await guild.roles.fetch().catch(() => undefined);
      if (discord.user && !guild.members.me) await guild.members.fetchMe().catch(() => undefined);
    }
    return guild;
  }

  async function getMember(guildId: string, userId: string, maxAgeMs = MEMBER_TTL): Promise<GuildMember | null> {
    if (!/^\d{15,22}$/.test(userId)) return null;
    const guild = await getGuild(guildId).catch(() => null);
    if (!guild) return null;
    const key = `${guildId}:${userId}`;
    const now = Date.now();
    if ((memberMissing.get(key) ?? 0) > now - Math.min(maxAgeMs, 10_000)) return null;
    const cached = guild.members.cache.get(userId);
    if (cached && now - (memberFetchedAt.get(key) ?? 0) < maxAgeMs) return cached;
    try {
      const member = await guild.members.fetch({ user: userId, force: true });
      bounded(memberFetchedAt, key, now);
      memberMissing.delete(key);
      return member;
    } catch {
      bounded(memberMissing, key, now);
      return null;
    }
  }

  async function settingsRow(guildId: string) {
    const hit = settingsCache.get(guildId);
    if (hit && Date.now() - hit.at < SETTINGS_TTL) return hit.row;
    const { data, error } = await supabase.from('guild_settings').select('*').eq('guild_id', guildId).maybeSingle();
    if (error) throw new Error(error.message);
    bounded(settingsCache, guildId, { at: Date.now(), row: data ?? null });
    return data ?? null;
  }

  const sessionUser = (c: Context) => (c.session?.data.user as SessionUser | undefined) ?? null;

  function selectedGuildId(c: Context) {
    const user = sessionUser(c);
    const id = c.session?.data.guildId as string | undefined;
    if (!user) throw new HttpError(401, 'سجّل دخولك أول.');
    if (!id) throw new HttpError(400, 'ما فيه سيرفر مختار.');
    if (!user.guilds.some(guild => guild.id === id)) throw new HttpError(403, 'هذا السيرفر مو متاح لحسابك.');
    return id;
  }

  const adminOf = (guild: Guild, member: GuildMember | null, userId: string) => guild.ownerId === userId || Boolean(member?.permissions.has(PermissionFlagsBits.Administrator));

  async function isAdmin(c: Context) {
    const user = sessionUser(c);
    if (!user) return false;
    const guildId = selectedGuildId(c);
    const guild = await getGuild(guildId).catch(() => null);
    if (!guild) return false;
    const member = await getMember(guildId, user.id);
    const admin = adminOf(guild, member, user.id);
    user.isOwner = guild.ownerId === user.id;
    user.isAdministrator = Boolean(member?.permissions.has(PermissionFlagsBits.Administrator));
    user.isManagement = admin;
    return admin;
  }

  async function requireAdministrator(c: Context) {
    if (await isAdmin(c)) return true;
    c.fail(403, 'هذا الإجراء يحتاج صلاحية أدمن.');
    return false;
  }

  /** حارس /api: مستخدم مسجّل + السيرفر المختار فيه البوت + عنده رتبة الستاف الحين. يتكرر كل 30 ثانية لكل جلسة. */
  async function checkStaff(c: Context): Promise<Response | void> {
    const user = sessionUser(c);
    if (!user || !c.session) return c.fail(401, 'سجّل دخولك أول.');
    if ((c.session.data.staffOkUntil ?? 0) > Date.now()) return;
    let guildId: string;
    try { guildId = selectedGuildId(c); } catch (error) { return c.fail((error as HttpError).status ?? 403, (error as Error).message); }
    const guild = await getGuild(guildId).catch(() => null);
    const member = guild ? await getMember(guildId, user.id) : null;
    const settings = guild ? await settingsRow(guildId).catch(() => null) : null;
    const staffRoleId = settings?.staff_role_id as string | undefined;
    const isStaff = Boolean(member && staffRoleId && member.roles.cache.has(staffRoleId));
    if (!guild || !member || !isStaff) {
      destroySession(c);
      return c.fail(403, 'تحتاج رتبة الستاف عشان تدخل لوحة التحكم.');
    }
    user.isOwner = guild.ownerId === user.id;
    user.isAdministrator = member.permissions.has(PermissionFlagsBits.Administrator);
    user.isManagement = user.isOwner || user.isAdministrator;
    user.isStaff = true;
    c.session.data.staffOkUntil = Date.now() + 30_000;
  }

  /** بدون Gateway: نحدّث قائمة سيرفرات البوت كل كم دقيقة (سيرفر جديد يظهر، والمحذوف يختفي). */
  async function refreshGuilds() {
    if (!discord.rest) return;
    const list: Array<{ id: string }> = await discord.rest.get('/users/@me/guilds').catch(() => null);
    if (!Array.isArray(list)) return;
    const ids = new Set(list.map(item => item.id));
    for (const id of [...discord.guilds.cache.keys()]) if (!ids.has(id)) discord.guilds.cache.delete(id);
    for (const id of ids) if (!discord.guilds.cache.has(id)) await loadGuild(id).catch(() => undefined);
  }

  return {
    discord, supabase, selectedGuildId, requireAdministrator, requireManagement: requireAdministrator, isAdmin, sessionUser,
    getGuild, getMember, settingsRow, invalidateSettings: guildId => { settingsCache.delete(guildId); }, refreshGuilds, checkStaff,
  };
}
