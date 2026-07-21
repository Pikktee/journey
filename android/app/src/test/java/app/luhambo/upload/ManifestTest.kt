// ManifestBau: Room-Bestand → `luhambo/upload@1`. Die Naht zum Backend —
// Segmentierung an Moduswechseln, Zeitformate und Anker müssen exakt stimmen.
package app.luhambo.upload

import app.luhambo.daten.MediumEntity
import app.luhambo.daten.Modus
import app.luhambo.daten.ModuswechselEntity
import app.luhambo.daten.TourEntity
import app.luhambo.daten.TourStatus
import app.luhambo.daten.TrackpunktEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ManifestTest {

    private fun punkt(id: Long, tS: Double, lng: Double = 8.0 + tS / 10_000) =
        TrackpunktEntity(id = id, tourId = "t", lng = lng, lat = 46.59, ele = 500.0, tOffsetS = tS, genauigkeitM = 5f)

    private fun wechsel(tS: Double, modus: Modus) =
        ModuswechselEntity(tourId = "t", tOffsetS = tS, modus = modus)

    private val tour = TourEntity(
        id = "lokal-abc",
        titel = "Testtour",
        beschreibung = null,
        startMs = 1_751_600_000_000, // 2025-07-04T04:13:20Z
        endeMs = 1_751_603_600_000,
        zone = "Europe/Zurich",
        status = TourStatus.ENTWURF,
    )

    @Test
    fun `ein Modus ergibt ein Segment mit allen Punkten`() {
        val punkte = (0..5).map { punkt(it.toLong(), it * 10.0) }
        val segmente = ManifestBau.baueSegmente(punkte, listOf(wechsel(0.0, Modus.WALK)))
        assertEquals(1, segmente.size)
        assertEquals("walk", segmente[0].mode)
        assertEquals(6, segmente[0].pts.size)
    }

    @Test
    fun `Moduswechsel zerschneidet mit gemeinsamem Grenzpunkt`() {
        val punkte = (0..5).map { punkt(it.toLong(), it * 10.0) } // t = 0,10,…,50
        val segmente = ManifestBau.baueSegmente(
            punkte,
            listOf(wechsel(0.0, Modus.WALK), wechsel(25.0, Modus.BIKE)),
        )
        assertEquals(2, segmente.size)
        assertEquals("walk", segmente[0].mode)
        assertEquals("bike", segmente[1].mode)
        // walk endet am letzten Punkt VOR dem Wechsel (t=20); bike beginnt dort
        // (Grenzpunkt doppelt — das Backend erwartet anschließende Segmente)
        assertEquals(20.0, segmente[0].pts.last()[3], 1e-9)
        assertEquals(20.0, segmente[1].pts.first()[3], 1e-9)
        assertEquals(30.0, segmente[1].pts[1][3], 1e-9)
    }

    @Test
    fun `Wechsel ohne nachfolgende Punkte faellt weg`() {
        val punkte = (0..3).map { punkt(it.toLong(), it * 10.0) } // bis t=30
        val segmente = ManifestBau.baueSegmente(
            punkte,
            listOf(wechsel(0.0, Modus.WALK), wechsel(29.0, Modus.FERRY)),
        )
        // Fähre hätte nur den Grenz- und Endpunkt — walk + Mini-Fähre sind ok,
        // Hauptsache: kein leeres Segment, alle Punkte abgedeckt
        assertTrue(segmente.isNotEmpty())
        assertTrue(segmente.all { it.pts.size >= 2 })
    }

    @Test
    fun `Manifest traegt Schema, clientTourId und ISO-Zeiten`() {
        val punkte = (0..2).map { punkt(it.toLong(), it * 10.0) }
        val manifest = ManifestBau.baue(tour, punkte, listOf(wechsel(0.0, Modus.WALK)), emptyList())
        assertEquals("luhambo/upload@1", manifest.schema)
        assertEquals("lokal-abc", manifest.clientTourId)
        assertEquals("Europe/Zurich", manifest.time.zone)
        assertTrue(manifest.time.start.endsWith("Z"))

        val json = ManifestBau.alsJson(manifest)
        assertTrue(json.contains("\"schema\":\"luhambo/upload@1\""))
        assertTrue(json.contains("\"clientTourId\":\"lokal-abc\""))
    }

    @Test
    fun `Medien mit und ohne Anker`() {
        val medien = listOf(
            MediumEntity(
                id = "m1", tourId = "t", typ = "photo", datei = "touren/t/a.jpg",
                aufgenommenMs = tour.startMs + 60_000, ankerLng = 8.001, ankerLat = 46.591,
            ),
            MediumEntity(
                id = "m2", tourId = "t", typ = "photo", datei = "touren/t/b.jpg",
                aufgenommenMs = tour.startMs + 120_000, ankerLng = null, ankerLat = null,
            ),
        )
        val punkte = (0..2).map { punkt(it.toLong(), it * 10.0) }
        val manifest = ManifestBau.baue(tour, punkte, listOf(wechsel(0.0, Modus.WALK)), medien)
        assertEquals(listOf(8.001, 46.591), manifest.media[0].anchor)
        assertEquals(null, manifest.media[1].anchor)
        assertEquals("a.jpg", manifest.media[0].file)

        // anchor: null darf im JSON gar nicht auftauchen (explicitNulls = false),
        // sonst scheitert die strikte Schema-Validierung des Backends
        val json = ManifestBau.alsJson(manifest)
        assertFalse(json.contains("\"anchor\":null"))
    }

    @Test
    fun `Titel eines Fotos geht als caption mit, leerer Text gar nicht`() {
        val medien = listOf(
            MediumEntity(
                id = "m1", tourId = "t", typ = "photo", datei = "touren/t/a.jpg",
                aufgenommenMs = tour.startMs + 60_000, ankerLng = null, ankerLat = null,
                caption = "Blick über die Bucht",
            ),
            MediumEntity(
                id = "m2", tourId = "t", typ = "photo", datei = "touren/t/b.jpg",
                aufgenommenMs = tour.startMs + 120_000, ankerLng = null, ankerLat = null,
                caption = "   ",
            ),
        )
        val punkte = (0..2).map { punkt(it.toLong(), it * 10.0) }
        val manifest = ManifestBau.baue(tour, punkte, listOf(wechsel(0.0, Modus.WALK)), medien)

        assertEquals("Blick über die Bucht", manifest.media[0].caption)
        assertEquals(null, manifest.media[1].caption)
        assertFalse(ManifestBau.alsJson(manifest).contains("\"caption\":null"))
    }
}
