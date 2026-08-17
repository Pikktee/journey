# Konzept: Die Foto-Karte auf eine Leinwand

**Ziel:** Die letzte Stelle schließen, an der Player und Video-Export
auseinanderlaufen können — die Einblendungen. Alles andere im Film ist seit dem
Takt-Umbau Player-Code; Foto-Karte, Startscreen und Finale-Tafel sind es nicht.

Stand: **2026-08-17** · Status: **Entwurf, nichts gebaut** ·
Betrifft: Player (`src/ui.ts`, `src/style.css`, `erlebnis.html`), Video-Export
(`src/exportfilm.ts`), geteilte Zahlen (`src/einblendung.ts`).

Verwandt, aber anders:
- [konzept_video_export.md](konzept_video_export.md). Dort steht, warum der
  Export ein Taktgeber ist und was er heute nachbaut. Dieses Konzept löst genau
  den Rest, den §6 dort als „die einzige Stelle" benennt.
- [konzept_gleichlauf_player_editor.md](konzept_gleichlauf_player_editor.md) §6A.
  Dort ist ein GETEILTES DOM-Bauteil zwischen Player und Editor ausdrücklich
  verworfen. Das bleibt so — hier geht es um Player↔Export, nicht um
  Player↔Editor (s. §5).

---

## 1. Das Problem in einem Satz

> Die Karte, die der Zuschauer sieht, und die Karte, die in der Datei landet,
> sind zwei verschiedene Programme.

Der Player baut sie aus DOM und CSS. Der Export kann DOM nicht greifen — ein
`drawImage` nimmt nur Leinwände — und zeichnet sie deshalb ein zweites Mal auf
seine Komposition (`zeichneFotoKarte`, `zeichneIntroTafel`,
`zeichneFinaleTafel`; zusammen knapp 200 Zeilen).

Das ist dieselbe Sorte Fehler, die der Takt-Umbau bei der Kamera behoben hat,
nur eine Ebene höher: nicht zwei Uhren, sondern zwei Zeichner.

---

## 2. Es ist nicht theoretisch — es ist schon falsch

Kein einziger dieser Punkte ist eine Befürchtung. Alle stehen heute so im Code:

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

Genau das ist das Argument: Eine Zweitfassung driftet nicht irgendwann, sie ist
schon beim Schreiben anders. Jede spätere Änderung an der Karte macht es
schlimmer, und keine davon fällt auf.

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
6. **Der Editor rührt sich nicht.** Er behält seine DOM-Einblendung. Das ist
   kein Versehen, sondern §6A des Gleichlauf-Konzepts: Der Player streamt einen
   Film voraus, der Editor springt in einer Datei umher. Geteilt sind die
   Rechnungen, nicht die Mechanik. Ob der Editor später denselben Maler benutzt,
   ist eine eigene Frage — und eine leichtere, sobald es einen Maler gibt.

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

### Etappe 1 — Der Wächter (klein, sofort wertvoll)

Ein Test, der Maler-Eingaben und die heutigen CSS-Zahlen gegeneinander hält:
Ken-Burns-Richtung und -Endwerte, Entwickeln-Dauer, Klip-Länge, Balkenanteil.
Er läuft ohne Browser, weil beide Seiten aus `einblendung.ts` kommen — und er
hätte die Ken-Burns-Umkehrung aus §2 am Tag ihrer Entstehung gemeldet.

**Auch wenn Etappe 2 nie kommt, ist dieser Test die Hälfte des Gewinns.**

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
   denkt, kippt §6A des Gleichlauf-Konzepts.
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

1. Etappe 1 bauen: den Wächter. Er ist billig und deckt den Rest der Zeit ab,
   in der es zwei Fassungen gibt.
2. Etappe 2 erst danach, und mit dem Bildvergleich als Abnahme.
3. Vorher §2 gegenprüfen — die Tabelle ist am Code von heute abgelesen und
   sollte am Tag des Umbaus noch stimmen.
