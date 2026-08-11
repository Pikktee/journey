# Renderer-Labor: ausgebaut am 2026-08-11

Die experimentellen Renderer und die MapLibre-Gebäudeebene sind aus dem
Hauptprojekt entfernt. Dieses Blatt sagt, **was es gab, warum es ging und wie man
es zurückholt**. Es ist Historie — keine Implementierungsquelle.

Nichts davon ist geplant. Wer wieder in diese Richtung forscht, fängt sinnvoll
gegen die dann aktuellen Bibliotheken neu an; der Tag bewahrt die Erkenntnisse
und den Referenzcode, keinen einbaufähigen Zustand.

---

## Der Tag

```bash
git switch -c labor/renderer labor/renderer-v1   # Branch erst bei Bedarf
git show labor/renderer-v1:src/deckscene.js      # nur nachsehen
```

`labor/renderer-v1` ist ein annotierter Tag auf `dd45846` (v0.59.4) — dem letzten
Commit, der alles vollständig enthält. Bewusst **kein Branch**: Ein Branch
verwaist, taucht in jeder Übersicht auf und behauptet, weiterentwickelt zu
werden. Ein Tag ist unveränderlich und trägt seine Begründung selbst
(`git tag -n20 labor/renderer-v1`).

`git revert` des Ausbau-Commits funktioniert nur, solange drumherum wenig
gewandert ist — nach der TypeScript-Migration des Players wird das konfliktreich.
Der realistische Weg ist, einzelne Dateien aus dem Tag zu holen und neu
anzuschließen.

---

## Was entfernt wurde

| Datei | Zeilen | Flag | Was es war |
|---|---:|---|---|
| `src/deckscene.js` | 487 | `?scene=1` | eigenständige deck.gl-Szene (Terrain + Satellit), MapLibre unsichtbar als Kamera-/Terrain-Rechner. Stufe 0–2 des Renderer-Plans |
| `src/buildings3d.js` | 409 | `?roofs=1` | Three.js-Dächer über MapLibre-Boden, prozedural (nordic/alpine) |
| `src/buildingdata.js` | 270 | — | geteilte Datenschicht der drei Gebäude-Renderer |
| `src/tiles3d.js` | 249 | `?tiles3d=1` | Google Photorealistic 3D Tiles via 3DTilesRendererJS (kein Cesium) |
| `src/deckbuildings.js` | 161 | `?deck=1` | Hybrid: deck.gl-Gebäude über MapLibre-Boden |
| `src/buildings.js` | 142 | — | Dachfarben-Sampling aus dem Satellitenbild (`feature-state`) |
| `src/shadows.js` | 150 | — | geerdete Wurfschatten ohne zweiten Renderer |

Dazu: der `buildings-3d`-Layer samt OpenFreeMap-Vektorquelle und den
Farbpaletten in `map.js`, der dev-only Ansicht-Umschalter in `main.js` /
`erlebnis.html` / `style.css`, der Google-Key-Dialog (`#g3d`), `tour.extCamera`
und die Query-Flags `?deck` `?scene` `?roofs` `?tiles3d` `?buildings`
`?noshadows`.

Aus `package.json` fielen sieben Pakete: `@deck.gl/core`, `/extensions`,
`/geo-layers`, `/layers`, `/mapbox`, `@loaders.gl/mvt`, `3d-tiles-renderer`.
**`three` blieb** — die 3D-Foto-Pins des Produkts brauchen es.

Zusammen rund 2 150 Zeilen.

---

## Warum

Alle Pfade waren nur im Entwicklermodus erreichbar (`body.dev`, der Umschalter
trug `dev-only`), und die Gebäude waren im Produkt **dauerhaft ausgeblendet**:
`buildings3dOn` war ohne Flag immer `false`. Kein Nutzer hat je etwas davon
gesehen — `buildings.js` sampelte trotzdem bei jedem Kachel-Laden Dachfarben für
einen unsichtbaren Layer, und jede Änderung an Kamera, Tag/Nacht oder Wetter
musste die Labor-Verzweigungen mitdenken.

Der konkrete Anlass war die geplante TypeScript-Migration des Players
([konzept_player_typescript.md](../concepts/konzept_player_typescript.md)): Weil
`main.js` vier der Module **dynamisch** importierte und ein dynamischer Import
einer untypisierten `.js` denselben `TS7016` wirft wie ein statischer, hätte das
Labor die letzte Migrationswelle blockiert — entweder durch Typisierarbeit an
Code auf dem Abstellgleis oder durch eine Deklarationsdatei, die diesen Zustand
festgeschrieben hätte.

---

## Was die Spikes gelehrt haben

Die Messwerte und Begründungen im Einzelnen stehen in
[renderer-plan.md](renderer-plan.md), die Abgrenzung Produkt/Labor in
[konzept_renderer_labor.md](konzept_renderer_labor.md) — beide liegen jetzt hier
im Archiv. Die vier Punkte, die ein Neuanlauf kennen sollte:

1. **Das Flimmern war datenseitig, nicht renderseitig.** In den OpenFreeMap-
   Kacheln fehlt `hide_3d`, ~15 % der Polygone überlappen (Umriss + `building:parts`)
   → koplanares Z-Fighting. Clientseitig nicht sauber lösbar. Der Trick, der wirklich
   griff: alle Gebäudefarben auf **konstante Luminanz** normalisieren, dann kippt der
   Z-Fight nur im Farbton statt in der Helligkeit.
2. **Echte Schatten brauchen echte Geometrie.** Im deck.gl-Spike fielen Schatten
   nur auf deck-Geometrie, nicht auf MapLibres Terrain — im Bergland versank alles.
   Deshalb waren die ausgelieferten Schatten geometrisch gefälscht (verschobene
   Kopie des Grundrisses), was auch im Hang funktionierte.
3. **Pixel waren nie der Hebel.** Foto-Dächer aus Orthofotos wurden verworfen
   (z18 skaliert nicht, Gewinn marginal). Der nächste echte Hebel wären bessere
   DATEN (Overture: echte Dachformen), nicht mehr Auflösung.
4. **Der Engpass ist MapLibres Terrain-/Raster-Pipeline** (~72–90 % der Frame-Zeit),
   nicht unser Overlay-JS (~2 %). Ein zweiter Renderer löst das nicht automatisch.

Google Photorealistic 3D war ein eigener Track: beeindruckend, aber
API-Key-pflichtig, kostenpflichtig jenseits 1.000 Sessions/Monat und nur für
~2.500 Städte verfügbar (nicht alpin) — kein Default-Kandidat für ein Produkt
auf freien Kartendaten.
