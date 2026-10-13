// صفحة ملف العضو (/p/:name) داخل نفس هيكل اللوحة (الروابط تنتقل بتحميل عادي).
import { api } from '../lib/api';
import { readBoot, type SessionUser } from '../lib/boot';
import { initTheme } from '../lib/theme';
import { createShell } from '../shell/shell';
import { renderProfile } from '../public/profile-page';

initTheme();
const boot = readBoot();
const user: SessionUser | null = boot.user?.id ? boot.user : (await api<{ user: SessionUser | null }>('/api/me').catch(() => null))?.user ?? null;
if (!user) location.assign('/login');
else {
  const shell = createShell({ user, boot, current: 'profile' });
  const root = document.createElement('div');
  root.className = 'page page-profile';
  shell.view.replaceChildren(root);
  const identifier = String(boot.identifier ?? decodeURIComponent(/^\/p\/([^/?#]+)/i.exec(location.pathname)?.[1] ?? 'me'));
  await renderProfile(root, identifier, user.id);
}
