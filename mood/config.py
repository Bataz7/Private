"""الإعدادات: تنقرأ من ملف .env (أو من متغيرات البيئة)."""
import os
from datetime import time, timedelta, timezone
from pathlib import Path

BASE = Path(__file__).resolve().parent


def _load_env():
    env = BASE / ".env"
    if not env.exists():
        return
    for line in env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_env()


def _ids(name):
    return [int(x) for x in os.getenv(name, "").replace(" ", "").split(",") if x]


def _time(name, default):
    h, m = os.getenv(name, default).split(":")
    return int(h), int(m)


def _tz():
    name = os.getenv("TIMEZONE", "Asia/Riyadh")
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(name)
    except Exception:  # ويندوز بدون tzdata
        print(f"⚠️  ما لقيت المنطقة الزمنية {name}، بستخدم UTC+3")
        return timezone(timedelta(hours=3))


TOKEN = os.getenv("DISCORD_TOKEN", "")
TARGET_IDS = _ids("TARGET_USER_ID")          # الشخص (أو الأشخاص) اللي يوصلهم السؤال
OWNER_IDS = _ids("OWNER_ID")                 # أنت: تشوف التقارير وتتحكم بالبوت
TZ = _tz()
CHECKIN_TIME = time(*_time("CHECKIN_TIME", "14:30"), tzinfo=TZ)
WEEKLY_REPORT_DAY = int(os.getenv("WEEKLY_REPORT_DAY", "4"))   # 0=الاثنين ... 4=الجمعة 6=الأحد
WEEKLY_REPORT_TIME = time(*_time("WEEKLY_REPORT_TIME", "21:00"), tzinfo=TZ)
REMINDER_AFTER_HOURS = float(os.getenv("REMINDER_AFTER_HOURS", "3"))  # 0 = بدون تذكير
NOTIFY_OWNER = os.getenv("NOTIFY_OWNER", "false").lower() == "true"

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
AI_MODEL = os.getenv("AI_MODEL", "claude-opus-5-5")

DB_PATH = BASE / os.getenv("DB_FILE", "mood.db")
REPORTS_DIR = BASE / "reports"
EMOJI_DIR = BASE / "assets" / "emojis"

ALLOWED = set(TARGET_IDS) | set(OWNER_IDS)
