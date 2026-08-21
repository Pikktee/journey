// Reisezahlen fürs Profil — aus beiden Quellen zusammengezählt.
package app.maptale.ui

import app.maptale.data.TourEntity
import app.maptale.data.TourStatus
import app.maptale.upload.ServerTour
import org.junit.Assert.assertEquals
import org.junit.Test

class TravelStatsTest {

    private fun lokal(status: TourStatus, distanceM: Double) = TourEntry.Local(
        TourEntity(
            id = "l-$status-$distanceM",
            title = null,
            description = null,
            startMs = 1_000,
            endMs = 2_000,
            zone = "Europe/Berlin",
            status = status,
            distanceM = distanceM,
        ),
    )

    private fun server(km: Double?, hoehe: Double?, status: String = "bereit") = TourEntry.Server(
        ServerTour(
            id = "t-$km-$hoehe",
            no = "N°01",
            title = null,
            status = status,
            km = km,
            gainM = hoehe,
            visibility = "unlisted",
            cover = null,
            coverThumb = null,
            createdAt = "2026-07-04T08:00:00Z",
        ),
    )

    @Test
    fun `zaehlt beide Quellen zusammen`() {
        val statistik = computeTravelStats(
            listOf(server(12.5, 300.0), server(7.5, 120.0), lokal(TourStatus.DRAFT, distanceM = 4_000.0)),
        )
        assertEquals(3, statistik.tourCount)
        assertEquals(24.0, statistik.km, 1e-9)
        assertEquals(420.0, statistik.gainM, 1e-9)
    }

    @Test
    fun `die laufende Aufnahme zaehlt noch nicht`() {
        val statistik = computeTravelStats(listOf(lokal(TourStatus.RECORDING, distanceM = 900.0)))
        assertEquals(0, statistik.tourCount)
        assertEquals(0.0, statistik.km, 1e-9)
    }

    @Test
    fun `Touren in Verarbeitung zaehlen mit, auch ohne Zahlen`() {
        // Sonst schrumpfte die Statistik in dem Moment, in dem eine Tour
        // hochgeladen ist und der Server noch rechnet.
        val statistik = computeTravelStats(listOf(server(km = null, hoehe = null, status = "verarbeitung")))
        assertEquals(1, statistik.tourCount)
        assertEquals(0.0, statistik.km, 1e-9)
    }

    @Test
    fun `leere Liste ergibt Nullen`() {
        assertEquals(TravelStats(0, 0.0, 0.0), computeTravelStats(emptyList()))
    }
}
