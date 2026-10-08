"""يدمج ترجمات الأجزاء ويتحقق منها ثم يكتب locales/en.json
    python tools/build_locale.py entries.json out_1.json out_2.json ...
"""
import json
import re
import sys
from pathlib import Path

PH = re.compile(r"\{(\d+|[A-Za-z_][\w.]*)(?::[^{}]*)?\}|%[sd]")
entries = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
tr = {}
for p in sys.argv[2:]:
    tr.update(json.loads(Path(p).read_text(encoding="utf-8")))
exact, templates, bad, skipped = {}, [], [], 0
for e in entries:
    en = tr.get(e["id"])
    if not en or en == e["text"]:
        skipped += 1
        continue
    if sorted(PH.findall(e["text"])) != sorted(PH.findall(en)) and sorted(m.group(0) for m in PH.finditer(e["text"])) != sorted(m.group(0) for m in PH.finditer(en)):
        bad.append(e["id"])
        continue
    if PH.search(e["text"]):
        templates.append({"ar": e["text"], "en": en})
    else:
        exact[e["text"]] = en
out = Path(__file__).resolve().parent.parent / "locales" / "en.json"
out.parent.mkdir(exist_ok=True)
out.write_text(json.dumps({"exact": exact, "templates": templates}, ensure_ascii=False, indent=0), encoding="utf-8")
print(f"exact={len(exact)} templates={len(templates)} skipped={skipped} bad_placeholders={len(bad)} {bad[:10]}")
