#!/bin/sh
# تشغيل البوت (لينكس/ماك). أول مرة ينشئ بيئة ويثبت المكتبات.
cd "$(dirname "$0")"
export PYTHONDONTWRITEBYTECODE=1
if [ ! -d .venv ]; then
  python3 -m venv .venv && .venv/bin/pip install --no-compile -q -r requirements.txt
fi
exec .venv/bin/python bot.py
