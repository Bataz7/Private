from datetime import datetime, timedelta
import json
import os
import re
import discord
from discord import app_commands
from discord.ext import commands, tasks

# استيراد دالة خصم الأموال من البنك
from cogs.bank import deduct_money

DATA_FILE = "vehicles_data.json"
CONFIG_FILE = "vehicles_config.json"
REGISTRATION_FEE = 750
PLATE_FEE = 850  # رسوم استخراج اللوحة الإجبارية
INSURANCE_FEE = 1000
TARGET_IBAN = "3554"

# نمط التحقق من صيغة اللوحة المطلوبة
PLATE_REGEX = re.compile(r"^[\u0600-\u06FFa-zA-Z0-9\s\-]+-\d+$")


class VehicleModal(discord.ui.Modal, title="تسجيل مركبة واستخراج لوحة"):
  real_name = discord.ui.TextInput(
      label="1. اسمك الحقيقي",
      placeholder="اكتب اسمك الحقيقي هنا...",
      required=True,
  )
  real_age = discord.ui.TextInput(
      label="2. عمرك الحقيقي", placeholder="اكتب عمرك هنا...", required=True
  )
  id_number = discord.ui.TextInput(
      label="3. رقم الهوية", placeholder="اكتب رقم الهوية هنا...", required=True
  )
  vehicle_name = discord.ui.TextInput(
      label="4. اسم المركبة",
      placeholder="مثال: كامري، تشارجر...",
      required=True,
  )
  vehicle_company = discord.ui.TextInput(
      label="5. شركة المركبة", placeholder="مثال: تويوتا، دودج...", required=True
  )

  def __init__(self, main_cog, user_id):
    super().__init__()
    self.main_cog = main_cog
    self.user_id = user_id

  async def on_submit(self, interaction: discord.Interaction):
    data = {
        "name": self.real_name.value,
        "age": self.real_age.value,
        "id_num": self.id_number.value,
        "v_name": self.vehicle_name.value,
        "v_company": self.vehicle_company.value,
    }
    await interaction.response.send_message(
        f"✅ تم استلام المعلومات الأساسية!\n📌 سيتم إكمال إجراءات استخراج اللوحة"
        f" (رسومها `{PLATE_FEE}` ريال) وتسجيل المركبة (رسومها"
        f" `{REGISTRATION_FEE}` ريال) عبر الخاص (DM).",
        ephemeral=True,
    )
    await self.main_cog.continue_private_questions(
        interaction.user, data, interaction.guild.id
    )


class InsuranceSelect(discord.ui.Select):

  def __init__(self, cog, vehicles, user_id):
    self.cog = cog
    self.user_id = user_id
    options = []
    for index, v in enumerate(vehicles):
      label = (
          f"{v.get('company', '')} {v.get('name', 'مركبة')} (لوحة:"
          f" {v.get('plate', 'بدون')})"
      )[:100]
      desc = (
          f"اللون: {v.get('color', 'غير متوفر')} | الحالة:"
          f" {'مؤمنة 🟢' if v.get('insured') else 'غير مؤمنة 🔴'}"
      )[:100]
      options.append(
          discord.SelectOption(
              label=label, description=desc, value=str(index)
          )
      )

    super().__init__(
        placeholder="اختر المركبة المراد تأمينها...",
        min_values=1,
        max_values=1,
        options=options,
    )

  async def callback(self, interaction: discord.Interaction):
    selected_index = int(self.values[0])
    user_vehicles = self.cog.data.get(self.user_id, [])

    if selected_index >= len(user_vehicles):
      await interaction.response.send_message(
          "❌ حدث خطأ، المركبة غير موجودة.", ephemeral=True
      )
      return

    vehicle = user_vehicles[selected_index]
    await interaction.response.send_message(
        f"✅ تم اختيار المركبة (`{vehicle.get('plate')}`). تابع الخطوات في الخاص"
        " (DM).",
        ephemeral=True,
    )
    await self.cog.start_insurance_questions(
        interaction.user, interaction.guild.id, vehicle
    )


class InsuranceSelectView(discord.ui.View):

  def __init__(self, cog, vehicles, user_id):
    super().__init__(timeout=60)
    self.add_item(InsuranceSelect(cog, vehicles, user_id))


# --- قائمة منسدلة لعرض مركبات المواطن ---
class ViewVehicleSelect(discord.ui.Select):

  def __init__(self, cog, vehicles, user_id):
    self.cog = cog
    self.user_id = user_id
    options = []
    for index, v in enumerate(vehicles):
      label = (
          f"{v.get('company', '')} {v.get('name', 'مركبة')} (لوحة:"
          f" {v.get('plate', 'بدون')})"
      )[:100]
      desc = (
          f"اللون: {v.get('color', 'غير متوفر')} | الحالة:"
          f" {'مؤمنة 🟢' if v.get('insured') else 'غير مؤمنة 🔴'}"
      )[:100]
      options.append(
          discord.SelectOption(
              label=label, description=desc, value=str(index)
          )
      )

    super().__init__(
        placeholder="اختر المركبة التي تريد عرض تفاصيلها...",
        min_values=1,
        max_values=1,
        options=options,
    )

  async def callback(self, interaction: discord.Interaction):
    selected_index = int(self.values[0])
    user_vehicles = self.cog.data.get(self.user_id, [])

    if selected_index >= len(user_vehicles):
      await interaction.response.send_message(
          "❌ حدث خطأ، المركبة غير موجودة.", ephemeral=True
      )
      return

    v = user_vehicles[selected_index]

    insurance_status = "❌ غير مؤمنة"
    if v.get("insured"):
      try:
        exp_date = datetime.fromisoformat(v["insurance_expiry"])
        if datetime.utcnow() < exp_date:
          insurance_status = (
              f"✅ مؤمنة (تنتهي في: {exp_date.strftime('%Y-%m-%d')})"
          )
        else:
          insurance_status = "⚠️ انتهى التأمين"
      except Exception:
        insurance_status = "❌ غير مؤمنة"

    embed = discord.Embed(
        title=(
            "🚙 تفاصيل المركبة:"
            f" {v.get('company', '')} {v.get('name', '')}"
        ),
        color=discord.Color.blue(),
    )
    embed.add_field(
        name="الشركة والنوع",
        value=f"{v.get('company', 'غير متوفر')} {v.get('name', 'غير متوفر')}",
        inline=True,
    )
    embed.add_field(
        name="رقم اللوحة", value=f"`{v.get('plate', 'بدون لوحة')}`", inline=True
    )
    embed.add_field(name="اللون", value=v.get("color", "غير متوفر"), inline=True)
    embed.add_field(
        name="حالة التأمين", value=insurance_status, inline=False
    )
    embed.add_field(
        name="الاسم الحقيقي والعمر",
        value=(
            f"{v.get('real_name', 'غير متوفر')} (العمر:"
            f" {v.get('age', 'غير متوفر')})"
        ),
        inline=False,
    )
    embed.add_field(
        name="رقم الهوية", value=v.get("id_num", "غير متوفر"), inline=True
    )

    if v.get("image"):
      embed.set_image(url=v["image"])

    await interaction.response.send_message(embed=embed, ephemeral=True)


class ViewVehicleSelectView(discord.ui.View):

  def __init__(self, cog, vehicles, user_id):
    super().__init__(timeout=60)
    self.add_item(ViewVehicleSelect(cog, vehicles, user_id))


# --- قائمة منسدلة لسحب التأمين إدارياً للأعضاء ---
class AdminRevokeInsuranceSelect(discord.ui.Select):

  def __init__(self, cog, insured_list):
    self.cog = cog
    options = []
    for item in insured_list:
      u_id = item["user_id"]
      v_idx = item["vehicle_index"]
      v = item["vehicle"]
      member = item["member"]

      display_name = member.display_name if member else f"مواطن ({u_id})"
      label = f"{display_name} - {v.get('company')} {v.get('name')}"[:100]
      desc = f"اللوحة: {v.get('plate')} | ID: {u_id}"[:100]
      value = f"{u_id}_{v_idx}"

      options.append(
          discord.SelectOption(
              label=label, description=desc, value=value, emoji="🛡️"
          )
      )

    super().__init__(
        placeholder="اختر المركبة المؤمنة لسحب التأمين عنها...",
        min_values=1,
        max_values=1,
        options=options,
    )

  async def callback(self, interaction: discord.Interaction):
    if not interaction.user.guild_permissions.administrator:
      return await interaction.response.send_message(
          "❌ عذراً، هذا الخيار مخصص للأدمستريتر (Administrator) فقط!",
          ephemeral=True,
      )

    val_parts = self.values[0].split("_")
    user_id_str = val_parts[0]
    v_index = int(val_parts[1])

    user_vehicles = self.cog.data.get(user_id_str, [])
    if v_index >= len(user_vehicles):
      return await interaction.response.send_message(
          "❌ حدث خطأ، المركبة غير موجودة أو تم حذفها مسبقاً.", ephemeral=True
      )

    vehicle = user_vehicles[v_index]
    if not vehicle.get("insured"):
      return await interaction.response.send_message(
          "❌ هذه المركبة ليست مؤمنة أساساً!", ephemeral=True
      )

    # إلغاء التأمين
    vehicle["insured"] = False
    vehicle["insurance_expiry"] = None
    vehicle["expired_notified"] = False
    self.cog.save_json(DATA_FILE, self.cog.data)

    plate = vehicle.get("plate", "غير معروف")
    guild = interaction.guild

    # إرسال إشعار بالخاص (DM) للمواطن
    try:
      target_user = await interaction.client.fetch_user(int(user_id_str))
      if target_user:
        await target_user.send(
            f"⚠️ **تنبيه سحب التأمين:**\nعزيزي المواطن، تم سحب تأمين مركبتك (لوحة:"
            f" `{plate}`) رسمياً في سيرفر **{guild.name}** من قِبل الإدارة."
        )
    except Exception:
      pass

    # توثيق العملية في روم اللوق إن وجدت
    guild_cfg = self.cog.config.get(str(guild.id))
    if guild_cfg and guild_cfg.get("log_channel"):
      log_channel = guild.get_channel(guild_cfg["log_channel"])
      if log_channel:
        embed = discord.Embed(
            title="🚫 سحب تأمين مركبة إدارياً",
            description=(
                f"قام الإداري {interaction.user.mention} بسحب تأمين المركبة"
                f" الخاصة بالمواطن <@{user_id_str}> ذات اللوحة (`{plate}`)."
            ),
            color=discord.Color.dark_red(),
            timestamp=datetime.utcnow(),
        )
        embed.set_footer(text=f"معرف المواطن: {user_id_str}")
        await log_channel.send(embed=embed)

    await interaction.response.edit_message(
        content=(
            f"✅ تم سحب التأمين عن مركبة المواطن <@{user_id_str}> (لوحة:"
            f" `{plate}`) بنجاح وتم إشعاره بالخاص!"
        ),
        view=None,
    )


class AdminRevokeInsuranceView(discord.ui.View):

  def __init__(self, cog, insured_list):
    super().__init__(timeout=60)
    self.add_item(AdminRevokeInsuranceSelect(cog, insured_list))


# --- القائمة الرئيسية المدمجة لجميع الخيارات (Select Menu) ---
class VehicleMainSelect(discord.ui.Select):

  def __init__(self, cog):
    self.cog = cog
    options = [
        discord.SelectOption(
            label="تسجيل مركبة ولوحة",
            description="تسجيل مركبة جديدة واستخراج لوحة رسمية مرورية",
            emoji="🚗",
            value="register_vehicle",
        ),
        discord.SelectOption(
            label="شراء تأمين",
            description="إصدار تأمين لمدة أسبوع للمركبة المختارة",
            emoji="🛡️",
            value="buy_insurance",
        ),
        discord.SelectOption(
            label="عرض مركباتي",
            description="استعراض تفاصيل مركباتك وحالة التأمين واللوحة",
            emoji="📋",
            value="view_vehicles",
        ),
        discord.SelectOption(
            label="سحب تأمين (للأدمن)",
            description="سحب تأمين مركبة لمواطن وإشعاره بالخاص",
            emoji="🚫",
            value="revoke_insurance",
        ),
    ]
    super().__init__(
        placeholder="اختر الخدمة المطلوبة من القائمة...",
        min_values=1,
        max_values=1,
        options=options,
        custom_id="vehicle_main_select_menu",
    )

  async def callback(self, interaction: discord.Interaction):
    choice = self.values[0]
    user_id = str(interaction.user.id)

    if choice == "register_vehicle":
      user_vehicles = self.cog.data.get(user_id, [])
      if len(user_vehicles) >= 3:
        return await interaction.response.send_message(
            "❌ عذراً، لقد وصلت للحد الأقصى (3 مركبات).", ephemeral=True
        )
      await interaction.response.send_modal(
          VehicleModal(self.cog, user_id)
      )

    elif choice == "buy_insurance":
      vehicles = self.cog.data.get(user_id, [])
      if not vehicles:
        return await interaction.response.send_message(
            "❌ ليس لديك أي مركبات مسجلة لتأمينها! يرجى تسجيل مركبة أولاً.",
            ephemeral=True,
        )
      view = InsuranceSelectView(self.cog, vehicles, user_id)
      await interaction.response.send_message(
          "🛡️ **اختر من القائمة أدناه المركبة التي تريد إصدار تأمين لها:**",
          view=view,
          ephemeral=True,
      )

    elif choice == "view_vehicles":
      vehicles = self.cog.data.get(user_id, [])
      if not vehicles:
        return await interaction.response.send_message(
            "❌ ليس لديك أي مركبات مسجلة في النظام حالياً.", ephemeral=True
        )
      view = ViewVehicleSelectView(self.cog, vehicles, user_id)
      await interaction.response.send_message(
          "📋 **اختر من القائمة أدناه المركبة التي تريد عرض تفاصيلها:**",
          view=view,
          ephemeral=True,
      )

    elif choice == "revoke_insurance":
      if not interaction.user.guild_permissions.administrator:
        return await interaction.response.send_message(
            "❌ عذراً، خيار سحب التأمين مخصص للأدمستريتر (Administrator) فقط!",
            ephemeral=True,
        )

      insured_list = []
      for u_str, vehicles in self.cog.data.items():
        try:
          member = interaction.guild.get_member(
              int(u_str)
          ) or await interaction.guild.fetch_member(int(u_str))
        except Exception:
          member = None

        for idx, v in enumerate(vehicles):
          if v.get("insured"):
            insured_list.append({
                "user_id": u_str,
                "vehicle_index": idx,
                "vehicle": v,
                "member": member,
            })

      if not insured_list:
        return await interaction.response.send_message(
            "❌ لا توجد أي مركبات مؤمنة حالياً لسحب التأمين عنها!",
            ephemeral=True,
        )

      if len(insured_list) > 25:
        insured_list = insured_list[:25]  # أقصى حد لعناصر القائمة في ديسكورد

      view = AdminRevokeInsuranceView(self.cog, insured_list)
      await interaction.response.send_message(
          "🚫 **لوحة سحب التأمين الإدارية:**\nاختر المركبة المراد سحب التأمين"
          " عنها من القائمة أدناه:",
          view=view,
          ephemeral=True,
      )


class VehicleView(discord.ui.View):

  def __init__(self, cog):
    super().__init__(timeout=None)
    self.add_item(VehicleMainSelect(cog))


class VehicleSystem(commands.Cog):

  def __init__(self, bot):
    self.bot = bot
    self.data = self.load_json(DATA_FILE)
    self.config = self.load_json(CONFIG_FILE)
    self.check_insurance_expiry.start()

  def cog_unload(self):
    self.check_insurance_expiry.cancel()

  def load_json(self, filename):
    if os.path.exists(filename):
      try:
        with open(filename, "r", encoding="utf-8") as f:
          return json.load(f)
      except Exception:
        return {}
    return {}

  def save_json(self, filename, data):
    with open(filename, "w", encoding="utf-8") as f:
      json.dump(data, f, ensure_ascii=False, indent=4)

  @commands.Cog.listener()
  async def on_ready(self):
    self.bot.add_view(VehicleView(self))

  @tasks.loop(minutes=30)
  async def check_insurance_expiry(self):
    now = datetime.utcnow()
    updated = False
    for user_id, vehicles in self.data.items():
      for v in vehicles:
        if v.get("insured") and not v.get("expired_notified", False):
          try:
            exp_date = datetime.fromisoformat(v["insurance_expiry"])
            if now >= exp_date:
              v["expired_notified"] = True
              updated = True
              try:
                user = await self.bot.fetch_user(int(user_id))
                if user:
                  await user.send(
                      "⚠️ **تنبيه انتهاء التأمين:** لقد انتهت صلاحية تأمين"
                      " مركبتك (لوحة:"
                      f" `{v.get('plate', 'غير معروف')}`). يجب عليك إصدار تأمين"
                      " جديد عبر البانل ✅"
                  )
              except Exception:
                pass
          except Exception:
            continue
    if updated:
      self.save_json(DATA_FILE, self.data)

  @check_insurance_expiry.before_loop
  async def before_check_insurance(self):
    await self.bot.wait_until_ready()

  @app_commands.command(
      name="setup_vehicle",
      description="إعداد نظام المركبات واللوحات وتحديد الرومات",
  )
  @app_commands.describe(
      panel_channel="روم بانل تسجيل المركبات والتأمين",
      log_channel="روم لوقز العمليات",
      insured_channel="روم المركبات المؤمنة الجديدة",
  )
  @app_commands.checks.has_permissions(administrator=True)
  async def setup_vehicle(
      self,
      interaction: discord.Interaction,
      panel_channel: discord.TextChannel,
      log_channel: discord.TextChannel,
      insured_channel: discord.TextChannel,
  ):
    guild_id = str(interaction.guild.id)

    if guild_id not in self.config:
      self.config[guild_id] = {}

    self.config[guild_id]["panel_channel"] = panel_channel.id
    self.config[guild_id]["log_channel"] = log_channel.id
    self.config[guild_id]["insured_channel"] = insured_channel.id
    self.save_json(CONFIG_FILE, self.config)

    embed = discord.Embed(
        title="📌 نظام تسجيل المركبات واللوحات المرورية والتأمين",
        description=(
            "استخدم القائمة أدناه لتسجيل مركبة واستخراج لوحتها الرسمية (رسوم"
            f" اللوحة: **{PLATE_FEE} ريال** + رسوم التسجيل:"
            f" **{REGISTRATION_FEE} ريال**) أو شراء تأمين للمركبة (رسوم:"
            f" **{INSURANCE_FEE} ريال**) تُحول إلى إيبان `{TARGET_IBAN}`."
        ),
        color=discord.Color.green(),
    )
    view = VehicleView(self)
    await panel_channel.send(embed=embed, view=view)

    await interaction.response.send_message(
        "✅ تم إعداد النظام بنجاح!\n- **روم البانل:**"
        f" {panel_channel.mention}\n- **روم اللوق:**"
        f" {log_channel.mention}\n- **روم المركبات المؤمنة:**"
        f" {insured_channel.mention}",
        ephemeral=True,
    )

  # ------------------ أمر الإدارة: حذف مركبة مواطن ------------------
  @app_commands.command(
      name="admin_remove_vehicle",
      description=(
          "[إدارة] حذف مركبة معينة لمواطن باستخدام رقم اللوحة"
      ),
  )
  @app_commands.describe(
      member="العضو صاحب المركبة", plate="رقم اللوحة المراد حذفها"
  )
  @app_commands.checks.has_permissions(administrator=True)
  async def admin_remove_vehicle(
      self,
      interaction: discord.Interaction,
      member: discord.Member,
      plate: str,
  ):
    user_id = str(member.id)
    if user_id not in self.data or not self.data[user_id]:
      await interaction.response.send_message(
          f"❌ العضو {member.mention} ليس لديه أي مركبات مسجلة.", ephemeral=True
      )
      return

    found = False
    for v in self.data[user_id]:
      if v.get("plate", "").strip().lower() == plate.strip().lower():
        self.data[user_id].remove(v)
        found = True
        break

    if found:
      self.save_json(DATA_FILE, self.data)
      await interaction.response.send_message(
          f"✅ تم بنجاح حذف المركبة التي تحمل اللوحة (`{plate}`) الخاصة بالمواطن"
          f" {member.mention}.",
          ephemeral=True,
      )
    else:
      await interaction.response.send_message(
          f"❌ لم يتم العثور على مركبة تحمل اللوحة (`{plate}`) لهذا العضو.",
          ephemeral=True,
      )

  async def continue_private_questions(
      self, user: discord.User, initial_data: dict, guild_id: int
  ):
    try:
      dm_channel = await user.create_dm()

      def check(m):
        return m.author == user and isinstance(m.channel, discord.DMChannel)

      # 1. استخراج اللوحة المرورية إجبارياً بالصيغة المحددة
      await dm_channel.send(
          "🪧 **أدخل رقم اللوحة المرورية المطلوبة:**\n• يجب أن تكون بالصيغة الصحيحة"
          " وتحتوي على شرطة (-) وأرقام.\n• أمثلة صحيحة: `ABM-123` أو"
          " `أبج-1234`"
      )

      plate = None
      while True:
        msg = await self.bot.wait_for("message", check=check, timeout=60.0)
        content = msg.content.strip()
        if PLATE_REGEX.match(content):
          plate = content
          break
        else:
          await dm_channel.send(
              "❌ **الصيغة غير صحيحة!** يرجى كتابة اللوحة بالصيغة المطلوبة (مثال:"
              " `ABM-123` أو `XYZ-987`):"
          )

      # 2. لون المركبة
      await dm_channel.send("🎨 أرسل الآن **لون المركبة**:")
      msg = await self.bot.wait_for("message", check=check, timeout=60.0)
      color = msg.content

      # 3. صورة المركبة (مع التحقق الإلزامي)
      await dm_channel.send(
          "🖼️ أرسل الآن **صورة للمركبة** (يجب إرفاق ملف صورة حصراً، النصوص غير"
          " مقبولة):"
      )

      image_url = None
      while True:
        msg = await self.bot.wait_for("message", check=check, timeout=60.0)
        if msg.attachments:
          attachment = msg.attachments[0]
          if any(
              attachment.filename.lower().endswith(ext)
              for ext in [".png", ".jpg", ".jpeg", ".webp", ".gif"]
          ):
            image_url = attachment.url
            break
          else:
            await dm_channel.send(
                "❌ الملف المرسل ليس صورة! يرجى إرفاق صورة صحيحة (PNG, JPG):"
            )
        else:
          await dm_channel.send(
              "❌ ممنوع إرسال نصوص هنا! يرجى **إرفاق صورة** للمركبة:"
          )

      # 4. خصم رسوم اللوحة ورسوم التسجيل معاً
      total_fees = PLATE_FEE + REGISTRATION_FEE
      success = await deduct_money(user.id, guild_id, total_fees)
      if not success:
        await dm_channel.send(
            "❌ **فشلت عملية التسجيل:** رصيدك البنكي لا يكفي لدفع إجمالي الرسوم"
            f" (`{total_fees}` ريال: {PLATE_FEE} لوحة + {REGISTRATION_FEE}"
            " تسجيلاً) أو أنك غير مسجل في البنك."
        )
        return

      vehicle_info = {
          "real_name": initial_data["name"],
          "age": initial_data["age"],
          "id_num": initial_data["id_num"],
          "name": initial_data["v_name"],
          "company": initial_data["v_company"],
          "plate": plate,
          "color": color,
          "image": image_url,
          "insured": False,
      }

      str_user_id = str(user.id)
      if str_user_id not in self.data:
        self.data[str_user_id] = []

      self.data[str_user_id].append(vehicle_info)
      self.save_json(DATA_FILE, self.data)

      await dm_channel.send(
          f"✅ تم خصم إجمالي الرسوم (`{total_fees}` ريال) بنجاح، واستخراج اللوحة"
          f" (`{plate}`) وتسجيل المركبة في النظام بشكل دائم!"
      )

      guild_obj = self.bot.get_guild(guild_id)
      if guild_obj:
        guild_cfg = self.config.get(str(guild_id))
        if guild_cfg and guild_cfg.get("log_channel"):
          log_channel = guild_obj.get_channel(guild_cfg["log_channel"])
          if log_channel:
            log_embed = discord.Embed(
                title="🚗 تسجيل مركبة واستخراج لوحة جديد (مدفوع)",
                color=discord.Color.green(),
            )
            log_embed.add_field(
                name="صاحب المركبة",
                value=f"{user.mention} (`{user.id}`)",
                inline=False,
            )
            log_embed.add_field(
                name="الاسم الحقيقي والعمر",
                value=(
                    f"{initial_data['name']} (العمر:"
                    f" {initial_data['age']})"
                ),
                inline=True,
            )
            log_embed.add_field(
                name="رقم الهوية", value=initial_data["id_num"], inline=True
            )
            log_embed.add_field(
                name="المركبة والشركة",
                value=(
                    f"{initial_data['v_company']} {initial_data['v_name']}"
                ),
                inline=True,
            )
            log_embed.add_field(
                name="رقم اللوحة المستخرجة", value=f"`{plate}`", inline=True
            )
            log_embed.add_field(name="اللون", value=color, inline=True)
            log_embed.add_field(
                name="الرسوم المدفوعة",
                value=(
                    f"لوحة ({PLATE_FEE}) + تسجيلاً ({REGISTRATION_FEE}) ="
                    f" `{total_fees} ريال`"
                ),
                inline=False,
            )
            if image_url:
              log_embed.set_image(url=image_url)
            await log_channel.send(embed=log_embed)

    except TimeoutError:
      await user.send(
          "⏰ انتهى الوقت المخصص للإجابة، يرجى إعادة المحاولة من البانل الأساسي."
      )

  async def start_insurance_questions(
      self, user: discord.User, guild_id: int, selected_vehicle: dict
  ):
    try:
      dm_channel = await user.create_dm()

      def check(m):
        return m.author == user and isinstance(m.channel, discord.DMChannel)

      role_name = selected_vehicle.get("real_name", "غير متوفر")
      role_age = selected_vehicle.get("age", "غير متوفر")
      v_type_company = selected_vehicle.get("company", "غير متوفر")
      model = selected_vehicle.get("name", "غير متوفر")
      color = selected_vehicle.get("color", "غير متوفر")
      plate = selected_vehicle.get("plate", "غير متوفر")

      await dm_channel.send(
          f"🛡️ **استكمال تأمين المركبة المختارة:**\n• الشركة والنوع:"
          f" `{v_type_company} {model}`\n• اللوحة: `{plate}`\n• اللون:"
          f" `{color}`\n\n🖼️ أرسل الآن **صورة للمركبة** (أو أعد إرسال صورتها لتأكيد"
          " التأمين):"
      )

      image_url = selected_vehicle.get("image")
      while True:
        msg = await self.bot.wait_for("message", check=check, timeout=60.0)
        if msg.attachments:
          attachment = msg.attachments[0]
          if any(
              attachment.filename.lower().endswith(ext)
              for ext in [".png", ".jpg", ".jpeg", ".webp", ".gif"]
          ):
            image_url = attachment.url
            break
          else:
            await dm_channel.send(
                "❌ الملف المرسل ليس صورة! يرجى إرفاق صورة صحيحة:"
            )
        else:
          await dm_channel.send(
              "❌ ممنوع إرسال نصوص! يرجى **إرفاق صورة** للمركبة:"
          )

      success = await deduct_money(user.id, guild_id, INSURANCE_FEE)
      if not success:
        await dm_channel.send(
            "❌ **فشلت عملية إصدار التأمين:** رصيدك البنكي لا يكفي لدفع رسوم"
            f" التأمين (`{INSURANCE_FEE}` ريال)."
        )
        return

      expiry_date = datetime.utcnow() + timedelta(days=7)

      selected_vehicle["insured"] = True
      selected_vehicle["insurance_expiry"] = expiry_date.isoformat()
      selected_vehicle["expired_notified"] = False
      if image_url:
        selected_vehicle["image"] = image_url

      self.save_json(DATA_FILE, self.data)

      await dm_channel.send(
          f"✅ تم خصم رسوم التأمين (`{INSURANCE_FEE}` ريال) بنجاح وإصدار التأمين"
          f" لمدة **أسبوع (7 أيام)** للمركبة ذات اللوحة (`{plate}`)!"
      )

      guild_obj = self.bot.get_guild(guild_id)
      if guild_obj:
        guild_cfg = self.config.get(str(guild_id))
        if guild_cfg:
          if guild_cfg.get("log_channel"):
            log_channel = guild_obj.get_channel(guild_cfg["log_channel"])
            if log_channel:
              log_embed = discord.Embed(
                  title="🛡️ إصدار تأمين مركبة جديد",
                  color=discord.Color.purple(),
              )
              log_embed.add_field(
                  name="صاحب التأمين",
                  value=f"{user.mention} (`{user.id}`)",
                  inline=False,
              )
              log_embed.add_field(
                  name="الاسم والعمر",
                  value=f"{role_name} (العمر: {role_age})",
                  inline=True,
              )
              log_embed.add_field(
                  name="المركبة والشركة",
                  value=f"{v_type_company} {model}",
                  inline=True,
              )
              log_embed.add_field(name="اللون", value=color, inline=True)
              log_embed.add_field(
                  name="رقم اللوحة", value=f"`{plate}`", inline=True
              )
              log_embed.add_field(
                  name="تاريخ الانتهاء",
                  value=expiry_date.strftime("%Y-%m-%d %H:%M"),
                  inline=False,
              )
              if image_url:
                log_embed.set_image(url=image_url)
              await log_channel.send(embed=log_embed)

          if guild_cfg.get("insured_channel"):
            insured_channel = guild_obj.get_channel(
                guild_cfg["insured_channel"]
            )
            if insured_channel:
              ins_embed = discord.Embed(
                  title="🚙 مركبة مؤمنة جديدة", color=discord.Color.green()
              )
              ins_embed.add_field(
                  name="المواطن", value=user.mention, inline=False
              )
              ins_embed.add_field(
                  name="نوع المركبة والشركة",
                  value=f"{v_type_company} {model}",
                  inline=True,
              )
              ins_embed.add_field(name="اللون", value=color, inline=True)
              ins_embed.add_field(
                  name="رقم اللوحة", value=f"`{plate}`", inline=True
              )
              ins_embed.add_field(
                  name="صلاحية التأمين",
                  value=f"تنتهي في: {expiry_date.strftime('%Y-%m-%d')}",
                  inline=False,
              )
              if image_url:
                ins_embed.set_image(url=image_url)
              await insured_channel.send(embed=ins_embed)

    except TimeoutError:
      await user.send(
          "⏰ انتهى الوقت المخصص للإجابة، يرجى إعادة المحاولة من البانل الأساسي."
      )


async def setup(bot):
  await bot.add_cog(VehicleSystem(bot))