# 3D-Foto-Pins auf der Terrainkarte

Frage: Lassen sich die nummerierten Foto-Wegpunkte, heute flache Kreise am Boden,
dreidimensional mit Höhe darstellen — als Pin, der über dem Gelände steht?

**Antwort: ja, aber nur mit einem eigenen Renderer.** Inzwischen die
**Standarddarstellung** der Foto-Stopps: [src/photopins.js](../../src/photopins.ts) (Three.js-
Custom-Layer) mit den Rechenregeln in [src/pin-model.ts](../../src/pin-model.ts) (DOM-frei,
21 Vitest-Fälle in [test/pin-model.test.ts](../../test/pin-model.test.ts)).

* `?pins3d=0` schaltet auf die alten flachen Kreise zurück — A/B-Vergleich wie bei den
  Renderer-Flags, und der Rückfall, falls ein Gerät Ärger macht.
* `?pins3d=foto` zeigt das Bild des Stopps im Kopf statt der Nummer.

Der Startpunkt-Dot bleibt flach (er ist kein Halt). Klick und Fortschritts-Zustände
verhalten sich wie bei den 2D-Layern.

## Machbarkeit — was MapLibre 5.24 kann und was nicht

Geprüft am installierten Bundle, nicht aus der Erinnerung:

| Weg | Ergebnis |
| --- | --- |
| Symbol-/Circle-Layer über Grund heben | **Nein.** `symbol-z-offset` und `*-elevation-reference` existieren in dieser Version nicht (kommen aus der Mapbox-Welt bzw. späteren Specs). `circle-pitch-alignment: viewport` hält den Kreis zur Kamera, aber am Boden. |
| `fill-extrusion` als Mast | Geometrisch ja, aber der Klotz trägt weder Text noch eine kamerazugewandte Scheibe — Nummer und Foto am Kopf wären unmöglich, und eine Beschriftung ließe sich nicht dorthin heben. |
| DOM-Marker (wie der Fahrer) mit Pixel-Offset | **Nein.** Ein Marker kennt nur eine Bodenkoordinate; ein Offset nach oben wäre nicht perspektivisch — die Pinhöhe schrumpfte nicht mit der Entfernung, bei Kameraschwenks „klebte" der Kopf falsch. |
| Custom Layer (`renderingMode: '3d'`) mit Three.js | **Ja.** Damals im Repo etabliert (buildings3d.js, deckscene.js — inzwischen ausgebaut, s. [Archiv](../archive/renderer-labor.md)): Mercator-Ursprung + MapLibres Projektionsmatrix, Three rendert in denselben WebGL-Kontext. |

Zusätzlich belegt: **MapLibres Terrain schreibt Tiefe**, gegen die ein Custom Layer
testen kann. Mast und Bodenring werden vom Gelände geschnitten (im A/B mit
`__j.pins.setTiefentest(false)` nachgewiesen); der Kopf ist bewusst davon ausgenommen
und bleibt immer lesbar — dieselbe Entscheidung wie beim Fahrer-Marker
(`opacityWhenCovered: '1'`).

## Der Entwurfspunkt ist der MASSSTAB, nicht die Geometrie

Eine feste Pinhöhe in Metern funktioniert nicht: 40 m sind im Intro-Anflug (Kamera
~3 km hoch) ein Zahnstocher und am Foto-Orbit (~200 m) ein Sendemast. Die Größe kommt
deshalb aus der Kameradistanz, mit einem Mischfaktor `MASSE.perspektive` zwischen

* **bildschirmstabil** (1,0 — Verhalten der alten 2D-Kreise, aber ohne Tiefeneindruck) und
* **weltfest** (0,0 — ferne Pins verschwinden).

Voreinstellung 0,82: fast bildschirmstabil, nahe Pins bleiben spürbar größer als ferne.
Genau diese Restperspektive erzeugt den 3D-Eindruck. Die resultierende Pixelgröße ist
zusätzlich geklemmt (0,5×–1,7×), damit weder Intro noch Orbit das Bild sprengen.

Der Maßstab wird **aus der Projektionsmatrix gemessen** (ein Meter entlang der
Bildschirm-Rechts-Achse projizieren), nicht aus der Kameraposition gerechnet: MapLibre 5
hat keine `getFreeCameraOptions()` mehr, und die Messung ist gegenüber Projektions-
Details unempfindlich.

## Fallen, die beim Bau aufgeschlagen sind

* **Der Mercator-Raum ist gespiegelt** (y zeigt nach Süden) → die Winding-Order kippt.
  Die flach liegende Bodenscheibe wurde mit dem Three-Default `FrontSide` komplett
  weggecullt: unsichtbar, unabhängig von Größe, Höhe und Tiefentest. `DoubleSide` ist
  hier Pflicht, keine Bequemlichkeit.
* **Bodennahe Flächen verschwinden im Tiefentest.** Der Fußring braucht spürbaren
  Abstand (3 % der Masthöhe); 0,2 m reichten nicht.
* **`queryTerrainElevation` liefert die Höhe inklusive Überhöhung** — genau dafür ist
  sie da. Ohne sie stünde der Fuß im Hang statt auf dem gerenderten Boden.
* **Nachladende DEM-Kacheln ändern die Höhe um Meter.** Hart gesetzt springt der Pin
  sichtbar; die Höhe wird deshalb pro Frame nachgezogen.
* **Transparenz ohne Tiefenschreiben braucht explizite Reihenfolge.** Three sortiert
  über seine Kameramatrix — die gibt es hier nicht (die Projektion kommt von MapLibre),
  also wird `renderOrder` pro Frame aus der Clip-Tiefe gesetzt.

## Was es kostet — gemessen, nicht geschätzt

**Messaufbau** (wiederholbar, Skripte im Scratchpad dieser Sitzung):

* Playwright mit `channel: 'chromium'` + `--use-angle=metal`. **Wichtig:** Playwrights
  Default-Headless rendert mit SwiftShader (Software) — dort liegt der Player bei ~2 fps
  und jede Messung ist wertlos. Mit ANGLE/Metal läuft es headless auf der echten M4-GPU.
* A/B/A/B in EINER Seite über `pins.setVisible()` — gleicher Kachel-Cache, gleiche
  Kameraphase. Jeder Block fährt DENSELBEN Streckenmeter erneut ab; ein einfaches
  Durchfahren misst überwiegend das Kachel-Laden (erste Versuche schwankten um ±30 %
  und lieferten sogar negative Differenzen).
* Zusätzlich direkt: die `render`-Funktion des Custom Layers von außen umhüllt und ihre
  CPU-Zeit pro Frame gemittelt. Das ist die belastbarere Zahl, weil sie nicht im
  vsync-Deckel verschwindet.

| Fall | Layer-CPU je Frame | Bildrate |
| --- | --- | --- |
| Desktop 1440×900 @2, M4, 12 Pins | **0,20 ms** (vor der Sichtbarkeitsprüfung 0,59 ms) | 60 fps mit und ohne Pins, Differenz im Rauschen (~0,1 ms) |
| **Pixel 9, Chrome, Hochformat** (Mali-G715) | **0,71 ms** | 26,0 vs. 26,1 ms/Frame — **kein messbarer Unterschied** (38 fps) |
| **Pixel 9, Chrome, Querformat** | **1,50 ms** | 33,2 vs. 31,0 ms/Frame → **+2,2 ms bzw. 7 %** (30,1 statt 32,3 fps) |
| **Pixel 9, Querformat, MIT Detailstufe** | **0,80 ms** (−47 %) | 22,0 vs. 21,5 ms → +0,5 ms, **unter der Messschwelle** (die Blöcke wechseln das Vorzeichen) |
| Mobiler Viewport 390×844 am Mac, CPU 6× gedrosselt (Proxy) | 1,16 ms gedrosselt | 33,2 vs. 31,1 ms — ~2 ms bzw. ~6 % |

Der Unterschied zwischen Hoch- und Querformat am Pixel 9 war der Befund, der zur
Detailstufe führte: im Querformat sind durch das breitere Blickfeld **mehr Pins gleichzeitig
sichtbar** (vier statt einem), und genau daran hängen die Kosten — die Layer-Zeit
verdoppelte sich, und die 7 % waren in jedem einzelnen Block reproduzierbar (jeder
„an"-Block lag über jedem „aus"-Block, also keine thermische Drift). Die CPU-Drosselung am
Mac hatte das gut vorhergesagt.

Mit Detailstufe halbiert sich die Layer-Zeit, und die Bildratendifferenz verschwindet im
Rauschen. Vorsicht beim Vergleich der Prozente ÜBER Läufe hinweg: die Grundlast schwankt
zwischen Sitzungen deutlich (21,5 ms gegen 31,0 ms Baseline, je nach Kachel-Cache und
Gerätetemperatur). Belastbar sind die direkt gemessene Layer-Zeit (1,50 → 0,80 ms) und die
absolute Differenz innerhalb eines Laufs (2,2 → 0,5 ms).

Messung am Gerät (Pixel 9, Android 17, Chrome 150, per USB):
`adb reverse tcp:8099 tcp:<devport>`, Chrome **explizit als Komponente** starten
(`am start -n com.android.chrome/…` — auf diesem Gerät ist Firefox Standardbrowser, ein
schlichter VIEW-Intent landet dort), dann `adb forward tcp:9333 localabstract:chrome_devtools_remote`
und über CDP messen. Fallen, die Zeit gekostet haben: Playwrights `_android`-API öffnet den Tab
im **Hintergrund** (Chrome rendert dort nicht → MapLibre wird nie fertig, das Skript hängt
minutenlang und auf dem Gerät ist „nichts zu sehen"), und ein zweiter Messlauf in derselben
Seite lässt **zwei rAF-Sammler** mitlaufen → Median 0,3 ms, „3333 fps". Die Display-Skalierung
des Geräts geht direkt in die Zeichenfläche ein (dpr 4,05 → Canvas 0,3 MP), also vor dem
Vergleich `wm density` festlegen und danach zurücksetzen.

Einordnung:

* Die Kosten sind **CPU-/Draw-Call-seitig**, nicht Füllrate: Kopf, Mast und Fußring sind
  winzige Quads. Der Terrain-Pass bleibt der Engpass (s. CLAUDE.md).
* Sie skalieren mit der Zahl **sichtbarer** Pins, nicht mit der Gesamtzahl — die
  Sichtbarkeitsprüfung im Clip-Raum drückte die Layer-Zeit auf ein Drittel (bei 12
  Stopps sind meist ein bis drei Pins im Bild). Three cullt hier nicht selbst, weil die
  Kamera nur eine Projektionsmatrix von MapLibre trägt.
* Bei einer aufgezeichneten Tour mit 60 Stopps sind deutlich mehr Pins gleichzeitig im
  Bild — dann gehört das in EIN Mesh mit Texturatlas statt drei Draws pro Pin.
* **Konsequenz aus den 7 % im Querformat:** der Hebel ist die Zahl gleichzeitig sichtbarer
  Pins, nicht „mobil abschalten". Eine Detailstufe (die nächsten zwei bis drei Stopps als
  voller Pin, alle weiteren als flacher Punkt) nimmt die Kosten dort weg, wo sie entstehen,
  und hält die Darstellung auf allen Geräten gleich — wichtig, weil die Android-App
  denselben Player in der WebView zeigt (`?app=1`).

## Detailstufe: nur die Stopps, um die es gerade geht

Voller Pin (Bodenpunkt · Mast · Kopf) bekommt nur ein **Fenster** um die aktuelle Position:
der nächste Stopp, der zuletzt besuchte und — am Desktop — der zweite kommende
(`FENSTER = { vor: 2 (Touch: 1), zurueck: 1 }`). Alle anderen bleiben ein flacher
Bodenpunkt, etwas größer als sonst, damit sie auf der Karte auffindbar bleiben.

Drei Entscheidungen, die dabei zählen:

* **Der Übergang wird geblendet** (`pin.stufe`, ~0,3 s). Ein harter Wechsel Pin↔Punkt fällt
  genau beim Vorbeifahren an — dort schaut man hin. Mast und Kopf wachsen aus dem
  Bodenpunkt heraus; weil die Masthöhe mit der Stufe schrumpft, wandert das **Klickziel**
  von selbst nach unten und der Stopp bleibt in jeder Stufe anfassbar (die flachen
  2D-Kreise waren es auch).
* **Die Blende läuft auch in der Pause aus.** Steht die Szene, liefert MapLibre keinen
  weiteren Frame — der Layer fordert ihn selbst nach (`blendet` → `triggerRepaint`), sonst
  friert die Blende auf halbem Weg ein.
* **Der Abstand des Bodenrings über Grund hängt an der VOLLEN Masthöhe**, nicht an der
  geblendeten. Sonst versinkt der reine Bodenpunkt (Stufe 0) wieder im Terrain — dieselbe
  Falle wie beim ersten Bau.

Nachjustierbar am laufenden Player: `__j.pins.setFenster({ vor: 3, zurueck: 1 })`,
Stufen ablesbar über `__j.pins._dbg().stufen`.

## Auf dem Handy

Geprüft in 390×844 (Hoch- und Querformat, `isMobile`/`hasTouch`, also mit dem
Pixelbudget `targetPixelRatio → 1,5` wie am Gerät):

* Querformat trägt die Pins am besten — sie stehen frei über dem Gelände und verdecken
  nichts von der Route.
* Im Hochformat waren die Desktop-Maße zu wuchtig: 34 px Kopf sind auf 390 px Breite
  fast 9 % des Bildes (am Desktop 2,4 %). Auf Touch deshalb **Kopf 14 px, Mast 62 px,
  Fußring 8 px** (Foto-Variante 22/74). Lesbar bleibt die Nummer in beiden Formaten.
* Der Kopf kommt im Hochformat dem „Nächster Halt"-Chip nahe. Solange die Pins ein
  Mockup sind, ist das hinnehmbar; für den Standard wäre eine Randzone sinnvoll, in der
  der Kopf nach unten ausweicht.

## Bedienung im laufenden Player

```
(ohne Flag)    3D-Pins mit Nummer im Kopf — Standard
?pins3d=foto   Foto im Kopf (größerer Kopf, längerer Mast)
?pins3d=0      zurück zu den flachen Kreisen (A/B, Rückfall)
```

```js
__j.pins.setMasse({ mast: 90, kopf: 20, fuss: 11, perspektive: 0.7 })
__j.pins.setFenster({ vor: 3, zurueck: 1 })  // Detailstufen-Fenster
__j.pins.setTiefentest(false)   // Verdeckung durch Gelände aus (A/B)
__j.pins.setVisible(false)      // Pins aus — der A/B-Schalter der Messung
__j.pins._dbg()                 // Höhen, Detailstufen, Bildschirmpositionen
```

## Offen, bevor daraus der Standard wird

1. **Kollision.** Bei dicht beieinander liegenden Stopps überlappen die Köpfe; die
   2D-Layer hatten dasselbe Problem, in 3D fällt es mehr auf. Die Detailstufe entschärft
   es (selten mehr als drei Masten gleichzeitig), löst es aber nicht — naheliegend wäre,
   die Köpfe zu staffeln (leicht unterschiedliche Masthöhen) statt sie zu verstecken.
2. **Viele Stopps.** Drei Draws pro sichtbarem Pin sind bei 12 Stopps unkritisch
   (s. Messung), bei einer aufgezeichneten Tour mit 60 Stopps nicht mehr — dann EIN Mesh
   mit Texturatlas. Und eine echte Messung am Pixel 9, nicht per CPU-Drosselung.
3. **Foto im Kopf.** Bei 27 px Radius ist ein Foto erkennbar, aber klein. Entweder
   deutlich größer (dann nur für den nächsten Stopp) oder beim Nähern aufblenden.
4. **Startpunkt.** Der Start-Dot ist weiterhin flach; ein eigener kleiner Pin wäre
   konsequent.

*(Der frühere Punkt „Zweit-Renderer" — Pins in die deck-/Google-Szene spiegeln —
ist mit dem Ausbau des Renderer-Labors am 2026-08-11 entfallen, s.
[Archiv](../archive/renderer-labor.md).)*
