FROM node:24-slim AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:24-slim

# Install curl for the health check, then drop to a dedicated non-root user.
# Run the final image as an unprivileged user.
RUN apt-get update && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd -r app --gid 1001 \
  && useradd -r -g app --uid 1001 -d /app -s /usr/sbin/nologin app \
  && mkdir -p /app /data/payloads \
  && chown -R app:app /app /data/payloads

WORKDIR /app
COPY --from=builder --chown=app:app /app/package*.json ./
RUN npm ci --omit=dev \
  && chown -R app:app /app/node_modules
COPY --from=builder --chown=app:app /app/dist/ ./dist/
COPY --chown=app:app scripts/ ./scripts/

ENV NODE_ENV=production
ENV PORT=3076

USER app

EXPOSE 3076

HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD curl -sf http://localhost:3076/healthz || exit 1

CMD ["node", "dist/http.js"]
