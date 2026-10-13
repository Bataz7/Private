// مدخل لوحة التحكم: الهيكل + التنقل بين الصفحات بدون إعادة تحميل (كل صفحة تُحمّل عند الحاجة).
import { mount } from '#jsx/jsx-runtime';
import { api, errorText } from '../lib/api';
import { avatarUrl, isAdmin, readBoot, type SessionUser } from '../lib/boot';
import { initTheme } from '../lib/theme';
import { createShell, guildOf } from '../shell/shell';
import { parsePath, pathOf, routeOf, type RouteKey } from '../shell/routes';
import type { PageCtx } from '../shell/types';
import { Empty, ErrorState, PageSkeleton } from '../ui/kit';
import type { PaletteItem } from '../shell/palette';

initTheme();
const boot = readBoot();

async function currentUser(): Promise<SessionUser | null> {
  if (boot.user?.id) return boot.user;
  const me = await api<{ user: SessionUser | null }>('/api/me').catch(() => null);
  return me?.user ?? null;
}

const user = await currentUser();
if (!user) {
  location.assign('/login');
  throw new Error('signed out');
}
const admin = isAdmin(user);

// ───── بيانات مشتركة مع تخزين قصير ─────
const cache = new Map<string, { at: number; promise: Promise<unknown> }>();
function shared<T>(key: string, loader: () => Promise<T>, maxAgeMs = 20_000): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.promise as Promise<T>;
  const promise = loader();
  cache.set(key, { at: Date.now(), promise });
  promise.then(data => onShared(key, data)).catch(() => cache.delete(key));
  return promise;
}
const invalidate = (key?: string) => (key ? cache.delete(key) : cache.clear());

let staffList: any[] = [];
function onShared(key: string, data: any) {
  if (key !== 'bootstrap' || !data) return;
  staffList = Array.isArray(data.staff) ? data.staff : [];
  const guild = guildOf(data);
  if (guild) shell.setGuild(guild);
  const pending = (rows: any[] | undefined) => (rows ?? []).filter(row => row.status === 'pending').length;
  shell.setBadge('staff', staffList.filter(member => !member.dismissed).length);
  shell.setBadge('complaints', pending(data.complaints));
  shell.setBadge('leaves', pending(data.leaves));
  shell.setBadge('resignations', pending(data.resignations));
}

const shell = createShell({
  user,
  boot,
  current: parsePath(location.pathname),
  onNavigate: key => void go(key),
  onRefresh: () => refresh(),
  staffForPalette: (): PaletteItem[] => staffList.map(member => ({
    label: member.displayName || member.username,
    hint: member.username ? `@${member.username}` : undefined,
    avatar: member.avatar || '',
    keywords: member.userId,
    run: () => location.assign(`/p/${encodeURIComponent(member.userId)}`),
  })),
  extraActions: () => admin ? [
    { label: 'إضافة عضو للستاف', icon: 'user-add', keywords: 'staff add', run: () => void import('../pages/staff-actions').then(m => m.addStaffDialog(() => { invalidate('bootstrap'); refresh(); })) },
    { label: 'مزامنة الستاف', icon: 'sync', keywords: 'sync مزامنة', run: () => void import('../pages/staff-actions').then(m => m.syncStaff('sync', () => { invalidate('bootstrap'); refresh(); })) },
    { label: 'إرسال إشعار للستاف', icon: 'send-2', run: () => void go('notifications') },
  ] : [],
});

// ───── التنقل ─────
let active: { key: RouteKey; controller: AbortController; cleanups: Array<() => void> } | null = null;
let token = 0;

function leave() {
  if (!active) return;
  active.controller.abort();
  for (const fn of active.cleanups.splice(0)) {
    try { fn(); } catch { /* ignore */ }
  }
  active = null;
}

async function go(key: RouteKey, options: { push?: boolean; search?: string; initial?: boolean } = {}) {
  const route = routeOf(key) ?? routeOf('overview')!;
  const search = options.search ?? '';
  if (options.push !== false && !options.initial) history.pushState({ key: route.key }, '', pathOf(route.key) + search);
  leave();
  const mine = ++token;
  shell.setActive(route.key);
  shell.closeDrawer();
  const view = shell.view;
  const controller = new AbortController();
  const cleanups: Array<() => void> = [];
  active = { key: route.key, controller, cleanups };
  if (!options.initial) window.scrollTo({ top: 0 });

  if (route.admin && !admin) {
    mount(view, <Empty icon="lock" title="هذي الصفحة للإدارة فقط" text="تحتاج صلاحية أدمن في السيرفر عشان تفتحها." />);
    return;
  }
  const skeleton = setTimeout(() => { if (mine === token) mount(view, <PageSkeleton />); }, 120);
  try {
    const mod = await route.load();
    if (mine !== token) return;
    clearTimeout(skeleton);
    const root = document.createElement('div');
    root.className = `page page-${route.key}`;
    const ctx: PageCtx = {
      root,
      user: user!,
      admin,
      boot,
      signal: controller.signal,
      onCleanup: fn => cleanups.push(fn),
      navigate: (next, nextSearch) => void go(next, { search: nextSearch }),
      refresh,
      setCrumb: text => shell.setCrumb(text),
      setBadge: (badge, count) => shell.setBadge(badge, count),
      shared,
      invalidate,
    };
    view.replaceChildren(root);
    view.classList.remove('is-entering');
    void view.offsetWidth;
    view.classList.add('is-entering');
    if (!options.initial) view.focus({ preventScroll: true });
    await mod.default(ctx);
  } catch (error) {
    clearTimeout(skeleton);
    if (mine !== token || controller.signal.aborted) return;
    console.error(error);
    mount(view, <ErrorState title={`ما قدرنا نفتح «${route.title}»`} message={errorText(error)} onRetry={() => refresh()} />);
  }
}

function refresh() {
  if (!active) return;
  invalidate();
  void go(active.key, { push: false, search: location.search });
}

window.addEventListener('popstate', () => void go(parsePath(location.pathname), { push: false, search: location.search }));
window.addEventListener('rift:navigate', (event: Event) => {
  const key = (event as CustomEvent<string>).detail;
  if (routeOf(key)) void go(key as RouteKey);
});

const first = parsePath(location.pathname);
if (location.pathname !== pathOf(first) && !/^\/dashboard\/?$/i.test(location.pathname)) history.replaceState({ key: first }, '', pathOf(first) + location.search);
void go(first, { initial: true, search: location.search });

// عدادات القائمة للإدارة (في الخلفية بعد أول صفحة).
if (admin) {
  setTimeout(() => {
    void shared('bootstrap', () => api('/api/bootstrap')).catch(() => undefined);
    api<{ totals?: { pending?: number } }>('/api/mod-reports/overview').then(data => shell.setBadge('modreports', data.totals?.pending ?? 0)).catch(() => undefined);
    api<{ totals?: { pending?: number } }>('/api/applications/overview').then(data => shell.setBadge('applications', data.totals?.pending ?? 0)).catch(() => undefined);
  }, 600);
}

// صورة المستخدم بالرابط الكامل للصفحات اللي تحتاجها.
(window as any).riftUser = { ...user, avatarUrl: avatarUrl(user) };
