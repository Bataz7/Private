@echo off
REM تشغيل البوت على ويندوز
cd /d %~dp0
set PYTHONDONTWRITEBYTECODE=1
if not exist .venv (
  python -m venv .venv
  .venv\Scripts\pip install --no-compile -q -r requirements.txt tzdata
)
.venv\Scripts\python bot.py
