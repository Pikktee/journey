// Aus erkannter Bewegung wird ein Fortbewegungsmittel — pure Kotlin-Klasse ohne
// Android-Bezug, dadurch direkt unit-testbar (wie PunktFilter).
//
// Play Services meldet Übergänge zwischen Aktivitäten (zu Fuß, Rad, Fahrzeug).
// Diese Meldungen sind roh: An einer Ampel „steht" man, beim Umsteigen wechselt
// die Erkennung mehrfach in wenigen Sekunden. Ungefiltert entstünden dutzende
// Modus-Wechsel und damit dutzende Segmente im Upload-Manifest — die der Server
// unangetastet übernimmt, weil mehrere Segmente für ihn „jemand hat bewusst
// umgeschaltet" bedeuten. Aus einer Verbesserung würde so eine Verschlechterung.
//
// Deshalb wird nicht der Zustrom gefiltert (dazu bräuchte es Timer und einen
// Zustandsautomaten im Service), sondern das ERGEBNIS: Der Service schreibt
// jede Meldung mit, und beim Bau des Manifests fallen die zu kurzen Abschnitte
// wieder heraus. Dasselbe Prinzip nutzt der Server für seine Tempo-Automatik
// (`verschmelzeKurze` in pipeline/tempo.ts).
package app.maptale.aufzeichnung

import app.maptale.daten.Modus

/** Was die Erkennung unterscheiden kann — gröber als `Modus`. */
enum class Bewegungsart { ZU_FUSS, RAD, FAHRZEUG }

/** Ein Fortbewegungsmittel ab diesem Zeitpunkt (s seit Tour-Start). */
data class Modusabschnitt(val tOffsetS: Double, val modus: Modus)

object Bewegungsdeutung {

    /** Kürzere Abschnitte gehen im Vorgänger auf (s). */
    const val MIN_ABSCHNITT_S = 90.0

    /**
     * Fortbewegungsmittel zu einer erkannten Bewegungsart.
     *
     * Welches Fahrzeug es war, weiß kein Sensor. `JEEP` ist hier das generische
     * Kraftfahrzeug — der Server hebt Abschnitte, die einer Straßenbahntrasse
     * folgen, anschließend auf `TRAM` (pipeline/schienen.ts). Das darf er nur,
     * weil das Manifest diese Aufteilung als automatisch ermittelt ausweist.
     */
    fun modus(art: Bewegungsart): Modus = when (art) {
        Bewegungsart.ZU_FUSS -> Modus.WALK
        Bewegungsart.RAD -> Modus.BIKE
        Bewegungsart.FAHRZEUG -> Modus.JEEP
    }

    /**
     * Rohe Meldungen zu belastbaren Abschnitten glätten.
     *
     * Drei Regeln, in dieser Reihenfolge: gleiche Nachbarn verschmelzen, zu
     * kurze Abschnitte im Vorgänger aufgehen lassen, und der erste Abschnitt
     * beginnt immer bei 0 — sonst gälte für den Anfang der Tour gar nichts.
     *
     * `endeS` ist das Tour-Ende; ohne das ließe sich die Dauer des LETZTEN
     * Abschnitts nicht messen, und ein zufällig kurz vor Schluss erkannter
     * Sprint bliebe als eigener Abschnitt stehen.
     */
    fun glaette(
        abschnitte: List<Modusabschnitt>,
        endeS: Double,
        minAbschnittS: Double = MIN_ABSCHNITT_S,
    ): List<Modusabschnitt> {
        if (abschnitte.isEmpty()) return emptyList()
        var liste = abschnitte.sortedBy { it.tOffsetS }.let { sortiert ->
            // Der erste Abschnitt gilt ab Tour-Beginn
            listOf(sortiert.first().copy(tOffsetS = 0.0)) + sortiert.drop(1).filter { it.tOffsetS > 0.0 }
        }

        var geaendert = true
        while (geaendert && liste.size > 1) {
            geaendert = false
            liste = verschmelzeGleiche(liste)
            val index = liste.indices.firstOrNull { i ->
                val bis = liste.getOrNull(i + 1)?.tOffsetS ?: endeS
                bis - liste[i].tOffsetS < minAbschnittS
            }
            if (index != null) {
                // Der erste Abschnitt kann nicht im Vorgänger aufgehen — dann
                // erbt er den Modus seines Nachfolgers, dessen Beginn auf 0 rückt.
                liste = if (index == 0) {
                    listOf(liste.getOrNull(1)?.copy(tOffsetS = 0.0) ?: liste[0]) + liste.drop(2)
                } else {
                    liste.filterIndexed { i, _ -> i != index }
                }
                geaendert = true
            }
        }
        return verschmelzeGleiche(liste)
    }

    private fun verschmelzeGleiche(liste: List<Modusabschnitt>): List<Modusabschnitt> =
        liste.filterIndexed { i, a -> i == 0 || liste[i - 1].modus != a.modus }
}
