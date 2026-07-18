# Deployment auf Hetzner mit CloudPanel

Alternative zum reinen Docker-Compose-Setup ([README](../README.md)): Luhambo
läuft auf einem Server, auf dem bereits **CloudPanel** installiert ist.
CloudPanels Nginx übernimmt Webserver, TLS und den `/api`-Reverse-Proxy — der
`web`/Caddy-Container entfällt, nur die **API** läuft im Container.

```
Internet ──HTTPS──▶ CloudPanel-Nginx ──┬─▶ dist/ (statischer Web-Build)
   (Domain, LE-Cert)                    └─▶ /api ▶ 127.0.0.1:8790  (API-Container)
                                                    └─ SQLite + Medien in /srv/luhambo/daten
```

Die **Android-App** wird nicht hier gehostet — sie ist eine APK und zeigt mit
ihrer Server-URL auf dieselbe Domain.

## 0. Voraussetzungen

- Eine **Domain oder Subdomain** mit A-Record auf die Server-IP:
  `luhambo.henrikheil.net` → `178.104.147.230`. Für Let's-Encrypt-TLS Pflicht
  — eine nackte IP bekommt kein öffentliches Zertifikat.
- **Docker** auf dem Server (`docker --version`). Falls nicht vorhanden:
  `curl -fsSL https://get.docker.com | sh`. (Ohne Docker: siehe „Variante nativ"
  unten.)
- SSH-Zugang zum Server.

## 1. Datenverzeichnis + .env auf dem Server

```bash
sudo mkdir -p /srv/luhambo/daten
cd /srv/luhambo
# docker-compose.cloudpanel.yml aus dem Repo hierher kopieren
```

`/srv/luhambo/.env` anlegen:

```
LUHAMBO_COOKIE_SECRET=<z. B. `openssl rand -hex 32`>
LUHAMBO_ADMIN_EMAIL=contact@henrikheil.net
LUHAMBO_ADMIN_PASSWORT=<stark>
LUHAMBO_BASIS_URL=https://luhambo.henrikheil.net
RESEND_API_KEY=re_…            # aus deiner lokalen .env
LUHAMBO_MAIL_ABSENDER=Luhambo <noreply@henrikheil.net>   # Domain muss in Resend verifiziert sein
ANTHROPIC_API_KEY=sk-ant-…     # optional (M5): Wetter-Verfeinerung per Bildanalyse; fehlt er, bleibt das Auto-Wetter wie in M2
```

## 2. CloudPanel-Site + Vhost + SSL

1. In CloudPanel eine **Site** für die Domain anlegen (Typ „Static Site" oder
   „Node.js" — der Document-Root ist entscheidend, dorthin kommt später `dist/`).
   CloudPanel legt sie unter `/home/<site-user>/htdocs/<domain>/` an — **diesen
   Pfad + den Site-User notieren**, beides braucht der Deploy (Schritt 5).
2. **Vhost editieren** (Sites → Site → Vhost): die location-Blöcke aus
   [`deploy/cloudpanel-nginx.conf`](../deploy/cloudpanel-nginx.conf) in den
   `server { … }`-Block einfügen (v. a. `client_max_body_size` und `/api/` —
   ohne die scheitern große Uploads bzw. die API ist nicht erreichbar).
3. **SSL** in CloudPanel für die Site aktivieren (Let's Encrypt, ein Klick).

## 3. API starten

```bash
cd /srv/luhambo
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

Danach `https://luhambo.henrikheil.net` öffnen → das Studio erscheint,
Registrierung + Bestätigungsmail funktionieren, ein Test-Upload spielt ab.

## 5. Automatischer Deploy (GitHub Actions)

[`deploy.yml`](../.github/workflows/deploy.yml) ist bereits auf den
CloudPanel-Fluss umgestellt: Test-Gate (Web + Backend + Android) → **API-Image**
nach GHCR → per SSH den API-Container aktualisieren **und** `dist/` in den
Site-Root synchronisieren (der `web`/Caddy-Image-Schritt entfällt). Der
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
| `CLOUDPANEL_DOCROOT` | `/home/<site-user>/htdocs/luhambo.henrikheil.net` |

Danach: `npm run release minor` → Tag → automatischer Deploy.

> **Zur User-Wahl:** Der `rsync` schreibt ins htdocs (gehört dem Site-User), das
> `docker compose` braucht Docker-Rechte. Am einfachsten ist **ein** Deploy-User,
> der beides kann — entweder `root` (dann `CLOUDPANEL_DOCROOT` mit root-rsync,
> Dateien sind für Nginx lesbar) oder der CloudPanel-Site-User, den du einmalig
> mit `usermod -aG docker <site-user>` in die docker-Gruppe aufnimmst.

## Variante ohne Docker (nativ)

Falls kein Docker: Node 22 + ffmpeg auf den Host (`apt install ffmpeg`), die API
als systemd-Dienst (`server/` bauen: `npm ci && npm run build`, dann
`node dist/index.js` mit denselben Env-Variablen, `LUHAMBO_DATEN_DIR` auf ein
Verzeichnis mit Schreibrecht, `PORT=8790` da 8787 belegt ist). Der Nginx-Vhost
bleibt identisch (proxyt weiter auf `127.0.0.1:8790`). Der Deploy zieht dann statt `docker compose` einen
`git pull && npm ci && npm run build && systemctl restart luhambo-api`.
