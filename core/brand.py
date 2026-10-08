"""هوية الإيمبدات | Embed branding — ألوان وأشكال موحّدة لكل رسائل البوت."""
from datetime import datetime, timezone

import discord

COLORS = {
    "brand": 0x2F6BFF, "success": 0x1FC46A, "error": 0xF23D4F, "warn": 0xFFA51F, "info": 0x22B8F0,
    "join": 0x1FC46A, "leave": 0xFF7A1F, "ban": 0xF23D4F, "unban": 0x1FC46A, "kick": 0xFF7A1F,
    "timeout": 0xFFA51F, "role": 0x8B5CF6, "message": 0x2F6BFF, "edit": 0x22B8F0, "delete": 0xF23D4F,
    "channel": 0x14C8B0, "server": 0x7B8BAB, "voice": 0x22B8F0, "invite": 0x14C8B0, "ticket": 0x2F6BFF, "gold": 0xF6C445,
}
FOOTER = "Revive"


def color(kind: str) -> discord.Color:
    return discord.Color(COLORS.get(kind, COLORS["brand"]))


def embed(_lang_or_obj, kind: str = "brand", title: str | None = None, description: str | None = None, *, now: bool = True) -> discord.Embed:
    e = discord.Embed(title=title, description=description, color=color(kind))
    if now:
        e.timestamp = datetime.now(timezone.utc)
    return e


def clip(text, n: int = 1000) -> str:
    text = str(text or "")
    return text if len(text) <= n else text[: n - 1] + "…"
