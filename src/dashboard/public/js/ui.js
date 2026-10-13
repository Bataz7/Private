import { ic } from './icon.js';
export const $ = selector => document.querySelector(selector);
export const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
export const avatar = (url, name) => { const fallback = esc((name || 'R')[0]); return url ? `<div class="avatar avatar-image"><img src="${esc(url)}" alt="" loading="lazy" onerror="this.parentElement.textContent='${fallback}'"></div>` : `<div class="avatar">${fallback}</div>`; };
export const date = (value, lang = 'ar') => value ? new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-US', { dateStyle: 'medium', calendar: 'gregory' }).format(new Date(value)) : '-';
export const stars = score => { const on = Math.round(score); return `<span class="rift-rating-marks" role="img" aria-label="${on} of 5">${[1, 2, 3, 4, 5].map(n => `<img src="/logo-mark.svg" class="rift-rating-mark ${n <= on ? 'on' : 'off'}" alt="">`).join('')}</span>`; };
export const average = values => values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
export async function api(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, { headers: { 'Content-Type': 'application/json' }, signal: controller.signal, ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(data.error || `Request failed (${response.status})`);
    return data;
  } finally {
    clearTimeout(timeout);
  }
}
export function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  setTimeout(() => element.classList.remove('show'), 2800);
}
