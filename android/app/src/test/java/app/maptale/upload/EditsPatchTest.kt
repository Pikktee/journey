// Das Edit-Overlay gehört nicht der App allein: im Studio gesetzte
// Kamerafahrten, Musik und Wetterkorrekturen liegen in derselben Datei. Diese
// Tests halten fest, dass ein Foto-Titel aus der App davon nichts anfasst.
package app.maptale.upload

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class EditsPatchTest {

    private fun read(text: String): JsonObject = Json.parseToJsonElement(text).jsonObject

    @Test
    fun `Overlay einer Tour ohne edits-Datei bekommt das Schema`() {
        // Der Server antwortet dann nur mit dem Schema-Feld; ohne es weist die
        // strenge Prüfung beim Speichern das Overlay ab.
        val neu = withMediumCaption(read("""{"schema":"maptale/edits@2"}"""), "m1", "Bucht")
        assertEquals(EDITS_SCHEMA, neu["schema"]?.jsonPrimitive?.content)
        assertEquals("Bucht", neu["media"]!!.jsonObject["m1"]!!.jsonObject["caption"]!!.jsonPrimitive.content)
    }

    @Test
    fun `fremde Felder des Studios bleiben unangetastet`() {
        val vorher = read(
            """
            {
              "schema": "maptale/edits@2",
              "kamera": [{"ab": "2026-07-04T09:00:00Z", "preset": "weit"}],
              "audio": [{"datei": "song.mp3", "typ": "musik", "ab": "2026-07-04T09:00:00Z"}],
              "wetter": [{"ab": "2026-07-04T09:00:00Z", "mode": "rain"}],
              "trim": {"start": "2026-07-04T08:30:00Z"},
              "cover": "m4"
            }
            """.trimIndent(),
        )
        val nachher = withMediumCaption(vorher, "m1", "Bucht")

        assertEquals(vorher["kamera"], nachher["kamera"])
        assertEquals(vorher["audio"], nachher["audio"])
        assertEquals(vorher["wetter"], nachher["wetter"])
        assertEquals(vorher["trim"], nachher["trim"])
        assertEquals(vorher["cover"], nachher["cover"])
    }

    @Test
    fun `andere Medien und deren Einstellungen bleiben erhalten`() {
        val vorher = read(
            """
            {
              "schema": "maptale/edits@2",
              "media": {
                "m1": {"caption": "Alt", "display": {"holdS": 5, "kenBurns": true}},
                "m2": {"geloescht": true}
              }
            }
            """.trimIndent(),
        )
        val media = withMediumCaption(vorher, "m1", "Neu")["media"]!!.jsonObject

        assertEquals("Neu", media["m1"]!!.jsonObject["caption"]!!.jsonPrimitive.content)
        // Anzeige-Optionen desselben Mediums überleben die Titeländerung
        assertEquals(5, media["m1"]!!.jsonObject["display"]!!.jsonObject["holdS"]!!.jsonPrimitive.content.toInt())
        assertEquals(true, media["m2"]!!.jsonObject["geloescht"]!!.jsonPrimitive.content.toBoolean())
    }

    @Test
    fun `geleerter Titel wird ausdruecklich geleert, nicht weggelassen`() {
        // Das Overlay unterscheidet '' (leeren) von „Feld fehlt" (Original behalten)
        val nachher = withMediumCaption(read("""{"schema":"maptale/edits@2"}"""), "m1", "   ")
        val eintrag = nachher["media"]!!.jsonObject["m1"]!!.jsonObject
        assertTrue(eintrag.containsKey("caption"))
        assertEquals("", eintrag["caption"]!!.jsonPrimitive.content)
    }

    @Test
    fun `Titelbild setzen laesst Medien-Titel stehen`() {
        val mitTitel = withMediumCaption(read("""{"schema":"maptale/edits@2"}"""), "m1", "Bucht")
        val nachher = withCover(mitTitel, "m1")

        assertEquals("m1", nachher["cover"]!!.jsonPrimitive.content)
        assertEquals("Bucht", nachher["media"]!!.jsonObject["m1"]!!.jsonObject["caption"]!!.jsonPrimitive.content)
    }
}
