# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Was das ist

Maptale ist eine App für Relive-artige 3D-Kamerafahrten über eine GPS-Route mit
automatischen Foto-Stopps — vollständig auf freien Kartendaten. Web-Player in Vanilla JS + Vite
(neue Module in TypeScript), gerendert mit MapLibre GL JS.

**Maptale wird von einem Prototyp zu einem echten Produkt ausgebaut** (Aufnahme-Plattform,
Meilensteine M1–M9): eigene Touren aufzeichnen (Android), hochladen, serverseitig anreichern
und mit der vorhandenen Player-Engine abspielen. Das Repo ist ein **Monorepo**:

- **Root**: Web-Player (Vite). Spielt statische `TOURS` und aufgezeichnete Touren
  (`?tour=srv:<id>` → [src/remote.ts](src/remote.ts) gegen das Backend).
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
- **Öffentliche Seiten**: [galerie.html](galerie.html) (alle auf `public` gestellten Touren)
  und [profil.html](profil.html) (`?id=…`, die Reisen einer Person). Beide ohne Anmeldung,
  Logik DOM-frei in [src/galerie/galeriemodell.ts](src/galerie/galeriemodell.ts).
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
npm test                      # Web-Unit-Tests (Vitest: geo.js, remote.ts/timeAt, audiotracks.js
                              #   und die Studio-Logik — Editor, Baukasten, Upload, EXIF)
npm run typecheck             # tsc --noEmit; die CI deployt ohne grünen Typecheck nicht
cd server && npm run dev      # Backend (tsx watch, Port 8787; via PORT übersteuerbar)
cd server && npm test         # Backend-Tests (Vitest)
cd server && npm run test:coverage  # dieselben Tests mit Coverage-Gate 80 % (wie in der CI)
cd android && ./gradlew test  # Android-Unit-Tests (JAVA_HOME auf JDK 17 setzen)
```

Optik-Verifikation läuft weiterhin über den Dev-Server im Browser. Dev-Proxy: `/api` →
`http://localhost:8787` (übersteuerbar via `LUHAMBO_API`-Env, z. B. wenn 8787 belegt ist —
auf dem Server läuft die API aus demselben Grund auf Host-Port 8790).

Tour-Auswahl per Query-Param am Player: `/erlebnis.html?tour=<id aus TOURS>` (Default
`kohphangan`), aufgezeichnete Touren via `?tour=srv:<id>`. `/?tour=…` funktioniert weiterhin,
wird aber von der Landing auf `/erlebnis.html` umgeleitet. `?app=1` markiert die Android-WebView.

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
[src/main.js](src/main.js)), das **Studio** ([studio.html](studio.html) +
[src/studio/](src/studio/)) und eine schlanke **Landing** ([index.html](index.html), kein
MapLibre). Alle sind eigene Vite-Einstiege ([vite.config.js](vite.config.js)).

**Der URL-Raum steht in [src/routen.ts](src/routen.ts) — und nur dort.** Kein Router: Nginx
liefert die Seiten statisch aus, nur `/api` geht in den Container. Aus der Tabelle leiten sich
die Vite-Eingänge, alle Links (`pfad('player', '?tour=…')`), die Dev-Middleware in
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

Der Player läuft clientseitig ab einem `map.on('load')`-Callback in [src/main.js](src/main.js),
der die Module verdrahtet. Der zentrale Datenfluss:

**Route als Bogenlängen-Parameter.** [src/geo.js](src/geo.js) `buildRoute()` nimmt Wegpunkte,
glättet sie (Catmull-Rom) und resampled sie auf ~14 m Schritte. Die entstehende `route` trägt
`coords` (lng,lat,ele), kumulierte Distanzen `cum` und `total`. **Die eine Zustandsvariable, die
alles antreibt, ist `s` — die Position entlang der Route in Metern.** `pointAt(route, s)`,
`bearingAt(route, s)`, `nearestS(route, lnglat)` übersetzen zwischen `s`, Koordinaten und
Kurswinkel. Fotos und Modus-Wechsel werden über `s` verankert.

**Tour-Konfiguration als Daten.** [src/tours.js](src/tours.js) exportiert `TOURS` — pro Tour:
`segments` (jedes mit `pts` und `mode`), `photos` (mit
`anchor`-Koordinate), Intro-/Finale-Texte, optional `time` (für Tag/Nacht), `geoid` und `weather`.
`weather` ist eine kuratierte Wetter-Timeline `[{ km, mode, k }]` (km entlang der Route) und hat
Vorrang vor dem historischen Auto-Wetter — nötig, wenn das ERA5-Archiv einen Effekt nie codiert
(z.B. Gewitter über Koh Pha-ngan). main.js verkettet die Segmente
zu einer Wegpunktliste, baut die Route und verankert Fotos via `nearestS`. Nahe beieinander
liegende Fotos (< 120 m in `s`) werden zu einem **Stopp** mit mehreren `items` gruppiert.

**Kamera-Engine.** [src/tour.js](src/tour.js) `Tour` ist das Herzstück. Sie nutzt MapLibres
**FreeCamera-API** (nicht zoom-basiert), weil zoom-basierte Kameras in steilem Gelände im Hang
stecken bleiben — die Kamera hat eine explizite Flughöhe über Grund plus Blickpunkt. Jede
Kameragröße läuft durch einen `Smooth`-Filter (exponentielle Glättung mit `tau`), wodurch
Phasenwechsel automatisch zu weichen Schwenks werden. Phasen: `intro` (Orbit) → Fahrt →
Foto-Orbit → Finale. Pro Modus skalieren `MODE_SPEED`/`MODE_SCALE` Tempo und Kameradistanz;
`PRESETS` (nah/mittel/weit) sind die vom Nutzer wählbaren Einstellungsgrößen. Die Engine ruft
pro Frame `ui.updateTrace(s, pos)` und optional `ui.onTick(frac)` auf.

**Fortbewegungs-Modi** sind `walk | bike | moped | jeep | tram | ferry`. Die Liste muss an vier
Stellen deckungsgleich bleiben: `MODE_SPEED`/`MODE_SCALE` ([src/tour.js](src/tour.js)),
`MODE_ICONS` ([src/map.js](src/map.js)), `MODE_SOUND` ([src/vehicle.js](src/vehicle.js), nur
motorisierte Modi) und `MODI` ([server/src/schema/upload.ts](server/src/schema/upload.ts), von
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
[src/elevation.js](src/elevation.js) echte DEM-Höhen aus AWS Terrarium-Tiles (async fetch +
Bilinear-Sampling), glättet sie und überschreibt `coords[i][2]`; Höhenmeter und Höhenprofil
werden neu berechnet. Fähr-Abschnitte werden auf Meereshöhe geklemmt (DEM rauscht über Wasser).
Fällt der Fetch aus (offline), bleibt es beim Wegpunkt-Profil.

**Rendering-Schichten.** [src/map.js](src/map.js) baut den MapLibre-Stil: Esri-Satellit über
AWS-Terrain-DEM (`EXAGGERATION`-Konstante), Atmosphäre, Routen-Layer, Foto-Wegpunkte
(`addSpotLayers`), Fahrer-Marker (`createRider`/`setRiderIcon` mit `MODE_ICONS`).
[src/daynight.js](src/daynight.js) + [src/sun.js](src/sun.js) mappen Streckenanteil → Pseudo-Uhrzeit
→ Sonnenstand → Szenenstimmung (nur wenn `cfg.time` gesetzt ist).
**Foto-Stopps sind 3D-PINS** ([src/photopins.js](src/photopins.js), Standard;
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

**Gebäude sind ein einzelner fill-extrusion-Layer** (`buildings-3d`; MapLibre kann kein
AO/Schatten/Fenster). [src/buildings.js](src/buildings.js) sampelt beim Kachel-Laden die echte
Dachfarbe aus dem Esri-Satellitenpixel am Gebäude-Zentroid und setzt sie per `feature-state`
{color} (nachts ignoriert → dunkle Palette). **Kritisch:** In den OpenFreeMap-Kacheln fehlt
`hide_3d`, ~15 % der Polygone überlappen (Umriss + parts) und flimmern durch koplanares
Z-Fighting; clientseitig ist das geometrisch nicht sauber lösbar. Deshalb werden ALLE
Gebäudefarben (gesampelt wie Fallback-Palette) auf **konstante Luminanz** normalisiert — der
Z-Fight kippt dann nur im Farbton, kaum sichtbar. Echte Geometrie-Bereinigung + Dächer/Schatten
brauchen einen zweiten Renderer; drei Wege sind gebaut und per Query-Flag wählbar: `?deck=1`
(deck.gl-Gebäude über MapLibre, [src/deckbuildings.js](src/deckbuildings.js)), `?scene=1`
(eigenständige deck.gl-Szene, [src/deckscene.js](src/deckscene.js)) und `?roofs=1` (leichter
Three.js-Dächer-Renderer, [src/buildings3d.js](src/buildings3d.js)). Geerdete Wurf-Schatten
([src/shadows.js](src/shadows.js)) laufen im Default-Pfad mit (`?noshadows=1` schaltet sie aus).
Begründung und Vergleich: [docs/architecture/renderer-plan.md](docs/architecture/renderer-plan.md).

**UI.** [src/ui.js](src/ui.js) `UI` verwaltet Overlays, Steuerleiste, Telemetrie, Höhenprofil und
die Fortschrittsleiste. Das Scrubbing (Ziehen/Tippen auf der Timeline, inkl. Foto-Dots) wird in
main.js über Pointer-Events verdrahtet und ruft `tour.beginScrub/scrub/endScrub` bzw.
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
nennt, WAS man ihr ansieht (Satellitenbild · Gelände · Gebäude · Wetter). Zwei Punkte, die man
leicht „aufräumt": Der Inhalt wird aus den `attribution`-Feldern der Stil-Quellen gebaut — eine
neue Kachelquelle erscheint dadurch von selbst, ohne Rollen-Eintrag als „Kartendaten", aber
niemals ungenannt. Und das Element hängt am **body**, nicht im Kartencontainer: dessen `z-index`
gilt nur innerhalb des Karten-Stacking-Contexts, das Popup verschwand dort hinter der
Steuerleiste (Nebeneffekt: der Knopf bleibt im Google-3D-Modus sichtbar, wo MapLibres Canvas
ausgeblendet ist). Solange es offen steht, hält `body.info-offen` den Auto-Rückzug der UI an.

**Eine Tour beginnt am Anfang.** Der Player merkt sich Position und Wiedergabezustand
(`maptale:pos:<id>`), aber die Wiederaufnahme hängt an einem **Einmal-Ticket** im sessionStorage
(`maptale:weiter:<id>`): Nur der Renderer-/Ansicht-Umschalter legt es unmittelbar vor seinem
eigenen Reload, der nächste Start verbraucht es sofort. Vorher genügte ein 30-Minuten-Fenster im
localStorage — wer eine Tour verließ und erneut startete, landete bei Kilometer 14 statt im
Startscreen. Ohne Ticket wird der Merker nicht einmal gelesen.

**Das Fortbewegungsmittel steht NICHT in der Telemetrie.** Der Marker auf der Karte zeigt es,
der Motorloop lässt es hören — ein Wort „Unterwegs mit · Jeep 4×4" in der Steuerleiste
wiederholte das nur. Der Modus wird weiter pro Frame verfolgt (`modeKey` in `ui.stats`), denn an
seiner Kante hängen Marker-Icon und Motorsound.

**Atmosphäre und Wetter.** [src/atmosphere.js](src/atmosphere.js) (Horizont-Dunst, Wolken,
Sterne, Sonne) und [src/weather.js](src/weather.js) (Regen/Schnee/Nebel/Gewitter als
Partikel-Overlay) liegen über der Karte. Das Wetter kommt entweder aus der kuratierten
`weather`-Timeline der Tour, aus dem Tour-JSON des Servers oder — als Fallback — aus
[src/autoweather.js](src/autoweather.js) (Open-Meteo an den Foto-Ankern).
[src/audiotracks.js](src/audiotracks.js) spielt die im Studio gesetzten Musik-/SFX-Spuren.

**„Google 3D"-Modus (`?tiles3d=1`).** [src/tiles3d.js](src/tiles3d.js) rendert Google
Photorealistic 3D Tiles — den echten Fotoscan der Stadt, also „die echten Gebäude, die dort
stehen" — in einer eigenen, lazy geladenen **Three.js**-Szene via 3DTilesRendererJS (kein
Cesium). MapLibre läuft dabei **unsichtbar weiter** (die Tour-Engine braucht dessen Terrain-
Abfragen); die Kamera wird pro Frame in ECEF gespiegelt (`extCamera`, `WGS84_ELLIPSOID`).
Route/Fahrer/Tag-Nacht sind integriert. Aktivierung über einen Google-Map-Tiles-API-Key
(`VITE_GOOGLE_MAP_TILES_API_KEY` im Dev bzw. `localStorage`). Grenze: Google deckt nur ~2.500
Städte ab (nicht alpin) → für unabgedeckte Regionen bleibt der MapLibre-Boden der Fallback.
Renderer-Landschaft & Begründung: [docs/architecture/renderer-plan.md](docs/architecture/renderer-plan.md).

## Studio

Die Weboberfläche für aufgezeichnete Touren ([studio.html](studio.html), Vite-Einstieg;
Logik in [src/studio/](src/studio/)). Kein Router — Login-, App- und Editor-Ansicht liegen
gleichzeitig im DOM und werden per `hidden` umgeschaltet; der Editor wird lazy importiert,
damit MapLibre nicht ins Basis-Bundle kommt.

**Die Anmeldebühne setzt erst die Stopps, dann zieht sie den Weg.** Links neben dem
Formular (Anmelden, Registrieren, Reset, Warteliste — alle teilen sie) läuft eine reine
SVG/CSS-Szene: Zuerst **setzen** sich die drei Foto-Stopps als Pins (0,3 s versetzt), danach
zeichnet sich die Route zwischen ihnen (3,4 s), ab 4,6 s fährt ein Läufer sie alle 11 s ab —
mit HALT an jedem Stopp (`keyPoints`/`keyTimes` des `animateMotion`; die Pin-Pulse hängen im
selben 11-s-Takt an ihrer Ankunftszeit). **Auf der Linie bewegt sich sonst nichts:** Der
Lichtpunkt, der die Strecke früher VORWEG abfuhr, und das dauernde Fließen IN der Linie sind
beide gestrichen — zwei Bewegungen auf derselben Spur lesen sich als Unruhe, und die eine, auf
die es ankommt, ist der Läufer. Kein wiederholtes Neuzeichnen: eine Anmeldeseite darf nicht
blinken. Bei `prefers-reduced-motion` bleibt das fertige Standbild. Vier Regeln halten das
zusammen:

1. **Die Pin-Koordinaten kommen AUS der Kurve**, nicht umgekehrt (`getPointAtLength` bei den
   `keyPoints` 0,30 / 0,56 / 0,84). Hingestellte Pins mit geschätzten Bruchteilen ließen den
   Läufer zweistellig daneben halten. Wer die Bruchteile verschiebt, rechnet BEIDES neu: die
   Punkte im Markup und die `keyTimes` (Fahrzeit je Etappe ∝ Streckenanteil, dazu 0,09 Halt)
   samt den Puls-Verzögerungen (4,6 s + Ankunftszeit).
2. **`calcMode="spline"`, nicht `linear`** — je Fahrt-Etappe eine eigene Ease-in-out-Kurve,
   sonst schießt der Läufer bis auf den Pin und steht aus voller Fahrt.
3. **`pathLength="1"` gehört an den `<path>` in `<defs>`, nicht an das `<use>`** — dort ist es
   wirkungslos (der Schattenbaum übernimmt es nicht), und genau deshalb zeichnete sich die
   Route jahrelang gar nicht: `stroke-dasharray: 1` war auf 1517 echten Einheiten nur ein
   Punktmuster. Aufgefallen ist es erst, als der vortäuschende Lichtpunkt wegfiel. Alle
   Strichmaße rechnen seither in Anteilen der Streckenlänge.
4. Der Pfad **umrundet die Textzone** (Mindestabstand 43 Einheiten, gemessen) und bleibt vom
   unteren Rand weg — tiefster Punkt y 738 von 900. Bei y 808 stand er auf der Kante:
   `preserveAspectRatio="slice"` beschneidet an breiten Fenstern die HÖHE, dort fiel der
   Bogen ganz heraus.

Er steht einmal in `<defs>` und wird zweimal benutzt — zeichnen und abfahren. Die
Wortmarke gehört in den **zentrierten Titelblock**, nicht nach oben links: dort steht wie im
Player genau EIN Element, der Weg hinaus. Ihr Text spricht von **Maptale**, nicht vom Studio —
ein Konto braucht auch, wer nur mit der App aufzeichnet (die App verweist zum Registrieren
ausdrücklich auf die Website). Entwurf und die beiden verworfenen Varianten (Tag/Nacht-Himmel,
Feld aus Routen-Signaturen): [docs/mockups/studio-login.html](docs/mockups/studio-login.html).

**Jedes Feld sagt, ob es sein muss.** In den vier Auth-Formularen (Anmelden, Registrieren,
Passwort, Warteliste) trägt jedes Label ein Wort: „Pflicht" oder „optional". Sternchen mit
Legende darunter wären kürzer, aber man muss sie erst entschlüsseln; das Wort steht da, wo die
Frage aufkommt. **Beide** Sorten sind markiert, nicht nur die optionale — sonst muss man aus dem
Fehlen schließen, und genau dieses Schließen kostet den Moment Unsicherheit, der Formulare zäh
macht. Die Texte dieser Bereiche kommen ohne Gedankenstrich aus (zwei Sätze statt einem mit
Einschub) und ohne Sätze, die nur die Überschrift wiederholen; die Fehlermeldungen des Servers
gehören dazu, sie erscheinen in denselben Formularen. Beim ANMELDEN hängt am Passwortfeld nur
der Sichtbarkeits-Schalter, keine Stärkeanzeige (`haengePasswortfeld(el, { bewertung: false })`):
Ein bestehendes Passwort zu benoten ändert nichts mehr.

**Die Bibliothek ist die Bühne.** Kacheln mit Titelbild statt Zeilen; über dem Bild liegt die
**Routen-Signatur** — die Form DIESER Tour. Fotos sehen einander ähnlich, Routen nicht.
Sie entsteht beim Anreichern ([server/src/pipeline/signatur.ts](server/src/pipeline/signatur.ts))
und liegt als `stats.spur` neben `stats.fotos` in der Tour-Liste; ältere Touren haben beides
erst nach dem nächsten Rendern, die Kachel muss ohne auskommen. Die ganze Kachel spielt ab —
die Taste in der Mitte ist die Ansage dafür, nicht das einzige Ziel; daneben genau zwei Griffe
(Bearbeiten, Sichtbarkeit, letztere zugleich Anzeige UND Umschalter).

**Neue Tour: erst zeigen, dann hochladen.** Der Upload ist kein Formular mehr, sondern ein
Fenster, das den **Befund** der abgelegten Dateien zeigt ([src/studio/pruefung.ts](src/studio/pruefung.ts),
DOM-frei und getestet): Streckenform, Zeitspanne, jede Aufnahme an ihrer Uhrzeit — und was
auffiel (ohne Ortsangabe, ohne Zeitstempel, außerhalb der Aufzeichnung). Nur wo es etwas zu
entscheiden gibt, steht ein Knopf („Weglassen").

**Das Fenster ist erst ein Dialog und wird dann eine Arbeitsfläche.** Im Leerzustand trägt es NUR
die Einladung: keine Fußzeile (`.neu-fenster.klein`), also weder „Aufnahmen hinzufügen" (heißt
NACHLEGEN — „Dateien wählen" mitten im Fenster sagt dasselbe größer) noch Sichtbarkeit (entscheidet
über eine Tour, die es noch nicht gibt) noch „Tour bauen" (der Weg dorthin führt ohnehin über den
Befund), und kein gestrichelter Kasten im Kasten — die ganze Fläche IST die Ablage. Mit den ersten
Dateien wächst das Fenster in einem Zug von 560×452 auf 1080×780 (`transition` auf `width`/`height`,
gesteuert von `setzeFenstergroesse`), und der Befund steigt dabei EINMAL mit auf (`.neu-rumpf.wachst`,
Klasse räumt sich beim nächsten Render selbst weg — sonst zuckte die Fläche unter jedem
„Weglassen"). Dazwischen liegt der Zustand „Liest die Aufnahmen" mit füllendem Ring: das Lesen der
EXIF-Blöcke dauert bei dreißig Fotos merkbar, und ohne ihn stand die Einladung still und sprang
dann ohne Ansage. Weil es im Leerzustand keine Fußzeile gibt, trägt `zeigeLeerHinweis` die
Statuszeile („3 Dateien ignoriert") in die Einladung — sonst wäre sie unsichtbar. Der Vorgabewert
der Sichtbarkeit bleibt „Privat", auch solange das Feld aus ist.
**Ohne GPX** werden die Foto-Orte zur Strecke:
das Manifest trägt dann `segments` statt `trackFile` (`baueFotoSegmente`) — deshalb überspringt
[tours.ts](server/src/routes/tours.ts) `ladeOriginalSegmente` für solche Touren die
Gehabschnitts-Automatik: zwischen zwei Fotos liegt eine Luftlinie, jedes daraus gerechnete
Tempo wäre Zufall. Die eigene Inszenierung dafür (gestrichelte Bodenlinie, fliegende statt
fahrende Kamera) steht noch aus: [docs/concepts/foto-tour.md](docs/concepts/foto-tour.md).

**Rohdaten + Overlay, nie destruktiv.** Der Editor verändert die hochgeladenen Daten nicht,
sondern schreibt ein **Edit-Overlay** (`maptale/edits@1`, [server/src/schema/edits.ts](server/src/schema/edits.ts)):
`medien` (Caption, Anker, gelöscht, Anzeigeoptionen, Video-Schnitt), `modi`, `kamera`, `audio`,
`wetter`, `titelbild` (dazu das TOUR-`trim` — im Format erhalten und serverseitig angewandt,
aber **nicht mehr bedienbar**: die Griffe an den Leistenrändern sind entfallen, eine Tour
beginnt und endet, wo sie aufgezeichnet wurde; nicht zu verwechseln mit `medien[].trim`, dem
Video-Schnitt aus Etappe 4).
Beim Speichern rendert der Server die Tour aus Rohdaten + Overlay neu. Edits referenzieren
**stabile Anker** — Medien-IDs, Koordinaten, absolute ISO-Zeitstempel, nie den Streckenanteil `f`.
**Die Schema-ID bleibt `maptale/edits@1`, auch wenn Felder dazukommen:** Erweiterungen sind
strikt additiv, alle neuen Felder optional, ihre Vorgaben bilden das bisherige Verhalten ab.
Bewacht wird das von einem **Vertragstest**
([server/test/vertrag-tourjson.test.ts](server/test/vertrag-tourjson.test.ts)), der das
gerenderte `tour.json` für elf echte Overlay-Formen als Schnappschuss festhält — samt einer
Probe, dass die Fälle sich überhaupt UNTERSCHEIDEN (ohne sie könnten elf identische Ergebnisse
grün sein und der Vertrag bewachte nichts).
`wetter` (Grenzen `[{ab, mode, staerke?}]` wie `modi`/`kamera`) ist ein Sonderfall: sobald
gesetzt, **ersetzt** es das Auto-Wetter (Open-Meteo + Foto-Verfeinerung) der ganzen Tour
vollständig — bewusste Korrektur, wenn das automatische Wetter danebenlag. `wetterAusOverlay`
([server/src/pipeline/weather.ts](server/src/pipeline/weather.ts)) baut daraus eine
Stufenfunktion; Marken-PAARE auf demselben `f` legen die Umschaltung (Player: Mitte zweier
Marken) exakt auf die Grenze. Rein render-seitig → der Anreicherungs-Cache bleibt gültig
(ein Wetter-Edit löst keine externen Aufrufe aus).

**Die Wetterspur zeigt das echte Wetter, nicht das Wort „automatisch".** Weil das Overlay das
Auto-Wetter vollständig ersetzt, hätte die erste eigene Grenze früher den Rest der Tour
schlagartig klar gemacht. Deshalb liefert `/api/tours/:id/editor` das **ermittelte** Wetter als
Zeitgrenzen mit (`autoWetter`): `wetterZuGrenzen` ist die Umkehrung von `wetterAusOverlay` —
Keyframes → Grenzen, die Bandkante auf die MITTE zweier Marken (dort schaltet `weatherAt` im
Player), `f` → Zeit über `zeitZurPosition`. Quelle ist das gerenderte `tour.json` (enthält die
Foto-Verfeinerung), ersatzweise `wetterRoh` aus dem Anreicherungs-Cache; rein lesend, keine
externen Aufrufe. Der Editor zeigt diese Grenzen als normale Bänder und schreibt sie beim
ERSTEN Eingriff ins Overlay (`schreibeWetterFest`) — genau das Muster von `materialisiereModi`
bei der Fortbewegung. Die Kamera-Spur bleibt dagegen ohne Vorgabe: ihr Grundband heißt
**„Standard"**, weil dort gilt, was der Zuschauer im Player einstellt (Nah/Mittel/Weit).

**Eine neue Tour bekommt Musik, aber nur einmal.** Beim ERSTEN Verarbeiten (`finalize`, erkannt
am Status VOR dem Claim → `erstmals` in `verarbeite`) wählt
[musikwahl.ts](server/src/pipeline/musikwahl.ts) aus Uhrzeit, Wetter, Höhen, Fortbewegung und
Breitengrad ein Stück der Bibliothek und schreibt es ins **Overlay** — nicht direkt ins
Tour-JSON, denn dort wäre es im Studio unsichtbar und unabänderlich. Reihenfolge der Regeln
(erste gewinnt): Nacht → Nachtfahrt, nasses Drittel → Regentag, Höhenmeter/Höhe → Bergpass,
Fähre → Küstenstraße, Wendekreise → Tropen, Abendankunft → Goldene Stunde, ≥ 60 km → Fernweh,
sonst Aufbruch. **Nur beim ersten Mal**: `reprocess` rendert ebenfalls `frisch`, rührt das
Overlay aber nicht an — wer die Musik entfernt, bekommt sie nicht zurück, und eine selbst
gesetzte Spur wird nie überschrieben (beides als Vertrag getestet). Der Server kann
`sfxbibliothek.ts` nicht importieren (eigener `rootDir`) und führt die Dateinamen ein zweites
Mal; ein Drift-Wächter prüft, dass jede davon im Katalog steht und Musik ist.

**Die Audio-Bibliothek „Musik & Effekte" ist benutzerweit.** Eigene Dateien landen NICHT
mehr tour-lokal, sondern in der Bibliothek des Kontos (`<userId>/audio/` im benutzerStorage,
[server/src/routes/bibliothek.ts](server/src/routes/bibliothek.ts)): einmal hochgeladen, in
jeder Tour einsetzbar (`quelle: 'benutzer'` im Overlay), zur Quota zählend, löschbar nur
solange KEINE Tour sie referenziert (edits.json ODER gerendertes tour.json). Ausgeliefert
wird über die Tour (`/api/tours/:id/bibliothek-audio/:datei`, Sichtbarkeit + Referenz-Check
— sonst wäre die Route ein Orakel über fremde Bibliotheken); das Studio hört über die
Owner-Route `/api/audio-bibliothek/:datei` vor. Tour-lokale `media/`-Audios bleiben als
Altbestand unterstützt (Verweis ohne `quelle`). Im Studio ist die Bibliothek ein **Katalog
zum Durchhören** in einem Dialog mit FESTEM Format (springt beim Filtern nicht): Suche über
die GANZE Bibliothek (Reiter treten zurück), Reiter nach Art (Musik · Atmosphäre · Effekte ·
Eigene, bewusst kein „Alle"), dichte Zeilen; die Kategorie bestimmt beim Einsetzen die
ROLLE (Musik/Atmosphäre → Filmmusik, Effekte → Ton der Szene) und mit ihr die Loop-Vorgabe.
Was läuft,
zeigt eine mitlaufende Linie plus Zeit aus `currentTime`/`duration`; der Fortschritt wird IN
die Zeile geschrieben, nie durch Neubau der Liste. Der Dialog kennt zwei Ziele: EINSETZEN
(neuer Eintrag ab der Marke) und ERSETZEN („Ändern …" in der Stück-Karte des Panels —
tauscht nur die Datei, Platzierung und Lautstärke bleiben; das aktuelle Stück trägt ein
„Aktuell"-Badge). Beim Aussuchen klingt immer nur EINE Quelle (Bibliotheks- und
Panel-Vorhören stoppen einander; das Panel-Vorhören folgt der Eintrags-Lautstärke live am
Regler). ÜBERLAPPENDE Klips sind erlaubt und MISCHEN sich — im Player (je Spur ein
Element, audiotracks.js) wie im Studio-Abspielen (je Klip ein Element, abspielen.ts); die
Zeitleiste stapelt sie in Unterzeilen (`lane` aus `loeseTonKlips`), die Bahn wächst mit.

**Ein Ton-Klip hängt an der REISE, nicht an einer Filmsekunde** (Etappe 4, rechnende Teile
DOM-frei in [src/studio/tonklip.ts](src/studio/tonklip.ts)). Er merkt sich `anker`
(Aufnahmezeit — wo auf der Reise), `versatzFilmS` (die Feinlage in FILMsekunden, darf mitten
in einer Standzeit liegen — was reine Aufnahmezeit nicht ausdrücken kann), `dauerFilmS`,
`einstiegS` (Einstieg in die Datei) und `loop`. Dadurch rückt Ton mit, wenn Standzeiten oder
die Fortbewegung sich ändern — vorher war er das einzige Element, das liegen blieb (gemessen:
Standzeit +24,5 s → der Klip dahinter +116,0 px, der davor exakt 0 px). Alle Felder sind
optional und `ab`/`bis` bleiben als Fallback lesbar; **aufgewertet wird nur der Klip, den man
ANFASST** — anders als bei `materialisiereModi`, wo die ganze Stufenfunktion auf einmal fest
werden MUSS, sind Ton-Klips unabhängige Objekte. **Zwei Trimm-Regeln gehen leicht verloren:**
Der Anschlag ist an BEIDEN Kanten das MATERIAL (Trimmen legt frei, was da ist, und erfindet
nichts; Stille gehört ZWISCHEN die Klips, nie in einen), und **Loop hebt nur den RECHTEN
Anschlag auf** — `el.loop` springt am Dateiende auf den DATEIANFANG, eine Wiederholung davor
gibt es nicht. Die linke Kante bewegt Anfang UND Einstieg gemeinsam (FCPX): der Inhalt bleibt
an seinem Platz im Film, vorne fällt etwas weg. Am Anschlag sagt das Etikett „kein Material
mehr" — eine Kante, die kommentarlos stehen bleibt, liest sich als hakender Griff.
Loop ist eine **Einstellung im Inspector**, auf dem Klip nur das ⟲-Zeichen: als Schalter dort
wäre sie eine Ausnahme, die Lautstärke und Dateiwechsel nicht auch bekommen könnten. **Loop
AUSschalten holt den Klip ans Material zurück** (`setzeLoop`) — sonst hinge hinter der
Wellenform ein stummer Rest, und man müsste ihn von Hand zurechtziehen, um überhaupt zu sehen,
wo sein Material endet.

**Ein EINGESETZTES Stück klingt einmal, so lang wie es ist** (`setzeTonEin`): kein Loop, Länge
= Dateilänge. Beides gehört zusammen — „nicht wiederholen" allein ließe einen Musik-Klip
entstehen, der bis zum Tour-Ende reicht und nur seine Dateilänge klingt, also genau den stummen
Rest, den `setzeLoop` behebt. Ein EFFEKT braucht dafür kein einziges Feld (er wiederholt von
Haus aus nicht und ist ohnehin so lang wie seine Datei); geschrieben wird nur, was von der
Vorgabe der Rolle abweicht. Gemessen wird VOR dem Einfügen — so entsteht genau EIN
Overlay-Stand (ein Undo-Schritt) und der Klip steht sofort in seiner endgültigen Form da,
statt nach dem Erscheinen zu zucken. Ohne messbare Länge bleibt es bei der Vorgabe: `loop:
false` ohne bekanntes Ende erzeugte wieder den stummen Rest. **Die Auto-Musikwahl des Servers
([musikwahl.ts](server/src/pipeline/musikwahl.ts)) ist davon nicht betroffen** — sie schlägt
ein Stück vor, das die GANZE Tour tragen soll, und schreibt weiter nur `datei`/`typ`/`ab`.

**`musik` vs. `sfx` beschreibt seit Etappe 4 die ROLLE, nicht die Form.** Beide sind Klips mit
Länge, beide können wiederholen, beide mischen sich — die Beschriftung „Musik (über eine
Strecke) / Effekt (ein Zeitpunkt)" war eine Aussage über eine Form, die es nicht mehr gibt.
Was der Unterschied noch bewirkt, sind genau zwei Dinge im Player, und beide fragen dasselbe
(„Score oder Ort?"): Der Zuschauer-Schalter **„Musik"** nimmt `type: 'music'` weg und lässt
den Ton der Szene stehen (`main.js`, `setMusikEnabled`/`setSfxEnabled`), und unter dem eigenen
Ton eines Videos **duckt** nur die Musik. Deshalb heißt das Feld in der Oberfläche „Rolle"
(Filmmusik · Ton der Szene). Beim Umschalten kippen zwei Dinge leicht still: `bis` fiel früher
ersatzlos weg (die Länge geht jetzt vorher nach `dauerFilmS`), und die Loop-VORGABE hängt an
der Rolle — `loopNachRollenwechsel` schreibt den bisherigen Wert fest, wo die neue Vorgabe ihn
umdrehen würde.

**Die Zeitfelder des Ton-Inspectors gehen über die FILM-Achse**, nicht über `ab`/`bis`. Nach
der Aufwertung haben die keinen Vorrang mehr: Ein Feld, das dorthin schriebe, wäre ab dem
ersten Kantenzug still wirkungslos, und ein Feld, das von dort läse, zeigte eine Zeit, die im
Film nichts mehr bedeutet (an der Probetour 08:37 statt 08:32). Deshalb bekommt
`loeseFokusAuf` die Ton-Spanne als Rückruf herein (das Modul kennt die Achse nicht) und
`audioZeitSetzen` ruft dieselben `verschiebeTon`/`trimmeRechts` wie der Zug an der Kante —
samt Materialanschlag.

**Ein Effekt war nie eine Marke — die LEISTE hat ihn nur so gezeichnet.** Der Player spielt
einen One-Shot bis zum Dateiende aus; als Punkt gezeichnet verschwieg die Zeitleiste bloß, wie
lange er klingt. Er ist deshalb derselbe Klip wie Musik, nur in seiner Farbe. Die Dateilängen
stehen NIRGENDS im Datenmodell (der Katalog führt Namen und Charakter, keine Sekunden) — der
Editor misst sie clientseitig per `loadedmetadata` (`preload='metadata'`, höchstens ein
Versuch je Datei). Bis ein Wert da ist, bleibt der Klip ein Pin und die Kante ohne Anschlag:
lieber ziehen lassen als grundlos klemmen. Die **Wellenform** gehört ebenfalls zur DATEI, nicht
zum Klip: voller Datei-Streifen dahinter, um den Einstieg nach links geschoben, Wiederholung
nur bei Loop — beim Trimmen wandert dadurch der AUSSCHNITT und man sieht, was wegfällt
(gestaucht sähe jeder Trim wie ein Tempowechsel aus). Gezeichnet wird sie aus ECHTEN
Ausschlägen (`decodeAudioData`, Spitze je Balken statt Mittel), nicht aus einem Muster: eine
erfundene Wellenform sähe aus wie eine Aussage über den Inhalt und wäre keine. Ihr Fenster
braucht ein eigenes `overflow: hidden` — am Klip selbst schnitte es die überstehenden
Kanten-Griffe weg und Anfang/Ende wären nicht mehr zu greifen.

**Ausgeliefert werden ABGELEITETE Fassungen, nicht das Hochgeladene**
([bild.ts](server/src/pipeline/bild.ts)). Aus jedem Foto entstehen beim Rendern zwei Dateien —
`m1.w1920.jpg` (Anzeige, längste Kante 1920) und `m1.t480.jpg` (Kachel für Listen, Zeitleiste,
Pin-Köpfe) —, danach wird das **Original verworfen**; bei Video ebenso, sobald `m1.web.mp4`
steht. An einer echten Tour: 26,5 MB Originale → 3,1 MB Fassungen, ohne sichtbaren Unterschied
in der Wiedergabe. Vier Dinge, die man dabei leicht zerstört:
*Die Reihenfolge* — erst schreiben, dann löschen; wer die Quelle vorher wegnimmt, verliert bei
einem Abbruch beides. *Der Wiedereintritt* — jeder Re-Render läuft ohne Original, `bereiteFotosAuf`
und `bereiteVideosAuf` müssen die vorhandene Fassung als Quelle nehmen statt zu scheitern. *Der
Vollständigkeits-Check* im finalize ([tours.ts](server/src/routes/tours.ts)) zählt Original ODER
Fassung, sonst meldet jeder App-Retry „Medien fehlen". Und *das EXIF*: ffmpeg wirft es beim
Skalieren weg, der Studio-Editor liest die Aufnahme-Details aber aus der ausgelieferten Datei —
deshalb wird der Exif-APP1-Block von Hand übertragen und seine Drehung dabei auf 1 gesetzt (die
steckt jetzt in den Pixeln; bliebe die Angabe stehen, drehte der Browser ein zweites Mal). Die
Kachel bekommt bewusst kein EXIF: der Block eines Testfotos war 42 KB, mehr als das Bild selbst.
Bestandstouren stellt ein Start-Durchlauf um ([bildnachtrag.ts](server/src/pipeline/bildnachtrag.ts),
ohne Re-Render, also ohne neue Wetter-/Vision-Aufrufe). **`thumb` kann fehlen** — jede Anzeige
braucht den Rückfall auf `src`. Die App verkleinert schon vor dem Upload auf 2560 px
([Fotoaufbereitung.kt](android/app/src/main/java/app/maptale/kamera/Fotoaufbereitung.kt)) — bewusst
größer als die Anzeige-Fassung, denn der Server rechnet aus DIESER Datei.

**Vier Feinheiten der Pipeline, die man leicht „repariert":**

1. **Der Nutzertext eines Fotos wird die ÜBERSCHRIFT**, nicht die Unterzeile: `edits.caption`
   (Oberfläche: „Titel") landet im Tour-JSON als `title`, die Uhrzeit rutscht als „Foto ·
   14:32" darunter ([enrich.ts](server/src/pipeline/enrich.ts)). Ohne Beschriftung bleibt es
   umgekehrt. Der Feldname `caption` ist historisch — wer den Text „zurück an seinen Platz"
   schiebt, macht die Überschrift wieder zur Maschinenangabe.
2. **Gehabschnitte trennt der Server selbst** ([tempo.ts](server/src/pipeline/tempo.ts)):
   Rolling-Median über ±30 s, Hysterese 5,5/8 km/h, Mindestdauern gegen Ampel-Fehlalarme. Sie
   läuft in `ladeOriginalSegmente` — der einen Stelle, die sich Editor und Render teilen;
   nur beim Rendern angewandt, zeigte der Editor eine andere Aufteilung als das Video.
   `edits.modi` wird darübergelegt und behält Vorrang; mehrere Segmente im Manifest bleiben
   unangetastet (jemand hat dann selbst umgeschaltet). **Sie gilt für echte Aufzeichnungen,
   nicht für gesetzte Wegpunkte** — zwischen zwei Foto-Orten liegt eine Luftlinie, jedes
   daraus gerechnete Tempo wäre Zufall. Die Unterscheidung trifft `istAufzeichnung` an der
   FORM der Daten (dichtes Zeitraster; die App legt spätestens alle 30 s einen Punkt ab), denn
   ein Manifest-Feld dafür gibt es nicht und Bestandstouren hätten es ohnehin nicht. Sie hing
   lange stattdessen an `trackFile` — das aber nur der GPX-Import setzt, während die App ihren
   Track als eingebettete `segments` schickt: Bei JEDER App-Aufnahme lief dadurch gar keine
   Erkennung, und weil „Automatisch" in der App als `walk` übertragen wird, blieb eine
   Straßenbahnfahrt mit Fußwegen ein einziges „zu Fuß" über die ganze Tour.

   **Welches Fahrzeug es war, entscheidet die Trasse, nicht das Tempo**
   ([schienen.ts](server/src/pipeline/schienen.ts)): Moped, Jeep und Tram sind am Tempo nicht
   auseinanderzuhalten, die Automatik hebt eine Aufnahme ohne Angabe deshalb höchstens auf
   „Rad". Wer über ≥ 1,5 km zu ≥ 75 % im 30-m-Korridor um `railway=tram/light_rail` bleibt,
   saß in der Straßenbahn — abgefragt per Overpass (OSM). Drei Schutzregeln: Das läuft nur bei
   `frisch` (finalize/„Neu verarbeiten", also nie bei einem Edit-Speichern), nur wenn die
   Fortbewegung überhaupt GERATEN wurde (`trackMode` leer und alles `walk`), und nur solange
   `edits.modi` leer ist — eine im Studio gezogene Kante wird nie überstimmt. Das Ergebnis geht
   als Modus-Grenzen ins **Overlay**, nicht ins Tour-JSON: dort ist es sichtbar und
   korrigierbar (dasselbe Muster wie die Auto-Musikwahl). Fällt OSM aus, bleibt es bei „Rad" —
   eine Anreicherung, kein Muss.

   Erkennt die **App** die Fortbewegung selbst (Activity Recognition, s.
   [android/CLAUDE.md](android/CLAUDE.md)), schickt sie fertige Abschnitte und setzt
   `modiAutomatisch` im Manifest. Nur dieses Feld unterscheidet „erkannt" von „angegeben" —
   `walk` heißt in der App beides. Ein Fahrzeug schickt sie als `jeep`; welches es war, klärt
   auch dort erst der Schienenabgleich.
3. **Eine Pause wird GERAFFT, nicht herausgekürzt** ([zeit.ts](server/src/pipeline/zeit.ts),
   `raffePausen`): Überall gilt die echte Aufnahmezeit, nur um die Pause herum liegt ein
   schmales Streckenfenster, in dem die Zeit im Schnelldurchlauf vergeht — der Himmel dreht
   dort sichtbar von Dämmerung auf Nacht. Bis Juli 2026 wurde die Pause stattdessen auf zwei
   Minuten gestaucht; das nahm den Ruck, ließ aber ALLES Folgende um die Restdauer
   zurückhängen. An einer echten Tour endete die Telemetrie deshalb um 20:51, während die
   Fotos derselben Minuten schon „22:48" untertitelt waren. Das Fenster wird in FILMsekunden
   bemessen ([filmtempo.ts](server/src/pipeline/filmtempo.ts) — der Server kennt seit dem
   die Tempo-Tabelle der Engine, mit Drift-Wächter), nicht in Metern: 200 m sind zu Fuß vier
   Sekunden und auf der Fähre eine halbe. Und es wächst mit der Pausendauer, sonst zuckte
   das Licht bei zwei Stunden genauso schnell wie bei zwanzig Minuten. Der Player braucht
   dafür nichts: `createTimeAt` interpoliert linear in `f`, eine steile Stützstellen-Flanke
   IST der Zeitraffer — und weil der Sonnenstand pro Frame aus der Pseudo-Zeit gerechnet
   wird, ist er auch beim Scrubben deterministisch.
4. **Ein Video wird neu geschrieben, sobald sein Index hinten liegt**
   ([video.ts](server/src/pipeline/video.ts)): Android schreibt jede Aufnahme über den
   MediaMuxer, und der setzt das `moov`-Atom ans Dateiende — bei 26 MB also 26 MB hinter den
   Anfang. Wer so etwas streamt, sieht erst einmal gar nichts: Der Player liest den Kopf,
   findet keinen Index, springt ans Dateiende, holt ihn dort und beginnt erst dann zu laden.
   Auf dem Pixel waren das ~5 s pro Video, in denen die Fläche schwarz blieb. `+faststart`
   setzte lange nur der Transcode — und eine H.264/AAC-`.mp4` vom Telefon ist web-tauglich,
   wurde also unangetastet durchgereicht. Jetzt prüft `hatFaststart` die Atom-Reihenfolge und
   lässt sonst `remuxeFaststart` laufen: `-c copy`, nur der Container neu, 0,2 s für 26 MB,
   kein Qualitätsverlust. Heraus kommt dieselbe `m1.web.mp4` wie beim Transcode — aus einem
   anderen Grund. **Bestandstouren brauchen einmal „Neu verarbeiten"**, sonst bleibt es beim
   alten Auslieferungspfad.

**Arbeitsteilung im Code.** [src/studio/editmodell.ts](src/studio/editmodell.ts) (Overlay
immutabel fortschreiben, Track-Projektion), [src/studio/zeitleiste.ts](src/studio/zeitleiste.ts)
(Skalen, Bänder, Marken, Dauerschätzung), [src/studio/stopps.ts](src/studio/stopps.ts)
(Halt-Gruppierung) und [src/studio/tonklip.ts](src/studio/tonklip.ts) (Ton-Klips auf der
Filmachse: auflösen, verschieben, trimmen) sind **DOM-frei und unter Vitest getestet**;
[src/studio/editor.ts](src/studio/editor.ts) enthält nur DOM- und MapLibre-Verdrahtung.
Neue Editor-Logik gehört in diese Module, sonst ist sie nicht testbar.

**Im Studio gibt es kein Mono.** Zeiten, Kilometer, Zähler und Skalenmarken laufen in Outfit mit
`font-variant-numeric: tabular-nums` (DESIGN.md). Die Variable `--font-mono` ist **entfernt** —
wer sie aus Gewohnheit wieder schreibt, bekommt keinen Fehler, sondern still die geerbte
Schrift; und der IBM-Plex-Mono-Webfont wird von [studio.html](studio.html) nicht mehr geladen.
Versalien sind nur da richtig, wo sie die Sache selbst sind (Initialen im Profil-Chip,
Datei-Endung „MP3") — nicht als gesperrtes Etikett über einer Zeile.

**Zeitleiste: eine Bahn je Ereignistyp** (Fortbewegung, Kamera, Wetter, Momente, Musik & Effekte, Fotos) auf
gemeinsamer Zeitachse. Zustände sind **lückenlose, beschriftete Bänder** — Anfang und Ende
eines Zustands sind dieselbe Kante, gezogen wird die Kante selbst. Der Abspielkopf liegt als
Overlay über allen Bahnen (absolut positioniert, **nicht** als Grid-Item: ein Item mit
`grid-row: 1/-1` belegt die ganze Spalte und drängt die Bahnen weg).

**Fortbewegung · Kamera · Wetter sind drei GLEICHRANGIGE schmale Bahnen** (19 px, Etappe 3
des [Zeitleisten-Umbaus](docs/concepts/zeitleiste-umbau.md)). Sie beschreiben, wie das
Dazwischen aussieht — bei einer typischen Tour zwei bis drei Entscheidungen, die vorher drei
randvolle Bahnen belegten und mit den Szenen um Fläche konkurrierten: Material verdient Fläche,
Kontext verdient eine Zeile. Verworfen (mit Nutzer-Feedback): sie unter „Reise"
zusammenzuklappen, Kamera/Wetter als Unterspuren zu führen, Wechsel-Marken statt Bändern und
eine blass/kräftig-Unterscheidung Automatik vs. Entscheidung. **Ein Band ist KEIN Klip:** keine
Rundung, kein eigener Rahmen, keine Rille in der Bahn — ein durchgehender Streifen, der an den
Grenzen die Farbe wechselt (Klips haben Lücken dazwischen, ein Zustand hat kein „dazwischen").
Der Griff ist EIN Riegel auf der Fuge (3 px, dunkler Ring, hover/Zug orange) und **immer
sichtbar** — als Haarstrich fand man ihn erst beim Darüberfahren; zwei Backen oben und unten
lasen sich auf 19 px als Bildfehler.

**Im Zug wird die Leiste fortwährend in den ZIELZUSTAND gesetzt.** Jeder Zieh-Frame schreibt
die Grenze und baut die Leiste neu auf: Klips, Bänder und Marken rücken mit, die Filmdauer in
der Kopf-Uhr wächst mit. Das ist nicht Kosmetik, sondern die Bedingung dafür, dass Zielen und
Landen im selben Bild stattfinden. Zeigte die Leiste während des Zugs die ALTE Anordnung, konnte
eine Rast-Vorschau nur eines von beidem sein — den Halt, auf den man zeigt, oder die Stelle, an
der die Kante landet (sie liegen bis zu 159 px auseinander). Beide Fassungen wurden gebaut und
beide waren falsch. Möglich ist der Live-Aufbau erst durch die EXAKTE Umrechnung (s. u.): Die
Kante steht nach jedem Neuaufbau wieder unter dem Zeiger (gemessen 0,1 px); mit der Achse des
Vorframes sprang sie um 116 px, und genau deshalb war der Zug zwischenzeitlich entkoppelt.
Gemessen kostet ein Zieh-Frame 5,5 ms im Median (335 Trackpunkte, 12 Klips) bzw. 4,0 ms
(541 Punkte ohne Medien) — der Editor-Track ist serverseitig auf 5 m vereinfacht
([tours.ts](server/src/routes/tours.ts)), aus 9 000 Rohpunkten werden 541.
Ein Undo-Schritt bleibt es: `renderNachZug` schreibt `letzterStand` nicht fort.

**Die Ziellinie ist eine Orientierung durch alle Bahnen** — den ganzen Zug über sichtbar, weil
man beim Setzen einer Grenze wissen will, was dort zeitlich übereinanderliegt. Beim Einrasten
tritt sie hervor (lila) und das Etikett nennt den Grund; sonst bleibt sie ein Haarstrich, der
den orangen Riegel nicht überdeckt. Das Etikett steht immer und trägt Filmzeit, Uhrzeit und bei
der Fortbewegung die Folge für die Filmlänge („Film 4:53 → 5:05").
**Eingerastet wird über ±0,5 s AUFNAHMEzeit**, nicht über Filmsekunden — 0,01 Filmsekunden
schmolzen auf dem Rückweg durch die Achse auf ein halbes Tausendstel und verloren gegen die
lower_bound-Konvention (bis 71 px daneben); „dahinter" braucht dabei einen Zeitstempel STRIKT
nach der Haltzeit, und weil Overlay-Anker sekundengenau sind, ist das eine ganze Sekunde. In
einem Halt ist das Rasten keine Bequemlichkeit, sondern die einzige Art, eine Position zu
benennen: Dort gibt es keine Aufnahmezeit, die Rückrechnung fiele auf die linke Flanke.
**Geklemmt wird in PIXELN** (14 px Mindestbreite), nicht in Sekunden: mit ±1 s konnten zwei
Grenzen so nah zusammenrücken, dass das Band dazwischen unsichtbar und unanfassbar wurde.

**Die Fortbewegungs-Grenze liegt auf der Achse, die sie selbst verändert** — im Tempo je Modus
steckt die Filmzeit. Gelöst wird das ANALYTISCH, nicht per Bisektion: Die Filmposition der
Kante hängt nur von dem ab, was VOR ihr liegt (bis zur vorigen Grenze ändert sich nichts,
dazwischen gilt das Tempo des linken Bands — egal wohin man zieht). Also ist die Abbildung eine
feste, stückweise lineare, monotone Funktion, die `baueGrenzKurve` EINMAL beim Zug-Start
aufbaut. Die im Konzept vorgesehene Bisektion (14 Achsenbauten je Frame) wurde vorher gemessen
und verworfen: 0,62 ms bei 335 Trackpunkten, aber **12,5 ms bei 10 000** — über dem 8-ms-Budget;
die Kurve kostet dort 0,2 ms einmal. Dieselbe Rechnung trägt die Filmdauer-Vorschau
(`filmDauerBeiGrenze`): es wechselt nur die Strecke zwischen alter und neuer Lage den Modus.

**Die Kante ist ein Griff, kein eigenes Objekt.** Sie liegt (9 px) ÜBER dem Band und ist dessen
Geschwister, kein Vorfahr — `closest('[data-fokus]')` findet von dort aus nichts, und ein Klick
auf die Kante wählte deshalb gar nichts aus (der Cursor sprang auf „Rand ziehen", und nichts
geschah). `bandUnterZeiger` sucht das Band per `elementsFromPoint`; ziehen verschiebt die
Grenze, bloßes Antippen wählt das Band darunter.

**Während eines Zugs wird NICHTS neu gebaut.** Der Foto-Zug rief pro `pointermove` einen
kompletten Neuaufbau der Leiste (~46 DOM-Änderungen, ein erzwungenes Layout in
`kuerzeBeschriftungen`, frische `img`-Elemente): das Bild zuckte unter dem Finger, die Karte
blieb stehen. Jetzt bewegt der Zug nur die Miniatur und den Kartenpunkt; das Overlay wird beim
Loslassen einmal geschrieben (= genau ein Undo-Schritt). Analog schreibt `zeichneMarker` die
Kartenpunkte **fort** statt sie abzureißen (geschlüsselt nach der Zusammensetzung des Halts) —
sonst wurden bei jedem Klick alle Fotos kurz zu leeren Kreisen.

**Die Achse zeigt FILMZEIT, die Anker bleiben Aufnahmezeit.** Position auf der Leiste ∝
Filmzeit (`baueAchse` in [zeitleiste.ts](src/studio/zeitleiste.ts)): gleich breit heißt gleich
lang im fertigen Film — eine Fähre schrumpft auf ihren Filmanteil, ein Foto-Halt bekommt seine
Standzeit als Achsenbreite (Sprung: Zeit steht, Film läuft; bei foto-lastigen Kurztouren IST
der Film überwiegend Standzeit), eine reale Pause fällt fast auf einen Strich zusammen
(Plateau; die GPS-Drift kollabiert zusätzlich serverseitig, s. o.). Das Maßband zählt
Filmminuten („0:30", `baueFilmMassband`, film-linear ⇒ äquidistant); die Kopf-Uhr zeigt
„Filmzeit / Gesamt" prominent, Uhrzeit und km als Nebengrößen. ALLE Overlay-Anker bleiben
absolute Aufnahme-Zeitstempel — nur die Abbildung Zeit ↔ Leistenposition
(`offsetZuAnteil`/`anteilZuOffset` über `Achse`) ist nichtlinear; ohne Kurve (degenerierte
Tour) fällt sie auf linear zurück. Das Abspielen läuft über `baueSpielKurve` (Identität; bei
Alt-Trim Plateaus) und zeigt Aufnahmen als Überfahr-MARKEN im Halt-Sprung (`zeigen`, kein
restS mehr). Eine Kante bleibt: Ereignisse, die ganz in einer Ex-Pause liegen, drängen auf
einen Pixel (Ausweg: Zeitfelder im Inspector).

**Der Abspielkopf steht in FILMsekunden** (`kopfFilmS`, Etappe 1 des
[Zeitleisten-Umbaus](docs/concepts/zeitleiste-umbau.md)) — eine Quelle für Scrubben, Klick,
Pfeiltasten und Abspielen; die Aufnahmezeit (`z.auswahl`, zugleich Einfügemarke) wird daraus
ABGELEITET, nie umgekehrt. Der Grund ist die Umkehrbarkeit: In Aufnahmezeit gibt es keinen
Wert für „mitten im Halt" (zwei Stützstellen auf derselben Sekunde), jede Rückrechnung fällt
auf die linke Haltkante. Genau daran klebte der Kopf — 28 von 39 Frames Stillstand, und mit
Pfeiltasten (5 Filmsekunden) kam man an einem 6-s-Halt NIE vorbei. Deshalb gibt `baueAchse`
die Halte als **Intervalle** zurück (`filmVon`/`filmBis`, dazu `stuecke` je Aufnahme und
`indizes` als Rückweg zum Stopp), und `haltBeiFilmS` beantwortet „steht der Kopf in einem
Halt, und wo darin?" (`beschreibeHaltStand`: „Aufnahme 2 von 3 · 2,1 s von 6,0 s") — die
Grundlage der Klip-Kette aus Etappe 2. **In der Kopfleiste steht diese Auskunft NICHT**: Eine
Pille, die beim Scrubben erscheint und verschwindet, verschiebt Uhr, Werkzeuge und
Zoom-Regler daneben — eine Anzeige, die die Bedienelemente springen lässt, kostet mehr, als
sie sagt; dass ein Halt läuft, zeigt ohnehin das eingeblendete Bild auf der Karte. Der
Kopfstrich bleibt immer orange: Farbe bezeichnet auf der Leiste Identität, nicht Zustand.

**Ein Video zählt mit seiner echten Länge, ein Moment mit seiner Dauer.** `aufnahmeHaltS`
ist die eine Formel dafür (Video → `dauerS`, sonst `haltedauerS`); `display.holdS` ist bei
Video wirkungslos, der Player läuft bis zum Dateiende. `dauerS` liefert die Editor-Route aus
drei Quellen (Manifest → Anreicherungs-Cache → tour.json), rein lesend; fehlt alles
(unverarbeiteter Altbestand), bleibt es bei der Foto-Annahme. Vorher bekam ein 34-s-Video
~34 px statt ~200 px, und Momente hatten gar keine Breite — an der Beispieltour 13,6
unsichtbare Filmsekunden. Gemeint ist dabei die Länge des MATERIALS, nicht die des
Ausschnitts (`quellDauerS` vor `dauerS`): daran schlagen die Schnitt-Kanten an.

**Der Maßstab ist px je FILMSEKUNDE** (`pxProFilmS` + `einpassen`), kein Faktor auf die
Fensterbreite. Der Unterschied zählt, weil die Fortbewegung die Filmdauer bestimmt: Im
Faktor-Modell skalierte jede Modus- oder Standzeit-Änderung die GANZE Leiste, auch alles vor
der geänderten Stelle. Jetzt wächst die Achse hinten und links bleibt jedes Pixel stehen
(gemessen: Standzeit +14,8 s ⇒ +82,9 px am Ende, Maßstab unverändert). Beim Öffnen wird
einmal eingepasst (`passeEin`), danach ändert nur Zoomen den Maßstab — waagerechter Scroll
entsteht nie beim Öffnen. Weil die Breite jetzt an den DATEN hängt, schreibt
`renderZeitleiste` sie mit (`schreibeZeitBreite`, mit Letzter-Wert-Vergleich: die Funktion
läuft in jedem Zug-Frame).

**Ein Halt ist eine KETTE von Klips, kein Stapel** (Etappe 2 des
[Zeitleisten-Umbaus](docs/concepts/zeitleiste-umbau.md)). Der „Cluster" war nie ein eigenes
Ding, sondern die Folge zusammenfallender Anker — als Stapel mit Zahl-Plakette gezeichnet,
weil PUNKTE an derselben Stelle übereinanderlägen. Er saß an der LINKEN Kante einer Breite,
die der Halt trotzdem belegte: eine tote Zone, in der nichts anzufassen war, obwohl dort der
halbe Film liegt (52 % der Beispieltour sind Standzeit). Jetzt hat jede Aufnahme ihren eigenen
Klip mit Anfang und Ende, und die Kette liegt lückenlos hintereinander. Drei Regeln tragen das:
**Reconcile an `medium.id`** (nicht am Titel — der ist weder eindeutig noch stabil; und nie per
Neubau: der kostete 2,34 ms je Zieh-Frame und das gezogene Element samt dekodiertem `img`),
**Container-Queries** für die drei Ausbaustufen (nur Bild < 150 px < Bild+Name < 232 px <
Bild+Name+Bild — gemessene JS-Klassen schalteten erst beim Loslassen, weil
`kuerzeBeschriftungen` im Zug bewusst nicht läuft) und die **Miniatur aus `miniaturQuelle`**
(thumb → src; ohne den Rückfall bliebe jede Tour von vor der Bildaufbereitung ohne Bild).

**Die rechte Kante eines Fotos ist seine Standzeit** (`display.holdS`, Blase am Griff). Ein
Video hat diesen Griff NICHT — der Player läuft bis zum Dateiende, `holdS` ist dort wirkungslos
(src/tour.js), ein Griff dafür wäre eine Lüge. Es hat stattdessen **zwei SCHNITT-Kanten**
(`edits.medien[].trim` in DATEI-Sekunden, Etappe 4): Der alte Satz „ein Video trägt seine
Länge, sie steht nicht zur Wahl" stimmt für die Standzeit, nicht für den Schnitt. Anschlag
ist an beiden Kanten die Datei, Loop gibt es hier nicht. Der **Ripple kostet keine Zeile
Code** — ein Video liegt in einer Halt-Kette ohne Lücken, ein kürzerer Ausschnitt macht
seinen Halt schmaler, die Achse baut sich neu und alles Folgende rückt vor. Angewandt wird
der Schnitt in der Pipeline ([video.ts](server/src/pipeline/video.ts)), und zwar **immer per
Transcode**: `-c copy` schnitte nur an Keyframes und träfe den Punkt um Sekunden. Die
geschnittene Fassung (`m1.cut.mp4`) entsteht NEBEN dem Master, nie an seiner Stelle — sonst
wäre der zweite Schnitt einer in den ersten, und „Trim zurücknehmen" fände das Weggeschnittene
nirgends wieder. **Der Zug friert den Maßstab ein und lässt ihn
eingefroren:** eingepasst folgte er sonst der wachsenden Filmdauer — die Leiste schrumpfte
unter der Hand, der Griff bliebe hinter dem Zeiger zurück, und beim Loslassen sprang alles noch
einmal auf „ganzer Film im Fenster". Genau diese Skalierung soll der feste Maßstab verhindern:
sie verschiebt AUCH alles vor der geänderten Stelle. Der Fit gehört zum Öffnen und zum Zoomen,
nicht zu einer Datenänderung; zurück führen der „×"-Knopf und ⇧Z, die danach sichtbar aktiv
werden. Ein waagerechter Scrollbalken ist dann kein Fehler, sondern die Folge einer
Nutzerhandlung.

**Der Klip-Zug ist EINE Geste mit zwei Bedeutungen.** Innerhalb der eigenen Kette ordnet er um
(`reihe`, risikofrei), darüber hinaus setzt er den ORT auf der Route — was gerade gilt, sagt
das Etikett am Zeiger, nicht erst das Ergebnis. Über einem FREMDEN Halt dockt der Klip an
(über dessen volle Breite: dort gibt es keine Zwischenposition, die Pixel gehören einer
Standzeit und keiner Fahrzeit) und übernimmt dessen Anker — über die Zeit gerechnet läge er
knapp daneben und der Halt zerfiele wieder. Die Rückübersetzung px → Zeit läuft über eine
Achse OHNE die Halte DIESER Aufnahme: auf der echten Achse hat der gezogene Klip selbst
Breite, um die Ruhelage läge also eine tote Zone von Sprungbreite. Welche Bedeutung gilt,
entscheidet die Kette, in der der Zug BEGANN — sonst kippte sie mitten in der Bewegung. Ein
Zug, der auf seinem eigenen Platz endet, schreibt nichts: `reiheVergeben` erzeugte sonst ein
neues Overlay und damit einen leeren Undo-Schritt.
Den ganzen Halt bewegt seither nur noch der Punkt auf der KARTE; den Filmstreifen im Inspector
gibt es nicht mehr (er war der einzige Weg zum Umordnen und Herauslösen — beides tut jetzt der
Klip-Zug dort, wo man es sieht).

**Die Halt-Zone gilt nur dem AUSGEWÄHLTEN Halt** — die gestrichelte Führung durch alle Bahnen
beantwortet „was liegt zeitlich darüber?" genau dann, wenn die Frage gestellt wird. Über alle
Halte gelegt waren es zwölf Linien Dauerunruhe (dasselbe Muster wie der leuchtende
Streckenabschnitt auf der Karte).

**Was in der Datei steht, liest der Editor selbst.** Der Block „Aufnahme-Details" unter einer
Aufnahme zeigt Aufnahmezeit, Verortung und die Kameradaten aus dem EXIF (Kamera, Objektiv,
Belichtung, Auflösung, Höhe). Gelesen wird clientseitig aus der ausgelieferten Datei —
`liesAufnahme`/`beschreibeAufnahme` in [src/studio/exif.ts](src/studio/exif.ts), beide DOM-frei
und an echten Beispiel-JPEGs getestet (`test/fixtures/`). Der EXIF-Block steht am DATEIANFANG,
deshalb holt der Editor per Range-Request nur die ersten 256 KB — und das erst beim ersten
Aufklappen (Ergebnis je Medium gecacht, der Auf-/Zu-Zustand überlebt den Render). Kein
Server-Feld, keine Pipeline-Änderung: was das Foto trägt, trägt es schon.

**Was der ganzen Tour gehört, steht nicht im Inspector-Leerzustand.** Titel,
Beschreibung und Endscreen gehören keinem Objekt der Zeitleiste; sie liegen in
„Tour-Einstellungen", erreichbar über den Titel in der Kopfleiste und über den
„…"-Knopf neben Speichern (dort auch „Neu verarbeiten") — als eigene Ansicht
im rechten Panel, nicht als Modal und nicht als Leerzustand (der las sich
früher wie eine Einstellung des Nichts).

**Die globalen Knopf-Regeln schlagen jede Klasse.** `button:hover { background: … }` wiegt durch
die Pseudoklasse mehr als `.knopf-primaer` oder `.kopf-griff` — wer einem Knopf eine eigene
Fläche gibt, muss sie in der `:hover`-Regel WIEDERHOLEN, sonst wird er beim Zeigen grau (der
orange Primärknopf und der Abspielkopf wurden so ausgerechnet dunkler). Dasselbe gilt für
`:disabled:hover`. Ein Knopf, der gar keinen Hover haben soll, braucht trotzdem eine leere
`:hover`-Regel, die seine Fläche hält.

**Der Inspector-Inhalt ist eine Flex-SPALTE — hohe Blöcke brauchen `flex: none`.** Ein
Flex-Item schrumpft (Default `flex-shrink: 1`), statt den Container scrollen zu lassen: der
aufgeklappte Block „Aufnahme-Details" war dadurch **2 px hoch**, seine acht Zeilen standen im
DOM und waren unsichtbar. Gleiche Sorte Falle wie „`margin-top: auto` kollabiert im Overflow".

**Zwei CSS-Fallen derselben Sorte** (eine eigene Regel schlägt eine, die der Browser über einen
anderen Selektor stellt): `display: flex` direkt auf `dialog` schlägt
`dialog:not([open]) { display: none }` — der geschlossene Dialog hängt dann sichtbar über der
Seite; die Regel gehört an `dialog[open]`. Und die globale `button:active { transform: scale(…) }`
ERSETZT die Zentrierung `translateX(-50%)`, statt sie zu ergänzen (CSS kennt nur *eine*
`transform`-Eigenschaft) — Abspielkopf und Foto-Miniatur sprangen beim Drücken um ihre halbe
Breite; beide brauchen eine eigene `:active`-Regel, die beides kombiniert.

**Ein Auswahl-Rahmen gehört nach INNEN.** Ein `box-shadow` ohne `inset` liegt AUSSERHALB der
Box — bei einem Element am Rand seines Containers schneidet ihn dessen `overflow` weg. Auf der
Zeitleiste war das an `.spuren-fenster { overflow-x: scroll }` zu sehen: Ein Ton-Klip, der bei
0:00 beginnt, hatte oben, unten und rechts einen Rahmen und links keinen. Die Zustandsbänder
lösen es längst mit `inset` (`.band.fokus`); bei den Klips musste es ein eigenes
`::after`-Pseudo-Element werden, weil die Wellenform (`inset: 0`) einen Inset-Schatten am Klip
selbst wieder zudeckte — mit `pointer-events: none`, sonst schluckt der Ring die überstehenden
Kanten-Griffe. Der weiche SCHEIN darf außen bleiben: dass er an einer Kante fehlt, sieht man
nicht. Dieselbe Familie wie „`border` + `overflow: hidden` frisst das Randpixel"
(docs/concepts/zeitleiste-umbau.md §5).

**Abspielen ist Schnittprüfung, kein zweiter Player.** [src/studio/abspielen.ts](src/studio/abspielen.ts)
(lazy beim ersten Play) lässt den Abspielkopf über die Achse laufen, spielt Musik und Klänge
und blendet an jedem Halt die Foto-Karte auf — die 3D-Kamerafahrt bleibt dem echten Player
vorbehalten („Vorschau"). Die Schrittlogik `tick()` ist rein und getestet; das Tempo ist
`1/schaetzeAnimationsdauer`, sodass der Halt an einem Foto hier so viel Zeit „kostet" wie
später. Musik läuft über EIN `Audio`-Element mit **Eintritts-Seek** (wer mitten im Bereich
startet, hört, was dort im Film liefe — `createAudioTracks` kann das nicht, deshalb eigener
Weg); Klänge nutzen `sfxSollFeuern` aus [src/audiotracks.js](src/audiotracks.js), damit im
Studio nichts klingt, was der Film nicht spielt (Drift-Wächter + handgeschriebene
`audiotracks.d.ts`, weil `allowJs` aus ist). Jede manuelle Geste ruft `halteAbspielen()` —
der Spielplan ist ein Schnappschuss und liefe sonst gegen veraltete Halte.

**Welches Bild auf der Karte liegt, ist eine FUNKTION der Kopfposition** — keine Uhr und keine
Überfahr-Marke. `synchronisiereFoto` (aufgerufen aus `renderPlayhead`, also bei jeder
Kopfbewegung) fragt `haltBeiFilmS`: steht der Kopf in einem Klip, liegt dessen Bild auf der
Karte; verlässt er ihn, verschwindet es. Der Fortschrittsbalken wird dabei gesetzt statt
animiert. Vorher stieß der Abspieler die Einblendung als Marke an und ein Timer nahm sie
zurück — daran hingen ZWEI Fehler, die derselbe Satz erklärt: Beim Scrubben erschien gar kein
Bild (der Abspieler lief ja nicht), und beim Abspielen ging es 0,8 s zu früh aus, weil der
Timer über die reine Standzeit lief, der Klip aber über Standzeit + Ausblendung. Im
Schnelllauf (J/L) bleibt die Karte aus — dort will man die Strecke überfliegen. `ZeigeMarke`
und `Schritt.zeige` sind damit ersatzlos entfallen.

**Eine Auswahl über drei Ansichten.** `z.fokus` (ausgewähltes Objekt) ist getrennt von
`z.auswahl` (Einfügemarke für „ab hier"-Aktionen) — wie Selektion und Abspielkopf in einem
Schnittprogramm. Der Fokus speichert nur die **Identität**; die Spanne löst `loeseFokusAuf()`
bei jedem Render neu auf, sonst veraltet sie beim Verschieben einer Grenze. Das fokussierte
Objekt ist gleichzeitig im Band hervorgehoben, im Inspector beschrieben und als leuchtender
Streckenabschnitt auf der Karte sichtbar.

**Undo/Redo** nutzt aus, dass das Overlay immutabel fortgeschrieben wird: Ein Referenzvergleich
beim Render (`letzterStand`) erkennt jede Änderung, egal aus welchem Handler. Während eines
Zeitleisten-Zugs läuft nur `renderNachZug()`, das den Stand nicht fortschreibt — der ganze Zug
wird dadurch zu genau einem Undo-Schritt.

**Falle bei Zeitleisten-Interaktion:** Nach `setPointerCapture` zeigt `e.target` im `pointerup`
auf das Capture-Element, nicht mehr auf das Element unter dem Finger. Was angeklickt wurde,
muss im `pointerdown` gemerkt werden.

## Benutzerverwaltung

Eigene Seite ([admin.html](admin.html) + [src/admin/](src/admin/)), nicht Teil des Studios:
Das Studio ist der Schneideraum für Touren, das hier ist Hausverwaltung. Erreichbar über das
Konto-Menü im Studio — der Eintrag erscheint nur für Admins. Rechnende Teile liegen DOM-frei in
[adminmodell.ts](src/admin/adminmodell.ts), Server-Seite in
[server/src/routes/admin.ts](server/src/routes/admin.ts) hinter `erfordereAdmin`.

**Fünf Reiter, und die Regel steht bei dem, was sie regelt.** Konten · Einladungen ·
Warteliste · System-Mails · Protokoll; alle fünf Panels liegen im DOM, sichtbar ist eins
(dasselbe `hidden`-Muster wie im Studio). Die Liste `TABS` in [adminmodell.ts](src/admin/adminmodell.ts)
ist die einzige Quelle für Leiste, Zähler und URL-Anhang (`/admin#einladungen`, per
`replaceState` — mit `pushState` führte der Zurück-Knopf durch die zuletzt besuchten Reiter,
statt die Seite zu verlassen); ein Drift-Wächter prüft, dass zu jedem Reiter ein
`panel-<id>` in [admin.html](admin.html) steht. Die beiden Schalter der Registrierung liegen
NICHT mehr zusammen in einer Karte, sondern je im Reiter, den sie betreffen — die
Einladungspflicht bei den Einladungen, das Wartelisten-Angebot bei der Warteliste. Weil die
Warteliste dadurch „angeschaltet, aber ohne Wirkung" sein kann, ohne dass die Ursache
sichtbar wäre, steht dort ein Knopf zum anderen Reiter; ob sie wirkt, rechnet
`wartelisteAngeboten` nach (Spiegel der Server-Regel, Wahrheitstabelle doppelt getestet).
**Der Zähler am Reiter ist ein Hinweis, keine Statistik:** bei den Konten sind es alle, bei
Einladungen die OFFENEN, bei der Warteliste die WARTENDEN — und nur die färbt sich amber,
denn nur dort wartet Arbeit. Was die Zahl zählt, steht im `aria-label`.

**Das Protokoll zeigt, was die API zuletzt gemeldet hat** — die letzten 500 Warnungen und
Fehler aus einem Ringpuffer im Arbeitsspeicher ([server/src/protokoll.ts](server/src/protokoll.ts)).
Bewusst keine Tabelle: Ein Protokoll in der Datenbank will Fristen, Indizes und eine
Aufräumerei, und die Frage dahinter ist fast immer „was ist gerade eben schiefgegangen?".
Der Preis steht offen im Reiter, denn Leere ist hier die GUTE Nachricht und darf nicht
wie ein Ausfall klingen: „Nichts vorgefallen seit dem Start der API am … um …".
Gefüllt wird der Puffer am **Logger-Ziel** (`protokollZiel` als pino-Stream in
[app.ts](server/src/app.ts)), nicht an den Aufrufstellen — sonst gäbe es zwei Wege, etwas
zu melden, und der zweite bliebe liegen; die Zeile geht dabei unverändert weiter nach
stdout, das Docker-Log bleibt also die vollständige Quelle. Drei Feinheiten: Der Zähler am
Reiter zählt nur die FEHLER (eine Warnung ist Betrieb), die Zusammenfassung über der Liste
zählt denselben Vorrat (sonst widerspräche sie ihm sichtbar), und Meldungen, die während
des Lesens eintreffen, rutschen NICHT von selbst in die Liste, sondern warten hinter dem
Streifen „N neue Meldungen anzeigen". Der Abgleich läuft über `seit=<höchste Nummer>`;
weil die Nummern nach einem Neustart wieder bei 1 beginnen, vergleicht die Ansicht
zusätzlich `gestartet` und lädt dann komplett neu — ohne das bliebe sie nach jedem Deploy
für immer still und sähe dabei gesund aus.

**Suche und Filter greifen mit UND, und die Segmente zählen INNERHALB der Suche.** Dadurch
beantwortet die Filterleiste zwei Fragen auf einmal (wie viele passen, wie sie sich
verteilen) und eine Zeile „3 von 12" erübrigt sich. Die Sperr-Regeln zählen dagegen über
ALLE Konten: Ein Filter darf nicht darüber entscheiden, ob der letzte Admin löschbar wird.

**Zwei Fallen, die diese Seite gekostet hat:** Das `close`-Ereignis eines `<dialog>` kam in
der Abnahme nicht an — eine Rückfrage, deren Versprechen daran hängt, hängt für immer, und
der Löschen-Knopf tat schlicht nichts. Deshalb lösen die KNÖPFE die Frage auf
(`beendeFrage`), `close`/`cancel` sind nur das Auffangnetz für Esc. Und ein modaler Dialog
liegt im Browser-Top-Layer über allem: Der Flash zur Testmail lag unter dessen Backdrop,
also meldet aus dem Mail-Dialog heraus seine eigene Fußzeile (DESIGN.md sagt dasselbe).
Rückfragen laufen nicht mehr über `window.confirm` — das kam in Systemoptik, nannte oben die
Domain und gab dem gefährlichen Knopf dieselbe Gestalt wie dem harmlosen.

**Es gibt zwei Rollen** (`users.rolle`), keine Rechtematrix: wer verwalten darf und wer seine
eigenen Touren hat. `Benutzer.rolle` hängt an jeder aufgelösten Sitzung und kommt über
`/auth/me` bis in die Oberfläche.

**Wer Admin ist, entscheidet zuerst die Konfiguration.** `MAPTALE_ADMINS` (Default:
Henriks beide Adressen) wird bei JEDEM Start auf die Admin-Rolle gehoben — `hebeAdmins` in
[auth.ts](server/src/auth/auth.ts). Das ist bewusst eine Boot-Garantie und keine einmalige
Migration: So kann sich niemand aussperren, und ein Konto, das es beim Umstellen noch gar nicht
gab, wird Admin, sobald es angelegt ist. Die Kehrseite: Diese Konten lassen sich in der
Oberfläche NICHT herabstufen oder löschen — die Route lehnt es mit 409 ab, statt es beim
nächsten Neustart still rückgängig zu machen. Dieselbe Sorge deckt zwei weitere Riegel: die
eigene Admin-Rolle ist nicht ablegbar, und der letzte Admin bleibt Admin. Alle drei Regeln
stehen doppelt (Server + `rolleGesperrt`/`loeschenGesperrt` im Modell): Der Server MUSS sie
durchsetzen, die Oberfläche SOLL den Knopf gar nicht erst anbieten.

**Registrierung: ein Schalter, zwei Ebenen.** Die DB-Einstellung `einladung_pflicht`
(Vorgabe AN, [einladungen.ts](server/src/auth/einladungen.ts)) entscheidet, ob ein Code nötig
ist — sie liegt in der Datenbank und nicht in der Umgebung, weil sie zur Laufzeit umgelegt wird.
Darüber steht weiterhin der harte Env-Riegel `MAPTALE_REGISTRIERUNG_OFFEN`: Ist der zu, hilft
auch ein gültiger Code nicht. `/auth/me` meldet beides AUCH ohne Anmeldung — genau dort, wo das
Registrierungsformular danach fragt, ist niemand angemeldet.

**Eine Einladung ist einmal einlösbar** und bleibt nach dem Einlösen stehen (sie ist die
einzige Stelle, an der später noch steht, wer wen hereingeholt hat). Der Code steht im
Klartext: Er ist ein Türöffner zur Registrierung, kein Kontogeheimnis, und der Admin muss ihn
weitergeben können. Geprüft wird ZWEIMAL — vorab für eine brauchbare Fehlermeldung, und beim
Einlösen nach dem Anlegen über ein bedingtes UPDATE, denn nur dort ist es atomar. Scheitert das
zweite (zwei Anmeldungen mit demselben Code in derselben Sekunde), wird das eben angelegte
Konto wieder zurückgenommen.

**Die Registrierung ist zweistufig: erst die Einladung, dann die Person.** Schritt 1 fragt nur
den Code und prüft ihn über `POST /api/auth/einladung-pruefen` — rein lesend, eigene Bremse
(12 Versuche je 10 min), verbraucht nichts. Erst danach kommt das Formular — und das fragt
**nur E-Mail und Passwort**: Jedes weitere Pflichtfeld kostet Anmeldungen, und für ein Konto
gebraucht wurde der Name nie. `users.name` ist trotzdem NOT NULL und trägt zwei sichtbare
Dinge (Mail-Anrede „Hallo Mira," und den Konto-Chip, solange im Profil kein Anzeigename
steht) — deshalb leitet `nameAusEmail` ([server/src/auth/auth.ts](server/src/auth/auth.ts))
ihn aus dem lokalen Teil der Adresse ab: Plus-Zusatz weg, Trennzeichen zu Leerraum, jedes
Wort groß (`mira.wolf@…` → „Mira Wolf"). Eine VORGABE, keine Behauptung — im Profil ist der
Anzeigename jederzeit überschreibbar. Das Feld `name` bleibt in der Route optional: Wer ihn
mitschickt, behält ihn. Der bestätigte Code steht im Formular als grüner Chip mit „Ändern",
sonst wüsste niemand, ob die Einladung angekommen ist. Ohne Einladungspflicht entfällt
Schritt 1 ersatzlos.
`formatiereEinladungscode` ([src/einladungscode.ts](src/einladungscode.ts)) räumt beim TIPPEN
auf (Versalien, Bindestrich von selbst), statt hinterher zu meckern. Zwei Kanten: Der Einstieg
`#registrieren` von der Landing fällt VOR der `/auth/me`-Antwort an und kennt die Pflicht noch
nicht — `zeigeRegistrierungsmodus` stellt ihn nachträglich gerade. Und ein zwischen Schritt 1
und 2 verbrauchter Code wirft zurück auf Schritt 1, weil nur dort das Feld steht, in dem sich
das beheben lässt. Der Link aus der Verwaltung (`/studio.html#einladung=CODE`) prüft den Code
sofort und überspringt Schritt 1; wie `#verify=`/`#reset=` wirkt er nur beim Laden der Seite,
nicht bei einem Hash-Wechsel in einem offenen Tab.

**Wer keinen Code hat, kommt auf die Warteliste** ([server/src/auth/warteliste.ts](server/src/auth/warteliste.ts),
[routes/warteliste.ts](server/src/routes/warteliste.ts)) — die Kehrseite der Einladungspflicht:
Adresse hinterlassen, der Betreiber lädt gezielt nach. Vier Dinge tragen das, und jedes davon
lässt sich „vereinfachen", bis es rechtlich kippt:
**Double-Opt-in** — ein Eintrag zählt erst nach dem Klick in der Bestätigungsmail; ohne ihn
trüge jeder fremde Adressen ein, und der Einwilligungs-Nachweis (Art. 7 Abs. 1 DSGVO, deshalb
Zeitpunkt UND IP beider Schritte in der Zeile) fehlte. Eingeladen wird **nur, wer bestätigt
hat** (409 sonst, doppelt geprüft via `einladenGesperrt`).
**Ein Token für beide Wege** — bestätigen und austragen. Gespeichert ist nur sein Hash, deshalb
bekommt die Einladungsmail einen FRISCHEN (`erneuereToken`): Es gilt immer der Link aus der
jüngsten Mail. Das Austragen läuft nie auf den bloßen Link-Aufruf, sondern über einen Knopf —
Mail-Scanner öffnen Links vorab, und eine Löschung durch einen Scanner wollte niemand.
**Die öffentlichen Routen antworten immer gleich** (`{ok:true}`), egal ob die Adresse neu ist,
schon wartet oder längst ein Konto hat — sonst wären sie eine Auskunft darüber, wer bei Maptale
angemeldet ist. Die Oberfläche zeigt darum denselben Satz.
**Fristen statt Sammlung**: `raeumeAuf` (beim Start und täglich) löscht Unbestätigtes nach 14
Tagen, Wartende nach einem Jahr, Eingeladene 90 Tage nach dem Code.
Ob das Formular überhaupt vor der Tür steht, entscheidet `wartelisteAngeboten` aus DREI Werten
(eigener Schalter, Einladungspflicht, Env-Riegel) — bei offener Registrierung wäre „trag dich
ein, wir melden uns" eine Schikane. `/auth/me` meldet das Ergebnis mit, die Seite rechnet es
nicht nach. Die Fristen stehen auch in [datenschutz.html](datenschutz.html); wer sie im Code
ändert, ändert dort eine Zusage.

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

**System-Mails: HTML im Maptale-Look, Texte in der Verwaltung.** Die vier Mails (Bestätigung,
Passwort-Reset, Warteliste bestätigen, Warteliste einladen) gehen als **multipart** raus —
HTML UND Text, immer beide aus DERSELBEN Quelle
([maillayout.ts](server/src/maillayout.ts) `rendereMail`). Der Text-Teil ist keine Beigabe:
Ohne ihn steigt die Spam-Wahrscheinlichkeit, und die halbe Testsuite zieht ihren Link daraus
(`letzterLink()`). Deshalb steht der Haupt-Link im Text auf einer EIGENEN Zeile — Programme,
die selbst verlinken, schneiden sonst am nächsten Satzzeichen ab, und ein Token mit
angehängtem Punkt löst nichts ein.
Das HTML ist tabellenbasiert mit Inline-Styles, weil Outlook mit Word rendert und Gmail
`<style>`-Blöcke teils verwirft. Drei Dinge, die man dabei „aufräumt" und damit zerstört: Die
Flächenfarbe muss **doppelt** stehen (`bgcolor`-Attribut UND Inline-Style), der Knopf ist eine
Tabelle mit `bgcolor` (der Verlauf ist nur Zugabe — Outlook sieht ihn nie), und das Logo ist
ein **PNG** mit `alt="Maptale"` (`public/branding/mail-logo.png`, Rendering von `logo.svg`,
s. [scripts/gen-logo.mjs](scripts/gen-logo.mjs)): SVG zeigt kein Mail-Programm, und weil
Bilder oft erst auf Klick geladen werden, ist der Alt-Text so gesetzt, dass an seiner Stelle
die Wortmarke steht.
**Die Texte stehen im Katalog** [mailvorlagen.ts](server/src/mailvorlagen.ts) — die Tabelle
`mailvorlagen` hält nur ABWEICHUNGEN. Eine bessere Formulierung im Code erreicht damit alle,
die nichts angepasst haben; „Zurücksetzen" ist folgerichtig ein DELETE, und wer den Standard
von Hand zurücktippt, bekommt ebenfalls die Zeile gelöscht (sonst hinge die Vorlage still vom
Code ab). Bearbeitbar sind die WORTE (Betreff, Überschrift, Absätze, Knopf, Kleingedrucktes),
nicht das HTML: Freies Markup wäre erst im Postfach als kaputt zu sehen, ginge an jeder
Layout-Verbesserung vorbei und wäre ein Eingabefeld, aus dem HTML in fremde Mails fließt.
Platzhalter (`{{name}}`, `{{link}}`, `{{code}}`, `{{austragenLink}}`) sind pro Vorlage
deklariert; `pruefeBausteine` lehnt eine Fassung ab, in der eine Angabe fehlt — eine Mail
ohne ihren Link ist keine Geschmacksfrage, sondern eine Sackgasse. Ein Absatz, der NUR aus
`{{code}}` besteht, wird zur hervorgehobenen Code-Box (ein Feld „Code hervorheben" wäre ein
Formularfeld für etwas, das man am Text schon sieht).
In der Verwaltung (Karte „System-Mails") liegen Felder und **Live-Vorschau** nebeneinander;
gerendert wird die Vorschau vom SERVER (`POST …/vorschau`) — ein zweiter Renderer im Browser
wäre genau die Kopie, die auseinanderläuft. „Testmail" geht **nur an die eigene Adresse** und
trägt `[Test]` im Betreff; ein Empfängerfeld machte aus der Verwaltung ein Versandwerkzeug.

## Android-App

Aufnahme-App unter [android/](android/) (Kotlin, Compose, minSdk 29) — Architektur,
Upload-Fluss und die Fallen (Medien-IDs, Manifest-Unveränderlichkeit, WebView-Session,
Room-Migrationen) stehen in [android/CLAUDE.md](android/CLAUDE.md); die Datei lädt
automatisch, sobald unter `android/` gearbeitet wird.

## Konventionen

- Design / Marke: [`DESIGN.md`](DESIGN.md) — Single Source of Truth für Assistenten und UI.
- `window.__j` bündelt Debug-Handles des Players (`map`, `route`, `tour`, `rider`, `eleReady`
  u.a.); das Studio hat analog `window.__studio` mit den Accessoren `karte()` und `zustand()`.
- Externe Datenquellen brauchen sichtbare Attribution (Esri/Maxar, AWS Terrain) — auch in
  späteren Video-Exporten einbrennen. Siehe [README.md](README.md).
- Neue Tour hinzufügen = neuer Eintrag in `TOURS`; keine Code-Änderung an der Engine nötig.

## Medien-Generierung

**Medien werden AUSSCHLIESSLICH über zwei Dienste generiert — keine anderen: Bilder über
fal.ai, Audio über ElevenLabs.** Keine anderen Bild-/Audio-/Video-Generatoren verwenden.
Beide Keys liegen in `.env` (`FAL_KEY`, `ELEVEN_LABS_KEY`) — nur lokal/Dev, nicht in den
Build/das Repo. API-Formen, Generier-Skripte, die kuratierte Studio-Bibliothek
(`public/audio/sfx/`) und die Wiedergabe-Wege im Player beschreibt der Skill
`medien-generierung` ([.claude/skills/medien-generierung/SKILL.md](.claude/skills/medien-generierung/SKILL.md))
— er lädt, sobald Medien erzeugt oder neu generiert werden sollen.
