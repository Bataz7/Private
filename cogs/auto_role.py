import discord
from discord import app_commands
from discord.ext import commands
import sqlite3

class AutoRoleCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.DB_FILE = "autorole.db"
        self.db = sqlite3.connect(self.DB_FILE)
        self.cursor = self.db.cursor()

        self.cursor.execute("""
        CREATE TABLE IF NOT EXISTS auto_roles (
            guild_id INTEGER PRIMARY KEY,
            role_id INTEGER
        )
        """)
        self.db.commit()

    def cog_unload(self):
        self.db.close()

    @commands.Cog.listener()
    async def on_member_join(self, member: discord.Member):
        self.cursor.execute("SELECT role_id FROM auto_roles WHERE guild_id = ?", (member.guild.id,))
        row = self.cursor.fetchone()
        
        if row:
            role_id = row[0]
            role = member.guild.get_role(role_id)
            if role:
                try:
                    await member.add_roles(role, reason="التسجيل التلقائي للرتبة عند الانضمام")
                except Exception:
                    pass

    @app_commands.command(name="autorole-set", description="تحديد الرتبة التلقائية التي تُعطى للأعضاء عند انضمامهم")
    @app_commands.describe(role="اختر الرتبة التلقائية")
    @app_commands.checks.has_permissions(administrator=True)
    async def autorole_set(self, interaction: discord.Interaction, role: discord.Role):
        guild_id = interaction.guild.id

        # التحقق من صلاحيات البوت لإعطاء هذه الرتبة
        if role.position >= interaction.guild.me.top_role.position:
            return await interaction.response.send_message("❌ لا يمكنني اختيار هذه الرتبة لأنها أعلى من رتبتي أو تساويها!", ephemeral=True)

        self.cursor.execute("""
        INSERT INTO auto_roles (guild_id, role_id)
        VALUES (?, ?)
        ON CONFLICT(guild_id) DO UPDATE SET role_id = excluded.role_id
        """, (guild_id, role.id))
        self.db.commit()

        await interaction.response.send_message(f"✅ تم تحديد رتبة التلقائية بنجاح: **{role.name}**", ephemeral=True)

    @app_commands.command(name="autorole-remove", description="إيقاف وإزالة الرتبة التلقائية للانضمام")
    @app_commands.checks.has_permissions(administrator=True)
    async def autorole_remove(self, interaction: discord.Interaction):
        guild_id = interaction.guild.id
        self.cursor.execute("DELETE FROM auto_roles WHERE guild_id = ?", (guild_id,))
        self.db.commit()
        
        await interaction.response.send_message("🗑️️ تم تعطيل وإزالة نظام الرتبة التلقائية بنجاح.", ephemeral=True)

async def setup(bot):
    await bot.add_cog(AutoRoleCog(bot))
