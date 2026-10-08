"""الإعدادات | Settings — من متغيرات البيئة أو ملف .env (لا أسرار في الكود)."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("DATA_DIR") or BASE_DIR / "data")
ASSETS_DIR = BASE_DIR / "assets"


def load_env(path: Path = BASE_DIR / ".env") -> None:
    """قارئ .env بسيط؛ لا يستبدل المتغيرات الموجودة."""
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip("\"'"))
    except OSError:
        pass


load_env()


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default)


def env_int(name: str, default: int = 0) -> int:
    try:
        return int(os.environ.get(name, "") or default)
    except ValueError:
        return default


TOKEN = env("DISCORD_TOKEN")
DEFAULT_LANG = env("DEFAULT_LANG", "ar") if env("DEFAULT_LANG", "ar") in ("ar", "en") else "ar"
OWNER_IDS = {int(x) for x in env("OWNER_IDS").replace(" ", "").split(",") if x.isdigit()}
# سيرفر المالك: يستقبل إشعارات دخول البوت لسيرفرات جديدة + الإحصائيات (اختياري)
OWNER_GUILD_ID = env_int("OWNER_GUILD_ID")
OWNER_LOG_CHANNEL_ID = env_int("OWNER_LOG_CHANNEL_ID")
OWNER_STATS_CHANNEL_ID = env_int("OWNER_STATS_CHANNEL_ID")
ENABLE_DASHBOARD = env("ENABLE_DASHBOARD", "1").lower() not in ("0", "false", "no", "off")
