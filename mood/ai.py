"""الذكاء الاصطناعي (Claude) — اختياري.

نستخدم Claude API بطلب HTTP مباشر عبر aiohttp (موجودة أصلاً مع discord.py)
بدل مكتبة anthropic الرسمية، لأن المكتبة لحالها حوالي 26 ميقا والبوت لازم يبقى تحت 20.
لو ما فيه ANTHROPIC_API_KEY، البوت يشتغل عادي بردود وتحليل بسيط بدون AI.
"""
import json
import logging
from collections import Counter

import aiohttp

from config import AI_MODEL, ANTHROPIC_API_KEY

log = logging.getLogger("mood.ai")
API_URL = "https://api.anthropic.com/v1/messages"
# الموديلات اللي تدعم fallbacks: "default" (لو رفض الطلب يكمّله موديل ثاني تلقائياً)
_FALLBACK_MODELS = {"claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"}

MOOD_NAMES = {5: "ممتاز", 4: "كويس", 3: "عادي", 2: "سيء", 1: "سيء جداً"}

SYSTEM = (
    "أنت 'مود'، رفيق لطيف داخل بوت ديسكورد يسأل شخصاً كل يوم عن يومه. "
    "تكلّم بلهجة سعودية بيضاء ودودة وقصيرة، بدون وعظ وبدون تشخيص طبي. "
    "إذا ظهر في الكلام ما يدل على خطر على النفس أو أذى، شجّعه بلطف يكلم شخص يثق فيه أو مختص."
)

enabled = bool(ANTHROPIC_API_KEY)


async def _call(messages, max_tokens, effort, schema=None):
    body = {
        "model": AI_MODEL,
        "max_tokens": max_tokens,
        "system": SYSTEM,
        "messages": messages,
        "output_config": {"effort": effort},
    }
    headers = {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    if schema:
        body["output_config"]["format"] = {"type": "json_schema", "schema": schema}
    if AI_MODEL in _FALLBACK_MODELS:
        body["fallbacks"] = "default"
        headers["anthropic-beta"] = "server-side-fallback-2026-07-01"

    timeout = aiohttp.ClientTimeout(total=120)
    async with aiohttp.ClientSession(timeout=timeout) as s:
        async with s.post(API_URL, json=body, headers=headers) as r:
            data = await r.json(content_type=None)
            if r.status != 200:
                raise RuntimeError(f"Claude API {r.status}: {data.get('error', data)}")
    if data.get("stop_reason") == "refusal":
        raise RuntimeError("Claude refused the request")
    return "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text").strip()


def _fmt(e):
    s = f"- {e['day']}: {MOOD_NAMES[e['mood']]} ({e['mood']}/5)"
    if e.get("highlight"):
        s += f" | أبرز شي: {e['highlight']}"
    if e.get("problems"):
        s += f" | مشاكل: {e['problems']}"
    return s


# ───────────────────────── رد على تسجيل اليوم ─────────────────────────

_FALLBACK_REPLY = {
    5: "يا سلام! يوم حلو يستاهل ينحفظ 🌟 كمّل على نفس الطاقة.",
    4: "حلو إن يومك كان كويس 😊 الأشياء الصغيرة الحلوة تفرق.",
    3: "يوم عادي وهذا طبيعي جداً 🙂 بكرة فرصة جديدة.",
    2: "الله يعينك، الأيام الصعبة تعدّي 💛 خذ لك راحة الليلة.",
    1: "آسف إن يومك كان ثقيل 🫂 لا تشيل الحمل لحالك، كلم أحد تثق فيه.",
}


async def reply(entry, recent):
    """رد قصير ودود على تسجيل اليوم."""
    if not enabled:
        return _FALLBACK_REPLY[entry["mood"]]
    history = "\n".join(_fmt(e) for e in recent[-7:]) or "لا يوجد"
    prompt = (
        f"تسجيل اليوم:\n{_fmt(entry)}\n\nآخر الأيام:\n{history}\n\n"
        "اكتب رد من 2 إلى 3 جمل: تفاعل مع اللي كتبه بالضبط، ولو يومه سيء اقترح شي صغير عملي يسويه الليلة، "
        "ولو لاحظت نمط من الأيام اللي قبل اذكره بلطف. أضف إيموجي واحد أو اثنين."
    )
    try:
        return await _call([{"role": "user", "content": prompt}], 2000, "low")
    except Exception as ex:
        log.warning("AI reply failed: %s", ex)
        return _FALLBACK_REPLY[entry["mood"]]


# ───────────────────────── تحليل التقرير ─────────────────────────

REPORT_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "good_things": {"type": "array", "items": {"type": "string"}},
        "bad_things": {"type": "array", "items": {"type": "string"}},
        "tips": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["summary", "good_things", "bad_things", "tips"],
    "additionalProperties": False,
}

_STOP = set("في من على الى إلى عن مع و او أو ما لا انا أنا هو هي كان كانت اليوم يوم شي شيء بس مرة جداً جدا كثير".split())


def _common(texts, n=4):
    """أكثر الأشياء تكراراً: الجمل المكررة أولاً، وبعدها الكلمات."""
    texts = [t.strip() for t in texts if t and t.strip()]
    phrases = Counter(t for t in texts if len(t) <= 60)
    out = [f"{t} (×{c})" for t, c in phrases.most_common(n) if c > 1]
    if len(out) < n:
        words = Counter(w.strip(".,!؟?،") for t in texts for w in t.split())
        out += [f"تكرر ذكر «{w}» (×{c})" for w, c in words.most_common(20)
                if len(w) > 2 and w not in _STOP and c > 1 and not any(w in o for o in out)][:n - len(out)]
    return out


async def analyze(rows, prev_avg):
    """يرجع dict فيه: summary, good_things, bad_things, tips."""
    if not rows:
        return {"summary": "ما فيه تسجيلات في هالفترة.", "good_things": [], "bad_things": [], "tips": []}
    if enabled:
        prompt = (
            "هذي تسجيلات المزاج اليومية لشخص (المقياس 1 إلى 5):\n"
            + "\n".join(_fmt(e) for e in rows)
            + (f"\n\nمتوسط الفترة اللي قبلها: {prev_avg:.2f}/5" if prev_avg else "")
            + "\n\nحلّلها لتقرير احترافي قصير:\n"
            "- summary: فقرة من 3-4 جمل عن الفترة واتجاه المزاج (تحسن/تراجع) مع الأرقام.\n"
            "- good_things: أكثر الأشياء اللي خلّت أيامه حلوة (3-5 نقاط قصيرة).\n"
            "- bad_things: أكثر المشاكل اللي خرّبت أيامه (3-5 نقاط قصيرة).\n"
            "- tips: 3 نصائح عملية ومحددة مبنية على بياناته هو، مو نصائح عامة."
        )
        try:
            return json.loads(await _call([{"role": "user", "content": prompt}], 8000, "medium", REPORT_SCHEMA))
        except Exception as ex:
            log.warning("AI analyze failed: %s", ex)

    # بدون AI: تحليل بسيط بالكلمات المتكررة
    avg = sum(e["mood"] for e in rows) / len(rows)
    good = _common([e["highlight"] for e in rows if e["mood"] >= 3])
    bad = _common([e["problems"] for e in rows])
    trend = ""
    if prev_avg:
        diff = avg - prev_avg
        trend = " مزاجك أحسن من الفترة اللي قبل 📈" if diff > 0.1 else (" مزاجك أقل من الفترة اللي قبل 📉" if diff < -0.1 else " مزاجك ثابت تقريباً.")
    return {
        "summary": f"سجّلت {len(rows)} يوم ومتوسط مزاجك {avg:.1f} من 5.{trend}",
        "good_things": good,
        "bad_things": bad,
        "tips": ["فعّل الذكاء الاصطناعي (ANTHROPIC_API_KEY) عشان تجيك نصائح مخصصة لك."],
    }
