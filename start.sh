#!/usr/bin/env bash
# تشغيل ريفايف: يثبّت المتطلبات ثم يشغّل البوت | install deps and run the bot
cd "$(dirname "$0")" || exit 1
PY=$(command -v python3 || command -v python)
"$PY" -m pip install -q -r requirements.txt || "$PY" -m pip install -q --user -r requirements.txt
exec "$PY" main.py
