from datetime import datetime, timedelta
import sqlite3
import discord
from discord import app_commands
from discord.ext import commands, tasks

try:
  from cogs import bank
except ImportError:
  bank = None


class RealEstateCog(commands.Cog):

  def __init__(self, bot):
    self.bot = bot
    self.setup_database()
    self.shop_profits_loop.start()

  def cog_unload(self):
    self.shop_profits_loop.cancel()

  def setup_database(self):
    conn = sqlite3.connect("real_estate.db")
    cursor = conn.cursor()

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS properties (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            property_id TEXT UNIQUE,
            name TEXT,
            category TEXT,
            location TEXT,
            price INTEGER,
            profit_amount INTEGER DEFAULT 0,
            status TEXT DEFAULT 'متاح',
            description TEXT,
            owner_id INTEGER DEFAULT 0,
            last_claimed_timestamp TEXT DEFAULT NULL
        )
        """
    )
    
    try:
      cursor.execute("ALTER TABLE properties ADD COLUMN profit_amount INTEGER DEFAULT 0")
    except sqlite3.OperationalError:
      pass

    try:
      cursor.execute("ALTER TABLE properties ADD COLUMN last_claimed_timestamp TEXT DEFAULT NULL")
    except sqlite3.OperationalError:
      pass

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            channel_id INTEGER
        )
        """
    )
    conn.commit()
    conn.close()

  @commands.Cog.listener()
  async def on_ready(self):
    # تسجيل الـ Views المستمرة لضمان عدم توقف الأزرار عند إعادة تشغيل البوت
    self.bot.add_view(AdminPanelView())
    self.bot.add_view(CitizenPanelView())

  async def send_log(self, guild: discord.Guild, title: str, description: str, color: discord.Color):
    try:
      conn = sqlite3.connect("real_estate.db")
      cursor = conn.cursor()
      cursor.execute("SELECT channel_id FROM settings WHERE key = 'logs_channel'")
      row = cursor.fetchone()
      conn.close()

      if row and row[0]:
        channel = guild.get_channel(row[0])
        if channel:
          embed = discord.Embed(title=title, description=description, color=color, timestamp=datetime.utcnow())
          embed.set_footer(text="نظام العقارات والمحلات - السجلات")
          await channel.send(embed=embed)
    except Exception as e:
      print(f"خطأ في إرسال اللوق: {e}")

  @tasks.loop(hours=48)
  async def shop_profits_loop(self):
    pass

  @shop_profits_loop.before_loop
  async def before_shop_profits_loop(self):
    await self.bot.wait_until_ready()

  @app_commands.command(
      name="اعداد-العقارات",
      description="تسطيب النظام وتحديد رومات المواطنين، الإدارة، الطلبات، سوق البيع، والسجلات",
  )
  @app_commands.rename(
      citizen_channel="روم_المواطنين",
      admin_channel="روم_الادارة",
      requests_channel="روم_الطلبات",
      market_channel="روم_السوق",
      logs_channel="روم_اللوق",
  )
  @app_commands.describe(
      citizen_channel="روم عرض العقارات للمواطنين",
      admin_channel="روم لوحة تحكم المسؤولين",
      requests_channel="روم استقبال طلبات شراء العقارات من النظام",
      market_channel="روم سوق عقارات المواطنين (لبيع العقارات)",
      logs_channel="روم سجلات العمليات (اللوق)",
  )
  @app_commands.checks.has_permissions(administrator=True)
  async def setup_real_estate(
      self,
      interaction: discord.Interaction,
      citizen_channel: discord.TextChannel,
      admin_channel: discord.TextChannel,
      requests_channel: discord.TextChannel,
      market_channel: discord.TextChannel,
      logs_channel: discord.TextChannel,
  ):
    conn = sqlite3.connect("real_estate.db")
    cursor = conn.cursor()
    cursor.execute(
        "INSERT OR REPLACE INTO settings (key, channel_id) VALUES (?, ?)",
        ("requests_channel", requests_channel.id),
    )
    cursor.execute(
        "INSERT OR REPLACE INTO settings (key, channel_id) VALUES (?, ?)",
        ("market_channel", market_channel.id),
    )
    cursor.execute(
        "INSERT OR REPLACE INTO settings (key, channel_id) VALUES (?, ?)",
        ("logs_channel", logs_channel.id),
    )
    conn.commit()
    conn.close()

    admin_embed = discord.Embed(
        title="🏢 إدارة العقارات والمحلات",
        description=(
            "لوحة تحكم المسؤولين\n\nمن هنا تقدر تدير جميع العقارات والمحلات"
            " وأرباحها والطلبات."
        ),
        color=discord.Color.from_rgb(43, 45, 49),
    )
    await admin_channel.send(embed=admin_embed, view=AdminPanelView())

    citizen_embed = discord.Embed(
        title="🏡 سوق العقارات والمحلات والممتلكات",
        description=(
            "اختر القسم المطلوب للاستعراض أو الشراء، أو استعرض ممتلكاتك، أو استلم أرباح محلاتك من القائمة أدناه:"
        ),
        color=discord.Color.green(),
    )
    await citizen_channel.send(embed=citizen_embed, view=CitizenPanelView())

    await interaction.response.send_message(
        f"✅ تم تسطيب النظام بنجاح!\n- روم المواطنين: {citizen_channel.mention}\n- روم الإدارة: {admin_channel.mention}\n- روم طلبات النظام: {requests_channel.mention}\n- روم سوق المواطنين: {market_channel.mention}\n- روم السجلات (اللوق): {logs_channel.mention}",
        ephemeral=True,
    )


class AdminCategoryModal(discord.ui.Modal, title="إضافة عقار أو محل جديد"):
  prop_id = discord.ui.TextInput(
      label="معرف العقار/المحل (مثال: shop_01)", placeholder="shop_01"
  )
  category = discord.ui.TextInput(
      label="القسم (فلل، شقق، محلات، مكاتب، استراحات)", placeholder="محلات"
  )
  location = discord.ui.TextInput(
      label="الموقع / المنطقة", placeholder="حي النخيل"
  )
  price = discord.ui.TextInput(label="سعر الشراء (أرقام فقط)", placeholder="250000")
  profit_amount = discord.ui.TextInput(
      label="الأرباح الدورية (كل 48 ساعة للمحلات)",
      placeholder="اكتب 0 إذا لم يكن محلاً",
      default="0",
  )

  async def on_submit(self, interaction: discord.Interaction):
    try:
      price_val = int(self.price.value)
      profit_val = int(self.profit_amount.value)
    except ValueError:
      await interaction.response.send_message(
          "❌ السعر والأرباح يجب أن تكون أرقاماً صحيحة!", ephemeral=True
      )
      return

    conn = sqlite3.connect("real_estate.db")
    cursor = conn.cursor()
    try:
      cursor.execute(
          """INSERT INTO properties (property_id, name, category, location, price, profit_amount, description, owner_id, status)
                     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'متاح')""",
          (
              self.prop_id.value,
              self.prop_id.value,
              self.category.value,
              self.location.value,
              price_val,
              profit_val,
              "لا يوجد وصف",
          ),
      )
      conn.commit()
     
      cog = interaction.client.get_cog("RealEstateCog")
      if cog:
        await cog.send_log(
            interaction.guild,
            "➕ إضافة عقار/محل جديد",
            f"**المسؤول:** {interaction.user.mention}\n**المعرف:** `{self.prop_id.value}`\n**القسم:** {self.category.value}\n**السعر:** {price_val:,} ريال\n**الأرباح:** {profit_val:,} ريال",
            discord.Color.green()
        )

      await interaction.response.send_message(
          f"✅ تم إضافة `{self.prop_id.value}` بنجاح!", ephemeral=True
      )
    except sqlite3.IntegrityError:
      await interaction.response.send_message(
          "❌ معرف العقار مستخدم مسبقاً.", ephemeral=True
      )
    finally:
      conn.close()


class AdminSelect(discord.ui.Select):

  def __init__(self):
    options = [
        discord.SelectOption(
            label="جميع العقارات والمحلات",
            emoji="🏠",
            value="list",
            description="عرض قائمة بكل العقارات والمحلات المسجلة",
        ),
        discord.SelectOption(
            label="الإحصائيات",
            emoji="📊",
            value="stats",
            description="عرض إحصائيات العقارات",
        ),
        discord.SelectOption(
            label="نقل الملكية",
            emoji="🔄",
            value="transfer",
            description="نقل ملكية عقار لمواطن آخر",
        ),
        discord.SelectOption(
            label="تعديل عقار/محل",
            emoji="✏️",
            value="edit",
            description="تعديل كافة بيانات العقار",
        ),
        discord.SelectOption(
            label="إزالة عقار/محل",
            emoji="🗑️",
            value="delete",
            description="حذف عقار من النظام",
        ),
    ]
    super().__init__(
        placeholder="📋 اختر إجراءً من القائمة...",
        min_values=1,
        max_values=1,
        options=options,
        custom_id="admin_menu_select_v12",
        row=1,
    )

  async def callback(self, interaction: discord.Interaction):
    val = self.values[0]

    if val == "list":
      conn = sqlite3.connect("real_estate.db")
      cursor = conn.cursor()
      cursor.execute(
          "SELECT property_id, name, category, price, profit_amount, status FROM properties"
      )
      props = cursor.fetchall()
      conn.close()

      if not props:
        await interaction.response.send_message(
            "❌ لا توجد أي عقارات أو محلات مسجلة بالنظام حالياً.", ephemeral=True
        )
        return

      embed = discord.Embed(
          title="🏠 جميع العقارات والمحلات المسجلة", color=discord.Color.blue()
      )
      for p in props[:25]:  # حد ديسكورد 25 حقلاً
        profit_text = f"\n💵 الأرباح الدورية: {p[4]:,} ريال" if p[2] == "محلات" else ""
        embed.add_field(
            name=f"{p[1]} ({p[2]})",
            value=(
                f"🆔 المعرف: `{p[0]}`\n💰 السعر: {p[3]:,} ريال{profit_text}\n📌"
                f" الحالة: {p[5]}"
            ),
            inline=False,
        )
      await interaction.response.send_message(embed=embed, ephemeral=True)

    elif val == "stats":
      conn = sqlite3.connect("real_estate.db")
      cursor = conn.cursor()
      cursor.execute("SELECT COUNT(*) FROM properties")
      total = cursor.fetchone()[0]
      cursor.execute("SELECT COUNT(*) FROM properties WHERE status='متاح'")
      available = cursor.fetchone()[0]
      cursor.execute("SELECT COUNT(*) FROM properties WHERE status='مباع'")
      sold = cursor.fetchone()[0]
      conn.close()

      embed = discord.Embed(
          title="📊 إحصائيات العقارات والمحلات", color=discord.Color.gold()
      )
      embed.add_field(name="📦 إجمالي العقارات/المحلات", value=str(total), inline=True)
      embed.add_field(name="🟢 المتاحة", value=str(available), inline=True)
      embed.add_field(name="🔴 المباعة", value=str(sold), inline=True)
      await interaction.response.send_message(embed=embed, ephemeral=True)

    elif val == "transfer":
      conn = sqlite3.connect("real_estate.db")
      cursor = conn.cursor()
      cursor.execute("SELECT property_id, name FROM properties")
      props = cursor.fetchall()
      conn.close()
      if not props:
        await interaction.response.send_message(
            "❌ لا توجد عقارات لنقل ملكيتها.", ephemeral=True
        )
        return
      view = discord.ui.View()
      view.add_item(TransferPropertySelect(props))
      await interaction.response.send_message(
          "🔄 اختر العقار/المحل الذي تريد نقل ملكيته:", view=view, ephemeral=True
      )

    elif val == "edit":
      conn = sqlite3.connect("real_estate.db")
      cursor = conn.cursor()
      cursor.execute("SELECT property_id, name FROM properties")
      props = cursor.fetchall()
      conn.close()
      if not props:
        await interaction.response.send_message(
            "❌ لا توجد عقارات لتعديلها.", ephemeral=True
        )
        return
      view = discord.ui.View()
      view.add_item(EditPropertySelect(props))
      await interaction.response.send_message(
          "✏️ اختر العقار أو المحل الذي تريد تعديل بياناته:", view=view, ephemeral=True
      )

    elif val == "delete":
      conn = sqlite3.connect("real_estate.db")
      cursor = conn.cursor()
      cursor.execute("SELECT property_id, name FROM properties")
      props = cursor.fetchall()
      conn.close()
      if not props:
        await interaction.response.send_message(
            "❌ لا توجد عقارات لحذفها.", ephemeral=True
        )
        return
      view = discord.ui.View()
      view.add_item(DeletePropertySelect(props))
      await interaction.response.send_message(
          "🗑️ اختر العقار أو المحل الذي تريد إزالته من النظام:",
          view=view,
          ephemeral=True,
      )


class AdminAddButton(discord.ui.Button):

  def __init__(self):
    super().__init__(
        label="إضافة عقار / محل",
        style=discord.ButtonStyle.green,
        emoji="➕",
        custom_id="admin_add_prop_btn_v12",
        row=0,
    )

  async def callback(self, interaction: discord.Interaction):
    await interaction.response.send_modal(AdminCategoryModal())


class AdminPanelView(discord.ui.View):

  def __init__(self):
    super().__init__(timeout=None)
    self.add_item(AdminAddButton())
    self.add_item(AdminSelect())


class CitizenSelect(discord.ui.Select):

  def __init__(self):
    options = [
        discord.SelectOption(
            label="فلل",
            emoji="🏰",
            value="فلل",
            description="استعراض الفلل المتاحة للشراء",
        ),
        discord.SelectOption(
            label="شقق",
            emoji="🏢",
            value="شقق",
            description="استعراض الشقق المتاحة للشراء",
        ),
        discord.SelectOption(
            label="مكاتب",
            emoji="💼",
            value="مكاتب",
            description="استعراض المكاتب المتاحة للشراء",
        ),
        discord.SelectOption(
            label="استراحات",
            emoji="🌴",
            value="استراحات",
            description="استعراض الاستراحات المتاحة للشراء",
        ),
        discord.SelectOption(
            label="محلات",
            emoji="🏪",
            value="محلات",
            description="استعراض المحلات المتاحة للشراء",
        ),
        discord.SelectOption(
            label="ممتلكاتي",
            emoji="🏡",
            value="my_properties",
            description="استعراض العقارات والمحلات التي تملكها",
        ),
        discord.SelectOption(
            label="استلام الأرباح",
            emoji="💰",
            value="claim_profits",
            description="استلام الأرباح الدورية لمحلاتك (كل 48 ساعة)",
        ),
        discord.SelectOption(
            label="عرض عقار للبيع",
            emoji="🏷️",
            value="sell",
            description="عرض عقارك الخاص للبيع في سوق المواطنين",
        ),
    ]
    super().__init__(
        placeholder="🏡 اختر القسم أو الخدمة المطلوبة...",
        min_values=1,
        max_values=1,
        options=options,
        custom_id="citizen_menu_select_v12",
    )

  async def callback(self, interaction: discord.Interaction):
    val = self.values[0]
    user_id = interaction.user.id
    guild_id = interaction.guild.id

    if val in ["فلل", "شقق", "مكاتب", "استراحات", "محلات"]:
      conn = sqlite3.connect("real_estate.db")
      cursor = conn.cursor()
      cursor.execute(
          "SELECT property_id, name, category, location, price, profit_amount, description FROM properties WHERE category = ? AND status = 'متاح'",
          (val,)
      )
      props = cursor.fetchall()
      conn.close()

      if not props:
        await interaction.response.send_message(
            f"❌ لا توجد أي عقارات متاحة في قسم **{val}** حالياً.", ephemeral=True
        )
        return

      embed = discord.Embed(
          title=f"🏡 عقارات قسم: {val}", color=discord.Color.green()
      )
      for p in props[:25]:  # حد ديسكورد 25 حقلاً
        profit_text = f"\n💵 الأرباح الدورية: {p[5]:,} ريال" if p[2] == "محلات" else ""
        embed.add_field(
            name=f"{p[1]}",
            value=(
                f"🆔 المعرف: `{p[0]}`\n📍 الموقع: {p[3]}\n💰 السعر: {p[4]:,} ريال{profit_text}\n📝 الوصف: {p[6]}"
            ),
            inline=False,
        )

      view = discord.ui.View()
      view.add_item(BrowseBuySelect(props))
      await interaction.response.send_message(
          embed=embed, view=view, ephemeral=True
      )

    elif val == "my_properties":
      conn = sqlite3.connect("real_estate.db")
      cursor = conn.cursor()
      cursor.execute(
          "SELECT property_id, name, category, location, price, profit_amount FROM properties WHERE owner_id = ?",
          (user_id,),
      )
      props = cursor.fetchall()
      conn.close()

      if not props:
        await interaction.response.send_message(
            "❌ أنت لا تملك أي عقارات أو محلات مسجلة باسمك حالياً.", ephemeral=True
        )
        return

      embed = discord.Embed(
          title="🏡 ممتلكاتك الخاصة", color=discord.Color.blue()
      )
      for p in props[:25]:  # حد ديسكورد 25 حقلاً
        profit_text = f"\n💵 الأرباح الدورية: {p[5]:,} ريال" if p[2] == "محلات" else ""
        embed.add_field(
            name=f"{p[1]} ({p[2]})",
            value=f"🆔 المعرف: `{p[0]}`\n📍 الموقع: {p[3]}\n💰 السعر الأصلي: {p[4]:,} ريال{profit_text}",
            inline=False,
        )
      await interaction.response.send_message(embed=embed, ephemeral=True)

    elif val == "claim_profits":
      conn = sqlite3.connect("real_estate.db")
      cursor = conn.cursor()
      cursor.execute(
          "SELECT property_id, name, profit_amount, last_claimed_timestamp FROM properties WHERE owner_id = ? AND category = 'محلات' AND profit_amount > 0",
          (user_id,),
      )
      shops = cursor.fetchall()
      conn.close()

      if not shops:
        await interaction.response.send_message(
            "❌ لا تملك أي محلات تحقق أرباحاً دورية حالياً.", ephemeral=True
        )
        return

      now = datetime.utcnow()
      total_claimed = 0
      claimed_shops = []
      cooldown_shops = []

      conn = sqlite3.connect("real_estate.db")
      cursor = conn.cursor()

      for shop in shops:
        prop_id, shop_name, profit_amount, last_claimed_str = shop
        can_claim = True

        if last_claimed_str:
          last_claimed = datetime.fromisoformat(last_claimed_str)
          if now - last_claimed < timedelta(hours=48):
            can_claim = False
            remaining = timedelta(hours=48) - (now - last_claimed)
            hours, remainder = divmod(int(remaining.total_seconds()), 3600)
            minutes, _ = divmod(remainder, 60)
            cooldown_shops.append(f"• **{shop_name}** (`{prop_id}`): باقي `{hours} ساعة و {minutes} دقيقة`")

        if can_claim:
          total_claimed += profit_amount
          claimed_shops.append(prop_id)
          cursor.execute(
              "UPDATE properties SET last_claimed_timestamp = ? WHERE property_id = ?",
              (now.isoformat(), prop_id)
          )

      conn.commit()
      conn.close()

      if not claimed_shops and cooldown_shops:
        await interaction.response.send_message(
            "⏳ لم يحين موعد استلام أرباح محلاتك بعد:\n" + "\n".join(cooldown_shops),
            ephemeral=True
        )
        return

      if total_claimed > 0:
        try:
          success = False
          if bank and hasattr(bank, "add_money"):
            try:
              success = bank.add_money(user_id, guild_id, total_claimed, "استلام أرباح المحلات")
            except TypeError:
              try:
                success = bank.add_money(user_id, total_claimed)
              except Exception:
                pass
          else:
            con_bank = sqlite3.connect("bank.db")
            cur_bank = con_bank.cursor()
            cur_bank.execute(
                "UPDATE accounts SET balance = balance + ? WHERE guild_id = ? AND user_id = ?",
                (total_claimed, guild_id, user_id),
            )
            con_bank.commit()
            con_bank.close()
            success = True

        except Exception as e:
          await interaction.response.send_message(
              f"❌ حدث خطأ أثناء إيداع الأرباح في رصيدك البنكي: {e}", ephemeral=True
          )
          return

      msg = f"💰 **تم استلام الأرباح بنجاح!**\nإجمالي الأرباح المضافة لرصيدك: `{total_claimed:,}` ريال."
      if cooldown_shops:
        msg += "\n\n⏳ **ملاحظة:** بعض محلاتك لم يحين وقت سحب أرباحها:\n" + "\n".join(cooldown_shops)

      await interaction.response.send_message(msg, ephemeral=True)

      cog = interaction.client.get_cog("RealEstateCog")
      if cog:
        await cog.send_log(
            interaction.guild,
            "💰 استلام أرباح محل",
            f"**المواطن:** {interaction.user.mention}\n**المبلغ المستلم:** {total_claimed:,} ريال",
            discord.Color.green()
        )

    elif val == "sell":
      conn = sqlite3.connect("real_estate.db")
      cursor = conn.cursor()
      cursor.execute(
          "SELECT property_id, name FROM properties WHERE owner_id = ?",
          (user_id,),
      )
      props = cursor.fetchall()
      conn.close()

      if not props:
        await interaction.response.send_message(
            "❌ لا تملك أي عقارات أو محلات لعرضها للبيع.", ephemeral=True
        )
        return

      view = discord.ui.View()
      view.add_item(CitizenSellSelect(props))
      await interaction.response.send_message(
          "🏷️ اختر العقار أو المحل الذي تريد عرضه للبيع في السوق:",
          view=view,
          ephemeral=True,
      )


class CitizenPanelView(discord.ui.View):

  def __init__(self):
    super().__init__(timeout=None)
    self.add_item(CitizenSelect())


class BrowseBuySelect(discord.ui.Select):

  def __init__(self, props):
    options = [
        discord.SelectOption(label=f"{p[1]} ({p[4]:,} ريال)", value=p[0])
        for p in props[:25]
    ]
    super().__init__(
        placeholder="🛒 اختر العقار لتقديم طلب شرائه...",
        min_values=1,
        max_values=1,
        options=options,
    )

  async def callback(self, interaction: discord.Interaction):
    prop_id = self.values[0]
    await interaction.response.send_modal(BuyRequestModal(prop_id))


class CitizenSellSelect(discord.ui.Select):

  def __init__(self, props):
    options = [discord.SelectOption(label=p[1], value=p[0]) for p in props[:25]]  # حد ديسكورد 25 خياراً
    super().__init__(
        placeholder="🏷️ اختر العقار لبيعه...",
        min_values=1,
        max_values=1,
        options=options,
    )

  async def callback(self, interaction: discord.Interaction):
    prop_id = self.values[0]
    await interaction.response.send_modal(SellPropertyModal(prop_id))


class EditPropertyModal(discord.ui.Modal):
  new_name = discord.ui.TextInput(
      label="الاسم الجديد", placeholder="اكتب الاسم الجديد..."
  )
  new_category = discord.ui.TextInput(
      label="القسم الجديد (فلل، شقق، مكاتب، استراحات، محلات)", placeholder="محلات"
  )
  new_location = discord.ui.TextInput(
      label="الموقع الجديد", placeholder="اكتب الموقع الجديد..."
  )
  new_price = discord.ui.TextInput(
      label="السعر الجديد والأرباح (السعر,الأرباح)", placeholder="250000, 10000"
  )
  new_description = discord.ui.TextInput(
      label="الحالة والوصف (متاح/مباع - الوصف)",
      style=discord.TextStyle.paragraph,
      required=False,
      placeholder="متاح - تفاصيل جديدة...",
  )

  def __init__(self, prop_id, current_data):
    super().__init__(title="تعديل بيانات العقار أو المحل")
    self.prop_id = prop_id
    self.new_name.default = current_data[0]
    self.new_category.default = current_data[1]
    self.new_location.default = current_data[2]
    self.new_price.default = f"{current_data[3]}, {current_data[4]}"
    self.new_description.default = f"{current_data[5]} - {current_data[6] or ''}"

  async def on_submit(self, interaction: discord.Interaction):
    try:
      price_parts = self.new_price.value.replace(" ", "").split(",")
      price_val = int(price_parts[0])
      profit_val = int(price_parts[1]) if len(price_parts) > 1 else 0
    except ValueError:
      await interaction.response.send_message(
          "❌ صيغة السعر والأرباح خاطئة! تأكد من كتابتها هكذا: `250000, 10000`", ephemeral=True
      )
      return

    desc_text = self.new_description.value.strip()
    if "-" in desc_text:
      status_val, desc_val = desc_text.split("-", 1)
      status_val = status_val.strip()
      desc_val = desc_val.strip()
    else:
      status_val = "متاح"
      desc_val = desc_text

    conn = sqlite3.connect("real_estate.db")
    cursor = conn.cursor()
    cursor.execute(
        """
        UPDATE properties
        SET name = ?, category = ?, location = ?, price = ?, profit_amount = ?, status = ?, description = ?
        WHERE property_id = ?
        """,
        (
            self.new_name.value,
            self.new_category.value,
            self.new_location.value,
            price_val,
            profit_val,
            status_val,
            desc_val,
            self.prop_id,
        ),
    )
    conn.commit()
    conn.close()

    cog = interaction.client.get_cog("RealEstateCog")
    if cog:
      await cog.send_log(
          interaction.guild,
          "✏️ تعديل بيانات عقار/محل",
          f"**المسؤول:** {interaction.user.mention}\n**معرف العقار:** `{self.prop_id}`\n**الاسم الجديد:** {self.new_name.value}\n**السعر الجديد:** {price_val:,} ريال",
          discord.Color.gold()
      )

    await interaction.response.send_message(
        f"✅ تم تعديل بيانات العقار/المحل `{self.prop_id}` بنجاح!", ephemeral=True
    )


class EditPropertySelect(discord.ui.Select):

  def __init__(self, props):
    options = [discord.SelectOption(label=p[1], value=p[0]) for p in props[:25]]  # حد ديسكورد 25 خياراً
    super().__init__(
        placeholder="اختر العقار أو المحل لتعديله...",
        min_values=1,
        max_values=1,
        options=options,
    )

  async def callback(self, interaction: discord.Interaction):
    prop_id = self.values[0]
    conn = sqlite3.connect("real_estate.db")
    cursor = conn.cursor()
    cursor.execute(
        "SELECT name, category, location, price, profit_amount, status, description FROM properties WHERE property_id = ?",
        (prop_id,)
    )
    current_data = cursor.fetchone()
    conn.close()

    if not current_data:
      await interaction.response.send_message("❌ لم يتم العثور على بيانات هذا العقار.", ephemeral=True)
      return

    await interaction.response.send_modal(EditPropertyModal(prop_id, current_data))


class DeletePropertySelect(discord.ui.Select):

  def __init__(self, props):
    options = [discord.SelectOption(label=p[1], value=p[0]) for p in props[:25]]  # حد ديسكورد 25 خياراً
    super().__init__(
        placeholder="اختر العقار أو المحل لحذفه...",
        min_values=1,
        max_values=1,
        options=options,
    )

  async def callback(self, interaction: discord.Interaction):
    prop_id = self.values[0]
    conn = sqlite3.connect("real_estate.db")
    cursor = conn.cursor()
    cursor.execute("DELETE FROM properties WHERE property_id = ?", (prop_id,))
    conn.commit()
    conn.close()

    cog = interaction.client.get_cog("RealEstateCog")
    if cog:
      await cog.send_log(
          interaction.guild,
          "🗑️ حذف عقار/محل",
          f"**المسؤول:** {interaction.user.mention}\n**المعرف المحذوف:** `{prop_id}`",
          discord.Color.red()
      )

    await interaction.response.edit_message(
        content=(
            f"🗑️ تم حذف وإزالة العقار/المحل بمعرف `{prop_id}` من النظام بنجاح!"
        ),
        view=None,
    )


class TransferPropertySelect(discord.ui.Select):

  def __init__(self, props):
    options = [discord.SelectOption(label=p[1], value=p[0]) for p in props[:25]]  # حد ديسكورد 25 خياراً
    super().__init__(
        placeholder="اختر العقار لنقل ملكيته...",
        min_values=1,
        max_values=1,
        options=options,
    )

  async def callback(self, interaction: discord.Interaction):
    prop_id = self.values[0]
    view = discord.ui.View()
    view.add_item(TransferUserSelect(prop_id))
    await interaction.response.edit_message(
        content=(
            f"🔄 تم اختيار `{prop_id}`. الآن حدد المواطن الجديد من القائمة أدناه"
            " لنقل الملكية إليه:"
        ),
        view=view,
    )


class TransferUserSelect(discord.ui.UserSelect):

  def __init__(self, prop_id):
    self.prop_id = prop_id
    super().__init__(
        placeholder="👤 اختر المواطن الجديد لنقل الملكية...",
        min_values=1,
        max_values=1,
    )

  async def callback(self, interaction: discord.Interaction):
    new_owner = self.values[0]

    conn = sqlite3.connect("real_estate.db")
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE properties SET status = 'مباع', owner_id = ? WHERE property_id = ?",
        (new_owner.id, self.prop_id),
    )
    conn.commit()
    conn.close()

    cog = interaction.client.get_cog("RealEstateCog")
    if cog:
      await cog.send_log(
          interaction.guild,
          "🔄 نقل ملكية (إداري)",
          f"**المسؤول:** {interaction.user.mention}\n**العقار:** `{self.prop_id}`\n**المالك الجديد:** {new_owner.mention}",
          discord.Color.blue()
      )

    await interaction.response.edit_message(
        content=(
            f"✅ تم نقل ملكية العقار/المحل بنجاح إلى المواطن {new_owner.mention}!"
        ),
        view=None,
    )


class BuyRequestModal(discord.ui.Modal):
  notes = discord.ui.TextInput(
      label="سبب الشراء / ملاحظاتك",
      style=discord.TextStyle.paragraph,
      placeholder="أكتب سبب رغبتك في الشراء...",
      required=True,
  )

  def __init__(self, prop_id):
    super().__init__(title="طلب شراء عقار أو محل من النظام")
    self.prop_id = prop_id

  async def on_submit(self, interaction: discord.Interaction):
    conn = sqlite3.connect("real_estate.db")
    cursor = conn.cursor()
    cursor.execute(
        "SELECT name, price, location, profit_amount, category FROM properties"
        " WHERE property_id = ?",
        (self.prop_id,),
    )
    prop = cursor.fetchone()

    cursor.execute(
        "SELECT channel_id FROM settings WHERE key = 'requests_channel'"
    )
    settings = cursor.fetchone()
    conn.close()

    if not prop:
      await interaction.response.send_message("❌ هذا العقار لم يعد موجوداً في النظام!", ephemeral=True)
      return

    if not settings or not settings[0]:
      await interaction.response.send_message(
          "❌ لم يتم تحديد روم الطلبات من قبل الإدارة عبر أمر `/اعداد-العقارات`!",
          ephemeral=True,
      )
      return

    requests_channel = interaction.guild.get_channel(settings[0])
    if not requests_channel:
      await interaction.response.send_message(
          "❌ روم الطلبات غير موجود أو تم حذفه!", ephemeral=True
      )
      return

    embed = discord.Embed(
        title="📥 طلب شراء جديد من النظام", color=discord.Color.orange()
    )
    embed.add_field(name="🏠 العقار/المحل", value=prop[0], inline=True)
    embed.add_field(name="💰 السعر", value=f"{prop[1]:,} ريال", inline=True)
    if prop[4] == "محلات":
      embed.add_field(
          name="💵 الأرباح الدورية (كل 48 ساعة)",
          value=f"{prop[3]:,} ريال",
          inline=True,
      )
    embed.add_field(name="📍 الموقع", value=prop[2], inline=True)
    embed.add_field(name="👤 المشتري", value=interaction.user.mention, inline=False)
    embed.add_field(
        name="📝 ملاحظات المشتري", value=self.notes.value, inline=False
    )
    embed.set_footer(text=f"معرف العقار: {self.prop_id}")

    view = RequestActionView(self.prop_id, interaction.user.id)
    await requests_channel.send(embed=embed, view=view)

    cog = interaction.client.get_cog("RealEstateCog")
    if cog:
      await cog.send_log(
          interaction.guild,
          "📥 طلب شراء من النظام",
          f"**المشتري:** {interaction.user.mention}\n**العقار:** `{self.prop_id}` ({prop[0]})\n**السعر:** {prop[1]:,} ريال",
          discord.Color.orange()
      )

    await interaction.response.send_message(
        "✅ تم إرسال طلب الشراء بنجاح إلى الإدارة، سيتم مراجعته والرد عليك قريباً!",
        ephemeral=True,
    )


class RequestActionView(discord.ui.View):

  def __init__(self, prop_id, buyer_id):
    super().__init__(timeout=None)
    self.prop_id = prop_id
    self.buyer_id = buyer_id

  @discord.ui.button(
      label="قبول الطلب",
      style=discord.ButtonStyle.green,
      emoji="✅",
      custom_id="accept_req_v12",
  )
  async def accept_btn(
      self, interaction: discord.Interaction, button: discord.ui.Button
  ):
    conn = sqlite3.connect("real_estate.db")
    cursor = conn.cursor()
    cursor.execute(
        "SELECT price, name FROM properties WHERE property_id = ?",
        (self.prop_id,),
    )
    prop_data = cursor.fetchone()
    if not prop_data:
      await interaction.response.send_message("❌ هذا العقار غير موجود في النظام!", ephemeral=True)
      conn.close()
      return
      
    price = prop_data[0]
    prop_name = prop_data[1]
    conn.close()

    staff_id = interaction.user.id

    try:
      success = False
      if bank and hasattr(bank, "deduct_money"):
        try:
          success = await bank.deduct_money(self.buyer_id, interaction.guild.id, price)
        except TypeError:
          success = bank.deduct_money(self.buyer_id, interaction.guild.id, price)
      elif bank and hasattr(bank, "remove_money"):
        success = bank.remove_money(self.buyer_id, price)
      else:
        con_bank = sqlite3.connect("bank.db")
        cur_bank = con_bank.cursor()
        cur_bank.execute(
            "SELECT balance FROM accounts WHERE guild_id = ? AND user_id = ?", (interaction.guild.id, self.buyer_id)
        )
        row = cur_bank.fetchone()
        if row and row[0] >= price:
          cur_bank.execute(
              "UPDATE accounts SET balance = balance - ? WHERE guild_id = ? AND user_id = ?",
              (price, interaction.guild.id, self.buyer_id),
          )
          con_bank.commit()
          success = True
        con_bank.close()

      if not success:
        await interaction.response.send_message(
            "❌ فشلت عملية القبول: رصيد المشتري في البنك لا يكفي أو حسابه غير مسجل!",
            ephemeral=True,
        )
        return

      if bank and hasattr(bank, "add_money"):
        try:
          bank.add_money(staff_id, interaction.guild.id, price, "بيع عقار نظامي")
        except TypeError:
          try:
            bank.add_money(staff_id, price)
          except Exception:
            pass
      else:
        con_bank = sqlite3.connect("bank.db")
        cur_bank = con_bank.cursor()
        cur_bank.execute(
            "UPDATE accounts SET balance = balance + ? WHERE guild_id = ? AND user_id = ?",
            (price, interaction.guild.id, staff_id),
        )
        con_bank.commit()
        con_bank.close()

    except Exception as e:
      await interaction.response.send_message(
          f"❌ حدث خطأ أثناء المعالجة المالية: {e}", ephemeral=True
      )
      return

    conn = sqlite3.connect("real_estate.db")
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE properties SET status = 'مباع', owner_id = ? WHERE property_id = ?",
        (self.buyer_id, self.prop_id),
    )
    conn.commit()
    conn.close()

    for child in self.children:
      child.disabled = True
    await interaction.message.edit(view=self)

    cog = interaction.client.get_cog("RealEstateCog")
    if cog:
      await cog.send_log(
          interaction.guild,
          "✅ قبول طلب شراء النظام",
          f"**المسؤول (المستلم للمبلغ):** {interaction.user.mention}\n**المشتري:** <@{self.buyer_id}>\n**العقار:** `{self.prop_id}` ({prop_name})\n**المبلغ المحول:** {price:,} ريال",
          discord.Color.green()
      )

    await interaction.response.send_message(
        f"✅ تم قبول الطلب بواسطة {interaction.user.mention}، وتم خصم مبلغ `{price:,}` ريال من المشتري وتحويله لحسابك بنجاح!",
        ephemeral=False,
    )

    try:
      buyer = await interaction.guild.fetch_member(self.buyer_id)
      await buyer.send(
          f"🎉 **مبروك! تم قبول طلبك وسحب مبلغ `{price:,}` ريال من حسابك وإتمام نقل الملكية لعقار ({prop_name}).**"
      )
    except Exception:
      pass

  @discord.ui.button(
      label="رفض الطلب",
      style=discord.ButtonStyle.red,
      emoji="❌",
      custom_id="reject_req_v12",
  )
  async def reject_btn(
      self, interaction: discord.Interaction, button: discord.ui.Button
  ):
    for child in self.children:
      child.disabled = True
    await interaction.message.edit(view=self)

    cog = interaction.client.get_cog("RealEstateCog")
    if cog:
      await cog.send_log(
          interaction.guild,
          "❌ رفض طلب شراء",
          f"**المسؤول:** {interaction.user.mention}\n**المشتري:** <@{self.buyer_id}>\n**العقار:** `{self.prop_id}`",
          discord.Color.red()
      )

    await interaction.response.send_message(
        f"❌ تم رفض الطلب بواسطة {interaction.user.mention}.", ephemeral=False
    )

    try:
      buyer = await interaction.guild.fetch_member(self.buyer_id)
      await buyer.send("❌ نأسف لك، تم رفض طلب الشراء الخاص بك من قبل الإدارة.")
    except Exception:
      pass


class SellPropertyModal(discord.ui.Modal):
  sale_price = discord.ui.TextInput(
      label="سعر البيع المطلوب (أرقام فقط)", placeholder="مثال: 300000"
  )

  def __init__(self, prop_id):
    super().__init__(title="عرض عقارك/محلك للبيع")
    self.prop_id = prop_id

  async def on_submit(self, interaction: discord.Interaction):
    try:
      price_val = int(self.sale_price.value)
    except ValueError:
      await interaction.response.send_message(
          "❌ يرجى إدخال أرقام صحيحة لسعر البيع!", ephemeral=True
      )
      return

    conn = sqlite3.connect("real_estate.db")
    cursor = conn.cursor()
    cursor.execute("SELECT channel_id FROM settings WHERE key = 'market_channel'")
    settings = cursor.fetchone()

    cursor.execute(
        "SELECT name, location, category, profit_amount FROM properties WHERE property_id = ?",
        (self.prop_id,),
    )
    prop = cursor.fetchone()
    conn.close()

    if not prop:
      await interaction.response.send_message("❌ هذا العقار غير موجود!", ephemeral=True)
      return

    if not settings or not settings[0]:
      await interaction.response.send_message(
          "❌ لم يتم تحديد روم سوق المواطنين من قبل الإدارة عبر أمر `/اعداد-العقارات`!",
          ephemeral=True,
      )
      return

    market_channel = interaction.guild.get_channel(settings[0])
    if not market_channel:
      await interaction.response.send_message(
          "❌ روم سوق المواطنين غير موجود أو تم حذفه!", ephemeral=True
      )
      return

    embed = discord.Embed(
        title="🛒 عقار / محل معروض للبيع من مواطن",
        description=f"تم عرض هذا العقار للبيع بواسطة المالك الحالي.",
        color=discord.Color.purple(),
    )
    embed.add_field(name="🏠 الاسم", value=prop[0], inline=True)
    embed.add_field(name="📂 القسم", value=prop[2], inline=True)
    embed.add_field(name="📍 الموقع", value=prop[1], inline=True)
    embed.add_field(name="💵 سعر البيع", value=f"{price_val:,} ريال", inline=True)
    if prop[2] == "محلات":
      embed.add_field(name="📈 الأرباح الدورية", value=f"{prop[3]:,} ريال", inline=True)
    embed.add_field(name="👤 البائع", value=interaction.user.mention, inline=False)
    embed.set_footer(text=f"معرف العقار: {self.prop_id}")

    view = MarketBuyView(self.prop_id, interaction.user.id, price_val)
    await market_channel.send(embed=embed, view=view)

    cog = interaction.client.get_cog("RealEstateCog")
    if cog:
      await cog.send_log(
          interaction.guild,
          "🏷️ عرض عقار للبيع بسوق المواطنين",
          f"**البائع:** {interaction.user.mention}\n**العقار:** `{self.prop_id}` ({prop[0]})\n**سعر البيع:** {price_val:,} ريال",
          discord.Color.purple()
      )

    await interaction.response.send_message(
        f"✅ تم عرض عقارك/محلك للبيع بنجاح في روم {market_channel.mention}!",
        ephemeral=True,
    )


class MarketBuyView(discord.ui.View):

  def __init__(self, prop_id, seller_id, price):
    super().__init__(timeout=None)
    self.prop_id = prop_id
    self.seller_id = seller_id
    self.price = price

  @discord.ui.button(
      label="شراء العقار",
      style=discord.ButtonStyle.green,
      emoji="💳",
      custom_id="market_buy_prop_btn_v12",
  )
  async def buy_btn(
      self, interaction: discord.Interaction, button: discord.ui.Button
  ):
    buyer_id = interaction.user.id
    guild_id = interaction.guild.id

    if buyer_id == self.seller_id:
      await interaction.response.send_message(
          "❌ لا يمكنك شراء عقارك الخاص!", ephemeral=True
      )
      return

    conn = sqlite3.connect("real_estate.db")
    cursor = conn.cursor()
    cursor.execute(
        "SELECT owner_id, name FROM properties WHERE property_id = ?",
        (self.prop_id,),
    )
    p_data = cursor.fetchone()
    conn.close()

    if not p_data or p_data[0] != self.seller_id:
      await interaction.response.send_message(
          "❌ عذراً، هذا العقار لم يعد ملكاً للبائع أو تم بيعه مسبقاً!",
          ephemeral=True,
      )
      return

    prop_name = p_data[1]

    try:
      success = False
      if bank and hasattr(bank, "deduct_money"):
        try:
          success = await bank.deduct_money(buyer_id, guild_id, self.price)
        except TypeError:
          success = bank.deduct_money(buyer_id, guild_id, self.price)
      elif bank and hasattr(bank, "remove_money"):
        success = bank.remove_money(buyer_id, self.price)
      else:
        con_bank = sqlite3.connect("bank.db")
        cur_bank = con_bank.cursor()
        cur_bank.execute(
            "SELECT balance FROM accounts WHERE guild_id = ? AND user_id = ?", (guild_id, buyer_id)
        )
        row = cur_bank.fetchone()
        if row and row[0] >= self.price:
          cur_bank.execute(
              "UPDATE accounts SET balance = balance - ? WHERE guild_id = ? AND user_id = ?",
              (self.price, guild_id, buyer_id),
          )
          con_bank.commit()
          success = True
        con_bank.close()

      if not success:
        await interaction.response.send_message(
            "❌ رصيدك في البنك لا يكفي لإتمام عملية الشراء!", ephemeral=True
        )
        return

      if bank and hasattr(bank, "add_money"):
        try:
          bank.add_money(self.seller_id, guild_id, self.price, "بيع عقار في السوق")
        except TypeError:
          try:
            bank.add_money(self.seller_id, self.price)
          except Exception:
            pass
      else:
        con_bank = sqlite3.connect("bank.db")
        cur_bank = con_bank.cursor()
        cur_bank.execute(
            "UPDATE accounts SET balance = balance + ? WHERE guild_id = ? AND user_id = ?",
            (self.price, guild_id, self.seller_id),
        )
        con_bank.commit()
        con_bank.close()

    except Exception as e:
      await interaction.response.send_message(
          f"❌ حدث خطأ مالى أثناء إتمام عملية الشراء: {e}", ephemeral=True
      )
      return

    conn = sqlite3.connect("real_estate.db")
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE properties SET owner_id = ? WHERE property_id = ?",
        (buyer_id, self.prop_id),
    )
    conn.commit()
    conn.close()

    for child in self.children:
      child.disabled = True
    await interaction.message.edit(view=self)

    cog = interaction.client.get_cog("RealEstateCog")
    if cog:
      await cog.send_log(
          interaction.guild,
          "🤝 إتمام بيع عقار بين المواطنين",
          f"**البائع:** <@{self.seller_id}>\n**المشتري:** {interaction.user.mention}\n**العقار:** `{self.prop_id}` ({prop_name})\n**المبلغ:** {self.price:,} ريال",
          discord.Color.purple()
      )

    await interaction.response.send_message(
        f"✅ تمت عملية شراء العقار/المحل `{prop_name}` بنجاح وتم تحويل المبلغ للبائع!",
        ephemeral=False,
    )


async def setup(bot):
  await bot.add_cog(RealEstateCog(bot))
