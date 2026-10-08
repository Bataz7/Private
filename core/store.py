"""تخزين خفيف | Lightweight storage helpers (JSON مع كاش + sqlite بإعدادات سريعة)."""
import json
import os
import sqlite3
import tempfile
import time
from pathlib import Path


class JsonStore:
    """ملف JSON يُقرأ من الذاكرة ولا يُعاد تحميله إلا إذا تغيّر على القرص (لوحة التحكم تكتب في نفس الملف)."""

    def __init__(self, path: str | Path):
        self.path = Path(path)
        self._data: dict = {}
        self._mtime = -1.0

    def get(self) -> dict:
        try:
            m = self.path.stat().st_mtime
        except OSError:
            self._data, self._mtime = {}, -1.0
            return self._data
        if m != self._mtime:
            try:
                self._data = json.loads(self.path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                self._data = {}
            self._mtime = m
        return self._data

    def save(self, data: dict | None = None) -> None:
        data = self._data if data is None else data
        fd, tmp = tempfile.mkstemp(dir=str(self.path.parent or "."), suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, self.path)
        self._data, self._mtime = data, self.path.stat().st_mtime


class TTL:
    """كاش بسيط بمدة صلاحية — يخفف القراءات المتكررة من قاعدة البيانات."""

    def __init__(self, ttl: float = 30.0, maxsize: int = 2048):
        self.ttl, self.maxsize, self._d = ttl, maxsize, {}

    def get(self, key, default=None):
        v = self._d.get(key)
        if v and v[0] > time.monotonic():
            return v[1]
        return default

    def set(self, key, value):
        if len(self._d) >= self.maxsize:
            self._d.clear()
        self._d[key] = (time.monotonic() + self.ttl, value)
        return value

    def pop(self, key):
        self._d.pop(key, None)

    def clear(self):
        self._d.clear()


_orig_connect = sqlite3.connect


def _fast_connect(*a, **kw):
    kw.setdefault("timeout", 10)
    con = _orig_connect(*a, **kw)
    try:
        con.execute("PRAGMA journal_mode=WAL")
        con.execute("PRAGMA synchronous=NORMAL")
        con.execute("PRAGMA temp_store=MEMORY")
        con.execute("PRAGMA cache_size=-2000")  # ~2MB لكل اتصال
    except sqlite3.Error:
        pass
    return con


def install_fast_sqlite() -> None:
    """يجعل كل اتصالات sqlite في البوت (والكوجات القديمة) أسرع وأخف: WAL + كاش صغير."""
    sqlite3.connect = _fast_connect
