from datetime import timedelta
import sqlite3
import discord
from discord import app_commands
from discord.ext import commands

class BadWordsCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.DB_FILE = "badwords_settings.db"
        self.db = sqlite3.connect(self.DB_FILE)
        self.db.row_factory = sqlite3.Row
        self.cursor = self.db.cursor()

        # جدول الكلمات المحظورة لكل سيرفر
        self.cursor.execute("""
        CREATE TABLE IF NOT EXISTS bad_words (
            guild_id INTEGER,
            word TEXT,
            PRIMARY KEY (guild_id, word)
        )
        """)

        # جدول عقوبة الكلمات المحظورة لكل سيرفر
        self.cursor.execute("""
        CREATE TABLE IF NOT EXISTS bad_words_punishment (
            guild_id INTEGER PRIMARY KEY,
            punishment TEXT DEFAULT 'timeout'
        )
        """)
        self.db.commit()

    def cog_unload(self):
        self.db.close()

    def get_punishment(self, guild_id: int) -> str:
        self.cursor.execute("SELECT punishment FROM bad_words_punishment WHERE guild_id = ?", (guild_id,))
        row = self.cursor.fetchone()
        return row["punishment"] if row else "timeout"

    def set_punishment(self, guild_id: int, punishment: str):
        self.cursor.execute("""
        INSERT INTO bad_words_punishment (guild_id, punishment) VALUES (?, ?)
        ON CONFLICT(guild_id) DO UPDATE SET punishment = excluded.punishment
        """, (guild_id, punishment))
        self.db.commit()

    def get_words(self, guild_id: int) -> list:
        self.cursor.execute("SELECT word FROM bad_words WHERE guild_id = ?", (guild_id,))
        return [row["word"] for row in self.cursor.fetchall()]

    async def execute_punishment(self, message: discord.Message, reason: str):
        guild = message.guild
        member = message.author
        
        if not member or member.bot or member.id == guild.owner_id:
            return

        bot_member = guild.me
        if bot_member.top_role <= member.top_role:
            print(f"[تحذير] البوت لا يمتلك رتبة أعلى من العضو {member.name} لتنفيذ العقوبة عليه!")
            return

        punishment = self.get_punishment(guild.id)
        
        try:
            if punishment == "ban":
                await guild.ban(member, reason=f"حماية الكلمات المحظورة: {reason}")
            elif punishment == "kick":
                await guild.kick(member, reason=f"حماية الكلمات المحظورة: {reason}")
            elif punishment == "timeout":
                await member.timeout(timedelta(minutes=15), reason=f"حماية الكلمات المحظورة: {reason}")
            elif punishment == "strip_roles":
                roles_to_remove = [r for r in member.roles if not r.managed and r != guild.default_role]
                if roles_to_remove:
                    await member.remove_roles(*roles_to_remove, reason=f"حماية الكلمات المحظورة: {reason}")
            print(f"[نجاح] تم تنفيذ العقوبة ({punishment}) على العضو {member.name}")
        except Exception as e:
            print(f"[خطأ فادح أثناء تنفيذ العقوبة]: {e}")

    # --- الأوامر ---

    @app_commands.command(name="اضافة-كلمة", description="إضافة كلمة جديدة إلى قائمة الكلمات المحظورة")
    @app_commands.describe(word="الكلمة المراد حظرها")
    @app_commands.rename(word="الكلمة")
    @app_commands.checks.has_permissions(administrator=True)
    async def add_word(self, interaction: discord.Interaction, word: str):
        word_clean = word.strip().lower()
        try:
            self.cursor.execute("INSERT INTO bad_words (guild_id, word) VALUES (?, ?)", (interaction.guild.id, word_clean))
            self.db.commit()
            await interaction.response.send_message(f"✅ تمت إضافة الكلمة (`{word_clean}`) إلى قائمة الحظر بنجاح.", ephemeral=True)
        except sqlite3.IntegrityError:
            await interaction.response.send_message(f"⚠️️ الكلمة (`{word_clean}`) موجودة مسبقاً في القائمة.", ephemeral=True)

    @app_commands.command(name="حذف-كلمة", description="إزالة كلمة من قائمة الكلمات المحظورة")
    @app_commands.describe(word="الكلمة المراد إزالتها")
    @app_commands.rename(word="الكلمة")
    @app_commands.checks.has_permissions(administrator=True)
    async def remove_word(self, interaction: discord.Interaction, word: str):
        word_clean = word.strip().lower()
        self.cursor.execute("DELETE FROM bad_words WHERE guild_id = ? AND word = ?", (interaction.guild.id, word_clean))
        self.db.commit()
        await interaction.response.send_message(f"🗑️ تمت إزالة الكلمة (`{word_clean}`) من القائمة.", ephemeral=True)

    @app_commands.command(name="الكلمات-المحظورة", description="عرض جميع الكلمات المحظورة في السيرفر")
    @app_commands.checks.has_permissions(administrator=True)
    async def list_words(self, interaction: discord.Interaction):
        words = self.get_words(interaction.guild.id)
        if not words:
            await interaction.response.send_message("📂 لا توجد أي كلمات محظورة مضافة حالياً في هذا السيرفر.", ephemeral=True)
            return
        
        words_list = ", ".join([f"`{w}`" for w in words])
        embed = discord.Embed(
            title="🚫 قائمة الكلمات المحظورة",
            description=words_list,
            color=discord.Color.red()
        )
        await interaction.response.send_message(embed=embed, ephemeral=True)

    @app_commands.command(name="عقوبة-الكلمات", description="تحديد العقوبة عند كتابة كلمة محظورة")
    @app_commands.describe(punishment="اختر العقوبة التي ستطبق على المخالف")
    @app_commands.rename(punishment="العقوبة")
    @app_commands.choices(punishment=[
        app_commands.Choice(name="🔨 باند", value="ban"),
        app_commands.Choice(name="👢 طرد", value="kick"),
        app_commands.Choice(name="⏳ تايم أوت", value="timeout"),
        app_commands.Choice(name="🏷️ سحب كافة الرتب", value="strip_roles")
    ])
    @app_commands.checks.has_permissions(administrator=True)
    async def set_word_punishment(self, interaction: discord.Interaction, punishment: str):
        self.set_punishment(interaction.guild.id, punishment)
        labels = {"ban": "باند", "kick": "طرد", "timeout": "تايم أوت", "strip_roles": "سحب كافة الرتب"}
        await interaction.response.send_message(f"✅ تم تحديث عقوبة الكلمات المحظورة لتصبح: **{labels.get(punishment, punishment)}**", ephemeral=True)

    # --- الحدث لمراقبة الرسائل وحذفها مع العقوبة ---

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message):
        if not message.guild or message.author.bot:
            return
        
        guild_id = message.guild.id
        banned_words = self.get_words(guild_id)
        if not banned_words:
            return

        content_lower = message.content.lower()
        for word in banned_words:
            if word in content_lower:
                try:
                    await message.delete()
                    await self.execute_punishment(message, f"كتب كلمة محظورة: {word}")
                except Exception as e:
                    print(f"[خطأ في حذف الرسالة]: {e}")
                break

async def setup(bot):
    await bot.add_cog(BadWordsCog(bot))
