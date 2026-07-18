// GPX-Import (M8): Zeitextraktion, MIME-Zuordnung und der trackFile-Manifestbau.
// Reine Logik — die SAF-/Upload-Orchestrierung (ImportViewModel) ist Android
// und wird hier nicht abgedeckt.
package app.luhambo.importieren

import app.luhambo.upload.ImportMedium
import app.luhambo.upload.ManifestBau
import app.luhambo.upload.Zeitspanne
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
    fun `Zeitspanne nimmt ersten und letzten Zeitstempel`() {
        val spanne = GpxImport.zeitspanne(gpx)!!
        assertEquals(java.time.Instant.parse("2026-07-04T08:12:31Z").toEpochMilli(), spanne.startMs)
        assertEquals(java.time.Instant.parse("2026-07-04T09:03:10Z").toEpochMilli(), spanne.endeMs)
    }

    @Test
    fun `ohne Zeitstempel keine Zeitspanne`() {
        assertNull(GpxImport.zeitspanne("<gpx><trk><trkseg><trkpt lat='1' lon='2'/></trkseg></trk></gpx>"))
    }

    @Test
    fun `einzelner Zeitstempel ergibt mindestens eine Sekunde Spanne`() {
        val spanne = GpxImport.zeitspanne("<gpx><trkpt><time>2026-07-04T08:00:00Z</time></trkpt></gpx>")!!
        assertTrue(spanne.endeMs > spanne.startMs)
    }

    @Test
    fun `hatTrackpunkte erkennt trkpt`() {
        assertTrue(GpxImport.hatTrackpunkte(gpx))
        assertEquals(false, GpxImport.hatTrackpunkte("<gpx></gpx>"))
    }

    @Test
    fun `MIME-Zuordnung deckt erlaubte Typen ab`() {
        assertEquals("photo", ImportLogik.medientyp("image/jpeg"))
        assertEquals("video", ImportLogik.medientyp("video/mp4"))
        assertNull(ImportLogik.medientyp("application/pdf"))
        assertEquals("jpg", ImportLogik.endung("image/jpeg"))
        assertEquals("mov", ImportLogik.endung("video/quicktime"))
        assertNull(ImportLogik.endung("audio/mpeg"))
    }

    @Test
    fun `clientTourId ist stabil und begrenzt`() {
        val id = ImportLogik.clientTourId("meine-tour.gpx", 1_751_609_551_000)
        assertTrue(id.startsWith("import:meine-tour.gpx:"))
        assertTrue(id.length <= 100)
    }

    @Test
    fun `baueImport erzeugt trackFile statt Segmente, mit Anker aus EXIF`() {
        val spanne = Zeitspanne(1_751_609_551_000, 1_751_612_590_000)
        val manifest = ManifestBau.baueImport(
            clientTourId = "import:t:1",
            titel = "Testimport",
            zone = "Europe/Zurich",
            zeitspanne = spanne,
            medien = listOf(
                ImportMedium(id = "m1", typ = "photo", datei = "m1.jpg", aufgenommenMs = spanne.startMs, ankerLng = 8.0, ankerLat = 46.5),
                ImportMedium(id = "m2", typ = "video", datei = "m2.mp4", aufgenommenMs = spanne.startMs),
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
    fun `baueImport-JSON enthält trackFile und keine segments`() {
        val manifest = ManifestBau.baueImport(
            clientTourId = "import:t:1",
            titel = null,
            zone = "UTC",
            zeitspanne = Zeitspanne(1_000_000_000_000, 1_000_000_100_000),
            medien = emptyList(),
        )
        val json = ManifestBau.alsJson(manifest)
        assertTrue(json.contains("\"trackFile\""))
        assertEquals(false, json.contains("\"segments\""))
    }
}
