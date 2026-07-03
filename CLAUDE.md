# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Was das ist

Journey ist ein Proof-of-Concept für Relive-artige 3D-Kamerafahrten über eine GPS-Route
mit automatischen Foto-Stopps — vollständig auf freien Kartendaten. Vanilla JS + Vite,
gerendert mit MapLibre GL JS. Kein Framework, keine Tests, kein Backend.

Sprache im gesamten Projekt (Code-Kommentare, UI, Doku) ist **Deutsch**.

## Commands

```bash
npm install
npm run dev      # Vite-Dev-Server, Port 5173 (strictPort — belegt = Fehler, nicht Ausweichport)
npm run build    # Produktions-Build nach dist/
npm run preview  # gebautes dist/ lokal servieren
```

Es gibt keine Lint- oder Test-Skripte. Verifikation läuft über den Dev-Server im Browser.

Tour-Auswahl per Query-Param: `?tour=oberland` bzw. `?tour=<id aus TOURS>` (Default `oberland`).

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
`segments` (jedes mit `pts` und `mode`: walk/bike/tram/ferry), `photos` (mit `anchor`-Koordinate),
Intro-/Finale-Texte, optional `time` (für Tag/Nacht) und `geoid`. main.js verkettet die Segmente
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

**UI.** [src/ui.js](src/ui.js) `UI` verwaltet Overlays, Steuerleiste, Telemetrie, Höhenprofil und
die Fortschrittsleiste. Das Scrubbing (Ziehen/Tippen auf der Timeline, inkl. Foto-Dots) wird in
main.js über Pointer-Events verdrahtet und ruft `tour.beginScrub/scrub/endScrub` bzw.
`tour.jumpToPhoto`. Der DOM liegt statisch in [index.html](index.html); JS greift per `id` zu.

**Optionaler Google-3D-Modus.** [src/photoreal.js](src/photoreal.js) ist ein Prototyp, der
CesiumJS lazy vom CDN lädt und Google Photorealistic 3D Tiles rendert. MapLibre läuft dabei
**unsichtbar weiter** (die Tour-Engine braucht dessen Terrain-Abfragen); Cesium spiegelt nur pro
Frame die Kamera-Pose. Aktivierung über einen API-Key im `localStorage`. Standardmäßig aus.

## Konventionen

- `window.__j` bündelt Debug-Handles (`map`, `route`, `tour`, `rider`, `eleReady`) — nützlich
  zum Inspizieren im Browser.
- Externe Datenquellen brauchen sichtbare Attribution (Esri/Maxar, AWS Terrain) — auch in
  späteren Video-Exporten einbrennen. Siehe [README.md](README.md).
- Neue Tour hinzufügen = neuer Eintrag in `TOURS`; keine Code-Änderung an der Engine nötig.
