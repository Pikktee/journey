// GPS-Punktfilter der Aufzeichnung — pure Kotlin-Klasse ohne Android-Bezug,
// dadurch direkt unit-testbar (Plan M3: Kernlogik raus aus dem Service).
//
// Regeln (Plan): Genauigkeit schlechter 30 m → verwerfen; gespeichert wird bei
// ≥ 5 m Distanz, > 15° Kurswechsel oder ≥ 30 s seit dem letzten Speichern —
// so bleibt die Punktdichte klein, ohne Kurven oder Pausen zu verlieren
// (die 30-s-Punkte im Stand braucht die Pausen-Erkennung des Backends).
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
)

class PunktFilter(
    private val maxGenauigkeitM: Float = 30f,
    private val minDistanzM: Double = 5.0,
    private val minKurswechselGrad: Double = 15.0,
    private val maxAbstandS: Double = 30.0,
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

        // Kurswechsel zählt nur mit Mindestbewegung — GPS-Jitter im Stand dreht
        // den Kurs beliebig, würde also ohne die 2-m-Schwelle dauernd speichern.
        val speichern = distanz >= minDistanzM ||
            (kurswechsel > minKurswechselGrad && distanz >= minDistanzM * 0.4) ||
            zeit >= maxAbstandS
        if (!speichern) return false

        distanzM += distanz
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
