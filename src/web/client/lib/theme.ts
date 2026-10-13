// الثيم: فاتح أو داكن أو حسب النظام. الاختيار ينحفظ في localStorage (وكوكي عشان السيرفر يقدر يرسمه من البداية).

export type ThemeChoice = 'light' | 'dark' | 'system';
const KEY = 'rift-theme';
const media = () => matchMedia('(prefers-color-scheme: dark)');

export function themeChoice(): ThemeChoice {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

export const resolvedTheme = (choice = themeChoice()): 'light' | 'dark' => (choice === 'system' ? (media().matches ? 'dark' : 'light') : choice);

export function applyTheme(choice = themeChoice()): void {
  const root = document.documentElement;
  if (choice === 'system') delete root.dataset.theme;
  else root.dataset.theme = choice;
  root.style.colorScheme = resolvedTheme(choice);
  window.dispatchEvent(new CustomEvent('rift:theme', { detail: resolvedTheme(choice) }));
}

export function setTheme(choice: ThemeChoice): void {
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch { /* التخزين مقفول: يتغير لهذه الجلسة فقط */ }
  document.cookie = `${KEY}=${choice}; Path=/; Max-Age=31536000; SameSite=Lax`;
  applyTheme(choice);
}

/** يبدّل بين الفاتح والداكن (من الوضع الظاهر حاليًا). */
export function toggleTheme(): 'light' | 'dark' {
  const next = resolvedTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}

export function initTheme(): void {
  applyTheme();
  media().addEventListener('change', () => {
    if (themeChoice() === 'system') applyTheme('system');
  });
}
