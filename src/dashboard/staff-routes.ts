import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits, type Guild } from '../lib/djs/index.js';
import { supabase } from '../supabase/client.js';
import { Staff } from '../models/Staff.js';
import { StaffRating } from '../models/StaffRating.js';
import { Shift } from '../models/Shift.js';
import { LeaveRequest } from '../models/LeaveRequest.js';
import { ResignationRequest } from '../models/ResignationRequest.js';
import { Complaint } from '../models/Complaint.js';
import { StaffReport } from '../models/StaffReport.js';
import { StaffDailyActivity } from '../models/StaffDailyActivity.js';
import { StaffLog } from '../models/StaffLog.js';
import { PointsLedger } from '../models/PointsLedger.js';
import { createLog } from '../services/log.service.js';
import { createComplaintOnce } from '../services/complaint.service.js';
import { describeSync, syncStaffFromRole } from '../services/staff-sync.service.js';
import { dismissStaff, listDismissed, reinstateStaff } from '../services/dismissal.service.js';
import { setLeaderboardChannel } from '../services/leaderboard.service.js';
import { dismissedUserIds } from '../discipline/dismissed.js';
import { buildShiftPanel } from '../utils/shift-panel.js';
import { buildComplaintPanel } from '../utils/complaint-panel.js';
import { buildRatingPanel } from '../utils/rating-panel.js';
import { clearLedger } from '../core/points.js';
import { enrichBootstrap } from '../core/dashboard.js';
import { logDbIssue } from '../core/db.js';
import type { Context } from '../web/server/http.js';
import { HttpError } from '../web/server/http.js';
import type { Mount } from '../web/server/router.js';
import { isIntId, isSnowflake, rateLimit } from '../web/server/security.js';
import type { DashboardContext, SessionUser } from './context.js';

// المسارات الأساسية للوحة (الستاف، الإعدادات، الشكاوي، اللوحات في ديسكورد، التقارير اليدوية) + المزامنة والفصل.
// كل المسارات هنا خلف حارس الستاف (app.ts). اللي للأدمن تفحص الصلاحية مباشرة من ديسكورد قبل أي شي.

type Handler = (c: Context) => unknown;
const DAY = 86_400_000;
const clean = (value: unknown, max: number) => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
const finite = (value: unknown, min: number, max: number) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(max, Math.max(min, number));
};
const isSchemaError = (error: { message?: string; code?: string } | null | undefined) =>
  Boolean(error && (['PGRST204', 'PGRST205', '42703'].includes(error.code || '') || /column|schema cache|does not exist/i.test(error.message || '')));

/** تحديث guild_settings يتحمّل الأعمدة الناقصة (migration ما انطبق): يشيل العمود الناقص ويعيد المحاولة. */
export async function updateSettingsTolerant(guildId: string, values: Record<string, unknown>) {
  const pending = { ...values };
  const missing: string[] = [];
  for (let attempt = 0; attempt < 12 && Object.keys(pending).length; attempt += 1) {
    const { error } = await supabase.from('guild_settings').update(pending).eq('guild_id', guildId);
    if (!error) return { missing };
    if (!isSchemaError(error)) throw new Error(error.message);
    const column = /'([a-z_]+)' column/.exec(error.message)?.[1] ?? /column "?([a-z_]+)"?/.exec(error.message)?.[1] ?? Object.keys(pending).find(key => error.message.includes(key));
    if (!column || !(column in pending)) {
      // ما عرفنا أي عمود: نشيل الأعمدة الاختيارية كلها مرة وحدة.
      for (const key of Object.keys(pending)) { missing.push(key); delete pending[key]; }
      break;
    }
    missing.push(column);
    delete pending[column];
  }
  return { missing };
}

export function mountStaffRoutes(app: Mount, ctx: DashboardContext) {
  const { discord } = ctx;
  const admin = (handler: Handler): Handler => async c => { if (!await ctx.requireAdministrator(c)) return; return handler(c); };
  const userOf = (c: Context) => ctx.sessionUser(c) as SessionUser;
  const writeLimit = rateLimit('staff-writes', 60_000, 60);
  const syncLimit = rateLimit('staff-sync', 60_000, 3, 'المزامنة محدودة بثلاث مرات بالدقيقة. انتظر شوي.');
  const complaintLimit = rateLimit('complaints', 60_000, 5, 'شكاوي كثيرة بوقت قصير. انتظر شوي.');
  const panelLimit = rateLimit('panels', 60_000, 10);
  const dmLimit = rateLimit('report-dm', 60_000, 10);
  const userIdParam = (c: Context) => {
    const id = String(c.params.userId || '');
    if (!isSnowflake(id)) throw new HttpError(400, 'آيدي العضو غير صحيح.');
    return id;
  };

  // ---- أسماء وصور الأعضاء (كاش محدود 5 دقايق) ----------------------------------------------------
  const infoCache = new Map<string, { at: number; info: { username: string; displayName: string; avatar: string; banner: string } | null }>();
  async function memberInfo(guild: Guild, userId: string) {
    const key = `${guild.id}:${userId}`;
    const hit = infoCache.get(key);
    if (hit && Date.now() - hit.at < 5 * 60_000) return hit.info;
    const member = guild.members.cache.get(userId) ?? await ctx.getMember(guild.id, userId, 5 * 60_000);
    const user = member?.user ?? await discord.users.fetch(userId).catch(() => null);
    const info = user ? {
      username: user.username, displayName: member?.displayName ?? user.globalName ?? user.username,
      avatar: (member ?? user).displayAvatarURL({ extension: 'png', size: 128 }),
      banner: member?.displayBannerURL({ extension: 'png', size: 1024 }) ?? user.bannerURL({ extension: 'png', size: 1024 }) ?? '',
    } : null;
    if (infoCache.size >= 3000) infoCache.delete(infoCache.keys().next().value!);
    infoCache.set(key, { at: Date.now(), info });
    return info;
  }

  const textChannel = async (guild: Guild, channelId: unknown) => {
    const id = String(channelId || '');
    if (!isSnowflake(id)) return null;
    const channel = await guild.channels.fetch(id).catch(() => null);
    return channel?.isTextBased() ? channel : null;
  };

  // ---- السيرفرات ---------------------------------------------------------------------------------
  // لوحة سيرفر واحد: القائمة فيها السيرفر الرئيسي بس، والاختيار ما يغيّر شي.
  app.get('/api/guilds', async c => {
    const guildId = ctx.selectedGuildId(c);
    const guild = await ctx.getGuild(guildId);
    return c.json({ guilds: [{ id: guild.id, name: guild.name, icon: guild.icon ?? null, owner: guild.ownerId === userOf(c).id }], selectedGuildId: guildId });
  });
  app.post('/api/guilds/select', c => {
    const guildId = ctx.selectedGuildId(c);
    if (c.body.guildId && String(c.body.guildId) !== guildId) return c.fail(403, 'اللوحة لسيرفر واحد فقط.');
    return c.json({ ok: true, guildId });
  });

  // ---- الإعداد --------------------------------------------------------------------------------------
  app.get('/api/setup/options', admin(async c => {
    const guild = await ctx.getGuild(ctx.selectedGuildId(c));
    const roles = (await guild.roles.fetch()).filter(role => !role.managed).sort((a, b) => b.position - a.position).map(role => ({ id: role.id, name: role.name, color: role.hexColor }));
    const channels = (await guild.channels.fetch()).filter(channel => channel?.isTextBased()).map(channel => ({ id: channel!.id, name: channel!.name ?? channel!.id }));
    const row = await ctx.settingsRow(guild.id).catch(() => null);
    return c.json({ roles, channels, presenceCheck: presenceView(row) });
  }));

  app.post('/api/setup', admin(async c => {
    const guildId = ctx.selectedGuildId(c);
    const values = c.body as Record<string, unknown>;
    const pick = (key: string) => (isSnowflake(values[key]) ? String(values[key]) : '');
    const requiredRoles = ['staffRoleId', 'onShiftRoleId', 'leaveRoleId'];
    const requiredChannels = ['shiftChannelId', 'leaveChannelId', 'resignationChannelId', 'logsChannelId'];
    if ([...requiredRoles, ...requiredChannels].some(key => !pick(key))) return c.fail(400, 'كمّل كل الرتب والرومات المطلوبة.');
    const guild = await ctx.getGuild(guildId);
    const roles = await guild.roles.fetch();
    const channels = await guild.channels.fetch();
    if (requiredRoles.some(key => !roles.has(pick(key))) || requiredChannels.some(key => !channels.has(pick(key)))) return c.fail(400, 'فيه رتبة أو روم مختار مو موجود في السيرفر.');
    for (const key of ['reportChannelId', 'complaintChannelId', 'ratingChannelId']) if (pick(key) && !channels.has(pick(key))) return c.fail(400, 'فيه روم اختياري مختار مو موجود في السيرفر.');
    const { error } = await supabase.from('guild_settings').upsert({
      guild_id: guildId, staff_role_id: pick('staffRoleId'), on_shift_role_id: pick('onShiftRoleId'), leave_role_id: pick('leaveRoleId'), management_role_id: null,
      shift_channel_id: pick('shiftChannelId'), leave_channel_id: pick('leaveChannelId'), resignation_channel_id: pick('resignationChannelId'), logs_channel_id: pick('logsChannelId'),
      report_channel_id: pick('reportChannelId') || null, complaint_channel_id: pick('complaintChannelId') || null, rating_channel_id: pick('ratingChannelId') || null,
    }, { onConflict: 'guild_id' });
    if (error) throw new Error(error.message);
    let missing: string[] = [];
    const presence = presenceInput(values);
    if (Object.keys(presence).length) ({ missing } = await updateSettingsTolerant(guildId, presence));
    ctx.invalidateSettings(guildId);
    return c.json({ ok: true, ...(missing.length ? { warning: 'انحفظت الإعدادات، بس إعدادات التحقق من التواجد تحتاج تحديث قاعدة البيانات (migration).', missing } : {}) });
  }));

  // ---- التحقق من التواجد + حد التحذيرات -------------------------------------------------------------
  function presenceView(row: Record<string, any> | null) {
    return {
      enabled: row?.presence_check_enabled !== false,
      minutes: Number(row?.presence_check_minutes) || 60,
      timeoutMinutes: Number(row?.presence_check_timeout_minutes) || 30,
      warnLimit: Number(row?.warn_limit) || 3,
      migrated: Boolean(row) && 'presence_check_enabled' in row!,
    };
  }
  function presenceInput(body: Record<string, unknown>) {
    const source = (body.presenceCheck && typeof body.presenceCheck === 'object' ? body.presenceCheck : body) as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    const enabled = source.enabled ?? source.presence_check_enabled;
    if (enabled !== undefined) out.presence_check_enabled = enabled === true || enabled === 'true';
    const minutes = source.minutes ?? source.presence_check_minutes;
    if (minutes !== undefined) out.presence_check_minutes = Math.round(finite(minutes, 5, 720) ?? 60);
    const timeout = source.timeoutMinutes ?? source.presence_check_timeout_minutes;
    if (timeout !== undefined) out.presence_check_timeout_minutes = Math.round(finite(timeout, 2, 240) ?? 30);
    const warn = source.warnLimit ?? source.warn_limit;
    if (warn !== undefined) out.warn_limit = Math.round(finite(warn, 1, 20) ?? 3);
    return out;
  }

  app.get('/api/settings/presence-check', admin(async c => c.json({ settings: presenceView(await ctx.settingsRow(ctx.selectedGuildId(c)).catch(() => null)) })));
  app.patch('/api/settings/presence-check', admin(async c => {
    const guildId = ctx.selectedGuildId(c);
    const values = presenceInput(c.body);
    if (!Object.keys(values).length) return c.fail(400, 'ما فيه شي ينحفظ.');
    const { missing } = await updateSettingsTolerant(guildId, values);
    ctx.invalidateSettings(guildId);
    if (missing.length === Object.keys(values).length) return c.fail(503, 'إعدادات التحقق من التواجد تحتاج تحديث قاعدة البيانات (migration) أول.', { missing });
    return c.json({ ok: true, settings: presenceView(await ctx.settingsRow(guildId).catch(() => null)), ...(missing.length ? { missing } : {}) });
  }), { guards: [writeLimit] });

  // ---- قناة لوحة الصدارة الأسبوعية ------------------------------------------------------------------
  app.get('/api/leaderboard/settings', admin(async c => {
    const row = await ctx.settingsRow(ctx.selectedGuildId(c)).catch(() => null);
    return c.json({ channelId: row?.leaderboard_channel_id ?? '', migrated: Boolean(row) && 'leaderboard_channel_id' in row! });
  }));
  app.patch('/api/leaderboard/settings', admin(async c => {
    const guildId = ctx.selectedGuildId(c);
    const raw = c.body.channelId;
    let channelId: string | null = null;
    if (raw) {
      const channel = await textChannel(await ctx.getGuild(guildId), raw);
      if (!channel) return c.fail(400, 'اختر روم كتابي في هذا السيرفر.');
      channelId = channel.id;
    }
    // الخدمة تحفظ الروم وترسل اللوحة الحية على طول (ورسالتها عربية لو الـ migration ناقص).
    await setLeaderboardChannel(await ctx.getGuild(guildId), channelId);
    ctx.invalidateSettings(guildId);
    await createLog(guildId, 'LEADERBOARD_CHANNEL_SET', userOf(c).id, userOf(c).id, { channelId }).catch(() => undefined);
    return c.json({ ok: true, channelId: channelId ?? '' });
  }), { guards: [writeLimit] });

  app.patch('/api/settings/messages', admin(async c => {
    const guildId = ctx.selectedGuildId(c);
    const values = c.body as Record<string, unknown>;
    const text = (value: unknown, fallback: string) => clean(value ?? fallback, 400) || fallback;
    const { error } = await supabase.from('guild_settings').update({
      points_message_title: text(values.title, '💜 Rift • نقاطك الخاصة'),
      points_message_description: text(values.description, 'هذا التقرير خاص بك ولا يظهر لباقي الأعضاء.'),
      points_message_footer: text(values.footer, 'Rift Staff Operations'),
    }).eq('guild_id', guildId);
    if (error) throw new Error(error.message);
    ctx.invalidateSettings(guildId);
    return c.json({ ok: true });
  }), { guards: [writeLimit] });

  app.patch('/api/settings/help-commands', admin(async c => {
    const commands = [...new Set(String(c.body.commands || '').split(/[,\s]+/).map(value => value.replace(/^!/, '').trim().slice(0, 32)).filter(value => /^[\p{L}\p{N}_-]+$/u.test(value)).slice(0, 10))];
    if (!commands.length) return c.fail(400, 'أضف أمر مساعدة واحد على الأقل.');
    const guildId = ctx.selectedGuildId(c);
    const { error } = await supabase.from('guild_settings').update({ help_commands: commands }).eq('guild_id', guildId);
    if (error) throw new Error(error.message);
    ctx.invalidateSettings(guildId);
    return c.json({ ok: true, commands });
  }), { guards: [writeLimit] });

  app.patch('/api/settings/language', admin(async c => {
    const language = c.body.language === 'en' ? 'en' : 'ar';
    const guildId = ctx.selectedGuildId(c);
    const { error } = await supabase.from('guild_settings').update({ bot_language: language }).eq('guild_id', guildId);
    if (error) throw new Error(error.message);
    ctx.invalidateSettings(guildId);
    return c.json({ ok: true, language });
  }), { guards: [writeLimit] });

  const developerModes = new Map<string, boolean>();
  app.patch('/api/settings/dev-mode', admin(async c => {
    const enabled = Boolean(c.body.enabled);
    developerModes.set(ctx.selectedGuildId(c), enabled);
    return c.json({ ok: true, enabled });
  }));

  // ---- بيانات اللوحة الرئيسية ----------------------------------------------------------------------
  const staffSyncAt = new Map<string, number>();
  async function syncCachedStaff(guild: Guild, staffRoleId: string) {
    if (Date.now() - (staffSyncAt.get(guild.id) ?? 0) < 60_000) return;
    staffSyncAt.set(guild.id, Date.now());
    const dismissed = await dismissedUserIds(guild.id).catch(() => new Set<string>());
    for (const member of guild.members.cache.values()) {
      if (dismissed.has(member.id)) continue;
      if (!member.roles.cache.has(staffRoleId) || member.user.bot) continue;
      try {
        const existing = await Staff.findOne({ guildId: guild.id, userId: member.id });
        if (!existing) await Staff.create({ guildId: guild.id, userId: member.id, joinedAt: new Date(), active: true, points: 0, claimed: 0, closed: 0 });
        else if (!existing.active) { existing.active = true; await existing.save(); }
      } catch (error) { console.error(`Could not sync staff member ${member.id}:`, error instanceof Error ? error.message : error); }
    }
  }

  app.get('/api/bootstrap', admin(async c => {
    const guildId = ctx.selectedGuildId(c);
    const guild = await ctx.getGuild(guildId);
    const settings = await ctx.settingsRow(guildId);
    if (settings?.staff_role_id) await syncCachedStaff(guild, settings.staff_role_id);
    const [staffRows, shifts, complaints, ratingRows, activities, leaves, resignations] = await Promise.all([
      Staff.find({ guildId, active: true }), Shift.find({ guildId }).sort({ startedAt: -1 }).limit(1000), Complaint.find({ guildId }).sort({ createdAt: -1 }).limit(50),
      StaffRating.find({ guildId }).sort({ createdAt: -1 }).limit(300), StaffDailyActivity.find({ guildId }), LeaveRequest.find({ guildId }).sort({ createdAt: -1 }).limit(100), ResignationRequest.find({ guildId }).sort({ createdAt: -1 }).limit(100),
    ]);
    const ratings = uniqueRatings(ratingRows);
    const staff = await Promise.all(staffRows.map(async row => {
      const info = await memberInfo(guild, row.userId);
      const userRatings = ratings.filter(rating => rating.staffUserId === row.userId);
      const userShifts = shifts.filter(shift => shift.userId === row.userId);
      const userComplaints = complaints.filter(complaint => complaint.staffUserId === row.userId && complaint.status === 'approved');
      const activityHours = activities.filter(activity => activity.userId === row.userId).reduce((sum, activity) => sum + activity.activeMinutes, 0) / 60;
      const totalMs = userShifts.reduce((sum, shift) => sum + activeDuration(shift), 0);
      return {
        userId: row.userId, username: info?.username ?? row.userId, displayName: info?.displayName ?? row.userId, avatar: info?.avatar ?? '', banner: info?.banner ?? '',
        joinedAt: row.joinedAt, points: row.points, messageCount: row.messageCount, voiceMinutes: row.voiceMinutes, activityHours, complaintCount: userComplaints.length, ratingCount: userRatings.length,
        averageRating: userRatings.length ? userRatings.reduce((sum, rating) => sum + rating.rating, 0) / userRatings.length : 0, shiftHours: totalMs / 3_600_000,
        active: Boolean(shifts.find(shift => shift.userId === row.userId && shift.status === 'active')), status: 'active', rank: '', notes: [] as unknown[],
      };
    }));
    const viewerId = userOf(c).id;
    const viewer = staff.find(item => item.userId === viewerId) ?? null;
    const viewerComplaints = complaints.filter(item => item.staffUserId === viewerId && item.status === 'approved').length;
    const ratingsWithNames = await Promise.all(ratings.map(async rating => ({ ...rating, reviewerName: (await memberInfo(guild, rating.reviewerUserId))?.displayName ?? rating.reviewerUserId })));
    const body: Record<string, any> = {
      guild: { id: guild.id, name: guild.name, icon: guild.iconURL({ extension: 'png', size: 128 }) }, settings, staff,
      viewer: viewer ? { ...viewer, complaintCount: viewerComplaints, voiceHours: (viewer.voiceMinutes ?? 0) / 60, messageCount: viewer.messageCount ?? 0 } : null,
      shifts, complaints, leaves, resignations, ratings: ratingsWithNames, botStatus: settings?.bot_status ?? 'idle',
    };
    await enrichBootstrap(ctx, guildId, body).catch(error => logDbIssue(error, 'Staff notes'));
    return c.json(body);
  }));

  app.get('/api/management-users', admin(async c => {
    const guild = await ctx.getGuild(ctx.selectedGuildId(c));
    const members = guild.members.cache.size >= guild.memberCount ? guild.members.cache : await guild.members.fetch();
    const users = [...members.values()]
      .filter(member => !member.user.bot && (member.permissions.has(PermissionFlagsBits.Administrator) || guild.ownerId === member.id))
      .slice(0, 200)
      .map(member => ({ userId: member.id, username: member.user.username, displayName: member.displayName, avatar: member.user.displayAvatarURL({ extension: 'png', size: 128 }) }));
    return c.json({ users });
  }), { guards: [rateLimit('management-users', 60_000, 10)] });

  app.get('/api/audit', admin(async c => {
    const guildId = ctx.selectedGuildId(c);
    const query = c.q('q').trim().toLowerCase().slice(0, 100);
    const action = c.q('action').slice(0, 60);
    const from = /^\d{4}-\d{2}-\d{2}$/.test(c.q('from')) ? c.q('from') : '';
    const to = /^\d{4}-\d{2}-\d{2}$/.test(c.q('to')) ? c.q('to') : '';
    const page = Math.min(1000, Math.max(1, Number(c.q('page')) || 1)); const pageSize = 50;
    let request = supabase.from('staff_logs').select('*').eq('guild_id', guildId).order('created_at', { ascending: false }).limit(5000);
    if (action) request = request.eq('action', action);
    if (from) request = request.gte('created_at', `${from}T00:00:00.000Z`);
    if (to) request = request.lte('created_at', `${to}T23:59:59.999Z`);
    const [{ data, error }, actionRows] = await Promise.all([request, supabase.from('staff_logs').select('action').eq('guild_id', guildId).order('created_at', { ascending: false }).limit(5000)]);
    if (error) throw new Error(error.message);
    const guild = await ctx.getGuild(guildId);
    const rows = (data ?? []).map((row: any) => ({ id: row.id, guildId: row.guild_id, action: row.action, userId: row.user_id, actorId: row.actor_id, details: row.details ?? {}, createdAt: row.created_at }));
    const nameOf = (id: string | null) => (id ? guild.members.cache.get(id)?.displayName ?? id : null);
    let named = rows.map(row => ({ ...row, name: nameOf(row.userId) ?? row.userId, actorName: nameOf(row.actorId) }));
    if (query) named = named.filter(row => `${row.action} ${row.name} ${row.actorName || ''}`.toLowerCase().includes(query));
    const actions = [...new Set((actionRows.data ?? []).map((row: any) => String(row.action)))].sort();
    const start = (page - 1) * pageSize;
    return c.json({ rows: named.slice(start, start + pageSize), actions, total: named.length, hasMore: start + pageSize < named.length });
  }));

  app.get('/api/shifts', admin(async c => {
    const guildId = ctx.selectedGuildId(c);
    const guild = await ctx.getGuild(guildId);
    const [shifts, staffRows] = await Promise.all([Shift.find({ guildId }).sort({ startedAt: -1 }).limit(1000), Staff.find({ guildId, active: true })]);
    const staff = await Promise.all(staffRows.map(async row => {
      const info = await memberInfo(guild, row.userId);
      const totalMs = shifts.filter(shift => shift.userId === row.userId).reduce((sum, shift) => sum + activeDuration(shift), 0);
      return { userId: row.userId, displayName: info?.displayName ?? row.userId, username: info?.username ?? row.userId, active: row.active, shiftHours: totalMs / 3_600_000 };
    }));
    return c.json({ shifts, staff, summary: { active: shifts.filter(shift => shift.status === 'active').length } });
  }));

  // قائمة الستاف: النشطين + المفصولين (dismissed) لو أعمدة الفصل موجودة في قاعدة البيانات.
  app.get('/api/staff', admin(async c => {
    const guildId = ctx.selectedGuildId(c);
    const guild = await ctx.getGuild(guildId);
    const rows = await Staff.find({ guildId, active: true });
    // listDismissed يشتغل حتى بدون أعمدة الفصل (يقرأ من سجل الستاف).
    const dismissal = new Map<string, { dismissedAt: string | null; dismissedBy: string | null; dismissReason: string | null }>();
    for (const entry of await listDismissed(guildId, 500).catch(() => [])) dismissal.set(entry.userId, { dismissedAt: entry.at ? entry.at.toISOString() : null, dismissedBy: entry.by, dismissReason: entry.reason || null });
    const dismissedOnly = [...dismissal.keys()].filter(id => !rows.some(row => row.userId === id));
    const dismissedRows = dismissedOnly.length ? await Staff.find({ guildId, active: false }).then(list => list.filter(row => dismissedOnly.includes(row.userId))) : [];
    const staff = await Promise.all([...rows, ...dismissedRows].map(async row => {
      const info = await memberInfo(guild, row.userId);
      const dismissed = row.active ? undefined : dismissal.get(row.userId);
      return {
        userId: row.userId, username: info?.username ?? row.userId, displayName: info?.displayName ?? row.userId, points: row.points, messageCount: row.messageCount, voiceMinutes: row.voiceMinutes,
        active: row.active, dismissed: Boolean(dismissed?.dismissedAt), dismissedAt: dismissed?.dismissedAt ?? null, dismissedBy: dismissed?.dismissedBy ?? null, dismissReason: dismissed?.dismissReason ?? null,
      };
    }));
    return c.json({ staff });
  }));

  app.get('/api/activity/weekly', admin(async c => {
    const guildId = ctx.selectedGuildId(c);
    const start = new Date(Math.floor(Date.now() / DAY) * DAY - 13 * DAY);
    const [activities, shifts] = await Promise.all([StaffDailyActivity.find({ guildId }), Shift.find({ guildId })]);
    const days = Array.from({ length: 14 }, (_, index) => ({ date: new Date(start.getTime() + index * DAY).toISOString().slice(0, 10), minutes: 0, messages: 0, shiftHours: 0 }));
    const dayIndex = (value: Date) => Math.floor((new Date(value).getTime() - start.getTime()) / DAY);
    for (const activity of activities) {
      const index = dayIndex(activity.activityDate);
      if (index >= 0 && index < days.length) { days[index]!.minutes += activity.activeMinutes; days[index]!.messages += activity.messageCount; }
    }
    for (const shift of shifts) {
      const index = dayIndex(shift.startedAt);
      if (index >= 0 && index < days.length) days[index]!.shiftHours += activeDuration(shift) / 3_600_000;
    }
    return c.json({ days: days.map(day => ({ ...day, shiftHours: Math.round(day.shiftHours * 10) / 10 })) });
  }));

  app.get('/api/staff/complaint-candidates', admin(async c => {
    const guildId = ctx.selectedGuildId(c);
    const guild = await ctx.getGuild(guildId);
    const rows = await Staff.find({ guildId, active: true }).sort({ userId: 1 });
    const staff = (await Promise.all(rows.map(async row => {
      const info = await memberInfo(guild, row.userId);
      return info ? { id: row.userId, username: info.username, displayName: info.displayName } : null;
    }))).filter((item): item is { id: string; username: string; displayName: string } => Boolean(item));
    return c.json({ staff });
  }));

  // ---- إدارة الستاف -------------------------------------------------------------------------------
  app.post('/api/staff', admin(async c => {
    const userId = String(c.body.userId || '').trim();
    const points = Math.round(finite(c.body.points ?? 0, 0, 10_000_000) ?? 0);
    if (!isSnowflake(userId)) return c.fail(400, 'اكتب آيدي ديسكورد صحيح.');
    const guildId = ctx.selectedGuildId(c);
    const settings = await ctx.settingsRow(guildId);
    const member = await ctx.getMember(guildId, userId, 0);
    if (!member) return c.fail(400, 'هذا الشخص مو عضو في السيرفر المختار.');
    if (!settings?.staff_role_id) return c.fail(400, 'رتبة الستاف مو محددة. افتح إعدادات السيرفر أول.');
    const guild = await ctx.getGuild(guildId);
    const botMember = guild.members.me;
    const canAssignRole = Boolean(member.manageable && botMember && member.roles.highest.position < botMember.roles.highest.position);
    if (canAssignRole) await member.roles.add(settings.staff_role_id, 'Added from Rift dashboard');
    const existing = await Staff.findOne({ guildId, userId });
    if (existing) { existing.active = true; existing.points = points; await existing.save(); }
    else await Staff.create({ guildId, userId, joinedAt: new Date(), active: true, points, claimed: 0, closed: 0 });
    await createLog(guildId, 'STAFF_ADDED', userId, userOf(c).id, { source: 'dashboard' }).catch(() => undefined);
    return c.json({ ok: true, roleAssigned: canAssignRole });
  }), { guards: [writeLimit] });

  app.delete('/api/staff/:userId', admin(async c => {
    const userId = userIdParam(c);
    const guildId = ctx.selectedGuildId(c);
    const settings = await ctx.settingsRow(guildId);
    const member = await ctx.getMember(guildId, userId, 0);
    if (member && settings?.staff_role_id) await member.roles.remove(settings.staff_role_id, 'Removed from Rift dashboard');
    const existing = await Staff.findOne({ guildId, userId });
    if (existing) { existing.active = false; await existing.save(); }
    await createLog(guildId, 'STAFF_REMOVED', userId, userOf(c).id, { source: 'dashboard' }).catch(() => undefined);
    return c.json({ ok: true });
  }), { guards: [writeLimit] });

  app.patch('/api/staff/:userId', admin(async c => {
    const userId = userIdParam(c);
    const guildId = ctx.selectedGuildId(c);
    const actor = userOf(c).id;
    if (actor === userId) return c.fail(403, 'ما تقدر تعدّل نقاطك بنفسك.');
    const staff = await Staff.findOne({ guildId, userId });
    if (!staff) return c.fail(404, 'الستاف مو موجود.');
    const before = staff.points;
    if (c.body.points !== undefined) {
      const points = finite(c.body.points, 0, 10_000_000);
      if (points === null) return c.fail(400, 'النقاط لازم تكون رقم صحيح.');
      staff.points = Math.round(points);
    }
    if (c.body.shiftHours !== undefined) {
      const shiftHours = finite(c.body.shiftHours, 0, 100_000);
      if (shiftHours === null) return c.fail(400, 'ساعات الشفت لازم تكون رقم صحيح.');
      if (await Shift.findOne({ guildId, userId, status: 'active' })) return c.fail(409, 'أنهِ الشفت الشغال أول قبل تعديل الساعات.');
      await Shift.deleteMany({ guildId, userId });
      const startedAt = new Date('2000-01-01T00:00:00.000Z');
      const endedAt = new Date(startedAt.getTime() + shiftHours * 3_600_000);
      await Shift.create({ guildId, userId, startedAt, endedAt, status: 'ended', breaks: [], lastActivityAt: endedAt, checkSentAt: null, pointsAwarded: 0 });
    }
    if (c.body.closed !== undefined) {
      const closed = finite(c.body.closed, 0, 10_000_000);
      if (closed === null) return c.fail(400, 'الرقم غير صحيح.');
      staff.closed = Math.round(closed);
    }
    await staff.save();
    await createLog(guildId, 'STAFF_STATS_UPDATED', staff.userId, actor, { points: staff.points, closed: staff.closed });
    if (before !== staff.points) await PointsLedger.create({ guildId, userId, delta: staff.points - before, pointsBefore: before, pointsAfter: staff.points, source: 'manual', reason: 'Set from the staff page', actorId: actor }).catch(error => logDbIssue(error, 'The points ledger'));
    const user = await discord.users.fetch(staff.userId).catch(() => null);
    if (user) {
      const settings = await ctx.settingsRow(guildId).catch(() => null);
      const replace = (value: string | undefined, fallback: string) => (value || fallback).replaceAll('{points}', String(staff.points)).replaceAll('{helped}', '0').replaceAll('{hours}', '0').replaceAll('{complaints}', '0');
      await user.send({ embeds: [new EmbedBuilder().setColor(0x8175f5).setTitle(replace(settings?.points_message_title, 'Rift • تم تحديث نقاطك')).setDescription(replace(settings?.points_message_description, 'تم تحديث إحصائياتك من إدارة السيرفر.')).addFields({ name: 'Rift • النقاط', value: String(staff.points), inline: true }).setFooter({ text: replace(settings?.points_message_footer, 'Rift Staff Operations') }).setThumbnail(user.displayAvatarURL({ extension: 'png', size: 128 })).setTimestamp()] }).catch(() => undefined);
    }
    return c.json({ ok: true });
  }), { guards: [writeLimit] });

  app.post('/api/staff/:userId/reset', admin(async c => {
    const userId = userIdParam(c);
    const guildId = ctx.selectedGuildId(c);
    const staff = await Staff.findOne({ guildId, userId });
    if (!staff) return c.fail(404, 'الستاف مو موجود.');
    if (await Shift.findOne({ guildId, userId, status: 'active' })) return c.fail(409, 'أنهِ الشفت الشغال أول قبل تصفير البيانات.');
    staff.points = 0; staff.claimed = 0; staff.closed = 0; staff.messageCount = 0; staff.voiceMinutes = 0;
    await staff.save();
    await Shift.deleteMany({ guildId, userId });
    await Complaint.deleteMany({ guildId, staffUserId: userId });
    await StaffRating.deleteMany({ guildId, staffUserId: userId });
    await clearLedger(guildId, userId);
    await supabase.from('assistances').delete().eq('guild_id', guildId).eq('staff_user_id', userId);
    await createLog(guildId, 'STAFF_STATS_RESET', userId, userOf(c).id);
    return c.json({ ok: true });
  }), { guards: [writeLimit] });

  app.post('/api/staff/:userId/reset-shift-hours', admin(async c => {
    const userId = userIdParam(c);
    const guildId = ctx.selectedGuildId(c);
    if (!await Staff.findOne({ guildId, userId })) return c.fail(404, 'الستاف مو موجود.');
    if (await Shift.findOne({ guildId, userId, status: 'active' })) return c.fail(409, 'أنهِ الشفت الشغال أول قبل تصفير الساعات.');
    await Shift.deleteMany({ guildId, userId });
    await createLog(guildId, 'STAFF_SHIFT_HOURS_RESET', userId, userOf(c).id);
    return c.json({ ok: true });
  }), { guards: [writeLimit] });

  app.post('/api/staff/reset-all', admin(async c => {
    const guildId = ctx.selectedGuildId(c);
    if (c.body.confirm !== undefined && c.body.confirm !== true && c.body.confirm !== 'تصفير الكل') return c.fail(400, 'أكّد التصفير أول.');
    const settings = await ctx.settingsRow(guildId);
    const staffRows = await Staff.find({ guildId });
    const steps: Array<[string, PromiseLike<{ error: { message: string } | null }>]> = [
      ['staff', supabase.from('staff').update({ points: 0, claimed: 0, closed: 0, message_count: 0, voice_minutes: 0 }).eq('guild_id', guildId)],
      ['shifts', supabase.from('shifts').delete().eq('guild_id', guildId)],
      ['activity', supabase.from('staff_daily_activity').delete().eq('guild_id', guildId)],
      ['ratings', supabase.from('staff_ratings').delete().eq('guild_id', guildId)],
      ['complaints', supabase.from('complaints').delete().eq('guild_id', guildId)],
      ['reports', supabase.from('staff_reports').delete().eq('guild_id', guildId)],
    ];
    for (const [, step] of steps) { const { error } = await step; if (error) throw new Error(error.message); }
    if (settings?.on_shift_role_id) {
      const guild = await ctx.getGuild(guildId);
      for await (const member of guild.members.list()) if (member._roles.includes(settings.on_shift_role_id)) await member.roles.remove(settings.on_shift_role_id, 'All Staff stats reset').catch(() => undefined);
    }
    await clearLedger(guildId);
    await supabase.from('assistances').delete().eq('guild_id', guildId);
    await createLog(guildId, 'ALL_STAFF_STATS_RESET', 'all-staff', userOf(c).id, { count: staffRows.length });
    return c.json({ ok: true, count: staffRows.length });
  }), { guards: [rateLimit('reset-all', 60_000, 2)] });

  // مزامنة قائمة الستاف مع رتبة الستاف (أو مسح الكل وإعادة التسجيل).
  app.post('/api/staff/sync', admin(async c => {
    const mode = c.body.mode === 'wipe' ? 'wipe' : c.body.mode === 'sync' || c.body.mode === undefined ? 'sync' : null;
    if (!mode) return c.fail(400, 'نوع المزامنة غير صحيح.');
    if (mode === 'wipe' && c.body.confirm !== 'مسح الكل') return c.fail(400, 'للمسح الكامل اكتب "مسح الكل" بالضبط للتأكيد.');
    const guildId = ctx.selectedGuildId(c);
    const guild = await ctx.getGuild(guildId);
    const result = await syncStaffFromRole(guild, mode);
    const message = describeSync(result);
    await createLog(guildId, mode === 'wipe' ? 'STAFF_WIPED' : 'STAFF_SYNCED', userOf(c).id, userOf(c).id, { ...result, source: 'dashboard' }).catch(() => undefined);
    staffSyncAt.set(guildId, Date.now());
    return c.json({ ok: true, result, message });
  }), { guards: [syncLimit] });

  // الفصل وإرجاع الستاف (الخدمة نفسها تفحص وتسجّل).
  app.post('/api/staff/:userId/dismiss', admin(async c => {
    const userId = userIdParam(c);
    const guildId = ctx.selectedGuildId(c);
    const actor = userOf(c).id;
    if (userId === actor) return c.fail(400, 'ما تقدر تفصل نفسك.');
    const reason = clean(c.body.reason, 500);
    if (reason.length < 3) return c.fail(400, 'اكتب سبب الفصل.');
    const guild = await ctx.getGuild(guildId);
    if (guild.ownerId === userId) return c.fail(403, 'ما تقدر تفصل مالك السيرفر.');
    const result = await dismissStaff(guild, userId, { by: actor, reason, resetPoints: c.body.resetPoints === true, source: 'dashboard' });
    return c.json(result);
  }), { guards: [writeLimit] });

  app.post('/api/staff/:userId/reinstate', admin(async c => {
    const userId = userIdParam(c);
    const guildId = ctx.selectedGuildId(c);
    const guild = await ctx.getGuild(guildId);
    const result = await reinstateStaff(guild, userId, { by: userOf(c).id, reason: clean(c.body.reason, 500) || undefined, restoreRole: c.body.restoreRole !== false, source: 'dashboard' });
    return c.json(result);
  }), { guards: [writeLimit] });

  // ---- الشكاوي ------------------------------------------------------------------------------------
  app.post('/api/complaints', async c => {
    const staffUserId = String(c.body.staffUserId || '');
    const reason = clean(c.body.reason, 1500);
    const evidence = clean(c.body.evidence, 500);
    if (!isSnowflake(staffUserId) || !reason) return c.fail(400, 'اختر الإداري واكتب سبب الشكوى.');
    const guildId = ctx.selectedGuildId(c);
    const reporter = userOf(c).id;
    if (reporter === staffUserId) return c.fail(403, 'ما تقدر تشتكي على نفسك.');
    const member = await ctx.getMember(guildId, staffUserId);
    const settings = await ctx.settingsRow(guildId);
    if (!member || !settings?.staff_role_id || !member.roles.cache.has(settings.staff_role_id)) return c.fail(400, 'الإداري مو موجود.');
    const result = await createComplaintOnce({ guildId, staffUserId, reporterUserId: reporter, reason, evidence });
    const complaint = result.complaint;
    if (!result.created) return c.json({ ok: true, duplicate: true, complaint });
    const guild = await ctx.getGuild(guildId);
    const embed = new EmbedBuilder().setColor(0x8175f5).setTitle('◇ شكوى جديدة').addFields({ name: 'الإداري', value: `<@${staffUserId}>`, inline: true }, { name: 'المبلّغ', value: `<@${reporter}>`, inline: true }, { name: 'التفاصيل', value: reason }, { name: 'الدليل', value: evidence || 'لا يوجد' }).setFooter({ text: `Rift Complaint #${String(complaint._id ?? complaint.id).slice(-6)}` });
    if (settings.complaint_channel_id) {
      const channel = await textChannel(guild, settings.complaint_channel_id);
      if (channel) await channel.send({ embeds: [embed], allowedMentions: { parse: [] }, components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`complaint_approve:${complaint._id ?? complaint.id}`).setLabel('اعتماد وخصم نقطة').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId(`complaint_reject:${complaint._id ?? complaint.id}`).setLabel('رفض').setStyle(ButtonStyle.Secondary))] }).catch(() => undefined);
    }
    if (settings.logs_channel_id) {
      const channel = await textChannel(guild, settings.logs_channel_id);
      if (channel) await channel.send({ content: `◇ شكوى جديدة على <@${staffUserId}> من <@${reporter}>`, allowedMentions: { parse: [] } }).catch(() => undefined);
    }
    return c.json({ ok: true, complaint });
  }, { guards: [complaintLimit] });

  app.patch('/api/complaints/:id', admin(async c => {
    const guildId = ctx.selectedGuildId(c);
    const id = String(c.params.id || '');
    if (!/^[\w-]{1,64}$/.test(id)) return c.fail(400, 'رقم الشكوى غير صحيح.');
    const complaint = await Complaint.findById(id);
    // الشكوى تنحسم في سيرفرها بس، وما يحسمها الشخص اللي هي عليه.
    if (!complaint || complaint.guildId !== guildId || complaint.status !== 'pending') return c.fail(404, 'الشكوى ما عادت معلّقة.');
    const reviewer = userOf(c).id;
    if (complaint.staffUserId === reviewer) return c.fail(403, 'ما تقدر تراجع شكوى عليك.');
    complaint.status = c.body.status === 'approved' ? 'approved' : 'rejected';
    complaint.penaltyPoints = complaint.status === 'approved' ? Math.min(1000, Math.max(0, Math.floor(Number(c.body.penaltyPoints) || 0))) : 0;
    complaint.reviewedBy = reviewer;
    complaint.reviewedAt = new Date();
    complaint.decisionNote = clean(c.body.note, 1500);
    await complaint.save();
    if (complaint.status === 'approved' && complaint.penaltyPoints > 0) {
      const staff = await Staff.findOne({ guildId, userId: complaint.staffUserId });
      if (staff) { staff.points = Math.max(0, staff.points - complaint.penaltyPoints); await staff.save(); }
    }
    await createLog(guildId, 'COMPLAINT_REVIEWED', complaint.staffUserId, reviewer, { complaintId: complaint.id, status: complaint.status, penaltyPoints: complaint.penaltyPoints });
    const staffUser = await discord.users.fetch(complaint.staffUserId).catch(() => null);
    if (staffUser) await staffUser.send({ content: `تمت مراجعة الشكوى عليك في Rift: **${complaint.status === 'approved' ? 'مقبولة' : 'مرفوضة'}**.${complaint.decisionNote ? `\nملاحظة: ${complaint.decisionNote}` : ''}`, allowedMentions: { parse: [] } }).catch(() => undefined);
    return c.json({ ok: true });
  }), { guards: [writeLimit] });

  // ---- لوحات ديسكورد ------------------------------------------------------------------------------
  app.get('/api/panel/options', admin(async c => {
    const guild = await ctx.getGuild(ctx.selectedGuildId(c));
    const channels = (await guild.channels.fetch()).filter(channel => channel?.isTextBased()).map(channel => ({ id: channel!.id, name: channel!.name ?? channel!.id }));
    return c.json({ channels });
  }));

  app.post('/api/shifts/panel', admin(async c => {
    const guild = await ctx.getGuild(ctx.selectedGuildId(c));
    const channel = await textChannel(guild, c.body.channelId);
    if (!channel) return c.fail(400, 'اختر روم كتابي.');
    const row = await ctx.settingsRow(guild.id).catch(() => null);
    await channel.send(buildShiftPanel({ messages: row?.auto_shift_messages ?? undefined, windowMinutes: row?.auto_shift_window_minutes ?? undefined, idleMinutes: row?.auto_shift_idle_minutes ?? undefined, enabled: row?.auto_shift_enabled !== false }));
    return c.json({ ok: true });
  }), { guards: [panelLimit] });

  const complaintPanelPublishing = new Set<string>();
  app.post('/api/complaints/panel', admin(async c => {
    const guild = await ctx.getGuild(ctx.selectedGuildId(c));
    const channel = await textChannel(guild, c.body.channelId);
    if (!channel) return c.fail(400, 'اختر روم كتابي.');
    if (complaintPanelPublishing.has(channel.id)) return c.fail(409, 'تحديث لوحة الشكاوي شغال الحين.');
    complaintPanelPublishing.add(channel.id);
    try {
      const settings = await ctx.settingsRow(guild.id);
      const payload = buildComplaintPanel(settings?.bot_language === 'en' ? 'en' : 'ar');
      const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
      const panels = [...(messages?.filter(message => message.author.id === discord.user?.id && message.components.some((row: any) => 'components' in row && row.components.some((component: any) => 'customId' in component && component.customId === 'complaint_panel_submit'))).values() ?? [])].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
      const existing = panels[0];
      if (existing) await existing.edit(payload); else await channel.send(payload);
      for (const duplicate of panels.slice(1)) await duplicate.delete().catch(() => undefined);
      return c.json({ ok: true, updated: Boolean(existing), removedDuplicates: Math.max(0, panels.length - 1) });
    } finally { complaintPanelPublishing.delete(channel.id); }
  }), { guards: [panelLimit] });

  app.post('/api/ratings/panel', admin(async c => {
    const guild = await ctx.getGuild(ctx.selectedGuildId(c));
    const channel = await textChannel(guild, c.body.channelId);
    if (!channel) return c.fail(400, 'اختر روم كتابي صحيح.');
    const payload = await buildRatingPanel(guild);
    if (!payload) return c.fail(400, 'لا يوجد ستاف مؤهل للتقييم.');
    await channel.send(payload);
    return c.json({ ok: true });
  }), { guards: [panelLimit] });

  // ---- التقارير اليدوية ---------------------------------------------------------------------------
  app.post('/api/staff-reports', admin(async c => {
    const guildId = ctx.selectedGuildId(c);
    const userId = String(c.body.staffUserId || '');
    if (!isSnowflake(userId)) return c.fail(400, 'اختر الستاف.');
    const requestedStart = new Date(`${String(c.body.periodStart || '').slice(0, 10)}T00:00:00.000Z`);
    const requestedEnd = new Date(`${String(c.body.periodEnd || '').slice(0, 10)}T23:59:59.999Z`);
    const { start, end } = Number.isNaN(requestedStart.getTime()) || Number.isNaN(requestedEnd.getTime()) || requestedEnd < requestedStart ? reportPeriod() : { start: requestedStart, end: requestedEnd };
    const metrics = await staffMetrics(guildId, userId, start, end);
    if (!metrics.staff) return c.fail(404, 'الستاف مو موجود.');
    const complaints = await Complaint.countDocuments({ guildId, staffUserId: userId, status: 'approved' });
    const note = clean(c.body.note, 1500);
    const report = await StaffReport.create({ guildId, staffUserId: userId, authorUserId: userOf(c).id, periodStart: start, periodEnd: end, note, automated: false, shiftHours: metrics.shiftHours, activityHours: metrics.activityHours, activeDays: metrics.activeDays, helped: 0, messageCount: metrics.staff.messageCount, points: metrics.staff.points, voiceHours: metrics.staff.voiceMinutes / 60, complaints, ratingAverage: metrics.ratingAverage, ratingCount: metrics.ratingCount });
    const content = reportText(userId, { points: metrics.staff.points, shiftHours: metrics.shiftHours, activityHours: metrics.activityHours, voiceHours: metrics.staff.voiceMinutes / 60, messageCount: metrics.staff.messageCount, activeDays: metrics.activeDays, complaints, ratingAverage: metrics.ratingAverage, ratingCount: metrics.ratingCount, note });
    const user = await discord.users.fetch(userId).catch(() => null);
    await user?.send({ content, allowedMentions: { parse: [] } }).catch(() => undefined);
    const settings = await ctx.settingsRow(guildId).catch(() => null);
    if (settings?.report_channel_id) {
      const channel = await textChannel(await ctx.getGuild(guildId), settings.report_channel_id);
      if (channel) await channel.send({ content, allowedMentions: { parse: [] } }).catch(() => undefined);
    }
    return c.json({ ok: true, report });
  }), { guards: [dmLimit] });

  app.patch('/api/staff-reports/:id', admin(async c => {
    const guildId = ctx.selectedGuildId(c);
    if (!isIntId(c.params.id)) return c.fail(400, 'رقم التقرير غير صحيح.');
    const id = Number(c.params.id);
    const report = await StaffReport.findOne({ id, guildId });
    if (!report) return c.fail(404, 'التقرير مو موجود.');
    return c.json({ ok: true, report: await StaffReport.update(report.id, { note: clean(c.body.note, 1500) }) });
  }), { guards: [writeLimit] });

  app.delete('/api/staff-reports/:id', admin(async c => {
    const guildId = ctx.selectedGuildId(c);
    if (!isIntId(c.params.id)) return c.fail(400, 'رقم التقرير غير صحيح.');
    const id = Number(c.params.id);
    if (!await StaffReport.findOne({ id, guildId })) return c.fail(404, 'التقرير مو موجود.');
    await StaffReport.deleteMany({ id, guildId });
    return c.json({ ok: true });
  }), { guards: [writeLimit] });
}

// ---- مساعدات ----------------------------------------------------------------------------------------
function reportPeriod() {
  const end = new Date();
  const monday = new Date(end);
  monday.setDate(end.getDate() - ((end.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  const start = new Date(monday);
  start.setDate(start.getDate() - 7);
  const periodEnd = new Date(monday);
  periodEnd.setMilliseconds(-1);
  return { start, end: periodEnd };
}

async function staffMetrics(guildId: string, userId: string, start: Date, end: Date) {
  const [shifts, activities, staff, ratings] = await Promise.all([Shift.find({ guildId, userId }), StaffDailyActivity.find({ guildId, userId }), Staff.findOne({ guildId, userId }), StaffRating.find({ guildId, staffUserId: userId })]);
  const range = shifts.filter(shift => shift.startedAt <= end && (!shift.endedAt || shift.endedAt >= start));
  const activityRange = activities.filter(activity => activity.activityDate >= start && activity.activityDate <= end);
  const shiftHours = range.reduce((sum, shift) => sum + activeDuration(shift), 0) / 3_600_000;
  const activityHours = activityRange.reduce((sum, activity) => sum + activity.activeMinutes, 0) / 60;
  const activeDays = new Set(activityRange.map(activity => activity.activityDate.toISOString().slice(0, 10))).size;
  const ratingCount = ratings.length;
  const ratingAverage = ratingCount ? ratings.reduce((sum, rating) => sum + rating.rating, 0) / ratingCount : 0;
  return { staff, shiftHours, activityHours, activeDays, ratingAverage, ratingCount };
}

function reportText(userId: string, report: { points: number; shiftHours: number; activityHours: number; voiceHours: number; messageCount: number; activeDays: number; complaints: number; ratingAverage: number; ratingCount: number; note?: string }) {
  return [
    `تقرير Rift لـ <@${userId}>`,
    `النقاط: ${report.points}`,
    `ساعات الشفت: ${report.shiftHours.toFixed(1)}`,
    `ساعات النشاط: ${report.activityHours.toFixed(1)}`,
    `ساعات الصوت: ${report.voiceHours.toFixed(1)}`,
    `الرسائل: ${report.messageCount}`,
    `أيام النشاط: ${report.activeDays}`,
    `الشكاوي المعتمدة: ${report.complaints}`,
    `التقييم: ${report.ratingAverage.toFixed(2)}/5 (${report.ratingCount} مقيّم)`,
    report.note ? `ملاحظة: ${report.note}` : '',
  ].filter(Boolean).join('\n');
}

function uniqueRatings<T extends { guildId: string; staffUserId: string; reviewerUserId: string; createdAt: Date }>(rows: T[]) {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const key = `${row.guildId}:${row.staffUserId}:${row.reviewerUserId}`;
    const current = latest.get(key);
    if (!current || row.createdAt.getTime() > current.createdAt.getTime()) latest.set(key, row);
  }
  return [...latest.values()];
}

export function activeDuration(shift: any) {
  const startedAt = new Date(shift.startedAt).getTime();
  if (!Number.isFinite(startedAt)) return 0;
  const end = new Date(shift.endedAt ?? new Date()).getTime();
  const breaks = (shift.breaks ?? []).reduce((sum: number, item: any) => {
    const breakStart = new Date(item.startedAt).getTime();
    const breakEnd = new Date(item.endedAt ?? shift.endedAt ?? new Date()).getTime();
    return Number.isFinite(breakStart) && Number.isFinite(breakEnd) ? sum + Math.max(0, breakEnd - breakStart) : sum;
  }, 0);
  return Number.isFinite(end) ? Math.max(0, end - startedAt - breaks) : 0;
}
