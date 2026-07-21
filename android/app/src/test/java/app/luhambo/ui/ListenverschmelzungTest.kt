// Welche Darstellung gewinnt, wenn eine Tour lokal UND beim Server liegt.
package app.luhambo.ui

import app.luhambo.daten.TourEntity
import app.luhambo.daten.TourStatus
import app.luhambo.upload.ServerTour
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ListenverschmelzungTest {

    private fun lokal(
        id: String,
        status: TourStatus,
        serverId: String? = null,
        startMs: Long = 1_000,
    ) = TourEntity(
        id = id,
        titel = null,
        beschreibung = null,
        startMs = startMs,
        endeMs = startMs + 1000,
        zone = "Europe/Berlin",
        status = status,
        serverId = serverId,
    )

    private fun server(id: String, erstelltAm: String = "2026-07-04T08:00:00Z") = ServerTour(
        id = id,
        no = "N°01",
        titel = null,
        status = "bereit",
        km = 12.0,
        hoehenmeter = 300.0,
        visibility = "unlisted",
        cover = null,
        erstelltAm = erstelltAm,
    )

    @Test
    fun `Tour ohne Server-Pendant erscheint lokal`() {
        val liste = verschmelzeTouren(listOf(lokal("l1", TourStatus.ENTWURF)), emptyList())
        assertEquals(1, liste.size)
        assertTrue(liste[0] is Toureintrag.Lokal)
    }

    @Test
    fun `Waehrend des Uploads gewinnt die lokale Darstellung`() {
        // Der Worker vermerkt die Server-ID früh — ab dann kennt der Server die
        // Tour, während lokal noch Medien hochgeladen werden. Nur die lokale
        // Karte kennt Fortschritt und Fehler.
        val liste = verschmelzeTouren(
            listOf(lokal("l1", TourStatus.LAEDT_HOCH, serverId = "t_1")),
            listOf(server("t_1")),
        )
        assertEquals(1, liste.size)
        assertEquals("l1", liste[0].schluessel)
    }

    @Test
    fun `Nach dem Upload gewinnt die Server-Darstellung`() {
        val liste = verschmelzeTouren(
            listOf(lokal("l1", TourStatus.HOCHGELADEN, serverId = "t_1")),
            listOf(server("t_1")),
        )
        assertEquals(1, liste.size)
        assertEquals("t_1", liste[0].schluessel)
    }

    @Test
    fun `Ein fehlgeschlagener Teilupload bleibt sichtbar`() {
        val liste = verschmelzeTouren(
            listOf(lokal("l1", TourStatus.FEHLER, serverId = "t_1")),
            listOf(server("t_1")),
        )
        assertEquals(listOf("l1"), liste.map { it.schluessel })
    }

    @Test
    fun `Im Studio erstellte Touren erscheinen ohne lokales Pendant`() {
        val liste = verschmelzeTouren(emptyList(), listOf(server("t_studio")))
        assertEquals(1, liste.size)
        assertTrue(liste[0] is Toureintrag.Server)
    }

    @Test
    fun `Die laufende Aufnahme steht immer oben`() {
        val liste = verschmelzeTouren(
            listOf(
                lokal("alt", TourStatus.ENTWURF, startMs = 9_000_000),
                lokal("laeuft", TourStatus.AUFNAHME, startMs = 1_000),
            ),
            listOf(server("t_1", erstelltAm = "2030-01-01T00:00:00Z")),
        )
        assertEquals("laeuft", liste.first().schluessel)
    }

    @Test
    fun `Sonst sortiert die Zeit, neueste zuerst`() {
        val liste = verschmelzeTouren(
            listOf(lokal("l_alt", TourStatus.ENTWURF, startMs = 1_000_000)),
            listOf(server("t_neu", erstelltAm = "2030-01-01T00:00:00Z")),
        )
        assertEquals(listOf("t_neu", "l_alt"), liste.map { it.schluessel })
    }

    @Test
    fun `Ein unlesbarer Zeitstempel kippt die Sortierung nicht`() {
        assertEquals(0L, zeitstempel("kaputt"))
        val liste = verschmelzeTouren(
            listOf(lokal("l1", TourStatus.ENTWURF, startMs = 5_000)),
            listOf(server("t_kaputt", erstelltAm = "kaputt")),
        )
        assertEquals(listOf("l1", "t_kaputt"), liste.map { it.schluessel })
    }
}
