"""/language — لغة البوت لكل سيرفر (عربي/English). كل الإيمبدات والردود تتبدّل بالكامل."""
import discord
from discord import app_commands
from discord.ext import commands

from core import i18n
from core.brand import embed as mk_embed
from core.strings import add
from emojis import E

add("lang", {
    "cmd": ("تغيير لغة البوت في هذا السيرفر", "Change the bot's language in this server"),
    "opt": ("اللغة الجديدة", "The new language"),
    "title": ("لغة البوت", "Bot language"),
    "changed": ("تم تغيير لغة البوت إلى **العربية**. كل الإيمبدات والردود تظهر الآن بالعربي.", "The bot language is now **English**. Every embed and reply will appear in English."),
    "current": ("اللغة الحالية: **العربية** 🇸🇦\nلتغييرها: `/language` ثم اختر اللغة.", "Current language: **English** 🇬🇧\nTo change it: `/language` then pick a language."),
    "need": ("تحتاج صلاحية **إدارة السيرفر** لتغيير اللغة.", "You need the **Manage Server** permission to change the language."),
    "arabic": ("العربية", "Arabic"), "english": ("English", "English"),
})


class LanguageCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(name="language", description="تغيير لغة البوت في هذا السيرفر")
    @app_commands.describe(language="اللغة الجديدة")
    @app_commands.choices(language=[app_commands.Choice(name="العربية 🇸🇦", value="ar"), app_commands.Choice(name="English 🇬🇧", value="en")])
    @app_commands.guild_only()
    async def language(self, interaction: discord.Interaction, language: app_commands.Choice[str] | None = None):
        gid = interaction.guild_id
        if language is None:
            cur = i18n.guild_lang(gid)
            emb = mk_embed(interaction, "info", f"{E.globe} " + i18n.tr(cur, "lang.title"), i18n.tr(cur, "lang.current"))
            return await interaction.response.send_message(embed=emb, ephemeral=True)
        if not interaction.user.guild_permissions.manage_guild:
            return await interaction.response.send_message(i18n.tr(interaction, "lang.need"), ephemeral=True)
        i18n.set_guild_lang(gid, language.value)
        i18n.set_context_lang(language.value)  # الرد نفسه يظهر باللغة الجديدة
        emb = mk_embed(language.value, "success", f"{E.success} " + i18n.tr(language.value, "lang.title"), i18n.tr(language.value, "lang.changed"))
        await interaction.response.send_message(embed=emb)


async def setup(bot):
    await bot.add_cog(LanguageCog(bot))
