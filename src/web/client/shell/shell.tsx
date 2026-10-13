// هيكل التطبيق: قائمة جانبية قابلة للطي (درج على الجوال)، شريط علوي بمسار التنقل، البحث، الإشعارات، الثيم وقائمة المستخدم.
import type { Child } from '#jsx/jsx-runtime';
import { mount, toDOM } from '#jsx/jsx-runtime';
import { Icon, Logo } from '../ui/Icon';
import { Avatar, Button, Kbd } from '../ui/kit';
import { openMenu, toast, toastError } from '../ui/overlay';
import { api } from '../lib/api';
import { avatarUrl, isAdmin, type BootData, type SessionUser } from '../lib/boot';
import { cx, live } from '../lib/dom';
import { ago, num } from '../lib/format';
import { resolvedTheme, setTheme, themeChoice, toggleTheme } from '../lib/theme';
import { GROUPS, ROUTES, pathOf, routeOf, type Route, type RouteKey } from './routes';
import type { BadgeKey } from './types';
import { initPalette, type PaletteItem } from './palette';

export type ShellOptions = {
  user: SessionUser;
  boot: BootData;
  current: RouteKey | 'profile';
  /** داخل تطبيق اللوحة: الروابط تنتقل بدون تحميل الصفحة. */
  onNavigate?: (key: RouteKey) => void;
  onRefresh?: () => void;
  staffForPalette?: () => PaletteItem[];
  extraActions?: () => PaletteItem[];
};

export type Shell = {
  view: HTMLElement;
  setActive: (key: RouteKey | 'profile') => void;
  setCrumb: (text: string | null) => void;
  setBadge: (key: BadgeKey, count: number) => void;
  refreshInbox: () => Promise<void>;
  closeDrawer: () => void;
  setGuild: (guild: { id: string; name: string; icon?: string | null } | null) => void;
};

const COLLAPSE_KEY = 'rift-sidebar';

export async function logout() {
  await api('/auth/logout', { method: 'POST', noRedirect: true }).catch(() => undefined);
  try { sessionStorage.clear(); } catch { /* ignore */ }
  location.replace('/login');
}

export function createShell(options: ShellOptions): Shell {
  const { user } = options;
  const admin = isAdmin(user);
  const avatar = avatarUrl(user);
  const badges = new Map<BadgeKey, number>();
  let current = options.current;
  let crumb: string | null = null;
  let guild = options.boot.guild ?? null;
  const visible = (route: Route) => !route.admin || admin;

  const navLink = (route: Route) => (
    <a class="nav-item" href={pathOf(route.key)} data-key={route.key} aria-current={route.key === current ? 'page' : undefined} title={route.title}
      onPointerEnter={() => { if (options.onNavigate) route.load().catch(() => undefined); }}
      onClick={(event: MouseEvent) => {
        if (!options.onNavigate || event.metaKey || event.ctrlKey || event.shiftKey || event.button) return;
        event.preventDefault();
        options.onNavigate(route.key);
        closeDrawer();
      }}>
      <span class="nav-ico"><Icon name={route.icon} size={20} class="ico-line" /><Icon name={route.icon} size={20} bold class="ico-bold" /></span>
      <span class="nav-text">{route.title}</span>
      {route.badge ? <b class="nav-badge" data-badge={route.badge} hidden /> : null}
    </a>
  );

  const groups = (Object.keys(GROUPS) as Array<Route['group']>).map(group => {
    const items = ROUTES.filter(route => route.group === group && visible(route));
    const extra: Child[] = [];
    if (group === 'main') extra.push(<a class={cx('nav-item')} href="/p/me" data-key="profile" aria-current={current === 'profile' ? 'page' : undefined} title="ملفي الشخصي"><span class="nav-ico"><Icon name="user-square" size={20} class="ico-line" /><Icon name="user-square" size={20} bold class="ico-bold" /></span><span class="nav-text">ملفي الشخصي</span></a>);
    if (group === 'system') extra.push(<a class="nav-item" href="/status" target="_blank" rel="noopener noreferrer" title="صفحة الحالة العامة"><span class="nav-ico"><Icon name="global" size={20} /></span><span class="nav-text">صفحة الحالة العامة</span><Icon name="external" size={14} class="nav-ext" /></a>);
    if (!items.length && !extra.length) return null;
    const list = group === 'main' ? [items[0] ? navLink(items[0]) : null, extra[0], ...items.slice(1).map(navLink)] : [...items.map(navLink), ...extra];
    return <div class="nav-group"><span class="nav-label">{GROUPS[group]}</span>{list}</div>;
  });

  const guildButton = live(() => (
    <button type="button" class="guild-switch" aria-haspopup="menu" aria-expanded="false" title="تبديل السيرفر" onClick={(event: Event) => openGuildMenu(event.currentTarget as HTMLElement)}>
      <Avatar src={guild?.icon ?? null} name={guild?.name ?? 'R'} size={34} class="guild-icon" />
      <span class="guild-text"><b>{guild?.name ?? 'سيرفرك'}</b><small>{admin ? 'إدارة' : 'ستاف'} · مساحة العمل</small></span>
      <Icon name="arrow-down-01" size={16} class="guild-chev" />
    </button>
  ));

  const themeIcon = live(() => <Icon name={resolvedTheme() === 'dark' ? 'sun' : 'moon'} size={20} />, { class: 'contents' }, 'span');
  window.addEventListener('rift:theme', () => themeIcon.update());

  const crumbs = live(() => {
    const route = current === 'profile' ? null : routeOf(current);
    const parts: Child[] = [<span class="crumb-root">Rift</span>];
    if (route) parts.push(<span>{GROUPS[route.group]}</span>);
    const title = current === 'profile' ? 'الملف الشخصي' : route?.title ?? '';
    if (crumb) {
      parts.push(route && options.onNavigate ? <a href={pathOf(route.key)} onClick={(event: MouseEvent) => { event.preventDefault(); options.onNavigate!(route.key); }}>{title}</a> : <span>{title}</span>);
      parts.push(<span aria-current="page">{crumb}</span>);
    } else parts.push(<span aria-current="page">{title}</span>);
    return parts.flatMap((part, index) => (index ? [<Icon name="chevron-left" size={14} class="crumb-sep" flip />, part] : [part]));
  }, { class: 'crumbs', 'aria-label': 'مسار التنقل' }, 'nav');

  let inboxData: { notifications: any[]; unread: number } = { notifications: [], unread: 0 };

  const root = toDOM(
    <div class="app">
      <a class="skip-link" href="#view">تخطَّ إلى المحتوى</a>
      <aside class="sidebar" id="sidebar" aria-label="القائمة الجانبية">
        <div class="sb-head">
          <a class="brand" href="/dashboard" onClick={(event: MouseEvent) => { if (options.onNavigate && !event.metaKey && !event.ctrlKey) { event.preventDefault(); options.onNavigate('overview'); closeDrawer(); } }}>
            <Logo size={30} /><span class="brand-text"><b>rift</b><small>إدارة الستاف</small></span>
          </a>
          <button type="button" class="btn btn-ghost btn-icon sb-collapse" aria-label="طي القائمة" title="طي القائمة" onClick={toggleCollapse}><Icon name="sidebar" size={20} /></button>
          <button type="button" class="btn btn-ghost btn-icon sb-close" aria-label="إغلاق القائمة" onClick={() => closeDrawer()}><Icon name="x" size={20} /></button>
        </div>
        {guildButton.node}
        <nav class="nav" aria-label="الصفحات">{groups}</nav>
        <div class="sb-foot">
          <button type="button" class="me-card" aria-haspopup="menu" aria-expanded="false" onClick={(event: Event) => openUserMenu(event.currentTarget as HTMLElement)}>
            <Avatar src={avatar} name={user.username} size={34} />
            <span class="me-text"><b>{user.username}</b><small>{user.isOwner ? 'مالك السيرفر' : admin ? 'إدارة' : 'ستاف'}</small></span>
            <Icon name="more" size={18} />
          </button>
        </div>
      </aside>
      <div class="sb-scrim" onClick={() => closeDrawer()} />
      <div class="main">
        <header class="topbar">
          <button type="button" class="btn btn-ghost btn-icon tb-menu" aria-label="فتح القائمة" aria-controls="sidebar" aria-expanded="false" onClick={openDrawer}><Icon name="menu" size={22} /></button>
          {crumbs.node}
          <div class="tb-actions">
            <button type="button" class="tb-search" aria-label="بحث (Ctrl K)" onClick={() => palette.open()}>
              <Icon name="search-normal" size={18} /><span>ابحث…</span><span class="tb-kbd"><Kbd>Ctrl</Kbd><Kbd>K</Kbd></span>
            </button>
            <button type="button" class="btn btn-ghost btn-icon tb-bell" aria-label="الإشعارات" aria-haspopup="dialog" onClick={(event: Event) => openInbox(event.currentTarget as HTMLElement)}>
              <Icon name="notification" size={20} /><b class="bell-count" data-badge="notifications" hidden />
            </button>
            <button type="button" class="btn btn-ghost btn-icon" aria-label="تبديل الثيم" title="تبديل الثيم (فاتح/داكن)" onClick={() => toggleTheme()}>{themeIcon.node}</button>
            <button type="button" class="tb-user" aria-label="قائمة الحساب" aria-haspopup="menu" aria-expanded="false" onClick={(event: Event) => openUserMenu(event.currentTarget as HTMLElement)}>
              <Avatar src={avatar} name={user.username} size={32} />
            </button>
          </div>
        </header>
        <main id="view" class="view" tabindex="-1" />
      </div>
    </div>,
  ) as HTMLElement;

  const host = document.getElementById('root') ?? document.body;
  mount(host, null);
  host.appendChild(root);
  const view = root.querySelector<HTMLElement>('#view')!;
  try { if (localStorage.getItem(COLLAPSE_KEY) === '1') root.classList.add('is-collapsed'); } catch { /* ignore */ }

  function toggleCollapse() {
    const on = root.classList.toggle('is-collapsed');
    try { localStorage.setItem(COLLAPSE_KEY, on ? '1' : '0'); } catch { /* ignore */ }
  }
  function openDrawer() {
    root.classList.add('drawer-open');
    root.querySelector('.tb-menu')?.setAttribute('aria-expanded', 'true');
    root.querySelector<HTMLElement>('.sidebar .nav-item[aria-current="page"], .sidebar .nav-item')?.focus();
  }
  function closeDrawer() {
    if (!root.classList.contains('drawer-open')) return;
    root.classList.remove('drawer-open');
    root.querySelector('.tb-menu')?.setAttribute('aria-expanded', 'false');
  }
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeDrawer(); });

  function openUserMenu(anchor: HTMLElement) {
    const choice = themeChoice();
    openMenu(anchor, [
      { label: 'ملفي الشخصي', icon: 'user-square', onClick: () => location.assign('/p/me') },
      { label: 'الإشعارات', icon: 'notification', onClick: () => (options.onNavigate ? options.onNavigate('notifications') : location.assign('/dashboard/notifications')) },
      'sep',
      { label: 'ثيم فاتح', icon: 'sun', hint: choice === 'light' ? '✓' : undefined, onClick: () => setTheme('light') },
      { label: 'ثيم داكن', icon: 'moon', hint: choice === 'dark' ? '✓' : undefined, onClick: () => setTheme('dark') },
      { label: 'حسب الجهاز', icon: 'monitor', hint: choice === 'system' ? '✓' : undefined, onClick: () => setTheme('system') },
      'sep',
      { label: 'تسجيل الخروج', icon: 'logout-01', danger: true, onClick: () => void logout() },
    ]);
  }

  async function openGuildMenu(anchor: HTMLElement) {
    try {
      const data = await api<{ guilds: Array<{ id: string; name: string; icon?: string | null }>; selectedGuildId: string }>('/api/guilds');
      const icon = (item: { id: string; icon?: string | null }) => (item.icon ? (item.icon.startsWith('http') ? item.icon : `https://cdn.discordapp.com/icons/${item.id}/${item.icon}.png?size=64`) : null);
      if (!guild) { const found = data.guilds.find(item => item.id === data.selectedGuildId); if (found) { guild = { ...found, icon: icon(found) }; guildButton.update(); } }
      openMenu(anchor, data.guilds.map(item => ({
        label: item.name,
        icon: item.id === data.selectedGuildId ? 'tick-circle' : 'global',
        hint: item.id === data.selectedGuildId ? 'الحالي' : undefined,
        onClick: async () => {
          if (item.id === data.selectedGuildId) return;
          try { await api('/api/guilds/select', { method: 'POST', body: { guildId: item.id } }); toast(`انتقلت إلى ${item.name}`); setTimeout(() => location.assign('/dashboard'), 400); }
          catch (error) { toastError(error); }
        },
      })), 'start');
    } catch (error) { toastError(error); }
  }

  // ───── صندوق الإشعارات ─────
  const readBy = (item: any) => (item.readBy ?? []).some((entry: any) => entry.userId === user.id);
  function openInbox(anchor: HTMLElement) {
    document.querySelectorAll('.inbox-pop').forEach(item => item.remove());
    const list = live(() => inboxData.notifications.length ? inboxData.notifications.slice(0, 8).map(item => (
      <button type="button" class={cx('inbox-item', !readBy(item) && 'unread')} onClick={async () => {
        await api(`/api/notifications/${encodeURIComponent(item.id)}/read`, { method: 'PATCH' }).catch(() => undefined);
        close();
        await refreshInbox();
        if (options.onNavigate) options.onNavigate('notifications'); else location.assign('/dashboard/notifications');
      }}>
        <Avatar src={item.senderAvatar || null} name={item.senderName || 'R'} size={34} />
        <span class="inbox-text"><b dir="auto">{item.title || 'إشعار'}</b><small>{item.senderName || 'Rift'} · {ago(item.createdAt)}</small><em dir="auto">{String(item.message ?? '').slice(0, 110)}</em></span>
        {!readBy(item) ? <i class="unread-dot" aria-label="غير مقروء" /> : null}
      </button>
    )) : <div class="inbox-empty"><Icon name="tick-circle" size={26} /><b>كل شي مقروء</b><span>ما عندك إشعارات جديدة.</span></div>);
    const pop = toDOM(
      <div class="inbox-pop" role="dialog" aria-label="الإشعارات">
        <header><div><b>الإشعارات</b><small>{inboxData.unread ? `${num(inboxData.unread)} غير مقروء` : 'لا جديد'}</small></div>
          <Button variant="ghost" size="sm" icon="tick-circle" disabled={!inboxData.unread} onClick={async () => {
            await Promise.all(inboxData.notifications.filter(item => !readBy(item)).map(item => api(`/api/notifications/${encodeURIComponent(item.id)}/read`, { method: 'PATCH' }).catch(() => undefined)));
            await refreshInbox();
            list.update();
          }}>تحديد الكل كمقروء</Button>
        </header>
        {list.node}
        <footer><Button variant="soft" block iconEnd="arrow-right-01" flipIcon onClick={() => { close(); if (options.onNavigate) options.onNavigate('notifications'); else location.assign('/dashboard/notifications'); }}>كل الإشعارات</Button></footer>
      </div>,
    ) as HTMLElement;
    document.body.appendChild(pop);
    const rect = anchor.getBoundingClientRect();
    pop.style.top = `${rect.bottom + 8}px`;
    pop.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - pop.offsetWidth - 8))}px`;
    const onDoc = (event: Event) => { if (!pop.contains(event.target as Node) && !anchor.contains(event.target as Node)) close(); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { close(); anchor.focus(); } };
    function close() { pop.remove(); document.removeEventListener('pointerdown', onDoc, true); document.removeEventListener('keydown', onKey, true); }
    setTimeout(() => { document.addEventListener('pointerdown', onDoc, true); document.addEventListener('keydown', onKey, true); });
    pop.querySelector<HTMLElement>('button')?.focus();
  }

  async function refreshInbox() {
    try {
      inboxData = await api('/api/notifications');
      setBadge('notifications', inboxData.unread || 0);
    } catch { /* نحاول مرة ثانية لاحقًا */ }
  }

  function setBadge(key: BadgeKey, count: number) {
    badges.set(key, count);
    root.querySelectorAll<HTMLElement>(`[data-badge="${key}"]`).forEach(el => {
      el.textContent = count > 99 ? '99+' : String(count);
      el.hidden = !count;
    });
  }

  function setActive(key: RouteKey | 'profile') {
    current = key;
    crumb = null;
    root.querySelectorAll<HTMLElement>('.nav-item[data-key]').forEach(el => {
      if (el.dataset.key === key) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    });
    crumbs.update();
    const title = key === 'profile' ? 'الملف الشخصي' : routeOf(key)?.title ?? '';
    document.title = `${title} · Rift`;
  }

  const palette = initPalette({
    pages: () => [
      ...ROUTES.filter(visible).map(route => ({ label: route.title, icon: route.icon, hint: GROUPS[route.group], keywords: route.keywords, run: () => (options.onNavigate ? options.onNavigate(route.key) : location.assign(pathOf(route.key))) })),
      { label: 'ملفي الشخصي', icon: 'user-square', hint: 'مساحة العمل', run: () => location.assign('/p/me') },
      { label: 'صفحة الحالة العامة', icon: 'global', hint: 'خارجي', run: () => window.open('/status', '_blank', 'noopener') },
    ],
    staff: () => options.staffForPalette?.() ?? [],
    actions: () => [
      ...(options.onRefresh ? [{ label: 'تحديث الصفحة الحالية', icon: 'refresh-arrow-01', run: options.onRefresh }] : []),
      { label: 'تعديل ملفي', icon: 'edit-2', run: () => location.assign('/p/me#edit') },
      ...(options.extraActions?.() ?? []),
      { label: resolvedTheme() === 'dark' ? 'التبديل للثيم الفاتح' : 'التبديل للثيم الداكن', icon: resolvedTheme() === 'dark' ? 'sun' : 'moon', keywords: 'theme ثيم', run: () => toggleTheme() },
      { label: 'تسجيل الخروج', icon: 'logout-01', run: () => void logout() },
    ],
  });

  setActive(current);
  void refreshInbox();
  const timer = setInterval(() => { if (!document.hidden) void refreshInbox(); }, 30_000);
  window.addEventListener('pagehide', () => clearInterval(timer));

  return { view, setActive, setCrumb: text => { crumb = text; crumbs.update(); }, setBadge, refreshInbox, closeDrawer, setGuild: next => { if (next && (next.id !== guild?.id || next.name !== guild?.name || next.icon !== guild?.icon)) { guild = next; guildButton.update(); } } };
}

