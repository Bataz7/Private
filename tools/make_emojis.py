"""يصنع حزمة إيموجيات ريفايف | Builds the Revive emoji pack.

التشغيل:  python tools/make_emojis.py
الناتج:   emojis/*.png (128×128 شفافة) + emojis/svg/*.svg + emojis/manifest.json + emojis/preview.html
PNG يحتاج playwright + chromium (pip install playwright)؛ بدونه تُنتج ملفات SVG فقط.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from dashboard_ui.icons import ICONS, EMBLEM  # noqa: E402

OUT = ROOT / "emojis"

# ألوان الجواهر: (فاتح، متوسط، داكن، توهّج)
COLORWAYS = {
    "royal": ("#6aa0ff", "#2f6bff", "#16358f", "#4f8cff"),
    "green": ("#6df0a4", "#1fc46a", "#0b6b3a", "#2fe38a"),
    "red": ("#ff8a8a", "#f23d4f", "#8f1226", "#ff4d5e"),
    "amber": ("#ffd36b", "#ffa51f", "#a35a00", "#ffbb3a"),
    "gold": ("#fff0a8", "#f6c445", "#a8730a", "#ffd24a"),
    "purple": ("#c9a8ff", "#8b5cf6", "#4a1fa8", "#a47bff"),
    "pink": ("#ffb0d4", "#ff5c9e", "#a8185a", "#ff7ab4"),
    "teal": ("#7af5e3", "#14c8b0", "#08685c", "#2de0c8"),
    "cyan": ("#8be4ff", "#22b8f0", "#0a5f93", "#40caff"),
    "orange": ("#ffb27a", "#ff7a1f", "#a33a00", "#ff8f3d"),
    "slate": ("#c7d2e8", "#7b8bab", "#3a4663", "#9fb0d0"),
}

# (الاسم، التصنيف، الأيقونة، اللون، عربي، English)
PACK = [
    # ---- لوقات ----
    ("rv_log_join", "logs", "log-in", "green", "دخول عضو", "Member joined"),
    ("rv_log_leave", "logs", "logout", "orange", "خروج عضو", "Member left"),
    ("rv_log_ban", "logs", "hammer", "red", "باند", "Ban"),
    ("rv_log_unban", "logs", "unlock", "green", "فك الباند", "Unban"),
    ("rv_log_kick", "logs", "user-x", "orange", "طرد", "Kick"),
    ("rv_log_timeout", "logs", "clock", "amber", "تايم أوت", "Timeout"),
    ("rv_log_untimeout", "logs", "timer-off", "teal", "إزالة التايم أوت", "Timeout removed"),
    ("rv_log_role", "logs", "tag", "purple", "رتبة", "Role"),
    ("rv_log_role_add", "logs", "tag-plus", "green", "إعطاء رتبة", "Role added"),
    ("rv_log_role_remove", "logs", "tag-off", "red", "سحب رتبة", "Role removed"),
    ("rv_log_msg_delete", "logs", "message-x", "red", "حذف رسالة", "Message deleted"),
    ("rv_log_msg_edit", "logs", "pencil", "royal", "تعديل رسالة", "Message edited"),
    ("rv_log_reaction", "logs", "smile", "pink", "تفاعل", "Reaction"),
    ("rv_log_channel_create", "logs", "folder-plus", "green", "إنشاء روم", "Channel created"),
    ("rv_log_channel_delete", "logs", "folder-x", "red", "حذف روم", "Channel deleted"),
    ("rv_log_channel_edit", "logs", "folder-edit", "royal", "تعديل روم", "Channel edited"),
    ("rv_log_role_create", "logs", "tag-plus", "teal", "إنشاء رتبة", "Role created"),
    ("rv_log_role_delete", "logs", "trash", "red", "حذف رتبة", "Role deleted"),
    ("rv_log_server", "logs", "settings", "slate", "إعدادات السيرفر", "Server updated"),
    ("rv_log_voice", "logs", "mic", "cyan", "الصوت", "Voice"),
    ("rv_log_invite", "logs", "link", "teal", "دعوة", "Invite"),
    ("rv_log_bot", "logs", "bot", "purple", "بوت", "Bot"),
    # ---- تذاكر ----
    ("rv_ticket", "tickets", "ticket", "royal", "تذكرة", "Ticket"),
    ("rv_ticket_open", "tickets", "inbox", "green", "فتح تذكرة", "Ticket opened"),
    ("rv_ticket_close", "tickets", "lock", "red", "إغلاق تذكرة", "Ticket closed"),
    ("rv_ticket_reopen", "tickets", "unlock", "green", "إعادة فتح", "Reopened"),
    ("rv_ticket_claim", "tickets", "hand", "amber", "استلام تذكرة", "Claim"),
    ("rv_ticket_transcript", "tickets", "file-check", "royal", "نسخة المحادثة", "Transcript"),
    ("rv_ticket_rating", "tickets", "star", "gold", "تقييم", "Rating"),
    ("rv_ticket_user_add", "tickets", "user-plus", "green", "إضافة عضو", "Add member"),
    ("rv_ticket_user_remove", "tickets", "user-x", "red", "إزالة عضو", "Remove member"),
    ("rv_ticket_rename", "tickets", "pencil", "royal", "تغيير الاسم", "Rename"),
    ("rv_ticket_delete", "tickets", "trash", "red", "حذف", "Delete"),
    ("rv_ticket_priority", "tickets", "flag", "orange", "أولوية", "Priority"),
    ("rv_ticket_support", "tickets", "support", "teal", "الدعم", "Support"),
    ("rv_ticket_panel", "tickets", "layers", "purple", "بانل", "Panel"),
    ("rv_ticket_note", "tickets", "clipboard", "slate", "ملاحظة", "Note"),
    ("rv_ticket_notify", "tickets", "bell", "amber", "تنبيه", "Notify"),
    # ---- حالات ----
    ("rv_success", "status", "check-circle", "green", "نجاح", "Success"),
    ("rv_error", "status", "x", "red", "خطأ", "Error"),
    ("rv_warning", "status", "warn", "amber", "تحذير", "Warning"),
    ("rv_info", "status", "info", "cyan", "معلومة", "Info"),
    ("rv_loading", "status", "refresh", "royal", "جاري التحميل", "Loading"),
    ("rv_pending", "status", "clock", "slate", "قيد الانتظار", "Pending"),
    ("rv_locked", "status", "lock", "slate", "مقفل", "Locked"),
    ("rv_on", "status", "check", "green", "مفعّل", "On"),
    ("rv_off", "status", "ban", "red", "معطّل", "Off"),
    # ---- حماية ----
    ("rv_shield", "protection", "shield", "royal", "الحماية", "Protection"),
    ("rv_shield_on", "protection", "shield", "green", "حماية مفعّلة", "Protection on"),
    ("rv_shield_off", "protection", "shield", "red", "حماية معطّلة", "Protection off"),
    ("rv_antibot", "protection", "bot", "red", "منع البوتات", "Anti-bot"),
    ("rv_antilink", "protection", "link", "orange", "منع الروابط", "Anti-link"),
    ("rv_antiraid", "protection", "hammer", "purple", "منع التبنيد", "Anti-raid"),
    ("rv_badword", "protection", "ban", "red", "كلمة محظورة", "Blocked word"),
    ("rv_admin", "protection", "crown", "gold", "أدمن", "Admin"),
    ("rv_alert", "protection", "alert-circle", "red", "تنبيه أمني", "Security alert"),
    # ---- اقتصاد ----
    ("rv_bank", "economy", "landmark", "gold", "البنك", "Bank"),
    ("rv_money", "economy", "coins", "gold", "فلوس", "Money"),
    ("rv_card", "economy", "card", "royal", "بطاقة", "Card"),
    ("rv_loan", "economy", "clipboard", "amber", "قرض", "Loan"),
    ("rv_transfer", "economy", "arrow", "teal", "تحويل", "Transfer"),
    ("rv_levels", "economy", "trending", "green", "المستويات", "Levels"),
    ("rv_xp", "economy", "sparkles", "purple", "خبرة", "XP"),
    ("rv_trophy", "economy", "trophy", "gold", "كأس", "Trophy"),
    # ---- رول بلاي ----
    ("rv_identity", "roleplay", "id-card", "royal", "الهوية", "Identity"),
    ("rv_weapon", "roleplay", "crosshair", "red", "الأسلحة", "Weapons"),
    ("rv_traffic", "roleplay", "traffic", "amber", "المرور", "Traffic"),
    ("rv_realestate", "roleplay", "building", "teal", "العقارات", "Real estate"),
    ("rv_key", "roleplay", "key", "gold", "مفتاح", "Key"),
    ("rv_apply", "roleplay", "clipboard", "purple", "تقديم", "Application"),
    ("rv_activation", "roleplay", "check-circle", "green", "تفعيل", "Activation"),
    ("rv_rpstatus", "roleplay", "activity", "cyan", "حالة الرول", "RP status"),
    ("rv_location", "roleplay", "pin", "red", "موقع", "Location"),
    # ---- عام ----
    ("rv_logo", "misc", "emblem", "royal", "ريفايف", "Revive"),
    ("rv_crown", "misc", "crown", "gold", "تاج", "Crown"),
    ("rv_star", "misc", "star", "gold", "نجمة", "Star"),
    ("rv_bolt", "misc", "bolt", "amber", "سرعة", "Fast"),
    ("rv_welcome", "misc", "user-plus", "green", "ترحيب", "Welcome"),
    ("rv_azkar", "misc", "moon", "purple", "أذكار", "Azkar"),
    ("rv_settings", "misc", "settings", "slate", "إعدادات", "Settings"),
    ("rv_heart", "misc", "heart", "pink", "قلب", "Heart"),
    ("rv_chart", "misc", "chart", "cyan", "إحصائيات", "Stats"),
    ("rv_globe", "misc", "globe", "royal", "لغة", "Language"),
    ("rv_bot", "misc", "bot", "royal", "البوت", "Bot"),
    ("rv_users", "misc", "users", "teal", "الأعضاء", "Members"),
    ("rv_message", "misc", "message", "royal", "رسالة", "Message"),
    ("rv_shortcut", "misc", "bolt", "purple", "اختصار", "Shortcut"),
    ("rv_palette", "misc", "palette", "pink", "ثيم", "Theme"),
]


def glyph(icon: str) -> str:
    """الأيقونة كطبقتين: تعبئة خفيفة + خطوط بيضاء، مركزة في الجوهرة."""
    if icon == "emblem":
        return f'<g transform="translate(64 66) scale(.5) translate(-60 -55)" color="#fff">{EMBLEM}</g>'
    fill, stroke = ICONS[icon]
    f = f'<g fill="url(#gf)" stroke="none">{fill}</g>' if fill else ""
    return (f'<g transform="translate(26 27) scale(3.04)" filter="url(#gs)">{f}'
            f'<g fill="none" stroke="#fff" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">{stroke}</g></g>')


def svg(name: str, icon: str, color: str) -> str:
    lt, md, dk, glow = COLORWAYS[color]
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
<defs>
 <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{lt}"/><stop offset=".45" stop-color="{md}"/><stop offset="1" stop-color="{dk}"/></linearGradient>
 <radialGradient id="bt" cx=".5" cy="1.05" r=".75"><stop offset="0" stop-color="{glow}" stop-opacity=".95"/><stop offset="1" stop-color="{glow}" stop-opacity="0"/></radialGradient>
 <linearGradient id="gl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".62"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
 <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset=".5" stop-color="#fff" stop-opacity=".12"/><stop offset="1" stop-color="{lt}" stop-opacity=".7"/></linearGradient>
 <linearGradient id="gf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity=".12"/></linearGradient>
 <filter id="gs" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy=".5" stdDeviation=".55" flood-color="#000" flood-opacity=".38"/></filter>
 <filter id="sh" x="-30%" y="-30%" width="160%" height="170%"><feGaussianBlur stdDeviation="5"/></filter>
 <clipPath id="cp"><rect x="8" y="6" width="112" height="112" rx="34"/></clipPath>
</defs>
<ellipse cx="64" cy="118" rx="40" ry="6.5" fill="{dk}" opacity=".55" filter="url(#sh)"/>
<rect x="8" y="6" width="112" height="112" rx="34" fill="url(#bg)"/>
<g clip-path="url(#cp)">
 <rect x="8" y="6" width="112" height="112" fill="url(#bt)"/>
 <ellipse cx="64" cy="22" rx="52" ry="30" fill="url(#gl)"/>
 <path d="M-10 118 L40 6 H58 L8 118Z" fill="#fff" opacity=".07"/>
</g>
<rect x="9.5" y="7.5" width="109" height="109" rx="32.5" fill="none" stroke="url(#rim)" stroke-width="3"/>
<rect x="14" y="12" width="100" height="100" rx="29" fill="none" stroke="#000" stroke-opacity=".13" stroke-width="1.5"/>
{glyph(icon)}
<path d="M98 20 L100.2 26.4 L106.6 28.6 L100.2 30.8 L98 37.2 L95.8 30.8 L89.4 28.6 L95.8 26.4Z" fill="#fff" opacity=".9"/>
<circle cx="31" cy="97" r="2" fill="#fff" opacity=".55"/>
</svg>'''


def main():
    OUT.mkdir(exist_ok=True)
    (OUT / "svg").mkdir(exist_ok=True)
    manifest = []
    for name, cat, icon, color, ar, en in PACK:
        assert len(name) <= 32 and name.replace("_", "").isalnum(), name
        (OUT / "svg" / f"{name}.svg").write_text(svg(name, icon, color), encoding="utf-8")
        manifest.append(dict(name=name, file=f"{name}.png", category=cat, ar=ar, en=en))
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("playwright غير مثبّت: كُتبت ملفات SVG فقط / playwright missing: SVG only")
        return
    with sync_playwright() as p:
        import glob
        exe = next(iter(glob.glob("/opt/pw-browsers/chromium-*/chrome-linux/chrome")), None)
        b = p.chromium.launch(executable_path=exe, args=["--no-sandbox"]) if exe else p.chromium.launch()
        page = b.new_page(viewport={"width": 128, "height": 128})
        for e in manifest:
            s = (OUT / "svg" / f"{e['name']}.svg").read_text(encoding="utf-8")
            page.set_content(f'<html><body style="margin:0;background:transparent">{s}</body></html>')
            page.locator("svg").screenshot(path=str(OUT / e["file"]), omit_background=True)
        b.close()
    cards = "".join(f'<figure><img src="{e["file"]}" width="64" height="64"><figcaption>{e["name"]}<br><small>{e["ar"]} · {e["en"]}</small></figcaption></figure>' for e in manifest)
    (OUT / "preview.html").write_text(
        '<meta charset="utf-8"><title>Revive emojis</title><style>body{margin:0;padding:24px;background:#0f1830;color:#e8eefc;font-family:system-ui;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px}'
        'figure{margin:0;text-align:center;padding:12px;border-radius:16px;background:#162244}figcaption{font-size:11px;margin-top:6px;word-break:break-all}small{color:#8ea0c8}</style>' + cards, encoding="utf-8")
    print(f"{len(manifest)} emojis → {OUT}")


if __name__ == "__main__":
    main()
