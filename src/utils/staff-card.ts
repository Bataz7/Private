import { BRAND_COLOR, e, progressBar } from './emoji.js';
import { V2_FLAG, container, rtl, section, separator, text, thumbnail } from './v2.js';

// بطاقة الستاف: Components V2 (بدون صور ولا مكتبات رسم = ذاكرة صفر). تُرسل كرسالة عادية أو مخفية.

export type StaffCardData = {
  name: string; avatar: string; points: number; complaints: number; shiftHours: number; voiceHours: number; messages: number;
  /** الناس اللي ساعدهم (من /assist). */
  helped?: number;
  ratingAverage?: number; ratingCount?: number;
  /** ترتيبه بين الستاف (1 = الأول). */
  rank?: number | null;
  /** أعلى نقاط في السيرفر (لشريط التقدّم). */
  topPoints?: number;
  /** نقاط هذا الأسبوع. */
  weekPoints?: number;
  /** الإنذارات النشطة / الحد. */
  warnings?: number; warnLimit?: number;
  /** في شفت الآن؟ ومن متى. */
  onShiftSince?: Date | null;
  /** اسم الرتبة الأعلى. */
  roleName?: string;
  dismissed?: boolean;
};

const n = (v: number) => Math.round(v).toLocaleString('en-US');
const h = (v: number) => (Math.round(v * 10) / 10).toLocaleString('en-US');

/** يرجّع رسالة جاهزة (flags + components). ephemeral=true يخليها مخفية. */
export function buildStaffCard(data: StaffCardData, ephemeral = false) {
  const status = data.dismissed
    ? `${e('cross')} **مفصول**`
    : data.onShiftSince
      ? `${e('check')} **في الشفت الآن** · منذ <t:${Math.floor(data.onShiftSince.getTime() / 1000)}:R>`
      : `${e('away')} خارج الشفت`;
  const rating = data.ratingCount ? `**${(data.ratingAverage ?? 0).toFixed(1)}/5** (${n(data.ratingCount)})` : '—';
  const top = Math.max(data.topPoints ?? data.points, data.points, 1);
  const accent = data.dismissed ? 0xe9697b : data.onShiftSince ? 0x4fc08d : BRAND_COLOR;
  const lines = [
    `${e('chart')} ساعات الشفت: **${h(data.shiftHours)}** · ${e('voice')} الفويس: **${h(data.voiceHours)}** ساعة`,
    `${e('chat')} الرسائل: **${n(data.messages)}** · ${e('engage')} ساعد: **${n(data.helped ?? 0)}**`,
    `${e('star')} التقييم: ${rating} · ${e('blocked')} الشكاوى: **${n(data.complaints)}**`,
  ];
  if (data.warnings !== undefined) lines.push(`${e('warn')} الإنذارات: **${n(data.warnings)}${data.warnLimit ? `/${data.warnLimit}` : ''}**`);
  if (data.weekPoints !== undefined) lines.push(`${e('calendar')} نقاط هذا الأسبوع: **${n(data.weekPoints)}**`);
  const card = container([
    section([rtl(`## ${e('crown')} ${data.name}`), rtl(`${data.roleName ? `${data.roleName} · ` : ''}ستاف Rift`), rtl(status)], thumbnail(data.avatar)),
    separator(),
    text(rtl(`### ${e('points')} النقاط: **${n(data.points)}**${data.rank ? ` · الترتيب **#${data.rank}**` : ''}\n${progressBar(data.points / top, 12)}`)),
    text(rtl(lines.join('\n'))),
    separator(false),
    text(rtl('-# Rift Staff · بطاقة الأداء')),
  ], accent);
  return { flags: V2_FLAG | (ephemeral ? 64 : 0), components: [card], allowedMentions: { parse: [] } };
}
