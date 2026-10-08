from datetime import datetime, timezone
import sqlite3
import discord
from discord import app_commands
from discord.ext import commands

# =========================================================
# نافذة إضافة أو إزالة النقاط (Modal)
# =========================================================
class ModifyPointsModal(discord.ui.Modal):
    def __init__(self, cog, action_type: str):
        super().__init__(title="➕ إضافة نقاط" if action_type == "add" else "➖ إزالة نقاط")
        self.cog = cog
        self.action_type = action_type

        self.member_id = discord.ui.TextInput(
            label="آيدي العضو (User ID)",
            placeholder="مثال: 123456789012345678",
            required=True,
            max_length=20
        )
        self.points = discord.ui.TextInput(
            label="عدد النقاط",
            placeholder="اكتب الرقم هنا...",
            required=True,
            max_length=5
        )
        self.reason = discord.ui.TextInput(
            label="السبب",
            style=discord.TextStyle.paragraph,
            placeholder="اكتب سبب الإضافة أو الخصم...",
            required=True,
            max_length=300
        )

        self.add_item(self.member_id)
        self.add_item(self.points)
        self.add_item(self.reason)

    async def on_submit(self, interaction: discord.Interaction):
        try:
            target_id = int(self.member_id.value)
            pts = int(self.points.value)
        except ValueError:
            return await interaction.response.send_message("❌ الآيدي أو عدد النقاط يجب أن يكون أرقاماً صحيحة!", ephemeral=True)

        if pts <= 0:
            return await interaction.response.send_message("❌ عدد النقاط يجب أن يكون رقماً أكبر من صفر!", ephemeral=True)

        target_member = interaction.guild.get_member(target_id)
        if not target_member:
            return await interaction.response.send_message("❌ لم يتم العثور على العضو في هذا السيرفر!", ephemeral=True)

        current_pts = self.cog.get_user_points(interaction.guild.id, target_id)
        new_pts = current_pts + pts if self.action_type == "add" else current_pts - pts
        if new_pts < 0:
            new_pts = 0

        self.cog.update_user_points(interaction.guild.id, target_id, new_pts)

        await interaction.response.defer(ephemeral=True)

        # إرسال إشعار بالخاص (DM) للعضو
        try:
            action_name = "إضافة نقاط إليه" if self.action_type == "add" else "خصم نقاط منه"
            embed_dm = discord.Embed(
                title="🔔 تنبيه - نظام النقاط العسكرية",
                description=f"تم **{action_name}** في سيرفر **{interaction.guild.name}**.",
                color=discord.Color.green() if self.action_type == "add" else discord.Color.red(),
                timestamp=datetime.now(timezone.utc)
            )
            embed_dm.add_field(name="النقاط المُعاملة", value=str(pts), inline=True)
            embed_dm.add_field(name="الرصيد الجديد", value=str(new_pts), inline=True)
            embed_dm.add_field(name="السبب", value=self.reason.value, inline=False)
            embed_dm.set_footer(text=f"بواسطة المسؤول: {interaction.user.name}")
            if interaction.guild.icon:
                embed_dm.set_thumbnail(url=interaction.guild.icon.url)
            await target_member.send(embed=embed_dm)
        except Exception:
            pass

        await interaction.followup.send(
            f"✅ تم {'إضافة' if self.action_type == 'add' else 'خصم'} **{pts}** نقطة لـ {target_member.mention} بنجاح!\n"
            f"📊 رصيده الحالي: `{new_pts}` نقطة.",
            ephemeral=True
        )

# =========================================================
# قائمة اختيار العساكر (مخفية بالكامل للمستخدم)
# =========================================================
class MilitarySelect(discord.ui.Select):
    def __init__(self, cog, guild: discord.Guild):
        self.cog = cog
        settings = cog.get_settings(guild.id)
        role_id = settings["military_role_id"] if settings else None

        options = []
        if role_id:
            role = guild.get_role(role_id)
            if role:
                for member in role.members[:25]:
                    options.append(discord.SelectOption(label=member.display_name, value=str(member.id), description=f"ID: {member.id}"))

        if not options:
            options.append(discord.SelectOption(label="لا يوجد أعضاء بهذه الرتبة حالياً", value="none"))

        super().__init__(placeholder="🔍 اختر العسكري المطلوب لعرض نقاطه...", min_values=1, max_values=1, options=options)

    async def callback(self, interaction: discord.Interaction):
        if self.values[0] == "none":
            return await interaction.response.send_message("❌ لا توجد رتبة عسكرية محددة أو لا يوجد أعضاء.", ephemeral=True)
        
        target_id = int(self.values[0])
        target_member = interaction.guild.get_member(target_id)
        pts = self.cog.get_user_points(interaction.guild.id, target_id)

        embed = discord.Embed(
            title="🎖️ سجل نقاط العسكري",
            description=f"العضو: {target_member.mention if target_member else 'غير معروف'}\n📊 النقاط الحالية: **{pts}** نقطة",
            color=discord.Color.blue(),
            timestamp=datetime.now(timezone.utc)
        )
        if interaction.guild.icon:
            embed.set_thumbnail(url=interaction.guild.icon.url)
            
        await interaction.response.send_message(embed=embed, ephemeral=True)

class MilitarySelectView(discord.ui.View):
    def __init__(self, cog, guild):
        super().__init__(timeout=60)
        self.add_item(MilitarySelect(cog, guild))

# =========================================================
# القائمة المنسدلة لبانل التحكم (الإداري)
# =========================================================
class AdminControlSelect(discord.ui.Select):
    def __init__(self, cog):
        self.cog = cog
        options = [
            discord.SelectOption(label="إضافة نقاط", description="إضافة نقاط لعسكري عبر الآيدي والسبب", emoji="➕", value="add_pts"),
            discord.SelectOption(label="إزالة نقاط", description="خصم نقاط من عسكري عبر الآيدي والسبب", emoji="➖", value="remove_pts"),
            discord.SelectOption(label="تصفير النقاط", description="تصفير جميع نقاط السيرفر بالكامل", emoji="🔄", value="reset_pts")
        ]
        super().__init__(placeholder="⚙️ اختر عملية التحكم الإداري من هنا...", min_values=1, max_values=1, options=options, custom_id="police:admin_control_select")

    def check_manager(self, interaction: discord.Interaction):
        settings = self.cog.get_settings(interaction.guild.id)
        if not settings or not settings["manager_role_id"]:
            return interaction.user.guild_permissions.administrator
        
        role = interaction.guild.get_role(settings["manager_role_id"])
        return (role in interaction.user.roles) or interaction.user.guild_permissions.administrator

    async def callback(self, interaction: discord.Interaction):
        if not self.check_manager(interaction):
            return await interaction.response.send_message("❌ ليس لديك صلاحية مسؤول النقاط للتحكم!", ephemeral=True)

        choice = self.values[0]

        if choice == "add_pts":
            await interaction.response.send_modal(ModifyPointsModal(self.cog, "add"))
        elif choice == "remove_pts":
            await interaction.response.send_modal(ModifyPointsModal(self.cog, "remove"))
        elif choice == "reset_pts":
            if not interaction.user.guild_permissions.administrator:
                return await interaction.response.send_message("❌ تصفير النقاط مخصص للمشرفين العامين فقط.", ephemeral=True)
            
            self.cog.cursor.execute("DELETE FROM user_points WHERE guild_id = ?", (interaction.guild.id,))
            self.cog.db.commit()
            await interaction.response.send_message("🔄 تم تصفير جميع نقاط السيرفر بنجاح!", ephemeral=True)

class PoliceAdminPanelView(discord.ui.View):
    def __init__(self, cog):
        super().__init__(timeout=None)
        self.add_item(AdminControlSelect(cog))

# =========================================================
# القائمة المنسدلة للخدمات العامة
# =========================================================
class PublicServicesSelect(discord.ui.Select):
    def __init__(self, cog):
        self.cog = cog
        options = [
            discord.SelectOption(label="كشف نقاطي", description="استعلم عن رصيدك الحالي من النقاط", emoji="👤", value="my_points"),
            discord.SelectOption(label="كشف نقاط عسكري", description="اختر عسكرياً من القائمة للاستعلام عن نقاطه", emoji="🔍", value="check_military"),
            discord.SelectOption(label="توب 10 نقاط", description="عرض قائمة أكثر 10 عساكر حصولاً على النقاط", emoji="🏆", value="top_10")
        ]
        super().__init__(placeholder="📂 اختر الخدمة المطلوبة من هنا...", min_values=1, max_values=1, options=options, custom_id="police:public_services_select")

    async def callback(self, interaction: discord.Interaction):
        choice = self.values[0]

        if choice == "my_points":
            pts = self.cog.get_user_points(interaction.guild.id, interaction.user.id)
            await interaction.response.send_message(f"👤 {interaction.user.mention} نقاطك الحالية هي: **{pts}** نقطة.", ephemeral=True)

        elif choice == "check_military":
            await interaction.response.send_message("🔽 اختر العسكري من القائمة أدناه لعرض نقاطه:", view=MilitarySelectView(self.cog, interaction.guild), ephemeral=True)

        elif choice == "top_10":
            top_users = self.cog.get_top_10(interaction.guild.id)
            desc = ""
            for idx, row in enumerate(top_users, 1):
                member = interaction.guild.get_member(row["user_id"])
                name = member.mention if member else f"مستخدم مغادر ({row['user_id']})"
                desc += f"**{idx}.** {name} ⟵ **{row['points']}** نقطة\n"

            if not desc:
                desc = "لا توجد أي نقاط مسجلة حتى الآن."

            embed = discord.Embed(
                title="🏆 قائمة أفضل 10 عساكر",
                description=desc,
                color=discord.Color.gold(),
                timestamp=datetime.now(timezone.utc)
            )
            if interaction.guild.icon:
                embed.set_thumbnail(url=interaction.guild.icon.url)
                
            await interaction.response.send_message(embed=embed, ephemeral=True)

class PolicePublicPanelView(discord.ui.View):
    def __init__(self, cog):
        super().__init__(timeout=None)
        self.add_item(PublicServicesSelect(cog))

# =========================================================
# الـ Cog الأساسي
# =========================================================
class PointPolice(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        
        self.DB_FILE = "police_points.db"
        self.db = sqlite3.connect(self.DB_FILE)
        self.db.row_factory = sqlite3.Row
        self.cursor = self.db.cursor()

        self.cursor.execute("""
        CREATE TABLE IF NOT EXISTS police_settings (
            guild_id INTEGER PRIMARY KEY,
            manager_role_id INTEGER,
            military_role_id INTEGER,
            panel_channel_id INTEGER
        )
        """)

        # ترقية قاعدة البيانات القديمة بدون حذف الإعدادات الموجودة
        try:
            self.cursor.execute("ALTER TABLE police_settings ADD COLUMN panel_channel_id INTEGER")
            self.db.commit()
        except sqlite3.OperationalError:
            pass

        self.cursor.execute("""
        CREATE TABLE IF NOT EXISTS user_points (
            guild_id INTEGER,
            user_id INTEGER,
            points INTEGER,
            PRIMARY KEY (guild_id, user_id)
        )
        """)
        self.db.commit()

        self.bot.add_view(PoliceAdminPanelView(self))
        self.bot.add_view(PolicePublicPanelView(self))

    def cog_unload(self):
        self.db.close()

    def get_settings(self, guild_id):
        return self.cursor.execute("SELECT * FROM police_settings WHERE guild_id = ?", (guild_id,)).fetchone()

    def update_setting(self, guild_id, column, value):
        self.cursor.execute(f"""
        INSERT INTO police_settings (guild_id, {column}) VALUES (?, ?)
        ON CONFLICT(guild_id) DO UPDATE SET {column} = excluded.{column}
        """, (guild_id, value))
        self.db.commit()

    def get_dashboard_settings(self, guild_id):
        row = self.get_settings(guild_id)
        if not row:
            return {"manager_role_id": None, "military_role_id": None, "panel_channel_id": None}
        return {
            "manager_role_id": row["manager_role_id"],
            "military_role_id": row["military_role_id"],
            "panel_channel_id": row["panel_channel_id"],
        }

    def save_dashboard_settings(self, guild_id, data):
        values = {}
        for key in ("manager_role_id", "military_role_id", "panel_channel_id"):
            raw = data.get(key)
            if raw is None or str(raw).strip() == "":
                raise ValueError("حدد رتبة المسؤول ورتبة وزارة الداخلية وروم إرسال البانل")
            try:
                values[key] = int(raw)
            except (TypeError, ValueError):
                raise ValueError("قيمة إعدادات النقاط العسكرية غير صالحة")

        guild = self.bot.get_guild(int(guild_id))
        if not guild:
            raise ValueError("السيرفر غير موجود")
        if not guild.get_role(values["manager_role_id"]):
            raise ValueError("رتبة المسؤول غير موجودة")
        if not guild.get_role(values["military_role_id"]):
            raise ValueError("رتبة وزارة الداخلية غير موجودة")
        channel = guild.get_channel(values["panel_channel_id"])
        if not channel or not isinstance(channel, discord.TextChannel):
            raise ValueError("روم إرسال البانل غير صالح")

        self.cursor.execute(
            "INSERT INTO police_settings (guild_id, manager_role_id, military_role_id, panel_channel_id) "
            "VALUES (?, ?, ?, ?) ON CONFLICT(guild_id) DO UPDATE SET "
            "manager_role_id=excluded.manager_role_id, military_role_id=excluded.military_role_id, "
            "panel_channel_id=excluded.panel_channel_id",
            (guild_id, values["manager_role_id"], values["military_role_id"], values["panel_channel_id"])
        )
        self.db.commit()

    def build_dashboard_panel(self, guild):
        settings = self.get_dashboard_settings(guild.id)
        if not settings["manager_role_id"] or not settings["military_role_id"]:
            raise ValueError("حدد رتبة المسؤول ورتبة وزارة الداخلية أولاً")

        manager_role = guild.get_role(int(settings["manager_role_id"]))
        military_role = guild.get_role(int(settings["military_role_id"]))
        if not manager_role or not military_role:
            raise ValueError("إحدى الرتب المحددة غير موجودة")

        embed = discord.Embed(
            title="🛡️ لوحة تحكم النقاط العسكرية",
            description=(
                "من هنا يتم التحكم في نقاط العساكر وإدارتها.\n\n"
                f"**رتبة المسؤول:** {manager_role.mention}\n"
                f"**رتبة وزارة الداخلية:** {military_role.mention}"
            ),
            color=discord.Color.dark_red(),
            timestamp=datetime.now(timezone.utc)
        )
        if guild.icon:
            embed.set_thumbnail(url=guild.icon.url)
        embed.set_footer(text=guild.name, icon_url=guild.icon.url if guild.icon else None)
        return embed, PoliceAdminPanelView(self)

    async def send_dashboard_panel(self, guild, channel):
        embed, view = self.build_dashboard_panel(guild)
        await channel.send(embed=embed, view=view)

    def get_user_points(self, guild_id, user_id):
        row = self.cursor.execute("SELECT points FROM user_points WHERE guild_id = ? AND user_id = ?", (guild_id, user_id)).fetchone()
        return row["points"] if row else 0

    def update_user_points(self, guild_id, user_id, points):
        self.cursor.execute("""
        INSERT INTO user_points (guild_id, user_id, points) VALUES (?, ?, ?)
        ON CONFLICT(guild_id, user_id) DO UPDATE SET points = excluded.points
        """, (guild_id, user_id, points))
        self.db.commit()

    def get_top_10(self, guild_id):
        return self.cursor.execute("SELECT user_id, points FROM user_points WHERE guild_id = ? ORDER BY points DESC LIMIT 10", (guild_id,)).fetchall()

    # أمر التحكم العسكري
    @app_commands.command(name="police-admin", description="إرسال لوحة تحكم النقاط العسكرية")
    @app_commands.describe(
        manager_role="رتبة مسؤول النقاط (التي تملك صلاحية التحكم)",
        military_role="رتبة وزارة الداخلية (العسكرية)",
        description="الوصف الخاص بلوحة التحكم العسكرية"
    )
    @app_commands.guild_only()
    @app_commands.checks.has_permissions(administrator=True)
    async def police_admin(self, interaction: discord.Interaction, manager_role: discord.Role, military_role: discord.Role, description: str):
        self.update_setting(interaction.guild.id, "manager_role_id", manager_role.id)
        self.update_setting(interaction.guild.id, "military_role_id", military_role.id)

        admin_embed = discord.Embed(
            title="🛡️ لوحة تحكم النقاط العسكرية",
            description=description,
            color=discord.Color.dark_red(),
            timestamp=datetime.now(timezone.utc)
        )
        if interaction.guild.icon:
            admin_embed.set_thumbnail(url=interaction.guild.icon.url)
        admin_embed.set_footer(text=interaction.guild.name, icon_url=interaction.guild.icon.url if interaction.guild.icon else None)

        await interaction.channel.send(embed=admin_embed, view=PoliceAdminPanelView(self))
        await interaction.response.send_message("✅ تم إرسال لوحة التحكم العسكرية بنجاح وتعيين الرتب!", ephemeral=True)

    # أمر الخدمات العامة
    @app_commands.command(name="police-public", description="إرسال لوحة خدمات النقاط العامة")
    @app_commands.describe(
        description="الوصف الخاص باللوحة العامة"
    )
    @app_commands.guild_only()
    @app_commands.checks.has_permissions(administrator=True)
    async def police_public(self, interaction: discord.Interaction, description: str):
        public_embed = discord.Embed(
            title="🎖️ لوحة خدمات النقاط العسكرية",
            description=description,
            color=discord.Color.from_rgb(0, 50, 100),
            timestamp=datetime.now(timezone.utc)
        )
        if interaction.guild.icon:
            public_embed.set_thumbnail(url=interaction.guild.icon.url)
        public_embed.set_footer(text=interaction.guild.name, icon_url=interaction.guild.icon.url if interaction.guild.icon else None)

        await interaction.channel.send(embed=public_embed, view=PolicePublicPanelView(self))
        await interaction.response.send_message("✅ تم إرسال اللوحة العامة بنجاح!", ephemeral=True)

    async def cog_app_command_error(self, interaction: discord.Interaction, error: app_commands.AppCommandError):
        if isinstance(error, app_commands.MissingPermissions):
            msg = "❌ هذا الأمر للمشرفين (Administrator) فقط."
        else:
            msg = "❌ حدث خطأ غير متوقع أثناء تنفيذ الأمر."
        if interaction.response.is_done():
            await interaction.followup.send(msg, ephemeral=True)
        else:
            await interaction.response.send_message(msg, ephemeral=True)

async def setup(bot):
    await bot.add_cog(PointPolice(bot))
