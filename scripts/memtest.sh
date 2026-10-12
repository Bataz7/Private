#!/usr/bin/env bash
# يشغّل البوت ضد سيرفر Discord وهمي تحت ضغط ويقيس استهلاك الذاكرة (RSS).
#   bash scripts/memtest.sh [ثواني=90] [bot-command]
# مثال على الملف التنفيذي: bash scripts/memtest.sh 120 ./revive
cd "$(dirname "$0")/.." || exit 1
SECS=${1:-90}
CMD=${2:-"bun --smol src/index.ts"}
PORT=${MOCK_PORT:-37999}
DATA=$(mktemp -d)

MOCK_PORT=$PORT bun scripts/mock-discord.ts > "$DATA/mock.log" 2>&1 &
MOCK=$!
sleep 1

export DISCORD_TOKEN=aaaaaaaaaaaaaaaaaaaaaaaa.bbbbbb.ccccccccccccccccccccccccccccccccccccccc
export DISCORD_API_BASE=http://127.0.0.1:$PORT/api/v10 DISCORD_GATEWAY_URL=ws://127.0.0.1:$PORT/gw
export AUTO_EMOJIS=0 DATA_DIR=$DATA
$CMD > "$DATA/bot.log" 2>&1 &
BOT=$!

max=0; maxanon=0; sum=0; n=0
for ((t=0; t<SECS; t+=5)); do
  sleep 5
  if ! kill -0 $BOT 2>/dev/null; then echo "bot exited"; cat "$DATA/bot.log" | tail -20; break; fi
  rss=$(ps -o rss= -p $BOT | tr -d ' ')
  anon=$(awk '/^Private_Dirty/{print $2}' /proc/$BOT/smaps_rollup 2>/dev/null)
  mb=$(awk "BEGIN{printf \"%.1f\", $rss/1024}")
  echo "t=${t}s rss=${mb}MB private=$(awk "BEGIN{printf \"%.1f\", ${anon:-0}/1024}")MB"
  (( ${anon:-0} > maxanon )) && maxanon=${anon:-0}
  (( rss > max )) && max=$rss
  sum=$((sum + rss)); n=$((n + 1))
done
kill $BOT $MOCK 2>/dev/null
wait 2>/dev/null
echo "---"
awk "BEGIN{printf \"max rss %.1f MB · avg %.1f MB · max private %.1f MB over %d samples\n\", $max/1024, ($sum/($n>0?$n:1))/1024, $maxanon/1024, $n}"
grep -c "ERRO" "$DATA/bot.log" | xargs echo "bot errors:"
grep "ERRO" "$DATA/bot.log" | sort | uniq -c | sort -rn | head -5
tail -3 "$DATA/mock.log"
rm -rf "$DATA"
