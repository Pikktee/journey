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

## Deployment (Hetzner-VPS, Docker Compose)

Zwei Services aus einem Repo: `web` (statischer Vite-Build, Multi-Stage-
`Dockerfile`: Node baut, Caddy serviert und proxyt `/api` → Backend) und `api`
([`server/`](server/), eigene `server/Dockerfile` mit ffmpeg). Caddy übernimmt
TLS (Let's Encrypt) über die eigene Domain. Es sind **keine Build-Secrets**
nötig — der Google-3D-Key wird nur im Dev genutzt.

**Einmalige Einrichtung:**

1. Hetzner-Cloud-Server (z. B. CAX11) mit Docker; DNS-A-Record auf die Server-IP.
2. Auf dem Server `/srv/luhambo/` anlegen mit der [`docker-compose.yml`](docker-compose.yml)
   aus dem Repo und einer `.env`:
   `SITE_ADDRESS=deine-domain.tld`, `LUHAMBO_COOKIE_SECRET=<lang & zufällig>`,
   `LUHAMBO_ADMIN_EMAIL`/`LUHAMBO_ADMIN_PASSWORT` (Seed-Benutzer). Tour-Daten
   landen im Bind-Mount `/srv/luhambo/daten` (→ Backup einplanen!).
3. Im GitHub-Repo unter **Settings → Secrets and variables → Actions**:
   Secrets `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` (Deploy-Key des Servers).

**Ablauf:** Ein Version-Tag (`vX.Y.Z`) triggert
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) → Web- und
Backend-Tests als Gate → Images nach GHCR → per SSH `docker compose pull && up -d`.
Tags erzeugt man mit dem Release-Tool:

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
