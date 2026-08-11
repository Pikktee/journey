# Maptale Dokumentation

```
docs/
├── ops/             # Betrieb, Deployment-Runbooks & Release-Anleitungen
├── specs/           # Datenformate, Schnittstellen & Datenmodell-Spezifikationen
├── architecture/    # Umgesetzte Architektur-Entscheidungen & technische Designs
├── concepts/        # Offene Zukunfts-Features & Entwürfe (noch nicht / nicht ganz gebaut)
├── mockups/         # Aktuelle HTML-Prototypen als Vorlage
└── archive/         # Historie — nicht als Implementierungsquelle nutzen
```

**Für Coding-Agenten:** Verbindlich sind `ops/`, `specs/`, `architecture/` und die
unten gelisteten offenen `concepts/`. `archive/` ignorieren (widerspricht oft dem
Ist-Stand oder beschreibt erledigte Arbeit).

---

## Ordner-Übersicht

### 1. `ops/` (Operations & Release)
* [`deploy-cloudpanel.md`](ops/deploy-cloudpanel.md) — VPS-Deployment mit Hetzner & CloudPanel.
* [`android-release.md`](ops/android-release.md) — Bauen, Signieren und Veröffentlichen der Android-APK.
* [`polar-einrichten.md`](ops/polar-einrichten.md) — Polar AccessLink: Client, Token-Schlüssel, Webhook-Registrierung (das Geheimnis gibt es nur einmal).
* [`push-einrichten.md`](ops/push-einrichten.md) — Firebase-Projekt, `google-services.json` und Dienstkonto für die Push-Meldung „deine Tour ist fertig".

### 2. `specs/` (Spezifikationen)
* [`austauschformat.md`](specs/austauschformat.md) — `.maptale`-Export/Import-Format und `tour.json`.
* [`overlay-und-tourjson.md`](specs/overlay-und-tourjson.md) — Rollenverteilung zwischen `edits.json`, `anreicherung.json` und `tour.json`.

### 3. `architecture/` (Umgesetzte Entscheidungen)
* [`systemuebersicht.md`](architecture/systemuebersicht.md) — Tech-Stack & High-Level-Systemarchitektur (Einstieg mit Diagrammen).
* [`foto-pins-3d.md`](architecture/foto-pins-3d.md) — Three.js Custom-Layer für 3D-Fotopins & Mercator-Skalierung.
* [`zeitleiste-umbau.md`](architecture/zeitleiste-umbau.md) — Filmzeit-Achse, Halt-Klips, Zustandsbänder, Ton-Trim.
* [`konzept_profil_konto.md`](architecture/konzept_profil_konto.md) — Handle, Profil, Konto, Newsletter-Einwilligung, Export, SEO-Meta.

### 4. `concepts/` (Offene Konzepte)
* [`konzept_play_store_interner_test.md`](concepts/konzept_play_store_interner_test.md) — Android Play Store, interner Test als erster Schritt.
* [`konzept_social_login.md`](concepts/konzept_social_login.md) — Anmelden mit Google (später Apple).
* [`konzept_newsletter.md`](concepts/konzept_newsletter.md) — Teil B: redaktioneller Newsletter-Versand (Teil A ist live).
* [`konzept_mehrsprachigkeit_i18n.md`](concepts/konzept_mehrsprachigkeit_i18n.md) — Mehrsprachigkeit & `/de/` / `/en/`-Routing.
* [`konzept_tracker_integrationen.md`](concepts/konzept_tracker_integrationen.md) — Garmin/Strava Sync & automatische Foto-Zuordnung.
* [`konzept_medien_nachreichen_und_loeschen.md`](concepts/konzept_medien_nachreichen_und_loeschen.md) — Additive Medien-Route & endgültiges Löschen (Etappe 0 der Tracker-Integrationen).
* [`konzept_codebase_english_refactoring.md`](concepts/konzept_codebase_english_refactoring.md) — Bezeichner auf Englisch: Wellenplan, Glossar, Welle‑1-Schnitt.
* [`konzept-reisen-sammlungen.md`](concepts/konzept-reisen-sammlungen.md) — Sammlungen & mehrtägige Reisen.
* [`modi-konsolidierung.md`](concepts/modi-konsolidierung.md) — Fortbewegungs-Modi auf eine zentrale Tabelle ziehen.
* [`konzept_editor_zerlegung.md`](concepts/konzept_editor_zerlegung.md) — `editor.ts` in Karte / Inspector / Zeitleiste / Menüs zerlegen.
* [`konzept_live_mitverfolgen.md`](concepts/konzept_live_mitverfolgen.md) — Live-Link während der App-Aufnahme; Spur und Medien in Echtzeit.
* [`editor-ausbau.md`](concepts/editor-ausbau.md) — Erzählerische Werkzeuge im Studio.
* [`foto-tour.md`](concepts/foto-tour.md) — Foto-basierte Touren ohne GPS-Track.
* [`ideen-inspiration.md`](concepts/ideen-inspiration.md) — Rohideen-Backlog (nichts beschlossen).

### 5. `mockups/` (Aktuelle Vorlagen)
* [`studio-login.html`](mockups/studio-login.html) — Anmeldebühne.
* [`studio-konto.html`](mockups/studio-konto.html) — Profil & Kontoeinstellungen (abgenommen, in `DESIGN.md` referenziert).
* [`studio-aufnahmen-nachreichen.html`](mockups/studio-aufnahmen-nachreichen.html) — Medien nachträglich im Studio.
* [`app-aufnahmen-hinzufuegen.html`](mockups/app-aufnahmen-hinzufuegen.html) — Medien nachträglich in der App.
* [`app-live-teilen.html`](mockups/app-live-teilen.html) — Live-Freigabe während der Android-Aufnahme.
* [`live-ansicht.html`](mockups/live-ansicht.html) — Live-Zuschaueransicht (`/live/…`).

### 6. `archive/` (Historie)
Siehe [`archive/README.md`](archive/README.md). Enthält u. a. den Tool-Katalog,
alte Luhambo-/CI-/Logo-Mockups, den Zeitleisten-Mockup-Stand vor der Umsetzung und
das [Renderer-Labor](archive/renderer-labor.md) (2026-08-11 ausgebaut — was es gab,
was es gelehrt hat, wie man es zurückholt) sowie
[antialias-verworfen.md](archive/antialias-verworfen.md) (MSAA war seit MapLibre 5
stumm aus; nachgemessen, ohne sichtbaren Effekt, Flags entfernt) und die
[Player-TS-Migration](archive/konzept_player_typescript.md) (erledigt mit v0.60.0 —
lesenswert für die Methodik: topologische Wellen, Äquivalenztest, Smoke-Aufbau).
