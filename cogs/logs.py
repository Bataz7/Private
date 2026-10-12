"""اللوقات الاحترافية | Professional server logs.

- الأوامر: /اللوقات تحديد · /اللوقات الكل · /اللوقات ايقاف · /اللوقات الحالة · /اللوقات تجربة
- يعتمد على حدث audit-log الواحد بدل استدعاء سجل التدقيق مع كل حدث → أخف على المعالج والـ API.
- لا يخزّن شيئاً في الذاكرة غير كاش إعدادات صغير مدته 30 ثانية.
- إعدادات الرومات في logs_settings.db (نفس القاعدة التي تعدّلها لوحة التحكم).
"""
import sqlite3
from datetime import datetime, timezone

import discord
from discord import app_commands
from discord.ext import commands

from core import i18n
from core.brand import clip, embed as mk_embed
from core.store import TTL
from core.strings import S, add
from emojis import E

TYPES = {  # نوع اللوق: (إيموجي، ثابت داخلي)
    "members_join_remove": "log_join", "member_bans": "log_ban", "member_kick": "log_kick", "member_timeout": "log_timeout",
    "member_roles": "log_role", "nicknames": "log_msg_edit", "messages": "log_msg_delete", "reactions": "log_reaction",
    "voice": "log_voice", "channels_crud": "log_channel_create", "channels_update": "log_channel_edit",
    "roles_crud": "log_role_create", "roles_update": "log_role", "invites": "log_invite", "server_updates": "log_server",
}

add("logs", {
    # ---- الأوامر ----
    "group": ("إدارة لوقات السيرفر", "Manage the server logs"),
    "set_d": ("تحديد روم لنوع معيّن من اللوقات", "Choose the channel for one type of log"),
    "all_d": ("تحديد روم واحد لكل أنواع اللوقات", "Send every log type to one channel"),
    "off_d": ("إيقاف نوع من اللوقات أو كلها", "Turn off one log type or all of them"),
    "status_d": ("عرض حالة كل اللوقات والرومات المرتبطة", "Show every log type and its channel"),
    "test_d": ("إرسال رسالة تجريبية لكل روم لوق", "Send a test message to every log channel"),
    "p_type": ("نوع اللوق", "Log type"), "p_channel": ("روم اللوق", "Log channel"),
    "p_type_off": ("نوع اللوق (اتركه فاضي لإيقاف الكل)", "Log type (leave empty to turn all off)"),
    "set_ok": ("تم ربط **{type}** بالروم {channel}.", "**{type}** is now sent to {channel}."),
    "all_ok": ("تم ربط **كل اللوقات ({n})** بالروم {channel}.", "**All {n} log types** are now sent to {channel}."),
    "off_ok": ("تم إيقاف **{type}**.", "**{type}** is turned off."),
    "off_all": ("تم إيقاف كل اللوقات.", "All logs are turned off."),
    "need_perm": ("البوت يحتاج صلاحية **إرسال الرسائل + إرفاق الروابط** في {channel}.", "I need **Send Messages + Embed Links** in {channel}."),
    "audit_warn": ("⚠️ البوت ما عنده صلاحية **عرض سجل التدقيق** — لن تظهر أسماء المشرفين في اللوقات.", "⚠️ I don't have **View Audit Log** — moderator names won't appear in logs."),
    "status_t": ("حالة اللوقات", "Log status"),
    "status_d2": ("{on} من {total} مفعّلة", "{on} of {total} enabled"),
    "test_t": ("اختبار اللوقات", "Log test"), "test_d2": ("هذه رسالة تجريبية للوق **{type}** ✅", "This is a test for the **{type}** log ✅"),
    "test_n": ("تم إرسال {n} رسالة تجريبية.", "Sent {n} test messages."), "test_none": ("ما فيه لوقات مفعّلة. استخدم `/اللوقات تحديد` أولاً.", "No logs are enabled. Use `/logs set` first."),
    "off_label": ("غير مفعّل", "Not set"),
    # ---- أسماء الأنواع ----
    "t_members_join_remove": ("دخول وخروج الأعضاء", "Members joining & leaving"), "t_member_bans": ("الباند وفك الباند", "Bans & unbans"),
    "t_member_kick": ("طرد الأعضاء", "Member kicks"), "t_member_timeout": ("التايم أوت", "Timeouts"), "t_member_roles": ("إعطاء وسحب الرتب", "Roles given & removed"),
    "t_nicknames": ("تغيير الأسماء المستعارة", "Nickname changes"), "t_messages": ("حذف وتعديل الرسائل", "Message deletes & edits"), "t_reactions": ("التفاعلات", "Reactions"),
    "t_voice": ("القنوات الصوتية", "Voice channels"), "t_channels_crud": ("إنشاء وحذف الرومات", "Channels created & deleted"), "t_channels_update": ("تعديل الرومات", "Channel edits"),
    "t_roles_crud": ("إنشاء وحذف الرتب", "Roles created & deleted"), "t_roles_update": ("تعديل الرتب", "Role edits"), "t_invites": ("الدعوات", "Invites"),
    "t_server_updates": ("إعدادات السيرفر", "Server settings"),
    # ---- عناوين الأحداث ----
    "join": ("عضو جديد", "Member joined"), "leave": ("غادر عضو", "Member left"), "ban": ("تم حظر عضو", "Member banned"), "unban": ("تم فك الحظر", "Member unbanned"),
    "kick": ("تم طرد عضو", "Member kicked"), "to_on": ("تايم أوت لعضو", "Member timed out"), "to_off": ("إزالة التايم أوت", "Timeout removed"),
    "role_add": ("إضافة رتبة لعضو", "Role added to member"), "role_remove": ("سحب رتبة من عضو", "Role removed from member"), "nick": ("تغيير اسم مستعار", "Nickname changed"),
    "msg_delete": ("حذف رسالة", "Message deleted"), "msg_edit": ("تعديل رسالة", "Message edited"), "bulk": ("حذف جماعي للرسائل", "Bulk message delete"),
    "react": ("تفاعل جديد", "Reaction added"), "v_join": ("دخول روم صوتي", "Joined voice"), "v_leave": ("خروج من روم صوتي", "Left voice"), "v_move": ("انتقال بين الرومات الصوتية", "Moved voice channel"),
    "v_mute": ("كتم/فك كتم من الإدارة", "Server mute changed"), "v_deaf": ("صمم/فك صمم من الإدارة", "Server deafen changed"),
    "ch_new": ("إنشاء روم", "Channel created"), "ch_del": ("حذف روم", "Channel deleted"), "ch_upd": ("تعديل روم", "Channel updated"),
    "ro_new": ("إنشاء رتبة", "Role created"), "ro_del": ("حذف رتبة", "Role deleted"), "ro_upd": ("تعديل رتبة", "Role updated"),
    "inv_new": ("إنشاء دعوة", "Invite created"), "inv_del": ("حذف دعوة", "Invite deleted"), "guild_upd": ("تعديل إعدادات السيرفر", "Server updated"),
    "emoji_new": ("إيموجي جديد", "Emoji added"), "emoji_del": ("حذف إيموجي", "Emoji removed"), "emoji_upd": ("تعديل إيموجي", "Emoji updated"),
    "bot_add": ("إضافة بوت", "Bot added"), "webhook": ("تغيير في الويب هوك", "Webhook changed"),
    # ---- الحقول ----
    "f_member": ("العضو", "Member"), "f_by": ("بواسطة", "By"), "f_reason": ("السبب", "Reason"), "f_id": ("الآيدي", "ID"),
    "f_created": ("إنشاء الحساب", "Account created"), "f_joined": ("انضم", "Joined"), "f_count": ("عدد الأعضاء", "Members"),
    "f_roles": ("الرتب", "Roles"), "f_new_acc": ("⚠️ حساب جديد (أقل من 7 أيام)", "⚠️ New account (under 7 days)"),
    "f_until": ("ينتهي", "Ends"), "f_role": ("الرتبة", "Role"), "f_content": ("المحتوى", "Content"), "f_before": ("قبل", "Before"), "f_after": ("بعد", "After"),
    "f_author": ("الكاتب", "Author"), "f_channel": ("الروم", "Channel"), "f_attach": ("المرفقات", "Attachments"), "f_msg_sent": ("أُرسلت", "Sent"),
    "f_nocache": ("*الرسالة قديمة وغير محفوظة في الذاكرة*", "*Message wasn't cached (too old)*"), "f_empty": ("*بدون نص*", "*No text*"),
    "f_count_msgs": ("عدد الرسائل", "Messages"), "f_emoji": ("التفاعل", "Reaction"), "f_msg": ("الرسالة", "Message"), "f_jump": ("اذهب للرسالة", "Jump to message"),
    "f_name": ("الاسم", "Name"), "f_type": ("النوع", "Type"), "f_changes": ("التغييرات", "Changes"), "f_added": ("أُضيفت", "Added"), "f_removed": ("أُزيلت", "Removed"),
    "f_code": ("الكود", "Code"), "f_inviter": ("صاحب الدعوة", "Inviter"), "f_uses": ("الاستخدامات", "Max uses"), "f_age": ("المدة", "Duration"), "f_unlimited": ("غير محدود", "Unlimited"),
    "f_link": ("رابط", "link"), "f_hours": ("ساعة", "h"),
    "wh_create": ("إنشاء ويب هوك", "Webhook created"), "wh_delete": ("حذف ويب هوك", "Webhook deleted"), "wh_update": ("تعديل ويب هوك", "Webhook updated"),
    "f_from": ("من", "From"), "f_to": ("إلى", "To"), "f_perms": ("الصلاحيات", "Permissions"), "f_unknown": ("غير معروف", "Unknown"), "f_none": ("—", "—"),
})

add("logs_attr", {
    "name": ("الاسم", "Name"), "nick": ("الاسم المستعار", "Nickname"), "topic": ("الوصف", "Topic"), "color": ("اللون", "Color"), "colour": ("اللون", "Color"),
    "hoist": ("عرض منفصل", "Display separately"), "mentionable": ("قابلة للمنشن", "Mentionable"), "slowmode_delay": ("الوضع البطيء (ث)", "Slowmode (s)"),
    "nsfw": ("+18", "NSFW"), "bitrate": ("جودة الصوت", "Bitrate"), "user_limit": ("حد الأعضاء", "User limit"), "verification_level": ("مستوى التحقق", "Verification level"),
    "icon": ("الصورة", "Icon"), "banner": ("البانر", "Banner"), "afk_timeout": ("مهلة AFK", "AFK timeout"), "afk_channel": ("روم AFK", "AFK channel"),
    "system_channel": ("روم النظام", "System channel"), "rules_channel": ("روم القوانين", "Rules channel"), "vanity_url_code": ("الرابط المخصص", "Vanity URL"),
    "default_notifications": ("الإشعارات الافتراضية", "Default notifications"), "explicit_content_filter": ("فلتر المحتوى", "Content filter"),
    "mfa_level": ("التحقق بخطوتين", "2FA level"), "preferred_locale": ("لغة السيرفر", "Server language"), "owner": ("المالك", "Owner"),
    "permissions": ("الصلاحيات", "Permissions"), "position": ("الترتيب", "Position"), "type": ("النوع", "Type"), "category": ("الكاتيجوري", "Category"),
})

AUDIT_FLAGS = ("id", "type", "overwrites", "roles", "$add", "$remove", "permissions_new", "available_tags")


def pretty_perms(p: discord.Permissions | None) -> str:
    return ", ".join(sorted(n.replace("_", " ") for n, v in p if v)) if p else ""


class LogsCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.db = sqlite3.connect("logs_settings.db", check_same_thread=False)
        self.db.execute("CREATE TABLE IF NOT EXISTS server_logs (guild_id INTEGER, log_type TEXT, channel_id INTEGER, PRIMARY KEY (guild_id, log_type))")
        self.db.commit()
        self.cache = TTL(30)

    def cog_unload(self):
        self.db.close()

    # ------------------------------------------------------------------ الإعدادات
    def cfg(self, guild_id: int) -> dict[str, int]:
        c = self.cache.get(guild_id)
        if c is None:
            c = {t: ch for t, ch in self.db.execute("SELECT log_type, channel_id FROM server_logs WHERE guild_id=?", (guild_id,)) if ch}
            self.cache.set(guild_id, c)
        return c

    def _save(self, guild_id: int, log_type: str, channel_id: int | None):
        if channel_id:
            self.db.execute("INSERT INTO server_logs(guild_id, log_type, channel_id) VALUES(?,?,?) ON CONFLICT(guild_id, log_type) DO UPDATE SET channel_id=excluded.channel_id", (guild_id, log_type, channel_id))
        else:
            self.db.execute("DELETE FROM server_logs WHERE guild_id=? AND log_type=?", (guild_id, log_type))
        self.cache.pop(guild_id)

    def lg(self, guild) -> str:
        return i18n.guild_lang(guild.id)

    def t(self, guild, key, **v):
        return i18n.tr(self.lg(guild), "logs." + key, **v)

    async def send(self, guild: discord.Guild, log_type: str, emb: discord.Embed, view: discord.ui.View | None = None):
        cid = self.cfg(guild.id).get(log_type)
        if not cid:
            return
        ch = guild.get_channel(cid)
        if ch is None:
            return
        kw = {"view": view} if view else {}
        try:
            await ch.send(embed=emb, allowed_mentions=discord.AllowedMentions.none(), **kw)
        except (discord.Forbidden, discord.HTTPException):
            pass

    # ------------------------------------------------------------------ أدوات العرض
    def head(self, guild, kind: str, emoji_key: str, title_key: str, *, actor=None, target=None) -> discord.Embed:
        e = mk_embed(None, kind, f"{getattr(E, emoji_key)} {self.t(guild, title_key)}")
        who = actor or target
        if who is not None and hasattr(who, "display_avatar"):
            e.set_author(name=str(who), icon_url=who.display_avatar.url)
        return e

    def fmt(self, guild, v) -> str:
        if v is None:
            return "—"
        if isinstance(v, bool):
            return "✅" if v else "❌"
        if isinstance(v, (discord.Role, discord.abc.GuildChannel)):
            return v.mention
        if isinstance(v, discord.Object):
            return f"`{v.id}`"
        if isinstance(v, discord.Colour):
            return f"`#{v.value:06X}`"
        if isinstance(v, discord.Asset):
            return f"[{self.t(guild, 'f_link')}]({v.url})"
        if isinstance(v, discord.Permissions):
            return f"`{v.value}`"
        if hasattr(v, "name") and not isinstance(v, str):
            return f"`{v.name}`"
        if isinstance(v, datetime):
            return discord.utils.format_dt(v, "R")
        return clip(f"`{v}`" if not isinstance(v, str) or len(v) < 60 else v, 200)

    def diff_lines(self, guild, entry: discord.AuditLogEntry) -> list[str]:
        lines = []
        before = {k: v for k, v in entry.before}
        after = {k: v for k, v in entry.after}
        for k in dict.fromkeys([*after.keys(), *before.keys()]):
            if k in AUDIT_FLAGS:
                continue
            b, a = before.get(k), after.get(k)
            if k == "permissions" and isinstance(a, discord.Permissions) and isinstance(b, discord.Permissions):
                on = [n for n, v in a if v and not getattr(b, n)]
                off = [n for n, v in b if v and not getattr(a, n)]
                if on:
                    lines.append(f"{E.on} **{self.t(guild, 'f_added')}:** " + ", ".join(f"`{n.replace('_', ' ')}`" for n in on))
                if off:
                    lines.append(f"{E.off} **{self.t(guild, 'f_removed')}:** " + ", ".join(f"`{n.replace('_', ' ')}`" for n in off))
                continue
            label = i18n.tr(self.lg(guild), "logs_attr." + k) if ("logs_attr." + k) in S else k.replace("_", " ")
            lines.append(f"**{label}:** {self.fmt(guild, b)} ➜ {self.fmt(guild, a)}")
        return lines

    def user_ref(self, u) -> str:
        return f"{u.mention} (`{u}`)" if hasattr(u, "mention") and hasattr(u, "name") else (f"<@{u.id}>" if getattr(u, "id", None) else "—")

    def mod_line(self, guild, entry) -> str:
        return f"{E.admin} **{self.t(guild, 'f_by')}:** {self.user_ref(entry.user)}" if entry.user else ""

    # ------------------------------------------------------------------ أحداث سجل التدقيق (الأساس)
    @commands.Cog.listener()
    async def on_audit_log_entry_create(self, entry: discord.AuditLogEntry):
        guild = entry.guild
        if not self.cfg(guild.id):
            return
        A = discord.AuditLogAction
        a = entry.action
        t = self.t
        target = entry.target
        tid = getattr(target, "id", None)

        if a in (A.ban, A.unban, A.kick):
            kind, em, key, typ = {A.ban: ("ban", "log_ban", "ban", "member_bans"), A.unban: ("unban", "log_unban", "unban", "member_bans"), A.kick: ("kick", "log_kick", "kick", "member_kick")}[a]
            user = target if hasattr(target, "display_avatar") else self.bot.get_user(tid) or target
            e = self.head(guild, kind, em, key, target=user if hasattr(user, "display_avatar") else None)
            e.description = f"{E.users} **{t(guild, 'f_member')}:** {self.user_ref(user)}\n{self.mod_line(guild, entry)}\n{E.ticket_note} **{t(guild, 'f_reason')}:** {entry.reason or t(guild, 'f_none')}"
            e.set_footer(text=f"{t(guild, 'f_id')}: {tid}")
            return await self.send(guild, typ, e)

        if a == A.member_update:
            changed = {k: v for k, v in entry.after}
            if "timed_out_until" in changed:
                until = changed["timed_out_until"]
                on = until is not None
                e = self.head(guild, "timeout" if on else "success", "log_timeout" if on else "log_untimeout", "to_on" if on else "to_off", target=target if hasattr(target, "display_avatar") else None)
                e.description = f"{E.users} **{t(guild, 'f_member')}:** {self.user_ref(target)}\n{self.mod_line(guild, entry)}"
                if on:
                    e.description += f"\n{E.log_timeout} **{t(guild, 'f_until')}:** {discord.utils.format_dt(until, 'f')} ({discord.utils.format_dt(until, 'R')})"
                e.description += f"\n{E.ticket_note} **{t(guild, 'f_reason')}:** {entry.reason or t(guild, 'f_none')}"
                return await self.send(guild, "member_timeout", e)
            return

        if a == A.member_role_update:
            for roles, key, kind, em in ((entry.after.roles if hasattr(entry.after, "roles") else [], "role_add", "success", "log_role_add"), (entry.before.roles if hasattr(entry.before, "roles") else [], "role_remove", "error", "log_role_remove")):
                for r in roles or []:
                    e = self.head(guild, "role" if key == "role_add" else "delete", em, key, target=target if hasattr(target, "display_avatar") else None)
                    rm = r.mention if hasattr(r, "mention") else f"`{r.id}`"
                    e.description = f"{E.users} **{t(guild, 'f_member')}:** {self.user_ref(target)}\n{E.log_role} **{t(guild, 'f_role')}:** {rm}\n{self.mod_line(guild, entry)}"
                    await self.send(guild, "member_roles", e)
            return

        if a in (A.channel_create, A.channel_delete, A.channel_update):
            key, em, kind, typ = {A.channel_create: ("ch_new", "log_channel_create", "channel", "channels_crud"), A.channel_delete: ("ch_del", "log_channel_delete", "delete", "channels_crud"), A.channel_update: ("ch_upd", "log_channel_edit", "edit", "channels_update")}[a]
            e = self.head(guild, kind, em, key, actor=entry.user)
            name = getattr(target, "name", None) or getattr(entry.before, "name", None) or getattr(entry.after, "name", None) or str(tid)
            ref = target.mention if isinstance(target, discord.abc.GuildChannel) else f"`#{name}`"
            e.description = f"{E.folder} **{t(guild, 'f_channel')}:** {ref}\n{self.mod_line(guild, entry)}"
            if a == A.channel_update:
                lines = self.diff_lines(guild, entry)
                if not lines:
                    return
                e.add_field(name=t(guild, "f_changes"), value=clip("\n".join(lines), 1000), inline=False)
            e.set_footer(text=f"{t(guild, 'f_id')}: {tid}")
            return await self.send(guild, typ, e)

        if a in (A.role_create, A.role_delete, A.role_update):
            key, em, kind, typ = {A.role_create: ("ro_new", "log_role_create", "role", "roles_crud"), A.role_delete: ("ro_del", "log_role_delete", "delete", "roles_crud"), A.role_update: ("ro_upd", "log_role", "role", "roles_update")}[a]
            e = self.head(guild, kind, em, key, actor=entry.user)
            name = getattr(entry.before, "name", None) or getattr(entry.after, "name", None) or getattr(target, "name", None) or str(tid)
            ref = target.mention if isinstance(target, discord.Role) else f"`{name}`"
            e.description = f"{E.log_role} **{t(guild, 'f_role')}:** {ref}\n{self.mod_line(guild, entry)}"
            if a == A.role_update:
                lines = self.diff_lines(guild, entry)
                if not lines:
                    return
                e.add_field(name=t(guild, "f_changes"), value=clip("\n".join(lines), 1000), inline=False)
            e.set_footer(text=f"{t(guild, 'f_id')}: {tid}")
            return await self.send(guild, typ, e)

        if a == A.guild_update:
            lines = self.diff_lines(guild, entry)
            if not lines:
                return
            e = self.head(guild, "server", "log_server", "guild_upd", actor=entry.user)
            e.description = self.mod_line(guild, entry)
            e.add_field(name=t(guild, "f_changes"), value=clip("\n".join(lines), 1000), inline=False)
            if guild.icon:
                e.set_thumbnail(url=guild.icon.url)
            return await self.send(guild, "server_updates", e)

        if a in (A.emoji_create, A.emoji_delete, A.emoji_update):
            key = {A.emoji_create: "emoji_new", A.emoji_delete: "emoji_del", A.emoji_update: "emoji_upd"}[a]
            e = self.head(guild, "server", "log_server", key, actor=entry.user)
            name = getattr(entry.after, "name", None) or getattr(entry.before, "name", None) or str(tid)
            e.description = f"{E.log_reaction} **{t(guild, 'f_name')}:** `{name}`\n{self.mod_line(guild, entry)}"
            return await self.send(guild, "server_updates", e)

        if a == A.bot_add:
            e = self.head(guild, "warn", "log_bot", "bot_add", actor=entry.user)
            e.description = f"{E.log_bot} **{t(guild, 'f_name')}:** {self.user_ref(target)}\n{self.mod_line(guild, entry)}"
            return await self.send(guild, "server_updates", e)

        if a in (A.webhook_create, A.webhook_delete, A.webhook_update):
            e = self.head(guild, "server", "log_server", "webhook", actor=entry.user)
            e.description = f"**{t(guild, {A.webhook_create: 'wh_create', A.webhook_delete: 'wh_delete'}.get(a, 'wh_update'))}**\n{self.mod_line(guild, entry)}"
            return await self.send(guild, "server_updates", e)

    # ------------------------------------------------------------------ دخول وخروج (بدون سجل تدقيق)
    @commands.Cog.listener()
    async def on_member_join(self, member: discord.Member):
        if "members_join_remove" not in self.cfg(member.guild.id):
            return
        g, t = member.guild, self.t
        age_days = (datetime.now(timezone.utc) - member.created_at).days
        e = self.head(g, "join", "log_join", "join", actor=member)
        e.description = (f"{E.users} **{t(g, 'f_member')}:** {member.mention} (`{member}`)\n"
                         f"{E.calendar} **{t(g, 'f_created')}:** {discord.utils.format_dt(member.created_at, 'D')} ({discord.utils.format_dt(member.created_at, 'R')})\n"
                         f"{E.users} **{t(g, 'f_count')}:** `{g.member_count}`")
        if age_days < 7:
            e.add_field(name="​", value=t(g, "f_new_acc"), inline=False)
        e.set_thumbnail(url=member.display_avatar.url)
        e.set_footer(text=f"{t(g, 'f_id')}: {member.id}")
        await self.send(g, "members_join_remove", e)

    @commands.Cog.listener()
    async def on_member_remove(self, member: discord.Member):
        if "members_join_remove" not in self.cfg(member.guild.id):
            return
        g, t = member.guild, self.t
        e = self.head(g, "leave", "log_leave", "leave", actor=member)
        e.description = f"{E.users} **{t(g, 'f_member')}:** {member.mention} (`{member}`)\n{E.users} **{t(g, 'f_count')}:** `{g.member_count}`"
        if member.joined_at:
            e.description += f"\n**{t(g, 'f_joined')}:** {discord.utils.format_dt(member.joined_at, 'R')}"
        roles = [r.mention for r in member.roles[1:]][:15]
        if roles:
            e.add_field(name=t(g, "f_roles"), value=" ".join(roles), inline=False)
        e.set_thumbnail(url=member.display_avatar.url)
        e.set_footer(text=f"{t(g, 'f_id')}: {member.id}")
        await self.send(g, "members_join_remove", e)

    # بدائل عند غياب صلاحية سجل التدقيق
    @commands.Cog.listener()
    async def on_member_ban(self, guild, user):
        if not guild.me.guild_permissions.view_audit_log:
            e = self.head(guild, "ban", "log_ban", "ban", target=user)
            e.description = f"{E.users} **{self.t(guild, 'f_member')}:** {self.user_ref(user)}"
            await self.send(guild, "member_bans", e)

    @commands.Cog.listener()
    async def on_member_unban(self, guild, user):
        if not guild.me.guild_permissions.view_audit_log:
            e = self.head(guild, "unban", "log_unban", "unban", target=user)
            e.description = f"{E.users} **{self.t(guild, 'f_member')}:** {self.user_ref(user)}"
            await self.send(guild, "member_bans", e)

    @commands.Cog.listener()
    async def on_member_update(self, before: discord.Member, after: discord.Member):
        if before.nick == after.nick or "nicknames" not in self.cfg(after.guild.id):
            return
        g, t = after.guild, self.t
        e = self.head(g, "edit", "log_msg_edit", "nick", actor=after)
        e.description = f"{E.users} **{t(g, 'f_member')}:** {after.mention}\n**{t(g, 'f_before')}:** {clip(before.nick or before.name, 100)}\n**{t(g, 'f_after')}:** {clip(after.nick or after.name, 100)}"
        e.set_footer(text=f"{t(g, 'f_id')}: {after.id}")
        await self.send(g, "nicknames", e)

    # ------------------------------------------------------------------ الرسائل
    @commands.Cog.listener()
    async def on_raw_message_delete(self, p: discord.RawMessageDeleteEvent):
        if not p.guild_id:
            return
        g = self.bot.get_guild(p.guild_id)
        if not g or "messages" not in self.cfg(g.id):
            return
        m = p.cached_message
        if m and (m.author.bot or m.webhook_id):
            return
        t = self.t
        e = self.head(g, "delete", "log_msg_delete", "msg_delete", actor=m.author if m else None)
        ch = g.get_channel(p.channel_id)
        e.description = f"{E.users} **{t(g, 'f_author')}:** {m.author.mention if m else t(g, 'f_unknown')}\n{E.message} **{t(g, 'f_channel')}:** {ch.mention if ch else f'`{p.channel_id}`'}"
        if m:
            e.add_field(name=t(g, "f_content"), value=clip(m.content, 1000) or t(g, "f_empty"), inline=False)
            if m.attachments:
                e.add_field(name=t(g, "f_attach"), value=clip("\n".join(f"[{a.filename}]({a.url})" for a in m.attachments), 1000), inline=False)
            e.add_field(name=t(g, "f_msg_sent"), value=discord.utils.format_dt(m.created_at, "R"), inline=True)
        else:
            e.add_field(name=t(g, "f_content"), value=t(g, "f_nocache"), inline=False)
        e.set_footer(text=f"{t(g, 'f_id')}: {p.message_id}")
        await self.send(g, "messages", e)

    @commands.Cog.listener()
    async def on_raw_bulk_message_delete(self, p: discord.RawBulkMessageDeleteEvent):
        g = self.bot.get_guild(p.guild_id) if p.guild_id else None
        if not g or "messages" not in self.cfg(g.id):
            return
        t = self.t
        ch = g.get_channel(p.channel_id)
        e = self.head(g, "delete", "log_msg_delete", "bulk")
        e.description = f"{E.message} **{t(g, 'f_channel')}:** {ch.mention if ch else p.channel_id}\n{E.log_msg_delete} **{t(g, 'f_count_msgs')}:** `{len(p.message_ids)}`"
        await self.send(g, "messages", e)

    @commands.Cog.listener()
    async def on_raw_message_edit(self, p: discord.RawMessageUpdateEvent):
        if not p.guild_id or p.cached_message is None:
            return
        old, new = p.cached_message, p.message
        g = self.bot.get_guild(p.guild_id)
        if not g or old.author.bot or old.content == new.content or "messages" not in self.cfg(g.id):
            return
        t = self.t
        e = self.head(g, "edit", "log_msg_edit", "msg_edit", actor=old.author)
        e.description = f"{E.users} **{t(g, 'f_author')}:** {old.author.mention}\n{E.message} **{t(g, 'f_channel')}:** {new.channel.mention}"
        e.add_field(name=t(g, "f_before"), value=clip(old.content, 1000) or t(g, "f_empty"), inline=False)
        e.add_field(name=t(g, "f_after"), value=clip(new.content, 1000) or t(g, "f_empty"), inline=False)
        e.set_footer(text=f"{t(g, 'f_id')}: {new.id}")
        view = discord.ui.View(timeout=None)
        view.add_item(discord.ui.Button(label=t(g, "f_jump"), url=new.jump_url, emoji=E.pe("message")))
        await self.send(g, "messages", e, view)

    @commands.Cog.listener()
    async def on_raw_reaction_add(self, p: discord.RawReactionActionEvent):
        if not p.guild_id or (p.member and p.member.bot):
            return
        g = self.bot.get_guild(p.guild_id)
        if not g or "reactions" not in self.cfg(g.id):
            return
        t = self.t
        ch = g.get_channel(p.channel_id)
        e = self.head(g, "message", "log_reaction", "react", actor=p.member)
        e.description = (f"{E.users} **{t(g, 'f_member')}:** {p.member.mention if p.member else p.user_id}\n"
                         f"{E.log_reaction} **{t(g, 'f_emoji')}:** {p.emoji}\n{E.message} **{t(g, 'f_channel')}:** {ch.mention if ch else p.channel_id}")
        view = discord.ui.View(timeout=None)
        view.add_item(discord.ui.Button(label=t(g, "f_jump"), url=f"https://discord.com/channels/{g.id}/{p.channel_id}/{p.message_id}", emoji=E.pe("message")))
        await self.send(g, "reactions", e, view)

    # ------------------------------------------------------------------ الصوت والدعوات
    @commands.Cog.listener()
    async def on_voice_state_update(self, m: discord.Member, b: discord.VoiceState, a: discord.VoiceState):
        g = m.guild
        if m.bot or "voice" not in self.cfg(g.id):
            return
        t = self.t
        if b.channel != a.channel:
            key = "v_join" if not b.channel else "v_leave" if not a.channel else "v_move"
            e = self.head(g, "voice", "log_voice", key, actor=m)
            lines = [f"{E.users} **{t(g, 'f_member')}:** {m.mention}"]
            if b.channel:
                lines.append(f"**{t(g, 'f_from')}:** {b.channel.mention}")
            if a.channel:
                lines.append(f"**{t(g, 'f_to')}:** {a.channel.mention}")
            e.description = "\n".join(lines)
            return await self.send(g, "voice", e)
        for attr, key in (("mute", "v_mute"), ("deaf", "v_deaf")):
            if getattr(b, attr) != getattr(a, attr):
                e = self.head(g, "voice", "log_voice", key, actor=m)
                e.description = f"{E.users} **{t(g, 'f_member')}:** {m.mention}\n{'✅' if getattr(a, attr) else '❌'}"
                await self.send(g, "voice", e)

    @commands.Cog.listener()
    async def on_invite_create(self, inv: discord.Invite):
        g = self.bot.get_guild(inv.guild.id) if inv.guild else None
        if not g or "invites" not in self.cfg(g.id):
            return
        t = self.t
        e = self.head(g, "invite", "log_invite", "inv_new", actor=inv.inviter)
        e.description = (f"{E.log_invite} **{t(g, 'f_code')}:** `{inv.code}`\n{E.message} **{t(g, 'f_channel')}:** {inv.channel.mention if inv.channel else '—'}\n"
                         f"**{t(g, 'f_uses')}:** `{inv.max_uses or t(g, 'f_unlimited')}`\n**{t(g, 'f_age')}:** `{(str(inv.max_age // 3600) + ' ' + t(g, 'f_hours')) if inv.max_age else t(g, 'f_unlimited')}`")
        await self.send(g, "invites", e)

    @commands.Cog.listener()
    async def on_invite_delete(self, inv: discord.Invite):
        g = self.bot.get_guild(inv.guild.id) if inv.guild else None
        if not g or "invites" not in self.cfg(g.id):
            return
        e = self.head(g, "delete", "log_invite", "inv_del")
        e.description = f"{E.log_invite} **{self.t(g, 'f_code')}:** `{inv.code}`"
        await self.send(g, "invites", e)

    # ------------------------------------------------------------------ أوامر السلاش /اللوقات
    logs = app_commands.Group(name="اللوقات", description="إدارة لوقات السيرفر", guild_only=True, default_permissions=discord.Permissions(manage_guild=True))

    @staticmethod
    def type_choices():
        return [app_commands.Choice(name=i18n.both("logs.t_" + k)[0], value=k) for k in TYPES]

    async def _need_manage(self, it: discord.Interaction) -> bool:
        if it.user.guild_permissions.manage_guild:
            return True
        await it.response.send_message(i18n.tr(it, "c.no_perm"), ephemeral=True)
        return False

    def _check_channel(self, it, ch: discord.TextChannel) -> bool:
        p = ch.permissions_for(it.guild.me)
        return p.send_messages and p.embed_links and p.view_channel

    @logs.command(name="تحديد", description="تحديد روم لنوع معيّن من اللوقات")
    @app_commands.rename(type="النوع", channel="الروم")
    @app_commands.describe(type="نوع اللوق", channel="روم اللوق")
    @app_commands.choices(type=[app_commands.Choice(name=i18n.both("logs.t_" + k)[0], value=k) for k in TYPES])
    async def logs_set(self, it: discord.Interaction, type: app_commands.Choice[str], channel: discord.TextChannel):
        if not await self._need_manage(it):
            return
        if not self._check_channel(it, channel):
            return await it.response.send_message(i18n.tr(it, "logs.need_perm", channel=channel.mention), ephemeral=True)
        self._save(it.guild_id, type.value, channel.id)
        self.db.commit()
        name = i18n.tr(it, "logs.t_" + type.value)
        e = mk_embed(None, "success", f"{E.success} {name}", i18n.tr(it, "logs.set_ok", type=name, channel=channel.mention))
        if not it.guild.me.guild_permissions.view_audit_log:
            e.add_field(name="​", value=i18n.tr(it, "logs.audit_warn"), inline=False)
        await it.response.send_message(embed=e, ephemeral=True)

    @logs.command(name="الكل", description="تحديد روم واحد لكل أنواع اللوقات")
    @app_commands.rename(channel="الروم")
    @app_commands.describe(channel="روم اللوق")
    async def logs_all(self, it: discord.Interaction, channel: discord.TextChannel):
        if not await self._need_manage(it):
            return
        if not self._check_channel(it, channel):
            return await it.response.send_message(i18n.tr(it, "logs.need_perm", channel=channel.mention), ephemeral=True)
        for k in TYPES:
            self._save(it.guild_id, k, channel.id)
        self.db.commit()
        e = mk_embed(None, "success", f"{E.success} {i18n.tr(it, 'logs.status_t')}", i18n.tr(it, "logs.all_ok", n=len(TYPES), channel=channel.mention))
        if not it.guild.me.guild_permissions.view_audit_log:
            e.add_field(name="​", value=i18n.tr(it, "logs.audit_warn"), inline=False)
        await it.response.send_message(embed=e, ephemeral=True)

    @logs.command(name="ايقاف", description="إيقاف نوع من اللوقات أو كلها")
    @app_commands.rename(type="النوع")
    @app_commands.describe(type="نوع اللوق (اتركه فاضي لإيقاف الكل)")
    @app_commands.choices(type=[app_commands.Choice(name=i18n.both("logs.t_" + k)[0], value=k) for k in TYPES])
    async def logs_off(self, it: discord.Interaction, type: app_commands.Choice[str] | None = None):
        if not await self._need_manage(it):
            return
        for k in ([type.value] if type else list(TYPES)):
            self._save(it.guild_id, k, None)
        self.db.commit()
        msg = i18n.tr(it, "logs.off_ok", type=i18n.tr(it, "logs.t_" + type.value)) if type else i18n.tr(it, "logs.off_all")
        await it.response.send_message(embed=mk_embed(None, "warn", f"{E.off} {i18n.tr(it, 'logs.status_t')}", msg), ephemeral=True)

    @logs.command(name="الحالة", description="عرض حالة كل اللوقات والرومات المرتبطة")
    async def logs_status(self, it: discord.Interaction):
        cfg = self.cfg(it.guild_id)
        lines = []
        for k, em in TYPES.items():
            ch = it.guild.get_channel(cfg.get(k, 0))
            lines.append(f"{getattr(E, em)} **{i18n.tr(it, 'logs.t_' + k)}** ➜ {ch.mention if ch else '`' + i18n.tr(it, 'logs.off_label') + '`'}")
        on = sum(1 for k in TYPES if it.guild.get_channel(cfg.get(k, 0)))
        e = mk_embed(None, "brand", f"{E.shield} {i18n.tr(it, 'logs.status_t')}", "\n".join(lines))
        e.set_footer(text=i18n.tr(it, "logs.status_d2", on=on, total=len(TYPES)))
        if not it.guild.me.guild_permissions.view_audit_log:
            e.add_field(name="​", value=i18n.tr(it, "logs.audit_warn"), inline=False)
        await it.response.send_message(embed=e, ephemeral=True)

    @logs.command(name="تجربة", description="إرسال رسالة تجريبية لكل روم لوق")
    async def logs_test(self, it: discord.Interaction):
        if not await self._need_manage(it):
            return
        cfg = self.cfg(it.guild_id)
        if not cfg:
            return await it.response.send_message(i18n.tr(it, "logs.test_none"), ephemeral=True)
        await it.response.defer(ephemeral=True)
        n = 0
        for k in TYPES:
            if k in cfg:
                name = i18n.tr(it, "logs.t_" + k)
                e = mk_embed(None, "brand", f"{getattr(E, TYPES[k])} {i18n.tr(it, 'logs.test_t')}", i18n.tr(it, "logs.test_d2", type=name))
                await self.send(it.guild, k, e)
                n += 1
        await it.followup.send(i18n.tr(it, "logs.test_n", n=n), ephemeral=True)


async def setup(bot):
    await bot.add_cog(LogsCog(bot))
