// بيانات البداية التي يضعها السيرفر في <script type="application/json" id="boot">.

export type SessionUser = {
  id: string;
  username: string;
  avatar?: string | null;
  isOwner?: boolean;
  isAdministrator?: boolean;
  isManagement?: boolean;
  isStaff?: boolean;
  guilds?: Array<{ id: string; name: string; icon?: string | null; owner?: boolean }>;
};

export type BootData = {
  user?: SessionUser | null;
  guild?: { id: string; name: string; icon?: string | null } | null;
  guildId?: string;
  guilds?: Array<{ id: string; name: string; icon?: string | null }>;
  page?: string;
  [key: string]: unknown;
};

let cached: BootData | null = null;

export function readBoot(): BootData {
  if (cached) return cached;
  try {
    cached = JSON.parse(document.getElementById('boot')?.textContent || '{}') as BootData;
  } catch {
    cached = {};
  }
  return cached ?? {};
}

export const isAdmin = (user: SessionUser | null | undefined): boolean => Boolean(user?.isOwner || user?.isAdministrator || user?.isManagement);

/** رابط صورة المستخدم من ديسكورد (السيرفر أحيانًا يرسل الهاش فقط). */
export function avatarUrl(user: { id?: string; avatar?: string | null } | null | undefined, size = 128): string {
  if (!user?.avatar) return '';
  const value = String(user.avatar);
  if (/^https?:\/\//.test(value)) return value;
  return `https://cdn.discordapp.com/avatars/${user.id}/${value}.png?size=${size}`;
}
