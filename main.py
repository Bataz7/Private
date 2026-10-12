"""ريفايف — نقطة التشغيل | Revive entry point.

    python main.py          (التوكن وباقي الأسرار من .env — انظر .env.example)
"""
import asyncio
import gc
import logging
import os
import platform
import sqlite3
import sys

from core import config, console, migrate

VERSION = "v2.1"
console.setup_logging()
console.banner(VERSION)
moved = migrate.run()
os.chdir(config.DATA_DIR)  # كل ملفات البيانات النسبية (db/json) تُقرأ وتُكتب داخل data/
sys.path.insert(0, str(config.BASE_DIR))

import discord  # noqa: E402
from discord.ext import commands  # noqa: E402

import emojis  # noqa: E402
from core import hooks, store  # noqa: E402

log = logging.getLogger("revive")
store.install_fast_sqlite()
try:  # أسرع حلقة أحداث وأقل استهلاكاً للمعالج (اختياري)
    import uvloop  # type: ignore
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        asyncio.set_event_loop_policy(uvloop.EventLoopPolicy())
    FAST_LOOP = "uvloop"
except Exception:
    FAST_LOOP = "asyncio"

# الأنظمة الجديدة أولاً ثم الكوجات الأصلية
EXTENSIONS = ([] if config.ARABIC_ONLY else ["cogs.language"]) + [
    "cogs.logs", "cogs.welcome", "cogs.tickets", "cogs.owner",
    "cogs.apply", "cogs.setup_apply", "cogs.id", "cogs.role", "cogs.auto_role", "cogs.reply", "cogs.shorts", "cogs.shortscuts",
    "cogs.embed", "cogs.security", "cogs.badwords", "cogs.azkar", "cogs.levels",
    "cogs.bank", "cogs.traffic", "cogs.vehicle", "cogs.real_estate", "cogs.point_police",
]


def check_databases() -> tuple[int, int, int]:
    """يفتح كل قاعدة بيانات في data/ ويتأكد أنها سليمة. يرجع (متصلة، فاشلة، حجم KB)."""
    good = bad = size = 0
    for f in sorted(config.DATA_DIR.glob("*.db")):
        try:
            con = sqlite3.connect(str(f))
            tables = con.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table'").fetchone()[0]
            ok = con.execute("PRAGMA quick_check").fetchone()[0] == "ok"
            con.close()
            kb = f.stat().st_size // 1024
            size += kb
            if ok:
                good += 1
                console.ok(f.name, f"{tables} tables · {kb} KB")
            else:
                bad += 1
                console.fail(f.name, "integrity check failed")
        except sqlite3.Error as e:
            bad += 1
            console.fail(f.name, str(e)[:40])
    return good, bad, size


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
        self.sync_count = 0
        self.dash = "off"
        self.emoji_state = ("…", "")

    async def setup_hook(self):
        if not config.ARABIC_ONLY:  # طبقة الترجمة للإنجليزي تشتغل بس لو ARABIC_ONLY=0
            hooks.install(self)
            await self.tree.set_translator(hooks.ReviveTranslator())

        console.section("Storage")
        good, bad, kb = check_databases()
        if not good and not bad:
            console.info("Databases", "none yet — they will be created on first use")
        else:
            (console.ok if not bad else console.warn)("Databases", f"{good} connected" + (f" · {bad} failed" if bad else "") + f" · {kb} KB total")
        console.info("Data folder", str(config.DATA_DIR))
        if moved:
            console.ok("Migrated", f"{len(moved)} file(s) moved into data/")

        console.section("Systems")
        for ext in EXTENSIONS:
            try:
                await self.load_extension(ext)
                cog_cmds = sum(len(c.get_app_commands()) for c in self.cogs.values() if c.__module__ == ext)
                console.ok(ext.split(".")[-1], f"{cog_cmds} slash commands" if cog_cmds else "loaded")
            except Exception as e:
                console.fail(ext.split(".")[-1], f"{type(e).__name__}: {str(e)[:60]}")
                log.debug("load failure", exc_info=True)
        console.info("Total", f"{len(self.extensions)}/{len(EXTENSIONS)} loaded · {len(self.tree.get_commands())} top-level commands")

        if config.ENABLE_DASHBOARD:
            try:
                from web_dashboard import start_web
                self.web_task = asyncio.create_task(start_web(self))
                self.dash = (config.env("DASHBOARD_URL") or f"port {config.env('DASHBOARD_PORT', '8080')}")
            except Exception:
                console.fail("Dashboard", "failed to start")
                log.exception("dashboard")
        if config.env("AUTO_EMOJIS", "1").lower() not in ("0", "false", "off"):
            self.emoji_task = asyncio.create_task(self._sync_emojis())

    async def _sync_emojis(self):
        """يسجّل إيموجيات البوت الخاصة تلقائياً (يرفع الناقص فقط)."""
        try:
            manifest_total = len(emojis.json.loads((emojis.DIR / "manifest.json").read_text(encoding="utf-8")))
        except (OSError, ValueError):
            self.emoji_state = ("skip", "no emoji pack found")
            return
        have = sum(1 for k in emojis.E.ids if k.startswith("rv_"))
        if have >= manifest_total:
            self.emoji_state = ("ok", f"{have}/{manifest_total} ready")
            return
        console.section("Emojis")
        console.info("Registering", f"{manifest_total - have} new emoji(s) as application emojis…")
        last = [0]

        def progress(n, total, name):
            if _tty() and n != last[0]:
                print(f"\r  {console.bar(n, total)} {console.c(name, console.GRAY)}        ", end="", flush=True)
            last[0] = n

        try:
            await emojis.sync(self, on_progress=progress)
            if _tty():
                print()
            st = emojis.sync.last
            self.emoji_state = ("ok", f"{st['ready']}/{st['total']} ready (+{st['uploaded']} uploaded)")
            console.ok("Emojis", self.emoji_state[1])
        except Exception as e:
            self.emoji_state = ("warn", str(e)[:60])
            console.warn("Emojis", f"sync failed: {str(e)[:70]}")

    async def on_ready(self):
        if not self._synced:  # المزامنة مرة واحدة فقط (مو كل إعادة اتصال)
            self._synced = True
            try:
                self.sync_count = len(await self.tree.sync())
                if config.OWNER_GUILD_ID:
                    await self.tree.sync(guild=discord.Object(id=config.OWNER_GUILD_ID))
            except Exception:
                log.exception("slash sync failed")
            gc.collect()
            gc.freeze()  # يخفف عمل الـ GC على الكائنات الثابتة
            members = sum(g.member_count or 0 for g in self.guilds)
            state, detail = self.emoji_state
            console.section("Connected")
            console.panel([
                ("Bot", f"{self.user} ({self.user.id})"),
                ("Servers / Members", f"{len(self.guilds):,} / {members:,}"),
                ("Latency", f"{round(self.latency * 1000)} ms"),
                ("Slash commands", f"{self.sync_count} synced"),
                ("Databases", f"connected · {len(list(config.DATA_DIR.glob('*.db')))} files"),
                ("Emojis", detail or state),
                ("Dashboard", self.dash),
                ("Language", "Arabic only" if config.ARABIC_ONLY else ("Arabic" if config.DEFAULT_LANG == "ar" else "English")),
                ("Memory", f"{console.memory_mb():.0f} MB"),
                ("Runtime", f"Python {platform.python_version()} · discord.py {discord.__version__} · {FAST_LOOP}"),
                ("Started in", console.uptime()),
            ], title="REVIVE IS ONLINE")
        else:
            log.info("reconnected (%d servers)", len(self.guilds))


def _tty() -> bool:
    return sys.stdout.isatty()


def _token_hints(t: str) -> list[str]:
    """تشخيص آمن للتوكن (لا يطبع التوكن نفسه)."""
    import base64
    hints = [f"token length {len(t)} · dots {t.count('.')} (a bot token is ~70 chars with 2 dots)"]
    if len(t) == 32 or len(t) == 64:
        hints.append("this looks like a Client Secret / Public Key — use Bot → Reset Token instead")
    try:
        p = t.split(".")[0]
        hints.append("token belongs to application id " + base64.b64decode(p + "=" * (-len(p) % 4)).decode()
                     + " — compare with General Information → Application ID")
    except Exception:
        hints.append("first part is not a valid id — the token was copied incorrectly")
    if os.environ.get("DISCORD_TOKEN") and (config.BASE_DIR / ".env").exists():
        hints.append("if you changed .env but nothing changes, run: unset DISCORD_TOKEN")
    return hints


def main():
    console.section("Startup")
    bad = config.token_problem(config.TOKEN)
    if bad:
        console.fail("DISCORD_TOKEN", bad)
        console.info("Fix", "put it in .env as  DISCORD_TOKEN=<token>  (no spaces/quotes) or in the host's Variables tab")
        sys.exit(1)
    console.ok("Configuration", ".env loaded" if (config.BASE_DIR / ".env").exists() else "environment variables")
    console.info("Connecting to Discord", "logging in…")
    try:
        ReviveBot().run(config.TOKEN, log_handler=None)
    except discord.LoginFailure:
        console.fail("Login failed", "the token is invalid — reset it in the Developer Portal")
        for line in _token_hints(config.TOKEN):
            console.warn("Hint", line)
        sys.exit(1)


if __name__ == "__main__":
    main()
