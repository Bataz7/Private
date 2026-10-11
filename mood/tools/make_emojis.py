"""يرسم ايموجيات البوت (PNG 128×128) داخل assets/emojis.

التشغيل مرة وحدة فقط (يحتاج Pillow):  python tools/make_emojis.py
الصور الناتجة موجودة أصلاً في المشروع، فما تحتاج تشغله إلا لو عدلت التصميم.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

S = 4                 # رسم بدقة أعلى ثم تصغير = حواف ناعمة
SIZE = 128 * S
OUT = Path(__file__).resolve().parent.parent / "assets" / "emojis"

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
    d.ellipse([SIZE * .15, SIZE * .14, SIZE * .3, SIZE * .23], fill=(255, 255, 255, 110))

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
        for bx in (SIZE * .22, SIZE * .78):
            d.ellipse([bx - 13 * S, SIZE * .53, bx + 13 * S, SIZE * .6], fill=(255, 120, 140, 120))
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


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, (c1, c2, mouth, extras) in FACES.items():
        face(name, c1, c2, mouth, extras).save(OUT / f"{name}.png", optimize=True)
    report_icon().save(OUT / "mood_report.png", optimize=True)
    print("done →", OUT)
