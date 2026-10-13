import { getSettings } from '../services/settings.service.js';

// Small helpers shared by the leave / resignation modules.
export type RequestKind = 'leave' | 'resignation';
export const DAY_MS = 86_400_000;

/** Arabic-Indic digits and slashes are accepted, the time is local midnight. */
export function parseDay(input: string) {
  const value = String(input ?? '').trim().replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).replace(/\//g, '-');
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (!match) throw new Error('Invalid date. Use YYYY-MM-DD, for example 2026-09-21.');
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) throw new Error('Invalid date. Use a real date in YYYY-MM-DD format.');
  date.setHours(0, 0, 0, 0);
  return date;
}

export function gregorianDate(date: Date | string) {
  const value = new Date(date);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

export const stamp = (date: Date | string, style = 'D') => `<t:${Math.floor(new Date(date).getTime() / 1000)}:${style}>`;
export const seconds = (date: Date | string) => Math.floor(new Date(date).getTime() / 1000);
export const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

/** True when the server is set to Arabic. */
export async function isArabic(guildId: string) {
  return (await getSettings(guildId).catch(() => null))?.botLanguage === 'ar';
}

/** End dates are stored as midnight at the start of the chosen day; the leave lasts through that day. */
export const leaveEndsAt = (request: { endDate: Date | string }) => new Date(request.endDate).getTime() + DAY_MS - 1;
