"""يرفع إيموجيات ريفايف لتطبيقك في ديسكورد (مرة واحدة) | Uploads the pack as Application Emojis.
    DISCORD_TOKEN=xxxx python tools/upload_emojis.py
"""
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import emojis  # noqa: E402

token = os.environ.get("DISCORD_TOKEN") or (sys.argv[1] if len(sys.argv) > 1 else "")
if not token:
    sys.exit("ضع توكن البوت: DISCORD_TOKEN=... python tools/upload_emojis.py")
ids = asyncio.run(emojis.sync(token))
print(f"تم ✅ {len(ids)} إيموجي جاهزة / ready → emojis/ids.json")
