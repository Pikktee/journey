// Welche Darstellung gewinnt, wenn eine Tour lokal UND beim Server liegt.
package app.maptale.ui

import app.maptale.data.TourEntity
import app.maptale.data.TourStatus
import app.maptale.upload.ServerTour
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TourListMergeTest {

    private fun lokal(
        id: String,
        status: TourStatus,
        serverId: String? = null,
        startMs: Long = 1_000,
    ) = TourEntity(
        id = id,
        title = null,
        description = null,
        startMs = startMs,
        endMs = startMs + 1000,
        zone = "Europe/Berlin",
        status = status,
        serverId = serverId,
    )

    private fun server(id: String, createdAt: String = "2026-07-04T08:00:00Z") = ServerTour(
        id = id,
        no = "N°01",
        title = null,
        status = "bereit",
        km = 12.0,
        gainM = 300.0,
        visibility = "unlisted",
        cover = null,
        coverThumb = null,
        createdAt = createdAt,
    )

    @Test
    fun `Tour ohne Server-Pendant erscheint lokal`() {
        val liste = mergeTours(listOf(lokal("l1", TourStatus.DRAFT)), emptyList())
        assertEquals(1, liste.size)
        assertTrue(liste[0] is TourEntry.Local)
    }

    @Test
    fun `Waehrend des Uploads gewinnt die lokale Darstellung`() {
        // Der Worker vermerkt die Server-ID früh — ab dann kennt der Server die
        // Tour, während lokal noch Medien hochgeladen werden. Nur die lokale
        // Karte kennt Fortschritt und Fehler.
        val liste = mergeTours(
            listOf(lokal("l1", TourStatus.UPLOADING, serverId = "t_1")),
            listOf(server("t_1")),
        )
        assertEquals(1, liste.size)
        assertEquals("l1", liste[0].key)
    }

    @Test
    fun `Nach dem Upload gewinnt die Server-Darstellung`() {
        val liste = mergeTours(
            listOf(lokal("l1", TourStatus.UPLOADED, serverId = "t_1")),
            listOf(server("t_1")),
        )
        assertEquals(1, liste.size)
        assertEquals("t_1", liste[0].key)
    }

    @Test
    fun `Ein fehlgeschlagener Teilupload bleibt sichtbar`() {
        val liste = mergeTours(
            listOf(lokal("l1", TourStatus.FAILED, serverId = "t_1")),
            listOf(server("t_1")),
        )
        assertEquals(listOf("l1"), liste.map { it.key })
    }

    @Test
    fun `Im Studio erstellte Touren erscheinen ohne lokales Pendant`() {
        val liste = mergeTours(emptyList(), listOf(server("t_studio")))
        assertEquals(1, liste.size)
        assertTrue(liste[0] is TourEntry.Server)
    }

    @Test
    fun `Die laufende Aufnahme steht immer oben`() {
        val liste = mergeTours(
            listOf(
                lokal("alt", TourStatus.DRAFT, startMs = 9_000_000),
                lokal("laeuft", TourStatus.RECORDING, startMs = 1_000),
            ),
            listOf(server("t_1", createdAt = "2030-01-01T00:00:00Z")),
        )
        assertEquals("laeuft", liste.first().key)
    }

    @Test
    fun `Sonst sortiert die Zeit, neueste zuerst`() {
        val liste = mergeTours(
            listOf(lokal("l_alt", TourStatus.DRAFT, startMs = 1_000_000)),
            listOf(server("t_neu", createdAt = "2030-01-01T00:00:00Z")),
        )
        assertEquals(listOf("t_neu", "l_alt"), liste.map { it.key })
    }

    @Test
    fun `Ein unlesbarer Zeitstempel kippt die Sortierung nicht`() {
        assertEquals(0L, timestamp("kaputt"))
        val liste = mergeTours(
            listOf(lokal("l1", TourStatus.DRAFT, startMs = 5_000)),
            listOf(server("t_kaputt", createdAt = "kaputt")),
        )
        assertEquals(listOf("l1", "t_kaputt"), liste.map { it.key })
    }
}
