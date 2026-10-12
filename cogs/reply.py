import discord
from discord import app_commands
from discord.ext import commands
import json
import os

# الشكل الجديد: {guild_id: {keyword: {response, match_type, mention}}}
DATA_FILE = "auto_responses.json"

def load_responses():
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def save_responses(data):
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=4)

def is_legacy(d):
    # الشكل القديم: {keyword: {response, match_type, mention}} بدون سيرفر
    return any(isinstance(v, dict) and "response" in v and "match_type" in v for v in d.values())

class Reply(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        raw = load_responses()
        self.legacy = raw if is_legacy(raw) else {}
        self.responses = {} if self.legacy else raw
        self._mt = self._mtime()

    @staticmethod
    def _mtime():
        try:
            return os.path.getmtime(DATA_FILE)
        except OSError:
            return 0

    def _fresh(self):
        # الموقع يكتب في نفس الملف، فنعيد القراءة إذا تغيّر
        mt = self._mtime()
        if mt != self._mt and not self.legacy:
            self.responses = load_responses()
            self._mt = mt

    def _save(self):
        save_responses(self.responses)
        self._mt = self._mtime()

    def _guild(self, gid):
        return self.responses.setdefault(str(gid), {})

    @commands.Cog.listener()
    async def on_ready(self):
        # ترحيل الردود القديمة (كانت تشتغل بكل السيرفرات): ننسخها لكل سيرفر موجود فيه البوت
        if self.legacy:
            for g in self.bot.guilds:
                self.responses[str(g.id)] = dict(self.legacy)
            self.legacy = {}
            self._save()

    @app_commands.command(name="اضافة-رد", description="إضافة رد تلقائي جديد")
    @app_commands.describe(keyword="الكلمة المفتاحية", response="الرد", match_type="نوع المطابقة", mention_user="منشن العضو")
    @app_commands.rename(keyword="الكلمة", response="الرد", match_type="نوع_المطابقة", mention_user="منشن_العضو")
    @app_commands.choices(
        match_type=[
            app_commands.Choice(name="تتضمن", value="contains"),
            app_commands.Choice(name="مطابقة تماماً", value="exact")
        ],
        mention_user=[
            app_commands.Choice(name="نعم", value="true"),
            app_commands.Choice(name="لا", value="false")
        ]
    )
    @app_commands.guild_only()
    @app_commands.checks.has_permissions(administrator=True)
    async def ar_add(self, interaction: discord.Interaction, keyword: str, response: str, match_type: str, mention_user: str):
        self._fresh()
        self._guild(interaction.guild.id)[keyword.lower().strip()] = {
            "response": response, "match_type": match_type, "mention": mention_user}
        self._save()
        await interaction.response.send_message(f"✅ تم إضافة الرد للكلمة: `{keyword}` في هذا السيرفر بنجاح!", ephemeral=True)

    @app_commands.command(name="تعديل-رد", description="تعديل رد تلقائي موجود")
    @app_commands.describe(keyword="الكلمة المفتاحية الموجودة", new_response="الرد الجديد", match_type="نوع المطابقة", mention_user="منشن العضو")
    @app_commands.rename(keyword="الكلمة", new_response="الرد_الجديد", match_type="نوع_المطابقة", mention_user="منشن_العضو")
    @app_commands.choices(
        match_type=[
            app_commands.Choice(name="تتضمن", value="contains"),
            app_commands.Choice(name="مطابقة تماماً", value="exact")
        ],
        mention_user=[
            app_commands.Choice(name="نعم", value="true"),
            app_commands.Choice(name="لا", value="false")
        ]
    )
    @app_commands.guild_only()
    @app_commands.checks.has_permissions(administrator=True)
    async def ar_edit(self, interaction: discord.Interaction, keyword: str, new_response: str, match_type: str, mention_user: str):
        self._fresh()
        rs = self._guild(interaction.guild.id)
        key = keyword.lower().strip()
        if key not in rs:
            await interaction.response.send_message(f"❌ الكلمة `{keyword}` غير مسجلة في هذا السيرفر!", ephemeral=True)
            return
        rs[key] = {"response": new_response, "match_type": match_type, "mention": mention_user}
        self._save()
        await interaction.response.send_message(f"✅ تم تعديل الرد للكلمة: `{keyword}` بنجاح!", ephemeral=True)

    @app_commands.command(name="حذف-رد", description="حذف رد تلقائي")
    @app_commands.describe(keyword="الكلمة المراد حذفها")
    @app_commands.rename(keyword="الكلمة")
    @app_commands.guild_only()
    @app_commands.checks.has_permissions(administrator=True)
    async def ar_delete(self, interaction: discord.Interaction, keyword: str):
        self._fresh()
        rs = self._guild(interaction.guild.id)
        key = keyword.lower().strip()
        if key in rs:
            del rs[key]
            self._save()
            await interaction.response.send_message(f"🗑️ تم حذف الرد للكلمة: `{keyword}` بنجاح!", ephemeral=True)
        else:
            await interaction.response.send_message(f"❌ الكلمة `{keyword}` غير موجودة في هذا السيرفر!", ephemeral=True)

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message):
        if message.author.bot or not message.guild:
            return

        self._fresh()
        rs = self.responses.get(str(message.guild.id))  # ردود هذا السيرفر فقط
        if not rs:
            return

        content_lower = message.content.lower()
        for keyword, data in rs.items():
            if data.get("match_type") == "exact":
                matched = content_lower == keyword or keyword in content_lower.split()
            else:
                matched = keyword in content_lower

            if matched:
                response_text = data["response"]
                if data.get("mention") == "true":
                    response_text = f"{message.author.mention} {response_text}"
                await message.channel.send(response_text)
                break

async def setup(bot):
    await bot.add_cog(Reply(bot))
