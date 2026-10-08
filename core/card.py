"""كانفاس الترحيب | Welcome card renderer (Pillow).

بطاقة PNG بحجم 1000×360 بعدة تصاميم، تدعم العربي (RTL) والإنجليزي، صورة العضو، وخلفية مخصصة.
- لا تعتمد على numpy؛ كل العمل بـ Pillow وبخطوط محلية (assets/fonts).
- تُستدعى من خيط منفصل (asyncio.to_thread) فلا تعطّل البوت.
"""
import io
import re
from functools import lru_cache

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps, features

from . import config

W, H = 1000, 360
FONTS = config.ASSETS_DIR / "fonts"
AR = re.compile(r"[؀-ۿ]")
RAQM = features.check("raqm")

try:  # بديل لو libraqm غير متوفرة على السيرفر
    import arabic_reshaper
    from bidi.algorithm import get_display
except Exception:  # pragma: no cover
    arabic_reshaper = get_display = None

STYLES = ["royal", "neon", "glass", "minimal", "sunset", "aurora"]
COLOR_NAMES = {"أزرق": "#4f8cff", "أخضر": "#2fd18b", "أحمر": "#ff5470", "أصفر": "#ffc83d", "بنفسجي": "#9b7bff", "برتقالي": "#ff8a3d", "أبيض": "#ffffff", "أسود": "#2b2f3a"}
# (خلفية أولى، خلفية ثانية، نص داكن؟)
PALETTES = {
    "royal": ("#081a3a", "#1b3f8a", False), "neon": ("#07070f", "#1a0f33", False), "glass": ("#1b2540", "#0d1424", False),
    "minimal": ("#f4f6fb", "#e4e9f5", True), "sunset": ("#3a0f2e", "#d9531e", False), "aurora": ("#04121a", "#0f766e", False),
}


def hex_rgb(h: str, default=(79, 140, 255)):
    h = COLOR_NAMES.get(h, h or "")
    m = re.fullmatch(r"#?([0-9a-fA-F]{6})", h.strip())
    if not m:
        return default
    v = m.group(1)
    return tuple(int(v[i:i + 2], 16) for i in (0, 2, 4))


@lru_cache(maxsize=32)
def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    path = FONTS / name
    try:
        return ImageFont.truetype(str(path), size, layout_engine=ImageFont.Layout.RAQM if RAQM else ImageFont.Layout.BASIC)
    except OSError:
        return ImageFont.load_default()


def shape(text: str) -> str:
    if RAQM or not AR.search(text) or not arabic_reshaper:
        return text
    return get_display(arabic_reshaper.reshape(text))


def tw(draw, text, f) -> float:
    return draw.textlength(shape(text), font=f, **({"direction": "rtl", "language": "ar"} if RAQM and AR.search(text) else {}))


def fit(draw, text, name, size, max_w, min_size=22):
    while size > min_size and tw(draw, text, font(name, size)) > max_w:
        size -= 2
    f = font(name, size)
    if tw(draw, text, f) > max_w:  # قص مع …
        while len(text) > 3 and tw(draw, text + "…", f) > max_w:
            text = text[:-1]
        text += "…"
    return text, f


def put(draw, xy, text, f, fill, rtl: bool):
    kw = {}
    if RAQM and AR.search(text):
        kw = {"direction": "rtl", "language": "ar"}
    draw.text(xy, shape(text), font=f, fill=fill, anchor=("rs" if rtl else "ls"), **kw)


def gradient(c1, c2) -> Image.Image:
    """تدرج قطري بدون حواف: مزج تدرج عمودي وأفقي."""
    v = Image.linear_gradient("L").resize((W, H))
    h = Image.linear_gradient("L").rotate(90).resize((W, H))
    return ImageOps.colorize(Image.blend(v, h, 0.62), tuple(c1), tuple(c2)).convert("RGBA")


def glow(size, color, alpha=170) -> Image.Image:
    m = Image.radial_gradient("L").resize(size)
    m = m.point(lambda v: int(max(0, 255 - v * 1.4143) * alpha / 255))  # يصل للصفر عند منتصف الحواف (بدون حواف مربعة)
    layer = Image.new("RGBA", size, color + (0,))
    layer.putalpha(m)
    return layer


def circle_avatar(data: bytes | None, d: int) -> Image.Image:
    if data:
        try:
            im = Image.open(io.BytesIO(data)).convert("RGBA").resize((d, d), Image.LANCZOS)
        except Exception:
            im = None
    else:
        im = None
    if im is None:
        im = Image.new("RGBA", (d, d), (88, 101, 242, 255))
    big = Image.new("L", (d * 4, d * 4), 0)
    ImageDraw.Draw(big).ellipse((0, 0, d * 4 - 1, d * 4 - 1), fill=255)
    im.putalpha(big.resize((d, d), Image.LANCZOS))
    return im


def background(style: str, accent, bg_bytes: bytes | None) -> Image.Image:
    c1, c2, light = PALETTES.get(style, PALETTES["royal"])
    c1, c2 = hex_rgb(c1), hex_rgb(c2)
    if bg_bytes:
        try:
            im = Image.open(io.BytesIO(bg_bytes)).convert("RGBA")
            im = ImageOps.fit(im, (W, H), Image.LANCZOS)
            if style == "glass":
                im = im.filter(ImageFilter.GaussianBlur(14))
            shade = Image.new("RGBA", (W, H), (0, 0, 0, 120 if not light else 40))
            return Image.alpha_composite(im, shade)
        except Exception:
            pass
    base = gradient(c1, c2)
    if style == "neon":
        base = Image.alpha_composite(base, glow((620, 620), accent, 120).crop((0, 0, 620, 620)).resize((W, H)))
    elif style == "aurora":
        base = Image.alpha_composite(base, glow((700, 420), (120, 80, 255), 110).resize((W, H)))
    elif style == "sunset":
        base = Image.alpha_composite(base, glow((520, 520), (255, 190, 90), 110).resize((W, H)))
    return base


def render(*, avatar: bytes | None, name: str, title: str, subtitle: str, badge: str, style: str = "royal", accent="#4f8cff",
           rtl: bool = False, show_avatar: bool = True, bg: bytes | None = None) -> bytes:
    style = style if style in STYLES else "royal"
    ac = hex_rgb(accent)
    light = PALETTES[style][2]
    ink = (20, 26, 45) if light else (255, 255, 255)
    soft = (70, 82, 110) if light else (205, 215, 235)

    img = background(style, ac, bg).convert("RGB")  # RGB: الرسم بشفافية يمزج مع الخلفية بدل أن يكتب الشفافية في الصورة
    d = ImageDraw.Draw(img, "RGBA")

    # زخرفة: خطوط قطرية خفيفة + شرارات
    if style != "minimal":
        for x in range(-H, W, 46):
            d.line([(x, H), (x + H, 0)], fill=ink + (7,), width=2)
    side = W - 70 if not rtl else 70
    for (sx, sy, r) in ((side, 60, 9), (side - (28 if not rtl else -28), 92, 5), (W - side, H - 48, 7)):
        d.polygon([(sx, sy - r * 2), (sx + r * .6, sy - r * .6), (sx + r * 2, sy), (sx + r * .6, sy + r * .6), (sx, sy + r * 2), (sx - r * .6, sy + r * .6), (sx - r * 2, sy), (sx - r * .6, sy - r * .6)], fill=ac + (210,))

    # لوحة زجاجية للتصميم glass/minimal
    if style in ("glass", "minimal"):
        panel = Image.new("RGBA", (W - 60, H - 60), (255, 255, 255, 40 if style == "glass" else 150))
        mask = Image.new("L", panel.size, 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, panel.size[0] - 1, panel.size[1] - 1), 34, fill=255)
        panel.putalpha(ImageChops_min(mask, panel.getchannel("A")))
        img.paste(panel, (30, 30), panel)
        d = ImageDraw.Draw(img, "RGBA")

    # الصورة الشخصية
    dia = 218
    ax = (W - 56 - dia) if rtl else 56
    ay = (H - dia) // 2
    if show_avatar:
        halo = glow((dia + 150, dia + 150), ac, 190)
        img.paste(halo, (ax - 75, ay - 75), halo)
        d = ImageDraw.Draw(img, "RGBA")
        d.ellipse((ax - 12, ay - 12, ax + dia + 12, ay + dia + 12), fill=ac + (255,))
        d.ellipse((ax - 5, ay - 5, ax + dia + 5, ay + dia + 5), fill=(12, 16, 30, 255) if not light else (255, 255, 255, 255))
        av = circle_avatar(avatar, dia)
        img.paste(av, (ax, ay), av)
        d = ImageDraw.Draw(img, "RGBA")
        text_left, text_right = (ax + dia + 54, W - 56) if not rtl else (56, ax - 54)
    else:
        text_left, text_right = 70, W - 70
    max_w = text_right - text_left
    x = text_right if rtl else text_left

    # العنوان (صغير بلون التمييز)
    t, ft = fit(d, title, "Lalezar-Regular.ttf", 58, max_w)
    put(d, (x, 118), t, ft, ac + (255,), rtl)
    # الاسم
    n, fn = fit(d, name, "IBMPlexSansArabic-Bold.ttf", 66, max_w)
    put(d, (x, 196), n, fn, ink + (255,), rtl)
    # السطر الثالث
    s, fs = fit(d, subtitle, "IBMPlexSansArabic-Medium.ttf", 30, max_w)
    put(d, (x, 244), s, fs, soft + (255,), rtl)
    # شارة العدد
    bf = font("IBMPlexSansArabic-Bold.ttf", 26)
    bw = int(tw(d, badge, bf)) + 44
    bx0 = (text_right - bw) if rtl else text_left
    d.rounded_rectangle((bx0, 270, bx0 + bw, 318), 24, fill=ac + (255,))
    on_ac = (255, 255, 255) if sum(ac) < 520 else (20, 26, 45)
    d.text((bx0 + bw / 2, 294), shape(badge), font=bf, fill=on_ac, anchor="mm", **({"direction": "rtl", "language": "ar"} if RAQM and AR.search(badge) else {}))

    # إطار بزوايا مدوّرة
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    m = Image.new("L", (W * 2, H * 2), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, W * 2 - 1, H * 2 - 1), 64, fill=255)
    out.paste(img, (0, 0), m.resize((W, H), Image.LANCZOS))
    ImageDraw.Draw(out, "RGBA").rounded_rectangle((1, 1, W - 2, H - 2), 31, outline=ac + (150,), width=3)
    buf = io.BytesIO()
    out.save(buf, "PNG", optimize=True)
    return buf.getvalue()


def ImageChops_min(a, b):
    from PIL import ImageChops
    return ImageChops.multiply(a, b)
