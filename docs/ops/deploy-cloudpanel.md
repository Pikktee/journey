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
  `maptale.io` → `178.104.147.230`. Für Let's-Encrypt-TLS Pflicht
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
MAPTALE_BASIS_URL=https://maptale.io
RESEND_API_KEY=re_…            # aus deiner lokalen .env
MAPTALE_MAIL_ABSENDER=Maptale <noreply@maptale.io>   # Domain muss in Resend verifiziert sein
OPEN_ROUTER_KEY=sk-or-…        # optional (M5): Wetter-Verfeinerung per Bildanalyse (Vision-Modell via OpenRouter); fehlt er, bleibt das Auto-Wetter wie in M2
# MAPTALE_VISION_MODELL=google/gemini-2.5-flash-lite   # optional: Vision-Modell überschreiben
MAPTALE_UMAMI_DB_PASSWORT=<Postgres-Passwort des Umami-Containers>   # optional: nur für den Statistik-Reiter der Verwaltung
```

> **`MAPTALE_UMAMI_DB_PASSWORT`** ist das Postgres-Passwort der selbst gehosteten
> Umami-Instanz (Container `umami-db-1` auf demselben Host; die Route fragt ihn
> per `docker exec … psql` ab). Es steht bewusst nicht im Quelltext — fehlt der
> Wert, zeigt der Reiter „Statistiken" Nullen, alles andere läuft weiter. Muss
> mit dem `POSTGRES_PASSWORD` des Umami-Compose übereinstimmen: Wer es dort
> rotiert, trägt es hier nach und startet die API neu
> (`docker compose -f docker-compose.cloudpanel.yml up -d`).

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
>
> Stand 2026-08-06 nachgezogen: der **Profil-Namensraum**
> `location ~ ^/@` (Etappe 1 aus
> [konzept_profil_konto.md](../concepts/konzept_profil_konto.md)), der
> **Tour-Namensraum** `location ^~ /tour/` (Etappe 5.5) und der Block für die
> beiden dynamischen **Sitemaps**.
>
> **Die Reihenfolge hat sich mit Etappe 6 UMGEDREHT.** Solange die beiden
> Namensräume `rewrite` waren, durfte der Vhost vor dem Code raus: `/@…`
> antwortete dann mit der statischen Seite, die den unbekannten Handle als
> „nicht gefunden" zeigte. Seit sie `proxy_pass` sind, gilt das Gegenteil —
> **erst der Code, dann der Vhost**. Eine API, die `/@handle` noch nicht kennt,
> antwortet dort mit JSON-404: Jede Profil- und Tour-Adresse wäre sofort tot.
>
> Der Container holt sich das gebaute `profil.html`/`erlebnis.html` zur Laufzeit
> über `MAPTALE_WEB_URL` (leer = `MAPTALE_BASIS_URL`, in `/srv/maptale/.env`
> auf `https://maptale.io` gesetzt). Ist die Variable falsch, antwortet jede
> dieser Seiten mit 502 — die Gegenprobe unten fängt das ab.

**Gegenprobe nach jedem Vhost-Eingriff** (alle Zeilen müssen stimmen — kein 404 auf einer
Adresse, die es geben soll, und kein 502 auf `/@…` oder `/tour/…`):

```bash
H=https://maptale.io
for p in /app /anmelden /registrieren /erlebnis /galerie /profil /admin '/@henrik' /tour/kohphangan /sitemap.xml /sitemap-profile.xml /sitemap-touren.xml /robots.txt; do printf '%-22s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' $H$p)"; done
# Die vom Server gesetzten Köpfe: beide müssen den eigenen Titel tragen, nicht den aus dem Build.
printf 'profil-titel     %s\n' "$(curl -s $H/@henrik | grep -o '<title>[^<]*</title>')"
printf 'tour-titel       %s\n' "$(curl -s $H/tour/kohphangan | grep -o '<title>[^<]*</title>')"
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

Danach `https://maptale.io` öffnen → das Studio erscheint,
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
| `CLOUDPANEL_DOCROOT` | `/home/maptale-io/htdocs/maptale.io` |

Danach: `npm run release minor` → Tag → automatischer Deploy.

> **Zur User-Wahl:** Der `rsync` schreibt ins htdocs (gehört dem Site-User), das
> `docker compose` braucht Docker-Rechte. Am einfachsten ist **ein** Deploy-User,
> der beides kann — entweder `root` (dann `CLOUDPANEL_DOCROOT` mit root-rsync,
> Dateien sind für Nginx lesbar) oder der CloudPanel-Site-User, den du einmalig
> mit `usermod -aG docker <site-user>` in die docker-Gruppe aufnimmst.

## 6. Alt-Domains (maptale.henrikheil.net, maptale.de)

Die Site lief bis zum 2026-08-04 unter `maptale.henrikheil.net`. Beide Domains
zeigen weiter auf denselben Server, sind in CloudPanel aber **eigene Sites mit
eigenem Docroot** — und der Deploy befüllt nur einen (`CLOUDPANEL_DOCROOT`).
Eine Alt-Domain, die man einfach stehen lässt, serviert deshalb still einen
**eingefrorenen Altstand**: `maptale.henrikheil.net` lag drei Tage hinter
`maptale.io`, ohne dass irgendetwas kaputt aussah. Also gilt: jede Domain, die
nicht der Docroot des Deploys ist, ist eine **Weiterleitung**.

Der Vhost der Alt-Domain besteht dann nur noch aus drei Blöcken (`.well-known`
für die Zertifikatserneuerung, `/api/`, `location /` → 301) — Muster:
`maptale.de.conf` und `maptale.henrikheil.net.conf` auf dem Server.

> **Stand 2026-08-05 eingesetzt:** `maptale.henrikheil.net` leitet auf
> `maptale.io` um (`/etc/nginx/sites-enabled/maptale.henrikheil.net.conf`,
> Vorzustand als Backup unter `/root/maptale.henrikheil.net.conf.vor-redirect-20260805`).
> Wie jeder Vhost ist das **Handarbeit auf dem Server** — CloudPanel überschreibt
> die Datei, sobald jemand die Site im UI speichert; derselbe Stand gehört dann
> einmal in den Vhost-Editor. Im selben Zug ging die alte Domain aus den drei
> Stellen, an denen wir uns gegenüber fremden Diensten ausweisen: den
> User-Agents für Nominatim ([`naming.ts`](../../server/src/pipeline/naming.ts))
> und Overpass ([`schienen.ts`](../../server/src/pipeline/schienen.ts)) sowie dem
> `http-referer` an OpenRouter ([`vision.ts`](../../server/src/pipeline/vision.ts)).
> Sie stecken in Commit `1d16d8e`, dessen Betreff von der Umami-Umstellung
> spricht — im `git log` ist diese Änderung deshalb nicht zu finden.

> **`/api/` wird NICHT mitumgeleitet.** Android-Installationen aus der Zeit vor
> der Umstellung haben die alte Domain als Server gespeichert
> ([`Einstellungen.kt`](../../android/app/src/main/java/app/maptale/upload/Einstellungen.kt)
> `STANDARD_SERVER`); OkHttp macht aus einem POST hinter 301/302 ein GET und
> wirft dabei den `Authorization`-Header ab — jeder Upload einer Alt-Installation
> schlüge still fehl. Der `location ^~ /api/`-Block bleibt daher unverändert
> stehen und proxyt weiter auf `127.0.0.1:8790`: dieselbe API, dieselbe DB.

Gegenprobe (Web leitet um, API antwortet, Query bleibt erhalten):

```bash
A=https://maptale.henrikheil.net
for p in / /app '/erlebnis?tour=kohphangan'; do curl -sI "$A$p" | grep -iE '^(HTTP|location)'; done
curl -s $A/api/auth/me | head -c 40
```

Nicht vergessen, wenn die Hauptdomain wechselt: `MAPTALE_BASIS_URL` und
`MAPTALE_MAIL_ABSENDER` in `/srv/maptale/.env` (sonst tragen Bestätigungs- und
Reset-Mails weiter die alte Adresse — der Link funktioniert über den Redirect
zwar, steht aber falsch da), das Secret `CLOUDPANEL_DOCROOT`, die Absender-Domain
in Resend und `STANDARD_SERVER` in der Android-App.

## Variante ohne Docker (nativ)

Falls kein Docker: Node 22 + ffmpeg auf den Host (`apt install ffmpeg`), die API
als systemd-Dienst (`server/` bauen: `npm ci && npm run build`, dann
`node dist/index.js` mit denselben Env-Variablen, `MAPTALE_DATEN_DIR` auf ein
Verzeichnis mit Schreibrecht, `PORT=8790` da 8787 belegt ist). Der Nginx-Vhost
bleibt identisch (proxyt weiter auf `127.0.0.1:8790`). Der Deploy zieht dann statt `docker compose` einen
`git pull && npm ci && npm run build && systemctl restart maptale-api`.
