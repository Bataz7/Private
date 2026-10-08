"""لوحة تحكم ريفايف | Revive dashboard backend (FastAPI).

الإعدادات تُقرأ من متغيرات البيئة أو من ملف .env (انظر .env.example) — لا تضع الأسرار داخل الكود.
Settings come from environment variables or a .env file (see .env.example) — never hard-code secrets.
"""
import os, sys, re, json, logging, secrets, sqlite3, urllib.parse, datetime
from pathlib import Path
import aiohttp, uvicorn, discord
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import RedirectResponse, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.sessions import SessionMiddleware
from fastapi.responses import HTMLResponse, Response

from dashboard_ui import i18n as ui_i18n, render as ui_render, schema as ui_schema, themes as ui_themes

BASE_DIR = Path(__file__).resolve().parent
WEB_DIR = BASE_DIR / "web"
EMOJI_DIR = BASE_DIR / "emojis"

def _load_env(path=BASE_DIR / ".env"):
    """قارئ .env بسيط بدون مكتبات؛ لا يستبدل المتغيرات الموجودة أصلاً."""
    try:
        for line in Path(path).read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip("\"'"))
    except OSError:
        pass
_load_env()

def _flag(name, default):
    return str(os.environ.get(name, default)).strip().lower() not in ("0", "false", "no", "off", "")

CLIENT_ID = os.environ.get("DISCORD_CLIENT_ID", "1549657352385597491")
CLIENT_SECRET = os.environ.get("DISCORD_CLIENT_SECRET", "")
# رابط الموقع الرسمي (الدومين) مثل https://dashboard.example.com — اتركه فاضي ليؤخذ من الطلب نفسه
BASE_URL = os.environ.get("DASHBOARD_URL", "").strip().rstrip("/")
if BASE_URL and "://" not in BASE_URL:
    BASE_URL = "https://" + BASE_URL
FORCE_HTTPS = _flag("FORCE_HTTPS", "1")          # حوّل أي طلب http إلى https (ضعها 0 للتجربة المحلية)
PORT = int(os.environ.get("DASHBOARD_PORT", os.environ.get("SERVER_PORT", "8080")))
SSL_CERTFILE = os.environ.get("SSL_CERTFILE") or None   # اختياري: https مباشر بدون بروكسي
SSL_KEYFILE = os.environ.get("SSL_KEYFILE") or None
API = "https://discord.com/api/v10"
SUPPORT_URL = os.environ.get("SUPPORT_URL", "https://discord.gg/ZHpPtZZsZv")
SECTIONS = {"botlang", "welcome", "tickets", "apply", "rolestatus", "realestate", "activation", "identity", "weapons", "traffic", "replies", "bank", "autorole", "embed", "shortcuts", "logs", "security", "badwords", "azkar", "levels"}

def _session_secret():
    """مفتاح الجلسات: من البيئة، وإلا يُولَّد مرة واحدة ويُحفظ في .session_secret."""
    env = os.environ.get("SESSION_SECRET")
    if env:
        return env
    f = BASE_DIR / ".session_secret"
    try:
        saved = f.read_text(encoding="utf-8").strip()
    except OSError:
        saved = ""
    if saved:
        return saved
    key = secrets.token_urlsafe(48)
    try:
        f.write_text(key, encoding="utf-8")
    except OSError:
        pass
    return key
SECRET = _session_secret()

def site_base(request: Request) -> str:
    """الدومين الذي يُبنى عليه الـ redirect_uri: DASHBOARD_URL إن وُجد، وإلا من الطلب (مع إجبار https)."""
    if BASE_URL:
        return BASE_URL
    scheme = "https" if FORCE_HTTPS else request.url.scheme
    return f"{scheme}://{request.headers.get('host') or request.url.netloc}"

def redirect_uri(request: Request) -> str:
    return site_base(request) + "/callback"

# ---------- قاعدة البيانات (يقرأ منها البوت أيضاً) ----------
db = sqlite3.connect("dashboard.db", check_same_thread=False)
db.execute("""CREATE TABLE IF NOT EXISTS settings(
    guild_id TEXT, section TEXT, slot TEXT DEFAULT '', data TEXT,
    PRIMARY KEY(guild_id, section, slot))""")

def get_settings(gid, section, slot=""):
    r = db.execute("SELECT data FROM settings WHERE guild_id=? AND section=? AND slot=?",
                   (str(gid), section, str(slot))).fetchone()
    return json.loads(r[0]) if r else {}

def save_settings(gid, section, data, slot=""):
    db.execute("REPLACE INTO settings VALUES(?,?,?,?)",
               (str(gid), section, str(slot), json.dumps(data, ensure_ascii=False)))
    db.commit()

# ---------- التطبيق ----------
app = FastAPI(docs_url=None, redoc_url=None)
app.add_middleware(SessionMiddleware, secret_key=SECRET, same_site="lax", max_age=86400, https_only=FORCE_HTTPS)

_LOCAL_HOSTS = {"localhost", "127.0.0.1", "[::1]", "::1"}

@app.middleware("http")
async def https_and_domain(request: Request, call_next):
    """يحوّل http إلى https وأي دومين آخر إلى الدومين الرسمي (DASHBOARD_URL) ويضيف HSTS."""
    host = (request.headers.get("host") or "").lower()
    if FORCE_HTTPS and host.split(":")[0] not in _LOCAL_HOSTS:
        canon = urllib.parse.urlsplit(BASE_URL).netloc.lower() if BASE_URL else host
        if request.url.scheme != "https" or host != canon:
            url = f"https://{canon}{request.url.path}" + (f"?{request.url.query}" if request.url.query else "")
            return RedirectResponse(url, status_code=308)
    resp = await call_next(request)
    if request.url.scheme == "https":
        resp.headers.setdefault("Strict-Transport-Security", "max-age=31536000")
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    return resp

# ---------- ترجمة رسائل الأخطاء (عربي / English) ----------
ERR_EN = {
    "سجّل دخولك أول": "Please sign in first",
    "ما عندك صلاحية على هذا السيرفر": "You don't have permission on this server",
    "البوت مو موجود في هذا السيرفر": "The bot is not in this server",
    "فشل تسجيل الدخول": "Login failed",
    "روم أو رتبة ما تتبع هذا السيرفر": "That channel or role doesn't belong to this server",
    "رقم غير صالح": "Invalid number",
    "السؤال لازم يكون 45 حرف أو أقل": "Each question must be 45 characters or less",
    "نوع غير صالح": "Invalid type",
    "قيمة غير صالحة": "Invalid value",
    "بيانات غير صالحة": "Invalid data",
    "عقوبة غير صالحة": "Invalid punishment",
    "قاعدة بيانات الترحيب غير جاهزة": "The welcome database isn't ready",
    "قاعدة البيانات غير جاهزة": "The database isn't ready",
    "قاعدة بيانات العقارات غير جاهزة": "The real estate database isn't ready",
    "المدة غير صالحة": "Invalid interval",
    "اختر مدة من 5 أو 10 أو 15 أو 30 أو 45 دقيقة": "Pick an interval of 5, 10, 15, 30 or 45 minutes",
    "روم الأذكار ما يتبع هذا السيرفر": "The Azkar channel doesn't belong to this server",
    "حدد روم الأذكار عند تفعيل النظام": "Select the Azkar channel when enabling the system",
    "قاعدة بيانات الأذكار غير جاهزة": "The Azkar database isn't ready",
    "حدد روم نصي صالح للمستويات": "Select a valid text channel for levels",
    "اكتب رسالة المستويات": "Write the level-up message",
    "رسالة المستويات 2000 حرف كحد أقصى": "The level message is limited to 2000 characters",
    "قاعدة بيانات المستويات غير جاهزة": "The levels database isn't ready",
    "حدّث ملف الردود reply.py بالنسخة الجديدة أول": "Update reply.py to the new version first",
    "كل رد لازم له كلمة مفتاحية ونص": "Every reply needs a keyword and a response",
    "الكلمة 100 حرف والرد 2000 حرف كحد أقصى": "Keyword max 100 characters, response max 2000",
    "قاعدة بيانات البنك غير جاهزة": "The bank database isn't ready",
    "حدد روم إرسال بانل حالة الرول": "Select the channel for the role status panel",
    "حدد روم إرسال بانل الهوية": "Select the channel for the identity panel",
    "حدد روم إرسال بانل الأسلحة": "Select the channel for the weapons panel",
    "حدد روم بانل العساكر أو روم بانل المواطنين": "Select the police panel channel or the citizens panel channel",
    "هذي الرتبة ما تنفع كرتبة تلقائية": "This role can't be used as an auto role",
    "الرتبة أعلى من رتبة البوت أو تساويها، ارفع رتبة البوت فوقها أول": "The role is higher than or equal to the bot's role — move the bot's role above it first",
    "قاعدة بيانات الرتبة التلقائية غير جاهزة": "The auto role database isn't ready",
    "إرسال الايمبد للأدمن فقط": "Only admins can send embeds",
    "العنوان 256 حرف والوصف 4000 حرف كحد أقصى": "Title max 256 characters, description max 4000",
    "رابط الصورة لازم يبدأ بـ http أو https": "The image URL must start with http or https",
    "النص الخارجي 2000 حرف كحد أقصى": "The outside text is limited to 2000 characters",
    "تعذر الإرسال، تأكد من صلاحيات البوت في الروم": "Couldn't send — check the bot's permissions in the channel",
    "كل اختصار لازم له اسم ونوع أمر": "Every shortcut needs a name and a command type",
    "نوع الأمر غير مدعوم": "Unsupported command type",
    "الاختصار 50 حرف والأمر 100 حرف كحد أقصى": "Shortcut max 50 characters, command max 100",
    "قاعدة بيانات الاختصارات غير جاهزة": "The shortcuts database isn't ready",
    "اللوق لازم يكون في روم نصي من هذا السيرفر": "Logs must go to a text channel of this server",
    "قاعدة بيانات اللوقات غير جاهزة": "The logs database isn't ready",
    "قاعدة بيانات الحماية غير جاهزة": "The protection database isn't ready",
    "تعديل هذا القسم للأدمن فقط": "Only admins can edit this section",
    "الكلمة أطول من 100 حرف": "The word is longer than 100 characters",
    "الحد الأقصى 500 كلمة": "Maximum 500 words",
    "قاعدة بيانات الكلمات المحظورة غير جاهزة": "The blocked words database isn't ready",
    "حدد روم نصي صالح": "Select a valid text channel",
    "اكتب عنوان ووصف البانل": "Write the panel title and description",
    "اختر عنصر واحد على الأقل": "Select at least one item",
    "تعذر إرسال البانل، تأكد من صلاحيات البوت في الروم": "Couldn't send the panel — check the bot's permissions in the channel",
    "اختر من 1 إلى 5 نجوم": "Choose 1 to 5 stars",
}
ERR_PREFIX_EN = [
    ("متغير غير معروف: ", "Unknown variable: "),
    ("الاختصار لازم يكون كلمة وحدة بدون مسافات: ", "A shortcut must be a single word without spaces: "),
    ("الاختصار مكرر: ", "Duplicate shortcut: "),
    ("الكلمة لازم تكون حرفين على الأقل: ", "A word must be at least 2 characters: "),
]
SYSTEM_EN = {"نظام العقارات": "Real estate system", "نظام التفعيل": "Activation system", "نظام البنك": "Bank system",
             "نظام حالة الرول": "Role status system", "نظام الهوية": "Identity system", "نظام الأسلحة": "Weapons system",
             "نظام المرور": "Traffic system"}

def translate_error(msg: str, lang: str) -> str:
    if lang != "en" or msg.startswith("REQ:"):
        return msg
    if msg in ERR_EN:
        return ERR_EN[msg]
    for ar, en in ERR_PREFIX_EN:
        if msg.startswith(ar):
            return en + msg[len(ar):]
    m = re.fullmatch(r"(.+) غير محمّل في البوت", msg)
    if m:
        return f"{SYSTEM_EN.get(m.group(1), m.group(1))} isn't loaded in the bot"
    m = re.fullmatch(r"حدّث ملف (.+) أول", msg)
    if m:
        return f"Update {m.group(1)} first"
    m = re.match(r"تعذر إرسال بانل (\S+): (.*)", msg, re.S)
    if m:
        return f"Couldn't send the {m.group(1)} panel: {SYSTEM_EN.get(m.group(2), m.group(2))}"
    return msg

def req_lang(request: Request) -> str:
    return "en" if (request.headers.get("x-lang") or request.cookies.get("lang") or "").lower().startswith("en") else "ar"

@app.exception_handler(StarletteHTTPException)
async def http_error(request: Request, exc: StarletteHTTPException):
    detail = translate_error(exc.detail, req_lang(request)) if isinstance(exc.detail, str) else exc.detail
    return JSONResponse({"detail": detail}, status_code=exc.status_code, headers=getattr(exc, "headers", None))

def user_or_401(request: Request):
    u = request.session.get("user")
    if not u:
        raise HTTPException(401, "سجّل دخولك أول")
    return u

def guild_or_403(request: Request, gid: str):
    user_or_401(request)
    if gid not in request.session.get("guilds", []):
        raise HTTPException(403, "ما عندك صلاحية على هذا السيرفر")
    g = request.app.state.bot.get_guild(int(gid))
    if not g:
        raise HTTPException(404, "البوت مو موجود في هذا السيرفر")
    return g

@app.get("/login")
async def login(request: Request):
    state = secrets.token_urlsafe(24)
    request.session["oauth_state"] = state
    q = urllib.parse.urlencode({"client_id": CLIENT_ID, "redirect_uri": redirect_uri(request),
                                "response_type": "code", "scope": "identify guilds", "state": state})
    return RedirectResponse(f"https://discord.com/oauth2/authorize?{q}")

@app.get("/invite")
async def invite():
    q = urllib.parse.urlencode({"client_id": CLIENT_ID, "permissions": 8, "scope": "bot applications.commands"})
    return RedirectResponse(f"https://discord.com/oauth2/authorize?{q}")

@app.get("/callback")
async def callback(request: Request, code: str = "", state: str = "", error: str = ""):
    expected = request.session.pop("oauth_state", None)
    if error or not code:
        return RedirectResponse("/")  # المستخدم ألغى الدخول
    if not expected or not secrets.compare_digest(expected, state or ""):
        raise HTTPException(400, "فشل تسجيل الدخول")
    async with aiohttp.ClientSession() as s:
        async with s.post(f"{API}/oauth2/token", data={
            "client_id": CLIENT_ID, "client_secret": CLIENT_SECRET, "grant_type": "authorization_code",
            "code": code, "redirect_uri": redirect_uri(request)}) as r:
            if r.status != 200:
                raise HTTPException(400, "فشل تسجيل الدخول")
            token = (await r.json())["access_token"]
        h = {"Authorization": f"Bearer {token}"}
        async with s.get(f"{API}/users/@me", headers=h) as r:
            user = await r.json()
        async with s.get(f"{API}/users/@me/guilds", headers=h) as r:
            guilds = await r.json()
    avatar_hash = user.get("avatar")
    if avatar_hash:
        ext = "gif" if str(avatar_hash).startswith("a_") else "png"
        avatar_url = f"https://cdn.discordapp.com/avatars/{user['id']}/{avatar_hash}.{ext}?size=256"
    else:
        avatar_url = f"https://cdn.discordapp.com/embed/avatars/{(int(user['id']) >> 22) % 6}.png"
    request.session["user"] = {
        "id": user["id"],
        "name": user["username"],
        "global_name": user.get("global_name") or user["username"],
        "avatar": avatar_url,
    }
    # نحتفظ بالسيرفرات التي يملكها المستخدم أو لديه فيها صلاحية إدارة السيرفر
    # owner مهم لأن Discord قد لا يعيد OWNER بصلاحية إدارة ضمن permissions في بعض الحالات.
    request.session["guilds"] = [
        g["id"] for g in guilds
        if bool(g.get("owner")) or (int(g.get("permissions", 0)) & (0x8 | 0x20))
    ]
    return RedirectResponse("/dashboard")  # بعد تسجيل الدخول يفتح صفحة لوحة التحكم

# ---------- الصفحات (Python يبنيها بقوالب Jinja2) ----------
def get_lang(request: Request) -> str:
    return ui_i18n.pick_lang(request.cookies.get("lang"), request.headers.get("accept-language"))

def page_ctx(request: Request, **extra):
    theme = request.cookies.get("theme")
    return dict(lang=get_lang(request), user=request.session.get("user"), support_url=SUPPORT_URL,
                theme=theme if theme in ui_themes.ORDER else "royal", fx_off=request.cookies.get("fx") == "0", **extra)

def html_page(template: str, request: Request, **extra):
    ctx = page_ctx(request, **extra)
    lang = ctx.pop("lang")
    return HTMLResponse(ui_render.page(template, lang, **ctx), headers={"Cache-Control": "no-store"})

@app.get("/")
async def landing_page(request: Request):
    return html_page("landing.html", request)

@app.get("/team")
@app.get("/team.html")
async def team_page(request: Request):
    return html_page("team.html", request)

def user_guild_list(request: Request):
    bot = request.app.state.bot
    out = []
    for gid in request.session.get("guilds", []):
        g = bot.get_guild(int(gid))
        if g:
            out.append({"id": gid, "name": g.name})
    return out

@app.get("/dashboard")
@app.get("/dashboard/")
async def dashboard_page(request: Request):
    if not request.session.get("user"):
        return RedirectResponse("/login")
    guilds = user_guild_list(request)
    saved = request.cookies.get("gid")
    gid = saved if any(x["id"] == saved for x in guilds) else (guilds[0]["id"] if guilds else "")
    return html_page("dashboard.html", request, guilds=guilds, gid=gid)

@app.get("/assets/i18n.js")
async def i18n_js():
    return Response(ui_i18n.js_bundle(), media_type="application/javascript", headers={"Cache-Control": "no-cache"})

@app.get("/assets/css/themes.css")
async def themes_css():
    return Response(ui_themes.css(), media_type="text/css", headers={"Cache-Control": "no-cache"})

@app.get("/logout")
async def logout(request: Request):
    request.session.clear()
    return RedirectResponse("/")

@app.get("/api/me")
async def me(request: Request):
    return user_or_401(request)

@app.get("/api/guilds")
async def guilds(request: Request):
    user_or_401(request)
    out = []
    bot = request.app.state.bot
    for gid in request.session.get("guilds", []):
        g = bot.get_guild(int(gid))
        if g:
            out.append({"id": gid, "name": g.name, "icon": g.icon.url if g.icon else None, "bot_present": True})
    return out

@app.get("/api/stats")
async def stats(request: Request):
    user_or_401(request)
    bot = request.app.state.bot
    return {"guilds": len(bot.guilds)}

@app.get("/api/guilds/{gid}/meta")
async def meta(gid: str, request: Request):
    g = guild_or_403(request, gid)
    return {
        "channels": [{"id": str(c.id), "name": c.name} for c in g.text_channels],
        "categories": [{"id": str(c.id), "name": c.name} for c in g.categories],
        "roles": [{"id": str(r.id), "name": r.name} for r in g.roles
                  if not r.is_default() and not r.managed],
    }

# ---------- جسر الربط مع ملفات البوت الحالية ----------
def jload(f):
    try:
        with open(f, encoding="utf-8") as x:
            return json.load(x)
    except Exception:
        return {}

def jsave(f, d):
    with open(f, "w", encoding="utf-8") as x:
        json.dump(d, x, ensure_ascii=False, indent=4)

def sid(v):
    return str(v) if v else ""

def clean(g, d, text, ids, req):
    o = {}
    for k in text:
        v = d.get(k)
        o[k] = (v.strip() if isinstance(v, str) else v) or None
    for k in ids:
        v = d.get(k)
        v = int(v) if str(v or "").isdigit() else None
        if v and not (g.get_channel(v) or g.get_role(v)):
            raise HTTPException(400, "روم أو رتبة ما تتبع هذا السيرفر")
        o[k] = v
    for k in req:
        if not o.get(k):
            raise HTTPException(400, "REQ:" + k)
    return o

def slot_ok(s, n):
    if s not in [str(i) for i in range(1, n + 1)]:
        raise HTTPException(400, "رقم غير صالح")

# التذاكر: tickets_data.json  {guild: {num: {...}}}
TKF = "tickets_data.json"
TK_IDS = ["category_id", "support_role_id", "ticket_mod_role_id", "log_channel_id", "rating_channel_id", "panel_channel_id"]
def r_tk(g, s):
    d = jload(TKF).get(str(g.id), {}).get(s) or {}
    return {k: (sid(v) if k in TK_IDS else v) for k, v in d.items()}
def w_tk(g, s, d):
    slot_ok(s, 10)
    o = clean(g, d, ["name", "welcome_msg", "image_url", "preset"], TK_IDS,
              ["name", "category_id", "support_role_id", "ticket_mod_role_id", "log_channel_id"])
    try:
        from core.ticket_presets import PRESETS
    except Exception:
        PRESETS = {}
    if o.get("preset") and o["preset"] not in PRESETS:
        o["preset"] = None
    o["questions"] = [q.strip()[:45] for q in (d.get("questions") or []) if isinstance(q, str) and q.strip()][:5]
    try:
        o["max_open"] = max(1, min(5, int(d.get("max_open") or 1)))
    except (TypeError, ValueError):
        o["max_open"] = 1
    a = jload(TKF); a.setdefault(str(g.id), {})[s] = o; jsave(TKF, a)

# التقديمات: apply_data.json  {guild: {num: {...}}}
APF = "apply_data.json"
def r_ap(g, s):
    d = jload(APF).get(str(g.id), {}).get(s) or {}
    if not isinstance(d, dict) or not d:
        return {}
    gr = list(d.get("given_roles_ids") or []) + [None, None]
    return {"name": d.get("name"), "admin_role_id": sid(d.get("admin_role_id")),
            "review_channel_id": sid(d.get("review_channel_id")), "accept_msg": d.get("accept_msg"),
            "reject_msg": d.get("reject_msg"), "given1": sid(gr[0]), "given2": sid(gr[1]),
            "removed_role_id": sid(d.get("removed_role_id")), "panel_channel_id": sid(d.get("panel_channel_id")), "questions": d.get("questions") or []}
def w_ap(g, s, d):
    slot_ok(s, 10)
    o = clean(g, d, ["name", "accept_msg", "reject_msg"], ["admin_role_id", "review_channel_id", "removed_role_id", "given1", "given2", "panel_channel_id"],
              ["name", "admin_role_id", "review_channel_id", "accept_msg", "reject_msg"])
    qs = [q.strip() for q in (d.get("questions") or []) if isinstance(q, str) and q.strip()][:5]
    if not qs:
        raise HTTPException(400, "REQ:questions")
    if any(len(q) > 45 for q in qs):
        raise HTTPException(400, "السؤال لازم يكون 45 حرف أو أقل")
    row = {"num": s, "name": o["name"][:90], "admin_role_id": o["admin_role_id"], "review_channel_id": o["review_channel_id"],
           "accept_msg": o["accept_msg"], "reject_msg": o["reject_msg"],
           "given_roles_ids": [x for x in (o["given1"], o["given2"]) if x], "removed_role_id": o["removed_role_id"], "panel_channel_id": o["panel_channel_id"],
           "questions": qs}
    a = jload(APF); a.setdefault(str(g.id), {})[s] = row; jsave(APF, a)

# حالة الرول: roleplay_data.json  {guild: {...}}
RPF = "roleplay_data.json"
RP_IDS = ["panel_channel_id", "channel_id", "ping_role_id", "manager_role_id"]
def r_rp(g, s):
    d = jload(RPF).get(str(g.id), {})
    return {k: (sid(v) if k in RP_IDS else v) for k, v in d.items() if k != "last_status_msg_id"}
def w_rp(g, s, d):
    o = clean(g, d, ["start_msg", "end_msg", "vote_msg"], RP_IDS, ["channel_id"])
    a = jload(RPF); cur = a.get(str(g.id), {}); cur.update(o); a[str(g.id)] = cur; jsave(RPF, a)

# الترحيب والمغادرة: welcome_goodbye.db (النوع 1 = ترحيب، 2 = مغادرة)
WT = {"1": "welcome", "2": "goodbye"}
COLORS = ["أزرق", "أخضر", "أحمر", "أصفر", "بنفسجي", "برتقالي", "أبيض", "أسود"]
EMBEDS = ["ايمبد عادي", "ايمبد حديث"]
BOOLS = ["show_avatar", "ignore_bots", "disable_mention", "status"]
WL_STYLES = ["royal", "neon", "glass", "minimal", "sunset", "aurora"]
def r_wl(g, s):
    try:
        c = sqlite3.connect("welcome_goodbye.db"); c.row_factory = sqlite3.Row
        r = c.execute("SELECT * FROM welcome_settings WHERE guild_id=? AND type=?", (g.id, WT.get(s))).fetchone(); c.close()
    except sqlite3.Error:
        return {}
    if not r:
        return {}
    d = dict(r); d["channel_id"] = sid(d.get("channel_id"))
    for k in BOOLS:
        d[k] = bool(d.get(k))
    d["card"] = bool(d.get("card", 1)) if d.get("card") is not None else True
    d["card_style"] = d.get("card_style") or "royal"
    return d
def w_wl(g, s, d):
    if s not in WT:
        raise HTTPException(400, "نوع غير صالح")
    o = clean(g, d, ["color", "embed_type", "image_url", "embed_text", "outside_text"], ["channel_id"], ["channel_id", "color", "embed_type"])
    if o["color"] not in COLORS or o["embed_type"] not in EMBEDS:
        raise HTTPException(400, "قيمة غير صالحة")
    b = [1 if d.get(k) else 0 for k in BOOLS]
    card = {"card": 1 if d.get("card", True) else 0, "card_style": d.get("card_style") if d.get("card_style") in WL_STYLES else "royal",
            "card_bg": (d.get("card_bg") or "").strip() or None, "card_title": (d.get("card_title") or "").strip()[:40] or None, "card_sub": (d.get("card_sub") or "").strip()[:70] or None}
    if card["card_bg"] and not card["card_bg"].startswith(("http://", "https://")):
        raise HTTPException(400, "رابط الصورة لازم يبدأ بـ http أو https")
    try:
        c = sqlite3.connect("welcome_goodbye.db")
        have = {r[1] for r in c.execute("PRAGMA table_info(welcome_settings)")}
        for col, ddl in (("card", "INTEGER DEFAULT 1"), ("card_style", "TEXT DEFAULT 'royal'"), ("card_bg", "TEXT"), ("card_title", "TEXT"), ("card_sub", "TEXT")):
            if col not in have:
                c.execute(f"ALTER TABLE welcome_settings ADD COLUMN {col} {ddl}")
        c.execute("""INSERT INTO welcome_settings(guild_id,type,channel_id,color,show_avatar,ignore_bots,disable_mention,embed_type,image_url,embed_text,outside_text,status,card,card_style,card_bg,card_title,card_sub)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(guild_id,type) DO UPDATE SET channel_id=excluded.channel_id,color=excluded.color,
            show_avatar=excluded.show_avatar,ignore_bots=excluded.ignore_bots,disable_mention=excluded.disable_mention,embed_type=excluded.embed_type,
            image_url=excluded.image_url,embed_text=excluded.embed_text,outside_text=excluded.outside_text,status=excluded.status,
            card=excluded.card,card_style=excluded.card_style,card_bg=excluded.card_bg,card_title=excluded.card_title,card_sub=excluded.card_sub""",
            (g.id, WT[s], o["channel_id"], o["color"], b[0], b[1], b[2], o["embed_type"], o["image_url"], o["embed_text"], o["outside_text"], b[3],
             card["card"], card["card_style"], card["card_bg"], card["card_title"], card["card_sub"]))
        c.commit(); c.close()
    except sqlite3.Error:
        raise HTTPException(500, "قاعدة بيانات الترحيب غير جاهزة")

# الهوية: id_data.json  {guild: {...}} (يحافظ على قائمة من قدّموا سابقاً)
IDF = "id_data.json"
ID_IDS = ["admins_channel_id", "add_role_id", "rem_role_id", "panel_channel_id"]
def r_id(g, s):
    d = jload(IDF)
    if not isinstance(d, dict):
        return {}
    o = {k: sid(d.get(k)) for k in ID_IDS}
    o["change_nick"] = bool(d.get("change_nick", True))
    return o
def w_id(g, s, d):
    o = clean(g, d, [], ID_IDS, ["admins_channel_id"])
    # id.py currently uses a single top-level configuration. Keep that format
    # so the live bot and the dashboard use the exact same settings.
    a = jload(IDF)
    if not isinstance(a, dict):
        a = {}
    submitted = a.get("submitted", [])
    a.update(o)
    a["submitted"] = submitted if isinstance(submitted, list) else []
    a["change_nick"] = bool(d.get("change_nick", True))
    jsave(IDF, a)

# جداول إعدادات بسيطة (صف لكل سيرفر)
def simple(db, table, cols):
    def r(g, s):
        try:
            c = sqlite3.connect(db)
            x = c.execute(f"SELECT {','.join(cols)} FROM {table} WHERE guild_id=?", (g.id,)).fetchone(); c.close()
        except sqlite3.Error:
            return {}
        return {k: sid(v) for k, v in zip(cols, x)} if x else {}
    def w(g, s, d):
        o = clean(g, d, [], cols, cols)
        try:
            c = sqlite3.connect(db)
            c.execute(f"INSERT OR REPLACE INTO {table}(guild_id,{','.join(cols)}) VALUES(?{',?' * len(cols)})", (g.id, *[o[k] for k in cols]))
            c.commit(); c.close()
        except sqlite3.Error:
            raise HTTPException(500, "قاعدة البيانات غير جاهزة")
    return r, w

# ---------- العقارات: real_estate.db (جدول settings: key, channel_id) ----------
REDB = "real_estate.db"
RE_KEYS = ["citizen_channel", "admin_channel", "requests_channel", "market_channel", "logs_channel"]
def r_re(g, s):
    try:
        c = sqlite3.connect(REDB)
        rows = dict(c.execute("SELECT key, channel_id FROM settings").fetchall()); c.close()
    except sqlite3.Error:
        return {}
    return {k: sid(rows.get(k)) for k in RE_KEYS if rows.get(k)}
def w_re(g, s, d):
    o = clean(g, d, [], RE_KEYS, ["requests_channel", "market_channel", "logs_channel"])
    try:
        c = sqlite3.connect(REDB)
        c.execute("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, channel_id INTEGER)")
        for k in RE_KEYS:
            if o[k]:
                c.execute("INSERT OR REPLACE INTO settings (key, channel_id) VALUES (?, ?)", (k, o[k]))
            else:
                c.execute("DELETE FROM settings WHERE key=?", (k,))
        c.commit(); c.close()
    except sqlite3.Error:
        raise HTTPException(500, "قاعدة بيانات العقارات غير جاهزة")

# الأذكار: azkar_settings.db (نفس قاعدة azkhar.py)
AZKDB = "azkar_settings.db"
def r_azkar(g, s):
    try:
        c = sqlite3.connect(AZKDB, timeout=10); c.row_factory = sqlite3.Row
        r = c.execute("SELECT channel_id, interval_minutes, status FROM server_azkar WHERE guild_id=?", (g.id,)).fetchone(); c.close()
    except sqlite3.Error:
        return {}
    if not r:
        return {"channel_id": "", "interval": 15, "status": False}
    return {"channel_id": sid(r["channel_id"]), "interval": int(r["interval_minutes"] or 15), "status": str(r["status"]).upper() == "TRUE"}

def w_azkar(g, s, d):
    try:
        interval = int(d.get("interval") or 15)
    except (TypeError, ValueError):
        raise HTTPException(400, "المدة غير صالحة")
    if interval not in (5, 10, 15, 30, 45):
        raise HTTPException(400, "اختر مدة من 5 أو 10 أو 15 أو 30 أو 45 دقيقة")
    enabled = bool(d.get("status"))
    raw = str(d.get("channel_id") or "")
    channel_id = int(raw) if raw.isdigit() else 0
    if channel_id and not g.get_channel(channel_id):
        raise HTTPException(400, "روم الأذكار ما يتبع هذا السيرفر")
    if enabled and not channel_id:
        raise HTTPException(400, "حدد روم الأذكار عند تفعيل النظام")
    try:
        c = sqlite3.connect(AZKDB, timeout=10)
        c.execute("""CREATE TABLE IF NOT EXISTS server_azkar (
            guild_id INTEGER PRIMARY KEY, channel_id INTEGER,
            interval_minutes INTEGER DEFAULT 15, status TEXT DEFAULT 'FALSE'
        )""")
        c.execute("""INSERT INTO server_azkar(guild_id, channel_id, interval_minutes, status)
            VALUES(?,?,?,?)
            ON CONFLICT(guild_id) DO UPDATE SET channel_id=excluded.channel_id,
            interval_minutes=excluded.interval_minutes, status=excluded.status""",
            (g.id, channel_id, interval, "TRUE" if enabled else "FALSE"))
        c.commit(); c.close()
    except sqlite3.Error:
        raise HTTPException(500, "قاعدة بيانات الأذكار غير جاهزة")

# المستويات: levels_settings.db (نفس قاعدة levels.py)
LVDB = "levels_settings.db"
LEVEL_DEFAULT = "مبروك {user}، لقد صعدت إلى المستوى {level}! (المستوى القادم: {next-level})"
def r_levels(g, s):
    try:
        c = sqlite3.connect(LVDB, timeout=10); c.row_factory = sqlite3.Row
        r = c.execute("SELECT channel_id, custom_message FROM server_levels_settings WHERE guild_id=?", (g.id,)).fetchone(); c.close()
    except sqlite3.Error:
        return {}
    if not r:
        return {"channel_id": "", "message": LEVEL_DEFAULT}
    return {"channel_id": sid(r["channel_id"]), "message": r["custom_message"] or LEVEL_DEFAULT}

def w_levels(g, s, d):
    channel_id = str(d.get("channel_id") or "")
    if not channel_id.isdigit() or not g.get_channel(int(channel_id)):
        raise HTTPException(400, "حدد روم نصي صالح للمستويات")
    message = str(d.get("message") or "").strip()
    if not message:
        raise HTTPException(400, "اكتب رسالة المستويات")
    if len(message) > 2000:
        raise HTTPException(400, "رسالة المستويات 2000 حرف كحد أقصى")
    allowed = {"{user}", "{level}", "{next-level}", "{xp}"}
    import re
    fields = set(re.findall(r"\{[^{}]+\}", message))
    unknown = fields - allowed
    if unknown:
        raise HTTPException(400, "متغير غير معروف: " + ", ".join(sorted(unknown)))
    try:
        c = sqlite3.connect(LVDB, timeout=10)
        c.execute("""CREATE TABLE IF NOT EXISTS server_levels_settings (
            guild_id INTEGER PRIMARY KEY, channel_id INTEGER,
            custom_message TEXT
        )""")
        c.execute("""INSERT INTO server_levels_settings(guild_id, channel_id, custom_message)
            VALUES(?,?,?) ON CONFLICT(guild_id) DO UPDATE SET channel_id=excluded.channel_id, custom_message=excluded.custom_message""",
            (g.id, int(channel_id), message))
        c.commit(); c.close()
    except sqlite3.Error:
        try: c.close()
        except Exception: pass
        raise HTTPException(500, "قاعدة بيانات المستويات غير جاهزة")

# إعدادات الأسلحة والمرور (تُقرأ أيضاً من مرسل البانلات)
WPN_RW = simple("weapons.db", "weapon_settings", ["panel_channel", "log_channel"])
TRF_RW = simple("bank_traffic.db", "traffic_settings", ["police_role", "control_channel", "citizen_channel", "log_channel"])
def r_wpn(g, s):
    return WPN_RW[0](g, s)
def r_traffic(g, s):
    return TRF_RW[0](g, s)

# ---------- إرسال البانلات بعد الحفظ ----------
db.execute("""CREATE TABLE IF NOT EXISTS panels(
    guild_id TEXT, section TEXT, slot TEXT, channel_id TEXT, message_id TEXT,
    PRIMARY KEY(guild_id, section, slot))""")

async def replace_panel(g, section, slot, ch, **kw):
    """يحذف البانل القديمة (إن وجدت) ويرسل الجديدة، عشان ما تتكرر مع كل حفظ."""
    r = db.execute("SELECT channel_id, message_id FROM panels WHERE guild_id=? AND section=? AND slot=?",
                   (str(g.id), section, slot)).fetchone()
    if r:
        try:
            old = g.get_channel(int(r[0]))
            await (await old.fetch_message(int(r[1]))).delete()
        except Exception:
            pass
    msg = await ch.send(**kw)
    db.execute("REPLACE INTO panels VALUES(?,?,?,?,?)", (str(g.id), section, slot, str(ch.id), str(msg.id)))
    db.commit()

async def panel_re(bot, g, slot):
    m = find_mod(bot, "AdminPanelView", "نظام العقارات")
    d = r_re(g, "")
    items = [
        ("admin_channel", "admin", m.AdminPanelView, discord.Embed(
            title="🏢 إدارة العقارات والمحلات",
            description="لوحة تحكم المسؤولين\n\nمن هنا تقدر تدير جميع العقارات والمحلات وأرباحها والطلبات.",
            color=discord.Color.from_rgb(43, 45, 49))),
        ("citizen_channel", "citizen", m.CitizenPanelView, discord.Embed(
            title="🏡 سوق العقارات والمحلات والممتلكات",
            description="اختر القسم المطلوب للاستعراض أو الشراء، أو استعرض ممتلكاتك، أو استلم أرباح محلاتك من القائمة أدناه:",
            color=discord.Color.green())),
    ]
    n = 0
    for key, name, view, emb in items:
        ch = g.get_channel(int(d[key])) if d.get(key) else None
        if ch:
            await replace_panel(g, "realestate", name, ch, embed=emb, view=view()); n += 1
    return n

# الأقسام الأخرى تسجّل دالتها من الكوج: bot.dashboard_panels["tickets"] = async def f(bot, g, slot)
def find_mod(bot, attr, name):
    for c in bot.cogs.values():
        m = sys.modules.get(type(c).__module__)
        if m and hasattr(m, attr):
            return m
    raise RuntimeError(name + " غير محمّل في البوت")

# التفعيل: activation_settings.json (يقرأه كوج apply_2 لكل سيرفر)
ACF = "activation_settings.json"
AC_IDS = ["panel_channel_id", "staff_channel_id", "add_role_id", "remove_role_id", "staff_role_id"]
def r_ac(g, s):
    d = jload(ACF).get(str(g.id)) or {}
    return {k: sid(d.get(k)) for k in AC_IDS if d.get(k)}
def w_ac(g, s, d):
    o = clean(g, d, [], AC_IDS, ["staff_channel_id"])
    a = jload(ACF); a[str(g.id)] = o; jsave(ACF, a)

async def panel_ac(bot, g, slot):
    m = find_mod(bot, "build_panel_embed", "نظام التفعيل")
    d = r_ac(g, "")
    ch = g.get_channel(int(d["panel_channel_id"])) if d.get("panel_channel_id") else None
    if not ch:
        return 0
    await replace_panel(g, "activation", "", ch, embed=m.build_panel_embed(g), view=m.ApplyPanelView())
    return 1

# الردود التلقائية: auto_responses.json  {guild: {keyword: {response, match_type, mention}}}
ARF = "auto_responses.json"
def ar_legacy(a):
    return any(isinstance(v, dict) and "response" in v and "match_type" in v for v in a.values())
def r_ar(g, s):
    a = jload(ARF)
    if ar_legacy(a):
        return {"items": [], "legacy": True}
    return {"items": [{"keyword": k, "response": v.get("response", ""), "match_type": v.get("match_type", "contains"),
                       "mention": v.get("mention") == "true"} for k, v in (a.get(str(g.id)) or {}).items()]}
def w_ar(g, s, d):
    a = jload(ARF)
    if ar_legacy(a):
        raise HTTPException(409, "حدّث ملف الردود reply.py بالنسخة الجديدة أول")
    new = {}
    for it in (d.get("items") or []):
        if not isinstance(it, dict):
            continue
        k = str(it.get("keyword") or "").lower().strip(); r = str(it.get("response") or "").strip()
        if not k and not r:
            continue
        if not k or not r:
            raise HTTPException(400, "كل رد لازم له كلمة مفتاحية ونص")
        if len(k) > 100 or len(r) > 2000:
            raise HTTPException(400, "الكلمة 100 حرف والرد 2000 حرف كحد أقصى")
        new[k] = {"response": r, "match_type": "exact" if it.get("match_type") == "exact" else "contains",
                  "mention": "true" if it.get("mention") else "false"}
    a[str(g.id)] = new; jsave(ARF, a)

# البنك: bank.db (جدول guild_settings لكل سيرفر)
BKDB = "bank.db"
BK_IDS = ["account_panel_channel_id", "citizens_panel_channel_id", "staff_panel_channel_id",
          "loan_channel_id", "log_channel_id", "bank_staff_role_id"]
def bk_cols(c):
    for k in BK_IDS:
        try:
            c.execute(f"ALTER TABLE guild_settings ADD COLUMN {k} INTEGER")
        except sqlite3.OperationalError:
            pass
def r_bk(g, s):
    try:
        c = sqlite3.connect(BKDB, timeout=10); c.row_factory = sqlite3.Row
        bk_cols(c)
        r = c.execute(f"SELECT {','.join(BK_IDS)} FROM guild_settings WHERE guild_id=?", (g.id,)).fetchone(); c.close()
    except sqlite3.Error:
        return {}
    return {k: sid(r[k]) for k in BK_IDS if r and r[k]}
def w_bk(g, s, d):
    o = clean(g, d, [], BK_IDS, [])
    try:
        c = sqlite3.connect(BKDB, timeout=10)
        c.execute("CREATE TABLE IF NOT EXISTS guild_settings (guild_id INTEGER PRIMARY KEY, loan_channel_id INTEGER, log_channel_id INTEGER, bank_staff_role_id INTEGER)")
        bk_cols(c)
        c.execute("INSERT OR IGNORE INTO guild_settings(guild_id) VALUES(?)", (g.id,))
        c.execute(f"UPDATE guild_settings SET {','.join(k + '=?' for k in BK_IDS)} WHERE guild_id=?", (*[o[k] for k in BK_IDS], g.id))
        c.commit(); c.close()
    except sqlite3.Error:
        raise HTTPException(500, "قاعدة بيانات البنك غير جاهزة")

async def panel_bk(bot, g, slot):
    m = find_mod(bot, "create_account_embed", "نظام البنك")
    d = r_bk(g, "")
    items = [("account_panel_channel_id", "account", m.create_account_embed, m.CreateAccountView),
             ("citizens_panel_channel_id", "citizens", m.create_citizen_embed, m.CitizenServicesView),
             ("staff_panel_channel_id", "staff", m.create_staff_embed, m.BankStaffView)]
    n = 0
    for key, name, emb, view in items:
        ch = g.get_channel(int(d[key])) if d.get(key) else None
        if not ch:
            continue
        r = db.execute("SELECT channel_id, message_id FROM panels WHERE guild_id=? AND section='bank' AND slot=?",
                       (str(g.id), name)).fetchone()
        if r and r[0] == str(ch.id):  # نفس الروم والرسالة موجودة: ما نعيد الإرسال
            try:
                await ch.fetch_message(int(r[1])); continue
            except Exception:
                pass
        await replace_panel(g, "bank", name, ch, embed=emb(), view=view()); n += 1
    return n

async def panel_role_status(bot, g, slot):
    m = find_mod(bot, "RPView", "نظام حالة الرول")
    d = r_rp(g, "")
    cid = str(d.get("panel_channel_id") or "")
    ch = g.get_channel(int(cid)) if cid.isdigit() else None
    if not ch:
        raise HTTPException(400, "حدد روم إرسال بانل حالة الرول")
    emb = discord.Embed(
        title="🎮 لوحة تحكم إدارة الرول بلاي",
        description="اختر الحالة المناسبة من القائمة المنسدلة بالأسفل لتحديث حالة الرول مباشرة في الروم المخصص.",
        color=discord.Color.dark_embed()
    )
    await replace_panel(g, "rolestatus", "main", ch, embed=emb, view=m.RPView(bot))
    return 1

async def panel_identity(bot, g, slot):
    m = find_mod(bot, "IDSelectView", "نظام الهوية")
    d = r_id(g, "")
    cid = str(d.get("panel_channel_id") or "")
    ch = g.get_channel(int(cid)) if cid.isdigit() else None
    if not ch:
        raise HTTPException(400, "حدد روم إرسال بانل الهوية")
    emb = discord.Embed(
        title="الـهـويـة الـوطـنـيـة 🪪",
        description=(
            "أهلاً بك في نظام استخراج الهويات الوطنية الرسمية للسيرفر.\n"
            "من هنا يمكنك توثيق حسابك للحصول على كامل الصلاحيات والمزايا الخاصة بالمجتمع.\n"
            "نحرص دائماً على تنظيم الرول بلاي وتقديم أفضل تجربة ترفيهية تناسب الجميع.\n"
            "يرجى التأكد من إدخال معلوماتك بدقة واجتياز المتطلبات المطلوبة لتجنب رفض الطلب.\n"
            "نسعد بانضمامك الدائم وتواجدك المميز معنا في أوقاتك الممتعة.\n"
            "اختر من القائمة أدناه للبدء في عملية التقديم بكل سهولة ويسر."
        ),
        color=discord.Color.blue()
    )
    if g.icon:
        emb.set_author(name=g.name, icon_url=g.icon.url)
        emb.set_thumbnail(url=g.icon.url)
    await replace_panel(g, "identity", "main", ch, embed=emb, view=m.IDSelectView(bot))
    return 1

async def panel_weapons(bot, g, slot):
    m = find_mod(bot, "WeaponPanelView", "نظام الأسلحة")
    d = r_wpn(g, "")
    cid = str(d.get("panel_channel") or "")
    ch = g.get_channel(int(cid)) if cid.isdigit() else None
    if not ch:
        raise HTTPException(400, "حدد روم إرسال بانل الأسلحة")
    emb = discord.Embed(
        title="🔫 مكتب إصدار وتجديد تصاريح الأسلحة الرسمية",
        description=(
            "للحصول على تصريح سلاح جديد أو تجديد تصريحك الحالي، أو استعراض تفاصيل "
            "تصريحك، يرجى استخدام القائمة أدناه.\n*(ملاحظة: مسموح لك بتصريح نشط "
            "واحد فقط)*\n\n"
            "💰 **رسوم الإصدار الجديد:** `31,000` ريال\n"
            "🔄 **رسوم التجديد:** `2,500` ريال\n"
            "⏳ **مدة الصلاحية:** 10 أيام لكل تفعيل"
        ),
        color=discord.Color.dark_red()
    )
    await replace_panel(g, "weapons", "main", ch, embed=emb, view=m.WeaponPanelView())
    return 1

async def panel_traffic(bot, g, slot):
    m = find_mod(bot, "TrafficControlView", "نظام المرور")
    cog = next((c for c in bot.cogs.values() if type(c).__module__ == m.__name__), None)
    if cog is None:
        raise HTTPException(500, "نظام المرور غير محمّل في البوت")
    d = r_traffic(g, "")
    sent = 0

    control = g.get_channel(int(d["control_channel"])) if d.get("control_channel") else None
    if control:
        emb = discord.Embed(
            title="🛡️ لوحة تحكم العساكر ورجال المرور",
            description=(
                "مرحباً بك في نظام إدارة المرور العسكري\n\n"
                "• **تسجيل مخالفة:** لتعبئة بيانات المركبة واختيار العضو والمخالفة (تسحب تلقائياً خلال 5 أيام إذا لم تُسدد).\n"
                "• **إزالة مخالفة:** لاختيار عضو وإزالة مخالفة خاطئة (تعرض المخالفات النشطة فقط) مع إرسال إشعار ولُوق.\n"
                "• **عرض المخالفات الغير مسدده:** لعرض قائمة الأشخاص الذين عليهم مخالفات ومعاينة تفاصيل كل شخص بدقة."
            ),
            color=discord.Color.dark_red()
        )
        await replace_panel(g, "traffic", "control", control, embed=emb, view=m.TrafficControlView(cog))
        sent += 1

    citizen = g.get_channel(int(d["citizen_channel"])) if d.get("citizen_channel") else None
    if citizen:
        emb = discord.Embed(
            title="🚦 خدمات المرور العامة للمواطنين",
            description=(
                "مرحباً بك في البانل الرسمي لخدمات المرور\n\n"
                "• **مخالفاتي:** للاستعلام عن مخالفاتك غير المسددة فقط.\n"
                "• **سداد مخالفة:** لاختيار وسداد الغرامات آلياً عبر قائمة منسدلة."
            ),
            color=discord.Color.blue()
        )
        await replace_panel(g, "traffic", "citizen", citizen, embed=emb, view=m.TrafficCitizenView(cog))
        sent += 1

    if not sent:
        raise HTTPException(400, "حدد روم بانل العساكر أو روم بانل المواطنين")
    return sent

# Existing sections plus the four real integrations.
PANEL_SENDERS = {
    "realestate": panel_re,
    "activation": panel_ac,
    "bank": panel_bk,
    "rolestatus": panel_role_status,
    "identity": panel_identity,
    "weapons": panel_weapons,
    "traffic": panel_traffic,
}
PANEL_KEYS = {
    "realestate": ["admin_channel", "citizen_channel"],
    "activation": ["panel_channel_id"],
    "rolestatus": ["panel_channel_id"],
    "identity": ["panel_channel_id"],
    "weapons": ["panel_channel"],
    "traffic": ["control_channel", "citizen_channel"],
    "bank": ["account_panel_channel_id", "citizens_panel_channel_id", "staff_panel_channel_id"],
}

async def send_panel(bot, g, section, slot):
    fn = PANEL_SENDERS.get(section) or getattr(bot, "dashboard_panels", {}).get(section)
    if not fn:
        return "unsupported"
    try:
        result = await fn(bot, g, slot)
        return "sent" if result else "none"
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, "تعذر إرسال بانل %s: %s" % (section, str(e)[:120]))

# الرتبة التلقائية: autorole.db  جدول auto_roles(guild_id PK, role_id)
ARDB = "autorole.db"
def r_au(g, s):
    try:
        c = sqlite3.connect(ARDB, timeout=10)
        r = c.execute("SELECT role_id FROM auto_roles WHERE guild_id=?", (g.id,)).fetchone(); c.close()
    except sqlite3.Error:
        return {}
    return {"role_id": sid(r[0])} if r and r[0] else {}
def w_au(g, s, d):
    rid = clean(g, d, [], ["role_id"], [])["role_id"]
    if rid:
        role = g.get_role(rid)
        if not role or role.is_default() or role.managed:
            raise HTTPException(400, "هذي الرتبة ما تنفع كرتبة تلقائية")
        me = getattr(g, "me", None)
        if me and role.position >= me.top_role.position:
            raise HTTPException(400, "الرتبة أعلى من رتبة البوت أو تساويها، ارفع رتبة البوت فوقها أول")
    try:
        c = sqlite3.connect(ARDB, timeout=10)
        c.execute("CREATE TABLE IF NOT EXISTS auto_roles (guild_id INTEGER PRIMARY KEY, role_id INTEGER)")
        if rid:
            c.execute("INSERT INTO auto_roles (guild_id, role_id) VALUES (?, ?) ON CONFLICT(guild_id) DO UPDATE SET role_id = excluded.role_id", (g.id, rid))
        else:
            c.execute("DELETE FROM auto_roles WHERE guild_id=?", (g.id,))
        c.commit(); c.close()
    except sqlite3.Error:
        raise HTTPException(500, "قاعدة بيانات الرتبة التلقائية غير جاهزة")

# إرسال ايمبد نصي (نفس أمر /send-embed): يرسل مباشرة ولا يحفظ إلا آخر قيم للتسهيل
EMB_COLORS = {"أزرق": discord.Color.blue, "أخضر": discord.Color.green, "أحمر": discord.Color.red,
              "أصفر": discord.Color.gold, "بنفسجي": discord.Color.purple, "برتقالي": discord.Color.orange,
              "أبيض": discord.Color.light_embed, "أسود": discord.Color.dark_theme}

async def send_custom_embed(request, g, d):
    uid = int(request.session["user"]["id"])
    try:
        m = g.get_member(uid) or await g.fetch_member(uid)
        is_admin = m.guild_permissions.administrator
    except Exception:
        is_admin = False
    if not is_admin:
        raise HTTPException(403, "إرسال الايمبد للأدمن فقط")
    cid = str(d.get("channel_id") or "")
    ch = g.get_channel(int(cid)) if cid.isdigit() else None
    if not ch or str(getattr(ch, "type", "")) != "text":
        raise HTTPException(400, "REQ:channel_id")
    title, desc = (d.get("title") or "").strip(), (d.get("description") or "").strip()
    if not title:
        raise HTTPException(400, "REQ:title")
    if not desc:
        raise HTTPException(400, "REQ:description")
    if len(title) > 256 or len(desc) > 4000:
        raise HTTPException(400, "العنوان 256 حرف والوصف 4000 حرف كحد أقصى")
    image = (d.get("image_url") or "").strip()
    if image and not image.startswith(("http://", "https://")):
        raise HTTPException(400, "رابط الصورة لازم يبدأ بـ http أو https")
    outside = (d.get("outside_text") or "").strip() or None
    if outside and len(outside) > 2000:
        raise HTTPException(400, "النص الخارجي 2000 حرف كحد أقصى")
    emb = discord.Embed(title=title, description=desc, timestamp=discord.utils.utcnow(),
                        color=EMB_COLORS.get(d.get("color"), discord.Color.blue)())
    if image:
        emb.set_image(url=image)
    try:
        await ch.send(content=outside, embed=emb)
    except Exception:
        raise HTTPException(500, "تعذر الإرسال، تأكد من صلاحيات البوت في الروم")
    save_settings(str(g.id), "embed", {k: d.get(k) for k in ("channel_id", "color", "title", "description", "image_url", "outside_text")})

# الاختصارات: shortcuts.db  جدول server_shortcuts(guild_id, shortcut_name, target_command, status)
SCDB = "shortcuts.db"
SC_ON, SC_OFF = "\u0645\u0641\u0639\u0651\u0644", "\u0645\u0639\u0637\u0644"  # مفعّل / معطل (نفس القيم اللي يقرأها البوت)
def r_sc(g, s):
    try:
        c = sqlite3.connect(SCDB, timeout=10)
        rows = c.execute("SELECT shortcut_name, target_command, status, options FROM server_shortcuts WHERE guild_id=? ORDER BY shortcut_name", (g.id,)).fetchall(); c.close()
    except sqlite3.Error:
        return {"items": []}
    items = []
    for a, b, c_, opts in rows:
        try: options = json.loads(opts or "{}") if isinstance(opts, str) else {}
        except Exception: options = {}
        # توافق مع الاختصارات القديمة: إعطاء/سحب الرتبة صار اختصاراً واحداً.
        if b in ("add_role", "remove_role"):
            b = "toggle_role"
        items.append({"name": a, "target": b, "enabled": c_ == SC_ON, "options": options})
    return {"items": items}
def w_sc(g, s, d):
    items, seen = [], set()
    for it in (d.get("items") or []):
        if not isinstance(it, dict):
            continue
        name = str(it.get("name") or "").strip().lower().lstrip("!/.#")
        target = str(it.get("target") or "").strip().lstrip("/")
        if not name and not target:
            continue
        allowed = {"ban", "kick", "timeout", "untimeout", "clear", "warn", "unban", "toggle_role", "nickname"}
        if not name or not target:
            raise HTTPException(400, "كل اختصار لازم له اسم ونوع أمر")
        if target not in allowed:
            raise HTTPException(400, "نوع الأمر غير مدعوم")
        if any(ch.isspace() for ch in name):
            raise HTTPException(400, "الاختصار لازم يكون كلمة وحدة بدون مسافات: " + name)
        if len(name) > 50 or len(target) > 100:
            raise HTTPException(400, "الاختصار 50 حرف والأمر 100 حرف كحد أقصى")
        if name in seen:
            raise HTTPException(400, "الاختصار مكرر: " + name)
        seen.add(name)
        opts = it.get("options") if isinstance(it.get("options"), dict) else {}
        # الاختصار يحدد نوع العملية فقط؛ الأرقام والمنشنات والرتب تُكتب داخل ديسكورد.
        # لا توجد إعدادات ثابتة للعدد أو الرتبة من الموقع.
        opts = {"reason_required": bool(opts.get("reason_required"))}
        items.append((g.id, name, target, SC_ON if it.get("enabled") else SC_OFF, json.dumps(opts, ensure_ascii=False)))
    try:
        c = sqlite3.connect(SCDB, timeout=10)
        with c:
            c.execute("CREATE TABLE IF NOT EXISTS server_shortcuts (guild_id INTEGER, shortcut_name TEXT, target_command TEXT, status TEXT DEFAULT '%s', options TEXT DEFAULT '{}', PRIMARY KEY (guild_id, shortcut_name))" % SC_ON)
            c.execute("DELETE FROM server_shortcuts WHERE guild_id=?", (g.id,))
            c.executemany("INSERT INTO server_shortcuts (guild_id, shortcut_name, target_command, status, options) VALUES (?,?,?,?,?)", items)
        c.close()
    except sqlite3.Error:
        raise HTTPException(500, "قاعدة بيانات الاختصارات غير جاهزة")

# اللوقات: logs_settings.db  جدول server_logs(guild_id, log_type, channel_id)  (حذف الصف = إيقاف هذا اللوق)
LGDB = "logs_settings.db"
LG_TYPES = ["members_join_remove", "member_bans", "member_kick", "member_timeout", "member_roles", "nicknames", "messages",
            "reactions", "voice", "channels_crud", "channels_update", "roles_crud", "roles_update", "invites", "server_updates"]
def r_lg(g, s):
    try:
        c = sqlite3.connect(LGDB, timeout=10)
        rows = c.execute("SELECT log_type, channel_id FROM server_logs WHERE guild_id=?", (g.id,)).fetchall(); c.close()
    except sqlite3.Error:
        return {}
    return {t: sid(ch) for t, ch in rows if t in LG_TYPES and ch}
def w_lg(g, s, d):
    vals = {}
    for t in LG_TYPES:
        v = str(d.get(t) or "")
        if not v:
            vals[t] = None
            continue
        ch = g.get_channel(int(v)) if v.isdigit() else None
        if not ch or str(getattr(ch, "type", "")) != "text":
            raise HTTPException(400, "اللوق لازم يكون في روم نصي من هذا السيرفر")
        vals[t] = ch.id
    try:
        c = sqlite3.connect(LGDB, timeout=10)
        with c:
            c.execute("CREATE TABLE IF NOT EXISTS server_logs (guild_id INTEGER, log_type TEXT, channel_id INTEGER, PRIMARY KEY (guild_id, log_type))")
            for t, cid in vals.items():
                if cid:
                    c.execute("INSERT INTO server_logs (guild_id, log_type, channel_id) VALUES (?,?,?) ON CONFLICT(guild_id, log_type) DO UPDATE SET channel_id=excluded.channel_id", (g.id, t, cid))
                else:
                    c.execute("DELETE FROM server_logs WHERE guild_id=? AND log_type=?", (g.id, t))
        c.close()
    except sqlite3.Error:
        raise HTTPException(500, "قاعدة بيانات اللوقات غير جاهزة")

# أدوات الحماية: security_settings.db  جدولي server_security(status) و security_punishments(punishment)
SEDB = "security_settings.db"
SE_FEATS = ["bot_add", "admin_role", "mass_ban", "mass_kick", "channel_delete", "role_delete", "role_create", "channel_create", "links"]
SE_PUN = ["timeout", "kick", "ban", "strip_roles"]
def r_se(g, s):
    try:
        c = sqlite3.connect(SEDB, timeout=10)
        st = dict(c.execute("SELECT feature, status FROM server_security WHERE guild_id=?", (g.id,)).fetchall())
        pu = dict(c.execute("SELECT feature, punishment FROM security_punishments WHERE guild_id=?", (g.id,)).fetchall())
        c.close()
    except sqlite3.Error:
        st, pu = {}, {}
    o = {}
    for f in SE_FEATS:
        o[f + "__on"] = bool(st.get(f, 0))
        o[f + "__p"] = pu.get(f, "timeout")
    return o
def w_se(g, s, d):
    rows = []
    for f in SE_FEATS:
        p = d.get(f + "__p") or "timeout"
        if p not in SE_PUN:
            raise HTTPException(400, "عقوبة غير صالحة")
        rows.append((f, 1 if d.get(f + "__on") else 0, p))
    try:
        c = sqlite3.connect(SEDB, timeout=10)
        with c:
            c.execute("CREATE TABLE IF NOT EXISTS server_security (guild_id INTEGER, feature TEXT, status INTEGER DEFAULT 0, PRIMARY KEY (guild_id, feature))")
            c.execute("CREATE TABLE IF NOT EXISTS security_punishments (guild_id INTEGER, feature TEXT, punishment TEXT DEFAULT 'timeout', PRIMARY KEY (guild_id, feature))")
            for f, on, p in rows:
                c.execute("INSERT INTO server_security (guild_id, feature, status) VALUES (?,?,?) ON CONFLICT(guild_id, feature) DO UPDATE SET status=excluded.status", (g.id, f, on))
                c.execute("INSERT INTO security_punishments (guild_id, feature, punishment) VALUES (?,?,?) ON CONFLICT(guild_id, feature) DO UPDATE SET punishment=excluded.punishment", (g.id, f, p))
        c.close()
    except sqlite3.Error:
        raise HTTPException(500, "قاعدة بيانات الحماية غير جاهزة")

def r_botlang(g, s):
    try:
        from core import i18n
        return {"lang": i18n.guild_lang(g.id)}
    except Exception:
        return {"lang": "ar"}
def w_botlang(g, s, d):
    if d.get("lang") not in ("ar", "en"):
        raise HTTPException(400, "قيمة غير صالحة")
    try:
        from core import i18n
        i18n.set_guild_lang(g.id, d["lang"])
    except ImportError:
        raise HTTPException(500, "قاعدة البيانات غير جاهزة")

ADMIN_ONLY = {"security", "badwords", "azkar", "levels", "botlang"}  # أقسام التعديل فيها للأدمن فقط (مثل أوامر البوت)
async def require_admin(request, g):
    try:
        uid = int(request.session["user"]["id"])
        m = g.get_member(uid) or await g.fetch_member(uid)
        ok = m.guild_permissions.administrator
    except Exception:
        ok = False
    if not ok:
        raise HTTPException(403, "تعديل هذا القسم للأدمن فقط")

# الكلمات المحظورة: badwords_settings.db  جدولي bad_words و bad_words_punishment
BWDB = "badwords_settings.db"
def r_bw(g, s):
    try:
        c = sqlite3.connect(BWDB, timeout=10)
        words = [r[0] for r in c.execute("SELECT word FROM bad_words WHERE guild_id=? ORDER BY word", (g.id,)).fetchall()]
        p = c.execute("SELECT punishment FROM bad_words_punishment WHERE guild_id=?", (g.id,)).fetchone()
        c.close()
    except sqlite3.Error:
        words, p = [], None
    return {"words": words, "punishment": p[0] if p else "timeout"}
def w_bw(g, s, d):
    pun = d.get("punishment") or "timeout"
    if pun not in SE_PUN:
        raise HTTPException(400, "عقوبة غير صالحة")
    words, seen = [], set()
    for x in d.get("words") or []:
        x = str(x).strip().lower()
        if not x:
            continue
        if len(x) < 2:
            raise HTTPException(400, "الكلمة لازم تكون حرفين على الأقل: " + x)
        if len(x) > 100:
            raise HTTPException(400, "الكلمة أطول من 100 حرف")
        if x not in seen:
            seen.add(x); words.append(x)
    if len(words) > 500:
        raise HTTPException(400, "الحد الأقصى 500 كلمة")
    try:
        c = sqlite3.connect(BWDB, timeout=10)
        with c:
            c.execute("CREATE TABLE IF NOT EXISTS bad_words (guild_id INTEGER, word TEXT, PRIMARY KEY (guild_id, word))")
            c.execute("CREATE TABLE IF NOT EXISTS bad_words_punishment (guild_id INTEGER PRIMARY KEY, punishment TEXT DEFAULT 'timeout')")
            c.execute("DELETE FROM bad_words WHERE guild_id=?", (g.id,))
            c.executemany("INSERT INTO bad_words (guild_id, word) VALUES (?,?)", [(g.id, x) for x in words])
            c.execute("INSERT INTO bad_words_punishment (guild_id, punishment) VALUES (?,?) ON CONFLICT(guild_id) DO UPDATE SET punishment=excluded.punishment", (g.id, pun))
        c.close()
    except sqlite3.Error:
        raise HTTPException(500, "قاعدة بيانات الكلمات المحظورة غير جاهزة")

AD = {"botlang": (r_botlang, w_botlang), "badwords": (r_bw, w_bw), "security": (r_se, w_se), "logs": (r_lg, w_lg), "shortcuts": (r_sc, w_sc), "autorole": (r_au, w_au), "realestate": (r_re, w_re), "activation": (r_ac, w_ac), "bank": (r_bk, w_bk), "replies": (r_ar, w_ar), "tickets": (r_tk, w_tk), "apply": (r_ap, w_ap), "rolestatus": (r_rp, w_rp), "welcome": (r_wl, w_wl), "identity": (r_id, w_id),
      "azkar": (r_azkar, w_azkar), "levels": (r_levels, w_levels),
      "weapons": WPN_RW, "traffic": TRF_RW}

@app.get("/api/guilds/{gid}/settings/{section}")
async def read(gid: str, section: str, request: Request, slot: str = ""):
    g = guild_or_403(request, gid)
    if section not in SECTIONS:
        raise HTTPException(404)
    return AD[section][0](g, slot) if section in AD else get_settings(gid, section, slot)

@app.post("/api/guilds/{gid}/settings/{section}")
async def write(gid: str, section: str, request: Request, slot: str = ""):
    g = guild_or_403(request, gid)
    if section not in SECTIONS:
        raise HTTPException(404)
    data = await request.json()
    if not isinstance(data, dict) or len(json.dumps(data)) > 200000:
        raise HTTPException(400, "بيانات غير صالحة")
    if section in ADMIN_ONLY:
        await require_admin(request, g)
    if section == "embed":
        await send_custom_embed(request, g, data)
        return {"ok": True, "panel": "sent"}
    if section in AD:
        AD[section][1](g, slot, data)
    else:
        save_settings(gid, section, data, slot)
    out = {"ok": True}
    if any(data.get(k) for k in PANEL_KEYS.get(section, [])):
        out["panel"] = await send_panel(request.app.state.bot, g, section, slot)
    return out

# ---------- بانل التذاكر (إرسال مباشر من الموقع) ----------
@app.get("/api/guilds/{gid}/tickets/list")
async def tickets_list(gid: str, request: Request):
    return ticket_items(guild_or_403(request, gid))

def ticket_items(g):
    d = jload(TKF).get(str(g.id), {})
    return [{"num": k, "name": v.get("name", "")} for k, v in sorted(d.items(), key=lambda x: int(x[0])) if isinstance(v, dict) and str(k).isdigit()]

def _panel_args(g, d):
    cid = str(d.get("channel_id", ""))
    ch = g.get_channel(int(cid)) if cid.isdigit() else None
    if not ch or str(getattr(ch, "type", "")) != "text":
        raise HTTPException(400, "حدد روم نصي صالح")
    title, desc = (d.get("title") or "").strip(), (d.get("desc") or "").strip()
    if not title or not desc:
        raise HTTPException(400, "اكتب عنوان ووصف البانل")
    if len(title) > 256 or len(desc) > 4000:
        raise HTTPException(400, "العنوان 256 حرف والوصف 4000 حرف كحد أقصى")
    image = (d.get("image") or "").strip() or None
    if image and not image.startswith(("http://", "https://")):
        raise HTTPException(400, "رابط الصورة لازم يبدأ بـ http أو https")
    nums = [str(n) for n in (d.get("nums") or []) if str(n).isdigit()]
    if not nums:
        raise HTTPException(400, "اختر عنصر واحد على الأقل")
    return ch, title, desc, image, nums, ("buttons" if d.get("display") == "buttons" else "dropdown")

async def _send_via_cog(bot, g, d, cog_name, fix_file):
    ch, title, desc, image, nums, disp = _panel_args(g, d)
    cog = bot.get_cog(cog_name)
    if not cog or not hasattr(cog, "send_panel"):
        raise HTTPException(500, "حدّث ملف %s أول" % fix_file)
    try:
        await cog.send_panel(g, ch.id, title, desc, image, disp, nums)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception:
        raise HTTPException(500, "تعذر إرسال البانل، تأكد من صلاحيات البوت في الروم")

async def do_send_ticket_panel(bot, g, d):
    await _send_via_cog(bot, g, d, "Ticket", "ticket.py")

async def do_send_apply_panel(bot, g, d):
    await _send_via_cog(bot, g, d, "SetupApply", "setup_apply.py")

@app.get("/api/guilds/{gid}/apply/list")
async def apply_list(gid: str, request: Request):
    return apply_items(guild_or_403(request, gid))

def apply_items(g):
    d = jload(APF).get(str(g.id), {})
    if not isinstance(d, dict):
        return []
    out = []
    for k, v in d.items():
        if isinstance(v, dict) and str(k).isdigit():
            out.append({"num": str(k), "name": str(v.get("name") or "")})
    return sorted(out, key=lambda x: int(x["num"]))

@app.post("/api/guilds/{gid}/send/apply-panel")
async def send_apply_panel(gid: str, request: Request):
    g = guild_or_403(request, gid)
    d = await request.json()
    if not isinstance(d, dict):
        raise HTTPException(400, "بيانات غير صالحة")
    await do_send_apply_panel(request.app.state.bot, g, d)
    return {"ok": True}

@app.post("/api/guilds/{gid}/send/ticket-panel")
async def send_ticket_panel(gid: str, request: Request):
    g = guild_or_403(request, gid)
    d = await request.json()
    if not isinstance(d, dict):
        raise HTTPException(400, "بيانات غير صالحة")
    await do_send_ticket_panel(request.app.state.bot, g, d)
    return {"ok": True}

# ---------- تقييم الموقع ----------
db.execute("CREATE TABLE IF NOT EXISTS ratings(user_id TEXT PRIMARY KEY, stars INTEGER, comment TEXT, ts INTEGER)")

def rating_data(uid):
    m = db.execute("SELECT stars, comment FROM ratings WHERE user_id=?", (str(uid),)).fetchone()
    a = db.execute("SELECT AVG(stars), COUNT(*) FROM ratings").fetchone()
    return {"mine": {"stars": m[0], "comment": m[1] or ""} if m else None, "avg": round(a[0] or 0, 1), "count": a[1]}

def rating_save(uid, stars, comment):
    import time
    try:
        stars = int(stars)
    except (TypeError, ValueError):
        stars = 0
    if not 1 <= stars <= 5:
        raise HTTPException(400, "اختر من 1 إلى 5 نجوم")
    comment = str(comment or "").strip()[:500]
    db.execute("REPLACE INTO ratings VALUES(?,?,?,?)", (str(uid), stars, comment, int(time.time())))
    db.commit()

@app.get("/api/rating")
async def rating_get(request: Request):
    return rating_data(user_or_401(request)["id"])

@app.post("/api/rating")
async def rating_set(request: Request):
    u = user_or_401(request)
    d = await request.json()
    if not isinstance(d, dict):
        raise HTTPException(400, "بيانات غير صالحة")
    rating_save(u["id"], d.get("stars"), d.get("comment"))
    return rating_data(u["id"])

@app.get("/api/site-info")
async def site_info(request: Request):
    info = getattr(request.app.state, "application_info", None)
    created = None
    bot_id = getattr(info, "id", None) if info else None
    if bot_id:
        try:
            ts = ((int(bot_id) >> 22) + 1420070400000) / 1000
            created = datetime.datetime.fromtimestamp(ts, datetime.timezone.utc).strftime("%Y/%m/%d")
        except Exception:
            pass
    return {"creator": {"username": ".a.506.", "avatar": "https://cdn.simpleicons.org/discord/5865F2"}, "created_at": created}

# ---------- أقسام اللوحة كـ HTML جاهز (Python يبنيه، والمتصفح يعرضه فقط) ----------
def guild_meta(g):
    return {"channels": [{"id": str(c.id), "name": c.name} for c in g.text_channels],
            "categories": [{"id": str(c.id), "name": c.name} for c in g.categories],
            "roles": [{"id": str(r.id), "name": r.name} for r in g.roles if not r.is_default() and not r.managed]}

@app.get("/ui/view/{key}")
async def ui_view(key: str, request: Request, gid: str = "", slot: str = "", mode: str = ""):
    u = user_or_401(request)
    lang = get_lang(request)
    ctx = dict(user=u, key=key)

    def out(template, **extra):
        return HTMLResponse(ui_render.page(template, lang, **ctx, **extra), headers={"Cache-Control": "no-store"})

    if key in ui_schema.SECTIONS:
        if not gid:
            return out("views/empty.html", icon_name="server", message=ui_i18n.t(lang, "ui.noServers"), invite=True, title=None)
        g = guild_or_403(request, gid)
        c = ui_schema.SECTIONS[key]
        slot = slot if slot in (c.get("slots") or []) else (c["slots"][0] if c.get("slots") else "")
        meta = guild_meta(g)
        if c.get("modes") and mode == "panel":
            items = ticket_items(g) if key == "tickets" else apply_items(g)
            return out("views/panel.html", guild_name=g.name, meta=meta, items=items)
        data = AD[key][0](g, slot) if key in AD else get_settings(gid, key, slot)
        return out("views/section.html", guild_name=g.name, meta=meta, data=data, slot=slot, mode="setup")

    bot = request.app.state.bot
    if key == "home":
        info = getattr(request.app.state, "application_info", None)
        created = None
        if info and getattr(info, "id", None):
            try:
                created = datetime.datetime.fromtimestamp(((int(info.id) >> 22) + 1420070400000) / 1000, datetime.timezone.utc).strftime("%Y/%m/%d")
            except Exception:
                pass
        gname = ""
        if gid:
            g = bot.get_guild(int(gid)) if gid.isdigit() else None
            gname = g.name if g else ""
        tiles = [("server", ui_i18n.t(lang, "ui.yourServers"), None, len(user_guild_list(request))),
                 ("globe", ui_i18n.t(lang, "ui.allServers"), None, len(bot.guilds)),
                 ("server", ui_i18n.t(lang, "ui.currentServer"), gname or "—", None),
                 ("code", ui_i18n.t(lang, "ui.developer"), ".a.506.", None),
                 ("calendar", ui_i18n.t(lang, "ui.botCreated"), created or ui_i18n.t(lang, "c.unknown"), None)]
        return out("views/home.html", tiles=tiles, ltr=True)
    if key == "stats":
        return out("views/stats.html", guilds_total=len(bot.guilds))
    if key in ("themes", "language"):
        return out(f"views/{key}.html")
    if key == "rate":
        return out("views/rate.html", rating=rating_data(u["id"]))
    if key == "emojis":
        emojis, cats, ids_ready = ui_render.emoji_list()
        return out("views/emojis.html", emojis=emojis, cats=cats, ids_ready=ids_ready)
    raise HTTPException(404)

# ---------- الملفات الثابتة ----------
if EMOJI_DIR.is_dir():
    app.mount("/emojis", StaticFiles(directory=str(EMOJI_DIR)), name="emojis")
# يجب أن يكون آخر شي: /assets و /logo.png وغيرها
app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="web")

async def start_web(bot):
    app.state.bot = bot
    try:
        app.state.application_info = await bot.application_info()
    except Exception:
        app.state.application_info = None
    if not CLIENT_SECRET:
        logging.getLogger("dashboard").warning("DISCORD_CLIENT_SECRET is not set — dashboard login will fail")
    cfg = uvicorn.Config(app, host="0.0.0.0", port=PORT, log_level="warning",
                         proxy_headers=True, forwarded_allow_ips=os.environ.get("FORWARDED_ALLOW_IPS", "*"),
                         ssl_certfile=SSL_CERTFILE, ssl_keyfile=SSL_KEYFILE)
    logging.getLogger("dashboard").info("listening on port %s · redirect %s/callback", PORT, BASE_URL or "<host>")
    await uvicorn.Server(cfg).serve()
