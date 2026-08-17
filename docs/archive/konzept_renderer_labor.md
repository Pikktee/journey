---
archiviert_aus: concepts
---

# Umbauplan: Renderer-Labor begrenzen

> **Archiviert am 2026-08-11.** Die hier beschriebenen Renderer sind aus dem
> Hauptprojekt ausgebaut; der Code hängt am Tag `labor/renderer-v1`. Was
> geblieben ist und wie man es zurückholt: [renderer-labor.md](renderer-labor.md).
> Dieses Blatt ist Historie — die Dateiverweise zeigen ins Leere.

**Ziel:** Den **Default-Player** (MapLibre + `fill-extrusion` + Schatten + 3D-Pins)
klar und pflegbar halten. Experimentelle Renderer bleiben Labor — dokumentiert,
am Einstieg isoliert, ohne stillen Anspruch auf den Produktpfad.

Stand: **2026-08-07**, nichts davon umgesetzt. Baut auf
[renderer-plan.md](renderer-plan.md) auf (Stufen 0–2 gebaut,
Stufe 3–4 offen) und trennt **Forschung** von **Auslieferung**.

---

## 1. Warum das nötig ist

Heute hängen in [src/main.js](../../src/main.js) mehrere Welten an Query-Flags:

| Flag | Modul | Rolle |
|---|---|---|
| *(kein Flag)* | `map.js` + `buildings.js` + `shadows.js` + `photopins.js` | **Produkt-Default** |
| `?deck=1` | `deckbuildings.js` | Hybrid: deck-Gebäude über MapLibre |
| `?scene=1` | `deckscene.js` | Eigenständige deck-Szene (Stufe 0–2) |
| `?roofs=1` | `buildings3d.js` | Three.js-Dächer über MapLibre-Boden |
| `?tiles3d=1` | `tiles3d.js` | Google Photorealistic 3D Tiles |
| `?pins3d=0` / `=foto` | `photopins.js` | A/B bzw. Variante am Default-Pfad |
| `?noshadows=1` | — | Schatten aus (Mess-/Vergleich) |

Zusätzlich ein Ansichts-Umschalter in der UI, der `deck` / `scene` / `tiles3d`
setzt und die URL umschreibt.

**Kosten der Offenheit:**
- Jeder Tag/Nacht-, Gebäude- und Trace-Hook in `main.js` verzweigt in Labor-Pfade.
- Performance- und Optik-Bugs sind mehrdeutig („welcher Renderer?“).
- Agenten und Menschen behandeln Labor-Code wie Produktcode (Typen, Features, Fixes).
- [renderer-plan.md](renderer-plan.md) Stufe 4 („Default wechseln“)
  wirkt näher, als die Produktentscheidung ist.

Dieses Konzept **stoppt den Drift**, ohne die Spikes zu löschen.

---

## 2. Leitregeln

1. **Ein Default.** Auslieferung und „normale“ Dev-URL ohne Labor-Flags = MapLibre-
   Pfad wie heute. Kein stiller Default-Wechsel ohne eigene Produktentscheidung
   (die wäre Stufe 4 im Renderer-Plan — und ein eigenes Go).
2. **Labor ist opt-in und erkennbar.** Flag + Kommentar + eine Liste an einer Stelle.
3. **Produktfeatures enden im Default-Pfad.** Foto-Pins, Wetter, Audio, UI-Clean,
   SEO-Tourkopf — nicht „und bitte auch in `?scene=1`“.
4. **Labor darf brechen.** Kein Versprechen von Parität. CI muss den Default grün
   halten; Labor-Module nicht mit Coverage-Pflicht belasten.
5. **Kein zweites Heimweh.** Entweder Labor pflegen (selten) oder archivieren —
   nicht halb.

---

## 3. Drei Körbe

### Korb A — Produkt (Default)

Immer geladen bzw. zum Default gehörend:

- `map.js`, `tour.js`, `ui.js`, `geo.js`, …
- `buildings.js` (`fill-extrusion` + Luminanz-Normalisierung)
- `shadows.js` (an, außer `?noshadows=1`)
- `photopins.js` (3D-Pins **an** im Default; siehe unten)
- `atmosphere.js`, `weather.js`, `daynight.js`, …

### Korb B — Labor (behalten, isolieren)

Forschung mit erkennbarem Mehrwert oder offenem Architektur-Spike:

| Flag | Status laut renderer-plan | Empfehlung |
|---|---|---|
| `?scene=1` | Stufe 0–2 gebaut | **Haupt-Labor** — einzige Linie Richtung „eigene Szene“ |
| `?tiles3d=1` | eigener Track (Google) | Labor / Demo; API-Key-Pflicht bleibt; **nicht** Default-Kandidat fürs freie Produkt |
| `?deck=1` | Spike, Schatten-Limit bekannt | nur behalten, solange er `scene` noch etwas lehrt; sonst Korb C |

### Korb C — Einfrieren oder entfernen

| Flag | Empfehlung |
|---|---|
| `?roofs=1` | **Einfrieren:** kein Feature-Port mehr; in Labor-Liste als „Seitenast, nicht weiter“ oder nach Smoke-Verlust löschen |
| `?deck=1` (wenn `scene` ihn ersetzt) | nach kurzer Übergangsnotiz → Code nach `docs/archive/`-Vermerk entfernen oder Ordner `src/labor/` |

**Pins:** `?pins3d=0` und `?pins3d=foto` sind **kein** Renderer-Labor im Sinne von
deck/Google — sie sind Varianten/A-B am Produktpfad. Behalten; in der Labor-Doku
nur kurz abgrenzen („Produkt-Flag, nicht Korb B“).

---

## 4. Wellen

### Welle 1 — Eine Quelle der Wahrheit für Flags

Neu: schmales Modul, z. B. [src/rendererflags.ts](../../src/rendererflags.ts)
(Name egal, eine Datei):

```ts
/** Query-Flags des Players. Produkt vs. Labor — siehe docs/concepts/konzept_renderer_labor.md */
export type RendererLabor = 'kein' | 'deck' | 'scene' | 'roofs' | 'tiles3d'

export function liesRendererFlags(params: URLSearchParams): {
  labor: RendererLabor
  pins3d: 'an' | 'aus' | 'foto'
  noshadows: boolean
  // …
} { /* … */ }

/** Nur Dev/Debug: erlaubte Labor-Werte für den Ansichts-Umschalter. */
export const LABOR_SCHALTER: ReadonlyArray<{ id: RendererLabor; label: string }> = [
  { id: 'kein', label: 'MapLibre' },
  { id: 'scene', label: 'deck-Szene (Labor)' },
  { id: 'tiles3d', label: 'Google 3D (Labor)' },
  // deck/roofs nur wenn noch nicht eingefroren
]
```

`main.js` liest **nur noch** über dieses Modul — keine verstreuten
`params.get('scene') === '1'`-Inseln für denselben Begriff.

**Fertig wenn:** ein Grep auf `params.get('deck'|'scene'|'roofs'|'tiles3d')` außerhalb
der Flag-Datei (und ggf. Tests) leer ist bzw. nur Wrappers trifft.

---

### Welle 2 — UI: Labor nicht als gleichwertige „Ansicht“

Heute wirkt der Umschalter wie ein Produkt-Menü mit vier gleichrangigen Modi.

**Soll:**
- Default-Nutzer (kein Flag, keine Dev-Geste): **kein** Labor-Umschalter — oder
  nur hinter einem klaren Debug-Einstieg (z. B. bestehendes Debug-Panel /
  `localStorage`-Schalter `maptale:labor=1`, nicht die normale Steuerleiste).
- Wenn Labor-UI bleibt: Labels mit „Labor“ / „Experiment“, und `roofs`/`deck`
  entfallen, sobald Korb C greift.

**Nicht:** Labor-Modus in der Android-WebView als normale Option anbieten.

---

### Welle 3 — `main`-Verdrahtung entflechten

Zielstruktur (logisch, nicht zwingend eigene Dateien):

```
main: Default-Pfad verdrahten
  └─ if (flags.labor !== 'kein') installiereLabor(flags, { map, tour, route, … })
```

`installiereLabor` (z. B. `src/labor/installiere.ts`) kapselt lazy `import()` von
`deckscene` / `tiles3d` / … und die Hooks (`extCamera`, `setProgress`, Night).

Default-Pfad enthält **keine** `tiles3d?.setNight`-Strohmann-Aufrufe mehr — der
Labor-Installer hängt Listener / Wrapper.

**Fertig wenn:** Lesen von `main`’s `map.on('load')` erzählt zuerst die Produktstory;
Labor ist ein Block oder ein Aufruf.

---

### Welle 4 — Dokumentation und Agenten-Hinweise

1. [renderer-plan.md](renderer-plan.md): Kopf ergänzen —
   „Stufen 0–2 = Labor (`?scene=1`); Default bleibt MapLibre bis ausdrückliches Go
   zu Stufe 4.“ Empfehlung „Stufe 0 als Nächstes“ im Plan historisch lassen, aber
   **Produktpriorität** hierher verweisen.
2. `CLAUDE.md` / `AGENTS.md`: Renderer-Absatz kürzen — Default beschreiben; Labor
   in einem Satz + Link auf dieses Konzept.
3. `docs/README.md`: dieses Konzept unter `concepts/` (erledigt mit Anlage).

---

### Welle 5 — Aufräumen Korb C

Pro Modul in Korb C:

1. Letzten manuellen Smoke notieren (Datum, Tour, Gerät) — oder „seit X Monaten
   ungenutzt“.
2. Entweder:
   - **Einfrieren:** Datei behalten, erster Kommentar `LABOR EINGEFROREN — nicht
     erweitern`; aus dem UI-Schalter nehmen; Flags funktionieren noch für
     Archaeologie.
   - **Entfernen:** Datei + Imports + Flag-Zweige weg; kurzer Eintrag unter
     `docs/archive/` („roofs-Renderer, entfernt JJJJ-MM“).

Keine Pflicht, alles an einem Tag zu löschen. Pflicht ist die **Entscheidung**.

---

### Welle 6 — Politik für Weiterbau (ongoing)

| Wenn … | Dann … |
|---|---|
| Neues Gebäude-/Boden-Experiment | nur hinter Flag, Code unter `src/labor/` oder bestehendem Labor-Modul, Eintrag in `liesRendererFlags` |
| Labor schlägt Default messbar (Optik + Perf + Wartung) | eigenes Entscheidungsdokument / Go für Renderer-Plan Stufe 4 — **nicht** still `scene` zum Default machen |
| Niemand hat `?scene=1` seit N Releases gebraucht | Welle-5-Review: einfrieren oder entfernen |
| Player-TS-Migration ([konzept_player_typescript.md](konzept_player_typescript.md)) | Labor-Module = deren Welle 8; Default zuerst |

---

## 5. Was explizit Produkt bleibt

- **3D-Foto-Pins** Default an ([foto-pins-3d.md](../architecture/foto-pins-3d.md)).
- **Wurf-Schatten** Default an (`?noshadows=1` nur Messausnahme).
- **Gebäude-Umschalter** „Gebäude aus/ein“ am Default-Layer (und nur dann Labor
  mitziehen, wenn Labor ohnehin aktiv ist — keine Pflicht-Parität).

---

## 6. Tests und CI

- Keine neuen Pflicht-Tests für Labor-Rendererdarstellung.
- Optional: Unit-Test auf `liesRendererFlags` (Matrix der Query-Strings) — klein,
  stabilisiert Welle 1.
- Deploy-Gate unverändert am Default-Build; Labor-Code lazy → Bundle-Default
  sollte nicht wachsen. Nach Welle 3 einmal `npm run build` und Chunk-Namen prüfen:
  Labor in eigenen Async-Chunks.

---

## 7. Nicht-Ziele

- Jetzt auf deck.gl oder Google 3D als Default umstellen.
- Alle Labor-Dateien sofort löschen.
- Parität Wetter/Pins/Audio in jedem Labor-Pfad erzwingen.
- Cesium wieder einführen.

---

## 8. Erfolg

- Neue Feature-PRs berühren `deckscene` / `tiles3d` / `buildings3d` nur noch bewusst.
- `main` ist für den Default-Pfad lesbar.
- Renderer-Plan Stufe 4 ist eine **Entscheidung**, kein schleichendes Ergebnis von
  Flag-Parität.
- Labor bleibt möglich — nur nicht mehr kostspielig für den Alltag.
