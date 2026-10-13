// معاينة الواجهة بدون البوت: يقدّم web-dist مع قالب HTML وبيانات API تجريبية.
//   bun scripts/web-preview.ts [--port 4173] [--member]   (--member = عضو ستاف بدون صلاحيات إدارة)
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildWeb, type WebManifest } from '../src/web/build.ts';

const root = resolve(import.meta.dir, '..');
const dist = join(root, 'web-dist');
const port = Number(process.argv[process.argv.indexOf('--port') + 1]) || 4173;
const member = process.argv.includes('--member');
const manifest: WebManifest = existsSync(join(dist, 'manifest.json')) && !process.argv.includes('--build') ? JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8')) : await buildWeb({ quiet: true });

const DAY = 86_400_000;
const now = Date.now();
const iso = (offset: number) => new Date(now - offset).toISOString();
const names = ['نورة', 'فهد', 'سارة', 'عبدالله', 'ريم', 'خالد', 'لمى', 'تركي', 'جود', 'مشعل', 'هيا', 'ماجد', 'Alex', 'Omar'];
const avatar = (i: number) => `https://cdn.discordapp.com/embed/avatars/${i % 6}.png`;
const staff = names.map((name, i) => ({
  userId: String(900000000000000000n + BigInt(i * 7919)), username: name === 'Alex' || name === 'Omar' ? name.toLowerCase() : `user_${i}`, displayName: name, avatar: i % 4 === 3 ? '' : avatar(i), banner: '',
  joinedAt: iso((i + 3) * 9 * DAY), points: 1240 - i * 83 + (i % 3) * 17, weekPoints: 180 - i * 11, messageCount: 4200 - i * 260, voiceMinutes: 2600 - i * 150, activityHours: 120 - i * 7, complaintCount: i % 5 === 0 ? 1 : 0,
  ratingCount: 14 - i, averageRating: 4.8 - i * 0.12, shiftHours: 96 - i * 6.3, active: i < 4, status: i === 6 ? 'on_leave' : 'active', rank: i < 2 ? 'مشرف أول' : i < 6 ? 'مشرف' : '', claimed: 40 - i * 2,
  notes: i === 0 ? [{ text: 'ممتازة في التعامل مع الأعضاء الجدد.', addedBy: 'admin', createdAt: iso(2 * DAY) }] : [],
}));
const dismissedRow = { ...staff[12]!, userId: '900000000000999999', displayName: 'Ziyad', username: 'ziyad', dismissed: true, dismissedAt: iso(3 * DAY), dismissReason: 'غياب متكرر بدون عذر', active: false };
const shifts = staff.slice(0, 4).map((s, i) => ({ id: `s${i}`, userId: s.userId, status: 'active', startedAt: iso((i + 1) * 47 * 60_000), breaks: i === 2 ? [{ startedAt: iso(10 * 60_000), endedAt: null }] : [], interactionMessageCount: 34 - i * 5, pointsAwarded: 0 }))
  .concat(staff.slice(0, 8).map((s, i) => ({ id: `e${i}`, userId: s.userId, status: 'ended', startedAt: iso((i + 1) * DAY), endedAt: iso((i + 1) * DAY - 3 * 3_600_000), breaks: [], interactionMessageCount: 50, pointsAwarded: 12 } as any)));
const complaints = [
  { id: 'c1', staffUserId: staff[3]!.userId, reporterUserId: '111', reason: 'تأخر في الرد على تذكرة دعم لأكثر من ساعة بدون أي توضيح.', evidence: 'https://example.com/shot.png', status: 'pending', createdAt: iso(5 * 3_600_000), penaltyPoints: 5 },
  { id: 'c2', staffUserId: staff[5]!.userId, reporterUserId: '112', reason: 'أسلوب غير لائق مع عضو جديد.', status: 'approved', createdAt: iso(4 * DAY), penaltyPoints: 10, reviewedBy: staff[0]!.userId, reviewedAt: iso(3 * DAY) },
];
const leaves = [
  { id: 'l1', userId: staff[7]!.userId, reason: 'سفر عائلي لمدة أسبوع.', status: 'pending', startDate: iso(-2 * DAY), endDate: iso(-9 * DAY), createdAt: iso(2 * 3_600_000) },
  { id: 'l2', userId: staff[6]!.userId, reason: 'اختبارات نهائية.', status: 'approved', startDate: iso(2 * DAY), endDate: iso(-5 * DAY), createdAt: iso(6 * DAY), reviewedBy: staff[0]!.userId, reviewedAt: iso(5 * DAY) },
];
const resignations = [{ id: 'r1', userId: staff[9]!.userId, reason: 'ضغط الدراسة وما عندي وقت كافي.', notes: '', status: 'pending', lastWorkingDay: iso(-6 * DAY), createdAt: iso(DAY) }];
const ratings = staff.slice(0, 6).flatMap((s, i) => [5, 4, 5].map((rating, j) => ({ id: `${i}-${j}`, staffUserId: s.userId, reviewerUserId: `r${j}`, reviewerName: ['ماجد', 'سلمان', 'Lina'][j], rating: rating - (i % 2), comment: j === 0 ? 'سريع ومحترم، شكرًا على المساعدة!' : '', createdAt: iso((j + 1) * DAY) })));
const people = Object.fromEntries(staff.map(s => [s.userId, { displayName: s.displayName, username: s.username, avatar: s.avatar }]));
const user = { id: member ? staff[4]!.userId : staff[0]!.userId, username: member ? 'ريم' : 'نورة', avatar: avatar(member ? 4 : 0), isOwner: !member, isAdministrator: !member, isManagement: !member, isStaff: true };
const roles = ['الإدارة', 'المشرفين', 'الستاف', 'في الشفت', 'إجازة', 'متقدم', 'VIP'].map((name, i) => ({ id: `70${i}000000000000000`, name, color: ['#e9697b', '#8175f5', '#4fc08d', '#e0b04f', '#6db4d4', '#000000', '#f0866a'][i], manageable: i > 0, dangerous: i === 0 }));
const channels = ['الإعلانات', 'الشفتات', 'السجلات', 'الشكاوى', 'التقييمات', 'التقارير', 'الطلبات', 'لوحة-المتصدرين'].map((name, i) => ({ id: `80${i}000000000000000`, name }));
const days = Array.from({ length: 14 }, (_, i) => ({ date: new Date(now - (13 - i) * DAY).toISOString().slice(0, 10), minutes: 300 + ((i * 97) % 400), messages: 400 + ((i * 131) % 600), shiftHours: Math.round((12 + ((i * 37) % 20)) * 10) / 10 }));
const notifications = [
  { id: 'n1', title: 'اجتماع الستاف الجمعة', message: 'تذكير: اجتماع الستاف يوم الجمعة الساعة 9 مساءً في روم الاجتماعات. الحضور مهم.', senderName: 'نورة', senderAvatar: avatar(0), createdAt: iso(3_600_000), level: 'info', readBy: [] },
  { id: 'n2', title: 'تحديث قوانين الشفتات', message: 'صار التحقق من التواجد كل 60 دقيقة في الفويس.', senderName: 'فهد', senderAvatar: avatar(1), createdAt: iso(2 * DAY), level: 'warning', readBy: [{ userId: user.id }] },
];

const api: Record<string, (url: URL, body: any) => unknown> = {
  'GET /api/me': () => ({ user, configured: true }),
  'GET /api/guilds': () => ({ guilds: [{ id: 'g1', name: 'سيرفر ريفت', icon: null }, { id: 'g2', name: 'Rift Testing', icon: null }], selectedGuildId: 'g1' }),
  'GET /api/bootstrap': () => ({ guild: { id: 'g1', name: 'سيرفر ريفت', icon: null }, settings: { guild_id: 'g1', staff_role_id: roles[2]!.id, on_shift_role_id: roles[3]!.id, leave_role_id: roles[4]!.id, shift_channel_id: channels[1]!.id, leave_channel_id: channels[6]!.id, resignation_channel_id: channels[6]!.id, logs_channel_id: channels[2]!.id, presence_check_enabled: true, presence_check_minutes: 60, presence_check_timeout_minutes: 30, warn_limit: 3, leaderboard_channel_id: channels[7]!.id }, staff, viewer: staff[0], shifts, complaints, leaves, resignations, ratings, assistances: [{ id: 'a1', staffUserId: staff[0]!.userId, memberUserId: '1', memberName: 'Yousef', type: 'دعم', note: 'ساعده في تفعيل حسابه', createdAt: iso(DAY) }], botStatus: 'online' }),
  'GET /api/staff': () => ({ staff: [...staff.map(s => ({ ...s, active: true })), dismissedRow] }),
  'GET /api/shifts': () => ({ shifts, staff: staff.map(s => ({ userId: s.userId, displayName: s.displayName, username: s.username, active: true, shiftHours: s.shiftHours })), summary: { active: 4 } }),
  'GET /api/activity/weekly': () => ({ days }),
  'GET /api/notifications': () => ({ notifications, unread: 1 }),
  'GET /api/notifications/options': () => ({ staff: staff.map(s => ({ userId: s.userId, displayName: s.displayName, username: s.username })), roles }),
  'GET /api/points': () => ({ admin: !member, rules: [{ points: '+1', ar: 'كل 10 دقايق في الشفت', en: '' }, { points: '+1', ar: 'كل 20 رسالة وأنت في الشفت', en: '' }, { points: '+2', ar: 'مساعدة عضو', en: '' }, { points: '±', ar: 'التقييمات (حسب النجوم)', en: '' }, { points: '−', ar: 'شكوى معتمدة', en: '' }], me: { total: 1240, parts: [{ key: 'shift', points: 620, count: 48 }, { key: 'messages', points: 310 }, { key: 'voice', points: 180 }, { key: 'assist', points: 80, count: 40 }, { key: 'rating', points: 60, count: 14 }, { key: 'complaint', points: -10, count: 1 }] }, leaderboard: staff.map((s, i) => ({ place: i + 1, userId: s.userId, displayName: s.displayName, avatar: s.avatar, points: s.points, weekPoints: s.weekPoints, rank: s.rank })), recent: [{ userId: staff[2]!.userId, name: 'سارة', by: 'نورة', delta: 15, reason: 'مساعدة ممتازة في الفعالية', source: 'manual', at: iso(3_600_000) }, { userId: staff[5]!.userId, name: 'خالد', by: 'نورة', delta: -5, reason: 'تأخير متكرر', source: 'manual', at: iso(DAY) }] }),
  'GET /api/grades': () => ({ grades: [{ letter: 'S', min: 90 }, { letter: 'A', min: 75 }, { letter: 'B', min: 60 }, { letter: 'C', min: 40 }, { letter: 'D', min: 0 }], weights: { shift: 30, activeDays: 15, voice: 15, messages: 15, rating: 15, clean: 10 }, penalty: { each: 5, max: 20 }, targets: { shiftHours: 10, activeDays: 5, voiceHours: 6, messages: 300 }, noRatingDefault: 4, me: { score: 78, grade: 'A', rank: 2, of: 14, next: { letter: 'S', min: 90, need: 12 }, penalty: 0, parts: [{ key: 'shift', value: 8.5, target: 10, earned: 25.5, max: 30 }, { key: 'activeDays', value: 5, target: 5, earned: 15, max: 15 }, { key: 'voice', value: 3, target: 6, earned: 7.5, max: 15 }, { key: 'messages', value: 220, target: 300, earned: 11, max: 15 }, { key: 'rating', value: 4.6, earned: 13.8, max: 15 }, { key: 'clean', value: 0, earned: 10, max: 10 }], ratingIsDefault: false, last: { score: 71, grade: 'B' } }, team: member ? undefined : staff.slice(0, 12).map((s, i) => ({ userId: s.userId, displayName: s.displayName, avatar: s.avatar, score: 92 - i * 6, grade: ['S', 'A', 'A', 'B', 'B', 'C', 'C', 'C', 'D', 'D', 'D', 'D'][i], rank: i + 1, next: i ? { letter: 'S', need: i * 6 } : null, shiftHours: 12 - i, voiceHours: 7 - i * 0.4, messages: 400 - i * 30, activeDays: 6 - (i % 4) })), admin: !member }),
  'GET /api/audit': () => ({ rows: ['SHIFT_STARTED', 'STAFF_DISMISSED', 'SHIFT_PRESENCE_TIMEOUT', 'LEAVE_REQUESTED', 'POINTS_ADJUSTED', 'STAFF_SYNCED', 'BREAK_STARTED', 'COMPLAINT_REVIEWED'].map((action, i) => ({ id: i, action, userId: staff[i]!.userId, name: staff[i]!.displayName, actorId: i % 2 ? staff[0]!.userId : null, actorName: i % 2 ? 'نورة' : null, createdAt: iso(i * 47 * 60_000 + 60_000) })), actions: ['SHIFT_STARTED', 'STAFF_DISMISSED', 'LEAVE_REQUESTED'], total: 8, hasMore: false }),
  'GET /api/leaves': () => ({ ready: true, admin: !member, rows: leaves, people }),
  'GET /api/resignations': () => ({ ready: true, admin: !member, rows: resignations, people }),
  'GET /api/requests-workflow/options': () => ({ channels, leave: { panelChannelId: channels[6]!.id, requestsChannelId: channels[6]!.id }, resignation: {} }),
  'GET /api/requests/leaves/closed-count': () => ({ closed: 3 }),
  'GET /api/requests/resignations/closed-count': () => ({ closed: 0 }),
  'GET /api/setup/options': () => ({ roles, channels, presenceCheck: { enabled: true, minutes: 60, timeoutMinutes: 30, warnLimit: 3, migrated: true } }),
  'GET /api/leaderboard/settings': () => ({ channelId: channels[7]!.id, migrated: true }),
  'GET /api/panel/options': () => ({ channels }),
  'GET /api/health': () => ({ now, bot: { startedAt: iso(3 * DAY), updatedAt: iso(8000), pingMs: 84, guilds: 3, memoryMb: 74, nodeVersion: 'bun 1.4', activeShifts: 4, watchdogs: { shifts: now - 30_000, roles: now - 200_000, weekly: now - 500_000 } }, database: { connected: true, latencyMs: 41 }, dashboard: { uptimeSec: 260000, memoryMb: 52, gatewayReady: true, gatewayPingMs: 80 }, queue: { staff: 14, pendingComplaints: 1, pendingLeaves: 1, pendingResignations: 1 }, logs: [], uptime: { uptime24h: 99.98, uptime30: 99.4, days: Array.from({ length: 30 }, (_, i) => ({ date: new Date(now - (29 - i) * DAY).toISOString().slice(0, 10), pct: i === 12 ? 96.2 : i < 3 ? null : 100, downMs: i === 12 ? 3_000_000 : 0 })), halfHours: Array.from({ length: 48 }, (_, i) => ({ start: iso((47 - i) * 1_800_000), pct: 100 })), incidents: [{ kind: 'downtime', startedAt: iso(17 * DAY), endedAt: iso(17 * DAY - 3_000_000), note: 'انقطاع في الاستضافة' }, { kind: 'restart', startedAt: iso(3 * DAY), note: 'تحديث البوت' }] } }),
  'GET /api/status': () => ({ generatedAt: new Date().toISOString(), name: 'Rift', overall: { state: 'operational' }, uptime: { h24: 99.98, d30: 99.42 }, components: ['bot', 'discord', 'jobs', 'database', 'dashboard'].map((key, k) => ({ key, name: key, state: key === 'database' ? 'degraded' : 'operational', detail: key === 'bot' ? 'Responding, 84 ms to Discord' : '', uptime30: 99.4 + k * 0.1, days: Array.from({ length: 30 }, (_, i) => ({ date: new Date(now - (29 - i) * DAY).toISOString().slice(0, 10), pct: i === 12 ? 96 : i < 2 ? null : 100, downMs: i === 12 ? 3_000_000 : 0 })), jobs: key === 'jobs' ? [{ key: 'shifts', state: 'operational', lastRun: iso(40_000) }, { key: 'weekly', state: 'operational', lastRun: iso(DAY) }] : [] })), incidents: [{ status: 'resolved', startedAt: iso(17 * DAY), resolvedAt: iso(17 * DAY - 3_000_000) }], maintenances: { ongoing: [], upcoming: [{ id: 'm1', title: 'نقل الاستضافة', description: 'ممكن البوت يوقف 10 دقايق.', startsAt: iso(-2 * DAY), endsAt: iso(-2 * DAY - 3_600_000), affects: ['bot'], status: 'scheduled' }], completed: [] }, posts: [{ id: 'p1', kind: 'announcement', pinned: true, title: 'التحقق من التواجد صار متاح', body: 'البوت يسأل **«هل انت موجود؟»** كل ساعة في الفويس. التفاصيل: https://example.com', createdAt: iso(5 * 3_600_000) }, { id: 'p2', kind: 'resolved', title: 'انحلت مشكلة بطء الحفظ', body: '', createdAt: iso(2 * DAY) }] }),
  'GET /api/status/metrics': () => ({ points: Array.from({ length: 40 }, (_, i) => ({ t: now - (40 - i) * 600_000, ping: 70 + ((i * 37) % 60), dbMs: 30 + ((i * 17) % 50) })) }),
  'GET /api/status-posts': () => ({ posts: [{ id: 'p1', kind: 'announcement', pinned: true, title: 'التحقق من التواجد صار متاح', body: 'البوت يسأل كل ساعة.', authorName: 'نورة', createdAt: iso(5 * 3_600_000) }] }),
  'GET /api/bot/status': () => ({ config: { status: 'online', entries: [{ type: 'watching', text: '{onshift} ستاف في الشفت' }, { type: 'playing', text: 'مع {staff} ستاف' }], interval: 30, mode: 'sequence', url: '' }, editable: true, bot: { username: 'Rift', avatar: '' }, vars: { servers: '3', members: '12,400', staff: '14', onshift: '4', server: 'سيرفر ريفت' }, migrated: true, configured: true }),
  'GET /api/weekly-reports/settings': () => ({ settings: { enabled: true, dmStaff: true, dmSummary: false, recipients: 'all', staffIds: [], channelId: channels[5]!.id, language: 'ar', targets: { shiftHours: 10, activeDays: 5, voiceHours: 6, messages: 300 } }, lastRun: iso(5 * DAY), nextRun: iso(-2 * DAY), migrated: true, staff: staff.map(s => ({ userId: s.userId, displayName: s.displayName, username: s.username, avatar: s.avatar })), channels }),
  'GET /api/staff-reports': () => ({ reports: staff.slice(0, 4).map((s, i) => ({ id: i + 1, staffUserId: s.userId, displayName: s.displayName, avatar: s.avatar, periodStart: iso(12 * DAY), periodEnd: iso(5 * DAY), automated: i !== 1, score: 88 - i * 9, grade: ['A', 'A', 'B', 'C'][i], shiftHours: 11 - i, voiceHours: 6 - i, engagement: 80 - i * 7, messageCount: 420 - i * 40, activeDays: 6 - i, ratingAverage: 4.7, complaints: i === 3 ? 1 : 0, points: 140 - i * 20, rank: i + 1, note: i === 1 ? 'أداء ممتاز هذا الأسبوع 👏' : '' })), canCreate: !member }),
  'GET /api/mod-reports/overview': () => ({ totals: { pending: 3, approved: 21, rejected: 4 }, actions: { warn: 6, mute: 9, kick: 2, ban: 3 }, top: staff.slice(0, 3).map((s, i) => ({ userId: s.userId, displayName: s.displayName, avatar: s.avatar, n: 9 - i * 2, approved: 7 - i })), settings: { enabled: true, language: 'ar', color: '#8175f5', reviewChannelId: '', pingRoleId: '', reporterRoleIds: [], actionRoles: { mute: [], kick: [roles[1]!.id], ban: [roles[0]!.id] }, requireEvidence: ['ban'], dmModerator: true, approvePoints: 2, rejectPoints: 1, panels: { ar: { channelId: '', messageId: '' }, en: { channelId: '', messageId: '' } } } }),
  'GET /api/mod-reports/options': () => ({ roles, channels }),
  'GET /api/mod-reports': () => ({ rows: [1, 2, 3].map(n => ({ id: `mr${n}`, number: 40 + n, action: ['mute', 'ban', 'warn'][n - 1], reason: 'سب وشتم في الشات العام', targetTag: `spammer${n}`, targetUserId: `5550000000000000${n}`, moderator: staff[n]!.displayName, moderatorAvatar: staff[n]!.avatar, createdAt: iso(n * 3_600_000), status: 'pending', notes: n === 1 ? 1 : 0, flags: n === 2 ? 1 : 0 })), hasMore: false }),
  'GET /api/applications/overview': () => ({ totals: { pending: 2, accepted: 9, rejected: 5, in_progress: 1 }, daily: Array.from({ length: 14 }, (_, i) => ({ date: new Date(now - (13 - i) * DAY).toISOString().slice(0, 10), count: (i * 3) % 5 })), oauthReady: true, forms: [{ id: 'f1', title: 'التقديم على الإدارة', open: true, settings: { mode: 'both', color: '#8175f5' }, questions: [{ type: 'short' }, { type: 'paragraph' }, { type: 'choice' }], counts: { pending: 2, accepted: 9, rejected: 5 }, updatedAt: iso(DAY), applyUrl: 'https://rift.example/apply/f1' }] }),
  'GET /api/studio': () => ({ messages: [], templates: [{ key: 'blank', name: 'رسالة فاضية', mode: 'v2' }, { key: 'announcement', name: 'إعلان', mode: 'v2' }] }),
  'GET /api/studio/options': () => ({ roles, channels, emojis: [] }),
};

const page = (entry: keyof WebManifest['entries'], boot: unknown, body = '<div class="boot-loader"><span class="boot-spinner"></span><span>جاري التحميل…</span></div>') => {
  const assets = manifest.entries[entry];
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="csrf-token" content="preview"><title>Rift</title>${assets.css.map(href => `<link rel="stylesheet" href="${href}">`).join('')}<script type="module" src="${assets.js}"></script></head><body class="page-${entry}"><div id="root">${body}</div><script type="application/json" id="boot">${JSON.stringify(boot).replace(/</g, '\\u003c')}</script></body></html>`;
};

const { renderToString } = await import('../src/web/jsx/jsx-runtime.ts');
const { LoginPage } = await import('../src/web/client/pages/LoginPage.tsx');

Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const boot = { user, guilds: [{ id: 'g1', name: 'سيرفر ريفت', icon: null }], guildId: 'g1', admin: !member };
    if (path.startsWith('/a/')) {
      const file = Bun.file(join(dist, path));
      return (await file.exists()) ? new Response(file) : new Response('', { status: 404 });
    }
    if (path === '/' || path === '/dashboard' || path.startsWith('/dashboard/')) return new Response(page('app', boot), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    if (path.startsWith('/p/')) return new Response(page('profile', { ...boot, identifier: path.slice(3) }), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    if (path === '/login') return new Response(page('login', {}, renderToString(LoginPage({ error: url.searchParams.get('error') ?? '', configured: true }))), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    if (path.startsWith('/status') && !path.startsWith('/status.')) return new Response(page('status', {}), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    if (path.startsWith('/apply/')) return new Response(page('apply', {}), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    if (path.startsWith('/apply-api/forms/')) return Response.json({ form: { id: 'f1', title: 'التقديم على الإدارة', description: 'نبحث عن مشرفين نشيطين ومحترمين.', open: true, language: 'ar', color: '#8175f5', questions: [{ id: 'q1', type: 'short', label: 'وش اسمك؟', required: true, options: [] }, { id: 'q2', type: 'number', label: 'كم عمرك؟', required: true, options: [], min: 13, max: 60 }, { id: 'q3', type: 'choice', label: 'هل عندك خبرة إشراف؟', required: true, options: ['نعم', 'لا'] }, { id: 'q4', type: 'paragraph', label: 'احكِ لنا عن خبرتك', required: false, options: [], showIf: { questionId: 'q3', values: ['نعم'] } }, { id: 'q5', type: 'scale', label: 'قيّم صبرك', required: true, options: [], min: 1, max: 5, minLabel: 'قليل', maxLabel: 'كثير' }] }, guild: { name: 'سيرفر ريفت', members: 12400, icon: '' }, viewer: { id: 'v1', username: 'applicant', avatar: avatar(2) }, eligibility: { ok: true }, loginReady: true });
    if (path.startsWith('/api/') || path.startsWith('/auth/')) {
      const key = `${request.method} ${path}`;
      const handler = api[key] ?? (request.method === 'GET' && path.startsWith('/api/profile/') ? () => profile() : null);
      if (handler) return Response.json(handler(url, null));
      if (request.method === 'GET') return Response.json({ error: 'غير متوفر في المعاينة' }, { status: 404 });
      if (path === '/api/staff/sync') return Response.json({ ok: true, result: { mode: 'sync', withRole: 15, added: 1, reactivated: 0, deactivated: 1, skippedDismissed: 1 }, message: 'تمت المزامنة.' });
      return Response.json({ ok: true });
    }
    return new Response('not found', { status: 404 });
  },
});

function profile() {
  const s = staff[0]!;
  return {
    member: { userId: s.userId, username: s.username, displayName: s.displayName, avatar: s.avatar, discordBanner: null, rank: 'مشرف أول', joinedAt: s.joinedAt },
    profile: { bio: 'مشرفة في ريفت من سنتين. أحب أساعد الأعضاء الجدد وأنظم الفعاليات 🎮', tagline: 'شفت الليل · دعم الأعضاء', accent: '', bannerUrl: '', links: [{ label: 'موقعي', url: 'https://example.com' }], showFeedback: true, showConnections: true },
    connections: [{ type: 'github', name: 'noura', verified: true, url: 'https://github.com/noura' }, { type: 'steam', name: 'noura', verified: false, url: '' }],
    social: { views: 312, reps: 27, hasRep: false, commentCount: 2 },
    comments: [{ id: 'k1', text: 'أفضل مشرفة 👏', createdAt: iso(3_600_000), authorUserId: staff[2]!.userId, authorName: 'سارة', authorUsername: 'user_2', authorAvatar: avatar(2), canDelete: true }],
    level: { level: 13, progress: 0.4, toNext: 60 },
    viewer: { userId: user.id, name: user.username, avatar: user.avatar },
    stats: { points: s.points, shiftHours: 96.3, shiftCount: 48, avgShiftMinutes: 120, longestShiftMinutes: 290, messages: 4200, messages30: 980, activeDays30: 24, streak: 9, voiceHours: 43, assists: 40, ratingCount: 14, averageRating: 4.8, distribution: { 5: 11, 4: 2, 3: 1, 2: 0, 1: 0 }, modReports: { total: 12, approved: 10, approvalRate: 83 }, complaints: 0, position: 1, totalStaff: 14, tenureDays: 410, weekPoints: 180, warnings: 0, warnLimit: 3 },
    badges: ['top', 'streak', 'marathon', 'helper', 'loved', 'reporter', 'chatty', 'veteran'].map((key, i) => ({ key, value: i < 5 ? 10 : 3, goal: i < 5 ? 10 : 10 })),
    pointsBreakdown: { total: s.points, parts: [{ key: 'shift', points: 620 }, { key: 'messages', points: 310 }, { key: 'assist', points: 80 }, { key: 'complaint', points: -10 }] },
    status: { onShift: true, onBreak: false, lastSeenAt: iso(60_000) },
    feedback: ratings.slice(0, 3), feedbackHidden: false,
    activity: ['SHIFT_STARTED', 'POINTS_ADJUSTED', 'BREAK_STARTED'].map((action, i) => ({ action, createdAt: iso(i * 3_600_000 + 60_000), delta: 15, reason: 'مساعدة في الفعالية' })),
    shifts: shifts.slice(0, 5).map(x => ({ startedAt: x.startedAt, status: x.status, minutes: 130, points: 12, messages: 40 })),
    days: Array.from({ length: 84 }, (_, i) => ({ date: new Date(now - (83 - i) * DAY).toISOString().slice(0, 10), shiftMinutes: (i * 53) % 240, messages: (i * 71) % 120 })),
    isSelf: !member, isAdmin: !member,
  };
}

console.log(`Rift preview on http://localhost:${port}/dashboard  (${member ? 'staff member' : 'administrator'})`);
