// النوافذ: Modal و Drawer (مع حبس التركيز وEsc وإرجاع التركيز)، نافذة التأكيد، إدخال نص، والتنبيهات (Toasts).
import type { Child } from '#jsx/jsx-runtime';
import { toDOM } from '#jsx/jsx-runtime';
import { Icon } from './Icon';
import { Button, Field, type Tone } from './kit';
import { cx } from '../lib/dom';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const stack: HTMLElement[] = [];

function lockScroll(on: boolean) {
  document.documentElement.classList.toggle('scroll-locked', on);
}

export type OverlayHandle = { el: HTMLElement; close: () => void };

type OverlayOptions = {
  kind: 'modal' | 'drawer';
  title?: Child;
  description?: Child;
  icon?: string;
  tone?: Tone;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  body: (close: () => void) => Child;
  footer?: (close: () => void) => Child;
  onClose?: () => void;
  /** يمنع الإغلاق بالضغط خارج النافذة. */
  sticky?: boolean;
  label?: string;
  class?: string;
};

function openOverlay(options: OverlayOptions): OverlayHandle {
  const previous = document.activeElement as HTMLElement | null;
  let closed = false;
  const titleId = `ov-${Math.random().toString(36).slice(2, 8)}`;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    root.classList.add('is-leaving');
    const index = stack.indexOf(root);
    if (index >= 0) stack.splice(index, 1);
    if (!stack.length) lockScroll(false);
    setTimeout(() => root.remove(), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 160);
    options.onClose?.();
    previous?.focus?.({ preventScroll: true });
  };
  const onKey = (event: KeyboardEvent) => {
    if (stack.at(-1) !== root) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === 'Tab') {
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(item => item.offsetParent !== null || item === document.activeElement);
      if (!items.length) return;
      const first = items[0]!;
      const last = items.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  };
  const isDrawer = options.kind === 'drawer';
  const head = options.title ? (
    <header class="ov-head">
      {options.icon ? <span class={cx('ov-icon', options.tone && `t-${options.tone}`)}><Icon name={options.icon} size={22} /></span> : null}
      <div class="ov-titles"><h2 id={titleId}>{options.title}</h2>{options.description ? <p>{options.description}</p> : null}</div>
      <button type="button" class="btn btn-ghost btn-icon ov-close" aria-label="إغلاق" onClick={close}><Icon name="x" size={20} /></button>
    </header>
  ) : null;
  const root = toDOM(
    <div class={cx('overlay', isDrawer ? 'is-drawer' : 'is-modal', options.class)}>
      <div class="ov-scrim" />
      <section class={cx('ov-panel', `ov-${options.size ?? 'md'}`)} role="dialog" aria-modal="true" aria-labelledby={options.title ? titleId : undefined} aria-label={options.title ? undefined : options.label}>
        {head}
        <div class="ov-body">{options.body(close)}</div>
        {options.footer ? <footer class="ov-foot">{options.footer(close)}</footer> : null}
      </section>
    </div>,
  ) as HTMLElement;
  root.querySelector('.ov-scrim')?.addEventListener('click', () => { if (!options.sticky) close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(root);
  stack.push(root);
  lockScroll(true);
  requestAnimationFrame(() => {
    const target = root.querySelector<HTMLElement>('[autofocus]') || root.querySelector<HTMLElement>('.ov-body ' + FOCUSABLE) || root.querySelector<HTMLElement>(FOCUSABLE);
    target?.focus({ preventScroll: true });
  });
  return { el: root, close };
}

export const openModal = (options: Omit<OverlayOptions, 'kind'>) => openOverlay({ ...options, kind: 'modal' });
export const openDrawer = (options: Omit<OverlayOptions, 'kind'>) => openOverlay({ ...options, kind: 'drawer', size: options.size ?? 'lg' });

export type ConfirmOptions = {
  title: string;
  message?: Child;
  details?: string[];
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  typeToConfirm?: string;
  icon?: string;
};

/** نافذة تأكيد. ترجع true فقط عند التأكيد الصريح. */
export function confirmDialog({ title, message, details = [], confirmText = 'تأكيد', cancelText = 'إلغاء', danger = true, typeToConfirm = '', icon }: ConfirmOptions): Promise<boolean> {
  return new Promise(resolve => {
    let decided = false;
    let ok: HTMLButtonElement | null = null;
    const done = (value: boolean, close: () => void) => { decided = true; resolve(value); close(); };
    openModal({
      title,
      description: message,
      icon: icon ?? (danger ? 'warning-2' : 'info-circle'),
      tone: danger ? 'danger' : 'brand',
      size: 'sm',
      class: 'confirm',
      onClose: () => { if (!decided) resolve(false); },
      body: close => [
        details.length ? <ul class="confirm-list">{details.map(item => <li><Icon name="arrow-right-01" size={14} flip /> {item}</li>)}</ul> : null,
        typeToConfirm ? (
          <Field label={<span>اكتب <b class="type-word">{typeToConfirm}</b> للمتابعة</span>}>
            <input class="input" autocomplete="off" spellcheck="false" dir="auto" autofocus onInput={(event: Event) => { if (ok) ok.disabled = (event.currentTarget as HTMLInputElement).value.trim() !== typeToConfirm; }} onKeyDown={(event: KeyboardEvent) => { if (event.key === 'Enter' && ok && !ok.disabled) done(true, close); }} />
          </Field>
        ) : null,
      ],
      footer: close => [
        <Button variant="ghost" onClick={() => done(false, close)}>{cancelText}</Button>,
        <Button variant={danger ? 'danger' : 'primary'} disabled={Boolean(typeToConfirm)} ref={(el: HTMLButtonElement) => { ok = el; }} onClick={() => done(true, close)} autofocus={typeToConfirm ? undefined : true}>{confirmText}</Button>,
      ],
    });
  });
}

export type PromptOptions = { title: string; message?: Child; label: string; placeholder?: string; confirmText?: string; danger?: boolean; multiline?: boolean; required?: boolean; value?: string; maxLength?: number; icon?: string };

/** يطلب نصًا من المستخدم. يرجع null عند الإلغاء. */
export function promptDialog({ title, message, label, placeholder = '', confirmText = 'حفظ', danger, multiline = true, required, value = '', maxLength = 1000, icon }: PromptOptions): Promise<string | null> {
  return new Promise(resolve => {
    let decided = false;
    let input: HTMLInputElement | HTMLTextAreaElement | null = null;
    const submit = (close: () => void) => {
      const text = input?.value.trim() ?? '';
      if (required && !text) { input?.focus(); input?.classList.add('is-invalid'); return; }
      decided = true;
      resolve(text);
      close();
    };
    openModal({
      title,
      description: message,
      icon,
      tone: danger ? 'danger' : 'brand',
      size: 'sm',
      onClose: () => { if (!decided) resolve(null); },
      body: close => (
        <Field label={label} optional={!required}>
          {multiline
            ? <textarea class="input" rows="4" dir="auto" maxlength={maxLength} placeholder={placeholder} autofocus ref={(el: HTMLTextAreaElement) => { input = el; }}>{value}</textarea>
            : <input class="input" dir="auto" maxlength={maxLength} placeholder={placeholder} value={value} autofocus ref={(el: HTMLInputElement) => { input = el; }} onKeyDown={(event: KeyboardEvent) => { if (event.key === 'Enter') submit(close); }} />}
        </Field>
      ),
      footer: close => [
        <Button variant="ghost" onClick={close}>إلغاء</Button>,
        <Button variant={danger ? 'danger' : 'primary'} onClick={() => submit(close)}>{confirmText}</Button>,
      ],
    });
  });
}

// ───────── التنبيهات ─────────

type ToastKind = 'info' | 'success' | 'error' | 'warning';
let toastRoot: HTMLElement | null = null;

export function toast(message: string, kind: ToastKind = 'success', title?: string): void {
  if (!toastRoot) {
    toastRoot = toDOM(<div class="toasts" role="status" aria-live="polite" />) as HTMLElement;
    document.body.appendChild(toastRoot);
  }
  const icon = { info: 'info-circle', success: 'tick-circle', error: 'danger', warning: 'warning-2' }[kind];
  const item = toDOM(
    <div class={cx('toast', `t-${kind}`)}>
      <Icon name={icon} size={20} />
      <div class="toast-text">{title ? <b>{title}</b> : null}<span>{message}</span></div>
      <button type="button" class="toast-x" aria-label="إغلاق" onClick={(event: Event) => (event.currentTarget as HTMLElement).parentElement?.remove()}><Icon name="x" size={16} /></button>
    </div>,
  ) as HTMLElement;
  toastRoot.appendChild(item);
  while (toastRoot.children.length > 4) toastRoot.firstElementChild?.remove();
  setTimeout(() => { item.classList.add('is-leaving'); setTimeout(() => item.remove(), 220); }, kind === 'error' ? 6500 : 4200);
}

export const toastError = (error: unknown, fallback = 'صار خطأ غير متوقع.') => toast(error instanceof Error && error.message ? error.message : fallback, 'error');

// ───────── القوائم المنسدلة ─────────

/** قائمة تظهر تحت زر. ترجع دالة الإغلاق. */
export function openMenu(anchor: HTMLElement, items: Array<{ label: Child; icon?: string; danger?: boolean; onClick: () => void; hint?: Child } | 'sep'>, align: 'start' | 'end' = 'end'): () => void {
  document.querySelectorAll('.menu-pop').forEach(item => item.remove());
  const menu = toDOM(
    <div class="menu-pop" role="menu">
      {items.map(item => item === 'sep'
        ? <hr />
        : <button type="button" role="menuitem" class={cx('menu-item', item.danger && 'danger')} onClick={() => { close(); item.onClick(); }}>
            {item.icon ? <Icon name={item.icon} size={18} /> : null}<span>{item.label}</span>{item.hint ? <small>{item.hint}</small> : null}
          </button>)}
    </div>,
  ) as HTMLElement;
  document.body.appendChild(menu);
  const rect = anchor.getBoundingClientRect();
  const width = menu.offsetWidth;
  const rtl = document.documentElement.dir === 'rtl';
  let left = (align === 'end') === rtl ? rect.left : rect.right - width;
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
  let top = rect.bottom + 6;
  if (top + menu.offsetHeight > window.innerHeight - 8) top = Math.max(8, rect.top - menu.offsetHeight - 6);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  anchor.setAttribute('aria-expanded', 'true');
  const onDoc = (event: Event) => { if (!menu.contains(event.target as Node) && event.target !== anchor && !anchor.contains(event.target as Node)) close(); };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { close(); anchor.focus(); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const buttons = [...menu.querySelectorAll<HTMLElement>('button')];
      const index = buttons.indexOf(document.activeElement as HTMLElement);
      buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    }
  };
  function close() {
    menu.remove();
    anchor.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onDoc, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', close);
  }
  setTimeout(() => {
    document.addEventListener('pointerdown', onDoc, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', close);
  });
  menu.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  return close;
}
