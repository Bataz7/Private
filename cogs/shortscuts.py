from datetime import datetime, timezone, timedelta
import sqlite3
import json
import discord
from discord import app_commands
from discord.ext import commands

DB_FILE = "shortcuts.db"
ON, OFF = "مفعّل", "معطل"

# الأنواع التي تظهر في لوحة التحكم
ACTIONS = {
    "ban": "🔨 باند",
    "kick": "👢 طرد",
    "timeout": "⏳ تايم أوت",
    "untimeout": "⏱️ إزالة تايم أوت",
    "clear": "🗑️ مسح رسائل",
    "warn": "⚠️ تحذير",
    "unban": "🔓 فك باند",
    "toggle_role": "🏷️ إعطاء/سحب رتبة",
    "nickname": "✏️ تغيير اسم عضو",
}

class ShortcutsCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.db = sqlite3.connect(DB_FILE, timeout=10)
        self.db.row_factory = sqlite3.Row
        self.cursor = self.db.cursor()
        self.cursor.execute("""
        CREATE TABLE IF NOT EXISTS server_shortcuts (
            guild_id INTEGER,
            shortcut_name TEXT,
            target_command TEXT,
            status TEXT DEFAULT 'مفعّل',
            options TEXT DEFAULT '{}',
            PRIMARY KEY (guild_id, shortcut_name)
        )
        """)
        # ترقية قاعدة البيانات القديمة بدون حذف الاختصارات الموجودة.
        cols = {r[1] for r in self.cursor.execute("PRAGMA table_info(server_shortcuts)").fetchall()}
        if "options" not in cols:
            self.cursor.execute("ALTER TABLE server_shortcuts ADD COLUMN options TEXT DEFAULT '{}'")
        # تحويل الاختصارات القديمة الخاصة بالرتب إلى نظام التبديل الجديد.
        self.cursor.execute("UPDATE server_shortcuts SET target_command='toggle_role' WHERE target_command IN ('add_role','remove_role')")
        self.db.commit()

    def cog_unload(self):
        self.db.close()

    def _get(self, guild_id, name):
        return self.cursor.execute(
            "SELECT shortcut_name,target_command,status,options FROM server_shortcuts WHERE guild_id=? AND shortcut_name=?",
            (guild_id, name)
        ).fetchone()

    async def _target(self, message, value):
        # يدعم المنشن أو ID، وإذا لم يُحدد أحد يعتبر الشخص هو مرسل الرسالة نفسه
        if message.mentions:
            return message.mentions[0]
        raw = str(value or "").strip().strip("<@!>")
        if raw.isdigit():
            try:
                return message.guild.get_member(int(raw)) or await message.guild.fetch_member(int(raw))
            except Exception:
                return None
        return message.author

    async def _execute(self, message, action, options, args):
        guild = message.guild
        member = message.author

        # كل الاختصارات الإدارية تحتاج صلاحية مناسبة.
        required = {
            "ban": "ban_members", "kick": "kick_members", "timeout": "moderate_members",
            "untimeout": "moderate_members", "clear": "manage_messages", "warn": "moderate_members",
            "unban": "ban_members", "toggle_role": "manage_roles", "nickname": "manage_nicknames"
        }.get(action)
        if required and not getattr(member.guild_permissions, required, False):
            return "❌ ما عندك الصلاحية المطلوبة لهذا الاختصار."

        reason_required = bool(options.get("reason_required", False))
        reason = " ".join(args[1:]).strip() if len(args) > 1 else "اختصار إداري"
        if reason_required and len(args) < 2 and not message.mentions:
            return "❌ لازم تحدد السبب بعد العضو."

        if action == "clear":
            raw_amount = next((x for x in args if str(x).isdigit()), "")
            if not raw_amount:
                return "❌ اكتب عدد الرسائل بعد الاختصار، مثال: `مسح 70`"
            amount = max(1, min(int(raw_amount), 100))
            deleted = await message.channel.purge(limit=amount + 1)
            return f"🗑️ تم مسح {max(0, len(deleted)-1)} رسالة."

        if action == "unban":
            raw = str(args[0]).strip() if args else ""
            if not raw.isdigit():
                return "❌ لفك الباند اكتب آيدي العضو بعد الاختصار."
            try:
                user = await self.bot.fetch_user(int(raw))
                await guild.unban(user, reason=reason)
                return f"🔓 تم فك الباند عن **{user}**."
            except discord.NotFound:
                return "❌ العضو غير موجود في قائمة الباند."

        # تحديد المستهدف (إذا لم يتم منشن أحد، يتم اختيار الكاتب تلقائياً)
        target_arg = next((x for x in args if not str(x).isdigit()), "") if action == "timeout" else (args[0] if args else "")
        target = await self._target(message, target_arg)
        if not target:
            return "❌ لم يتم العثور على العضو."
        
        # السماح بتنفيذ الإجراء على النفس (إلا للباند والطرد والتايم أوت)
        if target.id == member.id and action in ["ban", "kick", "timeout"]:
            return "❌ ما تقدر تطرد أو تبند أو تعطي تايم أوت لنفسك."

        if isinstance(target, discord.Member):
            if target != member:
                if target == guild.owner or target.top_role >= member.top_role:
                    return "❌ ما تقدر تنفذ هذا الإجراء على عضو رتبته مساوية أو أعلى من رتبتك."
            me = guild.me
            if me and target.top_role >= me.top_role and target.id != member.id:
                return "❌ رتبة البوت أقل من رتبة العضو المستهدف."

        if action == "ban":
            await target.ban(reason=reason, delete_message_days=0)
            return f"🔨 تم تبنيد {target.mention}."
        if action == "kick":
            await target.kick(reason=reason)
            return f"👢 تم طرد {target.mention}."
        if action == "timeout":
            raw_minutes = next((x for x in args if str(x).isdigit()), "10")
            minutes = max(1, min(int(raw_minutes), 40320))
            await target.timeout(timedelta(minutes=minutes), reason=reason)
            return f"⏳ تم إعطاء {target.mention} تايم أوت لمدة **{minutes} دقيقة**."
        if action == "untimeout":
            await target.timeout(None, reason=reason)
            return f"⏱️ تم إزالة التايم أوت عن {target.mention}."
        if action == "warn":
            self.cursor.execute("""CREATE TABLE IF NOT EXISTS shortcut_warns (
                guild_id INTEGER, user_id INTEGER, count INTEGER DEFAULT 0,
                PRIMARY KEY(guild_id,user_id))""")
            self.cursor.execute("""INSERT INTO shortcut_warns(guild_id,user_id,count) VALUES(?,?,1)
                ON CONFLICT(guild_id,user_id) DO UPDATE SET count=count+1""", (guild.id, target.id))
            self.db.commit()
            count = self.cursor.execute("SELECT count FROM shortcut_warns WHERE guild_id=? AND user_id=?", (guild.id,target.id)).fetchone()[0]
            return f"⚠️ تم تحذير {target.mention}. عدد التحذيرات: **{count}**"
        
        if action == "nickname":
            if message.mentions:
                new_name = " ".join(args[1:]).strip() if len(args) > 1 else ""
            else:
                new_name = " ".join(args).strip()
            if not new_name:
                return "❌ اكتب الاسم الجديد بعد الاختصار."
            if len(new_name) > 32:
                return "❌ اسم العضو لازم يكون 32 حرف أو أقل."
            await target.edit(nick=new_name, reason="اختصار تغيير اسم عضو")
            return f"✏️ تم تغيير اسم {target.mention} إلى **{discord.utils.escape_markdown(new_name)}**."

        if action == "toggle_role":
            role = None
            # 1. البحث عن طريق منشن الرتبة المباشر
            if message.role_mentions:
                role = message.role_mentions[0]
            else:
                # 2. البحث عن طريق الـ ID لو كتبه المستخدم بالنص
                for arg in args:
                    clean_arg = arg.strip().strip("<@&>")
                    if clean_arg.isdigit():
                        role = guild.get_role(int(clean_arg))
                        if role:
                            break

            if not role:
                return "❌ اكتب منشن الرتبة أو اكتب آيدي الرتبة بشكل صحيح، مثال: `رتب @الرتبة` أو `رتب 123456789`"

            reason = "اختصار إعطاء/سحب رتبة"
            if role >= guild.me.top_role:
                return "❌ رتبة البوت أقل من الرتبة المحددة."
            if target is None:
                return "❌ حدد العضو أولاً."
            if role in target.roles:
                await target.remove_roles(role, reason=reason)
                return f"🏷️ تم سحب {role.mention} من {target.mention}."
            await target.add_roles(role, reason=reason)
            return f"🏷️ تم إعطاء {role.mention} إلى {target.mention}."
        
        return "❌ نوع الاختصار غير معروف."

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message):
        if message.author.bot or not message.guild:
            return
        words = message.content.strip().split()
        if not words:
            return
        shortcut = words[0].lstrip("!/.#").lower()
        row = self._get(message.guild.id, shortcut)
        if not row or row["status"] != ON:
            return
        try:
            options = json.loads(row["options"] or "{}")
        except Exception:
            options = {}
        result = await self._execute(message, row["target_command"].lower(), options, words[1:])
        try:
            await message.reply(result, mention_author=False, delete_after=8)
        except Exception:
            pass

    @app_commands.command(name="اضافة-اختصار", description="إضافة اختصار إداري جديد")
    @app_commands.describe(shortcut="اسم الاختصار", target="نوع الأمر")
    @app_commands.rename(shortcut="الاختصار", target="نوع_الامر")
    @app_commands.choices(target=[app_commands.Choice(name=label, value=key) for key, label in ACTIONS.items()])
    @app_commands.checks.has_permissions(manage_guild=True)
    async def shortcut_add(self, interaction: discord.Interaction, shortcut: str, target: str):
        clean_shortcut = shortcut.strip().lower().lstrip("!/.#")
        clean_target = target.strip().lower()
        if clean_target not in ACTIONS:
            return await interaction.response.send_message("❌ نوع الأمر غير مدعوم.", ephemeral=True)
        self.cursor.execute("""INSERT INTO server_shortcuts(guild_id,shortcut_name,target_command,status,options)
            VALUES(?,?,?,?,?) ON CONFLICT(guild_id,shortcut_name) DO UPDATE SET target_command=excluded.target_command,status=excluded.status""",
            (interaction.guild.id, clean_shortcut, clean_target, ON, "{}"))
        self.db.commit()
        await interaction.response.send_message(f"✅ تم حفظ `{clean_shortcut}` → {ACTIONS[clean_target]}", ephemeral=True)

    @app_commands.command(name="حذف-اختصار", description="حذف اختصار موجود")
    @app_commands.describe(shortcut="اسم الاختصار المراد حذفه")
    @app_commands.rename(shortcut="الاختصار")
    @app_commands.checks.has_permissions(manage_guild=True)
    async def shortcut_remove(self, interaction: discord.Interaction, shortcut: str):
        clean = shortcut.strip().lower().lstrip("!/.#")
        self.cursor.execute("DELETE FROM server_shortcuts WHERE guild_id=? AND shortcut_name=?", (interaction.guild.id, clean))
        self.db.commit()
        await interaction.response.send_message(f"🗑️ تم حذف `{clean}`.", ephemeral=True)

    @app_commands.command(name="الاختصارات", description="عرض اختصارات السيرفر")
    @app_commands.checks.has_permissions(manage_guild=True)
    async def shortcut_list(self, interaction: discord.Interaction):
        rows = self.cursor.execute("SELECT shortcut_name,target_command,status FROM server_shortcuts WHERE guild_id=? ORDER BY shortcut_name", (interaction.guild.id,)).fetchall()
        if not rows:
            return await interaction.response.send_message("❌ لا توجد اختصارات.", ephemeral=True)
        desc = "\n".join(f"• `{r['shortcut_name']}` → {ACTIONS.get(r['target_command'], r['target_command'])} — {r['status']}" for r in rows)
        await interaction.response.send_message(embed=discord.Embed(title="⚡ اختصارات السيرفر", description=desc, color=discord.Color.blue()), ephemeral=True)

async def setup(bot):
    await bot.add_cog(ShortcutsCog(bot))
