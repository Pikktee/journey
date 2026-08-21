package app.maptale.tracker

import app.maptale.upload.TrackerProvider
import app.maptale.upload.TrackerImport
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private fun anbieter(
    available: Boolean = true,
    verbunden: Boolean = false,
    status: String? = null,
    error: String? = null,
) = TrackerProvider(
    id = "polar",
    name = "Polar",
    available = available,
    verbunden = verbunden,
    status = status,
    error = error,
)

private fun importEintrag(status: String) =
    TrackerImport(id = "i_$status", anbieter = "polar", status = status, tourId = null, error = null)

class TrackerModelTest {

    @Test
    fun `die vier Zustaende sind unterscheidbar`() {
        val saetze = listOf(
            providerText(anbieter()),
            providerText(anbieter(verbunden = true, status = "active")),
            providerText(anbieter(status = "expired")),
            providerText(anbieter(available = false)),
        )
        assertEquals(4, saetze.toSet().size)
    }

    @Test
    fun `abgelaufen nennt den Grund und den naechsten Schritt`() {
        val satz = providerText(anbieter(status = "expired", error = "Zugriff beim Anbieter widerrufen."))
        assertTrue(satz.contains("widerrufen"))
        assertTrue(satz.contains("neu verbinden"))
    }

    @Test
    fun `abgelaufen fuehrt auf Neu verbinden, nicht auf Trennen`() {
        // Da ist nichts mehr zu trennen, sondern etwas neu herzustellen.
        assertEquals(TrackerAction.RECONNECT, providerAction(anbieter(status = "expired")))
        assertEquals(TrackerAction.RECONNECT, providerAction(anbieter(verbunden = true, status = "expired")))
    }

    @Test
    fun `ein nicht eingerichteter Anbieter bekommt keine Aktion`() {
        // Ein „Verbinden", das auf eine Fehlerseite führt, wäre die schlechtere
        // Auskunft als gar kein Knopf.
        assertNull(providerAction(anbieter(available = false)))
    }

    @Test
    fun `verbunden trennt, unverbunden verbindet`() {
        assertEquals(TrackerAction.DISCONNECT, providerAction(anbieter(verbunden = true, status = "active")))
        assertEquals(TrackerAction.CONNECT, providerAction(anbieter()))
    }

    @Test
    fun `gemeldet wird nur, was wirklich als Tour ankam`() {
        // Eine übersprungene Halleneinheit ist kein Ereignis für den
        // Sperrbildschirm, und ein Fehler, den niemand beheben kann, ist Lärm.
        assertNull(messageFor(emptyList()))
        assertNull(messageFor(listOf(importEintrag("uebersprungen"), importEintrag("failed"))))
        assertEquals("Eine neue Tour ist da", messageFor(listOf(importEintrag("done"))))
    }

    @Test
    fun `mehrere fertige Touren werden gezaehlt`() {
        val meldung = messageFor(listOf(importEintrag("done"), importEintrag("done"), importEintrag("failed")))
        assertEquals("2 neue Touren sind da", meldung)
    }

    @Test
    fun `der Deep Link liefert die Anbieter-Kennung`() {
        assertEquals("polar", providerFromDeepLink("maptale://tracker/polar?ok=1"))
        assertEquals("polar", providerFromDeepLink("maptale://tracker/polar"))
    }

    @Test
    fun `fremde und leere Adressen werden nicht angenommen`() {
        assertNull(providerFromDeepLink(null))
        assertNull(providerFromDeepLink("https://maptale.io/konto"))
        assertNull(providerFromDeepLink("maptale://tour/t_abc"))
        assertNull(providerFromDeepLink("maptale://tracker/"))
    }
}
