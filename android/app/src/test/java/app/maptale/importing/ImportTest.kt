// GPX-Import (M8): Zeitextraktion, MIME-Zuordnung und der trackFile-Manifestbau.
// Reine Logik — die SAF-/Upload-Orchestrierung (ImportViewModel) ist Android
// und wird hier nicht abgedeckt.
package app.maptale.importing

import app.maptale.upload.ImportMedium
import app.maptale.upload.ManifestBuilder
import app.maptale.upload.TimeSpan
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ImportTest {

    private val gpx = """
        <?xml version="1.0"?>
        <gpx version="1.1"><trk><trkseg>
          <trkpt lat="46.5" lon="7.9"><ele>800</ele><time>2026-07-04T08:12:31Z</time></trkpt>
          <trkpt lat="46.6" lon="8.0"><ele>900</ele><time>2026-07-04T08:20:00Z</time></trkpt>
          <trkpt lat="46.7" lon="8.1"><ele>950</ele><time>2026-07-04T09:03:10Z</time></trkpt>
        </trkseg></trk></gpx>
    """.trimIndent()

    @Test
    fun `TimeSpan nimmt ersten und letzten Zeitstempel`() {
        val spanne = GpxImport.timeSpan(gpx)!!
        assertEquals(java.time.Instant.parse("2026-07-04T08:12:31Z").toEpochMilli(), spanne.startMs)
        assertEquals(java.time.Instant.parse("2026-07-04T09:03:10Z").toEpochMilli(), spanne.endMs)
    }

    @Test
    fun `ohne Zeitstempel keine Zeitspanne`() {
        assertNull(GpxImport.timeSpan("<gpx><trk><trkseg><trkpt lat='1' lon='2'/></trkseg></trk></gpx>"))
    }

    @Test
    fun `einzelner Zeitstempel ergibt mindestens eine Sekunde Spanne`() {
        val spanne = GpxImport.timeSpan("<gpx><trkpt><time>2026-07-04T08:00:00Z</time></trkpt></gpx>")!!
        assertTrue(spanne.endMs > spanne.startMs)
    }

    @Test
    fun `hasTrackPoints erkennt trkpt`() {
        assertTrue(GpxImport.hasTrackPoints(gpx))
        assertEquals(false, GpxImport.hasTrackPoints("<gpx></gpx>"))
    }

    @Test
    fun `MIME-Zuordnung deckt erlaubte Typen ab`() {
        assertEquals("photo", ImportLogic.mediaType("image/jpeg"))
        assertEquals("video", ImportLogic.mediaType("video/mp4"))
        assertNull(ImportLogic.mediaType("application/pdf"))
        assertEquals("jpg", ImportLogic.extension("image/jpeg"))
        assertEquals("mov", ImportLogic.extension("video/quicktime"))
        assertNull(ImportLogic.extension("audio/mpeg"))
    }

    @Test
    fun `clientTourId ist stabil und begrenzt`() {
        val id = ImportLogic.clientTourId("meine-tour.gpx", 1_751_609_551_000)
        assertTrue(id.startsWith("import:meine-tour.gpx:"))
        assertTrue(id.length <= 100)
    }

    @Test
    fun `buildImport erzeugt trackFile statt Segmente, mit Anker aus EXIF`() {
        val spanne = TimeSpan(1_751_609_551_000, 1_751_612_590_000)
        val manifest = ManifestBuilder.buildImport(
            clientTourId = "import:t:1",
            title = "Testimport",
            zone = "Europe/Zurich",
            timeSpan = spanne,
            media = listOf(
                ImportMedium(id = "m1", typ = "photo", datei = "m1.jpg", takenAtMs = spanne.startMs, anchorLng = 8.0, anchorLat = 46.5),
                ImportMedium(id = "m2", typ = "video", datei = "m2.mp4", takenAtMs = spanne.startMs),
            ),
        )
        assertEquals("track.gpx", manifest.trackFile)
        assertNull(manifest.segments)
        assertEquals("Testimport", manifest.title)
        assertEquals(2, manifest.media.size)
        assertEquals(listOf(8.0, 46.5), manifest.media[0].anchor)
        assertNull(manifest.media[1].anchor) // Video ohne GPS → Zeit-Platzierung serverseitig
    }

    @Test
    fun `buildImport-JSON enthält trackFile und keine segments`() {
        val manifest = ManifestBuilder.buildImport(
            clientTourId = "import:t:1",
            title = null,
            zone = "UTC",
            timeSpan = TimeSpan(1_000_000_000_000, 1_000_000_100_000),
            media = emptyList(),
        )
        val json = ManifestBuilder.toJson(manifest)
        assertTrue(json.contains("\"trackFile\""))
        assertEquals(false, json.contains("\"segments\""))
    }
}
