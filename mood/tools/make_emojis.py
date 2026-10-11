"""يرسم ايموجيات البوت (PNG 128×128) داخل assets/emojis.

أداة تطوير فقط (البوت نفسه ما يحتاجها): الصور الناتجة موجودة أصلاً في المشروع،
فما تحتاج تشغلها إلا لو عدلت التصميم.   pip install pillow && python tools/make_emojis.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

S = 4                 # رسم بدقة أعلى ثم تصغير = حواف ناعمة
SIZE = 128 * S
OUT = Path(__file__).resolve().parent.parent / "assets" / "emojis"
SMALL = OUT.parent / "emojis-small"

# name: (لون فاتح, لون غامق, شكل الفم, إضافات)
FACES = {
    "mood_great": ("#7EE8A2", "#2BB673", "grin", {"blush", "sparkle"}),
    "mood_good":  ("#B8F28C", "#6CC24A", "smile", {"blush"}),
    "mood_okay":  ("#FFE58A", "#F5B935", "flat", set()),
    "mood_bad":   ("#FFC38A", "#F08A3C", "frown", set()),
    "mood_awful": ("#FF9A9A", "#E5484D", "sad", {"tear"}),
}


def hex2rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def radial(c1, c2):
    """دائرة بتدرج لوني من الأعلى لليسار."""
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    a, b = hex2rgb(c1), hex2rgb(c2)
    d = ImageDraw.Draw(img)
    steps = 60
    for i in range(steps):
        t = i / (steps - 1)
        r = int(SIZE * 0.46 * (1 - t * 0.85))
        cx = SIZE * 0.5 - t * SIZE * 0.08
        cy = SIZE * 0.5 - t * SIZE * 0.1
        col = tuple(int(b[k] + (a[k] - b[k]) * t) for k in range(3)) + (255,)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=col)
    return img


def overlay(img, draw_fn):
    """الأشكال الشفافة لازم تنرسم على طبقة منفصلة وتندمج (ImageDraw يستبدل البكسل بدل ما يدمجه)."""
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw_fn(ImageDraw.Draw(layer))
    img.alpha_composite(layer)


def face(name, c1, c2, mouth, extras):
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))

    # ظل خفيف
    shadow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).ellipse(
        [SIZE * .06, SIZE * .09, SIZE * .94, SIZE * .97], fill=(0, 0, 0, 70))
    img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(6 * S)))

    # الوجه
    body = radial(c1, c2)
    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).ellipse([SIZE * .04, SIZE * .04, SIZE * .96, SIZE * .96], fill=255)
    img.paste(body, (0, 0), mask)

    d = ImageDraw.Draw(img)
    ink = (45, 35, 40, 255)

    # لمعة
    overlay(img, lambda o: o.ellipse([SIZE * .15, SIZE * .14, SIZE * .3, SIZE * .23], fill=(255, 255, 255, 110)))

    # العيون
    ey = SIZE * .42
    for ex in (SIZE * .35, SIZE * .65):
        if mouth == "grin":  # عيون مبتسمة ^ ^
            d.arc([ex - 13 * S, ey - 8 * S, ex + 13 * S, ey + 16 * S], 200, 340, fill=ink, width=6 * S)
        else:
            d.ellipse([ex - 8 * S, ey - 11 * S, ex + 8 * S, ey + 11 * S], fill=ink)
            d.ellipse([ex - 2 * S, ey - 8 * S, ex + 4 * S, ey - 2 * S], fill=(255, 255, 255, 230))

    # الحواجب الحزينة
    if mouth in ("frown", "sad"):
        d.line([SIZE * .25, SIZE * .30, SIZE * .41, SIZE * .26], fill=ink, width=5 * S)
        d.line([SIZE * .75, SIZE * .30, SIZE * .59, SIZE * .26], fill=ink, width=5 * S)

    # الفم
    mx, my = SIZE * .5, SIZE * .66
    if mouth == "grin":
        d.chord([mx - 30 * S, my - 22 * S, mx + 30 * S, my + 26 * S], 0, 180, fill=ink)
        d.chord([mx - 16 * S, my + 4 * S, mx + 16 * S, my + 24 * S], 180, 360, fill=(255, 110, 130, 255))
    elif mouth == "smile":
        d.arc([mx - 24 * S, my - 22 * S, mx + 24 * S, my + 14 * S], 20, 160, fill=ink, width=7 * S)
    elif mouth == "flat":
        d.line([mx - 20 * S, my + 2 * S, mx + 20 * S, my + 2 * S], fill=ink, width=7 * S)
    elif mouth == "frown":
        d.arc([mx - 22 * S, my + 2 * S, mx + 22 * S, my + 34 * S], 200, 340, fill=ink, width=7 * S)
    elif mouth == "sad":
        d.arc([mx - 24 * S, my + 2 * S, mx + 24 * S, my + 36 * S], 195, 345, fill=ink, width=7 * S)

    if "blush" in extras:
        overlay(img, lambda o: [o.ellipse([bx - 13 * S, SIZE * .53, bx + 13 * S, SIZE * .6], fill=(255, 120, 140, 120)) for bx in (SIZE * .22, SIZE * .78)])
    if "tear" in extras:
        tx, ty = SIZE * .69, SIZE * .52
        d.polygon([(tx, ty - 10 * S), (tx - 9 * S, ty + 8 * S), (tx + 9 * S, ty + 8 * S)], fill=(90, 170, 255, 255))
        d.ellipse([tx - 9 * S, ty, tx + 9 * S, ty + 18 * S], fill=(90, 170, 255, 255))
    if "sparkle" in extras:
        for sx, sy, r in ((SIZE * .88, SIZE * .14, 11), (SIZE * .12, SIZE * .80, 7)):
            r *= S
            d.polygon([(sx, sy - r), (sx + r * .3, sy - r * .3), (sx + r, sy), (sx + r * .3, sy + r * .3),
                       (sx, sy + r), (sx - r * .3, sy + r * .3), (sx - r, sy), (sx - r * .3, sy - r * .3)],
                      fill=(255, 215, 80, 255))
    return img.resize((128, 128), Image.LANCZOS)


def report_icon():
    """أيقونة التقرير: لوحة صغيرة فيها أعمدة."""
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([SIZE * .08, SIZE * .08, SIZE * .92, SIZE * .92], radius=26 * S, fill="#6C5CE7")
    bars = [(.22, .62, "#FF9A9A"), (.40, .48, "#FFE58A"), (.58, .36, "#B8F28C"), (.76, .24, "#7EE8A2")]
    for x, top, col in bars:
        d.rounded_rectangle([SIZE * (x - .07), SIZE * top, SIZE * (x + .07), SIZE * .8], radius=6 * S, fill=col)
    return img.resize((128, 128), Image.LANCZOS)


def _canvas():
    return Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))


def _vgrad(w, h, top, bottom):
    """تدرج عمودي."""
    a, b = hex2rgb(top), hex2rgb(bottom)
    g = Image.new("RGBA", (w, h))
    d = ImageDraw.Draw(g)
    for y in range(h):
        t = y / max(h - 1, 1)
        d.line([(0, y), (w, y)], fill=tuple(int(a[k] + (b[k] - a[k]) * t) for k in range(3)) + (255,))
    return g


def _fill_mask(mask, top, bottom):
    img = _canvas()
    img.paste(_vgrad(SIZE, SIZE, top, bottom), (0, 0), mask)
    return img


def _smooth(points, steps=16):
    """منحنى ناعم (Catmull-Rom مغلق) يمر بالنقاط."""
    out, n = [], len(points)
    for i in range(n):
        p0, p1, p2, p3 = points[i - 1], points[i], points[(i + 1) % n], points[(i + 2) % n]
        for k in range(steps):
            t = k / steps
            t2, t3 = t * t, t * t * t
            out.append(tuple(0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2
                                   + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3) for j in (0, 1)))
    return out


FLAME = [(.5, .96), (.24, .88), (.13, .66), (.2, .45), (.31, .3), (.34, .16), (.43, .34), (.53, .04),
         (.7, .24), (.78, .4), (.86, .27), (.9, .56), (.8, .86)]


def _flame_mask(scale, cy=.96):
    m = Image.new("L", (SIZE, SIZE), 0)
    pts = [(SIZE * (.5 + (x - .5) * scale), SIZE * (cy - (cy - y) * scale)) for x, y in FLAME]
    ImageDraw.Draw(m).polygon(_smooth(pts), fill=255)
    return m


def fire_icon():
    """شعلة السلسلة 🔥"""
    img = _fill_mask(_flame_mask(1), "#FFB347", "#F0543C")
    img.alpha_composite(_fill_mask(_flame_mask(.52, .93), "#FFF6C2", "#FFC93C"))
    return img.resize((128, 128), Image.LANCZOS)


def heart_icon():
    """قلب الامتنان 💛"""
    m = Image.new("L", (SIZE, SIZE), 0)
    d = ImageDraw.Draw(m)
    r = SIZE * .22
    d.ellipse([SIZE * .1, SIZE * .18, SIZE * .1 + 2 * r, SIZE * .18 + 2 * r], fill=255)
    d.ellipse([SIZE * .9 - 2 * r, SIZE * .18, SIZE * .9, SIZE * .18 + 2 * r], fill=255)
    d.polygon([(SIZE * .11, SIZE * .45), (SIZE * .5, SIZE * .9), (SIZE * .89, SIZE * .45), (SIZE * .5, SIZE * .3)], fill=255)
    img = _fill_mask(m, "#FF8FB1", "#E5484D")
    overlay(img, lambda o: o.ellipse([SIZE * .2, SIZE * .26, SIZE * .34, SIZE * .38], fill=(255, 255, 255, 120)))
    return img.resize((128, 128), Image.LANCZOS)


def sleep_icon():
    """هلال النوم 😴"""
    m = Image.new("L", (SIZE, SIZE), 0)
    d = ImageDraw.Draw(m)
    d.ellipse([SIZE * .1, SIZE * .14, SIZE * .82, SIZE * .86], fill=255)
    d.ellipse([SIZE * .32, SIZE * .02, SIZE * 1.0, SIZE * .7], fill=0)
    img = _fill_mask(m, "#A29BFE", "#4B3FB8")
    d = ImageDraw.Draw(img)
    for x, y, sz in ((.66, .52, 22), (.8, .36, 16)):
        x, y, sz = SIZE * x, SIZE * y, sz * S
        d.line([(x, y), (x + sz, y), (x, y + sz), (x + sz, y + sz)], fill=(255, 255, 255, 255), width=4 * S, joint="curve")
    return img.resize((128, 128), Image.LANCZOS)


def energy_icon():
    """صاعقة الطاقة ⚡"""
    m = Image.new("L", (SIZE, SIZE), 0)
    pts = [(.58, .04), (.2, .56), (.46, .56), (.38, .96), (.8, .4), (.53, .4), (.66, .04)]
    ImageDraw.Draw(m).polygon([(SIZE * x, SIZE * y) for x, y in pts], fill=255)
    img = _fill_mask(m, "#FFE58A", "#F5A623")
    return img.resize((128, 128), Image.LANCZOS)


def trophy_icon():
    """كأس الإنجاز 🏆"""
    m = Image.new("L", (SIZE, SIZE), 0)
    d = ImageDraw.Draw(m)
    d.chord([SIZE * .22, SIZE * -.02, SIZE * .78, SIZE * .62], 0, 180, fill=255)
    d.rectangle([SIZE * .22, SIZE * .1, SIZE * .78, SIZE * .3], fill=255)
    for cx in (.2, .8):
        d.ellipse([SIZE * (cx - .13), SIZE * .14, SIZE * (cx + .13), SIZE * .4], outline=255, width=6 * S)
    d.rectangle([SIZE * .45, SIZE * .58, SIZE * .55, SIZE * .76], fill=255)
    d.rounded_rectangle([SIZE * .28, SIZE * .76, SIZE * .72, SIZE * .9], radius=5 * S, fill=255)
    img = _fill_mask(m, "#FFE58A", "#E0A100")
    overlay(img, lambda o: o.polygon([(SIZE * .5, SIZE * .16), (SIZE * .54, SIZE * .26), (SIZE * .64, SIZE * .27), (SIZE * .56, SIZE * .33), (SIZE * .59, SIZE * .43),
                                 (SIZE * .5, SIZE * .37), (SIZE * .41, SIZE * .43), (SIZE * .44, SIZE * .33), (SIZE * .36, SIZE * .27), (SIZE * .46, SIZE * .26)], fill=(255, 255, 255, 200)))
    return img.resize((128, 128), Image.LANCZOS)


def save(img, name):
    img.save(OUT / f"{name}.png", optimize=True)
    # نسخة صغيرة للتقارير (HTML) عشان حجم الملف يبقى خفيف
    SMALL.mkdir(parents=True, exist_ok=True)
    img.resize((48, 48), Image.LANCZOS).save(SMALL / f"{name}.png", optimize=True)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, (c1, c2, mouth, extras) in FACES.items():
        save(face(name, c1, c2, mouth, extras), name)
    save(report_icon(), "mood_report")
    save(fire_icon(), "mood_fire")
    save(heart_icon(), "mood_heart")
    save(sleep_icon(), "mood_sleep")
    save(energy_icon(), "mood_energy")
    save(trophy_icon(), "mood_trophy")
    print("done →", OUT)
