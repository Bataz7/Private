import type { BootData, SessionUser } from '../lib/boot';
import type { RouteKey } from './routes';

export type BadgeKey = 'staff' | 'complaints' | 'leaves' | 'resignations' | 'modreports' | 'applications' | 'notifications';

export type PageCtx = {
  /** حاوية الصفحة (فاضية عند البداية). */
  root: HTMLElement;
  user: SessionUser;
  admin: boolean;
  boot: BootData;
  /** يُلغى عند مغادرة الصفحة (للطلبات والمؤقتات). */
  signal: AbortSignal;
  onCleanup: (fn: () => void) => void;
  navigate: (key: RouteKey, search?: string) => void;
  /** يعيد تحميل الصفحة الحالية. */
  refresh: () => void;
  /** جزء إضافي في مسار التنقل (مثل اسم النموذج المفتوح). */
  setCrumb: (text: string | null) => void;
  setBadge: (key: BadgeKey, count: number) => void;
  /** بيانات مشتركة بين الصفحات (مع تخزين مؤقت قصير). */
  shared: <T>(key: string, loader: () => Promise<T>, maxAgeMs?: number) => Promise<T>;
  invalidate: (key?: string) => void;
};

export type PageModule = { default: (ctx: PageCtx) => void | Promise<void> };
