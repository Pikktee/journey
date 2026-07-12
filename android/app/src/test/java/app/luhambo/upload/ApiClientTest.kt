// ApiClient gegen einen MockWebServer: Authorization-Header, Idempotenz-
// Toleranz beim Finalize (409 = läuft schon) und Fehlertext-Extraktion.
// Robolectric nur wegen DataStore (Einstellungen braucht einen Context).
package app.luhambo.upload

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class ApiClientTest {

    private lateinit var server: MockWebServer
    private lateinit var einstellungen: Einstellungen
    private lateinit var client: ApiClient

    @Before
    fun aufbau() {
        server = MockWebServer()
        server.start()
        val context = ApplicationProvider.getApplicationContext<Context>()
        einstellungen = Einstellungen(context)
        client = ApiClient(einstellungen)
    }

    @After
    fun abbau() {
        server.shutdown()
    }

    private suspend fun melodeAn() {
        einstellungen.setzeServer(server.url("/").toString().trimEnd('/'))
        einstellungen.setzeAnmeldung("test@example.com", "lhb_testtoken")
    }

    @Test
    fun `login liefert das API-Token`() = runTest {
        server.enqueue(MockResponse().setBody("""{"benutzer":{},"apiToken":"lhb_neu"}"""))
        val token = client.login(server.url("/").toString().trimEnd('/'), "a@b.c", "geheim", "Testgerät")
        assertEquals("lhb_neu", token)
        val anfrage = server.takeRequest()
        assertEquals("/api/auth/login", anfrage.path)
        assertTrue(anfrage.body.readUtf8().contains("\"tokenLabel\":\"Testgerät\""))
    }

    @Test
    fun `tourAnlegen sendet Bearer-Token und liest die id`() = runTest {
        melodeAn()
        server.enqueue(MockResponse().setResponseCode(201).setBody("""{"id":"t_abc"}"""))
        val id = client.tourAnlegen("""{"schema":"luhambo/upload@1"}""")
        assertEquals("t_abc", id)
        assertEquals("Bearer lhb_testtoken", server.takeRequest().getHeader("Authorization"))
    }

    @Test
    fun `finalisiere wirft 409 zur semantischen Aufloesung im Worker`() = runTest {
        // 409 ist doppeldeutig (läuft bereits / Medien fehlen) — der ApiClient
        // reicht ihn durch, der UploadWorker entscheidet über den Tour-Status
        melodeAn()
        server.enqueue(MockResponse().setResponseCode(409).setBody("""{"fehler":"Medien fehlen"}"""))
        try {
            client.finalisiere("t_abc")
            throw AssertionError("ApiFehler erwartet")
        } catch (fehler: ApiFehler) {
            assertEquals(409, fehler.status)
        }
    }

    @Test
    fun `patchTour sendet nur gesetzte Felder`() = runTest {
        melodeAn()
        server.enqueue(MockResponse().setBody("""{"ok":true}"""))
        client.patchTour("t_abc", "Neuer Titel", null)
        val anfrage = server.takeRequest()
        assertEquals("PATCH", anfrage.method)
        val body = anfrage.body.readUtf8()
        assertTrue(body.contains("\"title\":\"Neuer Titel\""))
        assertTrue(!body.contains("description"))
    }

    @Test
    fun `Fehlertext des Backends landet in der Exception`() = runTest {
        melodeAn()
        server.enqueue(MockResponse().setResponseCode(413).setBody("""{"fehler":"Datei zu groß"}"""))
        try {
            client.tourAnlegen("{}")
            throw AssertionError("ApiFehler erwartet")
        } catch (fehler: ApiFehler) {
            assertEquals(413, fehler.status)
            assertTrue(fehler.message!!.contains("Datei zu groß"))
        }
    }
}
