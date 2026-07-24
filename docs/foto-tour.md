# Tour nur aus Fotos — ohne GPX

Stand 2026-07-22, geplant, noch nicht gebaut. Ziel: Wer nur Fotos hat (Handy in der
Hosentasche, keine Aufzeichnung gestartet), soll trotzdem eine Kamerafahrt bekommen.

## Warum das kleiner ist, als es klingt

Die Engine braucht kein GPX — sie braucht **Wegpunkte**. Die statischen Touren in
[src/tours.js](../src/tours.js) haben genau das: `segments[].pts`, kein Track, keine
Zeitreihe. `buildRoute()` in [src/geo.js](../src/geo.js) glättet die Punkte per
Catmull-Rom und resampled sie auf ~14-m-Schritte; die Höhen holt
[src/elevation.js](../src/elevation.js) danach ohnehin aus dem DEM und **überschreibt**
`coords[i][2]`.

Und die zweite Hälfte liegt auch schon da: Der Studio-EXIF-Leser
([src/studio/exif.ts](../src/studio/exif.ts)) liest neben der Aufnahmezeit bereits
`gps: [lng, lat]` aus dem GPS-IFD.

**Am Server ist deshalb nichts zu ändern.** Das Upload-Schema erlaubt als Track-Quelle
`oneOf: [segments, trackFile]` — `segments` ist der Weg. Das Studio baut die Segmente
aus den Fotos, der Rest der Pipeline (Benennung, Wetter, Medien-Platzierung, Edit-Overlay)
läuft unverändert.

## Ablauf

1. Fotos ohne GPX-Datei erkannt → Foto-Modus statt Fehlermeldung.
2. Fotos mit GPS nach `takenAt` sortieren; jedes wird ein Wegpunkt
   `[lng, lat, 0, tOffset]` (`tOffset` = Sekunden seit dem ersten Foto, Höhe 0 —
   das DEM korrigiert sie beim Abspielen).
3. Unter zwei verorteten Fotos: keine Fahrt möglich. Dann ehrlich sagen, was fehlt,
   und anbieten, die Orte im Editor auf die Karte zu setzen.
4. `time.start/end` aus dem ersten und letzten Foto.
5. Manifest wie gehabt hochladen — mit `segments` statt `trackFile`.

## Was dabei anders ist als bei einer echten Aufzeichnung

**Die Strecke ist geraten** — und genau deshalb wird sie nicht als Fahrt inszeniert.
Statt einer Route, die eine Straße behauptet, die es nie gab, **fliegt die Kamera auf
direktem Weg von Foto zu Foto**. Das ist keine Notlösung, sondern die ehrlichere
Darstellung: Ein sichtbarer Flug über die Landschaft behauptet keinen Weg, er verbindet
Orte. Konkret heißt das für den Player:

- Bodenlinie gestrichelt statt durchgezogen (die durchgezogene Linie ist die
  aufgezeichnete Spur — dieser Unterschied sollte etwas bedeuten).
- Höher und ruhiger fliegen als bei einer Fahrt: kein Fahrzeug-Icon, kein Motorsound,
  keine Modus-Skalierung — zwischen den Fotos gibt es nichts zu simulieren.
- Tempo aus den Foto-Zeitstempeln: Wo eine Stunde zwischen zwei Bildern liegt, wird
  der Flug länger; wo zwei Minuten liegen, kurz.

Damit erübrigt sich der Warnhinweis — die Darstellung sagt es selbst. Eine leise
Kennzeichnung an der Tour („aus Fotos") bleibt trotzdem sinnvoll, damit man später
weiß, warum diese Tour anders aussieht.

**Die Modus-Automatik greift hier nicht.** [tempo.ts](../server/src/pipeline/tempo.ts)
rechnet aus dem Punktabstand ein Tempo — bei Luftlinien zwischen weit entfernten Fotos
kommt Unsinn heraus. Für Foto-Touren gilt deshalb die Ausnahme: **hier** wird die
Fortbewegung gefragt, weil es keine Daten gibt, aus denen man sie lesen könnte. Technisch:
`trackMode` mitschicken und die Tempo-Trennung für diese Touren überspringen.

**Fotos ohne GPS** (Kameras ohne Empfänger, gestrippte EXIF) tragen nichts zur Strecke
bei. Sie sollen trotzdem mitkommen und über die Zeit platziert werden — den Weg dafür
gibt es schon (`anchor` ist optional, dann greift die Zeit-Platzierung).

## Ausbaustufe 2: echte Wege statt Luftlinien

Zwischen den Foto-Punkten routen (OSRM/BRouter) — so ist die Koh-Pha-ngan-Tour entstanden,
und der Unterschied ist groß: aus einer Diagonale über den Berg wird die Straße, die es
dort wirklich gibt. Braucht einen externen Dienst im Anreicherungs-Pfad (Cache beachten,
s. `anreicherung.json`) und ist deshalb bewusst ein zweiter Schritt.

## Aufwand

Stufe 1 liegt im Studio: Manifest aus Fotos bauen (neue Funktion neben
`baueUploadManifest` in [src/studio/upload.ts](../src/studio/upload.ts)), der
Upload-Fluss ohne GPX, die Kennzeichnung, Tests für die Punktbildung (Sortierung,
Fotos ohne GPS, weniger als zwei Punkte). Server unverändert.
