// ApiClient gegen einen MockWebServer: Authorization-Header, Idempotenz-
// Toleranz beim Finalize (409 = läuft schon) und Fehlertext-Extraktion.
// Robolectric nur wegen DataStore (Einstellungen braucht einen Context).
package app.maptale.upload

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
    private lateinit var settings: Settings
    private lateinit var client: ApiClient

    @Before
    fun aufbau() {
        server = MockWebServer()
        server.start()
        val context = ApplicationProvider.getApplicationContext<Context>()
        settings = Settings(context)
        client = ApiClient(settings)
    }

    @After
    fun abbau() {
        server.shutdown()
    }

    private suspend fun melodeAn() {
        settings.setServer(server.url("/").toString().trimEnd('/'))
        settings.setLogin("test@example.com", "lhb_testtoken")
    }

    @Test
    fun `login liefert das API-Token`() = runTest {
        server.enqueue(MockResponse().setBody("""{"user":{},"apiToken":"lhb_neu"}"""))
        val token = client.login(server.url("/").toString().trimEnd('/'), "a@b.c", "geheim", "Testgerät")
        assertEquals("lhb_neu", token)
        val anfrage = server.takeRequest()
        assertEquals("/api/auth/login", anfrage.path)
        assertTrue(anfrage.body.readUtf8().contains("\"tokenLabel\":\"Testgerät\""))
    }

    @Test
    fun `createTour sendet Bearer-Token und liest die id`() = runTest {
        melodeAn()
        server.enqueue(MockResponse().setResponseCode(201).setBody("""{"id":"t_abc"}"""))
        val id = client.createTour("""{"schema":"maptale/upload@2"}""")
        assertEquals("t_abc", id)
        assertEquals("Bearer lhb_testtoken", server.takeRequest().getHeader("Authorization"))
    }

    @Test
    fun `finalize wirft 409 zur semantischen Aufloesung im Worker`() = runTest {
        // 409 ist doppeldeutig (läuft bereits / Medien fehlen) — der ApiClient
        // reicht ihn durch, der UploadWorker entscheidet über den Tour-Status
        melodeAn()
        server.enqueue(MockResponse().setResponseCode(409).setBody("""{"fehler":"Medien fehlen"}"""))
        try {
            client.finalize("t_abc")
            throw AssertionError("ApiFehler erwartet")
        } catch (fehler: ApiError) {
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
    fun `tourList liest Titelbild, Zeitstempel und Hoehenmeter`() = runTest {
        melodeAn()
        server.enqueue(
            MockResponse().setBody(
                """
                {"tours":[{"id":"t_1","no":"N°01","title":"Bucht","status":"bereit","visibility":"unlisted",
                "cover":"/api/media/t_1/m1.jpg","createdAt":"2026-07-04T08:00:00.000Z",
                "stats":{"km":12.5,"gainM":300}}]}
                """.trimIndent(),
            ),
        )
        val tour = client.tourList().single()
        assertEquals("/api/media/t_1/m1.jpg", tour.cover)
        assertEquals("2026-07-04T08:00:00.000Z", tour.createdAt)
        assertEquals(12.5, tour.km!!, 1e-9)
        assertEquals(300.0, tour.gainM!!, 1e-9)
    }

    @Test
    fun `eine Tour ohne Titelbild bleibt lesbar`() = runTest {
        // Vor dem ersten Rendern gibt es kein cover — das darf die Liste nicht kippen
        melodeAn()
        server.enqueue(MockResponse().setBody("""{"tours":[{"id":"t_1","status":"verarbeitung"}]}"""))
        val tour = client.tourList().single()
        assertEquals(null, tour.cover)
        assertEquals(null, tour.km)
    }

    @Test
    fun `accountState liest Bestaetigung und Kontingent`() = runTest {
        melodeAn()
        server.enqueue(
            MockResponse().setBody(
                """{"user":{"id":"u1","email":"a@b.c","name":"Ida"},"verified":false,
                   "quota":{"used":1048576,"limit":10485760,"frei":9437184}}""",
            ),
        )
        val stand = client.accountState()
        assertEquals("a@b.c", stand.email)
        assertEquals(false, stand.verified)
        assertEquals(0.1f, stand.quotaFraction, 1e-6f)
    }

    @Test
    fun `Overlay wird gelesen und unveraendert zurueckgeschrieben`() = runTest {
        melodeAn()
        server.enqueue(MockResponse().setBody("""{"schema":"maptale/edits@2","kamera":[]}"""))
        val overlay = client.loadEdits("t_1")
        assertEquals("/api/tours/t_1/edits", server.takeRequest().path)

        server.enqueue(MockResponse().setResponseCode(202).setBody("{}"))
        client.saveEdits("t_1", withMediumCaption(overlay, "m1", "Bucht"))
        val anfrage = server.takeRequest()
        assertEquals("PUT", anfrage.method)
        val body = anfrage.body.readUtf8()
        assertTrue(body.contains("\"caption\":\"Bucht\""))
        assertTrue("Studio-Feld verloren: $body", body.contains("\"kamera\""))
    }

    @Test
    fun `sessionForPlayer liefert die Sitzungs-ID`() = runTest {
        melodeAn()
        server.enqueue(MockResponse().setBody("""{"sessionId":"s_abc","ablauf":"2026-08-01T00:00:00Z"}"""))
        assertEquals("s_abc", client.sessionForPlayer())
        val anfrage = server.takeRequest()
        assertEquals("POST", anfrage.method)
        assertEquals("/api/auth/session-from-token", anfrage.path)
        assertEquals("Bearer lhb_testtoken", anfrage.getHeader("Authorization"))
    }

    @Test
    fun `registerPushDevice schickt Adresse und Plattform`() = runTest {
        melodeAn()
        server.enqueue(MockResponse().setBody("""{"ok":true,"push":true,"geraetId":"g_abc"}"""))
        assertTrue(client.registerPushDevice("fid-abc"))
        val anfrage = server.takeRequest()
        assertEquals("POST", anfrage.method)
        assertEquals("/api/push/devices", anfrage.path)
        assertEquals("Bearer lhb_testtoken", anfrage.getHeader("Authorization"))
        val koerper = anfrage.body.readUtf8()
        assertTrue(koerper.contains("\"token\":\"fid-abc\""))
        assertTrue(koerper.contains("\"platform\":\"android\""))
    }

    @Test
    fun `ein Server ohne Push meldet das, statt zu scheitern`() = runTest {
        // Kein Dienstkonto auf dem Server: Die App soll das erfahren und es
        // beim periodischen Abruf belassen — nicht in einen Fehler laufen.
        melodeAn()
        server.enqueue(MockResponse().setBody("""{"ok":false,"push":false}"""))
        assertEquals(false, client.registerPushDevice("fid-abc"))
    }

    @Test
    fun `unregisterPushDevice schickt die Adresse im Body, nicht im Pfad`() = runTest {
        // Im Pfad landete sie in Zugriffsprotokollen — dort hat eine
        // Geräte-Adresse nichts zu suchen.
        melodeAn()
        server.enqueue(MockResponse().setBody("""{"ok":true}"""))
        client.unregisterPushDevice("fid-abc")
        val anfrage = server.takeRequest()
        assertEquals("DELETE", anfrage.method)
        assertEquals("/api/push/devices", anfrage.path)
        assertTrue(anfrage.body.readUtf8().contains("\"token\":\"fid-abc\""))
    }

    @Test
    fun `Fehlertext des Backends landet in der Exception`() = runTest {
        melodeAn()
        server.enqueue(MockResponse().setResponseCode(413).setBody("""{"fehler":"Datei zu groß"}"""))
        try {
            client.createTour("{}")
            throw AssertionError("ApiFehler erwartet")
        } catch (fehler: ApiError) {
            assertEquals(413, fehler.status)
            assertTrue(fehler.message!!.contains("Datei zu groß"))
        }
    }
}
