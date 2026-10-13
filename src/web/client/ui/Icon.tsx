import { ICONS } from './icon-data';
import { cx } from '../lib/dom';

export type IconProps = { name: string; size?: number; bold?: boolean; class?: string; flip?: boolean; label?: string };

/** أيقونة SVG من مجموعة iconsax. `flip` تعكسها في الاتجاه من اليمين لليسار (الأسهم). */
export function Icon({ name, size = 20, bold = false, class: cls, flip, label }: IconProps) {
  const set = ICONS[name] ?? ICONS['info-circle'];
  if (!set) return null;
  const paths = (bold && set.b) || set.l;
  return (
    <svg class={cx('ic', cls, flip && 'flip-rtl')} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden={label ? undefined : 'true'} role={label ? 'img' : undefined} aria-label={label}>
      {paths.map(path => {
        const kind = path[0] === 's' || path[0] === 'S' || path[0] === 'f' ? path[0] : 's';
        const d = kind === path[0] ? path.slice(1) : path;
        return kind === 'f'
          ? <path d={d} fill="currentColor" />
          : <path d={d} stroke="currentColor" stroke-width={kind === 'S' ? '2' : '1.5'} stroke-linecap="round" stroke-linejoin="round" />;
      })}
    </svg>
  );
}

/** شعار ريفت المصغّر. */
export const Logo = ({ size = 28 }: { size?: number }) => <img class="logo-mark" src="/a/s/logo-mark.svg" width={size} height={size} alt="" />;

export const DiscordLogo = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" d="M20.32 4.37a19.8 19.8 0 0 0-4.89-1.52.07.07 0 0 0-.08.04c-.21.38-.44.87-.61 1.25a18.27 18.27 0 0 0-5.49 0 12.64 12.64 0 0 0-.62-1.25.08.08 0 0 0-.08-.04 19.74 19.74 0 0 0-4.88 1.52.07.07 0 0 0-.03.03C.53 9.05-.32 13.58.1 18.06a.08.08 0 0 0 .03.06 19.9 19.9 0 0 0 5.99 3.03.08.08 0 0 0 .08-.03c.46-.63.87-1.3 1.23-1.99a.08.08 0 0 0-.04-.1 13.1 13.1 0 0 1-1.87-.9.08.08 0 0 1-.01-.12l.37-.29a.07.07 0 0 1 .08-.01c3.93 1.79 8.18 1.79 12.06 0a.07.07 0 0 1 .08.01l.37.3a.08.08 0 0 1-.01.12c-.6.35-1.22.65-1.87.9a.08.08 0 0 0-.04.1c.36.7.77 1.36 1.23 1.99a.08.08 0 0 0 .08.03 19.84 19.84 0 0 0 6-3.03.08.08 0 0 0 .03-.06c.5-5.18-.84-9.67-3.55-13.66a.06.06 0 0 0-.03-.03ZM8.02 15.33c-1.18 0-2.16-1.08-2.16-2.42 0-1.33.96-2.42 2.16-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.34-.96 2.42-2.16 2.42Zm7.97 0c-1.18 0-2.15-1.08-2.15-2.42 0-1.33.95-2.42 2.15-2.42 1.22 0 2.18 1.1 2.16 2.42 0 1.34-.94 2.42-2.16 2.42Z" />
  </svg>
);
