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

**Maptale wird von einer Machbarkeitsstudie zu einem echten Produkt ausgebaut** (Aufnahme-Plattform,
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

Sprache: **Code-Bezeichner sind ENGLISCH** (verbindliches Glossar:
[docs/concepts/konzept_codebase_english_refactoring.md](docs/concepts/konzept_codebase_english_refactoring.md) §6,
vollständige Abbildung je Bezeichner: [docs/specs/abbildungstabelle.tsv](docs/specs/abbildungstabelle.tsv)),
einschließlich API-Pfaden unter `/api/`, DB-Schema und JSON-Schlüsseln. **UI- und
Produkttexte, Code-Kommentare, Doku, Commit-Messages und Chat bleiben Deutsch.**
Der Bestand ist noch deutsch und wandert in Wellen (Konzept §5); NEUER Code entsteht
englisch, kein Agent erfindet Namen am Glossar vorbei. UI-Strings werden beim
Refactoring nicht mit übersetzt (Code `visibility`, Label „Sichtbarkeit").

**In NEUEN Texten steht kein langer Gedankenstrich.** Weder in der Oberfläche noch in
Überschriften, Bildunterschriften oder Doku, die frisch entsteht. Wo einer stünde, trennt ein
Punkt, ein Komma oder ein Doppelpunkt; oft sind zwei Sätze die bessere Antwort. Der Bestand
bleibt, wie er ist: Diese Datei und die Kommentare im Code benutzen ihn seit jeher, ein Umbau
wäre eine Diff über das halbe Repo ohne Gewinn. Zwei Wörter sind im selben Zug verworfen und
gehören nicht in Produkttexte: „Formular" (grenzt technisch ab, statt zu sagen, was man tut)
und „wie das Wetter steht".

**Design System.** Kanonische Quelle für Marke, Farben, Typografie und UI-Dos/Don’ts ist
[`DESIGN.md`](DESIGN.md) (Google DESIGN.md-Format). Coding-Assistenten und UI-Arbeit folgen
dieser Datei; CSS-Variablen, [`src/brand.ts`](src/brand.ts) und Android `Theme.kt` /
`Typografie.kt` sind Ableitungen. Kurzregel: Outfit überall; Zahlen mit
`font-variant-numeric: tabular-nums` (Compose: `fontFeatureSettings = "tnum"`), nicht Mono.

**Der FOKUS hat zwei Fälle, und zwar nach dem Element**: Was einen eigenen Rand hat (Felder),
färbt ihn amber und bekommt den Halo `--fokus-ring`; was keinen hat (Knöpfe, Links, Karten),
bekommt `outline: 2px` mit `outline-offset: 2px`. Beides zusammen war der Doppelring, der im
Studio stand — Rand amber, Outline mit Abstand daneben, Fläche dunkler: drei Signale für einen
Zustand, und keines davon so in DESIGN.md. Ein Wächter hält jetzt beide Hälften
([test/basis-css.test.ts](test/basis-css.test.ts)): jeder abweichende Offset (er war einmal
3 px, einmal −2 px) und jeder selbst gemischte Halo (15 %, 22 %, 55 % Amber für dieselbe
Sache) fällt auf. Nach innen darf die Outline nur, wo der Überstand ohnehin beschnitten wird —
die Galerie-Karte und der Aufklapper im Inspector stehen als benannte Ausnahmen im Test.

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
([server/src/web-paths.ts](server/src/web-paths.ts), Mail-Links — eigener `rootDir`, kann nicht
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
`reserved_handles`, damit alte Links weiter zur Person führen, statt an den nächsten
Interessenten zu fallen. Die alte Form `?id=…` bleibt für immer bedienbar — die Profilseite
schreibt sie per `replaceState` auf `/@…` um.

**`/@handle` beantwortet seit Etappe 6 der SERVER**, nicht Nginx
([server/src/routes/pages.ts](server/src/routes/pages.ts), Vhost `proxy_pass` statt
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
**verdichtet sie zuerst linear auf höchstens `STUETZ_MAX_M` = 25 m**, glättet sie dann
(Catmull-Rom) und resampled sie auf ~14 m Schritte. Das Vorverdichten ist keine Kosmetik: Die
Glättung BEULT über weite Stützpunkte aus, und der Überschuss sitzt in den KURVEN. Solange die
Engine ihre Position selbst integrierte, war das nur eine etwas zu lange Route; seit sie aus
der Filmachse kommt (die in ROHEN Metern rechnet), ist es ein TEMPOfehler — wo die gezeichnete
Route länger ist, muss die Kamera schneller werden. An Stockholm lief der Film in Schlenkern
mit bis zu 95 statt 60 m/s, also fast doppelt so schnell wie auf der Geraden; 2,2 % des Films
liefen mehr als 50 % zu schnell. Nach dem Verdichten sind es 0,00 %
(`scripts/messungen/bildschirmtempo.mjs`). Verdichtet wird nur, wo es zu dünn ist — dichte
Fußwege und Aufzeichnungen bleiben Punkt für Punkt, wie sie sind. Die entstehende `route` trägt
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
Foto-Orbit → Finale. Pro Modus skalieren `MODUS_TEMPO` ([src/filmachse.ts](src/filmachse.ts))
und `MODE_SCALE` ([src/tour.ts](src/tour.ts)) Tempo und Kameradistanz;
`PRESETS` (nah/mittel/weit) sind die vom Nutzer wählbaren Einstellungsgrößen. Die Engine ruft
pro Frame `ui.updateTrace(s, pos)` und optional `ui.onTick(frac)` auf.

**Aus der Strecke wird Filmzeit — an genau EINER Stelle**
([src/filmachse.ts](src/filmachse.ts), Gleichlauf-Konzept §8C, E3/E12). Das Modul ist DOM- und
importfrei und wird von **Player und Studio gemeinsam** benutzt: Tempo je Modus
(`MODUS_TEMPO`/`tempoMs` — früher `MODE_SPEED`+`baseSpeed` in `tour.ts`), Moment-Standzeiten,
die lower_bound-Interpolation, das Einweben der Halte und die RAMPEN (`RAMPE_M`, s. unten). Vorher stand das Tempo-Modell an
DREI Stellen, gekoppelt über Tests, die den Quelltext von `tour.ts` nach Zeichenketten
absuchten — einer prüfte, ob ein Kommentar dasteht. Jetzt sind es zwei: hier und der
erzwungene Server-Spiegel ([film-tempo.ts](server/src/pipeline/film-tempo.ts) +
[film-axis.ts](server/src/pipeline/film-axis.ts), eigener `rootDir`), und beide rechnen
dasselbe **Verhaltens-Fixture** durch ([test/fixtures/filmachse.json](test/fixtures/filmachse.json),
Web-Hälfte in [test/filmachse.test.ts](test/filmachse.test.ts), Server-Hälfte in
[server/test/film-tempo.test.ts](server/test/film-tempo.test.ts)).

**Parametrisiert wird über die STRECKE, nicht über die Aufnahmezeit.** Das ist keine Wahl: Der
Player braucht Filmsekunde → Streckenposition, und über der Aufnahmezeit endet die Rechnung bei
einer Aufnahmezeit, die er nicht weiterverwenden kann (`cfg.timeline` ist Pseudo-Zeit mit
Pausen-Zeitraffer, nicht die Aufnahmeuhr). Wer in Aufnahmezeit verankert — die Zeitleiste des
Editors, Medien, Ton-Klips —, legt einen **Zeit→Strecke-Adapter** daneben (`AxisCurve` in
[zeitleiste.ts](src/studio/zeitleiste.ts): je Stützpunkt seine Zeit und sein Meterstand) — der
Server-Spiegel seit Etappe 4 genauso; die Anker selbst bleiben Zeitstempel, umgestellt ist die
Achse, nicht die Verankerung. Drei Dinge,
die man dabei kippt: Die Achse rechnet über die **rohen Wegpunktabstände**, nicht über
`route.cum` — Catmull-Rom und das 14-m-Raster machen die Route 2,2–3,0 % länger, die Filmdauer
wäre allein durch die Glättung zu lang. Die Konvention **„Plateau → Ankunft"** bleibt nötig,
sie wechselt nur ihren Ort (über der Zeit waren die Plateaus die realen Pausen, über der
Strecke sind es die Halte). Und das Modul gehört nach `src/`, **nicht** nach `src/studio/`: Ein
Import Player→Studio zöge die Editor-Typenwelt in den Player-Chunk.

**Die Achse TREIBT den Player an** (`window.__j.filmachse`, `window.__j.filmS`) — s. den
eigenen Abschnitt unten. Sie trägt daneben den TON: Beim Eintritt in einen Musik-Bereich UND am Ende jedes
Sprungs setzt `musikVersatzS` ([src/audiotracks.ts](src/audiotracks.ts)) die Datei auf die
Stelle, die dort im Film liefe. Vorher stand da hart `currentTime = startS`: Wer mitten
hineinsprang, hörte das Stück von vorn; wer INNERHALB eines Bereichs scrubbte, hörte es
weiterlaufen — die Datei stand danach bis zum Bereichsende woanders als der Film. Die Funktion
kam aus `src/studio/abspielen.ts` (ein Umzug, kein Nachbau); nachgezogen wird am ENDE einer
Geste und nicht pro Frame, weil während des Scrubs Musik klingt und ein Seek je Frame ein
Stottern wäre.

**Und die Ereignisse werden NACH FILMZEIT ausgelöst** (E10, Etappe 4b): `istAktiv` und
`sfxSollFeuern` in [src/audiotracks.ts](src/audiotracks.ts) vergleichen Filmsekunden, der
Kamera-Folger in [main.ts](src/main.ts) ebenso. Der Grund ist der HALT: Dort läuft der Film,
während die Strecke steht — ein Musik-Klip, der ganz in einer Standzeit liegt, hat
`f0 === f1` und wäre unter jeder `frac`-Prüfung stumm, welche Zahl auch immer im JSON
danebensteht. **Die Auslöse-Logik ist die Substanz, die JSON-Felder sind ihr Transport:** Das
Tour-JSON trägt seit E10 additiv eine Filmsekunde je Ereignis (`audio[].filmS`/`filmBisS`,
`camera[].filmS`, `moments[].filmS` — [docs/specs/austauschformat.md](docs/specs/austauschformat.md)),
der Player nimmt sie je Endpunkt, wo sie steht, und rechnet sonst wie bisher aus `f`.
Vier Dinge, die man dabei kippt: Die Filmsekunde kommt aus **`tour.filmS`** und nie aus
`filmBeiS(s)` — im Halt steht `s` still, der Rückweg lieferte dort die ganze Standzeit lang
die ANKUNFT, also genau den Wert, den `f` schon hat. Die **SFX-Schwelle ist keine Übersetzung
der alten 0,02**, sondern der Notdeckel der Filmuhr (1,0 s): In `frac` waren das 2 % der
Tour (auf Koh Pha-ngan ~4,4 s), naiv als „0,02 s" übernommen verschlucken sie jeden One-Shot.
Der **Moment bleibt an `f` verankert**, obwohl er das Feld trägt — er IST ein Halt, und die
Achse wird aus den Halten gebaut. Und **Bestandstouren klingen unverändert**: Sie tragen ihre
Anker noch in `f` und wandern erst beim nächsten Render an die Stelle, die der Autor in
Filmzeit gemeint hat.

**Und ein zweiter Anlass zum Nachziehen: verworfene Filmzeit.** Der Ton läuft auf der
WANDUHR, der Film auf der Filmuhr — und die verwirft, was über ihrem Notdeckel (1,0 s) liegt.
Bei gedrosseltem `rAF` ohne `visibilitychange` (verdecktes Fenster, Kachel-Nachladen nach
einem Sprung, langsames Gerät unter Last) ist die Datei danach um genau diese Sekunden zu
weit, und zwar dauerhaft: In der Entwicklungs-Pane gemessen 29,4 s in zwei Frames, hörbar als
„dieselbe Stelle der Tour, andere Stelle des Stücks". Deshalb vergleicht `updateTrace`
`tour.uhr.verworfenFrames` mit dem zuletzt gesehenen Stand und richtet bei jeder Änderung neu
aus — im Normalfall der Vergleich zweier Zahlen, im Fehlerfall die einzige Stelle, an der der
Ton je erfährt, dass er zu weit ist. Das ist dieselbe Regel wie in §8A: *Was nicht an der
Filmuhr hängt, muss ausdrücklich mitgehen.*

**Die Position FOLGT der Filmzeit — die Engine integriert `s` nicht mehr selbst** (Etappe 4,
E2): `s = streckeBeiFilm(achse, filmS)`, und `filmS` kommt aus der Filmuhr. Was dadurch
ERSATZLOS entfallen ist, ist der eigentliche Gewinn (E13): die Zeiger `nextIdx`/`nextMomentIdx`
samt `syncNextIdx`, der Bremsweg-Vorgriff (`speed · 0.62`), die Ausrollschwelle `speed < 4`
und jede `dir > 0`-Schranke. **„Im Halt" ist seither ein ZUSTAND DER KURVE** — `filmS` liegt in
einem Halt-Intervall —, kein getriggerter Phasenwechsel: Rückwärts fährt derselbe Weg zurück,
Halte inklusive, wie im Editor seit Monaten. `mult` und `dir` sind Faktor und Vorzeichen auf
die Filmzeit, `nudge` ist 1/24 FILMsekunde, und `speed` in [tour.ts](src/tour.ts) ist nur noch
eine Beobachtung für die Messskripte. Fünf Dinge, die man dabei kippt:

- **Video-Halte enden an der ACHSE, nicht am Dateiende** (`onMediaEnded` ist Notausgang und
  tut nichts mehr). Wich die echte Dateilänge um Zehntel von `dauerS` ab, verschob sich sonst
  alles Folgende — kumulativ, und Studio und Player kamen woanders heraus.
- **Die Achse wird für eine laufende Fahrt NIE neu gebaut** (Konzept, Falle 5). Ein Neubau
  verschöbe jetzt nicht mehr nur den Balken, sondern `s`: Die Kamera setzte sichtbar um. Spät
  bekannte Videolängen (`loadedmetadata` bei Altbestand) ändern deshalb nichts; es gilt, was
  das Tour-JSON sagt, und ohne Angabe die Foto-Annahme, die auch das Studio trifft.
- **Die Achse rechnet in ROHEN Metern, die Engine fährt auf der gebauten Route.** Die
  Übersetzung in beide Richtungen steht in [main.ts](src/main.ts) (`rohBeiS`/`sBeiRoh`) und
  nirgends sonst — nur diese Datei kennt beide Meterstände.
- **Der Anteil, den `seek`/`scrub` bekommen, ist der des FILMS** (Etappe 5), weil die
  Fortschrittsleiste ihn so zeichnet — s. den Abschnitt „Die Leiste ist die Zeitachse" unten.
- **Die Foto-Karte ist eine FUNKTION der Filmzeit** (E15, s. den eigenen Abschnitt unten) —
  kein getriggerter Auftritt mehr.

**Die Rampe ist eine feste Form über eine feste STRECKE** (E14, `RAMPE_M` = 120 m in
[filmachse.ts](src/filmachse.ts)), keine nachgebaute Exponentialkurve — und sie gilt für
**JEDEN Tempowechsel**, nicht nur für Halte. Über eine Rampenstrecke `L` von `v0` auf `v1`
folgt das Tempo `v0 + (v1 − v0) · smoothstep(u)`: sanft an, in der Mitte am stärksten, sanft
ins neue Tempo. Daraus die zwei Zahlen, die alles tragen: die Dauer **`T = 2L / (v0 + v1)`**
(Strecke durch das MITTLERE Tempo) und der Weganteil
`w(u) = [v0·u + (v1 − v0)·(u³ − u⁴/2)] / ((v0 + v1)/2)`. Ein HALT ist der Sonderfall „Wechsel
von oder auf null" — dort fällt `w = 2u³ − u⁴` heraus und die Rampe kostet genau eine
Reisezeit ihrer Strecke.

Fünf Regeln daneben: Am Halt liegt die volle Länge auf JEDER Seite, an einer Modus-Grenze
liegt sie EINMAL und ganz im **schnelleren** Abschnitt (beim Beschleunigen dahinter, beim
Verzögern davor — symmetrisch gelegt liefe der langsamere Modus auf seinen letzten Metern
schon mit dem Tempo des schnelleren, an Stockholm gemessen zu Fuß mit dem 5,3-Fachen des
Fußgängertempos); am Tour-ENDE wird nicht gebremst (der Film läuft aus); **kollidierende
Rampen teilen sich die Lücke anteilig** nach ihrem Bedarf (bei zwei gleich langen hälftig);
**ein Tempowechsel NÄHER als eine Rampenlänge an einem Halt wandert ganz auf den Halt** —
dort steigt man ein, und ohne die Regel beschleunigte der Film auf den letzten Metern auf
volle Höhe, um sofort wieder stillzustehen; und die Länge ist KALIBRIERT, nicht geraten
(`scripts/messungen/rampen-kalibrierung.ts` gegen die 64,3 Rampen-Sekunden aus
`rampen-simulation.ts`). Dass sich die Verteilung dabei umdreht — schnelle Fortbewegung wird
knackiger, zu Fuß getragener —, ist gewollt. Dass die Modus-Rampe den Film sogar leicht
VERKÜRZT, folgt aus der Formel: Man verlässt das langsamere Tempo früher.

**Nur um Halte zu rampen war ein Fehler**, und einer, den man erst beim Abfahren sieht: An
einer Modus-Grenze sprang das Tempo dann von einem Frame zum nächsten (Stockholm walk → ferry,
Faktor 6,25), während die Kamera weiter geglättet folgte — erst schnell und nah, dann schnell
und weit. Die alte Engine hatte das nicht: Ihr Tiefpass lag auf JEDER Tempoänderung.

**`MODUS_TEMPO` und `RAMPE_M` sind GESTALTERISCHE Zahlen** — sie sagen, wie sich eine
Fortbewegung im Film anfühlen soll, nicht wie schnell man wirklich ist. `walk` steht seit dem
Abfahren auf 0,5 (vorher 0,4, zu träge). Wer eine davon ändert, ändert die Dauer JEDER
bestehenden Tour: `scripts/messungen/filmdauer.ts` ist der Beleg, und der Spiegel in
`server/src/pipeline/filmtempo.ts` muss mit.

**Die KAMERADISTANZ folgt derselben Rampe** (`Filmspur.skalaBeiS`, aus `modusMischung`) —
und zwar am TEMPO geführt, nicht an der Strecke: Die Rampe ist eine Form über der Zeit, nach
halber Rampenzeit sind aus dem Stand erst 3/16 ihrer Strecke gefahren. Vorher zog ein eigener
Tiefpass die Distanz nach (τ = 2,2 s, also rund 6 s bis sie steht), während die Rampe in unter
einer Sekunde fertig ist: Dazwischen fuhr man Fährtempo mit einer Fußgänger-Kamera. Das ist
keine Kosmetik, sondern dieselbe Regel wie bei der Uhr — *was nicht an der Filmzeit hängt,
muss ausdrücklich mitgehen*. Gemessen als **Bildschirm-Tempo** (Fahrtempo ÷ Kameradistanz,
`scripts/messungen/bildschirmtempo.mjs`): Die Modi sind darauf abgestimmt und liegen alle bei
0,167–0,202 /s; die Spitze über den ganzen Film fiel von 0,888 auf 0,230 /s.

**Und die Fortbewegung, die Marker und Motorton lesen, kommt aus der ACHSE** (`filmachse.modi`),
nicht aus den rohen Modus-Grenzen: Die Achse zieht einen Tempowechsel dicht an einem Halt auf
den Halt, die rohen Grenzen wissen davon nichts — ein Fußgänger-Marker liefe sonst für die
Meter dazwischen mit Fährtempo über die Karte.

**Der Server-Zwilling muss mit**:
[server/src/pipeline/film-axis.ts](server/src/pipeline/film-axis.ts) rechnet seit derselben
Auslieferung über die STRECKE statt über die Aufnahmezeit und kennt dieselben Rampen; bliebe
er zurück, lösten `anker + versatzFilmS` in Studio und Render verschieden auf.

**Schnelllauf geht bis 8× — und Ton klingt nur bei Tempo 1 vorwärts** (E16). Beide Bühnen
gleich (`cycleSpeed`/`shuttle` im Player, J/L im Editor). Das erledigt eine Lücke statt sie zu
flicken: Die Musik lief im Schnelllauf weiter und driftete, weil `shuttle` keinen Ausgleich
auslöste — bei 8× vergehen acht Filmsekunden je Wanduhrsekunde. Beim Zurückschalten auf 1×
richtet [main.ts](src/main.ts) den Ton einmal aus (`nachSprung`), wie nach jedem Sprung.

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

**Der Video-Export ist ein TAKTGEBER, kein zweiter Renderer**
([src/exportfilm.ts](src/exportfilm.ts), Konzept
[konzept_video_export.md](docs/concepts/konzept_video_export.md) §6 „Ein Takt"). `Tour.exportTakt`
hängt `tick` von der Wanduhr ab, der Encoder ruft `Tour.exportSchritt(1/fps)` — und das ist
DIESELBE `schritt`-Funktion. Die Bildrate (24/30/50/60, Vorgabe 30) ist dabei eine reine
ABTASTUNG: `Smooth` rechnet `1 − exp(−dt/τ)`, also kommt bei 60 fps dieselbe Bewegung heraus,
nur doppelt so oft gemessen — Filmlänge, Halte und Rampen ändern sich nicht. Intro-Orbit, Anfahrt (`tour.begin()`), Halte, Foto-Karte,
Modus-Kanten und Finale sind Player-Code; die einzige Größe, die der Film anders rechnet, ist
`exportSkalaMin` (Esri-Überzoom zu Fuß). Nachgebaut wird nur, was im DOM liegt und deshalb nicht
grabbar ist: Foto-Karte, Startscreen, Finale-Tafel — und deren INHALT kommt aus denselben
Elementen, die der Player füllt. Die Regel von oben gilt hier ein drittes Mal und ist teurer als
im Player: Ein Filmbild kostet 0,3–2 s Wandzeit (Kachel-Idle), also bekäme jede eigene Schleife
pro Filmbild bis zu einer halben echten Sekunde Vorschub — der Regen sprang, statt zu
fallen. Deshalb `weather.externerTakt`/`weather.schritt` und `atmo.setzeTakt`. Wer eine neue
Schleife anlegt (Partikel, Blende, Zähler), gibt ihr einen Schritt von außen.
**Gerendert wird IM Studio-Tab**, in einem gleich-origin `iframe` mit der Export-Seite
([src/studio/exportblatt.ts](src/studio/exportblatt.ts), Meldungen per `postMessage`, Kanal in
[exportformat.ts](src/exportformat.ts)). Ein zweiter Tab wäre ein verdeckter Tab, und Chrome
drosselt dessen `requestAnimationFrame`: gemessen 0,15 statt 15 Bilder je Sekunde. Der Rahmen
muss dabei GEZEICHNET werden — `display: none` liefert kein WebGL-Bild —, also ist er sichtbar
und zugleich die Vorschau. Von der Frame-Zeit sind 98 % das Warten auf Kacheln (`window.__j.exportMess`);
Engine, Komposition und Encode zusammen 1,2 ms. Wer die Auflösung senkt, spart fast nichts.

**Fortbewegungs-Modi** sind `walk | bike | moped | jeep | tram | ferry`. Die Liste muss an vier
Stellen deckungsgleich bleiben: `MODUS_TEMPO` ([src/filmachse.ts](src/filmachse.ts)) samt
`MODE_SCALE` ([src/tour.ts](src/tour.ts)),
`MODE_ICONS` ([src/map.ts](src/map.ts)), `MODE_SOUND` ([src/vehicle.ts](src/vehicle.ts), nur
die drei mit Motorgeräusch: moped/jeep/ferry — die Tram fährt lautlos) und `TRAVEL_MODES` ([server/src/schema/upload.ts](server/src/schema/upload.ts), von
dort beziehen Studio-Typ und alle JSON-Schema-Enums ihre Werte). Sie **lief schon einmal
auseinander** — Studio und Server kannten `moped`/`jeep` nicht, obwohl Engine, Icons und
Motorsound sie längst unterstützten; aufgezeichnete Touren konnten diese Modi deshalb nie
bekommen. Ein Drift-Wächter in [test/studio-baukasten.test.ts](test/studio-baukasten.test.ts)
vergleicht die Listen (und die Tempo-Faktoren) jetzt automatisch.
Der Modus wird bei der Aufnahme EINMAL angegeben; wo jemand stattdessen zu Fuß war, trennt
[server/src/pipeline/tempo.ts](server/src/pipeline/tempo.ts) beim Rendern selbst ab (s. unten).
Im Editor ist **jeder Modus-Wechsel eine ziehbare Kante** — auch die von der Automatik
erkannte. Beim ersten Zug schreibt `materializeTravelModes` ([editmodell.ts](src/studio/editmodell.ts))
die ganze erkannte Aufteilung als Grenzen fest: `edits.travelModes` ist eine Stufenfunktion, die AB
ihrem Punkt alles Folgende übersteuert — eine einzelne neue Grenze mitten in der Automatik
risse die späteren Abschnitte mit. `clampBoundary` hält jede Kante zwischen ihren Nachbarn UND
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
per `id` zu. **Die UI zieht sich zurück, solange der FILM läuft** (`body.ui-clean`, nach 3,2 s
Ruhe; Weg zurück, Halt-Chip, Steuerleiste UND Mauszeiger) und kommt bei der nächsten Regung wieder —
auf jeder Zeigerart, deshalb gibt es keinen Knopf und keine Taste dafür mehr. Drei Fallen:
`pointermove` feuert auch ohne Handbewegung, sobald sich der Inhalt unter dem stehenden Zeiger
ändert (also pro Frame) — ohne Koordinaten-Vergleich käme die UI nie zur Ruhe; `:hover` (die
Ausnahme „Maus liegt auf der Steuerleiste") darf nur bei `(hover: hover)` zählen, weil die
Pseudoklasse auf Touch nach einem Tipp am getippten Element hängen bleibt; und der **Halt zählt
zur laufenden Wiedergabe**. Dort stand einmal `phase === 'ride'`, die Leiste blieb also die
ganze Standzeit oben — unter der alten Schichtung unsichtbar, seit E17 der Normalfall: Sie
deckte Bildunterschrift und „Weiter" zu (gemessen 93 px bei 1280 × 800). Dieselbe Lehre wie bei
E13 — ein Halt ist ein Zustand der Kurve, kein anderer Betriebsmodus.

**Die Bedienung liegt ÜBER dem Bild** (E17): `.photo-layer` (12) und `.finale` (13) unter
`.dock` (20), `.karten-info` (22), `.zurueck` (31) und dem Startscreen (30). Vorher war es
umgekehrt (25 gegen 20), und das trug nur, solange `beginScrub` die Karte wegräumte — seit sie
liegen bleibt, muss die Leiste erreichbar sein, WÄHREND sie liegt. Das ist die Ordnung jedes
Videoplayers: Das Bild ist der Inhalt, die Steuerung liegt darauf. Gehalten von
[test/player-schichtung.test.ts](test/player-schichtung.test.ts) — die Zahlen stehen 500 Zeilen
auseinander, wer die eine anfasst, sieht die andere nicht.

**Und die Foto-Karte ist eine FUNKTION der Filmzeit** (E15, `Tour.synchronisiereKarte` →
`UI.synchronisiereKarte`), keine Wanduhr-Animation mehr. Jede Aufnahme eines Halts ist ein
KLIP von Standzeit + Ausblendung (`klipDauerS` in [einblendung.ts](src/einblendung.ts));
steht `filmS` darin, liegt ihre Karte auf der Bühne — mit dem Auftritt, dem „Entwickeln", dem
Ken-Burns-Stand und dem Video-Frame genau dieser Filmsekunde. Technisch **malt sie seit dem
2026-08-17 ein Maler auf eine LEINWAND** (s. den nächsten Abschnitt); bis dahin standen die
Animationen dauerhaft auf `animation-play-state: paused` und ihr Fortschritt kam aus einem
NEGATIVEN Delay (`--karte-zeit`) — die Technik, mit der man ein Standbild aus einer Animation
zieht. **Der Editor malt seit demselben Tag ebenfalls** (s. übernächster Abschnitt); die
`--fe-*`-Choreografie ist weg. Vier Dinge fallen damit zusammen:
Die Karte erscheint auch rückwärts und animiert rückwärts; **Ken Burns ist pausierbar** (als
`transition` lief er unter dem „Angehalten"-Abzeichen weiter, gemessen: Bildskala hält jetzt
über 2,2 s Wanduhr exakt); Scrubben durch einen Halt zeigt endlich etwas (`beginScrub` räumte
die Karte weg); und die **1-Sekunden-Abweichung aus §6C** des Gleichlauf-Konzepts ist weg — die
Drift-Dauer ist beidseits die Klip-Länge (`holdS + 0.8`), nicht mehr `holdS + 1.8` im Player.
Vier Regeln daneben: Ein **Video kann nicht rückwärts spielen**, dort wird geseekt
(`videoStandS`, geteilt); es läuft nur bei Tempo genau 1 und schweigt sonst; **ab 2×
Schnelllauf bleibt die Karte ganz aus** (E16, „dort will man die Strecke überfliegen"); und
`swapPhoto` ist ersatzlos entfallen — jede Aufnahme hat ihren eigenen Klip und damit ihren
eigenen Auf- und Abgang. Was geteilt wird, sind die RECHNUNGEN (`kartenZeiten`,
`balkenAnteil`, `klipDauerS`, `videoStandS` in [einblendung.ts](src/einblendung.ts)) und die
Filmzeit — **nicht die Mechanik**: Ein gemeinsames DOM-Bauteil ist ausdrücklich nicht gewollt
(Konzept §6A), der Player streamt einen Film voraus, der Editor springt in einer Datei umher.

**Wann ein Video GESUCHT wird, entscheidet eine geteilte Rechnung** (`videoNachfuehrung` in
[einblendung.ts](src/einblendung.ts), benutzt von Player und Editor). Vorher stand an beiden
Bühnen dieselbe Bedingung direkt am Element: „weicht `currentTime` um mehr als 0,34 s ab, dann
springen", in jedem Frame gefragt. Auf dem Telefon war das ein SUCHSTURM. Über Mobilfunk
braucht ein Video rund eine Sekunde bis zum ersten Bild, die Filmzeit läuft dabei weiter, und
nach 0,34 s wurde gesucht. Der begonnene Suchlauf wurde im nächsten Frame durch den nächsten
ersetzt, und keiner kam je an. Sichtbar war es als Ruckeln mit schwarzen Bildern dazwischen:
Ein suchendes Video liefert keinen Frame, und ohne Frame malte die Karte ihr schwarzes
Bildfeld. Vier Regeln halten das auf, und jede einzelne reicht dafür allein nicht: **Ein
laufender Suchlauf wird nie überholt** (das Ziel wandert, jeder neue wäre der Abbruch des
vorigen); **im Lauf wird nur gesucht, wenn das Video weiterlaufen könnte** (`HAVE_FUTURE_DATA`,
sonst führt der Sprung in ungepufferte Daten und verlängert das Puffern); **nach einem Suchlauf
liegt eine Wanduhr-Ruhe** von 0,5 s (er kostet selbst Zeit, in der der Film weiterläuft); und
**die Schwelle ist im Lauf grob und im Stand fein** (0,5 s gegen 0,04 s), denn beim Scrubben
IST die gesuchte Stelle das, was man sehen will. Drei Dinge daneben: Der **Maler zeichnet auch
ohne die Zusicherung** `bereit` (ein `drawImage` auf ein suchendes `<video>` liefert das alte
Bild, und das ist auf der Bühne die bessere Auskunft als Schwarz); das **Poster bleibt bis zum
Stopp-Wechsel liegen**, statt nach einer Frist von 1,5 s abgeräumt zu werden (genau die nahm auf
dem Telefon das Bild weg, das über das Laden hinweghalf), und sobald das Video einmal einen
Frame geliefert hat, bleibt es die Quelle, weil `readyState` bei jedem Suchlauf zurückfällt;
und der **Export sucht jedes Bild** (`bildgenau`), statt das Video nebenher laufen zu lassen.
Dort vergeht je Filmbild 0,3 bis 2 s Wanduhr, die Toleranz des Laufs landete also als falsches
Einzelbild in der Datei. Den Anfang entschärft `_weckeVideo` in [ui.ts](src/ui.ts): Der nächste
Halt holt schon während der Anfahrt den KOPF seiner Datei (`preload="metadata"`, nicht die
ganze Datei, die konkurrierte mit den Kacheln).

**Und die Karte des PLAYERS liegt auf einer Leinwand** ([kartenmaler.ts](src/kartenmaler.ts),
DOM-frei; eingehängt von [kartenschicht.ts](src/kartenschicht.ts) als `#karte` auf z-index 12).
Damit gibt es sie nur noch ZWEIMAL statt dreimal: Der Video-Export holt sie mit
`zeichneOverlay(ctx, 'karte', …)`, derselben Zeile wie für Wetter und Atmosphäre, und sein
eigener Nachbau ist weg. Der hatte Ken Burns in der GEGENRICHTUNG laufen, kein „Entwickeln",
keinen Blitz, keinen Balken, keine Pillen — und las die Texte per `textContent` aus dem DOM
zurück, das der Player gerade gefüllt hatte
([docs/concepts/die-foto-karte-auf-eine-leinwand.md](docs/concepts/die-foto-karte-auf-eine-leinwand.md)).
Sieben Dinge, die man dabei kippt:

- **Was Bildinhalt ist, geht auf die Leinwand; was Umgebung oder Bedienung ist, bleibt DOM.**
  Der Schleier liegt DARUNTER (z 11), weil `backdrop-filter` auf einer Leinwand kein Gegenstück
  hat und ein eingefrorener Puffer nicht trägt (er bräuchte `preserveDrawingBuffer` im
  Normalbetrieb, und das Wetter läuft im Halt weiter). Klickfläche, Ton-Knopf, „Weiter ▸" und
  das „Angehalten"-Abzeichen liegen DARÜBER (z 14) — Knöpfe haben im Film nichts zu suchen.
- **Die Klickflächen sind MITGEFÜHRT.** `maleKarte` gibt seine Rechtecke zurück
  (`KartenMasse`), die Schicht legt die DOM-Elemente pro Frame darauf. Ein statischer Kasten
  wäre falsch, sobald die Karte springt, weil die Bedienung erscheint oder verschwindet.
- **Eine Leinwand zeichnet sich nicht von selbst neu.** Eine Custom Property tat es; hier hängt
  jede Änderung am nächsten Kopfschritt, und im ANGEHALTENEN Halt läuft keiner. Der Rückzug der
  UI kippt genau dort (die Steuerleiste deckte die Bildunterschrift zu), und ein Resize LÖSCHT
  die Leinwand, weil er `canvas.width` schreibt. Die Schicht beobachtet deshalb Größe UND die
  Klasse am body.
- **`prefers-reduced-motion` ist ein SCHALTER im Aufruf** (`buehne.ruhig`) und kein Blick des
  Malers nach draußen — im Export ist er immer aus, sonst hätte die Einstellung des rendernden
  Rechners Einfluss auf die ausgelieferte Datei. Ein Wächter verbietet dem Maler `matchMedia`.
- **Es gibt eine BEZUGSHÖHE** (900 CSS-Pixel, `mass = klemme(hoehe/900, 0.7, 2.6)`): Jede feste
  Länge im Maler ist ein Wert bei dieser Höhe. Ohne sie wäre die Karte im 4K-Film ein
  Briefmarkenrahmen mit Fußnotenschrift — ein gemeinsamer Zeichner allein macht zwei Bühnen
  nicht deckungsgleich. Nicht mit skalieren nur drei Mindest-Schriftgrößen (Telefon) und der
  Boden des Bildradius. Die LAGE (`breit`/`schmal`/`quer`) leitet der Maler selbst aus Breite
  und Höhe ab, an denselben Schwellen, an denen vorher `body.kompakt-quer` und
  `@media (max-width: 700px)` hingen.
- **Das „Entwickeln" ist eine Überblendung zweier gepufferter Fassungen, nicht `ctx.filter` pro
  Frame.** Der ist je nach Browser nicht beschleunigt. Es ist eine NÄHERUNG (gemessen: max 24
  von 255 in der Kurvenmitte, Anfang und Ende exakt) und hat in der Abnahme eine eigene
  Toleranz. Gepuffert werden ebenso der Schatten (in niedriger Auflösung) und jeder Textblock:
  Pro Frame Text messen und `shadowBlur` auf die große Karte legen macht eine Leinwand
  LANGSAMER als das DOM, das sie ersetzt.
- **Der Text bleibt im Dokument.** Eine versteckte Kopie (`figcaption.sr-only`) trägt Titel und
  Bildunterschrift weiter für Screenreader — ohne sie wäre der Umbau eine
  Zugänglichkeits-Regression, die niemandem auffällt, weil das Bild gleich aussieht.

**Und die Karte zeigt seit dem 2026-08-18 keine Gattung mehr.** „Foto" und „Video" standen
dreimal auf derselben Fläche: als Pille rechts unten, im Editor als Titel-Rückfall und im
Player als „Foto · 14:32" aus der Pipeline — jedes Mal in der größten Schrift die eine
Auskunft, die man dem Bild ansieht. Entwurf und Herleitung:
[studio-fotokarte-ohne-titel.html](docs/archive/mockups/studio-fotokarte-ohne-titel.html). Sechs Regeln
daneben, die man beim nächsten Anfassen leicht kippt:

- **Die FORM bleibt, ob mit Titel oder ohne.** Die Zeile behält die Höhe des Titelgrades, auch
  wenn nichts darin steht, und die Angaben bleiben RECHTS stehen. Ohne beides wäre die
  unbeschriftete Karte 11 px flacher und ihre einzige Zeile spränge nach links: Beim Blättern
  durch die Halte bewegte sich damit ausgerechnet das, was bleibt. Eine rahmenlose Fassung
  („nur das Bild") war die schönere EINZELkarte und ist genau daran gescheitert.
- **Titel links, Angaben rechts, eine Zeile — mit Rückfall.** Passen beide nicht mit dem
  doppelten `lueckeX` dazwischen nebeneinander, bekommt jede ihre eigene Zeile
  (`angabenPasstNicht`). Die Karte ist so breit wie ihr Bild: Bei einer Hochkant-Aufnahme sind
  das keine 200 px, dort blieben dem Titel 64 von 158 gebrauchten Pixeln. Deshalb kennt die
  Geometrie den INHALT (`KartenInhalt`) und wird im Bedarfsfall zweimal gerechnet — sie ist
  reine Rechnung, der zweite Durchgang kostet nichts.
- **Die Angaben haben keinen Rahmen mehr und stehen zweistufig** (`teileAngaben`): Ziffern
  dunkler und in 500, „Uhr" und „km" zurückgenommen. Ein Kasten sagt „hier steht eine Marke",
  und das ist eine Uhrzeit nicht. Der Kilometerstand bleibt auf JEDER Bühne, auch im Editor,
  obwohl der Zeitleisten-Kopf dieselbe Zahl trägt: Die Karte soll überall dieselbe sein, sonst
  sieht man beim Schneiden nicht, was ausgeliefert wird.
- **Der Knopf „Weiter ▸" ist ersatzlos entfallen.** Er sprang zur nächsten Aufnahme desselben
  Halts und stammte aus der Zeit, als ein Halt auf der Fortschrittsleiste keine Breite hatte.
  Seit Etappe 5 zieht man einfach durch. Was mit ihm entfallen ist, ist der GEZIELTE Sprung
  zur einzelnen Aufnahme — den bekommt die Leiste
  ([konzept_player_leiste_ui.md](docs/concepts/konzept_player_leiste_ui.md)). Mit ihm weg sind
  `tour.photoNext`, `#photo-next`, `.photo-next` und das `weiter`-Rechteck des Malers.
- **Die Karte hat keine BILDUNTERSCHRIFT mehr.** Ein Halt steht 5,2 s
  (`HOLD_HIDE`), nach Auftritt und Abgang bleiben rund vier; die kuratierten
  Beschreibungen waren im Median 84 Zeichen lang und die längste 239 — der Median
  füllte die Standzeit vollständig aus, wer las, sah das Bild nicht. Dazu kam,
  dass das Studio nie ein Feld dafür hatte: Nur `tours.ts` konnte sie setzen.
  Entfallen sind deshalb `KartenText.unter`, die Unterschrift-Geometrie samt
  ihren Maßsatz-Feldern, `#photo-sub` und die 28 Beschreibungen der kuratierten
  Touren. Der Player trägt seither `title`, `1/2` und die Angaben als
  `figcaption.sr-only`, sonst nichts.
- **Die UHRZEIT ist eine Angabe und kein Text.** Sie steht rechts neben dem Kilometerstand
  („09:09 Uhr · 2,4 km") und wird im Player aus `takenAt` gerechnet (`UI.zeitzone`,
  `UI._uhrzeit`) — nicht mehr als fertige Zeichenkette vom Server. Vorher lieferte
  [enrich.ts](server/src/pipeline/enrich.ts) „Foto · 09:09" als `title` bzw. als `caption`, und
  damit sah dieselbe Aufnahme im Player anders aus als im Editor: Uhrzeit unter dem Titel statt
  daneben, dazu die Gattung davor. Jetzt trägt das JSON in beiden Feldern NUR den Nutzertext;
  `caption` bleibt echten Bildunterschriften der kuratierten Touren vorbehalten. Drei Dinge,
  die man dabei kippt: Die Zone ist die der TOUR (`cfg.time.zone`) und nicht die des
  Betrachters; die Prüfung „liegt `takenAt` überhaupt in der Tour-Zeitspanne?" ist mit der
  Uhrzeit in den Player gewandert (`UI.zeitfenster`, sonst zeigte ein mtime-Fallback eine
  Uhrzeit von vorgestern); und der Kilometerstand steht mit KOMMA, wie im Editor.
  Bestandstouren tragen die alten Texte, bis sie neu gerendert werden.
- **Der Rand ist schmaler, der Fuß bleibt der eine breite Rand** (Editor: `polster` 22 → 12,
  `balken` 7 → 5, Balken-Rest 0,3 → 0,16; `textUnten` Editor 22 → 24 und Player 15 → 18).
  Gemessen wird am MALER und nicht am Entwurf — dort galt eine andere Geometrie, und eine 6
  sah dort richtig aus, ergab hier aber 13,5 px unten gegen 25 oben, also eine Karte, die unten
  abgeschnitten aussah. Jetzt sind es 27,5 zu 25 (Editor) und 24,8 zu 22,4 (Player). Gleich
  breit rundum wäre falsch: Ein Abzug mit Beschriftung hat oben und seitlich denselben
  schmalen Rand und unten einen breiteren, und das liest sich nur als gewollt, solange oben
  und seitlich gleich sind.
- **Quer beschriftet UNTER dem Bild — wie breit und schmal.** Die Textspalte NEBEN dem Bild
  ist weg, und mit ihr der letzte Sonderfall der Lage: `lage === 'quer'` kommt in der
  Geometrie nicht mehr vor. Sie stammte aus der Zeit mit Bildunterschrift, die sie füllte;
  ohne die stand dort eine leere Papierfläche, und beide Fehler der Karte hingen an ihr —
  erst lief die Angaben-Zeile links aus der Karte (die Geometrie lieferte die rechte Kante,
  der Maler las sie als linke), nach dem Umbau auf die Fußzeile dieselbe Zeile nach rechts
  hinaus, weil `malBeschriftung` seinen `lage === 'quer'`-Zweig behielt. **`text.angaben.x`
  ist in JEDER Lage die RECHTE Kante der Zeile**; ein Sonderfall daneben ist genau der
  Fehler, den man zweimal baut. Der Preis der Fußzeile ist gemessen und klein: Bild 501 × 334
  statt 549 × 366 auf dem Pixel 9 quer (−17 % Fläche, Titel dafür 18,9 statt 14 px). Und die
  **Chrome-Reserve kennt den zweizeiligen Fuß** (`inhalt.angabenEigeneZeile`): Passen Titel
  und Angaben nicht nebeneinander, wird die Karte um eine Zeile höher — ohne das blieben bei
  einer Hochkant-Aufnahme quer 2 px Luft zum Bühnenrand. Jetzt trägt das BILD die Zeile.

Die geteilten ZAHLEN bleiben in `KARTE`/`KARTE_BUEHNE` ([einblendung.ts](src/einblendung.ts));
die GEOMETRIE ist ausdrücklich nicht geteilt und steht als benannter Bühnen-Satz im Maler:
`KARTEN_MASSE` für den Player (drei Lagen, abgeleitet), `EDITOR_MASSE` für den Editor.
Gemessen wurde mit
[scripts/messungen/kartenleinwand.mjs](scripts/messungen/kartenleinwand.mjs): Bühne gegen Film
bei gleichem Format max 0 von 255, Frame-Zeit im Halt unverändert (14,4 → 14,0 ms).

**Und seit dem 2026-08-17 malt derselbe Maler auch im STUDIO** — die dritte Bühne, „Eine
Bühne, ein Maler" Etappe 1 ([docs/archive/eine-buehne-ein-maler.md](docs/archive/eine-buehne-ein-maler.md)).
Der Editor rief `createKartenSchicht` mit dem Satz `editor` und verlor dabei 150 Zeilen CSS:
fünf Keyframes, die `--fe-*`-Choreografie, einen eigenen Reduce-Block. Was ihn leicht macht,
ist, dass seine Karte **keine Knöpfe** hat — der aufwendigste Teil der Player-Migration, die
mitgeführten Klickflächen, entfällt dort ganz. Vier Dinge, die man dabei kippt:

- **Die Lage wird GESETZT, nicht abgeleitet.** `kartenLage` fragt Breite und Höhe, und für ein
  Vollbild ist das richtig; eine Editor-Fläche von 700 × 500 fiele damit in `quer` und bekäme
  das Layout „Bild links, Text rechts" eines liegenden Telefons. Sie gehört zum Bühnen-Satz.
- **`chrome: 306` ist ein ANTEIL, keine Reserve in Pixeln.** Die Bildhöhe ist
  `hoehe − chrome × mass`, und weil `mass` ungeklemmt `hoehe / 900` IST, ergibt 306 genau die
  `66cqh` der abgelösten CSS-Fassung — bei jeder Bühnenhöhe. Deshalb reicht der Maßstab dort
  auch tiefer (0,55 statt 0,7): Sonst wäre auf einer 480-px-Bühne immer geklemmt.
- **Eine Leinwand zeichnet sich nicht von selbst neu — und im Editor STEHT der Kopf.** Das ist
  der Fall, den die Falle des Player-Umbaus nicht nennt: Ein `img` in der DOM-Karte erschien
  von selbst, sobald es geladen war. Hier sah man beim Scrubben die Karte fliegen und liegen
  bleiben, mit LEEREM Bildfeld. `zeigeFoto` hängt deshalb an `load` (Bild) und
  `loadeddata`/`seeked` (Video) einen Rückruf auf `synchronisiereFoto`.
- **Der Schleier bleibt DOM** (`.karten-buehne::after`) und ist damit der eine Teil der Karte,
  der weiterhin zweimal als CSS dasteht und Text gegen Text bewacht wird.

**Der Kamerablitz ist zurückgebaut** (Etappe 2, am selben Tag). Nicht wegen der Kosten, obwohl
er die teuerste einzelne Operation eines Kartenbildes war (2,0 gegen 1,1 ms im Median), sondern
wegen einer Beobachtung am Bild: Auf seiner Spitze steht die Karte bei 7 % Deckkraft und das
„Entwickeln" beginnt bei `brightness(1.45)` — das Foto IST dort schon ein heller Schleier, der
Blitz legte eine zweite weiße Schicht auf eine, die längst da war. Drei Gründe daneben: Die
METAPHER ist verkehrt (ein Blitz sagt „hier wird gerade fotografiert", diese Fotos sind längst
aufgenommen und werden gezeigt), er STROBTE (er hing am Klip und nicht am Halt, feuerte also
bei jedem Bildwechsel innerhalb eines Halts neu), und der Auftritt war ohnehin voll.

**Und die Letterbox-Balken sind am selben Tag gefallen** (`.cine`, je 9vh oben und unten — auf
1080p zusammen 194 px). Sie stammen aus der Zeit, als der Halt fast nichts hatte, was ihn
ankündigte; teuer waren sie genau dort, wo etwas liegt: unten die Steuerleiste, oben der Weg
hinaus. `body.cinema` bleibt und schaltet nur noch den `backdrop-filter` des Schleiers.

**An seine Stelle tritt der SCHLEIER — und der hängt seither an der FILMZEIT.** Der Halt wird
dadurch markiert, dass die Umgebung zurücktritt. `kartenschicht.ts` schreibt pro Frame
`--schleier-sicht`, die Deckkraft der Karte; damit kommt er über den Flug hoch und geht mit dem
Abgang wieder weg, rückwärts wie vorwärts und beim Scrubben. Als 0,8-s-Transition an einer
Klasse blieb er beim Scrubben hinter der Karte zurück und kam rückwärts gar nicht mit — die
letzte Stelle der Karte, an der noch eine Wanduhr lief. Drei Dinge, die man dabei kippt: Es ist
eine **Custom Property und kein `style.opacity`** (im Editor ist der Schleier ein `::after`,
und ein Pseudo-Element nimmt keine Inline-Stile — seinen Host kann man beschriften); die
**Klasse bleibt und schaltet nur noch den FILTER** (ein bildschirmfüllender `backdrop-filter`,
der dauernd stünde, wäre auf einem schwachen Gerät der teuerste Posten der Seite); und die
**Transition muss WEG, nicht kürzer werden** — sie liefe sonst über die Werte, die die Filmzeit
setzt.

**Die Karte FÄHRT mit der Steuerleiste, sie springt nicht.** `KartenBuehne.bedienung` ist ein
Anteil 0..1 und kein Schalter; die Schicht führt ihn über 0,5 s mit `ease` — **Dauer und Kurve
der Leiste selbst** (`.dock`, `.zurueck`, `.next-stop` in style.css). Damit ist es eine Geste:
Die Leiste kommt, die Karte macht ihr Platz. Drei Dinge, die man dabei kippt: Die Geometrie muss
über dem Anteil **monoton** sein (der Maler mischt linear zwischen `chrome` und
`chromeBedienung`, die Kurve gehört der Schicht — eine Kante darin wäre ein Ruckeln); die
Schleife zeichnet **nur, wenn es im laufenden Bild noch niemand getan hat** (läuft der Film,
ruft er ohnehin jeden Frame `male()`, steht er, ist sie die einzige, die zeichnet — Falle 2 zum
dritten Mal); und **eine neu erscheinende Karte fährt nicht mit**, sie beginnt bei dem Anteil,
der gilt. Bei stehender Leiste ist die Karte außerdem kleiner geworden und sitzt höher
(`chromeBedienung` 335 → 380, `hubBedienung` 48 → 64): Auf 1080p blieben vorher 31 px zwischen
Kartenkante und Leiste bei 94 px oben, jetzt sind es 76 unten und 75 oben.

**Und die Karte hängt am HALT, nicht an einer Phasen-Flanke.** `update` räumte sie nur, wenn
die vorige Phase `photo` oder `moment` war — `beginScrub` schreibt aber `phase = 'ride'`, bevor
der erste Kopfschritt sie lesen kann. Wer bei einem Foto anhielt und dann scrubbte, behielt
deshalb die Karte, egal wohin er zog (gemessen: `filmS` 88 → 232, `s` 8974 → 26576, dieselbe
Aufnahme); geheilt hat es sich nur, wenn man zufällig durch einen ZWEITEN Halt zog. `raeumeKarte()`
steht jetzt unbedingt da, wo kein Halt ist; die Flanke trägt nur noch, was wirklich eine ist —
das weiche Anziehen der Kamera. Dieselbe Lehre wie E13, an einer Stelle, die davon nichts
mitbekommen hatte: *Ein Halt ist ein Zustand der Kurve, kein getriggerter Wechsel.*
**Und die Leiste ist die ZEITACHSE des Films** (Etappe 5), nicht mehr die Strecke. Damit hat
jeder Halt die Breite, die er im Film einnimmt — und weil sich eine Breite anfahren lässt,
kann man mitten in einen Halt scrubben und sieht dort den Stand dieser Filmsekunde. Vorher
stand der Kopf die ganze Standzeit still und sprang danach über sie hinweg (derselbe Defekt,
den die Studio-Zeitleiste am 2026-08-05 verlassen hat). Vier Dinge, die man dabei kippt:

- **`frac` bedeutet seither zwei Dinge, und deshalb heißt es nicht mehr überall so.**
  `Telemetrie` trägt `frac` (Streckenanteil: Sonnenstand, Pseudo-Uhrzeit, Wetter-Regie,
  `next.km`, `syncDots`) UND `filmFrac` (Filmanteil: Balken, Playhead, Profil-x, Dot-x). Die
  Kante zwischen beiden liegt in `UI.stats` und nirgends sonst. Der Aufruf, der still kippen
  kann, ist **`onTick`** — er treibt die Tag/Nacht-Regie an und rechnet
  `pointAt(route, frac × total)`: mit dem Filmanteil wanderte die Sonne im Halt weiter,
  während der Film steht.
- **Die Halt-Fläche ist Anzeige, nicht Griff** (`.halt-flaeche`, `pointer-events: none`).
  Wäre sie der Griff, spränge ein Tipp in ihrer Mitte auf die ANKUNFT des Halts — also genau
  dorthin, wohin vorher jede Eingabe fiel. Der Griff bleibt der Punkt und sitzt am Beginn.
- **Das Höhenprofil wird filmäquidistant abgetastet**, Halte sind darin Plateaus; `yAt` nimmt
  deshalb einen FILManteil, und die Punkte tragen ihn im `dataset` (für `rebuildProfile`
  nach dem Eintreffen der DEM-Höhen).
- **Im Punkte-Container liegen jetzt zwei Sorten Kinder.** `punkte` fragt nach `.photo-dot`
  statt nach `children`, sonst läse `syncDots` `dataset.s` von einer Fläche.

Abnahme: [scripts/messungen/leiste-filmlinear.mjs](scripts/messungen/leiste-filmlinear.mjs).
Was **noch fehlt**, ist das Einzelbild im Halt: `nudge` räumt die Karte weg, statt sie auf die
neue Filmsekunde zu stellen (eine Lücke von E15, gehört zur Feinplatzierung).

**Der Startscreen sagt, WAS einen erwartet — nicht, wann es aufgenommen wurde**
(2026-08-18, Entwurf: [player-startscreen.html](docs/archive/mockups/player-startscreen.html)).
Vorher stand über dem Titel das Aufnahmedatum in der Akzentfarbe, die Beschreibung aus dem
Studio kam nirgends an, und der Knopf trug einen Amber-Verlauf, den es sonst nirgends im
Produkt gab. Die Rechenteile stehen DOM-frei in [src/tourtexte.ts](src/tourtexte.ts), damit
Player, Studio und Tests dieselbe Antwort bekommen. Sechs Regeln, die man beim nächsten
Anfassen leicht kippt:

- **Die Dachzeile gehört dem Autor, nicht dem Geocoder.** Was dort hingehört — Ort, Gegend,
  Sehenswürdigkeit oder ein Satzanfang —, kann niemand ableiten: Nominatim liefert je nach
  Gegend eine andere Ebene (Stadtteil, Stadt, Landkreis). Also ein Feld (`tours.dachzeile`)
  mit drei Zuständen: NULL = nie gesetzt (Vorbelegung greift, und die gibt es NUR bei der
  Rundtour), '' = ausdrücklich keine Zeile, sonst der Text. Die Vorschläge im Studio sind die
  Adress-Ebenen aus derselben Geocoder-Antwort, aus der schon der Ortsname kommt — sie lagen
  bisher ungenutzt in der Antwort. **Bestandstouren tragen im gerenderten JSON noch den
  Alt-Kicker**; die Route wirft ihn weg, solange keine eigene Zeile gesetzt ist, sonst stünde
  das Datum doppelt auf der Seite.
- **Der AUTOR steht nicht in der gerenderten Datei**, sondern wird bei jeder Auslieferung
  frisch eingesetzt ([server/src/routes/tours.ts](server/src/routes/tours.ts)) — eingebacken
  wäre er nach dem nächsten Namenswechsel falsch. Verlinkt sind nur Avatar und Name, nicht das
  Datum; im App-Modus gar nicht, weil ein Profilsprung im WebView keinen Rückweg hat.
- **Die Beschreibung wird BEGRENZT statt geklemmt** (150 Zeichen, `BESCHREIBUNG_MAX`). Am
  Startscreen zu klemmen hieße raten, wo ein Satz endet, und zwar bei jeder Bildschirmbreite
  anders. Unter 150 bleibt der Text auch in der Vorschaukarte geteilter Links ungekürzt.
- **Die Filmdauer kommt aus der Achse** (`filmachse.gesamtS`) und ist damit keine Schätzung.
  Sie steht als erster Chip und nicht im Knopf: Der Knopf ist eine Handlung, und im
  Video-Export gibt es ihn nicht — die Kennzahlenzeile dagegen zeichnet er mit.
- **Eine Null ist keine Angabe.** „0 hm" stand neben „0.1 km" wie ein Defekt; Chips ohne Wert
  fallen weg. Die Stationszeile erscheint nur, wenn mindestens eine Station nicht schon im
  Titel steht — bei automatisch benannten Touren kommen Titel UND Stationen aus denselben zwei
  geocodierten Endpunkten, die Zeile wiederholte dort wortgleich den Titel.
- **Die Kennzahlen hängen NICHT am Kartenladen.** Sie standen im `load`-Handler und zeigten
  bis zur ersten Kachel „– km", obwohl Route und Achse längst gebaut sind.

Der Export zieht überall mit ([exportfilm.ts](src/exportfilm.ts) `zeichneIntroTafel`): Er
liest die Inhalte per `textContent` aus denselben Elementen und überspringt seit dem Umbau
ausgehängte (`hidden`) — sonst stünde im Film, was der Player gerade weglässt.

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

**Der Start-Knopf ist zugleich die Nutzergeste fürs VOLLBILD**
([src/vollbild.ts](src/vollbild.ts)). Im mobilen Browser frisst die Adressleiste
den Streifen, der im Querformat am meisten kostet; die Fullscreen API nimmt sie
weg, auf Android samt Systemleiste. Fünf Regeln, die man beim nächsten Anfassen
kippt: Gefragt wird nach der FÄHIGKEIT und nie nach dem Gerät (`fullscreenEnabled`
— auf dem iPhone gab es Vollbild jahrelang nur für `<video>`, seit Safari 26 für
jedes Element; altes iOS fällt still durch, und ein `iframe` ohne
`allow="fullscreen"` ebenso, was für den Export-Rahmen die richtige Antwort ist).
**Nichts hängt am Erfolg**: Der Aufruf kann trotz Nutzergeste ablehnen, und eine
unbehandelte Ablehnung risse den Start-Handler ab — dann startete die Tour nicht,
WEIL das Vollbild nicht klappte (`test/vollbild.test.ts` hält beide Wege).
`--vh-app` muss mitgehen, deshalb hört [main.ts](src/main.ts) zusätzlich auf
`fullscreenchange`. **Können und Wollen sind zwei Fragen**: Am Schreibtisch hat
das Fenster die Größe, die jemand ihm gegeben hat, und die Adressleiste kostet
daran fast nichts — dort wäre die Übernahme des Schirms eine Anmaßung.
`vollbildErwuenscht()` fragt deshalb `(hover: none) and (pointer: coarse)`, also
„Finger und keine Maus": Ein Notebook mit Berührungsbildschirm hat ein Trackpad,
meldet `hover: hover` und fällt heraus; Tablets fallen hinein. Nicht an der
BREITE festgemacht, denn ein schmales Browserfenster ist kein Telefon. Und **in
der App-WebView wird gar nicht erst gerufen** (`body.app`), dort ist ohnehin
Vollbild. Eine Web-App auf dem Home-Bildschirm ist ausdrücklich
etwas anderes und steht als eigenes Konzept daneben
([konzept_maptale_als_ios_webapp.md](docs/concepts/konzept_maptale_als_ios_webapp.md)).

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

**Die Tour-Musik hängt am Zustand `playing` — an nichts sonst.** Ihr Gate stand einmal auf
`playing || scrubbing || phase === 'photo'`, und BEIDE Oder-Klauseln waren dieselbe Sorte
Ausnahme: eine Stelle, an der die Pause nicht griff. Die letzte hob sie dort auf, wo man sie am
ehesten drückt — im Foto-/Video-Halt ist `playing` die einzige Auskunft darüber, ob der Film
läuft, also spielte die Musik unter der angehaltenen Einblendung weiter und stand danach
woanders als der Schnitt im Studio. Die mittlere ließ sie beim Scrubben wieder anlaufen: Wer
angehalten hatte und dann über die Leiste zog, hörte Musik und Regen zurückkommen und beim
Loslassen verstummen (gemessen an `mus-nachtfahrt.mp3` und `rain.mp3`). **Scrubben ist Blättern,
keine Wiedergabe** — und beim Ziehen WÄHREND der Wiedergabe ändert sich nichts, dort trägt
`playing`. Dieselbe Klausel steckte im `sceneAnimating` von Wetter und Atmosphäre und ist auch
dort weg. Die EINE Ausnahme, die bleibt, ist der kuratierte Ambient-Loop
([music.ts](src/music.ts)): Er hat `playing` bewusst nicht im Gate — er ist ein Bett der App,
nicht Teil der Szene, und läuft deshalb durch eine Pause hindurch. Aus demselben Grund läuft `holdT` in
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
  (`fileType` in [server/src/quota.ts](server/src/quota.ts)). Eigene Route und nicht
  Teil von `/auth/me`: Die Aufteilung läuft über alle Dateien aller Touren, `/auth/me` ist
  der heißeste Aufruf der API.

- **Der Newsletter-Schalter schaltet die EINWILLIGUNG, nicht den Versand.** Er ist auch
  bei unbestätigter Adresse bedienbar — gesperrt ist, was rausgeht
  (`NewsletterService.empfaenger` filtert auf `email_verified`), und die Zeile sagt es
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
  ([server/src/routes/pages.ts](server/src/routes/pages.ts)). Das steht so auch in
  [datenschutz.html](datenschutz.html), Abschnitt 5 — wer es ändert, ändert dort eine Zusage.

- **Der ZIP-Datenexport ist der einzige echte HINTERGRUNDLAUF im Projekt** (Art. 20 DSGVO,
  [server/src/data-export.ts](server/src/data-export.ts) für Aufträge und ZIP-Mechanik,
  [data-export-content.ts](server/src/data-export-content.ts) für das WAS,
  [data-export-run.ts](server/src/data-export-run.ts) für das Zusammenführen). Die Route antwortet
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
[server/src/routes/admin.ts](server/src/routes/admin.ts) hinter `requireAdmin`.

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
- Doku-Index: [`docs/README.md`](docs/README.md). Zum LESEN gibt es den lokalen
  Viewer: `npm run docs`, dann <http://maptale.localhost:5123/doku/> (Übersicht mit
  Roadmap, Bereiche, Volltextsuche, Mockup-Vorschauen, Verweis-Graph). Er leitet
  Bereiche, Systemteile und Archiv-Herkunft aus den Dateien ab und schreibt im
  Dev-Server auch zurück (bearbeiten, archivieren, einplanen, umbenennen).
  Er ist eine **gebaute** Website (`docs/_site/`, aus `docs/*.md` und
  `scripts/docs-viewer/`) — was der Dev-Server ausliefert, hat also nie die
  Quellen gesehen. Damit das nicht zur Falle wird, baut er selbst nach: Ein
  Wächter in [vite.config.js](vite.config.js) (`beobachteDoku`) beobachtet beide
  Quellorte, ruft nach 150 ms Ruhe `baueNeuNebenher()` und lädt den offenen Tab
  neu (gemessen: 1,5–2 s vom Speichern bis zur sichtbaren Änderung). Nötig war
  dafür dreierlei, und jedes einzeln kippt es lautlos: `docs/_site/` gehört aus
  Vites Watcher (`server.watch.ignored`, sonst löst der Bau die nächste Runde
  aus), jede Doku-Seite trägt im Dev Vites Client (sie geht durch keine
  Transformation, ein `full-reload` ginge sonst ins Leere), und die Auslieferung
  setzt `Cache-Control: no-store` (die Doku trägt keine Hashes im Dateinamen —
  der Tab lud sonst neu und zeigte das alte Blatt). Ohne den Wächter tarnt sich
  das Ganze als INHALTLICHER Fehler: Ein korrigiertes Skript verhält sich
  unverändert falsch, weil der Browser die Fassung von vorgestern ausführt.
  **Gebaut wird NEBEN der Ausgabe** (`docs/_site.bau.<pid>/`, danach zwei
  Umbenennungen; die Prozessnummer trennt zwei gleichzeitige Läufe): In-place geleert fehlte `index.html` rund eine Sekunde lang,
  und jede Anfrage in diesem Fenster bekam „Die Doku ist noch nicht gebaut" —
  genau dorthin fiel der Reload nach dem Archivieren. Aus demselben Anlass
  überspringt der Wächter, was der Viewer SELBST geschrieben hat
  (`letzterEigenerBau()` in [dienst.mjs](scripts/docs-viewer/dienst.mjs)); sonst
  baut er die Änderung ein zweites Mal und lädt die gerade umgezogene Seite auf
  ihre alte Adresse. Und eine Doku-Seite, die es nicht mehr gibt, fiele in Vites
  SPA-Fallback und käme als LANDING mit Status 200 zurück: Der Handler leitet
  stattdessen auf den neuen Ort um, wenn der Dateiname genau einmal im gebauten
  Baum vorkommt, und antwortet sonst mit einer eigenen 404.
  **Jedes Dokument trägt seinen VERLAUF** (Klappe unter dem Text, Weg dorthin in
  der Kopftafel): die Commits dieser Datei, und je Commit, was sich dabei an
  ihrem Kopf geändert hat („Status: Entwurf → Etappe 1 gebaut"). Damit steht die
  Gegenprobe zum handgepflegten `status` in derselben Ansicht wie die
  Behauptung. Gelesen wird EIN `git log -M -U0 -p` über `docs/` — `--follow`
  scheidet aus (es nimmt nur einen Pfad), Umbenennungen kommen aus den
  `rename from`-Zeilen, und der Kopfbereich wird über die Hunk-Zeilennummern
  abgegrenzt, sonst wäre jedes `status:` in einem Codeblock ein Statussprung.
  Wer ein
  Dokument oder Konzept ANLEGT, folgt dem Skill
  [`doku-anlegen`](.claude/skills/doku-anlegen/SKILL.md), wer ein MOCKUP zeichnet
  dem Skill [`mockup-anlegen`](.claude/skills/mockup-anlegen/SKILL.md) — beide
  laden automatisch.
  **Der Kopf eines Dokuments ist Front Matter** (`stand`, `status`, `betrifft`,
  `systemteile`, `archiviert_aus` — [`kopf.mjs`](scripts/docs-viewer/kopf.mjs)); die
  alte Prosa-Zeile „Stand: … · Status: …" gilt feldweise als Rückfall, beides
  zugleich verbietet der Wächter.
  **WER EINE ETAPPE BAUT, ZIEHT `status` UND `stand` IM SELBEN COMMIT NACH.** Der
  Satz in `status` ist die einzige Auskunft darüber, wie weit ein Vorhaben ist, und
  er ist von Hand gepflegt: Niemand prüft ihn, also veraltet er still und die Doku
  sieht danach gepflegt aus, ohne es zu sein. Konkret, sobald Code steht, den ein
  Konzept beschreibt: `status` auf den neuen Sachstand („Etappe 2 gebaut, 3 offen"
  statt „Entwurf"), `stand` auf das heutige Datum, und wenn der Plan durch ist,
  „abgearbeitet" hineinschreiben — dann verschwindet er von selbst aus der
  Roadmap. Der nächste Schritt in [`docs/roadmap.md`](docs/roadmap.md) gehört
  ebenfalls dazu. **Nicht ableitbar**: Zweimal versucht, den Verdacht am Git-Datum
  der Dateien aus `betrifft` zu messen, zweimal verworfen — `src/ui.ts` und
  `src/studio/editor.ts` werden von allem angefasst, die Prüfung schlug bei 7 von
  17 Konzepten falsch an. Gemeldet wird beim Bauen nur der Fall ohne Ratespiel:
  was laut Roadmap LÄUFT und dessen Kopf seit über drei Wochen unangetastet ist. `DESIGN.md` ist ausgenommen: Sein YAML-Block ist
  der Inhalt, nicht der Kopf. **Umbenannt wird über den Viewer**, nicht von Hand —
  er zieht die Verweise in `docs/` und im Handbuch nach.
  `docs/archive/` ist Historie: nicht als Implementierungsquelle nutzen (widerspricht
  oft dem Ist-Stand). Im Viewer ist das Archiv kein eigener Bereich, sondern hängt
  unter dem Bereich, aus dem ein Dokument kam.
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
  entscheidet der Server ([server/src/routes/feedback.ts](server/src/routes/feedback.ts)
  `cleanContext`) — sonst wäre das Feld ein offener Kanal und die Aufzählung in
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
