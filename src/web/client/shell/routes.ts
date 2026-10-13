// صفحات لوحة التحكم: العنوان، الأيقونة، المجموعة في القائمة الجانبية، ومن يقدر يشوفها.
// صفحات الإدارة تُحمَّل بـ import() منفصل، فالسيرفر يقدر يمنع ملفاتها عن غير الإدارة (manifest.adminFiles).
import type { PageModule } from './types';

export type RouteKey =
  | 'overview' | 'staff' | 'shifts' | 'points' | 'grades' | 'reports' | 'notifications'
  | 'complaints' | 'leaves' | 'resignations' | 'modreports' | 'applications'
  | 'studio' | 'commands' | 'status' | 'statusposts' | 'audit' | 'health' | 'settings';

export type Route = {
  key: RouteKey;
  title: string;
  icon: string;
  group: 'main' | 'requests' | 'recruit' | 'tools' | 'system';
  /** يظهر في القائمة للإدارة فقط (الـ API يرفض غيرهم). */
  admin?: boolean;
  /** كود الصفحة يُحجب عن غير الإدارة (يطابق ADMIN_PAGES في build.ts). */
  adminCode?: boolean;
  badge?: 'staff' | 'complaints' | 'leaves' | 'resignations' | 'modreports' | 'applications' | 'notifications';
  load: () => Promise<PageModule>;
  keywords?: string;
};

export const GROUPS: Record<Route['group'], string> = {
  main: 'مساحة العمل',
  requests: 'الطلبات',
  recruit: 'التوظيف',
  tools: 'الأدوات',
  system: 'النظام',
};

export const ROUTES: Route[] = [
  { key: 'overview', title: 'نظرة عامة', icon: 'home', group: 'main', load: () => import('../pages/overview'), keywords: 'الرئيسية dashboard' },
  { key: 'staff', title: 'الستاف', icon: 'people', group: 'main', admin: true, badge: 'staff', load: () => import('../pages/staff'), keywords: 'الفريق الأعضاء staff' },
  { key: 'shifts', title: 'الشفتات', icon: 'alarm', group: 'main', admin: true, load: () => import('../pages/shifts'), keywords: 'shift الدوام' },
  { key: 'points', title: 'النقاط', icon: 'medal-star', group: 'main', load: () => import('../pages/points'), keywords: 'الترتيب leaderboard' },
  { key: 'grades', title: 'الدرجات', icon: 'award', group: 'main', load: () => import('../pages/grades'), keywords: 'التقييم الأسبوعي grade' },
  { key: 'reports', title: 'التقارير', icon: 'chart-2', group: 'main', load: () => import('../pages/reports'), keywords: 'report الأسبوعية' },
  { key: 'notifications', title: 'الإشعارات', icon: 'notification', group: 'main', badge: 'notifications', load: () => import('../pages/notifications'), keywords: 'الوارد inbox' },
  { key: 'complaints', title: 'الشكاوى', icon: 'danger', group: 'requests', admin: true, badge: 'complaints', load: () => import('../pages/complaints'), keywords: 'complaint' },
  { key: 'leaves', title: 'الإجازات', icon: 'briefcase', group: 'requests', badge: 'leaves', load: () => import('../pages/leaves'), keywords: 'leave اجازة' },
  { key: 'resignations', title: 'الاستقالات', icon: 'logout-01', group: 'requests', badge: 'resignations', load: () => import('../pages/resignations'), keywords: 'resign استقالة' },
  { key: 'modreports', title: 'تقارير المود', icon: 'shield-tick', group: 'requests', admin: true, adminCode: true, badge: 'modreports', load: () => import('../pages/modreports'), keywords: 'mod باند كتم طرد' },
  { key: 'applications', title: 'التقديمات', icon: 'clipboard-text', group: 'recruit', admin: true, adminCode: true, badge: 'applications', load: () => import('../pages/applications'), keywords: 'تقديم توظيف forms' },
  { key: 'studio', title: 'استوديو الرسائل', icon: 'message-text', group: 'tools', admin: true, adminCode: true, load: () => import('../pages/studio'), keywords: 'embed امبد رسالة' },
  { key: 'commands', title: 'الاختصارات', icon: 'command-square', group: 'tools', load: () => import('../pages/commands'), keywords: 'الأوامر commands' },
  { key: 'status', title: 'حالة البوت', icon: 'radar', group: 'tools', admin: true, adminCode: true, load: () => import('../pages/status'), keywords: 'presence الحالة' },
  { key: 'statusposts', title: 'تحديثات الحالة', icon: 'notification', group: 'tools', admin: true, adminCode: true, load: () => import('../pages/statusposts'), keywords: 'تحديثات اعلان' },
  { key: 'audit', title: 'سجل التدقيق', icon: 'note-text', group: 'system', admin: true, adminCode: true, load: () => import('../pages/audit'), keywords: 'السجل log' },
  { key: 'health', title: 'صحة النظام', icon: 'activity', group: 'system', admin: true, adminCode: true, load: () => import('../pages/health'), keywords: 'الصيانة health' },
  { key: 'settings', title: 'إعدادات السيرفر', icon: 'setting-2', group: 'system', admin: true, adminCode: true, load: () => import('../pages/settings'), keywords: 'setup الإعداد الرتب الرومات' },
];

export const routeOf = (key: string): Route | undefined => ROUTES.find(route => route.key === key);

export function parsePath(pathname: string): RouteKey {
  const page = /^\/dashboard\/?([^/?#]*)/i.exec(pathname)?.[1]?.toLowerCase() || 'overview';
  return (routeOf(page)?.key ?? 'overview') as RouteKey;
}

export const pathOf = (key: RouteKey) => (key === 'overview' ? '/dashboard' : `/dashboard/${key}`);
