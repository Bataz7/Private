"""الترحيب والمغادرة بالكانفاس | Welcome & goodbye with a custom image card.

- /welcome setup  → استوديو تفاعلي: اختر التصميم واللون والنص والخلفية وشوف المعاينة مباشرة ثم احفظ.
- /welcome test · /welcome off · /welcome info
- نفس جدول welcome_settings الذي تعدّله لوحة التحكم (أُضيفت أعمدة للكانفاس تلقائياً).
- الصورة تُرسم في خيط منفصل وبحد أقصى 2 بالتوازي، وتُتخطى أثناء الغارات الكبيرة لحماية المعالج.
"""
import asyncio
import io
import sqlite3

import aiohttp
import discord
from discord import app_commands
from discord.ext import commands

from core import card, i18n
from core.brand import embed as mk_embed
from core.strings import add
from emojis import E

KINDS = ("welcome", "goodbye")
EMBED_COLORS = {"أزرق": 0x4F8CFF, "أخضر": 0x2FD18B, "أحمر": 0xFF5470, "أصفر": 0xFFC83D, "بنفسجي": 0x9B7BFF, "برتقالي": 0xFF8A3D, "أبيض": 0xF2F3F5, "أسود": 0x2B2F3A}
COLOR_LABEL = {"أزرق": ("أزرق", "Blue"), "أخضر": ("أخضر", "Green"), "أحمر": ("أحمر", "Red"), "أصفر": ("أصفر", "Yellow"), "بنفسجي": ("بنفسجي", "Purple"), "برتقالي": ("برتقالي", "Orange"), "أبيض": ("أبيض", "White"), "أسود": ("أسود", "Black")}

add("wl", {
    "group": ("إعداد الترحيب والمغادرة", "Welcome & goodbye setup"),
    "setup_d": ("افتح استوديو تصميم رسالة الترحيب أو المغادرة", "Open the welcome / goodbye design studio"),
    "test_d": ("أرسل رسالة تجريبية في روم الترحيب", "Send a test message to the welcome channel"),
    "off_d": ("إيقاف رسالة الترحيب أو المغادرة", "Turn the welcome / goodbye message off"),
    "info_d": ("عرض الإعدادات الحالية", "Show the current settings"),
    "p_type": ("النوع", "Type"), "k_welcome": ("ترحيب", "Welcome"), "k_goodbye": ("مغادرة", "Goodbye"),
    # استوديو
    "studio_t": ("استوديو الترحيب", "Welcome studio"), "studio_t_goodbye": ("استوديو المغادرة", "Goodbye studio"),
    "studio_d": ("عدّل التصميم من القوائم والأزرار وشاهد المعاينة مباشرة، ثم اضغط **حفظ**.", "Adjust the design with the menus and buttons, watch the live preview, then press **Save**."),
    "style_ph": ("🎨 اختر تصميم البطاقة", "🎨 Pick a card style"), "color_ph": ("🌈 اختر لون التمييز", "🌈 Pick an accent color"),
    "chan_ph": ("📍 اختر روم الرسالة", "📍 Pick the message channel"),
    "b_text": ("النصوص", "Texts"), "b_bg": ("الخلفية", "Background"), "b_card": ("البطاقة", "Card"), "b_avatar": ("الصورة", "Avatar"),
    "b_mention": ("المنشن", "Mention"), "b_bots": ("تجاهل البوتات", "Ignore bots"), "b_save": ("حفظ", "Save"), "b_test": ("تجربة", "Test"), "b_cancel": ("إلغاء", "Cancel"),
    "b_hex": ("لون مخصص", "Custom hex"), "b_on": ("مفعّل", "On"), "b_off": ("معطّل", "Off"), "b_status": ("الحالة", "Status"),
    "s_royal": ("ملكي", "Royal"), "s_neon": ("نيون", "Neon"), "s_glass": ("زجاجي", "Glass"), "s_minimal": ("بسيط فاتح", "Minimal light"), "s_sunset": ("غروب", "Sunset"), "s_aurora": ("شفق", "Aurora"),
    "m_text_t": ("نصوص الرسالة", "Message texts"), "m_embed": ("نص الإيمبد", "Embed text"), "m_outside": ("نص خارج الإيمبد (اختياري)", "Text above the embed (optional)"),
    "m_title": ("عنوان البطاقة", "Card title"), "m_sub": ("السطر الثاني في البطاقة", "Card subtitle"),
    "m_bg_t": ("خلفية البطاقة", "Card background"), "m_bg": ("رابط صورة الخلفية (فاضي = تصميم جاهز)", "Background image URL (empty = built-in)"),
    "m_img": ("رابط صورة الإيمبد (لو البطاقة معطلة)", "Embed image URL (when card is off)"),
    "m_hex_t": ("لون مخصص", "Custom color"), "m_hex": ("الكود مثل #7C4DFF", "Hex code, e.g. #7C4DFF"), "bad_hex": ("❌ كود اللون غير صحيح. مثال: #7C4DFF", "❌ Invalid color. Example: #7C4DFF"),
    "bad_url": ("❌ الرابط لازم يبدأ بـ http أو https", "❌ The URL must start with http or https"),
    "vars": ("المتغيرات: `{user}` منشن · `{name}` الاسم · `{server}` السيرفر · `{count}` العدد · `{id}` الآيدي", "Variables: `{user}` mention · `{name}` name · `{server}` server · `{count}` count · `{id}` ID"),
    "saved": ("✅ تم حفظ إعدادات **{kind}** وهي الآن **{state}** في {channel}.", "✅ **{kind}** settings saved — now **{state}** in {channel}."),
    "need_channel": ("اختر روم الرسالة أولاً من القائمة.", "Pick the message channel first."),
    "tested": ("📨 أُرسلت رسالة تجريبية إلى {channel}.", "📨 A test message was sent to {channel}."),
    "no_cfg": ("ما فيه إعدادات بعد. استخدم `/welcome setup`.", "Nothing is set up yet. Use `/welcome setup`."),
    "cancelled": ("تم إلغاء الاستوديو.", "Studio closed."), "off_ok": ("تم إيقاف رسالة **{kind}**.", "**{kind}** message turned off."),
    "not_yours": ("هذا الاستوديو لصاحب الأمر فقط.", "This studio belongs to whoever opened it."),
    "perm_chan": ("البوت يحتاج صلاحية **إرسال الرسائل + إرفاق الملفات** في {channel}.", "I need **Send Messages + Attach Files** in {channel}."),
    "info_t": ("إعدادات الترحيب", "Welcome settings"),
    "i_channel": ("الروم", "Channel"), "i_style": ("التصميم", "Style"), "i_card": ("البطاقة", "Card"),
    # نصوص افتراضية
    "d_text_welcome": ("حياك الله {user} في **{server}**! 🎉\nأنت العضو رقم **{count}**.", "Welcome {user} to **{server}**! 🎉\nYou're member **#{count}**."),
    "d_text_goodbye": ("{name} غادر **{server}**. نتمنى لك التوفيق 👋", "{name} has left **{server}**. We wish you the best 👋"),
    "d_title_welcome": ("حياك الله", "WELCOME"), "d_title_goodbye": ("في أمان الله", "GOODBYE"),
    "d_sub_welcome": ("نورت {server}", "to {server}"), "d_sub_goodbye": ("نتمنى لك التوفيق", "We'll miss you"),
    "d_badge_welcome": ("العضو رقم {count}", "Member #{count}"), "d_badge_goodbye": ("المتبقي {count} عضو", "{count} members left"),
})

COLUMNS = {"card": "INTEGER DEFAULT 1", "card_style": "TEXT DEFAULT 'royal'", "card_bg": "TEXT", "card_title": "TEXT", "card_sub": "TEXT"}


def fill(text: str | None, member: discord.Member, mention: bool = True) -> str | None:
    if not text:
        return text
    g = member.guild
    return (text.replace("{user}", member.mention if mention else member.display_name).replace("{name}", member.display_name)
            .replace("{server}", g.name).replace("{count}", f"{g.member_count:,}").replace("{id}", str(member.id)))


class WelcomeCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.db = sqlite3.connect("welcome_goodbye.db", check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute("""CREATE TABLE IF NOT EXISTS welcome_settings (
            guild_id INTEGER, type TEXT, channel_id INTEGER, color TEXT, show_avatar INTEGER, ignore_bots INTEGER, disable_mention INTEGER,
            embed_type TEXT, image_url TEXT, embed_text TEXT, outside_text TEXT, status INTEGER DEFAULT 1, PRIMARY KEY (guild_id, type))""")
        have = {r[1] for r in self.db.execute("PRAGMA table_info(welcome_settings)")}
        for col, ddl in COLUMNS.items():
            if col not in have:
                self.db.execute(f"ALTER TABLE welcome_settings ADD COLUMN {col} {ddl}")
        self.db.commit()
        self.sem = asyncio.Semaphore(2)
        self.pending = 0
        self._http: aiohttp.ClientSession | None = None
        self._bg: dict[str, bytes] = {}

    def cog_unload(self):
        self.db.close()
        if self._http:
            asyncio.create_task(self._http.close())

    # ------------------------------------------------------------------ بيانات
    def get(self, guild_id: int, kind: str) -> dict | None:
        r = self.db.execute("SELECT * FROM welcome_settings WHERE guild_id=? AND type=?", (guild_id, kind)).fetchone()
        return dict(r) if r else None

    def save(self, guild_id: int, kind: str, c: dict):
        cols = ["channel_id", "color", "show_avatar", "ignore_bots", "disable_mention", "embed_type", "image_url", "embed_text", "outside_text", "status", *COLUMNS]
        vals = [c.get(k) for k in cols]
        self.db.execute(
            f"INSERT INTO welcome_settings(guild_id,type,{','.join(cols)}) VALUES(?,?,{','.join('?' * len(cols))}) "
            f"ON CONFLICT(guild_id,type) DO UPDATE SET {','.join(f'{k}=excluded.{k}' for k in cols)}", (guild_id, kind, *vals))
        self.db.commit()

    @staticmethod
    def defaults(channel_id=None) -> dict:
        return dict(channel_id=channel_id, color="#4f8cff", show_avatar=1, ignore_bots=1, disable_mention=0, embed_type="ايمبد حديث", image_url=None,
                    embed_text=None, outside_text=None, status=1, card=1, card_style="royal", card_bg=None, card_title=None, card_sub=None)

    # ------------------------------------------------------------------ تركيب الرسالة
    async def fetch_bg(self, url: str) -> bytes | None:
        if url in self._bg:
            return self._bg[url]
        try:
            self._http = self._http or aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=8))
            async with self._http.get(url) as r:
                if r.status != 200 or int(r.headers.get("Content-Length", 0)) > 4_000_000:
                    return None
                data = await r.content.read(4_000_001)
                if len(data) > 4_000_000:
                    return None
        except Exception:
            return None
        if len(self._bg) >= 4:
            self._bg.pop(next(iter(self._bg)))
        self._bg[url] = data
        return data

    async def compose(self, member: discord.Member, kind: str, c: dict, *, allow_card: bool = True):
        """يرجع (content, embed, file|None)."""
        g = member.guild
        lang = i18n.guild_lang(g.id)
        T = lambda k, **v: i18n.tr(lang, "wl." + k, **v)
        mention = not c.get("disable_mention")
        body = fill(c.get("embed_text") or T(f"d_text_{kind}"), member, mention)
        outside = fill(c.get("outside_text"), member, mention)
        color = c.get("color") or "أزرق"
        accent = f"#{EMBED_COLORS[color]:06x}" if color in EMBED_COLORS else (color if color.startswith("#") else "#4f8cff")
        emb = discord.Embed(description=body, color=discord.Color.from_rgb(*card.hex_rgb(accent)), timestamp=discord.utils.utcnow())
        if c.get("embed_type") == "ايمبد حديث":
            emb.set_author(name=member.display_name, icon_url=member.display_avatar.url)
        file = None
        if c.get("card", 1) and allow_card:
            title = fill(c.get("card_title"), member, False) or T(f"d_title_{kind}")
            sub = fill(c.get("card_sub"), member, False) or T(f"d_sub_{kind}", server=g.name)
            badge = T(f"d_badge_{kind}", count=f"{g.member_count:,}")
            avatar = await member.display_avatar.replace(size=256, format="png").read() if c.get("show_avatar", 1) else None
            bg = await self.fetch_bg(c["card_bg"]) if c.get("card_bg") else None
            png = await asyncio.to_thread(card.render, avatar=avatar, name=member.display_name, title=title, subtitle=sub, badge=badge,
                                          style=c.get("card_style") or "royal", accent=accent, rtl=(lang == "ar"), show_avatar=bool(c.get("show_avatar", 1)), bg=bg)
            file = discord.File(io.BytesIO(png), filename="welcome.png")
            emb.set_image(url="attachment://welcome.png")
        else:
            if c.get("show_avatar", 1):
                emb.set_thumbnail(url=member.display_avatar.url)
            if c.get("image_url"):
                emb.set_image(url=c["image_url"])
        return outside, emb, file

    async def handle(self, member: discord.Member, kind: str):
        c = self.get(member.guild.id, kind)
        if not c or c.get("status") == 0 or (member.bot and c.get("ignore_bots")):
            return
        ch = member.guild.get_channel(c["channel_id"] or 0)
        if not isinstance(ch, discord.TextChannel) or not ch.permissions_for(member.guild.me).send_messages:
            return
        allow_card = self.pending < 8  # أثناء الغارات نرسل نصاً فقط
        self.pending += 1
        try:
            async with self.sem:
                content, emb, file = await self.compose(member, kind, c, allow_card=allow_card)
            kw = {"file": file} if file else {}
            await ch.send(content=content, embed=emb, allowed_mentions=discord.AllowedMentions(users=not c.get("disable_mention")), **kw)
        except Exception:
            pass
        finally:
            self.pending -= 1

    @commands.Cog.listener()
    async def on_member_join(self, member):
        await self.handle(member, "welcome")

    @commands.Cog.listener()
    async def on_member_remove(self, member):
        await self.handle(member, "goodbye")

    # ------------------------------------------------------------------ الأوامر
    wl = app_commands.Group(name="welcome", description="إعداد الترحيب والمغادرة", guild_only=True, default_permissions=discord.Permissions(manage_guild=True))
    KIND_CHOICES = [app_commands.Choice(name="ترحيب", value="welcome"), app_commands.Choice(name="مغادرة", value="goodbye")]

    async def _admin(self, it: discord.Interaction) -> bool:
        if it.user.guild_permissions.manage_guild:
            return True
        await it.response.send_message(i18n.tr(it, "c.no_perm"), ephemeral=True)
        return False

    @wl.command(name="setup", description="افتح استوديو تصميم رسالة الترحيب أو المغادرة")
    @app_commands.describe(type="النوع")
    @app_commands.choices(type=KIND_CHOICES)
    async def setup_cmd(self, it: discord.Interaction, type: app_commands.Choice[str] | None = None):
        if not await self._admin(it):
            return
        kind = type.value if type else "welcome"
        cfg = self.get(it.guild_id, kind) or self.defaults()
        cfg = {**self.defaults(), **{k: v for k, v in cfg.items() if v is not None}}
        studio = Studio(self, it, kind, cfg)
        await it.response.defer(ephemeral=True)
        await studio.refresh(it, first=True)

    @wl.command(name="test", description="أرسل رسالة تجريبية في روم الترحيب")
    @app_commands.describe(type="النوع")
    @app_commands.choices(type=KIND_CHOICES)
    async def test_cmd(self, it: discord.Interaction, type: app_commands.Choice[str] | None = None):
        if not await self._admin(it):
            return
        kind = type.value if type else "welcome"
        c = self.get(it.guild_id, kind)
        ch = it.guild.get_channel(c["channel_id"]) if c and c["channel_id"] else None
        if not ch:
            return await it.response.send_message(i18n.tr(it, "wl.no_cfg"), ephemeral=True)
        await it.response.defer(ephemeral=True)
        content, emb, file = await self.compose(it.user, kind, c)
        await ch.send(content=content, embed=emb, **({"file": file} if file else {}))
        await it.followup.send(i18n.tr(it, "wl.tested", channel=ch.mention), ephemeral=True)

    @wl.command(name="off", description="إيقاف رسالة الترحيب أو المغادرة")
    @app_commands.describe(type="النوع")
    @app_commands.choices(type=KIND_CHOICES)
    async def off_cmd(self, it: discord.Interaction, type: app_commands.Choice[str] | None = None):
        if not await self._admin(it):
            return
        kind = type.value if type else "welcome"
        self.db.execute("UPDATE welcome_settings SET status=0 WHERE guild_id=? AND type=?", (it.guild_id, kind))
        self.db.commit()
        await it.response.send_message(i18n.tr(it, "wl.off_ok", kind=i18n.tr(it, "wl.k_" + kind)), ephemeral=True)

    @wl.command(name="info", description="عرض الإعدادات الحالية")
    async def info_cmd(self, it: discord.Interaction):
        e = mk_embed(None, "brand", f"{E.welcome} {i18n.tr(it, 'wl.info_t')}")
        for kind in KINDS:
            c = self.get(it.guild_id, kind)
            ch = it.guild.get_channel(c["channel_id"]) if c and c["channel_id"] else None
            if not c:
                val = f"`{i18n.tr(it, 'wl.no_cfg')}`"
            else:
                val = (f"**{i18n.tr(it, 'wl.i_channel')}:** {ch.mention if ch else '—'}\n**{i18n.tr(it, 'wl.i_card')}:** {'✅' if c.get('card') else '❌'} · "
                       f"`{c.get('card_style') or 'royal'}`\n**{i18n.tr(it, 'wl.b_status')}:** {i18n.tr(it, 'wl.b_on') if c.get('status') != 0 else i18n.tr(it, 'wl.b_off')}")
            e.add_field(name=i18n.tr(it, "wl.k_" + kind), value=val, inline=True)
        await it.response.send_message(embed=e, ephemeral=True)


# ====================================================================== الاستوديو التفاعلي
class TextsModal(discord.ui.Modal):
    def __init__(self, studio: "Studio"):
        lang = studio.lang
        super().__init__(title=i18n.tr(lang, "wl.m_text_t"), timeout=600)
        self.studio = studio
        c = studio.cfg
        self.f_embed = discord.ui.TextInput(label=i18n.tr(lang, "wl.m_embed"), style=discord.TextStyle.paragraph, required=False, max_length=1000, default=c.get("embed_text") or "", placeholder=i18n.tr(lang, "wl.d_text_" + studio.kind)[:100])
        self.f_out = discord.ui.TextInput(label=i18n.tr(lang, "wl.m_outside"), required=False, max_length=300, default=c.get("outside_text") or "")
        self.f_title = discord.ui.TextInput(label=i18n.tr(lang, "wl.m_title"), required=False, max_length=40, default=c.get("card_title") or "", placeholder=i18n.tr(lang, "wl.d_title_" + studio.kind))
        self.f_sub = discord.ui.TextInput(label=i18n.tr(lang, "wl.m_sub"), required=False, max_length=70, default=c.get("card_sub") or "")
        for f in (self.f_embed, self.f_out, self.f_title, self.f_sub):
            self.add_item(f)

    async def on_submit(self, it: discord.Interaction):
        c = self.studio.cfg
        c["embed_text"], c["outside_text"] = self.f_embed.value.strip() or None, self.f_out.value.strip() or None
        c["card_title"], c["card_sub"] = self.f_title.value.strip() or None, self.f_sub.value.strip() or None
        await it.response.defer()
        await self.studio.refresh(it)


class BgModal(discord.ui.Modal):
    def __init__(self, studio: "Studio"):
        lang = studio.lang
        super().__init__(title=i18n.tr(lang, "wl.m_bg_t"), timeout=600)
        self.studio = studio
        self.f_bg = discord.ui.TextInput(label=i18n.tr(lang, "wl.m_bg"), required=False, default=studio.cfg.get("card_bg") or "", max_length=400)
        self.f_img = discord.ui.TextInput(label=i18n.tr(lang, "wl.m_img"), required=False, default=studio.cfg.get("image_url") or "", max_length=400)
        self.add_item(self.f_bg)
        self.add_item(self.f_img)

    async def on_submit(self, it: discord.Interaction):
        bg, img = self.f_bg.value.strip(), self.f_img.value.strip()
        if (bg and not bg.startswith(("http://", "https://"))) or (img and not img.startswith(("http://", "https://"))):
            return await it.response.send_message(i18n.tr(self.studio.lang, "wl.bad_url"), ephemeral=True)
        self.studio.cfg["card_bg"], self.studio.cfg["image_url"] = bg or None, img or None
        await it.response.defer()
        await self.studio.refresh(it)


class HexModal(discord.ui.Modal):
    def __init__(self, studio: "Studio"):
        super().__init__(title=i18n.tr(studio.lang, "wl.m_hex_t"), timeout=300)
        self.studio = studio
        self.f = discord.ui.TextInput(label=i18n.tr(studio.lang, "wl.m_hex"), min_length=6, max_length=7, placeholder="#7C4DFF")
        self.add_item(self.f)

    async def on_submit(self, it: discord.Interaction):
        import re
        v = self.f.value.strip()
        if not re.fullmatch(r"#?[0-9a-fA-F]{6}", v):
            return await it.response.send_message(i18n.tr(self.studio.lang, "wl.bad_hex"), ephemeral=True)
        self.studio.cfg["color"] = "#" + v.lstrip("#").lower()
        await it.response.defer()
        await self.studio.refresh(it)


class Studio(discord.ui.View):
    def __init__(self, cog: WelcomeCog, it: discord.Interaction, kind: str, cfg: dict):
        super().__init__(timeout=900)
        self.cog, self.kind, self.cfg, self.owner = cog, kind, cfg, it.user
        self.lang = i18n.guild_lang(it.guild_id)
        self.message: discord.Message | None = None
        self._build()

    def T(self, k, **v):
        return i18n.tr(self.lang, "wl." + k, **v)

    # --- بناء المكوّنات (تتجدد حسب الحالة)
    def _build(self):
        self.clear_items()
        c, T = self.cfg, self.T
        style = discord.ui.Select(placeholder=T("style_ph"), row=0, options=[
            discord.SelectOption(label=T("s_" + s), value=s, default=(c.get("card_style") or "royal") == s, emoji=E.pe("palette")) for s in card.STYLES])
        style.callback = self.on_style
        col = discord.ui.Select(placeholder=T("color_ph"), row=1, options=[
            *[discord.SelectOption(label=COLOR_LABEL[n][0 if self.lang == "ar" else 1], value=n, default=c.get("color") == n) for n in COLOR_LABEL],
            discord.SelectOption(label=T("b_hex"), value="__hex", emoji=E.pe("palette"))])
        col.callback = self.on_color
        chan = discord.ui.ChannelSelect(placeholder=T("chan_ph"), channel_types=[discord.ChannelType.text], row=2)
        chan.callback = self.on_channel
        for it_ in (style, col, chan):
            self.add_item(it_)

        def btn(label, cb, row, emoji=None, style=discord.ButtonStyle.secondary):
            b = discord.ui.Button(label=label, style=style, row=row, emoji=emoji)
            b.callback = cb
            self.add_item(b)
        on = discord.ButtonStyle.success
        btn(T("b_text"), self.on_texts, 3, E.pe("message"), discord.ButtonStyle.primary)
        btn(T("b_bg"), self.on_bg, 3, E.pe("image"))
        btn(T("b_card"), self.t_card, 3, E.pe("eye"), on if c.get("card", 1) else discord.ButtonStyle.secondary)
        btn(T("b_avatar"), self.t_avatar, 3, E.pe("user"), on if c.get("show_avatar", 1) else discord.ButtonStyle.secondary)
        btn(T("b_mention"), self.t_mention, 3, E.pe("users"), on if not c.get("disable_mention") else discord.ButtonStyle.secondary)
        btn(T("b_save"), self.on_save, 4, E.pe("success"), discord.ButtonStyle.success)
        btn(T("b_test"), self.on_test, 4, E.pe("bolt"))
        btn(T("b_bots"), self.t_bots, 4, E.pe("bot"), on if c.get("ignore_bots") else discord.ButtonStyle.secondary)
        btn(T("b_off") if c.get("status", 1) else T("b_on"), self.t_status, 4, E.pe("on" if c.get("status", 1) == 0 else "off"))
        btn(T("b_cancel"), self.on_cancel, 4, E.pe("error"), discord.ButtonStyle.danger)

    async def interaction_check(self, it: discord.Interaction) -> bool:
        if it.user.id != self.owner.id:
            await it.response.send_message(self.T("not_yours"), ephemeral=True)
            return False
        return True

    # --- المعاينة
    async def refresh(self, it: discord.Interaction, first: bool = False):
        self._build()
        member = it.user if isinstance(it.user, discord.Member) else it.guild.get_member(it.user.id)
        content, emb, file = await self.cog.compose(member, self.kind, self.cfg)
        head = discord.Embed(title=f"{E.welcome} {self.T('studio_t' if self.kind == 'welcome' else 'studio_t_goodbye')}",
                             description=f"{self.T('studio_d')}\n{self.T('vars')}", color=discord.Color(0x2F6BFF))
        attachments = [file] if file else []
        embeds = [head, emb]
        await it.edit_original_response(content=content or None, embeds=embeds, attachments=attachments, view=self)

    # --- ردود المكونات
    async def on_style(self, it):
        self.cfg["card_style"] = it.data["values"][0]
        await self._re(it)

    async def on_color(self, it):
        v = it.data["values"][0]
        if v == "__hex":
            return await it.response.send_modal(HexModal(self))
        self.cfg["color"] = v
        await self._re(it)

    async def on_channel(self, it):
        self.cfg["channel_id"] = int(it.data["values"][0])
        await self._re(it)

    async def _re(self, it):
        await it.response.defer()
        await self.refresh(it)

    async def on_texts(self, it):
        await it.response.send_modal(TextsModal(self))

    async def on_bg(self, it):
        await it.response.send_modal(BgModal(self))

    def _toggle(self, key, invert=False):
        async def cb(it):
            self.cfg[key] = 0 if self.cfg.get(key, 0 if invert else 1) else 1
            await self._re(it)
        return cb

    async def t_card(self, it):
        await self._toggle("card")(it)

    async def t_avatar(self, it):
        await self._toggle("show_avatar")(it)

    async def t_mention(self, it):
        await self._toggle("disable_mention", True)(it)

    async def t_bots(self, it):
        await self._toggle("ignore_bots", True)(it)

    async def t_status(self, it):
        await self._toggle("status")(it)

    async def on_test(self, it):
        ch = it.guild.get_channel(self.cfg.get("channel_id") or 0)
        if not ch:
            return await it.response.send_message(self.T("need_channel"), ephemeral=True)
        await it.response.defer(ephemeral=True)
        content, emb, file = await self.cog.compose(it.user, self.kind, self.cfg)
        await ch.send(content=content, embed=emb, **({"file": file} if file else {}))
        await it.followup.send(self.T("tested", channel=ch.mention), ephemeral=True)

    async def on_save(self, it):
        ch = it.guild.get_channel(self.cfg.get("channel_id") or 0)
        if not ch:
            return await it.response.send_message(self.T("need_channel"), ephemeral=True)
        p = ch.permissions_for(it.guild.me)
        if not (p.send_messages and p.attach_files and p.embed_links):
            return await it.response.send_message(self.T("perm_chan", channel=ch.mention), ephemeral=True)
        self.cog.save(it.guild_id, self.kind, self.cfg)
        self.stop()
        state = self.T("b_on") if self.cfg.get("status", 1) else self.T("b_off")
        await it.response.edit_message(content=None, attachments=[], view=None, embeds=[mk_embed(None, "success", f"{E.success} {self.T('studio_t')}",
                                       self.T("saved", kind=i18n.tr(self.lang, "wl.k_" + self.kind), state=state, channel=ch.mention))])

    async def on_cancel(self, it):
        self.stop()
        await it.response.edit_message(content=None, attachments=[], view=None, embeds=[mk_embed(None, "warn", None, self.T("cancelled"))])


async def setup(bot):
    await bot.add_cog(WelcomeCog(bot))
