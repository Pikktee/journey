# Umbauplan: Player von JavaScript nach TypeScript

**Ziel:** Die Player-Module unter `src/*.js` schrittweise nach TypeScript bringen —
strict wie der Rest des Web-Codes — ohne die Kamerafahrt, den Default-Renderer oder
die Tour-Verträge zu riskieren.

Stand: **2026-08-11**. Welle 0 (Rauchtest) und **Block A = Wellen 1–4 sind
umgesetzt** — 12 der 19 Player-Dateien liegen unter `tsc`. Offen sind Block B
(Wellen 5–6: `ui`, Engine) und Block C (Wellen 7–8: Visuals, Verdrahter).

Verwandt, aber **nicht** dasselbe:
- [modi-konsolidierung.md](modi-konsolidierung.md) — Modus-Tabelle; der dort
  geforderte Rauchtest JS↔TS-Import ist mit Welle 0 **erledigt** (Ergebnis unten).
- [konzept_codebase_english_refactoring.md](konzept_codebase_english_refactoring.md) —
  Bezeichner; **nicht** mit der Datei-Migration vermischen.
- [../archive/renderer-labor.md](../archive/renderer-labor.md) — das ausgebaute
  Renderer-Labor; der Grund, warum dieser Plan seit dem 2026-08-11 kleiner ist.

---

## 1. Ist-Stand

| | |
|---|---|
| Player-JS | ursprünglich 19 Dateien, 7229 Zeilen; nach Block A noch **6** (`atmosphere`, `main`, `photopins`, `tour`, `ui`, `weather`) |
| Web-TS | 40 `.ts` (Studio, Konto, Profil, Routen, …) + eine `.d.ts`; nach Block A 52 `.ts`, **keine `.d.ts` mehr** |
| `tsconfig.json` | `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, **`allowJs: false`**, `include: src/**/*.ts` |
| Einstieg | [erlebnis.html](../../erlebnis.html) Zeile 372 → [src/main.js](../../src/main.js) |
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
Welle 5   UI-Schicht (ui; karteninfo ist schon ts)
Welle 6   Engine (tour.js) — Herzstück
Welle 7   Default-Visuals (atmosphere, weather, photopins)
Welle 8   main.js — Verdrahter, zuletzt
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
  dieser Umbau gemacht ist. Die Zeile ist ersatzlos raus statt umgeschrieben:
  Sie WIEDER scharf zu stellen wäre eine Optik- und Bildraten-Änderung und
  gehört gemessen (MSAA war für Touch bewusst aus). **Offene Entscheidung** und
  nicht Teil dieses Plans — sie hat ein eigenes Konzept samt Messplan:
  [konzept_antialias.md](konzept_antialias.md).
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

---

### Welle 6 — `tour.js` (Engine)

947 Zeilen, FreeCamera, Phasen, Scrubbing, Presets. Importiert `geo` (W3) und
`map` (W4). **Eigenes PR, ruhiges Fenster.**

Vorgehen:
1. Datei umbenennen, öffentliche Methoden der Klasse/`Tour` typisieren.
2. Interne Hilfen (`Smooth`, Phasen-Enums) als echte Typen.
3. Callbacks (`ui.updateTrace`, `onPose`) als Interfaces.
4. Keine Algorithmus-„Verbesserungen“.

Smoke: Intro → Fahrt → Foto-Orbit → Finale; Scrub; Wiederaufnahme-Ticket
(`maptale:weiter:`); Moduswechsel hör-/sichtbar.

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

---

### Welle 8 — `main.js` (Verdrahter, zuletzt)

1151 Zeilen. Importiert praktisch alles Obige — deshalb ganz am Ende, sonst
typisiert man gegen `any`-Importe.

Hier fallen die Query-Flags an — beim Typisieren nur lesen/weiterreichen.

Einstieg in `erlebnis.html` (Zeile 372) auf `main.ts` umstellen; `window.__j`
einmal typsicher befüllen.

**Fertig wenn:** kein `.js` mehr unter `src/`, und `npm run typecheck` deckt den
kompletten Player-Pfad.

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

---

## 6. CI und Definition of Done (gesamt)

- `npm run typecheck` umfasst den gesamten Player-Pfad (keine Insel-JS mehr im
  Default-Graph).
- `allowJs` bleibt `false` — im Endzustand wie während der Migration (s.
  Abschnitt 8, Zeile „Reihenfolge-Zwang").
- Kein `.d.ts` bleibt übrig: `src/audiotracks.d.ts` entfällt mit Welle 3.
- `npm test` / Deploy-Gate unverändert grün.
- Manuell: Koh Pha-ngan + eine aufgezeichnete Tour, Desktop und schmale Viewport-Breite.
- `CLAUDE.md`-Absatz „neue Module in TypeScript“ → „Player und Studio in TypeScript“.
- `test/geo.test.js` ist danach der letzte JS-Test — mit Welle 3 nach `.test.ts`.

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
