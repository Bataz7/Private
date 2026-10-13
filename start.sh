#!/usr/bin/env bash
# تشغيل Rift بأقل ذاكرة (أقل من 20 ميقا): محرك txiki.js المرفق (runtime/tjs) + الحزمة dist/rift.js.
#   bash start.sh            → البوت
#   bash start.sh --bun      → البوت على Bun (أسهل للتطوير، ذاكرة أكثر ~60 ميقا)
# لو dist/rift.js مو موجود أو أقدم من الكود، ينبني تلقائياً (يحتاج Bun).
cd "$(dirname "$0")" || exit 1

if [ "$1" = "--bun" ] || [ ! -x runtime/tjs ]; then
  [ "$1" != "--bun" ] && echo "runtime/tjs غير موجود — التشغيل على Bun"
  exec bun --smol src/index.ts
fi

if command -v bun >/dev/null 2>&1; then
  if [ ! -f dist/rift.js ] || [ -n "$(find src -newer dist/rift.js -name '*.ts' -print -quit 2>/dev/null)" ]; then
    bun scripts/build.ts || exit 1
  fi
elif [ ! -f dist/rift.js ]; then
  echo "dist/rift.js غير موجود ولا يوجد Bun لبنائه. ثبّت Bun أو انسخ dist/rift.js." >&2
  exit 1
fi

# mimalloc يرجّع الذاكرة الفاضية للنظام فوراً
export MIMALLOC_PURGE_DELAY=${MIMALLOC_PURGE_DELAY:-0}
export MIMALLOC_ARENA_EAGER_COMMIT=${MIMALLOC_ARENA_EAGER_COMMIT:-0}

# يعيد التشغيل تلقائياً لو طاح (إلا عند الإيقاف بـ Ctrl+C)
while true; do
  ./runtime/tjs run dist/rift.js
  code=$?
  [ $code -eq 0 ] || [ $code -eq 130 ] && exit $code
  echo "البوت توقف (رمز $code) — إعادة التشغيل بعد 5 ثواني…" >&2
  sleep 5
done
