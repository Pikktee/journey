# Maptale-Austauschformat

Das Austauschformat ist die Achse zwischen Android-App, CLI-Importer, Web-Studio,
Backend und Player. Es hat zwei Gestalten desselben Schemas:

1. **Upload-Manifest `maptale/upload@2`** — was Clients hochladen (Rohdaten).
2. **Tour-JSON `maptale/tour@2`** — was das Backend daraus rendert und der
   Player abspielt (angereichert).

Dazu tritt das **Edit-Overlay `maptale/edits@2`** — die Bearbeitungen, aus denen
zusammen mit den Rohdaten das Tour-JSON entsteht. Wer wissen will, welche der
drei Dateien wofür zuständig ist und wohin ein neues Feld gehört:
[overlay-und-tourjson.md](overlay-und-tourjson.md).

Grundprinzipien:

- **Rohdaten sind unantastbar.** Der Original-Upload bleibt unter `original/`
  liegen; Bearbeitungen leben in einem Edit-Overlay (`edits.json`, ab M7) und
  referenzieren stabile Anker (Medien-IDs, Koordinaten, Zeitstempel) — nie
  Streckenanteile. Die Pipeline rendert das Tour-JSON jederzeit neu aus
  Rohdaten + Overlay (`POST /api/tours/:id/reprocess`).
- **Streckenpositionen als Bruchteil `f` (0..1), nie Meter.** Der Player baut
  die Route selbst neu auf (Catmull-Rom + 14-m-Resampling in `src/geo.ts`);
  serverseitige Meter würden minimal abweichen. Medien-Anker bleiben
  `[lng, lat]` und laufen clientseitig durch `nearestS`.
  **Damit `f` und Meter dieselbe Stelle meinen, schickt das Tour-JSON je
  ausgeliefertem Wegpunkt sein `f` mit** (`segments[].f`, s. u.). Ohne das war
  die Regel eine halbe: Der Server misst `f` auf der ROHEN Zeitreihe, die Route
  des Players ist 2,2–3,0 % länger — und die Dehnung verteilt sich
  ungleichmäßig, ein Anker lag deshalb bis zu 9 Filmsekunden neben seiner
  Stelle. Nachrechnen kann der Client das nicht: `simplifySegment` wirft
  Punkte weg, die Länge tragen.
  **Die eine begründete Ausnahme ist die FILMSEKUNDE je Ereignis** (`audio[].filmS`
  / `filmToS`, `camera[].filmS`, `moments[].filmS` — E10, s. u.). Sie ist keine
  zweite Streckenangabe, sondern eine andere Größe: Im HALT (Foto-Standzeit,
  Moment, kollabierte Pause) läuft der Film, während die Strecke steht. Ein
  ganzes Film-Intervall fällt dort auf EIN `f` zusammen, und aus diesem `f` ist
  es nicht wieder herauszuholen — ein Klip, der zwei Sekunden in eine
  5,2-s-Standzeit hinein beginnt, setzte sonst an der Halt-Kante ein, und einer,
  der ganz darin liegt, hätte gar keine Länge. Sekunden statt Anteil sind hier
  also nicht Bequemlichkeit, sondern die einzige Parametrisierung, in der die
  Angabe existiert. Die ganze ACHSE zu exportieren bleibt abgelehnt (sie ist
  redundant und teuer, Gleichlauf-Konzept §12); ein bis zwei Zahlen je Ereignis
  decken genau die Stelle ab, an der die Abbildung nicht umkehrbar ist.
- **Unbekannte Felder ignoriert der Player.** Baukasten-Felder (`camera`,
  `audio`, `media[].display`) sind reserviert und ab Tag 1 im Schema erlaubt.

## Upload-Manifest `maptale/upload@2`

`POST /api/tours` (Bearer-Token oder Session), Validierung: `server/src/schema/upload.ts`.

```json
{
  "schema": "maptale/upload@2",
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

- `segments[].pts`: `[lng, lat, ele(m), tOffset(s from time.start)]` — die Zeit
  als 4. Koordinate trägt die nichtlineare Pseudo-Zeit (M2) und die
  Zeit-Platzierung von Medien.
- `mode`: `walk | bike | moped | jeep | tram | ferry` (Tempo + Kameradistanz im Player).
- `media[].source` (optional, nur beim Nachreichen): Herkunfts-Schlüssel des Clients,
  z. B. `galerie:4711`. Er macht `POST /api/tours/:id/media` idempotent — derselbe
  Schlüssel legt keinen zweiten Eintrag an. Der Foto-Nachzug der App setzt ihn, das
  Studio nicht (s. [konzept_medien_nachreichen_und_loeschen.md](../concepts/konzept_medien_nachreichen_und_loeschen.md)).
  Die Liste ist deckungsgleich mit `MODI` in `server/src/schema/upload.ts` und der
  Engine (`MODUS_TEMPO` in `src/filmachse.ts`, `MODE_SCALE` in `src/tour.ts`);
  Motorgeräusche gibt es für
  `moped`, `jeep` und `ferry` (`MODE_SOUND` in `src/vehicle.ts`).
- `title: null` ⇒ Auto-Benennung serverseitig (Reverse-Geocoding Start/Ziel).
- `clientTourId`: idempotentes Anlegen — dieselbe App-Tour erzeugt nie zwei
  Server-Touren; die Antwort liefert die vorhandene ID zurück.
- Statt `segments` darf ein `trackFile: "track.gpx"` referenziert werden
  (ab M6; die Datei kommt wie ein Medium per PUT, der Server parst).

Medien-Binärdaten: `PUT /api/tours/:id/media/:mid` (roher Body, idempotent,
wiederholbar). Danach `POST /api/tours/:id/finalize` → Anreicherung läuft
asynchron (`status: created → processing → ready | failed`).

## Tour-JSON `maptale/tour@2`

`GET /api/tours/:id` (Sichtbarkeit: `private` nur Owner, `unlisted`/`public`
per Link). Renderer: `server/src/pipeline/enrich.ts`; Player-Adapter:
`src/remote.ts` (`?tour=srv:<id>`).

```json
{
  "schema": "maptale/tour@2",
  "id": "t_V1kQz9xY",
  "no": "N°07",
  "status": "ready",
  "brandTitle": "Lauterbrunnen → Grindelwald",
  "kicker": "Lauterbrunnen",
  "titleHtml": "Lauterbrunnen<br />→ Grindelwald",
  "stops": ["Lauterbrunnen", "Grindelwald"],
  "showFinale": false,
  "finaleTitle": "Grindelwald",
  "description": null,
  "author": { "anzeigename": "Henrik", "avatarUrl": null, "id": "u_…", "handle": "henrik" },
  "time": { "start": "…", "end": "…", "zone": "Europe/Zurich" },
  "timeline": [{ "f": 0.0, "t": "…" }, { "f": 1.0, "t": "…" }],
  "segments": [{ "mode": "walk", "label": "Zu Fuß", "pts": [[7.9086, 46.5934, 802.1]], "f": [0.0] }],
  "media": [
    { "id": "m1", "type": "photo", "src": "/api/media/t_V1kQz9xY/m1.w1920.jpg",
      "thumb": "/api/media/t_V1kQz9xY/m1.t480.jpg",
      "title": "", "caption": "", "anchor": [7.9105, 46.59],
      "takenAt": "2026-07-04T09:01:12+02:00" }
  ],
  "weather": [{ "f": 0.0, "mode": "clouds", "k": 0.5, "source": "openmeteo" }],
  "stats": { "km": 21.4, "gainM": 1250 }
}
```

- **Eine Aufnahme trägt genau EINEN Text: `title`.** Er ist der Nutzertext aus
  dem Studio, sonst leer. Bis 2026-08-18 setzte die Pipeline dort „Foto · 09:01"
  ein und schob die Uhrzeit nach `caption` — beides ist entfallen: Die Gattung
  sieht man dem Bild an, und die Uhrzeit ist eine Angabe, die der Player aus
  `takenAt` neben den Kilometerstand setzt (in der Zone der Tour, und nur wenn
  sie in `time` liegt). **`caption` bleibt im Schema und ist immer leer** — die
  Foto-Karte hat keine Bildunterschrift mehr. Ein Halt steht 5,2 Sekunden, die
  kuratierten Beschreibungen waren im Median 84 Zeichen lang: Wer sie las, sah
  das Bild nicht. Bestandstouren tragen ihre alten Texte, bis sie neu gerendert
  werden.

- **`kicker` ist die Dachzeile über dem Titel und kommt aus einem FELD**
  (`tours.kicker`), nicht mehr aus einem erzeugten Satz. Bis 2026-08-18 stand
  dort „Aufgezeichnet am 4. Juli 2026"; das Datum steht jetzt in der
  Herkunftszeile neben dem Namen des Aufnehmers. Drei Zustände: Spalte `NULL` =
  nie gesetzt, dann nimmt `buildNaming` die Vorbelegung (bei einer Rundtour den
  Startort, sonst nichts); leerer String = ausdrücklich keine Zeile; sonst der
  Text. Ohne die Unterscheidung ließe sich eine einmal gesetzte Zeile nie wieder
  loswerden. Die Vorschläge im Studio (`kickerSuggestions` im Editor-
  Datensatz) sind die Adress-Ebenen des Startpunkts aus dem Anreicherungs-Cache
  — dieselbe Geocoder-Antwort, aus der schon der Ortsname stammt.
- **`author` steht NICHT in der gerenderten Datei.** Die Route setzt ihn bei jeder
  Auslieferung frisch aus der Datenbank ein: Ein eingebackener Name wäre nach dem
  nächsten Wechsel falsch, und ein Re-Render aller Touren dafür unverhältnismäßig.
  Er fehlt ganz, wenn niemand einen Anzeigenamen gesetzt hat (dann bleibt die
  Tour anonym, statt ersatzweise Klarname oder Mailadresse zu zeigen); `id` und
  `handle` kommen nur bei öffentlichem Profil dazu, sonst gibt es keine Seite,
  auf die der Name führen könnte. Dieselbe Linie wie die Galerie-Karte.
- **`description` ist auf 150 Zeichen ausgelegt** (`BESCHREIBUNG_MAX` in
  `src/tourtexte.ts`). Das Schema erlaubt weiter 5000 — Bestandstexte sollen
  nicht abgelehnt werden —, das Studio-Feld begrenzt neue Eingaben, und der
  Startscreen kürzt Längeres an der Wortgrenze. Unter 150 bleibt der Text auch in
  der Vorschaukarte geteilter Links ungekürzt (die kürzt bei 200).
- Die Kopf-Felder (`no`…`finaleTitle`) sind bewusst deckungsgleich mit der
  statischen `TOURS`-Registry (`src/tours.ts`) — der Adapter reicht sie durch.
  `showFinale` steuert den Endscreen: `false` (Default bei aufgezeichneten
  Touren) → Player kehrt zum Startscreen zurück; `true` → „Ziel erreicht" mit
  `finaleTitle`. Kuratierte Demo-Touren setzen `showFinale: true`.
- `media` wird im Player zu `cfg.photos`; die vorhandene Anker→`nearestS`→
  Stopp-Gruppierung greift unverändert. `type: video` (M4) zeigt im Foto-Overlay
  ein `<video>`: stumme Autoplay-Wiedergabe, Haltedauer = Videolänge (statt fester
  Foto-Zeit), Ton per Opt-in. `poster` (Standbild) und `durationS` erzeugt die
  Pipeline serverseitig (`server/src/pipeline/video.ts`: ffprobe → Poster; nicht
  web-taugliche Codecs wie HEVC werden nach H.264/AAC 1080p transkodiert und unter
  `src` als `<id>.web.mp4` ausgeliefert — das Original wird danach VERWORFEN, s.
  „Abgeleitete Fassungen"). Die Medien-Route liefert Videos mit
  HTTP-Range-Support (Seeking).
- **Abgeleitete Fassungen** (`server/src/pipeline/bild.ts`): `src` zeigt bei
  Fotos auf die Anzeige-Fassung `<id>.w1920.jpg` (längste Kante 1920), `thumb`
  auf die Kachel-Fassung `<id>.t480.jpg` für Listen, Zeitleiste und Pin-Köpfe.
  Das hochgeladene Original wird nach dem Erzeugen verworfen — es kostete an
  einer echten Tour das Neunfache dessen, was je ausgeliefert wurde. Videos
  bekommen nur `thumb` (aus dem Poster). `thumb` FEHLT bei Touren, die vor der
  Umstellung gerendert wurden und den Start-Nachtrag noch nicht durchlaufen
  haben (`server/src/pipeline/bildnachtrag.ts`) — jede Anzeige braucht deshalb
  einen Rückfall auf `src`.
- `segments[].f` (**additiv**, `maptale/tour@2` bleibt): Streckenanteil je Punkt
  von `pts`, auf der ROHEN Geometrie gemessen — parallele Liste, gleiche Länge.
  Der Player baut daraus mit `route.wpS` (`src/geo.ts`) eine Tabelle und
  übersetzt JEDEN `f`-Anker der Tour EINMAL beim Laden nach Streckenmetern
  (`src/streckenanker.ts`); danach rechnet er nur noch in Metern. Betroffen sind
  `audio[].f0/f1`, `camera[].f`, `moments[].f`, `weather[].f` und `timeline[].f`.
  Drei Dinge hängen daran:
  - **Fehlt das Feld, fällt der Player auf `f × route.total` zurück** — das ist
    kein Notbehelf, sondern exakt sein Verhalten von vorher. Touren, die vor
    dieser Erweiterung gerendert wurden, bekommen es bei ihrem nächsten Render.
  - **Kuratierte Touren (`src/tours.ts`) bekommen es NIE** — sie sind eine Datei
    mit Wegpunkten, keine Aufzeichnung. Für sie ist der Rückfall dauerhaft.
  - **Der Nahtpunkt zweier Segmente steht doppelt** (einmal als letzter Punkt,
    einmal als erster des nächsten) und trägt beide Male denselben Wert; der
    Player wirft die Kopie mit `slice(1)` weg und muss die `f`-Liste dabei
    mitziehen.
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
  Geschickt wird die **Kachel-Fassung** (480 px) und in bis zu
  `BILDANALYSE_PARALLEL` gleichzeitigen Aufrufen: Der Block war sequenziell über
  90 % der Verarbeitungszeit (30 Fotos: 66 s → 11 s). Kosten sind kein Faktor —
  gemessen $0,0002 je Foto, also rund 0,4 Cent für eine Tour mit 20 Fotos.
- Fehlt `weather`, greift im Player das Client-Auto-Wetter
  (`src/autoweather.ts`) als Fallback — echte `takenAt`/`time`-Werte machen es
  bei aufgezeichneten Touren sofort sinnvoll.
- **Kreativbaukasten-Felder** (aus dem Edit-Overlay gerendert, s. u.; der
  Player ignoriert sie, wenn sie fehlen):
  - `camera: [{f, preset, filmS?}]` — Kamera-Preset-Keyframes (nah|mittel|weit|standard),
    sortiert nach `f`; gilt ab dieser Stelle bis zum nächsten Keyframe. Der Player
    (main.js-Folger) wendet sie über `tour.setPreset` an; ein manueller
    Preset-Klick des Zuschauers übersteuert den Verlauf. `default` ist der
    Wert für „keine Vorgabe": Der Folger setzt dort den Abstand zurück, den der
    Zuschauer eingestellt hat (dasselbe wie vor dem ersten Keyframe), und eine
    `scale` bleibt dabei außen vor — sie gehört zu einem gewählten Abstand.
    `PRESETS` in src/tour.js kennt ihn NICHT; er wird im Folger übersetzt.
  - `audio: [{type, src, f0, f1, gain?, filmS?, filmToS?}]` — `music` spielt im
    Bereich [Beginn, Ende) mit weichen Blenden (src/audiotracks.ts; ersetzt die
    statische Hintergrundmusik der Tour komplett), `sfx` feuert einmal beim
    Vorwärts-Überfahren seines Beginns. `gain` 0..1 (Default 1).
  - **Die Film-Anker `filmS` / `filmToS` (additiv, E10) gehen `f0`/`f1` vor.**
    Der Player rechnet in Filmsekunden, nicht im Streckenanteil — je Endpunkt
    einzeln: Wo `filmS` steht, gilt es; wo es fehlt, rechnet er die Filmsekunde
    aus `f0` über die Filmachse. `filmToS` steht nur bei einem BEREICH — ein
    One-Shot hat keine Länge, und dasselbe gilt für `camera[].filmS` und
    `moments[].filmS` (dort ist es eine Auskunft: Einen Moment verankert der
    Player weiter an `f`, weil die Filmachse AUS den Momenten gebaut wird).
    Gerundet auf 8 Nachkommastellen, wie `segments[].f` und aus demselben Grund.
    Kuratierte Touren (`src/tours.ts`) tragen die Felder nie; Touren, die vor
    E10 gerendert wurden, bekommen sie beim nächsten Render — bis dahin klingen
    sie unverändert.
  - `media[].display: {holdS?, kenBurns?}` — Haltedauer des Foto-Stopps in
    Sekunden (Default 5,2 s) und Ken-Burns-Drift an/aus (Default an);
    für Videos wirkungslos (Haltedauer = Videolänge).

## Edit-Overlay `maptale/edits@2` (M7)

Alle Bearbeitungen einer Tour leben in EINER Datei `edits.json` neben den
unantastbaren Rohdaten unter `original/` — die Pipeline rendert das Tour-JSON
stets aus Rohdaten + Overlay neu (`PUT /api/tours/:id/edits` speichert und
rendert; `POST /api/tours/:id/reprocess` rendert nur neu, z. B. für frisches
Auto-Wetter — die Edits bleiben dabei erhalten).

```jsonc
{
  "schema": "maptale/edits@2",
  "media": {                          // Overrides je Medien-ID des Manifests
    "m3": { "caption": "Neuer Text" },
    "m5": { "anchor": [7.912, 46.51] },// von Hand gesetzt → placement "manual"
    "m7": { "removed": true }        // aus der Wiedergabe; Rohdatei bleibt
  },
  "travelModes": [                            // Fortbewegung ab Zeitpunkt (bis zur nächsten Grenze)
    { "from": "2026-07-04T10:15:00Z", "mode": "ferry" }
  ],
  "trim": {                            // Track beschneiden (je optional)
    "start": "2026-07-04T08:30:00Z",
    "end":  "2026-07-04T16:00:00Z"
  }
}
```

Kern-Designentscheid: Edits referenzieren **stabile Anker** — Medien-IDs,
Koordinaten und absolute Zeitstempel, **nie den Streckenanteil `f`**. Ein Trim
verschiebt so keine nachfolgenden Bearbeitungen (Anker hängen an Koordinaten,
Grenzen an Uhrzeiten). Titel, Beschreibung und Endscreen (`finale` /
`finale_target`) liegen bewusst NICHT im Overlay, sondern in den DB-Spalten
(`PATCH /api/tours/:id`) — eine Quelle der Wahrheit pro Feld.
Anwendungsreihenfolge in der Pipeline (`pipeline/edits.ts`):
Trim → Modus-Grenzen → Auto-Platzierung → Medien-Overrides; Benennung,
Timeline und Wetter rechnen danach auf dem bearbeiteten Track.

Der Studio-Editor holt sich seine Arbeitsgrundlage über
`GET /api/tours/:id/editor` (Owner-only): Original-Track **mit Zeit-Offsets**
(`pts: [lng, lat, ele, tOffsetS]`, vereinfacht), Auto-Platzierung aller Medien
(inklusive gelöschter/unplatzierter; je Medium zusätzlich `gpsAnchor` = roher
Manifest-Anker, auch wenn die Platzierung ihn verwarf), die hochgeladenen
Audio-Assets (`audio: [{file, size}]`) und das gespeicherte Overlay.
Bewusste Vereinfachung: Die Auto-Platzierung im Editor rechnet auf dem
**Original-** (untrimmten) Track — beschneidet ein Trim das Umfeld eines
Auto-Ankers, kann das Render-Ergebnis davon abweichen (Medium wird
`unplaced`); der gerenderte Stand ist immer die Wahrheit des Players.

### Kreativbaukasten (edits@2-Erweiterung)

Drei zusätzliche Overlay-Bereiche, alle mit **absoluten Zeitstempeln** als
Anker (trim-stabil, nie `f`):

```jsonc
{
  "media": { "m3": { "display": { "holdS": 8, "kenBurns": false } } },
  "camera": [ { "from": "2026-07-04T10:00:00Z", "preset": "far" } ],
  "audio": [
    { "file": "musik.mp3", "type": "music", "from": "…", "to": "…", "volume": 0.8 },
    { "file": "knall.mp3", "type": "sfx", "from": "…" }
  ]
}
```

- `display.holdS` 2..60 s, `kenBurns` boolean; nur bei Fotos wirksam.
- `camera` (max. 100): Preset ab Zeitpunkt bis zur nächsten Grenze.
- `audio` (max. 50): `music` mit optionalem `to` (fehlt = Tour-Ende),
  `sfx` als Einzelschuss (kein `to`); `volume` 0..1.

**Audio-Assets** sind KEINE Aufnahme-Medien (nicht im Upload-Manifest),
sondern kreative Zutaten mit eigenem Lebenszyklus:

- `PUT /api/tours/:id/audio/:file` — roher Body; `file` =
  `^[A-Za-z0-9_-]{1,64}\.(mp3|m4a|ogg|wav)$`; auch auf `ready`-Touren
  erlaubt (nur während `processing` 409). Überschreiben ist verboten
  (409) — die Auslieferung verspricht `immutable`-Caching, neue Version =
  neuer Name. Limit `maxAudioBytes` (Default 25 MB) → 413.
- `DELETE /api/tours/:id/audio/:file` — löscht das Asset (das Overlay
  bereinigt der Editor beim Speichern; die Pipeline überspringt Einträge
  mit fehlender Datei mit Protokoll-Warnung).
- Ablage unter `media/`, Auslieferung über die normale Medien-Route
  (Range-Support fürs Seeking, korrekte audio/*-Content-Types).

Beim Rendern bildet die Pipeline die Zeit-Anker über `positionAtTime` auf
den **bearbeiteten** (getrimmten) Track ab: `camera.from → camera[].f`,
`audio.from/to → f0/f1` (Musik ohne `to` → f1 = 1; Einträge, die komplett
außerhalb der Wiedergabespanne liegen, entfallen mit Warnung). Parallel dazu
läuft dieselbe Abbildung über die **Film-Achse** (`server/src/pipeline/filmachse.ts`,
Spiegel von `src/filmachse.ts`) und liefert die Film-Anker. „Komplett außerhalb"
wird seit E10 in FILMZEIT geprüft: Ein Klip ganz in einer Standzeit hat dort
sehr wohl eine Länge und bleibt — vorher fiel genau er heraus.

## Status- und Fehlerfälle

| Zustand | `GET /api/tours/:id` liefert |
|---|---|
| `created` / `processing` | `{ id, status }` — Clients pollen |
| `failed` | `{ id, status: "failed", error: "…" }` |
| `ready` | das Tour-JSON oben |

Versionierung: Schema-Änderungen erhöhen die `@`-Version. Das Backend nimmt
GENAU die aktuelle an; ältere werden mit einem Hinweis abgelehnt (400 mit dem
Satz „Diese App-Version ist zu alt für den Server …", s. u.). Der Player prüft
`schema` und meldet Unverständliches sauber (`RemoteTourFehler`).

**Die Ablehnung trägt ihren Text zweimal** — als `error` UND als `fehler`. Sie
ist die eine Stelle, an der ein Client antwortet, der die Umbenennung nicht
kennen KANN: eine installierte App, die noch `maptale/upload@1` schickt und
darum den Fehlertext unter dem alten Namen sucht. Überall sonst gibt es kein
zweites Feld und keinen Rückwärtsleser.
