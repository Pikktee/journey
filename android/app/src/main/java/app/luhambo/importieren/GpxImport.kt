// GPX-Import (M8): das eigentliche Parsen (Trackpunkte, Modus-Heuristik,
// Platzierung) macht der Server — die App braucht nur die Zeitspanne der
// Aufzeichnung, weil das Upload-Manifest `time` verlangt. Bewusst eine schmale,
// regexbasierte Extraktion der Zeitstempel (kein zweiter GPX-Parser), pur und
// unit-getestet.
package app.luhambo.importieren

import app.luhambo.upload.Zeitspanne
import java.time.Instant

object GpxImport {

    // <time>2026-07-04T08:12:31Z</time> — der ISO-Zeitstempel je Trackpunkt.
    private val zeitMuster = Regex("<time>\\s*([^<]+?)\\s*</time>", RegexOption.IGNORE_CASE)

    /**
     * Zeitspanne (erster/letzter Zeitstempel) aus dem GPX. null, wenn der Export
     * keine verwertbaren Zeiten enthält (dann ist kein Auto-Wetter/keine
     * nichtlineare Zeit möglich — der Aufrufer meldet das dem Nutzer).
     */
    fun zeitspanne(gpx: String): Zeitspanne? {
        val zeiten = zeitMuster.findAll(gpx)
            .mapNotNull { runCatching { Instant.parse(it.groupValues[1].trim()).toEpochMilli() }.getOrNull() }
            .toList()
        if (zeiten.isEmpty()) return null
        val start = zeiten.min()
        val ende = zeiten.max()
        // Gleicher Start/Ende (nur ein Zeitstempel) → 1 s Spanne, damit
        // start < end (Server-Invariante) gewahrt bleibt.
        return Zeitspanne(start, if (ende > start) ende else start + 1000)
    }

    /** Enthält das GPX überhaupt Trackpunkte? (Vorabprüfung vor dem Upload.) */
    fun hatTrackpunkte(gpx: String): Boolean =
        Regex("<trkpt\\b", RegexOption.IGNORE_CASE).containsMatchIn(gpx)
}
