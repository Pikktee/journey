# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Was das ist

Maptale ist eine App für Relive-artige 3D-Kamerafahrten über eine GPS-Route mit
automatischen Foto-Stopps — vollständig auf freien Kartendaten. Web-Player in Vite,
gerendert mit MapLibre GL JS. **Player und Studio sind vollständig TypeScript** — unter
`src/` liegt seit dem 2026-08-11 keine `.js` mehr; die Migration und ihre Befunde stehen in
[docs/archive/konzept_player_typescript.md](docs/archive/konzept_player_typescript.md).
`allowJs` ist aus und bleibt es: Eine neue `.js` unter `src/` stünde außerhalb von `tsc` und
fiele erst am Aufrufer auf (`TS7016`). Das übrige JS des Repos (`vite.config.js`,
`vitest.config.js`, `scripts/*.mjs`) läuft unter Node bzw. Vites Config-Loader und bleibt.

**Maptale wird von einem Prototyp zu einem echten Produkt ausgebaut** (Aufnahme-Plattform,
Meilensteine M1–M9): eigene Touren aufzeichnen (Android), hochladen, serverseitig anreichern
und mit der vorhandenen Player-Engine abspielen. Das Repo ist ein **Monorepo**:

- **Root**: Web-Player (Vite). Spielt statische `TOURS` und aufgezeichnete Touren
  (`/tour/t_<id>` → [src/remote.ts](src/remote.ts) gegen das Backend).
- **[server/](server/)**: Backend (Node 22 + Fastify + better-sqlite3, TypeScript strict).
  Upload → Anreicherungs-Pipeline (Benennung via Nominatim, Pausen-Kollaps — GPS-Drift im
  Stand wird auf den Schwerpunkt gezogen, sonst zittert die Kamera und die km-Statistik lügt;
  läuft in `ladeOriginalSegmente`, der von Editor UND Render geteilten Stelle —, Track-
  Vereinfachung, Timeline mit Pausen-Zeitraffer, Medien-Platzierung, Edit-Overlay,
  Auto-Wetter via Open-Meteo, Wetter-Verfeinerung per Foto-Bildanalyse) → Tour-JSON. Dazu Mehrbenutzer-Betrieb: Konten mit
  Mail-Bestätigung, Passwort-Reset, Quota, Sichtbarkeit, Rollen und Einladungen
  ([server/src/auth/](server/src/auth/), `quota.ts`, `mail.ts`).
  Schema-Doku: [docs/specs/austauschformat.md](docs/specs/austauschformat.md);
  wer wofür zuständig ist (Rohdaten / Overlay / Tour-JSON / Cache) und wohin ein neues Feld
  gehört: [docs/specs/overlay-und-tourjson.md](docs/specs/overlay-und-tourjson.md).
- **Studio** ([studio.html](studio.html) + [src/studio/](src/studio/)): Weboberfläche zum
  Hochladen und Bearbeiten aufgezeichneter Touren (s. eigener Abschnitt unten).
- **Öffentliche Seiten**: [galerie.html](galerie.html) (alle auf `public` gestellten Touren,
  Logik in [src/galerie/](src/galerie/)) und [profil.html](profil.html) (`/@henrik`, die
  Reisen einer Person; `?id=…` bleibt als Alias, Logik in [src/profil/](src/profil/)). Beide
  ohne Anmeldung; die Kartendaten teilen sie sich
  ([galeriemodell.ts](src/galerie/galeriemodell.ts)), alles Übrige der Profilseite —
  Kennzahlen, Link-Chips, „gehört mir?" — steht DOM-frei in
  [profilmodell.ts](src/profil/profilmodell.ts). **Kennzahlen summiert der SERVER und nur
  über öffentliche Touren**: „12 Touren" neben drei sichtbaren Karten wäre eine Auskunft über
  die anderen neun. Das Bearbeiten-Modal wird erst für den Besitzer nachgeladen
  ([profilbearbeiten.ts](src/profil/profilbearbeiten.ts)). Ohne Anzeigenamen steht im Kopf
  der HANDLE (nicht „Ohne Namen" — das beschrieb ein leeres Datenbankfeld, nicht die
  Person; er fällt dann aus dem Beiwerk, sonst stünde er zweimal), und ohne gewähltes
  Titelbild zeigt das Banner eines der vier mitgelieferten, deterministisch aus dem Handle
  gewählt ([titelbilder.ts](src/profil/titelbilder.ts) `standardTitelbild`) — zufällig
  bekäme dieselbe Person bei jedem Aufruf ein anderes Kopfbild.
- **Kontoeinstellungen** ([konto.html](konto.html) + [src/konto/](src/konto/)): eigene Seite
  unter `/konto`, nicht im Studio (s. eigener Abschnitt unten).
- **Benutzerverwaltung** ([admin.html](admin.html) + [src/admin/](src/admin/)): Konten,
  Rollen und Einladungen (s. eigener Abschnitt unten).
- **[android/](android/)**: Aufnahme-App (Kotlin, Compose, minSdk 29) — s. eigener Abschnitt.

Sprache im gesamten Projekt (Code-Kommentare, UI, Doku, Commit-Messages) ist **Deutsch** —
auch in server/ und android/ (deutsche Bezeichner).

**Design System.** Kanonische Quelle für Marke, Farben, Typografie und UI-Dos/Don’ts ist
[`DESIGN.md`](DESIGN.md) (Google DESIGN.md-Format). Coding-Assistenten und UI-Arbeit folgen
dieser Datei; CSS-Variablen, [`src/brand.ts`](src/brand.ts) und Android `Theme.kt` /
`Typografie.kt` sind Ableitungen. Kurzregel: Outfit überall; Zahlen mit
`font-variant-numeric: tabular-nums` (Compose: `fontFeatureSettings = "tnum"`), nicht Mono.

**Im Web sind die Tokens genau eine Datei:** [`src/basis.css`](src/basis.css) — Farben,
Radien, Schrift, Maße, aus dem YAML-Kopf von DESIGN.md abgeleitet. Daneben liegen die
geteilten Bausteine: [`grundelemente.css`](src/grundelemente.css) (Kopfleiste, Konto-Menü,
Dialogschicht, Fußzeile — die Produkt-Seiten) und [`werkzeug.css`](src/werkzeug.css) (Knöpfe,
Felder, Etiketten von Studio und Verwaltung). **Zwei Dateien und nicht eine**, weil es zwei
Knopf-Register gibt — Pillen auf den öffentlichen Seiten, Kästen im Werkzeug —, und
`button.knopf` (Pille) `button, .knopf` (Kasten) durch die höhere Spezifität schlägt; in
einer Datei würden die Werkzeugleisten still zu Pillenreihen.

Drei Regeln, die man dabei leicht kippt: **Die Blätter hängen als `<link>` VOR dem
`<style>`-Block** jeder Seite, nicht als Modul-Import — Vite hängt gebautes CSS ans ENDE des
`<head>`, die Basis schlüge dort alles, was die Seite absichtlich anders macht (die
Verwaltung wurde so 80 px breiter, ohne dass sich eine Zeile ihres CSS änderte). Der
Dev-Server tut das NICHT, es fiele erst nach dem Deploy auf; `basisZuerst()` in
[vite.config.js](vite.config.js) stellt die Reihenfolge nach dem Bauen wieder her und erkennt
die Blätter an einer eigenen Custom Property (`--blatt-basis: 1`), weil Vite eine CSS-Datei
nach ihrem JS-Chunk benennt und nicht nach der Quelle. **Was zweimal vorkommt, gehört in ein
Blatt; was einmal vorkommt, bleibt in der Seite** — dort stehen nur noch ihre Abweichungen
(Lesebreite, Dialogbreite, Zeitleisten-Maße). Und **keine Farbe steht zweimal**: weder als
eigenes Token in einer HTML-Datei noch roh in einer Regel. Ein Drift-Wächter
([test/basis-css.test.ts](test/basis-css.test.ts)) hält DESIGN.md und `basis.css`
deckungsgleich, verbietet beides und findet Regeln, die eine Variable lesen, die es nicht
gibt (`var(--text-3)` im Passwortfeld war so ein Fall — auf zwei von drei Seiten undefiniert,
das Augen-Icon erbte deshalb die Textfarbe). `public/404.html` ist die eine erlaubte Kopie:
Sie liegt außerhalb des Builds, weil eine Fehlerseite auch dann stehen muss, wenn genau das
Bundle fehlt, das sie melden soll.

## Commands

```bash
npm install
npm run dev      # Vite-Dev-Server, Port 5173 (strictPort — belegt = Fehler, nicht Ausweichport)
npm run build    # Produktions-Build nach dist/
npm run preview  # gebautes dist/ lokal servieren
npm run release  # Version anheben + Tag pushen → triggert Deploy (bugfix|minor|major)
```

Weitere Arbeitsbereiche:

```bash
npm test                      # Web-Unit-Tests (Vitest: geo.ts, remote.ts/timeAt, audiotracks.ts
                              #   und die Studio-Logik — Editor, Baukasten, Upload, EXIF)
npm run typecheck             # tsc --noEmit; die CI deployt ohne grünen Typecheck nicht
cd server && npm run dev      # Backend (tsx watch, Port 8787; via PORT übersteuerbar)
cd server && npm test         # Backend-Tests (Vitest)
cd server && npm run test:coverage  # dieselben Tests mit Coverage-Gate 80 % (wie in der CI)
cd android && ./gradlew test  # Android-Unit-Tests (JAVA_HOME auf JDK 17 setzen)
```

Optik-Verifikation läuft weiterhin über den Dev-Server im Browser. Dev-Proxy: `/api` →
`http://localhost:8787` (übersteuerbar via `MAPTALE_API`-Env, z. B. wenn 8787 belegt ist —
auf dem Server läuft die API aus demselben Grund auf Host-Port 8790).

Tour-Auswahl über den Pfad: `/tour/<id aus TOURS>` (`/erlebnis` ohne Kennung spielt die
Standard-Tour `kohphangan`), aufgezeichnete Touren unter ihrer Server-Kennung `/tour/t_<id>`.
Die Alt-Form `?tour=…` bleibt bedienbar und wird beim Start per `replaceState` auf den Pfad
gezogen. `?app=1` markiert die Android-WebView.

**Deployment.** Hetzner-VPS mit CloudPanel (Railway und der Caddy-Container sind abgelöst):
CloudPanels Nginx serviert den statischen Build und proxyt `/api`; **nur die API läuft im
Container** ([docker-compose.cloudpanel.yml](docker-compose.cloudpanel.yml) →
[server/Dockerfile](server/Dockerfile), Host-Port `127.0.0.1:8790` → Container 8787,
Daten-Bind-Mount `/srv/maptale/daten`). Ein Version-Tag `vX.Y.Z` triggert
[.github/workflows/deploy.yml](.github/workflows/deploy.yml): Gate aus Web-Tests + Typecheck +
Build, Backend-Tests mit Coverage-Gate und Android-Unit-Tests → API-Image nach GHCR → per SSH
`docker compose -f docker-compose.cloudpanel.yml up -d` plus `rsync` des `dist/` in den
Site-Docroot. Tags erzeugt [scripts/release.sh](scripts/release.sh) (`npm run release`). Nötige
Secrets: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `CLOUDPANEL_DOCROOT` (fehlt letzteres, wird der
Rollout still übersprungen). Runbook: [docs/ops/deploy-cloudpanel.md](docs/ops/deploy-cloudpanel.md).
**Derselbe Tag baut die Android-App** und hängt den APK ans Release
`android-X.Y.Z` — der Download-Knopf der Landing zeigt fest auf
`releases/latest/download/maptale-android.apk` und lief, solange das von Hand geschah,
regelmäßig dem Code hinterher. Die App-Version kommt aus derselben `package.json`
(`versionCode` = `major*10000 + minor*100 + patch`); ohne hinterlegten Debug-Keystore
(`ANDROID_DEBUG_KEYSTORE_BASE64`) signiert jeder Lauf anders und der APK kann eine vorhandene
Installation nicht aktualisieren: [docs/ops/android-release.md](docs/ops/android-release.md).
`docker-compose.yml` + [Caddyfile](Caddyfile) bleiben als Alt-Weg für Server ohne CloudPanel.

## Architektur

Es gibt drei unabhängige Frontends: den **Player** ([erlebnis.html](erlebnis.html) +
[src/main.ts](src/main.ts)), das **Studio** ([studio.html](studio.html) +
[src/studio/](src/studio/)) und eine schlanke **Landing** ([index.html](index.html), kein
MapLibre). Alle sind eigene Vite-Einstiege ([vite.config.js](vite.config.js)).

**Der URL-Raum steht in [src/routen.ts](src/routen.ts) — und nur dort.** Kein Router: Nginx
liefert die Seiten statisch aus, nur `/api` geht in den Container. Aus der Tabelle leiten sich
die Vite-Eingänge, alle Links (`pfad('galerie')`), die Dev-Middleware in
[vite.config.js](vite.config.js) und die `location`-Blöcke des Vhosts ab; ein Drift-Wächter
([test/routen.test.ts](test/routen.test.ts)) hält Vhost und die Server-Kopie
([server/src/webpfade.ts](server/src/webpfade.ts), Mail-Links — eigener `rootDir`, kann nicht
importieren) dagegen. **URLs tragen kein `.html`**; die `…​.html`-Adressen antworten zwar
weiterhin (die Dateien liegen im Build), aber nichts im Code zeigt mehr dorthin — Nebeneffekt,
keine Zusage. Drei Pfade zeigen auf `studio.html`, weil dieselbe Seite drei Dinge ist: die Tür
(`/anmelden`, `/registrieren`) und der Raum dahinter (`/app`); welcher gilt, weiß nur der
Anmeldezustand, also schreibt `setzePfad` ihn per `replaceState` nach (samt Tab-Titel). Der
Pfad heißt **nicht** `/studio`: Ein Konto braucht auch, wer nur mit der App aufzeichnet.
**Beim Rollout muss der Vhost mitgehen** — ohne `try_files $uri $uri.html …` und die drei
`location =`-Blöcke landet jeder Anmelde- und Bestätigungslink still auf der Landing.
[deploy/cloudpanel-nginx.conf](deploy/cloudpanel-nginx.conf) ist die Vorlage; sie wird von
Hand in CloudPanel eingesetzt und **wird vom Deploy nicht mitgezogen** (auf dem Server steht
CloudPanels eigenes Gerüst, nicht diese Datei — Handgriff und Gegenprobe:
[docs/ops/deploy-cloudpanel.md](docs/ops/deploy-cloudpanel.md), Abschnitt 2). Bei Mehrsprachigkeit
wird aus `pfad: '/anmelden'` ein Eintrag je Sprache samt `/en/`-Präfix — die Aufrufer nennen
den sprachneutralen Namen, nicht den Pfad, und ändern sich nicht.

**Neben der Tabelle liegen zwei parametrisierte Namensräume.** Der erste ist `/@henrik` — die Adresse einer
Person ([src/handle.ts](src/handle.ts), Server-Kopie [server/src/handle.ts](server/src/handle.ts),
Vhost `location ~ ^/@`). Er steht bewusst NICHT in `ROUTEN`: Ohne das `@` teilte sich ein
Handle den Namensraum mit allen Seitenpfaden, und jeder neue Pfad entwertete still einen
vergebenen Handle. Aus demselben Grund ist die Liste reservierter Wörter eine eigene und
keine Ableitung aus `ROUTEN` — der Wächter prüft nur die eine Richtung (jeder Pfad muss
reserviert sein). Drei Dinge, die man dabei zerstört: `encodeURIComponent('@')` macht `%40`
daraus (deshalb baut `profilPfad` den Pfad selbst); die Dev-Middleware muss gegen
`HANDLE_REGELN` prüfen statt bloß auf `/@`, weil Vite unter genau diesem Präfix seine eigenen
Adressen bedient (`/@vite/client`, `/@fs/…`); und ein geänderter Handle wandert 90 Tage in
`handles_reserviert`, damit alte Links weiter zur Person führen, statt an den nächsten
Interessenten zu fallen. Die alte Form `?id=…` bleibt für immer bedienbar — die Profilseite
schreibt sie per `replaceState` auf `/@…` um.

**`/@handle` beantwortet seit Etappe 6 der SERVER**, nicht Nginx
([server/src/routes/seiten.ts](server/src/routes/seiten.ts), Vhost `proxy_pass` statt
`rewrite`). Grund ist die eine Sorte Information, die eine statische Datei nicht tragen kann:
die pro Adresse verschiedene. Der Server holt das gebaute `profil.html` zur Laufzeit über
denselben Nginx (`MAPTALE_WEB_URL`, fünf Minuten im Speicher) und ersetzt darin **nur den
Block zwischen `<!-- maptale:meta -->` und `<!-- /maptale:meta -->`** — die gehashten
Asset-Verweise bleiben unangetastet, es gibt keine Kopplung an den Web-Build. Fehlen die
Marker, wird die Seite stumm unverändert durchgereicht (Wächter in
[test/routen.test.ts](test/routen.test.ts)). Drei Regeln, die man leicht kippt: **Indexiert
wird nur, wer BEIDES will** — öffentliches Profil UND den Schalter „In Suchmaschinen
erscheinen" (`users.suchmaschinen`, Standard aus); **ein privates oder unbekanntes Profil
verrät im Kopf nichts** (generischer Titel statt Name plus `noindex` — der Meta-Kopf steht im
Quelltext für jeden lesbar, `noindex` verbirgt ihn nur vor Suchmaschinen); und **die
Vorschaukarte gibt es auch ohne Index**, weil die Messenger-Bots `robots` ignorieren. Genau
deshalb ist `/@` NICHT in der robots.txt gesperrt. Die Sitemaps der indexierbaren Profile
und der öffentlichen Touren kommen aus der Datenbank (`/sitemap-profile.xml`,
`/sitemap-touren.xml`, ein `location`-Block für beide); die statische `sitemap.xml` daneben
bleibt für die gebauten Seiten, und die robots.txt nennt alle drei. Fällt die API aus, ist die Profilseite
weg — der Preis dafür, dass sie überhaupt etwas über sich sagen kann.

**Der zweite ist `/tour/<kennung>`** — die Adresse einer Tour (`tourPfad`/`tourAusPfad` in
[src/routen.ts](src/routen.ts), Vhost `location ^~ /tour/`). Vorher war die Tour ein
Query-Parameter, und damit kein Ort: keine eigene Vorschaukarte, kein eigener Titel, kein
Sitemap-Eintrag — all das hängt an einer Adresse, die für sich steht. Der Pfad ist die
Vorbedingung dafür, dass der Server ihn mit Etappe 6 selbst beantwortet. **Die Kennung ist
die rohe ID und kein Slug**: Ihre Unerratbarkeit (14 Zeichen, ~2^80,
[server/src/ids.ts](server/src/ids.ts)) IST die Sichtbarkeitsstufe `unlisted`; ein sprechender
Name unter einem bekannten Handle wäre kein Geheimnis mehr, und die laufende Nummer `no` ist
ohnehin nur pro Besitzer eindeutig. **Kein `srv:` im Pfad**: Server-IDs tragen ihr `t_` selbst
— daran, und nur daran, unterscheidet der Player sie von den mitgelieferten `TOURS` (ein
Wächter verbietet deshalb `t_`-Schlüssel in [src/tours.ts](src/tours.ts)). `?tour=…` bleibt
bedienbar und wird beim Start per `replaceState` umgeschrieben; das `^~` im Vhost ist Pflicht,
weil CloudPanels Endungs-Regex sonst jede Kennung abfinge, die auf `.jpg` endet. **Auch diese
Adresse beantwortet der Server** (dieselbe Mechanik wie `/@`, Marker in
[erlebnis.html](erlebnis.html)): Titel, Beschreibung und Titelbild der Tour, `index` nur für
`public` — `unlisted` behält `noindex` und bekommt trotzdem seine Vorschaukarte, denn genau
das verspricht die Stufe. Eine private Tour zeigt im Kopf nichts, auch ihrem Besitzer nicht;
für Fremde antwortet sie 404, wie in der API. Die mitgelieferten Touren (`/tour/kohphangan`)
reicht der Server unverändert durch — `src/tours.ts` ein zweites Mal zu führen wäre die
nächste Kopie, die auseinanderläuft.

Der Player läuft clientseitig ab einem `map.on('load')`-Callback in [src/main.ts](src/main.ts),
der die Module verdrahtet. Der zentrale Datenfluss:

**Route als Bogenlängen-Parameter.** [src/geo.ts](src/geo.ts) `buildRoute()` nimmt Wegpunkte,
glättet sie (Catmull-Rom) und resampled sie auf ~14 m Schritte. Die entstehende `route` trägt
`coords` (lng,lat,ele), kumulierte Distanzen `cum` und `total`. **Die eine Zustandsvariable, die
alles antreibt, ist `s` — die Position entlang der Route in Metern.** `pointAt(route, s)`,
`bearingAt(route, s)`, `nearestS(route, lnglat)` übersetzen zwischen `s`, Koordinaten und
Kurswinkel. Fotos und Modus-Wechsel werden über `s` verankert.

**Und JEDER `f`-Anker wird beim Laden EINMAL nach `s` übersetzt** — danach rechnet der Player
nur in Metern ([src/streckenanker.ts](src/streckenanker.ts), Gleichlauf-Konzept §8D). Der
Server misst `f` auf der ROHEN Zeitreihe, die gebaute Route ist durch Catmull-Rom und das
14-m-Raster 2,2–3,0 % länger, und die Dehnung verteilt sich UNGLEICHMÄSSIG: `f × route.total`
lag deshalb im Median 0,8 Filmsekunden und in der Spitze 9 s neben der gemeinten Stelle. Die
Tabelle dagegen ist exakt — je Wegpunkt sein `f` (`segments[].f` aus dem Tour-JSON) und sein
`s` (`route.wpS`), dazwischen linear. Vier Dinge, die man dabei kippt: **Es reicht nicht, die
Formel `f * route.total` zu ersetzen** — die stand fast nur bei den Momenten; die größeren
Verbraucher rechnen UMGEKEHRT (`tourAudio.setFrac(s / route.total)` gegen rohe `f0`/`f1`,
`kamFolger` gegen `k.f`, `createTimeAt(frac)`, Wetter über `f`) und tauchen bei einer Suche
nach der Formel gar nicht auf. **Die Verkettung wirft je Folgesegment den ersten Punkt weg**
(`slice(1)`) — die `f`-Liste muss das mitmachen, sonst trägt ab dem zweiten Segment jeder
Wegpunkt das `f` seines Nachbarn. **`?reverse=1` dreht Segmente UND Punkte um**, `f` läuft
danach absteigend; `baueSBeiF` spiegelt die Tabelle, statt sie zu verwerfen. Und **kuratierte
`TOURS` bekommen nie ein Wegpunkt-`f`** — sie sind eine Datei mit Wegpunkten, keine
Aufzeichnung: Für sie ist der Rückfall auf `f × route.total` dauerhaft, nicht übergangsweise
(für aufgezeichnete gilt er bis zu ihrem nächsten Render). Messwerkzeug samt seiner drei
eigenen Fallen: [scripts/messungen/anker-versatz.ts](scripts/messungen/anker-versatz.ts).

**Tour-Konfiguration als Daten.** [src/tours.ts](src/tours.ts) exportiert `TOURS` — pro Tour:
`segments` (jedes mit `pts` und `mode`), `photos` (mit
`anchor`-Koordinate), Intro-/Finale-Texte, optional `time` (für Tag/Nacht), `geoid` und `weather`.
`weather` ist eine kuratierte Wetter-Timeline `[{ km, mode, k }]` (km entlang der Route) und hat
Vorrang vor dem historischen Auto-Wetter — nötig, wenn das ERA5-Archiv einen Effekt nie codiert
(z.B. Gewitter über Koh Pha-ngan). main.ts verkettet die Segmente
zu einer Wegpunktliste, baut die Route und verankert Fotos via `nearestS`. Nahe beieinander
liegende Fotos (< 120 m in `s`) werden zu einem **Stopp** mit mehreren `items` gruppiert.

**Kamera-Engine.** [src/tour.ts](src/tour.ts) `Tour` ist das Herzstück. Sie nutzt MapLibres
**FreeCamera-API** (nicht zoom-basiert), weil zoom-basierte Kameras in steilem Gelände im Hang
stecken bleiben — die Kamera hat eine explizite Flughöhe über Grund plus Blickpunkt. Jede
Kameragröße läuft durch einen `Smooth`-Filter (exponentielle Glättung mit `tau`), wodurch
Phasenwechsel automatisch zu weichen Schwenks werden. Phasen: `intro` (Orbit) → Fahrt →
Foto-Orbit → Finale. Pro Modus skalieren `MODE_SPEED`/`MODE_SCALE` Tempo und Kameradistanz;
`PRESETS` (nah/mittel/weit) sind die vom Nutzer wählbaren Einstellungsgrößen. Die Engine ruft
pro Frame `ui.updateTrace(s, pos)` und optional `ui.onTick(frac)` auf.

**Die Engine hat genau EINE Uhr, und sie ist ungedeckelt** ([src/filmuhr.ts](src/filmuhr.ts)).
Vorher klemmte `tick()` die Frame-Zeit bei 50 ms — ein langsames Gerät bekam dadurch keine
ausgelassenen Bilder, sondern eine langsamere Tour: bei 6× Drosselung lief die Bilduhr auf
81,3 % der Echtzeit, bei 12× auf 46,1 %, während der Ton in Echtzeit weiterlief. Ein Film mit
Ton trifft hier die Wahl jedes Videoplayers: **Die Zeit wird gehalten, das Bild springt.**
Drei Dinge, die man dabei falsch herum baut: Die **Kamera bekommt keinen eigenen Deckel und
keine Teilschritte** — `Smooth.to` rechnet `1 − exp(−dt/τ)` und ist bei konstantem Ziel exakt,
ein gedeckeltes `dtKamera` ließe sie dauerhaft hinterherhängen (~65 % der vergangenen Zeit bei
12×). Der **Rückkehr-aus-dem-Hintergrund-Fall hängt an `visibilitychange`**, nicht an einem
Deckel — die Android-WebView sagt es zusätzlich ausdrücklich
(`maptale:hintergrund`/`maptale:vordergrund` aus `PlayerScreen.kt`), weil dort nicht zugesichert
ist, dass `visibilitychange` durchkommt. Und was der Notdeckel (1,0 s, ein Netz für Umgebungen
ohne dieses Ereignis) doch kappt, ist **zählbar** statt unsichtbar: `window.__j.uhr`.

**Was nicht an der Filmuhr hängt, muss ausdrücklich mitgehen** — sonst ist es nicht eine Uhr,
sondern wieder zwei. Die Ton-Schleifen haben eigene Timer (`audiotracks.ts`, `music.ts`,
`vehicle.ts`, `weather.ts`), bewusst unabhängig von der Render-Schleife; sie liefen deshalb im
Hintergrund-Tab weiter, während das Bild stand, und die Musik war nach einer Minute eine
Minute voraus — dauerhaft. Deshalb steht **`tour.uhr.laeuft` in jedem Gate** der Seite
([src/main.ts](src/main.ts)); die Position hält der Ton dabei selbst (Pause innerhalb eines
Bereichs setzt nicht zurück). Das laufende **Video** geht den anderen Weg, über
`uhr.beiWechsel` → `ui.setzeVideoLauf` — ohne `setPlaying`, denn wer den Tab wechselt, hat
nichts angehalten, und ein „Angehalten"-Abzeichen beim Zurückkommen wäre die falsche Auskunft.
Hintergrund und Messwerte: [scripts/messungen/README.md](scripts/messungen/README.md),
Konzept §8A und Falle 3.

**Fortbewegungs-Modi** sind `walk | bike | moped | jeep | tram | ferry`. Die Liste muss an vier
Stellen deckungsgleich bleiben: `MODE_SPEED`/`MODE_SCALE` ([src/tour.ts](src/tour.ts)),
`MODE_ICONS` ([src/map.ts](src/map.ts)), `MODE_SOUND` ([src/vehicle.ts](src/vehicle.ts), nur
die drei mit Motorgeräusch: moped/jeep/ferry — die Tram fährt lautlos) und `MODI` ([server/src/schema/upload.ts](server/src/schema/upload.ts), von
dort beziehen Studio-Typ und alle JSON-Schema-Enums ihre Werte). Sie **lief schon einmal
auseinander** — Studio und Server kannten `moped`/`jeep` nicht, obwohl Engine, Icons und
Motorsound sie längst unterstützten; aufgezeichnete Touren konnten diese Modi deshalb nie
bekommen. Ein Drift-Wächter in [test/studio-baukasten.test.ts](test/studio-baukasten.test.ts)
vergleicht die Listen (und die Tempo-Faktoren) jetzt automatisch.
Der Modus wird bei der Aufnahme EINMAL angegeben; wo jemand stattdessen zu Fuß war, trennt
[server/src/pipeline/tempo.ts](server/src/pipeline/tempo.ts) beim Rendern selbst ab (s. unten).
Im Editor ist **jeder Modus-Wechsel eine ziehbare Kante** — auch die von der Automatik
erkannte. Beim ersten Zug schreibt `materialisiereModi` ([editmodell.ts](src/studio/editmodell.ts))
die ganze erkannte Aufteilung als Grenzen fest: `edits.modi` ist eine Stufenfunktion, die AB
ihrem Punkt alles Folgende übersteuert — eine einzelne neue Grenze mitten in der Automatik
risse die späteren Abschnitte mit. `klemmeGrenze` hält jede Kante zwischen ihren Nachbarn UND
lässt mindestens einen Trackpunkt im Abschnitt: sonst gälte der Zustand für keinen Punkt, das
Band verschwände aus der Anzeige und wäre nicht mehr anzufassen.

**Höhen zweistufig.** Wegpunkt-Höhen sind nur der Startwert. Nach dem Laden holt
[src/elevation.ts](src/elevation.ts) echte DEM-Höhen aus AWS Terrarium-Tiles (async fetch +
Bilinear-Sampling), glättet sie und überschreibt `coords[i][2]`; Höhenmeter und Höhenprofil
werden neu berechnet. Fähr-Abschnitte werden auf Meereshöhe geklemmt (DEM rauscht über Wasser).
Fällt der Fetch aus (offline), bleibt es beim Wegpunkt-Profil.

**Rendering-Schichten.** [src/map.ts](src/map.ts) baut den MapLibre-Stil: Esri-Satellit über
AWS-Terrain-DEM (`EXAGGERATION`-Konstante), Atmosphäre, Routen-Layer, Foto-Wegpunkte
(`addSpotLayers`), Fahrer-Marker (`createRider`/`setRiderIcon` mit `MODE_ICONS`).
[src/daynight.ts](src/daynight.ts) + [src/sun.ts](src/sun.ts) mappen Streckenanteil → Pseudo-Uhrzeit
→ Sonnenstand → Szenenstimmung (nur wenn `cfg.time` gesetzt ist).
**Foto-Stopps sind 3D-PINS** ([src/photopins.ts](src/photopins.ts), Standard;
`?pins3d=0` = alte flache Kreise, `?pins3d=foto` = Bild im Kopf): Fußring am Boden, Mast,
Kopfscheibe mit Nummer. Eigener Three.js-Custom-Layer, weil MapLibre 5 Symbole/Kreise nicht
über Grund heben kann (`symbol-z-offset` gibt es dort nicht). Die Größe kommt aus der
KAMERADISTANZ, nicht als feste Meterhöhe — sonst wäre der Pin im Intro-Anflug ein Zahnstocher
und am Foto-Orbit ein Sendemast. Voll dargestellt wird nur ein FENSTER um die aktuelle
Position (nächster Stopp, zuletzt besuchter, am Desktop der zweite kommende), alles andere
bleibt ein flacher Bodenpunkt: am Pixel 9 kostete das Querformat mit vier Pins doppelt so
viel CPU wie das Hochformat mit einem (7 % Bildrate → mit Detailstufe unter der Messschwelle).
Rechenregeln DOM-frei und getestet in [src/pinmodell.ts](src/pinmodell.ts); Machbarkeit,
Messwerte und Fallen (Mercator-y-Flip cullt Bodenflächen!) in
[docs/architecture/foto-pins-3d.md](docs/architecture/foto-pins-3d.md).

**UI.** [src/ui.ts](src/ui.ts) `UI` verwaltet Overlays, Steuerleiste, Telemetrie, Höhenprofil und
die Fortschrittsleiste. Das Scrubbing (Ziehen/Tippen auf der Timeline, inkl. Foto-Dots) wird in
main.ts über Pointer-Events verdrahtet und ruft `tour.beginScrub/scrub/endScrub` bzw.
`tour.jumpToPhoto`. Der Player-DOM liegt statisch in [erlebnis.html](erlebnis.html); JS greift
per `id` zu. **Die UI zieht sich während der Fahrt selbst zurück** (`body.ui-clean`, nach 3,2 s
Ruhe; Weg zurück, Halt-Chip, Steuerleiste UND Mauszeiger) und kommt bei der nächsten Regung wieder —
auf jeder Zeigerart, deshalb gibt es keinen Knopf und keine Taste dafür mehr. Zwei Fallen:
`pointermove` feuert auch ohne Handbewegung, sobald sich der Inhalt unter dem stehenden Zeiger
ändert (also pro Frame) — ohne Koordinaten-Vergleich käme die UI nie zur Ruhe; und `:hover` (die
Ausnahme „Maus liegt auf der Steuerleiste") darf nur bei `(hover: hover)` zählen, weil die
Pseudoklasse auf Touch nach einem Tipp am getippten Element hängen bleibt.

**Oben links steht genau EIN Element: der Weg hinaus** — die Pille `.zurueck`, fest positioniert
über dem Intro. Sie steht die ganze Fahrt über da (nicht nur im Startscreen), trägt das Wort der
Herkunft (Studio · Entdecken · Profil aus dem Referrer, sonst „Startseite") und geht per
`history.back()`, damit Scrollposition und Zustand der Liste erhalten bleiben. Der frühere
Marken-/Titelblock daneben ist **ersatzlos weg** (samt `body.intro-open`): er war nur während
der Fahrt sichtbar und wiederholte dort Ort und Route, die im Startscreen formatfüllend stehen
und unterwegs im Halt-Chip und in der Telemetrie weiterlaufen. Sein Kicker war zugleich ein
Home-Link auf die Landing — genau der Griff, über den man aus „Entdecken" heraus auf der
Startseite landete. Aus demselben Grund hat die Steuerleiste **keinen Menü-Knopf** mehr (zum
Startscreen einer Tour führt das Finale) und das Studio spielt im **selben Tab** ab (`spielAb`):
ein zweites Fenster hätte keinen Weg zurück, nur ein Schließkreuz. Im App-Modus (`body.app`)
bleibt die Pille aus — dort führt `.app-exit` in der Steuerleiste in die Tourliste.
Die einzige `h1` des Players ist seither der Intro-Titel.

**Typografie im Player folgt [`DESIGN.md`](DESIGN.md):** Outfit überall, Kennzahlen mit
`font-variant-numeric: tabular-nums` — **kein Mono und kein Versalien-Sperrsatz**. Der einzige
verbleibende Mono-Platz ist das API-Schlüssel-Feld des Google-3D-Testmodus (Debug); die
Karten-Attribution läuft seit dem Kartendaten-Popup ebenfalls in Outfit. Die kleinen gesperrten
Etiketten („NÄCHSTER HALT", „DISTANZ", „KM 12.3") waren die alte Sprache; Label sind jetzt
Satzschrift.

**Die Pflicht-Attribution ist ein ⓘ-Knopf mit Popup** ([src/karteninfo.ts](src/karteninfo.ts)),
nicht MapLibres compact-Control (`attributionControl: false`): eine Glaskarte, die pro Quelle
nennt, WAS man ihr ansieht (Satellitenbild · Gelände · Routen · Wetter). Zwei Punkte, die man
leicht „aufräumt": Der Inhalt wird aus den `attribution`-Feldern der Stil-Quellen gebaut — eine
neue Kachelquelle erscheint dadurch von selbst, ohne Rollen-Eintrag als „Kartendaten", aber
niemals ungenannt. Und das Element hängt am **body**, nicht im Kartencontainer: dessen `z-index`
gilt nur innerhalb des Karten-Stacking-Contexts, das Popup verschwand dort hinter der
Steuerleiste. Solange es offen steht, hält `body.info-offen` den Auto-Rückzug der UI an.

**Eine Tour beginnt am Anfang — immer.** Kein Positions-Merker, keine Wiederaufnahme:
Wer eine Tour verlässt und erneut startet, will den Startscreen und nicht Kilometer 14
von gestern.

**Das Fortbewegungsmittel steht NICHT in der Telemetrie.** Der Marker auf der Karte zeigt es,
der Motorloop lässt es hören — ein Wort „Unterwegs mit · Jeep 4×4" in der Steuerleiste
wiederholte das nur. Der Modus wird weiter pro Frame verfolgt (`modeKey` in `ui.stats`), denn an
seiner Kante hängen Marker-Icon und Motorsound.

**Atmosphäre und Wetter.** [src/atmosphere.ts](src/atmosphere.ts) (Horizont-Dunst, Wolken,
Sterne, Sonne) und [src/weather.ts](src/weather.ts) (Regen/Schnee/Nebel/Gewitter als
Partikel-Overlay) liegen über der Karte. Das Wetter kommt entweder aus der kuratierten
`weather`-Timeline der Tour, aus dem Tour-JSON des Servers oder — als Fallback — aus
[src/autoweather.ts](src/autoweather.ts) (Open-Meteo an den Foto-Ankern).
[src/audiotracks.ts](src/audiotracks.ts) spielt die im Studio gesetzten Musik-/SFX-Spuren.

**Die Tour-Musik hängt am Zustand `playing`, nicht an der Phase.** Ihr Gate stand einmal auf
`playing || scrubbing || phase === 'photo'` — und genau die letzte Klausel hob die Pause dort
auf, wo man sie am ehesten drückt: Im Foto-/Video-Halt ist `playing` die einzige Auskunft
darüber, ob der Film läuft, also spielte die Musik unter der angehaltenen Einblendung weiter und
stand danach woanders als der Schnitt im Studio. Aus demselben Grund läuft `holdT` in
[src/tour.ts](src/tour.ts) nur bei `playing` weiter — sonst blendete das Foto unter dem
„Angehalten"-Abzeichen von selbst weiter. Der PEGEL steht absolut (Studio-Regler, Vorgabe 0.8);
der Master 0.22 gilt nur den kuratierten Touren, deren `gain` gegen ihn ausgemessen ist
(`KURATIERTER_PEGEL` vs. `cfg.audioPegel`, s. [src/studio/CLAUDE.md](src/studio/CLAUDE.md)).

## Studio

Die Weboberfläche für aufgezeichnete Touren ([studio.html](studio.html), Vite-Einstieg;
Logik in [src/studio/](src/studio/)). Kein Router — Login-, App- und Editor-Ansicht liegen
gleichzeitig im DOM und werden per `hidden` umgeschaltet; der Editor wird lazy importiert,
damit MapLibre nicht ins Basis-Bundle kommt.

Anmeldebühne, Bibliothek, Upload-Befund, Edit-Overlay, Audio-Bibliothek, Ton-Klips und die
gesamte Zeitleiste (Achse in Filmzeit, Klip-Ketten, Zustandsbänder, Abspielen, Undo/Redo)
samt der CSS- und Pointer-Fallen stehen in **[src/studio/CLAUDE.md](src/studio/CLAUDE.md)** —
die Datei lädt automatisch, sobald unter `src/studio/` gearbeitet wird. Was der Server aus
Rohdaten + Overlay macht (Bildfassungen, Gehabschnitte, Pausen-Zeitraffer, Video-Faststart),
steht in **[server/CLAUDE.md](server/CLAUDE.md)**.

## Kontoeinstellungen

Eigene Seite ([konto.html](konto.html) + [src/konto/](src/konto/)), erreichbar über das
Konto-Menü — dort stehen seither zwei Einträge: „Mein Profil" (auf `/@handle`, nicht auf
`/profil`) und „Kontoeinstellungen". Sie liegt NICHT im Studio: Das Studio ist der
Schneideraum, das hier der Ordner mit den Papieren. Rechnende Teile stehen DOM-frei in
[kontomodell.ts](src/konto/kontomodell.ts), die Formulare werden nachgeladen
([kontodialoge.ts](src/konto/kontodialoge.ts)); die Dialogschicht teilt sie sich mit der
Profilseite ([src/dialogschicht.ts](src/dialogschicht.ts)).

Vier Dinge, die man dabei leicht „vereinfacht":

- **Die Adresse wechselt erst nach dem Klick im NEUEN Postfach.** Bis dahin wohnt sie im
  Mail-Token (`mail_tokens.nutzlast`, Zweck `email`) — stünde sie vorher in `users`,
  gehörte das Konto ab dem Absenden einer Adresse, die niemand bestätigt hat. Der Klick
  IST die Bestätigung (kein zweiter Verifikationslauf), der Link zeigt auf
  `/konto#email=<token>` und der Hash wird beim Einlösen sofort aus der Adresszeile
  geräumt. Ist die Adresse schon vergeben, ist die ANTWORT dieselbe wie im Erfolgsfall —
  nur die Mail bleibt aus, sonst wäre die Route eine Auskunft darüber, wer ein Konto hat.
- **Passwort und E-Mail-Wechsel verlangen das aktuelle Passwort.** Eine offene Sitzung
  beweist nur, dass jemand am Gerät saß. Der Passwortwechsel beendet danach alle anderen
  Zugänge (auch die App-Tokens) und behält genau die eigene Sitzung — sonst wirft er einen
  aus der Seite, auf der man gerade steht.
- **„Angemeldete Geräte" sind Sitzungen UND App-Tokens.** Die App meldet sich mit einem
  Token an, nicht mit einer Sitzung; eine Liste nur aus Sitzungen hätte genau das Gerät
  nicht dabei, an das die meisten zuerst denken. Die IDs tragen deshalb ein Präfix
  (`sitzung:` / `app:`). Von der Herkunft wird nur gespeichert, was zum Wiedererkennen
  nötig ist: roher User-Agent (die Deutung „Chrome auf macOS" passiert in
  `kontomodell.ts`, damit eine bessere Deutung keine Migration kostet) und **zwei Oktette**
  der IP. Das steht so auch in [datenschutz.html](datenschutz.html) — wer es erweitert,
  ändert dort eine Zusage.
- **Der Speicherbalken misst am LIMIT, nicht an der Summe**, und die Teile ergeben das
  Belegte (deshalb der Eimer `sonstiges`). Aufgeschlüsselt wird nach Dateiendung, nicht
  nach Ordner — in `media/` liegen Fotos, Videos, Poster und Klänge nebeneinander
  (`artDerDatei` in [server/src/quota.ts](server/src/quota.ts)). Eigene Route und nicht
  Teil von `/auth/me`: Die Aufteilung läuft über alle Dateien aller Touren, `/auth/me` ist
  der heißeste Aufruf der API.

- **Der Newsletter-Schalter schaltet die EINWILLIGUNG, nicht den Versand.** Er ist auch
  bei unbestätigter Adresse bedienbar — gesperrt ist, was rausgeht
  (`NewsletterDienst.empfaenger` filtert auf `email_verified`), und die Zeile sagt es
  dazu. Ein toter Schalter ließe rätseln, ob die Einwilligung angekommen ist. Kein
  zweites Double-Opt-in: Das DOI beweist, dass die Einwilligung vom INHABER der Adresse
  stammt — hier ist die Adresse längst bestätigt und angemeldet ist man auch. Gespeichert
  wird kein Boolean, sondern eine **Historie** (Zeitpunkt, Zustand, Quelle, Textfassung,
  Art. 7 Abs. 1 DSGVO); der Wortlaut steht in
  [server/src/newsletter.ts](server/src/newsletter.ts) und wortgleich in der Oberfläche,
  gehalten von einem Drift-Wächter. Der **Abmeldelink** (`/konto#newsletter-aus=<token>`)
  läuft VOR jeder Anmeldeprüfung und braucht keine Sitzung: signierter Token, ohne Frist.

- **„Verbundene Dienste" ist die Oberfläche der Tracker-Anbindung**
  ([trackerkarte.ts](src/konto/trackerkarte.ts), Sätze und Ton DOM-frei in
  [trackermodell.ts](src/konto/trackermodell.ts)). Der ganze Block bleibt AUS, solange kein
  Anbieter registriert ist — eine Überschrift über einer leeren Tafel wäre eine Auskunft über
  nichts. Vier Zustände müssen unterscheidbar bleiben, und der teuerste Fehler wäre,
  `abgelaufen` wie „nicht verbunden" aussehen zu lassen: Dann wartet jemand auf Touren, die
  nie kommen. Deshalb heißt der Knopf dort **„Neu verbinden"** und nicht „Verbinden", und der
  Satz nennt den Grund. In der Chronik ist `uebersprungen` bernstein und NICHT rot: Eine
  Halleneinheit ohne GPS ist normal — rot markiert wäre die Liste eines Vielsportlers
  dauerhaft alarmiert, und die eine echte Störung ginge darin unter.

**Der Sichtbarkeits-Schalter steht an ZWEI Stellen** (hier und im Bearbeiten-Modal des
Profils) und ist EIN Zustand — man sucht ihn hier beim Aufräumen und dort beim Bearbeiten;
auseinanderlaufen kann nichts, weil beide dasselbe Feld schreiben.

- **„In Suchmaschinen erscheinen" ist ein ZWEITER Schalter neben der Sichtbarkeit**, nicht
  deren dritte Stufe: Über den Link erreichbar zu sein ist etwas anderes, als unter dem
  eigenen Namen auffindbar zu sein. Standard **aus**, auch für Bestandskonten mit
  öffentlichem Profil. Bei privatem Profil ist er **gesperrt**, und die Zeile darunter sagt,
  worauf er wartet: Ein bedienbarer Schalter, der nichts tut, ist die schlechtere Auskunft
  als einer, der sichtbar auf etwas wartet. Die Sätze unter beiden Schaltern stehen in
  [src/sichtbarkeit.ts](src/sichtbarkeit.ts) — sie erscheinen hier UND im Bearbeiten-Modal
  der Profilseite und waren genau deshalb schon einmal auseinandergelaufen. Was er bewirkt,
  entscheidet der Server: `index` nur bei öffentlichem Profil UND gesetztem Schalter
  ([server/src/routes/seiten.ts](server/src/routes/seiten.ts)). Das steht so auch in
  [datenschutz.html](datenschutz.html), Abschnitt 5 — wer es ändert, ändert dort eine Zusage.

- **Der ZIP-Datenexport ist der einzige echte HINTERGRUNDLAUF im Projekt** (Art. 20 DSGVO,
  [server/src/export.ts](server/src/export.ts) für Aufträge und ZIP-Mechanik,
  [exportinhalt.ts](server/src/exportinhalt.ts) für das WAS,
  [exportlauf.ts](server/src/exportlauf.ts) für das Zusammenführen). Die Route antwortet
  sofort und stößt den Bau danach an — ein Archiv über zwei Gigabyte hielte sonst eine
  Verbindung minutenlang offen. Vier Dinge, die man dabei kippt: **Gegen Doppelläufe hilft
  nur die Datenbank** (partieller `UNIQUE`-Index `WHERE status = 'laeuft'`; zwischen „läuft
  schon einer?" und dem INSERT liegt sonst ein Fenster, in dem beide Anfragen dasselbe
  sehen). **Medien gehen ungepackt ins ZIP** — sie sind schon komprimiert, Deflate kostet
  die CPU des ganzen Servers und spart nichts. **Die Frist steht in der ZEILE**, beginnt mit
  der Fertigstellung und darf von einer späteren Konstante nicht rückwirkend geändert werden.
  Und **aufgeräumt wird stündlich**, nicht im täglichen Lauf: Ein Archiv mit allen Fotos einer
  Person läge sonst bis zu 72 statt 48 Stunden herum. Der Download-Link (`/api/export/<token>`,
  signiert) braucht **keine Anmeldung** — er wird im Postfach geöffnet, oft auf einem anderen
  Gerät; dieselbe Linie wie beim Passwort-Reset. Fristen und Umfang stehen in
  [datenschutz.html](datenschutz.html) Abschnitt 11 — wer sie ändert, ändert dort eine Zusage.

## Benutzerverwaltung

Eigene Seite ([admin.html](admin.html) + [src/admin/](src/admin/)), nicht Teil des Studios:
Das Studio ist der Schneideraum für Touren, das hier ist Hausverwaltung. Erreichbar über das
Konto-Menü im Studio — der Eintrag erscheint nur für Admins. Rechnende Teile liegen DOM-frei in
[adminmodell.ts](src/admin/adminmodell.ts), Server-Seite in
[server/src/routes/admin.ts](server/src/routes/admin.ts) hinter `erfordereAdmin`.

Die Reiter, das Protokoll und die Dialog-Fallen der Oberfläche stehen in
**[src/admin/CLAUDE.md](src/admin/CLAUDE.md)**; Rollen, Einladungspflicht, Warteliste (DSGVO-
Fristen!) und die System-Mails in **[server/CLAUDE.md](server/CLAUDE.md)**.

**Passwörter werden bewertet, nicht reglementiert.** [passwortstaerke.ts](src/passwortstaerke.ts)
(DOM-frei, getestet) folgt der NIST-Linie: **Länge ist der Hebel**, erzwungene Zeichenklassen
sind es nicht — „Hund!2026" erfüllt jede klassische Regel und ist trotzdem schlecht,
„lampe wolke treppe" erfüllt keine und ist gut. Abzüge gibt es für bekannte Muster,
Tastaturwege, Wiederholungen und alles, was in Name oder E-Mail steht (deshalb bekommt die
Bewertung diese Felder als FUNKTION — sie ändern sich, während das Passwort schon getippt ist).
Bewusst kein zxcvbn: dessen Wörterbücher lägen im Basis-Bundle jeder Anmeldeseite.
[passwortfeld.ts](src/passwortfeld.ts) hängt Balken, Rat und Sichtbarkeits-Schalter an ein
vorhandenes Input (Studio-Registrierung, Passwort-Reset, Admin-Dialog) und bringt sein CSS
selbst mit — sonst stünde derselbe Block in zwei HTML-Dateien und liefe auseinander. Der
Absende-Knopf sperrt erst, wenn tatsächlich etwas Schwaches im Feld steht: Ein von Anfang an
grauer Knopf sähe aus, als wäre das Formular kaputt.

## Android-App

Aufnahme-App unter [android/](android/) (Kotlin, Compose, minSdk 29) — Architektur,
Upload-Fluss und die Fallen (Medien-IDs, Manifest-Unveränderlichkeit, WebView-Session,
Room-Migrationen) stehen in [android/CLAUDE.md](android/CLAUDE.md); die Datei lädt
automatisch, sobald unter `android/` gearbeitet wird.

## Konventionen

- Design / Marke: [`DESIGN.md`](DESIGN.md) — Single Source of Truth für Assistenten und UI.
- Doku-Index: [`docs/README.md`](docs/README.md). `docs/archive/` ist Historie — nicht als
  Implementierungsquelle nutzen (widerspricht oft dem Ist-Stand).
- `window.__j` bündelt Debug-Handles des Players (`map`, `route`, `tour`, `rider`, `eleReady`
  u.a.); das Studio hat analog `window.__studio` mit den Accessoren `karte()` und `zustand()`.
- Externe Datenquellen brauchen sichtbare Attribution (Esri/Maxar, AWS Terrain) — auch in
  späteren Video-Exporten einbrennen. Siehe [README.md](README.md).
- Neue Tour hinzufügen = neuer Eintrag in `TOURS`; keine Code-Änderung an der Engine nötig.
- **Die besuchten Seiten tragen das Umami-Skript** (`https://analytics.maptale.io/script.js`
  mit `data-website-id`, jeweils Zeile 5 im `<head>`): index, erlebnis, studio, galerie,
  profil, konto (eine gewöhnliche Seite des Produkts — anders als die Verwaltung, die nur
  der Betreiber sieht). **Ohne Tag und zwar absichtlich:** admin (die eigene Verwaltung ist kein Publikum),
  impressum und datenschutz. Wer eine Seite dazunimmt, entscheidet also, in welche Gruppe sie
  gehört — vergessen fällt nicht auf, denn die Seite funktioniert, taucht in der Auswertung
  nur nie auf. Ausgewertet wird im Verwaltungs-Reiter „Statistiken" (natives Dashboard,
  daneben ein Link auf die Umami-Oberfläche). **Die Erhebung ist in
  [datenschutz.html](datenschutz.html) beschrieben** (Abschnitt 2 „Reichweitenmessung",
  dazu Rechtsgrundlage in 3, Cookie-Frage in 8, Empfänger in 9, **Frist 12 Monate** in 10 und
  die WebView-Ausnahme in 7): Wer am Umfang etwas ändert, ändert dort eine Zusage — und die
  12 Monate müssen in Umami auch tatsächlich eingestellt sein, sonst steht dort eine Frist,
  die die Datenbank nicht einhält. Die App misst nur das ABSPIELEN, weil sie den Player als
  WebView lädt; Aufzeichnen und Hochladen laufen an Umami vorbei.

- **Rückmeldungen sind ein eigener Knopf, kein Postfach.** Die Kopfleiste trägt neben dem
  Konto einen Feedback-Griff ([src/feedbackknopf.ts](src/feedbackknopf.ts)); er öffnet das
  Formular ÜBER der aktuellen Seite, damit der technische Kontext die Seite nennt, auf der
  jemand etwas bemerkt hat. Dieselbe Maske steht unter `/feedback` — von dort holt sie die
  Android-App im WebView (`?app=1`, Kopf- und Fußzeile aus). **Für den Absender ist es EIN
  Feld**: Kategorie, Status und Notiz vergibt, wer sichtet, im Reiter „Rückmeldungen" der
  Verwaltung. Jede Pflichtangabe im Formular kostet in einer Alpha Meldungen.
  **Die technischen Angaben sind freiwillig und sichtbar** — Häkchen (Standard an) plus
  Aufklapper, der aus DEMSELBEN Objekt gebaut wird, das gesendet wird
  ([feedbackmodell.ts](src/feedbackmodell.ts)); ein Häkchen ohne Einblick verlangt Vertrauen
  für etwas, das man zeigen kann. Die Seitenangabe trägt nur den PFAD: Query und Fragment
  tragen hier Einlöse-Token (`#email=…`, `#reset=…`). Welche Felder überhaupt ankommen,
  entscheidet der Server ([server/src/routes/rueckmeldungen.ts](server/src/routes/rueckmeldungen.ts)
  `saubereKontext`) — sonst wäre das Feld ein offener Kanal und die Aufzählung in
  [datenschutz.html](datenschutz.html) (Abschnitt 2, Fristen in 10) eine Zusage, die nicht
  stimmt. Melden geht OHNE Anmeldung: „ich komme nicht rein" kann niemand angemeldet
  schicken.

- **Der Entwicklungsstand steht hinter der Wortmarke** — das kleine Wort „Alpha", Markup und
  Text aus [src/entwicklungsstand.ts](src/entwicklungsstand.ts). Es ist ANKLICKBAR und das ist
  kein Beiwerk: Wer das Wort nicht kennt, klickt und liest dort, was der Stand für seine Daten
  bedeutet — ein bekannteres Wort wie „Beta" würde man zu verstehen glauben und nie öffnen.
  **Nicht „Preview"**, weil „Vorschau" hier bereits ein Fachwort der Oberfläche ist
  (Vorschaukarten geteilter Links, Titelbild-Vorschau) und der Hinweis dann als „Vorschau
  einer Tour" lesbar wäre. **Kein Chip in Akzentfarbe**: Eine Pille neben der Wortmarke zog
  mehr Blicke auf sich als die Marke — der Stand soll genannt sein, nicht beworben. Und
  **erklären ist nicht melden**: Der Weg zur Rückmeldung ist ein eigener Knopf daneben (s.
  oben), nicht ein zweiter Klick im Hinweis.
  **Das CSS steht STATISCH** in [grundelemente.css](src/grundelemente.css) und — weil die
  Landing dieses Blatt nicht lädt — noch einmal in [index.html](index.html): Per JavaScript
  eingehängte Regeln kommen nach dem Markup, das Wort blitzte dadurch bei jedem Laden kurz
  ungestaltet neben der Marke auf. Nur die Optik des Kärtchens hängt das Modul selbst ein, es
  entsteht erst auf Klick — dort stehen drei PUNKTE mit Symbol und Überschrift („Im Umbau",
  „Kein Backup", „Sag es uns"), kein Fließtext: Ein Absatzblock neben der Wortmarke wird
  überflogen, und der mittlere Punkt ist der, den niemand überfliegen sollte.
  **Ausgerichtet wird auf die GRUNDLINIE der Wortmarke, und zwar auf jeder Seite anders**:
  Die Produkt-Seiten nutzen `align-items: last baseline` — `.brand` ist dort ein inline-flex
  aus Logo UND Text, und die *letzte* Baseline ist die des Schriftzugs (die *erste* wäre die
  Bildunterkante, das Wort säße 10 px zu tief). Die Landing hat statt Text ein einziges Bild,
  in dem der Schriftzug steckt; dort trägt der Hinweis einen gemessenen `margin-bottom`, der
  sich aus der Logo-Geometrie ergibt (Grundlinie bei y=33,5 von 46 Einheiten, bei 40 px
  Anzeigehöhe also 9,2 px über der Bildunterkante). Wer Logo oder Höhe ändert, ändert diesen
  Wert mit. Der Knopf steht NEBEN `.nav-right`, nicht darin: `montiereNavRechts`
  schreibt diesen Container neu, sobald `/auth/me` antwortet. Der **Player bekommt beides
  bewusst nicht** — oben links steht dort genau ein Element, der Weg hinaus. Gehalten von zwei
  Wächtern: der Vergleich gegen `appHeaderHtml` ([test/app-nav.test.ts](test/app-nav.test.ts))
  deckt die fünf Produkt-Seiten ab, [test/entwicklungsstand.test.ts](test/entwicklungsstand.test.ts)
  die Landing mit ihrer eigenen Kopfleiste.

- **Auffindbarkeit ist eine dritte Ableitung von `ROUTEN`.** [public/robots.txt](public/robots.txt)
  sperrt Verwaltung, Konto und die Studio-Tür; [public/sitemap.xml](public/sitemap.xml) listet
  die vier statischen Seiten. Wer eine Seite dazunimmt, entscheidet also auch hier, in welche
  Gruppe sie gehört — der Wächter in [test/routen.test.ts](test/routen.test.ts) verlangt für
  jeden Pfad genau eines: gelistet, gesperrt oder ausdrücklich „gecrawlt, nicht gelistet"
  (heute `/erlebnis` und `/profil`). **`Disallow` und `noindex` schließen sich aus**: Was nicht
  geholt werden darf, kann auch nicht gelesen werden — die URL landet dann ohne Inhalt im
  Index. Deshalb ist `/profil` NICHT gesperrt; sein `noindex` ist der Schalter, den Etappe 6
  umlegt. Die **Vorschaukarten geteilter Links** (`og:`/`twitter:` in index, galerie, erlebnis)
  tragen feste Marken-Werte: Die Bots führen kein JavaScript aus und lösen keine relativen
  Bild-URLs auf. Das Bild erzeugt [scripts/gen-og-bild.mjs](scripts/gen-og-bild.mjs) aus dem
  Landing-Hero.

## Medien-Generierung

**Medien werden AUSSCHLIESSLICH über zwei Dienste generiert — keine anderen: Bilder über
fal.ai, Audio über ElevenLabs.** Keine anderen Bild-/Audio-/Video-Generatoren verwenden.
Beide Keys liegen in `.env` (`FAL_KEY`, `ELEVEN_LABS_KEY`) — nur lokal/Dev, nicht in den
Build/das Repo. API-Formen, Generier-Skripte, die kuratierte Studio-Bibliothek
(`public/audio/sfx/`) und die Wiedergabe-Wege im Player beschreibt der Skill
`medien-generierung` ([.claude/skills/medien-generierung/SKILL.md](.claude/skills/medien-generierung/SKILL.md))
— er lädt, sobald Medien erzeugt oder neu generiert werden sollen.
