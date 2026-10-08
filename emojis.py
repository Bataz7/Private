"""إيموجيات ريفايف الخاصة | Revive custom emojis — يستخدمها أي كوج في البوت.

    from emojis import E
    await ch.send(f"{E.log_ban} تم حظر العضو")          # <:rv_log_ban:123…>
    discord.ui.Button(label="إغلاق", emoji=E.pe("ticket_close"))

عند أول تشغيل ارفع الحزمة للتطبيق (مرة واحدة):
    await emojis.sync(bot)            # داخل setup_hook  — أو —   python tools/upload_emojis.py
قبل الرفع يرجع أقرب إيموجي عادي كبديل، فلا ينكسر شي.
"""
import asyncio
import base64
import json
from pathlib import Path

DIR = Path(__file__).resolve().parent / "emojis"
IDS_FILE = DIR / "ids.json"
API = "https://discord.com/api/v10"

# بدائل عادية قبل الرفع (الاسم بدون rv_)
_CAT = {"logs": "📜", "tickets": "🎫", "status": "ℹ️", "protection": "🛡️", "economy": "💰", "roleplay": "🎭", "misc": "✨"}
_FALLBACK = {
    "log_join": "📥", "log_leave": "📤", "log_ban": "🔨", "log_unban": "🔓", "log_kick": "👢", "log_timeout": "⏳", "log_untimeout": "⏱️",
    "log_role": "🏷️", "log_role_add": "➕", "log_role_remove": "➖", "log_msg_delete": "🗑️", "log_msg_edit": "✏️", "log_reaction": "⭐",
    "log_channel_create": "📁", "log_channel_delete": "🗑️", "log_channel_edit": "📝", "log_role_create": "🆕", "log_role_delete": "🗑️",
    "log_server": "⚙️", "log_voice": "🎙️", "log_invite": "🔗", "log_bot": "🤖",
    "ticket": "🎫", "ticket_open": "📬", "ticket_close": "🔒", "ticket_reopen": "🔓", "ticket_claim": "🙋", "ticket_transcript": "📄",
    "ticket_rating": "⭐", "ticket_user_add": "➕", "ticket_user_remove": "➖", "ticket_rename": "✏️", "ticket_delete": "🗑️",
    "ticket_priority": "🚩", "ticket_support": "🛟", "ticket_panel": "🗂️", "ticket_note": "📝", "ticket_notify": "🔔",
    "success": "✅", "error": "❌", "warning": "⚠️", "info": "ℹ️", "loading": "🔄", "pending": "⏳", "locked": "🔒", "on": "🟢", "off": "🔴",
    "shield": "🛡️", "shield_on": "🛡️", "shield_off": "🚫", "antibot": "🤖", "antilink": "🔗", "antiraid": "🔨", "badword": "🚫", "admin": "👑", "alert": "🚨",
    "bank": "🏦", "money": "💰", "card": "💳", "loan": "📋", "transfer": "↔️", "levels": "📈", "xp": "✨", "trophy": "🏆",
    "identity": "🪪", "weapon": "🔫", "traffic": "🚦", "realestate": "🏠", "key": "🔑", "apply": "📝", "activation": "✅", "rpstatus": "🎭", "location": "📍",
    "logo": "🌴", "crown": "👑", "star": "⭐", "bolt": "⚡", "welcome": "👋", "azkar": "🌙", "settings": "⚙️", "heart": "❤️", "chart": "📊",
    "globe": "🌐", "bot": "🤖", "users": "👥", "message": "💬", "shortcut": "⚡", "palette": "🎨",
    "calendar": "📅", "folder": "📁", "user": "👤", "link": "🔗", "eye": "👁️", "image": "🖼️", "copy": "📋", "search": "🔍", "list": "📋",
    "ticket_unclaim": "🔓", "ticket_lock": "🔒", "ticket_user": "👤", "ticket_time": "🕒", "ticket_questions": "❓",
}


def _load_ids() -> dict:
    try:
        return json.loads(IDS_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


class _Emojis:
    """E.log_ban → '<:rv_log_ban:ID>' (أو بديل عادي إن ما انرفع بعد)."""

    def __init__(self):
        self.ids = _load_ids()

    def reload(self):
        self.ids = _load_ids()

    def __getattr__(self, short: str) -> str:
        if short.startswith("_"):
            raise AttributeError(short)
        return self.get(short)

    def get(self, short: str) -> str:
        name = short if short.startswith("rv_") else f"rv_{short}"
        eid = self.ids.get(name)
        if eid:
            return f"<:{name}:{eid}>"
        return _FALLBACK.get(name[3:], "▫️")

    def pe(self, short: str):
        """discord.PartialEmoji للأزرار والقوائم."""
        import discord
        name = short if short.startswith("rv_") else f"rv_{short}"
        eid = self.ids.get(name)
        return discord.PartialEmoji(name=name, id=int(eid)) if eid else discord.PartialEmoji(name=_FALLBACK.get(name[3:], "▫️"))

    def all(self) -> dict:
        return {n: self.get(n) for n in (e["name"] for e in json.loads((DIR / "manifest.json").read_text(encoding="utf-8")))}


E = _Emojis()


async def sync(bot_or_token, session=None, on_progress=None) -> dict:
    """يرفع الإيموجيات الناقصة كإيموجيات للتطبيق (Application Emojis) ويحفظ emojis/ids.json.
    يقبل كائن البوت أو التوكن. آمن للتشغيل كل مرة: ما يرفع إلا الناقص."""
    import aiohttp
    token = bot_or_token if isinstance(bot_or_token, str) else bot_or_token.http.token
    manifest = json.loads((DIR / "manifest.json").read_text(encoding="utf-8"))
    headers = {"Authorization": f"Bot {token}", "Content-Type": "application/json"}
    own = session is None
    session = session or aiohttp.ClientSession()
    ids = _load_ids()
    try:
        async def call(method, path, **kw):
            for _ in range(6):
                async with session.request(method, API + path, headers=headers, **kw) as r:
                    if r.status == 429:
                        await asyncio.sleep(float((await r.json()).get("retry_after", 1)) + .2)
                        continue
                    if r.status >= 400:
                        raise RuntimeError(f"{method} {path} → {r.status}: {(await r.text())[:200]}")
                    return await r.json()
            raise RuntimeError("rate limited")
        app = await call("GET", "/applications/@me")
        existing = {e["name"]: e["id"] for e in (await call("GET", f"/applications/{app['id']}/emojis")).get("items", [])}
        ids.update(existing)
        todo = [e for e in manifest if e["name"] not in ids]
        for n, e in enumerate(todo, 1):
            data = base64.b64encode((DIR / e["file"]).read_bytes()).decode()
            made = await call("POST", f"/applications/{app['id']}/emojis", json={"name": e["name"], "image": f"data:image/png;base64,{data}"})
            ids[e["name"]] = made["id"]
            if on_progress:
                on_progress(n, len(todo), e["name"])
        ids = {k: v for k, v in ids.items() if k.startswith("rv_")}
        IDS_FILE.write_text(json.dumps(ids, indent=1), encoding="utf-8")
        E.reload()
        sync.last = {"total": len(manifest), "uploaded": len(todo), "ready": sum(1 for e in manifest if e["name"] in ids)}
        return ids
    finally:
        if own:
            await session.close()
