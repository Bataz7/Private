"""وزارة الداخلية — نقاط العساكر، الشفتات التلقائية، الإنذارات والفصل، وبطاقة النقاط.

الشفت التلقائي:
- العسكري يدخل روم شفت صوتي → يبدأ شفته تلقائياً، ويطلع من رومات الشفت → ينتهي ويأخذ نقاطه.
- كل ساعة (قابلة للتعديل) يرسل له البوت «هل انت موجود؟» بالخاص (أو في شات الروم الصوتي لو خاصه مقفل).
- لو ما ضغط الزر أو رد أو تفاعل خلال نص ساعة، يوقف الشفت بصمت (بدون أي رسالة له)، وتُحذف رسالة التحقق،
  ويُحسب له الوقت حتى لحظة إرسال التحقق فقط. ما يبدأ له شفت جديد إلا إذا طلع من الروم ورجع.
- الشفتات النشطة محفوظة في قاعدة البيانات فإعادة تشغيل البوت ما تضيّعها.
"""
import asyncio
import logging
import sqlite3
import time
from datetime import datetime, timezone

import discord
from discord import app_commands
from discord.ext import commands, tasks

from core import police_card

log = logging.getLogger("revive.police")

GOLD, BLUE, GREEN, RED, ORANGE, GRAY = 0xF6C445, 0x2F6BFF, 0x1FC46A, 0xF23D4F, 0xFF8A3D, 0x7B8BAB
COG_NAME = "PointPolice"

# الأعمدة الجديدة في police_settings (تُضاف للقواعد القديمة بدون حذف شي)
NEW_COLUMNS = {
    "log_channel_id": "INTEGER", "dismissed_role_id": "INTEGER", "dismiss_roles": "TEXT DEFAULT ''",
    "shift_enabled": "INTEGER DEFAULT 1", "shift_points": "INTEGER DEFAULT 1", "shift_block": "INTEGER DEFAULT 10",
    "shift_min": "INTEGER DEFAULT 15", "check_after": "INTEGER DEFAULT 60", "check_timeout": "INTEGER DEFAULT 30",
    "warn_limit": "INTEGER DEFAULT 3",
}
DEFAULTS = {"shift_enabled": 1, "shift_points": 1, "shift_block": 10, "shift_min": 15, "check_after": 60, "check_timeout": 30, "warn_limit": 3}

END_REASONS = {
    "left": "طلع من روم الشفت", "afk": "ما رد على التحقق (هل انت موجود؟)", "admin": "أنهاه مسؤول",
    "dismissed": "تم فصله", "restart": "طلع من الروم أثناء توقف البوت", "disabled": "تم إيقاف نظام الشفت",
    "role": "انشالت منه رتبة العسكر",
}


# =========================================================
# أدوات مساعدة
# =========================================================
def now() -> int:
    return int(time.time())


def dur(seconds: int) -> str:
    """مدة مقروءة: 2 ساعة و 5 دقيقة."""
    m = max(0, int(seconds)) // 60
    h, m = divmod(m, 60)
    if h and m:
        return f"{h} ساعة و {m} دقيقة"
    if h:
        return f"{h} ساعة"
    return f"{m} دقيقة"


def clock(seconds: int) -> str:
    """مدة مختصرة للبطاقة: 1:05"""
    m = max(0, int(seconds)) // 60
    return f"{m // 60}:{m % 60:02d}"


def mk(title: str, desc: str | None = None, color: int = BLUE, guild: discord.Guild | None = None) -> discord.Embed:
    e = discord.Embed(title=title, description=desc, color=color, timestamp=datetime.now(timezone.utc))
    if guild:
        e.set_footer(text=guild.name, icon_url=guild.icon.url if guild.icon else None)
    return e


def ts(t: int, style: str = "f") -> str:
    return f"<t:{int(t)}:{style}>"


# =========================================================
# نوافذ (Modals)
# =========================================================
class PointsModal(discord.ui.Modal):
    def __init__(self, cog: "PointPolice", action: str, member: discord.Member):
        super().__init__(title=("➕ إضافة نقاط" if action == "add" else "➖ خصم نقاط") + f" — {member.display_name}"[:40])
        self.cog, self.action, self.member = cog, action, member
        self.points = discord.ui.TextInput(label="عدد النقاط", placeholder="مثال: 10", max_length=6)
        self.reason = discord.ui.TextInput(label="السبب", style=discord.TextStyle.paragraph, placeholder="اكتب السبب…", max_length=300)
        self.add_item(self.points)
        self.add_item(self.reason)

    async def on_submit(self, interaction: discord.Interaction):
        try:
            pts = int(self.points.value.strip())
        except ValueError:
            return await interaction.response.send_message("❌ عدد النقاط لازم يكون رقم صحيح.", ephemeral=True)
        await self.cog.cmd_change_points(interaction, self.member, pts if self.action == "add" else -pts, self.reason.value)


class ReasonModal(discord.ui.Modal):
    def __init__(self, cog: "PointPolice", action: str, member: discord.Member):
        titles = {"warn": "⚠️ إنذار", "dismiss": "⛔ فصل", "reinstate": "↩️ إلغاء فصل"}
        super().__init__(title=f"{titles[action]} — {member.display_name}"[:45])
        self.cog, self.action, self.member = cog, action, member
        self.reason = discord.ui.TextInput(label="السبب", style=discord.TextStyle.paragraph, placeholder="اكتب السبب…", max_length=300)
        self.add_item(self.reason)

    async def on_submit(self, interaction: discord.Interaction):
        if self.action == "warn":
            await self.cog.cmd_warn(interaction, self.member, self.reason.value)
        elif self.action == "dismiss":
            await self.cog.cmd_dismiss(interaction, self.member, self.reason.value, reset_points=False, confirm=False)
        else:
            await self.cog.cmd_reinstate(interaction, self.member, self.reason.value)


# =========================================================
# أزرار وقوائم
# =========================================================
class ConfirmView(discord.ui.View):
    def __init__(self, author_id: int, on_confirm, label: str = "تأكيد"):
        super().__init__(timeout=60)
        self.author_id, self.on_confirm = author_id, on_confirm
        self.children[0].label = label

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        if interaction.user.id != self.author_id:
            await interaction.response.send_message("❌ هذا التأكيد مو لك.", ephemeral=True)
            return False
        return True

    @discord.ui.button(label="تأكيد", style=discord.ButtonStyle.danger, emoji="✔️")
    async def yes(self, interaction: discord.Interaction, _):
        self.stop()
        await self.on_confirm(interaction)

    @discord.ui.button(label="إلغاء", style=discord.ButtonStyle.secondary, emoji="✖️")
    async def no(self, interaction: discord.Interaction, _):
        self.stop()
        await interaction.response.edit_message(content="تم الإلغاء.", embed=None, view=None)


class PickMemberSelect(discord.ui.UserSelect):
    def __init__(self, cog: "PointPolice", action: str):
        super().__init__(placeholder="🔍 اختر العسكري…", min_values=1, max_values=1)
        self.cog, self.action = cog, action

    async def callback(self, interaction: discord.Interaction):
        member = self.values[0]
        if not isinstance(member, discord.Member):
            member = interaction.guild.get_member(member.id)
        if member is None or member.bot:
            return await interaction.response.send_message("❌ العضو مو موجود في السيرفر.", ephemeral=True)
        a = self.action
        if a in ("add", "remove"):
            await interaction.response.send_modal(PointsModal(self.cog, a, member))
        elif a in ("warn", "dismiss", "reinstate"):
            await interaction.response.send_modal(ReasonModal(self.cog, a, member))
        elif a == "end_shift":
            await self.cog.cmd_end_shift(interaction, member)
        elif a == "card":
            await self.cog.cmd_card(interaction, member)
        elif a == "record":
            await self.cog.cmd_record(interaction, member)


class PickMemberView(discord.ui.View):
    def __init__(self, cog, action):
        super().__init__(timeout=120)
        self.add_item(PickMemberSelect(cog, action))


class AdminControlSelect(discord.ui.Select):
    """بانل الإدارة — نفس custom_id القديم فالبانلات المرسلة سابقاً تشتغل."""

    def __init__(self, cog: "PointPolice"):
        self.cog = cog
        options = [
            discord.SelectOption(label="إضافة نقاط", description="إضافة نقاط لعسكري مع السبب", emoji="➕", value="add_pts"),
            discord.SelectOption(label="خصم نقاط", description="خصم نقاط من عسكري مع السبب", emoji="➖", value="remove_pts"),
            discord.SelectOption(label="إنذار", description="إعطاء عسكري إنذار (يُفصل تلقائياً عند الحد)", emoji="⚠️", value="warn"),
            discord.SelectOption(label="فصل عسكري", description="سحب رتب العسكر وتسجيل الفصل", emoji="⛔", value="dismiss"),
            discord.SelectOption(label="إلغاء فصل", description="إرجاع عسكري مفصول", emoji="↩️", value="reinstate"),
            discord.SelectOption(label="إنهاء شفت", description="إنهاء شفت عسكري يدوياً", emoji="⏹️", value="end_shift"),
            discord.SelectOption(label="سجل عسكري", description="النقاط والشفتات والإنذارات والفصل", emoji="📜", value="record"),
            discord.SelectOption(label="الشفتات الحالية", description="من في الشفت الآن", emoji="🟢", value="active"),
            discord.SelectOption(label="تصفير النقاط", description="تصفير نقاط السيرفر كاملة (للأدمن)", emoji="🔄", value="reset_pts"),
        ]
        super().__init__(placeholder="⚙️ اختر العملية…", min_values=1, max_values=1, options=options, custom_id="police:admin_control_select")

    async def callback(self, interaction: discord.Interaction):
        if not self.cog.is_manager(interaction.user):
            return await interaction.response.send_message("❌ هذي اللوحة لمسؤولي النقاط فقط.", ephemeral=True)
        choice = self.values[0]
        pick = {"add_pts": "add", "remove_pts": "remove", "warn": "warn", "dismiss": "dismiss", "reinstate": "reinstate",
                "end_shift": "end_shift", "record": "record"}
        if choice in pick:
            await interaction.response.send_message("🔽 اختر العسكري:", view=PickMemberView(self.cog, pick[choice]), ephemeral=True)
        elif choice == "active":
            await self.cog.cmd_active(interaction)
        elif choice == "reset_pts":
            await self.cog.cmd_reset(interaction)
        try:  # يرجع القائمة لوضعها الافتراضي عشان تقدر تختار نفس الخيار مرة ثانية
            await interaction.message.edit(view=self.view)
        except discord.HTTPException:
            pass


class PoliceAdminPanelView(discord.ui.View):
    def __init__(self, cog):
        super().__init__(timeout=None)
        self.add_item(AdminControlSelect(cog))


class PublicServicesSelect(discord.ui.Select):
    def __init__(self, cog: "PointPolice"):
        self.cog = cog
        options = [
            discord.SelectOption(label="بطاقتي", description="بطاقة نقاطك وساعات شفتك", emoji="🪪", value="my_card"),
            discord.SelectOption(label="بطاقة عسكري", description="اعرض بطاقة أي عسكري", emoji="🔍", value="member_card"),
            discord.SelectOption(label="توب 10", description="أعلى العساكر نقاطاً", emoji="🏆", value="top_10"),
            discord.SelectOption(label="حالة شفتي", description="هل أنت في شفت الآن وكم صار لك", emoji="⏱️", value="my_shift"),
            discord.SelectOption(label="سجلي", description="آخر عمليات النقاط والشفتات والإنذارات", emoji="📜", value="my_record"),
        ]
        super().__init__(placeholder="📂 اختر الخدمة…", min_values=1, max_values=1, options=options, custom_id="police:public_services_select")

    async def callback(self, interaction: discord.Interaction):
        c = self.values[0]
        if c in ("my_card", "my_points"):
            await self.cog.cmd_card(interaction, interaction.user)
        elif c in ("member_card", "check_military"):
            await interaction.response.send_message("🔽 اختر العسكري:", view=PickMemberView(self.cog, "card"), ephemeral=True)
        elif c == "top_10":
            await self.cog.cmd_top(interaction)
        elif c == "my_shift":
            await self.cog.cmd_my_shift(interaction)
        elif c == "my_record":
            await self.cog.cmd_record(interaction, interaction.user)
        try:
            await interaction.message.edit(view=self.view)
        except discord.HTTPException:
            pass


class PolicePublicPanelView(discord.ui.View):
    def __init__(self, cog):
        super().__init__(timeout=None)
        self.add_item(PublicServicesSelect(cog))


class HereButton(discord.ui.DynamicItem[discord.ui.Button], template=r"police:here:(?P<gid>\d+):(?P<uid>\d+)"):
    """زر «نعم، موجود» — يشتغل حتى بعد إعادة تشغيل البوت."""

    def __init__(self, gid: int, uid: int):
        super().__init__(discord.ui.Button(label="نعم، موجود", emoji="✅", style=discord.ButtonStyle.success, custom_id=f"police:here:{gid}:{uid}"))
        self.gid, self.uid = gid, uid

    @classmethod
    async def from_custom_id(cls, interaction, item, match):
        return cls(int(match["gid"]), int(match["uid"]))

    async def callback(self, interaction: discord.Interaction):
        cog = interaction.client.get_cog(COG_NAME)
        if cog:
            await cog.on_here_click(interaction, self.gid, self.uid)
        else:
            await interaction.response.defer()


# =========================================================
# الكوج
# =========================================================
class PointPolice(commands.Cog):
    police = app_commands.Group(name="الداخلية", description="إعدادات نظام وزارة الداخلية (النقاط والشفتات والفصل)",
                                guild_only=True, default_permissions=discord.Permissions(administrator=True))

    def __init__(self, bot: commands.Bot):
        self.bot = bot
        self.db = sqlite3.connect("police_points.db")
        self.db.row_factory = sqlite3.Row
        self.cursor = self.db.cursor()
        self._schema()
        self._settings: dict[int, dict] = {}
        self._channels: dict[int, set[int]] = {}
        self.active: dict[tuple[int, int], dict] = {}
        self.blocked: set[tuple[int, int]] = set()
        for r in self.db.execute("SELECT * FROM active_shifts"):
            self.active[(r["guild_id"], r["user_id"])] = dict(r)
        for r in self.db.execute("SELECT guild_id, user_id FROM shift_blocks"):
            self.blocked.add((r["guild_id"], r["user_id"]))
        self._reconciled = False
        self._render_lock = asyncio.Semaphore(2)
        self.bot.add_view(PoliceAdminPanelView(self))
        self.bot.add_view(PolicePublicPanelView(self))

    # ---------------------------------------------------------------- قاعدة البيانات
    def _schema(self):
        c = self.db
        c.executescript("""
        CREATE TABLE IF NOT EXISTS police_settings (
            guild_id INTEGER PRIMARY KEY, manager_role_id INTEGER, military_role_id INTEGER, panel_channel_id INTEGER);
        CREATE TABLE IF NOT EXISTS user_points (guild_id INTEGER, user_id INTEGER, points INTEGER, PRIMARY KEY (guild_id, user_id));
        CREATE TABLE IF NOT EXISTS shift_channels (guild_id INTEGER, channel_id INTEGER, PRIMARY KEY (guild_id, channel_id));
        CREATE TABLE IF NOT EXISTS active_shifts (
            guild_id INTEGER, user_id INTEGER, channel_id INTEGER, start_ts INTEGER, last_confirm_ts INTEGER, last_seen_ts INTEGER,
            check_sent_ts INTEGER, check_channel_id INTEGER, check_message_id INTEGER, PRIMARY KEY (guild_id, user_id));
        CREATE TABLE IF NOT EXISTS shift_blocks (guild_id INTEGER, user_id INTEGER, PRIMARY KEY (guild_id, user_id));
        CREATE TABLE IF NOT EXISTS shifts (
            id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id INTEGER, user_id INTEGER, start_ts INTEGER, end_ts INTEGER,
            seconds INTEGER, points INTEGER, end_reason TEXT);
        CREATE INDEX IF NOT EXISTS shifts_user ON shifts (guild_id, user_id, end_ts);
        CREATE TABLE IF NOT EXISTS points_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id INTEGER, user_id INTEGER, delta INTEGER, balance INTEGER,
            reason TEXT, by_id INTEGER, kind TEXT, ts INTEGER);
        CREATE INDEX IF NOT EXISTS points_log_user ON points_log (guild_id, user_id, ts);
        CREATE TABLE IF NOT EXISTS warnings (
            id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id INTEGER, user_id INTEGER, reason TEXT, by_id INTEGER, ts INTEGER,
            active INTEGER DEFAULT 1);
        CREATE TABLE IF NOT EXISTS dismissals (
            id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id INTEGER, user_id INTEGER, kind TEXT, reason TEXT, by_id INTEGER, ts INTEGER);
        """)
        have = {r[1] for r in c.execute("PRAGMA table_info(police_settings)")}
        for col, typ in NEW_COLUMNS.items():
            if col not in have:
                c.execute(f"ALTER TABLE police_settings ADD COLUMN {col} {typ}")
        c.commit()

    def settings(self, gid: int) -> dict:
        s = self._settings.get(gid)
        if s is None:
            row = self.db.execute("SELECT * FROM police_settings WHERE guild_id = ?", (gid,)).fetchone()
            s = dict(row) if row else {"guild_id": gid}
            for k, v in DEFAULTS.items():
                if s.get(k) is None:
                    s[k] = v
            self._settings[gid] = s
        return s

    # توافق مع الكود القديم
    def get_settings(self, gid):
        return self.settings(gid)

    def set_settings(self, gid: int, **values):
        cols = ", ".join(values)
        marks = ", ".join("?" for _ in values)
        upd = ", ".join(f"{k}=excluded.{k}" for k in values)
        self.db.execute(f"INSERT INTO police_settings (guild_id, {cols}) VALUES (?, {marks}) ON CONFLICT(guild_id) DO UPDATE SET {upd}",
                        (gid, *values.values()))
        self.db.commit()
        self._settings.pop(gid, None)

    def shift_channels(self, gid: int) -> set[int]:
        ch = self._channels.get(gid)
        if ch is None:
            ch = {r[0] for r in self.db.execute("SELECT channel_id FROM shift_channels WHERE guild_id = ?", (gid,))}
            self._channels[gid] = ch
        return ch

    def get_user_points(self, gid, uid) -> int:
        row = self.db.execute("SELECT points FROM user_points WHERE guild_id = ? AND user_id = ?", (gid, uid)).fetchone()
        return row["points"] if row else 0

    def add_points(self, gid: int, uid: int, delta: int, reason: str, by_id: int | None, kind: str) -> int:
        new = max(0, self.get_user_points(gid, uid) + delta)
        self.db.execute("INSERT INTO user_points (guild_id, user_id, points) VALUES (?, ?, ?) "
                        "ON CONFLICT(guild_id, user_id) DO UPDATE SET points = excluded.points", (gid, uid, new))
        self.db.execute("INSERT INTO points_log (guild_id, user_id, delta, balance, reason, by_id, kind, ts) VALUES (?,?,?,?,?,?,?,?)",
                        (gid, uid, delta, new, reason[:300], by_id, kind, now()))
        self.db.commit()
        return new

    def rank_of(self, gid: int, uid: int) -> int | None:
        pts = self.get_user_points(gid, uid)
        if not pts:
            return None
        return self.db.execute("SELECT COUNT(*) FROM user_points WHERE guild_id = ? AND points > ?", (gid, pts)).fetchone()[0] + 1

    def shift_totals(self, gid: int, uid: int, since: int = 0) -> tuple[int, int]:
        """(عدد الشفتات، مجموع الثواني) — يشمل الشفت الحالي."""
        row = self.db.execute("SELECT COUNT(*), COALESCE(SUM(seconds), 0) FROM shifts WHERE guild_id = ? AND user_id = ? AND end_ts >= ? AND seconds >= 60",
                              (gid, uid, since)).fetchone()
        count, secs = row[0], row[1]
        s = self.active.get((gid, uid))
        if s:
            count += 1
            secs += max(0, now() - max(s["start_ts"], since))
        return count, secs

    def active_warnings(self, gid: int, uid: int) -> list:
        return self.db.execute("SELECT * FROM warnings WHERE guild_id = ? AND user_id = ? AND active = 1 ORDER BY ts", (gid, uid)).fetchall()

    def is_dismissed(self, gid: int, uid: int) -> bool:
        row = self.db.execute("SELECT kind FROM dismissals WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1", (gid, uid)).fetchone()
        return bool(row and row["kind"] == "dismiss")

    def _save_shift(self, s: dict):
        self.db.execute("INSERT OR REPLACE INTO active_shifts (guild_id, user_id, channel_id, start_ts, last_confirm_ts, last_seen_ts, "
                        "check_sent_ts, check_channel_id, check_message_id) VALUES (?,?,?,?,?,?,?,?,?)",
                        (s["guild_id"], s["user_id"], s["channel_id"], s["start_ts"], s["last_confirm_ts"], s["last_seen_ts"],
                         s.get("check_sent_ts"), s.get("check_channel_id"), s.get("check_message_id")))
        self.db.commit()

    def _block(self, gid: int, uid: int, on: bool):
        key = (gid, uid)
        if on and key not in self.blocked:
            self.blocked.add(key)
            self.db.execute("INSERT OR IGNORE INTO shift_blocks VALUES (?, ?)", key)
            self.db.commit()
        elif not on and key in self.blocked:
            self.blocked.discard(key)
            self.db.execute("DELETE FROM shift_blocks WHERE guild_id = ? AND user_id = ?", key)
            self.db.commit()

    # ---------------------------------------------------------------- صلاحيات
    def is_manager(self, member) -> bool:
        if not isinstance(member, discord.Member):
            return False
        if member.guild_permissions.administrator:
            return True
        rid = self.settings(member.guild.id).get("manager_role_id")
        return bool(rid and member.get_role(rid))

    def is_military(self, member: discord.Member) -> bool:
        rid = self.settings(member.guild.id).get("military_role_id")
        return bool(rid and member.get_role(rid))

    async def send_log(self, guild: discord.Guild, embed: discord.Embed):
        cid = self.settings(guild.id).get("log_channel_id")
        ch = guild.get_channel(cid) if cid else None
        if ch:
            try:
                await ch.send(embed=embed, allowed_mentions=discord.AllowedMentions.none())
            except discord.HTTPException:
                pass

    # ---------------------------------------------------------------- دورة الحياة
    async def cog_load(self):
        self.bot.add_dynamic_items(HereButton)
        self.ticker.start()

    async def cog_unload(self):
        self.ticker.cancel()
        self.bot.remove_dynamic_items(HereButton)
        for s in self.active.values():
            s["last_seen_ts"] = now()
            self._save_shift(s)
        self.db.close()

    # ---------------------------------------------------------------- الشفت
    def in_shift_channel(self, member: discord.Member) -> bool:
        ch = member.voice.channel if member.voice else None
        return bool(ch and ch.id in self.shift_channels(member.guild.id))

    def can_shift(self, member: discord.Member) -> bool:
        s = self.settings(member.guild.id)
        if member.bot or not s.get("shift_enabled") or not s.get("military_role_id"):
            return False
        return self.is_military(member) and (member.guild.id, member.id) not in self.blocked

    async def start_shift(self, member: discord.Member, channel: discord.abc.GuildChannel, quiet: bool = False):
        key = (member.guild.id, member.id)
        if key in self.active:
            return
        t = now()
        s = {"guild_id": key[0], "user_id": key[1], "channel_id": channel.id, "start_ts": t, "last_confirm_ts": t, "last_seen_ts": t,
             "check_sent_ts": None, "check_channel_id": None, "check_message_id": None}
        self.active[key] = s
        self._save_shift(s)
        if not quiet:
            e = mk("🟢 بداية شفت", f"{member.mention} بدأ شفته في {channel.mention}", GREEN, member.guild)
            e.set_author(name=member.display_name, icon_url=member.display_avatar.url)
            await self.send_log(member.guild, e)

    def points_for(self, gid: int, seconds: int) -> int:
        st = self.settings(gid)
        minutes = seconds // 60
        if minutes < max(0, st["shift_min"]) or st["shift_block"] <= 0:
            return 0
        return (minutes // st["shift_block"]) * max(0, st["shift_points"])

    async def end_shift(self, gid: int, uid: int, reason: str, end_ts: int | None = None, by: discord.abc.User | None = None) -> tuple[int, int] | None:
        s = self.active.pop((gid, uid), None)
        if s is None:
            return None
        end = end_ts or now()
        if reason == "afk" and s.get("check_sent_ts"):
            end = s["check_sent_ts"]  # الوقت بعد التحقق ما يُحسب
        seconds = max(0, end - s["start_ts"])
        pts = self.points_for(gid, seconds)
        self.db.execute("DELETE FROM active_shifts WHERE guild_id = ? AND user_id = ?", (gid, uid))
        self.db.execute("INSERT INTO shifts (guild_id, user_id, start_ts, end_ts, seconds, points, end_reason) VALUES (?,?,?,?,?,?,?)",
                        (gid, uid, s["start_ts"], end, seconds, pts, reason))
        self.db.commit()
        if pts:
            self.add_points(gid, uid, pts, f"شفت {dur(seconds)}", by.id if by else None, "shift")
        await self._delete_check(s)

        guild = self.bot.get_guild(gid)
        if guild:
            member = guild.get_member(uid)
            color = ORANGE if reason == "afk" else (GRAY if seconds < 60 else BLUE)
            e = mk("⏹️ نهاية شفت" if reason != "afk" else "💤 إيقاف شفت تلقائي", None, color, guild)
            e.description = f"{member.mention if member else f'<@{uid}>'}"
            e.add_field(name="المدة", value=dur(seconds), inline=True)
            e.add_field(name="النقاط المكتسبة", value=f"+{pts}", inline=True)
            e.add_field(name="السبب", value=END_REASONS.get(reason, reason), inline=True)
            e.add_field(name="من", value=ts(s["start_ts"], "t"), inline=True)
            e.add_field(name="إلى", value=ts(end, "t"), inline=True)
            if by:
                e.add_field(name="بواسطة", value=by.mention, inline=True)
            if member:
                e.set_author(name=member.display_name, icon_url=member.display_avatar.url)
            await self.send_log(guild, e)
        return seconds, pts

    async def _delete_check(self, s: dict):
        if s.get("check_message_id") and s.get("check_channel_id"):
            try:
                await self.bot.http.delete_message(s["check_channel_id"], s["check_message_id"])
            except discord.HTTPException:
                pass

    async def send_check(self, s: dict):
        guild = self.bot.get_guild(s["guild_id"])
        member = guild and guild.get_member(s["user_id"])
        s["check_sent_ts"] = now()
        s["check_channel_id"] = s["check_message_id"] = None
        if member:
            st = self.settings(guild.id)
            ch = guild.get_channel(s["channel_id"])
            e = mk("👮 هل انت موجود؟",
                   f"صار لك أكثر من **{dur(now() - s['last_confirm_ts'])}** في شفتك"
                   + (f" بروم **{ch.name}**" if ch else "") + f" في **{guild.name}**.\n\n"
                   f"اضغط **«نعم، موجود»** أو رد على هذه الرسالة خلال **{st['check_timeout']} دقيقة** عشان يستمر شفتك.",
                   GOLD)
            if guild.icon:
                e.set_thumbnail(url=guild.icon.url)
            view = discord.ui.View(timeout=None)
            view.add_item(HereButton(guild.id, member.id))
            msg = None
            try:
                msg = await member.send(embed=e, view=view)
            except discord.HTTPException:
                vc = member.voice.channel if member.voice else None
                if vc is not None:  # خاصه مقفل → في شات الروم الصوتي
                    try:
                        msg = await vc.send(content=member.mention, embed=e, view=view,
                                            allowed_mentions=discord.AllowedMentions(users=[member]))
                    except discord.HTTPException:
                        msg = None
            if msg:
                s["check_channel_id"], s["check_message_id"] = msg.channel.id, msg.id
        self._save_shift(s)

    async def confirm(self, s: dict, interaction: discord.Interaction | None = None):
        s["last_confirm_ts"] = now()
        s["check_sent_ts"] = None
        e = mk("✅ تم التأكيد", "تمام، شفتك مستمر 👮", GREEN)
        if interaction is not None:
            await interaction.response.edit_message(embed=e, view=None)
        elif s.get("check_message_id"):
            try:
                await self.bot.http.edit_message(s["check_channel_id"], s["check_message_id"], params=discord.http.handle_message_parameters(embed=e, view=None))
            except (discord.HTTPException, TypeError):
                pass
        s["check_channel_id"] = s["check_message_id"] = None
        self._save_shift(s)

    async def on_here_click(self, interaction: discord.Interaction, gid: int, uid: int):
        if interaction.user.id != uid:
            return await interaction.response.send_message("❌ هذا التحقق مو لك.", ephemeral=True)
        s = self.active.get((gid, uid))
        if s and s.get("check_sent_ts"):
            return await self.confirm(s, interaction)
        await interaction.response.defer()  # شفت منتهي: بدون أي رد

    def _pending_for(self, uid: int):
        return [s for (g, u), s in self.active.items() if u == uid and s.get("check_sent_ts")]

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message):
        if message.author.bot:
            return
        pending = self._pending_for(message.author.id)
        if not pending:
            return
        hit = False
        for s in pending:
            if message.guild is None or s.get("check_channel_id") == message.channel.id:
                await self.confirm(s)
                hit = True
        if hit:
            try:
                await message.add_reaction("✅")
            except discord.HTTPException:
                pass

    @commands.Cog.listener()
    async def on_raw_reaction_add(self, payload: discord.RawReactionActionEvent):
        for s in self._pending_for(payload.user_id):
            if s.get("check_message_id") == payload.message_id:
                await self.confirm(s)

    @commands.Cog.listener()
    async def on_voice_state_update(self, member: discord.Member, before: discord.VoiceState, after: discord.VoiceState):
        if member.bot or before.channel == after.channel:
            return
        gid = member.guild.id
        chans = self.shift_channels(gid)
        key = (gid, member.id)
        self._block(gid, member.id, False)  # أي تنقل/طلعة = حركة حقيقية → ينفك الإيقاف
        now_in = after.channel is not None and after.channel.id in chans
        if key in self.active:
            if now_in:
                self.active[key]["channel_id"] = after.channel.id
                self._save_shift(self.active[key])
            else:
                await self.end_shift(gid, member.id, "left")
        elif now_in and self.can_shift(member):
            await self.start_shift(member, after.channel)

    @commands.Cog.listener()
    async def on_member_update(self, before: discord.Member, after: discord.Member):
        if (after.guild.id, after.id) in self.active and before.roles != after.roles and not self.is_military(after):
            await self.end_shift(after.guild.id, after.id, "role")

    @tasks.loop(seconds=60)
    async def ticker(self):
        if not self._reconciled:
            await self.reconcile()
        t = now()
        for (gid, uid), s in list(self.active.items()):
            guild = self.bot.get_guild(gid)
            member = guild.get_member(uid) if guild else None
            if guild is None:
                continue
            if member is None or not self.in_shift_channel(member):
                await self.end_shift(gid, uid, "left", end_ts=s["last_seen_ts"] if member is None else None)
                continue
            st = self.settings(gid)
            if not st.get("shift_enabled"):
                await self.end_shift(gid, uid, "disabled")
                continue
            s["last_seen_ts"] = t
            if s.get("check_sent_ts"):
                if t - s["check_sent_ts"] >= st["check_timeout"] * 60:
                    await self.end_shift(gid, uid, "afk")  # بصمت: ما نرسل له شي
                    self._block(gid, uid, True)
                    continue
            elif st["check_after"] > 0 and t - s["last_confirm_ts"] >= st["check_after"] * 60:
                await self.send_check(s)
        if self.active:
            self.db.executemany("UPDATE active_shifts SET last_seen_ts = ? WHERE guild_id = ? AND user_id = ?",
                                [(s["last_seen_ts"], g, u) for (g, u), s in self.active.items()])
            self.db.commit()

    @ticker.before_loop
    async def _before(self):
        await self.bot.wait_until_ready()

    @ticker.error
    async def _ticker_error(self, error):
        log.exception("police ticker", exc_info=error)
        await asyncio.sleep(5)
        self.ticker.restart()

    async def reconcile(self):
        """بعد التشغيل: يقفل الشفتات اللي طلع أصحابها، ويبدأ شفت لمن هو موجود في روم الشفت."""
        self._reconciled = True
        for (gid, uid), s in list(self.active.items()):
            guild = self.bot.get_guild(gid)
            if guild is None:
                continue
            member = guild.get_member(uid)
            if member is None or not self.in_shift_channel(member):
                await self.end_shift(gid, uid, "restart", end_ts=s["last_seen_ts"])
        for gid, uid in list(self.blocked):
            guild = self.bot.get_guild(gid)
            member = guild and guild.get_member(uid)
            if member is None or not self.in_shift_channel(member):
                self._block(gid, uid, False)
        for guild in self.bot.guilds:
            for cid in self.shift_channels(guild.id):
                ch = guild.get_channel(cid)
                for m in getattr(ch, "members", []) or []:
                    if (guild.id, m.id) not in self.active and self.can_shift(m):
                        await self.start_shift(m, ch, quiet=True)

    # ---------------------------------------------------------------- عرض
    async def card_file(self, member: discord.Member) -> discord.File:
        gid, uid = member.guild.id, member.id
        pts = self.get_user_points(gid, uid)
        rank = self.rank_of(gid, uid)
        count, secs = self.shift_totals(gid, uid)
        _, week = self.shift_totals(gid, uid, since=now() - 7 * 86400)
        warns = len(self.active_warnings(gid, uid))
        limit = self.settings(gid)["warn_limit"]
        s = self.active.get((gid, uid))
        if self.is_dismissed(gid, uid) and not self.is_military(member):
            status, status_text = "dismissed", "مفصول"
        elif s:
            status, status_text = "on", f"في الشفت الآن · {clock(now() - s['start_ts'])}"
        else:
            status, status_text = "off", "خارج الشفت"
        top_role = member.top_role.name if member.top_role and not member.top_role.is_default() else "عسكري"
        try:
            avatar = await member.display_avatar.replace(size=256, static_format="png").read()
        except discord.HTTPException:
            avatar = None
        async with self._render_lock:
            png = await asyncio.to_thread(
                police_card.render, avatar=avatar, name=member.display_name, subtitle=f"{top_role} · {member.guild.name}",
                points=pts, rank=f"#{rank}" if rank else "—", hours=f"{secs / 3600:.1f}", shifts=str(count),
                warnings=f"{warns}/{limit}" if limit else str(warns), status=status, status_text=status_text,
                week=f"آخر 7 أيام: {clock(week)} ساعة")
        import io
        return discord.File(io.BytesIO(png), filename="police-card.png")

    async def cmd_card(self, interaction: discord.Interaction, member):
        if not isinstance(member, discord.Member):
            member = interaction.guild.get_member(member.id)
        if member is None:
            return await interaction.response.send_message("❌ العضو مو موجود في السيرفر.", ephemeral=True)
        await interaction.response.defer(ephemeral=True, thinking=True)
        try:
            f = await self.card_file(member)
            await interaction.followup.send(file=f, ephemeral=True)
        except Exception:
            log.exception("police card")
            pts = self.get_user_points(member.guild.id, member.id)
            await interaction.followup.send(f"🎖️ {member.mention} نقاطه: **{pts}** نقطة.", ephemeral=True)

    async def cmd_top(self, interaction: discord.Interaction):
        gid = interaction.guild.id
        rows = self.db.execute("SELECT user_id, points FROM user_points WHERE guild_id = ? AND points > 0 ORDER BY points DESC LIMIT 10", (gid,)).fetchall()
        medals = ["🥇", "🥈", "🥉"]
        lines = []
        for i, r in enumerate(rows):
            _, secs = self.shift_totals(gid, r["user_id"])
            on = " 🟢" if (gid, r["user_id"]) in self.active else ""
            lines.append(f"{medals[i] if i < 3 else f'`#{i + 1}`'} <@{r['user_id']}> — **{r['points']:,}** نقطة · {secs / 3600:.1f} ساعة{on}")
        e = mk("🏆 أعلى 10 عساكر نقاطاً", "\n".join(lines) or "ما فيه نقاط مسجلة للحين.", GOLD, interaction.guild)
        if interaction.guild.icon:
            e.set_thumbnail(url=interaction.guild.icon.url)
        mine = self.rank_of(gid, interaction.user.id)
        if mine and mine > 10:
            e.add_field(name="ترتيبك", value=f"#{mine} — {self.get_user_points(gid, interaction.user.id):,} نقطة")
        await interaction.response.send_message(embed=e, ephemeral=True)

    async def cmd_my_shift(self, interaction: discord.Interaction):
        gid, uid = interaction.guild.id, interaction.user.id
        st = self.settings(gid)
        s = self.active.get((gid, uid))
        if s:
            el = now() - s["start_ts"]
            e = mk("🟢 أنت في الشفت", None, GREEN)
            e.add_field(name="الروم", value=f"<#{s['channel_id']}>")
            e.add_field(name="بدأ", value=ts(s["start_ts"], "R"))
            e.add_field(name="المدة", value=dur(el))
            e.add_field(name="النقاط المتوقعة لو أنهيته الآن", value=f"+{self.points_for(gid, el)}")
        else:
            chans = " ".join(f"<#{c}>" for c in self.shift_channels(gid)) or "ما تحددت رومات شفت للحين"
            e = mk("⚪ أنت خارج الشفت", f"ادخل أحد رومات الشفت ويبدأ شفتك تلقائياً:\n{chans}", GRAY)
        _, today = self.shift_totals(gid, uid, since=now() - 86400)
        _, week = self.shift_totals(gid, uid, since=now() - 7 * 86400)
        e.add_field(name="آخر 24 ساعة", value=dur(today))
        e.add_field(name="آخر 7 أيام", value=dur(week))
        e.set_footer(text=f"كل {st['shift_block']} دقيقة = {st['shift_points']} نقطة · أقل مدة تنحسب {st['shift_min']} دقيقة")
        await interaction.response.send_message(embed=e, ephemeral=True)

    async def cmd_record(self, interaction: discord.Interaction, member):
        gid = interaction.guild.id
        if member.id != interaction.user.id and not self.is_manager(interaction.user):
            return await interaction.response.send_message("❌ تقدر تشوف سجلك أنت بس.", ephemeral=True)
        uid = member.id
        count, secs = self.shift_totals(gid, uid)
        e = mk(f"📜 سجل {getattr(member, 'display_name', member.name)}", None, BLUE, interaction.guild)
        e.set_thumbnail(url=member.display_avatar.url)
        rank = self.rank_of(gid, uid)
        e.add_field(name="النقاط", value=f"**{self.get_user_points(gid, uid):,}**" + (f" (#{rank})" if rank else ""))
        e.add_field(name="الشفتات", value=f"{count} شفت · {secs / 3600:.1f} ساعة")
        warns = self.active_warnings(gid, uid)
        e.add_field(name="الإنذارات", value=f"{len(warns)}/{self.settings(gid)['warn_limit'] or '∞'}")
        logs = self.db.execute("SELECT * FROM points_log WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT 6", (gid, uid)).fetchall()
        if logs:
            e.add_field(name="آخر عمليات النقاط", inline=False, value="\n".join(
                f"`{'+' if r['delta'] >= 0 else ''}{r['delta']}` {r['reason'][:60]} · {ts(r['ts'], 'R')}" for r in logs))
        shifts = self.db.execute("SELECT * FROM shifts WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT 5", (gid, uid)).fetchall()
        if shifts:
            e.add_field(name="آخر الشفتات", inline=False, value="\n".join(
                f"{ts(r['start_ts'], 'd')} · {dur(r['seconds'])} · +{r['points']}" + (" 💤" if r["end_reason"] == "afk" else "") for r in shifts))
        if warns:
            e.add_field(name="الإنذارات النشطة", inline=False, value="\n".join(f"⚠️ {w['reason'][:80]} · {ts(w['ts'], 'R')}" for w in warns[-5:]))
        dis = self.db.execute("SELECT * FROM dismissals WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT 3", (gid, uid)).fetchall()
        if dis:
            e.add_field(name="الفصل", inline=False, value="\n".join(
                f"{'⛔ فصل' if d['kind'] == 'dismiss' else '↩️ إرجاع'} · {d['reason'][:70]} · {ts(d['ts'], 'R')}" for d in dis))
        await interaction.response.send_message(embed=e, ephemeral=True)

    async def cmd_active(self, interaction: discord.Interaction):
        gid = interaction.guild.id
        rows = sorted((s for (g, _), s in self.active.items() if g == gid), key=lambda s: s["start_ts"])
        lines = [f"🟢 <@{s['user_id']}> · <#{s['channel_id']}> · {dur(now() - s['start_ts'])}" + (" · ⏳ ينتظر التحقق" if s.get("check_sent_ts") else "")
                 for s in rows[:40]]
        e = mk(f"👮 الشفتات الحالية ({len(rows)})", "\n".join(lines) or "ما فيه أحد في الشفت الآن.", GREEN if rows else GRAY, interaction.guild)
        await interaction.response.send_message(embed=e, ephemeral=True)

    # ---------------------------------------------------------------- أوامر الإدارة
    async def _need_manager(self, interaction: discord.Interaction) -> bool:
        if self.is_manager(interaction.user):
            return True
        await interaction.response.send_message("❌ هذا الأمر لمسؤولي النقاط فقط.", ephemeral=True)
        return False

    async def _reply(self, interaction: discord.Interaction, **kw):
        if interaction.response.is_done():
            await interaction.followup.send(ephemeral=True, **kw)
        else:
            await interaction.response.send_message(ephemeral=True, **kw)

    async def cmd_change_points(self, interaction: discord.Interaction, member: discord.Member, delta: int, reason: str):
        if not await self._need_manager(interaction):
            return
        if delta == 0 or abs(delta) > 100000:
            return await interaction.response.send_message("❌ عدد النقاط لازم يكون بين 1 و 100000.", ephemeral=True)
        if member.bot:
            return await interaction.response.send_message("❌ ما تقدر تعطي البوتات نقاط.", ephemeral=True)
        gid = interaction.guild.id
        new = self.add_points(gid, member.id, delta, reason, interaction.user.id, "manual")
        add = delta > 0
        await interaction.response.send_message(
            f"{'✅ تمت إضافة' if add else '✅ تم خصم'} **{abs(delta)}** نقطة {'لـ' if add else 'من'} {member.mention}.\n📊 رصيده الحالي: **{new:,}** نقطة.",
            ephemeral=True)
        e = mk("➕ إضافة نقاط" if add else "➖ خصم نقاط", f"{member.mention}", GREEN if add else RED, interaction.guild)
        e.add_field(name="النقاط", value=f"{'+' if add else '-'}{abs(delta)}")
        e.add_field(name="الرصيد الجديد", value=f"{new:,}")
        e.add_field(name="بواسطة", value=interaction.user.mention)
        e.add_field(name="السبب", value=reason[:1000], inline=False)
        await self.send_log(interaction.guild, e)
        dm = mk("🔔 تحديث نقاطك", f"تم **{'إضافة' if add else 'خصم'} {abs(delta)}** نقطة {'لك' if add else 'منك'} في **{interaction.guild.name}**.",
                GREEN if add else RED, interaction.guild)
        dm.add_field(name="رصيدك الجديد", value=f"{new:,}")
        dm.add_field(name="السبب", value=reason[:1000], inline=False)
        try:
            await member.send(embed=dm)
        except discord.HTTPException:
            pass

    async def cmd_warn(self, interaction: discord.Interaction, member: discord.Member, reason: str):
        if not await self._need_manager(interaction):
            return
        gid = interaction.guild.id
        self.db.execute("INSERT INTO warnings (guild_id, user_id, reason, by_id, ts) VALUES (?,?,?,?,?)", (gid, member.id, reason[:300], interaction.user.id, now()))
        self.db.commit()
        count = len(self.active_warnings(gid, member.id))
        limit = self.settings(gid)["warn_limit"]
        await self._reply(interaction, content=f"⚠️ تم إنذار {member.mention} — صار عنده **{count}{f'/{limit}' if limit else ''}** إنذار.")
        e = mk("⚠️ إنذار", member.mention, ORANGE, interaction.guild)
        e.add_field(name="العدد", value=f"{count}{f'/{limit}' if limit else ''}")
        e.add_field(name="بواسطة", value=interaction.user.mention)
        e.add_field(name="السبب", value=reason[:1000], inline=False)
        await self.send_log(interaction.guild, e)
        dm = mk("⚠️ وصلك إنذار", f"وصلك إنذار في **{interaction.guild.name}** ({count}{f'/{limit}' if limit else ''}).", ORANGE, interaction.guild)
        dm.add_field(name="السبب", value=reason[:1000], inline=False)
        if limit and count < limit:
            dm.add_field(name="تنبيه", value=f"عند **{limit}** إنذارات يتم فصلك تلقائياً.", inline=False)
        try:
            await member.send(embed=dm)
        except discord.HTTPException:
            pass
        if limit and count >= limit:
            ok, msg = await self.dismiss(interaction.guild, member, f"وصل حد الإنذارات ({count}/{limit}) — آخر إنذار: {reason}", interaction.user)
            await self._reply(interaction, content=f"⛔ وصل {member.mention} حد الإنذارات وتم **فصله تلقائياً**." + (f"\n{msg}" if msg else ""))

    async def dismiss(self, guild: discord.Guild, member: discord.Member, reason: str, by: discord.abc.User, reset_points: bool = False) -> tuple[bool, str]:
        """يفصل العسكري: ينهي شفته، يسحب الرتب، يعطيه رتبة المفصول، يصفّر إنذاراته، ويسجّل كل شي."""
        st = self.settings(guild.id)
        gid = guild.id
        await self.end_shift(gid, member.id, "dismissed", by=by)
        ids = {st.get("military_role_id"), st.get("manager_role_id")} | {int(x) for x in (st.get("dismiss_roles") or "").split(",") if x.isdigit()}
        remove = [r for r in member.roles if r.id in ids and not r.managed]
        problems = ""
        try:
            if remove:
                await member.remove_roles(*remove, reason=f"فصل: {reason}"[:500])
            dr = guild.get_role(st.get("dismissed_role_id") or 0)
            if dr:
                await member.add_roles(dr, reason=f"فصل: {reason}"[:500])
        except discord.Forbidden:
            problems = "⚠️ ما قدرت أسحب/أعطي بعض الرتب — تأكد إن رتبة البوت فوق رتب العسكر."
        except discord.HTTPException:
            problems = "⚠️ صار خطأ أثناء تعديل الرتب."
        self.db.execute("UPDATE warnings SET active = 0 WHERE guild_id = ? AND user_id = ?", (gid, member.id))
        self.db.execute("INSERT INTO dismissals (guild_id, user_id, kind, reason, by_id, ts) VALUES (?,?,?,?,?,?)",
                        (gid, member.id, "dismiss", reason[:300], by.id, now()))
        self.db.commit()
        if reset_points:
            pts = self.get_user_points(gid, member.id)
            if pts:
                self.add_points(gid, member.id, -pts, "تصفير بسبب الفصل", by.id, "dismiss")
        self._block(gid, member.id, False)
        e = mk("⛔ فصل عسكري", member.mention, RED, guild)
        e.set_author(name=member.display_name, icon_url=member.display_avatar.url)
        e.add_field(name="بواسطة", value=by.mention)
        e.add_field(name="الرتب المسحوبة", value=" ".join(r.mention for r in remove) or "—")
        e.add_field(name="تصفير النقاط", value="نعم" if reset_points else "لا")
        e.add_field(name="السبب", value=reason[:1000], inline=False)
        await self.send_log(guild, e)
        dm = mk("⛔ تم فصلك", f"تم فصلك من **وزارة الداخلية** في **{guild.name}**.", RED, guild)
        dm.add_field(name="السبب", value=reason[:1000], inline=False)
        try:
            await member.send(embed=dm)
        except discord.HTTPException:
            pass
        return not problems, problems

    async def cmd_dismiss(self, interaction: discord.Interaction, member: discord.Member, reason: str, reset_points: bool, confirm: bool = True):
        if not await self._need_manager(interaction):
            return
        if member.bot or member.id == interaction.user.id:
            return await interaction.response.send_message("❌ ما تقدر تفصل هذا العضو.", ephemeral=True)
        if isinstance(interaction.user, discord.Member) and member.top_role >= interaction.user.top_role and not interaction.user.guild_permissions.administrator:
            return await interaction.response.send_message("❌ ما تقدر تفصل شخص رتبته أعلى منك أو مثلك.", ephemeral=True)

        async def go(i: discord.Interaction):
            if i.response.is_done():
                pass
            elif confirm:
                await i.response.edit_message(content="⏳ جاري الفصل…", embed=None, view=None)
            else:
                await i.response.defer(ephemeral=True)
            ok, problems = await self.dismiss(i.guild, member, reason, i.user, reset_points)
            await i.followup.send(f"⛔ تم فصل {member.mention}." + (f"\n{problems}" if problems else ""), ephemeral=True)

        if not confirm:
            return await go(interaction)
        e = mk("⛔ تأكيد الفصل", f"متأكد تبي تفصل {member.mention}؟\n**السبب:** {reason[:500]}\n**تصفير النقاط:** {'نعم' if reset_points else 'لا'}", RED)
        await interaction.response.send_message(embed=e, view=ConfirmView(interaction.user.id, go, "فصل"), ephemeral=True)

    async def cmd_reinstate(self, interaction: discord.Interaction, member: discord.Member, reason: str):
        if not await self._need_manager(interaction):
            return
        st = self.settings(interaction.guild.id)
        await interaction.response.defer(ephemeral=True)
        problems = ""
        try:
            mr = interaction.guild.get_role(st.get("military_role_id") or 0)
            if mr:
                await member.add_roles(mr, reason=f"إلغاء فصل: {reason}"[:500])
            dr = interaction.guild.get_role(st.get("dismissed_role_id") or 0)
            if dr and dr in member.roles:
                await member.remove_roles(dr, reason=f"إلغاء فصل: {reason}"[:500])
        except discord.HTTPException:
            problems = "\n⚠️ ما قدرت أعدّل الرتب — تأكد إن رتبة البوت فوق رتب العسكر."
        self.db.execute("INSERT INTO dismissals (guild_id, user_id, kind, reason, by_id, ts) VALUES (?,?,?,?,?,?)",
                        (interaction.guild.id, member.id, "reinstate", reason[:300], interaction.user.id, now()))
        self.db.commit()
        await interaction.followup.send(f"↩️ تم إرجاع {member.mention} للعسكر.{problems}", ephemeral=True)
        e = mk("↩️ إلغاء فصل", member.mention, GREEN, interaction.guild)
        e.add_field(name="بواسطة", value=interaction.user.mention)
        e.add_field(name="السبب", value=reason[:1000], inline=False)
        await self.send_log(interaction.guild, e)

    async def cmd_end_shift(self, interaction: discord.Interaction, member):
        if not await self._need_manager(interaction):
            return
        res = await self.end_shift(interaction.guild.id, member.id, "admin", by=interaction.user)
        if res is None:
            return await interaction.response.send_message(f"⚪ {member.mention} مو في شفت الآن.", ephemeral=True)
        if self.in_shift_channel(member):
            self._block(interaction.guild.id, member.id, True)  # ما يرجع يبدأ إلا إذا طلع ورجع
        await interaction.response.send_message(f"⏹️ تم إنهاء شفت {member.mention} — المدة {dur(res[0])} · +{res[1]} نقطة.", ephemeral=True)

    async def cmd_reset(self, interaction: discord.Interaction):
        if not interaction.user.guild_permissions.administrator:
            return await interaction.response.send_message("❌ تصفير النقاط للأدمن فقط.", ephemeral=True)

        async def go(i: discord.Interaction):
            n = self.db.execute("SELECT COUNT(*) FROM user_points WHERE guild_id = ? AND points > 0", (i.guild.id,)).fetchone()[0]
            self.db.execute("DELETE FROM user_points WHERE guild_id = ?", (i.guild.id,))
            self.db.execute("INSERT INTO points_log (guild_id, user_id, delta, balance, reason, by_id, kind, ts) VALUES (?,?,?,?,?,?,?,?)",
                            (i.guild.id, 0, 0, 0, "تصفير نقاط السيرفر", i.user.id, "reset", now()))
            self.db.commit()
            await i.response.edit_message(content=f"🔄 تم تصفير نقاط **{n}** عسكري.", embed=None, view=None)
            await self.send_log(i.guild, mk("🔄 تصفير النقاط", f"صفّر {i.user.mention} نقاط السيرفر ({n} عسكري).", RED, i.guild))

        e = mk("🔄 تأكيد التصفير", "متأكد تبي تصفّر **كل** نقاط العساكر في السيرفر؟ ما تقدر ترجع عنها.", RED)
        await interaction.response.send_message(embed=e, view=ConfirmView(interaction.user.id, go, "تصفير"), ephemeral=True)

    # ---------------------------------------------------------------- أوامر السلاش العامة
    @app_commands.command(name="نقاطي", description="بطاقة نقاطك وساعات شفتك")
    @app_commands.guild_only()
    async def my_points(self, interaction: discord.Interaction):
        await self.cmd_card(interaction, interaction.user)

    @app_commands.command(name="نقاط", description="عرض بطاقة نقاط عسكري")
    @app_commands.rename(member="العسكري")
    @app_commands.describe(member="العسكري اللي تبي تشوف نقاطه")
    @app_commands.guild_only()
    async def points_of(self, interaction: discord.Interaction, member: discord.Member):
        await self.cmd_card(interaction, member)

    @app_commands.command(name="توب", description="أعلى 10 عساكر نقاطاً")
    @app_commands.guild_only()
    async def top(self, interaction: discord.Interaction):
        await self.cmd_top(interaction)

    @app_commands.command(name="شفتي", description="حالة شفتك الآن وساعاتك")
    @app_commands.guild_only()
    async def my_shift(self, interaction: discord.Interaction):
        await self.cmd_my_shift(interaction)

    @app_commands.command(name="الشفتات", description="العساكر اللي في الشفت الآن")
    @app_commands.guild_only()
    async def active_cmd(self, interaction: discord.Interaction):
        await self.cmd_active(interaction)

    @app_commands.command(name="سجل", description="سجل عسكري: النقاط والشفتات والإنذارات والفصل")
    @app_commands.rename(member="العسكري")
    @app_commands.describe(member="اتركه فاضي لعرض سجلك")
    @app_commands.guild_only()
    async def record(self, interaction: discord.Interaction, member: discord.Member | None = None):
        await self.cmd_record(interaction, member or interaction.user)

    @app_commands.command(name="اضافة-نقاط", description="إضافة نقاط لعسكري (لمسؤولي النقاط)")
    @app_commands.rename(member="العسكري", amount="العدد", reason="السبب")
    @app_commands.describe(member="العسكري", amount="عدد النقاط", reason="سبب الإضافة")
    @app_commands.guild_only()
    async def add_points_cmd(self, interaction: discord.Interaction, member: discord.Member, amount: app_commands.Range[int, 1, 100000], reason: str):
        await self.cmd_change_points(interaction, member, amount, reason)

    @app_commands.command(name="خصم-نقاط", description="خصم نقاط من عسكري (لمسؤولي النقاط)")
    @app_commands.rename(member="العسكري", amount="العدد", reason="السبب")
    @app_commands.describe(member="العسكري", amount="عدد النقاط", reason="سبب الخصم")
    @app_commands.guild_only()
    async def remove_points_cmd(self, interaction: discord.Interaction, member: discord.Member, amount: app_commands.Range[int, 1, 100000], reason: str):
        await self.cmd_change_points(interaction, member, -amount, reason)

    @app_commands.command(name="انذار", description="إعطاء عسكري إنذار — يُفصل تلقائياً عند الحد")
    @app_commands.rename(member="العسكري", reason="السبب")
    @app_commands.describe(member="العسكري", reason="سبب الإنذار")
    @app_commands.guild_only()
    async def warn_cmd(self, interaction: discord.Interaction, member: discord.Member, reason: str):
        await self.cmd_warn(interaction, member, reason)

    @app_commands.command(name="ازالة-انذار", description="إزالة آخر إنذار من عسكري")
    @app_commands.rename(member="العسكري")
    @app_commands.describe(member="العسكري")
    @app_commands.guild_only()
    async def unwarn_cmd(self, interaction: discord.Interaction, member: discord.Member):
        if not await self._need_manager(interaction):
            return
        warns = self.active_warnings(interaction.guild.id, member.id)
        if not warns:
            return await interaction.response.send_message(f"⚪ {member.mention} ما عنده إنذارات.", ephemeral=True)
        self.db.execute("UPDATE warnings SET active = 0 WHERE id = ?", (warns[-1]["id"],))
        self.db.commit()
        await interaction.response.send_message(f"✅ تمت إزالة إنذار من {member.mention} — باقي **{len(warns) - 1}**.", ephemeral=True)
        await self.send_log(interaction.guild, mk("✅ إزالة إنذار", f"{member.mention} · بواسطة {interaction.user.mention}", GREEN, interaction.guild))

    @app_commands.command(name="فصل", description="فصل عسكري: سحب الرتب وإنهاء الشفت وتسجيل الفصل")
    @app_commands.rename(member="العسكري", reason="السبب", reset_points="تصفير_النقاط")
    @app_commands.describe(member="العسكري", reason="سبب الفصل", reset_points="تصفير نقاطه بعد الفصل؟")
    @app_commands.choices(reset_points=[app_commands.Choice(name="لا", value=0), app_commands.Choice(name="نعم", value=1)])
    @app_commands.guild_only()
    async def dismiss_cmd(self, interaction: discord.Interaction, member: discord.Member, reason: str, reset_points: int = 0):
        await self.cmd_dismiss(interaction, member, reason, bool(reset_points))

    @app_commands.command(name="الغاء-فصل", description="إرجاع عسكري مفصول")
    @app_commands.rename(member="العسكري", reason="السبب")
    @app_commands.describe(member="العسكري", reason="سبب الإرجاع")
    @app_commands.guild_only()
    async def reinstate_cmd(self, interaction: discord.Interaction, member: discord.Member, reason: str):
        await self.cmd_reinstate(interaction, member, reason)

    @app_commands.command(name="انهاء-شفت", description="إنهاء شفت عسكري يدوياً (لمسؤولي النقاط)")
    @app_commands.rename(member="العسكري")
    @app_commands.describe(member="العسكري")
    @app_commands.guild_only()
    async def end_shift_cmd(self, interaction: discord.Interaction, member: discord.Member):
        await self.cmd_end_shift(interaction, member)

    # ---------------------------------------------------------------- /الداخلية (إعدادات الأدمن)
    @police.command(name="اعداد", description="تحديد رتب النظام وروم اللوق")
    @app_commands.rename(manager_role="رتبة_المسؤول", military_role="رتبة_العسكر", log_channel="روم_اللوق", dismissed_role="رتبة_المفصول")
    @app_commands.describe(manager_role="رتبة مسؤولي النقاط (يضيفون ويخصمون ويفصلون)", military_role="رتبة العساكر (وزارة الداخلية)",
                           log_channel="روم لوق النقاط والشفتات والفصل", dismissed_role="رتبة تُعطى للمفصول (اختياري)")
    async def setup_cmd(self, interaction: discord.Interaction, manager_role: discord.Role, military_role: discord.Role,
                        log_channel: discord.TextChannel | None = None, dismissed_role: discord.Role | None = None):
        values = {"manager_role_id": manager_role.id, "military_role_id": military_role.id}
        if log_channel:
            values["log_channel_id"] = log_channel.id
        if dismissed_role:
            values["dismissed_role_id"] = dismissed_role.id
        self.set_settings(interaction.guild.id, **values)
        await interaction.response.send_message(embed=self.settings_embed(interaction.guild, "✅ تم حفظ الإعدادات"), ephemeral=True)

    @police.command(name="رومات-الشفت", description="إضافة أو إزالة رومات الشفت الصوتية")
    @app_commands.rename(action="العملية", channel="الروم")
    @app_commands.describe(action="إضافة أو إزالة أو عرض", channel="الروم الصوتي")
    @app_commands.choices(action=[app_commands.Choice(name="اضافة", value="add"), app_commands.Choice(name="ازالة", value="remove"),
                                  app_commands.Choice(name="عرض", value="list")])
    async def shift_rooms(self, interaction: discord.Interaction, action: str, channel: discord.VoiceChannel | discord.StageChannel | None = None):
        gid = interaction.guild.id
        if action != "list":
            if channel is None:
                return await interaction.response.send_message("❌ حدد الروم الصوتي.", ephemeral=True)
            if action == "add":
                self.db.execute("INSERT OR IGNORE INTO shift_channels VALUES (?, ?)", (gid, channel.id))
            else:
                self.db.execute("DELETE FROM shift_channels WHERE guild_id = ? AND channel_id = ?", (gid, channel.id))
            self.db.commit()
            self._channels.pop(gid, None)
            if action == "add":  # اللي موجودين في الروم الحين يبدأ شفتهم
                for m in channel.members:
                    if self.can_shift(m):
                        await self.start_shift(m, channel)
            else:
                for (g, u), s in list(self.active.items()):
                    if g == gid and s["channel_id"] == channel.id:
                        await self.end_shift(g, u, "left")
        chans = "\n".join(f"🔊 <#{c}>" for c in self.shift_channels(gid)) or "ما فيه رومات شفت."
        await interaction.response.send_message(embed=mk("🔊 رومات الشفت", chans, BLUE), ephemeral=True)

    @police.command(name="رتب-الفصل", description="رتب إضافية تنسحب من العسكري عند فصله (مثل رتب الدرجات العسكرية)")
    @app_commands.rename(action="العملية", role="الرتبة")
    @app_commands.describe(action="إضافة أو إزالة أو عرض", role="الرتبة")
    @app_commands.choices(action=[app_commands.Choice(name="اضافة", value="add"), app_commands.Choice(name="ازالة", value="remove"),
                                  app_commands.Choice(name="عرض", value="list")])
    async def dismiss_roles(self, interaction: discord.Interaction, action: str, role: discord.Role | None = None):
        gid = interaction.guild.id
        ids = [int(x) for x in (self.settings(gid).get("dismiss_roles") or "").split(",") if x.isdigit()]
        if action != "list":
            if role is None:
                return await interaction.response.send_message("❌ حدد الرتبة.", ephemeral=True)
            if action == "add" and role.id not in ids:
                ids.append(role.id)
            elif action == "remove" and role.id in ids:
                ids.remove(role.id)
            self.set_settings(gid, dismiss_roles=",".join(map(str, ids)))
        txt = " ".join(f"<@&{i}>" for i in ids) or "ما فيه رتب إضافية — يُسحب بس رتبة العسكر ورتبة المسؤول."
        await interaction.response.send_message(embed=mk("⛔ رتب الفصل", txt, RED), ephemeral=True)

    @police.command(name="نظام-الشفت", description="تشغيل/إيقاف الشفت التلقائي وتعديل النقاط ووقت التحقق")
    @app_commands.rename(status="الحالة", points="النقاط", every="كل_كم_دقيقة", minimum="اقل_مدة", check_after="التحقق_بعد",
                         timeout="مهلة_الرد", warn_limit="حد_الانذارات")
    @app_commands.describe(status="تشغيل أو إيقاف الشفت التلقائي", points="كم نقطة يأخذ العسكري", every="كل كم دقيقة شفت يأخذ النقاط (مثلاً 10)",
                           minimum="أقل مدة شفت تنحسب (بالدقائق)", check_after="بعد كم دقيقة يرسل «هل انت موجود؟» (0 = بدون تحقق)",
                           timeout="كم دقيقة ينتظر الرد قبل ما يوقف الشفت", warn_limit="عدد الإنذارات اللي يُفصل بعدها تلقائياً (0 = بدون)")
    @app_commands.choices(status=[app_commands.Choice(name="تشغيل", value=1), app_commands.Choice(name="ايقاف", value=0)])
    async def shift_system(self, interaction: discord.Interaction, status: int | None = None,
                           points: app_commands.Range[int, 0, 1000] | None = None, every: app_commands.Range[int, 1, 600] | None = None,
                           minimum: app_commands.Range[int, 0, 600] | None = None, check_after: app_commands.Range[int, 0, 1440] | None = None,
                           timeout: app_commands.Range[int, 1, 240] | None = None, warn_limit: app_commands.Range[int, 0, 50] | None = None):
        values = {k: v for k, v in {"shift_enabled": status, "shift_points": points, "shift_block": every, "shift_min": minimum,
                                    "check_after": check_after, "check_timeout": timeout, "warn_limit": warn_limit}.items() if v is not None}
        if values:
            self.set_settings(interaction.guild.id, **values)
        await interaction.response.send_message(embed=self.settings_embed(interaction.guild, "✅ تم الحفظ" if values else "⚙️ إعدادات الداخلية"), ephemeral=True)

    @police.command(name="الاعدادات", description="عرض إعدادات نظام الداخلية")
    async def show_settings(self, interaction: discord.Interaction):
        await interaction.response.send_message(embed=self.settings_embed(interaction.guild, "⚙️ إعدادات الداخلية"), ephemeral=True)

    @police.command(name="لوحة-الادارة", description="إرسال لوحة تحكم المسؤولين في هذا الروم")
    @app_commands.rename(description="الوصف")
    @app_commands.describe(description="وصف اللوحة (اختياري)")
    async def admin_panel(self, interaction: discord.Interaction, description: str | None = None):
        st = self.settings(interaction.guild.id)
        if not st.get("manager_role_id"):
            return await interaction.response.send_message("❌ استخدم `/الداخلية اعداد` أول.", ephemeral=True)
        desc = description or ("لوحة تحكم مسؤولي وزارة الداخلية.\n\n"
                               "➕ إضافة نقاط · ➖ خصم نقاط · ⚠️ إنذار · ⛔ فصل · ↩️ إلغاء فصل\n"
                               "⏹️ إنهاء شفت · 📜 سجل عسكري · 🟢 الشفتات الحالية · 🔄 تصفير")
        e = mk("🛡️ لوحة تحكم الداخلية", desc, RED, interaction.guild)
        if interaction.guild.icon:
            e.set_thumbnail(url=interaction.guild.icon.url)
        await interaction.channel.send(embed=e, view=PoliceAdminPanelView(self))
        self.set_settings(interaction.guild.id, panel_channel_id=interaction.channel.id)
        await interaction.response.send_message("✅ تم إرسال لوحة التحكم.", ephemeral=True)

    @police.command(name="لوحة-الخدمات", description="إرسال لوحة خدمات العساكر في هذا الروم")
    @app_commands.rename(description="الوصف")
    @app_commands.describe(description="وصف اللوحة (اختياري)")
    async def public_panel(self, interaction: discord.Interaction, description: str | None = None):
        st = self.settings(interaction.guild.id)
        chans = " ".join(f"<#{c}>" for c in self.shift_channels(interaction.guild.id))
        desc = description or ("خدمات العساكر في وزارة الداخلية.\n\n"
                               "🪪 بطاقتي · 🔍 بطاقة عسكري · 🏆 توب 10 · ⏱️ حالة شفتي · 📜 سجلي\n\n"
                               f"⏱️ **الشفت تلقائي:** ادخل روم الشفت ويبدأ شفتك، وكل **{st['shift_block']} دقيقة = {st['shift_points']} نقطة**."
                               + (f"\n🔊 رومات الشفت: {chans}" if chans else ""))
        e = mk("🎖️ خدمات وزارة الداخلية", desc, 0x003264, interaction.guild)
        if interaction.guild.icon:
            e.set_thumbnail(url=interaction.guild.icon.url)
        await interaction.channel.send(embed=e, view=PolicePublicPanelView(self))
        await interaction.response.send_message("✅ تم إرسال لوحة الخدمات.", ephemeral=True)

    @police.command(name="تصفير", description="تصفير كل نقاط السيرفر (مع تأكيد)")
    async def reset_cmd(self, interaction: discord.Interaction):
        await self.cmd_reset(interaction)

    def settings_embed(self, guild: discord.Guild, title: str) -> discord.Embed:
        st = self.settings(guild.id)
        role = lambda k: f"<@&{st[k]}>" if st.get(k) else "—"  # noqa: E731
        e = mk(title, None, BLUE, guild)
        e.add_field(name="رتبة المسؤول", value=role("manager_role_id"))
        e.add_field(name="رتبة العسكر", value=role("military_role_id"))
        e.add_field(name="رتبة المفصول", value=role("dismissed_role_id"))
        e.add_field(name="روم اللوق", value=f"<#{st['log_channel_id']}>" if st.get("log_channel_id") else "—")
        e.add_field(name="الشفت التلقائي", value="🟢 شغال" if st["shift_enabled"] else "🔴 موقف")
        e.add_field(name="النقاط", value=f"كل {st['shift_block']} دقيقة = {st['shift_points']} نقطة")
        e.add_field(name="أقل مدة", value=f"{st['shift_min']} دقيقة")
        e.add_field(name="«هل انت موجود؟»", value=f"بعد {st['check_after']} دقيقة" if st["check_after"] else "بدون تحقق")
        e.add_field(name="مهلة الرد", value=f"{st['check_timeout']} دقيقة")
        e.add_field(name="حد الإنذارات", value=str(st["warn_limit"] or "بدون فصل تلقائي"))
        e.add_field(name="رومات الشفت", value=" ".join(f"<#{c}>" for c in self.shift_channels(guild.id)) or "—", inline=False)
        if not st.get("military_role_id"):
            e.description = "⚠️ لازم تحدد رتبة العسكر عشان يشتغل الشفت: `/الداخلية اعداد`"
        elif not self.shift_channels(guild.id):
            e.description = "⚠️ أضف روم شفت صوتي: `/الداخلية رومات-الشفت`"
        return e

    async def cog_app_command_error(self, interaction: discord.Interaction, error: app_commands.AppCommandError):
        if isinstance(error, (app_commands.MissingPermissions, app_commands.CheckFailure)):
            msg = "❌ ما عندك صلاحية لهذا الأمر."
        else:
            log.exception("police command", exc_info=error)
            msg = "❌ صار خطأ غير متوقع أثناء تنفيذ الأمر."
        try:
            await self._reply(interaction, content=msg)
        except discord.HTTPException:
            pass


async def setup(bot):
    await bot.add_cog(PointPolice(bot))
