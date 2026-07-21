// Reisezahlen fürs Profil — aus beiden Quellen zusammengezählt.
package app.luhambo.ui

import app.luhambo.daten.TourEntity
import app.luhambo.daten.TourStatus
import app.luhambo.upload.ServerTour
import org.junit.Assert.assertEquals
import org.junit.Test

class ReisestatistikTest {

    private fun lokal(status: TourStatus, distanzM: Double) = Toureintrag.Lokal(
        TourEntity(
            id = "l-$status-$distanzM",
            titel = null,
            beschreibung = null,
            startMs = 1_000,
            endeMs = 2_000,
            zone = "Europe/Berlin",
            status = status,
            distanzM = distanzM,
        ),
    )

    private fun server(km: Double?, hoehe: Double?, status: String = "bereit") = Toureintrag.Server(
        ServerTour(
            id = "t-$km-$hoehe",
            no = "N°01",
            titel = null,
            status = status,
            km = km,
            hoehenmeter = hoehe,
            visibility = "unlisted",
            cover = null,
            erstelltAm = "2026-07-04T08:00:00Z",
        ),
    )

    @Test
    fun `zaehlt beide Quellen zusammen`() {
        val statistik = berechneReisestatistik(
            listOf(server(12.5, 300.0), server(7.5, 120.0), lokal(TourStatus.ENTWURF, distanzM = 4_000.0)),
        )
        assertEquals(3, statistik.touren)
        assertEquals(24.0, statistik.kilometer, 1e-9)
        assertEquals(420.0, statistik.hoehenmeter, 1e-9)
    }

    @Test
    fun `die laufende Aufnahme zaehlt noch nicht`() {
        val statistik = berechneReisestatistik(listOf(lokal(TourStatus.AUFNAHME, distanzM = 900.0)))
        assertEquals(0, statistik.touren)
        assertEquals(0.0, statistik.kilometer, 1e-9)
    }

    @Test
    fun `Touren in Verarbeitung zaehlen mit, auch ohne Zahlen`() {
        // Sonst schrumpfte die Statistik in dem Moment, in dem eine Tour
        // hochgeladen ist und der Server noch rechnet.
        val statistik = berechneReisestatistik(listOf(server(km = null, hoehe = null, status = "verarbeitung")))
        assertEquals(1, statistik.touren)
        assertEquals(0.0, statistik.kilometer, 1e-9)
    }

    @Test
    fun `leere Liste ergibt Nullen`() {
        assertEquals(Reisestatistik(0, 0.0, 0.0), berechneReisestatistik(emptyList()))
    }
}
