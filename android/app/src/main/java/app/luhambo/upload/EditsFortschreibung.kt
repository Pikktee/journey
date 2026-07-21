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
package app.luhambo.upload

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject

const val EDITS_SCHEMA = "luhambo/edits@1"

/**
 * Nutzertext eines Mediums setzen. Ein leerer Text wird als leerer String
 * abgelegt — das Overlay unterscheidet „ausdrücklich geleert" ('') von „nicht
 * angefasst" (Feld fehlt).
 */
fun mitMediumTitel(overlay: JsonObject, mediumId: String, titel: String?): JsonObject {
    val medien = overlay["medien"]?.jsonObject ?: JsonObject(emptyMap())
    val eintrag = medien[mediumId]?.jsonObject ?: JsonObject(emptyMap())
    val neuerEintrag = ersetze(eintrag, "caption", JsonPrimitive(titel?.trim().orEmpty()))
    return ersetze(grundgeruest(overlay), "medien", ersetze(medien, mediumId, neuerEintrag))
}

/** Titelbild der Tour festlegen. */
fun mitTitelbild(overlay: JsonObject, mediumId: String): JsonObject =
    ersetze(grundgeruest(overlay), "titelbild", JsonPrimitive(mediumId))

/**
 * Overlay unverändert übernehmen, aber das Schema-Feld sicherstellen: Bei einer
 * Tour ohne edits.json antwortet der Server nur mit dem Schema, und ohne dieses
 * Feld weist die strenge Prüfung beim Speichern das Overlay ab.
 */
private fun grundgeruest(overlay: JsonObject): JsonObject =
    ersetze(overlay, "schema", JsonPrimitive(EDITS_SCHEMA))

/** Einen Schlüssel setzen; alle übrigen bleiben, wie sie sind. */
private fun ersetze(objekt: JsonObject, schluessel: String, wert: JsonElement): JsonObject =
    JsonObject(LinkedHashMap(objekt).also { it[schluessel] = wert })
