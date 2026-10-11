# Mood Bot — صورة خفيفة: Node فقط، بدون أي مكتبات (zero dependencies)
# لقاعدة PostgreSQL/MySQL/MongoDB:  docker compose build --build-arg DB_DRIVER=pg   (أو mysql2 أو mongodb)
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ARG DB_DRIVER=""
COPY package.json start.mjs ./
RUN if [ -n "$DB_DRIVER" ]; then npm install --omit=dev --no-save --no-audit --no-fund "$DB_DRIVER" && npm cache clean --force; fi
COPY src ./src
COPY assets ./assets
RUN mkdir -p /app/data && chown -R node:node /app
USER node
VOLUME ["/app/data"]
# صحي لو المجدول اشتغل خلال آخر 3 دقايق
HEALTHCHECK --interval=60s --timeout=5s --start-period=90s --retries=3 \
  CMD node -e "const t=+require('fs').readFileSync('/app/data/.heartbeat','utf8');process.exit(Date.now()-t<180000?0:1)"
CMD ["node", "start.mjs"]
