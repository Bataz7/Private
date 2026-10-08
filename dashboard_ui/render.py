"""يولّد الصفحات من قوالب Jinja2 | Server-side page rendering."""
from pathlib import Path
from jinja2 import Environment, FileSystemLoader, select_autoescape, pass_context
from markupsafe import Markup

from . import i18n, icons, schema, themes
from .team import TEAM, ROLE_ICON

TEMPLATES = Path(__file__).resolve().parent.parent / "templates"
env = Environment(loader=FileSystemLoader(str(TEMPLATES)), autoescape=select_autoescape(["html"]), trim_blocks=True, lstrip_blocks=True)


@pass_context
def _t(ctx, path, **vars):
    return i18n.t(ctx["lang"], path, **vars)


@pass_context
def _has(ctx, path):
    return i18n.has(ctx["lang"], path)


@pass_context
def _opt_label(ctx, opts_key, index):
    return i18n.t(ctx["lang"], "opt." + opts_key)[index]


def _sel(value, current):
    return Markup(" selected") if str(value) == str(current if current is not None else "") else Markup("")


env.globals.update(
    t=_t, has=_has, icon=icons.icon, sprite=icons.sprite, S=schema, THEMES=themes, TEAM=TEAM, ROLE_ICON=ROLE_ICON,
    opt_label=_opt_label, sel=_sel, WIDE=schema.WIDE_TYPES, OPTIONS=schema.OPTIONS,
)
env.filters["mins"] = lambda n, lang: i18n.t(lang, "opt.minutesFew" if n <= 10 else "opt.minutes", n=n)


def page(template: str, lang: str, **ctx) -> str:
    base = dict(lang=lang, dir="rtl" if lang == "ar" else "ltr", other_lang="en" if lang == "ar" else "ar")
    base.update(ctx)
    return env.get_template(template).render(**base)


def section_name(lang: str, key: str) -> str:
    if key in schema.SECTIONS:
        return i18n.t(lang, f"sec.{key}.n")
    return {"home": i18n.t(lang, "ui.home"), "language": i18n.t(lang, "ui.language"), "themes": i18n.t(lang, "ui.themes"),
            "emojis": i18n.t(lang, "ui.emojis"), "stats": i18n.t(lang, "ui.stats"), "rate": i18n.t(lang, "rate.title")}.get(key, key)


env.globals["section_name"] = pass_context(lambda ctx, key: section_name(ctx["lang"], key))


# ---------- أدوات للقوالب ----------
def sc_groups(items):
    """يجمّع الاختصارات حسب نوع الأمر (الأنواع المعروفة أولاً)."""
    m: dict[str, list] = {}
    for x in items or []:
        k = (x.get("target") or "").strip().lstrip("/")
        if k:
            m.setdefault(k, []).append(x)
    known = list(schema.SC_ICONS)
    return [(k, m.get(k, [])) for k in known + [k for k in m if k not in known]]


env.globals["sc_groups"] = sc_groups

EMOJI_DIR = Path(__file__).resolve().parent.parent / "emojis"


def emoji_list():
    """يقرأ emojis/manifest.json (من tools/make_emojis.py) و emojis/ids.json (من tools/upload_emojis.py)."""
    import json
    try:
        manifest = json.loads((EMOJI_DIR / "manifest.json").read_text(encoding="utf-8"))
    except OSError:
        return [], [], False
    try:
        ids = json.loads((EMOJI_DIR / "ids.json").read_text(encoding="utf-8"))
    except OSError:
        ids = {}
    out = []
    for e in manifest:
        eid = ids.get(e["name"])
        out.append(dict(e, code=f"<:{e['name']}:{eid}>" if eid else f":{e['name']}:"))
    cats = [c for c in dict.fromkeys(e["category"] for e in out)]
    return out, cats, bool(ids)
