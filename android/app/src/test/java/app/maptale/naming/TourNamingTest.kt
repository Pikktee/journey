// Titel-Logik der Auto-Benennung (pure Anteile + Geocoder-Fake).
package app.maptale.naming

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TourNamingTest {

    @Test
    fun `Start nach Ziel`() {
        assertEquals("Wengen → Grindelwald", TourNaming.baueTitel("Wengen", "Grindelwald", runde = false))
    }

    @Test
    fun `gleicher Ort wird zur Runde`() {
        assertEquals("Runde bei Wengen", TourNaming.baueTitel("Wengen", "Wengen", runde = false))
        assertEquals("Runde bei Wengen", TourNaming.baueTitel("Wengen", "Grindelwald", runde = true))
    }

    @Test
    fun `einseitige und fehlende Ortsnamen`() {
        assertEquals("Wengen", TourNaming.baueTitel("Wengen", null, runde = false))
        assertEquals("Grindelwald", TourNaming.baueTitel(null, "Grindelwald", runde = false))
        assertNull(TourNaming.baueTitel(null, null, runde = false))
    }

    @Test
    fun `istRunde misst die Luftlinie`() {
        val start = 7.92 to 46.605
        assertTrue(TourNaming.istRunde(start, 7.9201 to 46.6051)) // ~15 m
        assertFalse(TourNaming.istRunde(start, 7.99 to 46.60)) // >5 km
    }

    @Test
    fun `fallbackTitle nutzt das deutsche Datum`() {
        // 2026-07-04T08:00:00Z → 10:00 in Europe/Zurich
        assertEquals("Tour vom 4. Juli 2026", TourNaming.fallbackTitle(1_783_152_000_000, "Europe/Zurich"))
    }

    @Test
    fun `buildTitle zieht Namen aus dem Geocoder`() = runTest {
        val naming = TourNaming { lat, _ -> if (lat < 46.6) "Wengen" else "Grindelwald" }
        assertEquals("Wengen → Grindelwald", naming.buildTitle(7.92 to 46.59, 8.03 to 46.62))
    }
}
