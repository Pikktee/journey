// GPS-Punktfilter der Aufzeichnung — pure Kotlin-Klasse ohne Android-Bezug,
// dadurch direkt unit-testbar (Plan M3: Kernlogik raus aus dem Service).
//
// Regeln: Genauigkeit schlechter 30 m → verwerfen; gespeichert wird bei
// ≥ 3 m Distanz, > 15° Kurswechsel oder ≥ 30 s seit dem letzten Speichern —
// so bleibt die Punktdichte klein, ohne Kurven oder Pausen zu verlieren
// (die 30-s-Punkte im Stand braucht die Pausen-Erkennung des Backends).
//
// Die Mindestdistanz lag ursprünglich bei 5 m, und das war für Fußwege zu grob:
// Der Standort kommt im 2-Sekunden-Takt, beim Gehen (~1,4 m/s) also alle 2,8 m —
// jeder zweite Punkt fiel unter die Schwelle, und aus einem Spaziergang wurde
// ein Streckenzug mit langen Sehnen.
//
// Einfach tiefer setzen ging aber nicht: Die 5 m schützten die Distanzmessung.
// Im Stand wandert die gemeldete Position um mehrere Meter, und eine niedrige
// Schwelle hätte dieses Rauschen als zurückgelegten Weg gezählt — zehn Minuten
// Rast wären als halber Kilometer in der Telemetrie gelandet. Deshalb entscheidet
// jetzt das vom Empfänger gemessene TEMPO, welche Regel gilt: In Bewegung
// genügen 2,5 m, im Stand greift nur noch der 30-Sekunden-Takt, und die Distanz
// wächst dort gar nicht.
//
// Das kostet keinen Akku: Der Empfänger läuft ohnehin durchgehend mit derselben
// Rate, der Filter entscheidet nur, was davon in die Datenbank wandert. Teurer
// wird allein die Datenmenge — rund 40 Byte je Punkt, für eine Tagestour also
// wenige hundert Kilobyte.
package app.luhambo.aufzeichnung

import kotlin.math.asin
import kotlin.math.atan2
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

data class RohPunkt(
    val lng: Double,
    val lat: Double,
    val ele: Double,
    /** Sekunden seit Tour-Start */
    val tOffsetS: Double,
    val genauigkeitM: Float,
    /**
     * Vom Empfänger gemessenes Tempo (m/s); null, wenn er keins liefert.
     *
     * Verlässlicher als die Distanz zwischen zwei Meldungen: Im Stand bleibt es
     * nahe null, während die Position weiter umherspringt.
     */
    val tempoMps: Float? = null,
)

class PunktFilter(
    private val maxGenauigkeitM: Float = 30f,
    private val minDistanzM: Double = 2.5,
    private val minKurswechselGrad: Double = 15.0,
    private val maxAbstandS: Double = 30.0,
    /** Darunter gilt: Der Punkt steht, was sich bewegt, ist das Rauschen. */
    private val stillstandMps: Float = 0.5f,
) {
    private var letzter: RohPunkt? = null
    private var vorletzter: RohPunkt? = null

    /** Kumulierte Distanz der AKZEPTIERTEN Punkte (m) — speist die Telemetrie. */
    var distanzM: Double = 0.0
        private set

    /**
     * Entscheidet, ob der Punkt gespeichert wird; akzeptierte Punkte werden
     * interner Referenzzustand (Kurs/Distanz beziehen sich immer darauf).
     */
    fun pruefe(punkt: RohPunkt): Boolean {
        if (punkt.genauigkeitM > maxGenauigkeitM) return false
        val letzterPunkt = letzter ?: return akzeptiere(punkt)

        // Zeit läuft rückwärts (Batch-Nachzügler) → verwerfen
        if (punkt.tOffsetS <= letzterPunkt.tOffsetS) return false

        val distanz = distanzM(letzterPunkt.lng, letzterPunkt.lat, punkt.lng, punkt.lat)
        val zeit = punkt.tOffsetS - letzterPunkt.tOffsetS
        val kursAlt = vorletzter?.let { kursGrad(it.lng, it.lat, letzterPunkt.lng, letzterPunkt.lat) }
        val kursNeu = kursGrad(letzterPunkt.lng, letzterPunkt.lat, punkt.lng, punkt.lat)
        val kurswechsel = kursAlt?.let { winkelDifferenzGrad(it, kursNeu) } ?: 0.0

        // Ohne Tempo-Angabe (GPX-Import, ältere Geräte) wie bisher entscheiden:
        // Dann ist die Distanz das einzige Maß, das zur Verfügung steht.
        val bewegt = punkt.tempoMps?.let { it >= stillstandMps } ?: true

        // Kurswechsel zählt nur mit Mindestbewegung — GPS-Jitter im Stand dreht
        // den Kurs beliebig, würde also ohne diese Schwelle dauernd speichern.
        val speichern = if (bewegt) {
            distanz >= minDistanzM ||
                (kurswechsel > minKurswechselGrad && distanz >= minDistanzM * 0.4) ||
                zeit >= maxAbstandS
        } else {
            // Im Stand nur der Takt für die Pausen-Erkennung des Backends
            zeit >= maxAbstandS
        }
        if (!speichern) return false

        // Im Stand zurückgelegte „Strecke" ist Rauschen und darf die Telemetrie
        // nicht aufblähen.
        if (bewegt) distanzM += distanz
        return akzeptiere(punkt)
    }

    private fun akzeptiere(punkt: RohPunkt): Boolean {
        vorletzter = letzter
        letzter = punkt
        return true
    }

    companion object {
        private const val ERDRADIUS_M = 6_371_000.0

        /** Haversine-Distanz in Metern. */
        fun distanzM(lng1: Double, lat1: Double, lng2: Double, lat2: Double): Double {
            val dLat = Math.toRadians(lat2 - lat1)
            val dLng = Math.toRadians(lng2 - lng1)
            val h = sin(dLat / 2) * sin(dLat / 2) +
                cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLng / 2) * sin(dLng / 2)
            return 2 * ERDRADIUS_M * asin(sqrt(h))
        }

        /** Kurs (0–360°) von Punkt 1 nach Punkt 2. */
        fun kursGrad(lng1: Double, lat1: Double, lng2: Double, lat2: Double): Double {
            val dLng = Math.toRadians(lng2 - lng1)
            val lat1R = Math.toRadians(lat1)
            val lat2R = Math.toRadians(lat2)
            val y = sin(dLng) * cos(lat2R)
            val x = cos(lat1R) * sin(lat2R) - sin(lat1R) * cos(lat2R) * cos(dLng)
            return (Math.toDegrees(atan2(y, x)) + 360.0) % 360.0
        }

        /** Kleinste Winkeldifferenz zweier Kurse (0–180°). */
        fun winkelDifferenzGrad(a: Double, b: Double): Double {
            val d = abs(a - b) % 360.0
            return if (d > 180.0) 360.0 - d else d
        }
    }
}
