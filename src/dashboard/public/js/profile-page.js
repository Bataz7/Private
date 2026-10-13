import { api, esc, toast, stars } from './ui.js';
import { ic } from './icon.js';
import { BRANDS } from './brands.js';

// Standalone staff profile (no dashboard shell). Route: /p/:name. Arabic or English, following the dashboard language.
const SWATCHES = ['#8175f5', '#5b9be0', '#d9a441', '#6db4d4', '#8ea6f2', '#38c4b5', '#6fcf8a', '#f0866a', '#ff7a2f'];
const TABS = ['overview', 'feedback', 'activity', 'shifts'];
const BADGE_ICON = { top: 'crown', streak: 'flash', marathon: 'timer-start', helper: 'people', loved: 'like-1', reporter: 'shield-tick', chatty: 'message-text', veteran: 'award' };
const PART_ICON = { shift: 'clock', voice: 'activity', messages: 'message-text', assist: 'people', rating: 'star', modreport: 'shield-tick', complaint: 'danger', manual: 'edit-2' };
const ACTION_ICON = { SHIFT: 'alarm', BREAK: 'timer-pause', LEAVE: 'briefcase', RETURNED: 'briefcase', RESIGNATION: 'logout-01', REPORT: 'document-text', MOD: 'shield-tick', COMPLAINT: 'danger', ASSISTANCE: 'people', POINTS: 'medal-star' };

const T = {
  en: {
    nav: { dashboard: 'Dashboard', staff: 'Staff', leaderboard: 'Leaderboard' },
    tabs: { overview: 'Overview', feedback: 'Feedback', activity: 'Activity', shifts: 'Shifts' },
    hero: { points: 'Points', rating: 'Rating', level: 'Level', rank: 'Rank', view: 'view', views: 'views', rep: 'Rep', repSelf: 'You cannot rep yourself', edit: 'Edit profile', more: 'More', copy: 'Copy profile link', copied: 'Profile link copied', copyFail: 'Could not copy the link', staffList: 'Open staff list', language: 'العربية', logout: 'Log out', repFail: 'Could not update reputation' },
    status: { onShift: 'On shift', onBreak: 'On break', seen: 'Active {when}', none: 'No activity yet' },
    about: { title: 'About', bioSelf: 'Add a short bio so your team knows who you are.', bio: 'No bio yet.', joined: 'Joined {date}', tenure: '{n} days on the team', hintText: 'No Discord connections synced yet.', hintLink: 'Log in again', hintTail: 'and allow access to your connections to show GitHub, Xbox and more here.', hidden: 'Connections are hidden by this member.', verified: '(verified)' },
    tile: { shift: 'Shift time', shiftFoot: '{n} shifts · avg {d}', noShifts: 'No shifts yet', toLevel: '{n} to level {l}', review: 'review', reviews: 'reviews', messages: 'Messages', last30: 'Last 30 days: {n}' },
    stat: { streak: 'Day streak', days: 'days', activeDays: 'Active days', ofLast30: 'of the last 30', assists: 'People helped', mod: 'Mod reports', modSub: '{a} approved · {p}%', modNone: 'None yet', longest: 'Longest shift', avg: 'avg {d}', complaints: 'Approved complaints', tenure: 'Time on team', daysUnit: 'days', voice: 'Voice time', rank: 'Team rank', ofTeam: 'of {n} staff' },
    chart: { activity: 'Activity', shift: 'Shift time', messages: 'Messages', last14: 'Last 14 days', last12: 'Last 12 weeks', less: 'Less', more: 'More', total14: '{v} in 14 days', msgs: 'messages' },
    points: { mine: 'Where your points came from', theirs: 'Where {name}\'s points came from', details: 'Full details', none: 'Nothing yet.', parts: { shift: 'Shift time', messages: 'Messages on shift', voice: 'Voice on shift', assist: 'Members helped', rating: 'Ratings', modreport: 'Mod reports', complaint: 'Complaints', manual: 'Manual changes & older points' } },
    badges: {
      title: 'Badges', earned: 'Earned',
      top: ['Team #1', 'First place in the staff ranking'], streak: ['On fire', 'Active 7 days in a row'], marathon: ['Marathon', 'A single shift of 4 hours or more'], helper: ['Helper', 'Helped 25 members'],
      loved: ['Loved', '5 or more ratings averaging 4.5 stars'], reporter: ['Watchful', '10 approved mod reports'], chatty: ['Always around', '1,000 messages in the server'], veteran: ['Veteran', '90 days on the team'],
    },
    feedback: { private: 'Feedback is private', privateSub: '{name} chose not to show feedback publicly.', none: 'No feedback yet', noneSub: 'Ratings from members will appear here.', noComment: 'Rated without a comment.', average: 'Average rating', member: 'Member' },
    activity: { none: 'No activity yet', noneSub: 'Shifts, breaks and helping members build a timeline here.', pts: 'points' },
    shifts: { none: 'No shifts yet', noneSub: 'Completed shifts are listed here with their length.', live: 'In progress', done: 'Completed', pts: '{n} pts', msgs: '{n} msgs' },
    actions: {
      SHIFT_STARTED: 'Started a shift', SHIFT_STARTED_AUTOMATICALLY: 'Shift started automatically', SHIFT_ENDED: 'Ended a shift', SHIFT_AUTO_ENDED: 'Shift ended automatically (inactive)', BREAK_STARTED: 'Started a break', BREAK_RESUMED: 'Back from a break', BREAK_AUTO_ENDED: 'Break ended automatically',
      ASSISTANCE_RECORDED: 'Helped a member', MOD_REPORT_SUBMITTED: 'Submitted a mod report', LEAVE_REQUESTED: 'Requested leave', LEAVE_APPROVED: 'Leave approved', LEAVE_STARTED: 'Leave started', LEAVE_EXTENDED: 'Extended leave', RETURNED_FROM_LEAVE: 'Returned from leave',
      RESIGNATION_REQUESTED: 'Requested to resign', RESIGNATION_CONFIRMED: 'Resignation confirmed', RESIGNATION_WITHDRAWN: 'Withdrew the resignation', COMPLAINT_REVIEWED: 'A complaint was reviewed', REPORT_SUBMITTED: 'Submitted a staff report', REPORT_REVIEWED: 'A report was reviewed', POINTS_ADJUSTED: 'Points adjusted',
    },
    comments: { title: 'Comments', empty: 'No comments yet.', placeholder: 'Add a comment', post: 'Post', del: 'Delete', postFail: 'Could not post the comment', delFail: 'Could not delete the comment' },
    time: { justNow: 'just now', h: 'h', m: 'm' },
    edit: {
      title: 'Edit profile', sub: 'Only you can change this. Everyone in the staff workspace can see it.', tagline: 'Tagline', taglinePh: 'Night shift, member support', bio: 'Bio', bioPh: 'Tell the team about yourself', accent: 'Accent colour', accentDefault: 'Use my dashboard theme',
      banner: 'Banner image URL', bannerPh: 'https://... (leave empty to use your Discord banner)', links: 'Extra links', label: 'Label', showConn: 'Show my Discord connections', showConnSub: 'GitHub, Xbox, Steam and other accounts you made visible in Discord.',
      showFb: 'Show feedback on my profile', showFbSub: 'Ratings and comments from members. Management can always see them.', cancel: 'Cancel', save: 'Save profile', saved: 'Profile saved', saveFail: 'Could not save the profile.', close: 'Close',
    },
    error: { notFound: 'Profile not found', open: 'Could not open this profile', back: 'Back to dashboard' },
  },
  ar: {
    nav: { dashboard: 'الداشبورد', staff: 'الستاف', leaderboard: 'الترتيب' },
    tabs: { overview: 'نظرة عامة', feedback: 'التقييمات', activity: 'النشاط', shifts: 'الشفتات' },
    hero: { points: 'نقطة', rating: 'التقييم', level: 'المستوى', rank: 'الترتيب', view: 'مشاهدة', views: 'مشاهدة', rep: 'ريب', repSelf: 'ما تقدر تعطي نفسك ريب', edit: 'تعديل البروفايل', more: 'المزيد', copy: 'نسخ رابط البروفايل', copied: 'اننسخ رابط البروفايل', copyFail: 'ما قدرنا ننسخ الرابط', staffList: 'قائمة الستاف', language: 'English', logout: 'تسجيل الخروج', repFail: 'ما قدرنا نحدّث الريب' },
    status: { onShift: 'في الشفت', onBreak: 'في بريك', seen: 'آخر نشاط {when}', none: 'ما فيه نشاط بعد' },
    about: { title: 'نبذة', bioSelf: 'اكتب نبذة قصيرة عشان فريقك يعرفك.', bio: 'ما فيه نبذة بعد.', joined: 'انضم {date}', tenure: '{n} يوم في الفريق', hintText: 'ما انربطت حسابات ديسكورد بعد.', hintLink: 'سجّل دخول من جديد', hintTail: 'وسمح بالوصول للحسابات المربوطة عشان يطلع GitHub وXbox وغيرها هنا.', hidden: 'هذا العضو أخفى حساباته المربوطة.', verified: '(موثّق)' },
    tile: { shift: 'وقت الشفت', shiftFoot: '{n} شفت · المتوسط {d}', noShifts: 'ما فيه شفتات بعد', toLevel: 'باقي {n} للمستوى {l}', review: 'تقييم', reviews: 'تقييم', messages: 'الرسائل', last30: 'آخر 30 يوم: {n}' },
    stat: { streak: 'أيام متواصلة', days: 'أيام', activeDays: 'أيام النشاط', ofLast30: 'من آخر 30 يوم', assists: 'مساعدة الأعضاء', mod: 'تقارير المود', modSub: '{a} مقبول · {p}%', modNone: 'ما فيه بعد', longest: 'أطول شفت', avg: 'المتوسط {d}', complaints: 'الشكاوى المقبولة', tenure: 'المدة في الفريق', daysUnit: 'يوم', voice: 'وقت الفويس', rank: 'الترتيب', ofTeam: 'من {n} ستاف' },
    chart: { activity: 'النشاط', shift: 'وقت الشفت', messages: 'الرسائل', last14: 'آخر 14 يوم', last12: 'آخر 12 أسبوع', less: 'أقل', more: 'أكثر', total14: '{v} خلال 14 يوم', msgs: 'رسالة' },
    points: { mine: 'من وين جت نقاطك', theirs: 'من وين جت نقاط {name}', details: 'التفاصيل كاملة', none: 'ما فيه شي بعد.', parts: { shift: 'وقت الشفت', messages: 'الرسائل في الشفت', voice: 'الفويس في الشفت', assist: 'مساعدة الأعضاء', rating: 'التقييمات', modreport: 'تقارير المود', complaint: 'الشكاوى', manual: 'تعديلات يدوية ونقاط قديمة' } },
    badges: {
      title: 'الأوسمة', earned: 'مكتسب',
      top: ['الأول على الفريق', 'المركز الأول في ترتيب الستاف'], streak: ['ما يوقف', 'نشيط 7 أيام ورا بعض'], marathon: ['ماراثون', 'شفت واحد 4 ساعات أو أكثر'], helper: ['المساعد', 'ساعد 25 عضو'],
      loved: ['محبوب', '5 تقييمات أو أكثر بمعدل 4.5 نجوم'], reporter: ['عين ساهرة', '10 تقارير مود مقبولة'], chatty: ['موجود دايم', '1,000 رسالة في السيرفر'], veteran: ['من القدامى', '90 يوم في الفريق'],
    },
    feedback: { private: 'التقييمات خاصة', privateSub: '{name} اختار ما يعرض التقييمات للجميع.', none: 'ما فيه تقييمات بعد', noneSub: 'تقييمات الأعضاء بتطلع هنا.', noComment: 'قيّم بدون تعليق.', average: 'معدل التقييم', member: 'عضو' },
    activity: { none: 'ما فيه نشاط بعد', noneSub: 'الشفتات والبريكات ومساعدة الأعضاء تنبني منها الخط الزمني هنا.', pts: 'نقطة' },
    shifts: { none: 'ما فيه شفتات بعد', noneSub: 'الشفتات المنتهية تنعرض هنا مع مدتها.', live: 'شغّال الحين', done: 'منتهي', pts: '{n} نقطة', msgs: '{n} رسالة' },
    actions: {
      SHIFT_STARTED: 'بدأ شفت', SHIFT_STARTED_AUTOMATICALLY: 'بدأ الشفت تلقائيًا', SHIFT_ENDED: 'أنهى شفت', SHIFT_AUTO_ENDED: 'انتهى الشفت تلقائيًا (خمول)', BREAK_STARTED: 'بدأ بريك', BREAK_RESUMED: 'رجع من البريك', BREAK_AUTO_ENDED: 'انتهى البريك تلقائيًا',
      ASSISTANCE_RECORDED: 'ساعد عضو', MOD_REPORT_SUBMITTED: 'قدّم تقرير مود', LEAVE_REQUESTED: 'طلب إجازة', LEAVE_APPROVED: 'انقبلت إجازته', LEAVE_STARTED: 'بدأت إجازته', LEAVE_EXTENDED: 'مدّد الإجازة', RETURNED_FROM_LEAVE: 'رجع من الإجازة',
      RESIGNATION_REQUESTED: 'قدّم استقالة', RESIGNATION_CONFIRMED: 'تأكدت الاستقالة', RESIGNATION_WITHDRAWN: 'سحب الاستقالة', COMPLAINT_REVIEWED: 'انراجعت شكوى', REPORT_SUBMITTED: 'قدّم تقرير', REPORT_REVIEWED: 'انراجع تقرير', POINTS_ADJUSTED: 'تعديل نقاط',
    },
    comments: { title: 'التعليقات', empty: 'ما فيه تعليقات بعد.', placeholder: 'اكتب تعليق', post: 'نشر', del: 'حذف', postFail: 'ما قدرنا ننشر التعليق', delFail: 'ما قدرنا نحذف التعليق' },
    time: { justNow: 'الحين', h: 'س', m: 'د' },
    edit: {
      title: 'تعديل البروفايل', sub: 'بس أنت تقدر تغيّره، وكل الستاف يشوفه.', tagline: 'العبارة التعريفية', taglinePh: 'شفت الليل، دعم الأعضاء', bio: 'نبذة', bioPh: 'عرّف الفريق على نفسك', accent: 'لون البروفايل', accentDefault: 'استخدم ثيم الداشبورد',
      banner: 'رابط صورة الغلاف', bannerPh: 'https://... (اتركه فاضي لاستخدام غلاف ديسكورد)', links: 'روابط إضافية', label: 'الاسم', showConn: 'اعرض حساباتي المربوطة في ديسكورد', showConnSub: 'GitHub وXbox وSteam وأي حساب خليته ظاهر في ديسكورد.',
      showFb: 'اعرض التقييمات في بروفايلي', showFbSub: 'تقييمات وتعليقات الأعضاء. الإدارة تشوفها دايمًا.', cancel: 'إلغاء', save: 'حفظ البروفايل', saved: 'انحفظ البروفايل', saveFail: 'ما قدرنا نحفظ البروفايل.', close: 'إغلاق',
    },
    error: { notFound: 'البروفايل مو موجود', open: 'ما قدرنا نفتح هذا البروفايل', back: 'رجوع للداشبورد' },
  },
};

const root = document.getElementById('pp');
const nameFromPath = decodeURIComponent(location.pathname.match(/^\/p\/([^/]+)/i)?.[1] || 'me');
let state = null;
let lang = (() => { try { return localStorage.getItem('rift-language') === 'ar' ? 'ar' : 'en'; } catch { return 'en'; } })();
let tabKey = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
let metric = 'shift';

const t = (path, vars = {}) => String(path.split('.').reduce((obj, key) => obj?.[key], T[lang]) ?? path.split('.').reduce((obj, key) => obj?.[key], T.en) ?? path).replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? '');
const locale = () => (lang === 'ar' ? 'ar-SA-u-nu-latn-ca-gregory' : 'en-US');
const num = value => Number(value || 0).toLocaleString('en-US');
const ago = value => {
  const s = Math.round((new Date(value).getTime() - Date.now()) / 1000); const a = Math.abs(s);
  if (a < 60) return t('time.justNow');
  const rtf = new Intl.RelativeTimeFormat(lang === 'ar' ? 'ar-u-nu-latn' : 'en', { numeric: 'auto' });
  if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (a < 86400 * 30) return rtf.format(Math.round(s / 86400), 'day');
  return new Date(value).toLocaleDateString(locale(), { month: 'short', day: 'numeric', year: 'numeric' });
};
const full = value => new Date(value).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' });
const fmtDay = value => new Date(`${value}T00:00:00Z`).toLocaleDateString(locale(), { month: 'short', day: 'numeric', timeZone: 'UTC' });
const duration = minutes => { const m = Math.max(0, Math.round(minutes)); return m >= 60 ? `${Math.floor(m / 60)}${t('time.h')} ${m % 60}${t('time.m')}` : `${m}${t('time.m')}`; };
const signed = value => (value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : '0');
const safeUrl = value => { try { const url = new URL(value); return url.protocol === 'https:' || url.protocol === 'http:' ? url : null; } catch { return null; } };
const onAccent = hex => { const n = parseInt(String(hex).slice(1), 16); const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; return lum > 0.6 ? '#0a0d12' : '#ffffff'; };
const accentVars = hex => (/^#[0-9a-f]{6}$/i.test(hex) ? `--accent:${hex};--on-accent:${onAccent(hex)}` : '');
const brand = (type, size = 20) => (BRANDS[type] ? `<svg class="pp-brand-ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${BRANDS[type].path}"/></svg>` : ic(type === 'xbox' ? 'game' : 'link', { size }));
const avatarOf = (url, name, cls = '') => (url ? `<img class="${cls}" src="${esc(url)}" alt="" loading="lazy">` : `<span class="${cls} pp-initial">${esc((name || '?')[0].toUpperCase())}</span>`);
const label = value => String(value || '').toLowerCase().replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
const actionText = action => T[lang].actions[action] || T.en.actions[action] || label(action);

function applyLang() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  for (const [id, key] of [['ppNavDash', 'dashboard'], ['ppNavStaff', 'staff'], ['ppNavBoard', 'leaderboard']]) { const el = document.getElementById(id); if (el) el.textContent = t(`nav.${key}`); }
}

// ---- Pieces ----------------------------------------------------------------------------------

function connectionIcons(data) {
  const items = [
    ...data.connections.map(item => ({ icon: brand(item.type), title: BRANDS[item.type]?.title || label(item.type), sub: item.name, url: item.url, verified: item.verified })),
    ...data.profile.links.map(item => ({ item, parsed: safeUrl(item.url) })).filter(x => x.parsed).map(({ item, parsed }) => ({ icon: ic('link', { size: 20 }), title: item.label || parsed.hostname.replace(/^www\./, ''), sub: parsed.hostname.replace(/^www\./, ''), url: parsed.toString(), verified: false })),
  ];
  if (!items.length) return '';
  return `<div class="pp-conns">${items.map(item => {
    const tip = `<span class="tip" role="tooltip"><b>${esc(item.title)}</b><small>${esc(item.sub)}${item.verified ? ` ${t('about.verified')}` : ''}</small></span>`;
    return item.url ? `<a class="pp-conn" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer nofollow" aria-label="${esc(item.title)}: ${esc(item.sub)}">${item.icon}${tip}</a>` : `<span class="pp-conn" tabindex="0" aria-label="${esc(item.title)}: ${esc(item.sub)}">${item.icon}${tip}</span>`;
  }).join('')}</div>`;
}

const tile = (labelText, value, icon, foot) => `<div class="pp-tile"><div><span>${labelText}</span><strong>${value}</strong></div><i>${ic(icon, { size: 20 })}</i><div class="pp-tile-foot">${foot}</div></div>`;
const miniBars = values => { const max = Math.max(1, ...values); return `<div class="pp-spark" dir="ltr" aria-hidden="true">${values.map(v => `<i style="height:${Math.max(6, Math.round((v / max) * 100))}%"></i>`).join('')}</div>`; };
const statCell = (icon, labelText, value, sub = '') => `<div class="pp-stat"><i>${ic(icon, { size: 18 })}</i><div><strong>${value}</strong><span>${labelText}</span>${sub ? `<small>${sub}</small>` : ''}</div></div>`;

function statusPill(data) {
  const s = data.status;
  if (s.onShift) return `<span class="pp-pill ${s.onBreak ? 'is-break' : 'is-live'}"><i></i>${t(s.onBreak ? 'status.onBreak' : 'status.onShift')}</span>`;
  return s.lastSeenAt ? `<span class="pp-pill"><i></i>${t('status.seen', { when: esc(ago(s.lastSeenAt)) })}</span>` : '';
}

// Bar chart of the last 14 days and a 12-week calendar for the chosen metric (shift time or messages).
function chartBody(data) {
  const days = data.days;
  const value = day => (metric === 'shift' ? day.shiftMinutes : day.messages);
  const show = amount => (metric === 'shift' ? duration(amount) : `${num(amount)} ${t('chart.msgs')}`);
  const last = days.slice(-14);
  const max = Math.max(1, ...last.map(value));
  const total = last.reduce((sum, day) => sum + value(day), 0);
  const heatMax = Math.max(0, ...days.map(value));
  const level = amount => (!amount || !heatMax ? 0 : Math.min(4, Math.ceil((amount / heatMax) * 4)));
  const pad = new Date(`${days[0].date}T00:00:00Z`).getUTCDay();
  const cells = [...Array(pad).fill(null), ...days];
  return `<div class="pp-chart" dir="ltr" role="img" aria-label="${esc(t('chart.last14'))}">${last.map(day => `<i style="height:${Math.max(3, Math.round((value(day) / max) * 100))}%" class="${value(day) ? '' : 'is-empty'}" title="${esc(`${fmtDay(day.date)}: ${show(value(day))}`)}"></i>`).join('')}</div>
    <div class="pp-chart-scale" dir="ltr"><span>${esc(fmtDay(last[0].date))}</span><span>${esc(t('chart.total14', { v: show(total) }))}</span><span>${esc(fmtDay(last.at(-1).date))}</span></div>
    <h4 class="pp-sub">${t('chart.last12')}</h4>
    <div class="pp-heat" dir="ltr" role="img" aria-label="${esc(t('chart.last12'))}">${cells.map(day => (day ? `<i class="l${level(value(day))}" title="${esc(`${fmtDay(day.date)}: ${show(value(day))}`)}"></i>` : '<i class="pad"></i>')).join('')}</div>
    <div class="pp-heat-legend" dir="ltr"><span>${t('chart.less')}</span>${[0, 1, 2, 3, 4].map(n => `<i class="l${n}"></i>`).join('')}<span>${t('chart.more')}</span></div>`;
}

function pointsPanel(data) {
  const b = data.pointsBreakdown;
  if (!b) return '';
  const parts = b.parts.filter(part => part.points !== 0);
  const max = Math.max(1, ...parts.map(part => Math.abs(part.points)));
  const title = data.isSelf ? t('points.mine') : t('points.theirs', { name: esc(data.member.displayName) });
  return `<section class="panel pp-card"><div class="panel-head"><div><h3>${title}</h3></div><a class="pp-link" href="/dashboard/points">${t('points.details')} ${ic('arrow-right-01', { size: 14 })}</a></div>
    <ul class="pt-parts pp-parts">${parts.length ? parts.map(part => `<li class="${part.points < 0 ? 'neg' : ''}"><span class="pt-ic">${ic(PART_ICON[part.key] || 'star', { size: 16 })}</span><span class="pt-label"><b>${esc(T[lang].points.parts[part.key] || T.en.points.parts[part.key] || part.key)}</b></span><span class="pt-bar"><i style="width:${Math.round((Math.abs(part.points) / max) * 100)}%"></i></span><em>${signed(part.points)}</em></li>`).join('') : `<li class="pt-empty">${t('points.none')}</li>`}</ul></section>`;
}

function badgesPanel(data) {
  return `<section class="panel pp-card"><div class="panel-head"><div><h3>${t('badges.title')}</h3></div><span class="pp-count">${data.badges.filter(b => b.value >= b.goal).length}/${data.badges.length}</span></div>
    <div class="pp-badges">${data.badges.map(badge => {
      const earned = badge.value >= badge.goal;
      const [name, description] = T[lang].badges[badge.key];
      return `<div class="pp-badge ${earned ? 'is-earned' : ''}" title="${esc(description)}"><i>${ic(BADGE_ICON[badge.key], { size: 20 })}</i><b>${esc(name)}</b><small>${esc(description)}</small><em>${earned ? t('badges.earned') : `${num(Math.min(badge.value, badge.goal))}/${num(badge.goal)}`}</em>${earned ? '' : `<span class="pp-bar-mini"><i style="width:${Math.round(Math.min(1, badge.value / badge.goal) * 100)}%"></i></span>`}</div>`;
    }).join('')}</div></section>`;
}

function overview(data) {
  const { stats, level } = data;
  const mod = stats.modReports;
  return `<div class="pp-tiles">
    ${tile(t('hero.points'), num(stats.points), 'medal-star', `<div class="pp-progress" role="progressbar" aria-valuenow="${Math.round(level.progress * 100)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${Math.max(4, Math.round(level.progress * 100))}%"></i></div><small>${t('tile.toLevel', { n: num(level.toNext), l: level.level + 1 })}</small>`)}
    ${tile(t('tile.shift'), `${stats.shiftHours}${t('time.h')}`, 'alarm', `<small>${stats.shiftCount ? t('tile.shiftFoot', { n: num(stats.shiftCount), d: duration(stats.avgShiftMinutes) }) : t('tile.noShifts')}</small>`)}
    ${tile(t('hero.rating'), stats.ratingCount ? stats.averageRating.toFixed(1) : '-', 'star', `${stars(stats.averageRating)}<small>${num(stats.ratingCount)} ${t(stats.ratingCount === 1 ? 'tile.review' : 'tile.reviews')}</small>`)}
    ${tile(t('tile.messages'), num(stats.messages), 'message-text', `${miniBars(data.days.slice(-14).map(day => day.messages))}<small>${t('tile.last30', { n: num(stats.messages30) })}</small>`)}
  </div>
  <div class="pp-stats">
    ${statCell('flash', t('stat.streak'), num(stats.streak), t('stat.days'))}
    ${statCell('calendar-tick', t('stat.activeDays'), `${stats.activeDays30}/30`, t('stat.ofLast30'))}
    ${statCell('people', t('stat.assists'), num(stats.assists))}
    ${statCell('shield-tick', t('stat.mod'), num(mod.total), mod.total ? (mod.approvalRate === null ? '' : t('stat.modSub', { a: mod.approved, p: mod.approvalRate })) : t('stat.modNone'))}
    ${statCell('timer-start', t('stat.longest'), duration(stats.longestShiftMinutes), stats.shiftCount ? t('stat.avg', { d: duration(stats.avgShiftMinutes) }) : '')}
    ${statCell('activity', t('stat.voice'), `${stats.voiceHours}${t('time.h')}`)}
    ${stats.complaints === null ? statCell('calendar', t('stat.tenure'), num(stats.tenureDays), t('stat.daysUnit')) : statCell('danger', t('stat.complaints'), num(stats.complaints))}
    ${statCell('crown', t('stat.rank'), stats.position ? `#${stats.position}` : '-', stats.totalStaff ? t('stat.ofTeam', { n: stats.totalStaff }) : '')}
  </div>
  <section class="panel pp-card"><div class="panel-head"><div><h3>${t('chart.activity')}</h3></div><div class="ap-seg" data-metric-switch>${['shift', 'messages'].map(key => `<button type="button" data-metric="${key}" aria-pressed="${metric === key}">${t(`chart.${key}`)}</button>`).join('')}</div></div><div class="pp-card-body" data-chart>${chartBody(data)}</div></section>
  ${pointsPanel(data)}
  ${badgesPanel(data)}`;
}

function feedbackTab(data) {
  if (data.feedbackHidden) return `<div class="pf-empty">${ic('lock', { size: 22 })}<b>${t('feedback.private')}</b><span>${t('feedback.privateSub', { name: esc(data.member.displayName) })}</span></div>`;
  const { stats } = data;
  if (!stats.ratingCount) return `<div class="pf-empty">${ic('message-text', { size: 22 })}<b>${t('feedback.none')}</b><span>${t('feedback.noneSub')}</span></div>`;
  const dist = stats.distribution;
  const summary = `<section class="panel pp-card pp-rating"><div class="pp-rating-main"><strong>${stats.averageRating.toFixed(1)}</strong>${stars(stats.averageRating)}<small>${num(stats.ratingCount)} ${t(stats.ratingCount === 1 ? 'tile.review' : 'tile.reviews')}</small></div>
    <div class="pp-dist" dir="ltr">${[5, 4, 3, 2, 1].map(n => `<div><span>${n}</span><i><em style="width:${Math.round((dist[n] / stats.ratingCount) * 100)}%"></em></i><b>${dist[n]}</b></div>`).join('')}</div></section>`;
  return `${summary}<div class="pf-feed">${data.feedback.map(item => `<article class="pf-post"><header><b>${esc(item.reviewerName || t('feedback.member'))}</b>${stars(item.rating)}<time title="${esc(full(item.createdAt))}">${esc(ago(item.createdAt))}</time></header>${item.comment ? `<p dir="auto">${esc(item.comment)}</p>` : `<p class="pf-quiet">${t('feedback.noComment')}</p>`}</article>`).join('')}</div>`;
}

function activityTab(data) {
  if (!data.activity.length) return `<div class="pf-empty">${ic('activity', { size: 22 })}<b>${t('activity.none')}</b><span>${t('activity.noneSub')}</span></div>`;
  return `<ol class="pf-timeline">${data.activity.map(item => `<li><span class="pf-dot">${ic(ACTION_ICON[String(item.action).split('_')[0]] || 'activity', { size: 18 })}</span><div><b>${esc(actionText(item.action))}</b>${item.action === 'POINTS_ADJUSTED' ? `<small class="pp-delta ${item.delta < 0 ? 'neg' : ''}">${signed(item.delta)} ${t('activity.pts')}${item.reason ? ` · <span dir="auto">${esc(item.reason)}</span>` : ''}</small>` : ''}<time title="${esc(full(item.createdAt))}">${esc(ago(item.createdAt))}</time></div></li>`).join('')}</ol>`;
}

function shiftsTab(data) {
  if (!data.shifts.length) return `<div class="pf-empty">${ic('alarm', { size: 22 })}<b>${t('shifts.none')}</b><span>${t('shifts.noneSub')}</span></div>`;
  return `<div class="pp-shifts">${data.shifts.map(shift => `<div class="${shift.status === 'active' ? 'is-live' : ''}"><span><b>${esc(new Date(shift.startedAt).toLocaleDateString(locale(), { weekday: 'short', month: 'short', day: 'numeric' }))}</b><small>${esc(new Date(shift.startedAt).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' }))}</small></span><strong>${duration(shift.minutes)}</strong><span class="pp-shift-meta">${shift.messages ? `<small>${t('shifts.msgs', { n: num(shift.messages) })}</small>` : ''}${shift.points ? `<small>${t('shifts.pts', { n: shift.points })}</small>` : ''}</span><em>${shift.status === 'active' ? t('shifts.live') : t('shifts.done')}</em></div>`).join('')}</div>`;
}

function commentHtml(comment) {
  const link = comment.authorUsername ? `/p/${encodeURIComponent(comment.authorUsername)}` : '';
  return `<article class="pp-comment" data-id="${esc(comment.id)}">${avatarOf(comment.authorAvatar, comment.authorName, 'pp-c-avatar')}<div><header>${link ? `<a href="${link}">${esc(comment.authorName)}</a>` : `<b>${esc(comment.authorName)}</b>`}<time title="${esc(full(comment.createdAt))}">${esc(ago(comment.createdAt))}</time>${comment.canDelete ? `<button type="button" class="pp-c-del" data-delete="${esc(comment.id)}" aria-label="${t('comments.del')}" title="${t('comments.del')}">${ic('trash', { size: 16 })}</button>` : ''}</header><p dir="auto">${esc(comment.text)}</p></div></article>`;
}
function commentsPanel(data) {
  return `<section class="pp-comments panel"><div class="pp-c-head"><h3>${ic('message-text', { size: 20 })} ${t('comments.title')}</h3><output id="ppCommentCount">${data.social.commentCount}</output></div>
    <div class="pp-c-list" id="ppComments">${data.comments.length ? data.comments.map(commentHtml).join('') : `<p class="pp-c-empty">${t('comments.empty')}</p>`}</div>
    <form class="pp-c-form" id="ppCommentForm">${avatarOf(data.viewer.avatar, data.viewer.name, 'pp-c-avatar')}<div><textarea name="text" rows="2" maxlength="500" dir="auto" placeholder="${t('comments.placeholder')}" aria-label="${t('comments.placeholder')}"></textarea><div class="pp-c-foot"><span id="ppCount">0/500</span><button class="primary" type="submit">${ic('send-2', { size: 18 })} ${t('comments.post')}</button></div></div></form></section>`;
}

function render(data) {
  const { member, profile, stats, level, social } = data;
  const banner = profile.bannerUrl || member.discordBanner || '';
  applyLang();
  document.title = `${member.displayName} (@${member.username}) | Rift`;
  root.setAttribute('style', accentVars(profile.accent));
  root.innerHTML = `
  <section class="pp-hero">
    <div class="pp-banner" data-banner="${esc(banner)}"><span class="pp-views">${ic('eye', { size: 16 })} ${num(social.views)} ${t(social.views === 1 ? 'hero.view' : 'hero.views')}</span></div>
    <div class="pp-id">
      <div class="pp-avatar">${avatarOf(member.avatar, member.displayName)}</div>
      <div class="pp-name"><h1>${esc(member.displayName)}</h1>
        <p class="pp-handle">@${esc(member.username)}${member.rank ? ` <i></i> ${esc(member.rank)}` : ''}</p>
        ${statusPill(data)}
        <div class="pp-counts"><span><b>${num(stats.points)}</b> ${t('hero.points')}</span><span><b>${stats.ratingCount ? stats.averageRating.toFixed(1) : '-'}</b> ${t('hero.rating')}</span><span><b>${level.level}</b> ${t('hero.level')}</span>${stats.position ? `<span><b>#${stats.position}</b> ${t('hero.rank')}</span>` : ''}</div>
        ${profile.tagline ? `<p class="pp-tagline">${esc(profile.tagline)}</p>` : ''}</div>
      <div class="pp-actions">
        <button type="button" class="secondary pp-rep" data-rep aria-pressed="${social.hasRep}" ${data.isSelf ? `disabled title="${esc(t('hero.repSelf'))}"` : ''}>${ic('like-1', { size: 18, type: social.hasRep ? 'bold' : 'linear' })} ${t('hero.rep')} <span id="ppRepCount">${social.reps}</span></button>
        ${data.isSelf ? `<button type="button" class="secondary" data-edit>${ic('edit-2', { size: 18 })} ${t('hero.edit')}</button>` : ''}
        <div class="pp-menu"><button type="button" class="secondary icon-only" data-menu aria-label="${t('hero.more')}" aria-haspopup="menu" aria-expanded="false">${ic('more', { size: 20 })}</button>
          <div class="pp-menu-list" role="menu" hidden><button type="button" role="menuitem" data-copy>${ic('link', { size: 18 })} ${t('hero.copy')}</button><a role="menuitem" href="/dashboard/staff">${ic('people', { size: 18 })} ${t('hero.staffList')}</a><button type="button" role="menuitem" data-lang>${ic('translate', { size: 18 })} ${t('hero.language')}</button><button type="button" role="menuitem" data-logout>${ic('logout-01', { size: 18 })} ${t('hero.logout')}</button></div></div>
      </div>
    </div>
  </section>
  <div class="pp-grid">
    <div class="pp-left">
      <section class="panel pp-about"><div class="pp-about-head"><h3>${t('about.title')}</h3>${connectionIcons(data)}</div>
        <div class="pp-about-body">${profile.bio ? `<p class="pp-bio" dir="auto">${esc(profile.bio)}</p>` : `<p class="pp-bio pf-quiet">${data.isSelf ? t('about.bioSelf') : t('about.bio')}</p>`}
          <div class="pp-meta"><span>${ic('calendar', { size: 18 })} ${t('about.joined', { date: esc(new Date(member.joinedAt).toLocaleDateString(locale(), { month: 'long', year: 'numeric' })) })}</span><span>${ic('clock', { size: 18 })} ${t('about.tenure', { n: num(stats.tenureDays) })}</span></div>
          ${data.isSelf && !data.connections.length && data.connectionsRequiresAuth ? `<p class="pp-hint">${ic('link', { size: 16 })}<span>${t('about.hintText')} <a href="/auth/discord">${t('about.hintLink')}</a> ${t('about.hintTail')}</span></p>` : ''}
          ${data.connectionsHidden ? `<p class="pp-hint">${t('about.hidden')}</p>` : ''}</div></section>
      <div class="pp-tabs" role="tablist">${TABS.map(key => `<button role="tab" aria-selected="${key === tabKey}" data-tab="${key}">${t(`tabs.${key}`)}${key === 'feedback' ? ` <span>${stats.ratingCount}</span>` : ''}</button>`).join('')}</div>
      <div data-panel="overview" ${tabKey === 'overview' ? '' : 'hidden'}>${overview(data)}</div><div data-panel="feedback" ${tabKey === 'feedback' ? '' : 'hidden'}>${feedbackTab(data)}</div><div data-panel="activity" ${tabKey === 'activity' ? '' : 'hidden'}>${activityTab(data)}</div><div data-panel="shifts" ${tabKey === 'shifts' ? '' : 'hidden'}>${shiftsTab(data)}</div>
    </div>
    <aside class="pp-right">${commentsPanel(data)}</aside>
  </div>`;
  bind(data);
}

// ---- Behaviour -------------------------------------------------------------------------------

let outsideClick = null;
function bind(data) {
  const banner = root.querySelector('.pp-banner');
  const url = safeUrl(banner.dataset.banner);
  if (url) banner.style.backgroundImage = `url(${JSON.stringify(url.toString())})`;

  root.querySelector('.pp-tabs').addEventListener('click', event => {
    const tab = event.target.closest('[data-tab]'); if (!tab) return;
    tabKey = tab.dataset.tab;
    root.querySelectorAll('[data-tab]').forEach(item => item.setAttribute('aria-selected', String(item === tab)));
    root.querySelectorAll('[data-panel]').forEach(panel => { panel.hidden = panel.dataset.panel !== tabKey; });
    history.replaceState(null, '', `${location.pathname}#${tabKey}`);
  });

  root.querySelector('[data-metric-switch]')?.addEventListener('click', event => {
    const button = event.target.closest('[data-metric]'); if (!button) return;
    metric = button.dataset.metric;
    root.querySelectorAll('[data-metric]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    root.querySelector('[data-chart]').innerHTML = chartBody(data);
  });

  const menu = root.querySelector('.pp-menu-list');
  const menuButton = root.querySelector('[data-menu]');
  const closeMenu = () => { menu.hidden = true; menuButton.setAttribute('aria-expanded', 'false'); };
  menuButton.addEventListener('click', event => { event.stopPropagation(); menu.hidden = !menu.hidden; menuButton.setAttribute('aria-expanded', String(!menu.hidden)); });
  if (outsideClick) document.removeEventListener('click', outsideClick);
  outsideClick = closeMenu; document.addEventListener('click', outsideClick);
  root.querySelector('[data-copy]').addEventListener('click', async () => { closeMenu(); try { await navigator.clipboard.writeText(`${location.origin}/p/${encodeURIComponent(data.member.username)}`); toast(t('hero.copied')); } catch { toast(t('hero.copyFail')); } });
  root.querySelector('[data-logout]')?.addEventListener('click', async () => { await api('/auth/logout', { method: 'POST' }).catch(() => {}); sessionStorage.clear(); location.replace('/login'); });
  root.querySelector('[data-lang]').addEventListener('click', () => {
    lang = lang === 'ar' ? 'en' : 'ar';
    try { localStorage.setItem('rift-language', lang); } catch { /* storage blocked */ }
    render(state);
  });

  root.querySelector('[data-rep]')?.addEventListener('click', async event => {
    const button = event.currentTarget; button.disabled = true;
    try {
      const result = await api(`/api/profile/${encodeURIComponent(data.member.userId)}/rep`, { method: 'POST' });
      data.social.hasRep = result.hasRep; data.social.reps = result.reps;
      button.setAttribute('aria-pressed', String(result.hasRep));
      button.innerHTML = `${ic('like-1', { size: 18, type: result.hasRep ? 'bold' : 'linear' })} ${t('hero.rep')} <span id="ppRepCount">${result.reps}</span>`;
    } catch (error) { toast(error.message || t('hero.repFail')); }
    button.disabled = false;
  });

  const form = root.querySelector('#ppCommentForm');
  const box = form.elements.text;
  const list = root.querySelector('#ppComments');
  const counter = root.querySelector('#ppCount');
  box.addEventListener('input', () => { counter.textContent = `${box.value.length}/500`; });
  box.addEventListener('keydown', event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); form.requestSubmit(); } });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const text = box.value.trim(); if (!text) return;
    const submit = form.querySelector('[type="submit"]'); submit.disabled = true;
    try {
      const { comment } = await api(`/api/profile/${encodeURIComponent(data.member.userId)}/comments`, { method: 'POST', body: JSON.stringify({ text }) });
      list.querySelector('.pp-c-empty')?.remove();
      list.insertAdjacentHTML('afterbegin', commentHtml(comment));
      data.social.commentCount += 1; root.querySelector('#ppCommentCount').textContent = data.social.commentCount;
      box.value = ''; counter.textContent = '0/500';
    } catch (error) { toast(error.message || t('comments.postFail')); }
    submit.disabled = false;
  });
  list.addEventListener('click', async event => {
    const button = event.target.closest('[data-delete]'); if (!button) return;
    button.disabled = true;
    try {
      await api(`/api/profile/comments/${button.dataset.delete}`, { method: 'DELETE' });
      button.closest('.pp-comment').remove();
      data.social.commentCount = Math.max(0, data.social.commentCount - 1); root.querySelector('#ppCommentCount').textContent = data.social.commentCount;
      if (!list.children.length) list.innerHTML = `<p class="pp-c-empty">${t('comments.empty')}</p>`;
    } catch (error) { toast(error.message || t('comments.delFail')); button.disabled = false; }
  });

  root.querySelector('[data-edit]')?.addEventListener('click', () => editDialog(data));
}

function editDialog(data) {
  const { profile } = data;
  const dialog = document.createElement('div');
  dialog.className = 'modal-backdrop';
  const links = [...profile.links, ...Array(4)].slice(0, 4);
  dialog.innerHTML = `<section class="modal-card pf-edit" role="dialog" aria-modal="true" aria-labelledby="pfEditTitle">
    <button class="modal-close" type="button" data-close aria-label="${t('edit.close')}">${ic('close-circle', { size: 22 })}</button>
    <h2 id="pfEditTitle">${t('edit.title')}</h2><p class="pf-edit-sub">${t('edit.sub')}</p>
    <form class="pf-form">
      <label class="modal-field full"><span>${t('edit.tagline')}</span><input name="tagline" maxlength="60" dir="auto" value="${esc(profile.tagline)}" placeholder="${esc(t('edit.taglinePh'))}"></label>
      <label class="modal-field full"><span>${t('edit.bio')} <em data-count>${profile.bio.length}/300</em></span><textarea name="bio" rows="4" maxlength="300" dir="auto" placeholder="${esc(t('edit.bioPh'))}">${esc(profile.bio)}</textarea></label>
      <div class="modal-field full"><span>${t('edit.accent')}</span><div class="pf-swatches" role="radiogroup" aria-label="${t('edit.accent')}"><button type="button" role="radio" data-accent="" aria-checked="${profile.accent ? 'false' : 'true'}" title="${esc(t('edit.accentDefault'))}">${ic('close-circle', { size: 16 })}</button>${SWATCHES.map(color => `<button type="button" role="radio" data-accent="${color}" aria-checked="${profile.accent === color}" style="background:${color}" title="${color}"></button>`).join('')}</div></div>
      <label class="modal-field full"><span>${t('edit.banner')}</span><input name="bannerUrl" type="url" maxlength="500" dir="ltr" value="${esc(profile.bannerUrl)}" placeholder="${esc(t('edit.bannerPh'))}"></label>
      <div class="modal-field full"><span>${t('edit.links')}</span><div class="pf-links">${links.map((item, i) => `<div><input name="linkLabel${i}" maxlength="24" dir="auto" value="${esc(item?.label || '')}" placeholder="${esc(t('edit.label'))}"><input name="linkUrl${i}" type="url" maxlength="200" dir="ltr" value="${esc(item?.url || '')}" placeholder="https://"></div>`).join('')}</div></div>
      <label class="pf-check"><input type="checkbox" name="showConnections" ${profile.showConnections ? 'checked' : ''}><span><b>${t('edit.showConn')}</b><small>${t('edit.showConnSub')}</small></span></label>
      <label class="pf-check"><input type="checkbox" name="showFeedback" ${profile.showFeedback ? 'checked' : ''}><span><b>${t('edit.showFb')}</b><small>${t('edit.showFbSub')}</small></span></label>
      <p class="pf-error" role="alert" hidden></p>
      <div class="modal-actions full"><button class="secondary" type="button" data-close>${t('edit.cancel')}</button><button class="primary" type="submit">${t('edit.save')}</button></div>
    </form></section>`;
  document.body.appendChild(dialog);
  const form = dialog.querySelector('form');
  let accent = profile.accent || '';
  const restore = () => { root.setAttribute('style', accentVars(profile.accent)); };
  const close = () => { dialog.remove(); document.removeEventListener('keydown', onKey); restore(); };
  const onKey = event => { if (event.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  dialog.addEventListener('mousedown', event => { if (event.target === dialog) close(); });
  dialog.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', close));
  form.bio.addEventListener('input', () => { dialog.querySelector('[data-count]').textContent = `${form.bio.value.length}/300`; });
  dialog.querySelector('.pf-swatches').addEventListener('click', event => {
    const button = event.target.closest('[data-accent]'); if (!button) return;
    accent = button.dataset.accent;
    dialog.querySelectorAll('[data-accent]').forEach(item => item.setAttribute('aria-checked', String(item === button)));
    root.setAttribute('style', accentVars(accent));
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const error = dialog.querySelector('.pf-error'); error.hidden = true;
    const body = { tagline: form.tagline.value, bio: form.bio.value, accent, bannerUrl: form.bannerUrl.value, showFeedback: form.showFeedback.checked, showConnections: form.showConnections.checked, links: [0, 1, 2, 3].map(i => ({ label: form[`linkLabel${i}`].value, url: form[`linkUrl${i}`].value })) };
    const submit = form.querySelector('[type="submit"]'); submit.disabled = true;
    try { await api('/api/profile', { method: 'PATCH', body: JSON.stringify(body) }); document.removeEventListener('keydown', onKey); dialog.remove(); toast(t('edit.saved')); await load(); }
    catch (failure) { error.textContent = failure.message || t('edit.saveFail'); error.hidden = false; submit.disabled = false; }
  });
  form.tagline.focus();
}

// ---- Boot ------------------------------------------------------------------------------------

async function load() {
  const data = await api(`/api/profile/${encodeURIComponent(state?.member?.userId || nameFromPath)}`);
  state = data;
  if (location.pathname.toLowerCase() !== `/p/${data.member.username.toLowerCase()}`) history.replaceState(null, '', `/p/${encodeURIComponent(data.member.username)}${location.hash}`);
  render(data);
  return data;
}

async function start() {
  const boot = document.getElementById('bootScreen');
  applyLang();
  try {
    const me = await api('/api/me');
    if (!me?.user) { location.href = '/login'; return; }
    const user = me.user;
    const avatar = user.avatar ? (String(user.avatar).startsWith('http') ? user.avatar : `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`) : null;
    document.getElementById('ppUser').innerHTML = `${avatarOf(avatar, user.username, 'pp-nav-avatar')}<span>${esc(user.username)}</span>`;
    await load();
  } catch (error) {
    root.innerHTML = `<div class="pp-error">${ic('danger', { size: 30 })}<h1>${/staff/i.test(error.message) ? t('error.notFound') : t('error.open')}</h1><p>${esc(error.message)}</p><a class="primary" href="/dashboard">${t('error.back')}</a></div>`;
    document.title = `${t('error.notFound')} | Rift`;
  }
  boot.style.transition = 'none'; boot.classList.add('is-hidden');
  root.classList.add('enter');
}
start();
