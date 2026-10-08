"""ريفايف — نقطة التشغيل | Revive entry point.

    python main.py          (التوكن وباقي الأسرار من .env — انظر .env.example)
"""
import asyncio
import gc
import logging
import os
import sys

from core import config, migrate

moved = migrate.run()
os.chdir(config.DATA_DIR)  # كل ملفات البيانات النسبية (db/json) تُقرأ وتُكتب داخل data/
sys.path.insert(0, str(config.BASE_DIR))

import discord  # noqa: E402
from discord.ext import commands  # noqa: E402

from core import hooks, i18n, store  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("revive")

store.install_fast_sqlite()
try:  # أسرع حلقة أحداث وأقل استهلاكاً للمعالج (اختياري)
    import uvloop  # type: ignore
    asyncio.set_event_loop_policy(uvloop.EventLoopPolicy())
except Exception:
    pass

# الأنظمة الجديدة أولاً ثم الكوجات الأصلية
EXTENSIONS = [
    "cogs.language", "cogs.logs", "cogs.welcome", "cogs.tickets", "cogs.owner",
    "cogs.apply", "cogs.setup_apply", "cogs.id", "cogs.role", "cogs.auto_role", "cogs.reply", "cogs.shorts", "cogs.shortscuts",
    "cogs.embed", "cogs.security", "cogs.badwords", "cogs.azkar", "cogs.levels",
    "cogs.bank", "cogs.traffic", "cogs.vehicle", "cogs.real_estate", "cogs.point_police",
]


class ReviveBot(commands.Bot):
    def __init__(self):
        intents = discord.Intents.default()
        intents.message_content = True  # الردود والاختصارات والكلمات المحظورة
        intents.members = True          # الترحيب واللوقات والرتب
        intents.presences = False       # أكبر مستهلك للذاكرة وما نحتاجه
        intents.typing = False
        super().__init__(
            command_prefix="!", intents=intents, help_command=None,
            max_messages=1500,                      # كاش رسائل صغير يكفي لوق الحذف/التعديل
            chunk_guilds_at_startup=True,
            member_cache_flags=discord.MemberCacheFlags.from_intents(intents),
        )
        self._synced = False

    async def setup_hook(self):
        hooks.install(self)
        await self.tree.set_translator(hooks.ReviveTranslator())
        if config.ENABLE_DASHBOARD:
            try:
                from web_dashboard import start_web
                self.web_task = asyncio.create_task(start_web(self))
            except Exception:
                log.exception("dashboard failed to start")
        for ext in EXTENSIONS:
            try:
                await self.load_extension(ext)
            except Exception:
                log.exception("failed to load %s", ext)
        log.info("loaded %d/%d extensions", len(self.extensions), len(EXTENSIONS))

    async def on_ready(self):
        log.info("logged in as %s (%d guilds)", self.user, len(self.guilds))
        if not self._synced:  # المزامنة مرة واحدة فقط (مو كل إعادة اتصال)
            self._synced = True
            try:
                synced = await self.tree.sync()
                log.info("synced %d slash commands", len(synced))
                if config.OWNER_GUILD_ID:
                    await self.tree.sync(guild=discord.Object(id=config.OWNER_GUILD_ID))
            except Exception:
                log.exception("slash sync failed")
            gc.collect()
            gc.freeze()  # يخفف عمل الـ GC على الكائنات الثابتة


def main():
    if not config.TOKEN:
        sys.exit("DISCORD_TOKEN غير مضبوط — ضعه في ملف .env / DISCORD_TOKEN is not set (see .env.example)")
    if moved:
        log.info("moved data files into %s: %s", config.DATA_DIR, ", ".join(moved))
    ReviveBot().run(config.TOKEN, log_handler=None)


if __name__ == "__main__":
    main()
