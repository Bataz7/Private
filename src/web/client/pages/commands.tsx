// الاختصارات: أهم أقسام الإدارة في مكان واحد، وأوامر ديسكورد المتاحة للستاف.
import { mount } from '#jsx/jsx-runtime';
import type { PageCtx } from '../shell/types';
import type { RouteKey } from '../shell/routes';
import { Icon } from '../ui/Icon';
import { Card, PageHeader } from '../ui/kit';

const ACTIONS: Array<[string, string, string, RouteKey, boolean?]> = [
  ['people', 'الستاف', 'ملفات الفريق والملاحظات والنقاط وساعات الشفت، مع الفصل والمزامنة.', 'staff', true],
  ['medal-star', 'النقاط', 'الترتيب، طريقة احتساب النقاط، وإضافة أو خصم نقاط بسبب.', 'points'],
  ['chart-2', 'التقارير', 'التقارير الأسبوعية التلقائية وإرسال تقارير لأي فترة.', 'reports'],
  ['danger', 'الشكاوى', 'مراجعة الشكاوى واعتمادها أو رفضها.', 'complaints', true],
  ['briefcase', 'الإجازات', 'طلبات الإجازة والتمديد والرجوع.', 'leaves'],
  ['logout-01', 'الاستقالات', 'تقديم ومراجعة طلبات الاستقالة.', 'resignations'],
  ['radar', 'حالة البوت', 'حالة الظهور والعبارات المتغيرة.', 'status', true],
  ['setting-2', 'إعدادات السيرفر', 'الرتب والرومات والتحقق من التواجد وحد الإنذارات.', 'settings', true],
];
const SLASH: Array<[string, string]> = [
  ['/shift', 'بدء وإنهاء الشفت والبريك'], ['/points', 'نقاطك (خاصة لك)'], ['/leaderboard', 'أفضل 10 بالنقاط'], ['/profile', 'بطاقة الستاف'],
  ['/rating', 'تقييم عضو ستاف'], ['/complaint', 'رفع شكوى'], ['/leave', 'طلب إجازة'], ['/resign', 'طلب استقالة'], ['/assist', 'تسجيل مساعدة عضو'],
];

export default function commands(ctx: PageCtx) {
  mount(ctx.root, [
    <PageHeader title="الاختصارات" subtitle="أهم عمليات الإدارة من مكان واحد بدل التنقل بين الأوامر." />,
    <div class="command-grid">
      {ACTIONS.filter(([, , , , admin]) => !admin || ctx.admin).map(([icon, title, text, key]) => (
        <a class="command-card" href={`/dashboard/${key}`} onClick={(event: MouseEvent) => { if (event.ctrlKey || event.metaKey) return; event.preventDefault(); ctx.navigate(key); }}>
          <span class="command-icon"><Icon name={icon} size={22} /></span>
          <span class="command-copy"><b>{title}</b><small>{text}</small></span>
          <Icon name="arrow-right-01" size={18} flip class="command-arrow" />
        </a>
      ))}
    </div>,
    <Card title="أوامر ديسكورد" subtitle="النتائج الخاصة (النقاط والتقارير والتقييمات) تظهر لصاحبها فقط." icon="command-square" class="mt">
      <div class="slash-grid">{SLASH.map(([name, text]) => <div class="slash"><code class="ltr">{name}</code><span>{text}</span></div>)}</div>
    </Card>,
  ]);
}
