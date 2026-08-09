package app.maptale.tracker

import app.maptale.upload.TrackerAnbieter
import app.maptale.upload.TrackerImport
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private fun anbieter(
    verfuegbar: Boolean = true,
    verbunden: Boolean = false,
    status: String? = null,
    fehler: String? = null,
) = TrackerAnbieter(
    id = "polar",
    name = "Polar",
    verfuegbar = verfuegbar,
    verbunden = verbunden,
    status = status,
    fehler = fehler,
)

private fun importEintrag(status: String) =
    TrackerImport(id = "i_$status", anbieter = "polar", status = status, tourId = null, fehler = null)

class TrackerModellTest {

    @Test
    fun `die vier Zustaende sind unterscheidbar`() {
        val saetze = listOf(
            anbieterSatz(anbieter()),
            anbieterSatz(anbieter(verbunden = true, status = "aktiv")),
            anbieterSatz(anbieter(status = "abgelaufen")),
            anbieterSatz(anbieter(verfuegbar = false)),
        )
        assertEquals(4, saetze.toSet().size)
    }

    @Test
    fun `abgelaufen nennt den Grund und den naechsten Schritt`() {
        val satz = anbieterSatz(anbieter(status = "abgelaufen", fehler = "Zugriff beim Anbieter widerrufen."))
        assertTrue(satz.contains("widerrufen"))
        assertTrue(satz.contains("neu verbinden"))
    }

    @Test
    fun `abgelaufen fuehrt auf Neu verbinden, nicht auf Trennen`() {
        // Da ist nichts mehr zu trennen, sondern etwas neu herzustellen.
        assertEquals(TrackerAktion.NEU_VERBINDEN, anbieterAktion(anbieter(status = "abgelaufen")))
        assertEquals(TrackerAktion.NEU_VERBINDEN, anbieterAktion(anbieter(verbunden = true, status = "abgelaufen")))
    }

    @Test
    fun `ein nicht eingerichteter Anbieter bekommt keine Aktion`() {
        // Ein „Verbinden", das auf eine Fehlerseite führt, wäre die schlechtere
        // Auskunft als gar kein Knopf.
        assertNull(anbieterAktion(anbieter(verfuegbar = false)))
    }

    @Test
    fun `verbunden trennt, unverbunden verbindet`() {
        assertEquals(TrackerAktion.TRENNEN, anbieterAktion(anbieter(verbunden = true, status = "aktiv")))
        assertEquals(TrackerAktion.VERBINDEN, anbieterAktion(anbieter()))
    }

    @Test
    fun `gemeldet wird nur, was wirklich als Tour ankam`() {
        // Eine übersprungene Halleneinheit ist kein Ereignis für den
        // Sperrbildschirm, und ein Fehler, den niemand beheben kann, ist Lärm.
        assertNull(meldungFuer(emptyList()))
        assertNull(meldungFuer(listOf(importEintrag("uebersprungen"), importEintrag("fehler"))))
        assertEquals("Eine neue Tour ist da", meldungFuer(listOf(importEintrag("fertig"))))
    }

    @Test
    fun `mehrere fertige Touren werden gezaehlt`() {
        val meldung = meldungFuer(listOf(importEintrag("fertig"), importEintrag("fertig"), importEintrag("fehler")))
        assertEquals("2 neue Touren sind da", meldung)
    }

    @Test
    fun `der Deep Link liefert die Anbieter-Kennung`() {
        assertEquals("polar", anbieterAusDeepLink("maptale://tracker/polar?ok=1"))
        assertEquals("polar", anbieterAusDeepLink("maptale://tracker/polar"))
    }

    @Test
    fun `fremde und leere Adressen werden nicht angenommen`() {
        assertNull(anbieterAusDeepLink(null))
        assertNull(anbieterAusDeepLink("https://maptale.io/konto"))
        assertNull(anbieterAusDeepLink("maptale://tour/t_abc"))
        assertNull(anbieterAusDeepLink("maptale://tracker/"))
    }
}
