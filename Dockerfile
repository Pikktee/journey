# ————————————————————————————————————————————
#  Luhambo — Web-Image (Hetzner-VPS, Docker Compose)
#  Zwei Stufen: Vite-Build (Node) → statisches Ausliefern (Caddy).
#  Caddy übernimmt zusätzlich TLS (SITE_ADDRESS) und den /api-Proxy
#  zum Backend-Container — siehe Caddyfile + docker-compose.yml.
#  Keine Build-Secrets nötig — der Google-Key wird nur im Dev genutzt
#  (import.meta.env.DEV), nicht im Prod-Build.
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
# Mit SITE_ADDRESS (Domain) lauscht Caddy auf 80/443 (auto-TLS);
# ohne fällt die Caddyfile auf :8080 zurück (lokales Testen).
EXPOSE 80 443 8080
