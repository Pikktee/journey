# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Was das ist

Luhambo (Siswati für „Reise“) ist eine App für Relive-artige 3D-Kamerafahrten über eine GPS-Route mit
automatischen Foto-Stopps — vollständig auf freien Kartendaten. Web-Player in Vanilla JS + Vite
(neue Module in TypeScript), gerendert mit MapLibre GL JS.

**Luhambo wird von einem Prototyp zu einem echten Produkt ausgebaut** (Aufnahme-Plattform,
Meilensteine M1–M9): eigene Touren aufzeichnen (Android), hochladen, serverseitig anreichern
und mit der vorhandenen Player-Engine abspielen. Das Repo ist ein **Monorepo**:

- **Root**: Web-Player (Vite). Spielt statische `TOURS` und aufgezeichnete Touren
  (`?tour=srv:<id>` → [src/remote.ts](src/remote.ts) gegen das Backend).
- **[server/](server/)**: Backend (Node 22 + Fastify + better-sqlite3, TypeScript strict).
  Upload → Anreicherungs-Pipeline (Benennung via Nominatim, Track-Vereinfachung, Timeline mit
  Pausen-Kompression, Medien-Platzierung, Edit-Overlay, Auto-Wetter via Open-Meteo, Wetter-
  Verfeinerung per Foto-Bildanalyse) → Tour-JSON. Dazu Mehrbenutzer-Betrieb: Konten mit
  Mail-Bestätigung, Passwort-Reset, Quota, Sichtbarkeit ([server/src/auth/](server/src/auth/),
  `quota.ts`, `mail.ts`). Schema-Doku: [docs/austauschformat.md](docs/austauschformat.md).
- **Studio** ([studio.html](studio.html) + [src/studio/](src/studio/)): Weboberfläche zum
  Hochladen und Bearbeiten aufgezeichneter Touren (s. eigener Abschnitt unten).
- **Öffentliche Seiten**: [galerie.html](galerie.html) (alle auf `public` gestellten Touren)
  und [profil.html](profil.html) (`?id=…`, die Reisen einer Person). Beide ohne Anmeldung,
  Logik DOM-frei in [src/galerie/galeriemodell.ts](src/galerie/galeriemodell.ts).
- **[android/](android/)**: Aufnahme-App (Kotlin, Compose, minSdk 29) — s. eigener Abschnitt.

Sprache im gesamten Projekt (Code-Kommentare, UI, Doku, Commit-Messages) ist **Deutsch** —
auch in server/ und android/ (deutsche Bezeichner).

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
Daten-Bind-Mount `/srv/luhambo/daten`). Ein Version-Tag `vX.Y.Z` triggert
[.github/workflows/deploy.yml](.github/workflows/deploy.yml): Gate aus Web-Tests + Typecheck +
Build, Backend-Tests mit Coverage-Gate und Android-Unit-Tests → API-Image nach GHCR → per SSH
`docker compose -f docker-compose.cloudpanel.yml up -d` plus `rsync` des `dist/` in den
Site-Docroot. Tags erzeugt [scripts/release.sh](scripts/release.sh) (`npm run release`). Nötige
Secrets: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `CLOUDPANEL_DOCROOT` (fehlt letzteres, wird der
Rollout still übersprungen). Runbook: [docs/deploy-cloudpanel.md](docs/deploy-cloudpanel.md).
`docker-compose.yml` + [Caddyfile](Caddyfile) bleiben als Alt-Weg für Server ohne CloudPanel.

## Architektur

Es gibt drei unabhängige Frontends: den **Player** ([erlebnis.html](erlebnis.html) +
[src/main.js](src/main.js)), das **Studio** ([studio.html](studio.html) +
[src/studio/](src/studio/)) und eine schlanke **Landing** ([index.html](index.html), kein
MapLibre). Alle sind eigene Vite-Einstiege ([vite.config.js](vite.config.js)).

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
Begründung und Vergleich: [docs/renderer-plan.md](docs/renderer-plan.md).

**UI.** [src/ui.js](src/ui.js) `UI` verwaltet Overlays, Steuerleiste, Telemetrie, Höhenprofil und
die Fortschrittsleiste. Das Scrubbing (Ziehen/Tippen auf der Timeline, inkl. Foto-Dots) wird in
main.js über Pointer-Events verdrahtet und ruft `tour.beginScrub/scrub/endScrub` bzw.
`tour.jumpToPhoto`. Der Player-DOM liegt statisch in [erlebnis.html](erlebnis.html); JS greift
per `id` zu.

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
Renderer-Landschaft & Begründung: [docs/renderer-plan.md](docs/renderer-plan.md).

## Studio

Die Weboberfläche für aufgezeichnete Touren ([studio.html](studio.html), Vite-Einstieg;
Logik in [src/studio/](src/studio/)). Kein Router — Login-, App- und Editor-Ansicht liegen
gleichzeitig im DOM und werden per `hidden` umgeschaltet; der Editor wird lazy importiert,
damit MapLibre nicht ins Basis-Bundle kommt.

**Rohdaten + Overlay, nie destruktiv.** Der Editor verändert die hochgeladenen Daten nicht,
sondern schreibt ein **Edit-Overlay** (`luhambo/edits@1`, [server/src/schema/edits.ts](server/src/schema/edits.ts)):
`medien` (Caption, Anker, gelöscht, Anzeigeoptionen), `modi`, `trim`, `kamera`, `audio`,
`wetter`, `titelbild`.
Beim Speichern rendert der Server die Tour aus Rohdaten + Overlay neu. Edits referenzieren
**stabile Anker** — Medien-IDs, Koordinaten, absolute ISO-Zeitstempel, nie den Streckenanteil `f`.
`wetter` (Grenzen `[{ab, mode, staerke?}]` wie `modi`/`kamera`) ist ein Sonderfall: sobald
gesetzt, **ersetzt** es das Auto-Wetter (Open-Meteo + Foto-Verfeinerung) der ganzen Tour
vollständig — bewusste Korrektur, wenn das automatische Wetter danebenlag. `wetterAusOverlay`
([server/src/pipeline/weather.ts](server/src/pipeline/weather.ts)) baut daraus eine
Stufenfunktion; Marken-PAARE auf demselben `f` legen die Umschaltung (Player: Mitte zweier
Marken) exakt auf die Grenze. Rein render-seitig → der Anreicherungs-Cache bleibt gültig
(ein Wetter-Edit löst keine externen Aufrufe aus).

**Zwei Feinheiten der Pipeline, die man leicht „repariert":**

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
   unangetastet (jemand hat dann selbst umgeschaltet).

**Arbeitsteilung im Code.** [src/studio/editmodell.ts](src/studio/editmodell.ts) (Overlay
immutabel fortschreiben, Track-Projektion) und [src/studio/zeitleiste.ts](src/studio/zeitleiste.ts)
(Skalen, Bänder, Marken, Dauerschätzung) sind **DOM-frei und unter Vitest getestet**;
[src/studio/editor.ts](src/studio/editor.ts) enthält nur DOM- und MapLibre-Verdrahtung.
Neue Editor-Logik gehört in die beiden ersten Module, sonst ist sie nicht testbar.

**Zeitleiste: eine Bahn je Ereignistyp** (Fortbewegung, Kamera, Wetter, Momente, Musik & Sound, Fotos) auf
gemeinsamer Zeitachse. Zustände sind **lückenlose, beschriftete Bänder** — Anfang und Ende
eines Zustands sind dieselbe Kante, gezogen wird die Kante selbst. Trim-Griffe, Auswahl- und
Hover-Linie liegen als Overlay über allen Bahnen (absolut positioniert, **nicht** als
Grid-Item: ein Item mit `grid-row: 1/-1` belegt die ganze Spalte und drängt die Bahnen weg).

**Die Achse zeigt Aufnahmezeit**, nicht Wiedergabezeit — daran hängen alle Overlay-Anker.
Wie lang die fertige Animation läuft, ist eine andere Größe (die Engine fährt mit eigenem
Tempo und hält an jedem Foto); sie steht als **eine geschätzte Zahl** links unter den Bahnen
(`schaetzeAnimationsdauer`). Bewusst keine zweite Zeitachse.

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

## Android-App

Aufnahme-App unter [android/](android/) (Kotlin, Compose, minSdk 29). Aufgezeichnet wird in
einem **Foreground-Service**; der Live-Zustand liegt als Prozess-Singleton
(`AufzeichnungsZustand`, StateFlow), damit die Aufnahme das Verlassen des Screens überlebt.
Alles landet zuerst in Room, der Upload ist entkoppelt (WorkManager, pro Datei
wiederaufnehmbar).

**Hülle.** Zwei Reiter (Touren · Profil) mit dem Aufnahme-Knopf dazwischen — er ist KEIN
dritter Reiter: er wechselt nicht die Ansicht, sondern startet etwas, und während einer
laufenden Aufnahme führt er zu ihr zurück. Vollbild ohne Leiste laufen Aufzeichnung, Kamera,
Foto-Vollansicht, Tour-Detail und Player.

**Eine Tourenliste.** Lokale Entwürfe und Server-Touren werden verschmolzen
(`ui/Listenverschmelzung.kt`, DOM-frei getestet): Solange hochgeladen wird, gewinnt die lokale
Karte (nur sie kennt Fortschritt und Fehler), danach die vom Server (nur sie kennt Titelbild
und Kilometer). Der Upload startet automatisch beim Beenden der Aufnahme; der Nachzügler beim
App-Start reiht mit **`ExistingWorkPolicy.KEEP`** ein, sonst setzt er einen wartenden Backoff
zurück und startet doppelt.

**Medien-IDs** (`m1`, `m2`, …) werden aus der HÖCHSTEN vergebenen Nummer plus eins gebildet,
nicht aus der Anzahl — sonst kollidiert nach dem Löschen eines Fotos die nächste ID im
Verbund-Primärschlüssel `(tourId, id)`.

**Nach dem Upload ist das Manifest unveränderlich.** Foto-Titel und Titelbild laufen dann über
das Edit-Overlay: lesen, EINEN Schlüssel ergänzen, zurückschreiben — als **rohes JsonObject**
(`upload/EditsFortschreibung.kt`). Würde die App es in ein eigenes Modell parsen, fielen im
Studio gesetzte Kamerafahrten, Musik und Wetterkorrekturen still unter den Tisch.

**Der WebView-Player kann kein Bearer-Token schicken.** Er lädt `erlebnis.html` vom Web-Origin
und kennt nur Cookies; das Token steckt im OkHttp-Client. Vor dem Abspielen tauscht die App es
deshalb über `POST /api/auth/session-aus-token` gegen eine Sitzung — ohne das wären private
Touren (der Default für neue Touren) in der eigenen App unabspielbar.

**Room-Migrationen sind Pflicht**, kein `fallbackToDestructiveMigration`: auf dem Gerät liegen
echte, noch nicht hochgeladene Aufnahmen. Schemata werden nach `android/app/schemas/`
exportiert; der Migrationstest baut daraus die alte Datenbank und lässt Room migrieren und
validieren.

**Nicht erreichbar, aber vorhanden:** `ui/ImportScreen.kt` (GPX-Import) hat keinen Einstieg
mehr — auf dem Telefon liegen selten GPX-Dateien, das ist eine Studio-Aufgabe. Der Code bleibt
für einen späteren „Öffnen mit"-Intent-Filter stehen.

## Konventionen

- `window.__j` bündelt Debug-Handles des Players (`map`, `route`, `tour`, `rider`, `eleReady`
  u.a.); das Studio hat analog `window.__studio` mit den Accessoren `karte()` und `zustand()`.
- Externe Datenquellen brauchen sichtbare Attribution (Esri/Maxar, AWS Terrain) — auch in
  späteren Video-Exporten einbrennen. Siehe [README.md](README.md).
- Neue Tour hinzufügen = neuer Eintrag in `TOURS`; keine Code-Änderung an der Engine nötig.

## Medien-Generierung

**Medien werden AUSSCHLIESSLICH über zwei Dienste generiert — keine anderen:**

- **Bilder** (Foto-Stopps etc.): **fal.ai**. HTTP-API `https://fal.run/<model>` mit
  Header `Authorization: Key $FAL_KEY`; Standardmodell `fal-ai/flux/dev`, Seitenverhältnis
  3:2 (`image_size` `{width:1344,height:896}`), `output_format: 'jpeg'`. Fotorealistische,
  auf Ort/Uhrzeit/Wetter des jeweiligen Anker-Punktes abgestimmte Prompts.
- **Audio** (TTS, Wetter-Sounds, Fahrgeräusche, Hintergrundmusik): **ElevenLabs**.
  Wetter-SFX via Sound-Generation-API ([scripts/gen-weather-audio.mjs](scripts/gen-weather-audio.mjs)),
  Fahrzeug-Motorloops ebenso via Sound-Generation
  ([scripts/gen-vehicle-audio.mjs](scripts/gen-vehicle-audio.mjs) — Moped, Jeep und Boot als
  `eng-moped/eng-jeep/eng-boat.mp3`; das Auto ist auskommentiert), Ambient-Musik via Music-API
  `POST /v1/music` `{prompt, music_length_ms}`
  ([scripts/gen-music.mjs](scripts/gen-music.mjs) → `public/audio/ambient.mp3`).
  Loops laufen nahtlos über den Crossfade-Wrapper [src/audioloop.js](src/audioloop.js)
  (`SeamlessLoop`), die Hintergrundmusik über [src/music.js](src/music.js) (Dock-Toggle),
  die Motorloops über [src/vehicle.js](src/vehicle.js) (`MODE_SOUND` — `moped`/`jeep`/`ferry`;
  `walk`/`bike`/`tram` sind lautlos) — folgt `ui.onModeChange`, läuft nur während der Fahrt
  (Gate in main.js).

Keine anderen Bild-/Audio-/Video-Generatoren verwenden. Beide Keys liegen in `.env`
(`FAL_KEY`, `ELEVEN_LABS_KEY`) — nur lokal/Dev, nicht in den Build/das Repo.
