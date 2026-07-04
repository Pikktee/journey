# Renderer-Plan: von MapLibre-Klötzen zur echten 3D-Szene

Stand: 2026-07 · Status: **Stufe 0–2 gebaut** ([src/deckscene.js](../src/deckscene.js), Flag
`?scene=1`) — eigenständige deck-Szene mit Terrain+Satellit, Gebäuden, geerdeten Schatten,
Route, Wegpunkten, Himmel und Tag/Nacht; gemeinsame Datenschicht [src/buildingdata.js](../src/buildingdata.js)
(mit dem Hybrid geteilt). Offen: **Stufe 3** (Anti-Klotz-Realismus: eigene Satelliten-Textur-
Drapierung fürs Nahbild, Fassaden/Fenster, AO) und **Stufe 4** (Default-Wechsel/MapLibre-Rückbau).

## 1. Warum überhaupt

Wir haben MapLibres `fill-extrusion` bei den Gebäuden **ausgereizt**. Aktueller Stand
(gut, aber am Limit): geerdete Fake-Schatten ([src/shadows.js](../src/shadows.js)),
luminanz-normalisierte + entsättigte Satelliten-Dachfarben ([src/buildings.js](../src/buildings.js)),
vertikaler Verlauf, gerichtetes Licht.

Drei Probleme bleiben — und sie haben **eine gemeinsame Wurzel**: MapLibre besitzt die
3D-Szene nicht wirklich.

| Symptom | Wurzel |
|---|---|
| „Spielzeugklötze" (keine Fassaden/Fenster/Dächer/AO) | `fill-extrusion` kann nur flach eingefärbte Prismen |
| Doppelschatten auf dem Satellitenbild | Der Boden ist ein fixes Raster, wir haben keine Hoheit über seine Schattierung |
| Häuser sitzen nicht 100 % auf der Textur | OSM-Grundriss ↔ Esri-Luftbild-Registrierung + Bild-Parallaxe; kein Terrain-Drape der Baukörper |

Alle drei verschwinden, sobald **Terrain + Satellit + Gebäude in EINEM Renderer** liegen,
der Tiefe, Licht und Material selbst kontrolliert.

## 2. Was der deck.gl-Spike gelehrt hat

Der erste Spike ([src/deckbuildings.js](../src/deckbuildings.js), Flags `?deck=1/2`) hat
deck.gl-Gebäude **über** MapLibre gelegt. Ergebnis (am echten Dev-Server geprüft):

- ✅ Kamera-Sync über `MapboxOverlay` funktioniert, läuft flüssig (interleaved).
- ❌ Schatten fielen nur auf deck.gl-Geometrie, **nicht** auf MapLibres Satellitenboden.
- ❌ Häuser lagen ein paar Meter daneben (kein Terrain-Drape).

**Schlüssel-Erkenntnis:** Der Boden muss MIT in den Renderer. Genau das ist der Plan hier —
nicht „Layer über MapLibre", sondern eine **eigene deck.gl-Szene** mit Terrain-Mesh als
Schatten-Empfänger.

## 3. Renderer-Wahl: deck.gl

Drei Kandidaten, kurz abgewogen:

- **deck.gl** ← Empfehlung. Bereits installiert (v9). Alle Bausteine vorhanden:
  `TerrainLayer` (DEM→Mesh + Satellit-Textur), `MVTLayer` (Gebäude), `TerrainExtension`
  (drapiert Polygone exakt aufs Terrain → löst den Sitz), `LightingEffect`+Schatten
  (fallen auf das Terrain-Mesh → **geerdete** Schatten), `SimpleMeshLayer`/`extensions`
  (texturierte Fassaden später). JS-nativ, passt zur bestehenden Kamera-Mathematik.
- **Three.js**: maximale Kontrolle (PBR, echte Fassaden-Texturen, SSAO, Post-FX), aber
  Terrain-Mesh, Satelliten-Drape, Tile-Streaming und Kamera-Sync komplett selbst bauen.
  Deutlich mehr From-Scratch-Aufwand. Option, falls deck.gl bei Fassaden-Realismus an
  Grenzen stößt — nicht als Startpunkt.
- **CesiumJS**: „Batteries included" (Globus/Terrain/Imagery/3D-Tiles/Schatten), schon
  fürs Google-3D geladen. Aber: schwergewichtig, eigenes Ökosystem, Styling-Hoheit
  geringer, und für eigene Gebäude bräuchten wir 3D-Tiles (ion-Pipeline). Overkill für
  unseren fokussierten Anwendungsfall.

**Begründung deck.gl:** niedrigste Einstiegshürde (installiert, gespiked), deckt mit
Bordmitteln **alle drei** Probleme ab, und bleibt inkrementell an die vorhandene Engine
andockbar.

## 4. Architektur: MapLibre bleibt „headless" (inkrementell, geringes Risiko)

Wir bauen **keinen** Big-Bang-Rewrite. Blaupause ist die vorhandene Cesium-Bridge
([src/photoreal.js](../src/photoreal.js)): Die Tour-Engine ([src/tour.js](../src/tour.js))
läuft weiter, MapLibre bleibt — zunächst **unsichtbar** — als Rechen-Engine:

- **Kamera-Mathematik**: `map.calculateCameraOptionsFromTo(...)` in `applyCamera()` bleibt
  die Quelle der Pose. Die Engine ruft schon `this.extCamera?.({cg, alt, lt, ltAlt})` —
  der neue deck-Renderer hängt sich dort an (wie Cesium heute).
- **Terrain-Höhen**: `map.queryTerrainElevation()` (in `groundAlt()`) bleibt die Höhen-
  quelle. Perspektivisch aus demselben DEM in JS ersetzbar (wir laden Terrarium-Tiles
  schon in [src/elevation.js](../src/elevation.js)), aber nicht im MVP nötig.

So bleibt die gesamte, gut abgestimmte Kamera-Regie (Glättung, Presets, Foto-Orbits,
Scrubbing) **unangetastet**. Nur das Bild kommt aus deck.gl statt MapLibre.

Langfristig (nach MVP) kann MapLibre ganz entfallen, wenn Kamera-Mathe + Terrain-Query in
JS nachgebaut sind. Kein Muss.

## 5. Was neu gerendert werden muss

Heute in MapLibre, muss in der deck-Szene neu entstehen (oder als Overlay bleiben):

| Element | Heute | In der deck-Szene |
|---|---|---|
| Terrain + Satellit | MapLibre raster-dem + raster | `TerrainLayer` (DEM-Elevation + Satellit-Textur) |
| Gebäude | `fill-extrusion` | `MVTLayer` extrudiert + `TerrainExtension`, später Fassaden-Mesh |
| Routen-Linie | GL line-Layer ([addRouteLayers](../src/map.js)) | `PathLayer` (oder als 2D-Overlay behalten) |
| Foto-Wegpunkte | GL circle/symbol ([addSpotLayers](../src/map.js)) | `ScatterplotLayer`/`IconLayer` |
| Fahrer-Marker | DOM-`Marker` | bleibt DOM (liegt über dem Canvas) ✓ |
| Himmel/Atmosphäre | Style `sky` | deck-Hintergrund / Skybox |
| Tag/Nacht | [daynight.js](../src/daynight.js)+[sun.js](../src/sun.js) → Style | Licht-Richtung/-Farbe der `LightingEffect` steuern |
| Höhenprofil, UI, Overlays | DOM ([ui.js](../src/ui.js)) | bleibt DOM ✓ |

Wichtig: **Route, Wegpunkte, Himmel, Tag/Nacht** sind echter Portierungsaufwand, nicht nur
die Gebäude. Das ist der Hauptgrund, warum das eine mehrstufige Investition ist.

## 6. Datenschicht: Gebäude-Geometrie

Das Flimmern kam von überlappenden OSM-Polygonen ohne `hide_3d`
([Memo](../../.claude/…/gebaeude-flimmern-zfight.md)). Im eigenen Renderer lösbar:

- **MVP**: OpenFreeMap-Tiles weiter nutzen, aber beim Meshing **client-seitig
  deduplizieren** (überlappende Umriss-/`building:part`-Polygone erkennen und
  zusammenführen). Im Renderer haben wir die Geometrie in der Hand — anders als bei
  `fill-extrusion`.
- **Später**: bessere Quelle mit Dachformen/Fassaden-Attributen prüfen
  (**Overture Maps** Buildings hat teils Dachform/-höhe), oder **eigene aufbereitete
  Gebäude-Tiles** (Backend-Pipeline — passt zum Mehrbenutzer-/Produkt-Ziel, aber eigenes
  großes Arbeitspaket).

## 7. Inkrementeller Fahrplan

Jede Stufe ist einzeln lauffähig und bewertbar (hinter `?deck`-Flag, bis sie den
MapLibre-Weg schlägt). Aufwand relativ, nicht als Kalenderzusage.

**Stufe 0 — Terrain-Szene-Spike (klein).** `TerrainLayer` mit unserem DEM + Esri-Satellit
in einer eigenen deck-Szene, Kamera aus `extCamera` gespiegelt, MapLibre unsichtbar.
Ziel-Frage: Sitzt Terrain+Satellit deckungsgleich zur bisherigen Ansicht, flüssig?
→ *Beweist die Grundarchitektur.*

**Stufe 1 — Gebäude + geerdete Schatten (Kern-Payoff).** `MVTLayer` extrudiert mit
`TerrainExtension` (sitzt exakt) + `LightingEffect` mit Schatten auf dem Terrain-Mesh.
→ *Hier zeigt sich: echte Schatten auf der Straße, kein Doppelschatten, korrekter Sitz.*
Zuerst Stockholm (flach), dann Oberland (Terrain-Drape).

**Stufe 2 — Portierung Route/Wegpunkte/Fahrer/Himmel/Tag-Nacht.** Damit die deck-Szene
die MapLibre-Ansicht voll ersetzen kann und der `?deck`-Modus alltagstauglich wird.

**Stufe 3 — Anti-Klotz-Realismus.** Fassaden-Fenster (prozedural im Layer-Shader oder als
Textur), Dachfarbe getrennt von Fassade, AO/Kontaktschatten, Material-Feinschliff.
→ *Der eigentliche Look-Sprung.* Aufwändigste Stufe, ggf. Bedarf für Three.js-Evaluierung,
falls deck.gl-Materialien nicht reichen.

**Stufe 4 — Umschalten + MapLibre-Rückbau (optional).** deck-Szene wird Default,
MapLibre entweder headless (Kamera/Terrain) behalten oder durch JS-Äquivalente ersetzen.

## 8. Risiken

- **Fassaden-Realismus** (Stufe 3) ist die eigentliche Wette: deck.gls Material-System ist
  gut, aber kein voller PBR-/Post-FX-Stack. Fenster überzeugend hinzubekommen kann Custom-
  Shader-Arbeit oder einen Three.js-Schwenk bedeuten. **Deshalb Stufe 3 erst nach 0–2.**
- **Performance** mit Terrain-Mesh + Schatten-Pass + Gebäuden gleichzeitig — messen wir in
  Stufe 1. (M4 hat Reserven; Zielhardware-Bandbreite offen.)
- **Portierungsbreite** (Stufe 2): Route/Wegpunkte/Himmel/Tag-Nacht sind Detailarbeit mit
  vielen kleinen visuellen Feinheiten, die heute stimmen und nicht schlechter werden dürfen.
- **Doppelte Pflege** während der Übergangszeit (MapLibre- UND deck-Pfad hinter Flag).

## 9. Entscheidungen, die noch offen sind

1. **Gebäude-Quelle**: OpenFreeMap+Client-Dedup (schnell) vs. Overture (bessere Attribute)
   vs. eigene Tiles (Backend, groß). → MVP mit OpenFreeMap, Rest später.
2. **Wie weit Realismus?** Reicht „solide, beschattet, gut sitzend" (Stufe 0–2), oder muss
   es bis zu Fenstern/Dächern (Stufe 3)? Bestimmt, ob es ein 2-Stufen- oder 4-Stufen-Projekt ist.
3. **MapLibre-Zukunft**: headless behalten (pragmatisch) vs. später ganz ersetzen (sauberer,
   mehr Arbeit).

## Empfehlung

**Stufe 0 als Nächstes bauen** — die Terrain-Szene ist klein und beantwortet die teuerste
Architektur-Frage („trägt eine eigene deck-Terrain-Szene deckungsgleich und flüssig?").
Erst danach Stufe 1 (der sichtbare Payoff: geerdete Schatten + korrekter Sitz). Über
Stufe 3 (Fenster/Fassaden) entscheiden wir erst, wenn 0–2 stehen und wir den realen
Look-Gewinn sehen.
