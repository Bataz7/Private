"""لغة البوت | Per-server language + automatic English translation of Arabic bot text.

- كل سيرفر له لغة (ar/en) تُحفظ في language.db ويغيّرها /language أو لوحة التحكم.
- النصوص الجديدة تُكتب مباشرة بالنسختين في core/strings.py وتُستدعى بـ tr().
- الكوجات القديمة (عربي فقط) تُترجم تلقائياً عند الإرسال عبر جدول locales/en.json (انظر core/hooks.py).
"""
import contextvars
import json
import re
import sqlite3
from functools import lru_cache
from pathlib import Path

from . import config

LANGS = ("ar", "en")
_ctx: contextvars.ContextVar = contextvars.ContextVar("revive_lang", default=None)
_cache: dict[int, str] = {}
_db: sqlite3.Connection | None = None
AR = re.compile(r"[؀-ۿ]")


# ---------------------------------------------------------------- تخزين اللغة
def _con() -> sqlite3.Connection:
    global _db
    if _db is None:
        _db = sqlite3.connect("language.db", check_same_thread=False)
        _db.execute("CREATE TABLE IF NOT EXISTS guild_lang (guild_id INTEGER PRIMARY KEY, lang TEXT NOT NULL)")
        _db.commit()
        for gid, lang in _db.execute("SELECT guild_id, lang FROM guild_lang"):
            _cache[gid] = lang
    return _db


def guild_lang(guild_id: int | None) -> str:
    if not guild_id:
        return config.DEFAULT_LANG
    _con()
    return _cache.get(int(guild_id), config.DEFAULT_LANG)


def set_guild_lang(guild_id: int, lang: str) -> None:
    if lang not in LANGS:
        raise ValueError(lang)
    c = _con()
    c.execute("INSERT INTO guild_lang(guild_id, lang) VALUES(?,?) ON CONFLICT(guild_id) DO UPDATE SET lang=excluded.lang", (guild_id, lang))
    c.commit()
    _cache[int(guild_id)] = lang


def lang_of(x) -> str:
    """يقبل: 'ar'/'en' · رقم سيرفر · Guild · Interaction · Member · None."""
    if isinstance(x, str) and x in LANGS:
        return x
    if x is None:
        return _ctx.get() or config.DEFAULT_LANG
    if isinstance(x, int):
        return guild_lang(x)
    gid = getattr(x, "guild_id", None) or getattr(getattr(x, "guild", None), "id", None) or (getattr(x, "id", None) if hasattr(x, "member_count") else None)
    return guild_lang(gid) if gid else (_ctx.get() or config.DEFAULT_LANG)


def set_context_lang(lang: str | None):
    return _ctx.set(lang)


def current_lang() -> str | None:
    return _ctx.get()


# ---------------------------------------------------------------- نصوص جديدة (ثنائية اللغة)
def tr(x, key: str, **vars) -> str:
    from .strings import S
    ar_en = S.get(key)
    if ar_en is None:
        return key
    text = ar_en[0] if lang_of(x) == "ar" else ar_en[1]
    return text.format_map(_Safe(vars)) if vars else text


class _Safe(dict):
    def __missing__(self, k):
        return "{" + k + "}"


def both(key: str) -> tuple[str, str]:
    from .strings import S
    return S[key]


# ---------------------------------------------------------------- ترجمة تلقائية للنصوص العربية القديمة
_PH = re.compile(r"\{(\d+|[A-Za-z_][\w.]*)(?::[^{}]*)?\}|%[sd]")
_exact: dict[str, str] = {}
_templates: list[tuple[re.Pattern, str, list]] = []
_loaded = False


def register(ar: str, en: str) -> None:
    """يضيف ترجمة يدوية (تُستخدم لنصوص الأوامر الجديدة)."""
    _exact[ar] = en
    translate.cache_clear()


def _compile(ar: str, en: str):
    toks, pos, parts = [], 0, []
    for m in _PH.finditer(ar):
        parts.append(re.escape(ar[pos:m.start()]))
        parts.append("(.*?)")
        toks.append(m.group(0))
        pos = m.end()
    parts.append(re.escape(ar[pos:]))
    rx = re.compile("^" + "".join(parts) + "$", re.S)
    # English: كل placeholder يُربط بمجموعة من العربي (بالاسم، أو بالترتيب لـ %s)
    used = {}
    def sub(m):
        tok = m.group(0)
        if tok.startswith("%"):
            i = used.get("%", 0); used["%"] = i + 1
            idx = [j for j, t in enumerate(toks) if t.startswith("%")]
            g = idx[i] if i < len(idx) else 0
        else:
            g = toks.index(tok) if tok in toks else 0
        return "\0%d\0" % g
    return rx, _PH.sub(sub, en), toks


def _load() -> None:
    global _loaded
    if _loaded:
        return
    _loaded = True
    data = {"exact": {}, "templates": []}
    for name in ("manual.json", "en.json"):  # manual.json له الأولوية
        try:
            d = json.loads((config.BASE_DIR / "locales" / name).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        data["exact"] = {**d.get("exact", {}), **data["exact"]}
        data["templates"] += d.get("templates", [])
    for ar, en in data["exact"].items():
        _exact.setdefault(ar, en)
    for t in data["templates"]:
        try:
            rx, en, toks = _compile(t["ar"], t["en"])
            _templates.append((rx, en, toks))
        except re.error:
            continue
    _templates.sort(key=lambda x: -len(x[0].pattern))


def _fmt(en: str, m: re.Match) -> str:
    return re.sub(r"\0(\d+)\0", lambda g: m.group(int(g.group(1)) + 1) if int(g.group(1)) < m.re.groups else "", en)


def _line(s: str) -> str | None:
    t = s.strip()
    if not t or not AR.search(t):
        return None
    if t in _exact:
        return s.replace(t, _exact[t])
    for rx, en, _ in _templates:
        m = rx.match(t)
        if m:
            return s.replace(t, _fmt(en, m))
    return None


@lru_cache(maxsize=2048)
def translate(text: str) -> str:
    """عربي → English. يرجع النص كما هو لو ما وُجدت ترجمة."""
    if not text or not AR.search(text):
        return text
    _load()
    whole = _line(text)
    if whole is not None:
        return whole
    if "\n" in text:
        return "\n".join((_line(l) or l) for l in text.split("\n"))
    return text
