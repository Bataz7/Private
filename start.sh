#!/usr/bin/env bash
# تشغيل ريفايف:
#   - لو موجود runtime/tjs (محرك txiki.js الخفيف — انظر runtime/txiki/build.sh) يشتغل عليه: ذاكرة < 20 ميقا
#   - وإلا يشتغل على Bun (أسهل تثبيت، ذاكرة ~40 ميقا)
cd "$(dirname "$0")" || exit 1
if [ -x runtime/tjs ]; then
  [ -f dist/revive.js ] || { echo "dist/revive.js missing — run: bun run build"; exit 1; }
  exec runtime/tjs run dist/revive.js
fi
if command -v bun >/dev/null 2>&1; then
  exec env BUN_JSC_useDFGJIT=0 BUN_JSC_useFTLJIT=0 bun --smol src/index.ts
fi
echo "Bun is not installed: curl -fsSL https://bun.sh/install | bash"
exit 1
