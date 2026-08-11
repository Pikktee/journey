# Antialiasing im Player: Befund, Messplan, Schalter

**Ziel:** Entscheiden, ob der Player wieder MSAA anfordert — und ob daraus eine
Einstellung für Endnutzer wird oder eine feste Regel bleibt.

Stand: **2026-08-11**, nichts davon umgesetzt. Ausgelöst durch einen Fund beim
TypeScript-Umbau des Players
([konzept_player_typescript.md](konzept_player_typescript.md), Block A).

---

## 1. Der Befund

In [src/map.ts](../../src/map.ts) stand jahrelang:

```js
antialias: !COARSE,   // Touch: aus, Desktop: an
```

Seit dem Sprung auf **MapLibre GL JS 5** tut diese Zeile **nichts**. Die
WebGL-Kontext-Attribute sind dort nach `canvasContextAttributes` gewandert:

```ts
canvasContextAttributes?: WebGLContextAttributesWithType   // v5
```

Ein unbekanntes Feld auf oberster Ebene der `MapOptions` wird stumm ignoriert —
kein Fehler, keine Warnung, kein sichtbarer Unterschied im Log. Gefunden hat es
der Typecheck, als `map.js` zu `map.ts` wurde (`TS2353`).

**Was der Player heute zeigt, ist also der MapLibre-Default `antialias: false`
auf ALLEN Geräten** — auch auf dem Desktop, für den die Zeile gedacht war. Wie
lange schon, lässt sich aus der Git-Historie nicht ablesen: `package.json` trägt
`"maplibre-gl": "^5.6.0"` seit dem ersten Commit des Repos, der Sprung liegt vor
der öffentlichen Historie.

Die Zeile ist beim Umbau **ersatzlos entfernt** worden, nicht umgeschrieben.
Das war die einzige verhaltensneutrale Option: Sie an die richtige Stelle zu
setzen hätte im selben Commit die Optik und die Bildrate geändert, mitten in
einer Migration, deren Leitregel „Verhalten unverändert" lautet.

**Die stille Folge:** Wir haben nie gemessen, was MSAA in diesem Player kostet
oder bringt. Der `!COARSE`-Ausdruck war eine Annahme aus der Zeit vor der
Bildraten-Messreihe, und sie wurde nie geprüft, weil sie nie wirkte.

---

## 2. Was MSAA hier überhaupt glätten würde

Wichtig, bevor irgendwer misst: MSAA wirkt nur auf **Geometriekanten im
WebGL-Kontext der Karte**. Das ist in unserer Szene weniger, als man denkt.

| Element | Von MSAA betroffen? | Warum |
|---|---|---|
| Gelände-Silhouette gegen den Himmel | **ja** | die eine große, ständig bewegte Polygonkante im Bild |
| 3D-Foto-Pins ([photopins.js](../../src/photopins.js)) | **ja** | Three.js-Custom-Layer, echte Dreiecke: Mast, Ring, Kopfscheibe |
| Routen-Linien, Foto-Kreise | nein | MapLibre glättet Linien und Kreise analytisch im Fragment-Shader |
| Satellitenbild | nein | Raster, keine Kanten |
| Fahrer-Marker, UI, Steuerleiste | nein | DOM/CSS |
| Atmosphäre, Wetter | nein | eigene 2D-Canvases über der Karte, weiche Verläufe und Partikel |

Daraus folgt eine unangenehme Ehrlichkeit: Der sichtbare Gewinn beschränkt sich
auf **die Horizontkante und die Pins**. Ob das den Preis wert ist, ist genau die
offene Frage — und sie ist kleiner, als „Antialiasing an/aus" klingt.

**Ein Detail, das dabei auffällt:** [photopins.js](../../src/photopins.js) legt
seinen Three.js-Renderer so an:

```js
new THREE.WebGLRenderer({ canvas: m.getCanvas(), context: gl, antialias: true })
```

Das `antialias: true` dort ist **wirkungslos**, und zwar unabhängig vom
MapLibre-Fund: Three.js benutzt den übergebenen `context` unverändert, statt
einen eigenen anzulegen — die Attribute des Kontexts stehen längst fest. Die
Pins können also nur MSAA bekommen, wenn die KARTE es anfordert. Zwei
wirkungslose Flags an zwei Stellen, dieselbe Ursache. Der Ausdruck sollte
verschwinden oder einen Kommentar bekommen, sobald hier entschieden ist.

---

## 3. Warum ein Laufzeit-Schalter nicht billig ist

`antialias` ist ein **Attribut des WebGL-Kontexts**, kein Zustand der Karte. Der
Kontext entsteht einmal, beim Anlegen des `<canvas>`. MapLibre 5 bietet dafür
keinen Setter — nur die Konstruktor-Option und ein privates `_canvasContextAttributes`.

**Umschalten heißt also: die Karte neu bauen.** Und das ist im Player teurer als
anderswo, weil an `map` alles hängt: Terrain-Quelle und DEM-Cache, die
Routen-Layer, die Foto-Punkte samt Feature-State, der Fahrer-Marker, der
Three.js-Custom-Layer, die Tag/Nacht-Regie, die beiden Overlay-Canvases und die
FreeCamera-Engine mit ihrem Glättungszustand. Ein Neubau mitten in der Fahrt
wäre ein sichtbarer Aussetzer mit kaltem Kachel-Cache — und die Kamera stünde
danach mit frisch eingeschwungenen `Smooth`-Filtern da.

Damit gibt es genau zwei brauchbare Formen:

- **Beim nächsten Start wirksam.** Der Schalter schreibt nur den Merker; die
  laufende Fahrt bleibt unberührt. Das passt zur bestehenden Linie
  („Eine Tour beginnt am Anfang — immer", CLAUDE.md): Es gibt keinen
  Wiederaufnahme-Zustand, den ein Neubau zerstören könnte, wenn er zwischen zwei
  Touren liegt. Die Zeile im Dialog muss es sagen, sonst wirkt der Schalter kaputt.
- **Nur im Startscreen bedienbar.** Technisch dasselbe, nur strenger: Der
  Optionen-Dialog ist während der Fahrt erreichbar, der Eintrag wäre dort
  ausgegraut. Ehrlicher, aber eine Sonderregel mehr im Dialog.

Ein Neubau **während** der Fahrt ist kein Kandidat.

---

## 4. Drei Wege

### A — Fest an, wo es sich lohnt (kein Schalter)

Die alte Absicht wiederherstellen, aber mit einem ehrlicheren Kriterium als
`!COARSE`. Der Grund für „Touch aus" war nie das Eingabegerät, sondern die
**Pixeldichte**: Bei ≥2× Renderauflösung ist MSAA kaum zu unterscheiden, und
genau die liefern Telefone. Der Player kennt seine effektive Dichte längst —
`targetPixelRatio()` in [map.ts](../../src/map.ts) rechnet sie aus DPR, Fenster
und dem 5-MP-Budget aus.

```ts
canvasContextAttributes: { antialias: targetPixelRatio() < SCHWELLE }
```

Das trifft den Fall, der heute am meisten leidet: ein großes Fenster auf einem
1×-Monitor, wo das Pixelbudget ohnehin nicht greift und die Horizontkante hart
treppt. Und es lässt den Fall aus, wo MSAA nur kostet: hohe DPR.

**Vorteil:** kein Dialog, keine Persistenz, keine Neubau-Frage — die Entscheidung
fällt beim Anlegen der Karte, wo der Kontext ohnehin entsteht.
**Nachteil:** eine Konstante mehr, die jemand geraten hat, bis sie gemessen ist.

### B — Bildqualität als Endnutzer-Einstellung

Nicht „Antialiasing", sondern **ein** Regler, der beides fasst, was die
Bildqualität ausmacht: die Renderauflösung (`MAX_RENDER_MP`) und MSAA.

```
Bildqualität     ( Flüssig · Ausgewogen · Scharf )
                 Höhere Qualität kostet Bildrate. Wirkt ab der nächsten Tour.
```

Das ist die produktseitig richtige Form. Der Optionen-Dialog spricht heute
Klartext („Ton", „Musik", „Wetter-Effekte" — [erlebnis.html](../../erlebnis.html))
und trägt kein einziges Fachwort; „Antialiasing" bräche diese Sprache, und wer
das Wort kennt, versteht „Scharf" auch. Zugleich ist es die einzige Form, in der
ein Schalter überhaupt spürbar ist: MSAA allein bewegt auf der Horizontkante
wenig, das Pixelbudget bewegt das ganze Bild.

**Vorteil:** ein Griff für die eine Frage, die Nutzer wirklich haben („ruckelt
oder ist unscharf").
**Nachteil:** deutlich mehr als der Antialias-Fund — drei Stufen wollen definiert,
gemessen und benannt werden, und die Renderauflösung ist heute bewusst
automatisch (das Budget ist eine gemessene Klippe, keine Geschmacksfrage).
Ein Regler, der das übersteuert, kann den Player auf schwacher Hardware
schlechter machen, als er sein müsste.

### C — Vorerst nur dev

MSAA als Schalter unter `body.dev` (wie Wetter-Palette und Kameradistanz,
[src/main.js](../../src/main.js), Tippfolge „dev"). Kostet fast nichts, macht das
Messen bequem, verspricht Endnutzern nichts.

**Der empfohlene erste Schritt** — nicht als Endzustand, sondern als Messgerät:
Ohne Zahlen ist die Wahl zwischen A und B geraten. Ein dev-Schalter mit
Karten-Neubau ist dafür zulässig, weil der Aussetzer im Messbetrieb niemanden
stört.

---

## 5. Messplan

Die Methodik steht schon in [map.ts](../../src/map.ts) und gilt hier unverändert
— sie ist teuer erarbeitet, und wer sie abkürzt, misst Rauschen:

- **A/B/A/B-Wechsel**, je Zustand den ersten Lauf verwerfen (kalter Kachel-Cache).
- Zwischen **zwei Foto-Stopps** messen, nicht am ruhenden Orbit (der ist immer ~60 fps).
- Thermische Drosselung einrechnen: dieselbe Konfiguration lief über eine Messreihe
  von 26 auf 20 fps herunter.

Zu messen sind drei Geräteklassen, weil die Frage in jeder anders ausgeht:

| Aufbau | Erwartung |
|---|---|
| Pixel 9, Querformat, Koh Pha-ngan km 5–9 | MSAA sollte hier **nichts bringen und etwas kosten** — die Bildrate hängt am Terrain-Pass, die Dichte ist hoch |
| M4, 4K-Vollbild | das Pixelbudget greift bereits; MSAA obendrauf trifft dieselbe Füllraten-Klippe |
| M4, 1×-Monitor oder kleines Fenster | **der eigentliche Kandidat**: Budget greift nicht, DPR 1, harte Horizontkante |

Neben der Bildrate gehört ein **optischer** Beleg dazu, sonst diskutiert man über
Zahlen ohne Gegenstand: zwei Screenshots derselben Pose (Horizont im Bild, ein
Pin nah) je Zustand. Der Aufbau dafür steht in Abschnitt 5a des
[Player-TS-Konzepts](konzept_player_typescript.md) — Headless-Chromium gegen den
devhub-Dev-Server, `tour.resumeAt` für eine deterministische Pose.

**Abbruchkriterium:** Kostet MSAA auf dem 1×-Fall mehr als ~10 % Bildrate ohne
sichtbaren Gewinn im Screenshot-Vergleich, ist die ganze Frage erledigt — dann
bleibt es aus, der Fund wird zur Fußnote in map.ts, und `photopins.js` verliert
sein wirkungsloses `antialias: true`.

---

## 6. Wo ein Schalter hinginge

Falls B kommt, ist der Ort klar und schon gebaut:

- **DOM:** `.opt-row` im `#options-modal` von [erlebnis.html](../../erlebnis.html),
  neben Ton / Musik / Wetter-Effekte.
- **Verdrahtung:** [src/main.js](../../src/main.js) beim Block `MUSIC_KEY`/`AUDIO_KEY`.
- **Persistenz:** `localStorage` unter `maptale:…`, mit demselben `try`/`catch`
  wie die Nachbarn (Storage kann gesperrt sein) und einem Default, der wirkt,
  wenn nichts gespeichert ist.
- **Nicht** in die Kontoeinstellungen: Das ist eine Geräte-Eigenschaft, keine
  Eigenschaft der Person. Ein Konto, das auf dem Telefon dieselbe Qualitätsstufe
  erzwänge wie am 4K-Monitor, wäre die falsche Kopplung.

Der Schalter braucht eine **Zeile, die sagt, wann er wirkt** („Wirkt ab der
nächsten Tour"), sonst ist er aus Nutzersicht kaputt: Man legt ihn um und sieht
nichts.

---

## 7. Nicht-Ziele

- Den Renderer wechseln oder das Renderer-Labor wiederbeleben (ausgebaut am
  2026-08-11, s. [Archiv](../archive/renderer-labor.md)).
- `MAX_RENDER_MP` ohne Messung anfassen — die 5 MP sind eine gemessene Klippe,
  keine Geschmacksfrage.
- FXAA/SMAA als Post-Effekt im Overlay nachrüsten. Das glättet auch das
  Satellitenbild und die Schrift, kostet einen weiteren Vollbild-Pass und träfe
  genau die Füllrate, die ohnehin das Nadelöhr ist.
- Die Frage im TypeScript-Umbau miterledigen. Sie ist ein eigener Vorgang mit
  eigener Abnahme — das ist der Grund, warum es diese Datei gibt.

---

## 8. Nächster Schritt

1. Weg **C** bauen (dev-Schalter mit Karten-Neubau) — ein Nachmittag.
2. Nach Messplan messen, Zahlen und Screenshots **hier** eintragen.
3. Erst dann zwischen **A** (feste Regel an der Pixeldichte) und **B**
   (Bildqualität als Einstellung) entscheiden. Fällt die Messung flach aus:
   beides verwerfen, beide toten Flags entfernen, Datei nach `docs/archive/`.
