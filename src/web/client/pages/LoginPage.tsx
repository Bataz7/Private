// صفحة الدخول — يرسمها السيرفر كاملة (تشتغل بدون JavaScript). نقية: ما تلمس أي API للمتصفح.
// مدخل login.tsx يضيف فقط: حالة النظام الحية والثيم.
import { DiscordLogo } from '../ui/Icon';

const MESSAGES: Record<string, [string, string]> = {
  oauth: ['انلغى تسجيل الدخول', 'ديسكورد ما أرسل رمز الدخول، أو بدأت المحاولة من مكان ثاني. اضغط الزر ووافق على الطلب.'],
  oauth_token: ['ديسكورد ما أكّد الدخول', 'رمز الدخول انتهى أو استُخدم قبل. جرّب مرة ثانية.'],
  oauth_user: ['ما قدرنا نقرأ حسابك', 'ديسكورد ما يرد الحين. انتظر شوي وجرّب مرة ثانية.'],
  oauth_guilds: ['ما قدرنا نقرأ سيرفراتك', 'ديسكورد ما رجّع قائمة سيرفراتك. جرّب بعد لحظات.'],
  server: ['ما لقينا سيرفر', 'البوت مو موجود في أي سيرفر عندك فيه رتبة الستاف.'],
  member: ['ما لقيناك في السيرفر', 'تأكد إنك للحين عضو في السيرفر وسجّل دخولك من جديد.'],
  forbidden: ['ما عندك صلاحية', 'اللوحة للستاف فقط. تحتاج رتبة الستاف في السيرفر — اطلبها من الإدارة.'],
  expired: ['انتهت جلستك', 'سجّل دخولك من جديد عشان تكمل.'],
  logout: ['تم تسجيل الخروج', 'نشوفك على خير 👋'],
  config: ['الدخول مو مفعّل', 'تسجيل الدخول بديسكورد مو مضبوط في اللوحة (DISCORD_CLIENT_SECRET).'],
};

export const loginMessage = (code: string | undefined | null) => (code ? MESSAGES[code] ?? ['صار خطأ', 'ما كمل تسجيل الدخول. جرّب مرة ثانية.'] : null);

export function LoginPage(props: { error?: string | null; configured?: boolean }) {
  const configured = props.configured !== false;
  const message = configured ? loginMessage(props.error) : loginMessage('config');
  const info = props.error === 'logout';
  return (
    <main class="login-page">
      <div class="login-bg" aria-hidden="true"><i class="orb a" /><i class="orb b" /><i class="grid" /></div>
      <section class="login-card" aria-labelledby="login-title">
        <div class="login-brand">
          <img class="login-logo" src="/a/s/logo-mark.svg" width="48" height="48" alt="" />
          <span><b>rift</b><small>إدارة الستاف</small></span>
        </div>
        {message ? (
          <div class={info ? 'login-note' : 'login-error'} role={info ? 'status' : 'alert'}>
            <b>{message[0]}</b><span>{message[1]}</span>
          </div>
        ) : null}
        <h1 id="login-title" class="login-title">أهلًا بك في <em>بيت فريقك.</em></h1>
        <p class="login-subtitle">شفتات تبدأ لحالها، تقارير أسبوعية بالفويس والتفاعل، طلبات وتقديمات وأكثر — كلها في مكان واحد هادي.</p>
        {configured ? (
          <a class="login-button" href="/auth/discord" rel="nofollow">
            <span class="login-button-icon"><DiscordLogo size={22} /></span>
            <span>تسجيل الدخول بديسكورد</span>
            <svg class="login-arrow" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M19 12H5m6-6-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </a>
        ) : null}
        <ul class="login-points">
          <li><span aria-hidden="true">🛡️</span>رتبتك في ديسكورد تحدد وش تقدر تفتح.</li>
          <li><span aria-hidden="true">👁️</span>دخول للقراءة فقط: نشوف اسمك وصورتك وسيرفراتك بس.</li>
        </ul>
        <footer class="login-footer">
          <span class="login-status" id="loginStatus"><i class="status-dot" />حالة النظام</span>
          <nav class="login-links" aria-label="روابط"><a href="/status">صفحة الحالة</a></nav>
        </footer>
      </section>
      <aside class="login-showcase" aria-hidden="true">
        <div class="lf lf-1"><div class="lf-head"><span class="lf-live"><i />في الشفت</span><small>بدأ تلقائيًا</small></div><b class="ltr">3h 42m</b><div class="lf-bar"><i /></div><small>بدأ بعد 20 رسالة خلال 10 دقايق</small></div>
        <div class="lf lf-2"><div class="lf-head"><span>التقرير الأسبوعي</span><small>الاثنين</small></div><div class="lf-grade"><b>A</b><span><strong>86</strong><small>من 100</small></span></div><div class="lf-chips"><span>فويس 6.5س</span><span>رسائل 412</span><span>المركز #2</span></div></div>
        <div class="lf lf-3"><div class="lf-head"><span>التفاعل</span><small>هذا الأسبوع</small></div><div class="lf-spark"><i style={{ height: '38%' }} /><i style={{ height: '56%' }} /><i style={{ height: '44%' }} /><i style={{ height: '78%' }} /><i style={{ height: '64%' }} /><i style={{ height: '92%' }} /><i style={{ height: '70%' }} /></div></div>
        <img class="login-mark" src="/a/s/logo-mark.svg" alt="" />
      </aside>
    </main>
  );
}

export default LoginPage;
