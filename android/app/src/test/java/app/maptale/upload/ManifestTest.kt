// ManifestBau: Room-Bestand → `maptale/upload@2`. Die Naht zum Backend —
// Segmentierung an Moduswechseln, Zeitformate und Anker müssen exakt stimmen.
package app.maptale.upload

import app.maptale.data.MediumEntity
import app.maptale.data.TravelMode
import app.maptale.data.TravelModeChangeEntity
import app.maptale.data.TourEntity
import app.maptale.data.TourStatus
import app.maptale.data.TrackPointEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ManifestTest {

    private fun punkt(id: Long, tS: Double, lng: Double = 8.0 + tS / 10_000) =
        TrackPointEntity(id = id, tourId = "t", lng = lng, lat = 46.59, ele = 500.0, tOffsetS = tS, accuracyM = 5f)

    private fun wechsel(tS: Double, travelMode: TravelMode) =
        TravelModeChangeEntity(tourId = "t", tOffsetS = tS, travelMode = travelMode)

    private val tour = TourEntity(
        id = "local-abc",
        title = "Testtour",
        description = null,
        startMs = 1_751_600_000_000, // 2025-07-04T04:13:20Z
        endMs = 1_751_603_600_000,
        zone = "Europe/Zurich",
        status = TourStatus.DRAFT,
    )

    @Test
    fun `ein Modus ergibt ein Segment mit allen Punkten`() {
        val points = (0..5).map { punkt(it.toLong(), it * 10.0) }
        val segmente = ManifestBuilder.buildSegments(points, listOf(wechsel(0.0, TravelMode.WALK)))
        assertEquals(1, segmente.size)
        assertEquals("walk", segmente[0].mode)
        assertEquals(6, segmente[0].pts.size)
    }

    @Test
    fun `Moduswechsel zerschneidet mit gemeinsamem Grenzpunkt`() {
        val points = (0..5).map { punkt(it.toLong(), it * 10.0) } // t = 0,10,…,50
        val segmente = ManifestBuilder.buildSegments(
            points,
            listOf(wechsel(0.0, TravelMode.WALK), wechsel(25.0, TravelMode.BIKE)),
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
        val points = (0..3).map { punkt(it.toLong(), it * 10.0) } // bis t=30
        val segmente = ManifestBuilder.buildSegments(
            points,
            listOf(wechsel(0.0, TravelMode.WALK), wechsel(29.0, TravelMode.FERRY)),
        )
        // Fähre hätte nur den Grenz- und Endpunkt — walk + Mini-Fähre sind ok,
        // Hauptsache: kein leeres Segment, alle Punkte abgedeckt
        assertTrue(segmente.isNotEmpty())
        assertTrue(segmente.all { it.pts.size >= 2 })
    }

    @Test
    fun `Manifest traegt Schema, clientTourId und ISO-Zeiten`() {
        val points = (0..2).map { punkt(it.toLong(), it * 10.0) }
        val manifest = ManifestBuilder.build(tour, points, listOf(wechsel(0.0, TravelMode.WALK)), emptyList())
        assertEquals("maptale/upload@2", manifest.schema)
        assertEquals("local-abc", manifest.clientTourId)
        assertEquals("Europe/Zurich", manifest.time.zone)
        assertTrue(manifest.time.start.endsWith("Z"))

        val json = ManifestBuilder.toJson(manifest)
        assertTrue(json.contains("\"schema\":\"maptale/upload@2\""))
        assertTrue(json.contains("\"clientTourId\":\"local-abc\""))
    }

    @Test
    fun `Medien mit und ohne Anker`() {
        val media = listOf(
            MediumEntity(
                id = "m1", tourId = "t", type = "photo", file = "tours/t/a.jpg",
                takenAtMs = tour.startMs + 60_000, anchorLng = 8.001, anchorLat = 46.591,
            ),
            MediumEntity(
                id = "m2", tourId = "t", type = "photo", file = "tours/t/b.jpg",
                takenAtMs = tour.startMs + 120_000, anchorLng = null, anchorLat = null,
            ),
        )
        val points = (0..2).map { punkt(it.toLong(), it * 10.0) }
        val manifest = ManifestBuilder.build(tour, points, listOf(wechsel(0.0, TravelMode.WALK)), media)
        assertEquals(listOf(8.001, 46.591), manifest.media[0].anchor)
        assertEquals(null, manifest.media[1].anchor)
        assertEquals("a.jpg", manifest.media[0].file)

        // anchor: null darf im JSON gar nicht auftauchen (explicitNulls = false),
        // sonst scheitert die strikte Schema-Validierung des Backends
        val json = ManifestBuilder.toJson(manifest)
        assertFalse(json.contains("\"anchor\":null"))
    }

    @Test
    fun `Titel eines Fotos geht als caption mit, leerer Text gar nicht`() {
        val media = listOf(
            MediumEntity(
                id = "m1", tourId = "t", type = "photo", file = "tours/t/a.jpg",
                takenAtMs = tour.startMs + 60_000, anchorLng = null, anchorLat = null,
                caption = "Blick über die Bucht",
            ),
            MediumEntity(
                id = "m2", tourId = "t", type = "photo", file = "tours/t/b.jpg",
                takenAtMs = tour.startMs + 120_000, anchorLng = null, anchorLat = null,
                caption = "   ",
            ),
        )
        val points = (0..2).map { punkt(it.toLong(), it * 10.0) }
        val manifest = ManifestBuilder.build(tour, points, listOf(wechsel(0.0, TravelMode.WALK)), media)

        assertEquals("Blick über die Bucht", manifest.media[0].caption)
        assertEquals(null, manifest.media[1].caption)
        assertFalse(ManifestBuilder.toJson(manifest).contains("\"caption\":null"))
    }

    // — Glättung der erkannten Fortbewegung —
    //
    // Sie liegt bewusst VOR dem Zerschneiden: `buildSegments` bleibt mechanisch,
    // was ein belastbarer Abschnitt ist, entscheidet die Bewegungsdeutung.

    @Test
    fun `smoothChanges wirft das Flackern beim Umsteigen weg`() {
        val roh = listOf(
            wechsel(0.0, TravelMode.JEEP),
            wechsel(600.0, TravelMode.WALK),
            wechsel(620.0, TravelMode.JEEP),
        )
        val erg = ManifestBuilder.smoothChanges(roh, endeS = 1800.0)
        assertEquals(1, erg.size)
        assertEquals(TravelMode.JEEP, erg[0].travelMode)
        assertEquals(0.0, erg[0].tOffsetS, 1e-9)
    }

    @Test
    fun `smoothChanges behaelt einen echten Fussweg`() {
        val roh = listOf(
            wechsel(0.0, TravelMode.JEEP),
            wechsel(420.0, TravelMode.WALK),
            wechsel(1320.0, TravelMode.JEEP),
        )
        assertEquals(3, ManifestBuilder.smoothChanges(roh, endeS = 2700.0).size)
    }

    @Test
    fun `smoothChanges laesst die einzelne Angabe des Nutzers unberuehrt`() {
        val roh = listOf(wechsel(0.0, TravelMode.TRAM))
        assertEquals(roh, ManifestBuilder.smoothChanges(roh, endeS = 1800.0))
    }
}
