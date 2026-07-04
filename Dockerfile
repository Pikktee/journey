# ————————————————————————————————————————————
#  Luhambo — Produktions-Image für Railway
#  Zwei Stufen: Vite-Build (Node) → statisches Ausliefern (Caddy).
#  Kein Node-Runtime und keine Build-Secrets nötig — der Google-Key
#  wird nur im Dev genutzt (import.meta.env.DEV), nicht im Prod-Build.
# ————————————————————————————————————————————

# ---- Build-Stufe: Vite-Produktionsbuild nach /app/dist ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- Serve-Stufe: dist/ statisch via Caddy ausliefern ----
FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
# Railway gibt den Port über $PORT vor; Caddy liest ihn aus der Caddyfile.
EXPOSE 8080
