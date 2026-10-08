import discord
from discord.ext import commands
from discord import app_commands
from discord import ui
import json
import os

DATA_FILE = "roleplay_data.json"

def load_data():
    if not os.path.exists(DATA_FILE):
        return {}
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        try:
            return json.load(f)
        except json.JSONDecodeError:
            return {}

def save_data(data):
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=4)

class RPSelect(ui.Select):
    def __init__(self, bot):
        self.bot = bot
        options = [
            discord.SelectOption(label="بدء الرول", description="تغيير حالة الرول إلى (بدء)", emoji="🟢"),
            discord.SelectOption(label="انتهاء الرول", description="تغيير حالة الرول إلى (انتهاء)", emoji="🔴"),
            discord.SelectOption(label="تصويت الرول", description="تغيير حالة الرول إلى (تصويت)", emoji="🗳️")
        ]
        super().__init__(placeholder="اختر حالة الرول...", options=options, min_values=1, max_values=1)

    async def callback(self, interaction: discord.Interaction):
        # الاستجابة الفورية لمنع خطأ Unknown interaction (10062)
        await interaction.response.defer(ephemeral=True)

        guild_id = str(interaction.guild.id)
        data = load_data()
        guild_data = data.get(guild_id)

        if not guild_data:
            await interaction.followup.send("❌ لم يتم إعداد نظام الرول في هذا السيرفر بعد عبر `/setup-role-play`!", ephemeral=True)
            return

        # التحقق من رتبة مسؤول الرولات إن وجدت
        manager_role_id = guild_data.get("manager_role_id")
        if manager_role_id:
            role = interaction.guild.get_role(manager_role_id)
            if role and role not in interaction.user.roles and not interaction.user.guild_permissions.administrator:
                await interaction.followup.send("❌ ليس لديك الصلاحية أو رتبة مسؤول الرولات لاستخدام هذه القائمة!", ephemeral=True)
                return

        channel_id = guild_data.get("channel_id")
        if not channel_id:
            await interaction.followup.send("❌ لم يتم تحديد روم بدء الرول في الإعدادات!", ephemeral=True)
            return

        target_channel = interaction.guild.get_channel(channel_id)
        if not target_channel:
            await interaction.followup.send("❌ روم بدء الرول المحدد غير موجود!", ephemeral=True)
            return

        selection = self.values[0]
        ping_role_id = guild_data.get("ping_role_id")
        ping_content = f"<@&{ping_role_id}>" if ping_role_id else ""

        # تحديد محتوى الإمبد بناءً على الخيار
        if selection == "بدء الرول":
            msg_text = guild_data.get("start_msg") or "🟢 **تم افتتاح الرول الآن، تفضلوا بالدخول!**"
            embed = discord.Embed(title="🟢 حالة الرول: بدأ", description=msg_text, color=discord.Color.green())
        elif selection == "انتهاء الرول":
            msg_text = guild_data.get("end_msg") or "🔴 **انتهى الرول لهذا اليوم، شكراً لحسن تواجدكم.**"
            embed = discord.Embed(title="🔴 حالة الرول: انتهى", description=msg_text, color=discord.Color.red())
        elif selection == "تصويت الرول":
            msg_text = guild_data.get("vote_msg") or "🗳️ **هناك تصويت جارٍ الآن، يرجى المشاركة.**"
            embed = discord.Embed(title="🗳️ حالة الرول: تصويت", description=msg_text, color=discord.Color.blue())

        embed.set_footer(text=f"بواسطة: {interaction.user.name}")

        last_msg_id = guild_data.get("last_status_msg_id")
        sent_message = None

        if last_msg_id:
            try:
                old_msg = await target_channel.fetch_message(last_msg_id)
                await old_msg.edit(content=ping_content, embed=embed)
                sent_message = old_msg
            except Exception:
                pass

        if not sent_message:
            try:
                sent_message = await target_channel.send(content=ping_content, embed=embed)
                guild_data["last_status_msg_id"] = sent_message.id
                save_data(guild_data)
            except discord.Forbidden:
                await interaction.followup.send("❌ البوت لا يمتلك صلاحية الكتابة أو إرسال الرسائل في روم الرول المختار!", ephemeral=True)
                return

        data[guild_id] = guild_data
        save_data(data)

        await interaction.followup.send(f"✅ تم تحديث حالة الرول بنجاح في روم {target_channel.mention}!", ephemeral=True)

class RPView(ui.View):
    def __init__(self, bot):
        super().__init__(timeout=None)
        self.add_item(RPSelect(bot))

class RolePlaySystem(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(name="setup-role-play", description="إعداد نظام الرول بلاي والرسائل الخاصة به")
    @app_commands.describe(
        channel="روم بدء الرول (اختر القناة أو اكتب منشن لها)",
        start_message="رسالة بدء الرول (اختياري)",
        end_message="رسالة انتهاء الرول (اختياري)",
        vote_message="رسالة تصويت الرول (اختياري)",
        ping_role="رتبة المنشن عند تحديث الحالة (اختياري)",
        manager_role="رتبة مسؤول الرولات للتحكم بالقائمة (اختياري)"
    )
    async def setup_role_play(
        self,
        interaction: discord.Interaction,
        channel: discord.TextChannel,
        start_message: str = None,
        end_message: str = None,
        vote_message: str = None,
        ping_role: discord.Role = None,
        manager_role: discord.Role = None
    ):
        guild_id = str(interaction.guild.id)
        data = load_data()

        old_last_msg_id = data.get(guild_id, {}).get("last_status_msg_id")

        data[guild_id] = {
            "channel_id": channel.id,
            "start_msg": start_message,
            "end_msg": end_message,
            "vote_msg": vote_message,
            "ping_role_id": ping_role.id if ping_role else None,
            "manager_role_id": manager_role.id if manager_role else None,
            "last_status_msg_id": old_last_msg_id
        }
        save_data(data)

        await interaction.response.send_message(f"✅ تم حفظ إعدادات الرول بنجاح!\n📌 روم الرول: {channel.mention}", ephemeral=True)

    @app_commands.command(name="panel-role-play", description="إرسال لوحة التحكم (البانل) الخاصة بالرول بلاي مع القائمة المنسدلة")
    async def panel_role_play(self, interaction: discord.Interaction):
        guild_id = str(interaction.guild.id)
        data = load_data()

        if guild_id not in data:
            await interaction.response.send_message("❌ يرجى استخدام أمر التسطيب `/setup-role-play` أولاً!", ephemeral=True)
            return

        permissions = interaction.channel.permissions_for(interaction.guild.me)
        if not permissions.send_messages or not permissions.view_channel:
            await interaction.response.send_message("❌ البوت لا يمتلك صلاحية قراءة أو إرسال الرسائل في هذه الروم!", ephemeral=True)
            return

        embed = discord.Embed(
            title="🎮 لوحة تحكم إدارة الرول بلاي",
            description="اختر الحالة المناسبة من القائمة المنسدلة بالأسفل لتحديث حالة الرول مباشرة في الروم المخصص.",
            color=discord.Color.dark_embed()
        )

        view = RPView(self.bot)
        
        await interaction.response.send_message("✅ تم إرسال بانل الرول بنجاح.", ephemeral=True)
        await interaction.channel.send(embed=embed, view=view)

async def setup(bot):
    await bot.add_cog(RolePlaySystem(bot))
