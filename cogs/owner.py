"""أدوات المالك | Owner tools — إشعارات دخول/خروج البوت، إحصائيات حية، حظر سيرفرات.

يحل محل log.py و bot_log.py و stuts.py و msg.py. كل المعرفات من .env (OWNER_GUILD_ID / OWNER_LOG_CHANNEL_ID / OWNER_STATS_CHANNEL_ID / OWNER_IDS).
الإحصائيات تُحدَّث كل 5 دقائق (بدل 10 ثوانٍ) لتخفيف الـ API والمعالج.
"""
import sqlite3

import discord
from discord import app_commands
from discord.ext import commands, tasks

from core import config, i18n
from core.brand import embed as mk_embed
from core.strings import add
from emojis import E

add("owner", {
    "group": ("أوامر التحكم بالبوت", "Bot control"), "no": ("❌ هذا الأمر لمالك البوت فقط.", "❌ This command is for the bot owner only."),
    "joined": ("تمت إضافة البوت لسيرفر جديد", "Bot added to a new server"), "left": ("تمت إزالة البوت من سيرفر", "Bot removed from a server"),
    "name": ("السيرفر", "Server"), "members": ("الأعضاء", "Members"), "by": ("أضافه", "Added by"), "unknown": ("غير معروف", "Unknown"),
    "stats_t": ("إحصائيات {bot}", "{bot} statistics"), "stats_d": ("نظرة مباشرة على انتشار البوت.", "A live look at the bot's reach."),
    "servers": ("السيرفرات", "Servers"), "total": ("إجمالي الأعضاء", "Total members"), "latency": ("زمن الاستجابة", "Latency"),
    "stats_f": ("يتحدث كل 5 دقائق", "Updates every 5 minutes"), "refresh": ("تحديث", "Refresh"),
    "panel_d": ("إرسال بانل الإحصائيات في هذا الروم", "Post the statistics panel in this channel"), "panel_ok": ("✅ تم إرسال البانل.", "✅ Panel sent."),
    "ban_d": ("حظر سيرفر وإخراج البوت منه", "Blacklist a server and leave it"), "unban_d": ("فك حظر سيرفر", "Remove a server from the blacklist"),
    "list_d": ("عرض أكبر السيرفرات", "List the biggest servers"), "send_d": ("إرسال رسالة نصية في روم", "Send a plain message to a channel"),
    "p_gid": ("آيدي السيرفر", "Server ID"), "p_ch": ("الروم", "Channel"), "p_msg": ("الرسالة", "Message"),
    "banned": ("🚫 تم حظر السيرفر `{id}`.", "🚫 Server `{id}` blacklisted."), "unbanned": ("✅ تم فك حظر السيرفر `{id}`.", "✅ Server `{id}` removed from the blacklist."),
    "bad_id": ("❌ آيدي غير صحيح.", "❌ Invalid ID."), "sent": ("✅ تم الإرسال إلى {channel}.", "✅ Sent to {channel}."), "list_t": ("أكبر السيرفرات", "Biggest servers"),
})


class StatsView(discord.ui.View):
    def __init__(self, cog):
        super().__init__(timeout=None)
        self.cog = cog
        b = discord.ui.Button(label="تحديث", custom_id="revive_stats_refresh", style=discord.ButtonStyle.primary, emoji=E.pe("loading"))
        b.callback = self.refresh
        self.add_item(b)

    async def refresh(self, it: discord.Interaction):
        await it.response.edit_message(embed=self.cog.stats_embed(i18n.lang_of(it)))


class OwnerCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.db = sqlite3.connect("blacklisted_guilds.db", check_same_thread=False)
        self.db.execute("CREATE TABLE IF NOT EXISTS blacklisted_guilds (guild_id INTEGER PRIMARY KEY)")
        self.db.commit()
        self._stats_msg: int | None = None
        bot.add_view(StatsView(self))

    bc = app_commands.Group(name="التحكم-بالبوت", description="أوامر التحكم بالبوت", guild_ids=[config.OWNER_GUILD_ID or 1], default_permissions=discord.Permissions(administrator=True))

    async def cog_load(self):
        if config.OWNER_GUILD_ID and config.OWNER_STATS_CHANNEL_ID:
            self.stats_loop.start()

    def cog_unload(self):
        self.stats_loop.cancel()
        self.db.close()

    def is_owner(self, user) -> bool:
        return user.id in config.OWNER_IDS or (bool(getattr(user, "guild_permissions", None)) and user.guild_permissions.administrator)

    def blacklisted(self, gid: int) -> bool:
        return self.db.execute("SELECT 1 FROM blacklisted_guilds WHERE guild_id=?", (gid,)).fetchone() is not None

    # ------------------------------------------------------------------ أحداث
    def log_channel(self):
        g = self.bot.get_guild(config.OWNER_GUILD_ID) if config.OWNER_GUILD_ID else None
        return g.get_channel(config.OWNER_LOG_CHANNEL_ID) if g and config.OWNER_LOG_CHANNEL_ID else None

    @commands.Cog.listener()
    async def on_guild_join(self, guild: discord.Guild):
        if self.blacklisted(guild.id):
            return await guild.leave()
        ch = self.log_channel()
        if not ch:
            return
        lang = i18n.guild_lang(config.OWNER_GUILD_ID)
        T = lambda k, **v: i18n.tr(lang, "owner." + k, **v)
        by = T("unknown")
        try:
            async for en in guild.audit_logs(limit=3, action=discord.AuditLogAction.bot_add):
                if en.target and en.target.id == self.bot.user.id and en.user:
                    by = f"{en.user.mention} (`{en.user}`)"
                    break
        except discord.HTTPException:
            pass
        e = mk_embed(None, "success", f"{E.log_join} {T('joined')}")
        e.add_field(name=T("name"), value=f"**{guild.name}**\n`{guild.id}`", inline=True)
        e.add_field(name=T("members"), value=f"`{guild.member_count:,}`", inline=True)
        e.add_field(name=T("by"), value=by, inline=False)
        if guild.icon:
            e.set_thumbnail(url=guild.icon.url)
        await ch.send(embed=e)

    @commands.Cog.listener()
    async def on_guild_remove(self, guild: discord.Guild):
        ch = self.log_channel()
        if ch:
            lang = i18n.guild_lang(config.OWNER_GUILD_ID)
            e = mk_embed(None, "error", f"{E.log_leave} {i18n.tr(lang, 'owner.left')}", f"**{guild.name}**\n`{guild.id}`")
            await ch.send(embed=e)

    # ------------------------------------------------------------------ الإحصائيات
    def stats_embed(self, lang: str) -> discord.Embed:
        T = lambda k, **v: i18n.tr(lang, "owner." + k, **v)
        total = sum(g.member_count or 0 for g in self.bot.guilds)
        e = mk_embed(None, "brand", f"{E.chart} {T('stats_t', bot=self.bot.user.name)}", T("stats_d"))
        e.add_field(name=f"{E.globe} {T('servers')}", value=f"`{len(self.bot.guilds):,}`", inline=True)
        e.add_field(name=f"{E.users} {T('total')}", value=f"`{total:,}`", inline=True)
        e.add_field(name=f"{E.bolt} {T('latency')}", value=f"`{round(self.bot.latency * 1000)} مللي ثانية`", inline=True)
        e.set_thumbnail(url=self.bot.user.display_avatar.url)
        e.set_footer(text=T("stats_f"))
        return e

    @tasks.loop(minutes=5)
    async def stats_loop(self):
        g = self.bot.get_guild(config.OWNER_GUILD_ID)
        ch = g.get_channel(config.OWNER_STATS_CHANNEL_ID) if g else None
        if not ch:
            return
        e = self.stats_embed(i18n.guild_lang(g.id))
        try:
            if self._stats_msg:
                return await ch.get_partial_message(self._stats_msg).edit(embed=e)
            async for m in ch.history(limit=10):
                if m.author.id == self.bot.user.id and m.embeds:
                    self._stats_msg = m.id
                    return await m.edit(embed=e, view=StatsView(self))
            self._stats_msg = (await ch.send(embed=e, view=StatsView(self))).id
        except discord.HTTPException:
            self._stats_msg = None

    @stats_loop.before_loop
    async def _wait(self):
        await self.bot.wait_until_ready()

    # ------------------------------------------------------------------ الأوامر
    async def _guard(self, it) -> bool:
        if self.is_owner(it.user):
            return True
        await it.response.send_message(i18n.tr(it, "owner.no"), ephemeral=True)
        return False

    @bc.command(name="لوحة-الاحصائيات", description="إرسال بانل الإحصائيات في هذا الروم")
    async def c_panel(self, it: discord.Interaction):
        if await self._guard(it):
            await it.channel.send(embed=self.stats_embed(i18n.lang_of(it)), view=StatsView(self))
            await it.response.send_message(i18n.tr(it, "owner.panel_ok"), ephemeral=True)

    @bc.command(name="حظر-سيرفر", description="حظر سيرفر وإخراج البوت منه")
    @app_commands.rename(guild_id="ايدي_السيرفر")
    @app_commands.describe(guild_id="آيدي السيرفر")
    async def c_ban(self, it: discord.Interaction, guild_id: str):
        if not await self._guard(it):
            return
        if not guild_id.isdigit():
            return await it.response.send_message(i18n.tr(it, "owner.bad_id"), ephemeral=True)
        self.db.execute("INSERT OR IGNORE INTO blacklisted_guilds VALUES(?)", (int(guild_id),))
        self.db.commit()
        g = self.bot.get_guild(int(guild_id))
        if g:
            await g.leave()
        await it.response.send_message(i18n.tr(it, "owner.banned", id=guild_id), ephemeral=True)

    @bc.command(name="فك-حظر-سيرفر", description="فك حظر سيرفر")
    @app_commands.rename(guild_id="ايدي_السيرفر")
    @app_commands.describe(guild_id="آيدي السيرفر")
    async def c_unban(self, it: discord.Interaction, guild_id: str):
        if not await self._guard(it):
            return
        if not guild_id.isdigit():
            return await it.response.send_message(i18n.tr(it, "owner.bad_id"), ephemeral=True)
        self.db.execute("DELETE FROM blacklisted_guilds WHERE guild_id=?", (int(guild_id),))
        self.db.commit()
        await it.response.send_message(i18n.tr(it, "owner.unbanned", id=guild_id), ephemeral=True)

    @bc.command(name="السيرفرات", description="عرض أكبر السيرفرات")
    async def c_list(self, it: discord.Interaction):
        if await self._guard(it):
            top = sorted(self.bot.guilds, key=lambda g: g.member_count or 0, reverse=True)[:15]
            e = mk_embed(None, "brand", f"{E.globe} {i18n.tr(it, 'owner.list_t')}", "\n".join(f"`{i + 1:>2}.` **{g.name}** — `{g.member_count:,}` · `{g.id}`" for i, g in enumerate(top)))
            await it.response.send_message(embed=e, ephemeral=True)

    @bc.command(name="ارسال-رسالة", description="إرسال رسالة نصية في روم")
    @app_commands.rename(channel="الروم", message="الرسالة")
    @app_commands.describe(channel="الروم", message="الرسالة")
    async def c_send(self, it: discord.Interaction, channel: discord.TextChannel, message: str):
        if await self._guard(it):
            await channel.send(message[:2000], allowed_mentions=discord.AllowedMentions.none())
            await it.response.send_message(i18n.tr(it, "owner.sent", channel=channel.mention), ephemeral=True)


async def setup(bot):
    await bot.add_cog(OwnerCog(bot))
