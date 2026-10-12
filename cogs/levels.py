import math
import random
import sqlite3
import discord
from discord import app_commands
from discord.ext import commands

class LevelsCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.DB_FILE = "levels_settings.db"
        self.db = sqlite3.connect(self.DB_FILE)
        self.db.row_factory = sqlite3.Row
        self.cursor = self.db.cursor()

        # جدول بيانات الأعضاء (XP والمستويات)
        self.cursor.execute("""
        CREATE TABLE IF NOT EXISTS user_levels (
            guild_id INTEGER,
            user_id INTEGER,
            xp INTEGER DEFAULT 0,
            level INTEGER DEFAULT 0,
            PRIMARY KEY (guild_id, user_id)
        )
        """)

        # جدول إعدادات السيرفر (روم إرسال التلفل، ورسالة التلفل المخصصة إن وجدت)
        self.cursor.execute("""
        CREATE TABLE IF NOT EXISTS server_levels_settings (
            guild_id INTEGER PRIMARY KEY,
            channel_id INTEGER,
            custom_message TEXT DEFAULT 'مبروك {user}، لقد صعدت إلى المستوى {level}! (المستوى القادم: {next-level})'
        )
        """)
        self.db.commit()

    def cog_unload(self):
        self.db.close()

    def get_settings(self, guild_id: int):
        self.cursor.execute("SELECT * FROM server_levels_settings WHERE guild_id = ?", (guild_id,))
        return self.cursor.fetchone()

    def update_settings(self, guild_id: int, channel_id=None, message=None):
        current = self.get_settings(guild_id)
        if not current:
            self.cursor.execute("""
            INSERT INTO server_levels_settings (guild_id, channel_id, custom_message)
            VALUES (?, ?, ?)
            """, (guild_id, channel_id or 0, message or 'مبروك {user}، لقد صعدت إلى المستوى {level}! (المستوى القادم: {next-level})'))
        else:
            ch = channel_id if channel_id is not None else current["channel_id"]
            msg = message if message is not None else current["custom_message"]
            self.cursor.execute("""
            UPDATE server_levels_settings SET channel_id = ?, custom_message = ? WHERE guild_id = ?
            """, (ch, msg, guild_id))
        self.db.commit()

    # --- أمر تحديد روم و رسالة المستويات ---
    @app_commands.command(name="روم-المستويات", description="تحديد روم إرسال إشعارات صعود المستويات")
    @app_commands.describe(
        channel="روم المستويات",
        message="رسالة التلفل المخصصة (استخدم المتغيرات: {user}, {level}, {next-level}, {xp})"
    )
    @app_commands.rename(channel="الروم", message="الرسالة")
    @app_commands.checks.has_permissions(administrator=True)
    async def set_level_channel(self, interaction: discord.Interaction, channel: discord.TextChannel, message: str = None):
        guild_id = interaction.guild.id
        self.update_settings(guild_id, channel_id=channel.id, message=message)
        
        embed = discord.Embed(
            title="✨ إعدادات نظام المستويات",
            description=f"**روم المستويات:** {channel.mention}\n**الرسالة:**\n```{message or 'افتراضية'}```",
            color=discord.Color.green()
        )
        await interaction.response.send_message(embed=embed, ephemeral=True)

    # --- أمر عرض الرتبة (Rank) ---
    @app_commands.command(name="المستوى", description="عرض مستواك الحالي وعدد نقاط الخبرة")
    @app_commands.describe(member="العضو المراد عرض مستواه (اختياري)")
    @app_commands.rename(member="العضو")
    async def rank(self, interaction: discord.Interaction, member: discord.Member = None):
        target = member or interaction.user
        self.cursor.execute("SELECT xp, level FROM user_levels WHERE guild_id = ? AND user_id = ?", (interaction.guild.id, target.id))
        row = self.cursor.fetchone()

        xp = row["xp"] if row else 0
        level = row["level"] if row else 0
        next_level_xp = (level + 1) * 250 # معادلة حساب XP المستوى القادم

        embed = discord.Embed(
            title=f"📊 بطاقة المستوى لـ {target.name}",
            description=f"**المستوى:** `{level}`\n**النقاط الحالية:** `{xp} / {next_level_xp} خبرة`",
            color=discord.Color.blue()
        )
        if target.display_avatar:
            embed.set_thumbnail(url=target.display_avatar.url)
        await interaction.response.send_message(embed=embed)

    # --- نظام احتساب النقاط وتتبع الرسائل ---
    @commands.Cog.listener()
    async def on_message(self, message: discord.Message):
        if not message.guild or message.author.bot:
            return

        guild_id = message.guild.id
        user_id = message.author.id

        # إضافة نقاط عشوائية مع كل رسالة (من 15 إلى 25 نقطة)
        earned_xp = random.randint(15, 25)

        self.cursor.execute("SELECT xp, level FROM user_levels WHERE guild_id = ? AND user_id = ?", (guild_id, user_id))
        row = self.cursor.fetchone()

        if not row:
            self.cursor.execute("INSERT INTO user_levels (guild_id, user_id, xp, level) VALUES (?, ?, ?, ?)", (guild_id, user_id, earned_xp, 0))
            current_xp = earned_xp
            current_level = 0
        else:
            current_xp = row["xp"] + earned_xp
            current_level = row["level"]

        # معادلة الصعود للمستوى التالي
        next_level_xp = (current_level + 1) * 250

        if current_xp >= next_level_xp:
            current_level += 1
            self.cursor.execute("UPDATE user_levels SET xp = ?, level = ? WHERE guild_id = ? AND user_id = ?", (current_xp, current_level, guild_id, user_id))
            self.db.commit()

            # جلب إعدادات روم المستويات وإرسال التهنئة
            settings = self.get_settings(guild_id)
            if settings and settings["channel_id"]:
                channel = message.guild.get_channel(settings["channel_id"])
                if channel:
                    msg_template = settings["custom_message"] or "مبروك {user}، لقد صعدت إلى المستوى {level}!"
                    formatted_msg = (msg_template
                        .replace("{user}", message.author.mention)
                        .replace("{level}", str(current_level))
                        .replace("{next-level}", str(current_level + 1))
                        .replace("{xp}", str(current_xp)))
                    try:
                        await channel.send(formatted_msg)
                    except Exception:
                        pass
        else:
            self.cursor.execute("UPDATE user_levels SET xp = ? WHERE guild_id = ? AND user_id = ?", (current_xp, guild_id, user_id))
            self.db.commit()

async def setup(bot):
    await bot.add_cog(LevelsCog(bot))
