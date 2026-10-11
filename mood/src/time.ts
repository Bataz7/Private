/** أدوات الوقت والمناطق الزمنية — بدون مكتبات، باستخدام Intl. */

export interface ZonedNow {
  /** YYYY-MM-DD */
  day: string;
  /** HH:MM */
  hhmm: string;
  /** الدقائق من بداية اليوم */
  minutes: number;
  /** 0 = الأحد … 6 = السبت */
  weekday: number;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function zoned(date: Date, tz: string): ZonedNow {
  const parts = Object.fromEntries(formatter(tz).formatToParts(date).map((p) => [p.type, p.value]));
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  const hh = parts.hour === "24" ? "00" : parts.hour!;
  const mm = parts.minute!;
  return { day, hhmm: `${hh}:${mm}`, minutes: Number(hh) * 60 + Number(mm), weekday: weekdayOf(day) };
}

/** يقبل "14:30" أو "2:30" أو "٢:٣٠" ويرجع الدقائق، أو null لو غلط. */
export function parseHHMM(input: string): number | null {
  const m = /^\s*(\d{1,2})\s*[:.]\s*(\d{2})\s*$/.exec(toLatinDigits(input));
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** 14:30 → "2:30 الظهر" */
export function arabicTime(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = String(min % 60).padStart(2, "0");
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const period = h < 4 ? "الفجر" : h < 12 ? "الصباح" : h < 15 ? "الظهر" : h < 18 ? "العصر" : h < 20 ? "المغرب" : "الليل";
  return `${h12}:${m} ${period}`;
}

function toUTC(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!);
}

export function addDays(day: string, n: number): string {
  return new Date(toUTC(day) + n * 86_400_000).toISOString().slice(0, 10);
}

export function diffDays(a: string, b: string): number {
  return Math.round((toUTC(a) - toUTC(b)) / 86_400_000);
}

export function weekdayOf(day: string): number {
  return new Date(toUTC(day)).getUTCDay();
}

/** مفتاح الأسبوع ISO مثل 2026-W41 */
export function isoWeekKey(day: string): string {
  const d = new Date(toUTC(day));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

export const WEEKDAYS_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const WEEKDAY_ALIASES: Record<string, number> = {
  sun: 0, sunday: 0, "الأحد": 0, "الاحد": 0,
  mon: 1, monday: 1, "الاثنين": 1, "الإثنين": 1,
  tue: 2, tuesday: 2, "الثلاثاء": 2,
  wed: 3, wednesday: 3, "الأربعاء": 3, "الاربعاء": 3,
  thu: 4, thursday: 4, "الخميس": 4,
  fri: 5, friday: 5, "الجمعة": 5,
  sat: 6, saturday: 6, "السبت": 6,
};

/** يقبل friday / الجمعة / 5 (0 = الأحد). */
export function parseWeekday(v: string): number | null {
  const s = v.trim().toLowerCase();
  if (/^[0-6]$/.test(s)) return Number(s);
  return WEEKDAY_ALIASES[s] ?? null;
}

/** يحوّل الأرقام العربية-الهندية (٠١٢…) والفارسية للاتينية. */
export function toLatinDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/** تاريخ عربي لطيف: "الجمعة 10 أكتوبر" */
export function arabicDate(day: string): string {
  const d = new Date(toUTC(day));
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(d);
}
