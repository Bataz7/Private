import { e, progressBar } from './emoji.js';
import { T, V2_FLAG, button, clip, container, row, rtl, section, separator, text, thumbnail } from './v2.js';

// بطاقة الستاف: Components V2 بالكامل (بدون رسم صور = ذاكرة صفر). بانر العضو فوق، الصورة والرتبة والدرجة،
// النقاط مع شريط للدرجة القادمة، الإحصائيات، الإنجازات، وأزرار. المفصول له شكل مختلف (أحمر).

export type StaffTier = { key: string; name: string; emoji: string; color: number; min: number };

/** الدرجات حسب النقاط. نفس حدود الداشبورد (staff-overview). */
export const STAFF_TIERS: readonly StaffTier[] = [
  { key: 'bronze', name: 'برونزي', emoji: '🥉', color: 0xcd7f32, min: 0 },
  { key: 'silver', name: 'فضي', emoji: '🥈', color: 0xb8c2cc, min: 100 },
  { key: 'gold', name: 'ذهبي', emoji: '🥇', color: 0xf1c40f, min: 300 },
  { key: 'platinum', name: 'بلاتيني', emoji: '💠', color: 0x4fd1c5, min: 600 },
  { key: 'diamond', name: 'ماسي', emoji: '💎', color: 0x5dade2, min: 1000 },
  { key: 'legendary', name: 'أسطوري', emoji: '👑', color: 0xa855f7, min: 2000 },
];

/** درجة العضو، والدرجة اللي بعدها (null لو وصل الأعلى) وكم باقي لها، ونسبة التقدّم داخل الدرجة الحالية. */
export function staffTier(points: number) {
  const value = Number.isFinite(points) ? points : 0;
  let index = 0;
  for (let i = 0; i < STAFF_TIERS.length; i += 1) if (value >= STAFF_TIERS[i]!.min) index = i;
  const tier = STAFF_TIERS[index]!;
  const next = STAFF_TIERS[index + 1] ?? null;
  return {
    ...tier,
    next,
    nextAt: next ? next.min : null,
    remaining: next ? Math.max(0, next.min - value) : 0,
    progress: next ? Math.min(1, Math.max(0, (value - tier.min) / (next.min - tier.min))) : 1,
  };
}

export type StaffCardData = {
  name: string; avatar: string; points: number; complaints: number; shiftHours: number; voiceHours: number; messages: number;
  userId?: string;
  /** رابط بانر ديسكورد (لو عنده). */
  banner?: string | null;
  /** الناس اللي ساعدهم (من /assist). */
  helped?: number;
  ratingAverage?: number; ratingCount?: number;
  /** ترتيبه بين الستاف (1 = الأول) ومن كم. */
  rank?: number | null;
  totalStaff?: number;
  /** أعلى نقاط في السيرفر. */
  topPoints?: number;
  /** نقاط هذا الأسبوع والأسبوع اللي قبله (للسهم). */
  weekPoints?: number;
  lastWeekPoints?: number;
  /** ترتيبه هذا الأسبوع (لو من الثلاثة الأوائل). */
  weekRank?: number | null;
  /** أيام نشاط متتالية. */
  streak?: number;
  /** الإنذارات النشطة / الحد. */
  warnings?: number; warnLimit?: number;
  /** في شفت الآن؟ ومن متى، وهل بدأ تلقائياً. */
  onShiftSince?: Date | null;
  onBreak?: boolean;
  /** اسم الرتبة الأعلى. */
  roleName?: string;
  dismissed?: boolean;
  dismissReason?: string | null;
  /** رابط الداشبورد (يطلع زر الرابط بس لو موجود). */
  dashboardUrl?: string | null;
  /** وقت التحديث (للفوتر). */
  updatedAt?: Date;
};

export const CARD_BUTTON = 'card';
const n = (v: number) => Math.round(v).toLocaleString('en-US');
const h = (v: number) => (Math.round(v * 10) / 10).toLocaleString('en-US');
const unix = (date: Date) => Math.floor(date.getTime() / 1000);
const DISMISSED_COLOR = 0xe5484d;

export function stars(average: number) {
  const full = Math.max(0, Math.min(5, Math.round(average)));
  return `${'★'.repeat(full)}${'☆'.repeat(5 - full)}`;
}

/** 🟢 ما عليه شي · 🟡 عليه إنذارات · 🔴 قريب من الحد أو وصله. */
export function warningDot(count: number, limit?: number) {
  if (!count) return '🟢';
  if (limit && count >= limit - 1) return '🔴';
  return '🟡';
}

export function trendArrow(current: number, previous?: number) {
  if (previous === undefined) return '';
  if (current > previous) return '▲';
  if (current < previous) return '▼';
  return '▬';
}

/** شارات من بيانات موجودة أصلاً (بدون استعلامات زيادة). */
export function cardBadges(data: StaffCardData) {
  const badges: string[] = [];
  if ((data.streak ?? 0) >= 7) badges.push(`🔥 سلسلة ${n(data.streak!)} يوم`);
  if (data.weekRank && data.weekRank <= 3) badges.push(`🏆 توب ${data.weekRank} الأسبوع`);
  if (data.rank === 1 && (data.totalStaff ?? 0) > 1) badges.push('👑 الأول بالنقاط');
  if ((data.ratingCount ?? 0) >= 3 && (data.ratingAverage ?? 0) >= 4.5) badges.push('⭐ تقييم ممتاز');
  if (data.voiceHours >= 100) badges.push('🎧 +100 ساعة فويس');
  if (data.shiftHours >= 100) badges.push('⏱️ +100 ساعة شفت');
  if ((data.helped ?? 0) >= 25) badges.push('🤝 سند الأعضاء');
  if (data.messages >= 1000) badges.push('💬 +1K رسالة');
  if (!data.complaints && !(data.warnings ?? 0) && data.shiftHours >= 10) badges.push('🛡️ سجل نظيف');
  return badges.slice(0, 6);
}

/** يعدّ كل المكوّنات (الحاوية وما بداخلها والإكسسوارات). ديسكورد يسمح بـ 40. */
export function countComponents(components: any[]): number {
  let total = 0;
  for (const component of components) {
    total += 1;
    if (Array.isArray(component.components)) total += countComponents(component.components);
    if (component.accessory) total += 1;
  }
  return total;
}

/** يرجّع رسالة جاهزة (flags + components). ephemeral=true يخليها مخفية. */
export function buildStaffCard(data: StaffCardData, ephemeral = false) {
  const tier = staffTier(data.points);
  const dismissed = Boolean(data.dismissed);
  const accent = dismissed ? DISMISSED_COLOR : tier.color;
  const name = clip(data.name || 'إداري', 80);

  const status = dismissed
    ? `⛔ **مفصول من الستاف**`
    : data.onShiftSince
      ? `${data.onBreak ? '⏸️ **في استراحة**' : '🟢 **في الشفت الآن**'} · منذ <t:${unix(data.onShiftSince)}:R>`
      : '⚪ خارج الشفت';

  const parts: any[] = [];
  if (data.banner) parts.push({ type: T.media, items: [{ media: { url: data.banner }, description: `بانر ${name}` }] });
  parts.push(section([
    rtl(`## ${name}`),
    rtl(`${tier.emoji} **${tier.name}**${data.roleName ? ` · ${clip(data.roleName, 60)}` : ''}`),
    rtl(status),
  ], thumbnail(data.avatar, name)));

  if (dismissed) {
    parts.push(text(rtl(`> ⛔ **مفصول** — ${clip(data.dismissReason?.trim() || 'بدون سبب مسجّل', 300)}\n-# البطاقة محفوظة للأرشيف، النقاط والترتيب متوقفين.`)));
  }
  parts.push(separator(true, true));

  // ---- النقاط ----
  const pointsLines = [`# ${dismissed ? '' : `${tier.emoji} `}${n(data.points)} نقطة`];
  if (!dismissed) {
    if (data.rank) pointsLines.push(`🏆 الترتيب **#${n(data.rank)}**${data.totalStaff ? ` من **${n(data.totalStaff)}**` : ''}`);
    pointsLines.push(`${progressBar(tier.progress, 12)}  **${Math.round(tier.progress * 100)}%**`);
    pointsLines.push(tier.next ? `-# باقي **${n(tier.remaining)}** نقطة للـ ${tier.next.emoji} ${tier.next.name}` : '-# 👑 وصل أعلى درجة');
  }
  if (data.weekPoints !== undefined) {
    const arrow = trendArrow(data.weekPoints, data.lastWeekPoints);
    pointsLines.push(`📅 هذا الأسبوع **${data.weekPoints > 0 ? '+' : ''}${n(data.weekPoints)}** ${arrow}${data.lastWeekPoints !== undefined ? ` · الماضي ${n(data.lastWeekPoints)}` : ''}`);
  }
  parts.push(text(rtl(pointsLines.join('\n'))));
  parts.push(separator(true));

  // ---- الإحصائيات ----
  const rating = data.ratingCount ? `${stars(data.ratingAverage ?? 0)} **${(data.ratingAverage ?? 0).toFixed(1)}** (${n(data.ratingCount)})` : '☆☆☆☆☆ —';
  const grid = [
    `### 📊 الإحصائيات`,
    `${e('chart')} ساعات الشفت ┃ **${h(data.shiftHours)}**`,
    `${e('voice')} ساعات الفويس ┃ **${h(data.voiceHours)}**`,
    `${e('chat')} الرسائل ┃ **${n(data.messages)}**`,
    `${e('engage')} ساعد ┃ **${n(data.helped ?? 0)}** عضو`,
    `${e('star')} التقييم ┃ ${rating}`,
    `${e('blocked')} الشكاوى ┃ **${n(data.complaints)}**`,
  ];
  if (data.warnings !== undefined) grid.push(`${warningDot(data.warnings, data.warnLimit)} الإنذارات ┃ **${n(data.warnings)}${data.warnLimit ? `/${data.warnLimit}` : ''}**`);
  parts.push(text(rtl(grid.join('\n'))));

  // ---- الإنجازات ----
  const badges = dismissed ? [] : cardBadges(data);
  if (badges.length) {
    parts.push(separator(false));
    parts.push(text(rtl(`### 🏅 الإنجازات\n${badges.join('  ·  ')}`)));
  }

  parts.push(separator(true));
  parts.push(text(rtl(`-# Rift Staff · ${tier.emoji} ${tier.name} · آخر تحديث <t:${unix(data.updatedAt ?? new Date())}:R>`)));

  // ---- الأزرار ----
  if (data.userId) {
    const buttons = [
      button({ id: `${CARD_BUTTON}:shifts:${data.userId}`, label: 'سجل الشفتات', emoji: '📋', style: 'secondary' }),
      button({ id: `${CARD_BUTTON}:points:${data.userId}`, label: 'النقاط', emoji: '💎', style: dismissed ? 'secondary' : 'primary' }),
    ];
    if (data.dashboardUrl) buttons.push(button({ url: `${data.dashboardUrl}/dashboard/staff?user=${data.userId}`, label: 'فتح في الداشبورد', emoji: '🌐' }));
    parts.push(row(buttons));
  }

  const card = container(parts, accent);
  return { flags: V2_FLAG | (ephemeral ? 64 : 0), components: [card], allowedMentions: { parse: [] } };
}
