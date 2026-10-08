from datetime import datetime, timezone, timedelta
import asyncio
import sqlite3
import discord
from discord import app_commands
from discord.ext import commands

class ProtectionSettingsView(discord.ui.View):
    def __init__(self, cog, guild_id: int):
        super().__init__(timeout=180)
        self.cog = cog
        self.guild_id = guild_id
        self.update_components()

    def update_components(self):
        self.clear_items()
        
        options = [
            discord.SelectOption(label="🤖 حماية دخول البوتات", value="bot_add", description="يطرد أي بوت يضاف ويعاقب اللي أضافه"),
            discord.SelectOption(label="👑 حماية إعطاء رتبة أدمـن", value="admin_role", description="منع إعطاء رتب خطيرة/أدمن"),
            discord.SelectOption(label="🔨 حماية التبنيد السريع", value="mass_ban", description="منع التخريب بالباند المتسارع"),
            discord.SelectOption(label="👢 حماية الطرد السريع", value="mass_kick", description="منع الطرد العشوائي السريع"),
            discord.SelectOption(label="📁 حماية حذف الرومات", value="channel_delete", description="يعاقب من يحذف روم"),
            discord.SelectOption(label="🗑️ حماية حذف الرتب", value="role_delete", description="يعاقب من يحذف رتبة"),
            discord.SelectOption(label="🆕 حماية إنشاء الرتب", value="role_create", description="منع سبام إنشاء الرتب"),
            discord.SelectOption(label="📂 حماية إنشاء الرومات", value="channel_create", description="منع سبام إنشاء الرومات"),
            discord.SelectOption(label="🔗 حماية الروابط", value="links", description="يحذف أي رسالة فيها رابط أو دعوة ويقمع صاحبها"),
        ]
        
        select = discord.ui.Select(placeholder="اختر نظام الحماية لتغيير حالته (تفعيل / تعطيل)...", options=options, row=0)
        select.callback = self.select_callback
        self.add_item(select)

        punish_button = discord.ui.Button(label="⚙️ تحديد العقوبات", style=discord.ButtonStyle.secondary, row=1)
        punish_button.callback = self.punish_callback
        self.add_item(punish_button)

    async def select_callback(self, interaction: discord.Interaction):
        feature = interaction.data["values"][0]
        current_status = self.cog.get_setting(self.guild_id, feature)
        new_status = 0 if current_status == 1 else 1
        
        self.cog.update_setting(self.guild_id, feature, new_status)
        status_text = "🟢 مفعل (TRUE)" if new_status == 1 else "🔴 معطل (FALSE)"
        
        await interaction.response.send_message(f"✅ تم تحديث حماية (`{feature}`) وأصبحت الآن: **{status_text}**", ephemeral=True)

    async def punish_callback(self, interaction: discord.Interaction):
        await interaction.response.send_message("اختر النظام لتحديد عقوبته عبر الأمر: `/set-punishment`", ephemeral=True)


class SecurityCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.DB_FILE = "security_settings.db"
        self.db = sqlite3.connect(self.DB_FILE)
        self.db.row_factory = sqlite3.Row
        self.cursor = self.db.cursor()

        self.cursor.execute("""
        CREATE TABLE IF NOT EXISTS server_security (
            guild_id INTEGER,
            feature TEXT,
            status INTEGER DEFAULT 0,
            PRIMARY KEY (guild_id, feature)
        )
        """)

        self.cursor.execute("""
        CREATE TABLE IF NOT EXISTS security_punishments (
            guild_id INTEGER,
            feature TEXT,
            punishment TEXT DEFAULT 'timeout',
            PRIMARY KEY (guild_id, feature)
        )
        """)
        self.db.commit()

    def cog_unload(self):
        self.db.close()

    def get_setting(self, guild_id: int, feature: str) -> int:
        self.cursor.execute("SELECT status FROM server_security WHERE guild_id = ? AND feature = ?", (guild_id, feature))
        row = self.cursor.fetchone()
        return row["status"] if row else 0

    def update_setting(self, guild_id: int, feature: str, status: int):
        self.cursor.execute("""
        INSERT INTO server_security (guild_id, feature, status) VALUES (?, ?, ?)
        ON CONFLICT(guild_id, feature) DO UPDATE SET status = excluded.status
        """, (guild_id, feature, status))
        self.db.commit()

    def get_punishment(self, guild_id: int, feature: str) -> str:
        self.cursor.execute("SELECT punishment FROM security_punishments WHERE guild_id = ? AND feature = ?", (guild_id, feature))
        row = self.cursor.fetchone()
        return row["punishment"] if row else "timeout"

    def update_punishment(self, guild_id: int, feature: str, punishment: str):
        self.cursor.execute("""
        INSERT INTO security_punishments (guild_id, feature, punishment) VALUES (?, ?, ?)
        ON CONFLICT(guild_id, feature) DO UPDATE SET punishment = excluded.punishment
        """, (guild_id, feature, punishment))
        self.db.commit()

    async def execute_punishment(self, guild: discord.Guild, member: discord.Member, feature: str, reason: str):
        if not member or member.bot or member.id == guild.owner_id:
            return

        bot_member = guild.me
        
        # معاقبة الرتب اللي تحت البوت فقط
        if bot_member.top_role <= member.top_role:
            return

        punishment = self.get_punishment(guild.id, feature)
        
        try:
            if punishment == "ban":
                await guild.ban(member, reason=f"نظام الحماية: {reason}")
            elif punishment == "kick":
                await guild.kick(member, reason=f"نظام الحماية: {reason}")
            elif punishment == "timeout":
                await member.timeout(timedelta(minutes=15), reason=f"نظام الحماية: {reason}")
            elif punishment == "strip_roles":
                roles_to_remove = [r for r in member.roles if not r.managed and r != guild.default_role]
                if roles_to_remove:
                    await member.remove_roles(*roles_to_remove, reason=f"نظام الحماية: {reason}")
        except Exception as e:
            print(f"Error executing punishment: {e}")

    @app_commands.command(name="security-panel", description="لوحة تحكم إعدادات الحماية في السيرفر")
    @app_commands.checks.has_permissions(administrator=True)
    async def security_panel(self, interaction: discord.Interaction):
        view = ProtectionSettingsView(self, interaction.guild.id)
        embed = discord.Embed(
            title="🛡 لوحة إعدادات ونظام الحماية",
            description="من خلال القائمة أدناه يمكنك تفعيل أو تعطيل أنظمة الحماية وتحديد العقوبات.",
            color=discord.Color.dark_embed()
        )
        await interaction.response.send_message(embed=embed, view=view, ephemeral=True)

    @app_commands.command(name="set-punishment", description="تحديد العقوبة لأي نظام حماية")
    @app_commands.describe(feature="اختر نظام الحماية", punishment="اختر العقوبة")
    @app_commands.choices(feature=[
        app_commands.Choice(name="🤖 دخول البوتات", value="bot_add"),
        app_commands.Choice(name="👑 إعطاء رتبة أدمـن", value="admin_role"),
        app_commands.Choice(name="🔨 التبنيد السريع", value="mass_ban"),
        app_commands.Choice(name="👢 الطرد السريع", value="mass_kick"),
        app_commands.Choice(name="📁 حذف الرومات", value="channel_delete"),
        app_commands.Choice(name="🗑️ حذف الرتب", value="role_delete"),
        app_commands.Choice(name="🆕 إنشاء الرتب", value="role_create"),
        app_commands.Choice(name="📂 إنشاء الرومات", value="channel_create"),
        app_commands.Choice(name="🔗 الروابط", value="links")
    ])
    @app_commands.choices(punishment=[
        app_commands.Choice(name="🔨 باند (Ban)", value="ban"),
        app_commands.Choice(name="👢 طرد (Kick)", value="kick"),
        app_commands.Choice(name="⏳ تايم أوت (Timeout)", value="timeout"),
        app_commands.Choice(name="🏷️ سحب كافة الرتب", value="strip_roles")
    ])
    @app_commands.checks.has_permissions(administrator=True)
    async def set_punishment(self, interaction: discord.Interaction, feature: str, punishment: str):
        self.update_punishment(interaction.guild.id, feature, punishment)
        await interaction.response.send_message(f"✅ تم تحديث عقوبة النظام (`{feature}`) لتصبح: **{punishment}**", ephemeral=True)

    # --- الأحداث ---

    @commands.Cog.listener()
    async def on_member_join(self, member: discord.Member):
        if member.bot and self.get_setting(member.guild.id, "bot_add") == 1:
            await asyncio.sleep(1.5) # انتظار تسجيل الحدث في الـ Audit Log
            try:
                async for entry in member.guild.audit_logs(limit=5, action=discord.AuditLogAction.bot_add):
                    if entry.target and entry.target.id == member.id:
                        adder = member.guild.get_member(entry.user.id) if entry.user else None
                        
                        # إذا كنت أنت الأونر أو الشخص الذي أضاف البوت هو الأونر، لا تطرده أبداً
                        if adder and adder.id == member.guild.owner_id:
                            return
                        
                        # إذا أضافه شخص آخر (عضو أو إداري)، قم بمعاقبة الشخص الذي أضافه فقط ولا تطرد البوت
                        if adder:
                            await self.execute_punishment(member.guild, adder, "bot_add", "أضاف بوت غير مصرح به")
                        break
            except Exception as e:
                print(f"Error in bot_add check: {e}")

    @commands.Cog.listener()
    async def on_member_update(self, before: discord.Member, after: discord.Member):
        if self.get_setting(after.guild.id, "admin_role") == 1:
            if not before.guild_permissions.administrator and after.guild_permissions.administrator:
                await asyncio.sleep(1)
                try:
                    async for entry in after.guild.audit_logs(limit=3, action=discord.AuditLogAction.member_role_update):
                        if entry.target and entry.target.id == after.id:
                            mod = after.guild.get_member(entry.user.id)
                            if mod:
                                await self.execute_punishment(after.guild, mod, "admin_role", "أعطى صلاحيات أدمن لشخص آخر")
                            break
                except Exception:
                    pass

    @commands.Cog.listener()
    async def on_audit_log_entry_create(self, entry: discord.AuditLogEntry):
        guild = entry.guild
        if not guild:
            return

        mod = guild.get_member(entry.user.id) if entry.user else None
        if not mod:
            return

        if entry.action == discord.AuditLogAction.ban and self.get_setting(guild.id, "mass_ban") == 1:
            await self.execute_punishment(guild, mod, "mass_ban", "قام بتبنيد أعضاء")

        elif entry.action == discord.AuditLogAction.kick and self.get_setting(guild.id, "mass_kick") == 1:
            await self.execute_punishment(guild, mod, "mass_kick", "قام بطرد أعضاء")

        elif entry.action == discord.AuditLogAction.channel_create and self.get_setting(guild.id, "channel_create") == 1:
            await self.execute_punishment(guild, mod, "channel_create", "قام بإنشاء روم")

        elif entry.action == discord.AuditLogAction.role_create and self.get_setting(guild.id, "role_create") == 1:
            await self.execute_punishment(guild, mod, "role_create", "قام بإنشاء رتبة")

    @commands.Cog.listener()
    async def on_guild_channel_delete(self, channel: discord.abc.GuildChannel):
        if self.get_setting(channel.guild.id, "channel_delete") == 1:
            await asyncio.sleep(1)
            try:
                async for entry in channel.guild.audit_logs(limit=3, action=discord.AuditLogAction.channel_delete):
                    if entry.target and entry.target.id == channel.id:
                        mod = channel.guild.get_member(entry.user.id)
                        if mod:
                            await self.execute_punishment(channel.guild, mod, "channel_delete", "حذف روم")
                        break
            except Exception:
                pass

    @commands.Cog.listener()
    async def on_guild_role_delete(self, role: discord.Role):
        if self.get_setting(role.guild.id, "role_delete") == 1:
            await asyncio.sleep(1)
            try:
                async for entry in role.guild.audit_logs(limit=3, action=discord.AuditLogAction.role_delete):
                    if entry.target and entry.target.id == role.id:
                        mod = role.guild.get_member(entry.user.id)
                        if mod:
                            await self.execute_punishment(role.guild, mod, "role_delete", "حذف رتبة")
                        break
            except Exception:
                pass

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message):
        if not message.guild or message.author.bot:
            return
        
        if self.get_setting(message.guild.id, "links") == 1:
            if "http://" in message.content or "https://" in message.content or "discord.gg/" in message.content:
                try:
                    await message.delete()
                    await self.execute_punishment(message.guild, message.author, "links", "نشر روابط أو دعوات")
                except Exception:
                    pass

async def setup(bot):
    await bot.add_cog(SecurityCog(bot))
