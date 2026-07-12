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
  Upload → Anreicherungs-Pipeline (Benennung, Timeline mit Pausen-Kompression, Auto-Wetter
  via Open-Meteo) → Tour-JSON. Schema-Doku: [docs/austauschformat.md](docs/austauschformat.md).
- **[android/](android/)**: Aufnahme-App (Kotlin, Compose, minSdk 29) — GPS-Tracking als
  Foreground-Service, Fotos (CameraX), WorkManager-Upload, WebView-Player.

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
npm test                      # Web-Unit-Tests (Vitest: geo.js, remote.ts-Adapter, timeAt)
cd server && npm run dev      # Backend (tsx watch, Port 8787; Henriks Mac: 8791, s. u.)
cd server && npm test         # Backend-Tests (Vitest, Coverage-Gate 80 %)
cd android && ./gradlew test  # Android-Unit-Tests (JAVA_HOME auf JDK 17 setzen)
```

Optik-Verifikation läuft weiterhin über den Dev-Server im Browser. Dev-Proxy: `/api` →
`http://localhost:8787` (übersteuerbar via `LUHAMBO_API`-Env, z. B. wenn 8787 belegt ist).

Tour-Auswahl per Query-Param: `?tour=oberland` bzw. `?tour=<id aus TOURS>` (Default
`kohphangan`); aufgezeichnete Touren via `?tour=srv:<id>`.

**Deployment.** Docker Compose auf einem Hetzner-VPS (Railway ist abgelöst): Service `web`
(Root-`Dockerfile`: Node baut, Caddy serviert + `/api`-Proxy via [Caddyfile](Caddyfile)) und
Service `api` ([server/Dockerfile](server/Dockerfile), Daten-Bind-Mount `/srv/luhambo/daten`).
Ein Version-Tag `vX.Y.Z` triggert [.github/workflows/deploy.yml](.github/workflows/deploy.yml):
Web- und Backend-Tests als Gate, Images nach GHCR, dann per SSH `docker compose up -d`.
Tags erzeugt [scripts/release.sh](scripts/release.sh) (`npm run release`). Nötige
GitHub-Konfiguration: Secrets `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`. Siehe [README.md](README.md).

## Architektur

Alles läuft clientseitig ab einem `map.on('load')`-Callback in [src/main.js](src/main.js),
der die Module verdrahtet. Der zentrale Datenfluss:

**Route als Bogenlängen-Parameter.** [src/geo.js](src/geo.js) `buildRoute()` nimmt Wegpunkte,
glättet sie (Catmull-Rom) und resampled sie auf ~14 m Schritte. Die entstehende `route` trägt
`coords` (lng,lat,ele), kumulierte Distanzen `cum` und `total`. **Die eine Zustandsvariable, die
alles antreibt, ist `s` — die Position entlang der Route in Metern.** `pointAt(route, s)`,
`bearingAt(route, s)`, `nearestS(route, lnglat)` übersetzen zwischen `s`, Koordinaten und
Kurswinkel. Fotos und Modus-Wechsel werden über `s` verankert.

**Tour-Konfiguration als Daten.** [src/tours.js](src/tours.js) exportiert `TOURS` — pro Tour:
`segments` (jedes mit `pts` und `mode`: walk/moped/bike/jeep/tram/ferry), `photos` (mit
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
brauchen einen zweiten Renderer (deck.gl über MapLibre) — geplant.

**UI.** [src/ui.js](src/ui.js) `UI` verwaltet Overlays, Steuerleiste, Telemetrie, Höhenprofil und
die Fortschrittsleiste. Das Scrubbing (Ziehen/Tippen auf der Timeline, inkl. Foto-Dots) wird in
main.js über Pointer-Events verdrahtet und ruft `tour.beginScrub/scrub/endScrub` bzw.
`tour.jumpToPhoto`. Der DOM liegt statisch in [index.html](index.html); JS greift per `id` zu.

**„Google 3D"-Modus (`?tiles3d=1`).** [src/tiles3d.js](src/tiles3d.js) rendert Google
Photorealistic 3D Tiles — den echten Fotoscan der Stadt, also „die echten Gebäude, die dort
stehen" — in einer eigenen, lazy geladenen **Three.js**-Szene via 3DTilesRendererJS (kein
Cesium). MapLibre läuft dabei **unsichtbar weiter** (die Tour-Engine braucht dessen Terrain-
Abfragen); die Kamera wird pro Frame in ECEF gespiegelt (`extCamera`, `WGS84_ELLIPSOID`).
Route/Fahrer/Tag-Nacht sind integriert. Aktivierung über einen Google-Map-Tiles-API-Key
(`VITE_GOOGLE_MAP_TILES_API_KEY` im Dev bzw. `localStorage`). Grenze: Google deckt nur ~2.500
Städte ab (nicht alpin) → für unabgedeckte Regionen bleibt der MapLibre-Boden der Fallback.
Renderer-Landschaft & Begründung: [docs/renderer-plan.md](docs/renderer-plan.md).

## Konventionen

- `window.__j` bündelt Debug-Handles (`map`, `route`, `tour`, `rider`, `eleReady`) — nützlich
  zum Inspizieren im Browser.
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
  Fahrzeug-Motorloop (`eng-jeep.mp3`) ebenso via Sound-Generation
  ([scripts/gen-vehicle-audio.mjs](scripts/gen-vehicle-audio.mjs) — nur noch der Jeep;
  Moped/Auto/Boot auf Nutzerwunsch entfernt), Ambient-Musik via Music-API
  `POST /v1/music` `{prompt, music_length_ms}`
  ([scripts/gen-music.mjs](scripts/gen-music.mjs) → `public/audio/ambient.mp3`).
  Loops laufen nahtlos über den Crossfade-Wrapper [src/audioloop.js](src/audioloop.js)
  (`SeamlessLoop`), die Hintergrundmusik über [src/music.js](src/music.js) (Dock-Toggle),
  der Jeep-Motorloop über [src/vehicle.js](src/vehicle.js) (`MODE_SOUND`) — folgt
  `ui.onModeChange`, läuft nur während der Fahrt (Gate in main.js).

Keine anderen Bild-/Audio-/Video-Generatoren verwenden. Beide Keys liegen in `.env`
(`FAL_KEY`, `ELEVEN_LABS_KEY`) — nur lokal/Dev, nicht in den Build/das Repo.
