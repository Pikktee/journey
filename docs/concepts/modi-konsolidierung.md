# Umbauplan: Fortbewegungs-Modi konsolidieren

**Ziel:** Ein neuer Modus (z. B. `car`, `run`, `train`, `ski`) soll im Web **eine Zeile**
kosten statt acht verstreute Einträge — und die Maschine soll sagen, welche zwei Wörter
in Server und App noch fehlen.

Stand: **2026-07-27**, nichts davon umgesetzt. Voraussetzung für den Ausbau der
Modus-Liste in [editor-ausbau.md](editor-ausbau.md), Abschnitt 9.

> Früher unter `docs/architecture/` — dort falsch, weil noch nicht gebaut.

---

## Bestandsaufnahme: wo ein Modus heute steht

**Web — 8 Stellen:**

| # | Fundstelle | Inhalt |
|---|---|---|
| 1 | [tour.js:62](../../src/tour.js#L62) | `MODE_SPEED` — Tempo-Faktor |
| 2 | [tour.js:63](../../src/tour.js#L63) | `MODE_SCALE` — `{behind, hover}` Kameradistanz |
| 3 | [map.js:483](../../src/map.ts#L483) | `MODE_ICONS` — SVG-Markup des Fahrer-Markers |
| 4 | [studio.html](../../studio.html) | `<symbol id="i-m-*">` — **dieselben Icons ein zweites Mal** (6 Symbole) |
| 5 | [vehicle.js:11](../../src/vehicle.ts#L11) | `MODE_SOUND` — Motorloop-Dateiname |
| 6 | [editmodell.ts:17](../../src/studio/editmodell.ts#L17) | `MODI` + `type Modus` — Kopie der Server-Liste |
| 7 | [editor.ts:95](../../src/studio/editor.ts#L95) | `MODUS_NAMEN` — Anzeigenamen |
| 8 | [editor.ts:104](../../src/studio/editor.ts#L104) | `MODUS_FARBEN` — Bandfarben der Zeitleiste |

**Außerhalb des Webs — 2 Stellen:**

| # | Fundstelle | Inhalt |
|---|---|---|
| 9 | [upload.ts:13](../../server/src/schema/upload.ts#L13) | `MODI` — Typ + JSON-Schema-Enums |
| 10 | [Entities.kt:14](../../android/app/src/main/java/app/maptale/daten/Entities.kt#L14) | Kotlin-Enum: Schlüssel + Anzeigename |

**Wächter:** vier Tests in [studio-baukasten.test.ts](../../test/studio-baukasten.test.ts)
(ab „describe('Fortbewegungs-Modi')") vergleichen per Regex über den Quelltext:
`MODE_SPEED`-Deckung, Tempo-Faktoren gegen `schaetzeAnimationsdauer`, `MODE_SCALE`-Deckung
und die `d="…"`-Pfade von `MODE_ICONS` gegen den Sprite in `studio.html`.

---

## Warum die Quelle im Web liegen muss (und nicht im Server)

Die Grenze zwischen den Paketen ist **einseitig**:

- `server/tsconfig.json`: `rootDir: "."`, `include: ["src/**/*.ts", …]`;
  `server/Dockerfile` kopiert nur `package.json`, `tsconfig*.json` und `src`.
  → **Der Server kann nichts aus `/src` sehen.** Ein `shared/`-Ordner darüber würde
  Docker-Kontext, `rootDir` und damit das `dist/`-Layout verschieben.
- Umgekehrt kann Vite problemlos aus `server/src/…` importieren.

Die **Substanz** eines Modus (Tempo, Kameraskala, Icon, Ton, Farbe, Name) liegt aber
komplett im Web; der Server braucht nur die Schlüsselmenge fürs JSON-Schema, Android nur
Schlüssel + Anzeigename. Deshalb:

> **Stufe 1 macht das Web zur einen Quelle. Server und App behalten ihre je eine Zeile,
> und ein geschärfter Wächter sagt, wenn sie fehlt.**

Stufe 2 (geteilte JSON) und Stufe 3 (App lädt den Katalog) sind optionale Nachträge —
sie lohnen erst, wenn Modi ohne Play-Store-Update ausrollbar sein sollen.

---

## Stufe 1 — die acht Web-Stellen zu einer machen

### Schritt 0: Rauchtest der Modul-Auflösung (5 Minuten, vor allem anderen)

`tour.js`, `map.js` und `vehicle.js` sind **reines JavaScript**, und das Root-`tsconfig.json`
hat `allowJs: false` (include nur `src/**/*.ts`, `test/**/*.ts`). Zu klären ist nur, wie
eine `.ts`-Datei aus einer `.js`-Datei importiert wird:

```js
// in src/tour.js probeweise:
import { MODUS } from './modi.ts'      // Variante A
import { MODUS } from './modi'         // Variante B (ohne Endung)
```

Danach `npm run dev` **und** `npm run build` — beide müssen durchlaufen. Die im Repo
übliche `.js`-Endung (`'./geo.js'`) löst **nicht** zuverlässig auf `.ts` auf.

**Fällt der Test aus:** Fallback auf das Muster, das für `audiotracks.js` bereits
funktioniert — `src/modi.js` (reines JS) plus handgeschriebene `src/modi.d.ts`. Kostet
ein kleines Typ-Duplikat, dafür null Auflösungsrisiko.

### Schritt 1: `src/modi.ts` anlegen

Eine Tabelle, ein Eintrag pro Modus, alles beisammen:

```ts
/**
 * Die eine Quelle für Fortbewegungs-Modi im Web. Reihenfolge = Reihenfolge der
 * Auswahl-Listen im Studio: unmotorisiert → motorisiert → öffentlich → Wasser.
 * Server (server/src/schema/upload.ts) und App (Entities.kt) führen die
 * Schlüssel eigenständig; der Drift-Wächter in test/studio-baukasten.test.ts
 * prüft die Deckung.
 */
export interface ModusEintrag {
  name: string                          // Anzeigename („Zu Fuß")
  speed: number                         // Tempo-Faktor (war MODE_SPEED)
  scale: { behind: number; hover: number }  // Kameradistanz (war MODE_SCALE)
  sound: string | null                  // Motorloop unter /audio (war MODE_SOUND)
  farbe: string                         // Band im Editor (war MODUS_FARBEN)
  icon: string                          // SVG-Innenmarkup (war MODE_ICONS)
}

export const MODUS = {
  walk:  { name: 'Zu Fuß', speed: 0.4,  scale: { behind: 0.5,  hover: 0.68 }, sound: null,        farbe: '#3ecf8e', icon: `…` },
  bike:  { name: 'Rad',    speed: 1,    scale: { behind: 1,    hover: 1    }, sound: null,        farbe: '#5b9dff', icon: `…` },
  moped: { name: 'Moped',  speed: 1.15, scale: { behind: 0.95, hover: 1    }, sound: 'eng-moped', farbe: '#ff6f52', icon: `…` },
  jeep:  { name: 'Jeep',   speed: 1.45, scale: { behind: 1.25, hover: 1.25 }, sound: 'eng-jeep',  farbe: '#b98a5a', icon: `…` },
  tram:  { name: 'Tram',   speed: 1.25, scale: { behind: 1.15, hover: 1.2  }, sound: null,        farbe: '#f5a524', icon: `…` },
  ferry: { name: 'Fähre',  speed: 2.5,  scale: { behind: 2.3,  hover: 2.2  }, sound: 'eng-boat',  farbe: '#c58bff', icon: `…` },
} as const satisfies Record<string, ModusEintrag>

export const MODI = Object.keys(MODUS) as (keyof typeof MODUS)[]
export type Modus = keyof typeof MODUS
```

**Falle — Reihenfolge:** `MODI` in [editmodell.ts:17](../../src/studio/editmodell.ts#L17)
(`walk, bike, moped, …`) und in [upload.ts:13](../../server/src/schema/upload.ts#L13)
(`walk, moped, bike, …`) stehen heute **unterschiedlich**. Maßgeblich für die neue
Tabelle ist die Reihenfolge von `MODUS_NAMEN` — sie steuert die Auswahl-Listen
(`Object.entries`). Der Wächter muss deshalb **sortiert** vergleichen (tut er bereits).

**Falle — Werte übernehmen, nicht neu erfinden:** Die Zahlen oben sind aus dem Ist-Stand
abgeschrieben. Beim Umbau eins zu eins übernehmen; jede Abweichung ändert das Erlebnis
und bricht den Tempo-Faktor-Test.

### Schritt 2–4: Player umstellen

- **[tour.js:62-70](../../src/tour.js#L62)** — `MODE_SPEED`/`MODE_SCALE` löschen, aus
  `MODUS` lesen. Die Zugriffe stehen u. a. bei
  [tour.js:845](../../src/tour.js#L845) („Kameradistanz an den Fortbewegungsmodus anpassen").
- **[map.js:483](../../src/map.ts#L483)** — `MODE_ICONS` löschen. **Achtung:** `MODE_ICONS`
  ist `export`iert und wird anderswo benutzt; entweder Re-Export aus `modi.ts` beibehalten
  oder alle Aufrufer mitziehen. `setRiderIcon`/`createRider` nutzen den Fallback
  `MODE_ICONS[mode] ?? MODE_ICONS.bike` — der bleibt sinnvoll.
- **[vehicle.js:11](../../src/vehicle.ts#L11)** — `MODE_SOUND` löschen; `sound: null`
  bedeutet Stille (heute: Modus fehlt in der Tabelle). Die Logik in
  [vehicle.js:43](../../src/vehicle.ts#L43) (`?? null`) funktioniert unverändert.

### Schritt 5: Studio umstellen

- **[editmodell.ts:17-19](../../src/studio/editmodell.ts#L17)** — `MODI` und `type Modus`
  löschen, aus `modi.ts` re-exportieren (damit die vielen Importe in `editor.ts` und den
  Tests unverändert bleiben). `WETTER_MODI` bleibt unangetastet — das ist ein eigenes
  Thema mit eigenem Wächter.
- **[editor.ts:95-111](../../src/studio/editor.ts#L95)** — `MODUS_NAMEN` und `MODUS_FARBEN`
  löschen; die vier Verwendungsstellen (Zeilen ~1184, ~1637, ~3034, ~3059) auf
  `MODUS[m].name` / `MODUS[m].farbe` umstellen.

### Schritt 6: Studio-Sprite zur Laufzeit bauen

`studio.html` enthält sechs `<symbol id="i-m-walk">…` — dieselben Pfade wie in
`MODE_ICONS`, von Hand gedoppelt. Diese Symbole aus dem HTML entfernen und beim
Studio-Start aus der Tabelle erzeugen (verstecktes `<svg>`, `<symbol id="i-m-${key}">`
je Eintrag).

**Falle:** Das muss geschehen, **bevor** das erste `<use href="#i-m-…">` gerendert wird.
Prüfen, wo der Sprite außerhalb des lazy geladenen Editors gebraucht wird (Bibliotheks-
kacheln, Tour-Liste) — im Zweifel im Basis-Bundle erzeugen, nicht erst im Editor-Modul.

Fällt dieser Schritt aus (z. B. weil der Sprite anderswo statisch gebraucht wird), bleibt
der vorhandene Icon-Pfad-Wächter bestehen und Punkt 4 ist die einzige verbleibende
Doppelung im Web.

### Schritt 7: Drift-Wächter umbauen

Die vier bestehenden Tests werden größtenteils **gegenstandslos** — `MODE_SPEED`,
`MODE_SCALE` und `MODE_ICONS` existieren nicht mehr als eigene Tabellen. Ersetzen durch
einen Block, der die verbliebenen Außengrenzen prüft **und beim Fehlschlag sagt, was zu
tun ist**:

| Prüfung | Quelle | Fehlermeldung soll nennen |
|---|---|---|
| Server kennt jeden Schlüssel | Regex auf `MODI` in `server/src/schema/upload.ts` | „`ski` fehlt in server/src/schema/upload.ts" |
| App kennt jeden Schlüssel | Regex auf `Entities.kt` (`("([a-z]+)", "…")`) | „`ski` fehlt in Entities.kt (Schlüssel + Anzeigename)" |
| Jeder Sound existiert | `existsSync('public/audio/<sound>.mp3')` | „`eng-car.mp3` fehlt unter public/audio/" |
| Jeder Eintrag hat ein Icon | `MODUS[k].icon` nicht leer | „`ski` hat kein Icon" |
| Tempo-Faktoren stimmen | wie bisher, aber gegen `MODUS[k].speed` statt Regex | unverändert |

Der Tempo-Test importiert `MODUS` künftig direkt statt `tour.js` per Regex zu lesen
(`tour.js` lädt MapLibre und ist im Node-Test nicht importierbar — `modi.ts` hat keine
Abhängigkeiten und ist es sehr wohl). Das ist der eigentliche Nebengewinn dieses Umbaus.

### Abnahme

```bash
npm test && npm run typecheck && npm run build
```

Dazu manuell im Dev-Server: eine Tour mit mehreren Modi abspielen (Fahrer-Icon wechselt,
Motorloop setzt bei `moped`/`jeep`/`ferry` ein), im Studio die Zeitleiste öffnen
(Modus-Bänder tragen Namen und Farben, das Piktogramm am Läufer stimmt).

Server- und Android-Tests sind von Stufe 1 nicht betroffen, sollten aber vor dem Commit
grün sein (`cd server && npm test`, `cd android && ./gradlew test`).

---

## Ergebnis: einen Modus hinzufügen

Nach Stufe 1 ist das Rezept:

1. **`src/modi.ts`** — eine Zeile (Name, Tempo, Skala, Ton, Farbe, Icon).
2. **`server/src/schema/upload.ts`** — ein Wort in `MODI`.
3. **`Entities.kt`** — eine Enum-Zeile (Schlüssel + Anzeigename).
4. Falls motorisiert: einen Loop erzeugen
   ([gen-vehicle-audio.mjs](../../scripts/gen-vehicle-audio.mjs), ElevenLabs — das Auto ist
   dort bereits auskommentiert vorbereitet).

Vergisst man 2 oder 3, wird `npm test` rot und nennt Datei und fehlenden Schlüssel.

---

## Stufe 2 (optional) — geteilte JSON

Erst sinnvoll, wenn die Doppelung von Schritt 2/3 oben wirklich stört.

`server/src/schema/modi.json` trägt die **datenartigen** Felder (Schlüssel, Name, speed,
scale, sound, farbe); `upload.ts` leitet `MODI` daraus ab, `src/modi.ts` importiert die
JSON und ergänzt nur die Icons.

Zu klären: `"resolveJsonModule": true` im Root-`tsconfig.json` (fehlt heute), und ob
`exclude: ["server", …]` dem Import im Weg steht — TypeScript zieht importierte Dateien
auch dann ein, wenn sie von `include` nicht erfasst werden, das sollte also gehen, muss
aber verifiziert werden. Der Server-Docker-Build bleibt unberührt, weil die Datei
**innerhalb** von `server/src` liegt.

## Stufe 3 (später) — die App lädt den Katalog

Motivation: Web und Server deployen gemeinsam (ein Version-Tag rollt beides aus); die App
ist der einzige Teil mit eigenem Release-Zyklus. Ein `GET /api/modi` würde erlauben, einen
neuen Modus aufzuzeichnen, ohne auf ein Play-Store-Update zu warten.

Voraussetzung ist, `Modus` von einem Kotlin-Enum auf einen String umzustellen. Der Befund
dazu ist günstig:

- Der TypeConverter speichert **bereits den Austauschformat-Schlüssel**
  (`vonModus(m) = m.schluessel` → `"walk"`, nicht `"WALK"`,
  [LuhamboDb.kt:16](../../android/app/src/main/java/app/maptale/daten/LuhamboDb.kt#L16)).
  Die Spalte ist TEXT mit den richtigen Werten → **vermutlich keine Datenmigration**,
  nur ein neuer Schema-Export prüfen.
- `Modus.vonSchluessel` fällt bei Unbekanntem tolerant auf `WALK` zurück.
- Es gibt **kein erschöpfendes `when(modus)`** im Kotlin-Code; das Enum wird nur als
  Wertträger, für `Modus.entries` (Chip-Liste in `NeueTourBlatt.kt`) und als Default
  benutzt.

Nötig wären: Endpunkt, Cache in der App, eine kleine eingebaute Fallback-Liste für die
erste Nutzung offline (sie darf veralten — der Server liefert die neuere).

**Grenze, die dabei bleibt:** Ein Modus, den nur Server und App kennen, ist nicht
abspielbar — Tempo, Kameraskala, Icon und Ton stecken im Web-Bundle. Da Web und Server
zusammen deployt werden, ist das in der Praxis kein Problem, sollte aber bewusst sein.
