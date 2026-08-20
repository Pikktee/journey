# Overlay und Tour-JSON — wer sagt was?

Im Verzeichnis einer Tour liegen vier Dinge nebeneinander, die leicht
verwechselt werden. Wer sie verwechselt, schreibt an die falsche Stelle: Die
Änderung ist dann beim nächsten Rendern weg, im Studio unsichtbar oder nicht
mehr löschbar. Dieses Dokument beantwortet die eine Frage, die dabei zählt —
**wohin gehört das?**

Die Formate selbst (Felder, Enums, Validierung) stehen in
[austauschformat.md](austauschformat.md); hier geht es um die Rollenverteilung.

```
daten/tours/<id>/
├── original/manifest.json      Rohdaten — was das Gerät hochgeladen hat
├── original/track.gpx          Rohdaten — die aufgezeichnete Spur
├── media/                      Rohdaten — Fotos, Videos, hochgeladene Audios
├── edits.json                  DAS OVERLAY — was jemand entschieden hat
├── anreicherung.json           Zwischenspeicher — teuer beschaffte Ergebnisse
└── tour.json                   DAS ERGEBNIS — was der Player abspielt
```

## Die drei Rollen

**Rohdaten sind unantastbar.** Sie werden einmal hochgeladen und nie wieder
angefasst — auch nicht beim Bearbeiten. Deshalb ist jede Bearbeitung
verlustfrei rücknehmbar: Man wirft das Overlay weg und hat wieder den
Originalzustand.

**Das Overlay (`edits.json`) ist die Absicht.** Es enthält ausschließlich, was
ein Mensch entschieden hat: Foto-Titel, verschobene Anker, Modus-Grenzen,
Kamera-Presets, Musik, Wetterkorrekturen. Nichts Abgeleitetes, nichts
Ausgerechnetes. Geschrieben wird es fast nur an einer Stelle:
`PUT /api/tours/:id/edits` ([server/src/routes/tours.ts](../../server/src/routes/tours.ts)).
Die einzige Ausnahme ist die Auto-Musik beim allerersten Verarbeiten (s. unten) —
und die ist bewusst so gebaut, dass sie sich nie wiederholt.

**Das Tour-JSON (`tour.json`) ist das Erzeugnis.** Der Server rendert es aus
`Rohdaten + Overlay` und **überschreibt dabei die ganze Datei**. Es ist das
einzige, was der Player lädt — mit fertiger Route, Zeitleiste, Wetter-Keyframes,
aufgelösten URLs und Statistik.

Dazu kommt **`anreicherung.json`**: weder Quelle noch Ergebnis, sondern ein
Cache für das, was Geld oder Zeit kostet — Ortsnamen (Nominatim), Auto-Wetter
(Open-Meteo), Foto-Bildanalyse, Video-Metadaten. Ohne ihn liefe bei jedem
Speichern eines Edits die komplette externe Beschaffung erneut. Invalidiert wird
er nur von der Trim-Signatur; ein Wetter- oder Musik-Edit lässt ihn gültig.

## Dieselbe Musik in beiden Dateien

Ein reales Beispiel — dasselbe Musikstück, links wie es gespeichert ist, rechts
wie es gerendert ankommt:

```jsonc
// edits.json — 190 Bytes, die GANZE Datei
{
  "schema": "maptale/edits@2",
  "audio": [
    {
      "file": "mus-regentag.mp3",
      "type": "music",
      "from": "2026-05-14T13:17:19+02:00",
      "source": "library"
    }
  ]
}
```

```jsonc
// tour.json — 7.924 Bytes; das hier ist der Audio-Teil daraus
"audio": [
  { "type": "music", "src": "/audio/sfx/mus-regentag.mp3", "f0": 0, "f1": 1 }
]
```

| Overlay | Tour-JSON | Warum verschieden |
|---|---|---|
| `file` + `source: library` | `src: /audio/sfx/…` | Die URL hängt davon ab, ob die Datei global ausgeliefert wird oder unter `media/` der Tour liegt — eine Render-Entscheidung |
| `from: 2026-05-14T13:17:19+02:00` | `f0: 0, f1: 1` | **Der Kern:** absoluter Zeitpunkt vs. Streckenanteil |

## Absolute Anker im Overlay, `f` im Tour-JSON

Das ist die wichtigste Regel, und sie ist keine Stilfrage.

`f` (0…1) ist **abgeleitet**: Es bedeutet „40 % der Strecke". Trimmt jemand die
Tour, verschiebt einen Foto-Anker oder vereinfacht der Server den Track anders,
zeigt dasselbe `f` plötzlich auf einen anderen Ort. Ein Overlay mit `f` würde
also bei jedem Render leise verrutschen.

Ein Zeitstempel (`2026-05-14T13:17:19+02:00`) und eine Medien-ID (`m3`)
bedeuten dagegen immer dasselbe. Deshalb gilt: **im Overlay nie `f`** — nur
Medien-IDs, Koordinaten und absolute ISO-Zeitstempel. Die Umrechnung in `f`
macht die Pipeline bei jedem Render neu
([positionZurZeit](../../server/src/pipeline/zeit.ts)).

Aus demselben Grund zeigt die Zeitleiste im Studio **Aufnahmezeit** und nicht
Streckenanteil: Was man dort anfasst, wird direkt zum Anker im Overlay.

## Wohin gehört ein neues Feld?

Beim Erweitern hilft eine Frage: **Kann ein Mensch das entscheiden?**

- **Ja** → ins Overlay. Beispiele: Titel eines Fotos, Standzeit, Kamera-Preset,
  Reihenfolge im Stopp (`order`), Wetterkorrektur. Damit taucht es im Studio auf
  und ist änder- und löschbar.
- **Nein, das rechnet die Pipeline aus** → nur ins Tour-JSON. Beispiele:
  Streckenanteile, Höhenprofil, Routen-Signatur, Kilometer.
- **Nein, aber es kostet einen externen Aufruf** → zusätzlich in den
  Anreicherungs-Cache, damit das nächste Edit ihn nicht erneut auslöst.

### Tour-weite Meta (Titel, Beschreibung, Endscreen)

Titel, Beschreibung und der optionale Endscreen (`finale` / `finale_target`)
liegen wie bisher in den **DB-Spalten** und werden per `PATCH /api/tours/:id`
gesetzt — nicht im Overlay. Die Pipeline liest sie als Overrides und schreibt
`showFinale` / `finaleTitle` ins Tour-JSON.

### Der Grenzfall: automatisch erzeugt, aber änderbar

Auto-Wetter und Auto-Musik sind beides. Die Regel dafür: **Was jemand
überstimmen können soll, muss ins Overlay** — sonst gibt es keinen Ort, an dem
das Überstimmen stehen könnte.

- **Auto-Musik** schreibt die Pipeline beim allerersten Verarbeiten ins Overlay
  ([musikwahl.ts](../../server/src/pipeline/musikwahl.ts)) und rührt es danach nie
  wieder an. Läge sie nur im Tour-JSON, wäre sie im Studio unsichtbar und
  unlöschbar — die Pipeline schriebe sie bei jedem Render zurück. Man bräuchte
  dann ein „diesmal wirklich keine Musik"-Flag, also doch wieder ein Overlay.
- **Auto-Wetter** bleibt dagegen im Tour-JSON, bis jemand eingreift: Der Editor
  bekommt es über `/api/tours/:id/editor` als `autoWeather` nur zur Anzeige und
  schreibt es erst beim ersten eigenen Eingriff fest (`schreibeWetterFest`).
  Grund: `edits.weather` ersetzt das Auto-Wetter der ganzen Tour vollständig —
  ohne dieses Festschreiben würde eine einzelne Korrektur den Rest der Tour
  schlagartig gleichmachen.

Dasselbe Muster trägt `materialisiereModi` bei der Fortbewegung: Die vom Server
erkannten Gehabschnitte werden erst dann zu echten Grenzen im Overlay, wenn
jemand die erste davon anfasst.

## Fallstricke

- **Ins Tour-JSON schreiben nützt nichts.** Es wird bei jedem Speichern,
  `finalize` und `reprocess` komplett neu erzeugt.
- **Ein Overlay-Feld ohne Schema wird still verschluckt.** Fastifys Ajv läuft
  mit `removeAdditional` — unbekannte Felder verschwinden beim `PUT`, ohne
  Fehlermeldung. Neue Felder gehören immer auch ins JSON-Schema in
  [server/src/schema/edits.ts](../../server/src/schema/edits.ts).
- **Der Editor liest nicht das Tour-JSON.** Er lädt `/api/tours/:id/editor`
  (Rohdaten-Segmente + Overlay). Was nur gerendert existiert, kann er nicht
  anzeigen — und schon gar nicht bearbeiten.
