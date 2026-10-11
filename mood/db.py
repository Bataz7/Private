"""تخزين بسيط بـ SQLite (ملف واحد mood.db)."""
import sqlite3
from datetime import date, datetime, timedelta

from config import DB_PATH, TZ

_con = sqlite3.connect(DB_PATH)
_con.row_factory = sqlite3.Row
_con.executescript("""
CREATE TABLE IF NOT EXISTS entries (
    user_id    INTEGER NOT NULL,
    day        TEXT    NOT NULL,
    mood       INTEGER NOT NULL,
    highlight  TEXT    DEFAULT '',
    problems   TEXT    DEFAULT '',
    ai_reply   TEXT    DEFAULT '',
    created_at TEXT    NOT NULL,
    PRIMARY KEY (user_id, day)
);
CREATE TABLE IF NOT EXISTS prompts (
    user_id INTEGER NOT NULL,
    day     TEXT    NOT NULL,
    reminded INTEGER DEFAULT 0,
    PRIMARY KEY (user_id, day)
);
""")


def today() -> str:
    return datetime.now(TZ).date().isoformat()


def save_entry(user_id, mood, highlight="", problems="", day=None):
    """يحفظ تسجيل اليوم (لو سجّل مرتين بنفس اليوم ناخذ الأخير)."""
    _con.execute(
        "INSERT OR REPLACE INTO entries (user_id, day, mood, highlight, problems, created_at)"
        " VALUES (?,?,?,?,?,?)",
        (user_id, day or today(), mood, highlight.strip(), problems.strip(), datetime.now(TZ).isoformat()),
    )
    _con.commit()


def set_ai_reply(user_id, day, text):
    _con.execute("UPDATE entries SET ai_reply=? WHERE user_id=? AND day=?", (text, user_id, day))
    _con.commit()


def get_entry(user_id, day=None):
    return _con.execute("SELECT * FROM entries WHERE user_id=? AND day=?", (user_id, day or today())).fetchone()


def entries(user_id, days):
    """تسجيلات آخر N يوم مرتبة من الأقدم للأحدث."""
    since = (datetime.now(TZ).date() - timedelta(days=days - 1)).isoformat()
    return [dict(r) for r in _con.execute(
        "SELECT * FROM entries WHERE user_id=? AND day>=? ORDER BY day", (user_id, since))]


def entries_between(user_id, start: date, end: date):
    return [dict(r) for r in _con.execute(
        "SELECT * FROM entries WHERE user_id=? AND day>=? AND day<=? ORDER BY day",
        (user_id, start.isoformat(), end.isoformat()))]


def streak(user_id) -> int:
    """كم يوم ورا بعض سجّل فيها (لين اليوم أو أمس)."""
    days = {r[0] for r in _con.execute("SELECT day FROM entries WHERE user_id=?", (user_id,))}
    d = datetime.now(TZ).date()
    if d.isoformat() not in days:
        d -= timedelta(days=1)
    n = 0
    while d.isoformat() in days:
        n += 1
        d -= timedelta(days=1)
    return n


def mark_prompted(user_id, day=None):
    _con.execute("INSERT OR IGNORE INTO prompts (user_id, day) VALUES (?,?)", (user_id, day or today()))
    _con.commit()


def needs_reminder(user_id) -> bool:
    """انسأل اليوم وما رد وما تذكّر للحين؟"""
    row = _con.execute("SELECT reminded FROM prompts WHERE user_id=? AND day=?", (user_id, today())).fetchone()
    return bool(row) and not row["reminded"] and get_entry(user_id) is None


def mark_reminded(user_id):
    _con.execute("UPDATE prompts SET reminded=1 WHERE user_id=? AND day=?", (user_id, today()))
    _con.commit()
