# Deployment auf Hetzner mit CloudPanel

Alternative zum reinen Docker-Compose-Setup ([README](../../README.md)): Luhambo
läuft auf einem Server, auf dem bereits **CloudPanel** installiert ist.
CloudPanels Nginx übernimmt Webserver, TLS und den `/api`-Reverse-Proxy — der
`web`/Caddy-Container entfällt, nur die **API** läuft im Container.

```
Internet ──HTTPS──▶ CloudPanel-Nginx ──┬─▶ dist/ (statischer Web-Build)
   (Domain, LE-Cert)                    └─▶ /api ▶ 127.0.0.1:8790  (API-Container)
                                                    └─ SQLite + Medien in /srv/maptale/daten
```

Die **Android-App** wird nicht hier gehostet — sie ist eine APK und zeigt mit
ihrer Server-URL auf dieselbe Domain.

## 0. Voraussetzungen

- Eine **Domain oder Subdomain** mit A-Record auf die Server-IP:
  `maptale.henrikheil.net` → `178.104.147.230`. Für Let's-Encrypt-TLS Pflicht
  — eine nackte IP bekommt kein öffentliches Zertifikat.
- **Docker** auf dem Server (`docker --version`). Falls nicht vorhanden:
  `curl -fsSL https://get.docker.com | sh`. (Ohne Docker: siehe „Variante nativ"
  unten.)
- SSH-Zugang zum Server.

## 1. Datenverzeichnis + .env auf dem Server

```bash
sudo mkdir -p /srv/maptale/daten
cd /srv/maptale
# docker-compose.cloudpanel.yml aus dem Repo hierher kopieren
```

`/srv/maptale/.env` anlegen:

```
MAPTALE_COOKIE_SECRET=<z. B. `openssl rand -hex 32`>
MAPTALE_ADMIN_EMAIL=contact@henrikheil.net
MAPTALE_ADMIN_PASSWORT=<stark>
MAPTALE_BASIS_URL=https://maptale.henrikheil.net
RESEND_API_KEY=re_…            # aus deiner lokalen .env
MAPTALE_MAIL_ABSENDER=Luhambo <noreply@henrikheil.net>   # Domain muss in Resend verifiziert sein
OPEN_ROUTER_KEY=sk-or-…        # optional (M5): Wetter-Verfeinerung per Bildanalyse (Vision-Modell via OpenRouter); fehlt er, bleibt das Auto-Wetter wie in M2
# MAPTALE_VISION_MODELL=google/gemini-2.5-flash-lite   # optional: Vision-Modell überschreiben
```

## 2. CloudPanel-Site + Vhost + SSL

1. In CloudPanel eine **Site** für die Domain anlegen (Typ „Static Site" oder
   „Node.js" — der Document-Root ist entscheidend, dorthin kommt später `dist/`).
   CloudPanel legt sie unter `/home/<site-user>/htdocs/<domain>/` an — **diesen
   Pfad + den Site-User notieren**, beides braucht der Deploy (Schritt 5).
2. **Vhost editieren** (Sites → Site → Vhost): die location-Blöcke aus
   [`deploy/cloudpanel-nginx.conf`](../../deploy/cloudpanel-nginx.conf) in den
   `server { … }`-Block einfügen (v. a. `client_max_body_size` und `/api/` —
   ohne die scheitern große Uploads bzw. die API ist nicht erreichbar).
3. **SSL** in CloudPanel für die Site aktivieren (Let's Encrypt, ein Klick).

> **Der Vhost ist Handarbeit und wird beim Deploy NICHT mitgezogen.** Ändert
> sich [`deploy/cloudpanel-nginx.conf`](../../deploy/cloudpanel-nginx.conf), muss
> derselbe Stand vor dem nächsten `npm run release` in den CloudPanel-Editor —
> sonst rollt der Deploy einen Build aus, den der Server nicht bedienen kann.
>
> Und: **auf dem Server steht CloudPanels eigenes Gerüst, nicht diese Datei.**
> Sie ist die Sammlung der Blöcke, die von Hand hineingehören — plus (unten in
> der Datei) der Nachtrag an CloudPanels eigenen Locations. Wer den Vhost neu
> aufsetzt oder CloudPanel ihn zurücksetzt, braucht beides.
>
> Stand 2026-08-03 eingesetzt: die **URLs ohne `.html`** (`try_files $uri
> $uri.html $uri/ =404;` plus je ein `location =`-Block für `/app`, `/anmelden`
> und `/registrieren`), der **`include /etc/nginx/global_settings;`** in allen
> vier Blöcken mit eigenem `add_header` und **`error_page 404 /404.html;`**.
> Die Fehlerseite selbst braucht keinen Handgriff: Sie liegt in
> [`public/404.html`](../public/404.html), und Vite kopiert `public/`
> unverändert nach `dist/` — der normale Rollout bringt sie mit.

**Gegenprobe nach jedem Vhost-Eingriff** (drei Zeilen, alle drei müssen stimmen):

```bash
H=https://maptale.henrikheil.net
for p in /app /anmelden /registrieren /erlebnis /galerie /profil /admin; do printf '%-16s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' $H$p)"; done
printf 'unbekannt        %s (%s)\n' "$(curl -s -o /dev/null -w '%{http_code}' $H/gibtsnicht)" "$(curl -s $H/gibtsnicht | grep -o '<title>[^<]*</title>')"
printf 'api/unbekannt    %s (%s)\n' "$(curl -s -o /dev/null -w '%{http_code}' $H/api/tours/gibtsnicht)" "$(curl -s $H/api/tours/gibtsnicht | head -c 40)"
for u in /app /assets/ /api/auth/me; do printf '%-16s %s/3 Header\n' "$u" "$(curl -sI $H$u | grep -icE 'x-frame-options|x-content-type-options|referrer-policy')"; done
```

Erwartet: alle echten Pfade **200**; ein unbekannter **404 mit „Seite nicht
gefunden · Maptale"** (kein Soft-404 auf die Landing, aber auch nicht Nginx'
nackter Standardtext); ein unbekannter API-Pfad **404 mit JSON** (nicht mit der
HTML-Seite — sonst steht `proxy_intercept_errors` an); und **3/3**
Sicherheits-Header auf jeder Antwort. Antwortet ein echter Pfad mit 404, fehlen
die `location`-Blöcke; meldet eine Antwort 0/3, fehlt irgendwo der `include`.

## 3. API starten

```bash
cd /srv/maptale
# GHCR-Image ziehen (public oder mit `docker login ghcr.io`):
docker compose -f docker-compose.cloudpanel.yml up -d
docker compose -f docker-compose.cloudpanel.yml logs -f api   # „läuft auf Port 8787"
```

Test: `curl -s http://127.0.0.1:8790/api/gesundheit` → `{"ok":true}`. (Host-Port
8790, weil 8787 auf dem Server belegt ist; container-intern loggt die API 8787.)

## 4. Web-Build ausliefern

Der statische Build gehört in den Document-Root der Site. Lokal gebaut und
hochgeladen:

```bash
npm run build                                   # erzeugt dist/
rsync -az --delete dist/ <site-user>@178.104.147.230:/home/<site-user>/htdocs/<domain>/
```

Danach `https://maptale.henrikheil.net` öffnen → das Studio erscheint,
Registrierung + Bestätigungsmail funktionieren, ein Test-Upload spielt ab.

## 5. Automatischer Deploy (GitHub Actions)

[`deploy.yml`](../.github/workflows/deploy.yml) ist bereits auf den
CloudPanel-Fluss umgestellt: Test-Gate (Web + Backend + Android) → **API-Image**
nach GHCR → per SSH die **Compose-Datei** auf den Server spiegeln, den
API-Container aktualisieren **und** `dist/` in den Site-Root synchronisieren
(der `web`/Caddy-Image-Schritt entfällt). Weil die Compose-Datei mitgespiegelt
wird, brauchen neue Env-Variablen (z. B. `OPEN_ROUTER_KEY`) künftig nur noch
eine Zeile in `/srv/maptale/.env` — die Durchreichung kommt aus dem Repo. Der
Server-Deploy-Schritt ist an das Secret `CLOUDPANEL_DOCROOT` gekoppelt: solange
es fehlt, **baut der Tag nur das API-Image** und überspringt das Ausrollen — der
**erste** Deploy läuft also manuell (Schritte 1–4), danach setzt du die Secrets
und jeder weitere Tag rollt automatisch aus. Nötige GitHub-Secrets
(Repo → Settings → Secrets → Actions):

| Secret | Wert |
|---|---|
| `VPS_HOST` | `178.104.147.230` |
| `VPS_USER` | Deploy-User: muss Docker ausführen (root **oder** in der `docker`-Gruppe) **und** Schreibrecht im htdocs haben |
| `VPS_SSH_KEY` | privater Deploy-Key (öffentliches Gegenstück in `~/.ssh/authorized_keys` des Deploy-Users) |
| `CLOUDPANEL_DOCROOT` | `/home/<site-user>/htdocs/maptale.henrikheil.net` |

Danach: `npm run release minor` → Tag → automatischer Deploy.

> **Zur User-Wahl:** Der `rsync` schreibt ins htdocs (gehört dem Site-User), das
> `docker compose` braucht Docker-Rechte. Am einfachsten ist **ein** Deploy-User,
> der beides kann — entweder `root` (dann `CLOUDPANEL_DOCROOT` mit root-rsync,
> Dateien sind für Nginx lesbar) oder der CloudPanel-Site-User, den du einmalig
> mit `usermod -aG docker <site-user>` in die docker-Gruppe aufnimmst.

## Variante ohne Docker (nativ)

Falls kein Docker: Node 22 + ffmpeg auf den Host (`apt install ffmpeg`), die API
als systemd-Dienst (`server/` bauen: `npm ci && npm run build`, dann
`node dist/index.js` mit denselben Env-Variablen, `MAPTALE_DATEN_DIR` auf ein
Verzeichnis mit Schreibrecht, `PORT=8790` da 8787 belegt ist). Der Nginx-Vhost
bleibt identisch (proxyt weiter auf `127.0.0.1:8790`). Der Deploy zieht dann statt `docker compose` einen
`git pull && npm ci && npm run build && systemctl restart maptale-api`.
