# Dashain Raffle: zero-dependency Node app. No npm install step; the image is the official Node runtime + three files.
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data

WORKDIR /app
COPY package.json server.js ./
COPY public ./public

# All state (raffle.json, hourly snapshots, uploaded QR codes) lives in /data. Mount a volume there.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

LABEL org.opencontainers.image.title="dashain-raffle" \
      org.opencontainers.image.description="Company raffle with live odds, ticket sales, self-service, finance queue and live draw"

CMD ["node", "server.js"]
