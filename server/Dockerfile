# ————————————————————————————————————————————
#  Luhambo-API — Produktions-Image (Hetzner-VPS, Docker Compose)
#  Zwei Stufen: TypeScript-Build → schlanke Runtime mit ffmpeg
#  (Video-Transcode/Poster ab M4). Tour-Daten liegen im Bind-Mount /data.
# ————————————————————————————————————————————

# ---- Build-Stufe ----
FROM node:22-alpine AS build
# Sicherheitsnetz für native Module (better-sqlite3, @node-rs/argon2):
# fehlt für musl/arm64 ein Prebuild, kompiliert node-gyp selbst.
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---- Runtime ----
FROM node:22-alpine
RUN apk add --no-cache ffmpeg
ENV NODE_ENV=production \
    LUHAMBO_DATEN_DIR=/data \
    PORT=8787
WORKDIR /app
COPY package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
EXPOSE 8787
CMD ["node", "dist/index.js"]
