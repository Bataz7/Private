import { raw, renderDocument, type Child } from '#jsx/jsx-runtime';
import { entryAssets, isAdminFile, type WebEntry } from './assets.js';

// قوالب HTML من السيرفر (TSX): عربي RTL، ملفات الواجهة من المانيفست، توكن CSRF، وبيانات البداية كـ JSON (ما تنفّذ).
// ما فيه أي سكربت داخل الصفحة: CSP = script-src 'self'.

const THEME = '#0f0d17';

/** JSON آمن داخل <script type="application/json">: ما يقدر يقفل الوسم أو يفتح تعليق HTML. */
export function bootJson(data: unknown) {
  return JSON.stringify(data ?? {}).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export type ShellProps = {
  title: string;
  entry: WebEntry;
  csrf?: string;
  boot?: unknown;
  admin?: boolean;
  description?: string;
  themeColor?: string;
  head?: Child;
  bodyClass?: string;
  children?: Child;
};

function Loader(props: { text?: string }) {
  return (
    <div class="boot-loader" role="status" aria-live="polite">
      <span class="boot-spinner" aria-hidden="true"></span>
      <span class="boot-text">{props.text ?? 'جاري التحميل…'}</span>
    </div>
  );
}

export function Shell(props: ShellProps) {
  const assets = entryAssets(props.entry);
  const css = assets.css.filter(href => href && (props.admin || !isAdminFile(href)));
  return (
    <html lang="ar" dir="rtl">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content={props.themeColor ?? THEME} />
        <meta name="color-scheme" content="dark light" />
        <meta name="referrer" content="strict-origin-when-cross-origin" />
        {props.description ? <meta name="description" content={props.description} /> : null}
        {props.csrf ? <meta name="csrf-token" content={props.csrf} /> : null}
        <title>{props.title}</title>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        {css.map(href => <link rel="stylesheet" href={href} />)}
        {props.head}
        {assets.js ? <script type="module" src={assets.js}></script> : null}
      </head>
      <body class={props.bodyClass ?? `page-${props.entry}`}>
        <div id="root">{props.children ?? <Loader />}</div>
        <noscript><p class="noscript">تحتاج تفعّل JavaScript عشان تستخدم هذي الصفحة.</p></noscript>
        <script type="application/json" id="boot">{raw(bootJson(props.boot ?? {}))}</script>
      </body>
    </html>
  );
}

export const renderShell = (props: ShellProps) => renderDocument(<Shell {...props} />);

// ---- صفحة الدخول: كاملة من السيرفر وتشتغل بدون JavaScript --------------------------------------------
const LOGIN_ERRORS: Record<string, string> = {
  oauth: 'انتهت صلاحية محاولة الدخول أو بدأت من مكان ثاني. جرّب مرة ثانية.',
  oauth_token: 'ديسكورد رفض طلب الدخول. جرّب مرة ثانية بعد لحظات.',
  oauth_user: 'ما قدرنا نقرأ حسابك من ديسكورد. جرّب مرة ثانية.',
  oauth_guilds: 'ما قدرنا نقرأ سيرفراتك من ديسكورد. جرّب مرة ثانية.',
  server: 'ما لقينا سيرفر فيه البوت وأنت عندك فيه رتبة الستاف.',
  member: 'البوت ما قدر يلقى عضويتك في السيرفر.',
  forbidden: 'هذي اللوحة للستاف فقط. تحتاج رتبة الستاف في السيرفر.',
  expired: 'انتهت جلستك. سجّل دخولك من جديد.',
  logout: 'تم تسجيل الخروج.',
  config: 'تسجيل الدخول بديسكورد مو مضبوط في اللوحة (DISCORD_CLIENT_SECRET).',
};

export function loginMessage(code: string) {
  return LOGIN_ERRORS[code] ?? '';
}

function LogoMark() {
  return (
    <svg class="login-logo" viewBox="0 0 48 48" width="56" height="56" aria-hidden="true">
      <defs>
        <linearGradient id="rift-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#a99bff" />
          <stop offset="1" stop-color="#6a5af9" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="40" height="40" rx="12" fill="url(#rift-g)" />
      <path d="M17 34V14h9.5a6 6 0 0 1 1.6 11.8L33 34h-5.2l-4.4-7.6H21.6V34z M21.6 22.6h4.6a2.3 2.3 0 0 0 0-4.6h-4.6z" fill="#fff" />
    </svg>
  );
}

export function LoginPage(props: { error?: string; configured: boolean }) {
  const message = props.configured ? loginMessage(props.error ?? '') : loginMessage('config');
  const isInfo = props.error === 'logout';
  return (
    <main class="login-page">
      <section class="login-card" aria-labelledby="login-title">
        <LogoMark />
        <h1 id="login-title" class="login-title">لوحة تحكم Rift</h1>
        <p class="login-subtitle">إدارة الستاف والشفتات والطلبات من مكان واحد.</p>
        {message ? <p class={isInfo ? 'login-note' : 'login-error'} role={isInfo ? 'status' : 'alert'}>{message}</p> : null}
        {props.configured ? (
          <a class="login-button" href="/auth/discord" rel="nofollow">
            <svg class="login-button-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path fill="currentColor" d="M20.3 4.4A19.6 19.6 0 0 0 15.4 3l-.6 1.2a18 18 0 0 0-5.6 0L8.6 3a19.5 19.5 0 0 0-4.9 1.4C.6 9 0 13.6.3 18.1a19.8 19.8 0 0 0 6 3l1.3-2a12.7 12.7 0 0 1-2-1l.5-.4a14 14 0 0 0 11.8 0l.5.4-2 1 1.3 2a19.7 19.7 0 0 0 6-3c.4-5.2-.7-9.8-3.4-13.7ZM8.5 15.3c-1.2 0-2.1-1-2.1-2.3s.9-2.3 2.1-2.3 2.2 1 2.1 2.3c0 1.2-.9 2.3-2.1 2.3Zm7 0c-1.2 0-2.1-1-2.1-2.3s.9-2.3 2.1-2.3 2.2 1 2.1 2.3c0 1.2-.9 2.3-2.1 2.3Z" />
            </svg>
            <span>تسجيل الدخول بديسكورد</span>
          </a>
        ) : null}
        <p class="login-footer">الدخول للستاف فقط. نطلب صلاحيات قراءة حسابك وسيرفراتك فقط.</p>
        <nav class="login-links" aria-label="روابط">
          <a href="/status">حالة الخدمة</a>
        </nav>
      </section>
    </main>
  );
}

// ---- صفحة الحالة العامة ------------------------------------------------------------------------------
export type StatusMetaData = { title: string; description: string; url: string; themeColor: string };

function StatusHead(props: { meta: StatusMetaData }) {
  const { meta } = props;
  return (
    <>
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content="ستاف Rift" />
      <meta property="og:title" content={meta.title} />
      <meta property="og:description" content={meta.description} />
      {meta.url ? <meta property="og:url" content={meta.url} /> : null}
      {meta.url ? <link rel="canonical" href={meta.url} /> : null}
      <meta name="twitter:card" content="summary" />
      <meta name="twitter:title" content={meta.title} />
      <meta name="twitter:description" content={meta.description} />
      <link rel="alternate" type="application/rss+xml" title="حالة Rift" href="/status.rss" />
    </>
  );
}

export function renderStatusPage(meta: StatusMetaData, boot: unknown) {
  return renderShell({ title: 'حالة Rift', entry: 'status', description: meta.description, themeColor: meta.themeColor, head: <StatusHead meta={meta} />, boot, bodyClass: 'page-status' });
}

/** صفحة نموذج التقديم العام: توكن CSRF لو فيه جلسة (المتقدّم يسجل دخول بديسكورد أول). */
export function renderApplyPage(formId: string, csrf: string | undefined) {
  return renderShell({ title: 'نموذج التقديم · Rift', entry: 'apply', csrf, boot: { formId }, bodyClass: 'page-apply' });
}
