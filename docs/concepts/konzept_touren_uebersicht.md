---
stand: 2026-08-18
status: Entwurf, nichts gebaut
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
| Liste | `L1`, Tabelle mit sortierenden Spaltenköpfen und ausgerichteten Zahlen | ja |
| Löschen | Dialog mit Namen und Folgen, kein Rückgängig-Toast | ja |
| Titelbild | `V2`, kleiner Dialog mit Raster, aus dem ⋯-Menü heraus | ja |
| Video-Export | derselbe Menüpunkt öffnet das vorhandene Export-Blatt | entschieden, nur der Weg fehlt |

## Die harten Randbedingungen

- **`DELETE /api/tours/:id` löscht hart**, samt Fotos und Videos
  ([server/src/routes/tours.ts](../../server/src/routes/tours.ts)). Es gibt keinen
  Papierkorb, also ist ein „Rückgängig" nach dem Löschen eine Zusage, die der
  Server nicht halten kann. Wer ihn will, braucht zuerst ein `geloescht_am` und
  einen Aufräumlauf, und das ist eine Server-Entscheidung.
- **Die Filmdauer liegt schon in der Listen-Antwort** (`stats.filmS`, zusammen mit
  `spur` und `finale`) — der Video-Export hat sie dorthin gebracht, die Kachel
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
