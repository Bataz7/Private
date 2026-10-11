"""Mood Bot 🌈 — يسأل كل يوم: كيف كان يومك؟ ويطلع تقارير عن المزاج."""
import logging
from datetime import datetime, time, timedelta

import discord
from discord import app_commands
from discord.ext import tasks

import ai
import db
import report
from config import (ALLOWED, CHECKIN_TIME, EMOJI_DIR, NOTIFY_OWNER, OWNER_IDS, REMINDER_AFTER_HOURS,
                    TARGET_IDS, TOKEN, TZ, WEEKLY_REPORT_DAY, WEEKLY_REPORT_TIME)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("mood")

# mood: (اسم الإيموجي, الاسم, إيموجي احتياطي, اللون)
MOODS = {
    5: ("mood_great", "ممتاز", "😄", 0x2BB673),
    4: ("mood_good", "كويس", "🙂", 0x6CC24A),
    3: ("mood_okay", "عادي", "😐", 0xF5B935),
    2: ("mood_bad", "سيء", "😕", 0xF08A3C),
    1: ("mood_awful", "سيء جداً", "😢", 0xE5484D),
}
SQUARES = {5: "🟩", 4: "🟩", 3: "🟨", 2: "🟧", 1: "🟥"}
PURPLE = 0x6C5CE7

intents = discord.Intents.default()
client = discord.Client(intents=intents)
tree = app_commands.CommandTree(client)
EMOJIS: dict[str, discord.Emoji] = {}


def emo(mood_or_name):
    """يرجع الإيموجي الخاص بالبوت، أو العادي لو ما انرفع."""
    if isinstance(mood_or_name, int):
        name, _, fallback, _ = MOODS[mood_or_name]
    else:
        name, fallback = mood_or_name, "📊"
    return EMOJIS.get(name) or fallback


def is_owner(uid):
    return uid in OWNER_IDS or (not OWNER_IDS and uid in TARGET_IDS)


# ───────────────────────── واجهة السؤال اليومي ─────────────────────────

class MoodModal(discord.ui.Modal):
    def __init__(self, mood: int):
        super().__init__(title=f"يومك كان {MOODS[mood][1]} — احكِ لنا")
        self.mood = mood
        good = mood >= 4
        self.highlight = discord.ui.TextInput(
            label="وش أكثر شي خلى يومك حلو؟" if good else "وش أبرز شي صار اليوم؟",
            style=discord.TextStyle.paragraph, required=False, max_length=500,
            placeholder="مثال: طلعت مع الربع، خلصت شغلي بدري…")
        self.problems = discord.ui.TextInput(
            label="فيه مشاكل أو أشياء ضايقتك؟",
            style=discord.TextStyle.paragraph, required=False, max_length=500,
            placeholder="اكتب أي شي، أو خلها فاضية 🤍")
        self.add_item(self.highlight)
        self.add_item(self.problems)

    async def on_submit(self, interaction: discord.Interaction):
        await interaction.response.defer(thinking=True)
        uid, day = interaction.user.id, db.today()
        db.save_entry(uid, self.mood, self.highlight.value, self.problems.value, day)
        entry = dict(db.get_entry(uid, day))
        text = await ai.reply(entry, db.entries(uid, 14)[:-1])
        db.set_ai_reply(uid, day, text)

        name, label, _, color = MOODS[self.mood]
        e = discord.Embed(title=f"{emo(self.mood)} تم تسجيل يومك: {label}", description=text, color=color)
        if entry["highlight"]:
            e.add_field(name="🌟 أبرز شي", value=entry["highlight"][:1024], inline=False)
        if entry["problems"]:
            e.add_field(name="⚡ اللي ضايقك", value=entry["problems"][:1024], inline=False)
        e.set_footer(text=f"🔥 سلسلة التسجيل: {db.streak(uid)} يوم · /report للتقارير")
        await interaction.followup.send(embed=e)

        # نقفل أزرار رسالة السؤال
        if interaction.message:
            try:
                await interaction.message.edit(view=None)
            except discord.HTTPException:
                pass

        if NOTIFY_OWNER:
            for oid in OWNER_IDS:
                if oid != uid:
                    await _dm(oid, embed=discord.Embed(
                        title=f"{emo(self.mood)} {interaction.user.display_name} سجّل يومه: {label}",
                        color=color).set_footer(text="التفاصيل في /report"))


class CheckinView(discord.ui.View):
    """أزرار المزاج. timeout=None + custom_id ثابت = تشتغل حتى بعد إعادة تشغيل البوت."""

    def __init__(self):
        super().__init__(timeout=None)
        for mood in sorted(MOODS, reverse=True):
            btn = discord.ui.Button(label=MOODS[mood][1], emoji=emo(mood), custom_id=f"mood:{mood}",
                                    style=discord.ButtonStyle.secondary)
            btn.callback = self._make_cb(mood)
            self.add_item(btn)

    @staticmethod
    def _make_cb(mood):
        async def cb(interaction: discord.Interaction):
            if interaction.user.id not in ALLOWED:
                return await interaction.response.send_message("هذا السؤال مو لك 🙂", ephemeral=True)
            await interaction.response.send_modal(MoodModal(mood))
        return cb


def checkin_embed(user: discord.abc.User):
    hour = datetime.now(TZ).hour
    greet = "صباح الخير" if hour < 12 else ("مساء الخير" if hour >= 17 else "هلا والله")
    e = discord.Embed(
        title=f"{greet} {user.display_name} 👋",
        description="**كيف كان يومك؟**\nاختر الوجه اللي يوصف يومك، وبعدها احكِ لي وش صار 💬",
        color=PURPLE)
    e.set_footer(text="Mood Bot · إجاباتك تنحفظ في تقاريرك الأسبوعية")
    return e


async def _dm(uid, **kwargs):
    try:
        user = client.get_user(uid) or await client.fetch_user(uid)
        return await user.send(**kwargs)
    except discord.HTTPException as ex:
        log.warning("ما قدرت أرسل للمستخدم %s: %s", uid, ex)


async def send_checkin(uid):
    try:
        user = client.get_user(uid) or await client.fetch_user(uid)
    except discord.HTTPException as ex:
        return log.warning("ما لقيت المستخدم %s: %s", uid, ex)
    msg = await _dm(uid, embed=checkin_embed(user), view=CheckinView())
    if msg:
        db.mark_prompted(uid)
        log.info("أرسلت السؤال اليومي إلى %s", user)


# ───────────────────────── التقارير ─────────────────────────

def mood_strip(rows):
    if len(rows) <= 14:
        return " ".join(str(emo(r["mood"])) for r in rows)
    return "".join(SQUARES[r["mood"]] for r in rows)


async def build_report(uid, days):
    """يرجع (embed, file) لتقرير آخر N يوم."""
    user = client.get_user(uid) or await client.fetch_user(uid)
    st = report.stats(uid, days)
    insight = await ai.analyze(st["rows"], st["prev_avg"])
    path = report.save(uid, user.display_name, st, insight)

    color = MOODS[max(1, min(5, round(st["avg"])))][3] if st["count"] else PURPLE
    e = discord.Embed(title=f"{emo('mood_report')} تقرير المزاج — {user.display_name}",
                      description=f"**آخر {days} يوم** ({st['start']} ← {st['end']})\n\n{insight['summary']}",
                      color=color)
    if st["count"]:
        ch = st["change"]
        e.add_field(name="المتوسط", value=f"**{st['avg']:.1f}**/5 {emo(round(st['avg']))}")
        e.add_field(name="التغيّر", value="—" if ch is None else f"{'📈' if ch >= 0 else '📉'} {ch:+.0f}%")
        e.add_field(name="أيام حلوة", value=f"{st['good_days_pct']}% ({st['count']} يوم)")
        e.add_field(name="المزاج يوم بيوم", value=mood_strip(st["rows"])[:1024], inline=False)
        if insight["good_things"]:
            e.add_field(name="🌟 اللي يحسّن مزاجك", value="\n".join(f"• {x}" for x in insight["good_things"][:4])[:1024], inline=False)
        if insight["bad_things"]:
            e.add_field(name="⚡ اللي يضايقك", value="\n".join(f"• {x}" for x in insight["bad_things"][:4])[:1024], inline=False)
        if insight["tips"]:
            e.add_field(name="💡 نصائح", value="\n".join(f"• {x}" for x in insight["tips"][:3])[:1024], inline=False)
    e.set_footer(text=f"🔥 سلسلة التسجيل: {st['streak']} يوم · افتح الملف المرفق للتقرير الكامل")
    return e, path


# ───────────────────────── المهام المجدولة ─────────────────────────

def _shift(t: time, hours: float) -> time:
    dt = datetime.combine(datetime.now(TZ).date(), t) + timedelta(hours=hours)
    return dt.timetz()


@tasks.loop(time=CHECKIN_TIME)
async def daily_checkin():
    for uid in TARGET_IDS:
        await send_checkin(uid)


@tasks.loop(time=_shift(CHECKIN_TIME, REMINDER_AFTER_HOURS or 0))
async def reminder():
    if REMINDER_AFTER_HOURS <= 0:
        return
    for uid in TARGET_IDS:
        if db.needs_reminder(uid):
            await _dm(uid, content="تذكير لطيف 🌙 ما قلت لي كيف كان يومك… الأزرار فوق تنتظرك 👆")
            db.mark_reminded(uid)


@tasks.loop(time=WEEKLY_REPORT_TIME)
async def weekly_report():
    if datetime.now(TZ).weekday() != WEEKLY_REPORT_DAY:
        return
    for uid in TARGET_IDS:
        embed, path = await build_report(uid, 7)
        for dest in {uid, *OWNER_IDS}:
            await _dm(dest, content="📬 تقريرك الأسبوعي وصل!" if dest == uid else None,
                      embed=embed, file=discord.File(path))


# ───────────────────────── الأوامر ─────────────────────────

def _cmd(**kw):
    """أوامر تشتغل في الخاص والسيرفرات."""
    def deco(f):
        f = app_commands.allowed_contexts(guilds=True, dms=True, private_channels=True)(f)
        f = app_commands.allowed_installs(guilds=True, users=True)(f)
        return tree.command(**kw)(f)
    return deco


async def _guard(i: discord.Interaction):
    if i.user.id not in ALLOWED:
        await i.response.send_message("هذا البوت خاص 🔒", ephemeral=True)
        return False
    return True


def _resolve_target(i: discord.Interaction, user: discord.User | None):
    """الشخص المطلوب تقريره: المستخدم نفسه، أو (للمالك) أي شخص من القائمة."""
    if user and user.id != i.user.id:
        return user.id if is_owner(i.user.id) and user.id in TARGET_IDS else None
    if i.user.id in TARGET_IDS:
        return i.user.id
    return TARGET_IDS[0] if is_owner(i.user.id) and TARGET_IDS else None


@_cmd(name="checkin", description="سجّل مزاجك الحين (أو أرسل السؤال للشخص لو كنت المالك)")
async def checkin_cmd(i: discord.Interaction):
    if not await _guard(i):
        return
    if i.user.id in TARGET_IDS:
        return await i.response.send_message(embed=checkin_embed(i.user), view=CheckinView())
    await i.response.send_message("📨 أرسلت السؤال في الخاص.", ephemeral=True)
    for uid in TARGET_IDS:
        await send_checkin(uid)


@_cmd(name="report", description="تقرير المزاج مع تحليل ونصائح")
@app_commands.describe(period="الفترة", user="(للمالك) الشخص")
@app_commands.choices(period=[
    app_commands.Choice(name="أسبوع", value=7),
    app_commands.Choice(name="شهر", value=30),
    app_commands.Choice(name="3 شهور", value=90),
])
async def report_cmd(i: discord.Interaction, period: int = 7, user: discord.User | None = None):
    if not await _guard(i):
        return
    uid = _resolve_target(i, user)
    if uid is None:
        return await i.response.send_message("ما تقدر تشوف تقرير هالشخص 🔒", ephemeral=True)
    await i.response.defer(thinking=True, ephemeral=i.guild is not None)
    embed, path = await build_report(uid, period)
    await i.followup.send(embed=embed, file=discord.File(path), ephemeral=i.guild is not None)


@_cmd(name="history", description="آخر 7 أيام باختصار")
async def history_cmd(i: discord.Interaction, user: discord.User | None = None):
    if not await _guard(i):
        return
    uid = _resolve_target(i, user)
    if uid is None:
        return await i.response.send_message("🔒", ephemeral=True)
    rows = db.entries(uid, 7)
    lines = [f"{emo(r['mood'])} **{r['day']}** — {MOODS[r['mood']][1]}"
             + (f"\n  🌟 {r['highlight'][:80]}" if r["highlight"] else "")
             + (f"\n  ⚡ {r['problems'][:80]}" if r["problems"] else "") for r in reversed(rows)]
    e = discord.Embed(title="🗓️ آخر 7 أيام", description="\n".join(lines) or "ما فيه تسجيلات للحين.", color=PURPLE)
    await i.response.send_message(embed=e, ephemeral=i.guild is not None)


@_cmd(name="status", description="حالة البوت والإعدادات")
async def status_cmd(i: discord.Interaction):
    if not await _guard(i):
        return
    e = discord.Embed(title="⚙️ Mood Bot", color=PURPLE)
    e.add_field(name="السؤال اليومي", value=CHECKIN_TIME.strftime("%H:%M") + f" ({TZ})")
    e.add_field(name="التقرير الأسبوعي", value=f"{report.WEEKDAYS[WEEKLY_REPORT_DAY]} {WEEKLY_REPORT_TIME:%H:%M}")
    e.add_field(name="الذكاء الاصطناعي", value="✅ شغّال" if ai.enabled else "❌ مطفي")
    e.add_field(name="الأشخاص", value=" ".join(f"<@{u}>" for u in TARGET_IDS) or "—", inline=False)
    await i.response.send_message(embed=e, ephemeral=True)


# ───────────────────────── التشغيل ─────────────────────────

async def load_emojis():
    """يرفع ايموجيات البوت (مرة وحدة) كـ Application Emojis — تشتغل في الخاص وفي أي مكان."""
    try:
        existing = {e.name: e for e in await client.fetch_application_emojis()}
        for png in sorted(EMOJI_DIR.glob("*.png")):
            if png.stem not in existing:
                existing[png.stem] = await client.create_application_emoji(name=png.stem, image=png.read_bytes())
                log.info("رفعت الإيموجي %s", png.stem)
        EMOJIS.update(existing)
    except discord.HTTPException as ex:
        log.warning("ما قدرت أرفع الايموجيات، بستخدم العادية: %s", ex)


@client.event
async def setup_hook():
    client.add_view(CheckinView())  # عشان الأزرار القديمة تشتغل بعد إعادة التشغيل
    await tree.sync()
    for loop in (daily_checkin, reminder, weekly_report):
        loop.start()


@client.event
async def on_ready():
    if not EMOJIS:
        await load_emojis()
    log.info("✅ %s شغّال | السؤال اليومي %s | AI: %s", client.user, CHECKIN_TIME.strftime("%H:%M"),
             "on" if ai.enabled else "off")


def main():
    if not TOKEN or not TARGET_IDS:
        raise SystemExit("❌ لازم تحط DISCORD_TOKEN و TARGET_USER_ID في ملف .env (شوف .env.example)")
    client.run(TOKEN, log_handler=None)


if __name__ == "__main__":
    main()
