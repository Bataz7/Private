import random
import sqlite3
import time
import traceback
from datetime import datetime, timezone

import discord
from discord import app_commands
from discord.ext import commands, tasks

# قائمة كبيرة ومتنوعة من الأذكار والأدعية
AZKAR_LIST = [
    "سُبْحَانَ اللَّهِ وَبِحَمْدِهِ، سُبْحَانَ اللَّهِ الْعَظِيمِ.",
    "لَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِاللَّهِ.",
    "أَسْتَغْفِرُ اللَّهَ الْعَظِيمَ وَأَتُوبُ إِلَيْهِ.",
    "سُبْحَانَ اللَّهِ، وَالْحَمْدُ لِلَّهِ، وَلَا إِلَهَ إِلَّا اللَّهُ، وَاللَّهُ أَكْبَرُ.",
    "لَا إِلهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ، لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ وَهُوَ عَلَى كُلِّ شَيْءٍ قَدِيرٌ.",
    "اللَّهُمَّ صَلِّ وَسَلِّمْ عَلَى نَبِيِّنَا مُحَمَّدٍ.",
    "رَبِّ اغْفِرْ لِي وَتُبْ عَلَيَّ إِنَّكَ أَنْتَ التَّوَّابُ الرَّحِيمُ.",
    "سُبْحَانَ اللَّهِ وَبِحَمْدِهِ عَدَدَ خَلْقِهِ، وَرِضَا نَفْسِهِ، وَزِنَةَ عَرْشِهِ، وَمِدَادَ كَلِمَاتِهِ.",
    "رَبَّنَا آتِنَا فِي الدُّنْيَا حَسَنَةً وَفِي الْآخِرَةِ حَسَنَةً وَقِنَا عَذَابَ النَّارِ.",
    "يَا حَيُّ يَا قَيُّومُ بِرَحْمَتِكَ أَسْتَغِيثُ، أَصْلِحْ لِي شَأْنِي كُلَّهُ وَلَا تَكِلْنِي إِلَى نَفْسِي طَرْفَةَ عَيْنٍ.",
    "حَسْبِيَ اللَّهُ لَا إِلَهَ إِلَّا هُوَ عَلَيْهِ تَوَكَّلْتُ وَهُوَ رَبُّ الْعَرْشِ الْعَظِيمِ.",
    "اللَّهُمَّ إِنِّي أَسْأَلُكَ الْعَفْوَ وَالْعَافِيَةَ فِي الدُّنْيَا وَالْآخِرَةِ.",
    "رَبِّ اشْرَحْ لِي صَدْرِي وَيَسِّرْ لِي أَمْرِي.",
    "لَا إِلَهَ إِلَّا أَنْتَ سُبْحَانَكَ إِنِّي كُنْتُ مِنَ الظَّالِمِينَ.",
    "اللَّهُمَّ أَنْتَ رَبِّي لَا إِلَهَ إِلَّا أَنْتَ، خَلَقْتَنِي وَأَنَا عَبْدُكَ، وَأَنَا عَلَى عَهْدِكَ وَوَعْدِكَ مَا اسْتَطَعْتُ.",
]


class AzkarCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.DB_FILE = "azkar_settings.db"
        self.db = sqlite3.connect(self.DB_FILE)
        self.db.row_factory = sqlite3.Row
        self.db.execute("""
        CREATE TABLE IF NOT EXISTS server_azkar (
            guild_id INTEGER PRIMARY KEY,
            channel_id INTEGER,
            interval_minutes INTEGER DEFAULT 15,
            status TEXT DEFAULT 'FALSE',
            last_sent REAL DEFAULT 0
        )
        """)
        self.db.commit()
        self._migrate_db()
        self.azkar_loop.start()

    def _migrate_db(self):
        # لو ملف القاعدة قديم وناقصه أعمدة (CREATE IF NOT EXISTS ما يضيفها) نضيفها هنا
        cols = {r["name"] for r in self.db.execute("PRAGMA table_info(server_azkar)")}
        needed = {
            "channel_id": "INTEGER DEFAULT 0",
            "interval_minutes": "INTEGER DEFAULT 15",
            "status": "TEXT DEFAULT 'FALSE'",
            "last_sent": "REAL DEFAULT 0",
        }
        for name, ddl in needed.items():
            if name not in cols:
                self.db.execute(f"ALTER TABLE server_azkar ADD COLUMN {name} {ddl}")
        self.db.commit()

    def cog_unload(self):
        self.azkar_loop.cancel()
        self.db.close()

    # ---------------- قاعدة البيانات ----------------
    def get_settings(self, guild_id: int):
        return self.db.execute(
            "SELECT * FROM server_azkar WHERE guild_id = ?", (guild_id,)
        ).fetchone()

    def update_settings(self, guild_id: int, channel_id: int, interval: int, status: str):
        # عند التفعيل نخلي last_sent = 0 عشان أول ذكر يوصل مباشرة (خلال 30 ثانية)
        last_sent = 0 if status == "TRUE" else time.time()
        self.db.execute(
            """
            INSERT OR REPLACE INTO server_azkar
            (guild_id, channel_id, interval_minutes, status, last_sent)
            VALUES (?, ?, ?, ?, ?)
            """,
            (guild_id, channel_id, interval, status, last_sent),
        )
        self.db.commit()

    # ---------------- الأمر ----------------
    @app_commands.command(name="اعداد-الاذكار", description="تحديد روم الأذكار، المدة الزمنية، وتفعيل النظام")
    @app_commands.describe(
        status="حالة الأذكار تفعيل أو تعطيل",
        channel="روم إرسال الأذكار",
        interval="المدة الزمنية بين كل ذكر والآخر",
    )
    @app_commands.rename(status="الحالة", channel="الروم", interval="المدة")
    @app_commands.choices(
        status=[
            app_commands.Choice(name="🟢 تفعيل", value="TRUE"),
            app_commands.Choice(name="🔴 تعطيل", value="FALSE"),
        ],
        interval=[
            app_commands.Choice(name="5 دقائق", value=5),
            app_commands.Choice(name="10 دقائق", value=10),
            app_commands.Choice(name="15 دقيقة", value=15),
            app_commands.Choice(name="30 دقيقة", value=30),
            app_commands.Choice(name="45 دقيقة", value=45),
        ],
    )
    @app_commands.guild_only()
    @app_commands.default_permissions(administrator=True)
    @app_commands.checks.has_permissions(administrator=True)
    async def set_azkar(
        self,
        interaction: discord.Interaction,
        status: str,
        channel: discord.TextChannel = None,
        interval: int = None,
    ):
        guild = interaction.guild
        current = self.get_settings(guild.id)

        ch_id = channel.id if channel else (current["channel_id"] if current else 0)
        inte = interval if interval else (current["interval_minutes"] if current else 15)

        if status == "TRUE":
            if not ch_id:
                await interaction.response.send_message(
                    "⚠️ يجب تحديد روم الأذكار عند تفعيل النظام!", ephemeral=True
                )
                return

            target = guild.get_channel(ch_id)
            if target is None:
                await interaction.response.send_message(
                    "⚠️ ما قدرت ألقى الروم، حدد روم ثاني.", ephemeral=True
                )
                return

            # نتأكد إن البوت يقدر يرسل في الروم (أشهر سبب إن الأذكار ما تطلع)
            perms = target.permissions_for(guild.me)
            if not (perms.view_channel and perms.send_messages and perms.embed_links):
                await interaction.response.send_message(
                    f"⚠️ البوت ما عنده صلاحية (رؤية الروم + إرسال رسائل + تضمين الروابط) في {target.mention}.",
                    ephemeral=True,
                )
                return

        self.update_settings(guild.id, ch_id, inte, status)

        embed = discord.Embed(
            title="📿 إعدادات نظام الأذكار",
            description=(
                f"**الحالة:** `{'مفعّل' if status == 'TRUE' else 'معطّل'}`\n"
                f"**الروم:** {f'<#{ch_id}>' if ch_id else 'غير محدد'}\n"
                f"**المدة:** كل `{inte}` دقائق"
            ),
            color=discord.Color.green() if status == "TRUE" else discord.Color.red(),
            timestamp=datetime.now(timezone.utc),
        )
        await interaction.response.send_message(embed=embed, ephemeral=True)

    async def cog_app_command_error(self, interaction: discord.Interaction, error: app_commands.AppCommandError):
        if isinstance(error, app_commands.MissingPermissions):
            msg = "⛔ هذا الأمر للأدمن فقط."
        else:
            print(f"[خطأ في أمر الأذكار]: {error!r}")
            msg = "⚠️ صار خطأ غير متوقع."
        if interaction.response.is_done():
            await interaction.followup.send(msg, ephemeral=True)
        else:
            await interaction.response.send_message(msg, ephemeral=True)

    # ---------------- اللوب ----------------
    @tasks.loop(seconds=30)
    async def azkar_loop(self):
        # كل شي داخل try عشان أي خطأ ما يوقف اللوب
        try:
            rows = self.db.execute("SELECT * FROM server_azkar WHERE status = 'TRUE'").fetchall()
        except Exception:
            traceback.print_exc()
            return

        now = time.time()

        for row in rows:
            guild_id = row["guild_id"]
            try:
                interval = row["interval_minutes"] or 15
                last_sent = row["last_sent"] or 0
                channel_id = row["channel_id"] or 0

                if now - last_sent < interval * 60:
                    continue
                if not channel_id:
                    continue

                channel = self.bot.get_channel(channel_id)
                if channel is None:
                    channel = await self.bot.fetch_channel(channel_id)

                embed = discord.Embed(
                    title="✨ ذكر من القلب",
                    description=f">>> **{random.choice(AZKAR_LIST)}**",
                    color=discord.Color.blurple(),
                    timestamp=datetime.now(timezone.utc),
                )
                embed.set_footer(text="صَلِّ على الحبيب ليشفع لك • البوت الإسلامي")
                await channel.send(embed=embed)
            except Exception:
                print(f"[خطأ في إرسال الذكر للسيرفر {guild_id}]")
                traceback.print_exc()
            finally:
                # نحدث الوقت حتى لو فشل الإرسال عشان ما يعيد المحاولة كل 30 ثانية
                try:
                    self.db.execute(
                        "UPDATE server_azkar SET last_sent = ? WHERE guild_id = ?", (now, guild_id)
                    )
                    self.db.commit()
                except Exception:
                    traceback.print_exc()

    @azkar_loop.before_loop
    async def before_azkar_loop(self):
        await self.bot.wait_until_ready()

    @azkar_loop.error
    async def azkar_loop_error(self, error):
        print("[خطأ في لوب الأذكار]")
        traceback.print_exception(type(error), error, error.__traceback__)


async def setup(bot):
    await bot.add_cog(AzkarCog(bot))
