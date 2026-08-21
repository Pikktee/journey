// Das Edit-Overlay einer hochgeladenen Tour ändern, ohne fremde Arbeit zu
// zerstören.
//
// Nach dem Upload liegen Titel und Titelbild nicht mehr im Manifest, sondern im
// Overlay (edits.json) — und dort steht möglicherweise noch viel mehr: Kamera-
// Presets, Momente, Musikspuren, Wetterkorrekturen aus dem Studio. Die App
// kennt davon nichts und darf davon auch nichts kennen müssen. Deshalb wird das
// Overlay als ROHES JsonObject fortgeschrieben und nur der eine Schlüssel
// ersetzt; würde man es in ein App-Modell parsen und zurückschreiben, fielen
// alle unbekannten Felder still unter den Tisch.
package app.maptale.upload

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject

const val EDITS_SCHEMA = "maptale/edits@2"

/**
 * Nutzertext eines Mediums setzen. Ein leerer Text wird als leerer String
 * abgelegt — das Overlay unterscheidet „ausdrücklich geleert" ('') von „nicht
 * angefasst" (Feld fehlt).
 */
fun withMediumCaption(overlay: JsonObject, mediumId: String, title: String?): JsonObject {
    val media = overlay["media"]?.jsonObject ?: JsonObject(emptyMap())
    val entry = media[mediumId]?.jsonObject ?: JsonObject(emptyMap())
    val newEntry = ersetze(entry, "caption", JsonPrimitive(title?.trim().orEmpty()))
    return ersetze(grundgeruest(overlay), "media", ersetze(media, mediumId, newEntry))
}

/** Titelbild der Tour festlegen. */
fun withCover(overlay: JsonObject, mediumId: String): JsonObject =
    ersetze(grundgeruest(overlay), "cover", JsonPrimitive(mediumId))

/**
 * Overlay unverändert übernehmen, aber das Schema-Feld sicherstellen: Bei einer
 * Tour ohne edits.json antwortet der Server nur mit dem Schema, und ohne dieses
 * Feld weist die strenge Prüfung beim Speichern das Overlay ab.
 */
private fun grundgeruest(overlay: JsonObject): JsonObject =
    ersetze(overlay, "schema", JsonPrimitive(EDITS_SCHEMA))

/** Einen Schlüssel setzen; alle übrigen bleiben, wie sie sind. */
private fun ersetze(objekt: JsonObject, key: String, value: JsonElement): JsonObject =
    JsonObject(LinkedHashMap(objekt).also { it[key] = value })
