// صفحة الدخول: الصفحة نفسها من السيرفر. هنا فقط: الثيم، حالة النظام الحية، وتنظيف ?error من الرابط.
import { initTheme } from '../lib/theme';

initTheme();

if (new URLSearchParams(location.search).has('error')) history.replaceState(null, '', '/login');

const status = document.getElementById('loginStatus');
if (status) {
  fetch('/api/status', { headers: { accept: 'application/json' } })
    .then(response => (response.ok ? response.json() : null))
    .then((data: any) => {
      const dot = status.querySelector('.status-dot');
      const label = status.lastChild;
      if (!data || !dot || !label) return;
      const state = String(data.overall?.state ?? '');
      const ok = state === 'operational';
      dot.className = `status-dot ${ok ? 'd-success pulse' : state === 'outage' ? 'd-danger' : 'd-warning'}`;
      label.textContent = ok ? 'كل الأنظمة شغالة' : state === 'outage' ? 'فيه عطل حاليًا' : 'بعض الخدمات فيها بطء';
    })
    .catch(() => { status.lastChild!.textContent = 'حالة النظام غير متوفرة'; });
}
