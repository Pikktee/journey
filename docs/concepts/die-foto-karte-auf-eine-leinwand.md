---
stand: 2026-08-17
status: abgearbeitet: Karte auf der Leinwand, Tafeln herausgelöst
betrifft:
  - Player (src/kartenmaler.ts, src/kartenschicht.ts, src/ui.ts, erlebnis.html)
  - Studio-Editor (src/studio/abspielen.ts, studio.html)
  - Video-Export (src/exportfilm.ts)
  - geteilte Zahlen (src/einblendung.ts)
---

# Die Foto-Karte auf eine Leinwand

**Ziel:** Die letzte Stelle schließen, an der die Bühnen auseinanderlaufen
können — die Foto-Karte. Alles andere im Film ist seit dem Takt-Umbau geteilter
Code, sie war es nicht.

**Erledigt am 2026-08-17.** Die Karte liegt auf einer Leinwand, der Export holt
sie mit einem `drawImage`, und die Zahlen beider Bühnen stehen in einer Tabelle
mit einem Wächter darauf. Was hier steht, ist deshalb keine Absicht mehr, sondern
die Begründung des Ist-Stands: Wer eine dieser Zahlen anfasst, findet hier,
warum sie so ist.

Die TAFELN — Startscreen und „Ziel erreicht" — standen bis zuletzt als Etappe 3
in diesem Dokument und sind herausgelöst nach
[Die Tafeln auf die Leinwand](die-tafeln-auf-die-leinwand.md). Nicht nur wegen
des Termins: Bei der Karte hieß das Ziel „deckungsgleich", bei den Tafeln heißt
es das ausdrücklich nicht (die Titeltafel des Films ist bewusst keine
abfotografierte Oberfläche). Zwei Ziele in einem Dokument hätten sich
gegenseitig missverstanden.

**Es waren DREI Fassungen, nicht zwei.** Player (DOM + CSS), Studio-Editor
(eigenes DOM + eigenes CSS) und Video-Export (Canvas). Das war der erste
Entwurf dieses Konzepts zu eng gefasst: Er nannte nur Player↔Export, weil dort
die Abweichungen grob sind. Nachgemessen weichen aber auch Player und Editor
voneinander ab, feiner und deshalb schlimmer, weil man sie für gewollt halten
könnte (§2). Beim zweiten Nachzählen sind es nicht vier Stellen, sondern acht.

**Seit Etappe 2 (2026-08-17) sind es ZWEI**, und das ist der ganze Umbau: Der
Player malt die Karte auf eine Leinwand, der Export holt sie von dort mit einem
`drawImage`. Die zweite Fassung ist der Editor, und die bleibt (§3.6).

Verwandt, aber anders:
- [konzept_video_export.md](konzept_video_export.md). Dort steht, warum der
  Export ein Taktgeber ist und was er heute nachbaut. Dieses Konzept löst genau
  den Rest, den §6 dort als „die einzige Stelle" benennt.
- [konzept_gleichlauf_player_editor.md](konzept_gleichlauf_player_editor.md) §6A.
  Dort ist ein GETEILTES DOM-Bauteil zwischen Player und Editor ausdrücklich
  verworfen — und das bleibt so. Aber „andere Mechanik" heißt nicht „andere
  Zahlen": Was gleich aussehen soll, muss gleich SEIN, und was verschieden sein
  darf, muss als verschieden dastehen (§3.7).

---

## 1. Das Problem in einem Satz

> Dieselbe Foto-Karte ist an drei Stellen ein anderes Programm: beim Zuschauen,
> beim Schneiden und in der Datei.

Der Player baut sie aus DOM und CSS. Der Editor baut sie ein zweites Mal, mit
eigenem DOM und eigenem CSS — bewusst, weil er in einer Datei umherspringt,
während der Player einen Film voraus streamt (§6A des Gleichlauf-Konzepts). Und
der Export konnte DOM überhaupt nicht greifen — ein `drawImage` nimmt nur
Leinwände —, also zeichnete er sie ein drittes Mal auf seine Komposition
(`zeichneFotoKarte`, ~70 Zeilen; die Tafeln daneben haben ihren Nachbau noch,
s. das Tafel-Konzept).

Das ist dieselbe Sorte Fehler, die der Takt-Umbau bei der Kamera behoben hat,
nur eine Ebene höher: nicht zwei Uhren, sondern drei Zeichner. Und wie dort
liegt die Lösung nicht darin, alle drei gleichzuschalten, sondern darin, die
gemeinsame Substanz an einen Ort zu ziehen und den Rest als Absicht zu
benennen.

---

## 2. Es ist nicht theoretisch — es ist schon falsch

Kein einziger Punkt hier ist eine Befürchtung. Alle stehen heute so im Code.

Die beiden Tabellen darunter beschreiben den Stand VOR dem Umbau. Sie bleiben
stehen, weil sie der Beleg dafür sind, dass keine dieser Zahlen eine Entscheidung
war — und weil man ohne sie nicht sieht, warum es die Tabelle in
`einblendung.ts` gibt. §2.1 ist mit Etappe 2 vollständig erledigt, §2.2 mit
Etappe 1.

### 2.1 Player gegen Export — grob (behoben in Etappe 2)

| Was | Player | Export |
|---|---|---|
| **Ken Burns** | `scale(1.12)` → `scale(1.01)`, ease-out über die Klip-Länge — das Bild zoomt **heraus** | `1 + 0.06 · min(1, imS/6)`, linear über 6 s — das Bild zoomt **hinein** |
| **„Entwickeln"** | `brightness 1.45→1`, `contrast 0.82→1.02`, `saturate 0.55→1.05` über 1,6 s | fehlt |
| **Auftritt** | `karteFlug`: `translateY(70px) scale(0.9) rotate(1.4deg) rotateX(10deg)`, eigene Kurve über 0,95 s | lineare Deckkraft über 0,5 s |
| **Kamerablitz** | Radialer Blitz, 0,75 s, an der Filmzeit | fehlt |
| **Standzeit-Balken** | `photo-hold-fill`, aus `balkenAnteil` | fehlt |
| **Kennzahlen** | Pillen „Foto 1/2" und „KM 12.3" | fehlen |
| **Schleier** | `rgba(6,10,16,0.3)` **plus** `blur(14px) saturate(0.85) brightness(0.96)` | flache Füllung `rgba(6,10,16,0.28)` |
| **Seitenverhältnis** | geklemmt (`klemmeSeitenverhaeltnis`, AR 0,62–1,85) | rohes `naturalWidth/naturalHeight` |

Die erste Zeile ist die teuerste: **Der Ken Burns läuft im Export in die
Gegenrichtung.** Das ist keine Nuance, das ist die Bildsprache der Foto-Stopps —
und niemandem ist es aufgefallen, weil man dafür Player und Datei
nebeneinander an derselben Filmsekunde anhalten muss.

### 2.2 Player gegen Editor — fein, und deshalb heimtückisch

Hier ist die Mechanik ausdrücklich getrennt (§6A) und die ZEITEN sind sauber
geteilt: Auftritt 500 ms Blende plus 950 ms Flug, dieselbe
`cubic-bezier(0.19, 1.16, 0.32, 1)`, Entwickeln 1,6 s ease-out, Ken-Burns-Dauer
die Klip-Länge. Das ist E15/Paket D, und es hält.

Die WERTE halten nicht:

| Was | Player | Editor |
|---|---|---|
| Ken-Burns-Ende | `scale(1.01)` | `scale(1.02)` |
| Entwickeln-Ende | `brightness(1) contrast(1.02) saturate(1.05)` | `filter: none` |
| Flug-Beginn | `translateY(70px) rotate(1.4deg) rotateX(10deg)` | `translateY(48px) rotate(1.6deg) rotateX(9deg)` |
| Ruhelage der Karte | `rotate(-0.4deg)` | `rotate(-0.5deg)` |
| Ken-Burns-Rückfalldauer | `--kb-dauer, 7s` | `--fe-kb-dauer, 6s` |
| Ken Burns abgeschaltet | `transform: none` (also 1.0) | `scale(1.04)` |
| Kamerablitz | `flash 0.75s ease-out`, Kurve über `radial-gradient(… 0.95 / 0.55)` | `fotoBlitz 700ms`, Spitze bei 12 %, Gradient `0.9 / 0.5` |
| Schleier | `rgba(6,10,16,0.3)` + `blur(14px) saturate(0.85) brightness(0.96)` | `rgba(6,10,16,0.34)` + `blur(10px) brightness(0.92)` |

**Und jetzt der Punkt, auf den es ankommt: Man kann nicht sagen, welche dieser
acht Zeilen gewollt ist.** Die 48 px Flugweite gegen 70 px sind es
offensichtlich — die Editor-Karte ist kleiner, sie liegt auf einem Leuchttisch
und nicht bildschirmfüllend. Aber `1.01` gegen `1.02`? `-0.4°` gegen `-0.5°`?
Ein Entwickeln, das im Player bei `contrast 1.02 / saturate 1.05` endet und im
Editor bei `none`? Das sieht nach abgeschriebenen Zahlen aus, nicht nach einer
Entscheidung. Nachweisen lässt es sich heute nicht, weil nirgends steht, was
gleich sein SOLL.

Die vier unteren Zeilen kamen erst bei der Gegenprobe dazu, und sie sind
lehrreich, weil sie zeigen, wie die Krankheit fortschreitet: Zwei davon sind
RÜCKFALLWERTE (`7s` gegen `6s`), stehen also nur da, wenn die Custom Property
fehlt. Genau dann sieht man den Unterschied nicht als Bruch, sondern als leicht
anderen Film.

**Eine der vier ursprünglichen Fragen ist damit beantwortet.** Im
Reduced-Motion-Block des Players steht die Karte auf `scale(1.02)`
([style.css:1742](../../src/style.css)), also auf dem Editor-Wert. Die
gemeinte Ruhegröße ist `1.02`; das `1.01` im Keyframe ist der Ausreißer. Wer
beim Vereinheitlichen den Player als Vorbild nimmt, zementiert die falsche
Zahl an drei Stellen.

Das ist die eigentliche Krankheit, und sie ist schlimmer als die groben
Abweichungen aus §2.1: Ein Fehler, den man sieht, wird behoben. Einer, den man
für Absicht halten kann, bleibt.

### 2.3 Gegenprobe am Tag des Umbaus (2026-08-17)

Beide Tabellen stimmten Zeile für Zeile. Drei Nachträge, die dabei anfielen:

- **§4 nennt die falsche Titelgröße.** `clamp(18px, 2.2vw, 28px)` ist der Wert
  des EDITORS (`.fe-titel`); der Player läuft auf
  `clamp(22px, 2.3vw, 32px)`. Für das Skalierungsmodell in §5 ist das die
  Bezugsgröße, also die teurere Verwechslung von beiden.
- **Eine neunte Abweichung, aber keine Zahl:** Der Player lässt Titel,
  Unterschrift und Pille zeitversetzt einlaufen (`bildunterschrift`, 0,6 s, bei
  +0,35 / +0,45 / +0,55 s). Der Editor hat dafür gar keine Animation. Das ist
  kein auseinandergelaufener Wert, sondern ein fehlendes Bauteil, und es gehört
  deshalb nicht in die Tabelle, sondern in Etappe 2.
- Die Rückfalldauer des Ken-Burns-Zugs war ableitbar und musste nicht gewählt
  werden: `klipDauerS(HOLD_HIDE)` = 6 s, also der Wert des Editors.

**Entschieden wurde (Etappe 1):** Ken-Burns-Ende, Ruhewert bei abgeschaltetem
Ken Burns, Entwickeln-Ende, Auftritts- und Ruhewinkel, Blitz und Schleier sind
geteilt und stehen auf den Player-Werten, mit zwei Ausnahmen: Das Ken-Burns-Ende
ist 1.02 (der Editor-Wert, s. o.), und die stehende Karte liegt auf genau diesem
Ende statt auf `none` oder 1.04. Benannte Bühnen-Variante ist einzig die
Flugweite.

**Der Schleier wurde nachträglich am Bildschirm überprüft — und die Zweifel
haben nicht gehalten.** Er war der eine geteilte Wert, bei dem eine benannte
Variante denkbar schien: Auf der Bühne deckt die Karte gemessen rund vier
Fünftel des Bildes ab (der Schleier ist dort ein schmaler Rand), im Editor
liegt sie klein auf einer Karten-Bühne, die man zum Beurteilen der Platzierung
mitliest. Die Gegenprobe im laufenden Editor, gleiche Tour und gleiche
Filmsekunde, nur die vier Werte getauscht: Der Unterschied ist da, aber klein,
und keine der beiden Fassungen macht die Karte darunter unbrauchbar. Am
deutlichsten ist er bei heller Szenerie (Berner Oberland), wo der frühere
Editor-Wert etwas mehr Geländestruktur stehen lässt; bei dunkler Szenerie ist
er kaum auszumachen. **Der Wert bleibt geteilt.** Eine Variante braucht einen
Grund, und „ein bisschen mehr Struktur" ist keiner.

---

## 3. Leitentscheidungen

1. **Die Karte wird im PLAYER auf eine Leinwand gezeichnet.** Nicht der Export
   holt sich das DOM, sondern der Player hört auf, DOM dafür zu benutzen. Dann
   greift der Export sie so, wie er heute Atmosphäre und Wetter greift — mit
   einem `drawImage`, ohne eine Zeile über Ken Burns zu wissen.
2. **Ein Maler, zwei Aufrufer.** `src/kartenmaler.ts` zeichnet die Karte auf
   einen beliebigen 2D-Kontext, aus Filmsekunde und Halt. Der Player ruft ihn
   pro Frame auf seine Schicht; der Export braucht ihn gar nicht — er nimmt das
   Ergebnis. Ein Aufrufer wäre schöner, zwei sind ehrlich: die Export-Seite
   kann die Schicht auch direkt in ihrer Auflösung malen, wenn die
   Bildschirm-Schicht je vom Film abweicht.
3. **Bedienung bleibt DOM.** „Weiter ▸", der Ton-Knopf des Videos, das
   „Angehalten"-Abzeichen: Das sind Knöpfe, keine Bildinhalte. Sie liegen
   weiter im DOM über der Leinwand — und sie sind ohnehin die Teile, die im
   Film nichts zu suchen haben.
4. **Der Text bleibt lesbar.** Titel und Unterschrift wandern auf die Leinwand,
   aber nicht aus dem Dokument: Eine visuell versteckte Kopie
   (`figcaption.sr-only`) trägt sie weiter für Screenreader. Ohne das wäre der
   Umbau eine Zugänglichkeits-Regression, und die wäre den Gewinn nicht wert.
5. **Die geteilten ZAHLEN bleiben, wo sie sind.** `kartenZeiten`,
   `balkenAnteil`, `klipDauerS`, `videoStandS`, `klemmeSeitenverhaeltnis` in
   [einblendung.ts](../../src/einblendung.ts) sind schon geteilt und bleiben die
   Quelle. Der Maler benutzt sie, er ersetzt sie nicht.
6. **Der Editor behält seine Mechanik.** Er bleibt DOM. Das ist kein Versehen,
   sondern §6A des Gleichlauf-Konzepts: Der Player streamt einen Film voraus,
   der Editor springt in einer Datei umher. Ob er später denselben Maler
   benutzt, ist eine eigene Frage — und eine leichtere, sobald es einen Maler
   gibt.
7. **Aber jede Abweichung wird ERKLÄRT.** Aus §2.2 folgt die Regel, die dieses
   Konzept über den Export hinaus trägt: Was auf zwei Bühnen gleich aussehen
   soll, kommt aus einer Zahl in
   [einblendung.ts](../../src/einblendung.ts); was verschieden sein DARF, steht
   dort als benannte Bühnen-Variante mit ihrem Grund. Ein Wert, der auf zwei
   Bühnen zufällig anders ist, gilt danach als Fehler und nicht als Geschmack.
   Kandidaten für benannte Varianten: die Flugweite (bildschirmfüllend gegen
   Leuchttisch), der Schleier im Film (flache Füllung statt Blur, §4) und die
   Kartengröße bei stehender Bedienung (die es im Film nicht gibt, §5).
   Kandidaten für „war nie gemeint": Ken-Burns-Ende, Entwickeln-Ende,
   Ruhewinkel, die beiden Rückfalldauern, der Ruhewert bei abgeschaltetem Ken
   Burns, die Blitz-Dauer.

---

## 4. Was das kostet, und was es einspart

**Es wird nicht weniger Code, es wird EINMAL Code.** Der Maler ist ungefähr so
lang wie der heutige Export-Nachbau; dafür fallen dort ~200 Zeilen weg und im
Player die CSS-Animationen der Karte. Der Gewinn liegt nicht in Zeilen, sondern
darin, dass es die Zeilen nur einmal gibt.

Was schwieriger wird als in CSS:

- **Textumbruch, Kürzen und `clamp()`.** Canvas kann kein
  `text-overflow: ellipsis`. Der Umbruch steht mit `brichAttribution` in
  [exportfilm.ts](../../src/exportfilm.ts) schon da und gehört mit in den Maler;
  das KÜRZEN steht dort noch nicht, das ist neu. Dazu kommt, was heute
  unsichtbar in CSS steckt: Der Titel läuft auf der Bühne auf
  `clamp(22px, 2.3vw, 32px)` (im Editor auf `clamp(18px, 2.2vw, 28px)`, s.
  §2.3), die Karte auf `min(1500px, 92vw)` mit einer
  Höhenrechnung aus `--photo-chrome` und `--vh-app`. Alles davon ist
  Layout-Logik, die der Maler ausdrücklich nachbauen muss (s. §5,
  „Skalierungsmodell").
- **Schriften.** `ctx.font` zeichnet stumm mit der Ersatzschrift, wenn Outfit
  noch lädt. `document.fonts.ready` abwarten, bevor das erste Bild fällt — im
  Export ohnehin Pflicht, am Bildschirm ein Blitzen.
- **Weichzeichnen hinter der Karte, und das ist die härteste Nuss.**
  `backdrop-filter: blur(14px)` hat auf einer Leinwand kein Gegenstück, und der
  naheliegende Ausweg trägt NICHT: Um den Hintergrund überhaupt in einen Puffer
  zu bekommen, muss der Maler die MapLibre-Leinwand mit `drawImage` lesen, und
  das geht nur mit `preserveDrawingBuffer`. Das steht heute allein im
  Export-Zweig ([main.ts:541](../../src/main.ts)); dauerhaft eingeschaltet
  kostet es Leistung an genau der Stelle, die ohnehin der Engpass ist
  (gemessen: MapLibre 72–90 % der Frame-Zeit, s.
  [scripts/messungen/README.md](../../scripts/messungen/README.md)). Und der
  Puffer wäre auch inhaltlich falsch: Die Kamera steht im Halt zwar wirklich
  still ([tour.ts:1094](../../src/tour.ts)), das WETTER aber nicht. Regen und
  Schnee laufen an der Filmuhr weiter; ein eingefrorener Ausschnitt zeigt fünf
  Sekunden lang stehenden Regen hinter der Karte.
  **Entscheidung: Der Schleier bleibt eine DOM-Schicht mit `backdrop-filter`
  UNTER der Leinwand**, und die flache Füllung im Film ist eine benannte
  Bühnen-Variante nach §3.7 (Grund: Der Export komponiert selbst und hat den
  Hintergrund ohnehin im Griff; ein exaktes Blur wäre dort ein eigener,
  teurer Nachbau ohne Gewinn). Das ist keine Ausnahme von §3.1, sondern
  dieselbe Linie wie §3.3: Was Bildinhalt ist, geht auf die Leinwand; was
  Umgebung ist, darf DOM bleiben.
- **Rundungen und Schatten** sind `roundRect` und `shadowBlur`, also kein Thema.

Was leichter wird:

- **Rückwärts und Einzelbild fallen an.** Der Maler bekommt eine Filmsekunde
  und zeichnet den Stand dazu. Das ist genau das Modell, das die CSS-Fassung
  über `--karte-zeit` und pausierte Animationen mühsam nachstellt.
- **Der Halt ist der ruhige Fall, aber nicht der Ruhefall.** Die Kamera steht,
  MapLibre hat nichts zu tun. Der Maler aber schon: Ken Burns driftet über die
  GANZE Klip-Länge, es wird also pro Frame neu gezeichnet. Der Gewinn ist ein
  anderer und ein größerer, s. §5A: Der Maler arbeitet genau in der Phase, in
  der das Frame-Budget frei ist.

---

## 5. Technik

### Die Schicht

Eine Leinwand `#karte` zwischen Wetter und Bedienung — in der Schichtung von
E17 also über `.photo-layer`s heutigem Platz (12) und unter `.dock` (20). Der
Export komponiert sie an derselben Stelle, an der er heute die Foto-Karte malt:
nach Wetter und Reiter, vor der Attribution.

### Der Maler

```
maleKarte(ctx, breite, hoehe, stand)
  stand = { filmS, halt, aufnahme, bild, videoFrame, kmText, zaehlerText, … }
```

DOM-frei und getestet, wie `einblendung.ts`. Er kennt keine Elemente, nur
Werte — was er zeichnet, kommt aus dem Tour-JSON und der Filmsekunde, nicht aus
`textContent`. Das ist der zweite Gewinn: Heute liest der Export Texte aus dem
DOM zurück, das der Player gerade gefüllt hat. Danach lesen beide dieselben
Daten.

### Bild und Video

Das Foto ist ein `HTMLImageElement`, das Video ein `HTMLVideoElement` — beide
zeichnet `drawImage` direkt. Für das Video bleibt es bei `videoStandS`: Der
Maler malt den Frame, der zu dieser Filmsekunde gehört, das Seeken bleibt beim
Aufrufer (er weiß, ob er streamt oder springt).

**Dazu gehört eine Zusicherung, die es heute nicht braucht.** `drawImage` auf
einem noch suchenden `<video>` zeichnet ohne Fehler das ALTE Bild. Am
Bildschirm fällt das nicht auf, im Film ist es ein falsches Einzelbild in der
Datei. Der Maler braucht deshalb entweder die Zusage des Aufrufers „der Frame
steht" (im Export: `seeked` abgewartet) oder ein Rückgabesignal „noch nicht
bereit", auf das der Export wartet, statt zu encodieren.

### Skalierungsmodell

**Das ist die Vorbedingung dafür, dass „deckungsgleich" überhaupt eine
prüfbare Aussage ist.** Die Kartengeometrie hängt heute an festen Pixelwerten
und Viewport-Einheiten: `min(1500px, 92vw)`, `--photo-chrome` 235 px, das auf
335 px springt, sobald die Bedienung steht, dazu `--vh-app` und
`clamp(22px, 2.3vw, 32px)` für den Titel der Bühne. Ein 1920×1080-Film und ein
1280×800-Bildschirm ergeben damit verschieden große Karten und verschieden
große Schrift, und zwar AUCH mit einem einzigen Maler. Ein gemeinsamer Zeichner
allein macht zwei Bühnen nicht deckungsgleich.

Der Maler rechnet deshalb aus einer **Bezugshöhe**. Festgelegt (Etappe 2):

**`BEZUGSHOEHE` = 900 CSS-Pixel, `mass = klemme(hoehe / 900, 0.7, 2.6)`.** Jede
feste Länge im Maler ist ein Wert BEI Bezugshöhe, multipliziert mit `mass`
([kartenmaler.ts](../../src/kartenmaler.ts), `KARTEN_MASSE`).

**Warum 900 und nicht 1080.** Die Zahl ist nicht frei: Sie ist die Höhe, bei der
der Maler genau das ergibt, was heute im Browser steht. Die CSS-Fassung mischt
feste Pixel (Chrome 235, Kartenrand-Obergrenze 16, Balken 4) mit
Viewport-Einheiten (`clamp(22px, 2.3vw, 32px)`, `92vw`), und die beiden wachsen
verschieden. Bei 1600 × 900 liegen ALLE `clamp()` auf ihrer Obergrenze — dort
sind die festen Pixel und die vw-Anteile deckungsgleich, und nur dort lässt sich
ein einziger Faktor an die bestehende Optik anschließen. Mit 1080 als Bezug
wäre der Bildschirm bei 800 px Höhe sichtbar anders geworden als am Tag davor.

**Was mitskaliert:** alle Längen — Kartenrand, Chrome-Reserve, Bildradius,
Kartenradius, Balkenhöhe, Schatten, Pillen- und Knopfpolster, Zeilenhöhen UND
alle Schriftgrößen. Der Maler kennt keine feste Pixelgröße, die nicht durch
`mass` läuft.

**Was NICHT mitskaliert, und warum:**

- **Die vw-Anteile der heutigen `clamp()` entfallen ersatzlos.** Die Schrift hängt
  ab jetzt an der HÖHE, nicht an der Breite. Ein 21:9-Fenster machte den Titel
  sonst größer, ohne dass die Karte mehr Platz hätte — die Kartenhöhe kommt aus
  der Höhe. Die Breite steuert weiterhin genau eine Größe: die maximale
  Kartenbreite (92 % der Bühne, 89 % schmal, 62 % quer).
- **Drei Mindest-Schriftgrößen** (`KARTEN_MASSE.*.mindest`): Titel 19 px,
  Bildunterschrift 11,5 px, Pille 8,5 px. Unter 0,8 Bezugshöhe — also auf dem
  Telefon — greifen sie und halten die Zeile lesbar. Im Film greifen sie nie
  (`mass ≥ 1` bei jedem Ausgabeformat), sie sind also ausdrücklich eine
  Bildschirm-Regel und keine Kartengeometrie.
- **Der Rahmenradius hat einen Boden von 3 px.** Ein Radius unter 3 px ist auf
  einem 1× -Bildschirm kein Radius mehr, sondern ein unruhiger Pixelrand.
- **Alles Dimensionslose** — Ken-Burns-Skalen, Winkel, Deckkräfte, Kurven — ist
  ohnehin kein Maß und läuft nicht durch `mass`.

**Und zwei Dinge fallen ausdrücklich weg:** `--photo-chrome` gilt nur am
Bildschirm. Dass die Karte kleiner wird und hochrückt, sobald die Steuerleiste
steht, ist eine Antwort auf eine Leiste, die es im Film nicht gibt; der Maler
bekommt das als Schalter `bedienungSteht`, und der Export setzt ihn NIE. Und das
**Seitenverhältnis** ist auf beiden Bühnen das geklemmte aus
`klemmeSeitenverhaeltnis` (§2.1, letzte Zeile) — das rohe im Export war nie
gemeint.

**Die Lage leitet der Maler selbst ab**, aus Breite und Höhe und aus nichts
sonst: `quer` (Bild links, Text rechts) bei `breite > hoehe && hoehe ≤ 560`,
`schmal` (Titel auf eigener Zeile) bei `breite ≤ 700`, sonst `breit`. Das sind
dieselben Schwellen, an denen heute `body.kompakt-quer` (main.ts) und
`@media (max-width: 700px)` hängen. Ein vierter Aufruf-Schalter dafür wäre eine
zweite Wahrheit über dieselbe Geometrie.

**Der Preis, und er ist gewollt:** Unter 900 px Höhe ist die Karte ein paar
Prozent kleiner als am Tag davor, darüber ein paar Prozent größer. Vorher war
sie auf einem 4K-Film ein Briefmarkenrahmen mit Fußnotenschrift — genau der
Fehler, den ein Maler ohne Bezugshöhe NICHT behebt (Falle 6).

### Auflösung

Am Bildschirm zeichnet die Schicht mit `overlayPixelRatio()` wie Atmosphäre und
Wetter (gemeinsames Pixelbudget, s. `map.ts`). Im Export mit dem Export-Ratio.
Der Maler bekommt Breite und Höhe in CSS-Pixeln und eine Transform-Matrix — er
rechnet nie in Gerätepixeln.

**Ein Vorbehalt gegen die Analogie zu Wetter und Atmosphäre:**
`overlayPixelRatio()` fällt auf schwachen Geräten (`COARSE`) auf `1` zurück
([map.ts:102](../../src/map.ts)). Bei Partikeln sieht man das kaum, bei TEXT
sofort. Wenn die Bildunterschrift dort sichtbar weich wird, ist die
Karten-Schicht der eine Fall, der ein eigenes, höheres Verhältnis rechtfertigt
— sie liegt nur im Halt, und im Halt ist das Budget frei (§5A). Das ist eine
Messfrage, keine Vorabentscheidung: erst zeichnen, dann am Gerät ansehen.

---

## 5A. Was das für die Bildrate bedeutet

Kurz: **eher besser, vor allem mobil**, mit einem einzigen ernsten Risiko.

**Was wegfällt, ist der teuerste Posten der heutigen Fassung.** Solange die
Karte liegt, weichzeichnet `backdrop-filter: blur(14px) saturate(0.85)
brightness(0.96)` den GANZEN Viewport, live, Frame für Frame — bei bis zu 5 MP
Zeichenfläche (`targetPixelRatio`). Full-Screen-Backdrop-Blur ist auf
Mobilgeräten regelmäßig der Grund, warum eine Szene einbricht. Bleibt der
Schleier als DOM-Schicht (§4), bleibt auch dieser Posten — der Umbau nimmt ihn
also nicht automatisch weg, aber er macht ihn zum ersten Kandidaten für eine
Messung.

**Was hinzukommt, ist gedeckelt.** Eine Vollbild-Leinwand mehr im Stapel (wie
Wetter und Atmosphäre), darauf ein skalierter `drawImage` in Kartengröße pro
Frame. Das ist ein hardwarebeschleunigter Blit, seine Kosten wachsen mit der
ZIELfläche, nicht mit der Fotogröße, und die Zielfläche ist rund die halbe
Bühne.

**Der entscheidende Umstand ist aber, WANN der Maler arbeitet.** Die Karte
liegt nur im Halt, und im Halt steht die Kamera komplett still
([tour.ts:1094](../../src/tour.ts)): MapLibre hat weder Kachelarbeit noch
Repaint. Der Maler bekommt also genau die 72–90 % der Frame-Zeit geschenkt, die
sonst der Karte gehören. Das gilt auch dann noch, wenn pro Frame neu gezeichnet
wird — was er tut, weil Ken Burns über die ganze Klip-Länge driftet (§4).

**Das eine ernste Risiko heißt `ctx.filter`.** Das „Entwickeln"
(`brightness/contrast/saturate` über 1,6 s) ist in CSS ein Compositor-Effekt
und praktisch gratis; in Canvas2D ist `ctx.filter` je nach Browser NICHT
beschleunigt und kann pro Frame Millisekunden kosten. Im Repo wird es bis heute
nirgends benutzt. Drei Auswege, in dieser Reihenfolge zu probieren: das Bild
einmal in zwei Fassungen puffern (roh und „entwickelt") und zwischen ihnen
überblenden; die Kurve über Composite-Operationen nachbauen; erst zuletzt
`ctx.filter` und dann gemessen. Dass es nur 1,6 s je Halt betrifft, macht es
erträglich, aber es sind die 1,6 s, in denen die Karte auffliegt.

**Und der erste Ausweg ist eine NÄHERUNG, keine Identität — das muss man
wissen, bevor der Pixelvergleich es meldet.** Die drei Filterwerte laufen
gleichzeitig, ihre Wirkung multipliziert sich; eine lineare Überblendung
zwischen Anfangs- und Endfassung trifft deshalb die MITTE der Kurve nicht
exakt. Dazu kommt, dass `brightness(1.45)` Lichter abschneidet, und das Mischen
zweier beschnittener Bilder ist nicht dasselbe wie das Beschneiden des
gemischten. Sichtbar ist das voraussichtlich nicht, nachweisbar schon — und
zwar genau in der Abnahme von Etappe 2. Wer das nicht weiß, sucht dort einen
Fehler, der keiner ist. Konsequenz: Die 1,6 s des Entwickelns bekommen eine
eigene Toleranz oder werden getrennt bewertet (s. Etappe 2).

**Zwei kleinere Fallen derselben Art:** Text nicht pro Frame messen und setzen
(einmal in einen Text-Puffer malen, dann blitten — der Text ändert sich im Halt
nie), und `shadowBlur` nicht pro Frame auf die große Karte legen, sondern in
den Kartenpuffer. Beides ist genau der Unterschied zwischen „Canvas ist
schneller als DOM" und dem Gegenteil.

**Im Export ist die Frage gegenstandslos.** Dort sind 98 % der Frame-Zeit
Warten auf Kacheln (`window.__j.exportMess`), Engine plus Komposition plus
Encode zusammen 1,2 ms. Der Maler verschwindet darin, und der heutige Umweg
über das DOM (Texte per `textContent` zurücklesen) fällt weg.

**Abnahme.** Vorher/Nachher an DEMSELBEN Halt, gleiche Tour, gleiche
Filmsekunde, Frame-Zeit über die ganze Standzeit, Aufbau wie in
[scripts/messungen/README.md](../../scripts/messungen/README.md) (Playwright
plus CDP-Profiler auf dem Dev-Server). Die
Zahl gehört danach hierher, so wie die Rampen-Kalibrierung ihre Zahl im
Filmachsen-Konzept stehen hat.

### Gemessen (2026-08-17, Etappe 2)

Koh Pha-ngan, erster Foto-Halt, 1920 × 1080, `body.ui-clean`, Chromium headless
auf dem M4. Vorher ist der Etappe-1-Stand (1fe46a1) aus einem eigenen
Arbeitsbaum, damit BEIDE Fassungen zur selben Zeit auf derselben Maschine laufen;
je drei Läufe, genommen ist der mittlere.

| | Mittel | Median | p95 | Bilder/s |
|---|---|---|---|---|
| **Vorher** (DOM-Karte) | 14,39 ms | 13,30 ms | 27,10 ms | 69,5 |
| **Nachher** (Leinwand) | 14,02 ms | 12,90 ms | 27,10 ms | 71,3 |

**Also unverändert, und das ist die richtige Lesart.** Die 2,6 % liegen innerhalb
der Streuung der Einzelläufe (13,88–14,73 ms). Die Erwartung „eher besser" hat
sich NICHT eingelöst — und der Grund steht oben in diesem Abschnitt: Der teuerste
Posten der alten Fassung war der Vollbild-`backdrop-filter`, und der ist geblieben
(§4, der Schleier bleibt DOM). Was hinzukam — eine Vollbild-Leinwand mehr im
Stapel, ein skalierter `drawImage` je Frame — verschwindet dagegen im Rauschen,
wie vorhergesagt.

Zwei Schlüsse daraus. Erstens: **`ctx.filter` pro Frame war die richtige Sorge
und ist umgangen.** Zweitens: **Der Schleier ist jetzt der einzige verbliebene
Kandidat für eine Messung**, und zwar auf einem schwachen Gerät — auf dem M4 ist
die Szene im Halt so billig, dass 5 MP Blur nicht wehtun.

---

## 6. Etappen

### Etappe 1 — Der Wächter über ALLE DREI Bühnen ✅ gebaut (2026-08-17)

Die Zahlen der Einblendung wandern nach `einblendung.ts` — als geteilte Werte
oder als benannte Bühnen-Varianten mit Begründung (§3.7). Ein Test liest
danach `src/style.css` und `studio.html` und vergleicht, was dort steht, gegen
diese Tabelle: Ken-Burns-Richtung und -Ende, Entwickeln-Ende, Flug- und
Abgangs-Geometrie, Ruhewinkel, Dauern.

Das Muster gibt es im Repo schon zweimal: der Drift-Wächter zwischen DESIGN.md
und `basis.css` ([test/basis-css.test.ts](../../test/basis-css.test.ts)) und
[test/einblendung-css.test.ts](../../test/einblendung-css.test.ts). Der zweite
ist der Vorfahre dieses Tests — er prüft heute nur einen Teil (die ZEITEN, und
das ausdrücklich) und hat die acht Abweichungen aus §2.2 durchgelassen.

**Auch wenn Etappe 2 nie kommt, ist das die Hälfte des Gewinns:** Es macht
Absicht von Versehen unterscheidbar, und zwar für Player, Editor und Export
zugleich.

**Gebaut als:** `KARTE` (geteilte Werte), `KARTE_BUEHNE` (benannte Varianten,
heute nur die Flugweite) und `KARTE_EXPORT_ABWEICHUNGEN` in
[einblendung.ts](../../src/einblendung.ts); der Wächter in
[test/einblendung-css.test.ts](../../test/einblendung-css.test.ts) liest
`src/style.css` und `studio.html` dagegen. Der Export bekam KEINEN Maler und
keine Korrektur, er ist der dritte Vergleichspunkt: Geprüft wird, dass er die
zwei Zahlen teilt, die er heute schon rechnet (Auftritts-Blende, Ausblend-
Rückfall), und dass seine sieben bekannten Abweichungen noch genau so dastehen.
Der Zweck dieser Liste ist, dass sie SCHRUMPFT. Wer in Etappe 2 den Nachbau
entfernt, muss sie leeren, sonst beschreibt sie Code, den es nicht mehr gibt.

**Bekannter Folgeschritt, damit er später nicht wie ein Rückschritt aussieht:**
Nach Etappe 2 steht die Player-Optik nicht mehr in `style.css`, sondern im
Maler. Der Wächter vergleicht dann Maler-Konstanten gegen `studio.html` statt
CSS gegen CSS. Die Tabelle in `einblendung.ts` überlebt beide Fassungen, der
Lesecode für die eine Seite nicht. Das ist eingeplant und kein Versäumnis.

**So eingetreten (2026-08-17).** Die Player-Seite ist von einem Regex auf CSS auf
die RECHNUNG des Malers umgestellt (`kartenPhasen`, `blitzDeckkraft`), der Editor
bleibt die Textseite, denn seine Optik IST CSS. Das ist die bessere Hälfte des
Tauschs: Ein Regex prüft, welche Zeichenkette dasteht, eine Rechnung prüft, was
herauskommt. Dazu kam ein zweiter Wächter, den es vorher nicht geben konnte — er
verlangt, dass die alten Keyframes und `--photo-*`-Variablen aus `style.css`
VERSCHWUNDEN sind. Eine vergessene Regel wäre kein Fehler, den man sieht: Sie
liefe auf einem Element, das es nicht mehr gibt, bis jemand es wieder anlegt. Und
`KARTE_EXPORT_ABWEICHUNGEN` ist leer — die Liste ist bei null angekommen, wozu
sie gedacht war.

### Etappe 2 — Die Foto-Karte ✅ gebaut (2026-08-17)

`kartenmaler.ts` plus die Schicht im Player, Export-Nachbau raus.

**Gebaut als:** [src/kartenmaler.ts](../../src/kartenmaler.ts) (DOM-frei, aus
Filmsekunde und Halt, Werte aus `KARTE`) und
[src/kartenschicht.ts](../../src/kartenschicht.ts) (die Leinwand `#karte` auf
z-index 12, ihr einziger Aufrufer). `ui.ts` füllt nur noch Werte, `style.css`
ist um die Karten-Animationen leichter, und `zeichneFotoKarte` in
[exportfilm.ts](../../src/exportfilm.ts) ist einer Zeile gewichen:
`zeichneOverlay(ctx, 'karte', …)` — dieselbe wie für Wetter und Atmosphäre.
`KARTE_EXPORT_ABWEICHUNGEN` ist leer.

Drei Dinge stehen bewusst NICHT auf der Leinwand: der Schleier (DOM darunter,
§4), die Bedienung (DOM darüber, §3.3 — ihre Flächen setzt die Schicht pro Frame
aus den Rechtecken des Malers) und eine versteckte Textfassung im `figcaption`
(§3.4). Die Abnahme lief mit
[scripts/messungen/kartenleinwand.mjs](../../scripts/messungen/kartenleinwand.mjs).

**Abnahme, und zwar präziser als „deckungsgleich":** dieselbe Tour, dieselbe
Filmsekunde, Bühne gegen Film — bei GLEICHEM Format und mit `body.ui-clean` am
Bildschirm (sonst vergleicht der Test die Fensterbreite und den Stand der
Steuerleiste, s. §5 „Skalierungsmodell").

**Gemessen bei 1920 × 1080:** Karte 1235 × 951 px, Bild 1197 × 798, Titel
38,4 px, Maßstab 1,200, Lage `breit`. Geometrie über beide Wege **identisch**,
Abweichung im Karteninneren (1203 × 919 px) **max 0 von 255**.

Verglichen wird das INNERE der Karte, um den Eckenradius eingerückt. Das ist
keine Bequemlichkeit: Durch die runden Ecken und den weichen Schatten schaut der
Schleier hindurch, und der ist die eine benannte Bühnen-Variante (§4). Über den
ganzen Umschließungskasten gemessen sind es 68 von 255 an den Kanten — also genau
der Unterschied, der erlaubt ist. Wer das nicht einrückt, bekommt einen roten
Test für die Entscheidung aus §4.

**Was diese Messung NICHT ist, und das gehört dazu:** Sie malt denselben Stand
zweimal mit demselben Maler in derselben Seite und ändert nur die
Bühnen-Schalter. Sie belegt damit das Skalierungsmodell und dass der flache
Schleier nicht ins Karteninnere blutet — nicht, dass ein Player-Screenshot einem
Export-Bild gleicht. Das war vor dem Umbau die interessante Frage; seit der
Export dieselbe Leinwand mit einem `drawImage` holt, ist sie es nicht mehr: Es
IST dasselbe Bild, und übrig bleibt allein das Skalieren des Puffers auf die
Zielgröße. Wer die Zahl später verschärfen will, vergleicht die Leinwand des
Bildschirms gegen ein fertig komponiertes Export-Bild — dann misst er genau
dieses Skalieren und sonst nichts.

**Zwei Zeitfenster, zwei Maßstäbe.** Ab dem Ende des Entwickelns (Auftritt plus
1,6 s) wird hart auf Deckungsgleichheit geprüft: Geometrie, Ken-Burns-Stand,
Schrift, Balken. WÄHREND der 1,6 s gilt eine eigene Toleranz, weil die
Überblendung zweier gepufferter Fassungen die Filterkurve nur annähert (§5A).
**Gemessen gegen die ideale Kurve** (ein `ctx.filter` mit interpoliertem Wert je
Bild), Kanal-Abweichung von 255:

| Fortschritt | 0 | 0,10 | 0,25 | 0,50 | 0,75 | 0,90 | 1 |
|---|---|---|---|---|---|---|---|
| max | 0 | 7 | 17 | **24** | 20 | 10 | 0 |
| Mittel | 0,00 | 0,98 | 2,11 | **3,00** | 2,12 | 1,29 | 0,00 |

**Anfang und Ende sind exakt, die Kurvenmitte weicht um höchstens 24 von 255 ab
(Mittel 3,0) — das ist die Toleranz des Fensters.** Sie steht genau dort, wo §5A
sie vorhergesagt hat: in der MITTE, wo sich die drei Filterwerte multiplizieren
und das Mischen zweier beschnittener Bilder nicht dasselbe ist wie das
Beschneiden des gemischten. Am Bildschirm ist das nicht auszumachen (3 von 255
über 1,6 s einer weichen Blende), nachweisbar ist es sehr wohl. Wer hier einen
Fehler sucht, sucht die Entscheidung.

**Drei Fehler, die erst der Bildschirm gezeigt hat.** Die ersten beiden sind von
derselben Sorte — eine Leinwand zeichnet sich nicht von selbst neu, eine Custom
Property tat es —, der dritte kam erst bei der Durchsicht auf einem
Retina-Bildschirm dazu:

- **Der Auto-Rückzug der UI kippt im angehaltenen Halt.** Dort läuft kein
  Kopfschritt, die Karte behielt die alte Größe, und die Steuerleiste deckte ihre
  Bildunterschrift zu — genau der Defekt, gegen den `--photo-chrome` einmal
  eingeführt wurde. Dasselbe gilt für einen Fenster-Resize: Das Schreiben von
  `canvas.width` LÖSCHT die Leinwand. Die Schicht beobachtet deshalb Größe UND
  die Klasse am body und zeichnet den letzten Stand neu.
- **Die Lage `quer` reservierte zwei Textzeilen und zeichnete drei.** Die
  Kilometer-Pille lief in die dritte Zeile hinein. Am 844 × 390-Bild gesehen, in
  keinem Unit-Test sichtbar: Beide Zahlen für sich waren plausibel.
- **Die Leinwand lag in ihrer Pixelgröße über der Seite** (Falle 12): `inset: 0`
  spannt ein ersetztes Element nicht auf, es fehlten `width: 100%; height: 100%`.
  Bei `devicePixelRatio` 2 war die Karte dadurch fast doppelt so groß und saß
  halb außerhalb des Fensters. Unsichtbar bei Ratio 1 und unsichtbar im Film,
  weil die Komposition den Puffer nimmt und die Seite nicht ansieht.

### Etappe 3 — herausgelöst

Startscreen und Finale-Tafel standen hier als dritte Etappe. Sie sind ein eigenes
Vorhaben geworden: [Die Tafeln auf die Leinwand](die-tafeln-auf-die-leinwand.md).
Das Werkzeug dafür ist mit Etappe 2 entstanden und wartet dort — Bezugshöhe,
Kurven, Textumbruch, Puffer und das Muster „Bild auf die Leinwand, Bedienung als
mitgeführtes DOM".

---

## 7. Fallen

1. **Zugänglichkeit ist die eigentliche Gefahr.** Eine Leinwand hat keinen
   Text. Ohne die versteckte Kopie verliert der Player Bildunterschriften für
   Screenreader — und niemand merkt es, weil das Bild gleich aussieht.
2. **`prefers-reduced-motion` fällt beim Umbau still weg.** Der Player hatte
   einen ausführlichen Reduce-Block für die Karte (Ken Burns aus, Auftritt aus,
   Blitz aus); eine Leinwand erbt davon nichts. Der Maler darf die Einstellung
   aber auch nicht selbst lesen: Im EXPORT hätte der rendernde Rechner sonst
   Einfluss auf die ausgelieferte Datei. Also ein Schalter im Aufruf
   (`buehne.ruhig`), gesetzt von der Schicht, und im Export immer aus. Dieselbe
   Sorte Verlust wie Falle 1, nur unsichtbarer — deshalb verbietet der Wächter
   dem Maler jedes `matchMedia`.
3. **`ctx.font` scheitert leise.** Fehlt die Schrift noch, wird ohne Fehler die
   Ersatzschrift gezeichnet. `document.fonts.ready`.
4. **`backdrop-filter` hat kein Gegenstück, und der Puffer-Trick trägt nicht.**
   Weder pro Frame mit `ctx.filter` nachbauen noch einmal in einen Puffer
   einfrieren: Für den Puffer bräuchte es `preserveDrawingBuffer` im
   Normalbetrieb, und das Wetter läuft im Halt weiter (§4). Der Schleier bleibt
   DOM, die flache Füllung im Film ist eine benannte Variante.
5. **Der Klick auf die Karte muss bleiben, und er ist kein statischer Kasten.**
   „Klick: anhalten / weiterlaufen" hängt am `figure`, dazu kommen der Ton-Knopf
   des Videos und „Weiter ▸". Auf einer Leinwand braucht es mitgeführte,
   unsichtbare DOM-Rechtecke — und die müssen mitwandern, wenn die Karte springt,
   weil die Bedienung erscheint oder verschwindet. `maleKarte` gibt sie deshalb
   zurück (`KartenMasse`), die Schicht legt sie an. Beim Bauen kam eine
   ZEHNTE Falle derselben Familie dazu, und sie ist die teuerste des ganzen
   Umbaus, s. Falle 10.
6. **Nicht in Gerätepixeln rechnen.** Der Maler bekommt CSS-Pixel; wer `dpr` in
   die Geometrie einrechnet, bekommt am Bildschirm und im Film verschiedene
   Karten. Genau der Fehler, den das Konzept beheben soll. Die zweite Hälfte
   davon ist das Skalierungsmodell (§5): Ein Maler ohne Bezugshöhe liefert bei
   verschiedenen Formaten verschieden große Karten, auch ohne jeden `dpr`.
7. **Der Editor bleibt DOM (§3.6).** Wer beim Umbau „dann gleich überall"
   denkt, kippt §6A des Gleichlauf-Konzepts. Umgekehrt gilt aber auch: Wer eine
   Zahl im Player anfasst, ohne in die Tabelle zu sehen, erzeugt die nächste
   Zeile aus §2.2 — acht Werte sind so entstanden.
8. **Das Video muss weiter nur bei Tempo 1 laufen.** Der Maler zeichnet, er
   entscheidet nicht über Wiedergabe — sonst liefe im Schnelllauf plötzlich
   Ton. Und er darf keinen Frame malen, der noch gesucht wird (§5).
9. **Canvas ist nicht von selbst schneller.** Pro Frame Text messen, `ctx.filter`
   setzen und `shadowBlur` auf die große Karte legen macht die Leinwand
   langsamer als das DOM, das sie ersetzt (§5A). Der Maler puffert deshalb drei
   Dinge: die zwei Bildfassungen, den Schatten (in EIGENER, niedriger Auflösung —
   ein Verlauf über 140 px hat keine feine Struktur) und jeden Textblock.
10. **Eine Leinwand zeichnet sich nicht von selbst neu — und das ist die Falle,
    die beim Bauen wirklich zugeschlagen hat.** Eine Custom Property tat es: Wer
    `--photo-chrome` änderte, hatte im nächsten Bild die neue Kartengröße. Auf
    einer Leinwand hängt jede Änderung am nächsten Kopfschritt, und im
    ANGEHALTENEN Halt läuft keiner. Zwei Fälle waren dadurch beide kaputt: Der
    Auto-Rückzug der UI kippt genau dort (die Steuerleiste deckte die
    Bildunterschrift zu — der Defekt, gegen den `--photo-chrome` erfunden
    wurde), und ein Fenster-Resize LÖSCHT die Leinwand, weil er `canvas.width`
    schreibt. Die Schicht beobachtet deshalb beides und zeichnet den letzten
    Stand neu. Wer eine neue Größe einführt, die die Karte betrifft, gibt ihr
    einen Beobachter — oder sie gilt erst beim nächsten Bild.
11. **Text auf einer Leinwand muss GEKÜRZT werden.** Canvas kennt kein
    `text-overflow: ellipsis`, und die Kartenhöhe ist auf eine feste Zahl Zeilen
    gerechnet. Reserviert und gezeichnet müssen dieselbe Zahl sein: In der Lage
    `quer` standen zwei Zeilen im Platz und drei auf dem Papier, und die
    Kilometer-Pille lief hinein. Beide Zahlen waren für sich plausibel, und kein
    Unit-Test konnte es sehen.
12. **`inset: 0` spannt eine Leinwand NICHT auf, und auf einem Bildschirm mit
    Gerätepixel-Verhältnis 1 merkt man es nicht.** Ein `canvas` ist ein
    ERSETZTES Element: Sein `width: auto` löst auf die intrinsische Größe auf,
    also auf das `width`-Attribut, und `right`/`bottom` werden dann still
    ignoriert. `.karten-leinwand` lag dadurch in ihrer PIXELgröße über der
    Seite — bei `devicePixelRatio` 2 fast doppelt so groß wie das Fenster, die
    Karte doppelt so groß und halb außerhalb. Am Bildschirm mit Ratio 1 stimmen
    Pixel- und CSS-Größe zufällig überein, und im Film stimmt es immer, weil die
    Komposition den Puffer direkt nimmt und die Seite gar nicht ansieht: Der
    Fehler war also genau dort unsichtbar, wo geprüft wurde. `#atmosphere` und
    `#weather` tragen `width: 100%; height: 100%` aus diesem Grund seit jeher;
    der neuen Schicht fehlten sie. Gefunden erst beim Nachsehen auf einem
    Retina-Bildschirm.

---

## 8. Was wir nicht tun

- **Kein html2canvas, kein `foreignObject`.** Beides ist der Versuch, DOM doch
  irgendwie zu greifen: langsam, mit fremden Bildern und Schriften unzuverlässig,
  und das Ergebnis ist nie exakt. Es wäre eine dritte Fassung, nicht eine.
- **Keine geteilte DOM-Komponente Player↔Editor.** Verworfen und begründet
  ([Gleichlauf-Konzept](konzept_gleichlauf_player_editor.md) §6A).
- **Nicht dem Export das Zeichnen überlassen.** Er könnte den Maler auch nur
  für sich benutzen und der Player bliebe DOM. Dann gäbe es weiterhin zwei
  Fassungen, nur ordentlicher sortiert.

---

## 9. Was davon weiterlebt

Der Plan ist durch. Zwei Dinge bleiben trotzdem gültig, und beide betreffen
Leute, die dieses Dokument nicht suchen, sondern in den Code stolpern:

1. **Nicht anfassen, ohne in die Tabelle zu sehen.** `KARTE` und `KARTE_BUEHNE`
   in [einblendung.ts](../../src/einblendung.ts) sind die geteilten Zahlen von
   Player und Editor; die Geometrie der Player-Bühne steht in `KARTEN_MASSE`
   ([kartenmaler.ts](../../src/kartenmaler.ts)) und ist ausdrücklich NICHT
   geteilt. Wer eine Zahl im Maler ändert, ändert sie für Bildschirm UND Film.
   Ein Wert, der auf zwei Bühnen zufällig anders ist, gilt als Fehler und nicht
   als Geschmack (§3.7) — acht Werte sind genau so entstanden.
2. **Eine Messung ist offen, aber keine Etappe:** der Schleier (§5A). Auf dem M4
   ist der Vollbild-`backdrop-filter` im Halt nicht messbar, auf einem schwachen
   Gerät könnte er der teuerste Posten der Szene sein. Erst messen, dann
   entscheiden — und wenn er fällt, fällt er auf BEIDEN Bildschirm-Bühnen
   zugleich, sonst ist §2.2 wieder eine Zeile länger. Weitergetragen wird die
   Frage im [Tafel-Konzept](die-tafeln-auf-die-leinwand.md), weil dort dieselbe
   Sorte Glasfläche zur Entscheidung steht und weil ein erledigtes Dokument
   niemand mehr aufschlägt.
