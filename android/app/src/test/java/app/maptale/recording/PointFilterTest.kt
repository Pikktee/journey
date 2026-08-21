// PunktFilter: die Speicher-Regeln der Aufzeichnung (Plan M3) — pure Logik,
// deshalb hier ohne Robolectric testbar.
package app.maptale.recording

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PointFilterTest {

    private val start = RawPoint(lng = 8.0, lat = 46.59, ele = 500.0, tOffsetS = 0.0, accuracyM = 5f)

    /** Punkt `meter` östlich des Starts (auf Breitengrad 46,59). */
    private fun oestlich(meter: Double, tS: Double, genauigkeit: Float = 5f) = RawPoint(
        lng = 8.0 + meter / (111_320.0 * Math.cos(Math.toRadians(46.59))),
        lat = 46.59,
        ele = 500.0,
        tOffsetS = tS,
        accuracyM = genauigkeit,
    )

    @Test
    fun `verwirft ungenaue Punkte`() {
        val filter = PointFilter()
        assertFalse(filter.check(start.copy(accuracyM = 31f)))
        assertTrue(filter.check(start))
    }

    @Test
    fun `speichert ab 2,5 Metern Distanz`() {
        // Die Schwelle liegt unter dem, was ein Fußgänger zwischen zwei
        // Standort-Meldungen zurücklegt (~2,8 m) — sonst fiele jeder zweite
        // Punkt eines Spaziergangs heraus.
        val filter = PointFilter()
        filter.check(start)
        assertFalse(filter.check(oestlich(2.0, 2.0)))
        assertTrue(filter.check(oestlich(3.0, 4.0)))
    }

    @Test
    fun `speichert im Stand alle 30 Sekunden`() {
        val filter = PointFilter()
        filter.check(start)
        // gleiche Stelle, nur Zeit vergeht
        assertFalse(filter.check(start.copy(tOffsetS = 10.0)))
        assertFalse(filter.check(start.copy(tOffsetS = 29.0)))
        assertTrue(filter.check(start.copy(tOffsetS = 31.0)))
    }

    @Test
    fun `speichert enge Kurven trotz kleiner Distanz`() {
        val filter = PointFilter()
        filter.check(start)
        assertTrue(filter.check(oestlich(6.0, 2.0))) // Kurs: Ost
        // 90°-Wende nach Norden, nur 3 m — Kurswechsel-Regel greift
        val letzte = oestlich(6.0, 2.0)
        val nachNorden = letzte.copy(lat = letzte.lat + 3.0 / 111_320.0, tOffsetS = 4.0)
        assertTrue(filter.check(nachNorden))
    }

    @Test
    fun `verwirft rueckwaerts laufende Zeit`() {
        val filter = PointFilter()
        filter.check(start)
        assertFalse(filter.check(oestlich(50.0, tS = -1.0)))
    }

    @Test
    fun `summiert die Distanz der akzeptierten Punkte`() {
        val filter = PointFilter()
        filter.check(start)
        filter.check(oestlich(10.0, 2.0))
        filter.check(oestlich(20.0, 4.0))
        assertEquals(20.0, filter.distanceM, 0.5)
    }

    @Test
    fun `kursGrad und winkelDifferenz rechnen korrekt`() {
        val ost = PointFilter.kursGrad(8.0, 46.59, 8.001, 46.59)
        assertEquals(90.0, ost, 1.0)
        assertEquals(20.0, PointFilter.winkelDifferenzGrad(350.0, 10.0), 1e-9)
    }
    @Test
    fun `nimmt jeden Takt eines Fussmarschs`() {
        // Der Standort kommt alle 2 s; beim Gehen (~1,4 m/s) sind das 2,8 m.
        // Mit der früheren 5-m-Schwelle fiel jeder zweite Punkt heraus und der
        // Weg wurde zum Streckenzug mit langen Sehnen.
        val filter = PointFilter()
        var lat = 50.11
        var akzeptiert = 0
        for (i in 0 until 20) {
            if (filter.check(RawPoint(8.68, lat, 100.0, i * 2.0, 8f, speedMps = 1.4f))) akzeptiert++
            lat += 2.8 / 111_320.0 // 2,8 m nach Norden
        }
        assertEquals(20, akzeptiert)
    }

    @Test
    fun `zaehlt Positionsrauschen im Stand nicht als Strecke`() {
        // Zehn Minuten Rast: Die gemeldete Position springt um ±3 m, das Tempo
        // bleibt bei null. Ohne die Tempo-Prüfung wären daraus mehrere hundert
        // Meter Wegstrecke in der Telemetrie geworden.
        val filter = PointFilter()
        var akzeptiert = 0
        for (i in 0 until 300) {
            val versatz = if (i % 2 == 0) 3.0 else -3.0
            val punkt = RawPoint(8.68, 50.11 + versatz / 111_320.0, 100.0, i * 2.0, 8f, speedMps = 0.1f)
            if (filter.check(punkt)) akzeptiert++
        }
        assertEquals(0.0, filter.distanceM, 0.001)
        // Der 30-Sekunden-Takt läuft weiter — das Backend braucht ihn, um die
        // Pause überhaupt zu erkennen.
        assertTrue(akzeptiert in 15..25)
    }

}
