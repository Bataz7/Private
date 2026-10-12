"""اختبارات نظام الشفت والنقاط بدون اتصال بديسكورد: python -m pytest -q"""
import asyncio
import os
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import discord  # noqa: E402

from cogs import point_police as pp  # noqa: E402

MIL, VC, GID, UID = 11, 22, 100, 200


class FakeBot:
    def __init__(self, guild):
        self.guild = guild
        self.guilds = [guild]
        self.http = SimpleNamespace(delete_message=mock.AsyncMock(), edit_message=mock.AsyncMock())

    def add_view(self, *_):
        pass

    def get_guild(self, gid):
        return self.guild if gid == GID else None


def make_world():
    os.chdir(tempfile.mkdtemp())
    vc = SimpleNamespace(id=VC, name="شفت 1", mention=f"<#{VC}>", members=[], send=mock.AsyncMock())
    guild = SimpleNamespace(id=GID, name="سيرفر", icon=None, get_channel=lambda cid: vc if cid == VC else None)
    dm = SimpleNamespace(id=999, channel=SimpleNamespace(id=555))
    member = SimpleNamespace(
        id=UID, bot=False, guild=guild, mention=f"<@{UID}>", display_name="عسكري",
        display_avatar=SimpleNamespace(url="https://x/a.png"), voice=SimpleNamespace(channel=vc),
        get_role=lambda rid: object() if rid == MIL else None, send=mock.AsyncMock(return_value=dm),
        guild_permissions=SimpleNamespace(administrator=False),
    )
    guild.get_member = lambda uid: member if uid == UID else None
    bot = FakeBot(guild)
    cog = pp.PointPolice(bot)
    cog.set_settings(GID, military_role_id=MIL, shift_points=1, shift_block=10, shift_min=15, check_after=60, check_timeout=30)
    cog.db.execute("INSERT INTO shift_channels VALUES (?, ?)", (GID, VC))
    cog.db.commit()
    cog._reconciled = True
    return cog, member, vc


def run(coro):
    return asyncio.run(coro)


def test_points_formula():
    cog, *_ = make_world()
    assert cog.points_for(GID, 14 * 60) == 0          # أقل من الحد الأدنى
    assert cog.points_for(GID, 15 * 60) == 1
    assert cog.points_for(GID, 65 * 60) == 6


def test_join_and_leave_awards_points():
    cog, member, vc = make_world()
    before, after = SimpleNamespace(channel=None), SimpleNamespace(channel=vc)
    run(cog.on_voice_state_update(member, before, after))
    assert (GID, UID) in cog.active
    cog.active[(GID, UID)]["start_ts"] -= 45 * 60
    run(cog.on_voice_state_update(member, after, SimpleNamespace(channel=None)))
    assert (GID, UID) not in cog.active
    assert cog.get_user_points(GID, UID) == 4


def test_afk_check_then_silent_stop():
    cog, member, vc = make_world()
    run(cog.start_shift(member, vc, quiet=True))
    s = cog.active[(GID, UID)]
    s["start_ts"] -= 61 * 60
    s["last_confirm_ts"] -= 61 * 60
    run(cog.ticker.coro(cog))                      # بعد ساعة: يرسل «هل انت موجود؟»
    member.send.assert_awaited_once()
    assert s["check_sent_ts"] and s["check_message_id"] == 999
    s["check_sent_ts"] -= 31 * 60                  # مرت نص ساعة بدون رد
    run(cog.ticker.coro(cog))
    assert (GID, UID) not in cog.active
    assert member.send.await_count == 1            # ما انرسل له أي شي ثاني
    cog.bot.http.delete_message.assert_awaited_once_with(555, 999)
    assert (GID, UID) in cog.blocked               # ما يبدأ شفت جديد إلا إذا طلع ورجع
    row = cog.db.execute("SELECT seconds, points, end_reason FROM shifts").fetchone()
    assert row["end_reason"] == "afk" and row["points"] == 3   # الوقت حتى إرسال التحقق فقط (~30 دقيقة)
    run(cog.ticker.coro(cog))
    assert (GID, UID) not in cog.active
    run(cog.on_voice_state_update(member, SimpleNamespace(channel=vc), SimpleNamespace(channel=None)))
    run(cog.on_voice_state_update(member, SimpleNamespace(channel=None), SimpleNamespace(channel=vc)))
    assert (GID, UID) in cog.active


def test_reply_in_dm_confirms():
    cog, member, vc = make_world()
    run(cog.start_shift(member, vc, quiet=True))
    s = cog.active[(GID, UID)]
    s["last_confirm_ts"] -= 61 * 60
    run(cog.ticker.coro(cog))
    msg = SimpleNamespace(author=member, guild=None, channel=SimpleNamespace(id=555), add_reaction=mock.AsyncMock())
    run(cog.on_message(msg))
    assert s["check_sent_ts"] is None and (GID, UID) in cog.active


def test_card_renders():
    from core import police_card
    png = police_card.render(avatar=None, name="عسكري", subtitle="رقيب · سيرفر", points=1234, rank="#1", hours="12.5",
                             shifts="9", warnings="0/3", status="on", status_text="في الشفت الآن · 1:05", week="آخر 7 أيام: 3:20 ساعة")
    assert png[:8] == b"\x89PNG\r\n\x1a\n"


def test_command_names_are_arabic():
    import re
    names = [c.name for c in pp.PointPolice.__cog_app_commands__] + [c.name for c in pp.PointPolice.police.commands]
    assert names and all(not re.search("[A-Za-z]", n) for n in names)
    assert isinstance(pp.HereButton(1, 2).item, discord.ui.Button)
