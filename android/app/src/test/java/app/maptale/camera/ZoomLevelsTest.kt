// Zoom-Stufen: reine Rechnung, deshalb ohne Robolectric.
package app.maptale.camera

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ZoomLevelsTest {

    @Test
    fun `Geraet mit Ultraweitwinkel und Tele bekommt drei Stufen`() {
        val stufen = zoomLevels(minRatio = 0.6f, maxRatio = 10f)
        assertEquals(listOf("0,6×", "1×", "2×"), stufen.map { it.beschriftung })
        assertEquals(0.6f, stufen.first().ratio, 1e-6f)
    }

    @Test
    fun `Einfaches Objektiv bekommt nur die Normalstufe`() {
        // Kein Ultraweitwinkel (min = 1) und kein nennenswerter Zoom (max < 2)
        assertEquals(listOf("1×"), zoomLevels(minRatio = 1f, maxRatio = 1.5f).map { it.beschriftung })
    }

    @Test
    fun `Ohne Ultraweitwinkel, aber mit Tele`() {
        assertEquals(listOf("1×", "2×"), zoomLevels(minRatio = 1f, maxRatio = 5f).map { it.beschriftung })
    }

    @Test
    fun `Aktive Stufe nur nahe an einer Stufe, sonst freier Wert`() {
        val stufen = zoomLevels(0.6f, 10f)
        assertEquals(0, activeLevel(stufen, 0.6f))
        assertEquals(1, activeLevel(stufen, 1.02f)) // innerhalb der Toleranz
        assertEquals(2, activeLevel(stufen, 2f))
        assertNull(activeLevel(stufen, 1.7f)) // beim Kneifen zwischen den Stufen
    }

    @Test
    fun `Beschriftung rundet und nutzt das deutsche Komma`() {
        assertEquals("1×", formatZoom(1f))
        assertEquals("0,6×", formatZoom(0.6f))
        assertEquals("1,7×", formatZoom(1.66f))
        assertEquals("3×", formatZoom(2.98f))
    }
}
