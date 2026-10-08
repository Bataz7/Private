# ريفايف | Revive — Dashboard

لوحة تحكم بوت ريفايف (FastAPI + واجهة HTML/JS). عربي / English.

## البنية | Structure
```
web_dashboard.py          الباكند: OAuth2، الـ API، إرسال البانلات (يستدعيه البوت: start_web(bot))
web/
  index.html              الصفحة الرئيسية  →  /
  dashboard.html          لوحة التحكم      →  /dashboard  (تتطلب تسجيل دخول)
  assets/css/             base.css · landing.css · dashboard.css
  assets/js/              i18n.js (كل الترجمات) · icons.js (الأيقونات) · common.js · landing.js · dashboard.js
  assets/img/favicon.png
deploy/                   Caddyfile · nginx.conf.example
.env.example              كل الإعدادات (انسخه إلى .env)
```
ملاحظة: الصفحات تستخدم `web/logo.png` و `web/team.html` (ملفاتك الحالية) — ضعهما داخل مجلد `web/`.

## التشغيل | Setup
1. `pip install -r requirements.txt`
2. انسخ `.env.example` إلى `.env` واملأ `DISCORD_CLIENT_SECRET` و `DASHBOARD_URL`.
3. في [Discord Developer Portal](https://discord.com/developers/applications) → OAuth2 → Redirects أضف **بالضبط**:
   `https://<الدومين>/callback`
4. شغّل البوت كالعادة (يستدعي `start_web(bot)`).

## HTTPS والدومين
- أي زيارة عبر `http://` أو عبر دومين/منفذ مختلف تتحوّل تلقائياً (308) إلى `DASHBOARD_URL` بـ https.
- الزر «لوحة التحكم» يفتح `/dashboard` على الدومين الرسمي، وبعد تسجيل الدخول يعيدك إلى `/dashboard`.
- اختر واحدة: **بروكسي** (Caddy/nginx/Cloudflare — أمثلة في `deploy/`، لازم يرسل `X-Forwarded-Proto`)، أو **شهادة مباشرة** عبر `SSL_CERTFILE` و `SSL_KEYFILE`.
- للتجربة المحلية: `FORCE_HTTPS=0` ثم افتح `http://localhost:<port>`.

## الترجمة | i18n
كل النصوص في `web/assets/js/i18n.js` (`ar` و `en`). رسائل أخطاء الباكند تُترجم تلقائياً حسب لغة الواجهة (`ERR_EN` في `web_dashboard.py`).
لإضافة قسم جديد: أضفه في `SCHEMA` داخل `dashboard.js` + نصوصه في `i18n.js` + قارئه/كاتبه في `AD` داخل `web_dashboard.py`.
