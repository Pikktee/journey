---
stand: 2026-08-17
status: Entwurf, nichts gebaut
betrifft:
  - Player (erlebnis.html, src/style.css, src/ui.ts)
  - Video-Export (src/exportfilm.ts, src/exportformat.ts)
  - Leinwand-Werkzeug (src/kartenmaler.ts, src/kartenschicht.ts)
icon: leinwand
---

# Die Tafeln auf die Leinwand

**Ziel:** Startscreen und „Ziel erreicht" haben ihren Canvas-Nachbau im
Video-Export noch. Ihn ablösen, ohne die Bedienbarkeit am Bildschirm zu verlieren
und ohne die Unterschiede einzuebnen, die dort ABSICHT sind.

Das ist der herausgelöste Rest von
[Die Foto-Karte auf eine Leinwand](die-foto-karte-auf-eine-leinwand.md), wo er
als Etappe 3 stand. Herausgelöst, weil er ein anderes Ziel hat, und das ist
mehr als eine Terminfrage, s. §1.

Was von dort mitkommt, ist das Werkzeug: `src/kartenmaler.ts` bringt Bezugshöhe
und `mass`, die CSS-Kurven, Textumbruch mit Kürzen und die Puffer-Mechanik schon
mit, `src/kartenschicht.ts` das Muster „Bild auf die Leinwand, Bedienung als
mitgeführtes DOM darüber". Nichts davon muss ein zweites Mal entstehen.

---

## 1. Warum das ein eigenes Konzept ist

**Bei der Foto-Karte hieß das Ziel „deckungsgleich". Hier heißt es das gerade
nicht.**

Die Karte muss am Bildschirm und im Film dasselbe Bild sein: Sie ist der Inhalt
des Halts, und dass ihr Ken Burns im Export in die Gegenrichtung lief, war ein
Fehler. Die Tafeln sind etwas anderes: Der Startscreen ist eine BÜHNE MIT
KNÖPFEN, die Intro-Tafel des Films ist eine TITELTAFEL. Der Export lässt dort
heute schon bewusst Dinge weg (Startknopf, Zurück-Pille) und stellt andere anders
dar (Kennzahlen als ruhige Zeile statt als drei Pillen). Der Grund steht im
Kommentar an `zeichneIntroTafel`: Ein Rand und eine Glasfläche sagen „hier kann
man klicken". In einem Film sagt das niemandem etwas und sieht nach Screenshot
aus.

Daraus folgt eine andere Leitfrage, und deshalb ein eigenes Dokument: **Nicht
„wie machen wir es gleich?", sondern „welcher Teil ist geteilt und welcher ist
eine benannte Variante?"** Wer dieses Vorhaben als Fortsetzung der Karte liest,
verschmilzt Startscreen und Titeltafel und macht den Film zum Screenshot. Wer es
gar nicht angeht, behält den letzten Nachbau und die letzte Stelle, an der der
Export Texte per `textContent` aus dem DOM zurückliest.

---

## 2. Was heute dasteht

**Am Bildschirm** ([erlebnis.html](../../erlebnis.html)) sind es zwei Abschnitte
im DOM, mit CSS in [style.css](../../src/style.css):

| | Startscreen `.intro` | Finale `.finale` |
|---|---|---|
| Text | Kicker, **`h1`** (die einzige des Players), Trennlinie, Route | Kicker, `h2`, drei Kennzahlen mit Etikett |
| Kennzahlen | drei `.chip`-Pillen | drei `.stat` in einer Reihe |
| Bedienung | „Tour starten" | „Noch einmal erleben", „Zum Hauptmenü" |
| Auftritt | `.reveal` mit gestaffelten `--d`-Verzögerungen | Klasse `.in` auf der Karte |
| Grund | Bühne mit Knöpfen | Bühne mit Knöpfen |

**Im Film** ([exportfilm.ts](../../src/exportfilm.ts)) sind es zwei Funktionen,
`zeichneIntroTafel` und `zeichneFinaleTafel`, zusammen ~130 Zeilen. Sie sind
sauberer als der Karten-Nachbau war (der Kommentar erklärt die Absicht, die Maße
sind auf 720p ausgemessen und skalieren über ein `e`), aber sie tragen dieselben
drei Erbfehler:

1. **Der INHALT kommt aus dem DOM.** `text('intro-kicker')`, `text('final-km')`,
   `document.getElementById('intro-title')?.innerHTML` samt Aufspalten an
   `<br>`. Das ist der Umweg, den die Karte hinter sich hat: Der Export liest das
   Ergebnis des Players, nicht dessen Daten.
2. **Ein eigener Maßstab.** `e = min(b, h) / 720` neben der Bezugshöhe 900 des
   Malers. Zwei Maßstäbe für eine Bühne sind einer zu viel.
3. **Textmaße geraten statt gemessen.** Der Titel wird über
   `(b * 0.82) / (laengste * 0.54)` eingepasst. Das ist eine Schätzung „0,54 Kartenbreite
   je Zeichen", die bei „Wengen" und bei „Kleine Scheidegg" verschieden weit
   danebenliegt. `measureText` steht daneben zur Verfügung.

**Geteilt ist heute nur die ZEIT**, und die hält: `introTafelSicht` und
`finaleTafelSicht` in [exportformat.ts](../../src/exportformat.ts) sind DOM-frei
und getestet. Sie bleiben, wo sie sind.

---

## 3. Leitentscheidungen (Entwurf)

1. **Ein Zeichner, wie bei der Karte.** Ein `tafelmaler.ts` neben dem
   Kartenmaler, oder zwei Funktionen darin: Das entscheidet sich beim Bauen, wenn
   sichtbar ist, wie viel Geometrie sich wirklich teilt. Wichtig ist: DOM-frei,
   aus Werten, nicht aus `textContent`.
2. **Die Bezugshöhe ist dieselbe** (900, `kartenMass`). Ein zweiter Maßstab
   neben dem ersten wäre die nächste Zeile aus §2.2 des Karten-Konzepts.
3. **Die Bedienung bleibt DOM, und hier ist sie mehr als ein Beiwerk.** „Tour
   starten" ist der einzige Weg in die Tour, die beiden Finale-Knöpfe der einzige
   Weg heraus. Sie liegen über der Leinwand, ihre Flächen kommen mitgeführt aus
   dem Maler (das Muster ist `KartenMasse`).
4. **Der `h1` bleibt im Dokument.** Bei der Karte war die versteckte Textfassung
   Zugänglichkeit; hier ist sie zusätzlich die ÜBERSCHRIFT der Seite. Eine
   Leinwand hat keine Gliederung, und ein Player ohne `h1` ist nicht nur schlechter
   vorlesbar, er hat keinen Titel mehr.
5. **Die Unterschiede zwischen Bühne und Titeltafel werden BENANNT**, nach
   derselben Regel wie in `KARTE_BUEHNE`: geteilte Zahl oder Variante mit Grund.
   Sicher verschieden sind: Knöpfe (im Film keine), Kennzahlen-Darstellung
   (Pillen gegen Zeile), Glasfläche und Rand des Finales (im Film ein Scrim).
   Sicher geteilt sein sollten: Schriftgrade und ihr Verhältnis, Farben, die
   Trennlinie, die Reihenfolge der Zeilen.
6. **Die Auftritts-Staffelung ist ein Kandidat, kein Muss.** Am Bildschirm
   laufen die `.reveal`-Verzögerungen nach WANDUHR und ab dem Laden. Das ist
   dort richtig, denn es gibt keine Filmzeit vor dem Start. Im Film gibt es keine
   Staffelung, nur `introTafelSicht`. Ob das zusammengeführt wird, ist eine
   Gestaltungsfrage und keine Aufräumfrage.

---

## 4. Was leichter ist als bei der Karte

- **Kein Ken Burns, kein „Entwickeln", kein Video.** Damit fällt die ganze
  Puffer-und-Überblendung-Frage weg, samt ihrer Toleranz.
- **Kein Halt.** Die Tafeln liegen im Intro-Orbit und im Finale-Orbit. Dort dreht
  die Kamera, das Frame-Budget ist also NICHT so frei wie im Halt. Gezeichnet wird
  aber auch nur Text, und der geht in einen Puffer.
- **Kein Schleier mit `backdrop-filter`.** Das Finale hat eine Glasfläche
  (`--glas` plus `backdrop-filter`), aber die ist Teil der KARTE und nicht der
  ganzen Bühne. Ob sie DOM bleibt wie der Schleier der Foto-Karte oder als
  Füllung auf die Leinwand geht, hängt daran, ob man das Gelände dahinter noch
  lesen will.

## 5. Was schwerer ist

- **Der Startscreen wird nicht ausgeblendet, er wird VERLASSEN.** `hideIntro`
  setzt `.gone`, und die Klasse trägt eine Transition. Eine Leinwand braucht
  dafür einen Fortschritt von außen, und zwar einen, der nicht an der Filmzeit
  hängt, weil es vor dem Start keine gibt. Das ist die eine Stelle, an der das
  Muster der Karte NICHT trägt.
- **Der Titel bricht in Zeilen, die aus der Tour kommen** (`Berner<br />Oberland`).
  Der Maler braucht ihn deshalb als LISTE von Zeilen, nicht als Zeichenkette mit
  Markup darin. Das ist eine kleine Änderung an der Datenseite und die einzige,
  die über die Zeichnerei hinausgeht.
- **Zwei Knöpfe nebeneinander im Finale.** Bei der Karte war „Weiter ▸" ein
  einzelnes Rechteck. Zwei Knöpfe brauchen eine Reihe mit Umbruch auf schmalen
  Bühnen: Geometrie, die der Maler ausrechnen und zurückgeben muss.

---

## 6. Abnahme

Dieselbe Methodik wie bei der Karte
([scripts/messungen/kartenleinwand.mjs](../../scripts/messungen/kartenleinwand.mjs)
ist die Vorlage), aber mit einer anderen Frage:

1. **Bühne:** Der Startscreen ist mit der Tastatur bedienbar, „Tour starten"
   liegt auf seinem Rechteck, der `h1` steht im Dokument. Dasselbe für die zwei
   Knöpfe des Finales.
2. **Film:** Titel, Kicker, Route und Kennzahlen stehen in der Datei so da, wie
   die Tour sie nennt, geprüft gegen die DATEN und nicht gegen das DOM.
3. **Gemeinsam:** Was die Tabelle als geteilt führt, ist bei gleichem Format
   gleich; was als Variante dasteht, weicht genau dort ab und nirgends sonst.
4. **Formate:** 1920 × 1080, 1080 × 1920 (der Export kann hoch), 1280 × 800,
   Telefon. Bei der Karte hat genau dieser Durchgang zwei Fehler gefunden, die
   kein Unit-Test sehen konnte.

---

## 7. Fallen

Die Fallenliste des
[Karten-Konzepts](die-foto-karte-auf-eine-leinwand.md) gilt vollständig weiter:
Sie ist an einer Leinwand im Player abgearbeitet und keine Vermutung mehr. Vier
davon sind hier besonders scharf:

1. **`inset: 0` spannt eine Leinwand nicht auf.** Ein `canvas` ist ein ersetztes
   Element; ohne `width: 100%; height: 100%` lag die Karten-Schicht in ihrer
   PIXELgröße über der Seite, bei `devicePixelRatio` 2 also fast doppelt so groß.
   Unsichtbar bei Ratio 1 und unsichtbar im Film. Wer eine zweite Schicht anlegt,
   macht denselben Fehler ein zweites Mal.
2. **Eine Leinwand zeichnet sich nicht von selbst neu.** Größe und
   `body`-Klassen brauchen einen Beobachter, sonst gilt eine Änderung erst beim
   nächsten Bild, und im Startscreen läuft überhaupt kein Bild: Dort steht die
   Kamera im Orbit, und die Tafel ändert sich nie von selbst.
3. **`ctx.font` scheitert leise.** `document.fonts.ready` abwarten. Beim
   Startscreen ist das kritischer als bei der Karte: Er ist das ERSTE, was jemand
   sieht, und Outfit ist dann oft noch nicht da.
4. **`prefers-reduced-motion` als Schalter im Aufruf**, nie im Maler gelesen.
   Im Export hätte der rendernde Rechner sonst Einfluss auf die Datei. Der
   Startscreen hat `.reveal`-Animationen, ist also betroffen.

Dazu eine eigene:

5. **Der Startscreen ist der Weg IN die Tour und das Finale der Weg heraus.** Ein
   Knopf, der wegen einer falsch berechneten Fläche nicht zu treffen ist, macht
   den Player unbenutzbar, anders als bei „Weiter ▸", das nur eine Bequemlichkeit
   neben der ablaufenden Standzeit ist. Erst die Flächen, dann die Optik.

---

## 8. Auftrag für den nächsten Kontext

1. **§2 gegenprüfen.** Die Tabelle ist am Code vom 2026-08-17 abgelesen. Beim
   Karten-Konzept wuchs die entsprechende Liste beim ersten Gegenprüfen von vier
   auf acht Zeilen; das ist die Erwartung, nicht die Ausnahme.
2. **Die Trennung aus §3.5 EINZELN entscheiden**, bevor Code entsteht: Für jede
   Zahl der beiden Tafeln geteilt oder benannte Variante. Ohne das wird aus dem
   Vorhaben eine Vereinheitlichung, und die Titeltafel des Films verliert genau
   das, was sie zur Titeltafel macht.
3. **Erst die Flächen, dann die Optik** (Falle 5).
4. **Der Kartenmaler ist die Vorlage, nicht die Schablone.** Was sich teilen
   lässt (Bezugshöhe, Kurven, Textumbruch, Puffer), wird geteilt; ein zweiter
   `KARTEN_MASSE`-Satz für Tafeln ist dagegen richtig, denn eine Tafel ist keine
   Karte.
5. **Eine geerbte Messung mitnehmen:** der Schleier der Foto-Karte
   ([§5A dort](die-foto-karte-auf-eine-leinwand.md)). Er bleibt eine DOM-Schicht
   mit `backdrop-filter` über dem ganzen Bild, und auf dem M4 kostet er im Halt
   nichts messbares. Auf einem schwachen Gerät könnte er der teuerste Posten der
   Szene sein. Die Frage steht hier, weil beim Finale dieselbe Sorte Glasfläche
   zur Entscheidung kommt (§4) und man dann ohnehin am Gerät messen muss. Fällt
   der Schleier, fällt er auf BEIDEN Bildschirm-Bühnen zugleich, sonst läuft die
   Optik wieder auseinander.
