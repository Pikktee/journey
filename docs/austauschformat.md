# Luhambo-Austauschformat

Das Austauschformat ist die Achse zwischen Android-App, CLI-Importer, Web-Studio,
Backend und Player. Es hat zwei Gestalten desselben Schemas:

1. **Upload-Manifest `luhambo/upload@1`** — was Clients hochladen (Rohdaten).
2. **Tour-JSON `luhambo/tour@1`** — was das Backend daraus rendert und der
   Player abspielt (angereichert).

Grundprinzipien:

- **Rohdaten sind unantastbar.** Der Original-Upload bleibt unter `original/`
  liegen; Bearbeitungen leben in einem Edit-Overlay (`edits.json`, ab M7) und
  referenzieren stabile Anker (Medien-IDs, Koordinaten, Zeitstempel) — nie
  Streckenanteile. Die Pipeline rendert das Tour-JSON jederzeit neu aus
  Rohdaten + Overlay (`POST /api/tours/:id/reprocess`).
- **Streckenpositionen als Bruchteil `f` (0..1), nie Meter.** Der Player baut
  die Route selbst neu auf (Catmull-Rom + 14-m-Resampling in `src/geo.js`);
  serverseitige Meter würden minimal abweichen. Medien-Anker bleiben
  `[lng, lat]` und laufen clientseitig durch `nearestS`.
- **Unbekannte Felder ignoriert der Player.** Baukasten-Felder (`camera`,
  `audio`, `media[].display`) sind reserviert und ab Tag 1 im Schema erlaubt.

## Upload-Manifest `luhambo/upload@1`

`POST /api/tours` (Bearer-Token oder Session), Validierung: `server/src/schema/upload.ts`.

```json
{
  "schema": "luhambo/upload@1",
  "clientTourId": "8f3e-…",
  "title": null,
  "description": null,
  "time": { "start": "2026-07-04T08:12:31+02:00", "end": "2026-07-04T14:03:10+02:00", "zone": "Europe/Zurich" },
  "segments": [
    { "mode": "walk", "label": "Zu Fuß",
      "pts": [[7.9086, 46.5934, 802.1, 0.0], [7.9091, 46.5936, 802.8, 4.2]] }
  ],
  "media": [
    { "id": "m1", "type": "photo", "file": "IMG_0012.jpg",
      "takenAt": "2026-07-04T09:01:12+02:00", "anchor": [7.9105, 46.59], "caption": null },
    { "id": "m2", "type": "video", "file": "VID_0003.mp4",
      "takenAt": "2026-07-04T10:14:03+02:00", "anchor": [7.938, 46.5812], "durationS": 23.4 }
  ]
}
```

- `segments[].pts`: `[lng, lat, ele(m), tOffset(s ab time.start)]` — die Zeit
  als 4. Koordinate trägt die nichtlineare Pseudo-Zeit (M2) und die
  Zeit-Platzierung von Medien.
- `mode`: `walk | bike | tram | ferry` (Tempo + Kameradistanz im Player).
- `title: null` ⇒ Auto-Benennung serverseitig (Reverse-Geocoding Start/Ziel).
- `clientTourId`: idempotentes Anlegen — dieselbe App-Tour erzeugt nie zwei
  Server-Touren; die Antwort liefert die vorhandene ID zurück.
- Statt `segments` darf ein `trackFile: "track.gpx"` referenziert werden
  (ab M6; die Datei kommt wie ein Medium per PUT, der Server parst).

Medien-Binärdaten: `PUT /api/tours/:id/media/:mid` (roher Body, idempotent,
wiederholbar). Danach `POST /api/tours/:id/finalize` → Anreicherung läuft
asynchron (`status: angelegt → verarbeitung → bereit | fehler`).

## Tour-JSON `luhambo/tour@1`

`GET /api/tours/:id` (Sichtbarkeit: `private` nur Owner, `unlisted`/`public`
per Link). Renderer: `server/src/pipeline/enrich.ts`; Player-Adapter:
`src/remote.ts` (`?tour=srv:<id>`).

```json
{
  "schema": "luhambo/tour@1",
  "id": "t_V1kQz9xY",
  "no": "N°07",
  "status": "bereit",
  "brandTitle": "Lauterbrunnen → Grindelwald",
  "kicker": "Aufgezeichnet am 4. Juli 2026",
  "titleHtml": "Lauterbrunnen<br />→ Grindelwald",
  "stops": ["Lauterbrunnen", "Grindelwald"],
  "finaleTitle": "Grindelwald",
  "description": null,
  "time": { "start": "…", "end": "…", "zone": "Europe/Zurich" },
  "timeline": [{ "f": 0.0, "t": "…" }, { "f": 1.0, "t": "…" }],
  "segments": [{ "mode": "walk", "label": "Zu Fuß", "pts": [[7.9086, 46.5934, 802.1]] }],
  "media": [
    { "id": "m1", "type": "photo", "src": "/api/media/t_V1kQz9xY/m1.jpg",
      "title": "Foto · 09:01", "caption": "", "anchor": [7.9105, 46.59],
      "takenAt": "2026-07-04T09:01:12+02:00" }
  ],
  "weather": [{ "f": 0.0, "mode": "clouds", "k": 0.5, "source": "openmeteo" }],
  "stats": { "km": 21.4, "gainM": 1250 }
}
```

- Die Kopf-Felder (`no`…`finaleTitle`) sind bewusst deckungsgleich mit der
  statischen `TOURS`-Registry (`src/tours.js`) — der Adapter reicht sie durch.
- `media` wird im Player zu `cfg.photos`; die vorhandene Anker→`nearestS`→
  Stopp-Gruppierung greift unverändert. `type: video` (M4) zeigt im Foto-Overlay
  ein `<video>`: stumme Autoplay-Wiedergabe, Haltedauer = Videolänge (statt fester
  Foto-Zeit), Ton per Opt-in. `poster` (Standbild) und `durationS` erzeugt die
  Pipeline serverseitig (`server/src/pipeline/video.ts`: ffprobe → Poster; nicht
  web-taugliche Codecs wie HEVC werden nach H.264/AAC 1080p transkodiert und unter
  `src` als `<id>.web.mp4` ausgeliefert, das Original bleibt unangetastet). Die
  Medien-Route liefert Videos mit HTTP-Range-Support (Seeking).
- `timeline` (M2, `server/src/pipeline/zeit.ts`): destillierte Stützstellen
  Streckenanteil→Pseudo-Zeit (stückweise linear, ±45 s genau); Pausen > 15 min
  sind serverseitig auf 2 min komprimiert (sonst springt die Pseudo-Sonne beim
  Überfahren) — die Pseudo-Uhr läuft danach bewusst der echten Zeit hinterher.
  Der Player (`createTimeAt` in `src/remote.ts`) fällt ohne (brauchbare)
  Timeline auf die lineare Interpolation über `time.start/end` zurück.
- `weather` (M2, `server/src/pipeline/weather.ts`): Keyframes aus Open-Meteo-
  Raum-Zeit-Samples (volle Stunde × Streckenposition zu dieser Stunde; Touren
  jünger als ~6 Tage über die Forecast-API, sonst ERA5-Archiv), Median-geglättet
  (ein Modus zählt erst ab 2 Stunden-Samples) und mit Marken vor UND nach jedem
  Wechsel (der Player schaltet auf der Marken-Mitte um). Der Adapter rechnet
  `f` auf km um und speist die VORHANDENE kuratierte Wetter-Timeline des
  Players (`cfg.weather`, Vorrang vor dem Client-Auto-Wetter). `source`
  dokumentiert die Herkunft (`openmeteo` | `photo` ab M5).
- **Bildanalyse (M5, `server/src/pipeline/vision.ts`)**: optional (nur mit
  `OPEN_ROUTER_KEY`). Die Fotos werden per Vision-Sprachmodell (OpenRouter,
  Default `google/gemini-2.5-flash-lite`) klassifiziert (reine
  Klassifikation, keine Medien-Generierung) und übersteuern das API-Wetter LOKAL
  am Foto-Anker — aber nur, wenn das Bild sicher (`himmelSichtbar`,
  Konfidenz ≥ 0.7) **mehr** Wetter zeigt als die API (Rangfolge
  `off < clouds < fog < rain < snow < storm`); ein API-Niederschlag bleibt gegen
  ein „klar"-Foto stehen. Solche Stellen erscheinen als Keyframe-Fenster
  (±0.03 f um den Anker) mit `source: 'photo'`. Ohne Key ist M5 ein No-Op — das
  Wetter ist dann exakt das aus Open-Meteo (M2).
- Fehlt `weather`, greift im Player das Client-Auto-Wetter
  (`src/autoweather.js`) als Fallback — echte `takenAt`/`time`-Werte machen es
  bei aufgezeichneten Touren sofort sinnvoll.
- **Kreativbaukasten-Felder** (aus dem Edit-Overlay gerendert, s. u.; der
  Player ignoriert sie, wenn sie fehlen):
  - `camera: [{f, preset}]` — Kamera-Preset-Keyframes (nah|mittel|weit),
    sortiert nach `f`; gilt ab `f` bis zum nächsten Keyframe. Der Player
    (main.js-Folger) wendet sie über `tour.setPreset` an; ein manueller
    Preset-Klick des Zuschauers übersteuert den Verlauf.
  - `audio: [{type, src, f0, f1, gain?}]` — `music` spielt im Streckenbereich
    [f0, f1) mit weichen Blenden (src/audiotracks.js; ersetzt die statische
    Hintergrundmusik der Tour komplett), `sfx` feuert einmal beim
    Vorwärts-Überfahren von `f0` (f1 == f0). `gain` 0..1 (Default 1).
  - `media[].display: {holdS?, kenBurns?}` — Haltedauer des Foto-Stopps in
    Sekunden (Default 5,2 s) und Ken-Burns-Drift an/aus (Default an);
    für Videos wirkungslos (Haltedauer = Videolänge).

## Edit-Overlay `luhambo/edits@1` (M7)

Alle Bearbeitungen einer Tour leben in EINER Datei `edits.json` neben den
unantastbaren Rohdaten unter `original/` — die Pipeline rendert das Tour-JSON
stets aus Rohdaten + Overlay neu (`PUT /api/tours/:id/edits` speichert und
rendert; `POST /api/tours/:id/reprocess` rendert nur neu, z. B. für frisches
Auto-Wetter — die Edits bleiben dabei erhalten).

```jsonc
{
  "schema": "luhambo/edits@1",
  "medien": {                          // Overrides je Medien-ID des Manifests
    "m3": { "caption": "Neuer Text" },
    "m5": { "anchor": [7.912, 46.51] },// manuell gesetzt → placement "manuell"
    "m7": { "geloescht": true }        // aus der Wiedergabe; Rohdatei bleibt
  },
  "modi": [                            // Fortbewegung ab Zeitpunkt (bis zur nächsten Grenze)
    { "ab": "2026-07-04T10:15:00Z", "mode": "ferry" }
  ],
  "trim": {                            // Track beschneiden (je optional)
    "start": "2026-07-04T08:30:00Z",
    "ende":  "2026-07-04T16:00:00Z"
  }
}
```

Kern-Designentscheid: Edits referenzieren **stabile Anker** — Medien-IDs,
Koordinaten und absolute Zeitstempel, **nie den Streckenanteil `f`**. Ein Trim
verschiebt so keine nachfolgenden Bearbeitungen (Anker hängen an Koordinaten,
Grenzen an Uhrzeiten). Titel/Beschreibung liegen bewusst NICHT im Overlay,
sondern in den DB-Spalten (`PATCH /api/tours/:id`) — eine Quelle der Wahrheit
pro Feld. Anwendungsreihenfolge in der Pipeline (`pipeline/edits.ts`):
Trim → Modus-Grenzen → Auto-Platzierung → Medien-Overrides; Benennung,
Timeline und Wetter rechnen danach auf dem bearbeiteten Track.

Der Studio-Editor holt sich seine Arbeitsgrundlage über
`GET /api/tours/:id/editor` (Owner-only): Original-Track **mit Zeit-Offsets**
(`pts: [lng, lat, ele, tOffsetS]`, vereinfacht), Auto-Platzierung aller Medien
(inklusive gelöschter/unplatzierter; je Medium zusätzlich `gpsAnker` = roher
Manifest-Anker, auch wenn die Platzierung ihn verwarf), die hochgeladenen
Audio-Assets (`audio: [{datei, groesse}]`) und das gespeicherte Overlay.
Bewusste Vereinfachung: Die Auto-Platzierung im Editor rechnet auf dem
**Original-** (untrimmten) Track — beschneidet ein Trim das Umfeld eines
Auto-Ankers, kann das Render-Ergebnis davon abweichen (Medium wird
`unplatziert`); der gerenderte Stand ist immer die Wahrheit des Players.

### Kreativbaukasten (edits@1-Erweiterung)

Drei zusätzliche Overlay-Bereiche, alle mit **absoluten Zeitstempeln** als
Anker (trim-stabil, nie `f`):

```jsonc
{
  "medien": { "m3": { "display": { "holdS": 8, "kenBurns": false } } },
  "kamera": [ { "ab": "2026-07-04T10:00:00Z", "preset": "weit" } ],
  "audio": [
    { "datei": "musik.mp3", "typ": "musik", "ab": "…", "bis": "…", "lautstaerke": 0.8 },
    { "datei": "knall.mp3", "typ": "sfx", "ab": "…" }
  ]
}
```

- `display.holdS` 2..60 s, `kenBurns` boolean; nur bei Fotos wirksam.
- `kamera` (max. 100): Preset ab Zeitpunkt bis zur nächsten Grenze.
- `audio` (max. 50): `musik` mit optionalem `bis` (fehlt = Tour-Ende),
  `sfx` als Einzelschuss (kein `bis`); `lautstaerke` 0..1.

**Audio-Assets** sind KEINE Aufnahme-Medien (nicht im Upload-Manifest),
sondern kreative Zutaten mit eigenem Lebenszyklus:

- `PUT /api/tours/:id/audio/:datei` — roher Body; `datei` =
  `^[A-Za-z0-9_-]{1,64}\.(mp3|m4a|ogg|wav)$`; auch auf `bereit`-Touren
  erlaubt (nur während `verarbeitung` 409). Überschreiben ist verboten
  (409) — die Auslieferung verspricht `immutable`-Caching, neue Version =
  neuer Name. Limit `maxAudioBytes` (Default 25 MB) → 413.
- `DELETE /api/tours/:id/audio/:datei` — löscht das Asset (das Overlay
  bereinigt der Editor beim Speichern; die Pipeline überspringt Einträge
  mit fehlender Datei mit Protokoll-Warnung).
- Ablage unter `media/`, Auslieferung über die normale Medien-Route
  (Range-Support fürs Seeking, korrekte audio/*-Content-Types).

Beim Rendern bildet die Pipeline die Zeit-Anker über `positionZurZeit` auf
den **bearbeiteten** (getrimmten) Track ab: `kamera.ab → camera[].f`,
`audio.ab/bis → f0/f1` (Musik ohne `bis` → f1 = 1; Einträge, die komplett
außerhalb der Wiedergabespanne liegen, entfallen mit Warnung).

## Status- und Fehlerfälle

| Zustand | `GET /api/tours/:id` liefert |
|---|---|
| `angelegt` / `verarbeitung` | `{ id, status }` — Clients pollen |
| `fehler` | `{ id, status: "fehler", fehler: "…" }` |
| `bereit` | das Tour-JSON oben |

Versionierung: Schema-Änderungen erhöhen die `@`-Version. Das Backend darf
alte Manifest-Versionen weiter annehmen (Renderer bleibt kompatibel), der
Player prüft `schema` und meldet Unverständliches sauber (`RemoteTourFehler`).
