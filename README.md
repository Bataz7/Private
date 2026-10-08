# ريفايف | Revive — Dashboard

لوحة تحكم بوت ريفايف. **Python يبني كل الصفحات** (FastAPI + قوالب Jinja2)، والمتصفح فيه JS بسيط فقط للأنميشن والتفاعل. عربي / English.

## البنية | Structure
```
web_dashboard.py        الباكند: OAuth2، الـ API، الصفحات، إرسال البانلات (يستدعيه البوت: start_web(bot))
dashboard_ui/           واجهة بايثون
  schema.py             أقسام اللوحة وحقولها ومجموعاتها (أضف قسماً جديداً من هنا)
  i18n_data.py + i18n.py  كل النصوص عربي/English (المصدر الوحيد للترجمة)
  themes.py             ألوان الثيمات السبعة (يولّد themes.css)
  icons.py              مكتبة الأيقونات (duotone)
  team.py               أعضاء الفريق
  render.py             محرك القوالب
templates/              قوالب Jinja2 (landing, team, dashboard, views/*)
web/assets/             css + js (مؤثرات، تفاعل) + favicon
emojis/                 حزمة إيموجيات البوت (88 PNG) + manifest.json
emojis.py               استخدام الإيموجيات داخل كوجات البوت
tools/                  make_emojis.py (يصنع الحزمة) · upload_emojis.py (يرفعها)
deploy/                 Caddyfile · nginx.conf.example
```
ضع شعارك في `web/logo.png` (وإلا تظهر أيقونة بديلة).

## التشغيل | Setup
1. `pip install -r requirements.txt`
2. انسخ `.env.example` إلى `.env` واملأ `DISCORD_CLIENT_SECRET` و `DASHBOARD_URL`.
3. في Discord Developer Portal → OAuth2 → Redirects أضف: `https://<الدومين>/callback`
4. شغّل البوت كالعادة (يستدعي `start_web(bot)`).

## HTTPS والدومين
أي زيارة عبر http أو دومين/منفذ آخر تتحوّل (308) إلى `DASHBOARD_URL`. استخدم بروكسي (أمثلة في `deploy/`، لازم يرسل `X-Forwarded-Proto`) أو `SSL_CERTFILE` + `SSL_KEYFILE`. للتجربة المحلية `FORCE_HTTPS=0`.

## الإيموجيات | Emojis
```python
from emojis import E
await ch.send(f"{E.log_ban} تم الحظر")           # قبل الرفع يظهر بديل عادي
await emojis.sync(bot)                            # داخل setup_hook: يرفع الناقص كإيموجيات للتطبيق
```
أو مرة واحدة: `DISCORD_TOKEN=... python tools/upload_emojis.py`. لتغيير التصميم أو الإضافة: عدّل `PACK` في `tools/make_emojis.py` ثم شغّله.

## الترجمة والثيمات
نصوص جديدة: `dashboard_ui/i18n_data.py` (ar و en). ثيم جديد: كتلة في `dashboard_ui/themes.py` + اسمه في i18n.
