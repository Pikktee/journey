# Luhambo — 3D-Reise-Visualisierung

> **Luhambo** ist Siswati für „Reise“.

Relive-artige 3D-Kamerafahrt über eine GPS-Route mit automatischen Foto-Stopps,
komplett auf Basis kostenloser Kartendaten.

## Starten

```bash
npm install
npm run dev
```

## Was der PoC zeigt

- **3D-Terrain aus freien Daten:** Esri World Imagery (Satellit, gleiche Bildquelle wie Relive)
  drapiert über AWS Terrain Tiles (Terrarium-DEM, Open Data), gerendert mit MapLibre GL JS.
- **Kinematische Kamerafahrt:** FreeCamera-Ansatz über `calculateCameraOptionsFromTo` —
  die Kamera hat eine explizite Flughöhe über dem Gelände und einen Blickpunkt; alle
  Kameragrößen werden pro Frame exponentiell geglättet. Phasen: Intro-Orbit → Verfolgungsfahrt
  → Foto-Orbit → Finale-Orbit.
- **Automatische Foto-Stopps:** Fotos sind Streckenpunkten zugeordnet (im echten Produkt via
  EXIF-Zeit/GPS). Die Fahrt bremst weich ab, die Kamera orbitet, die Foto-Karte blendet
  animiert ein (Paper-Look + Ken-Burns-Drift) und wieder aus.
- **Individualisierung:** Kameradistanz (Nah/Mittel/Weit), Geschwindigkeit (1×/2×/4×),
  Scrubbing über die Fortschrittsleiste mit Foto-Markern, Pause mit freier Kamera.

## Struktur

| Datei | Inhalt |
| --- | --- |
| `src/data.js` | Demo-Route (Lauterbrunnen → Grindelwald) + Foto-Metadaten |
| `src/geo.js` | Haversine, Kurswinkel, Catmull-Rom-Glättung, Resampling |
| `src/map.js` | Kartenstil (Satellit + DEM + Atmosphäre), Routen-Layer, Fahrer-Marker |
| `src/tour.js` | Kamera-Engine (Phasen, Glättung, Foto-Trigger) |
| `src/ui.js` | Overlays, Steuerleiste, Telemetrie |

## Nächste Schritte Richtung Produkt

- GPX/FIT-Import statt handgesetzter Wegpunkte (`src/data.js` ersetzen)
- Foto-Zuordnung über EXIF-Zeitstempel/GPS
- Video-Export: deterministisches Frame-Stepping + WebCodecs/ffmpeg
  (Overlays werden dabei über den Map-Frames komponiert)
- 3D-Fahrzeugmodelle (glTF) als Custom Layer
- Höhenprofil aus dem DEM statt aus Wegpunkt-Höhen

## Deployment (Railway)

Die App wird als statischer Vite-Build ausgeliefert (Multi-Stage-`Dockerfile`:
Node baut, Caddy serviert). Es sind **keine Build-Secrets** nötig — der
Google-3D-Key wird nur im Dev genutzt.

**Einmalige Einrichtung:**

1. Auf [Railway](https://railway.app) ein Projekt + Service anlegen (Deploy from
   Dockerfile). Railway setzt `$PORT` automatisch; die `Caddyfile` liest ihn aus.
2. In den Railway-**Projekteinstellungen → Tokens** einen Projekt-Token erzeugen.
3. Im GitHub-Repo unter **Settings → Secrets and variables → Actions**:
   - Secret `RAILWAY_TOKEN` = der Projekt-Token.
   - *(optional)* Variable `RAILWAY_SERVICE` = Service-Name, falls das Projekt
     mehrere Services hat.

**Ablauf:** Ein Version-Tag (`vX.Y.Z`) triggert
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) → `npm run build`
als Gate → `railway up`. Tags erzeugt man mit dem Release-Tool:

```bash
npm run release            # interaktiv fragen (bugfix/minor/major)
npm run release bugfix     # Patch  (0.1.0 → 0.1.1)
npm run release minor      # Minor  (0.1.0 → 0.2.0)
npm run release major      # Major  (0.1.0 → 1.0.0)
```

Das Tool prüft ein sauberes Arbeitsverzeichnis, hebt die Version an
(`npm version`), committet, taggt und pusht — der Push startet den Deploy.

## Datenquellen & Attribution

- Satellit: © Esri, Maxar, Earthstar Geographics — Attribution muss sichtbar bleiben
  (auch in exportierten Videos einbrennen!)
- Terrain: Mapzen / AWS Open Data Terrain Tiles
- Demo-Fotos: KI-generiert (Platzhalter)
