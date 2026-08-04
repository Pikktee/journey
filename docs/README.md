# Maptale Dokumentation

Willkommen in der Dokumentation von **Maptale**. Dieser Ordner ist in klare Themenbereiche gegliedert:

```
docs/
├── ops/             # Betrieb, Deployment-Runbooks & Release-Anleitungen
├── specs/           # Datenformate, Schnittstellen & Datenmodell-Spezifikationen
├── architecture/    # Umgesetzte Architektur-Entscheidungen & technische Designs (ADR)
├── concepts/        # Geplante Zukunfts-Features, Entwürfe & Entwicklungs-Roadmaps
└── mockups/         # Interaktive HTML-Prototypen & visuelle Entwürfe
```

---

## 📁 Ordner-Übersicht

### 1. `ops/` (Operations & Release)
Anleitungen für den Betrieb, Deployment auf Servern und App-Releases.
* [`deploy-cloudpanel.md`](ops/deploy-cloudpanel.md) — VPS-Deployment mit Hetzner & CloudPanel.
* [`android-release.md`](ops/android-release.md) — Bauen, Signieren und Veröffentlichen der Android-APK.

### 2. `specs/` (Spezifikationen)
Kanonische Dokumentation der Datenstrukturen und Formate.
* [`austauschformat.md`](specs/austauschformat.md) — `.maptale`-Export/Import-Format und `tour.json`.
* [`overlay-und-tourjson.md`](specs/overlay-und-tourjson.md) — Rollenverteilung zwischen `edits.json`, `anreicherung.json` und `tour.json`.

### 3. `architecture/` (Umgesetzte Architektur-Entscheidungen)
Dokumentation von bereits gebauten System-Architekturen, Berechnungen und Design-Entscheidungen.
* [`foto-pins-3d.md`](architecture/foto-pins-3d.md) — Three.js Custom-Layer für 3D-Fotopins & Mercator-Skalierung.
* [`renderer-plan.md`](architecture/renderer-plan.md) — 3D Deck.gl / Three.js Renderer-Architektur.
* [`modi-konsolidierung.md`](architecture/modi-konsolidierung.md) — Konsolidierung der Fortbewegungs-Modi im Web & Server.

### 4. `concepts/` (Offene Konzepte & Zukunfts-Roadmaps)
Konzepte und Entwicklungspläne für künftige Features.
* [`konzept_mehrsprachigkeit_i18n.md`](concepts/konzept_mehrsprachigkeit_i18n.md) — Mehrsprachigkeit & `/de/` / `/en/`-Routing.
* [`konzept_tracker_integrationen.md`](concepts/konzept_tracker_integrationen.md) — Garmin/Strava Sync & automatische Foto-Zuordnung.
* [`konzept_codebase_english_refactoring.md`](concepts/konzept_codebase_english_refactoring.md) — Refactoring der Codebase auf englische Bezeichner.
* [`konzept-reisen-sammlungen.md`](concepts/konzept-reisen-sammlungen.md) — Sammlungen & mehrtägige Reisen.
* [`zeitleiste-umbau.md`](concepts/zeitleiste-umbau.md) — Entwurf für den nächsten Ausbau der Studio-Zeitleiste.
* [`editor-ausbau.md`](concepts/editor-ausbau.md) — Erzählerische Werkzeuge im Studio.
* [`foto-tour.md`](concepts/foto-tour.md) — Foto-basierte Touren ohne GPS-Track.

### 5. `mockups/` (Visuelle Prototypen)
Interaktive HTML-Prototypen zum Testen von Benutzeroberflächen vor der Implementierung.
