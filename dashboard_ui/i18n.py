"""واجهة الترجمة | Translation helpers. البيانات في i18n_data.py، والإضافات هنا."""
import json
from .i18n_data import TEXT

def _merge(dst: dict, src: dict):
    for k, v in src.items():
        if isinstance(v, dict) and isinstance(dst.get(k), dict):
            _merge(dst[k], v)
        else:
            dst[k] = v

_EXTRA = {
    "ar": {
        "ui": {"emojis": "الإيموجيات"},
        "grp": {"msg": "الرسالة", "look": "التصميم", "opts": "الخيارات", "general": "الإعدادات العامة", "roles": "الرتب", "channels": "الرومات",
                "messages": "الرسائل", "questions": "الأسئلة", "panels": "البانلات", "ops": "العمليات", "target": "الوجهة", "content": "المحتوى"},
        "tpv": {"title": "معاينة التذكرة", "hint": "هكذا ستظهر رسالة الترحيب داخل التذكرة", "user": "تذكرة @عضو", "close": "إغلاق", "claim": "استلام", "empty": "اكتب رسالة الترحيب لتظهر هنا"},
        "wpv": {"title": "معاينة الرسالة", "hint": "المتغيرات تُستبدل تلقائياً عند الإرسال"},
        "emo": {"title": "إيموجيات ريفايف", "sub": "حزمة إيموجيات خاصة بالبوت: لوقات، تذاكر، حماية، بنك والمزيد. اضغط على أي إيموجي لنسخ كوده.",
                "search": "ابحث بالاسم…", "all": "الكل", "copy": "نسخ الكود", "copied": "تم نسخ الكود", "count": "{n} إيموجي",
                "noIds": "الإيموجيات لسه ما انرفعت للتطبيق. شغّل tools/upload_emojis.py مرة واحدة وسيظهر كود الاستخدام الكامل هنا.",
                "cats": {"logs": "اللوقات", "tickets": "التذاكر", "status": "الحالات", "protection": "الحماية", "economy": "الاقتصاد", "roleplay": "الرول بلاي", "misc": "عام"}},
        "team": {"page": "فريق ريفايف"},
    },
    "en": {
        "ui": {"emojis": "Emojis"},
        "grp": {"msg": "Message", "look": "Design", "opts": "Options", "general": "General", "roles": "Roles", "channels": "Channels",
                "messages": "Messages", "questions": "Questions", "panels": "Panels", "ops": "Operations", "target": "Destination", "content": "Content"},
        "tpv": {"title": "Ticket preview", "hint": "This is how the welcome message looks inside a ticket", "user": "Ticket @member", "close": "Close", "claim": "Claim", "empty": "Write the welcome message to see it here"},
        "wpv": {"title": "Message preview", "hint": "Variables are replaced automatically when sent"},
        "emo": {"title": "Revive Emojis", "sub": "A custom emoji pack for the bot: logs, tickets, protection, economy and more. Click any emoji to copy its code.",
                "search": "Search by name…", "all": "All", "copy": "Copy code", "copied": "Code copied", "count": "{n} emojis",
                "noIds": "The emojis aren't uploaded to the application yet. Run tools/upload_emojis.py once and the full usage code will show here.",
                "cats": {"logs": "Logs", "tickets": "Tickets", "status": "Status", "protection": "Protection", "economy": "Economy", "roleplay": "Roleplay", "misc": "General"}},
        "team": {"page": "Revive Team"},
    },
}
_merge(TEXT["ar"], _EXTRA["ar"])
_merge(TEXT["en"], _EXTRA["en"])


def lookup(lang: str, path: str):
    o = TEXT.get(lang)
    for k in path.split("."):
        if not isinstance(o, dict) or k not in o:
            return None
        o = o[k]
    return o


def t(lang: str, path: str, **vars):
    v = lookup(lang, path)
    if v is None and lang != "ar":
        v = lookup("ar", path)
    if v is None:
        return path
    if isinstance(v, str) and vars:
        for k, val in vars.items():
            v = v.replace("{" + k + "}", str(val))
    return v


def has(lang: str, path: str) -> bool:
    return lookup(lang, path) is not None


def js_bundle() -> str:
    """نفس النصوص للمتصفح (للتنبيهات والرسائل الديناميكية)."""
    return "window.I18N=" + json.dumps(TEXT, ensure_ascii=False, separators=(",", ":")) + ";"


def pick_lang(cookie: str | None, accept: str | None) -> str:
    if cookie in ("ar", "en"):
        return cookie
    if accept:
        first = accept.split(",")[0].strip().lower()
        return "ar" if first.startswith("ar") else "en"
    return "ar"
