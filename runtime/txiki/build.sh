#!/usr/bin/env bash
# يبني محرك txiki.js المعدّل لـ Rift: ملف تشغيل واحد ثابت (static musl) يشتغل على أي Linux x64 بدون مكتبات.
#   bash runtime/txiki/build.sh            → runtime/tjs
# المتطلبات: git, cmake, make, python3 + pip (لتثبيت zig كمترجم C/C++ لـ musl)
#
# التعديلات (revive.patch + quickjs.patch):
#   - globalThis.__revive: قراءة/كتابة ملفات بشكل متزامن، قياس الذاكرة، GC — يحتاجها البوت
#   - SQLite: الأرقام الأكبر من 2^53 (آيديات ديسكورد) ترجع نص بدل ما تخرب
#   - QuickJS: ما يحتفظ بنص الدوال في الذاكرة
#   - SQLite بدون ذاكرة محجوزة مسبقاً لكل اتصال، مع mimalloc (شغّله مع MIMALLOC_PURGE_DELAY=0 يرجّع الذاكرة فوراً — start.sh يسويها)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WORK="${WORK:-$(mktemp -d)}"
JOBS="${JOBS:-$(nproc 2>/dev/null || echo 4)}"

echo "→ work dir: $WORK"
git clone --quiet --recurse-submodules --shallow-submodules https://github.com/saghul/txiki.js.git "$WORK/txiki.js"
cd "$WORK/txiki.js"
git checkout --quiet "$(cat "$HERE/TXIKI_COMMIT")"
git submodule update --quiet --init --recursive
git apply "$HERE/revive.patch"
(cd deps/quickjs && git apply "$HERE/quickjs.patch")

# zig = مترجم C/C++ يستهدف musl بشكل ثابت (يشمل libc++)
python3 -m pip install --quiet ziglang
BIN="$WORK/zig"
mkdir -p "$BIN"
for t in cc c++; do
  printf '#!/bin/sh\nexec python3 -m ziglang %s -target x86_64-linux-musl "$@"\n' "$t" > "$BIN/z$t"
done
printf '#!/bin/sh\nexec python3 -m ziglang ar "$@"\n' > "$BIN/zar"
printf '#!/bin/sh\nexec python3 -m ziglang ranlib "$@"\n' > "$BIN/zranlib"
chmod +x "$BIN"/*

mkdir -p build && cd build
CC="$BIN/zcc" CXX="$BIN/zc++" cmake .. \
  -DCMAKE_AR="$BIN/zar" -DCMAKE_RANLIB="$BIN/zranlib" \
  -DCMAKE_BUILD_TYPE=MinSizeRel -DCMAKE_EXE_LINKER_FLAGS="-static" \
  -DBUILD_WITH_WASM=OFF -DBUILD_WITH_FFI=OFF -DBUILD_WITH_MIMALLOC=ON -DBUILD_WITH_GC_SECTIONS=ON \
  -DCMAKE_C_FLAGS="-Wno-date-time -DSQLITE_DEFAULT_LOOKASIDE=0,0 -DSQLITE_DEFAULT_PCACHE_INITSZ=0 -DSQLITE_DEFAULT_CACHE_SIZE=-128" \
  -DCMAKE_CXX_FLAGS="-Wno-date-time" > /dev/null
make -j"$JOBS" tjs-cli > build.log 2>&1 || { tail -30 build.log; exit 1; }
strip tjs 2>/dev/null || true
cp tjs "$ROOT/runtime/tjs"
echo "✓ runtime/tjs ($(du -h "$ROOT/runtime/tjs" | cut -f1))"
