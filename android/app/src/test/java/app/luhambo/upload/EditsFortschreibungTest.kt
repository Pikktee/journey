// Das Edit-Overlay gehört nicht der App allein: im Studio gesetzte
// Kamerafahrten, Musik und Wetterkorrekturen liegen in derselben Datei. Diese
// Tests halten fest, dass ein Foto-Titel aus der App davon nichts anfasst.
package app.luhambo.upload

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class EditsFortschreibungTest {

    private fun lies(text: String): JsonObject = Json.parseToJsonElement(text).jsonObject

    @Test
    fun `Overlay einer Tour ohne edits-Datei bekommt das Schema`() {
        // Der Server antwortet dann nur mit dem Schema-Feld; ohne es weist die
        // strenge Prüfung beim Speichern das Overlay ab.
        val neu = mitMediumTitel(lies("""{"schema":"luhambo/edits@1"}"""), "m1", "Bucht")
        assertEquals(EDITS_SCHEMA, neu["schema"]?.jsonPrimitive?.content)
        assertEquals("Bucht", neu["medien"]!!.jsonObject["m1"]!!.jsonObject["caption"]!!.jsonPrimitive.content)
    }

    @Test
    fun `fremde Felder des Studios bleiben unangetastet`() {
        val vorher = lies(
            """
            {
              "schema": "luhambo/edits@1",
              "kamera": [{"ab": "2026-07-04T09:00:00Z", "preset": "weit"}],
              "audio": [{"datei": "song.mp3", "typ": "musik", "ab": "2026-07-04T09:00:00Z"}],
              "wetter": [{"ab": "2026-07-04T09:00:00Z", "mode": "rain"}],
              "trim": {"start": "2026-07-04T08:30:00Z"},
              "titelbild": "m4"
            }
            """.trimIndent(),
        )
        val nachher = mitMediumTitel(vorher, "m1", "Bucht")

        assertEquals(vorher["kamera"], nachher["kamera"])
        assertEquals(vorher["audio"], nachher["audio"])
        assertEquals(vorher["wetter"], nachher["wetter"])
        assertEquals(vorher["trim"], nachher["trim"])
        assertEquals(vorher["titelbild"], nachher["titelbild"])
    }

    @Test
    fun `andere Medien und deren Einstellungen bleiben erhalten`() {
        val vorher = lies(
            """
            {
              "schema": "luhambo/edits@1",
              "medien": {
                "m1": {"caption": "Alt", "display": {"holdS": 5, "kenBurns": true}},
                "m2": {"geloescht": true}
              }
            }
            """.trimIndent(),
        )
        val medien = mitMediumTitel(vorher, "m1", "Neu")["medien"]!!.jsonObject

        assertEquals("Neu", medien["m1"]!!.jsonObject["caption"]!!.jsonPrimitive.content)
        // Anzeige-Optionen desselben Mediums überleben die Titeländerung
        assertEquals(5, medien["m1"]!!.jsonObject["display"]!!.jsonObject["holdS"]!!.jsonPrimitive.content.toInt())
        assertEquals(true, medien["m2"]!!.jsonObject["geloescht"]!!.jsonPrimitive.content.toBoolean())
    }

    @Test
    fun `geleerter Titel wird ausdruecklich geleert, nicht weggelassen`() {
        // Das Overlay unterscheidet '' (leeren) von „Feld fehlt" (Original behalten)
        val nachher = mitMediumTitel(lies("""{"schema":"luhambo/edits@1"}"""), "m1", "   ")
        val eintrag = nachher["medien"]!!.jsonObject["m1"]!!.jsonObject
        assertTrue(eintrag.containsKey("caption"))
        assertEquals("", eintrag["caption"]!!.jsonPrimitive.content)
    }

    @Test
    fun `Titelbild setzen laesst Medien-Titel stehen`() {
        val mitTitel = mitMediumTitel(lies("""{"schema":"luhambo/edits@1"}"""), "m1", "Bucht")
        val nachher = mitTitelbild(mitTitel, "m1")

        assertEquals("m1", nachher["titelbild"]!!.jsonPrimitive.content)
        assertEquals("Bucht", nachher["medien"]!!.jsonObject["m1"]!!.jsonObject["caption"]!!.jsonPrimitive.content)
    }
}
