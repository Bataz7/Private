import type { Client, GuildMember } from '../lib/djs/index.js';
import { env } from '../config/env.js';
import { supabase } from '../supabase/client.js';
import { getSettings } from './settings.service.js';
import { createLog } from './log.service.js';
import { ensureStaff } from './shift.service.js';
import { changePoints } from './staff-points.js';
import { V2_FLAG, button, clip, container, quote, row, rtl, section, separator, text, thumbnail, ts, type Raw } from '../utils/v2.js';

export const ACTIONS = ['warn', 'mute', 'kick', 'ban', 'unban', 'other'] as const;
export type ModAction = typeof ACTIONS[number];
export type ModLanguage = 'ar' | 'en' | 'both';
export type PanelLanguage = 'ar' | 'en';
export const PANEL_LANGUAGES: PanelLanguage[] = ['ar', 'en'];
export type ReportStatus = 'pending' | 'approved' | 'rejected';
type PanelRef = { channelId: string; messageId: string };

export interface ModReportSettings {
  enabled: boolean;
  // Language of the review cards posted to the review channel. Each panel has its own language.
  language: PanelLanguage;
  color: string;
  reviewChannelId: string;
  pingRoleId: string;
  reporterRoleIds: string[];
  actionRoles: Record<'mute' | 'kick' | 'ban', string[]>;
  requireEvidence: ModAction[];
  approvePoints: number;
  rejectPoints: number;
  dmModerator: boolean;
  // One separate panel per language (Arabic and English are never merged into one message).
  panels: Record<PanelLanguage, PanelRef>;
}

export interface ModReportNote { text: string; userId: string; name: string; createdAt: Date }
export interface ModReportDoc {
  id: string; guildId: string; number: number;
  moderatorId: string; moderatorName: string;
  targetUserId: string; targetTag: string; targetAvatar: string;
  action: ModAction; reason: string; duration: string; evidence: string; flags: string[];
  status: ReportStatus;
  reviewedBy: string | null; reviewedAt: Date | null; pointsApplied: number;
  notes: ModReportNote[];
  reviewChannelId: string; reviewMessageId: string;
  // Language of the panel the moderator used; their result DM follows it.
  lang: PanelLanguage;
  createdAt: Date; updatedAt: Date;
  /** Raw updated_at, used for optimistic updates. */
  version: string;
}

// ---- Database ----------------------------------------------------------------------------------

const REPORTS = 'mod_reports';
const SETTINGS = 'mod_report_settings';

export class ModReportsSetupError extends Error {
  constructor() { super('تقارير الإدارة ما انضبطت للحين. شغّل supabase/migrations/032_mod_reports.sql في محرر SQL في Supabase.'); }
}
export const isSetupError = (error: unknown): error is ModReportsSetupError => error instanceof ModReportsSetupError;
const isMissing = (error: { code?: string; message?: string }) => ['PGRST205', '42P01', 'PGRST202', '42883'].includes(String(error.code)) || /schema cache|does not exist/i.test(String(error.message));

const WHAT_AR: Record<string, string> = { read: 'القراءة', count: 'العد', list: 'القائمة', stats: 'الإحصائيات', history: 'السجل', delete: 'الحذف', insert: 'الحفظ', decision: 'القرار', reopen: 'إعادة الفتح', note: 'الملاحظة', 'settings save': 'حفظ الإعدادات' };
function check<T>(result: { data: T; error: { code?: string; message: string } | null }, what: string): T {
  if (result.error) {
    if (isMissing(result.error)) throw new ModReportsSetupError();
    throw new Error(`تقارير الإدارة: فشل ${WHAT_AR[what] || what}: ${result.error.message}`);
  }
  return result.data;
}

const list = (value: unknown): any[] => (Array.isArray(value) ? value : []);
function fromRow(r: any): ModReportDoc {
  return {
    id: String(r.id), guildId: r.guild_id, number: r.number,
    moderatorId: r.moderator_id, moderatorName: r.moderator_name || '',
    targetUserId: r.target_user_id, targetTag: r.target_tag || '', targetAvatar: r.target_avatar || '',
    action: r.action, reason: r.reason, duration: r.duration || '', evidence: r.evidence || '', flags: list(r.flags).map(String),
    status: r.status, reviewedBy: r.reviewed_by || null, reviewedAt: r.reviewed_at ? new Date(r.reviewed_at) : null, pointsApplied: Number(r.points_applied) || 0,
    notes: list(r.notes).map(note => ({ text: String(note?.text || ''), userId: String(note?.userId || ''), name: String(note?.name || ''), createdAt: new Date(note?.createdAt || r.created_at) })),
    reviewChannelId: r.review_channel_id || '', reviewMessageId: r.review_message_id || '',
    lang: 'ar',
    createdAt: new Date(r.created_at), updatedAt: new Date(r.updated_at), version: String(r.updated_at),
  };
}

// ---- Settings ----------------------------------------------------------------------------------

const SNOWFLAKE = /^\d{15,22}$/;
const emptyPanel = (): PanelRef => ({ channelId: '', messageId: '' });
export const DEFAULT_MOD_SETTINGS: ModReportSettings = {
  enabled: true, language: 'ar', color: '#8175f5', reviewChannelId: '', pingRoleId: '', reporterRoleIds: [],
  actionRoles: { mute: [], kick: [], ban: [] }, requireEvidence: ['ban'], approvePoints: 1, rejectPoints: 0, dmModerator: true,
  panels: { ar: emptyPanel(), en: emptyPanel() },
};
const panelRef = (value: any): PanelRef => ({ channelId: SNOWFLAKE.test(String(value?.channelId || '')) ? String(value.channelId) : '', messageId: SNOWFLAKE.test(String(value?.messageId || '')) ? String(value.messageId) : '' });
const ids = (value: unknown) => [...new Set((Array.isArray(value) ? value : []).map(String).filter(item => SNOWFLAKE.test(item)))].slice(0, 20);
const int = (value: unknown, min: number, max: number, fallback: number) => { const n = Math.round(Number(value)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback; };

export function modSettings(raw: unknown): ModReportSettings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const roles = s.actionRoles && typeof s.actionRoles === 'object' ? s.actionRoles : {};
  return {
    enabled: s.enabled !== false,
    // البوت عربي دائمًا.
    language: 'ar',
    color: /^#[0-9a-f]{6}$/i.test(String(s.color || '')) ? String(s.color).toLowerCase() : DEFAULT_MOD_SETTINGS.color,
    reviewChannelId: SNOWFLAKE.test(String(s.reviewChannelId || '')) ? String(s.reviewChannelId) : '',
    pingRoleId: SNOWFLAKE.test(String(s.pingRoleId || '')) ? String(s.pingRoleId) : '',
    reporterRoleIds: ids(s.reporterRoleIds),
    actionRoles: { mute: ids(roles.mute), kick: ids(roles.kick), ban: ids(roles.ban) },
    requireEvidence: (Array.isArray(s.requireEvidence) ? s.requireEvidence : DEFAULT_MOD_SETTINGS.requireEvidence).filter((item: string) => (ACTIONS as readonly string[]).includes(item)),
    approvePoints: int(s.approvePoints, 0, 100, DEFAULT_MOD_SETTINGS.approvePoints),
    rejectPoints: int(s.rejectPoints, 0, 100, 0),
    dmModerator: s.dmModerator !== false,
    panels: { ar: panelRef(s.panels?.ar), en: panelRef(s.panels?.en) },
  };
}

/** Settings of a server. Without the migration this quietly returns the defaults so the panel preview keeps working. */
export async function getModSettings(guildId: string) {
  const { data, error } = await supabase.from(SETTINGS).select('settings').eq('guild_id', guildId).maybeSingle();
  if (error && !isMissing(error)) throw new Error(`ما قدرنا نقرأ إعدادات تقارير الإدارة: ${error.message}`);
  return modSettings(data?.settings);
}

async function writeSettings(guildId: string, settings: ModReportSettings) {
  check(await supabase.from(SETTINGS).upsert({ guild_id: guildId, settings, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' }), 'settings save');
  return settings;
}

export async function saveModSettings(guildId: string, raw: unknown) {
  const current = await getModSettings(guildId);
  return writeSettings(guildId, { ...modSettings(raw), panels: current.panels });
}

async function savePanelRef(guildId: string, lang: PanelLanguage, ref: PanelRef) {
  const current = await getModSettings(guildId);
  return writeSettings(guildId, { ...current, panels: { ...current.panels, [lang]: ref } });
}

// ---- Language ----------------------------------------------------------------------------------

const ACTION_META: Record<ModAction, { emoji: string; ar: string; en: string }> = {
  warn: { emoji: '⚠️', ar: 'تحذير', en: 'Warn' },
  mute: { emoji: '🔇', ar: 'ميوت / تايم أوت', en: 'Mute / Timeout' },
  kick: { emoji: '👢', ar: 'طرد', en: 'Kick' },
  ban: { emoji: '🔨', ar: 'باند', en: 'Ban' },
  unban: { emoji: '🔓', ar: 'فك باند', en: 'Unban' },
  other: { emoji: '📌', ar: 'إجراء آخر', en: 'Other' },
};
// البوت عربي دائمًا: التسميات والنصوص ترجع بالعربي مهما كانت اللغة الممرّرة.
export const actionLabel = (action: ModAction, _lang?: ModLanguage) => `${ACTION_META[action].emoji} ${ACTION_META[action].ar}`;
export const actionOptions = (lang: ModLanguage) => ACTIONS.map(action => ({ value: action, label: actionLabel(action, lang).slice(0, 100), emoji: ACTION_META[action].emoji }));
export const L = (_lang: ModLanguage, ar: string, _en: string) => ar;
export const pad = (n: number) => `#${String(n).padStart(4, '0')}`;
const hex = (color: string) => parseInt(color.replace('#', ''), 16);
const COLORS = { pending: 0x8175f5, approved: 0x4fc08d, rejected: 0xe9697b };

// ---- Panel -------------------------------------------------------------------------------------

function panelBlock(_lang: PanelLanguage, s: ModReportSettings, guildName: string) {
  const roles = (items: string[], fallback: string) => (items.length ? items.map(id => `<@&${id}>`).join(' ') : fallback);
  return [
    `# 🛡️ ${guildName} • تقارير الإدارة`,
    'هلا بفريق الإدارة! 👋\nأي إجراء إداري تسويه **لازم توثّقه هنا** عشان تراجعه الإدارة العليا.',
    `### ⚠️ متى تقدّم تقرير\n> 🔇 **ميوت / تايم أوت** — ${roles(s.actionRoles.mute, 'جميع الإداريين')}\n> 👢 **طرد** — ${roles(s.actionRoles.kick, 'الإدارة الرئيسية فما فوق')}\n> 🔨 **باند** — ${roles(s.actionRoles.ban, 'الإدارة العليا والأدمن')}`,
    '### 📝 محتوى التقرير\n**آيدي العضو** · **الإجراء** · **السبب** · **المدة** *(للميوت فقط)* · **الدليل**',
    '### ✅ مراجعة الإدارة العليا\n> ✅ **مقبول** — الإجراء والتقرير صحيحين.\n> ❌ **مرفوض** — فيه خطأ أو الإجراء يحتاج مراجعة.',
    '-# 💡 التقرير ما يتعدّل بعد ما ترسله. اكتب تقريرك بوضوح ودقة وأمانة.',
  ];
}

export function buildModPanel(s: ModReportSettings, guildName: string, lang: PanelLanguage) {
  const parts: Raw[] = [];
  panelBlock(lang, s, guildName).forEach((line, index) => {
    if (index > 1) parts.push(separator(index === 2));
    parts.push(text(rtl(line)));
  });
  parts.push(separator(true, true));
  // The panel's language travels in the custom id, so the form and the moderator's DM use the same language.
  parts.push(row([
    button({ id: `mr_open:${lang}`, label: 'تقديم تقرير', style: 'primary', emoji: '📝', disabled: !s.enabled }),
    button({ id: `mr_mine:${lang}`, label: 'تقاريري', style: 'secondary', emoji: '📋' }),
  ]));
  return { components: [container(parts, hex(s.color))], flags: V2_FLAG, allowedMentions: { parse: [] as never[] } };
}

// ---- Review card -------------------------------------------------------------------------------

// A card holds 4000 characters in total and every line gets a prefix: blank lines and long line lists are squeezed first.
const lines = (value: string, max: number) => String(value || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(0, max).join('\n');

export function buildReviewCard(report: ModReportDoc, s: ModReportSettings, forDm = false, language?: PanelLanguage) {
  const lang: PanelLanguage = language || s.language;
  const t = (value: string) => rtl(value);
  const status = report.status === 'pending'
    ? `🕒 **${L(lang, 'بانتظار المراجعة', 'Pending review')}**`
    : `${report.status === 'approved' ? '✅' : '❌'} **${report.status === 'approved' ? L(lang, 'مقبول', 'Approved') : L(lang, 'مرفوض', 'Rejected')}** · <@${report.reviewedBy}> ${report.reviewedAt ? ts(report.reviewedAt) : ''}`;
  const avatar = report.targetAvatar || 'https://cdn.discordapp.com/embed/avatars/0.png';
  const parts: Raw[] = [
    section([
      `## 🛡️ ${L(lang, 'تقرير', 'Report')} ${pad(report.number)} · ${actionLabel(report.action, lang)}`,
      `**${L(lang, 'المشرف', 'Moderator')}:** <@${report.moderatorId}>\n**${L(lang, 'العضو', 'User')}:** <@${report.targetUserId}> · \`${report.targetUserId}\`${report.targetTag ? ` · ${report.targetTag}` : ''}`,
    ].map(t), thumbnail(avatar)),
    separator(),
    text(t(`**${L(lang, 'السبب', 'Reason')}**\n${quote(clip(lines(report.reason, 12), 800))}`)),
  ];
  const extra: string[] = [];
  if (report.duration) extra.push(`**${L(lang, 'المدة', 'Duration')}:** ${clip(report.duration, 60)}`);
  if (report.evidence) extra.push(`**${L(lang, 'الدليل', 'Evidence')}**\n${clip(lines(report.evidence, 8), 700)}`);
  if (extra.length) parts.push(text(t(extra.join('\n'))));
  if (report.flags.length && !forDm) parts.push(text(report.flags.map(flag => `-# ⚠️ ${flag}`).join('\n')));
  parts.push(separator(), text(t(status)));
  if (report.notes.length) parts.push(text(`📝 **${L(lang, 'ملاحظات', 'Notes')}**\n${report.notes.slice(-5).map(note => `> <@${note.userId}> ${ts(note.createdAt)}\n> ${clip(lines(note.text, 4), 200).replace(/\n/g, '\n> ')}`).join('\n')}`));
  parts.push(text(t(`-# ${L(lang, 'أُرسل', 'Submitted')} ${ts(report.createdAt, 'f')} · ${pad(report.number)}`)));
  if (!forDm) {
    const link = /^https?:\/\//.test(env.dashboardUrl) ? [button({ url: `${env.dashboardUrl}/dashboard/modreports?id=${report.id}`, label: 'لوحة التحكم' })] : [];
    const note = button({ id: `mr_note:${report.id}`, label: L(lang, 'ملاحظة', 'Note'), emoji: '📝' });
    parts.push(row(report.status === 'pending'
      ? [button({ id: `mr_approve:${report.id}`, label: L(lang, 'قبول', 'Approve'), style: 'success', emoji: '✅' }), button({ id: `mr_reject:${report.id}`, label: L(lang, 'رفض', 'Reject'), style: 'danger', emoji: '✖️' }), note, ...link]
      : [note, button({ id: `mr_reopen:${report.id}`, label: L(lang, 'إعادة فتح', 'Reopen'), emoji: '↩️' }), ...link]));
  }
  return { components: [container(parts, COLORS[report.status])], flags: V2_FLAG, allowedMentions: { parse: [] as never[] } };
}

async function refreshCard(client: Client, report: ModReportDoc) {
  if (!report.reviewChannelId || !report.reviewMessageId) return false;
  const channel: any = await client.channels.fetch(report.reviewChannelId).catch(() => null);
  const message = channel?.messages ? await channel.messages.fetch(report.reviewMessageId).catch(() => null) : null;
  if (!message) return false;
  const { flags, ...payload } = buildReviewCard(report, await getModSettings(report.guildId));
  return message.edit(payload).then(() => true).catch(() => false);
}

// ---- Permissions -------------------------------------------------------------------------------

export async function canReport(member: GuildMember, s: ModReportSettings) {
  if (member.guild.ownerId === member.id || member.permissions.has('Administrator')) return true;
  const settings = await getSettings(member.guild.id).catch(() => null);
  const allowed = s.reporterRoleIds.length ? s.reporterRoleIds : [settings?.staffRoleId, settings?.managementRoleId].filter(Boolean) as string[];
  return allowed.some(id => member.roles.cache.has(id));
}

// Only the server owner and Administrators approve, reject, reopen or add notes.
export function canReviewModReports(member: GuildMember) {
  return member.guild.ownerId === member.id || member.permissions.has('Administrator');
}

async function assertAdministrator(client: Client, guildId: string, userId: string) {
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) throw new Error('ما لقينا السيرفر.');
  if (guild.ownerId === userId) return;
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member?.permissions.has('Administrator')) throw new Error('تحتاج صلاحية أدمن.');
}

// ---- Reads -------------------------------------------------------------------------------------

export async function getModReport(id: string) {
  if (!/^\d{1,18}$/.test(String(id || ''))) return null;
  const row = check(await supabase.from(REPORTS).select('*').eq('id', id).maybeSingle(), 'read');
  return row ? fromRow(row) : null;
}

export async function moderatorSummary(guildId: string, moderatorId: string) {
  const totals = await Promise.all((['pending', 'approved', 'rejected'] as const).map(async status => {
    const result = await supabase.from(REPORTS).select('id', { count: 'exact', head: true }).eq('guild_id', guildId).eq('moderator_id', moderatorId).eq('status', status);
    check(result, 'count');
    return result.count ?? 0;
  }));
  const rows = check(await supabase.from(REPORTS).select('*').eq('guild_id', guildId).eq('moderator_id', moderatorId).order('created_at', { ascending: false }).limit(10), 'list') as any[];
  return { pending: totals[0]!, approved: totals[1]!, rejected: totals[2]!, rows: rows.map(fromRow) };
}

export interface ReportFilter { status?: string; action?: string; q?: string; page?: number }
export const REPORTS_PAGE_SIZE = 30;

export async function listModReports(guildId: string, filter: ReportFilter) {
  const page = Math.max(1, Number(filter.page) || 1);
  let query = supabase.from(REPORTS).select('*', { count: 'exact' }).eq('guild_id', guildId);
  if (filter.status && ['pending', 'approved', 'rejected'].includes(filter.status)) query = query.eq('status', filter.status);
  if ((ACTIONS as readonly string[]).includes(String(filter.action))) query = query.eq('action', filter.action as string);
  // The value goes into a PostgREST "or" expression, so anything that could change its structure is removed first.
  const q = String(filter.q || '').trim().slice(0, 60).replace(/[,()*%\\"':]/g, ' ').trim();
  if (q) {
    const number = Number(q.replace(/^#/, ''));
    const terms = [`target_user_id.eq.${q}`, `moderator_id.eq.${q}`, `moderator_name.ilike.*${q}*`, `target_tag.ilike.*${q}*`, `reason.ilike.*${q}*`];
    if (Number.isInteger(number) && number > 0 && number < 2_000_000_000) terms.push(`number.eq.${number}`);
    query = query.or(terms.join(','));
  }
  const result = await query.order('created_at', { ascending: false }).range((page - 1) * REPORTS_PAGE_SIZE, page * REPORTS_PAGE_SIZE - 1);
  const rows = check(result, 'list') as any[];
  const total = result.count ?? rows.length;
  return { total, page, hasMore: page * REPORTS_PAGE_SIZE < total, rows: rows.map(fromRow) };
}

export async function modReportOverview(guildId: string) {
  const DAY = 86_400_000;
  const count = async (status: ReportStatus) => {
    const result = await supabase.from(REPORTS).select('id', { count: 'exact', head: true }).eq('guild_id', guildId).eq('status', status);
    check(result, 'count');
    return result.count ?? 0;
  };
  const [pending, approved, rejected, recent, week] = await Promise.all([
    count('pending'), count('approved'), count('rejected'),
    supabase.from(REPORTS).select('action').eq('guild_id', guildId).gte('created_at', new Date(Date.now() - 30 * DAY).toISOString()).limit(5000),
    supabase.from(REPORTS).select('moderator_id,status').eq('guild_id', guildId).gte('created_at', new Date(Date.now() - 7 * DAY).toISOString()).limit(5000),
  ]);
  const actions = Object.fromEntries(ACTIONS.map(action => [action, 0])) as Record<ModAction, number>;
  for (const item of check(recent, 'stats') as any[]) if (item.action in actions) actions[item.action as ModAction] += 1;
  const byModerator = new Map<string, { userId: string; n: number; approved: number; rejected: number }>();
  for (const item of check(week, 'stats') as any[]) {
    const entry = byModerator.get(item.moderator_id) ?? { userId: item.moderator_id, n: 0, approved: 0, rejected: 0 };
    entry.n += 1;
    if (item.status === 'approved') entry.approved += 1;
    if (item.status === 'rejected') entry.rejected += 1;
    byModerator.set(item.moderator_id, entry);
  }
  return { totals: { pending, approved, rejected }, actions, top: [...byModerator.values()].sort((a, b) => b.n - a.n).slice(0, 8) };
}

export async function modReportHistory(report: ModReportDoc) {
  const rows = check(await supabase.from(REPORTS).select('id,number,action,status,created_at,moderator_name').eq('guild_id', report.guildId).eq('target_user_id', report.targetUserId).neq('id', report.id).order('created_at', { ascending: false }).limit(10), 'history') as any[];
  return rows.map(item => ({ id: String(item.id), number: item.number, action: item.action, status: item.status, createdAt: item.created_at, moderator: item.moderator_name || '' }));
}

export async function deleteModReport(id: string) {
  check(await supabase.from(REPORTS).delete().eq('id', id), 'delete');
}

// ---- Lifecycle ---------------------------------------------------------------------------------

export async function createModReport(client: Client, member: GuildMember, input: { targetUserId: string; action: ModAction; reason: string; duration: string; evidence: string; lang?: PanelLanguage }) {
  const s = await getModSettings(member.guild.id);
  const target = await client.users.fetch(input.targetUserId).catch(() => null);
  const flags: string[] = [];
  const allowedRoles = (s.actionRoles as Record<string, string[]>)[input.action] || [];
  if (allowedRoles.length && !allowedRoles.some(id => member.roles.cache.has(id)) && !member.permissions.has('Administrator')) flags.push(`رتبة المشرف مو ضمن الرتب المسموح لها بـ ${ACTION_META[input.action]?.ar || input.action}.`);
  if (target && target.id === member.id) flags.push('المشرف رفع تقرير على إجراء ضد نفسه.');
  const earlier = await supabase.from(REPORTS).select('id', { count: 'exact', head: true }).eq('guild_id', member.guild.id).eq('target_user_id', input.targetUserId);
  check(earlier, 'count');
  if (earlier.count) flags.push(`فيه ${earlier.count} تقرير سابق على هذا العضو.`);
  // The database assigns the number inside the insert (see migration 032), so it is sequential even under load.
  let report = fromRow(check(await supabase.from(REPORTS).insert({
    guild_id: member.guild.id, moderator_id: member.id, moderator_name: member.displayName,
    target_user_id: input.targetUserId, target_tag: target ? `@${target.username}` : '', target_avatar: target?.displayAvatarURL({ extension: 'png', size: 128 }) || '',
    action: input.action, reason: input.reason, duration: input.duration, evidence: input.evidence, flags, lang: input.lang || s.language,
  }).select('*').single(), 'insert'));
  const guildSettings = await getSettings(member.guild.id).catch(() => null);
  const channelId = s.reviewChannelId || guildSettings?.logsChannelId || '';
  const channel: any = channelId ? await client.channels.fetch(channelId).catch(() => null) : null;
  if (channel?.isTextBased?.() && 'send' in channel && channel.guildId === member.guild.id) {
    const card = buildReviewCard(report, s);
    if (s.pingRoleId) card.components.unshift(text(`<@&${s.pingRoleId}>`));
    const message = await channel.send({ ...card, allowedMentions: { roles: s.pingRoleId ? [s.pingRoleId] : [] } }).catch((error: unknown) => { console.error('Mod report post failed:', error); return null; });
    if (message) {
      const saved = await supabase.from(REPORTS).update({ review_channel_id: channel.id, review_message_id: message.id }).eq('id', report.id).select('*').single();
      if (!saved.error) report = fromRow(saved.data);
    }
  }
  await createLog(member.guild.id, 'MOD_REPORT_SUBMITTED', member.id, member.id, { reportId: report.id, number: report.number, action: report.action, targetUserId: report.targetUserId }).catch(() => undefined);
  return report;
}

async function adjustPoints(guildId: string, userId: string, delta: number) {
  if (!delta) return;
  // One atomic update clamped at zero, recorded in the points ledger (so the dashboard shows where the points came from).
  const change = () => changePoints({ guildId, userId, delta, source: 'modreport', reason: delta > 0 ? 'قبول تقرير إداري' : 'رفض تقرير إداري أو إعادة فتحه' });
  if (await change() === null) {
    await ensureStaff(guildId, userId);
    await change();
  }
}

export async function decideModReport(client: Client, id: string, decision: 'approved' | 'rejected', reviewer: { id: string; name?: string }, note = '') {
  const existing = await getModReport(id);
  if (!existing) throw new Error('ما لقينا التقرير.');
  await assertAdministrator(client, existing.guildId, reviewer.id);
  const s = await getModSettings(existing.guildId);
  const delta = decision === 'approved' ? s.approvePoints : -s.rejectPoints;
  const clean = note.trim().slice(0, 1000);
  const update: Record<string, unknown> = { status: decision, reviewed_by: reviewer.id, reviewed_at: new Date().toISOString(), points_applied: delta };
  if (clean) update.notes = [...existing.notes, { text: clean, userId: reviewer.id, name: reviewer.name || '', createdAt: new Date().toISOString() }];
  // Atomic: only a pending report can be decided, so two reviewers cannot both apply points.
  const saved = check(await supabase.from(REPORTS).update(update).eq('id', existing.id).eq('status', 'pending').select('*'), 'decision') as any[];
  if (!saved.length) throw new Error('هذا التقرير انراجع من قبل.');
  const report = fromRow(saved[0]);
  await adjustPoints(report.guildId, report.moderatorId, delta);
  await refreshCard(client, report);
  let dmSent = false;
  if (s.dmModerator) {
    const user = await client.users.fetch(report.moderatorId).catch(() => null);
    const dmLang: PanelLanguage = report.lang || s.language;
    const card = buildReviewCard(report, s, true, dmLang);
    const headline = decision === 'approved' ? `✅ ${L(dmLang, 'تم قبول تقريرك', 'Your report was approved')}${delta ? ` · +${delta} ${L(dmLang, 'نقطة', 'pts')}` : ''}` : `❌ ${L(dmLang, 'تم رفض تقريرك', 'Your report was rejected')}${delta ? ` · ${delta} ${L(dmLang, 'نقطة', 'pts')}` : ''}`;
    card.components.unshift(text(rtl(headline)));
    dmSent = Boolean(user && await user.send(card).then(() => true).catch(() => false));
  }
  await createLog(report.guildId, decision === 'approved' ? 'MOD_REPORT_APPROVED' : 'MOD_REPORT_REJECTED', report.moderatorId, reviewer.id, { reportId: report.id, number: report.number }).catch(() => undefined);
  return { report, dmSent };
}

export async function reopenModReport(client: Client, id: string, actorId: string) {
  const existing = await getModReport(id);
  if (!existing || existing.status === 'pending') throw new Error('هذا التقرير أصلًا ينتظر المراجعة.');
  await assertAdministrator(client, existing.guildId, actorId);
  const saved = check(await supabase.from(REPORTS).update({ status: 'pending', reviewed_by: null, reviewed_at: null, points_applied: 0 }).eq('id', existing.id).eq('status', existing.status).select('*'), 'reopen') as any[];
  if (!saved.length) throw new Error('التقرير تغيّر، حدّث الصفحة وجرّب مرة ثانية.');
  const report = fromRow(saved[0]);
  await adjustPoints(report.guildId, report.moderatorId, -existing.pointsApplied);
  await refreshCard(client, report);
  await createLog(report.guildId, 'MOD_REPORT_REOPENED', report.moderatorId, actorId, { reportId: report.id, number: report.number }).catch(() => undefined);
  return report;
}

export async function addModReportNote(client: Client, id: string, author: { id: string; name?: string }, note: string) {
  const clean = note.trim().slice(0, 1000);
  if (!clean) throw new Error('اكتب الملاحظة أول.');
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const target = await getModReport(id);
    if (!target) throw new Error('ما لقينا التقرير.');
    await assertAdministrator(client, target.guildId, author.id);
    const notes = [...target.notes, { text: clean, userId: author.id, name: author.name || '', createdAt: new Date().toISOString() }];
    // Only writes when nobody changed the report in the meantime, otherwise reads it again and retries.
    const saved = check(await supabase.from(REPORTS).update({ notes }).eq('id', target.id).eq('updated_at', target.version).select('*'), 'note') as any[];
    if (saved.length) { const report = fromRow(saved[0]); await refreshCard(client, report); return report; }
  }
  throw new Error('التقرير ينعدّل الحين، جرّب مرة ثانية.');
}

export async function publishModPanel(client: Client, guildId: string, channelId: string, lang: PanelLanguage) {
  const s = await getModSettings(guildId);
  const channel: any = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.() || !('send' in channel) || channel.guildId !== guildId) throw new Error('اختر روم كتابي في هذا السيرفر.');
  const payload = buildModPanel(s, channel.guild?.name || 'Rift', lang);
  const current = s.panels[lang];
  if (current.messageId && current.channelId === channelId) {
    const existing = await channel.messages.fetch(current.messageId).catch(() => null);
    if (existing) { const { flags, ...edit } = payload; await existing.edit(edit); return { updated: true }; }
  }
  const message = await channel.send(payload);
  await savePanelRef(guildId, lang, { channelId, messageId: message.id });
  return { updated: false };
}

// Re-renders every posted panel (both languages) after settings change.
export async function refreshModPanel(client: Client, guildId: string) {
  const s = await getModSettings(guildId);
  let refreshed = false;
  for (const lang of PANEL_LANGUAGES) {
    const ref = s.panels[lang];
    if (ref.channelId && ref.messageId) refreshed = (await publishModPanel(client, guildId, ref.channelId, lang).then(() => true).catch(() => false)) || refreshed;
  }
  return refreshed;
}
