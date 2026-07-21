// Schlanker HTTP-Client fürs Luhambo-Backend (OkHttp, 4 Endpunkte — Retrofit
// wäre Overhead). Alle Aufrufe sind suspend und laufen auf Dispatchers.IO.
package app.luhambo.upload

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.util.concurrent.TimeUnit

class ApiFehler(val status: Int, nachricht: String) : Exception("HTTP $status: $nachricht")

/** Eine Server-Tour aus GET /api/tours (auch die im Web-Studio erstellten). */
data class ServerTour(
    val id: String,
    val no: String,
    val titel: String?,
    /** bereit | verarbeitung | angelegt | fehler */
    val status: String,
    val km: Double?,
    /** Aufgestiegene Höhenmeter (für die Reise-Statistik im Profil) */
    val hoehenmeter: Double?,
    /** private | unlisted | public */
    val visibility: String,
    /** Titelbild-Pfad relativ zum Server (/api/media/…); null vor dem ersten Render */
    val cover: String?,
    /** ISO-Zeitstempel des Anlegens — sortiert die verschmolzene Liste */
    val erstelltAm: String,
) {
    val spielbar get() = status == "bereit"
}

/** Konto-Auskunft aus GET /api/auth/me. */
data class KontoStand(
    val email: String,
    val name: String?,
    val verifiziert: Boolean,
    val benutztBytes: Long,
    val limitBytes: Long,
) {
    /** Anteil des belegten Kontingents (0..1); 0 wenn kein Limit gemeldet wurde. */
    val quotaAnteil: Float get() = if (limitBytes > 0) (benutztBytes.toDouble() / limitBytes).toFloat() else 0f
}

class ApiClient(private val einstellungen: Einstellungen) {

    private val http = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        // Medien-Uploads über Mobilfunk brauchen Luft
        .writeTimeout(120, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    private val json = Json { ignoreUnknownKeys = true }
    private val jsonTyp = "application/json; charset=utf-8".toMediaType()

    /** Login; legt zusätzlich ein App-Token an und liefert es zurück. */
    suspend fun login(serverUrl: String, email: String, passwort: String, geraet: String): String =
        withContext(Dispatchers.IO) {
            val body = buildJsonObject {
                put("email", email)
                put("passwort", passwort)
                put("tokenLabel", geraet)
            }.toString().toRequestBody(jsonTyp)
            val antwort = ausfuehren(
                Request.Builder().url("${serverUrl.trimEnd('/')}/api/auth/login").post(body).build(),
            )
            antwort["apiToken"]?.jsonPrimitive?.content
                ?: throw ApiFehler(200, "Antwort ohne apiToken")
        }

    /** POST /api/tours → Server-Tour-ID (idempotent über clientTourId). */
    suspend fun tourAnlegen(manifestJson: String): String = withContext(Dispatchers.IO) {
        val antwort = ausfuehren(
            autorisiert("/api/tours").post(manifestJson.toRequestBody(jsonTyp)).build(),
        )
        antwort["id"]?.jsonPrimitive?.content ?: throw ApiFehler(200, "Antwort ohne id")
    }

    /** PUT eines Mediums (idempotent, wiederholbar). */
    suspend fun mediumHochladen(serverTourId: String, mediumId: String, datei: File) {
        withContext(Dispatchers.IO) {
            ausfuehren(
                autorisiert("/api/tours/$serverTourId/media/$mediumId")
                    .put(datei.asRequestBody("application/octet-stream".toMediaType()))
                    .build(),
            )
        }
    }

    /** PUT des GPX-Tracks (Import, M8): rohes GPX in den Body. */
    suspend fun trackHochladen(serverTourId: String, gpx: String) {
        withContext(Dispatchers.IO) {
            ausfuehren(
                autorisiert("/api/tours/$serverTourId/track")
                    .put(gpx.toRequestBody("application/gpx+xml".toMediaType()))
                    .build(),
            )
        }
    }

    /**
     * Finalize: stößt die Anreicherung an. Wirft auch bei 409 — das kann
     * „läuft bereits" (harmlos) ODER „Medien fehlen" (echtes Problem) heißen;
     * die Unterscheidung trifft der Aufrufer semantisch über den Tour-Status.
     */
    suspend fun finalisiere(serverTourId: String) {
        withContext(Dispatchers.IO) {
            ausfuehren(autorisiert("/api/tours/$serverTourId/finalize").post("".toRequestBody()).build())
        }
    }

    /** Titel/Beschreibung serverseitig nachziehen (PATCH, idempotent). */
    suspend fun patchTour(serverTourId: String, titel: String?, beschreibung: String?) {
        if (titel == null && beschreibung == null) return
        withContext(Dispatchers.IO) {
            val body = buildJsonObject {
                titel?.let { put("title", it) }
                beschreibung?.let { put("description", it) }
            }.toString().toRequestBody(jsonTyp)
            ausfuehren(autorisiert("/api/tours/$serverTourId").patch(body).build())
        }
    }

    /** Verarbeitungs-Status der Tour (bereit | verarbeitung | fehler | angelegt). */
    suspend fun tourStatus(serverTourId: String): String = withContext(Dispatchers.IO) {
        val antwort = ausfuehren(autorisiert("/api/tours/$serverTourId").get().build())
        antwort["status"]?.jsonPrimitive?.content ?: "bereit"
    }

    /**
     * Alle eigenen Touren des angemeldeten Kontos (owner-gescopet, inkl. der im
     * Web-Studio erstellten). Der Server liefert { tours: [...] } — ohne gültiges
     * Token wirft autorisiert() 401; der Aufrufer fängt das zu einer leeren Liste.
     */
    suspend fun toureListe(): List<ServerTour> = withContext(Dispatchers.IO) {
        val antwort = ausfuehren(autorisiert("/api/tours").get().build())
        val liste = antwort["tours"] as? JsonArray ?: return@withContext emptyList()
        liste.mapNotNull { element ->
            val obj = element as? JsonObject ?: return@mapNotNull null
            val id = obj["id"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
            val stats = obj["stats"] as? JsonObject
            ServerTour(
                id = id,
                no = obj["no"]?.jsonPrimitive?.contentOrNull ?: "",
                titel = obj["title"]?.jsonPrimitive?.contentOrNull,
                status = obj["status"]?.jsonPrimitive?.contentOrNull ?: "",
                km = stats?.get("km")?.jsonPrimitive?.doubleOrNull,
                hoehenmeter = stats?.get("gainM")?.jsonPrimitive?.doubleOrNull,
                visibility = obj["visibility"]?.jsonPrimitive?.contentOrNull ?: "unlisted",
                cover = obj["cover"]?.jsonPrimitive?.contentOrNull,
                erstelltAm = obj["createdAt"]?.jsonPrimitive?.contentOrNull ?: "",
            )
        }
    }

    /** Konto-Auskunft (E-Mail, Bestätigungsstand, Kontingent). */
    suspend fun kontoStand(): KontoStand = withContext(Dispatchers.IO) {
        val antwort = ausfuehren(autorisiert("/api/auth/me").get().build())
        val benutzer = antwort["benutzer"] as? JsonObject ?: throw ApiFehler(401, "Nicht angemeldet")
        val quota = antwort["quota"] as? JsonObject
        KontoStand(
            email = benutzer["email"]?.jsonPrimitive?.contentOrNull ?: "",
            name = benutzer["name"]?.jsonPrimitive?.contentOrNull,
            verifiziert = antwort["verifiziert"]?.jsonPrimitive?.booleanOrNull ?: true,
            benutztBytes = quota?.get("benutzt")?.jsonPrimitive?.longOrNull ?: 0,
            limitBytes = quota?.get("limit")?.jsonPrimitive?.longOrNull ?: 0,
        )
    }

    /** Sichtbarkeit ändern (privat | ungelistet | öffentlich). */
    suspend fun setzeSichtbarkeit(serverTourId: String, sichtbarkeit: String) {
        withContext(Dispatchers.IO) {
            val body = buildJsonObject { put("visibility", sichtbarkeit) }.toString().toRequestBody(jsonTyp)
            ausfuehren(autorisiert("/api/tours/$serverTourId").patch(body).build())
        }
    }

    /** Edit-Overlay lesen; fehlt es, liefert der Server nur das Schema-Feld. */
    suspend fun editsLesen(serverTourId: String): JsonObject = withContext(Dispatchers.IO) {
        ausfuehren(autorisiert("/api/tours/$serverTourId/edits").get().build())
    }

    /** Edit-Overlay schreiben (der Server rendert die Tour danach neu). */
    suspend fun editsSchreiben(serverTourId: String, overlay: JsonObject) {
        withContext(Dispatchers.IO) {
            ausfuehren(
                autorisiert("/api/tours/$serverTourId/edits")
                    .put(overlay.toString().toRequestBody(jsonTyp))
                    .build(),
            )
        }
    }

    /**
     * Tauscht das API-Token gegen eine Sitzung für den WebView-Player. Der lädt
     * den Web-Player vom selben Origin und kann nur Cookies mitschicken; ohne
     * Sitzung blieben private Touren in der eigenen App unabspielbar.
     */
    suspend fun sitzungFuerPlayer(): String = withContext(Dispatchers.IO) {
        val antwort = ausfuehren(autorisiert("/api/auth/session-aus-token").post("".toRequestBody()).build())
        antwort["sessionId"]?.jsonPrimitive?.contentOrNull ?: throw ApiFehler(200, "Antwort ohne sessionId")
    }

    private suspend fun autorisiert(pfad: String): Request.Builder {
        val konto = einstellungen.aktuellesKonto()
        val token = konto.apiToken ?: throw ApiFehler(401, "Nicht angemeldet")
        return Request.Builder()
            .url("${konto.serverUrl}$pfad")
            .header("Authorization", "Bearer $token")
    }

    private fun ausfuehren(anfrage: Request): JsonObject {
        http.newCall(anfrage).execute().use { antwort ->
            val text = antwort.body?.string() ?: "{}"
            if (!antwort.isSuccessful) {
                val detail = runCatching {
                    json.parseToJsonElement(text).let { (it as? JsonObject)?.get("fehler")?.jsonPrimitive?.content }
                }.getOrNull()
                throw ApiFehler(antwort.code, detail ?: text.take(200))
            }
            return runCatching { json.parseToJsonElement(text) as JsonObject }.getOrElse { JsonObject(emptyMap()) }
        }
    }
}
