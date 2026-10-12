"""تعريف أقسام اللوحة | Dashboard sections.
حقل = (المفتاح، النوع، إضافي).  الأنواع:
  tx نص · ta نص طويل · bo مفتاح · ch روم · rl رتبة · cat كاتجوري · sel قائمة ثابتة · interval مدة
  qs أسئلة · ar ردود · sc اختصارات · lg لوقات · sec حماية · bw كلمات محظورة · pn عقوبة
المجموعات تُعرض كبطاقات مرتبة (عنوان + أيقونة) والعناوين في i18n تحت sec.<القسم>.groups.
"""

# القيم المخزّنة يقرأها البوت بالعربي لذلك تبقى كما هي، والعرض فقط يُترجم
COLORS = ["أزرق", "أخضر", "أحمر", "أصفر", "بنفسجي", "برتقالي", "أبيض", "أسود"]
EMBED_TYPES = ["ايمبد عادي", "ايمبد حديث"]
CARD_STYLES = ["royal", "neon", "glass", "minimal", "sunset", "aurora"]
OPTIONS = {"colors": COLORS, "embeds": EMBED_TYPES, "cardstyles": CARD_STYLES, "langs": ["ar", "en"]}
INTERVALS = [5, 10, 15, 30, 45]
NUM10 = [str(i) for i in range(1, 11)]

def G(key, icon, *fields):
    return {"key": key, "icon": icon, "fields": list(fields)}

SECTIONS = {
    "welcome": dict(icon="user-plus", slots=["1", "2"], slot_names="tabs", vars=["{server}", "{user}", "{count}"], mirror=True, groups=[
        G("msg", "message", ("channel_id", "ch"), ("status", "bo")),
        G("card", "image", ("card", "bo", True), ("card_style", "sel", "cardstyles"), ("card_bg", "tx"), ("card_title", "tx"), ("card_sub", "tx")),
        G("look", "palette", ("color", "sel", "colors"), ("embed_type", "sel", "embeds"), ("image_url", "tx"), ("embed_text", "ta"), ("outside_text", "ta")),
        G("opts", "settings", ("show_avatar", "bo"), ("ignore_bots", "bo"), ("disable_mention", "bo"))]),
    "tickets": dict(icon="ticket", slots=NUM10, modes=True, mirror=True, groups=[
        G("general", "ticket", ("name", "tx"), ("category_id", "cat"), ("image_url", "tx")),
        G("roles", "users", ("support_role_id", "rl"), ("ticket_mod_role_id", "rl")),
        G("channels", "folder", ("log_channel_id", "ch"), ("rating_channel_id", "ch")),
        G("messages", "message", ("welcome_msg", "ta")),
        G("questions", "list", ("preset", "preset"), ("questions", "qs"), ("max_open", "num"))]),
    "apply": dict(icon="clipboard", slots=NUM10, modes=True, groups=[
        G("general", "clipboard", ("name", "tx"), ("admin_role_id", "rl"), ("review_channel_id", "ch")),
        G("roles", "tag", ("given1", "rl"), ("given2", "rl"), ("removed_role_id", "rl")),
        G("messages", "message", ("accept_msg", "ta"), ("reject_msg", "ta")),
        G("questions", "list", ("questions", "qs"))]),
    "rolestatus": dict(icon="activity", groups=[
        G("channels", "folder", ("panel_channel_id", "ch"), ("channel_id", "ch")),
        G("roles", "tag", ("ping_role_id", "rl"), ("manager_role_id", "rl")),
        G("messages", "message", ("start_msg", "ta"), ("end_msg", "ta"), ("vote_msg", "ta"))]),
    "identity": dict(icon="id-card", groups=[
        G("channels", "folder", ("panel_channel_id", "ch"), ("admins_channel_id", "ch")),
        G("roles", "tag", ("add_role_id", "rl"), ("rem_role_id", "rl")),
        G("opts", "settings", ("change_nick", "bo", True))]),
    "weapons": dict(icon="crosshair", groups=[G("channels", "folder", ("panel_channel", "ch"), ("log_channel", "ch"))]),
    "traffic": dict(icon="traffic", groups=[
        G("roles", "tag", ("police_role", "rl")),
        G("channels", "folder", ("control_channel", "ch"), ("citizen_channel", "ch"), ("log_channel", "ch"))]),
    "bank": dict(icon="landmark", groups=[
        G("panels", "layers", ("account_panel_channel_id", "ch"), ("citizens_panel_channel_id", "ch"), ("staff_panel_channel_id", "ch")),
        G("ops", "coins", ("loan_channel_id", "ch"), ("log_channel_id", "ch"), ("bank_staff_role_id", "rl"))]),
    "realestate": dict(icon="building", groups=[
        G("panels", "layers", ("citizen_channel", "ch"), ("admin_channel", "ch")),
        G("ops", "folder", ("requests_channel", "ch"), ("market_channel", "ch"), ("logs_channel", "ch"))]),
    "activation": dict(icon="check-circle", groups=[
        G("channels", "folder", ("panel_channel_id", "ch"), ("staff_channel_id", "ch")),
        G("roles", "tag", ("staff_role_id", "rl"), ("add_role_id", "rl"), ("remove_role_id", "rl"))]),
    "replies": dict(icon="message", groups=[G("main", None, ("items", "ar"))]),
    "botlang": dict(icon="globe", groups=[G("main", None, ("lang", "sel", "langs"))]),
    "autorole": dict(icon="tag", groups=[G("main", None, ("role_id", "rl"))]),
    "shortcuts": dict(icon="bolt", groups=[G("main", None, ("items", "sc"))]),
    "logs": dict(icon="logs", groups=[G("main", None, ("logs", "lg"))]),
    "security": dict(icon="shield", note_icon="warn", groups=[G("main", None, ("sec", "sec"))]),
    "badwords": dict(icon="ban", note_icon="warn", groups=[G("main", None, ("words", "bw"), ("punishment", "pn"))]),
    "azkar": dict(icon="moon", groups=[G("main", None, ("channel_id", "ch"), ("interval", "interval"), ("status", "bo"))]),
    "levels": dict(icon="trending", vars=["{user}", "{level}", "{next-level}", "{xp}"], groups=[G("main", None, ("channel_id", "ch"), ("message", "ta"))]),
    "embed": dict(icon="send", groups=[
        G("target", "folder", ("channel_id", "ch"), ("color", "sel", "colors")),
        G("content", "message", ("title", "tx"), ("description", "ta"), ("image_url", "tx"), ("outside_text", "ta"))]),
}

CUSTOM = {"home": "home", "language": "globe", "themes": "palette", "emojis": "emoji", "stats": "chart", "rate": "star"}
NAV_TOP = ["home", "language", "themes", "emojis", "stats"]
NAV_GROUPS = [
    ("rp", ["rolestatus", "identity", "weapons", "traffic", "bank", "realestate"]),
    ("admin", ["tickets", "apply", "activation", "welcome", "autorole", "replies", "shortcuts", "embed", "logs", "azkar", "levels"]),
    ("sec", ["security", "badwords"]),
]
NAV_BOTTOM = ["rate"]
ADMIN_ONLY = {"security", "badwords", "azkar", "levels", "embed", "botlang"}
PANELS = {"tickets": {"list": "tickets/list", "send": "ticket-panel"}, "apply": {"list": "apply/list", "send": "apply-panel"}}

LOG_TYPES = {"members_join_remove": "log-in", "member_bans": "hammer", "member_kick": "user-x", "member_timeout": "clock", "member_roles": "tag",
             "nicknames": "pencil", "messages": "message-x", "reactions": "smile", "voice": "mic", "channels_crud": "folder-plus", "channels_update": "folder-edit",
             "roles_crud": "tag-plus", "roles_update": "tag", "invites": "link", "server_updates": "settings"}
SEC_FEATS = {"bot_add": "bot", "admin_role": "crown", "mass_ban": "hammer", "mass_kick": "user-x", "channel_delete": "folder-x",
             "role_delete": "trash", "role_create": "tag-plus", "channel_create": "folder-plus", "links": "link"}
PUNISHMENTS = ["timeout", "kick", "ban", "strip_roles"]
SC_ICONS = {"ban": "hammer", "kick": "user-x", "toggle_role": "tag", "timeout": "clock", "untimeout": "timer-off",
            "nickname": "pencil", "clear": "trash", "warn": "warn", "unban": "unlock"}

WIDE_TYPES = {"ta", "qs", "ar", "sc", "lg", "sec", "bw"}

def all_nav_keys():
    return NAV_TOP + [k for _, ks in NAV_GROUPS for k in ks] + NAV_BOTTOM
