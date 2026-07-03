# Journey — 3D-Reise-Visualisierung (Proof of Concept)

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

## Datenquellen & Attribution

- Satellit: © Esri, Maxar, Earthstar Geographics — Attribution muss sichtbar bleiben
  (auch in exportierten Videos einbrennen!)
- Terrain: Mapzen / AWS Open Data Terrain Tiles
- Demo-Fotos: KI-generiert (Platzhalter)
