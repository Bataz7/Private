"""ينقل ملفات البيانات القديمة (قواعد sqlite و json) من مجلد البوت إلى data/ مرة واحدة."""
import shutil
from pathlib import Path

from . import config

KNOWN = {
    "activation_requests.json", "activation_settings.json", "apply_data.json", "apply_panels.json", "apply_reviews.json", "auto_responses.json",
    "autorole.db", "azkar_settings.db", "badwords_settings.db", "bank.db", "bank_traffic.db", "blacklisted_guilds.db", "bot_logger.db",
    "dashboard.db", "id_data.json", "levels_settings.db", "logs_settings.db", "police_points.db", "real_estate.db", "roleplay_data.json",
    "security_settings.db", "shortcuts.db", "tickets.db", "tickets_data.json", "weapons.db", "welcome_goodbye.db", "language.db",
}


def run() -> list[str]:
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    moved = []
    for name in KNOWN:
        src, dst = config.BASE_DIR / name, config.DATA_DIR / name
        if src.exists() and not dst.exists():
            shutil.move(str(src), str(dst))
            moved.append(name)
    return moved
