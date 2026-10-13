// مكوّنات الواجهة الأساسية (نظام التصميم). كلها دوال ترجع JSX، والحالة الداخلية تُدار بمناطق live().
import type { Child } from '#jsx/jsx-runtime';
import { Icon } from './Icon';
import { cx, live, safeColor } from '../lib/dom';
import { initial } from '../lib/format';

export type Tone = 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'muted';

type ButtonProps = {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft' | 'danger-soft';
  size?: 'sm' | 'md' | 'lg';
  icon?: string;
  iconEnd?: string;
  flipIcon?: boolean;
  href?: string;
  external?: boolean;
  block?: boolean;
  class?: string;
  children?: Child;
  [key: string]: any;
};

export function Button({ variant = 'secondary', size = 'md', icon, iconEnd, flipIcon, href, external, block, class: cls, children, type, ...rest }: ButtonProps) {
  const iconSize = size === 'sm' ? 16 : 18;
  const iconOnly = !children && children !== 0;
  const className = cx('btn', `btn-${variant}`, size !== 'md' && `btn-${size}`, iconOnly && 'btn-icon', block && 'btn-block', cls);
  const inner = [
    icon ? <Icon name={icon} size={iconSize} flip={flipIcon} /> : null,
    iconOnly ? null : <span>{children}</span>,
    iconEnd ? <Icon name={iconEnd} size={iconSize} flip={flipIcon} /> : null,
  ];
  if (href) return <a class={className} href={href} target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer' : undefined} {...rest}>{inner}</a>;
  return <button class={className} type={type ?? 'button'} {...rest}>{inner}</button>;
}

/** يعطّل الزر ويظهر مؤشر التحميل أثناء المهمة. */
export async function busy<T>(button: HTMLButtonElement | null | undefined, task: () => Promise<T>): Promise<T | undefined> {
  if (button?.disabled) return undefined;
  if (button) {
    button.disabled = true;
    button.classList.add('is-busy');
  }
  try {
    return await task();
  } finally {
    if (button) {
      button.disabled = false;
      button.classList.remove('is-busy');
    }
  }
}

export const Badge = ({ tone = 'muted', dot, icon, children, class: cls }: { tone?: Tone; dot?: boolean; icon?: string; children?: Child; class?: string }) => (
  <span class={cx('badge', `b-${tone}`, cls)}>{dot ? <i class="dot" /> : null}{icon ? <Icon name={icon} size={14} /> : null}{children}</span>
);

export const Spinner = ({ size = 18 }: { size?: number }) => <span class="spinner" style={{ width: `${size}px`, height: `${size}px` }} role="status" aria-label="جار التحميل" />;

export function Avatar({ src, name, size = 36, class: cls, ring }: { src?: string | null; name?: string | null; size?: number; class?: string; ring?: string }) {
  const letter = initial(name);
  return (
    <span class={cx('avatar', cls)} style={{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.4)}px`, '--ring': ring || undefined }} aria-hidden="true">
      {src
        ? <img src={src} alt="" loading="lazy" referrerpolicy="no-referrer" onError={(event: Event) => (event.currentTarget as HTMLElement).replaceWith(document.createTextNode(letter))} />
        : letter}
    </span>
  );
}

type CardProps = { title?: Child; subtitle?: Child; icon?: string; actions?: Child; children?: Child; class?: string; flush?: boolean; id?: string; tone?: Tone };
export const Card = ({ title, subtitle, icon, actions, children, class: cls, flush, id, tone }: CardProps) => (
  <section class={cx('card', tone && `card-${tone}`, cls)} id={id}>
    {title || actions ? (
      <header class="card-head">
        {icon ? <span class="card-icon"><Icon name={icon} size={18} /></span> : null}
        <div class="card-titles">{title ? <h3>{title}</h3> : null}{subtitle ? <p>{subtitle}</p> : null}</div>
        {actions ? <div class="card-actions">{actions}</div> : null}
      </header>
    ) : null}
    <div class={cx('card-body', flush && 'flush')}>{children}</div>
  </section>
);

export const PageHeader = ({ title, subtitle, actions, eyebrow }: { title: Child; subtitle?: Child; actions?: Child; eyebrow?: Child }) => (
  <header class="page-head">
    <div class="page-titles">{eyebrow ? <span class="eyebrow">{eyebrow}</span> : null}<h1>{title}</h1>{subtitle ? <p>{subtitle}</p> : null}</div>
    {actions ? <div class="page-actions">{actions}</div> : null}
  </header>
);

type KpiProps = { icon: string; label: Child; value: Child; hint?: Child; tone?: Tone; onClick?: () => void; trend?: number | null };
export function Kpi({ icon, label, value, hint, tone = 'brand', onClick, trend }: KpiProps) {
  const body = [
    <div class="kpi-top"><span class="kpi-icon"><Icon name={icon} size={20} /></span><span class="kpi-label">{label}</span></div>,
    <strong class="kpi-value">{value}</strong>,
    hint || trend ? <small class="kpi-hint">{typeof trend === 'number' && trend !== 0 ? <span class={cx('trend', trend > 0 ? 'up' : 'down')}>{trend > 0 ? '▲' : '▼'} {Math.abs(trend)}%</span> : null}{hint}</small> : null,
  ];
  return onClick
    ? <button type="button" class={cx('kpi', `tone-${tone}`, 'is-link')} onClick={onClick}>{body}</button>
    : <div class={cx('kpi', `tone-${tone}`)}>{body}</div>;
}

export const Empty = ({ icon = 'tick-circle', title, text, action, compact }: { icon?: string; title: Child; text?: Child; action?: Child; compact?: boolean }) => (
  <div class={cx('empty', compact && 'compact')}>
    <span class="empty-art" aria-hidden="true"><i /><i /><span class="empty-icon"><Icon name={icon} size={compact ? 22 : 28} /></span></span>
    <b>{title}</b>
    {text ? <p>{text}</p> : null}
    {action ? <div class="empty-action">{action}</div> : null}
  </div>
);

export const ErrorState = ({ title = 'ما قدرنا نحمّل الصفحة', message, onRetry }: { title?: string; message?: string; onRetry?: () => void }) => (
  <div class="empty error-state">
    <span class="empty-art danger" aria-hidden="true"><i /><i /><span class="empty-icon"><Icon name="danger" size={28} /></span></span>
    <b>{title}</b>
    {message ? <p>{message}</p> : null}
    {onRetry ? <div class="empty-action"><Button icon="refresh-arrow-01" onClick={onRetry}>حاول مرة ثانية</Button></div> : null}
  </div>
);

export const Skeleton = ({ lines = 3, height, class: cls }: { lines?: number; height?: number; class?: string }) => (
  <div class={cx('sk-stack', cls)} aria-busy="true" aria-label="جار التحميل">
    {Array.from({ length: lines }, (_, index) => <span class="skeleton" style={{ height: height ? `${height}px` : undefined, width: index === lines - 1 && lines > 1 ? '62%' : undefined }} />)}
  </div>
);

/** هيكل صفحة أثناء التحميل: عنوان + بطاقات. */
export const PageSkeleton = ({ cards = 4 }: { cards?: number }) => (
  <div class="page-skeleton" aria-busy="true" aria-label="جار التحميل">
    <span class="skeleton sk-title" />
    <span class="skeleton sk-sub" />
    <div class="kpi-grid">{Array.from({ length: cards }, () => <span class="skeleton sk-card" />)}</div>
    <div class="grid-2"><span class="skeleton sk-panel" /><span class="skeleton sk-panel" /></div>
  </div>
);

type FieldProps = { label: Child; hint?: Child; optional?: boolean; children?: Child; class?: string; full?: boolean; error?: string; as?: 'label' | 'div' };
export function Field({ label, hint, optional, children, class: cls, full, error, as = 'label' }: FieldProps) {
  const inner = [
    <span class="field-label">{label}{optional ? <em>اختياري</em> : null}</span>,
    children,
    hint ? <small class="field-hint">{hint}</small> : null,
    error ? <small class="field-error" role="alert">{error}</small> : null,
  ];
  return as === 'div' ? <div class={cx('field', full && 'full', cls)}>{inner}</div> : <label class={cx('field', full && 'full', cls)}>{inner}</label>;
}

export type Option = { value: string; label: string; disabled?: boolean };

export function Select({ options, value = '', placeholder, class: cls, ...rest }: { options: Option[]; value?: string; placeholder?: string; class?: string; [key: string]: any }) {
  return (
    <select class={cx('input', cls)} {...rest}>
      {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
      {options.map(option => <option value={option.value} selected={option.value === value} disabled={option.disabled}>{option.label}</option>)}
    </select>
  );
}

export type Channel = { id: string; name: string };
export type Role = { id: string; name: string; color?: string; manageable?: boolean; dangerous?: boolean };

export const ChannelSelect = ({ channels, value = '', placeholder = 'اختر روم…', ...rest }: { channels: Channel[]; value?: string; placeholder?: string; [key: string]: any }) => (
  <Select options={channels.map(channel => ({ value: channel.id, label: `# ${channel.name}` }))} value={value} placeholder={placeholder} {...rest} />
);

export const RoleSelect = ({ roles, value = '', placeholder = 'بدون', ...rest }: { roles: Role[]; value?: string; placeholder?: string; [key: string]: any }) => (
  <Select options={roles.map(role => ({ value: role.id, label: `@${role.name}` }))} value={value} placeholder={placeholder} {...rest} />
);

export const roleColor = (role?: Role | null) => (role?.color && role.color !== '#000000' && safeColor(role.color) ? role.color : 'var(--text-3)');

/** اختيار عدة رتب (شرائح + قائمة إضافة). */
export function RolePicker({ roles, value, onChange, manageableOnly, max = 25 }: { roles: Role[]; value: string[]; onChange: (ids: string[]) => void; manageableOnly?: boolean; max?: number }) {
  let ids = [...value];
  const region = live(() => (
    <div class="role-picker">
      {ids.map(id => {
        const role = roles.find(item => item.id === id);
        const warn = manageableOnly && role && role.manageable === false;
        return (
          <span class={cx('chip', warn && 'warn')} title={warn ? 'رتبة البوت تحت هذي الرتبة، فما يقدر يعطيها.' : undefined}>
            <i class="chip-dot" style={{ background: roleColor(role) }} />
            {role?.name ?? 'رتبة محذوفة'}
            {warn ? <Icon name="warning-2" size={13} /> : null}
            <button type="button" class="chip-x" aria-label={`إزالة ${role?.name ?? ''}`} onClick={() => { ids = ids.filter(item => item !== id); onChange(ids); region.update(); }}><Icon name="x" size={12} /></button>
          </span>
        );
      })}
      {ids.length < max ? (
        <select class="input chip-add" aria-label="إضافة رتبة" onChange={(event: Event) => {
          const select = event.currentTarget as HTMLSelectElement;
          if (!select.value) return;
          ids = [...ids, select.value];
          onChange(ids);
          region.update();
        }}>
          <option value="">+ إضافة رتبة</option>
          {roles.filter(role => !ids.includes(role.id)).map(role => (
            <option value={role.id} disabled={manageableOnly && role.manageable === false}>{role.name}{manageableOnly && role.manageable === false ? ' (فوق رتبة البوت)' : ''}</option>
          ))}
        </select>
      ) : null}
    </div>
  ));
  return region.node;
}

type ToggleProps = { label: Child; hint?: Child; checked?: boolean; name?: string; onChange?: (checked: boolean) => void; disabled?: boolean; class?: string };
export const Toggle = ({ label, hint, checked, name, onChange, disabled, class: cls }: ToggleProps) => (
  <label class={cx('toggle-row', cls)}>
    <span class="switch"><input type="checkbox" role="switch" name={name} checked={Boolean(checked)} disabled={disabled} onChange={(event: Event) => onChange?.((event.currentTarget as HTMLInputElement).checked)} /><i /></span>
    <span class="toggle-text"><b>{label}</b>{hint ? <small>{hint}</small> : null}</span>
  </label>
);

export const Switch = ({ checked, onChange, label, disabled }: { checked?: boolean; onChange?: (checked: boolean) => void; label: string; disabled?: boolean }) => (
  <span class="switch" title={label}><input type="checkbox" role="switch" aria-label={label} checked={Boolean(checked)} disabled={disabled} onChange={(event: Event) => onChange?.((event.currentTarget as HTMLInputElement).checked)} /><i /></span>
);

export type SegOption = { value: string; label: Child; icon?: string; count?: number };

/** أزرار اختيار واحد. */
export function Seg({ options, value, onChange, label, class: cls, size }: { options: SegOption[]; value: string; onChange: (value: string) => void; label?: string; class?: string; size?: 'sm' }) {
  return (
    <div class={cx('seg', size === 'sm' && 'seg-sm', cls)} role="group" aria-label={label}>
      {options.map(option => (
        <button type="button" aria-pressed={String(option.value === value)} onClick={(event: Event) => {
          const button = event.currentTarget as HTMLElement;
          button.parentElement?.querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
          onChange(option.value);
        }}>
          {option.icon ? <Icon name={option.icon} size={15} /> : null}
          <span>{option.label}</span>
          {option.count ? <b class="seg-count">{option.count}</b> : null}
        </button>
      ))}
    </div>
  );
}

/** تبويبات (نفس فكرة Seg لكن بشكل خط سفلي). */
export function Tabs({ tabs, value, onChange, class: cls }: { tabs: SegOption[]; value: string; onChange: (value: string) => void; class?: string }) {
  return (
    <div class={cx('tabs', cls)} role="tablist">
      {tabs.map(tab => (
        <button type="button" role="tab" aria-selected={String(tab.value === value)} onClick={(event: Event) => {
          const button = event.currentTarget as HTMLElement;
          button.parentElement?.querySelectorAll('[role=tab]').forEach(item => item.setAttribute('aria-selected', String(item === button)));
          onChange(tab.value);
        }}>
          {tab.icon ? <Icon name={tab.icon} size={16} /> : null}
          <span>{tab.label}</span>
          {tab.count ? <b class="tab-count">{tab.count}</b> : null}
        </button>
      ))}
    </div>
  );
}

export const SearchInput = ({ placeholder = 'بحث…', value = '', onInput, label, class: cls, ...rest }: { placeholder?: string; value?: string; onInput?: (value: string) => void; label?: string; class?: string; [key: string]: any }) => (
  <label class={cx('search', cls)}>
    <Icon name="search-normal" size={18} />
    <input type="search" placeholder={placeholder} aria-label={label ?? placeholder} value={value} onInput={(event: Event) => onInput?.((event.currentTarget as HTMLInputElement).value)} {...rest} />
  </label>
);

export const Progress = ({ value, tone, label }: { value: number; tone?: Tone; label?: string }) => (
  <div class={cx('progress', tone && `p-${tone}`)} role="progressbar" aria-valuenow={String(Math.round(value))} aria-valuemin="0" aria-valuemax="100" aria-label={label}>
    <i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
  </div>
);

export const Notice = ({ tone = 'info', icon, title, children }: { tone?: Tone; icon?: string; title?: Child; children?: Child }) => (
  <div class={cx('notice', `n-${tone}`)} role={tone === 'danger' ? 'alert' : undefined}>
    <Icon name={icon ?? (tone === 'success' ? 'tick-circle' : tone === 'warning' || tone === 'danger' ? 'warning-2' : 'info-circle')} size={20} />
    <div>{title ? <b>{title}</b> : null}{children ? <div class="notice-body">{children}</div> : null}</div>
  </div>
);

/** صف معلومات بسيط (المفتاح والقيمة). */
export const Meta = ({ items }: { items: Array<[Child, Child]> }) => (
  <dl class="meta-grid">{items.map(([key, value]) => <div><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
);

export const Kbd = ({ children }: { children?: Child }) => <kbd class="kbd">{children}</kbd>;

export const Dot = ({ tone = 'muted', pulse }: { tone?: Tone; pulse?: boolean }) => <i class={cx('status-dot', `d-${tone}`, pulse && 'pulse')} aria-hidden="true" />;
