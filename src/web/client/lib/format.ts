// تنسيق الأرقام والتواريخ بالعربي (أرقام لاتينية، تقويم ميلادي).

const LOCALE = 'ar-SA-u-nu-latn-ca-gregory';
const rtf = new Intl.RelativeTimeFormat('ar-u-nu-latn', { numeric: 'auto' });

export const num = (value: unknown, digits = 0): string =>
  Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });

export const fixed = (value: unknown, digits = 1): string => Number(value || 0).toFixed(digits);

const toDate = (value: unknown): Date | null => {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value as string);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const date = (value: unknown): string => {
  const d = toDate(value);
  return d ? d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
};

export const shortDate = (value: unknown): string => {
  const d = toDate(value);
  return d ? d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' }) : '—';
};

export const dayUTC = (value: unknown): string => {
  const d = toDate(value);
  return d ? d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '—';
};

export const dateTime = (value: unknown): string => {
  const d = toDate(value);
  return d ? d.toLocaleString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
};

export const time = (value: unknown): string => {
  const d = toDate(value);
  return d ? d.toLocaleTimeString(LOCALE, { hour: 'numeric', minute: '2-digit' }) : '—';
};

export const weekday = (value: unknown): string => {
  const d = toDate(value);
  return d ? d.toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'short' }) : '—';
};

/** "قبل 5 دقائق"، "أمس"… */
export function ago(value: unknown): string {
  const d = toDate(value);
  if (!d) return '—';
  const s = Math.round((d.getTime() - Date.now()) / 1000);
  const a = Math.abs(s);
  if (a < 60) return 'الحين';
  if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (a < 86_400) return rtf.format(Math.round(s / 3600), 'hour');
  if (a < 86_400 * 30) return rtf.format(Math.round(s / 86_400), 'day');
  return date(d);
}

/** مدة بالدقائق ← "3س 20د". */
export function duration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes || 0));
  if (m < 60) return `${m}د`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h < 24) return rest ? `${h}س ${rest}د` : `${h}س`;
  return `${Math.floor(h / 24)}ي ${h % 24}س`;
}

/** مدة بالثواني ← "2س 5د" / "40ث". */
export function span(seconds: number): string {
  const s = Math.max(0, Math.round(seconds || 0));
  if (s < 60) return `${s}ث`;
  return duration(s / 60);
}

export const hours = (value: unknown): string => `${fixed(value)} س`;

/** جمع عربي بسيط: [مفرد، مثنى، جمع 3-10، 11+]. */
export function count(n: number, forms: [string, string, string, string]): string {
  const value = Math.abs(Math.round(n));
  if (value === 0) return `0 ${forms[3]}`;
  if (value === 1) return forms[0];
  if (value === 2) return forms[1];
  if (value <= 10) return `${num(value)} ${forms[2]}`;
  return `${num(value)} ${forms[3]}`;
}

export const signed = (value: number): string => (value > 0 ? `+${num(value)}` : value < 0 ? `−${num(Math.abs(value))}` : '0');

export const initial = (name: unknown): string => (String(name || '?').trim()[0] || '?').toUpperCase();

/** التحية حسب الوقت. */
export function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'مساء الخير';
  if (hour < 12) return 'صباح الخير';
  return 'مساء الخير';
}

export const shortId = (id: unknown): string => String(id || '').slice(-4);
