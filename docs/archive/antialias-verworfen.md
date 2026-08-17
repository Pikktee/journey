# Antialiasing im Player — gemessen und verworfen

Archiviert aus: architecture

**Ergebnis (2026-08-11): MSAA bringt in diesem Player nichts Sichtbares. Es
bleibt aus, beide toten Flags sind entfernt, es gibt keine Einstellung dafür.**

Diese Datei liegt im Archiv, weil die Frage entschieden ist. Sie steht hier
trotzdem vollständig, damit niemand denselben Weg noch einmal geht — der Befund
sieht beim Wiederentdecken nach einem Bug aus.

Ausgelöst durch einen Fund beim TypeScript-Umbau des Players
([konzept_player_typescript.md](konzept_player_typescript.md), Block A).

---

## 1. Der Fund

In `src/map.ts` stand jahrelang:

```js
antialias: !COARSE,   // Touch: aus, Desktop: an
```

Seit dem Sprung auf **MapLibre GL JS 5** tat diese Zeile **nichts**. Die
WebGL-Kontext-Attribute sind dort nach `canvasContextAttributes` gewandert:

```ts
canvasContextAttributes?: WebGLContextAttributesWithType   // v5
```

Ein unbekanntes Feld auf oberster Ebene der `MapOptions` wird stumm ignoriert —
kein Fehler, keine Warnung. Gefunden hat es der Typecheck, als `map.js` zu
`map.ts` wurde (`TS2353`). Wie lange der Zustand bestand, lässt sich nicht
datieren: `package.json` trägt `"maplibre-gl": "^5.6.0"` seit dem ersten Commit
des Repos.

Dasselbe Missverständnis steckte ein zweites Mal in `src/photopins.js`:

```js
new THREE.WebGLRenderer({ canvas: m.getCanvas(), context: gl, antialias: true })
```

Auch wirkungslos, aus einem anderen Grund — Three.js benutzt den übergebenen
`context` unverändert, statt einen eigenen anzulegen; dessen Attribute stehen
längst fest. Die Pins hätten MSAA nur über die KARTE bekommen können.

**Beide Ausdrücke sind entfernt.** Der Player rendert ohne MSAA, wie schon die
ganze Zeit — jetzt aber, weil es so gemeint ist.

---

## 2. Die Messung

Aufbau: Headless-Chromium (Playwright-Cache, ANGLE/Metal) gegen den
devhub-Dev-Server, 1600×900, `deviceScaleFactor: 1` (der Fall, in dem MSAA am
meisten bringen müsste — bei 2× supersamplen wir ohnehin). Je Zustand eine
Aufnahme derselben Pose, dann Pixelvergleich und Sichtprüfung an 4×-Ausschnitten.

**Zwei Kontrollen, ohne die die Messung wertlos gewesen wäre:**

- **Wirkt MSAA überhaupt?** Ohne Beleg misst man womöglich nur, dass der
  Headless-Treiber die Anforderung ignoriert. Geprüft im Seitenkontext:
  `gl.getContextAttributes().antialias` und `gl.getParameter(gl.SAMPLES)`.
  Ergebnis `true` / **`4`** — 4× MSAA war real aktiv.
- **Ist die Pose identisch?** Die ersten Versuche liefen über die Tour-Kamera
  (`resumeAt`) — die schwingt ein und ist zwischen zwei Läufen nie bitgleich.
  Der gemessene „Unterschied" war prompt ein Sub-Pixel-Versatz des
  **DOM-Fahrer-Markers**, den MSAA gar nicht berühren kann. Erst
  Tour starten → `setPlaying(false)` → `map.jumpTo(feste Pose)` ergab
  reproduzierbare Bilder (in der Pause der Fahrphase fasst die Engine die Kamera
  nicht mehr an).

### Ergebnis

| Vergleich | max. Abweichung (0–255) | Pixel > 16 |
|---|---:|---:|
| Identische Pose, Karte gedimmt unter dem Startscreen | **3** | 0 von 1,44 Mio |
| Koh Pha-ngan, Bergkamm, Dämmerung, Pins im Bild | 81 | 704 |
| Oberland, Tageslicht, ohne DOM-Marker, `?pins3d=0` | 62 | 326 (0,02 %) |

Die Zahlen der beiden unteren Zeilen sehen nach „etwas" aus und sind es nicht:
Bei der Sichtprüfung ließ sich **keine einzige** dieser Abweichungen einer
Geometriekante zuordnen. Es waren jedes Mal nicht-deterministische Elemente —
der Pin-Fußring, der zwischen den Läufen unterschiedlich weit eingeblendet war,
und die UI. Pin-Mast, Kopfscheibe, Routenlinie und Gelände sahen in beiden
Zuständen gleich aus.

### Warum das so ist

Das Bild des Players ist fast vollständig **Raster**: Satellitenkachel auf
Terrain-Mesh, darüber die 2D-Overlays für Atmosphäre und Wetter, darüber
DOM-UI. Was MSAA glätten könnte, ist eine kurze Liste:

| Element | Von MSAA betroffen? | Warum |
|---|---|---|
| Gelände-Silhouette gegen den Himmel | ja — theoretisch | die einzige große Geometriekante |
| 3D-Foto-Pins (`photopins.js`) | ja — theoretisch | Three.js-Custom-Layer, echte Dreiecke |
| Routen-Linien, Foto-Kreise | nein | MapLibre glättet Linien und Kreise analytisch im Shader |
| Satellitenbild | nein | Raster |
| Fahrer-Marker, UI, Steuerleiste | nein | DOM/CSS |
| Atmosphäre, Wetter | nein | eigene 2D-Canvases über der Karte |

Und die eine Kante, die zählen würde, weicht der Player **selbst** auf: Der
Horizont-Dunst (`drawHaze` in `atmosphere.js`) liegt genau dort, wo die
Silhouette am härtesten wäre. Dazu kommt die Kameraführung — bei Pitch bis 86°
in der Verfolgung schaut man meist ins Gelände, der Himmel ist oft gar nicht im
Bild.

### Was die Messung NICHT zeigt

Ehrlichkeitshalber, falls jemand die Frage doch wieder aufmacht:

- **Standbilder.** Kantenflimmern in Bewegung („crawling") ist der klassische
  MSAA-Fall und lässt sich so nicht messen. Dagegen steht: Wo im Standbild kein
  Unterschied messbar ist, kann in Bewegung wenig flimmern.
- **Keine knackige Tag-Silhouette.** Die Oberland-Pose war verhangen, die
  Koh-Pha-ngan-Pose dämmrig. Ein wolkenloser Grat gegen blauen Himmel wurde
  nicht getestet — aber genau dort greift der Dunst-Einwand.
- **Keine Bildraten-Messung.** Sie wurde überflüssig, als der optische Gewinn
  ausblieb: Man misst keinen Preis für etwas, das man nicht kauft.

---

## 3. Die verworfene Einstellungs-Idee

Im Raum stand, Antialiasing zu einer Endnutzer-Einstellung zu machen. Auch das
ist erledigt, und zwar aus drei Gründen, die unabhängig vom Messergebnis gelten:

- **Ein Schalter kostet einen Karten-Neubau.** `antialias` gehört zum
  WebGL-Kontext, nicht zum Kartenzustand; MapLibre 5 hat dafür keinen Setter,
  nur die Konstruktor-Option und ein privates `_canvasContextAttributes`. An
  `map` hängen Terrain, Layer, Feature-States, der Three.js-Custom-Layer, die
  Tag/Nacht-Regie und die FreeCamera samt Glättungszustand. Mitten in der Fahrt
  ist das kein Kandidat; es ginge nur „ab der nächsten Tour".
- **„Antialiasing" wäre das einzige Fachwort im Dialog.** Der Optionen-Dialog
  sagt „Ton", „Musik", „Wetter-Effekte" — und wer den Begriff kennt, versteht
  „Scharf" auch.
- **Die tragfähige Form wäre ein anderer Schalter.** Nicht MSAA, sondern
  „Bildqualität" über die Renderauflösung (`MAX_RENDER_MP`). Das bewegt das
  ganze Bild statt einer Kante. **Falls das je gebaut wird, ist es ein eigener
  Vorgang** — und der muss damit umgehen, dass die 5 MP eine gemessene
  Füllraten-Klippe sind und kein Geschmack: Ein Regler darüber kann den Player
  auf schwacher Hardware schlechter machen, als er sein müsste.

---

## 4. Was bleibt

- `src/map.ts` fordert kein MSAA an, mit Kommentar und Verweis hierher.
- `src/photopins.js` fordert kein MSAA an, mit Kommentar.
- Kein Schalter, keine Einstellung, kein `MAX_RENDER_MP`-Regler.
- **Die Methodik ist wiederverwendbar** und war der eigentliche Ertrag: feste
  Pose über `setPlaying(false)` + `jumpTo`, DOM-Marker per CSS ausblenden,
  `?pins3d=0` gegen die Blenden-Nichtdeterminismen — und immer erst belegen,
  dass der zu messende Effekt überhaupt aktiv ist (`gl.getParameter(gl.SAMPLES)`),
  bevor man eine Null-Differenz als Antwort nimmt.
