"""قوالب أسئلة التذاكر | Ticket question presets (عربي/English).

كل قالب = أسئلة تظهر في نافذة (Modal) قبل فتح التذكرة، وتُعرض إجاباتها داخل التذكرة للإدارة.
الحد: 5 أسئلة، عنوان السؤال ≤ 45 حرف، المثال ≤ 100 حرف (قيود ديسكورد).
السؤال: (مفتاح، عنوان عربي، English label، مثال عربي، English placeholder، نوع: s قصير / p فقرة، إلزامي)
"""

PRESETS: dict[str, dict] = {
    "support": {"ar": "الدعم الفني", "en": "Technical support", "emoji": "ticket_support", "q": [
        ("kind", "ما نوع المشكلة؟", "What kind of problem is it?", "مثال: ما أقدر أدخل / خطأ في أمر", "e.g. can't join / command error", "s", True),
        ("desc", "اشرح مشكلتك بالتفصيل", "Describe your problem in detail", "اكتب كل ما يساعدنا نفهم المشكلة", "Tell us everything that helps us understand", "p", True),
        ("when", "متى بدأت المشكلة؟", "When did it start?", "اليوم / أمس / من أسبوع", "today / yesterday / a week ago", "s", False),
        ("tried", "وش جربت لحلها؟", "What have you already tried?", "إعادة تشغيل، تغيير الإعدادات…", "restart, changing settings…", "p", False)]},
    "inquiry": {"ar": "استفسار", "en": "General inquiry", "emoji": "message", "q": [
        ("q", "ما هو استفسارك؟", "What is your question?", "اكتب سؤالك بوضوح", "Write your question clearly", "p", True),
        ("topic", "القسم المعني بالاستفسار", "Which topic is it about?", "الرول بلاي / المتجر / التقديمات…", "roleplay / store / applications…", "s", False)]},
    "complaint": {"ar": "شكوى", "en": "Complaint", "emoji": "warning", "q": [
        ("who", "اسم أو آيدي المشتكى عليه", "Who is the complaint about?", "الاسم أو الآيدي أو المنشن", "name, ID or mention", "s", True),
        ("what", "تفاصيل الشكوى", "Complaint details", "وش صار بالضبط؟", "What exactly happened?", "p", True),
        ("when", "وقت وتاريخ الحادثة", "When did it happen?", "مثال: أمس العصر", "e.g. yesterday afternoon", "s", False),
        ("proof", "الأدلة (روابط صور أو فيديو)", "Evidence (image / video links)", "https://…", "https://…", "p", False)]},
    "report": {"ar": "بلاغ على لاعب", "en": "Player report", "emoji": "alert", "q": [
        ("char", "اسم الشخصية أو الآيدي", "Character name or ID", "الاسم داخل الرول", "in-roleplay name", "s", True),
        ("rule", "نوع المخالفة", "Rule broken", "FRP / RDM / VDM / تجاوز…", "FRP / RDM / VDM / abuse…", "s", True),
        ("story", "اشرح ما حدث بالتفصيل", "Explain what happened", "رتّب الأحداث من البداية", "Describe the events in order", "p", True),
        ("time", "وقت الحادثة", "Time of the incident", "مثال: 9:30 مساءً", "e.g. 9:30 PM", "s", False),
        ("clip", "رابط الكليب / الدليل", "Clip / evidence link", "https://…", "https://…", "s", False)]},
    "purchase": {"ar": "شراء / متجر", "en": "Purchase / store", "emoji": "money", "q": [
        ("item", "وش تبي تشتري؟", "What would you like to buy?", "اسم المنتج أو الباقة", "product or package name", "s", True),
        ("pay", "طريقة الدفع المفضلة", "Preferred payment method", "تحويل / بطاقة…", "bank transfer / card…", "s", True),
        ("ign", "اسمك داخل اللعبة", "Your in-game name", "الاسم الذي سنفعّل عليه الطلب", "the name we'll apply it to", "s", True),
        ("note", "ملاحظات إضافية", "Anything else?", "اختياري", "optional", "p", False)]},
    "partner": {"ar": "شراكة", "en": "Partnership", "emoji": "link", "q": [
        ("name", "اسم سيرفرك", "Your server name", "", "", "s", True),
        ("invite", "رابط السيرفر", "Server invite link", "https://discord.gg/…", "https://discord.gg/…", "s", True),
        ("members", "عدد الأعضاء", "Member count", "مثال: 1500", "e.g. 1500", "s", True),
        ("offer", "وش تقدم في الشراكة؟", "What do you offer?", "إعلانات، فعاليات، دعم…", "ads, events, support…", "p", True)]},
    "appeal": {"ar": "تظلم / فك باند", "en": "Ban appeal", "emoji": "unban", "q": [
        ("id", "آيدي حسابك في ديسكورد", "Your Discord ID", "18 رقم تقريباً", "about 18 digits", "s", True),
        ("reason", "سبب الباند حسب علمك", "Why were you banned?", "", "", "s", True),
        ("why", "ليش نرفع عنك الباند؟", "Why should we lift the ban?", "كن صادقاً ومختصراً", "be honest and brief", "p", True),
        ("staff", "المشرف الذي طبّق العقوبة (إن عرفته)", "Staff who banned you (if known)", "", "", "s", False)]},
    "staff": {"ar": "تقديم إدارة", "en": "Staff application", "emoji": "admin", "q": [
        ("age", "عمرك", "Your age", "", "", "s", True),
        ("exp", "خبراتك السابقة في الإدارة", "Your previous staff experience", "سيرفرات أدرتها / مدة الخبرة", "servers you managed / how long", "p", True),
        ("why", "ليش تبي تنضم لفريقنا؟", "Why do you want to join us?", "", "", "p", True),
        ("time", "كم ساعة تتواجد يومياً؟", "Daily availability (hours)", "مثال: 3 ساعات", "e.g. 3 hours", "s", True)]},
    "bug": {"ar": "إبلاغ عن خلل", "en": "Bug report", "emoji": "bolt", "q": [
        ("bug", "وش الخلل؟", "What's the bug?", "وصف مختصر", "short description", "s", True),
        ("steps", "خطوات تكرار الخلل", "Steps to reproduce", "1) … 2) … 3) …", "1) … 2) … 3) …", "p", True),
        ("impact", "تأثير الخلل", "Impact", "يوقف اللعب؟ يخسّرك فلوس؟", "does it block play? lose money?", "s", False),
        ("shot", "رابط صورة أو فيديو", "Screenshot / video link", "https://…", "https://…", "s", False)]},
    "suggest": {"ar": "اقتراح", "en": "Suggestion", "emoji": "star", "q": [
        ("title", "عنوان الاقتراح", "Suggestion title", "", "", "s", True),
        ("desc", "وصف الاقتراح", "Describe your idea", "كيف تتخيله يشتغل؟", "How do you imagine it working?", "p", True),
        ("benefit", "وش الفائدة منه؟", "How will it help?", "", "", "p", False)]},
    "refund": {"ar": "تعويض / استرجاع", "en": "Refund / compensation", "emoji": "card", "q": [
        ("lost", "وش اللي ضاع أو انسرق؟", "What did you lose?", "مبلغ / عنصر / ممتلكات", "money / item / property", "s", True),
        ("how", "كيف ضاع؟", "How did it happen?", "اشرح بالتفصيل", "explain in detail", "p", True),
        ("proof", "دليل", "Proof", "روابط صور أو كليبات", "screenshot or clip links", "p", True)]},
    "creator": {"ar": "صناع المحتوى", "en": "Content creators", "emoji": "image", "q": [
        ("channel", "رابط قناتك", "Your channel link", "يوتيوب / تيك توك / تويتش", "YouTube / TikTok / Twitch", "s", True),
        ("followers", "عدد المتابعين", "Followers", "", "", "s", True),
        ("content", "نوع المحتوى", "Content type", "رول بلاي، ألعاب، ترفيه…", "roleplay, gaming, fun…", "s", True),
        ("plan", "كيف ستروّج لنا؟", "How will you promote us?", "", "", "p", False)]},
}


def questions_for(cfg: dict, lang: str) -> list[dict]:
    """الأسئلة الفعلية لتذكرة: الأسئلة المخصصة (من لوحة التحكم) تتقدم على القالب."""
    custom = [q.strip() for q in (cfg.get("questions") or []) if isinstance(q, str) and q.strip()][:5]
    if custom:
        return [dict(id=f"c{i}", label=q[:45], ph="", style="p" if len(q) > 30 else "s", required=(i == 0)) for i, q in enumerate(custom)]
    p = PRESETS.get(cfg.get("preset") or "")
    if not p:
        return []
    i = 0 if lang == "ar" else 1
    return [dict(id=k, label=(q[1:3][i])[:45], ph=(q[3:5][i])[:100], style=q[5], required=q[6]) for q in p["q"] for k in [q[0]]]
