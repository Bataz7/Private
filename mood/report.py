"""حساب الإحصائيات وصناعة تقرير HTML احترافي (ملف واحد يفتح بأي متصفح)."""
import base64
import html
from datetime import date, datetime, timedelta

import db
from config import EMOJI_DIR, REPORTS_DIR, TZ

MOODS = {
    5: ("mood_great", "ممتاز", "#2BB673"),
    4: ("mood_good", "كويس", "#6CC24A"),
    3: ("mood_okay", "عادي", "#F5B935"),
    2: ("mood_bad", "سيء", "#F08A3C"),
    1: ("mood_awful", "سيء جداً", "#E5484D"),
}
WEEKDAYS = ["الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"]


def stats(user_id, days):
    end = datetime.now(TZ).date()
    start = end - timedelta(days=days - 1)
    rows = db.entries_between(user_id, start, end)
    prev = db.entries_between(user_id, start - timedelta(days=days), start - timedelta(days=1))
    avg = sum(r["mood"] for r in rows) / len(rows) if rows else 0
    prev_avg = sum(r["mood"] for r in prev) / len(prev) if prev else 0

    by_wd = {}
    for r in rows:
        by_wd.setdefault(date.fromisoformat(r["day"]).weekday(), []).append(r["mood"])
    wd_avg = {wd: sum(v) / len(v) for wd, v in by_wd.items()}

    return {
        "days": days,
        "start": start,
        "end": end,
        "rows": rows,
        "count": len(rows),
        "avg": avg,
        "prev_avg": prev_avg,
        "change": ((avg - prev_avg) / prev_avg * 100) if prev_avg and rows else None,
        "best": max(rows, key=lambda r: (r["mood"], r["day"])) if rows else None,
        "worst": min(rows, key=lambda r: (r["mood"], r["day"])) if rows else None,
        "dist": {m: sum(1 for r in rows if r["mood"] == m) for m in MOODS},
        "best_weekday": WEEKDAYS[max(wd_avg, key=wd_avg.get)] if wd_avg else None,
        "streak": db.streak(user_id),
        "good_days_pct": round(sum(1 for r in rows if r["mood"] >= 4) / len(rows) * 100) if rows else 0,
    }


def _img(name):
    p = EMOJI_DIR / f"{name}.png"
    return "data:image/png;base64," + base64.b64encode(p.read_bytes()).decode() if p.exists() else ""


def _chart(rows, start, days):
    """رسم خطي SVG للمزاج عبر الأيام."""
    W, H, P = 760, 260, 36
    if not rows:
        return '<p class="muted">ما فيه بيانات كافية للرسم.</p>'
    span = max(days - 1, 1)

    def xy(r):
        i = (date.fromisoformat(r["day"]) - start).days
        return P + (W - 2 * P) * i / span, H - P - (H - 2 * P) * (r["mood"] - 1) / 4

    pts = [xy(r) for r in rows]
    line = " ".join(f"{x:.1f},{y:.1f}" for x, y in pts)
    area = f"{pts[0][0]:.1f},{H - P} {line} {pts[-1][0]:.1f},{H - P}"
    grid = "".join(
        f'<line x1="{P}" x2="{W - P}" y1="{H - P - (H - 2 * P) * (m - 1) / 4:.1f}" y2="{H - P - (H - 2 * P) * (m - 1) / 4:.1f}" class="grid"/>'
        f'<image href="{_img(MOODS[m][0])}" x="2" y="{H - P - (H - 2 * P) * (m - 1) / 4 - 11:.1f}" width="22" height="22"/>'
        for m in MOODS)
    dots = "".join(
        f'<circle cx="{x:.1f}" cy="{y:.1f}" r="6" fill="{MOODS[r["mood"]][2]}" stroke="var(--card)" stroke-width="2">'
        f'<title>{r["day"]}: {MOODS[r["mood"]][1]}</title></circle>'
        for (x, y), r in zip(pts, rows))
    labels = "".join(
        f'<text x="{xy(r)[0]:.1f}" y="{H - 10}" class="lbl">{r["day"][5:]}</text>'
        for i, r in enumerate(rows) if len(rows) <= 10 or i % max(len(rows) // 8, 1) == 0)
    return f'''<svg viewBox="0 0 {W} {H}" class="chart" role="img" aria-label="رسم المزاج">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#6C5CE7" stop-opacity=".35"/><stop offset="1" stop-color="#6C5CE7" stop-opacity="0"/></linearGradient></defs>
{grid}<polygon points="{area}" fill="url(#g)"/>
<polyline points="{line}" fill="none" stroke="#6C5CE7" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
{dots}{labels}</svg>'''


def _list(items, empty="—"):
    if not items:
        return f'<p class="muted">{empty}</p>'
    return "<ul>" + "".join(f"<li>{html.escape(i)}</li>" for i in items) + "</ul>"


def build_html(name, st, insight):
    e = html.escape
    change = st["change"]
    if change is None:
        change_txt, change_cls = "—", ""
    else:
        change_txt = f"{'▲' if change >= 0 else '▼'} {abs(change):.0f}%"
        change_cls = "up" if change >= 0 else "down"
    avg_mood = MOODS[max(1, min(5, round(st["avg"])))] if st["count"] else MOODS[3]

    dist = "".join(
        f'''<div class="bar"><img src="{_img(MOODS[m][0])}" alt=""><span class="bn">{MOODS[m][1]}</span>
<div class="track"><div class="fill" style="width:{(st["dist"][m] / st["count"] * 100) if st["count"] else 0:.0f}%;background:{MOODS[m][2]}"></div></div>
<span class="bc">{st["dist"][m]}</span></div>'''
        for m in sorted(MOODS, reverse=True))

    rows_html = "".join(
        f'''<tr><td class="nw">{r["day"]}</td><td><img class="mini" src="{_img(MOODS[r["mood"]][0])}" alt=""> {MOODS[r["mood"]][1]}</td>
<td>{e(r["highlight"]) or '<span class="muted">—</span>'}</td><td>{e(r["problems"]) or '<span class="muted">—</span>'}</td></tr>'''
        for r in reversed(st["rows"]))

    return f'''<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>تقرير المزاج — {e(name)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap" rel="stylesheet">
<style>
:root{{--bg:#F4F3FB;--card:#fff;--ink:#1E1B2E;--muted:#7B7891;--line:#E7E5F2;--accent:#6C5CE7}}
@media (prefers-color-scheme:dark){{:root{{--bg:#13121A;--card:#1D1B27;--ink:#EEEDF5;--muted:#9a97ad;--line:#2C2A39}}}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--ink);font-family:Tajawal,system-ui,sans-serif;line-height:1.6}}
.wrap{{max-width:900px;margin:auto;padding:24px 16px 48px}}
header{{display:flex;align-items:center;gap:16px;background:linear-gradient(135deg,#6C5CE7,#A29BFE);color:#fff;border-radius:22px;padding:24px}}
header img{{width:72px;height:72px}}header h1{{margin:0;font-size:1.6rem}}header p{{margin:2px 0 0;opacity:.9}}
.grid4{{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:16px 0}}
.card{{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:18px}}
.kpi .v{{font-size:1.8rem;font-weight:800}}.kpi .k{{color:var(--muted);font-size:.9rem}}
.up{{color:#2BB673}}.down{{color:#E5484D}}.muted{{color:var(--muted)}}
h2{{font-size:1.15rem;margin:0 0 10px}}section{{margin-top:16px}}
.chart{{width:100%;height:auto}}.grid{{stroke:var(--line);stroke-dasharray:4 4}}.lbl{{fill:var(--muted);font-size:11px;text-anchor:middle}}
.bar{{display:flex;align-items:center;gap:10px;margin:8px 0}}.bar img{{width:26px}}.bn{{width:70px}}
.track{{flex:1;background:var(--line);border-radius:99px;height:12px;overflow:hidden}}.fill{{height:100%;border-radius:99px}}.bc{{width:28px;text-align:left}}
.two{{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}}
ul{{margin:0;padding-inline-start:20px}}li{{margin:4px 0}}
.summary{{font-size:1.05rem}}
.tbl{{overflow-x:auto}}table{{width:100%;border-collapse:collapse;font-size:.92rem}}th,td{{text-align:right;padding:10px 8px;border-bottom:1px solid var(--line);vertical-align:top}}
th{{color:var(--muted);font-weight:500}}.mini{{width:20px;vertical-align:middle}}.nw{{white-space:nowrap}}
footer{{text-align:center;color:var(--muted);font-size:.85rem;margin-top:24px}}
</style></head><body><div class="wrap">
<header><img src="{_img(avg_mood[0])}" alt="">
<div><h1>تقرير المزاج — {e(name)}</h1><p>من <bdi>{st["start"]}</bdi> إلى <bdi>{st["end"]}</bdi> · آخر {st["days"]} يوم</p></div></header>

<div class="grid4">
<div class="card kpi"><div class="k">متوسط المزاج</div><div class="v">{st["avg"]:.1f}<small>/5</small></div><div class="muted">{avg_mood[1]}</div></div>
<div class="card kpi"><div class="k">التغيّر عن الفترة السابقة</div><div class="v {change_cls}">{change_txt}</div><div class="muted">قبل: {st["prev_avg"]:.1f}/5</div></div>
<div class="card kpi"><div class="k">أيام حلوة</div><div class="v">{st["good_days_pct"]}%</div><div class="muted">{st["count"]} يوم مسجّل</div></div>
<div class="card kpi"><div class="k">سلسلة التسجيل 🔥</div><div class="v">{st["streak"]}</div><div class="muted">أفضل يوم بالأسبوع: {st["best_weekday"] or "—"}</div></div>
</div>

<section class="card"><h2>📝 الملخص</h2><p class="summary">{e(insight["summary"])}</p></section>
<section class="card"><h2>📈 المزاج عبر الأيام</h2>{_chart(st["rows"], st["start"], st["days"])}</section>
<section class="card"><h2>📊 توزيع المزاج</h2>{dist}</section>
<section class="two">
<div class="card"><h2>🌟 اللي خلّى أيامك حلوة</h2>{_list(insight["good_things"])}</div>
<div class="card"><h2>⚡ اللي ضايقك</h2>{_list(insight["bad_things"])}</div>
</section>
<section class="card"><h2>💡 نصائح لك</h2>{_list(insight["tips"])}</section>
<section class="card"><h2>🗓️ السجل اليومي</h2><div class="tbl"><table>
<tr><th>اليوم</th><th>المزاج</th><th>أبرز شي</th><th>المشاكل</th></tr>{rows_html}</table></div></section>
<footer>Mood Bot · {datetime.now(TZ):%Y-%m-%d %H:%M}</footer>
</div></body></html>'''


def save(user_id, name, st, insight):
    REPORTS_DIR.mkdir(exist_ok=True)
    path = REPORTS_DIR / f"mood_{user_id}_{st['end']}_{st['days']}d.html"
    path.write_text(build_html(name, st, insight), encoding="utf-8")
    return path
