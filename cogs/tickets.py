"""نظام التذاكر الاحترافي | Professional ticket system (يحل محل ticket.py و support.py).

- واجهة Components V2 (بطاقات Container) مع رجوع تلقائي للإيمبد لو مكتبة ديسكورد قديمة.
- أسئلة قبل فتح التذكرة (12 قالب جاهز أو أسئلة مخصصة من لوحة التحكم) تظهر إجاباتها داخل التذكرة.
- حالة التذاكر في tickets.db فتبقى الأزرار تعمل بعد إعادة التشغيل (بدون بيانات داخل الأزرار).
- استلام/إلغاء استلام، أولوية، إضافة/إزالة عضو، نسخة المحادثة HTML، تقييم بالخاص، لوق مفصّل.
- /ticket setup · panel · close · claim · add · remove · rename · priority · transcript · info
- نفس custom_id القديمة، فالبانلات المرسلة سابقاً تستمر بالعمل.
"""
import asyncio
import html
import io
import json
import re
import sqlite3
import time
from datetime import datetime, timezone

import discord
from discord import app_commands, ui
from discord.ext import commands

from core import i18n
from core.brand import clip, color as brand_color, embed as mk_embed
from core.store import JsonStore
from core.strings import add
from core.ticket_presets import PRESETS, questions_for
from emojis import E

CV2 = hasattr(ui, "LayoutView") and hasattr(ui, "Container")
PRIORITIES = ("normal", "high", "urgent")

add("tk", {
    "group": ("إدارة التذاكر", "Ticket management"),
    # ---- حالات/أخطاء
    "no_type": ("❌ ما لقيت إعدادات هذا النوع من التذاكر.", "❌ I couldn't find the settings for this ticket type."),
    "no_ticket": ("❌ هذا الروم ليس تذكرة.", "❌ This channel isn't a ticket."),
    "staff_only": ("❌ هذا الخيار للإدارة المسؤولة عن التذاكر فقط.", "❌ This option is for ticket staff only."),
    "owner_or_staff": ("❌ هذا الخيار لصاحب التذكرة أو الإدارة فقط.", "❌ Only the ticket owner or staff can do this."),
    "limit": ("❌ عندك تذكرة مفتوحة بالفعل من هذا النوع: {channel}", "❌ You already have an open ticket of this type: {channel}"),
    "cooldown": ("⏳ انتظر {s} ثانية قبل فتح تذكرة جديدة.", "⏳ Please wait {s}s before opening another ticket."),
    "no_cat": ("❌ كاتيجوري التذاكر غير موجود. تواصل مع الإدارة.", "❌ The ticket category is missing. Please contact the staff."),
    "no_perm_bot": ("❌ البوت يحتاج صلاحية **إدارة الرومات** و **إدارة الصلاحيات** في كاتيجوري التذاكر.", "❌ I need **Manage Channels** and **Manage Permissions** in the ticket category."),
    "created": ("✅ تم إنشاء تذكرتك: {channel}", "✅ Your ticket is ready: {channel}"),
    # ---- محتوى التذكرة
    "owner": ("صاحب التذكرة", "Ticket owner"), "opened": ("وقت الفتح", "Opened"), "priority": ("الأولوية", "Priority"), "claimed": ("المستلم", "Claimed by"),
    "unclaimed": ("لم تُستلم بعد", "Not claimed yet"), "type": ("النوع", "Type"), "answers": ("إجابات صاحب التذكرة", "Owner's answers"),
    "p_normal": ("عادية", "Normal"), "p_high": ("عالية", "High"), "p_urgent": ("عاجلة", "Urgent"),
    "welcome_default": ("أهلاً بك! اشرح طلبك وسيرد عليك فريق الدعم بأقرب وقت. 💙", "Welcome! Describe your request and our team will reply as soon as possible. 💙"),
    "ticket_of": ("تذكرة {name}", "{name}'s ticket"),
    # ---- أزرار
    "b_claim": ("استلام", "Claim"), "b_unclaim": ("إلغاء الاستلام", "Unclaim"), "b_close": ("إغلاق", "Close"), "b_call": ("استدعاء الدعم", "Call support"), "b_transcript": ("نسخة المحادثة", "Transcript"),
    "m_ph": ("⚙️ خيارات إدارة التذكرة…", "⚙️ Ticket options…"),
    "m_rename": ("تعديل اسم التذكرة", "Rename ticket"), "m_ping": ("استدعاء صاحب التذكرة", "Ping the ticket owner"), "m_add": ("إضافة عضو", "Add a member"),
    "m_remove": ("إزالة عضو", "Remove a member"), "m_priority": ("تغيير الأولوية", "Change priority"),
    # ---- إجراءات
    "claimed_msg": ("{user} استلم التذكرة وسيتابع معك.", "{user} claimed this ticket and will assist you."),
    "unclaimed_msg": ("{user} ألغى استلام التذكرة. بانتظار مسؤول آخر.", "{user} released this ticket. Waiting for another staff member."),
    "called": ("🔔 تم استدعاء فريق الدعم: {mention}", "🔔 Support team called: {mention}"), "pinged": ("🔔 {owner} فريق الدعم ينتظر ردك.", "🔔 {owner} the support team is waiting for your reply."),
    "pick_add": ("اختر العضو الذي تريد إضافته:", "Pick the member to add:"), "pick_remove": ("اختر العضو الذي تريد إزالته:", "Pick the member to remove:"),
    "added": ("✅ تمت إضافة {user} إلى التذكرة.", "✅ {user} was added to the ticket."), "removed": ("✅ تمت إزالة {user} من التذكرة.", "✅ {user} was removed from the ticket."),
    "cant_owner": ("لا يمكن إزالة صاحب التذكرة.", "You can't remove the ticket owner."),
    "renamed": ("✅ تم تغيير الاسم إلى **{name}**", "✅ Renamed to **{name}**"), "rename_t": ("تعديل اسم التذكرة", "Rename ticket"), "rename_l": ("الاسم الجديد", "New name"),
    "prio_set": ("✅ الأولوية الآن: **{p}**", "✅ Priority is now **{p}**"), "prio_ph": ("اختر الأولوية", "Choose a priority"),
    "close_t": ("إغلاق التذكرة", "Close ticket"), "close_l": ("سبب الإغلاق (اختياري)", "Closing reason (optional)"),
    "closing": ("🔒 جاري إغلاق التذكرة… ستُحذف خلال 5 ثوانٍ وتُرسل لك النسخة والتقييم.", "🔒 Closing the ticket… it will be deleted in 5 seconds; the transcript and rating are on their way."),
    "transcript_sent": ("📄 نسخة المحادثة:", "📄 Chat transcript:"), "transcript_busy": ("⏳ جاري تجهيز النسخة…", "⏳ Preparing the transcript…"),
    # ---- لوق التذاكر
    "log_t": ("تم إغلاق تذكرة", "Ticket closed"), "closed_by": ("أُغلقت بواسطة", "Closed by"), "duration": ("المدة", "Duration"), "messages": ("الرسائل", "Messages"),
    "reason": ("السبب", "Reason"), "none": ("—", "—"), "closed_at": ("وقت الإغلاق", "Closed"),
    # ---- التقييم
    "rate_t": ("قيّم تجربتك", "Rate your experience"), "rate_d": ("شكراً لتواصلك! كيف كانت خدمة فريق الدعم في تذكرة **{name}**؟", "Thanks for reaching out! How was our support in your **{name}** ticket?"),
    "rate_ph": ("⭐ اختر تقييمك", "⭐ Choose your rating"), "r5": ("ممتاز جداً", "Excellent"), "r4": ("جيد جداً", "Very good"), "r3": ("جيد", "Good"), "r2": ("مقبول", "Fair"), "r1": ("سيئ", "Poor"),
    "rate_thanks": ("💙 شكراً لتقييمك! رأيك يساعدنا نتطور.", "💙 Thanks for rating us! It helps us improve."), "rate_log_t": ("تقييم تذكرة جديد", "New ticket rating"),
    "rate_not_yours": ("❌ هذا التقييم لصاحب التذكرة فقط.", "❌ Only the ticket owner can rate."), "rating": ("التقييم", "Rating"),
    # ---- أوامر الإعداد
    "setup_d": ("إعداد نوع تذكرة جديد (1 إلى 10)", "Set up a ticket type (1–10)"), "panel_d": ("إرسال بانل التذاكر في روم", "Send the ticket panel to a channel"),
    "close_d": ("إغلاق التذكرة الحالية", "Close the current ticket"), "claim_d": ("استلام التذكرة الحالية", "Claim the current ticket"),
    "add_d": ("إضافة عضو للتذكرة", "Add a member to the ticket"), "remove_d": ("إزالة عضو من التذكرة", "Remove a member from the ticket"),
    "rename_d": ("تغيير اسم التذكرة", "Rename the ticket"), "prio_d": ("تغيير أولوية التذكرة", "Change the ticket priority"),
    "transcript_d": ("إرسال نسخة المحادثة", "Send the chat transcript"), "info_d": ("معلومات التذكرة الحالية / إحصائيات السيرفر", "Current ticket info / server stats"),
    "p_number": ("رقم التذكرة 1-10", "Ticket number 1-10"), "p_name": ("اسم التذكرة", "Ticket name"), "p_category": ("كاتيجوري التذاكر", "Tickets category"), "p_support": ("رتبة الدعم", "Support role"),
    "p_mod": ("رتبة مشرف التذاكر", "Ticket moderator role"), "p_log": ("روم اللوق", "Log channel"), "p_preset": ("قالب الأسئلة", "Question preset"), "p_welcome": ("رسالة الترحيب", "Welcome message"),
    "p_rating": ("روم التقييم", "Rating channel"), "p_image": ("رابط صورة (اختياري)", "Image URL (optional)"), "p_reason": ("سبب الإغلاق", "Closing reason"),
    "setup_ok": ("تم حفظ التذكرة رقم **{n}** باسم **{name}**.", "Ticket type **#{n}** saved as **{name}**."),
    "bad_num": ("❌ الرقم لازم يكون من 1 إلى 10.", "❌ The number must be between 1 and 10."),
    "panel_none": ("❌ ما فيه أنواع تذاكر محفوظة. استخدم `/ticket setup` أو لوحة التحكم أولاً.", "❌ No ticket types saved yet. Use `/ticket setup` or the dashboard first."),
    "panel_t": ("إرسال بانل التذاكر", "Send the ticket panel"), "panel_edit": ("العنوان والوصف", "Title & description"),
    "panel_channel_ph": ("📍 اختر روم البانل", "📍 Pick the panel channel"), "panel_items_ph": ("🎫 اختر أنواع التذاكر", "🎫 Pick ticket types"),
    "panel_style_ph": ("🔘 طريقة العرض", "🔘 Display style"), "panel_buttons": ("أزرار", "Buttons"), "panel_dropdown": ("قائمة منسدلة", "Dropdown"),
    "panel_send": ("إرسال", "Send"), "panel_modal_t": ("نص البانل", "Panel text"), "panel_title": ("العنوان", "Title"), "panel_desc": ("الوصف", "Description"), "panel_image": ("رابط الصورة (اختياري)", "Image URL (optional)"),
    "panel_sent": ("✅ تم إرسال البانل إلى {channel}.", "✅ Panel sent to {channel}."), "panel_need": ("اختر الروم وأنواع التذاكر أولاً.", "Pick the channel and ticket types first."),
    "panel_default_t": ("مركز الدعم", "Support center"), "panel_default_d": ("اختر نوع التذكرة المناسب وسنكون معك بأسرع وقت.", "Choose the right ticket type and we'll be with you shortly."),
    "panel_ph": ("🎫 اختر نوع التذكرة…", "🎫 Choose a ticket type…"),
    "info_t": ("معلومات التذكرة", "Ticket info"), "preset": ("قالب الأسئلة", "Question preset"),
    "stats_none": ("—", "—"),
})
for k, p in PRESETS.items():
    i18n.register(p["ar"], p["en"])

store = JsonStore("tickets_data.json")


def slug(s: str) -> str:
    s = re.sub(r"[^\w؀-ۿ-]+", "-", s.lower()).strip("-")
    return s[:40] or "user"


# ====================================================================== قاعدة بيانات التذاكر
class TicketDB:
    COLS = {"guild_id": "INTEGER", "type_num": "INTEGER", "name": "TEXT", "ticket_no": "INTEGER", "status": "TEXT DEFAULT 'open'", "priority": "TEXT DEFAULT 'normal'",
            "closed_at": "TEXT", "closed_by": "INTEGER", "answers": "TEXT", "rating": "INTEGER", "rating_msg_id": "INTEGER", "control_msg_id": "INTEGER", "reason": "TEXT"}

    def __init__(self):
        self.con = sqlite3.connect("tickets.db", check_same_thread=False)
        self.con.row_factory = sqlite3.Row
        self.con.execute("CREATE TABLE IF NOT EXISTS tickets (channel_id INTEGER PRIMARY KEY, user_id INTEGER, category TEXT, claimed_by INTEGER DEFAULT NULL, created_at TEXT)")
        have = {r[1] for r in self.con.execute("PRAGMA table_info(tickets)")}
        for c, ddl in self.COLS.items():
            if c not in have:
                self.con.execute(f"ALTER TABLE tickets ADD COLUMN {c} {ddl}")
        self.con.execute("CREATE INDEX IF NOT EXISTS idx_tk_user ON tickets(guild_id, user_id, status)")
        self.con.commit()

    def get(self, channel_id: int):
        r = self.con.execute("SELECT * FROM tickets WHERE channel_id=?", (channel_id,)).fetchone()
        return dict(r) if r else None

    def by_rating(self, msg_id: int):
        r = self.con.execute("SELECT * FROM tickets WHERE rating_msg_id=?", (msg_id,)).fetchone()
        return dict(r) if r else None

    def next_no(self, guild_id: int) -> int:
        return (self.con.execute("SELECT MAX(ticket_no) FROM tickets WHERE guild_id=?", (guild_id,)).fetchone()[0] or 0) + 1

    def open_of(self, guild_id: int, user_id: int, type_num: int):
        return [dict(r) for r in self.con.execute("SELECT * FROM tickets WHERE guild_id=? AND user_id=? AND type_num=? AND status='open'", (guild_id, user_id, type_num))]

    def insert(self, **kw):
        cols = ",".join(kw)
        self.con.execute(f"INSERT OR REPLACE INTO tickets({cols}) VALUES({','.join('?' * len(kw))})", tuple(kw.values()))
        self.con.commit()

    def update(self, channel_id: int, **kw):
        self.con.execute(f"UPDATE tickets SET {','.join(k + '=?' for k in kw)} WHERE channel_id=?", (*kw.values(), channel_id))
        self.con.commit()

    def stats(self, guild_id: int):
        q = self.con.execute("SELECT COUNT(*), SUM(status='open'), AVG(rating) FROM tickets WHERE guild_id=?", (guild_id,)).fetchone()
        return q[0] or 0, q[1] or 0, q[2]


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ====================================================================== الكوج
class Ticket(commands.Cog):  # الاسم Ticket مطلوب للوحة التحكم (send_panel)
    def __init__(self, bot):
        self.bot = bot
        self.db = TicketDB()
        self._cool: dict[tuple[int, int], float] = {}
        self.persistent = [PanelPersistent(self), ControlPersistent(self), RatingPersistent(self)]
        for v in self.persistent:
            bot.add_view(v)

    async def cog_unload(self):
        for v in self.persistent:
            v.stop()

    # -------------------------------------------------- مساعدات
    def types(self, guild_id: int) -> dict:
        return store.get().get(str(guild_id), {})

    def cfg(self, guild_id: int, num) -> dict | None:
        return self.types(guild_id).get(str(num))

    @staticmethod
    def lang(x) -> str:
        return i18n.lang_of(x)

    def T(self, x, key, **v):
        return i18n.tr(self.lang(x), "tk." + key, **v)

    def is_staff(self, member: discord.Member, cfg: dict | None) -> bool:
        if member.guild_permissions.administrator:
            return True
        ids = {(cfg or {}).get("support_role_id"), (cfg or {}).get("ticket_mod_role_id")}
        return any(r.id in ids for r in member.roles)

    def resolve(self, channel: discord.abc.GuildChannel):
        """صف التذكرة؛ للتذاكر القديمة (قبل التحديث) نستنتجه من الروم ونحفظه."""
        row = self.db.get(channel.id)
        if row:
            return row
        m = re.search(r"-(\d{1,2})$", channel.name or "")
        owner = next((t for t in channel.overwrites if isinstance(t, discord.Member) and not t.bot), None)
        if not (m and owner and channel.category):
            return None
        row = dict(channel_id=channel.id, user_id=owner.id, category="legacy", guild_id=channel.guild.id, type_num=int(m.group(1)), name=None,
                   ticket_no=self.db.next_no(channel.guild.id), created_at=utcnow_iso(), status="open", priority="normal")
        self.db.insert(**row)
        return self.db.get(channel.id)

    def prio_label(self, x, p: str) -> str:
        return self.T(x, "p_" + p if p in PRIORITIES else "p_normal")

    # -------------------------------------------------- رسالة التذكرة (CV2 أو إيمبد)
    def render(self, guild, row, cfg, owner, *, v2: bool = True):
        lang = self.lang(guild)
        T = lambda k, **kw: i18n.tr(lang, "tk." + k, **kw)
        preset = PRESETS.get(cfg.get("preset") or "", {})
        emoji = E.get(preset.get("emoji", "ticket"))
        name = cfg.get("name") or T("ticket_of", name=owner.display_name)
        welcome = cfg.get("welcome_msg") or T("welcome_default")
        claimer = guild.get_member(row["claimed_by"]) if row.get("claimed_by") else None
        pr = row.get("priority") or "normal"
        info = [f"{E.ticket_user} **{T('owner')}:** {owner.mention}",
                f"{E.ticket_time} **{T('opened')}:** {discord.utils.format_dt(datetime.fromisoformat(row['created_at']), 'R') if row.get('created_at') else '—'}",
                f"{E.ticket_priority} **{T('priority')}:** `{T('p_' + pr)}`",
                f"{E.ticket_claim} **{T('claimed')}:** {claimer.mention if claimer else '`' + T('unclaimed') + '`'}"]
        answers = json.loads(row["answers"]) if row.get("answers") else []
        qa = "\n\n".join(f"**{q}**\n> {clip(a, 500).replace(chr(10), chr(10) + '> ')}" for q, a in answers)
        accent = {"normal": 0x2F6BFF, "high": 0xFF7A1F, "urgent": 0xF23D4F}[pr] if not claimer else 0x1FC46A
        mention = f"{owner.mention} " + " ".join(f"<@&{cfg[k]}>" for k in ("support_role_id",) if cfg.get(k))

        claim = ui.Button(label=T("b_unclaim") if claimer else T("b_claim"), style=discord.ButtonStyle.secondary if claimer else discord.ButtonStyle.success, custom_id="persistent_claim_ticket_btn", emoji=E.pe("ticket_unclaim" if claimer else "ticket_claim"))
        close = ui.Button(label=T("b_close"), style=discord.ButtonStyle.danger, custom_id="persistent_close_ticket_btn", emoji=E.pe("ticket_close"))
        call = ui.Button(label=T("b_call"), style=discord.ButtonStyle.primary, custom_id="persistent_summon_support_btn", emoji=E.pe("ticket_notify"))
        manage = manage_select(lang)

        if v2 and CV2:
            c = ui.Container(accent_colour=discord.Colour(accent))
            c.add_item(ui.TextDisplay(mention))
            c.add_item(ui.Section(ui.TextDisplay(f"## {emoji} {name}\n{welcome}"), accessory=ui.Thumbnail(owner.display_avatar.url)))
            c.add_item(ui.Separator())
            c.add_item(ui.TextDisplay("\n".join(info)))
            if qa:
                c.add_item(ui.Separator())
                c.add_item(ui.TextDisplay(f"### {E.ticket_questions} {T('answers')}\n{clip(qa, 3000)}"))
            if cfg.get("image_url"):
                c.add_item(ui.MediaGallery(discord.MediaGalleryItem(cfg["image_url"])))
            c.add_item(ui.Separator(spacing=discord.SeparatorSpacing.large))
            c.add_item(ui.ActionRow(claim, close, call))
            c.add_item(ui.ActionRow(manage))
            view = ui.LayoutView(timeout=None)
            view.add_item(c)
            return {"view": view}
        emb = discord.Embed(title=f"{emoji} {name}", description=welcome, color=accent, timestamp=datetime.now(timezone.utc))
        emb.set_thumbnail(url=owner.display_avatar.url)
        emb.add_field(name="​", value="\n".join(info), inline=False)
        if qa:
            emb.add_field(name=f"{E.ticket_questions} {T('answers')}", value=clip(qa, 1000), inline=False)
        if cfg.get("image_url"):
            emb.set_image(url=cfg["image_url"])
        view = ui.View(timeout=None)
        for it_ in (claim, close, call):
            view.add_item(it_)
        view.add_item(manage)
        return {"content": mention, "embed": emb, "view": view}

    async def refresh_control(self, channel: discord.TextChannel, row: dict, message: discord.Message | None = None):
        cfg = self.cfg(channel.guild.id, row.get("type_num")) or {}
        owner = channel.guild.get_member(row["user_id"])
        if owner is None:
            return
        message = message
        if message is None and row.get("control_msg_id"):
            try:
                message = await channel.fetch_message(row["control_msg_id"])
            except discord.HTTPException:
                return
        if message is None:
            return
        v2 = bool(getattr(message.flags, "components_v2", False))
        kw = self.render(channel.guild, row, cfg, owner, v2=v2)
        if "view" in kw and isinstance(kw["view"], ui.LayoutView):
            await message.edit(view=kw["view"])
        else:
            await message.edit(content=kw.get("content"), embed=kw["embed"], view=kw["view"])
        kw["view"].stop()

    # -------------------------------------------------- فتح تذكرة
    async def open_ticket(self, it: discord.Interaction, num: int):
        cfg = self.cfg(it.guild_id, num)
        if not cfg:
            return await it.response.send_message(self.T(it, "no_type"), ephemeral=True)
        key = (it.guild_id, it.user.id)
        wait = self._cool.get(key, 0) - time.monotonic()
        if wait > 0:
            return await it.response.send_message(self.T(it, "cooldown", s=int(wait) + 1), ephemeral=True)
        existing = [r for r in self.db.open_of(it.guild_id, it.user.id, num) if it.guild.get_channel(r["channel_id"])]
        if len(existing) >= int(cfg.get("max_open") or 1):
            return await it.response.send_message(self.T(it, "limit", channel=f"<#{existing[0]['channel_id']}>"), ephemeral=True)
        qs = questions_for(cfg, self.lang(it))
        if qs:
            return await it.response.send_modal(QuestionsModal(self, num, cfg, qs, self.lang(it)))
        await it.response.defer(ephemeral=True)
        await self.create(it, num, cfg, [])

    async def create(self, it: discord.Interaction, num: int, cfg: dict, answers: list):
        g, user = it.guild, it.user
        category = g.get_channel(cfg.get("category_id") or 0)
        if not isinstance(category, discord.CategoryChannel):
            return await it.followup.send(self.T(it, "no_cat"), ephemeral=True)
        me = g.me
        ow = {g.default_role: discord.PermissionOverwrite(view_channel=False),
              user: discord.PermissionOverwrite(view_channel=True, send_messages=True, read_message_history=True, attach_files=True, embed_links=True),
              me: discord.PermissionOverwrite(view_channel=True, send_messages=True, manage_channels=True, manage_messages=True, embed_links=True, attach_files=True)}
        for k in ("support_role_id", "ticket_mod_role_id"):
            role = g.get_role(cfg.get(k) or 0)
            if role:
                ow[role] = discord.PermissionOverwrite(view_channel=True, send_messages=True, read_message_history=True, attach_files=True, manage_messages=(k == "ticket_mod_role_id"))
        no = self.db.next_no(g.id)
        try:
            ch = await g.create_text_channel(name=f"ticket-{no:04d}-{slug(user.name)}-{num}"[:100], category=category, overwrites=ow,
                                             topic=f"ticket:{user.id}:{num}", reason=f"Ticket by {user}")
        except discord.Forbidden:
            return await it.followup.send(self.T(it, "no_perm_bot"), ephemeral=True)
        row = dict(channel_id=ch.id, user_id=user.id, category=cfg.get("preset") or "custom", guild_id=g.id, type_num=num, name=cfg.get("name"), ticket_no=no,
                   created_at=utcnow_iso(), status="open", priority="normal", answers=json.dumps(answers, ensure_ascii=False) if answers else None)
        self.db.insert(**row)
        kw = self.render(g, row, cfg, user)
        msg = await ch.send(**kw)
        kw["view"].stop()  # ما نبي نحتفظ بنسخة بالذاكرة؛ الـ persistent view يتولى الضغطات
        self.db.update(ch.id, control_msg_id=msg.id)
        try:
            await msg.pin()
        except discord.HTTPException:
            pass
        self._cool[(g.id, user.id)] = time.monotonic() + 20
        await it.followup.send(self.T(it, "created", channel=ch.mention), ephemeral=True)

    # -------------------------------------------------- إجراءات داخل التذكرة
    async def ctx(self, it: discord.Interaction, staff: bool = False, allow_owner: bool = False):
        """يرجع (row, cfg) أو None بعد الرد بالخطأ."""
        row = self.resolve(it.channel) if isinstance(it.channel, discord.TextChannel) else None
        if not row:
            await it.response.send_message(self.T(it, "no_ticket"), ephemeral=True)
            return None
        cfg = self.cfg(it.guild_id, row.get("type_num")) or {}
        msg = getattr(it, "message", None)
        if msg is not None and not row.get("control_msg_id") and msg.channel.id == it.channel.id and not msg.flags.ephemeral:
            self.db.update(it.channel.id, control_msg_id=msg.id)
            row["control_msg_id"] = msg.id
        ok_staff = self.is_staff(it.user, cfg)
        if staff and not ok_staff and not (allow_owner and it.user.id == row["user_id"]):
            await it.response.send_message(self.T(it, "owner_or_staff" if allow_owner else "staff_only"), ephemeral=True)
            return None
        return row, cfg

    async def do_claim(self, it: discord.Interaction):
        c = await self.ctx(it, staff=True)
        if not c:
            return
        row, cfg = c
        unclaim = row.get("claimed_by") == it.user.id
        if row.get("claimed_by") and not unclaim and not it.user.guild_permissions.administrator:
            other = it.guild.get_member(row["claimed_by"])
            return await it.response.send_message(self.T(it, "claimed_msg", user=other.mention if other else "?"), ephemeral=True)
        self.db.update(it.channel.id, claimed_by=None if unclaim else it.user.id)
        row["claimed_by"] = None if unclaim else it.user.id
        await it.response.send_message(embed=mk_embed(None, "warn" if unclaim else "success", None, f"{E.ticket_unclaim if unclaim else E.ticket_claim} " + self.T(it, "unclaimed_msg" if unclaim else "claimed_msg", user=it.user.mention)))
        await self.refresh_control(it.channel, row, None)

    async def do_call(self, it: discord.Interaction):
        c = await self.ctx(it)
        if not c:
            return
        row, cfg = c
        if it.user.id != row["user_id"] and not self.is_staff(it.user, cfg):
            return await it.response.send_message(self.T(it, "owner_or_staff"), ephemeral=True)
        mention = " ".join(f"<@&{cfg[k]}>" for k in ("support_role_id", "ticket_mod_role_id") if cfg.get(k)) or "@here"
        await it.response.send_message(f"{E.ticket_notify} " + self.T(it, "called", mention=mention))

    async def do_manage(self, it: discord.Interaction, choice: str):
        c = await self.ctx(it, staff=True)
        if not c:
            return
        row, cfg = c
        if choice == "rename":
            return await it.response.send_modal(RenameModal(self, it.channel))
        if choice == "ping":
            owner = it.guild.get_member(row["user_id"])
            return await it.response.send_message(self.T(it, "pinged", owner=owner.mention if owner else f"<@{row['user_id']}>"))
        if choice in ("add", "remove"):
            return await it.response.send_message(self.T(it, "pick_" + choice), view=MemberPick(self, it.channel, choice, self.lang(it), row["user_id"]), ephemeral=True)
        if choice == "priority":
            return await it.response.send_message(self.T(it, "prio_ph"), view=PriorityPick(self, it.channel, row, self.lang(it)), ephemeral=True)

    async def do_close(self, it: discord.Interaction, reason: str | None):
        row = self.resolve(it.channel)
        if not row:
            return await it.response.send_message(self.T(it, "no_ticket"), ephemeral=True)
        cfg = self.cfg(it.guild_id, row.get("type_num")) or {}
        if not (self.is_staff(it.user, cfg) or it.user.id == row["user_id"]):
            return await it.response.send_message(self.T(it, "owner_or_staff"), ephemeral=True)
        await it.response.send_message(f"{E.ticket_close} " + self.T(it, "closing"))
        ch, g = it.channel, it.guild
        self.db.update(ch.id, status="closed", closed_at=utcnow_iso(), closed_by=it.user.id, reason=reason)
        row.update(status="closed", closed_by=it.user.id, closed_at=utcnow_iso(), reason=reason)
        transcript, count = await build_transcript(ch, g)
        file = lambda: discord.File(io.BytesIO(transcript), filename=f"transcript-{row.get('ticket_no') or ch.id}.html")
        owner = g.get_member(row["user_id"])
        lang = self.lang(g)
        T = lambda k, **kw: i18n.tr(lang, "tk." + k, **kw)
        # لوق الإدارة
        log_ch = g.get_channel(cfg.get("log_channel_id") or 0)
        if log_ch:
            claimer = g.get_member(row["claimed_by"]) if row.get("claimed_by") else None
            opened = datetime.fromisoformat(row["created_at"]) if row.get("created_at") else None
            dur = str(datetime.now(timezone.utc) - opened).split(".")[0] if opened else "—"
            e = mk_embed(None, "ticket", f"{E.ticket_close} {T('log_t')} · #{row.get('ticket_no') or ''}")
            e.add_field(name=f"{E.ticket_user} {T('owner')}", value=owner.mention if owner else f"<@{row['user_id']}>", inline=True)
            e.add_field(name=f"{E.ticket_claim} {T('claimed')}", value=claimer.mention if claimer else T("unclaimed"), inline=True)
            e.add_field(name=f"{E.ticket} {T('type')}", value=cfg.get("name") or "—", inline=True)
            e.add_field(name=f"{E.ticket_close} {T('closed_by')}", value=it.user.mention, inline=True)
            e.add_field(name=f"{E.ticket_time} {T('duration')}", value=f"`{dur}`", inline=True)
            e.add_field(name=f"{E.message} {T('messages')}", value=f"`{count}`", inline=True)
            if reason:
                e.add_field(name=f"{E.ticket_note} {T('reason')}", value=clip(reason, 500), inline=False)
            if opened:
                e.add_field(name=T("opened"), value=discord.utils.format_dt(opened, "f"), inline=True)
            e.add_field(name=T("closed_at"), value=discord.utils.format_dt(discord.utils.utcnow(), "f"), inline=True)
            e.set_thumbnail(url=owner.display_avatar.url if owner else g.icon.url if g.icon else None)
            try:
                await log_ch.send(embed=e, file=file())
            except discord.HTTPException:
                pass
        # DM لصاحب التذكرة: تقييم + نسخة
        if owner and cfg.get("rating_channel_id"):
            try:
                e = mk_embed(None, "gold", f"{E.ticket_rating} {T('rate_t')}", T("rate_d", name=cfg.get("name") or "—"))
                m = await owner.send(embed=e, view=RatingView(self, lang), file=file())
                self.db.update(ch.id, rating_msg_id=m.id)
            except discord.HTTPException:
                pass
        await asyncio.sleep(5)
        try:
            await ch.delete(reason=f"Ticket closed by {it.user}")
        except discord.HTTPException:
            pass

    async def do_rating(self, it: discord.Interaction, stars: int):
        row = self.db.by_rating(it.message.id)
        if not row:
            return await it.response.send_message(self.T(it, "no_ticket"), ephemeral=True)
        if it.user.id != row["user_id"]:
            return await it.response.send_message(self.T(it, "rate_not_yours"), ephemeral=True)
        self.db.update(row["channel_id"], rating=stars)
        g = self.bot.get_guild(row["guild_id"])
        cfg = self.cfg(row["guild_id"], row.get("type_num")) or {}
        if g:
            ch = g.get_channel(cfg.get("rating_channel_id") or 0)
            if ch:
                lang = self.lang(g)
                T = lambda k, **kw: i18n.tr(lang, "tk." + k, **kw)
                claimer = g.get_member(row["claimed_by"]) if row.get("claimed_by") else None
                e = mk_embed(None, "gold", f"{E.ticket_rating} {T('rate_log_t')}")
                e.add_field(name=T("type"), value=cfg.get("name") or "—", inline=True)
                e.add_field(name=T("owner"), value=f"<@{row['user_id']}>", inline=True)
                e.add_field(name=T("claimed"), value=claimer.mention if claimer else T("unclaimed"), inline=True)
                e.add_field(name=T("rating"), value=f"{'⭐' * stars}{'✩' * (5 - stars)}  **{stars}/5** — {T('r' + str(stars))}", inline=False)
                try:
                    await ch.send(embed=e)
                except discord.HTTPException:
                    pass
        await it.response.edit_message(content=None, embed=mk_embed(None, "success", f"{E.success} " + i18n.tr(row["guild_id"], "tk.rate_t"), i18n.tr(row["guild_id"], "tk.rate_thanks")), view=None, attachments=[])

    # -------------------------------------------------- البانل
    def panel_view(self, guild, cfgs: dict, nums: list[str], display: str, title: str, desc: str, image: str | None):
        lang = self.lang(guild)
        T = lambda k, **kw: i18n.tr(lang, "tk." + k, **kw)
        def emo(n):
            p = PRESETS.get(cfgs[n].get("preset") or "", {})
            return E.pe(p.get("emoji", "ticket"))
        if display == "dropdown":
            sel = ui.Select(custom_id="persistent_panel_ticket_dropdown", placeholder=T("panel_ph"), options=[
                discord.SelectOption(label=str(cfgs[n].get("name"))[:100], value=n, emoji=emo(n), description=(PRESETS.get(cfgs[n].get("preset") or "", {}).get(lang) or None)) for n in nums])
            rows = [ui.ActionRow(sel)]
        else:
            btns = [ui.Button(label=str(cfgs[n].get("name"))[:80], custom_id=f"persistent_open_ticket_{n}", style=discord.ButtonStyle.primary if i % 2 == 0 else discord.ButtonStyle.secondary, emoji=emo(n)) for i, n in enumerate(nums)]
            rows = [ui.ActionRow(*btns[i:i + 5]) for i in range(0, len(btns), 5)]
        if CV2:
            c = ui.Container(accent_colour=discord.Colour(0x2F6BFF))
            if image:
                c.add_item(ui.MediaGallery(discord.MediaGalleryItem(image)))
            c.add_item(ui.TextDisplay(f"# {E.ticket} {title}\n{desc}"))
            c.add_item(ui.Separator(spacing=discord.SeparatorSpacing.large))
            for r in rows:
                c.add_item(r)
            v = ui.LayoutView(timeout=None)
            v.add_item(c)
            return {"view": v}
        emb = discord.Embed(title=f"{E.ticket} {title}", description=desc, color=0x2F6BFF)
        if image:
            emb.set_image(url=image)
        v = ui.View(timeout=None)
        for r in rows:
            for child in r.children:
                v.add_item(child)
        return {"embed": emb, "view": v}

    async def send_panel(self, guild, channel_id, title, desc, image, display_type, nums):
        """تستخدمها لوحة التحكم: ترسل بانل التذاكر في الروم."""
        ch = guild.get_channel(channel_id)
        if not ch or not hasattr(ch, "send"):
            raise ValueError("الروم غير موجود")
        cfgs = self.types(guild.id)
        nums = [str(n) for n in nums if str(n) in cfgs]
        if not nums:
            raise ValueError("التذاكر المحددة غير مسطّبة")
        kw = self.panel_view(guild, cfgs, nums, display_type, title, desc, image)
        msg = await ch.send(**kw)
        kw["view"].stop()
        return msg

    # -------------------------------------------------- أوامر السلاش
    tk = app_commands.Group(name="ticket", description="إدارة التذاكر", guild_only=True)

    @tk.command(name="setup", description="إعداد نوع تذكرة جديد (1 إلى 10)")
    @app_commands.describe(number="رقم التذكرة 1-10", name="اسم التذكرة", category="كاتيجوري التذاكر", support_role="رتبة الدعم", mod_role="رتبة مشرف التذاكر",
                           log_channel="روم اللوق", preset="قالب الأسئلة", welcome_msg="رسالة الترحيب", rating_channel="روم التقييم", image_url="رابط صورة (اختياري)")
    @app_commands.choices(preset=[app_commands.Choice(name=p["ar"], value=k) for k, p in PRESETS.items()])
    @app_commands.default_permissions(administrator=True)
    async def setup_cmd(self, it: discord.Interaction, number: int, name: str, category: discord.CategoryChannel, support_role: discord.Role, mod_role: discord.Role,
                        log_channel: discord.TextChannel, preset: app_commands.Choice[str] | None = None, welcome_msg: str | None = None,
                        rating_channel: discord.TextChannel | None = None, image_url: str | None = None):
        if not it.user.guild_permissions.administrator:
            return await it.response.send_message(i18n.tr(it, "c.no_perm"), ephemeral=True)
        if not 1 <= number <= 10:
            return await it.response.send_message(self.T(it, "bad_num"), ephemeral=True)
        data = store.get()
        data.setdefault(str(it.guild_id), {})[str(number)] = dict(
            name=name, category_id=category.id, support_role_id=support_role.id, ticket_mod_role_id=mod_role.id, welcome_msg=welcome_msg or None,
            log_channel_id=log_channel.id, rating_channel_id=rating_channel.id if rating_channel else None, image_url=image_url, preset=preset.value if preset else None)
        store.save(data)
        e = mk_embed(None, "success", f"{E.success} {self.T(it, 'group')}", self.T(it, "setup_ok", n=number, name=name))
        e.add_field(name=self.T(it, "preset"), value=(PRESETS[preset.value][self.lang(it)] if preset else "—"), inline=True)
        await it.response.send_message(embed=e, ephemeral=True)

    @tk.command(name="panel", description="إرسال بانل التذاكر في روم")
    @app_commands.default_permissions(administrator=True)
    async def panel_cmd(self, it: discord.Interaction):
        if not it.user.guild_permissions.administrator:
            return await it.response.send_message(i18n.tr(it, "c.no_perm"), ephemeral=True)
        cfgs = self.types(it.guild_id)
        if not cfgs:
            return await it.response.send_message(self.T(it, "panel_none"), ephemeral=True)
        await it.response.send_message(embed=mk_embed(None, "brand", f"{E.ticket_panel} {self.T(it, 'panel_t')}"), view=PanelStudio(self, it), ephemeral=True)

    @tk.command(name="close", description="إغلاق التذكرة الحالية")
    @app_commands.describe(reason="سبب الإغلاق")
    async def close_cmd(self, it: discord.Interaction, reason: str | None = None):
        await self.do_close(it, reason)

    @tk.command(name="claim", description="استلام التذكرة الحالية")
    async def claim_cmd(self, it: discord.Interaction):
        await self.do_claim(it)

    @tk.command(name="add", description="إضافة عضو للتذكرة")
    async def add_cmd(self, it: discord.Interaction, member: discord.Member):
        c = await self.ctx(it, staff=True)
        if c:
            await it.channel.set_permissions(member, view_channel=True, send_messages=True, read_message_history=True, attach_files=True)
            await it.response.send_message(self.T(it, "added", user=member.mention))

    @tk.command(name="remove", description="إزالة عضو من التذكرة")
    async def remove_cmd(self, it: discord.Interaction, member: discord.Member):
        c = await self.ctx(it, staff=True)
        if c:
            if member.id == c[0]["user_id"]:
                return await it.response.send_message(self.T(it, "cant_owner"), ephemeral=True)
            await it.channel.set_permissions(member, overwrite=None)
            await it.response.send_message(self.T(it, "removed", user=member.mention))

    @tk.command(name="rename", description="تغيير اسم التذكرة")
    async def rename_cmd(self, it: discord.Interaction, name: str):
        c = await self.ctx(it, staff=True)
        if c:
            await it.channel.edit(name=slug(name)[:90] or "ticket")
            await it.response.send_message(self.T(it, "renamed", name=name), ephemeral=True)

    @tk.command(name="priority", description="تغيير أولوية التذكرة")
    @app_commands.choices(level=[app_commands.Choice(name="عادية", value="normal"), app_commands.Choice(name="عالية", value="high"), app_commands.Choice(name="عاجلة", value="urgent")])
    async def priority_cmd(self, it: discord.Interaction, level: app_commands.Choice[str]):
        c = await self.ctx(it, staff=True)
        if c:
            await self.set_priority(it, c[0], level.value)

    async def set_priority(self, it, row, level):
        self.db.update(row["channel_id"], priority=level)
        row["priority"] = level
        await self.refresh_control(it.channel, row, None)
        if it.response.is_done():
            await it.followup.send(self.T(it, "prio_set", p=self.prio_label(it, level)), ephemeral=True)
        else:
            await it.response.send_message(self.T(it, "prio_set", p=self.prio_label(it, level)), ephemeral=True)

    @tk.command(name="transcript", description="إرسال نسخة المحادثة")
    async def transcript_cmd(self, it: discord.Interaction):
        c = await self.ctx(it, staff=True, allow_owner=True)
        if c:
            await it.response.defer(ephemeral=True)
            data, n = await build_transcript(it.channel, it.guild)
            await it.followup.send(self.T(it, "transcript_sent"), file=discord.File(io.BytesIO(data), filename=f"transcript-{c[0].get('ticket_no') or it.channel.id}.html"), ephemeral=True)

    @tk.command(name="info", description="معلومات التذكرة الحالية / إحصائيات السيرفر")
    async def info_cmd(self, it: discord.Interaction):
        row = self.resolve(it.channel) if isinstance(it.channel, discord.TextChannel) else None
        total, opened, avg = self.db.stats(it.guild_id)
        e = mk_embed(None, "ticket", f"{E.ticket} {self.T(it, 'info_t')}")
        if row:
            owner = it.guild.get_member(row["user_id"])
            e.add_field(name=self.T(it, "owner"), value=owner.mention if owner else "—", inline=True)
            e.add_field(name=self.T(it, "priority"), value=self.prio_label(it, row.get("priority") or "normal"), inline=True)
        e.add_field(name=f"{E.chart} #", value=f"`{total}` · `{opened}` open · ⭐ `{avg:.1f}`" if avg else f"`{total}` · `{opened}` open", inline=False)
        await it.response.send_message(embed=e, ephemeral=True)


# ====================================================================== واجهات المستخدم
def manage_select(lang: str) -> ui.Select:
    T = lambda k: i18n.tr(lang, "tk." + k)
    return ui.Select(custom_id="persistent_ticket_actions_select", placeholder=T("m_ph"), options=[
        discord.SelectOption(label=T("m_rename"), value="rename", emoji=E.pe("ticket_rename")),
        discord.SelectOption(label=T("m_ping"), value="ping", emoji=E.pe("ticket_notify")),
        discord.SelectOption(label=T("m_add"), value="add", emoji=E.pe("ticket_user_add")),
        discord.SelectOption(label=T("m_remove"), value="remove", emoji=E.pe("ticket_user_remove")),
        discord.SelectOption(label=T("m_priority"), value="priority", emoji=E.pe("ticket_priority"))])


class QuestionsModal(ui.Modal):
    def __init__(self, cog: Ticket, num: int, cfg: dict, qs: list[dict], lang: str):
        super().__init__(title=(cfg.get("name") or "Ticket")[:45], timeout=900)
        self.cog, self.num, self.cfg, self.qs = cog, num, cfg, qs
        self.inputs = []
        for q in qs:
            t = ui.TextInput(label=q["label"], placeholder=q["ph"] or None, required=q["required"], max_length=1000 if q["style"] == "p" else 200,
                             style=discord.TextStyle.paragraph if q["style"] == "p" else discord.TextStyle.short)
            self.inputs.append(t)
            self.add_item(t)

    async def on_submit(self, it: discord.Interaction):
        await it.response.defer(ephemeral=True)
        answers = [(q["label"], t.value.strip()) for q, t in zip(self.qs, self.inputs) if t.value.strip()]
        await self.cog.create(it, self.num, self.cfg, answers)


class RenameModal(ui.Modal):
    def __init__(self, cog: Ticket, channel):
        lang = i18n.lang_of(channel.guild)
        super().__init__(title=i18n.tr(lang, "tk.rename_t"))
        self.cog, self.channel = cog, channel
        self.n = ui.TextInput(label=i18n.tr(lang, "tk.rename_l"), max_length=90)
        self.add_item(self.n)

    async def on_submit(self, it: discord.Interaction):
        await self.channel.edit(name=slug(self.n.value)[:90] or "ticket")
        await it.response.send_message(self.cog.T(it, "renamed", name=self.n.value), ephemeral=True)


class CloseModal(ui.Modal):
    def __init__(self, cog: Ticket, lang: str):
        super().__init__(title=i18n.tr(lang, "tk.close_t"))
        self.cog = cog
        self.r = ui.TextInput(label=i18n.tr(lang, "tk.close_l"), required=False, max_length=300, style=discord.TextStyle.paragraph)
        self.add_item(self.r)

    async def on_submit(self, it: discord.Interaction):
        await self.cog.do_close(it, self.r.value.strip() or None)


class MemberPick(ui.View):
    def __init__(self, cog, channel, action, lang, owner_id):
        super().__init__(timeout=90)
        self.cog, self.channel, self.action, self.lang, self.owner_id = cog, channel, action, lang, owner_id
        s = ui.UserSelect(placeholder="…")
        s.callback = self.pick
        self.add_item(s)

    async def pick(self, it: discord.Interaction):
        member = it.guild.get_member(int(it.data["values"][0]))
        if not member:
            return await it.response.defer()
        if self.action == "add":
            await self.channel.set_permissions(member, view_channel=True, send_messages=True, read_message_history=True, attach_files=True)
            msg = i18n.tr(self.lang, "tk.added", user=member.mention)
        else:
            if member.id == self.owner_id:
                return await it.response.edit_message(content=i18n.tr(self.lang, "tk.cant_owner"), view=None)
            await self.channel.set_permissions(member, overwrite=None)
            msg = i18n.tr(self.lang, "tk.removed", user=member.mention)
        await it.response.edit_message(content=msg, view=None)
        self.stop()


class PriorityPick(ui.View):
    def __init__(self, cog, channel, row, lang):
        super().__init__(timeout=60)
        self.cog, self.channel, self.row = cog, channel, row
        s = ui.Select(placeholder=i18n.tr(lang, "tk.prio_ph"), options=[discord.SelectOption(label=i18n.tr(lang, "tk.p_" + p), value=p, emoji=E.pe("ticket_priority")) for p in PRIORITIES])
        s.callback = self.pick
        self.add_item(s)

    async def pick(self, it: discord.Interaction):
        await self.cog.set_priority(it, self.row, it.data["values"][0])
        self.stop()


class RatingView(ui.View):
    def __init__(self, cog, lang):
        super().__init__(timeout=None)
        self.add_item(rating_select(lang))


def rating_select(lang: str) -> ui.Select:
    return ui.Select(custom_id="persistent_rating_select", placeholder=i18n.tr(lang, "tk.rate_ph"), options=[
        discord.SelectOption(label=f"{'⭐' * n} {i18n.tr(lang, 'tk.r' + str(n))}", value=str(n), emoji=E.pe("ticket_rating")) for n in (5, 4, 3, 2, 1)])


# ---- Views مسجّلة دائماً (تستقبل الضغطات حتى بعد إعادة التشغيل)
class PanelPersistent(ui.View):
    def __init__(self, cog):
        super().__init__(timeout=None)
        self.cog = cog
        for n in range(1, 11):
            b = ui.Button(label=f"Ticket {n}", custom_id=f"persistent_open_ticket_{n}")
            b.callback = self._open(n)
            self.add_item(b)
        s = ui.Select(custom_id="persistent_panel_ticket_dropdown", options=[discord.SelectOption(label="…", value="1")])
        s.callback = self._select
        self.add_item(s)

    def _open(self, n):
        async def cb(it):
            await self.cog.open_ticket(it, n)
        return cb

    async def _select(self, it: discord.Interaction):
        await self.cog.open_ticket(it, int(it.data["values"][0]))


class ControlPersistent(ui.View):
    def __init__(self, cog):
        super().__init__(timeout=None)
        self.cog = cog
        for cid, cb, style in (("persistent_claim_ticket_btn", self._claim, discord.ButtonStyle.success), ("persistent_close_ticket_btn", self._close, discord.ButtonStyle.danger),
                               ("persistent_summon_support_btn", self._call, discord.ButtonStyle.primary)):
            b = ui.Button(custom_id=cid, style=style, label="…")
            b.callback = cb
            self.add_item(b)
        s = ui.Select(custom_id="persistent_ticket_actions_select", options=[discord.SelectOption(label="…", value="rename")])
        s.callback = self._manage
        self.add_item(s)

    async def _claim(self, it):
        await self.cog.do_claim(it)

    async def _close(self, it):
        await it.response.send_modal(CloseModal(self.cog, self.cog.lang(it)))

    async def _call(self, it):
        await self.cog.do_call(it)

    async def _manage(self, it):
        await self.cog.do_manage(it, it.data["values"][0])


class RatingPersistent(ui.View):
    def __init__(self, cog):
        super().__init__(timeout=None)
        self.cog = cog
        s = ui.Select(custom_id="persistent_rating_select", options=[discord.SelectOption(label="5", value="5")])
        s.callback = self._rate
        self.add_item(s)

    async def _rate(self, it):
        await self.cog.do_rating(it, int(it.data["values"][0]))


class PanelModal(ui.Modal):
    def __init__(self, studio: "PanelStudio"):
        lang = studio.lang
        super().__init__(title=i18n.tr(lang, "tk.panel_modal_t"))
        self.studio = studio
        self.t = ui.TextInput(label=i18n.tr(lang, "tk.panel_title"), max_length=100, default=studio.title)
        self.d = ui.TextInput(label=i18n.tr(lang, "tk.panel_desc"), style=discord.TextStyle.paragraph, max_length=1500, default=studio.desc)
        self.i = ui.TextInput(label=i18n.tr(lang, "tk.panel_image"), required=False, default=studio.image or "")
        for x in (self.t, self.d, self.i):
            self.add_item(x)

    async def on_submit(self, it: discord.Interaction):
        s = self.studio
        s.title, s.desc, s.image = self.t.value, self.d.value, self.i.value.strip() or None
        await it.response.edit_message(embed=s.preview(), view=s)


class PanelStudio(ui.View):
    def __init__(self, cog: Ticket, it: discord.Interaction):
        super().__init__(timeout=600)
        self.cog, self.owner, self.lang = cog, it.user.id, i18n.guild_lang(it.guild_id)
        self.channel_id = None
        self.display = "buttons"
        self.nums: list[str] = []
        self.title, self.desc, self.image = i18n.tr(self.lang, "tk.panel_default_t"), i18n.tr(self.lang, "tk.panel_default_d"), None
        T = lambda k: i18n.tr(self.lang, "tk." + k)
        cfgs = cog.types(it.guild_id)
        ch = ui.ChannelSelect(placeholder=T("panel_channel_ph"), channel_types=[discord.ChannelType.text], row=0)
        ch.callback = self._ch
        st = ui.Select(placeholder=T("panel_style_ph"), row=1, options=[discord.SelectOption(label=T("panel_buttons"), value="buttons", emoji=E.pe("ticket_panel")), discord.SelectOption(label=T("panel_dropdown"), value="dropdown", emoji=E.pe("list"))])
        st.callback = self._style
        items = ui.Select(placeholder=T("panel_items_ph"), row=2, min_values=1, max_values=len(cfgs), options=[discord.SelectOption(label=f"{n}: {c.get('name')}"[:100], value=n, emoji=E.pe("ticket")) for n, c in sorted(cfgs.items(), key=lambda x: int(x[0]))])
        items.callback = self._items
        edit = ui.Button(label=T("panel_edit"), emoji=E.pe("message"), row=3)
        edit.callback = self._edit
        send = ui.Button(label=T("panel_send"), emoji=E.pe("success"), style=discord.ButtonStyle.success, row=3)
        send.callback = self._send
        for x in (ch, st, items, edit, send):
            self.add_item(x)

    def preview(self):
        return mk_embed(None, "brand", f"{E.ticket} {self.title}", self.desc)

    async def interaction_check(self, it):
        return it.user.id == self.owner

    async def _ch(self, it):
        self.channel_id = int(it.data["values"][0])
        await it.response.defer()

    async def _style(self, it):
        self.display = it.data["values"][0]
        await it.response.defer()

    async def _items(self, it):
        self.nums = it.data["values"]
        await it.response.defer()

    async def _edit(self, it):
        await it.response.send_modal(PanelModal(self))

    async def _send(self, it):
        if not self.channel_id or not self.nums:
            return await it.response.send_message(i18n.tr(self.lang, "tk.panel_need"), ephemeral=True)
        await it.response.defer(ephemeral=True)
        try:
            await self.cog.send_panel(it.guild, self.channel_id, self.title, self.desc, self.image, self.display, self.nums)
        except Exception as e:
            return await it.followup.send(f"❌ {e}", ephemeral=True)
        self.stop()
        await it.edit_original_response(embed=mk_embed(None, "success", None, i18n.tr(self.lang, "tk.panel_sent", channel=f"<#{self.channel_id}>")), view=None)


# ====================================================================== نسخة المحادثة (HTML خفيفة)
CSS = ("body{margin:0;background:#1e1f22;color:#dbdee1;font:15px/1.5 system-ui,'Segoe UI',Tahoma,sans-serif}header{padding:20px 28px;background:#2b2d31;border-bottom:1px solid #111}"
       "h1{margin:0;font-size:20px;color:#fff}small{color:#949ba4}.m{display:flex;gap:14px;padding:8px 28px}.m:hover{background:#2e3035}"
       ".a{width:40px;height:40px;border-radius:50%;flex:none;background:#5865f2}.n{font-weight:600;color:#fff}.b{background:#5865f2;color:#fff;border-radius:4px;padding:0 5px;font-size:11px;margin-inline-start:4px}"
       ".t{color:#949ba4;font-size:12px;margin-inline-start:8px}.c{white-space:pre-wrap;word-break:break-word}.e{border-inline-start:4px solid #5865f2;background:#2b2d31;border-radius:4px;padding:8px 12px;margin-top:4px;max-width:520px}"
       ".f a{color:#00a8fc}")


async def build_transcript(channel: discord.TextChannel, guild: discord.Guild, limit: int = 2500) -> tuple[bytes, int]:
    out = io.StringIO()
    out.write(f"<!doctype html><meta charset='utf-8'><title>{html.escape(channel.name)}</title><style>{CSS}</style>")
    out.write(f"<header><h1>#{html.escape(channel.name)}</h1><small>{html.escape(guild.name)} · {discord.utils.utcnow():%Y-%m-%d %H:%M} UTC</small></header>")
    n = 0
    try:
        async for m in channel.history(limit=limit, oldest_first=True):
            n += 1
            av = html.escape(m.author.display_avatar.replace(size=64).url)
            body = html.escape(m.content or "")
            extra = ""
            for e in m.embeds:
                extra += f"<div class='e'><b>{html.escape(e.title or '')}</b><div>{html.escape(e.description or '')}</div></div>"
            for a in m.attachments:
                extra += f"<div class='f'><a href='{html.escape(a.url)}'>📎 {html.escape(a.filename)}</a></div>"
            if getattr(m, "components", None) and not m.content and not m.embeds:
                extra += "<div class='c'><small>[components]</small></div>"
            out.write(f"<div class='m'><img class='a' src='{av}' width='40' height='40'><div><span class='n'>{html.escape(m.author.display_name)}</span>"
                      f"{'<span class=b>BOT</span>' if m.author.bot else ''}<span class='t'>{m.created_at:%Y-%m-%d %H:%M}</span><div class='c'>{body}</div>{extra}</div></div>")
            if out.tell() > 1_800_000:
                out.write("<p style='padding:16px 28px'><small>… truncated</small></p>")
                break
    except discord.HTTPException:
        pass
    return out.getvalue().encode("utf-8"), n


async def setup(bot):
    await bot.add_cog(Ticket(bot))
