"""اختبارات سريعة: python -m pytest -q"""
import io
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.chdir(os.environ.get("TMPDIR", "/tmp"))

from core import card, i18n  # noqa: E402
from core.ticket_presets import PRESETS, questions_for  # noqa: E402


def test_translate_exact_and_template():
    assert i18n.translate("رتبة وزارة الداخلية غير موجودة") == "Ministry of Interior role not found"
    assert i18n.translate("اختر المخالفة المرورية (صفحة 2 من 5)...") == "Select the traffic violation (page 2 of 5)..."


def test_translate_leaves_unknown_and_english():
    assert i18n.translate("Hello") == "Hello"
    assert i18n.translate("نص ما له ترجمة أبداً xyz") == "نص ما له ترجمة أبداً xyz"


def test_presets_respect_discord_limits():
    for p in PRESETS.values():
        assert len(p["q"]) <= 5
        for q in p["q"]:
            assert len(q[1]) <= 45 and len(q[2]) <= 45 and len(q[3]) <= 100 and len(q[4]) <= 100


def test_custom_questions_override_preset():
    qs = questions_for({"preset": "support", "questions": ["a?", "b?"]}, "ar")
    assert [q["label"] for q in qs] == ["a?", "b?"]


def test_card_renders_png_both_directions():
    from PIL import Image
    for rtl in (False, True):
        png = card.render(avatar=None, name="سارة" if rtl else "Sara", title="T", subtitle="S", badge="#1", style="neon", accent="#7c4dff", rtl=rtl)
        assert Image.open(io.BytesIO(png)).size == (card.W, card.H)
