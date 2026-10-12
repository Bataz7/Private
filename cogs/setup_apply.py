import discord
from discord.ext import commands
from discord import app_commands
from discord.app_commands import describe
from discord.ui import Button, View, Select, Modal, TextInput
import json
import os
import re
import uuid
from typing import Optional
from datetime import datetime, timezone

# ملفات التخزين
DATA_FILE = "apply_data.json"        # إعدادات التقديمات: {guild_id: {num: data}}
REVIEWS_FILE = "apply_reviews.json"  # رسائل المراجعة المعلقة: {message_id: data}
PANELS_FILE = "apply_panels.json"    # البانلات المرسلة: {message_id: info}


def load_json(path):
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            try:
                return json.load(f)
            except json.JSONDecodeError:
                return {}
    return {}


def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=4)


def load_data():
    return load_json(DATA_FILE)


def save_data(data):
    save_json(DATA_FILE, data)


async def get_member_safe(guild: discord.Guild, user_id):
    """يجلب العضو من الكاش، وإن لم يوجد يجلبه من API."""
    if not user_id:
        return None
    member = guild.get_member(user_id)
    if member:
        return member
    try:
        return await guild.fetch_member(user_id)
    except discord.HTTPException:
        return None


# ==========================================
# 1. أزرار القبول والرفض (Persistent View)
# ==========================================
class ApplyReviewView(View):
    def __init__(self):
        super().__init__(timeout=None)

    async def _process(self, interaction: discord.Interaction, accepted: bool):
        guild = interaction.guild
        message = interaction.message

        # قراءة بيانات هذه الرسالة من الملف (تعمل حتى بعد إعادة التشغيل)
        reviews = load_json(REVIEWS_FILE)
        info = reviews.get(str(message.id), {})

        applicant_id = info.get("applicant_id")
        if not applicant_id and message.embeds:
            footer = message.embeds[0].footer
            if footer and footer.text:
                m = re.search(r"\d+", footer.text)
                if m:
                    applicant_id = int(m.group())

        # التحقق من الصلاحية
        admin_role_id = info.get("admin_role_id")
        authorized = interaction.user.guild_permissions.administrator
        if admin_role_id and any(r.id == admin_role_id for r in interaction.user.roles):
            authorized = True
        if not authorized:
            await interaction.response.send_message("❌ هذا الزر مخصص للإدارة أو المسؤولين فقط!", ephemeral=True)
            return

        # defer فوراً لتجنب فشل التفاعل بعد 3 ثواني
        await interaction.response.defer(ephemeral=True)

        applicant = await get_member_safe(guild, applicant_id)
        notes = []

        if accepted:
            # منح الرتب
            roles = [guild.get_role(r_id) for r_id in info.get("given_roles_ids", [])]
            roles = [r for r in roles if r]
            if applicant and roles:
                try:
                    await applicant.add_roles(*roles, reason="قبول التقديم")
                except discord.HTTPException:
                    notes.append("⚠️ تعذر منح الرتب (تأكد أن رتبة البوت أعلى من الرتب المراد منحها).")

            # إزالة الرتبة
            removed_role_id = info.get("removed_role_id")
            if applicant and removed_role_id:
                rem_r = guild.get_role(removed_role_id)
                if rem_r and rem_r in applicant.roles:
                    try:
                        await applicant.remove_roles(rem_r, reason="إزالة رتبة ما بعد القبول")
                    except discord.HTTPException:
                        notes.append("⚠️ تعذر إزالة الرتبة المحددة.")

            dm_title = "🎉 نتيجة التقديم: مقبول"
            dm_text = info.get("accept_msg", "تم قبول تقديمك بنجاح!")
            dm_color = discord.Color.green()
            status_text = f"✅ مقبول بواسطة {interaction.user.mention}"
            result_text = "✅ تم قبول العضو بنجاح."
        else:
            dm_title = "❌ نتيجة التقديم: مرفوض"
            dm_text = info.get("reject_msg", "نعتذر منك، تم رفض تقديمك.")
            dm_color = discord.Color.red()
            status_text = f"❌ مرفوض بواسطة {interaction.user.mention}"
            result_text = "❌ تم رفض التقديم."

        # إرسال رسالة الخاص
        if applicant:
            try:
                embed_dm = discord.Embed(title=dm_title, description=dm_text, color=dm_color)
                if guild.icon:
                    embed_dm.set_thumbnail(url=guild.icon.url)
                await applicant.send(embed=embed_dm)
            except discord.HTTPException:
                notes.append("⚠️ تعذر إرسال رسالة الخاص (الخاص مغلق).")
        else:
            notes.append("⚠️ العضو غير موجود في السيرفر.")

        # تحديث رسالة المراجعة
        new_view = ApplyReviewView()
        for child in new_view.children:
            child.disabled = True

        if message.embeds:
            embed_updated = discord.Embed.from_dict(message.embeds[0].to_dict())
            embed_updated.color = dm_color
            embed_updated.add_field(name="حالة التقديم", value=status_text, inline=False)
            await message.edit(embed=embed_updated, view=new_view)
        else:
            await message.edit(view=new_view)

        # حذف السجل بعد المعالجة
        reviews.pop(str(message.id), None)
        save_json(REVIEWS_FILE, reviews)

        await interaction.followup.send("\n".join([result_text] + notes), ephemeral=True)

    @discord.ui.button(label="قبول", style=discord.ButtonStyle.success, emoji="✅", custom_id="persistent_apply_accept_btn")
    async def accept_button(self, interaction: discord.Interaction, button: Button):
        await self._process(interaction, True)

    @discord.ui.button(label="رفض", style=discord.ButtonStyle.danger, emoji="❌", custom_id="persistent_apply_reject_btn")
    async def reject_button(self, interaction: discord.Interaction, button: Button):
        await self._process(interaction, False)


# ==========================================
# 2. مودال إجابات الأسئلة الخمسة للمتقدم
# ==========================================
class UserApplyModal(Modal):
    def __init__(self, apply_data):
        super().__init__(title=f"تقديم: {apply_data['name']}"[:45])
        self.apply_data = apply_data

        q_list = apply_data.get("questions", [])

        def make_input(i):
            label = (q_list[i] if len(q_list) > i else f"السؤال {i + 1}")[:45]
            return TextInput(
                label=label,
                placeholder="اكتب إجابتك هنا...",
                style=discord.TextStyle.paragraph,
                required=True,
                max_length=1000,  # حد حقل الإيمبد 1024
            )

        self.ans_1 = make_input(0)
        self.ans_2 = make_input(1)
        self.ans_3 = make_input(2)
        self.ans_4 = make_input(3)
        self.ans_5 = make_input(4)

        for item in (self.ans_1, self.ans_2, self.ans_3, self.ans_4, self.ans_5):
            self.add_item(item)

    async def on_submit(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)

        guild = interaction.guild
        review_channel = guild.get_channel(self.apply_data.get("review_channel_id", 0))

        if not review_channel:
            await interaction.followup.send("❌ روم مراجعة التقديمات غير موجود حالياً!", ephemeral=True)
            return

        q_list = self.apply_data.get("questions", [])
        embed = discord.Embed(
            title=f"📥 تقديم جديد: {self.apply_data['name']}"[:256],
            color=discord.Color.blurple(),
            timestamp=datetime.now(timezone.utc),
        )
        if guild.icon:
            embed.set_thumbnail(url=guild.icon.url)
        embed.set_author(name=str(interaction.user), icon_url=interaction.user.display_avatar.url)
        embed.add_field(name="المتقدم", value=interaction.user.mention, inline=False)

        answers = [self.ans_1.value, self.ans_2.value, self.ans_3.value, self.ans_4.value, self.ans_5.value]
        for i, ans_val in enumerate(answers):
            q_text = q_list[i] if i < len(q_list) else f"السؤال {i + 1}"
            embed.add_field(name=f"{i + 1}) {q_text}"[:256], value=ans_val[:1024], inline=False)

        embed.set_footer(text=f"الآيدي: {interaction.user.id}")

        admin_role = guild.get_role(self.apply_data.get("admin_role_id", 0))
        mention_str = admin_role.mention if admin_role else None

        try:
            msg = await review_channel.send(content=mention_str, embed=embed, view=ApplyReviewView())
        except discord.HTTPException:
            await interaction.followup.send("❌ تعذر إرسال التقديم لروم المراجعة (تأكد من صلاحيات البوت).", ephemeral=True)
            return

        # حفظ بيانات هذه الرسالة لتعمل الأزرار بعد إعادة التشغيل
        data_for_buttons = dict(self.apply_data)
        data_for_buttons["applicant_id"] = interaction.user.id
        reviews = load_json(REVIEWS_FILE)
        reviews[str(msg.id)] = data_for_buttons
        save_json(REVIEWS_FILE, reviews)

        await interaction.followup.send("✅ تم إرسال تقديمك بنجاح وفي انتظار المراجعة.", ephemeral=True)

    async def on_error(self, interaction: discord.Interaction, error: Exception):
        msg = "❌ حدث خطأ غير متوقع، حاول مرة أخرى."
        if interaction.response.is_done():
            await interaction.followup.send(msg, ephemeral=True)
        else:
            await interaction.response.send_message(msg, ephemeral=True)
        raise error


# ==========================================
# 3. مودال تحديد الأسئلة الخمسة الإجبارية
# ==========================================
class SetupQuestionsModal(Modal, title="تحديد الـ 5 أسئلة الإجبارية للتقديم"):
    q1 = TextInput(label="السؤال الأول", placeholder="مثال: كم عمرك؟", required=True, max_length=100)
    q2 = TextInput(label="السؤال الثاني", placeholder="مثال: لماذا تريد الانضمام؟", required=True, max_length=100)
    q3 = TextInput(label="السؤال الثالث", placeholder="مثال: هل لديك خبرة سابقة؟", required=True, max_length=100)
    q4 = TextInput(label="السؤال الرابع", placeholder="مثال: كم تفعل من ساعات تفاعل؟", required=True, max_length=100)
    q5 = TextInput(label="السؤال الخامس", placeholder="مثال: لماذا نختارك أنت بالذات؟", required=True, max_length=100)

    def __init__(self, base_data):
        super().__init__()
        self.base_data = base_data

    async def on_submit(self, interaction: discord.Interaction):
        self.base_data["questions"] = [self.q1.value, self.q2.value, self.q3.value, self.q4.value, self.q5.value]

        guild_id = str(interaction.guild.id)
        data = load_data()
        data.setdefault(guild_id, {})

        apply_num = self.base_data["num"]
        data[guild_id][apply_num] = self.base_data
        save_data(data)

        embed = discord.Embed(
            title="✅ تم إعداد التقديم بنجاح",
            description=f"تم حفظ التقديم رقم **{apply_num}** باسم: **{self.base_data['name']}** مع الأسئلة الـ 5 بنجاح!",
            color=discord.Color.green(),
        )
        if interaction.guild.icon:
            embed.set_thumbnail(url=interaction.guild.icon.url)

        await interaction.response.send_message(embed=embed, ephemeral=True)


# ==========================================
# 4. أزرار وقوائم البانل والإيمبد (Persistent)
# ==========================================
class OpenApplyButton(Button):
    def __init__(self, guild_id, panel_id, num, name):
        super().__init__(
            label=name[:80],
            style=discord.ButtonStyle.primary,
            emoji="📋",
            custom_id=f"apply_btn:{panel_id}:{num}",
        )
        self.guild_id = str(guild_id)
        self.num = str(num)

    async def callback(self, interaction: discord.Interaction):
        apply_data = load_data().get(self.guild_id, {}).get(self.num)
        if not apply_data:
            await interaction.response.send_message("❌ بيانات هذا التقديم غير متوفرة.", ephemeral=True)
            return
        await interaction.response.send_modal(UserApplyModal(apply_data))


class OpenApplySelect(Select):
    def __init__(self, guild_id, panel_id, applies_dict):
        options = [
            discord.SelectOption(label=f"تقديم: {data['name']}"[:100], value=str(num), emoji="📝")
            for num, data in sorted(applies_dict.items(), key=lambda x: int(x[0]))
        ]
        super().__init__(
            custom_id=f"apply_select:{panel_id}",
            placeholder="اختر نوع التقديم الذي ترغب به...",
            min_values=1,
            max_values=1,
            options=options,
        )
        self.guild_id = str(guild_id)

    async def callback(self, interaction: discord.Interaction):
        selected_num = self.values[0]
        apply_data = load_data().get(self.guild_id, {}).get(selected_num)
        if not apply_data:
            await interaction.response.send_message("❌ بيانات هذا التقديم غير متوفرة.", ephemeral=True)
            return
        await interaction.response.send_modal(UserApplyModal(apply_data))


def build_panel_view(guild_id, panel_id, display_type, applies_dict):
    view = View(timeout=None)
    if display_type == "buttons":
        for num, data in sorted(applies_dict.items(), key=lambda x: int(x[0])):
            view.add_item(OpenApplyButton(guild_id, panel_id, num, data.get("name", "تقديم")))
    else:
        view.add_item(OpenApplySelect(guild_id, panel_id, applies_dict))
    return view


class PanelEmbedModal(Modal, title="إعداد إيمبد بانل التقديم"):
    panel_title = TextInput(label="عنوان الإيمبد", placeholder="اكتب عنوان البانل هنا...", required=True, max_length=256)
    panel_desc = TextInput(label="وصف الإيمبد", placeholder="اكتب وصف الإيمبد هنا...", style=discord.TextStyle.paragraph, required=True, max_length=4000)
    panel_image = TextInput(label="رابط صورة الإيمبد (اختياري)", placeholder="https://example.com/image.png", required=False)

    def __init__(self, target_channel_id, applies_dict):
        super().__init__()
        self.target_channel_id = target_channel_id
        self.applies_dict = applies_dict

    async def on_submit(self, interaction: discord.Interaction):
        guild = interaction.guild
        target_channel = guild.get_channel(self.target_channel_id)
        if not target_channel:
            await interaction.response.send_message("❌ لم يتم العثور على الروم المحددة!", ephemeral=True)
            return

        embed = discord.Embed(title=self.panel_title.value, description=self.panel_desc.value, color=discord.Color.blurple())
        if guild.icon:
            embed.set_thumbnail(url=guild.icon.url)

        image_url = self.panel_image.value.strip()
        if image_url:
            if image_url.startswith(("http://", "https://")):
                embed.set_image(url=image_url)
            else:
                await interaction.response.send_message("❌ رابط الصورة غير صالح، يجب أن يبدأ بـ http:// أو https://", ephemeral=True)
                return

        view = PanelTypeChoiceView(target_channel, embed, self.applies_dict)
        await interaction.response.send_message("🔘 حدد طريقة عرض التقديمات في البانل:", view=view, ephemeral=True)


class PanelTypeChoiceView(View):
    def __init__(self, target_channel, embed, applies_dict):
        super().__init__(timeout=180)
        self.target_channel = target_channel
        self.embed = embed
        self.applies_dict = applies_dict

    @discord.ui.button(label="أزرار", style=discord.ButtonStyle.primary, emoji="🔘")
    async def buttons_mode(self, interaction: discord.Interaction, button: Button):
        await self.send_panel(interaction, "buttons")

    @discord.ui.button(label="قائمة منسدلة", style=discord.ButtonStyle.success, emoji="📜")
    async def dropdown_mode(self, interaction: discord.Interaction, button: Button):
        await self.send_panel(interaction, "dropdown")

    async def send_panel(self, interaction: discord.Interaction, display_type: str):
        guild_id = interaction.guild.id
        panel_id = uuid.uuid4().hex[:12]
        view = build_panel_view(guild_id, panel_id, display_type, self.applies_dict)

        try:
            msg = await self.target_channel.send(embed=self.embed, view=view)
        except discord.HTTPException:
            await interaction.response.edit_message(content="❌ تعذر الإرسال في هذه الروم (تأكد من صلاحيات البوت).", view=None)
            return

        # حفظ البانل لإعادة تسجيله بعد إعادة تشغيل البوت
        panels = load_json(PANELS_FILE)
        panels[str(msg.id)] = {
            "guild_id": guild_id,
            "panel_id": panel_id,
            "display": display_type,
            "nums": list(self.applies_dict.keys()),
        }
        save_json(PANELS_FILE, panels)

        await interaction.response.edit_message(
            content=f"✅ تم إرسال بانل التقديم بنجاح إلى الروم {self.target_channel.mention}!",
            view=None,
        )


class PanelSelectAppliesDropdown(Select):
    def __init__(self, target_channel_id, applies_dict):
        options = [
            discord.SelectOption(label=f"تقديم {num}: {data['name']}"[:100], value=str(num), emoji="📌")
            for num, data in sorted(applies_dict.items(), key=lambda x: int(x[0]))
        ]
        super().__init__(placeholder="اختر التقديمات المراد إظهارها في البانل...", min_values=1, max_values=len(options), options=options)
        self.target_channel_id = target_channel_id
        self.applies_dict = applies_dict

    async def callback(self, interaction: discord.Interaction):
        sub_dict = {num: self.applies_dict[num] for num in self.values}
        await interaction.response.send_modal(PanelEmbedModal(self.target_channel_id, sub_dict))


class PanelAppliesSelectionView(View):
    def __init__(self, target_channel_id, applies_dict):
        super().__init__(timeout=180)
        self.add_item(PanelSelectAppliesDropdown(target_channel_id, applies_dict))


class ChannelSelectDropdownForPanel(discord.ui.ChannelSelect):
    def __init__(self):
        super().__init__(
            placeholder="ابحث واختر روم إرسال بانل التقديم...",
            min_values=1,
            max_values=1,
            channel_types=[discord.ChannelType.text],
        )

    async def callback(self, interaction: discord.Interaction):
        target_channel_id = self.values[0].id
        guild_id = str(interaction.guild.id)
        data = load_data()

        if guild_id not in data or not data[guild_id]:
            await interaction.response.edit_message(content="❌ لا توجد أي تقديمات مسجلة! استخدم أمر `/اعداد-تقديم` أولاً.", view=None)
            return

        view = PanelAppliesSelectionView(target_channel_id, data[guild_id])
        await interaction.response.edit_message(content="📋 حدد التقديمات التي تريد إظهارها في البانل:", view=view)


class ChannelSelectForPanel(View):
    def __init__(self):
        super().__init__(timeout=180)
        self.add_item(ChannelSelectDropdownForPanel())


# ==========================================
# 5. كلاس الأوامر الأساسي (Cog)
# ==========================================
class SetupApply(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    async def cog_load(self):
        # أزرار القبول والرفض (تقرأ بياناتها من الملف حسب رقم الرسالة)
        self.bot.add_view(ApplyReviewView())

        # إعادة تسجيل البانلات المرسلة سابقاً
        data = load_data()
        panels = load_json(PANELS_FILE)
        for message_id, p in panels.items():
            guild_applies = data.get(str(p["guild_id"]), {})
            applies = {n: guild_applies[n] for n in p["nums"] if n in guild_applies}
            if not applies:
                continue
            view = build_panel_view(p["guild_id"], p["panel_id"], p["display"], applies)
            self.bot.add_view(view, message_id=int(message_id))

    async def send_panel(self, guild, channel_id, title, desc, image, display_type, nums):
        """يرسل بانل التقديمات (تستخدمه لوحة التحكم). display_type: buttons أو dropdown"""
        ch = guild.get_channel(channel_id)
        if not ch or not hasattr(ch, "send"):
            raise ValueError("الروم غير موجود")
        guild_applies = load_data().get(str(guild.id), {})
        applies = {str(n): guild_applies[str(n)] for n in nums if str(n) in guild_applies}
        if not applies:
            raise ValueError("التقديمات المحددة غير مسطّبة")
        embed = discord.Embed(title=title, description=desc, color=discord.Color.blurple())
        if guild.icon:
            embed.set_thumbnail(url=guild.icon.url)
        if image:
            embed.set_image(url=image)
        panel_id = uuid.uuid4().hex[:12]
        view = build_panel_view(guild.id, panel_id, display_type, applies)
        msg = await ch.send(embed=embed, view=view)
        # حفظ البانل لإعادة تسجيله بعد إعادة تشغيل البوت
        panels = load_json(PANELS_FILE)
        panels[str(msg.id)] = {"guild_id": guild.id, "panel_id": panel_id, "display": display_type, "nums": list(applies.keys())}
        save_json(PANELS_FILE, panels)
        return msg

    @app_commands.command(name="اعداد-تقديم", description="إعداد تقديم جديد وتحديد الخيارات والأسئلة")
    @app_commands.guild_only()
    @app_commands.default_permissions(administrator=True)
    @app_commands.checks.has_permissions(administrator=True)
    @describe(
        apply_number="رقم التقديم (من 1 إلى 10)",
        name="اسم التقديم",
        admin_role="رتبة المسؤول عن القبول أو الإدارة",
        review_channel="روم القبول والرفض ومراجعة التقديمات",
        accept_msg="رسالة القبول في الخاص",
        reject_msg="رسالة الرفض في الخاص",
        given_role_1="رتبة معطاة أولى (اختياري)",
        given_role_2="رتبة معطاة ثانية (اختياري)",
        removed_role="رتبة تزال عند القبول (اختياري)",
    )
    @app_commands.rename(
        apply_number="رقم_التقديم",
        name="اسم_التقديم",
        admin_role="رتبة_المسؤول",
        review_channel="روم_المراجعة",
        accept_msg="رسالة_القبول",
        reject_msg="رسالة_الرفض",
        given_role_1="رتبة_معطاة_1",
        given_role_2="رتبة_معطاة_2",
        removed_role="رتبة_تزال",
    )
    async def setup_apply(
        self,
        interaction: discord.Interaction,
        apply_number: int,
        name: str,
        admin_role: discord.Role,
        review_channel: discord.TextChannel,
        accept_msg: str,
        reject_msg: str,
        given_role_1: Optional[discord.Role] = None,
        given_role_2: Optional[discord.Role] = None,
        removed_role: Optional[discord.Role] = None,
    ):
        if not (1 <= apply_number <= 10):
            await interaction.response.send_message("❌ يجب أن يكون رقم التقديم بين 1 و 10 تماماً!", ephemeral=True)
            return

        given_roles_ids = [r.id for r in (given_role_1, given_role_2) if r]

        base_data = {
            "num": str(apply_number),
            "name": name[:90],
            "admin_role_id": admin_role.id,
            "review_channel_id": review_channel.id,
            "accept_msg": accept_msg,
            "reject_msg": reject_msg,
            "given_roles_ids": given_roles_ids,
            "removed_role_id": removed_role.id if removed_role else None,
        }

        await interaction.response.send_modal(SetupQuestionsModal(base_data))

    @app_commands.command(name="لوحة-التقديمات", description="إرسال بانل التقديمات الرئيسي للسيرفر")
    @app_commands.guild_only()
    @app_commands.default_permissions(administrator=True)
    @app_commands.checks.has_permissions(administrator=True)
    async def panel_apply(self, interaction: discord.Interaction):
        await interaction.response.send_message(
            "🔍 اختر الروم المراد إرسال بانل التقديمات إليه:",
            view=ChannelSelectForPanel(),
            ephemeral=True,
        )

    async def cog_app_command_error(self, interaction: discord.Interaction, error: app_commands.AppCommandError):
        if isinstance(error, app_commands.MissingPermissions):
            msg = "❌ هذا الأمر للمسؤولين فقط!"
            if interaction.response.is_done():
                await interaction.followup.send(msg, ephemeral=True)
            else:
                await interaction.response.send_message(msg, ephemeral=True)
        else:
            raise error


async def setup(bot):
    await bot.add_cog(SetupApply(bot))
