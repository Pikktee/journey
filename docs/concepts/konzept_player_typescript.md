# Umbauplan: Player von JavaScript nach TypeScript

**Ziel:** Die Player-Module unter `src/*.js` schrittweise nach TypeScript bringen —
strict wie der Rest des Web-Codes — ohne die Kamerafahrt, den Default-Renderer oder
die Tour-Verträge zu riskieren.

Stand: **2026-08-07**, nichts davon umgesetzt (außer dem bestehenden Muster:
neue Produktflächen sind bereits `.ts`, der Player-Kern ist historisch `.js`).

Verwandt, aber **nicht** dasselbe:
- [modi-konsolidierung.md](modi-konsolidierung.md) — Modus-Tabelle; braucht vorher
  einen Rauchtest JS↔TS-Import.
- [konzept_codebase_english_refactoring.md](konzept_codebase_english_refactoring.md) —
  Bezeichner; **nicht** mit der Datei-Migration vermischen.

---

## 1. Ist-Stand

| | |
|---|---|
| Player-JS | 26 Dateien, ~9 400 Zeilen (`src/*.js`) |
| Web-TS | 38 Dateien (Studio, Konto, Profil, Routen, …) |
| `tsconfig.json` | `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, **`allowJs: false`** |
| Einstieg | [erlebnis.html](../../erlebnis.html) → [src/main.js](../../src/main.js) |
| Getestet heute | u. a. `geo` (JS-Test), `remote.ts`/`timeAt`, `audiotracks`, `pinmodell.ts` |

**Konsequenz aus `allowJs: false`:** Eine `.js`-Datei liegt **nicht** unter `tsc`.
Typen kommen nur, wenn (a) die Datei zu `.ts` wird, oder (b) eine handgeschriebene
`.d.ts` daneben liegt (Muster: `audiotracks` aus dem Studio).

Vite bundelt `.js` und `.ts` gemischt; die übliche Import-Endung im Repo ist `.js`
auch beim Import einer `.ts`-Quelle (`from './routen.js'` → Datei `routen.ts`).
Das muss der Rauchtest in Welle 0 für **JS→TS-Importe** bestätigen (siehe
modi-konsolidierung, Schritt 0).

---

## 2. Leitregeln

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
6. **Default-Pfad unangetastet lassen.** Labor-Flags (`?deck`, `?scene`, …) sind
   [konzept_renderer_labor.md](konzept_renderer_labor.md) — ihre Module wandern erst,
   wenn der Kern steht, oder bewusst als letzte Welle.

---

## 3. Wellen-Reihenfolge

Priorität: **Abhängigkeiten unten, Risiko oben; Labor zuletzt.**

```
Welle 0   Rauchtest Import + Typstrategie
Welle 1   Blatt-Module ohne MapLibre
Welle 2   Geo / Zeit / Audio (schon getestet)
Welle 3   Karten-Helfer (map, elevation, daynight, sun, vehicle, music)
Welle 4   UI-Schicht (ui, karteninfo ist schon ts)
Welle 5   Engine (tour.js) — Herzstück
Welle 6   main.js — Verdrahter
Welle 7   Default-Visuals (atmosphere, weather, photopins, buildings, shadows)
Welle 8   Labor-Module (deck*, buildings3d, tiles3d, buildingdata) — oder archivieren
Welle 9   tours.js — Daten; ggf. nur Typen + schmale Loader-TS
```

### Welle 0 — Rauchtest (pflicht, vor allem anderen)

In einer wegwerfbaren Probe oder am ersten echten Kandidaten (`sun.js`):

1. Datei nach `.ts` benennen, minimale Typen, Export gleich.
2. Importe aus verbleibendem JS: `from './sun.js'` (Vite) prüfen.
3. `npm run dev`, `npm run build`, `npm run typecheck`, `npm test`.

**Fallback**, falls JS eine TS-Datei nicht sauber auflöst: `.ts` + handgeschriebene
`.d.ts` für die Übergangszeit nur an der Grenze — Ziel bleibt volle `.ts`-Datei
ohne Doppelpflege.

**Zusätzlich festlegen:**
- Bleibt `window.__j` untypisiert (`any` an einer Stelle) oder bekommt ein
  `src/debugfenster.d.ts`? Empfehlung: schmales Interface `MaptaleDebug`, an
  `main` einmal asserten.
- `erlebnis.html` / Vite-Einstieg: weiter `main.js` bis Welle 6, dann `main.ts`
  (Vite akzeptiert beides; HTML-Script-Src anpassen).

---

### Welle 1 — Blatt-Module (niedriges Risiko)

| Datei | Zeilen | Hinweis |
|---|---:|---|
| `sun.js` | ~31 | rein, idealer erster Schnitt |
| `audioloop.js` | ~63 | |
| `music.js` | ~45 | |
| `exif.js` | ~77 | Schnittmenge mit Studio-`exif.ts` nicht zusammenlegen in diesem Plan |
| `demclean.js` | ~120 | |

**Fertig wenn:** typecheck kennt die Module; keine Runtime-Änderung.

---

### Welle 2 — Bereits getestete / halbwegs reine Kernbausteine

| Datei | Zeilen | Tests / Anker |
|---|---:|---|
| `geo.js` | ~174 | `test/geo.test.js` → nach `.test.ts` mitziehen |
| `audiotracks.js` | ~191 | `test/audiotracks.test.ts`; Studio-`.d.ts` entfällt danach |
| `autoweather.js` | ~154 | an `weather`-Typen aus Tour-JSON anbinden |
| `vehicle.js` | ~53 | hängt an Modus-Liste — ideal **nach oder mit** modi-konsolidierung |

`remote.ts` ist schon TS — hier nur Import-Endungen/Typen glätten, falls nötig.

---

### Welle 3 — Karten-Nebenmodule

| Datei | Zeilen | Risiko |
|---|---:|---|
| `elevation.js` | ~63 | async DEM; Typen für Terrarium-Sample |
| `daynight.js` | ~135 | koppelt an Style-API |
| `map.js` | ~531 | MapLibre-Style, `MODE_ICONS` — groß, aber gut gekapselt |
| `buildings.js` | ~142 | Default-Gebäudepfad; nicht mit Labor vermischen |

MapLibre-Typen: `@types` / mitgelieferte Typen der Dependency nutzen; wo die API
lockerer ist als unser Strict-Modus, Adapter-Typen lokal halten.

---

### Welle 4 — UI

| Datei | Zeilen |
|---|---:|
| `ui.js` | ~489 |

DOM-lastig. IDs aus `erlebnis.html` als Konstanten oder schmale Getter; kein
komplettes UI-Rewrite. `karteninfo.ts` existiert bereits — Muster übernehmen.

---

### Welle 5 — `tour.js` (Engine)

~950 Zeilen, FreeCamera, Phasen, Scrubbing, Presets. **Eigenes PR, ruhiges Fenster.**

Vorgehen:
1. Datei umbenennen, öffentliche Methoden der Klasse/`Tour` typisieren.
2. Interne Hilfen (`Smooth`, Phasen-Enums) als echte Typen.
3. Callbacks (`ui.updateTrace`, `extCamera`) als Interfaces.
4. Keine Algorithmus-„Verbesserungen“.

Smoke: Intro → Fahrt → Foto-Orbit → Finale; Scrub; Wiederaufnahme-Ticket
(`maptale:weiter:`); Moduswechsel hör-/sichtbar.

---

### Welle 6 — `main.js`

~1 150 Zeilen Verdrahter. Wandert **nach** `tour` + `map` + `ui`, sonst typisiert
man gegen `any`-Importe.

Hier fallen die Query-Flags an — beim Tipisieren nur lesen/weiterreichen; die
Politik der Flags steht in [konzept_renderer_labor.md](konzept_renderer_labor.md).

Einstieg in `erlebnis.html` / Vite auf `main.ts` umstellen; `window.__j` einmal
typsicher befüllen.

---

### Welle 7 — Default-Visuals

| Datei | Zeilen | Default? |
|---|---:|---|
| `atmosphere.js` | ~1 117 | ja |
| `weather.js` | ~445 | ja |
| `photopins.js` | ~589 | ja (`pins3d` Default an) |
| `shadows.js` | ~150 | ja (außer Labor-Konflikt) |

`atmosphere.js` ist groß — ggf. in derselben Welle nur umbenennen+typen, **nicht**
intern splitten (Split = eigenes Refactor-Konzept).

---

### Welle 8 — Labor-Module

`deckbuildings.js`, `deckscene.js`, `buildings3d.js`, `tiles3d.js`, `buildingdata.js`
(~1 500 Zeilen gesamt).

Nur migrieren, wenn sie nach dem Renderer-Labor-Konzept **behalten** werden.
Sonst: bleiben JS bis zur Archivierung — keine Tipparbeit in den Abstellraum.

---

### Welle 9 — `tours.js`

~1 180 Zeilen Tour-Daten + Struktur. Optionen:

- **A (empfohlen):** Datei nach `.ts`, `TOURS` als `satisfies`- oder
  `TourConfig`-Typ (Typ aus dem, was `main`/`Tour` wirklich brauchen — nicht das
  ganze Server-`tour.json`-Schema doppelnd).
- **B:** Daten als JSON + schmaler Loader — nur wenn ein zweiter Konsument das
  braucht; sonst Overkill.

Wächter: weiterhin keine `t_`-Schlüssel in `TOURS` (bestehender Test).

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

Repo-Konvention beibehalten:

```ts
import { pointAt } from './geo.js'  // Datei: geo.ts
```

Nach dem Umbenennen einer Datei alle Importe greppen (`geo.js`, `tour.js`, …) —
Web, Tests, ggf. Studio-`.d.ts`-Reste. Drift: eine vergessene Endung fällt in Vite
sofort auf, in `tsc` nur wenn die Datei im Graph ist.

---

## 6. CI und Definition of Done (gesamt)

- `npm run typecheck` umfasst den gesamten Player-Pfad (keine Insel-JS mehr im
  Default-Graph).
- `allowJs` bleibt `false`.
- `npm test` / Deploy-Gate unverändert grün.
- Manuell: Koh Pha-ngan + eine aufgezeichnete Tour, Desktop und schmale Viewport-Breite.
- `CLAUDE.md`-Absatz „neue Module in TypeScript“ → „Player und Studio in TypeScript“;
  Liste der verbleibenden `.js` (wenn nur Labor) explizit nennen.

---

## 7. Nicht-Ziele

- Player auf React/Solid umschreiben.
- Renderer-Default wechseln oder Labor-Flags ausbauen (eigenes Konzept).
- `tours.js`-Inhalte kuratieren / Touren umbauen.
- Bezeichner anglisieren.
- `exactOptionalPropertyTypes` abschalten, „damit es schneller geht“.

---

## 8. Risiken und Gegenmittel

| Risiko | Gegenmittel |
|---|---|
| Riesen-PR an `tour.js`/`main.js` | Eigene Wellen, kein Feature-Beifang |
| Typen zu streng → Laufzeit-Casts überall | Schmale Interfaces am Rand; innen eher präzise als `as any` |
| Doppelte `.d.ts` + `.ts` | Nach Migration `.d.ts` löschen (audiotracks) |
| Labor-Module blockieren den Fortschritt | Welle 8 optional / nach Labor-Entscheidung |
| modi-Konsolidierung parallel | vehicle/map/tour erst nach oder bewusst mit modi-Welle 1 |

---

## 9. Erfolg

- Jede Änderung an Kamera, Wetter oder UI läuft durch `tsc --noEmit`.
- Neue Player-Beiträge sind TS ohne Sonderregeln.
- Der mentale Bruch „Studio modern, Player legacy“ ist weg — übrig bleibt höchstens
  bewusstes Labor-JS auf dem Abstellgleis.
