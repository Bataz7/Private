import discord
from discord.ext import commands
from discord import app_commands
from discord import ui
import json
import os

DATA_FILE = "id_data.json"

def load_data():
    if not os.path.exists(DATA_FILE):
        return {"submitted": [], "admins_channel_id": None, "change_nick": True, "add_role_id": None, "rem_role_id": None}
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        try:
            data = json.load(f)
            if "change_nick" not in data:
                data["change_nick"] = True
            if "add_role_id" not in data:
                data["add_role_id"] = None
            if "rem_role_id" not in data:
                data["rem_role_id"] = None
            return data
        except json.JSONDecodeError:
            return {"submitted": [], "admins_channel_id": None, "change_nick": True, "add_role_id": None, "rem_role_id": None}

def save_data(data):
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=4)

class AgreementView(ui.View):
    def __init__(self, data_dict, bot, user):
        super().__init__(timeout=180)
        self.data_dict = data_dict
        self.bot = bot
        self.user = user

    @ui.button(label="أتعهد وأوافق", style=discord.ButtonStyle.green)
    async def agree_btn(self, interaction: discord.Interaction, button: ui.Button):
        data = load_data()
        channel_id = data.get("admins_channel_id")
        
        if not channel_id:
            await interaction.response.send_message("❌ لم يتم تحديد روم الإدارة بعد!", ephemeral=True)
            return

        channel = self.bot.get_channel(channel_id)
        if not channel:
            await interaction.response.send_message("❌ روم الإدارة غير موجود!", ephemeral=True)
            return

        embed = discord.Embed(title="📋 طلب هوية وطنية جديد", color=discord.Color.gold())
        embed.set_author(name=f"العضو: {self.user} (الآيدي: {self.user.id})", icon_url=self.user.display_avatar.url)
        
        embed.add_field(name="١- الاسم بالرول", value=str(self.data_dict["name"])[:1024], inline=True)
        embed.add_field(name="٢- العمر", value=str(self.data_dict["age"])[:1024], inline=True)
        embed.add_field(name="٣- الدولة", value=str(self.data_dict["country"])[:1024], inline=True)
        embed.add_field(name="٥- يوزر روبلوكس", value=str(self.data_dict["roblox_user"])[:1024], inline=True)
        embed.add_field(name="٦- رقم الهوية", value=str(self.data_dict["id_num"])[:1024], inline=True)
        embed.add_field(name="٧- التعهد", value="متعهد بقوانين الرول بلاي وعدم التخريب ✅", inline=False)
        
        if self.data_dict["image_url"]:
            embed.set_image(url=self.data_dict["image_url"])
        embed.set_footer(text=f"صاحب الطلب: {self.user.id}")

        admin_view = AdminReviewView(self.user.id, self.data_dict["roblox_user"], self.data_dict["id_num"], self.user)
        
        ping_role = f"<@&{data['add_role_id']}>" if data.get("add_role_id") else ""
        
        await channel.send(content=ping_role, embed=embed, view=admin_view)
        await interaction.response.send_message("✅ تم إرسال تقديمك بنجاح إلى الإدارة، انتظر رد الإدارة بالخاص!", ephemeral=True)
        self.stop()

class AdminReviewView(ui.View):
    def __init__(self, user_id, roblox_user, id_num, member_obj):
        super().__init__(timeout=None)
        self.user_id = user_id
        self.roblox_user = roblox_user
        self.id_num = id_num
        self.member_obj = member_obj

    @ui.button(label="قبول", style=discord.ButtonStyle.success, custom_id="accept_id_btn")
    async def accept_btn(self, interaction: discord.Interaction, button: ui.Button):
        guild = interaction.guild
        member = guild.get_member(self.user_id)
        admin_user = interaction.user
        
        data = load_data()
        if self.user_id not in data["submitted"]:
            data["submitted"].append(self.user_id)
            save_data(data)

        if member:
            if data.get("change_nick", True):
                new_nickname = f"{self.roblox_user} | {self.id_num}"
                try:
                    await member.edit(nick=new_nickname)
                except Exception:
                    pass

            if data.get("rem_role_id"):
                rem_role = guild.get_role(data["rem_role_id"])
                if rem_role and rem_role in member.roles:
                    try:
                        await member.remove_roles(rem_role)
                    except Exception:
                        pass

            if data.get("add_role_id"):
                add_role = guild.get_role(data["add_role_id"])
                if add_role and add_role not in member.roles:
                    try:
                        await member.add_roles(add_role)
                    except Exception:
                        pass

            try:
                await member.send(f"🎉 مبروك! تم **قبول** طلب الهوية الوطنية الخاصة بك بواسطة الإداري: {admin_user.display_name}")
            except Exception:
                pass

        old_embed = interaction.message.embeds[0]
        updated_embed = discord.Embed(
            title="📋 طلب هوية وطنية (تم القبول ✅)",
            description=f"👤 **العضو:** {self.member_obj.mention} (`{self.member_obj}`)\n🛡️ **المسؤول:** {admin_user.mention} (`{admin_user}`)",
            color=discord.Color.green()
        )
        updated_embed.set_author(name=old_embed.author.name, icon_url=old_embed.author.icon_url)
        for field in old_embed.fields:
            updated_embed.add_field(name=field.name, value=field.value, inline=field.inline)
        if old_embed.image:
            updated_embed.set_image(url=old_embed.image.url)
        updated_embed.set_footer(text=f"تم القبول بواسطة: {admin_user}")

        await interaction.message.edit(embed=updated_embed, view=None)
        await interaction.response.send_message(f"✅ تم قبول العضو بنجاح.", ephemeral=True)

    @ui.button(label="رفض", style=discord.ButtonStyle.danger, custom_id="reject_id_btn")
    async def reject_btn(self, interaction: discord.Interaction, button: ui.Button):
        modal = RejectReasonModal(self.user_id, interaction.user, self.member_obj)
        await interaction.response.send_modal(modal)

class RejectReasonModal(ui.Modal, title="سبب الرفض"):
    reason = ui.TextInput(label="اكتب سبب رفض الهوية هنا:", style=discord.TextStyle.paragraph, required=True)

    def __init__(self, user_id, admin_user, member_obj):
        super().__init__()
        self.user_id = user_id
        self.admin_user = admin_user
        self.member_obj = member_obj

    async def on_submit(self, interaction: discord.Interaction):
        guild = interaction.guild
        member = guild.get_member(self.user_id)
        
        if member:
            try:
                await member.send(f"❌ عذراً، تم **رفض** طلب الهوية الوطنية الخاصة بك بواسطة الإداري: {self.admin_user.display_name}.\nالسبب: {self.reason.value}")
            except Exception:
                pass

        message = interaction.message
        old_embed = message.embeds[0]
        updated_embed = discord.Embed(
            title="📋 طلب هوية وطنية (تم الرفض ❌)",
            description=f"👤 **العضو:** {self.member_obj.mention} (`{self.member_obj}`)\n🛡️ **المسؤول:** {self.admin_user.mention} (`{self.admin_user}`)\n📌 **السبب:** {self.reason.value}",
            color=discord.Color.red()
        )
        updated_embed.set_author(name=old_embed.author.name, icon_url=old_embed.author.icon_url)
        for field in old_embed.fields:
            updated_embed.add_field(name=field.name, value=field.value, inline=field.inline)
        if old_embed.image:
            updated_embed.set_image(url=old_embed.image.url)
        updated_embed.set_footer(text=f"تم الرفض بواسطة: {self.admin_user}")

        await message.edit(embed=updated_embed, view=None)
        await interaction.response.send_message(f"❌ تم رفض الطلب وإرسال السبب للعضو.", ephemeral=True)

class IDSelectMenu(ui.Select):
    def __init__(self, bot):
        options = [
            discord.SelectOption(label="تـقـديـم الـهـويـة الـوطـنـيـة 🪪", description="اضغط هنا لبدء تقديم طلب الهوية بالخاص", emoji="🪪"),
            discord.SelectOption(label="اعادة التشغيل", description="إعادة تعيين خيارات القائمة", emoji="🔄")
        ]
        # إضافة custom_id ثابت لكي يتعرف عليها ديسكورد بعد إعادة التشغيل
        super().__init__(custom_id="persistent_id_select_menu", placeholder="اضغط هنا لاختيار الخدمة...", options=options, min_values=1, max_values=1)
        self.bot = bot

    async def callback(self, interaction: discord.Interaction):
        if self.values[0] == "اعادة التشغيل":
            await interaction.response.send_message("🔄 تم إعادة تشغيل القائمة بنجاح.", ephemeral=True)
            return

        data = load_data()
        if interaction.user.id in data["submitted"]:
            await interaction.response.send_message("⚠️ لقد قمت بتقديم الهوية وتم قبولك مسبقاً، لا يمكنك التقديم مرة أخرى!", ephemeral=True)
            return

        await interaction.response.send_message("📬 تم إرسال الأسئلة لك في **الخاص**، يرجى التوجه هناك لإكمال التقديم!", ephemeral=True)

        try:
            dm_channel = await interaction.user.create_dm()
            
            def check_msg(m):
                return m.author == interaction.user and isinstance(m.channel, discord.DMChannel)

            await dm_channel.send("📌 **السؤال (1/6):** ما هو اسمك بالرول؟")
            msg1 = await self.bot.wait_for("message", check=check_msg, timeout=120.0)
            name = msg1.content

            await dm_channel.send("📌 **السؤال (2/6):** كم عمرك بالرول؟")
            msg2 = await self.bot.wait_for("message", check=check_msg, timeout=120.0)
            age = msg2.content

            await dm_channel.send("📌 **السؤال (3/6):** من أي دولة أنت؟")
            msg3 = await self.bot.wait_for("message", check=check_msg, timeout=120.0)
            country = msg3.content

            await dm_channel.send("📌 **السؤال (4/6):** أرسل **صورة** لحسابك في روبلوكس (في حال أرسلت شيئاً غير الصورة سيتم الرفض فوراً):")
            msg4 = await self.bot.wait_for("message", check=check_msg, timeout=120.0)
            if not msg4.attachments:
                await dm_channel.send("❌ لم تقم بإرسال صورة، تم إلغاء تقديمك.")
                return
            image_url = msg4.attachments[0].url

            await dm_channel.send("📌 **السؤال (5/6):** ما هو يوزرك في روبلوكس؟")
            msg5 = await self.bot.wait_for("message", check=check_msg, timeout=120.0)
            roblox_user = msg5.content

            while True:
                await dm_channel.send("📌 **السؤال (6/6):** اختر رقم هوية مكوناً من **4 أرقام إنجليزية** فقط (مثال: 0506):")
                msg6 = await self.bot.wait_for("message", check=check_msg, timeout=120.0)
                id_num = msg6.content.strip()
                
                if id_num.isdigit() and len(id_num) == 4:
                    break
                else:
                    await dm_channel.send("❌ خطأ! يرجى إرسال **أرقام إنجليزية** فقط وبطول 4 أرقام تماماً. حاول مرة أخرى:")

            user_data = {
                "name": name,
                "age": age,
                "country": country,
                "image_url": image_url,
                "roblox_user": roblox_user,
                "id_num": id_num
            }
            
            agree_view = AgreementView(user_data, self.bot, interaction.user)
            await dm_channel.send("📌 **السؤال (7/7):** هل تتعهد بقوانين الرول بلاي وعدم التخريب؟\nاضغط على الزر أدناه لإرسال طلبك نهائياً للإدارة:", view=agree_view)

        except Exception as e:
            try:
                await interaction.user.send("❌ انتهى الوقت المخصص للإجابة أو حدث خطأ، يرجى إعادة محاولة التقديم من السيرفر.")
            except:
                pass

class IDSelectView(ui.View):
    def __init__(self, bot):
        super().__init__(timeout=None)
        self.add_item(IDSelectMenu(bot))

class IDSystemCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        # تسجيل القائمة الرئيسية للـ ID لكي تبقى تعمل بنجاح بعد إعادة التشغيل
        self.bot.add_view(IDSelectView(bot))

    @app_commands.command(name="لوحة-الهوية", description="إرسال لوحة الهوية الوطنية وتحديد الإعدادات")
    @app_commands.describe(
        channel="روم الإدارة لاستقبال التقديمات",
        change_nickname="هل يتم تغيير اسم العضو بعد القبول تلقائياً؟",
        add_role="رتبة يتم إعطاؤها عند القبول (اختياري)",
        rem_role="رتبة يتم إزالتها عند القبول مثل رتبة مواطن جديد (اختياري)"
    )
    @app_commands.rename(
        channel="روم_الادارة",
        change_nickname="تغيير_الاسم",
        add_role="رتبة_القبول",
        rem_role="رتبة_الازالة"
    )
    @app_commands.checks.has_permissions(administrator=True)
    async def setup_id(
        self, 
        interaction: discord.Interaction, 
        channel: discord.TextChannel,
        change_nickname: bool = True,
        add_role: discord.Role = None,
        rem_role: discord.Role = None
    ):
        data = load_data()
        data["admins_channel_id"] = channel.id
        data["change_nick"] = change_nickname
        data["add_role_id"] = add_role.id if add_role else None
        data["rem_role_id"] = rem_role.id if rem_role else None
        save_data(data)

        embed = discord.Embed(
            title="الـهـويـة الـوطـنـيـة 🪪",
            description=(
                "أهلاً بك في نظام استخراج الهويات الوطنية الرسمية للسيرفر.\n"
                "من هنا يمكنك توثيق حسابك للحصول على كامل الصلاحيات والمزايا الخاصة بالمجتمع.\n"
                "نحرص دائماً على تنظيم الرول بلاي وتقديم أفضل تجربة ترفيهية تناسب الجميع.\n"
                "يرجى التأكد من إدخال معلوماتك بدقة واجتياز المتطلبات المطلوبة لتجنب رفض الطلب.\n"
                "نسعد بانضمامك الدائم وتواجدك المميز معنا في أوقاتك الممتعة.\n"
                "اختر من القائمة أدناه للبدء في عملية التقديم بكل سهولة ويسر."
            ),
            color=discord.Color.blue()
        )
        
        if interaction.guild.icon:
            embed.set_author(name=interaction.guild.name, icon_url=interaction.guild.icon.url)
            embed.set_thumbnail(url=interaction.guild.icon.url)

        view = IDSelectView(self.bot)
        await interaction.channel.send(embed=embed, view=view)
        
        roles_info = f"\n• تغيير الاسم: `{'مفعل' if change_nickname else 'معطل'}`"
        if add_role:
            roles_info += f"\n• رتبة الإعطاء: {add_role.mention}"
        if rem_role:
            roles_info += f"\n• رتبة الإزالة: {rem_role.mention}"

        await interaction.response.send_message(f"✅ تم إرسال لوحة الهوية بنجاح وتحديث الإعدادات إلى روم: {channel.mention}{roles_info}", ephemeral=True)

async def setup(bot):
    await bot.add_cog(IDSystemCog(bot))
