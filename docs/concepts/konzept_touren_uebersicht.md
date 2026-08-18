---
stand: 2026-08-19
status: Entwurf. Kachel, Löschen und Bildwähler abgenommen, Listenform offen
betrifft:
  - src/studio/studio.ts
  - studio.html
  - server/src/routes/tours.ts
systemteile:
  - Studio
---

# Meine Touren: Kachel, Liste, Löschen, Titelbild

Die Bibliothek ist die erste Seite nach dem Anmelden und die einzige, die jeder
Nutzer täglich sieht. Vier Dinge stehen dort zur Entscheidung, und sie hängen
aneinander: Was die Kachel zeigt, was die Liste zeigt, wie gelöscht wird und wo
das Titelbild gewählt wird.

Entwurf mit allen Varianten, bedienbar:
[studio-touren-uebersicht.html](../mockups/studio-touren-uebersicht.html).

## Warum überhaupt

Die Kachel kann heute **zwei Dinge weniger als die Zeile darunter**: Aus ihr
lässt sich weder löschen noch ein Video exportieren, aus der Zeile beides.
Dieselbe Tour, dieselbe Seite, zwei verschiedene Vorräte an Aktionen. Der
Video-Export zeigt, dass das kein einmaliger Ausrutscher ist: Er kam später dazu
und landete wieder nur in der Zeile, weil dort ein Knopf billiger ist als auf
einer Kachel, die schon voll aussieht. Dazu kommt das Titelbild: Das Feld
`edits.titelbild` gibt es und der Server respektiert es (`bestimmeCover`),
gesetzt wird es aber nur von der Android-App. Wer im Web aufnimmt, kann sein
Schaufenster nicht wählen.

Und beim Überfahren einer Kachel bewegen sich sechs Dinge gleichzeitig: die
Kachel selbst, der Signet-Kasten, die Signet-Linie, der Stift, die Play-Taste
und der Schleier. Auf einer Seite voller Kacheln ist das kein Detail.

## Was der Entwurf vorschlägt

| Stück | Vorschlag | Steht offen |
| --- | --- | --- |
| Kachel | `M2 · G2 · P1 · S2` mit der weichen Einblendung `F2`: ein ⋯ statt drei Zeichen, Signet steht still, Play bleibt (das einzige benannte Abspiel-Ziel für Tastatur und Screenreader), Sichtbarkeit und Filmdauer wandern in den Fuß | entschieden |
| Liste | `L3` nach Monaten als Hauptansicht, `L1` als Tabelle daneben | offen: eine oder beide? |
| Löschen | Dialog mit Namen und Folgen, hart, kein Papierkorb | entschieden |
| Titelbild | `V2`, kleiner Dialog mit Raster, **eine** Liste ohne Gruppen | entschieden |
| Video-Export | derselbe Menüpunkt öffnet das vorhandene Export-Blatt | entschieden, nur der Weg fehlt |


## Zwei Nachbesserungen aus der Abnahme

- **Das Signet zeichnet seine Linie nicht mehr nach.** `G2` hielt den Kasten fest,
  ließ die Route beim Zeigen aber aufblitzen; damit blieb oben links der letzte
  bewegte Rest. Eine Linie, die sich in einer Kachelreihe von selbst zeichnet,
  zieht den Blick genau dorthin, wo gerade nichts geschieht. Die Bestands-Kachel
  im Vergleich behält die Animation, sonst zeigt sie nicht mehr, was heute
  wirklich passiert.
- **„Link kopieren" ist kein Menüpunkt.** Der Link hängt an der Sichtbarkeit, also
  steht er dort, wo sie entschieden wird: im Chip unten links, zusammen mit den
  drei Stufen. Es gibt ihn nur, solange die Tour nicht privat ist, und bei
  „Privat" ist er im Entwurf sichtbar gesperrt statt verborgen. Als eigener
  Menüpunkt hätte er einen Zustand versprochen, den die Stufe darüber gerade
  widerruft. Aus demselben Grund verlässt er auch die Werkzeugspalte der Liste:
  Die hat für die Sichtbarkeit eine eigene Spalte.

## Auf dem Telefon reicht das ⋯ allein nicht

Zwei Dinge sind am Entwurf schon richtig: Das ⋯ steht dauerhaft und wartet nicht
auf einen Zeiger, den es dort nicht gibt, und der Sicht-Chip ebenso. Zwei fehlen:

- **Die Trefferflächen.** Gemessen sind das ⋯ 24 × 24 px und der Chip 21 px hoch;
  empfohlen sind 44 (Apple) bis 48 (Material). Beide wachsen deshalb im
  Anfassbaren, nicht im Sichtbaren: ein 44er Kreis um das ⋯, ein 44 px hohes Band
  über die Breite des Chips. Ein runder Bereich am Chip schiede aus, er träfe die
  Play-Taste.
- **Die Form des Menüs.** Als Popover verdeckt es 44 % der Kachel, auf die es sich
  bezieht, hat 33 px hohe Zeilen und keinen sichtbaren Rückweg. Als **Tafel von
  unten** hat es 48-px-Zeilen in Daumenreichweite, den Titel der Tour im Kopf,
  einen Griff, und die Kachel bleibt vollständig sichtbar: Man sieht, worüber man
  entscheidet.

Drei Regeln daneben: Der Tipp auf das ⋯ darf **nicht durchschlagen** (die ganze
Kachel spielt ab, sonst startet der Film hinter der Tafel), **Löschen steht
abgesetzt** (der Daumen trifft die unterste Zeile am leichtesten, dort darf nicht
das Gefährlichste liegen), und die Tafel braucht `env(safe-area-inset-bottom)`,
sonst liegt sie auf dem Strich zum Zurückwischen.

## Der Zeigen-Zustand: die Kachel bleibt stehen

Das Anheben um zwei Pixel ist nicht falsch, aber die schwächste von vier
Antworten: Es sagt „hier bin ich", indem es die Kachel aus der Reihe schiebt, und
im Raster stehen die Nachbarn danach sichtbar tiefer. Wer über eine Reihe fährt,
löst eine Welle aus. Vorschlag ist deshalb **Z2**: Rand und Schatten wie bisher,
kein Versatz.

Nicht gewählt wurden der Bildzoom (er setzt die Bewegung auf das Motiv, und die
Kachel ist zu 90 % Motiv, also der Rückweg zu der Unruhe, die mit dem Signet
gerade verschwunden ist) und die ganz nackte Fassung (ohne Rand und Schatten
unterscheidet sich die berührte Kachel nur noch auf dem Bild; beides zusammen ist
die Auskunft „das Ganze ist ein Knopf", und die kostet keine Bewegung). Auf Touch
ist die Frage gegenstandslos, dort gibt es nur den kurzen Druck.

## Nach Monaten ist die naheliegende Ansicht

Eine Tour ist ein **Ereignis mit Datum**. Wer eine bestimmte sucht, weiß fast nie
die Kilometerzahl und fast immer noch die Jahreszeit. Deshalb ist `L3` aus Runde 1
weitergefeilt worden, und zwar an den Stellen, die ein Entwurf gern auslässt:
Jahrestrenner, Monate ohne Touren als eine Zeile statt als fehlende Köpfe, die
Tour, die gerade entsteht, im laufenden Monat, und der Wochentag unter dem Datum.
Die Dichte ist entschieden (`D2`, Miniatur 68 × 43): Bei der größten Stufe zeigt
die Ansicht dasselbe Bild kleiner als die Kachelansicht und widerlegt sich selbst.

**Der Preis gehört dazu:** Nach Monaten gruppiert ist die Sortierung faktisch auf
„nach Datum" festgelegt, denn nach Strecke sortierte Monatsgruppen ergeben keinen
Sinn. Vergleichen und Aufräumen bleibt damit die Aufgabe von `L1`. Offen ist
also nicht „L3 oder L1", sondern ob L3 die Hauptansicht wird und L1 die Nebenform.

Eine **Mini-Karte je Monat** ist bewusst nicht Teil des Vorschlags: Sie müsste je
Gruppe aus mehreren Spuren zusammengesetzt und beim Scrollen gezeichnet werden.
Das ist eine eigene Entscheidung mit eigenen Kosten.

## Löschen bleibt hart

Entschieden: **Dialog mit Namen, dann weg.** Der Dialog zeigt, WAS verschwindet
(Titelbild, Titel, Zahl der Aufnahmen, Speicherplatz) und nennt bei öffentlichen
Touren den toten Link. Ein Papierkorb wäre kein Oberflächen-Entwurf, sondern ein
Feld `geloescht_am`, ein Aufräumlauf und eine zweite Antwort auf jede Frage nach
belegtem Speicher; solange es ihn nicht gibt, ist ein „Rückgängig"-Toast eine
Zusage, die der Server nicht halten kann.

## Der Bildwähler zeigt eine Liste

Keine Trennung zwischen „im Film platziert" und „ohne Ort". Die Gruppierung hätte
den Dialog nach dem FILM sortiert, obwohl darin das SCHAUFENSTER gewählt wird, und
in einer Tour ohne platzierte Aufnahmen bestünde er aus einer leeren und einer
vollen Abteilung. Das Zeichen an der einzelnen Kachel bleibt: Es sagt etwas über
das Bild, ohne eine Wand zu ziehen.

## Die harten Randbedingungen

- **`DELETE /api/tours/:id` löscht hart**, samt Fotos und Videos
  ([server/src/routes/tours.ts](../../server/src/routes/tours.ts)). Es gibt keinen
  Papierkorb, also ist ein „Rückgängig" nach dem Löschen eine Zusage, die der
  Server nicht halten kann. Wer ihn will, braucht zuerst ein `geloescht_am` und
  einen Aufräumlauf, und das ist eine Server-Entscheidung.
- **Die Filmdauer liegt schon in der Listen-Antwort** (`stats.filmS`, zusammen mit
  `spur` und `finale`): Der Video-Export hat sie dorthin gebracht, die Kachel
  zeigt sie nur nicht. Sie ist optional: Touren, die seither nicht neu gerendert
  wurden, tragen sie nicht, und der Kachelfuß muss ohne sie auskommen.
- **Das Export-Blatt existiert** (`oeffneExportBlatt`, aus Bibliothek und Editor
  aufgerufen). Aus der Kachel heraus fehlt nur der Aufruf, nichts sonst.
- **Der Bildwähler braucht keinen neuen Endpunkt**: `api.tour(id)` liefert das
  Tour-JSON samt `media[].thumb`. Die Wahl muss `cover`/`cover_thumb` direkt
  mitschreiben (Muster `bildnachtrag.ts`), denn ein Re-Render für eine Bildwahl
  wäre absurd.
- **Der Wähler bleibt ein Menüpunkt, solange er nichts am Bild verändert.** Kommt
  ein Wunsch nach Zuschnitt, Fokuspunkt oder Helligkeit, erzeugt er eine neue
  Bildfassung mit eigener Datei und eigener Quota. Dann gehört er in den Editor.

## Die Linie zwischen Menü und Editor

Das ⋯-Menü verwaltet die Tour **als Eintrag**: Name, Sichtbarkeit, Link,
Titelbild, Löschen. Der Editor bearbeitet den **Film**: Schnitt, Kamera, Wetter,
Musik, Modi. Das Titelbild kommt im Film nicht vor, es ist das Schaufenster
(Kachel, Galerie, Profil, Vorschaukarte geteilter Links).

## Frühere Runden

Die drei Sitzungen vom 13. August liegen im Archiv, verlinkt aus dem Kopf des
Mockups: [Kacheln A–C, Listen, Löschen](../archive/mockups/studio-touren-karten.html),
[die vier Fragen an die Kachel](../archive/mockups/studio-kachel-ruhe.html),
[der Bildwähler](../archive/mockups/studio-titelbild-waehler.html).
