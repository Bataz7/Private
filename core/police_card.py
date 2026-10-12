"""بطاقة نقاط العسكري | Police points card (Pillow).

بطاقة PNG بحجم 1000×470: الصورة والاسم والرتبة، النقاط بخط كبير، وأربع خانات (الترتيب، ساعات الشفت،
عدد الشفتات، الإنذارات) وحالة الخدمة. تُرسم في خيط منفصل (asyncio.to_thread) فلا تعطّل البوت.
"""
import io

from PIL import Image, ImageDraw, ImageOps

from .card import AR, RAQM, circle_avatar, fit, font, glow, hex_rgb, shape, tw

W, H = 1000, 470
BOLD, MED, DISPLAY = "IBMPlexSansArabic-Bold.ttf", "IBMPlexSansArabic-Medium.ttf", "Lalezar-Regular.ttf"

# لون الحالة: في الخدمة / خارج الخدمة / مفصول
STATUS = {"on": (47, 209, 139), "off": (150, 162, 190), "dismissed": (255, 84, 112)}


def _kw(text: str) -> dict:
    return {"direction": "rtl", "language": "ar"} if RAQM and AR.search(text) else {}


def _text(d, xy, text, f, fill, anchor):
    d.text(xy, shape(text), font=f, fill=fill, anchor=anchor, **_kw(text))


def _bg(c1, c2) -> Image.Image:
    v = Image.linear_gradient("L").resize((W, H))
    h = Image.linear_gradient("L").rotate(90).resize((W, H))
    return ImageOps.colorize(Image.blend(v, h, 0.55), c1, c2).convert("RGBA")


def render(*, avatar: bytes | None, name: str, subtitle: str, points: int, rank: str, hours: str, shifts: str,
           warnings: str, status: str, status_text: str, week: str, accent: str = "#f6c445") -> bytes:
    ac = hex_rgb(accent, (246, 196, 69))
    ink, soft, tile = (255, 255, 255), (196, 206, 228), (255, 255, 255, 16)

    img = _bg((7, 13, 30), (18, 38, 82))
    halo = glow((760, 760), ac, 70)
    img.alpha_composite(halo, (-260, -330))
    blue = glow((700, 700), (64, 120, 255), 80)
    img.alpha_composite(blue, (W - 420, H - 380))
    img = img.convert("RGB")
    d = ImageDraw.Draw(img, "RGBA")

    for x in range(-H, W, 44):  # خطوط قطرية خفيفة
        d.line([(x, H), (x + H, 0)], fill=(255, 255, 255, 6), width=2)
    d.rectangle((0, 0, W, 7), fill=ac + (255,))

    # الصورة (يمين) مع حلقة بلون الحالة
    st = STATUS.get(status, STATUS["off"])
    dia, ax, ay = 176, W - 52 - 176, 44
    d.ellipse((ax - 10, ay - 10, ax + dia + 10, ay + dia + 10), fill=ac + (255,))
    d.ellipse((ax - 4, ay - 4, ax + dia + 4, ay + dia + 4), fill=(10, 16, 34, 255))
    av = circle_avatar(avatar, dia)
    img.paste(av, (ax, ay), av)
    d = ImageDraw.Draw(img, "RGBA")
    d.ellipse((ax + 8, ay + dia - 40, ax + 44, ay + dia - 4), fill=(10, 16, 34, 255))
    d.ellipse((ax + 13, ay + dia - 35, ax + 39, ay + dia - 9), fill=st + (255,))

    # الاسم والرتبة (يسار الصورة، محاذاة لليمين)
    right = ax - 36
    n, fn = fit(d, name, BOLD, 54, 470)
    _text(d, (right, 104), n, fn, ink + (255,), "rs")
    s, fs = fit(d, subtitle, MED, 28, 470)
    _text(d, (right, 150), s, fs, soft + (255,), "rs")

    # شارة الحالة
    pf = font(BOLD, 24)
    pw = int(tw(d, status_text, pf)) + 64
    d.rounded_rectangle((right - pw, 176, right, 222), 23, fill=st + (40,), outline=st + (200,), width=2)
    d.ellipse((right - 30, 192, right - 16, 206), fill=st + (255,))
    _text(d, (right - 40, 200), status_text, pf, ink + (255,), "rm")

    # النقاط (يسار)
    box = (44, 40, 330, 226)
    d.rounded_rectangle(box, 30, fill=ac + (34,), outline=ac + (190,), width=3)
    _text(d, ((box[0] + box[2]) / 2, 84), "النقاط", font(MED, 28), soft + (255,), "mm")
    num = f"{points:,}"
    size = 92
    while size > 40 and d.textlength(num, font=font(DISPLAY, size)) > box[2] - box[0] - 40:
        size -= 4
    d.text(((box[0] + box[2]) / 2, 156), num, font=font(DISPLAY, size), fill=ac + (255,), anchor="mm")
    _text(d, ((box[0] + box[2]) / 2, 203), week, font(MED, 21), soft + (255,), "mm")

    # أربع خانات
    tiles = [("الترتيب", rank), ("ساعات الشفت", hours), ("عدد الشفتات", shifts), ("الإنذارات", warnings)]
    gap, top, bottom = 18, 262, 426
    tw_ = (W - 88 - gap * 3) / 4
    for i, (label, value) in enumerate(tiles):  # من اليمين لليسار
        x1 = W - 44 - i * (tw_ + gap)
        x0 = x1 - tw_
        d.rounded_rectangle((x0, top, x1, bottom), 24, fill=tile, outline=(255, 255, 255, 30), width=2)
        d.rounded_rectangle((x0 + 24, top, x1 - 24, top + 5), 3, fill=ac + (220,))
        cx = (x0 + x1) / 2
        _text(d, (cx, top + 46), label, font(MED, 25), soft + (255,), "mm")
        v, fv = fit(d, str(value), DISPLAY, 58, tw_ - 30, min_size=26)
        _text(d, (cx, top + 112), v, fv, ink + (255,), "mm")

    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    m = Image.new("L", (W * 2, H * 2), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, W * 2 - 1, H * 2 - 1), 60, fill=255)
    out.paste(img, (0, 0), m.resize((W, H), Image.LANCZOS))
    ImageDraw.Draw(out, "RGBA").rounded_rectangle((1, 1, W - 2, H - 2), 29, outline=ac + (140,), width=3)
    buf = io.BytesIO()
    out.save(buf, "PNG", optimize=True)
    return buf.getvalue()
