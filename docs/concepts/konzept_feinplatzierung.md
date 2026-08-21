---
stand: 2026-08-21
status: Entwurf, nichts gebaut
betrifft:
  - src/studio/editor.ts
  - src/studio/audio-clip.ts
  - src/studio/edit-model.ts
  - server/src/schema/edits.ts
systemteile: [Studio]
icon: regler
---

# Konzept: Feinplatzierung

**Ziel:** Klips framegenau setzen und ihre Länge fein bestimmen, damit man auf den
Takt der Musik schneiden kann.

Dieses Blatt ist E6 aus dem [Gleichlauf-Konzept](../archive/konzept_gleichlauf_player_editor.md).
Der Plan dort ist abgearbeitet, dieser Teil war nie gebaut; er steht seither
allein und wurde beim Archivieren herausgelöst, damit er nicht mit ins Archiv fällt.

## Die Entscheidung dahinter

**Kein sichtbares Taktraster**, keine Taktlinien, keine BPM-Erkennung, kein Einrasten auf den
Schlag. Gebraucht wird Schlichteres. Wer den Takt treffen will, hört ihn und stellt den Wert
ein; das Werkzeug muss nur die Auflösung hergeben. Als Einheit bietet sich **1/24 s** an, die
Engine kennt sie bereits (`nudge` versteht ein Einzelbild genau so).

## Heute geht das aus drei Gründen nicht

1. **Die Zeitfelder des Ton-Inspectors zeigen `HH:MM`.** `clockTimeShort` formatiert mit
   `hour: '2-digit', minute: '2-digit'`, also **Minutenauflösung**, und als Uhrzeit statt als
   Filmzeit. Gebraucht: Filmzeit mit Nachkommastellen, dazu die **Länge als eigenes Feld**
   (heute steht dort nur „Endet um").
2. **Es gibt kein Nudging.** Die Pfeiltasten bewegen den Abspielkopf (5 Filmsekunden) bzw. die
   Einfügemarke (60 s), nie einen ausgewählten Klip. Gebraucht: Pfeil = 1 Frame,
   ⇧Pfeil = 1 s, auf dem fokussierten Objekt.
3. **Foto-Einblendungen sind gar nicht framegenau setzbar.** Ein Ton-Klip hat `offsetFilmS`
   (Fließkomma). Ein Medium hat nur seinen **sekundengenauen Aufnahme-Anker**: Verschieben
   heißt „auf die nächste Aufnahmesekunde", je nach Reisegeschwindigkeit 0,01 bis 0,1
   Filmsekunden. Das ist ungefähr Frame-Größenordnung, aber nicht steuerbar. Abhilfe ist
   dieselbe wie beim Ton: ein additives `offsetFilmS` auch für `edits.media`.

## Zwei Kleinigkeiten, die man beim Bauen kippt

Das **Rasten muss sich aushebeln lassen** (Modifier), sonst zieht es die eben gesetzte
Feinlage weg. Und der **Zoom muss die Auflösung hergeben**, sonst ist ein Frame schmaler als
ein Pixel.
