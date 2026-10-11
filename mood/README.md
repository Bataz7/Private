# Mood Bot 🌈

**[العربية](#العربية) · [English](#english)**

بوت ديسكورد يرسل كل يوم الساعة **2:30** رسالة خاصة لشخص تحدده: **"كيف كان يومك؟"** مع **سؤال يومي جديد** 💭.
يسجّل مزاجه ووش اللي خلّى يومه حلو أو سيء، ويطلع **تقارير احترافية** بالرسوم، **بالعربي أو الإنجليزي**.

<p align="center"><img src="docs/emojis.png" alt="ايموجيات البوت" width="760"></p>

- **TypeScript** يشتغل مباشرة على Node.js 22.18+ بدون بناء
- **بدون أي مكتبة وقت التشغيل**. البوت كله **~420 كيلوبايت**
- **ذكاء اصطناعي**: OpenRouter (GPT-4o وغيره)، أو OpenAI، أو Claude، أو أي API متوافق
- **كل قواعد البيانات**: SQLite (الافتراضي)، PostgreSQL، MySQL/MariaDB، MongoDB، مع أداة نقل بينها
- **118 اختبار**، منها اختبار على 4 قواعد بيانات حقيقية، واختبار يشغّل البوت كامل ضد سيرفر ديسكورد وهمي

---

<a id="العربية"></a>

## ✨ المميزات

| | |
|---|---|
| 🕑 **سؤال يومي** | يوصل في الخاص بالوقت اللي تحدده، مع 5 وجوه وزر "ذكّرني بعد ساعة" |
| 💭 **سؤال اليوم** | 48 سؤال حلو يتغير كل يوم ("وش أكثر شي ضحّكك اليوم؟"، "لو يومك أغنية وش اسمها؟"…)، ما يتكرر لين تخلص كلها، وسؤال امتنان كل أسبوع |
| 📝 **تفاصيل اليوم** | أبرز شي صار، المشاكل، جواب سؤال اليوم، ساعات النوم، الطاقة من 10 |
| 🏷️ **الأنشطة** | 22 نشاط (شغل، رياضة، أصحاب، ضغط، نوم سيء…)، والتقارير تحسب وش يرفع مزاجه ووش ينزله |
| 🌐 **عربي + English** | كل شخص يختار لغته بـ `/language`: الرسائل والأزرار والتقارير والذكاء الاصطناعي كلها تتغير |
| 🤖 **ذكاء اصطناعي** | رد ودود على كل تسجيل، وتحليل احترافي للتقارير، ودردشة حرة في الخاص مع ذاكرة |
| 📊 **تقارير HTML** | رسم يومي مع متوسط متحرك، خريطة أيام، توزيع، أيام الأسبوع، أثر الأنشطة، النوم والطاقة، أسئلة اليوم، الإنجازات، والسجل الكامل. فيها وضع ليلي وتشتغل على الجوال وبدون نت |
| 📬 **تقارير تلقائية** | أسبوعية (الجمعة 9 الليل) وشهرية، للشخص ولك، كل واحد بلغته |
| 🔍 **أنماط** | `/insights`: وش يرفع المزاج، أحلى وأصعب يوم، علاقة النوم والطاقة بالمزاج، الاتجاه، التقلب |
| 🏆 **إنجازات وسلسلة** | 17 إنجاز تحفّز على التسجيل اليومي 🔥 |
| 💛 **شبكة أمان** | لو انكتب كلام مقلق يرسل رسالة دعم بأرقام المساعدة وينبّهك، ولو المزاج سيء 3 أيام ورا بعض يوصلك تنبيه |
| ⏰ **تذكير وإجازة** | تذكير تلقائي لو ما رد (حتى بعد منتصف الليل)، ووضع إجازة |
| 🗄️ **أي قاعدة بيانات** | SQLite بدون تثبيت، أو PostgreSQL / MySQL / MongoDB بسطر واحد في `.env` |
| 📦 **بياناتك لك** | تصدير CSV/JSON، وحذف كامل، ونسخ احتياطية يومية، ونقل بين قواعد البيانات |
| 🔒 **خصوصية** | البيانات ما تنعرض إلا في الخاص مع البوت. في السيرفرات والقروبات تطلع مخفية لك بس |

<p align="center"><img src="docs/report-preview.png" alt="شكل التقرير" width="900"></p>

## 🚀 التشغيل

**1) نزّل المشروع على جهازك:**
من صفحة المستودع اضغط **Code** ← **Download ZIP** وفك الضغط، أو:
```bash
git clone -b claude/awesome-davinci-f7lro7 https://github.com/bataz7/private.git
cd private/mood
```

**2) نزّل Node.js 22.18 أو أحدث** من [nodejs.org](https://nodejs.org).

**3) سوّ البوت في ديسكورد:**
1. ادخل [Discord Developer Portal](https://discord.com/developers/applications) ← **New Application**
2. **Bot** ← **Reset Token** وانسخ التوكن
3. **Installation** ← فعّل Guild Install وحط في Scopes: `bot` و `applications.commands`
4. ضيف البوت لسيرفر **فيه الشخص** (لازم يكونون في سيرفر واحد عشان يرسل له خاص)

**4) جيب الـ ID:** ديسكورد ← الإعدادات ← Advanced ← فعّل **Developer Mode** ← كليك يمين على الشخص ← **Copy User ID**

**5) الإعدادات:**
```bash
cp .env.example .env
```
افتح `.env` وعبّي:
```env
DISCORD_TOKEN=توكن البوت
TARGET_USER_ID=ID الشخص
OWNER_ID=ID حقك
OPENROUTER_API_KEY=مفتاح OpenRouter حقك
CHECKIN_TIME=14:30
```

> 🔑 **مفتاح الذكاء الاصطناعي** يتحط في `.env` بس، **ولا تحطه في الكود**. ملف `.env` ما يترفع على GitHub (موجود في `.gitignore`)، كذا مفتاحك ما ينسرق ولا يتوقف.

**6) شغّل:**
```bash
npm start
```
ما يحتاج `npm install`. أول تشغيل يسجّل الأوامر ويرفع الايموجيات تلقائياً.

> 💡 تبي تشوف التقرير قبل كل شي؟ `npm run demo` (أو `npm run demo -- 30 en` بالإنجليزي)

## 🗄️ قواعد البيانات

| النوع | `DATABASE_URL` | تثبيت | الحجم |
|---|---|---|---|
| **SQLite** (الافتراضي) | فاضي، أو `sqlite:./data/mood.db` | ما يحتاج | 0 |
| **PostgreSQL** | `postgres://user:pass@host:5432/mood` | `npm install pg` | ~1 ميقا |
| **MySQL / MariaDB** | `mysql://user:pass@host:3306/mood` | `npm install mysql2` | ~5 ميقا |
| **MongoDB** (مثلاً Atlas المجاني) | `mongodb+srv://user:pass@cluster.x.mongodb.net/mood` | `npm install mongodb` | ~8 ميقا |

الجداول تنسوى تلقائياً أول تشغيل، والنص العربي والإيموجي مدعومين في كلها.

**تبي تنقل بياناتك من قاعدة لثانية؟**
```bash
npm run migrate -- sqlite:./data/mood.db "mongodb+srv://user:pass@cluster.mongodb.net/mood"
```
**استرجاع من نسخة احتياطية JSON:**
```bash
npm run migrate -- backup:./data/backups/mood-2026-10-11.json sqlite:./data/mood.db
```

## 🤖 الذكاء الاصطناعي

| المزوّد | في `.env` | الموديل الافتراضي |
|---|---|---|
| **OpenRouter** (أي موديل) | `OPENROUTER_API_KEY=sk-or-…` | `openai/gpt-4o` |
| OpenAI | `OPENAI_API_KEY=sk-…` | `gpt-4o` |
| Anthropic Claude | `ANTHROPIC_API_KEY=sk-ant-…` | `claude-opus-5-5` |
| أي API متوافق (Ollama، Groq…) | `OPENAI_API_KEY=…` + `AI_BASE_URL=…` | `AI_MODEL` |

غيّر الموديل بـ `AI_MODEL` لأي موديل من [قائمة OpenRouter](https://openrouter.ai/models) (انسخ اسمه زي ما هو، مثل `openai/gpt-4o-mini` لتكلفة أقل).
فيه إعادة محاولة تلقائية، وحد 40 رسالة بالساعة عشان التكلفة. **وبدون مفتاح كل شي يشتغل**: الردود جاهزة والتحليل محلي.

## 💬 الأوامر

| الأمر | وش يسوي |
|---|---|
| `/checkin` | سجّل يومك الحين |
| `/report` | تقرير أسبوع، شهر، 3 شهور أو سنة، مع ملف HTML |
| `/insights` | وش يرفع مزاجك ووش ينزله |
| `/history` | آخر الأيام |
| `/achievements` | الإنجازات والسلسلة 🔥 |
| `/talk` | دردش مع مود 🤖 (أو كلّمه بالخاص) |
| `/language` | عربي / English |
| `/settings` | `time` · `timezone` · `reminder` · `pause` · `resume` · `show` |
| `/export` | CSV أو JSON |
| `/forget` | احذف كل البيانات |
| `/admin` | للمالك: نظرة عامة، إرسال السؤال، نسخة احتياطية |
| `/help` | المساعدة |

## 🐳 تشغيل 24/7

```bash
docker compose up -d          # SQLite
```
لقاعدة ثانية غيّر `DB_DRIVER` في `docker-compose.yml` إلى `pg` أو `mysql2` أو `mongodb`.
أو بـ pm2: `pm2 start "npm start" --name mood-bot`

## ⚙️ كل الإعدادات

كل الإعدادات موجودة في [`.env.example`](.env.example) مع شرح لكل وحدة. أهمها:
`DEFAULT_LANG` (ar/en) · `TIMEZONE` · `CHECKIN_TIME` · `REMINDER_AFTER_HOURS` · `WEEKLY_REPORT_DAY` · `WEEKLY_REPORT_TIME` · `MONTHLY_REPORT` · `ALERTS` · `LOW_MOOD_ALERT_DAYS` · `NOTIFY_OWNER` · `AI_MODEL` · `AI_CHAT` · `DATABASE_URL` · `BACKUP_KEEP`

## 🛡️ قوة وثبات

- **ما يفوّت السؤال**: لو البوت كان طافي وقت السؤال، يرسله أول ما يشتغل
- **منتصف الليل**: التأجيل والتذكير يبقون لنفس اليوم حتى لو عدّت الساعة 12، وما يضيع سؤال اليوم الجديد
- **إعادة اتصال ذكية**: يكمل الجلسة بعد أي انقطاع ويكشف الاتصال الميت
- **يحترم حدود ديسكورد**: طابور لكل مسار، وردود التفاعلات سريعة بدون انتظار
- **ما يطيح**: كل أمر ومهمة معزولة، والأخطاء ترجع برسالة لطيفة، وفيه إعادة محاولة تصاعدية
- **حدود ديسكورد مفحوصة**: الاختبارات تتأكد إن كل رسالة وزر ونافذة داخل الحدود حتى في أسوأ حالة
- **خصوصية**: لو فيه أكثر من شخص بدون مالك، ما أحد يشوف بيانات الثاني
- **إطفاء نظيف** مع `Ctrl+C` و `SIGTERM`

## 🧪 التطوير

```bash
npm install        # أدوات التطوير (TypeScript + مكتبات قواعد البيانات للاختبار)
npm run check      # فحص الأنواع + كل الاختبارات
npm run test:db    # اختبارات قواعد البيانات (حط TEST_POSTGRES_URL / TEST_MYSQL_URL / TEST_MONGO_URL)
npm run demo       # تقرير تجريبي
npm run size       # حجم البوت
```

```
mood/
├── start.mjs              يتأكد من نسخة Node ويشغّل البوت
├── src/
│   ├── index.ts           نقطة التشغيل
│   ├── app.ts             قلب البوت
│   ├── scheduler.ts       السؤال اليومي، التذكير، التقارير، النسخ الاحتياطية
│   ├── router.ts          توزيع الأوامر والأزرار مع الصلاحيات
│   ├── i18n.ts            القاموس العربي والإنجليزي
│   ├── questions.ts       أسئلة اليوم
│   ├── features/          checkin · reports · companion · settings · alerts · misc
│   ├── store/             sql (SQLite/PostgreSQL/MySQL) · mongo · index
│   ├── discord/           Gateway (WebSocket) · REST · ثوابت
│   ├── ai.ts              OpenRouter / OpenAI / Claude
│   ├── report.ts          تقرير HTML والرسوم
│   └── stats.ts · achievements.ts · safety.ts · moods.ts · time.ts · config.ts · emojis.ts
├── scripts/               demo-report · migrate-db · size
├── test/                  118 اختبار + سيرفر ديسكورد وهمي
└── tools/make_emojis.py   أداة رسم الايموجيات (للتطوير فقط)
```

> 🔒 **الخصوصية:** البيانات محفوظة في قاعدة البيانات اللي تختارها، وما تطلع إلا لمزوّد الذكاء الاصطناعي لو فعّلته.
> الشخص يشوف تحت كل سؤال إن تقاريره يطّلع عليها المالك، ويقدر يصدّر بياناته أو يحذفها متى ما بغى.
> 💛 البوت مو بديل عن مختص.

---

<a id="english"></a>

## English

**Mood Bot** is a Discord bot that DMs someone every day at **2:30 PM**: *"How was your day?"*, with a **fresh daily question** 💭. It logs their mood and what made the day good or bad, then builds **professional reports with charts**, in **Arabic or English**.

**Highlights**
- TypeScript running directly on Node.js 22.18+ with **zero runtime dependencies** (~420 KB total)
- **AI**: OpenRouter (GPT-4o or any model), OpenAI, Anthropic Claude, or any OpenAI-compatible API, plus local fallbacks with no key
- **Any database**: SQLite (default), PostgreSQL, MySQL/MariaDB, MongoDB, with a migration tool between them
- **Per-user language** (`/language`): messages, buttons, reports and AI replies all switch
- 48 rotating daily questions, 22 activity tags, 17 achievements, streaks, insights, safety net and owner alerts
- Weekly and monthly HTML reports (dark mode, mobile, offline), CSV/JSON export, daily backups
- 118 tests, including the full store contract against 4 real databases and an end-to-end run against a mock Discord

**Quick start**
```bash
git clone -b claude/awesome-davinci-f7lro7 https://github.com/bataz7/private.git
cd private/mood
cp .env.example .env     # set DISCORD_TOKEN, TARGET_USER_ID, OWNER_ID, OPENROUTER_API_KEY, DEFAULT_LANG=en
npm start
```
For PostgreSQL / MySQL / MongoDB, set `DATABASE_URL` and run `npm install pg` / `mysql2` / `mongodb`.
Move data between databases with `npm run migrate -- <from> <to>`.

> 🔑 Keep API keys in `.env` only (it's git-ignored), never in source code.
