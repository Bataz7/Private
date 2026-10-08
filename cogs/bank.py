import discord
from discord.ext import commands
from discord import app_commands
import sqlite3
import random
import re
from datetime import datetime


# =========================================================
# الإعدادات وقاعدة البيانات
# =========================================================

DATABASE = "bank.db"

db = sqlite3.connect(DATABASE, check_same_thread=False)
db.row_factory = sqlite3.Row
cursor = db.cursor()

cursor.execute("""
CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    account_number TEXT NOT NULL,
    balance INTEGER NOT NULL DEFAULT 0,
    is_frozen INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE(guild_id, user_id)
)
""")

cursor.execute("""
CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    target_user_id INTEGER,
    transaction_type TEXT NOT NULL,
    amount INTEGER NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL
)
""")

cursor.execute("""
CREATE TABLE IF NOT EXISTS loans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    account_number TEXT NOT NULL,
    amount INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL
)
""")

cursor.execute("""
CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id INTEGER PRIMARY KEY,
    loan_channel_id INTEGER,
    log_channel_id INTEGER,
    bank_staff_role_id INTEGER
)
""")

# التحقق من وجود الأعمدة وإضافتها تلقائياً إن لم تكن موجودة (لتجنب أخطاء الجداول القديمة)
try:
    cursor.execute("ALTER TABLE guild_settings ADD COLUMN loan_channel_id INTEGER")
except sqlite3.OperationalError:
    pass

try:
    cursor.execute("ALTER TABLE guild_settings ADD COLUMN log_channel_id INTEGER")
except sqlite3.OperationalError:
    pass

try:
    cursor.execute("ALTER TABLE guild_settings ADD COLUMN bank_staff_role_id INTEGER")
except sqlite3.OperationalError:
    pass

# رومات البانلات (كل بانل لها روم) — يكتبها الموقع وأمر bank_setup
for _col in ("account_panel_channel_id", "citizens_panel_channel_id", "staff_panel_channel_id"):
    try:
        cursor.execute(f"ALTER TABLE guild_settings ADD COLUMN {_col} INTEGER")
    except sqlite3.OperationalError:
        pass

db.commit()


# =========================================================
# وظائف عامة
# =========================================================

def now():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def get_bank_staff_role(guild_id: int):
    res = cursor.execute("SELECT bank_staff_role_id FROM guild_settings WHERE guild_id = ?", (guild_id,)).fetchone()
    return res["bank_staff_role_id"] if res and res["bank_staff_role_id"] else None


def is_staff(member: discord.Member):
    if member.guild_permissions.administrator:
        return True
    role_id = get_bank_staff_role(member.guild.id)
    if not role_id:
        return False
    return any(role.id == role_id for role in member.roles)


def get_account(guild_id, user_id):
    return cursor.execute(
        "SELECT * FROM accounts WHERE guild_id = ? AND user_id = ?",
        (guild_id, user_id)
    ).fetchone()


def get_account_by_number(guild_id, account_number):
    return cursor.execute(
        "SELECT * FROM accounts WHERE guild_id = ? AND account_number = ?",
        (guild_id, account_number)
    ).fetchone()


def generate_account_number(guild_id):
    while True:
        number = str(random.randint(1000, 9999))
        exists = cursor.execute(
            "SELECT id FROM accounts WHERE guild_id = ? AND account_number = ?",
            (guild_id, number)
        ).fetchone()
        if not exists:
            return number


# =========================================================
# واجهة برمجية للأنظمة الأخرى (المرور، المركبات، العقارات)
# =========================================================
async def deduct_money(user_id: int, guild_id: int, amount: int) -> bool:
    """يخصم مبلغاً من حساب العضو؛ يرجع False لو ما عنده حساب أو رصيد كافٍ أو الحساب مجمّد."""
    amount = int(amount)
    row = cursor.execute("SELECT balance, is_frozen FROM accounts WHERE guild_id = ? AND user_id = ?", (guild_id, user_id)).fetchone()
    if not row or row["is_frozen"] or amount <= 0 or row["balance"] < amount:
        return False
    cursor.execute("UPDATE accounts SET balance = balance - ? WHERE guild_id = ? AND user_id = ?", (amount, guild_id, user_id))
    db.commit()
    add_transaction(guild_id, user_id, "خصم", amount, "خصم من نظام آخر")
    return True


async def add_money(user_id: int, guild_id: int, amount: int) -> bool:
    """يضيف مبلغاً لحساب العضو؛ يرجع False لو ما عنده حساب."""
    amount = int(amount)
    if amount <= 0 or not cursor.execute("SELECT 1 FROM accounts WHERE guild_id = ? AND user_id = ?", (guild_id, user_id)).fetchone():
        return False
    cursor.execute("UPDATE accounts SET balance = balance + ? WHERE guild_id = ? AND user_id = ?", (amount, guild_id, user_id))
    db.commit()
    add_transaction(guild_id, user_id, "إيداع", amount, "إضافة من نظام آخر")
    return True


def add_transaction(guild_id, user_id, transaction_type, amount, description, target_user_id=None):
    cursor.execute(
        """
        INSERT INTO transactions (guild_id, user_id, target_user_id, transaction_type, amount, description, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (guild_id, user_id, target_user_id, transaction_type, amount, description, now())
    )
    db.commit()


async def send_log(guild: discord.Guild, bot, title, description, color=discord.Color.blue()):
    res = cursor.execute("SELECT log_channel_id FROM guild_settings WHERE guild_id = ?", (guild.id,)).fetchone()
    if res and res["log_channel_id"]:
        channel = guild.get_channel(res["log_channel_id"])
        if channel:
            embed = discord.Embed(title=f"📜 لوق البنك: {title}", description=description, color=color, timestamp=datetime.now())
            await channel.send(embed=embed)


def get_loan_channel(guild_id):
    res = cursor.execute("SELECT loan_channel_id FROM guild_settings WHERE guild_id = ?", (guild_id,)).fetchone()
    return res["loan_channel_id"] if res else None


# =========================================================
# إنشاء الحساب (زر)
# =========================================================

class CreateAccountView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(
        label="إنشاء حساب بنكي",
        emoji="🏦",
        style=discord.ButtonStyle.success,
        custom_id="bank:create_account_button_unique"
    )
    async def create_account_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        account = get_account(interaction.guild.id, interaction.user.id)
        if account:
            await interaction.response.send_message("❌ لديك حساب بنكي بالفعل.", ephemeral=True)
            return

        account_number = generate_account_number(interaction.guild.id)
        cursor.execute(
            """
            INSERT INTO accounts (guild_id, user_id, account_number, balance, is_frozen, created_at)
            VALUES (?, ?, ?, 0, 0, ?)
            """,
            (interaction.guild.id, interaction.user.id, account_number, now())
        )
        db.commit()
        
        account = get_account(interaction.guild.id, interaction.user.id)

        embed = discord.Embed(
            title="🏦 تم إنشاء حسابك البنكي",
            description=(
                f"**رقم الحساب (الآيبان):** `{account['account_number']}`\n"
                f"**الرصيد:** `{account['balance']:,} ريال`"
            )
        )
        await interaction.response.send_message(embed=embed, ephemeral=True)
        await send_log(interaction.guild, interaction.client, "إنشاء حساب", f"المستخدم: {interaction.user.mention}\nرقم الحساب: `{account['account_number']}`")


# =========================================================
# التحويل
# =========================================================

class TransferModal(discord.ui.Modal, title="💸 تحويل أموال"):
    iban = discord.ui.TextInput(label="آيبان العضو المستلم", placeholder="مثال: 4521", required=True, max_length=4)
    amount = discord.ui.TextInput(label="المبلغ", placeholder="مثال: 5000", required=True)

    async def on_submit(self, interaction: discord.Interaction):
        account = get_account(interaction.guild.id, interaction.user.id)
        if not account or account["is_frozen"]:
            await interaction.response.send_message("❌ حسابك غير متاح أو موقوف.", ephemeral=True)
            return

        target_iban = self.iban.value.strip()
        try:
            amount = int(self.amount.value)
        except ValueError:
            await interaction.response.send_message("❌ مبلغ غير صحيح.", ephemeral=True)
            return

        if amount <= 0:
            await interaction.response.send_message("❌ يجب أن يكون المبلغ أكبر من صفر.", ephemeral=True)
            return

        if account["account_number"] == target_iban:
            await interaction.response.send_message("❌ لا يمكنك التحويل لنفسك.", ephemeral=True)
            return

        target_account = get_account_by_number(interaction.guild.id, target_iban)
        if not target_account or target_account["is_frozen"]:
            await interaction.response.send_message("❌ لم يتم العثور على الحساب أو أنه موقوف.", ephemeral=True)
            return

        if account["balance"] < amount:
            await interaction.response.send_message("❌ رصيدك غير كافي.", ephemeral=True)
            return

        target_id = target_account["user_id"]
        
        cursor.execute("UPDATE accounts SET balance = balance - ? WHERE guild_id = ? AND account_number = ?", (amount, interaction.guild.id, account["account_number"]))
        cursor.execute("UPDATE accounts SET balance = balance + ? WHERE guild_id = ? AND account_number = ?", (amount, interaction.guild.id, target_iban))
        db.commit()

        add_transaction(interaction.guild.id, interaction.user.id, "تحويل", amount, f"تحويل للآيبان `{target_iban}`", target_id)
        add_transaction(interaction.guild.id, target_id, "استلام", amount, f"استلام من الآيبان `{account['account_number']}`", interaction.user.id)
        await send_log(interaction.guild, interaction.client, "تحويل أموال", f"من: {interaction.user.mention} (`{account['account_number']}`)\nإلى الآيبان: `{target_iban}`\nالمبلغ: **{amount:,} ريال**")

        try:
            target_user = interaction.guild.get_member(target_id) or await interaction.client.fetch_user(target_id)
            if target_user:
                embed_notif = discord.Embed(
                    title="💸 استلام حوالة مالية",
                    description=f"لقد استلمت حوالة بقيمة **{amount:,} ريال** من الآيبان (`{account['account_number']}`).",
                    color=discord.Color.green()
                )
                await target_user.send(embed=embed_notif)
        except Exception:
            pass

        await interaction.response.send_message(f"✅ تم تحويل **{amount:,} ريال** إلى الآيبان (`{target_iban}`) بنجاح.", ephemeral=True)


# =========================================================
# سداد القرض
# =========================================================

class RepayLoanModal(discord.ui.Modal, title="💳 سداد قرض"):
    loan_id = discord.ui.TextInput(label="رقم القرض", placeholder="مثال: 1", required=True)
    amount = discord.ui.TextInput(label="مبلغ السداد", placeholder="مثال: 5000", required=True)

    async def on_submit(self, interaction: discord.Interaction):
        account = get_account(interaction.guild.id, interaction.user.id)
        if not account or account["is_frozen"]:
            await interaction.response.send_message("❌ حسابك غير متاح أو موقوف.", ephemeral=True)
            return

        try:
            l_id = int(self.loan_id.value)
            amount = int(self.amount.value)
        except ValueError:
            await interaction.response.send_message("❌ قيم غير صحيحة.", ephemeral=True)
            return

        loan = cursor.execute("SELECT * FROM loans WHERE id = ? AND guild_id = ? AND user_id = ? AND status = 'active'", (l_id, interaction.guild.id, interaction.user.id)).fetchone()
        if not loan:
            await interaction.response.send_message("❌ لم يتم العثور على قرض نشط بهذا الرقم يخصك.", ephemeral=True)
            return

        if account["balance"] < amount:
            await interaction.response.send_message("❌ رصيدك البنكي غير كافي للسداد.", ephemeral=True)
            return

        cursor.execute("UPDATE accounts SET balance = balance - ? WHERE guild_id = ? AND account_number = ?", (amount, interaction.guild.id, account["account_number"]))
        cursor.execute("UPDATE loans SET amount = amount - ? WHERE id = ?", (amount, l_id))
        
        updated_loan = cursor.execute("SELECT amount FROM loans WHERE id = ?", (l_id,)).fetchone()
        if updated_loan["amount"] <= 0:
            cursor.execute("UPDATE loans SET status = 'paid', amount = 0 WHERE id = ?", (l_id,))
        db.commit()

        add_transaction(interaction.guild.id, interaction.user.id, "سداد قرض", amount, f"سداد للقرض رقم #{l_id}")
        await send_log(interaction.guild, interaction.client, "سداد قرض", f"المواطن: {interaction.user.mention}\nرقم القرض: `#{l_id}`\nالمبلغ المسدد: **{amount:,} ريال**")

        await interaction.response.send_message(f"✅ تم سداد مبلغ **{amount:,} ريال** للقرض رقم `#{l_id}` بنجاح.", ephemeral=True)


# =========================================================
# طلب القرض
# =========================================================

class LoanModal(discord.ui.Modal, title="📋 طلب قرض"):
    q1 = discord.ui.TextInput(label="1- اسمك الحقيقي:", placeholder="مثال: محمد", required=True)
    q2 = discord.ui.TextInput(label="2- الوظيفة الحالية:", placeholder="مثال: عسكري / مدني", required=True)
    q3 = discord.ui.TextInput(label="3- مبلغ القرض المطلوب:", placeholder="مثال: 50000", required=True)
    q4 = discord.ui.TextInput(label="4- سبب طلبك للقرض:", placeholder="شراء سيارة / منزل...", required=True, style=discord.TextStyle.paragraph)
    q5 = discord.ui.TextInput(label="5- التعهد (اكتب: موافق)", placeholder="في حال تاخير السداد سيتم إيقاف حسابك", required=True)

    async def on_submit(self, interaction: discord.Interaction):
        account = get_account(interaction.guild.id, interaction.user.id)
        if not account or account["is_frozen"]:
            await interaction.response.send_message("❌ حسابك موقوف أو لا يملك حساباً بنكياً.", ephemeral=True)
            return

        if "موافق" not in self.q5.value:
            await interaction.response.send_message("❌ يجب الموافقة على شرط إيقاف الحساب عند التأخير.", ephemeral=True)
            return

        try:
            loan_amount = int(self.q3.value)
        except ValueError:
            await interaction.response.send_message("❌ مبلغ القرض غير صحيح (يجب أن يكون رقماً).", ephemeral=True)
            return

        channel_id = get_loan_channel(interaction.guild.id)
        if not channel_id:
            await interaction.response.send_message("❌ لم يتم تحديد روم استقبال القروض من قِبل الإدارة.", ephemeral=True)
            return

        channel = interaction.guild.get_channel(channel_id)
        if not channel:
            await interaction.response.send_message("❌ روم القروض غير موجود حالياً.", ephemeral=True)
            return

        embed = discord.Embed(title="📜 طلب قرض جديد", color=discord.Color.gold())
        embed.add_field(name="المواطن", value=f"{interaction.user.mention}", inline=False)
        embed.add_field(name="رقم الآيبان", value=f"`{account['account_number']}`", inline=False)
        embed.add_field(name="1- الاسم", value=self.q1.value, inline=True)
        embed.add_field(name="2- الوظيفة", value=self.q2.value, inline=True)
        embed.add_field(name="3- مبلغ القرض المطلوب", value=f"**{loan_amount:,} ريال**", inline=False)
        embed.add_field(name="4- السبب", value=self.q4.value, inline=False)

        await channel.send(embed=embed, view=LoanApprovalView(interaction.user.id, loan_amount, account["account_number"]))
        await interaction.response.send_message("✅ تم إرسال طلب قرضك بنجاح إلى الإدارة.", ephemeral=True)


class LoanApprovalView(discord.ui.View):
    def __init__(self, applicant_id, loan_amount, account_number):
        super().__init__(timeout=None)
        self.applicant_id = applicant_id
        self.loan_amount = loan_amount
        self.account_number = account_number

    def _data(self, interaction):
        # بعد إعادة تشغيل البوت تنقرأ بيانات الطلب من الايمبد نفسه (بدون تخزينها في الـ View المشترك)
        if self.applicant_id:
            return self.applicant_id, self.loan_amount, self.account_number
        try:
            f = {x.name: x.value for x in interaction.message.embeds[0].fields}
            return (int(re.search(r"\d+", f["المواطن"]).group()),
                    int(re.sub(r"\D", "", f["3- مبلغ القرض المطلوب"])),
                    re.search(r"`(.+?)`", f["رقم الآيبان"]).group(1))
        except Exception:
            return 0, 0, ""

    @discord.ui.button(label="قبول", style=discord.ButtonStyle.success, custom_id="loan:accept_unique")
    async def accept(self, interaction: discord.Interaction, button: discord.ui.Button):
        applicant_id, loan_amount, account_number = self._data(interaction)
        if not applicant_id:
            await interaction.response.send_message("❌ تعذر قراءة بيانات الطلب.", ephemeral=True)
            return
        if not is_staff(interaction.user):
            await interaction.response.send_message("❌ للإدارة أو مسؤولي البنك فقط.", ephemeral=True)
            return
        for child in self.children:
            child.disabled = True
        await interaction.response.edit_message(view=self)
        
        cursor.execute("UPDATE accounts SET balance = balance + ? WHERE guild_id = ? AND account_number = ?", (loan_amount, interaction.guild.id, account_number))
        cursor.execute(
            "INSERT INTO loans (guild_id, user_id, account_number, amount, status, created_at) VALUES (?, ?, ?, ?, 'active', ?)",
            (interaction.guild.id, applicant_id, account_number, loan_amount, now())
        )
        db.commit()
        
        add_transaction(interaction.guild.id, applicant_id, "قرض", loan_amount, f"صرف قرض معتمد بواسطة {interaction.user.name}")
        await send_log(interaction.guild, interaction.client, "قبول وصرف قرض", f"المسؤول: {interaction.user.mention}\nالمواطن: <@{applicant_id}>\nالمبلغ: **{loan_amount:,} ريال**")

        try:
            applicant = interaction.guild.get_member(applicant_id) or await interaction.client.fetch_user(applicant_id)
            if applicant:
                embed_dm = discord.Embed(
                    title="✅ تم قبول طلب القرض وصرفه",
                    description=f"مبروك! تم قبول طلب القرض الخاص بك بقيمة **{loan_amount:,} ريال** وإيداعها في حسابك البنكي بواسطة {interaction.user.mention}.",
                    color=discord.Color.green()
                )
                await applicant.send(embed=embed_dm)
        except Exception:
            pass

        await interaction.followup.send(f"✅ تم قبول القرض وصرف مبلغ **{loan_amount:,} ريال** للمواطن <@{applicant_id}> بواسطة {interaction.user.mention}")

    @discord.ui.button(label="رفض", style=discord.ButtonStyle.danger, custom_id="loan:reject_unique")
    async def reject(self, interaction: discord.Interaction, button: discord.ui.Button):
        applicant_id, loan_amount, account_number = self._data(interaction)
        if not applicant_id:
            await interaction.response.send_message("❌ تعذر قراءة بيانات الطلب.", ephemeral=True)
            return
        if not is_staff(interaction.user):
            await interaction.response.send_message("❌ للإدارة أو مسؤولي البنك فقط.", ephemeral=True)
            return
        for child in self.children:
            child.disabled = True
        await interaction.response.edit_message(view=self)

        try:
            applicant = interaction.guild.get_member(applicant_id) or await interaction.client.fetch_user(applicant_id)
            if applicant:
                embed_dm = discord.Embed(
                    title="❌ تم رفض طلب القرض",
                    description=f"نأسف لك، تم رفض طلب القرض الخاص بك بقيمة **{loan_amount:,} ريال** بواسطة {interaction.user.mention}.",
                    color=discord.Color.red()
                )
                await applicant.send(embed=embed_dm)
        except Exception:
            pass

        await interaction.followup.send(f"❌ تم رفض القرض للمواطن <@{applicant_id}> بواسطة {interaction.user.mention}")


# =========================================================
# قائمة خدمات المواطنين
# =========================================================

class CitizenServicesSelect(discord.ui.Select):
    def __init__(self):
        options = [
            discord.SelectOption(label="الرصيد", description="الاستعلام عن رصيدك البنكي الحالي", emoji="💰", value="balance"),
            discord.SelectOption(label="تحويل", description="تحويل أموال لحساب آخر عبر الآيبان", emoji="💸", value="transfer"),
            discord.SelectOption(label="معلومات الحساب", description="عرض تفاصيل حسابك البنكي والآيبان وقروضك غير المسددة", emoji="🏦", value="account_info"),
            discord.SelectOption(label="طلب قرض", description="تقديم نموذج طلب قرض جديد", emoji="📋", value="loan"),
            discord.SelectOption(label="سداد قرض", description="سداد جزء أو كامل قرضك النشط برقم القرض", emoji="💳", value="repay_loan"),
            discord.SelectOption(label="إعادة تشغيل القائمة", description="تحديث وإعادة تحميل القائمة", emoji="🔄", value="refresh"),
        ]
        super().__init__(placeholder="اختر الخدمة البنكية المطلوبة...", min_values=1, max_values=1, options=options, custom_id="citizen_services_select_menu_unique")

    async def callback(self, interaction: discord.Interaction):
        val = self.values[0]
        
        if val == "refresh":
            await interaction.response.send_message("🔄 تم تحديث وإعادة تحميل القائمة بنجاح.", ephemeral=True)
            return

        account = get_account(interaction.guild.id, interaction.user.id)

        if val != "loan" and not account:
            await interaction.response.send_message("❌ لا يوجد لديك حساب بنكي.", ephemeral=True)
            return

        if val == "balance":
            embed = discord.Embed(title="💰 رصيدك البنكي", description=f"**{account['balance']:,} ريال**")
            await interaction.response.send_message(embed=embed, ephemeral=True)

        elif val == "transfer":
            if account["is_frozen"]:
                await interaction.response.send_message("❌ حسابك موقوف، لا يمكنك التحويل.", ephemeral=True)
                return
            await interaction.response.send_modal(TransferModal())

        elif val == "account_info":
            active_loans = cursor.execute(
                "SELECT id, amount FROM loans WHERE guild_id = ? AND user_id = ? AND status = 'active'",
                (interaction.guild.id, interaction.user.id)
            ).fetchall()

            loans_text = ""
            if active_loans:
                for loan in active_loans:
                    loans_text += f"• رقم القرض: `#{loan['id']}` — المتبقي: **{loan['amount']:,} ريال**\n"
            else:
                loans_text = "لا توجد قروض غير مسددة ✅"

            embed = discord.Embed(
                title="🏦 معلومات الحساب والقروض",
                description=(
                    f"**رقم الحساب (الآيبان):** `{account['account_number']}`\n"
                    f"**الرصيد:** `{account['balance']:,} ريال`\n"
                    f"**حالة الحساب:** `{'موقوف 🛑' if account['is_frozen'] else 'نشط ✅'}`\n"
                    f"**تاريخ الإنشاء:** `{account['created_at']}`\n\n"
                    f"📋 **القروض غير المسددة:**\n{loans_text}"
                ),
                color=discord.Color.blue()
            )
            await interaction.response.send_message(embed=embed, ephemeral=True)

        elif val == "loan":
            await interaction.response.send_modal(LoanModal())

        elif val == "repay_loan":
            loans = cursor.execute("SELECT * FROM loans WHERE guild_id = ? AND user_id = ? AND status = 'active'", (interaction.guild.id, interaction.user.id)).fetchall()
            if not loans:
                await interaction.response.send_message("❌ ليس لديك أي قروض نشطة للسداد.", ephemeral=True)
                return
            await interaction.response.send_modal(RepayLoanModal())


class CitizenServicesView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)
        self.add_item(CitizenServicesSelect())


# =========================================================
# مسؤولي البنك (وكشف الحساب)
# =========================================================

class StaffActionModal(discord.ui.Modal):
    def __init__(self, action_type):
        self.action_type = action_type
        title = "➕ إضافة أموال" if action_type == "add" else ("➖ إزالة أموال" if action_type == "remove" else "🛑 إيقاف / تفعيل حساب")
        super().__init__(title=title)

        self.iban = discord.ui.TextInput(label="رقم الآيبان (4 أرقام)", placeholder="مثال: 4521", required=True, max_length=4)
        self.add_item(self.iban)
        
        if action_type in ["add", "remove"]:
            self.amount = discord.ui.TextInput(label="المبلغ", placeholder="مثال: 5000", required=True)
            self.add_item(self.amount)

    async def on_submit(self, interaction: discord.Interaction):
        target_iban = self.iban.value.strip()
        account = get_account_by_number(interaction.guild.id, target_iban)
        
        if not account:
            await interaction.response.send_message("❌ لم يتم العثور على حساب بهذا الآيبان.", ephemeral=True)
            return

        target_id = account["user_id"]

        if self.action_type == "freeze":
            new_status = 0 if account["is_frozen"] else 1
            cursor.execute("UPDATE accounts SET is_frozen = ? WHERE guild_id = ? AND account_number = ?", (new_status, interaction.guild.id, target_iban))
            db.commit()
            status_text = "تفعيل الحساب ✅" if new_status == 0 else "إيقاف الحساب 🛑"
            await send_log(interaction.guild, interaction.client, "تغيير حالة حساب", f"المسؤول: {interaction.user.mention}\nالآيبان: `{target_iban}`\nالحالة الجديدة: **{status_text}**")
            await interaction.response.send_message(f"✅ تم تغيير حالة الحساب للآيبان (`{target_iban}`) إلى: **{status_text}**", ephemeral=True)
            return

        try:
            amount = int(self.amount.value)
        except ValueError:
            await interaction.response.send_message("❌ المبلغ غير صحيح.", ephemeral=True)
            return

        if amount <= 0:
            await interaction.response.send_message("❌ يجب أن يكون المبلغ أكبر من صفر.", ephemeral=True)
            return

        if self.action_type == "add":
            cursor.execute("UPDATE accounts SET balance = balance + ? WHERE guild_id = ? AND account_number = ?", (amount, interaction.guild.id, target_iban))
            db.commit()
            add_transaction(interaction.guild.id, target_id, "إضافة أموال", amount, f"بواسطة المسؤول {interaction.user.name}")
            await send_log(interaction.guild, interaction.client, "إضافة رصيد", f"المسؤول: {interaction.user.mention}\nالآيبان: `{target_iban}`\nالمبلغ: **{amount:,} ريال**")
            await interaction.response.send_message(f"✅ تم إضافة **{amount:,} ريال** إلى الآيبان (`{target_iban}`).", ephemeral=True)

        elif self.action_type == "remove":
            if account["balance"] < amount:
                await interaction.response.send_message("❌ رصيد صاحب الحساب غير كافي لإتمام الإزالة.", ephemeral=True)
                return
            cursor.execute("UPDATE accounts SET balance = balance - ? WHERE guild_id = ? AND account_number = ?", (amount, interaction.guild.id, target_iban))
            db.commit()
            add_transaction(interaction.guild.id, target_id, "إزالة أموال", amount, f"بواسطة المسؤول {interaction.user.name}")
            await send_log(interaction.guild, interaction.client, "سحب رصيد", f"المسؤول: {interaction.user.mention}\nالآيبان: `{target_iban}`\nالمبلغ المسحوب: **{amount:,} ريال**")
            await interaction.response.send_message(f"✅ تم إزالة **{amount:,} ريال** من الآيبان (`{target_iban}`).", ephemeral=True)


class SalaryAmountModal(discord.ui.Modal, title="💵 تحديد قيمة الراتب"):
    amount = discord.ui.TextInput(label="قيمة الراتب لكل فرد", placeholder="مثال: 5000", required=True)

    async def on_submit(self, interaction: discord.Interaction):
        try:
            amount = int(self.amount.value)
        except ValueError:
            await interaction.response.send_message("❌ مبلغ غير صحيح.", ephemeral=True)
            return

        if amount <= 0:
            await interaction.response.send_message("❌ يجب أن يكون المبلغ أكبر من صفر.", ephemeral=True)
            return

        view = SalaryRoleSelectView(amount)
        await interaction.response.send_message(f"💵 تم تحديد الراتب: **{amount:,} ريال**.\nالرجاء اختيار رتبة الموظفين المستحقة:", view=view, ephemeral=True)


class SalaryRoleSelect(discord.ui.RoleSelect):
    def __init__(self, amount):
        self.salary_amount = amount
        super().__init__(placeholder="اختر رتبة الموظفين المستحقة...", min_values=1, max_values=1, custom_id="salary_role_select_menu_unique")

    async def callback(self, interaction: discord.Interaction):
        role = self.values[0]
        amount = self.salary_amount
        paid = 0

        for member in role.members:
            account = get_account(interaction.guild.id, member.id)
            if not account or account["is_frozen"]:
                continue

            cursor.execute("UPDATE accounts SET balance = balance + ? WHERE guild_id = ? AND account_number = ?", (amount, interaction.guild.id, account["account_number"]))
            db.commit()
            add_transaction(interaction.guild.id, member.id, "راتب", amount, f"صرف راتب رتبة {role.name}")
            paid += 1

            try:
                embed = discord.Embed(
                    title="💵 تم استلام راتبك",
                    description=f"تم إيداع راتب رتبتك (**{role.name}**) بقيمة **{amount:,} ريال** في حسابك البنكي.",
                    color=discord.Color.green()
                )
                await member.send(embed=embed)
            except Exception:
                pass

        await send_log(interaction.guild, interaction.client, "صرف رواتب", f"المسؤول: {interaction.user.mention}\nالرتبة: {role.mention}\nالمبلغ لكل فرد: **{amount:,} ريال**\nعدد المستفيدين: **{paid}**")
        await interaction.response.edit_message(
            content=f"✅ تم توزيع الرواتب بنجاح على رتبة **{role.name}** بقيمة **{amount:,} ريال** لكل فرد.\n(عدد المستفيدين: **{paid}**)",
            view=None
        )


class SalaryRoleSelectView(discord.ui.View):
    def __init__(self, amount):
        super().__init__(timeout=180)
        self.add_item(SalaryRoleSelect(amount))


class AccountStatementSelect(discord.ui.Select):
    def __init__(self, guild: discord.Guild):
        accounts = cursor.execute("SELECT * FROM accounts WHERE guild_id = ?", (guild.id,)).fetchall()
        options = []
        
        if not accounts:
            options.append(discord.SelectOption(label="لا توجد حسابات مسجلة", value="none"))
        else:
            for acc in accounts:
                member = guild.get_member(acc['user_id'])
                display_name = member.display_name if member else f"مستخدم #{acc['user_id']}"
                
                if len(display_name) > 80:
                    display_name = display_name[:77] + "..."

                options.append(
                    discord.SelectOption(
                        label=display_name,
                        description=f"الآيبان: {acc['account_number']} | الرصيد: {acc['balance']:,}",
                        value=str(acc['user_id'])
                    )
                )
                if len(options) >= 25:
                    break

        super().__init__(placeholder="اختر عضواً لعرض كشف حسابه...", min_values=1, max_values=1, options=options, custom_id="account_statement_select_unique")

    async def callback(self, interaction: discord.Interaction):
        if not is_staff(interaction.user):
            await interaction.response.send_message("❌ ليس لديك صلاحية.", ephemeral=True)
            return

        if self.values[0] == "none":
            await interaction.response.send_message("❌ لا توجد أي حسابات بنكية مسجلة في السيرفر حالياً.", ephemeral=True)
            return

        user_id = int(self.values[0])
        account = get_account(interaction.guild.id, user_id)

        if not account:
            await interaction.response.send_message("❌ لم يتم العثور على هذا الحساب.", ephemeral=True)
            return

        member = interaction.guild.get_member(user_id)
        user_mention = member.mention if member else f"<@{user_id}>"

        embed = discord.Embed(
            title="📄 كشف حساب البنك (إداري)",
            description=(
                f"👤 **المواطن:** {user_mention}\n"
                f"🏦 **رقم الآيبان:** `{account['account_number']}`\n"
                f"💰 **الرصيد الحالي:** `{account['balance']:,} ريال`\n"
                f"🛑 **حالة الحساب:** `{'موقوف' if account['is_frozen'] else 'نشط'}`\n"
                f"📅 **تاريخ الإنشاء:** `{account['created_at']}`"
            ),
            color=discord.Color.blue()
        )
        await interaction.response.send_message(embed=embed, ephemeral=True)


class AccountStatementView(discord.ui.View):
    def __init__(self, guild):
        super().__init__(timeout=180)
        self.add_item(AccountStatementSelect(guild))


class BankStaffSelect(discord.ui.Select):
    def __init__(self):
        options = [
            discord.SelectOption(label="كشف حساب", description="عرض أسامي أصحاب الحسابات ومعلوماتها الكاملة", emoji="📄", value="statement"),
            discord.SelectOption(label="توزيع الرواتب", description="صرف رواتب لرتبة معينة مع إشعار الأعضاء", emoji="💵", value="salary"),
            discord.SelectOption(label="عرض القروض", description="استعراض كافة القروض النشطة وأرقامها", emoji="📜", value="view_loans"),
            discord.SelectOption(label="إضافة أموال", description="إضافة رصيد لحساب مواطن عبر الآيبان", emoji="➕", value="add"),
            discord.SelectOption(label="إزالة أموال", description="سحب رصيد من حساب مواطن عبر الآيبان", emoji="➖", value="remove"),
            discord.SelectOption(label="إيقاف / تفعيل حساب", description="تجميد أو تفعيل حساب بنكي عبر الآيبان", emoji="🛑", value="freeze"),
            discord.SelectOption(label="إعادة تشغيل القائمة", description="تحديث وإعادة تحميل القائمة", emoji="🔄", value="refresh"),
        ]
        super().__init__(placeholder="اختر إجراء المسؤول...", min_values=1, max_values=1, options=options, custom_id="bank_staff_select_menu_unique")

    async def callback(self, interaction: discord.Interaction):
        if not is_staff(interaction.user):
            await interaction.response.send_message("❌ ليس لديك صلاحية.", ephemeral=True)
            return

        val = self.values[0]
        if val == "refresh":
            await interaction.response.send_message("🔄 تم تحديث وإعادة تحميل لوحة التحكم بنجاح.", ephemeral=True)
            return
        elif val == "statement":
            view = AccountStatementView(interaction.guild)
            await interaction.response.send_message("📄 الرجاء اختيار العضو المطلوب لعرض كشف حسابه:", view=view, ephemeral=True)
        elif val == "salary":
            await interaction.response.send_modal(SalaryAmountModal())
        elif val == "view_loans":
            loans = cursor.execute("SELECT * FROM loans WHERE guild_id = ? AND status = 'active'", (interaction.guild.id,)).fetchall()
            if not loans:
                await interaction.response.send_message("❌ لا توجد أي قروض نشطة حالياً.", ephemeral=True)
                return
            desc = ""
            for l in loans:
                desc += f"• **رقم القرض:** `#{l['id']}` | المواطن: <@{l['user_id']}> | الآيبان: `{l['account_number']}` | المتبقي: **{l['amount']:,} ريال**\n"
            embed = discord.Embed(title="📜 قائمة القروض النشطة", description=desc, color=discord.Color.gold())
            await interaction.response.send_message(embed=embed, ephemeral=True)
        elif val == "add":
            await interaction.response.send_modal(StaffActionModal("add"))
        elif val == "remove":
            await interaction.response.send_modal(StaffActionModal("remove"))
        elif val == "freeze":
            await interaction.response.send_modal(StaffActionModal("freeze"))


class BankStaffView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)
        self.add_item(BankStaffSelect())


# =========================================================
# embeds البانلات
# =========================================================

def create_account_embed():
    return discord.Embed(title="🏦 فتح حساب بنكي", description="اضغط على الزر أدناه لإنشاء حسابك البنكي والحصول على رقم الآيبان الخاص بك.")

def create_citizen_embed():
    return discord.Embed(title="🏦 خدمات المواطنين البنكية", description="استخدم القائمة أدناه للوصول إلى الخدمات (الرصيد، التحويل، معلومات الحساب، طلب وقروض وسداد القروض).")

def create_staff_embed():
    return discord.Embed(title="🏦 لوحة تحكم مسؤولي البنك", description="هذه اللوحة مخصصة للمسؤولين لإدارة الرواتب، الأرصدة، عرض القروض، كشف الحسابات، وإيقاف الحسابات للمتعثرين.")


# =========================================================
# Cog الكود الرئيسي
# =========================================================

class Bank(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(name="bank_setup", description="إعداد بانلات نظام البنك، روم القروض، روم اللوق، ورتبة مسؤولي البنك")
    @app_commands.describe(
        panel="اختر البانل المراد إرساله",
        loan_channel="روم استقبال طلبات القروض (اختياري)",
        log_channel="روم العمليات واللوق البنكي (اختياري)",
        bank_role="رتبة مسؤولي البنك (اختياري، مقتصرة على الأدمن إن لم تحدد)"
    )
    @app_commands.choices(
        panel=[
            app_commands.Choice(name="بانل إنشاء الحساب", value="account"),
            app_commands.Choice(name="بانل خدمات المواطنين", value="citizens"),
            app_commands.Choice(name="بانل مسؤولي البنك", value="staff"),
            app_commands.Choice(name="إرسال جميع البانلات", value="all")
        ]
    )
    async def bank_setup(
        self,
        interaction: discord.Interaction,
        panel: app_commands.Choice[str],
        loan_channel: discord.TextChannel = None,
        log_channel: discord.TextChannel = None,
        bank_role: discord.Role = None
    ):
        if not interaction.user.guild_permissions.administrator:
            await interaction.response.send_message("❌ هذا الأمر للأعضاء الإداريين فقط.", ephemeral=True)
            return

        await interaction.response.defer(ephemeral=True)

        cursor.execute(
            """
            INSERT INTO guild_settings (guild_id, loan_channel_id, log_channel_id, bank_staff_role_id)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(guild_id) DO UPDATE SET 
                loan_channel_id = COALESCE(?, loan_channel_id),
                log_channel_id = COALESCE(?, log_channel_id),
                bank_staff_role_id = COALESCE(?, bank_staff_role_id)
            """,
            (
                interaction.guild.id, 
                loan_channel.id if loan_channel else None, 
                log_channel.id if log_channel else None,
                bank_role.id if bank_role else None,
                loan_channel.id if loan_channel else None,
                log_channel.id if log_channel else None,
                bank_role.id if bank_role else None
            )
        )
        db.commit()

        if panel.value == "account":
            await interaction.channel.send(embed=create_account_embed(), view=CreateAccountView())
        elif panel.value == "citizens":
            await interaction.channel.send(embed=create_citizen_embed(), view=CitizenServicesView())
        elif panel.value == "staff":
            await interaction.channel.send(embed=create_staff_embed(), view=BankStaffView())
        elif panel.value == "all":
            await interaction.channel.send(embed=create_account_embed(), view=CreateAccountView())
            await interaction.channel.send(embed=create_citizen_embed(), view=CitizenServicesView())
            await interaction.channel.send(embed=create_staff_embed(), view=BankStaffView())

        _cols = {"account": ["account_panel_channel_id"], "citizens": ["citizens_panel_channel_id"],
                 "staff": ["staff_panel_channel_id"],
                 "all": ["account_panel_channel_id", "citizens_panel_channel_id", "staff_panel_channel_id"]}[panel.value]
        for _c in _cols:
            cursor.execute(f"UPDATE guild_settings SET {_c} = ? WHERE guild_id = ?", (interaction.channel.id, interaction.guild.id))
        db.commit()

        await interaction.followup.send("✅ تم حفظ إعدادات البنك وإرسال البانل بنجاح.", ephemeral=True)

    @commands.Cog.listener()
    async def on_ready(self):
        if getattr(self.bot, "_bank_views_loaded", False):
            return
        self.bot.add_view(CreateAccountView())
        self.bot.add_view(CitizenServicesView())
        self.bot.add_view(BankStaffView())
        self.bot.add_view(LoanApprovalView(0, 0, ""))  # أزرار قبول/رفض القروض بعد إعادة التشغيل
        self.bot._bank_views_loaded = True
        print("✅ Bank System Loaded Successfully")


async def setup(bot):
    await bot.add_cog(Bank(bot))