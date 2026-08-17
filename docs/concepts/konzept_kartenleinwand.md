# Konzept: Die Foto-Karte auf eine Leinwand

**Ziel:** Die letzte Stelle schließen, an der die Bühnen auseinanderlaufen
können — die Einblendungen. Alles andere im Film ist seit dem Takt-Umbau
geteilter Code; Foto-Karte, Startscreen und Finale-Tafel sind es nicht.

**Es sind DREI Fassungen, nicht zwei.** Player (DOM + CSS), Studio-Editor
(eigenes DOM + eigenes CSS) und Video-Export (Canvas). Das war der erste
Entwurf dieses Konzepts zu eng gefasst: Er nannte nur Player↔Export, weil dort
die Abweichungen grob sind. Nachgemessen weichen aber auch Player und Editor an
vier Stellen voneinander ab — feiner, und deshalb schlimmer, weil man sie für
gewollt halten könnte (§2).

Stand: **2026-08-17** · Status: **Entwurf, nichts gebaut** ·
Betrifft: Player (`src/ui.ts`, `src/style.css`, `erlebnis.html`), Studio-Editor
(`src/studio/abspielen.ts`, `studio.html`), Video-Export (`src/exportfilm.ts`),
geteilte Zahlen (`src/einblendung.ts`).

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
der Export kann DOM überhaupt nicht greifen — ein `drawImage` nimmt nur
Leinwände —, also zeichnet er sie ein drittes Mal auf seine Komposition
(`zeichneFotoKarte`, `zeichneIntroTafel`, `zeichneFinaleTafel`; zusammen knapp
200 Zeilen).

Das ist dieselbe Sorte Fehler, die der Takt-Umbau bei der Kamera behoben hat,
nur eine Ebene höher: nicht zwei Uhren, sondern drei Zeichner. Und wie dort
liegt die Lösung nicht darin, alle drei gleichzuschalten, sondern darin, die
gemeinsame Substanz an einen Ort zu ziehen und den Rest als Absicht zu
benennen.

---

## 2. Es ist nicht theoretisch — es ist schon falsch

Kein einziger Punkt hier ist eine Befürchtung. Alle stehen heute so im Code.

### 2.1 Player gegen Export — grob

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

**Und jetzt der Punkt, auf den es ankommt: Man kann nicht sagen, welche dieser
vier Zeilen gewollt ist.** Die 48 px Flugweite gegen 70 px sind es
offensichtlich — die Editor-Karte ist kleiner, sie liegt auf einem Leuchttisch
und nicht bildschirmfüllend. Aber `1.01` gegen `1.02`? `-0.4°` gegen `-0.5°`?
Ein Entwickeln, das im Player bei `contrast 1.02 / saturate 1.05` endet und im
Editor bei `none`? Das sieht nach abgeschriebenen Zahlen aus, nicht nach einer
Entscheidung. Nachweisen lässt es sich heute nicht, weil nirgends steht, was
gleich sein SOLL.

Das ist die eigentliche Krankheit, und sie ist schlimmer als die groben
Abweichungen aus §2.1: Ein Fehler, den man sieht, wird behoben. Einer, den man
für Absicht halten kann, bleibt.

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
   Kandidat für die erste Variante: die Flugweite (bildschirmfüllend gegen
   Leuchttisch). Kandidaten für „war nie gemeint": Ken-Burns-Ende,
   Entwickeln-Ende, Ruhewinkel.

---

## 4. Was das kostet, und was es einspart

**Es wird nicht weniger Code, es wird EINMAL Code.** Der Maler ist ungefähr so
lang wie der heutige Export-Nachbau; dafür fallen dort ~200 Zeilen weg und im
Player die CSS-Animationen der Karte. Der Gewinn liegt nicht in Zeilen, sondern
darin, dass es die Zeilen nur einmal gibt.

Was schwieriger wird als in CSS:

- **Textumbruch und Kürzen.** Canvas kann kein `text-overflow: ellipsis`. Der
  Maler braucht Umbruch und Kürzen selbst — das steht mit `brichAttribution`
  in [exportfilm.ts](../../src/exportfilm.ts) schon da und gehört mit in den Maler.
- **Schriften.** `ctx.font` zeichnet stumm mit der Ersatzschrift, wenn Outfit
  noch lädt. `document.fonts.ready` abwarten, bevor das erste Bild fällt — im
  Export ohnehin Pflicht, am Bildschirm ein Blitzen.
- **Weichzeichnen hinter der Karte.** `backdrop-filter: blur(14px)` hat auf
  einer Leinwand kein Gegenstück. `ctx.filter = 'blur(14px)'` gibt es, ist aber
  langsam und nicht überall gleich. Der ehrliche Weg: den Karten-Ausschnitt der
  Szene EINMAL beim Auftritt in einen Offscreen-Puffer weichzeichnen und den
  liegen lassen — er ändert sich im Halt ohnehin nicht, weil die Kamera steht.
  Das ist zugleich schneller als das heutige Live-Blur.
- **Rundungen und Schatten** sind `roundRect` und `shadowBlur`, also kein Thema.

Was leichter wird:

- **Der Halt ist der Ruhefall.** Während die Karte liegt, steht die Kamera. Die
  Leinwand muss also nur bei Änderung neu gemalt werden, nicht pro Frame.
- **Rückwärts und Einzelbild fallen an.** Der Maler bekommt eine Filmsekunde
  und zeichnet den Stand dazu. Das ist genau das Modell, das die CSS-Fassung
  über `--karte-zeit` und pausierte Animationen mühsam nachstellt.

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

### Auflösung

Am Bildschirm zeichnet die Schicht mit `overlayPixelRatio()` wie Atmosphäre und
Wetter (gemeinsames Pixelbudget, s. `map.ts`). Im Export mit dem Export-Ratio.
Der Maler bekommt Breite und Höhe in CSS-Pixeln und eine Transform-Matrix — er
rechnet nie in Gerätepixeln.

---

## 6. Etappen

### Etappe 1 — Der Wächter über ALLE DREI Bühnen (klein, sofort wertvoll)

Die Zahlen der Einblendung wandern nach `einblendung.ts` — als geteilte Werte
oder als benannte Bühnen-Varianten mit Begründung (§3.7). Ein Test liest
danach `src/style.css` und `studio.html` und vergleicht, was dort steht, gegen
diese Tabelle: Ken-Burns-Richtung und -Ende, Entwickeln-Ende, Flug- und
Abgangs-Geometrie, Ruhewinkel, Dauern.

Das Muster gibt es im Repo schon zweimal: der Drift-Wächter zwischen DESIGN.md
und `basis.css` ([test/basis-css.test.ts](../../test/basis-css.test.ts)) und
[test/einblendung-css.test.ts](../../test/einblendung-css.test.ts). Der zweite
ist der Vorfahre dieses Tests — er prüft heute nur einen Teil und hat die vier
Abweichungen aus §2.2 durchgelassen.

**Auch wenn Etappe 2 nie kommt, ist das die Hälfte des Gewinns:** Es macht
Absicht von Versehen unterscheidbar, und zwar für Player, Editor und Export
zugleich.

### Etappe 2 — Die Foto-Karte

`kartenmaler.ts` plus die Schicht im Player, Export-Nachbau raus. Abnahme ist
ein Vergleich: dieselbe Tour, dieselbe Filmsekunde, Player-Screenshot gegen
Export-Frame. Sie müssen deckungsgleich sein — vorher gemessen, damit die Zahl
im Konzept steht.

### Etappe 3 — Die Tafeln

Startscreen und Finale auf dieselbe Schicht. Sie sind die leichtere Hälfte
(Text und Linien, kein Ken Burns, kein Video), aber sie kommen zuletzt: Der
Startscreen ist am Bildschirm eine Bühne mit Knöpfen, und die müssen dabei
bedienbar bleiben.

---

## 7. Fallen

1. **Zugänglichkeit ist die eigentliche Gefahr.** Eine Leinwand hat keinen
   Text. Ohne die versteckte Kopie verliert der Player Bildunterschriften für
   Screenreader — und niemand merkt es, weil das Bild gleich aussieht.
2. **`ctx.font` scheitert leise.** Fehlt die Schrift noch, wird ohne Fehler die
   Ersatzschrift gezeichnet. `document.fonts.ready`.
3. **`backdrop-filter` hat kein Gegenstück.** Nicht mit `ctx.filter` pro Frame
   nachbauen, sondern einmal in einen Puffer (s. §4) — im Halt steht die Kamera.
4. **Der Klick auf die Karte muss bleiben.** „Klick: anhalten / weiterlaufen"
   hängt heute am `figure`. Auf einer Leinwand braucht es einen Treffertest
   oder — besser — ein unsichtbares DOM-Rechteck, das mitgeführt wird.
5. **Nicht in Gerätepixeln rechnen.** Der Maler bekommt CSS-Pixel; wer `dpr` in
   die Geometrie einrechnet, bekommt am Bildschirm und im Film verschiedene
   Karten. Genau der Fehler, den das Konzept beheben soll.
6. **Der Editor bleibt DOM (§3.6).** Wer beim Umbau „dann gleich überall"
   denkt, kippt §6A des Gleichlauf-Konzepts. Umgekehrt gilt aber auch: Wer eine
   Zahl im Player anfasst, ohne in die Tabelle zu sehen, erzeugt die nächste
   Zeile aus §2.2 — vier Werte sind so entstanden.
7. **Das Video muss weiter nur bei Tempo 1 laufen.** Der Maler zeichnet, er
   entscheidet nicht über Wiedergabe — sonst liefe im Schnelllauf plötzlich Ton.

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

## 9. Auftrag für den nächsten Kontext

1. Etappe 1 bauen: den Wächter über alle drei Bühnen. Er ist billig und deckt
   den Rest der Zeit ab, in der es drei Fassungen gibt.
2. Dabei die vier Zeilen aus §2.2 EINZELN entscheiden: geteilte Zahl oder
   benannte Bühnen-Variante. Nicht stillschweigend gleichziehen — die Flugweite
   soll verschieden bleiben, und ohne Begründung im Code wäre die nächste
   Vereinheitlichung eine Verschlechterung.
3. Etappe 2 erst danach, und mit dem Bildvergleich als Abnahme.
4. Vorher §2 gegenprüfen — beide Tabellen sind am Code von heute abgelesen und
   sollten am Tag des Umbaus noch stimmen.
