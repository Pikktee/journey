// Titel-Logik der Auto-Benennung (pure Anteile + Geocoder-Fake).
package app.luhambo.benennung

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TourBenennungTest {

    @Test
    fun `Start nach Ziel`() {
        assertEquals("Wengen → Grindelwald", TourBenennung.baueTitel("Wengen", "Grindelwald", runde = false))
    }

    @Test
    fun `gleicher Ort wird zur Runde`() {
        assertEquals("Runde bei Wengen", TourBenennung.baueTitel("Wengen", "Wengen", runde = false))
        assertEquals("Runde bei Wengen", TourBenennung.baueTitel("Wengen", "Grindelwald", runde = true))
    }

    @Test
    fun `einseitige und fehlende Ortsnamen`() {
        assertEquals("Wengen", TourBenennung.baueTitel("Wengen", null, runde = false))
        assertEquals("Grindelwald", TourBenennung.baueTitel(null, "Grindelwald", runde = false))
        assertNull(TourBenennung.baueTitel(null, null, runde = false))
    }

    @Test
    fun `istRunde misst die Luftlinie`() {
        val start = 7.92 to 46.605
        assertTrue(TourBenennung.istRunde(start, 7.9201 to 46.6051)) // ~15 m
        assertFalse(TourBenennung.istRunde(start, 7.99 to 46.60)) // >5 km
    }

    @Test
    fun `fallbackTitel nutzt das deutsche Datum`() {
        // 2026-07-04T08:00:00Z → 10:00 in Europe/Zurich
        assertEquals("Tour vom 4. Juli 2026", TourBenennung.fallbackTitel(1_783_152_000_000, "Europe/Zurich"))
    }

    @Test
    fun `benenne zieht Namen aus dem Geocoder`() = runTest {
        val benennung = TourBenennung { lat, _ -> if (lat < 46.6) "Wengen" else "Grindelwald" }
        assertEquals("Wengen → Grindelwald", benennung.benenne(7.92 to 46.59, 8.03 to 46.62))
    }
}
