import discord
from discord.ext import commands
from discord import app_commands
import json
import os

DATA_FILE = "activation_requests.json"  # كان apply_data.json وتتعارض مع قسم التقديمات
SETTINGS_FILE = "activation_settings.json"  # إعدادات كل سيرفر (يكتبها الموقع والأمر)

def load_data():
    if not os.path.exists(DATA_FILE):
        return {}
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        try:
            return json.load(f)
        except json.JSONDecodeError:
            return {}

def str_save_data(data):
    json.dump(data, open(DATA_FILE, "w", encoding="utf-8"), ensure_ascii=False, indent=4)

def save_data(data):
    str_save_data(data)

def load_settings(guild_id):
    try:
        with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
            return json.load(f).get(str(guild_id)) or {}
    except Exception:
        return {}

def save_settings(guild_id, cfg):
    try:
        with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
            allc = json.load(f)
    except Exception:
        allc = {}
    allc[str(guild_id)] = cfg
    with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(allc, f, ensure_ascii=False, indent=4)

def build_panel_embed(guild):
    embed = discord.Embed(color=discord.Color.dark_embed())
    embed.set_author(name=f"{guild.name} 🎮", icon_url=guild.icon.url if guild.icon else None)
    embed.add_field(
        name="الأنشطة ✅",
        value=f"مرحباً بكم في مدينة `{guild.name}` نورتونا 🎮\n\nللبدء في التفعيل يرجى اختيار **التفعيل** من القائمة بالأسفل! ✅\n\nحياكم الله نورتونا وشرفتونا 👋",
        inline=False
    )
    embed.set_image(url="https://i.ibb.co/3s6q376/image.png")
    return embed

class ReviewView(discord.ui.View):
    def __init__(self, target_user_id: int, staff_msg_id: int, remove_role_id: int = None, add_role_id: int = None, staff_role_id: int = None):
        super().__init__(timeout=None)
        self.target_user_id = target_user_id
        self.staff_msg_id = staff_msg_id
        self.remove_role_id = remove_role_id
        self.add_role_id = add_role_id
        self.staff_role_id = staff_role_id

    @discord.ui.button(label="قبول", style=discord.ButtonStyle.green, custom_id="accept_apply")
    async def accept_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.send_message("✍️ أرسل الآن في الشات **سبب القبول**:", ephemeral=True)
        
        def check(m):
            return m.author == interaction.user and m.channel == interaction.channel

        try:
            msg = await interaction.client.wait_for('message', timeout=60.0, check=check)
            reason = msg.content
            await msg.delete()
        except:
            reason = "تم القبول بدون ذكر سبب."

        guild = interaction.guild
        member = guild.get_member(self.target_user_id)

        remove_role = guild.get_role(self.remove_role_id) if self.remove_role_id else None
        add_role = guild.get_role(self.add_role_id) if self.add_role_id else None

        if member:
            if remove_role:
                try: await member.remove_roles(remove_role)
                except: pass
            if add_role:
                try: await member.add_roles(add_role)
                except: pass

            try:
                dm_embed = discord.Embed(color=discord.Color.green())
                dm_embed.set_author(name=f"{guild.name} 🎮", icon_url=guild.icon.url if guild.icon else None)
                dm_embed.add_field(name="التفعيل ✅", value=f"-\n\nنهنئك بقبول تفعيلك في `{guild.name}`\n\nالسبب: {reason}\n`🪪 ( ✅ ) R c`", inline=False)
                await member.send(embed=dm_embed)
            except:
                pass

        data = load_data()
        if str(self.staff_msg_id) in data:
            data[str(self.staff_msg_id)]["status"] = "accepted"
            save_data(data)

        for child in self.children:
            child.disabled = True

        target_member = guild.get_member(self.target_user_id)
        target_mention = target_member.mention if target_member else f"<@!{self.target_user_id}>"

        if interaction.message.embeds:
            old_embed = interaction.message.embeds[0]
            new_embed = discord.Embed(
                title="طلب تفعيل جديد (مقبول ✅)",
                color=discord.Color.green()
            )
            new_embed.set_author(name=old_embed.author.name, icon_url=old_embed.author.icon_url)
            new_embed.description = f"**تم قبول العضو:** {target_mention}\n**من قبل المسؤول:** {interaction.user.mention}\n**السبب:** {reason}"
            
            for field in old_embed.fields:
                new_embed.add_field(name=field.name, value=field.value, inline=field.inline)
            
            new_embed.set_footer(text=old_embed.footer.text)
            
            await interaction.message.edit(embed=new_embed, view=self)

        await interaction.followup.send(f"✅ تم قبول العضو بنجاح بواسطة {interaction.user.mention}", ephemeral=True)

    @discord.ui.button(label="رفض", style=discord.ButtonStyle.red, custom_id="reject_apply")
    async def reject_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.send_message("✍️ أرسل الآن في الشات **سبب الرفض**:", ephemeral=True)
        
        def check(m):
            return m.author == interaction.user and m.channel == interaction.channel

        try:
            msg = await interaction.client.wait_for('message', timeout=60.0, check=check)
            reason = msg.content
            await msg.delete()
        except:
            reason = "استيفاء الشروط المطلوبة."

        guild = interaction.guild
        member = guild.get_member(self.target_user_id)

        if member:
            try:
                dm_embed = discord.Embed(color=discord.Color.red())
                dm_embed.set_author(name=f"{guild.name} 🎮", icon_url=guild.icon.url if guild.icon else None)
                dm_embed.add_field(name="التفعيل ✅", value=f"-\n\nتم رفض طلب التفعيل ❌\n\nنعتذر منك تم رفض طلب التفعيل لعدم استيفاء الشروط المطلوبة\nيمكنك التقديم مرة أخرى بعد التأكد من استكمال جميع الشروط المطلوبة\n\nالسبب: {reason}", inline=False)
                await member.send(embed=dm_embed)
            except:
                pass

        data = load_data()
        if str(self.staff_msg_id) in data:
            del data[str(self.staff_msg_id)]
            save_data(data)

        for child in self.children:
            child.disabled = True
        await interaction.message.edit(view=self)
        await interaction.followup.send(f"❌ تم رفض العضو بواسطة {interaction.user.mention}", ephemeral=True)

class ApplyDropdown(discord.ui.Select):
    def __init__(self, staff_channel_id: int = None, remove_role_id: int = None, add_role_id: int = None, staff_role_id: int = None):
        self.staff_channel_id = staff_channel_id
        self.remove_role_id = remove_role_id
        self.add_role_id = add_role_id
        self.staff_role_id = staff_role_id
        
        options = [
            discord.SelectOption(label="التفعيل", description="بدء طلب التفعيل", value="start_apply_dm", emoji="✅"),
            discord.SelectOption(label="إعادة التشغيل", description="إعادة تعيين خيارات القائمة", value="reset_menu", emoji="🔄")
        ]
        super().__init__(placeholder="اختر من القائمة", min_values=1, max_values=1, options=options, custom_id="apply_dropdown_persistent_dm")

    async def callback(self, interaction: discord.Interaction):
        if self.values[0] == "reset_menu":
            await interaction.response.send_message("🔄 تم إعادة تعيين القائمة بنجاح.", ephemeral=True)
            return

        if self.values[0] == "start_apply_dm":
            cfg = load_settings(interaction.guild.id)
            if cfg:
                staff_channel_id, add_role_id = cfg.get("staff_channel_id"), cfg.get("add_role_id")
                remove_role_id, staff_role_id = cfg.get("remove_role_id"), cfg.get("staff_role_id")
            else:
                staff_channel_id, add_role_id = self.staff_channel_id, self.add_role_id
                remove_role_id, staff_role_id = self.remove_role_id, self.staff_role_id

            data = load_data()
            already_applied = False
            for req in data.values():
                if req.get("user_id") == interaction.user.id and req.get("guild_id", interaction.guild.id) == interaction.guild.id:
                    already_applied = True
                    break

            if add_role_id:
                activated_role = interaction.guild.get_role(add_role_id)
                if activated_role and activated_role in interaction.user.roles:
                    already_applied = True

            if already_applied:
                await interaction.response.send_message("❌ عذراً، أنت مفعل مسبقاً أو لديك طلب تفعيل قيد المراجعة!", ephemeral=True)
                return

            await interaction.response.send_message("📩 تم إرسال أسئلة التفعيل في الخاص، توجه هناك لو سمحت!", ephemeral=True)
            
            questions = [
                "١- ما هو اسمك الحقيقي؟",
                "٢- ما هو عمرك الحقيقي؟",
                "٣- هل تم قراءة قوانين السيرفر؟ (نعم / لا)",
                "٤- اذكر ٢ من قوانين السيرفر:",
                "٥- اذكر ٢ من قوانين الرول بلاي:",
                "٦- كم مدة تفاعلك اليومي؟",
                "٧- هل تتعهد بالالتزام بالقوانين والأنظمة؟"
            ]
            
            answers = []
            def check(m):
                return m.author == interaction.user and isinstance(m.channel, discord.DMChannel)

            try:
                for i, q in enumerate(questions):
                    await interaction.user.send(f"**[سؤال {i+1}/7]**\n{q}")
                    msg = await interaction.client.wait_for('message', timeout=120.0, check=check)
                    answers.append(msg.content)
            except:
                await interaction.user.send("⏰ انتهى الوقت المحدد للتقديم. حاول مرة أخرى من السيرفر.")
                return

            await interaction.user.send("✅ تم استلام جميع إجاباتك بنجاح! تم إرسال طلبك للإدارة للمراجعة.")

            embed = discord.Embed(title="طلب تفعيل جديد (خاص)", color=discord.Color.blue())
            embed.set_author(name=interaction.user.name, icon_url=interaction.user.display_avatar.url)
            embed.add_field(name="١- الاسم الحقيقي", value=answers[0], inline=False)
            embed.add_field(name="٢- العمر", value=answers[1], inline=False)
            embed.add_field(name="٣- قراءة القوانين؟", value=answers[2], inline=False)
            embed.add_field(name="٤- قوانين السيرفر", value=answers[3], inline=False)
            embed.add_field(name="٥- قوانين الرول بلاي", value=answers[4], inline=False)
            embed.add_field(name="٦- مدة التفاعل", value=answers[5], inline=False)
            embed.add_field(name="٧- التعهد بالالتزام", value=answers[6], inline=False)
            embed.set_footer(text=f"الآيدي: {interaction.user.id}")

            staff_channel = interaction.guild.get_channel(staff_channel_id) if staff_channel_id else None
            if staff_channel:
                temp_view = discord.ui.View()
                staff_mention = f"<@&{staff_role_id}>" if staff_role_id else "@here"
                msg_staff = await staff_channel.send(content=f"{staff_mention} طلب تفعيل جديد مقدّم من: {interaction.user.mention}", embed=embed, view=temp_view)
                
                final_view = ReviewView(interaction.user.id, msg_staff.id, remove_role_id, add_role_id, staff_role_id)
                await msg_staff.edit(view=final_view)
                
                data = load_data()
                data[str(msg_staff.id)] = {
                    "user_id": interaction.user.id,
                    "guild_id": interaction.guild.id,
                    "status": "pending"
                }
                save_data(data)

class ApplyPanelView(discord.ui.View):
    def __init__(self, staff_channel_id: int = None, remove_role_id: int = None, add_role_id: int = None, staff_role_id: int = None):
        super().__init__(timeout=None)
        self.add_item(ApplyDropdown(staff_channel_id, remove_role_id, add_role_id, staff_role_id))

class ApplyCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.bot.add_view(ApplyPanelView())

    @app_commands.command(name="لوحة-التفعيل", description="إرسال بانل التفعيل الخاص بالسيرفر")
    @app_commands.describe(
        staff_channel="روم استقبال طلبات الإدارة",
        add_role="رتبة العضو بعد القبول (اختياري)",
        remove_role="رتبة يتم إزالتها عند القبول (اختياري)",
        staff_role="رتبة الإدارة التي يتم عمل منشن لها (اختياري)"
    )
    @app_commands.rename(
        staff_channel="روم_الادارة",
        add_role="رتبة_القبول",
        remove_role="رتبة_الازالة",
        staff_role="رتبة_الادارة"
    )
    @app_commands.checks.has_permissions(administrator=True)
    async def setup_apply(
        self, 
        interaction: discord.Interaction, 
        staff_channel: discord.TextChannel,
        add_role: discord.Role = None,
        remove_role: discord.Role = None,
        staff_role: discord.Role = None
    ):
        guild = interaction.guild
        embed = build_panel_embed(guild)

        add_id = add_role.id if add_role else None
        remove_id = remove_role.id if remove_role else None
        staff_id = staff_role.id if staff_role else None
        save_settings(guild.id, {"staff_channel_id": staff_channel.id, "add_role_id": add_id,
                                 "remove_role_id": remove_id, "staff_role_id": staff_id})

        view = ApplyPanelView(staff_channel.id, remove_id, add_id, staff_id)
        await interaction.channel.send(embed=embed, view=view)
        await interaction.response.send_message("✅ تم إرسال البانل بنجاح وتفعيل القائمة!", ephemeral=True)

async def setup(bot):
    await bot.add_cog(ApplyCog(bot))
