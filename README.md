# ريفايف | Revive — Discord bot + dashboard

بوت ديسكورد عربي/English مع لوحة تحكم. Python يبني كل شي (البوت، الصفحات، الرسائل).

## البنية | Structure
```
main.py                 نقطة التشغيل (خفيفة: نوايا مقلّصة، مزامنة أوامر مرة واحدة، sqlite سريع)
core/                   النواة
  config.py             الإعدادات من .env (لا أسرار في الكود)
  i18n.py · hooks.py    لغة كل سيرفر + ترجمة تلقائية لكل رسائل البوت (انظر أدناه)
  strings.py            نصوص الأنظمة الجديدة بالنسختين
  card.py               كانفاس الترحيب (Pillow)
  ticket_presets.py     12 قالب أسئلة للتذاكر
  store.py              JSON بكاش + إعدادات sqlite سريعة
  migrate.py            ينقل db/json القديمة إلى data/ تلقائياً
cogs/                   الأنظمة
  language.py logs.py welcome.py tickets.py owner.py   ← جديدة بالكامل
  bank traffic vehicle real_estate point_police id apply setup_apply role auto_role reply shorts shortscuts embed security badwords azkar levels
locales/en.json         جدول الترجمة (1100+ نص) · manual.json تعديلات يدوية
emojis/ + emojis.py     102 إيموجي خاص + مساعد الاستخدام
web_dashboard.py · dashboard_ui/ · templates/ · web/    لوحة التحكم
tools/                  make_emojis · upload_emojis · extract_strings · build_locale
data/                   (يُنشأ تلقائياً) كل قواعد البيانات — لا يُرفع إلى GitHub
```

## التشغيل | Run
```
pip install -r requirements.txt
cp .env.example .env      # ضع DISCORD_TOKEN وباقي القيم
python main.py
```
أول تشغيل ينقل ملفات `*.db` و`*.json` القديمة من مجلد البوت إلى `data/`.

## الأنظمة الجديدة
| النظام | الأوامر | وش يميّزه |
|---|---|---|
| **اللغة** | `/language` | عربي/English لكل سيرفر؛ كل الإيمبدات والأزرار والقوائم والردود تتبدّل بالكامل |
| **اللوقات** | `/logs set · all · off · status · test` | 15 نوع، أسماء المشرفين من حدث audit واحد، فرق الرتب/الصلاحيات/القنوات، حذف وتعديل الرسائل مع زر قفز |
| **الترحيب** | `/welcome setup · test · off · info` | بطاقة كانفاس (6 تصاميم، لون، خلفية مخصصة، RTL) + استوديو معاينة حية |
| **التذاكر** | `/ticket setup · panel · close · claim · add · remove · rename · priority · transcript · info` | Components V2، أسئلة قبل الفتح، استلام، أولوية، نسخة HTML، تقييم، لوق |
| **المالك** | `/bot-control …` | إحصائيات حية كل 5 دقائق، حظر سيرفرات (يحتاج OWNER_GUILD_ID) |

## الإيموجيات
```python
from emojis import E
await ch.send(f"{E.log_ban} تم الحظر")             # قبل الرفع يظهر بديل عادي
discord.ui.Button(emoji=E.pe("ticket_close"))
```
ارفعها مرة واحدة: `DISCORD_TOKEN=... python tools/upload_emojis.py` (أو `await emojis.sync(bot)`).

## كيف تتحول الكوجات القديمة للإنجليزية؟
`core/hooks.py` يترجم نصوص الإيمبد والأزرار والقوائم والمودالات **لحظة الإرسال** لسيرفرات اللغة English، اعتماداً على `locales/en.json`. الكود الأصلي ما يتغيّر ولا تتأثر القيم (`custom_id`، قيم الخيارات). لإضافة نص جديد شغّل:
```
python tools/extract_strings.py cogs/*.py > locales/entries.json   # ثم ترجمها وادمجها بـ tools/build_locale.py
```
أو أضف سطراً في `locales/manual.json`.

## التحسينات في الأداء
- إيقاف `presences` (أكبر مستهلك للذاكرة) وكاش رسائل 1500 فقط.
- sqlite: WAL + كاش صغير لكل الاتصالات (بما فيها الكوجات القديمة).
- اللوقات بحدث audit واحد بدل طلبات REST لكل حدث؛ كاش إعدادات 30 ثانية.
- التذاكر بلا بيانات داخل الأزرار (لا تسريب ذاكرة) وتُحفظ في sqlite؛ ملف JSON يُقرأ من الذاكرة ما لم يتغيّر.
- الكانفاس في خيط منفصل، حد 2 بالتوازي، ويتوقف أثناء الغارات.
- إحصائيات المالك كل 5 دقائق بدل 10 ثوانٍ، ومزامنة الأوامر مرة واحدة، و`gc.freeze()` بعد الإقلاع، و`uvloop` إن توفر.

## أمان
لا تضع التوكن أو الـ Client Secret في الكود أو في GitHub — كلها في `.env`. لو انكشف توكن أو سر في أي مكان **أعد توليده** من Developer Portal.

## لوحة التحكم
انظر `deploy/` للدومين وHTTPS. Redirect: `https://<دومينك>/callback`.
