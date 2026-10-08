"""يستخرج كل النصوص العربية من كوجات البوت لبناء جدول الترجمة | Extracts Arabic UI strings from the cogs.

    python tools/extract_strings.py cogs/*.py  > locales/entries.json

كل نص يظهر بصيغة قالب: المتغيرات تتحول إلى {0} {1} … (مع تلميح بالتعبير الأصلي).
"""
import ast
import hashlib
import json
import re
import sys
from pathlib import Path

AR = re.compile(r"[؀-ۿ]")
BRACE = re.compile(r"\{[A-Za-z_][\w.\[\]'\"]*(?::[^{}]*)?\}|\{\d*(?::[^{}]*)?\}|%[sd]")


def sid(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:10]


def fstring_template(node: ast.JoinedStr, src: str):
    parts, exprs = [], []
    for v in node.values:
        if isinstance(v, ast.Constant):
            parts.append(str(v.value))
        else:  # FormattedValue
            i = len(exprs)
            exprs.append(ast.get_source_segment(src, v.value) or "?")
            parts.append("{%d}" % i)
    return "".join(parts), exprs


def collect(path: Path):
    src = path.read_text(encoding="utf-8")
    tree = ast.parse(src)
    skip = set()  # عقد لا نترجمها: print / docstrings / custom_id
    for n in ast.walk(tree):
        if isinstance(n, ast.Call):
            fn = ast.get_source_segment(src, n.func) or ""
            if fn in ("print", "traceback.print_exc", "logging.info", "logging.error", "logging.warning", "log.info", "log.error", "log.warning"):
                for sub in ast.walk(n):
                    skip.add(id(sub))
            for kw in n.keywords:
                if kw.arg in ("custom_id", "value", "name_localizations", "reason") and kw.arg != "reason":
                    for sub in ast.walk(kw.value):
                        skip.add(id(sub))
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Module)) and n.body and isinstance(n.body[0], ast.Expr) and isinstance(getattr(n.body[0], "value", None), ast.Constant):
            skip.add(id(n.body[0].value))
    out = []
    inner = set()  # أجزاء داخل f-string (حتى لا تُستخرج مرتين)
    for n in ast.walk(tree):
        if isinstance(n, ast.JoinedStr):
            for v in n.values:
                inner.add(id(v))
    for n in ast.walk(tree):
        if id(n) in skip or id(n) in inner:
            continue
        if isinstance(n, ast.JoinedStr):
            text, exprs = fstring_template(n, src)
            if AR.search(text):
                out.append(dict(text=text, exprs=exprs, kind="f", file=path.name, line=n.lineno))
        elif isinstance(n, ast.Constant) and isinstance(n.value, str) and AR.search(n.value):
            t = n.value
            kind = "t" if BRACE.search(t) else "c"
            out.append(dict(text=t, exprs=[], kind=kind, file=path.name, line=n.lineno))
    return out


def main(files):
    seen, rows = {}, []
    for f in files:
        for e in collect(Path(f)):
            t = e["text"].strip()
            if not t or len(t) < 2:
                continue
            key = e["text"]
            if key in seen:
                seen[key]["files"].add(f"{e['file']}:{e['line']}")
                continue
            e["id"] = sid(key)
            e["files"] = {f"{e['file']}:{e['line']}"}
            seen[key] = e
            rows.append(e)
    for e in rows:
        e["files"] = sorted(e["files"])[:3]
        e.pop("file"), e.pop("line")
    json.dump(rows, sys.stdout, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main(sys.argv[1:])
