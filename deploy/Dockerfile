# BotArk Web (Hark-first) — headless Electron backend + browser SPA.
#
# Build from the repository root:
#   docker build -f deploy/Dockerfile -t botark-web .
#
# The runtime image runs the packaged Linux app under Xvfb; the browser UI is
# served by the app's own Web Gateway on port 29178.

FROM node:22-bookworm AS build
WORKDIR /app
ENV DEBIAN_FRONTEND=noninteractive

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run dist:web

FROM node:22-bookworm-slim AS runtime
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgtk-3-0 libnss3 libasound2 libgbm1 libx11-xcb1 libxcomposite1 \
    libxdamage1 libxrandr2 libxtst6 libxss1 libsecret-1-0 \
    xvfb xauth fonts-noto-cjk ca-certificates curl dumb-init \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 10001 botark \
    && mkdir -p /data \
    && chown -R botark:botark /data

COPY --from=build /app/release/linux-unpacked /app/botark
RUN chown -R botark:botark /app/botark

USER botark
ENV BOTARK_WEB=1 \
    BOTARK_WEB_HOST=0.0.0.0 \
    BOTARK_WEB_PORT=29178 \
    BOTARK_DATA_DIR=/data \
    BOTARK_WEB_ROOT=/app/botark/resources/web \
    BOTARK_MIHOMO_BIN=/app/botark/resources/mihomo \
    ELECTRON_DISABLE_SECURITY_WARNINGS=1

EXPOSE 29178
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://127.0.0.1:29178/api/web/v1/health || exit 1

ENTRYPOINT ["dumb-init", "--", "xvfb-run", "-a", "-s", "-screen 0 1440x900x24", "/app/botark/botark", "--no-sandbox", "--disable-gpu", "--web"]
