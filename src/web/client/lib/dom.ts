// أدوات صغيرة فوق JSX: مناطق قابلة لإعادة الرسم، أصناف، تأخير، نسخ وتصدير.
import { jsx, mount, toDOM, type Child, type VNode } from '#jsx/jsx-runtime';

export { mount, toDOM };
export type { Child };

export const cx = (...parts: Array<string | false | null | undefined | 0>): string => parts.filter(Boolean).join(' ');

/**
 * منطقة يعاد رسمها: `const list = live(() => <Rows />)` ثم `{list.node}` داخل JSX و`list.update()` عند التغيير.
 * العنصر يُحفظ عند الرسم، فالتحديث يستبدل محتواه فقط (الحقول خارج المنطقة تحتفظ بالتركيز).
 */
export function live(view: () => Child, attrs: Record<string, unknown> = {}, tag = 'div') {
  let el: HTMLElement | null = null;
  const node = jsx(tag, {
    ...attrs,
    ref: (element: HTMLElement) => {
      el = element;
      mount(element, view());
    },
  }) as VNode;
  return {
    node,
    get el() {
      return el;
    },
    update() {
      if (el) mount(el, view());
    },
  };
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms = 250) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const csvCell = (value: unknown) => {
  let text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

/** ينزّل ملف CSV (مع BOM عشان Excel يقرأ العربي). */
export function downloadCsv(name: string, header: string[], rows: unknown[][]): void {
  const lines = [header.map(csvCell).join(','), ...rows.map(row => row.map(csvCell).join(','))];
  const url = URL.createObjectURL(new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: `${name}-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** رابط http(s) آمن أو فاضي. */
export const safeUrl = (value: unknown): string => {
  try {
    const url = new URL(String(value ?? ''));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : '';
  } catch {
    return '';
  }
};

/** يحوّل قيمة لرابط آمن داخل CSS url("…"). */
export const cssUrl = (value: unknown): string => {
  const url = safeUrl(value);
  return url ? `url(${JSON.stringify(url)})` : '';
};

export const safeColor = (value: unknown): string => (/^#[0-9a-f]{6}$/i.test(String(value ?? '')) ? String(value) : '');

/** قيم نموذج كاملة (حتى الحقول المكررة تصير مصفوفات). */
export function formValues(form: HTMLFormElement): Record<string, string> {
  const out: Record<string, string> = {};
  new FormData(form).forEach((value, key) => {
    out[key] = String(value);
  });
  return out;
}

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), byte => (byte % 36).toString(36)).join('');
