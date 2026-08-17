# Umbauplan: Player von JavaScript nach TypeScript

Archiviert aus: concepts

> **Erledigt und archiviert am 2026-08-12**, ausgeliefert mit **v0.60.0**. Unter
> `src/` liegt keine `.js` mehr, `tsc --noEmit` deckt den kompletten Player-Pfad.
> Dieses Blatt ist Historie — es bleibt lesenswert für die Methodik (topologische
> Wellen, Äquivalenztest §5b, Smoke-Aufbau §5a) und die Befunde unterwegs (totes
> `antialias`, verwaister `closeLayers`-Aufruf). Der aktuelle Stand steht in
> `CLAUDE.md`.

**Ziel:** Die Player-Module unter `src/*.js` schrittweise nach TypeScript bringen —
strict wie der Rest des Web-Codes — ohne die Kamerafahrt, den Default-Renderer oder
die Tour-Verträge zu riskieren.

Stand: **2026-08-11**. **Der Umbau ist abgeschlossen.** Welle 0 (Rauchtest),
Block A (Wellen 1–4), Block B (Wellen 5–6: `ui`, Engine) und Block C
(Wellen 7–8: Visuals, Verdrahter) sind umgesetzt — unter `src/` liegt keine
`.js` mehr, `npm run typecheck` deckt den kompletten Player-Pfad.

Verwandt, aber **nicht** dasselbe:
- [modi-konsolidierung.md](../concepts/modi-konsolidierung.md) — Modus-Tabelle; der dort
  geforderte Rauchtest JS↔TS-Import ist mit Welle 0 **erledigt** (Ergebnis unten).
- [konzept_codebase_english_refactoring.md](../concepts/konzept_codebase_english_refactoring.md) —
  Bezeichner; **nicht** mit der Datei-Migration vermischen.
- [../archive/renderer-labor.md](../archive/renderer-labor.md) — das ausgebaute
  Renderer-Labor; der Grund, warum dieser Plan seit dem 2026-08-11 kleiner ist.

---

## 1. Ist-Stand

| | |
|---|---|
| Player-JS | ursprünglich 19 Dateien, 7229 Zeilen; nach Block C **keine mehr** |
| Web-TS | 40 `.ts` (Studio, Konto, Profil, Routen, …) + eine `.d.ts`; nach Block C 58 `.ts`, **keine `.d.ts` mehr** |
| `tsconfig.json` | `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, **`allowJs: false`**, `include: src/**/*.ts` |
| Einstieg | [erlebnis.html](../../erlebnis.html) → [src/main.ts](../../src/main.ts) |
| Getestet heute | u. a. `geo` (JS-Test), `remote.ts`/`timeAt`, `audiotracks`, `pinmodell.ts` |

Zwei Mechaniken tragen die Migration von selbst: `tsconfig` inkludiert
`src/**/*.ts`, eine umbenannte Datei fällt also ohne Zutun in den Typecheck; und
`vitest.config.js` inkludiert `test/**/*.test.{js,ts}`, das Mitziehen von
[geo.test.js](../../test/geo.test.js) kostet nichts.

**Konsequenz aus `allowJs: false`:** Eine `.js`-Datei liegt **nicht** unter `tsc`.
Typen kommen nur, wenn (a) die Datei zu `.ts` wird, oder (b) eine handgeschriebene
`.d.ts` daneben liegt — Muster: [src/audiotracks.d.ts](../../src/audiotracks.d.ts),
angelegt für das Studio, aber im Player-Ordner.

Daraus folgt die Regel, an der die ganze Reihenfolge hängt (Beleg in Welle 0):
**Eine migrierte `.ts` darf kein noch nicht migriertes `.js` importieren** — weder
statisch noch dynamisch. Jede solche Kante ist ein roter Typecheck (`TS7016`) und
kostet eine Übergangs-`.d.ts`. Die Wellen sind deshalb keine Bequemlichkeit,
sondern eine topologische Sortierung des Importgraphen.

Die Gegenrichtung ist dagegen harmlos: Vite bundelt `.js` und `.ts` gemischt, und
die übliche Import-Endung im Repo ist `.js` auch beim Import einer `.ts`-Quelle
(`from './routen.js'` → Datei `routen.ts`). Das ist in Welle 0 gemessen, in beiden
Modi.

---

## 2. Leitregeln

0. **Blätter zuerst, Verdrahter zuletzt — das ist Pflicht, nicht Stil.** Eine
   Welle darf erst laufen, wenn alles migriert ist, was ihre Dateien importieren.
   Sonst `TS7016` (s. Abschnitt 1) und eine `.d.ts`, die zwei Wellen später
   wieder gelöscht wird.
1. **Eine Datei (oder ein kleines Cluster) = eine Welle.** Shipbar, CI grün, Smoke
   einer Tour (`/tour/kohphangan` + eine Server-Tour).
2. **Verhalten unverändert.** Keine Renderer-, Kamera- oder API-Refactors im selben
   PR. Keine Bezeichner-Anglisierung.
3. **Strict von Anfang an** in der neuen `.ts`-Datei. Kein `// @ts-nocheck`. Wo der
   Bestand `any`-Äquivalente braucht: lokale, benannte Typen oder schmale `unknown`-
   Engstellen mit Kommentar — nicht die Datei aufweichen.
4. **`exactOptionalPropertyTypes` ernst nehmen.** Optional heißt „Property fehlt“,
   nicht `prop: T | undefined` schreiben und hoffen. Bestehende Muster aus
   `remote.ts` / Studio kopieren.
5. **Tests ziehen mit.** Was DOM-frei ist, bekommt oder behält Vitest. Was nur über
   MapLibre läuft, bleibt Smoke + bestehende Vertragstests am Server.
6. **Verhalten unangetastet lassen.** Der Player hat seit dem Ausbau des Labors
   genau einen Renderer-Pfad; es gibt keine Flag-Verzweigungen mehr zu erhalten.
   Verbliebene Query-Flags (`?pins3d`, `?reverse`, `?dev`) beim Typisieren nur
   lesen und weiterreichen.

---

## 3. Wellen-Reihenfolge

Priorität: **topologisch — jede Datei nach allem, was sie importiert.** Risiko und
Größe entscheiden nur dort, wo der Graph frei lässt.

```
Welle 0   Rauchtest Import + Typstrategie              [durchgeführt]
Welle 1   tours.js — Daten, liefert TourConfig         [durchgeführt]
Welle 2   Blätter ohne MapLibre (sun, audioloop, exif, demclean)   [durchgeführt]
Welle 3   geo, audiotracks + music, autoweather, vehicle          [durchgeführt]
Welle 4   Karten-Nebenmodule (elevation, daynight, map)           [durchgeführt]
Welle 5   UI-Schicht (ui; karteninfo ist schon ts)               [durchgeführt]
Welle 6   Engine (tour.js) — Herzstück                           [durchgeführt]
Welle 7   Default-Visuals (atmosphere, weather, photopins)         [durchgeführt]
Welle 8   main.js — Verdrahter, zuletzt                            [durchgeführt]
```

Gegenüber der ersten Fassung sind drei Dinge gewandert, alle drei aus demselben
Grund (Leitregel 0): `tours.js` von hinten nach vorn — es ist ein echtes Blatt
ohne einen einzigen Import, und aus ihm kommt der Typ, gegen den `tour` und `main`
später typisiert werden. Die Default-Visuals stehen jetzt **vor** `main.js` statt
danach. Und `music.js` liegt bei `audiotracks`, das es importiert.

Die frühere Welle 8 (Labor-Module) ist ersatzlos entfallen — der Code ist weg.

### Welle 0 — Rauchtest: durchgeführt, Ergebnis

Gemessen am 2026-08-11 mit wegwerfbaren Proben unter `src/`:

| Frage | Ergebnis |
|---|---|
| `.js` importiert `.ts` als `from './x.js'` — Build? | **löst auf**, `vite build` (v6.4.3) baut durch |
| dasselbe im Dev-Server? | **löst auf**: liefert `import … from "/src/_probe_ts.ts"` |
| `.ts` importiert untypisiertes `.js`? | **`TS7016`**, Typecheck rot |
| dito, aber `await import('./x.js')`? | **`TS7016`**, ebenfalls rot |

Damit ist der ursprünglich befürchtete Fall (JS→TS) erledigt und der Fallback
„`.d.ts` an der Grenze" für ihn hinfällig. Das Risiko sitzt in der Gegenrichtung —
daraus wurde Leitregel 0 und die neue Reihenfolge.

Zwei Nebenbefunde: Die extensionslosen Importe im Bestand (`main.js:4`
`from './remote'`, `map.js:6` `'./karteninfo'`, `photopins.js:38` `'./pinmodell'`)
sind Altlast, keine Notwendigkeit — beim Anfassen auf `.js` vereinheitlichen. Und
`vite.config.js` importiert `./src/routen.ts` **mit `.ts`-Endung**; das ist eine
dritte Konvention, läuft aber über Vites eigenen Config-Loader und bleibt so.

**Zusätzlich festlegen:**
- Bleibt `window.__j` untypisiert (`any` an einer Stelle) oder bekommt ein
  `src/debugfenster.d.ts`? Empfehlung: schmales Interface `MaptaleDebug`, an
  `main` einmal asserten.
- `erlebnis.html` / Vite-Einstieg: weiter `main.js` bis Welle 8, dann `main.ts`
  (Vite akzeptiert beides; `erlebnis.html` Zeile 372 anpassen).

---

### Welle 1 — `tours.js` (Daten)

1 179 Zeilen Tour-Daten + Struktur, **null Importe** — das sauberste Blatt im
Projekt und zugleich die Typquelle für alles Spätere. Optionen:

- **A (empfohlen):** Datei nach `.ts`, `TOURS` als `satisfies`- oder
  `TourConfig`-Typ (Typ aus dem, was `main`/`Tour` wirklich brauchen — nicht das
  ganze Server-`tour.json`-Schema doppelnd).
- **B:** Daten als JSON + schmaler Loader — nur wenn ein zweiter Konsument das
  braucht; sonst Overkill.

Wächter: weiterhin keine `t_`-Schlüssel in `TOURS` (bestehender Test).

**Warum zuerst:** Die erste Fassung hatte das als Welle 9. Dann typisiert man
`tour.js` und `main.js` gegen ein `any`-`TOURS` — also gegen genau das, was der
Umbau beseitigen soll — und `main.ts` bräuchte zusätzlich eine `.d.ts` für die
Daten.

---

### Welle 2 — Blatt-Module (niedriges Risiko)

| Datei | Zeilen | Hinweis |
|---|---:|---|
| `sun.js` | 31 | rein, idealer erster Schnitt |
| `audioloop.js` | 63 | |
| `exif.js` | 77 | Schnittmenge mit Studio-`exif.ts` nicht zusammenlegen in diesem Plan |
| `demclean.js` | 120 | |

**Fertig wenn:** typecheck kennt die Module; keine Runtime-Änderung.

`music.js` stand hier ursprünglich mit, importiert aber `videoMusikDuck` aus
`audiotracks.js` — es zieht in Welle 3 um. (Es liefe heute zufällig durch, weil
`audiotracks.d.ts` genau diesen Export mitdeklariert; darauf zu bauen wäre
Glück, kein Plan.)

---

### Welle 3 — Bereits getestete / halbwegs reine Kernbausteine

| Datei | Zeilen | Tests / Anker |
|---|---:|---|
| `geo.js` | 174 | `test/geo.test.js` → nach `.test.ts` mitziehen |
| `audiotracks.js` | 191 | `test/audiotracks.test.ts`; `src/audiotracks.d.ts` entfällt danach |
| `music.js` | 45 | hängt an `audiotracks` — **gemeinsam** mit ihm |
| `autoweather.js` | 154 | importiert `exif` (Welle 2); an `weather`-Typen aus Tour-JSON anbinden |
| `vehicle.js` | 53 | importiert `audioloop` (Welle 2); hängt an Modus-Liste — ideal **nach oder mit** modi-konsolidierung |

`remote.ts` ist schon TS — hier nur Import-Endungen/Typen glätten, falls nötig.

---

### Welle 4 — Karten-Nebenmodule

| Datei | Zeilen | Risiko |
|---|---:|---|
| `elevation.js` | 63 | Blatt; async DEM, Typen für Terrarium-Sample |
| `daynight.js` | 135 | importiert `sun` (Welle 2); koppelt an Style-API |
| `map.js` | 417 | importiert `geo` (W3), `demclean` (W2), `karteninfo.ts`; MapLibre-Style, `MODE_ICONS` |

`map.js` ist der Knoten mit den meisten Nachfolgern (`tour`, mittelbar `ui`,
sämtliche Visuals) — geht diese Welle schief, steht der ganze Rest.

MapLibre-Typen: `@types` / mitgelieferte Typen der Dependency nutzen; wo die API
lockerer ist als unser Strict-Modus, Adapter-Typen lokal halten.

### Befunde aus Block A (Wellen 1–4)

Zwei Dinge, die man beim Weitermachen kennen sollte:

- **`antialias` in `map.ts` war seit MapLibre 5 tot.** Die Option ist dort unter
  `canvasContextAttributes` gewandert; ein unbekanntes Top-Level-Feld wird stumm
  ignoriert. Der Typecheck hat sie gefunden — genau die Sorte Fehler, für die
  dieser Umbau gemacht ist. Nachgemessen und **erledigt**: MSAA (nachgewiesen
  aktiv, SAMPLES = 4) ändert bei identischer Kamerapose nichts Sichtbares, weil
  das Bild fast reines Raster ist. Beide toten Flags sind entfernt, die
  Entscheidung steht in
  [../archive/antialias-verworfen.md](../archive/antialias-verworfen.md).
- **Ein laufender Dev-Server überlebt das Umbenennen nicht.** Vites Modulgraph
  hält die alten `/src/x.js`-Adressen mit `?t=`-Stempel; nach der Migration
  antwortet der Server darauf 404 und `window.__j` entsteht nie — es sieht aus
  wie ein kaputter Player, ist aber nur ein kalter Neustart
  (`devhub down journey && devhub up journey`). Der Build ist davon nicht
  betroffen, es fällt also nur lokal auf.

Was der Smoke gezeigt hat (drei statische Touren + eine abgefangene Server-Tour,
Aufbau s. Abschnitt 5a): `ride → photo`, `s` wächst, Pitch pendelt sich bei ~64°
ein, DEM-Höhen greifen (Oberland 658–1042 m, Koh Pha-ngan 0–349 m), das
Auto-Wetter baut seine Stützstellen (Stockholm 23) und der Motor-Loop schaltet
am Modus-Wechsel ein (`eng-moped`).

---

### Welle 5 — UI

| Datei | Zeilen |
|---|---:|
| `ui.js` | 489 |

Importiert `geo` und `audiotracks` (beide Welle 3). DOM-lastig. IDs aus
`erlebnis.html` als Konstanten oder schmale Getter; kein komplettes UI-Rewrite.
`karteninfo.ts` existiert bereits — Muster übernehmen.

**Umgesetzt.** Der Zugriff aufs DOM läuft über zwei Helfer (`$` per id,
`pflicht` per Selektor), die beim Fehlen ein benanntes „Player-DOM: #x fehlt
(erlebnis.html)" werfen statt später am Aufrufer als `null`-TypeError
aufzuschlagen — dieselbe Absturzklasse, nur mit Adresse. Die `els`-Tafel trägt
jetzt echte Elementtypen (`HTMLImageElement`, `SVGPathElement`, …); genau daran
hing der Kommentar bei `setPlaying`, dass SVG kein `hidden`-Property kennt.
Zwei Kleinigkeiten am Rand: `requestVideoFrameCallback` steht nicht in jeder
lib.dom-Fassung und bekommt eine schmale Erweiterung des `HTMLVideoElement`
statt einer Zusage; und die Timer-Felder laufen über `window.setTimeout`
(liefert `number`) — das globale `setTimeout` ist wegen `@types/node` im Repo
`NodeJS.Timeout` und hätte den Bestandswert `0` unbrauchbar gemacht.

---

### Welle 6 — `tour.js` (Engine)

947 Zeilen, FreeCamera, Phasen, Scrubbing, Presets. Importiert `geo` (W3) und
`map` (W4). **Eigenes PR, ruhiges Fenster.**

Vorgehen:
1. Datei umbenennen, öffentliche Methoden der Klasse/`Tour` typisieren.
2. Interne Hilfen (`Smooth`, Phasen-Enums) als echte Typen.
3. Callbacks (`ui.updateTrace`, `onPose`) als Interfaces.
4. Keine Algorithmus-„Verbesserungen“.

Smoke: Intro → Fahrt → Foto-Orbit → Finale; Scrub; Moduswechsel hör-/sichtbar.
(Das Wiederaufnahme-Ticket `maptale:weiter:` gibt es seit dem Ausbau des
Renderer-Labors nicht mehr — `resumeAt` bleibt als Einstieg für Messungen.)

**Umgesetzt.** Vier Dinge, die dabei entschieden wurden:

- **Die Modus- und Preset-Tabellen bleiben Literale, die Lookups bekommen einen
  Helfer.** `MODE_SPEED`/`MODE_SCALE`/`PRESETS` stehen mit `satisfies`
  (Vollständigkeit über `Modus` bleibt geprüft), gelesen wird über
  `tempoFaktor`/`skalaFuer`/`distanzFuer`. Grund: Die Schlüssel kommen als FREIE
  Zeichenketten herein (Server-Segmente, `data-preset` im DOM) — die Fallbacks
  des Bestands (`?? 1`, `?? MODE_SCALE.bike`) sind deshalb kein Zierrat, und ein
  `Record<Modus, …>` hätte sie zu totem Code erklärt.
- **Die Literale müssen Literale bleiben, weil vier Drift-Wächter sie per REGEX
  lesen** (`test/studio-baukasten.test.ts`, `server/test/filmtempo.test.ts` —
  der Server kann die Datei nicht importieren). Ein `const MODE_SPEED:
  Record<Modus, number> = {` hätte `const MODE_SPEED = \{` nicht mehr getroffen,
  und die Wächter wären still verstummt. Deshalb steht `satisfies` HINTER dem
  Objekt. Die Dateiendung in den Wächtern (`../src/tour.ts`) musste mit.
- **`shownStop` ist ehrlich `PlayerStopp | null`** statt einer
  Definite-Assignment-Zusage. Das kostet drei Wächter (`advancePhoto`,
  Foto-Trigger, „ausgerollt") an Stellen, die die Phase ohnehin schon prüften —
  erreichbar sind sie nicht, aber sie ersetzen einen möglichen TypeError durch
  ein Nichtstun.
- **`ui.updateTrace` trägt ein `!`.** Es ist der einzige Rückruf, den die Engine
  ohne `?.` aufruft; gesetzt wird er von `main.js` direkt nach dem Konstruktor.
  Ein Default-No-op hätte einen Verdrahtungsfehler verschluckt.

---

### Welle 7 — Default-Visuals

| Datei | Zeilen | Importiert | Default? |
|---|---:|---|---|
| `atmosphere.js` | 1117 | `map` (W4) | ja |
| `weather.js` | 445 | `audioloop` (W2), `map` (W4) | ja |
| `photopins.js` | 589 | `map` (W4), `pinmodell.ts` | ja (`pins3d` Default an) |

`atmosphere.js` ist groß — ggf. in derselben Welle nur umbenennen+typen, **nicht**
intern splitten (Split = eigenes Refactor-Konzept).

**Warum vor `main.js`:** In der ersten Fassung stand diese Welle danach. `main.js`
importiert alle drei (`photopins` dynamisch) — die Reihenfolge hätte
Übergangs-`.d.ts` gekostet, für Dateien, die eine Welle später ohnehin wandern.

**Umgesetzt.** Fünf Dinge, die dabei entschieden wurden:

- **`three` bringt keine Typen mit** (0.185 exportiert nur `build/three.module.js`)
  — `@types/three` ist als devDependency dazugekommen, versionsgleich (0.185.4).
  Die Alternative wäre eine handgeschriebene `.d.ts` gewesen, also genau die
  Sorte zweiter Wahrheit, die dieser Plan vermeidet.
- **Narrowing überlebt keine `function`-Deklaration.** `const ctx =
  canvas.getContext('2d'); if (!ctx) throw` schmälert `ctx` NICHT innerhalb einer
  gehobenen `function draw() {}` — TypeScript behandelt sie als am Blockanfang
  erzeugt. In `atmosphere.ts` (fast alle Zeichen-Ebenen sind `function`) hätte das
  ~60 `!` gekostet; stattdessen holt ein `kontext2d(canvas, wofuer)` den Kontext
  und wirft mit Adresse. Bei `weather.ts` fiel es nicht auf — dort sind alle
  Helfer Pfeil-Konstanten, und für die gilt die Verengung.
- **Die beiden Offscreens (Dunst-Maske, Wolken) laufen jetzt über einen
  Lazy-Getter** statt über ein Paar `let cv, ctx`. Grund ist derselbe: `resize()`
  setzt das Canvas auf `null`, der Kontext blieb stehen — ein Zustand, den man
  danach an jeder Verwendungsstelle wieder ausschließen muss. Der Getter prüft
  beides und baut in der aktuellen Größe neu; das Verwerfen bei `resize` bleibt.
- **Tupel retten `noUncheckedIndexedAccess`.** `type Vec3 = [number, number,
  number]` destrukturiert exakt (`const [r, g, b] = sky.fogc` ist `number`),
  ein `number[]` nicht. Die Farb- und Richtungsrechnung in `atmosphere.ts` kostet
  dadurch KEIN einziges `!`. Nur in den Rasterschleifen (Wolkenrauschen,
  Mercator-Matrizen) steht `!` — mit demselben Kommentar wie in `demclean.ts`.
- **`weather.ts` führt Loops und Donner getrennt.** Die alte `sounds`-Tafel
  mischte `SeamlessLoop` und `HTMLAudioElement` unter einem Schlüsselraum; die
  laufende Lautstärke-Rampe hing als `_ramp` am fremden Objekt. Beides ist jetzt
  getrennt bzw. eine `Map` — dieselbe Mechanik, aber ohne Fremdfelder.

---

### Welle 8 — `main.js` (Verdrahter, zuletzt)

1151 Zeilen. Importiert praktisch alles Obige — deshalb ganz am Ende, sonst
typisiert man gegen `any`-Importe.

Hier fallen die Query-Flags an — beim Typisieren nur lesen/weiterreichen.

Einstieg in `erlebnis.html` (Zeile 372) auf `main.ts` umstellen; `window.__j`
einmal typsicher befüllen.

**Fertig wenn:** kein `.js` mehr unter `src/`, und `npm run typecheck` deckt den
kompletten Player-Pfad.

**Umgesetzt.** Vier Dinge:

- **`SpielerTour` ist das Subset, in dem sich `TourConfig` und `RemoteTourCfg`
  treffen** — lokal in `main.ts`, nicht exportiert. Es ist keine dritte Fassung
  des Tour-Formats: Wo die beiden Quellen auseinandergehen, steht die WEITERE
  (`mode: string`, weil Server-Segmente nicht auf `Modus` eingeschränkt sind;
  `time?`, weil statische Touren ohne auskommen). Was hier fehlt, fasst der
  Verdrahter nicht an.
- **`TOURS` wird für den Lookup einmal als Wörterbuch gelesen.** Die Tabelle
  steht mit `satisfies`, hat also keine Index-Signatur — ein Zugriff über eine
  freie Zeichenkette (`?tour=…`) ist damit ein Typfehler. Der `Record`-Cast
  steht an genau EINER Stelle, die `Object.hasOwn`-Prüfung davor bleibt.
- **`window.__j` bekommt ein `PlayerDebug`-Interface** (`declare global`). Alles,
  was erst im Laufe des Bootens entsteht, ist optional — die Handles sind ein
  Konsolen-Zugang, kein API-Vertrag.
- **Ein toter Aufruf ist aufgefallen und entfernt:** `openWeather()` rief
  `closeLayers()`, eine Funktion, die es seit dem Ausbau des Renderer-Labors
  nicht mehr gibt. In JS warf jeder Klick auf den Wetter-Knopf dort einen
  `ReferenceError`, BEVOR das Menü sichtbar wurde — unbemerkt, weil der Knopf nur
  in `body.dev` steht. Der Typecheck fand ihn sofort (`Cannot find name`); nach
  dem Entfernen öffnet das Menü wieder (Smoke unten).

---

## 4. Typquellen (nicht neu erfinden)

| Bedarf | Quelle |
|---|---|
| Modus-Schlüssel | Server-`MODI` / später `src/modi.ts` (modi-konsolidierung) |
| Tour-JSON-Form | Annäherung an Server-Schema + was der Player liest; Vertragstests bleiben server-seitig |
| Overlay | irrelevant für Player-Laufzeit (schon gerendert) |
| MapLibre | Paket-Typen |
| Geo-Punkte | `[lng, lat, ele?]`-Tupel / kleine Aliase wie im Studio |

Keine zweite „Wahrheit“ fürs Tour-Format im Client erfinden, die dem
Austauschformat widerspricht. Lieber schmale `PlayerTour`-Typen mit dem Subset,
das `main` wirklich anfasst.

**Was Block A und B bereits geschaffen haben** — Block C typisiert dagegen und
erfindet nichts Neues (`grep -n "^export \(type\|interface\)" src/*.ts`):

| Modul | Typen |
|---|---|
| `tours.ts` | `Modus`, `Wegpunkt`, `Ankerpunkt`, `TourSegment`, `TourFoto`, `TourZeit`, `TourWetter`, `TourAudio`, `TourConfig` |
| `geo.ts` | `LngLat`, `Route`, `StoppFoto`, `Stopp<T>` |
| `map.ts` | `LngLat2D`, `FotoWegpunkt` |
| `daynight.ts` | `Lichtstimmung`, `TagNachtRegie` |
| `audiotracks.ts` | `DuckPegel`, `AudioSpuren` |
| `ui.ts` | `PlayerMedium`, `PlayerStopp`, `Telemetrie` |
| `tour.ts` | `Kameradistanz`, `KameraMoment`, `ModusGrenze`, `KameraPose`, `TourOptionen` |

`PlayerMedium` ist bewusst das SUBSET, das Anzeige und Engine anfassen (`s`,
`src`, `title`, `caption`, optional `type`/`poster`/`thumb`/`display`) — nicht
eine dritte Fassung neben `RemoteMedium` (src/remote.ts) und `TourFoto`
(src/tours.ts). `KameraPose` ist der Vertrag zum Atmosphäre-Overlay: Welle 7
typisiert `atmo.render(pose)` dagegen, statt ihn zu wiederholen.

---

## 5. Importe und Endungen

Repo-Konvention beibehalten — in Welle 0 für JS→TS bestätigt, im Build **und** im
Dev-Server:

```ts
import { pointAt } from './geo.js'  // Datei: geo.ts
```

Nach dem Umbenennen einer Datei alle Importe greppen (`geo.js`, `tour.js`, …) —
Web, Tests, `.d.ts`-Reste. Drift: eine vergessene Endung fällt in Vite
sofort auf, in `tsc` nur wenn die Datei im Graph ist.

Drei Abweichungen im Bestand, die beim Anfassen mitgehen:

| Stelle | heute | Ziel |
|---|---|---|
| `main.js:4`, `main.js:5` | `'./remote'`, `'./routen'` | `'./remote.js'`, `'./routen.js'` |
| `map.js:6` | `'./karteninfo'` | `'./karteninfo.js'` |
| `photopins.js:38` | `'./pinmodell'` | `'./pinmodell.js'` |

`vite.config.js` importiert `./src/routen.ts` dagegen **mit `.ts`** — das läuft
über Vites eigenen Config-Loader und bleibt, wie es ist.

---

## 5a. Schnitt in Blöcke — nicht in einem Rutsch

Die acht Wellen sind die Reihenfolge, nicht die Liefergröße. Drei Blöcke, jeder
ein eigener Commit, ein Release am Ende:

| Block | Wellen | Umfang | Abnahme |
|---|---|---:|---|
| A | 1–4 | ~2 300 Z, mechanisch | typecheck + `npm test` |
| B | 5–6 | 1 436 Z (`ui`, Engine) | **Smoke zwingend** |
| C | 7–8 | ~2 700 Z (Visuals, Verdrahter) | Smoke + beide Tour-Arten, Desktop und schmal |

**Warum nicht alles auf einmal:** nicht die Menge — die Abnahme. Von den 19
Player-Dateien haben nur `geo` und `audiotracks` echte Tests; die Treffer bei
`tour` und `map` in `test/` sind Drift-Wächter (Modus-Tabelle, `t_`-Schlüssel),
keine Verhaltenstests. `tour.js`, `main.js`, `atmosphere.js` und `ui.js` — der
eigentliche Kern — haben **keinen einzigen**. Der Typecheck fängt in diesem Umbau
also genau das, was ohnehin selten bricht, und nichts von dem, was wirklich
brechen kann. Dazu beißen `noUncheckedIndexedAccess` und
`exactOptionalPropertyTypes` ausgerechnet in `geo`/`tour`/`atmosphere` am
härtesten (jeder `coords[i][2]` wird `| undefined`) — hunderte Einzelentscheidungen
zwischen sauber prüfen und mit `!` durchwischen. Und ein 7 000-Zeilen-Diff ist
nicht bisektierbar, wenn drei Tage später die Kamera in einer Kurve zuckt.

**Smoke-Aufbau** (der Browser-Pane taugt nicht — er meldet `innerWidth 0`, MapLibre
startet dort nie): Headless-Chromium aus dem Playwright-Cache gegen den
devhub-Dev-Server, `window.__j.tour` abwarten, `#btn-start` klicken, dann Phase,
`s` und `map.getPitch()` über ~25 s beobachten. Erwartung: `intro → ride → photo
→ ride`, `s` wächst, Pitch pendelt sich bei ~65° ein (die ersten Sekunden sind
flach — das ist der einschwingende Smooth-Filter, kein Fehler).

Zwei Werkzeug-Notizen: Das Skript treibt `puppeteer-core` (liegt als
devDependency im Repo) auf das Chromium des Playwright-Caches — der Ordner heißt
dort `Google Chrome for Testing.app`, nicht `Chromium.app`. Und es muss **im
Repo-Wurzelverzeichnis** liegen, sonst findet Node `puppeteer-core` nicht; nach
dem Lauf gehört es gelöscht (dieselbe Regel wie bei den Wegwerf-Tests in §5b).

**Block-B-Abnahme (2026-08-11), beide Tour-Arten:**

| | `/tour/kohphangan` (statisch) | `/tour/t_…` (aufgezeichnet) |
|---|---|---|
| Phasenfolge | `intro → ride → photo → ride` | dito (Halt schon bei s≈0) |
| `s` | 18 → 1728 m in 25 s, Halt bei 745 m | 0 → 145 m, zwei Halte |
| Pitch | 45° → 8° (Anflug) → 57° und steigend | bis 66° |
| Foto-Karte | „Thong Sala" ein/aus, Telemetrie läuft mit | „Foto · 13:17"/„13:49" |
| Scrub · `jumpToPhoto` · `nudge` in Pause · `toMenu` | alle vier wie erwartet | dito |

Konsolen-/Netzfehler: einer, `400` von `analytics.maptale.io` — Umami mag
`localhost` nicht, mit der Migration hat er nichts zu tun.

**Block-C-Abnahme (2026-08-11), beide Tour-Arten, 25 s ab `#btn-start`:**

| | `/tour/kohphangan` (statisch) | `/tour/t_cGuHmm3vMa4ggQ` (aufgezeichnet) |
|---|---|---|
| Phasenfolge | `ride → photo` | dito |
| `s` | 19 → 1735 m, Halt bei 691–745 | 42 → 1871 m, Halt bei 354–410 |
| Pitch | 44° → 57° | 42° → 64° |
| DEM-Höhen | 0–349 m (`eleReady: 'dem'`) | 654–1042 m (`dem`) |
| Foto-Karte | „Thong Sala" | „Staubbachfall" |
| 3D-Pins | 12 | 6 |
| Auto-Wetter | `clouds` | `off` |
| Atmosphäre | `_dbg().horizonRenderNdcY` läuft mit der Kamera | dito |
| Scrub · `nudge` in Pause · `jumpToPhoto` · `toMenu` | alle vier wie erwartet | dito |

Dazu die Dev-Bedienung, die an `main.ts` hängt (`?dev=1`): Wetter-Menü öffnet,
„Gewitter" schaltet auf `storm` und schließt das Menü, Stufe „stark" hebt die
Intensität auf 1 ohne den Modus zu verlieren, der Optionen-Dialog öffnet und sein
Wetter-Schalter schaltet auf `off`. Keine Konsolenfehler.

---

## 5b. Äquivalenztest gegen die Vorgänger-Fassung

Der Typecheck prüft Typen, nicht Verhalten — und genau die Dateien mit dem
höchsten Risiko (`tour.js`, `ui.js`, `main.js`, `atmosphere.js`) haben keinen
einzigen Verhaltenstest. Für alles, was **rein rechnet**, gibt es eine billige
und sehr scharfe Absicherung: die alte Fassung danebenlegen und beide mit
denselben Eingaben füttern.

```bash
git show <commit-vor-der-welle>:src/geo.js > src/_geo_alt.js
```

```ts
// test/_aequiv.test.ts — WEGWERF, nach dem grünen Lauf löschen
import * as neu from '../src/geo.ts'
// @ts-expect-error — Alt-Fassung ohne Typen, nur für den Vergleich
import * as alt from '../src/_geo_alt.js'

let seed = 42                                   // deterministisch, KEIN Math.random:
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)

expect(neu.pointAt(rb, s)).toEqual(alt.pointAt(ra, s))
```

**Für Block B ging das nicht** und das ist kein Versäumnis: `tour` importiert
MapLibre (im Node-Test nicht ladbar — genau der Grund, warum die Drift-Wächter
den Quelltext per Regex lesen), und alles Rechnende in `ui` hängt am
Konstruktor, also am DOM. Die Abnahme war deshalb der Smoke aus §5a, gefahren
über beide Tour-Arten (Ergebnis unten).

An `geo` und `autoweather` hat das Block A abgenommen: 12 zufällige Routen à 41
Stützstellen, 200 Punktpaare, `wmoToWeather` über 2 430 Code-/Wolken-/Regen-/
Schnee-Kombinationen, `weatherAt` über 30 Timelines samt Rändern — alles
identisch.

Drei Fallen, die dabei Zeit kosten:

- **Zufallswerte einmal berechnen**, nicht je Aufruf: `f(rnd())` gegen `g(rnd())`
  vergleicht zwei verschiedene Eingaben und schlägt immer fehl.
- Die Wegwerf-Dateien müssen **unter `test/` bzw. `src/`** liegen — `vitest.config.js`
  inkludiert nur `test/**/*.test.{js,ts}`, ein Test im Repo-Wurzelverzeichnis wird
  gar nicht gefunden.
- **Danach beides löschen** (`test/_*.test.ts`, `src/_*_alt.js`) und `npm test`
  gegenlaufen lassen — eine vergessene Alt-Fassung landet sonst im Build-Graph.

**Wo die Methode NICHT greift** — an Block C gelernt, damit es niemand zweimal
versucht:

- **Factory-Module.** `atmosphere.ts` und `weather.ts` rechnen zwar überwiegend
  rein (Farbverläufe, Partikelbahnen, Sonnenstand), exportieren aber je genau
  **eine** Factory mit DOM-Container. Die Rechnung ist modul-intern und über die
  Modulgrenze nicht erreichbar; Exporte nur für den Test hinzuzufügen wäre genau
  die Änderung, die Leitregel 2 verbietet.
- **Alles mit `Math.random`.** In `atmosphere.ts` sieben Vorkommen (Sterne,
  Wolken) — damit ist auch ein Pixelvergleich zweier Fassungen nicht
  deterministisch.
- **Alles, was MapLibre importiert** (`tour.ts`, `map.ts`).

Brauchbar war die Methode damit an `geo`, `autoweather` und allem, was seine
Rechnung **exportiert** (`audiotracks`, `pinmodell`). Für den Rest bleibt es beim
Smoke aus §5a — der in Block B und C jeweils genügt hat.

---

## 6. CI und Definition of Done (gesamt) — **erfüllt**

- ✅ `npm run typecheck` umfasst den gesamten Player-Pfad (keine Insel-JS mehr im
  Default-Graph).
- ✅ `allowJs` bleibt `false` — im Endzustand wie während der Migration (s.
  Abschnitt 8, Zeile „Reihenfolge-Zwang").
- ✅ Kein `.d.ts` bleibt übrig: `src/audiotracks.d.ts` entfiel mit Welle 3.
- ✅ `npm test` / Deploy-Gate unverändert grün (564 Tests).
- ✅ Manuell: Koh Pha-ngan + eine aufgezeichnete Tour (s. Block-C-Abnahme).
- ✅ `CLAUDE.md`: „Player und Studio sind vollständig TypeScript“.
- ✅ `test/geo.test.js` war der letzte JS-Test — mit Welle 3 nach `.test.ts`.

Neu dazugekommen ist genau eine Abhängigkeit: **`@types/three`** (devDependency,
versionsgleich zu `three`) — s. Befunde zu Welle 7.

---

## 7. Nicht-Ziele

- Player auf React/Solid umschreiben.
- Renderer-Default wechseln. (Das Renderer-Labor ist am 2026-08-11 ausgebaut —
  eine eigene Sache, s. [Archiv](../archive/renderer-labor.md); dieser Plan
  erbt nur das Ergebnis.)
- `tours.js`-Inhalte kuratieren / Touren umbauen.
- Bezeichner anglisieren.
- `exactOptionalPropertyTypes` abschalten, „damit es schneller geht“.
- **Das übrige JS des Repos.** `vite.config.js`, `vitest.config.js` und die 14
  `scripts/*.mjs` (Medien-Generierung, GPX-Import, Seeds, OG-Bild) bleiben JS und
  stehen in keinem `tsconfig` — sie laufen unter Node bzw. Vites Config-Loader,
  nicht im Browser-Bundle. Das DoD „keine Insel-JS mehr“ meint den **Player-Pfad**,
  nicht das Repo. (`server/` hat gar kein Quell-JS mehr: was unter `server/dist/`
  und `server/coverage/` liegt, sind Artefakte.)

---

## 8. Risiken und Gegenmittel

| Risiko | Gegenmittel |
|---|---|
| Riesen-PR an `tour.js`/`main.js` | Eigene Wellen, kein Feature-Beifang |
| Typen zu streng → Laufzeit-Casts überall | Schmale Interfaces am Rand; innen eher präzise als `as any` |
| Doppelte `.d.ts` + `.ts` | Nach Migration `.d.ts` löschen (audiotracks) |
| Reihenfolge-Zwang macht die Wellen unbeweglich | Notausgang, falls doch umsortiert werden muss: für die Dauer der Migration `allowJs: true` + `checkJs: false`. JS-Importe kommen dann als inferierte statt fehlende Typen, die Reihenfolge wird frei. Endzustand bleibt `false` — bewusst nicht der Standardweg, weil er den grünen Endzustand erst zum Schluss erzwingt |
| modi-Konsolidierung parallel | vehicle/map/tour erst nach oder bewusst mit modi-Welle 1 |

---

## 9. Erfolg

- Jede Änderung an Kamera, Wetter oder UI läuft durch `tsc --noEmit`.
- Neue Player-Beiträge sind TS ohne Sonderregeln.
- Der mentale Bruch „Studio modern, Player legacy“ ist weg — `src/` ist danach
  vollständig TypeScript.
