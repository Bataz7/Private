"""ربط الترجمة بكل ما يرسله البوت | Applies the language layer at the HTTP boundary.

لأن كل رسالة/رد/مودال يمر عبر HTTPClient.request، نترجم النص هناك فتتحول كل الكوجات القديمة
(الإيمبد، الأزرار، القوائم، ردود السلاش) تلقائياً للإنجليزية لسيرفرات اللغة English، بدون تعديل كل كوج.
الكود نفسه ما يتأثر: نترجم النصوص الظاهرة فقط (label/title/description…) وليس قيم الخيارات أو custom_id.
"""
import json

import discord
from discord import app_commands
from discord.http import HTTPClient

from . import i18n

_bot = None
_orig_request = HTTPClient.request
_orig_parse = None


def _t(s):
    return i18n.translate(s) if isinstance(s, str) else s


def _embed(e: dict) -> dict:
    e = dict(e)
    for k in ("title", "description"):
        if k in e:
            e[k] = _t(e[k])
    if isinstance(e.get("footer"), dict) and "text" in e["footer"]:
        e["footer"] = {**e["footer"], "text": _t(e["footer"]["text"])}
    if isinstance(e.get("author"), dict) and "name" in e["author"]:
        e["author"] = {**e["author"], "name": _t(e["author"]["name"])}
    if "fields" in e:
        e["fields"] = [{**f, "name": _t(f.get("name")), "value": _t(f.get("value"))} for f in e["fields"]]
    return e


def _comp(c):
    if not isinstance(c, dict):
        return c
    c = dict(c)
    for k in ("label", "placeholder", "content", "description"):
        if k in c:
            c[k] = _t(c[k])
    if "options" in c:
        c["options"] = [{**o, "label": _t(o.get("label")), **({"description": _t(o["description"])} if o.get("description") else {})} for o in c["options"]]
    for k in ("components",):
        if k in c:
            c[k] = [_comp(x) for x in c[k]]
    for k in ("accessory", "component"):
        if k in c:
            c[k] = _comp(c[k])
    if "items" in c:  # media gallery
        c["items"] = [{**i, "description": _t(i.get("description"))} if i.get("description") else i for i in c["items"]]
    return c


def _msg(d: dict) -> dict:
    d = dict(d)
    if "content" in d:
        d["content"] = _t(d["content"])
    if "embeds" in d:
        d["embeds"] = [_embed(e) for e in d["embeds"]]
    if "components" in d:
        d["components"] = [_comp(c) for c in d["components"]]
    if "title" in d:  # modal
        d["title"] = _t(d["title"])
    if "choices" in d:  # autocomplete
        d["choices"] = [{**c, "name": _t(c.get("name"))} for c in d["choices"]]
    return d


def translate_payload(p: dict) -> dict:
    if "data" in p and isinstance(p["data"], dict) and "type" in p:  # interaction callback
        return {**p, "data": _msg(p["data"])}
    return _msg(p)


def _route_lang(route):
    ctx = i18n.current_lang()
    if ctx:
        return ctx
    cid = getattr(route, "channel_id", None) or (route.params.get("channel_id") if hasattr(route, "params") else None)
    if cid and _bot:
        ch = _bot.get_channel(int(cid))
        gid = getattr(getattr(ch, "guild", None), "id", None)
        if gid:
            return i18n.guild_lang(gid)
    return None


async def _request(self, route, *, files=None, form=None, **kwargs):
    try:
        path = route.path
        if "/messages" in path or "/interactions/" in path or "/webhooks/" in path:
            if _route_lang(route) == "en":
                if isinstance(kwargs.get("json"), dict):
                    kwargs["json"] = translate_payload(kwargs["json"])
                if form:
                    for part in form:
                        if part.get("name") == "payload_json" and isinstance(part.get("value"), str):
                            part["value"] = json.dumps(translate_payload(json.loads(part["value"])), ensure_ascii=False)
    except Exception:  # الترجمة ما لازم تكسر الإرسال
        pass
    return await _orig_request(self, route, files=files, form=form, **kwargs)


def _parse_interaction(self, data):
    gid = data.get("guild_id")
    if gid:
        lang = i18n.guild_lang(int(gid))
    else:
        lang = "ar" if str(data.get("locale", "")).startswith("ar") else ("en" if data.get("locale") else None)
    i18n.set_context_lang(lang)
    return _orig_parse(self, data)


class ReviveTranslator(app_commands.Translator):
    """وصف أوامر السلاش وخياراتها بالإنجليزية لمن يستخدم ديسكورد بالإنجليزي."""

    async def translate(self, string, locale, context):
        if locale not in (discord.Locale.american_english, discord.Locale.british_english):
            return None
        en = i18n.translate(string.message)
        if en == string.message:
            return None
        if context.location in (app_commands.TranslationContextLocation.command_name, app_commands.TranslationContextLocation.group_name, app_commands.TranslationContextLocation.parameter_name):
            return None  # الأسماء تبقى إنجليزية كما كتبناها
        return en[:100]


def install(bot) -> None:
    """استدعها مرة واحدة قبل bot.run()."""
    global _bot, _orig_parse
    _bot = bot
    HTTPClient.request = _request
    import discord.state as st
    if _orig_parse is None:
        _orig_parse = st.ConnectionState.parse_interaction_create
        st.ConnectionState.parse_interaction_create = _parse_interaction
