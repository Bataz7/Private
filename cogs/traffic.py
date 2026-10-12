from datetime import datetime, timedelta, timezone
import sqlite3
import discord
from discord import app_commands
from discord.ext import commands, tasks

# محاولة استيراد دالة خصم الأموال من نظام البنك الخارجي إن وجد
try:
    from cogs.bank import deduct_money
except ImportError:
    async def deduct_money(user_id, guild_id, amount):
        # دالة وهمية في حال عدم وجود ملف bank.py لتجنب انهيار البوت
        return True

# =========================================================
# قوائم المخالفات المرورية والأمنية
# =========================================================
VIOLATION_TYPES = {
    # --- القائمة الأولى (المخالفات الأساسية) ---
    "قطع إشارة المرور الحمراء": 3000,
    "عكس اتجاه السير": 3000,
    "التفحيط أو الاستعراض بالمركبة": 2500,
    "تجاوز السرعة المحددة بأكثر من 25 كم/س": 1500,
    "تجاوز السرعة المحددة بأكثر من 40 كم/س": 2000,
    "القيادة بدون رخصة قيادة": 2000,
    "القيادة برخصة قيادة منتهية": 500,
    "القيادة بدون لوحات معدنية": 3000,
    "طمس أو تظليل لوحات المركبة": 2000,
    "الهروب من دورية الأمن أو المرور": 10000,
    "عدم إعطاء الأفضلية للسيارات القادمة من اليمين": 500,
    "التجاوز من الأماكن الممنوعة (كتف الطريق)": 1000,
    "استخدام الهاتف المحمول أثناء القيادة": 500,
    "عدم ربط حزام الأمان": 300,
    "وضع كتابات أو ملصقات غير مرخصة على الهيكل": 500,
    "إحداث ضوضاء مزعجة باستخدام العادم (صوت عالي)": 1000,
    "الوقوف الخاطئ والمزعج في الأماكن الممنوعة": 500,
    "الوقوف في مواقف ذوي الاحتياجات الخاصة بدون حق": 1000,
    "إعاقة حركة المرور عمداً": 1500,
    "عدم ترك مسافة أمان كافية بين المركبات": 500,
    "الانحراف المفاجئ بين المسارات بدون إشارة": 500,
    "دخول الشاحنات في أوقات وأماكن غير مخصصة": 1000,
    "القيادة بإنارة تالفة أو غير مطابقة للمواصفات": 300,
    "عدم تغطية الحمولة ونقلها بطريقة غير آمنة": 1000,
    "ترك المركبة مشغولة وغير متروكة بحذر": 300,
    
    # --- القائمة الثانية (المخالفات الإضافية) ---
    "التجمهر لعرقلة حركة السير أو معاينة الحوادث": 1000,
    "القيادة تحت تأثير مواد مسكرة أو منومة": 5000,
    "استخدام الإضاءة العالية بشكل مزعج للمقابلين": 300,
    "إلقاء النفايات أو المخلفات من نافذة المركبة": 500,
    "الرجوع للخارج بطريقة خطرة في الشارع العام": 500,
    "عدم إعطاء الأفضلية لسيارات الطوارئ والإسعاف": 2000,
    "قيادة مركبة تنبعث منها عوادم ضارة بالبيئة": 500,
    "عدم استخدام إشارات الانحراف عند تغيير المسار": 300,
    "ترك الأطفال دون سن العاشرة في السيارة بمفرددهم": 1000,
    "استخدام الأجهزة الذكية أو التلفاز أثناء السواقة": 900,
    "قيادة دراجة نارية بدون خوذة حماية": 500,
    "نقل عدد ركاب يزيد عن الاستيعاب المحدد للمركبة": 800,
    "القيادة على مسارات الطوارئ في غير الحالات المسموحة": 3000,
    "عدم الالتزام بالمسار المخصص لاتجاه حركة المرور": 500,
    "التباطؤ في السير بشكل يعرقل الحركة المرورية": 400,
    "إجراء تعديلات على مظهر أو هيكل المركبة بدون تصريح": 2000,
    "عدم وجود إطار احتياطي أو أدوات السلامة الأساسية": 300,
    "الوقوف في التقاطعات أو الأماكن التي تعيق الرؤية": 600,
    "تجاوز الرتل العسكري أو مواكب الأمهات الرسمية": 3000,
    "القيادة بلوحة مرورية غير واضحة المعالم أو التالفة": 1000,
    "استخدام ميكروفونات أو مكبرات صوت غير مرخصة": 800,
    "عدم تقديم المساعدة للمصابين في حادث مروري متورط به": 5000,
    "تحميل بضائع ترتفع بشكل يترتب عليه خطر السقوط": 1500,
    "القيادة ببطء شديد يسبب إعاقة في الطرق السريعة": 500,
    "الاستعراض بالسيارات القديمة المعطلة في الشوارع العامة": 1200,

    # --- القائمة الثالثة (مخالفات الـ RP) ---
    "عدم استعمال الأنوار في الأوقات المخصصة (ليلاً/ضباب)": 400,
    "مخالفة الهروب من رجال الأمن (سير على الأقدام أو مراوغة)": 4000,
    "صدم وإتلاف الممتلكات العامة (أرصفة، إشارات، أعمدة)": 2000,
    "إزعاج المواطنين باستخدام البوري أو الهرن باستمرار": 500,
    "عدم امتلاك تصريح سلاح رسمي (حيازة غير مرخصة)": 10000,
    "إشهار السلاح في الأماكن العامة بدون سبب قانوني": 7000,
    "ارتداء قناع أو إخفاء الهوية في الأماكن العامة الممنوعة": 1000,
    "التواجد في المناطق العسكرية المحظورة بدون تصريح": 5000,
    "إلقاء شتائم أو إهانة عنصر أمني أثناء تأدية عمله": 2500,
    "محاولة رشوة رجل الأمن أو محاولة التلاعب بالمخالفة": 3500,
    "القيادة داخل الأرصفة وممشى المشاة": 1000,
    "الاصطدام المتعمد بمركبة أخرى (تخريب متعمد)": 3000,
    "عدم الامتثال لأوامر نقطة التفتيش الأمنية": 2500,
    "التجول بمركبة مسروقة أو بلا إثبات ملكية": 4000,
    "التسول أو إعاقة المارة في الشوارع التجارية": 600,
    "إشعال النيران في الأماكن العامة غير المخصصة لذلك": 1500,
    "تسلق المباني الحكومية أو المرافق العامة بطريقة خطرة": 2000,
    "إيقاف المركبة بشكل يعيق خروج السيارات الأخرى (سد الطريق)": 500,
    "استخدام أجهزة اتصال لاسلكية مقلدة أو بدون ترخيص أمني": 1500,
    "الدخول للمناطق السكنية بسرعة جنونية وتشكيل خطر": 1200,
    "الاعتداء اللفظي على المواطنين في الشارع": 1000,
    "رفض إبراز الهوية أو رخصة القيادة لرجل الأمن": 1500,
    "نقل مواد ممنوعة أو غير قانونية في صندوق المركبة": 6000,
    "الوقوف أمام مخارج الطوارئ أو مراكز الشرطة والمستشفيات": 1500,
    "تلويث الشارع العام أو الرسم العشوائي (جرافيتي) على الممتلكات": 800,

    # --- القائمة الرابعة الكاملة ---
    "عدم الوقوف عند لوحة STOP بالشارع": 800,
    "تجاوز الإشارة الضوئية برعونة أثناء التفافه يميناً": 1000,
    "استخدام الأضواء الكاشفة غير القانونية بوجه السائقين": 600,
    "الوقوف المزدوج في الشوارع الرئيسية الضيقة": 500,
    "عدم إعطاء الأفضلية للمشاة في مناطق العبور المخصصة": 700,
    "ترك محرك السيارة يعمل أثناء النزول منها في الأماكن العامة": 400,
    "قيادة المركبة بإطارات مهترئة تشكل خطراً على السلامة": 900,
    "القيادة بلوحة خلفية غير مقروءة أو متسخة تماماً": 800,
    "التوقف المفاجئ وغير المبرر في المسار السريع": 1200,
    "استخدام مسار حافلات النقل أو الطوارئ للمراوغة": 2000,
    "وضع زجاج مظلل بالكامل بدون استثناءات نظامية": 1000,
    "تجاوز الحواجز الأمنية المؤقتة بدون إذن": 5000,
    "القيادة بمركبة تصدر أصوات فرامل حادة ومزعجة": 500,
    "عدم وجود ولاعة أو طفاية حريق أساسية بالمركبة": 400,
    "استخدام أجهزة كشف الرادار أو منع رصد السرعة": 3000,
    "الوقوف في مناطق التحميل والتنزيل المخصصة للشاحنات": 800,
    "تغيير لون المركبة بالكامل دون تعديل الأوراق الرسمية": 1500,
    "القيادة بوضعيات جلوس غير آمنة أو خطرة للسائق": 600,
    "إلقاء أعقاب السجائر أو مواد قابلة للاشتعال بالطريق": 700,
    "عدم تشغيل مصابيح الضباب في الأجواء المناخية السيئة": 500,
    "استخدام مسجل الصوت بأعلى صوت قرب المستشفيات والمدارس": 900,
    "الوقوف العشوائي في مداخل ومخارج المباني السكنية": 600,
    "عدم تثبيت اللوحة الأمامية للمركبة في مكانها المخصص": 1000,
    "قيادة المركبة بسرعة منخفضة جداً بالمسار الأيسر السريع": 700,
    "التلاعب بمؤشرات عداد السرعة أو الكيلومترات بالمركبة": 2000
}

# =========================================================
# واجهات التفاعل (Views & Modals)
# =========================================================

class ViolationSelect(discord.ui.Select):
    def __init__(self, target_member: discord.Member, car_info: dict, page: int = 0, cog=None):
        self.target_member = target_member
        self.car_info = car_info
        self.page = page
        self.cog = cog
        
        items = list(VIOLATION_TYPES.items())
        start = page * 25
        end = start + 25
        current_items = items[start:end]
        
        options = [
            discord.SelectOption(
                label=name[:100], 
                description=f"الغرامة: {money(price)}"[:100], 
                value=str(index + start),
                emoji="🚨"
            )
            for index, (name, price) in enumerate(current_items)
        ]
        max_pages = (len(items) - 1) // 25 + 1
        super().__init__(placeholder=f"اختر المخالفة المرورية (صفحة {page+1} من {max_pages})...", min_values=1, max_values=1, options=options)
        self.items = items

    async def callback(self, interaction: discord.Interaction):
        item_index = int(self.values[0])
        reason, amount = list(VIOLATION_TYPES.items())[item_index]

        self.cog.cursor.execute(
            """
        INSERT INTO traffic_violations
        (guild_id, user_id, officer_id, car_type, car_model, car_color, car_plate, reason, amount, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', ?)
        """,
            (
                interaction.guild.id,
                self.target_member.id,
                interaction.user.id,
                self.car_info["type"],
                self.car_info["model"],
                self.car_info["color"],
                self.car_info["plate"],
                reason,
                amount,
                datetime.now(timezone.utc).isoformat(),
            ),
        )
        self.cog.db.commit()
        violation_id = self.cog.cursor.lastrowid

        await interaction.response.edit_message(
            content=f"✅ **تم تسجيل المخالفة بنجاح!**\n"
                    f"👤 المخالف: {self.target_member.mention}\n"
                    f"🚗 المركبة: `{self.car_info['type']} - {self.car_info['model']} - {self.car_info['color']}`\n"
                    f"🔢 اللوحة: `{self.car_info['plate']}`\n"
                    f"📝 السبب: `{reason}`\n"
                    f"💰 الغرامة: `{money(amount)}`\n"
                    f"🆔 رقم المخالفة: `#{violation_id}`\n"
                    f"⏳ ملاحظة: ستسحب تلقائياً من البنك خلال 5 أيام إذا لم تُسدد.",
            view=None,
        )

        try:
            embed_dm = make_embed(
                interaction.guild,
                "🚨 مخالفة مرورية جديدة",
                f"تم تسجيل مخالفة مرورية بحقك:\n\n"
                f"🚗 **المركبة:** {self.car_info['type']} ({self.car_info['model']}) - {self.car_info['color']}\n"
                f"🔢 **رقم اللوحة:** {self.car_info['plate']}\n"
                f"📋 **السبب:** {reason}\n"
                f"💰 **الغرامة:** {money(amount)}\n"
                f"👮 **العسكري:** {interaction.user.mention}\n"
                f"🆔 **رقم المخالفة:** `#{violation_id}`\n\n"
                f"⚠️ **تنبيه:** مهلة السداد 5 أيام، وبعدها سيتم السحب تلقائياً من رصيدك البنكي."
            )
            await self.target_member.send(embed=embed_dm)
        except:
            pass

        await self.cog.log_action(
            interaction.guild,
            make_embed(
                interaction.guild,
                "🚨 تسجيل مخالفة مرورية",
                f"👤 **المخالف:** {self.target_member.mention}\n"
                f"👮 **العسكري:** {interaction.user.mention}\n"
                f"🚗 **المركبة:** {self.car_info['type']} / {self.car_info['model']} / {self.car_info['color']}\n"
                f"🔢 **اللوحة:** `{self.car_info['plate']}`\n"
                f"📝 **السبب:** {reason}\n"
                f"💰 **الغرامة:** {money(amount)}\n"
                f"🆔 **رقم المخالفة:** `#{violation_id}`",
                discord.Color.orange(),
            ),
        )

class PrevPageButton(discord.ui.Button):
    def __init__(self, target_member, car_info, page, cog):
        super().__init__(label="الصفحة السابقة ◀️", style=discord.ButtonStyle.secondary)
        self.target_member = target_member
        self.car_info = car_info
        self.page = page
        self.cog = cog

    async def callback(self, interaction: discord.Interaction):
        view = ViolationSelectView(self.target_member, self.car_info, self.page - 1, self.cog)
        await interaction.response.edit_message(view=view)

class NextPageButton(discord.ui.Button):
    def __init__(self, target_member, car_info, page, cog):
        super().__init__(label="الصفحة التالية ▶️", style=discord.ButtonStyle.secondary)
        self.target_member = target_member
        self.car_info = car_info
        self.page = page
        self.cog = cog

    async def callback(self, interaction: discord.Interaction):
        view = ViolationSelectView(self.target_member, self.car_info, self.page + 1, self.cog)
        await interaction.response.edit_message(view=view)

class ViolationSelectView(discord.ui.View):
    def __init__(self, target_member: discord.Member, car_info: dict, page: int = 0, cog=None):
        super().__init__(timeout=120)
        self.target_member = target_member
        self.car_info = car_info
        self.page = page
        self.cog = cog
        
        self.add_item(ViolationSelect(target_member, car_info, page, cog))
        
        if len(VIOLATION_TYPES) > 25:
            if page > 0:
                self.add_item(PrevPageButton(target_member, car_info, page, cog))
            if (page + 1) * 25 < len(VIOLATION_TYPES):
                self.add_item(NextPageButton(target_member, car_info, page, cog))

class MemberSelectView(discord.ui.View):
    def __init__(self, car_info: dict, cog):
        super().__init__(timeout=120)
        self.car_info = car_info
        self.cog = cog

    @discord.ui.select(
        cls=discord.ui.UserSelect,
        placeholder="اختر العضو المخالف من القائمة أو ابحث عنه...",
        min_values=1,
        max_values=1
    )
    async def select_callback(self, interaction: discord.Interaction, select: discord.ui.UserSelect):
        target_member = interaction.guild.get_member(select.values[0].id)
        if not target_member:
            try:
                target_member = await interaction.guild.fetch_member(select.values[0].id)
            except:
                return await interaction.response.send_message("❌ العضو غير موجود في السيرفر.", ephemeral=True)
        
        view = ViolationSelectView(target_member, self.car_info, page=0, cog=self.cog)
        await interaction.response.edit_message(
            content=f"🎯 تم اختيار العضو: **{target_member.display_name}**\nالآن يرجى اختيار نوع المخالفة المرورية:",
            view=view
        )

class CarInfoModal(discord.ui.Modal, title="🚗 بيانات المركبة المخالفة"):
    car_type = discord.ui.TextInput(label="1- نوع المركبة", placeholder="مثال: فورد، شفروليه، تاهو...")
    car_model = discord.ui.TextInput(label="2- موديل المركبة", placeholder="مثال: 2024، سيدان...")
    car_color = discord.ui.TextInput(label="3- لون المركبة", placeholder="مثال: أسود، أبيض...")
    car_plate = discord.ui.TextInput(label="4- لوحة المركبة", placeholder="مثال: أ ب ج 1234")

    def __init__(self, cog):
        super().__init__()
        self.cog = cog

    async def on_submit(self, interaction: discord.Interaction):
        car_info = {
            "type": self.car_type.value,
            "model": self.car_model.value,
            "color": self.car_color.value,
            "plate": self.car_plate.value
        }

        await interaction.response.send_message(
            f"📋 تم حفظ معلومات المركبة بنجاح.\n"
            f"الخطوة التالية: **اختر العضو المراد مخالفته** من القائمة أدناه:",
            view=MemberSelectView(car_info, self.cog),
            ephemeral=True
        )

class RemoveViolationSelect(discord.ui.Select):
    def __init__(self, violations_list, guild: discord.Guild, cog):
        self.guild = guild
        self.cog = cog
        options = []
        for v in violations_list[:25]:  # ديسكورد يقبل 25 خياراً كحد أقصى
            v_id = v['id']
            user_id = v['user_id']
            member = guild.get_member(user_id)
            name = member.display_name if member else f"مستخدم ({user_id})"
            
            options.append(
                discord.SelectOption(
                    label=f"مخالفة #{v_id} - {name}"[:100],
                    description=f"السبب: {v['reason']} | المبلغ: {money(v['amount'])}"[:100],
                    value=str(v_id),
                    emoji="🗑️"
                )
            )
        super().__init__(placeholder="اختر المخالفة المراد إزالتها...", min_values=1, max_values=1, options=options)

    async def callback(self, interaction: discord.Interaction):
        v_id = int(self.values[0])
        
        violation = self.cog.cursor.execute("SELECT * FROM traffic_violations WHERE id = ?", (v_id,)).fetchone()
        if not violation:
            return await interaction.response.send_message("❌ هذه المخالفة غير موجودة أو تم حذفها مسبقاً.", ephemeral=True)

        user_id = violation['user_id']
        reason = violation['reason']
        amount = violation['amount']

        self.cog.cursor.execute("DELETE FROM traffic_violations WHERE id = ?", (v_id,))
        self.cog.db.commit()

        await interaction.response.edit_message(
            content=f"✅ **تم إزالة المخالفة بنجاح!**\n🆔 رقم المخالفة: `#{v_id}`\n📋 السبب المزال: `{reason}`",
            embed=None,
            view=None
        )

        member = interaction.guild.get_member(user_id)
        if not member:
            try:
                member = await interaction.guild.fetch_member(user_id)
            except:
                member = None

        if member:
            try:
                embed_dm = make_embed(
                    interaction.guild,
                    "🛡️ تم إزالة مخالفة مرورية عنك",
                    f"قام العسكري {interaction.user.mention} بإزالة إحدى المخالفات النشطة المسجلة بحقك:\n\n"
                    f"🆔 **رقم المخالفة:** `#{v_id}`\n"
                    f"📋 **السبب:** {reason}\n"
                    f"💰 **الغرامة:** {money(amount)}",
                    discord.Color.green()
                )
                await member.send(embed=embed_dm)
            except:
                pass

        await self.cog.log_action(
            interaction.guild,
            make_embed(
                interaction.guild,
                "🗑️ إزالة مخالفة مرورية (خطأ مطبعي/إلغاء)",
                f"👮 **العسكري:** {interaction.user.mention}\n"
                f"👤 **المواطن:** {member.mention if member else f'<@{user_id}>'}\n"
                f"🆔 **رقم المخالفة:** `#{v_id}`\n"
                f"📝 **السبب المزال:** {reason}\n"
                f"💰 **قيمة المخالفة:** {money(amount)}",
                discord.Color.blue()
            )
        )

class RemoveViolationUserSelect(discord.ui.Select):
    def __init__(self, users_with_violations, guild: discord.Guild, cog):
        self.guild = guild
        self.cog = cog
        options = []
        for u in users_with_violations[:25]:  # ديسكورد يقبل 25 خياراً كحد أقصى
            user_id = u['user_id']
            member = guild.get_member(user_id)
            name = member.display_name if member else f"مستخدم ({user_id})"
            
            options.append(
                discord.SelectOption(
                    label=name[:100],
                    description=f"المخالفات النشطة: {u['count']} | الإجمالي: {money(u['total'])}"[:100],
                    value=str(user_id),
                    emoji="👤"
                )
            )
        super().__init__(placeholder="اختر العضو لعرض مخالفاته النشطة وإزالة ما تحتاجه...", min_values=1, max_values=1, options=options)

    async def callback(self, interaction: discord.Interaction):
        target_user_id = int(self.values[0])
        member = interaction.guild.get_member(target_user_id)
        member_name = member.display_name if member else f"مستخدم ({target_user_id})"

        user_violations = self.cog.cursor.execute(
            """
            SELECT * FROM traffic_violations 
            WHERE guild_id = ? AND user_id = ? AND status = 'unpaid'
            ORDER BY id DESC
            """,
            (interaction.guild.id, target_user_id)
        ).fetchall()

        if not user_violations:
            return await interaction.response.send_message("❌ هذا العضو ليس لديه أي مخالفات نشطة (غير مسددة).", ephemeral=True)

        view = discord.ui.View(timeout=120)
        view.add_item(RemoveViolationSelect(user_violations, interaction.guild, self.cog))

        embed = make_embed(
            interaction.guild,
            f"🗑️ إزالة مخالفة للمواطن: {member_name}",
            "اختر المخالفة المطلوبة من القائمة أدناه لحذفها فوراً:",
            discord.Color.orange()
        )
        await interaction.response.edit_message(content=None, embed=embed, view=view)

class RemoveViolationView(discord.ui.View):
    def __init__(self, users_with_violations, guild: discord.Guild, cog):
        super().__init__(timeout=120)
        self.add_item(RemoveViolationUserSelect(users_with_violations, guild, cog))

class UserViolationsDetailView(discord.ui.View):
    def __init__(self, target_user_id: int, cog):
        super().__init__(timeout=120)
        self.target_user_id = target_user_id
        self.cog = cog

    @discord.ui.button(label="العودة لقائمة المخالفين 🔙", style=discord.ButtonStyle.secondary)
    async def back_to_list(self, interaction: discord.Interaction, button: discord.ui.Button):
        violations = self.cog.cursor.execute(
            """
        SELECT user_id, COUNT(*) as count, SUM(amount) as total 
        FROM traffic_violations 
        WHERE guild_id = ? AND status = 'unpaid' 
        GROUP BY user_id
        """,
            (interaction.guild.id,),
        ).fetchall()

        if not violations:
            return await interaction.response.edit_message(content="🎉 لا توجد مخالفات غير مسددة حالياً!", embed=None, view=None)

        view = UnpaidUsersSelectView(violations, interaction.guild, self.cog)
        embed = make_embed(interaction.guild, "📋 قائمة الأشخاص الذين عليهم مخالفات غير مسددة", "اختر العضو من القائمة أدناه لعرض تفاصيل مخالفاته:", discord.Color.orange())
        await interaction.response.edit_message(content=None, embed=embed, view=view)

class UserViolationsSelect(discord.ui.Select):
    def __init__(self, violations, guild: discord.Guild, cog):
        self.cog = cog
        options = []
        for v in violations[:25]:  # ديسكورد يقبل 25 خياراً كحد أقصى
            user_id = v['user_id']
            member = guild.get_member(user_id)
            member_name = member.display_name if member else f"مستخدم ({user_id})"
            
            options.append(
                discord.SelectOption(
                    label=member_name[:100],
                    description=f"عدد المخالفات: {v['count']} | الإجمالي: {money(v['total'])}"[:100],
                    value=str(user_id),
                    emoji="👤"
                )
            )
        super().__init__(placeholder="اختر عضواً لعرض مخالفاته بالتفصيل...", min_values=1, max_values=1, options=options)

    async def callback(self, interaction: discord.Interaction):
        target_user_id = int(self.values[0])
        member = interaction.guild.get_member(target_user_id)
        member_name = member.display_name if member else f"مستخدم ({target_user_id})"

        user_violations = self.cog.cursor.execute(
            """
        SELECT * FROM traffic_violations 
        WHERE guild_id = ? AND user_id = ? AND status = 'unpaid'
        ORDER BY id DESC
        """,
            (interaction.guild.id, target_user_id),
        ).fetchall()

        text = f"👤 **المخالف:** {member.mention if member else f'<@{target_user_id}>'}\n\n"
        for v in user_violations:
            time_ago = format_time_diff(v['created_at'])
            text += (
                f"🔹 **رقم المخالفة:** `#{v['id']}`\n"
                f"💰 **الغرامة:** {money(v['amount'])}\n"
                f"🚗 **المركبة:** {v['car_type']} ({v['car_plate']})\n"
                f"📝 **السبب:** {v['reason']}\n"
                f"⏳ **الوقت:** {time_ago}\n"
                f"-----------------------------------\n"
            )

        embed = make_embed(interaction.guild, f"📋 تفاصيل مخالفات: {member_name}", text, discord.Color.red())
        view = UserViolationsDetailView(target_user_id, self.cog)
        await interaction.response.edit_message(content=None, embed=embed, view=view)

class UnpaidUsersSelectView(discord.ui.View):
    def __init__(self, violations, guild: discord.Guild, cog):
        super().__init__(timeout=120)
        self.add_item(UserViolationsSelect(violations, guild, cog))

class PayViolationSelect(discord.ui.Select):
    def __init__(self, violations, cog):
        self.cog = cog
        options = []
        for v in violations[:25]:  # ديسكورد يقبل 25 خياراً كحد أقصى
            v_id = v['id']
            options.append(
                discord.SelectOption(
                    label=f"مخالفة #{v_id} — {money(v['amount'])}"[:100],
                    description=f"السبب: {v['reason']}"[:100],
                    value=str(v_id),
                    emoji="💳"
                )
            )
        super().__init__(placeholder="اختر المخالفة التي تريد سدادها...", min_values=1, max_values=1, options=options)

    async def callback(self, interaction: discord.Interaction):
        v_id = int(self.values[0])

        violation = self.cog.cursor.execute(
            "SELECT * FROM traffic_violations WHERE id = ? AND guild_id = ?",
            (v_id, interaction.guild.id),
        ).fetchone()

        if not violation:
            return await interaction.response.send_message("❌ هذه المخالفة غير موجودة.", ephemeral=True)

        if violation["user_id"] != interaction.user.id and not interaction.user.guild_permissions.administrator:
            return await interaction.response.send_message("❌ هذه المخالفة ليست مسجلة باسمك.", ephemeral=True)

        if violation["status"] == "paid":
            return await interaction.response.send_message("⚠️ هذه المخالفة مسددة مسبقاً!", ephemeral=True)

        amount = violation["amount"]

        success = await deduct_money(interaction.user.id, interaction.guild.id, amount)
        if not success:
            return await interaction.response.send_message(
                f"❌ رصيدك البنكي لا يكفي أو غير مسجل بالبنك! (قيمة المخالفة: {money(amount)})",
                ephemeral=True,
            )

        self.cog.cursor.execute(
            "UPDATE traffic_violations SET status = 'paid' WHERE id = ?",
            (v_id,),
        )
        self.cog.db.commit()

        await interaction.response.edit_message(
            content=f"✅ **تم سداد المخالفة بنجاح!**\n🆔 رقم المخالفة: `#{v_id}`\n💰 المبلغ المخصوم: `{money(amount)}`",
            embed=None,
            view=None
        )

        await self.cog.log_action(
            interaction.guild,
            make_embed(
                interaction.guild,
                "💳 سداد مخالفة",
                f"👤 **المواطن:** {interaction.user.mention}\n"
                f"🆔 **رقم المخالفة:** `#{v_id}`\n"
                f"💰 **المبلغ المسدد:** {money(amount)}",
                discord.Color.green(),
            ),
        )

class PayViolationSelectView(discord.ui.View):
    def __init__(self, violations, cog):
        super().__init__(timeout=120)
        self.add_item(PayViolationSelect(violations, cog))

class TrafficControlView(discord.ui.View):
    def __init__(self, cog):
        super().__init__(timeout=None)
        self.cog = cog

    @discord.ui.button(
        label="تسجيل مخالفة",
        emoji="🚨",
        style=discord.ButtonStyle.danger,
        custom_id="control_issue_violation"
    )
    async def issue_violation(self, interaction: discord.Interaction, button: discord.ui.Button):
        if not self.cog.is_police(interaction):
            return await interaction.response.send_message("❌ هذا الزر مخصص لرجال المرور والعساكر فقط.", ephemeral=True)
        
        await interaction.response.send_modal(CarInfoModal(self.cog))

    @discord.ui.button(
        label="إزالة مخالفة",
        emoji="🗑️",
        style=discord.ButtonStyle.primary,
        custom_id="control_remove_violation"
    )
    async def remove_violation_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        if not self.cog.is_police(interaction):
            return await interaction.response.send_message("❌ هذا الزر مخصص لرجال المرور والعساكر فقط.", ephemeral=True)

        users_with_violations = self.cog.cursor.execute(
            """
            SELECT user_id, COUNT(*) as count, SUM(amount) as total 
            FROM traffic_violations 
            WHERE guild_id = ? AND status = 'unpaid'
            GROUP BY user_id
            """,
            (interaction.guild.id,)
        ).fetchall()

        if not users_with_violations:
            return await interaction.response.send_message("🎉 لا توجد أي مخالفات نشطة (غير مسددة) في السيرفر حالياً!", ephemeral=True)

        embed = make_embed(
            interaction.guild,
            "🗑️ لوحة إزالة المخالفات المرورية",
            "اختر العضو المراد إزالة مخالفة عنه من القائمة أدناه:",
            discord.Color.dark_blue()
        )
        view = RemoveViolationView(users_with_violations, interaction.guild, self.cog)
        await interaction.response.send_message(embed=embed, view=view, ephemeral=True)

    @discord.ui.button(
        label="عرض المخالفات الغير مسدده",
        emoji="🔍",
        style=discord.ButtonStyle.secondary,
        custom_id="control_check_unpaid"
    )
    async def check_unpaid_violations(self, interaction: discord.Interaction, button: discord.ui.Button):
        if not self.cog.is_police(interaction):
            return await interaction.response.send_message("❌ هذا الزر مخصص لرجال المرور والعساكر فقط.", ephemeral=True)

        violations = self.cog.cursor.execute(
            """
        SELECT user_id, COUNT(*) as count, SUM(amount) as total 
        FROM traffic_violations 
        WHERE guild_id = ? AND status = 'unpaid' 
        GROUP BY user_id
        """,
            (interaction.guild.id,),
        ).fetchall()

        if not violations:
            return await interaction.response.send_message("🎉 لا توجد أي مخالفات مرورية غير مسددة في السيرفر حالياً!", ephemeral=True)

        embed = make_embed(
            interaction.guild, 
            "📋 قائمة الأشخاص الذين عليهم مخالفات غير مسددة", 
            "اختر العضو من القائمة أدناه لعرض تفاصيل مخالفاته:", 
            discord.Color.orange()
        )
        view = UnpaidUsersSelectView(violations, interaction.guild, self.cog)
        await interaction.response.send_message(embed=embed, view=view, ephemeral=True)

class TrafficCitizenView(discord.ui.View):
    def __init__(self, cog):
        super().__init__(timeout=None)
        self.cog = cog

    @discord.ui.button(
        label="مخالفاتي",
        emoji="📜",
        style=discord.ButtonStyle.primary,
        custom_id="citizen_my_violations"
    )
    async def my_violations(self, interaction: discord.Interaction, button: discord.ui.Button):
        violations = self.cog.cursor.execute(
            """
        SELECT * FROM traffic_violations
        WHERE guild_id = ? AND user_id = ? AND status = 'unpaid'
        ORDER BY id DESC LIMIT 15
        """,
            (interaction.guild.id, interaction.user.id),
        ).fetchall()

        if not violations:
            return await interaction.response.send_message("🎉 سجلك نظيف! ليس لديك أي مخالفات مرورية غير مسددة.", ephemeral=True)

        text = ""
        for v in violations:
            time_ago = format_time_diff(v['created_at'])
            text += (
                f"**#{v['id']}** — {money(v['amount'])} (❌ غير مسددة)\n"
                f"🚗 **المركبة:** {v['car_type']} ({v['car_plate']})\n"
                f"📝 **السبب:** {v['reason']}\n"
                f"⏳ **المضى:** {time_ago}\n\n"
            )

        embed = make_embed(interaction.guild, "📋 سجل مخالفاتك المرورية غير المسددة", text, discord.Color.gold())
        await interaction.response.send_message(embed=embed, ephemeral=True)

    @discord.ui.button(
        label="سداد مخالفة",
        emoji="💳",
        style=discord.ButtonStyle.success,
        custom_id="citizen_pay_violation"
    )
    async def pay_violation_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        violations = self.cog.cursor.execute(
            """
            SELECT * FROM traffic_violations 
            WHERE guild_id = ? AND user_id = ? AND status = 'unpaid'
            ORDER BY id DESC
            """,
            (interaction.guild.id, interaction.user.id)
        ).fetchall()

        if not violations:
            return await interaction.response.send_message("🎉 ليس لديك أي مخالفات غير مسددة لسدادها!", ephemeral=True)

        embed = make_embed(
            interaction.guild,
            "💳 قائمة سداد المخالفات",
            "اختر المخالفة التي تريد سدادها من القائمة أدناه:",
            discord.Color.green()
        )
        view = PayViolationSelectView(violations, self.cog)
        await interaction.response.send_message(embed=embed, view=view, ephemeral=True)

# =========================================================
# الدوال المساعدة العامة (Helpers)
# =========================================================

def server_icon(guild):
    if guild.icon:
        return guild.icon.url
    return None

def make_embed(guild, title, description="", color=discord.Color.red()):
    embed = discord.Embed(
        title=title, description=description, color=color, 
        timestamp=datetime.now(timezone.utc)
    )
    icon = server_icon(guild)
    if icon:
        embed.set_thumbnail(url=icon)
    return embed

def money(value):
    return f"{value:,} ريال"

def format_time_diff(created_at_str):
    try:
        created_at = datetime.fromisoformat(created_at_str)
        now = datetime.now(timezone.utc)
        diff = now - created_at
        
        seconds = int(diff.total_seconds())
        if seconds < 60:
            return "منذ لحظات"
        
        minutes = seconds // 60
        if minutes < 60:
            return f"منذ {minutes} دقيقة"
            
        hours = minutes // 60
        if hours < 24:
            return f"منذ {hours} ساعة"
            
        days = hours // 24
        return f"منذ {days} يوم"
    except:
        return "وقت غير معروف"

# =========================================================
# الـ Cog الأساسي
# =========================================================

class Traffic(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        
        # قاعدة بيانات المرور
        self.DB_FILE = "bank_traffic.db"
        self.db = sqlite3.connect(self.DB_FILE)
        self.db.row_factory = sqlite3.Row
        self.cursor = self.db.cursor()

        self.cursor.execute("""
        CREATE TABLE IF NOT EXISTS traffic_settings (
            guild_id INTEGER PRIMARY KEY,
            police_role INTEGER,
            control_channel INTEGER,
            citizen_channel INTEGER,
            log_channel INTEGER
        )
        """)

        self.cursor.execute("""
        CREATE TABLE IF NOT EXISTS traffic_violations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            officer_id INTEGER NOT NULL,
            car_type TEXT,
            car_model TEXT,
            car_color TEXT,
            car_plate TEXT,
            reason TEXT NOT NULL,
            amount INTEGER NOT NULL,
            status TEXT DEFAULT 'unpaid',
            created_at TEXT
        )
        """)
        self.db.commit()

        # تشغيل التمهيد للأزرار الدائمة في البوت
        self.bot.add_view(TrafficControlView(self))
        self.bot.add_view(TrafficCitizenView(self))
        
        # بدء مهمة السحب التلقائي
        self.auto_deduct_expired_violations.start()

    def cog_unload(self):
        self.auto_deduct_expired_violations.cancel()
        self.db.close()

    def get_traffic_settings(self, guild_id):
        return self.cursor.execute(
            "SELECT * FROM traffic_settings WHERE guild_id = ?", (guild_id,)
        ).fetchone()

    def is_police(self, interaction: discord.Interaction):
        settings = self.get_traffic_settings(interaction.guild.id)
        if not settings:
            return interaction.user.guild_permissions.administrator
        role_id = settings["police_role"]
        if not role_id:
            return interaction.user.guild_permissions.administrator
        role = interaction.guild.get_role(role_id)
        if not role:
            return interaction.user.guild_permissions.administrator
        return (
            role in interaction.user.roles
            or interaction.user.guild_permissions.administrator
        )

    async def log_action(self, guild, embed):
        settings = self.get_traffic_settings(guild.id)
        if not settings or not settings["log_channel"]:
            return
        channel = guild.get_channel(settings["log_channel"])
        if channel:
            await channel.send(embed=embed)

    # =========================================================
    # النظام الخلفي (Background Task) للسحب التلقائي بعد 5 أيام
    # =========================================================
    @tasks.loop(hours=1)
    async def auto_deduct_expired_violations(self):
        await self.bot.wait_until_ready()
        now = datetime.now(timezone.utc)
        deadline = now - timedelta(days=5)

        for guild in self.bot.guilds:
            expired_violations = self.cursor.execute(
                """
                SELECT * FROM traffic_violations 
                WHERE guild_id = ? AND status = 'unpaid' AND created_at <= ?
                """,
                (guild.id, deadline.isoformat())
            ).fetchall()

            if not expired_violations:
                continue

            for v in expired_violations:
                user_id = v['user_id']
                amount = v['amount']
                v_id = v['id']

                await deduct_money(user_id, guild.id, amount)
                
                self.cursor.execute("UPDATE traffic_violations SET status = 'paid' WHERE id = ?", (v_id,))
                self.db.commit()

                member = guild.get_member(user_id)
                if not member:
                    try:
                        member = await guild.fetch_member(user_id)
                    except:
                        member = None
                
                if member:
                    try:
                        embed_dm = make_embed(
                            guild,
                            "⚠️ تم السحب التلقائي لمخالفة مرورية",
                            f"لقد تجاوزت مهلة السداد (5 أيام) للمخالفة رقم `#{v_id}`.\n\n"
                            f"📋 **السبب:** {v['reason']}\n"
                            f"💰 **المبلغ المسحوب:** {money(amount)}\n"
                            f"تم خصم المبلغ تلقائياً من حسابك البنكي بنجاح.",
                            discord.Color.dark_red()
                        )
                        await member.send(embed=embed_dm)
                    except:
                        pass

                await self.log_action(
                    guild,
                    make_embed(
                        guild,
                        "🤖 سحب تلقائي لمخالفة منتهية",
                        f"👤 **المواطن:** {member.mention if member else f'<@{user_id}>'}\n"
                        f"🆔 **رقم المخالفة:** `#{v_id}`\n"
                        f"💰 **المبلغ المسحوب تلقائياً:** {money(amount)}\n"
                        f"⏳ **السبب:** مر 5 أيام بدون سداد.",
                        discord.Color.dark_orange()
                    )
                )

    # =========================================================
    # الأوامر (Commands)
    # =========================================================
    @app_commands.command(name="اعداد-المرور", description="إعداد رتب ورومات نظام المرور")
    @app_commands.default_permissions(administrator=True)
    @app_commands.rename(police_role="رتبة_العساكر", control_channel="روم_التحكم", citizen_channel="روم_المواطنين", log_channel="روم_اللوق")
    @app_commands.describe(
        police_role="رتبة العساكر",
        control_channel="روم تحكم العساكر",
        citizen_channel="روم بانل المواطنين",
        log_channel="روم السجلات (اللوق)",
    )
    async def traffic_setup(
        self,
        interaction: discord.Interaction,
        police_role: discord.Role = None,
        control_channel: discord.TextChannel = None,
        citizen_channel: discord.TextChannel = None,
        log_channel: discord.TextChannel = None,
    ):
        try:
            old = self.get_traffic_settings(interaction.guild.id)

            p_role = police_role.id if police_role else (old["police_role"] if old and "police_role" in old.keys() and old["police_role"] else 0)
            c_chan = control_channel.id if control_channel else (old["control_channel"] if old and "control_channel" in old.keys() and old["control_channel"] else 0)
            cit_chan = citizen_channel.id if citizen_channel else (old["citizen_channel"] if old and "citizen_channel" in old.keys() and old["citizen_channel"] else 0)
            l_chan = log_channel.id if log_channel else (old["log_channel"] if old and "log_channel" in old.keys() and old["log_channel"] else 0)

            self.cursor.execute(
                """
            INSERT OR REPLACE INTO traffic_settings (guild_id, police_role, control_channel, citizen_channel, log_channel)
            VALUES (?, ?, ?, ?, ?)
            """,
                (interaction.guild.id, p_role, c_chan, cit_chan, l_chan),
            )
            self.db.commit()

            r_role = interaction.guild.get_role(p_role) if p_role else None
            r_control = interaction.guild.get_channel(c_chan) if c_chan else None
            r_citizen = interaction.guild.get_channel(cit_chan) if cit_chan else None
            r_log = interaction.guild.get_channel(l_chan) if l_chan else None

            embed = make_embed(
                interaction.guild,
                "⚙️ تم إعداد نظام المرور بنجاح",
                f"👮 رتبة المرور: {r_role.mention if r_role else 'غير محددة'}\n"
                f"🛡️ روم التحكم (عساكر): {r_control.mention if r_control else 'غير محدد'}\n"
                f"🏛️ روم المواطنين: {r_citizen.mention if r_citizen else 'غير محدد'}\n"
                f"📜 روم السجلات: {r_log.mention if r_log else 'غير محدد'}",
                discord.Color.blue(),
            )
            await interaction.response.send_message(embed=embed, ephemeral=True)
        except Exception as e:
            await interaction.response.send_message(f"❌ حدث خطأ أثناء الحفظ: `{e}`", ephemeral=True)

    @app_commands.command(name="لوحة-العساكر-المرور", description="إرسال بانل تحكم العساكر")
    @app_commands.default_permissions(administrator=True)
    async def traffic_control_panel(self, interaction: discord.Interaction):
        settings = self.get_traffic_settings(interaction.guild.id)
        if not settings or not settings["control_channel"]:
            return await interaction.response.send_message("❌ يرجى تحديد روم تحكم العساكر أولاً عبر أمر `/اعداد-المرور`", ephemeral=True)

        channel = interaction.guild.get_channel(settings["control_channel"])
        if not channel:
            return await interaction.response.send_message("❌ روم التحكم غير موجود", ephemeral=True)

        embed = make_embed(
            interaction.guild,
            "🛡️ لوحة تحكم العساكر ورجال المرور",
            "مرحباً بك في نظام إدارة المرور العسكري\n\n"
            "• **تسجيل مخالفة:** لتعبئة بيانات المركبة واختيار العضو والمخالفة (تسحب تلقائياً خلال 5 أيام إذا لم تُسدد).\n"
            "• **إزالة مخالفة:** لاختيار عضو وإزالة مخالفة خاطئة (تعرض المخالفات النشطة فقط) مع إرسال إشعار ولُوق.\n"
            "• **عرض المخالفات الغير مسدده:** لعرض قائمة الأشخاص الذين عليهم مخالفات ومعاينة تفاصيل كل شخص بدقة.",
            discord.Color.dark_red()
        )

        await channel.send(embed=embed, view=TrafficControlView(self))
        await interaction.response.send_message(f"✅ تم إرسال بانل العساكر بنجاح في روم {channel.mention}", ephemeral=True)

    @app_commands.command(name="لوحة-المواطنين-المرور", description="إرسال بانل خدمات المواطنين")
    @app_commands.default_permissions(administrator=True)
    async def traffic_citizen_panel(self, interaction: discord.Interaction):
        settings = self.get_traffic_settings(interaction.guild.id)
        if not settings or not settings["citizen_channel"]:
            return await interaction.response.send_message("❌ يرجى تحديد روم بانل المواطنين أولاً عبر أمر `/اعداد-المرور`", ephemeral=True)

        channel = interaction.guild.get_channel(settings["citizen_channel"])
        if not channel:
            return await interaction.response.send_message("❌ روم المواطنين غير موجود", ephemeral=True)

        embed = make_embed(
            interaction.guild,
            "🚦 خدمات المرور العامة للمواطنين",
            "مرحباً بك في البانل الرسمي لخدمات المرور\n\n"
            "• **مخالفاتي:** للاستعلام عن مخالفاتك غير المسددة فقط.\n"
            "• **سداد مخالفة:** لاختيار وسداد الغرامات آلياً عبر قائمة منسدلة.",
            discord.Color.blue()
        )

        await channel.send(embed=embed, view=TrafficCitizenView(self))
        await interaction.response.send_message(f"✅ تم إرسال بانل المواطنين بنجاح في روم {channel.mention}", ephemeral=True)


async def setup(bot):
    await bot.add_cog(Traffic(bot))