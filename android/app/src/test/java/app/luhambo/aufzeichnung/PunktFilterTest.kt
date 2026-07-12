// PunktFilter: die Speicher-Regeln der Aufzeichnung (Plan M3) — pure Logik,
// deshalb hier ohne Robolectric testbar.
package app.luhambo.aufzeichnung

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PunktFilterTest {

    private val start = RohPunkt(lng = 8.0, lat = 46.59, ele = 500.0, tOffsetS = 0.0, genauigkeitM = 5f)

    /** Punkt `meter` östlich des Starts (auf Breitengrad 46,59). */
    private fun oestlich(meter: Double, tS: Double, genauigkeit: Float = 5f) = RohPunkt(
        lng = 8.0 + meter / (111_320.0 * Math.cos(Math.toRadians(46.59))),
        lat = 46.59,
        ele = 500.0,
        tOffsetS = tS,
        genauigkeitM = genauigkeit,
    )

    @Test
    fun `verwirft ungenaue Punkte`() {
        val filter = PunktFilter()
        assertFalse(filter.pruefe(start.copy(genauigkeitM = 31f)))
        assertTrue(filter.pruefe(start))
    }

    @Test
    fun `speichert ab 5 Metern Distanz`() {
        val filter = PunktFilter()
        filter.pruefe(start)
        assertFalse(filter.pruefe(oestlich(3.0, 2.0)))
        assertTrue(filter.pruefe(oestlich(6.0, 4.0)))
    }

    @Test
    fun `speichert im Stand alle 30 Sekunden`() {
        val filter = PunktFilter()
        filter.pruefe(start)
        // gleiche Stelle, nur Zeit vergeht
        assertFalse(filter.pruefe(start.copy(tOffsetS = 10.0)))
        assertFalse(filter.pruefe(start.copy(tOffsetS = 29.0)))
        assertTrue(filter.pruefe(start.copy(tOffsetS = 31.0)))
    }

    @Test
    fun `speichert enge Kurven trotz kleiner Distanz`() {
        val filter = PunktFilter()
        filter.pruefe(start)
        assertTrue(filter.pruefe(oestlich(6.0, 2.0))) // Kurs: Ost
        // 90°-Wende nach Norden, nur 3 m — Kurswechsel-Regel greift
        val letzte = oestlich(6.0, 2.0)
        val nachNorden = letzte.copy(lat = letzte.lat + 3.0 / 111_320.0, tOffsetS = 4.0)
        assertTrue(filter.pruefe(nachNorden))
    }

    @Test
    fun `verwirft rueckwaerts laufende Zeit`() {
        val filter = PunktFilter()
        filter.pruefe(start)
        assertFalse(filter.pruefe(oestlich(50.0, tS = -1.0)))
    }

    @Test
    fun `summiert die Distanz der akzeptierten Punkte`() {
        val filter = PunktFilter()
        filter.pruefe(start)
        filter.pruefe(oestlich(10.0, 2.0))
        filter.pruefe(oestlich(20.0, 4.0))
        assertEquals(20.0, filter.distanzM, 0.5)
    }

    @Test
    fun `kursGrad und winkelDifferenz rechnen korrekt`() {
        val ost = PunktFilter.kursGrad(8.0, 46.59, 8.001, 46.59)
        assertEquals(90.0, ost, 1.0)
        assertEquals(20.0, PunktFilter.winkelDifferenzGrad(350.0, 10.0), 1e-9)
    }
}
