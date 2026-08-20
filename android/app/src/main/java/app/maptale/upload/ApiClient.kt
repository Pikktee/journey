// Schlanker HTTP-Client fürs Maptale-Backend (OkHttp, 4 Endpunkte — Retrofit
// wäre Overhead). Alle Aufrufe sind suspend und laufen auf Dispatchers.IO.
package app.maptale.upload

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import app.maptale.aufzeichnung.Spurpunkt
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
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
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okio.BufferedSink
import okio.source
import java.io.File
import java.util.concurrent.TimeUnit

class ApiFehler(val status: Int, nachricht: String) : Exception("HTTP $status: $nachricht")

/** Eine Server-Tour aus GET /api/tours (auch die im Web-Studio erstellten). */
data class ServerTour(
    val id: String,
    val no: String,
    val titel: String?,
    /** ready | processing | created | failed */
    val status: String,
    val km: Double?,
    /** Aufgestiegene Höhenmeter (für die Reise-Statistik im Profil) */
    val hoehenmeter: Double?,
    /** private | unlisted | public */
    val visibility: String,
    /** Titelbild-Pfad relativ zum Server (/api/media/…); null vor dem ersten Render */
    val cover: String?,
    /** Kachel-Fassung des Titelbilds; null bei Touren ohne aufbereitete Fassungen */
    val coverThumb: String?,
    /** ISO-Zeitstempel des Anlegens — sortiert die verschmolzene Liste */
    val erstelltAm: String,
) {
    val spielbar get() = status == "ready"
}

/**
 * Was eine fertige Tour über die Listen-Angaben hinaus hergibt — aus dem
 * gerenderten Tour-JSON (GET /api/tours/:id).
 */
data class ServerTourDetail(
    val beschreibung: String?,
    val fotos: List<Serverfoto>,
    /** Der gefahrene/gegangene Weg als Linie für die Skizze; leer ohne Track. */
    val route: List<Spurpunkt>,
)

/** Ein Medium der Tour, wie es die App anzeigt. */
data class Serverfoto(
    val id: String,
    /** Serverpfad des anzeigbaren Bildes (/api/media/…) */
    val pfad: String,
    /** Kachel-Fassung für das Raster; null bei unaufbereitetem Altbestand */
    val thumb: String?,
    /** Was im Player als Überschrift steht — Nutzertext oder „Foto · 14:32“. */
    val titel: String?,
    /**
     * Der vom Nutzer gesetzte Text, leer wenn keiner.
     *
     * Im Tour-JSON tauschen die beiden Felder je nach Fall die Rollen: Gibt es
     * einen Nutzertext, wird er zum `title` und die Uhrzeit rutscht in
     * `caption`; sonst steht die Uhrzeit im `title` und `caption` ist leer. Eine
     * gefüllte `caption` ist also das Zeichen dafür, dass `title` von Hand
     * gesetzt wurde (s. server/src/pipeline/enrich.ts).
     */
    val nutzertext: String,
    /**
     * „Foto · 21:03" — die Maschinenangabe, aus dem Rollentausch oben wieder
     * herausgerechnet. Sie steht in der Ansicht IMMER über dem Titel: Wann ein
     * Bild entstand, bleibt auch dann interessant, wenn es einen Namen hat.
     */
    val zeitzeile: String?,
    /** Videos zeigen als Kachel ihr Standbild — abgespielt wird die Datei. */
    val istVideo: Boolean,
    /** Serverpfad der abspielbaren Datei; bei Fotos gleich [pfad]. */
    val quellPfad: String,
    /**
     * Wo am Track das Medium hängt — für den Punkt auf der Routenskizze. Beide
     * null, wenn der Server es nicht platzieren konnte (kein GPS beim Auslösen,
     * Aufnahmezeit außerhalb der Tour); der Player überspringt solche Medien,
     * die Skizze lässt sie entsprechend aus.
     */
    val anchorLng: Double?,
    val anchorLat: Double?,
    /**
     * Aufnahmezeitpunkt (ISO) aus dem Manifest.
     *
     * Nicht für die Anzeige — dafür gibt es `zeitzeile` — sondern damit der
     * Foto-Nachzug erkennt, was die Tour SCHON hat: Ohne diesen Abgleich käme
     * derselbe Vorschlag bei jedem Öffnen wieder, auch für den, der ihn eben
     * abgelehnt hat.
     */
    val aufgenommenIso: String?,
)

/** Konto-Auskunft aus GET /api/auth/me. */
data class KontoStand(
    val email: String,
    val name: String?,
    val verifiziert: Boolean,
    val benutztBytes: Long,
    val limitBytes: Long,
    val profil: ProfilStand,
) {
    /** Anteil des belegten Kontingents (0..1); 0 wenn kein Limit gemeldet wurde. */
    val quotaAnteil: Float get() = if (limitBytes > 0) (benutztBytes.toDouble() / limitBytes).toFloat() else 0f
}

/**
 * Das öffentliche Profil — getrennt vom Konto.
 *
 * `anzeigename` ist NICHT der Klarname aus der Registrierung: wer sich mit
 * seinem echten Namen anmeldet, veröffentlicht ihn nicht nebenbei.
 */
data class ProfilStand(
    val anzeigename: String?,
    val bio: String?,
    /** Serverpfad des Profilbilds; null = keins gesetzt */
    val avatarUrl: String?,
    val oeffentlich: Boolean,
)

/**
 * Ein verbindbarer Sport-Tracker (Polar & Co.) samt Zustand — Spiegelbild von
 * `GET /api/tracker/providers`.
 *
 * Die App bringt KEIN Anbieter-SDK mit und kennt auch kein OAuth: Sie holt
 * eine Autorisierungs-URL vom eigenen Server, öffnet sie im Browser und wird
 * per Deep Link zurückgerufen. Alles Übrige — Tokens, Webhooks, Importe —
 * bleibt serverseitig, wo es hingehört (Konzept, Abschnitt 2).
 */
data class TrackerAnbieter(
    val id: String,
    val name: String,
    /** Zugangsdaten auf dem Server hinterlegt; sonst gibt es nichts zu verbinden. */
    val verfuegbar: Boolean,
    val verbunden: Boolean,
    /** `active` · `expired` · `disconnected` — oder null, wenn nie verbunden. */
    val status: String?,
    val fehler: String?,
) {
    /** Der Zugang ist tot und muss neu erteilt werden — nicht dasselbe wie „nie verbunden". */
    val abgelaufen get() = status == "expired"
}

/**
 * Ein nachzureichendes Foto — die ID vergibt der SERVER (s. `medienNachreichen`).
 *
 * `anker` ist [lng, lat] wie im Manifest und OPTIONAL: Fehlt er, platziert der
 * Server über die Aufnahmezeit am Track. Genau deshalb funktioniert der
 * Foto-Nachzug auch mit Bildern ohne GPS — und das ist der Normalfall, seit
 * Android den Ort ohne eigene Erlaubnis aus dem EXIF entfernt.
 */
data class NachreichMedium(
    val dateiname: String,
    val aufgenommenIso: String,
    val anker: Pair<Double, Double>? = null,
    /**
     * `photo` oder `video` — der Server prüft die Dateiendung GEGEN diesen
     * Wert und weist den ganzen Stapel mit 400 ab, wenn beides nicht
     * zusammenpasst.
     */
    val istVideo: Boolean = false,
    /**
     * Woher das Bild stammt (`galerie:<MediaStore-ID>`) — der Idempotenz-
     * Schlüssel des Nachreichens.
     *
     * Er ist der Grund, warum ein wiederholter Nachzug keine Doppel erzeugt:
     * Der Server legt eine bekannte `quelle` kein zweites Mal an, sondern gibt
     * die vorhandene Zuordnung zurück. Ohne ihn müsste die App wissen, was die
     * Tour schon hat — und das weiß sie erst NACH dem Rendern.
     */
    val quelle: String? = null,
)

/** Ein Import aus `GET /api/tracker/imports/pending` — die Grundlage der Meldung. */
data class TrackerImport(
    val id: String,
    val anbieter: String,
    val status: String,
    val tourId: String?,
    val fehler: String?,
)

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
                put("password", passwort)
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

    /**
     * Medien zu einer BESTEHENDEN Tour anmelden — additiv, das Manifest wächst.
     *
     * Der Weg des Foto-Nachzugs zu Cloud-Touren (und im Studio des
     * Nachreichens). Die IDs vergibt der SERVER, anders als beim Anlegen: Dort
     * braucht es sie für die idempotente Wiederholung, hier garantieren sie,
     * dass keine kollidiert und keine je wiederverwendet wird.
     *
     * Zurück kommt die Zuordnung in der Reihenfolge der Anfrage — je Eintrag
     * die Medien-ID, mit der danach `mediumHochladen` läuft.
     */
    suspend fun medienNachreichen(serverTourId: String, medien: List<NachreichMedium>): List<String> =
        withContext(Dispatchers.IO) {
            if (medien.isEmpty()) return@withContext emptyList()
            val koerper = buildJsonObject {
                put(
                    "media",
                    JsonArray(
                        medien.map { m ->
                            buildJsonObject {
                                put("type", JsonPrimitive(if (m.istVideo) "video" else "photo"))
                                put("file", JsonPrimitive(m.dateiname))
                                put("takenAt", JsonPrimitive(m.aufgenommenIso))
                                m.anker?.let { (lng, breite) ->
                                    put("anchor", JsonArray(listOf(JsonPrimitive(lng), JsonPrimitive(breite))))
                                }
                                m.quelle?.let { put("source", JsonPrimitive(it)) }
                            }
                        },
                    ),
                )
            }.toString().toRequestBody(jsonTyp)
            val antwort = ausfuehren(autorisiert("/api/tours/$serverTourId/media").post(koerper).build())
            val liste = antwort["media"] as? JsonArray ?: return@withContext emptyList()
            liste.mapNotNull { (it as? JsonObject)?.get("id")?.jsonPrimitive?.contentOrNull }
        }

    /**
     * Ein Medium aus einem beliebigen Datenstrom hochladen.
     *
     * Für Galeriebilder: Sie liegen nicht als `File` im App-Verzeichnis,
     * sondern hinter einem `content://`-Uri, den nur der ContentResolver
     * öffnen kann. Der Strom wird dabei GESTREAMT und nicht in den Speicher
     * gelesen — ein Rohfoto sind schnell zwanzig Megabyte, und der Nachzug
     * lädt gleich mehrere.
     */
    suspend fun mediumHochladen(serverTourId: String, mediumId: String, oeffne: () -> java.io.InputStream) {
        withContext(Dispatchers.IO) {
            val koerper = object : RequestBody() {
                override fun contentType() = "application/octet-stream".toMediaType()
                override fun writeTo(senke: BufferedSink) {
                    oeffne().use { strom -> senke.writeAll(strom.source()) }
                }
            }
            ausfuehren(autorisiert("/api/tours/$serverTourId/media/$mediumId").put(koerper).build())
        }
    }

    /**
     * Neu verarbeiten — nötig, damit nachgereichte Medien im Film auftauchen.
     *
     * Der Server rendert dabei aus seinem Anreicherungs-Cache; Geocoding,
     * Wetter und Bildanalyse laufen nicht erneut, nur die neuen Fotos werden
     * analysiert und platziert.
     */
    suspend fun neuVerarbeiten(serverTourId: String) {
        withContext(Dispatchers.IO) {
            ausfuehren(autorisiert("/api/tours/$serverTourId/reprocess").post("".toRequestBody()).build())
        }
    }

    /**
     * Das Zeitfenster einer fertigen Tour (`time.start`/`time.end` aus dem
     * gerenderten Tour-JSON) — die Grundlage des Galerie-Scans.
     *
     * Null, solange die Tour nicht „bereit" ist: Dann gibt es kein Tour-JSON,
     * und ohne Fenster wird auch nicht in der Galerie gesucht.
     */
    suspend fun tourZeitfenster(serverTourId: String): Pair<String, String>? = withContext(Dispatchers.IO) {
        val antwort = ausfuehren(autorisiert("/api/tours/$serverTourId").get().build())
        val zeit = antwort["time"] as? JsonObject ?: return@withContext null
        val start = zeit["start"]?.jsonPrimitive?.contentOrNull ?: return@withContext null
        val ende = zeit["end"]?.jsonPrimitive?.contentOrNull ?: return@withContext null
        start to ende
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
                coverThumb = obj["coverThumb"]?.jsonPrimitive?.contentOrNull,
                erstelltAm = obj["createdAt"]?.jsonPrimitive?.contentOrNull ?: "",
            )
        }
    }

    /** Konto-Auskunft (E-Mail, Bestätigungsstand, Kontingent). */
    suspend fun kontoStand(): KontoStand = withContext(Dispatchers.IO) {
        val antwort = ausfuehren(autorisiert("/api/auth/me").get().build())
        val benutzer = antwort["user"] as? JsonObject ?: throw ApiFehler(401, "Nicht angemeldet")
        val quota = antwort["quota"] as? JsonObject
        val profil = antwort["profile"] as? JsonObject
        KontoStand(
            email = benutzer["email"]?.jsonPrimitive?.contentOrNull ?: "",
            name = benutzer["name"]?.jsonPrimitive?.contentOrNull,
            verifiziert = antwort["verified"]?.jsonPrimitive?.booleanOrNull ?: true,
            benutztBytes = quota?.get("used")?.jsonPrimitive?.longOrNull ?: 0,
            limitBytes = quota?.get("limit")?.jsonPrimitive?.longOrNull ?: 0,
            profil = ProfilStand(
                anzeigename = profil?.get("displayName")?.jsonPrimitive?.contentOrNull,
                bio = profil?.get("bio")?.jsonPrimitive?.contentOrNull,
                avatarUrl = profil?.get("avatarUrl")?.jsonPrimitive?.contentOrNull,
                oeffentlich = profil?.get("visibility")?.jsonPrimitive?.contentOrNull == "public",
            ),
        )
    }

    /** Profilfelder ändern; nur übergebene Felder werden angefasst. */
    suspend fun setzeProfil(anzeigename: String? = null, bio: String? = null, oeffentlich: Boolean? = null) {
        withContext(Dispatchers.IO) {
            val body = buildJsonObject {
                anzeigename?.let { put("displayName", it) }
                bio?.let { put("bio", it) }
                oeffentlich?.let { put("visibility", if (it) "public" else "private") }
            }.toString().toRequestBody(jsonTyp)
            ausfuehren(autorisiert("/api/auth/me/profile").patch(body).build())
        }
    }

    /** Profilbild setzen (fertig skaliertes JPEG); liefert die neue Adresse. */
    suspend fun setzeAvatar(jpeg: ByteArray): String = withContext(Dispatchers.IO) {
        val antwort = ausfuehren(
            autorisiert("/api/auth/me/avatar")
                .put(jpeg.toRequestBody("image/jpeg".toMediaType()))
                .build(),
        )
        antwort["avatarUrl"]?.jsonPrimitive?.contentOrNull ?: throw ApiFehler(200, "Antwort ohne avatarUrl")
    }

    suspend fun loescheAvatar() {
        withContext(Dispatchers.IO) { ausfuehren(autorisiert("/api/auth/me/avatar").delete().build()) }
    }

    /**
     * Konto endgültig löschen — mitsamt allen Touren, Medien und dem Profil.
     * Der Server räumt auch die Dateiablage; danach ist das Token wertlos.
     */
    suspend fun loescheKonto() {
        withContext(Dispatchers.IO) { ausfuehren(autorisiert("/api/auth/me").delete().build()) }
    }

    /** Sichtbarkeit ändern (privat | ungelistet | öffentlich). */
    suspend fun setzeSichtbarkeit(serverTourId: String, sichtbarkeit: String) {
        withContext(Dispatchers.IO) {
            val body = buildJsonObject { put("visibility", sichtbarkeit) }.toString().toRequestBody(jsonTyp)
            ausfuehren(autorisiert("/api/tours/$serverTourId").patch(body).build())
        }
    }

    /**
     * Beschreibung und Medien einer fertigen Tour.
     *
     * Der Endpunkt liefert das gerenderte Tour-JSON — dieselbe Datei, die auch
     * der Player liest. Für die App zählen daraus nur Beschreibung und Medien;
     * Titel, Kilometer und Titelbild kommen aus der Liste.
     */
    suspend fun tourDetail(serverTourId: String): ServerTourDetail = withContext(Dispatchers.IO) {
        val antwort = ausfuehren(autorisiert("/api/tours/$serverTourId").get().build())
        val medien = antwort["media"] as? JsonArray ?: JsonArray(emptyList())
        // Die Segmente aneinanderhängen zu EINER Linie: Für die Skizze zählt die
        // Form des ganzen Weges, nicht wo ein Modus in den nächsten übergeht.
        val segmente = antwort["segments"] as? JsonArray ?: JsonArray(emptyList())
        val route = segmente.flatMap { seg ->
            (seg as? JsonObject)?.get("pts") as? JsonArray ?: JsonArray(emptyList())
        }.mapNotNull { punkt ->
            val paar = punkt as? JsonArray ?: return@mapNotNull null
            val lng = paar.getOrNull(0)?.jsonPrimitive?.doubleOrNull
            val lat = paar.getOrNull(1)?.jsonPrimitive?.doubleOrNull
            if (lng == null || lat == null) null else Spurpunkt(lng, lat)
        }
        ServerTourDetail(
            beschreibung = antwort["description"]?.jsonPrimitive?.contentOrNull,
            route = route,
            fotos = medien.mapNotNull { element ->
                val obj = element as? JsonObject ?: return@mapNotNull null
                val src = obj["src"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
                val titel = obj["title"]?.jsonPrimitive?.contentOrNull
                val zeitzeile = obj["caption"]?.jsonPrimitive?.contentOrNull.orEmpty()
                // `anchor` ist [lng,lat] oder JSON-null — beides fängt das as?
                val anker = obj["anchor"] as? JsonArray
                Serverfoto(
                    id = obj["id"]?.jsonPrimitive?.contentOrNull ?: src,
                    // Bei Videos zeigt das Standbild, was zu sehen ist — die
                    // Datei selbst kann kein Bildbetrachter darstellen.
                    pfad = obj["poster"]?.jsonPrimitive?.contentOrNull ?: src,
                    thumb = obj["thumb"]?.jsonPrimitive?.contentOrNull,
                    titel = titel,
                    nutzertext = if (zeitzeile.isNotBlank()) titel.orEmpty() else "",
                    zeitzeile = if (zeitzeile.isNotBlank()) zeitzeile else titel,
                    istVideo = obj["type"]?.jsonPrimitive?.contentOrNull == "video",
                    quellPfad = src,
                    anchorLng = anker?.getOrNull(0)?.jsonPrimitive?.doubleOrNull,
                    anchorLat = anker?.getOrNull(1)?.jsonPrimitive?.doubleOrNull,
                    aufgenommenIso = obj["takenAt"]?.jsonPrimitive?.contentOrNull,
                )
            },
        )
    }

    /** Tour beim Server löschen — endgültig, samt Medien. */
    suspend fun loescheTour(serverTourId: String) {
        withContext(Dispatchers.IO) {
            ausfuehren(autorisiert("/api/tours/$serverTourId").delete().build())
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
        val antwort = ausfuehren(autorisiert("/api/auth/session-from-token").post("".toRequestBody()).build())
        antwort["sessionId"]?.jsonPrimitive?.contentOrNull ?: throw ApiFehler(200, "Antwort ohne sessionId")
    }

    // — Verbundene Dienste (Tracker) —

    suspend fun trackerAnbieter(): List<TrackerAnbieter> = withContext(Dispatchers.IO) {
        val antwort = ausfuehren(autorisiert("/api/tracker/providers").get().build())
        val liste = antwort["provider"] as? JsonArray ?: return@withContext emptyList()
        liste.mapNotNull { element ->
            val obj = element as? JsonObject ?: return@mapNotNull null
            val id = obj["id"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
            TrackerAnbieter(
                id = id,
                name = obj["name"]?.jsonPrimitive?.contentOrNull ?: id,
                verfuegbar = obj["available"]?.jsonPrimitive?.booleanOrNull ?: false,
                verbunden = obj["connected"]?.jsonPrimitive?.booleanOrNull ?: false,
                status = obj["status"]?.jsonPrimitive?.contentOrNull,
                fehler = obj["error"]?.jsonPrimitive?.contentOrNull,
            )
        }
    }

    /**
     * Die Adresse, an der der Nutzer die Verknüpfung erlaubt.
     *
     * `ziel = app` sorgt dafür, dass der Server nach dem Token-Tausch auf den
     * Deep Link zurückleitet statt auf die Kontoseite — sonst bliebe der
     * Browser stehen und die App erführe nie, dass sie fertig ist.
     */
    suspend fun trackerVerbindenUrl(anbieterId: String): String = withContext(Dispatchers.IO) {
        val koerper = """{"ziel":"app"}""".toRequestBody(jsonTyp)
        val antwort = ausfuehren(autorisiert("/api/tracker/$anbieterId/connect").post(koerper).build())
        antwort["authorizationUrl"]?.jsonPrimitive?.contentOrNull
            ?: throw ApiFehler(200, "Antwort ohne Autorisierungs-URL")
    }

    suspend fun trackerTrennen(anbieterId: String) {
        withContext(Dispatchers.IO) { ausfuehren(autorisiert("/api/tracker/$anbieterId").delete().build()) }
    }

    /**
     * Die Importe, die der Nutzer noch nicht gesehen hat, NAMENTLICH abhaken.
     *
     * Der Weg für alles, was erst meldet und dann quittiert: Was nicht gezeigt
     * werden konnte, bleibt offen und kommt beim nächsten Lauf wieder. Mit
     * `quittieren = true` beim Holen wäre es umgekehrt — dort gilt schon als
     * gesehen, was nur GELESEN wurde.
     */
    suspend fun trackerImporteGesehen(ids: List<String>) {
        if (ids.isEmpty()) return
        withContext(Dispatchers.IO) {
            val koerper = buildJsonObject { put("ids", JsonArray(ids.map { JsonPrimitive(it) })) }
                .toString()
                .toRequestBody(jsonTyp)
            ausfuehren(autorisiert("/api/tracker/imports/seen").post(koerper).build())
        }
    }

    /**
     * Was seit dem letzten Blick angekommen ist.
     *
     * `quittieren` setzt den Gesehen-Vermerk auf dem SERVER — nur so meldet
     * ein zweites Gerät am selben Konto dieselbe Tour nicht ein zweites Mal.
     * Wer erst melden und dann abhaken will, holt OHNE und quittiert
     * anschließend mit `trackerImporteGesehen`.
     */
    suspend fun trackerOffeneImporte(quittieren: Boolean): List<TrackerImport> = withContext(Dispatchers.IO) {
        val pfad = "/api/tracker/imports/pending" + if (quittieren) "?seen=1" else ""
        val antwort = ausfuehren(autorisiert(pfad).get().build())
        val liste = antwort["imports"] as? JsonArray ?: return@withContext emptyList()
        liste.mapNotNull { element ->
            val obj = element as? JsonObject ?: return@mapNotNull null
            val id = obj["id"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
            TrackerImport(
                id = id,
                anbieter = obj["provider"]?.jsonPrimitive?.contentOrNull ?: "",
                status = obj["status"]?.jsonPrimitive?.contentOrNull ?: "",
                tourId = obj["tourId"]?.jsonPrimitive?.contentOrNull,
                fehler = obj["error"]?.jsonPrimitive?.contentOrNull,
            )
        }
    }

    /**
     * Den FCM-Token beim eigenen Server hinterlegen.
     *
     * `false` heißt: Der Server hat kein Dienstkonto, Push gibt es dort nicht.
     * Das ist eine Auskunft, kein Fehler — die App bleibt dann bei ihrem
     * periodischen Abruf, statt einen Token zu pflegen, an den nie etwas geht.
     */
    suspend fun pushGeraetAnmelden(token: String): Boolean = withContext(Dispatchers.IO) {
        val koerper = buildJsonObject {
            put("token", JsonPrimitive(token))
            put("platform", JsonPrimitive("android"))
        }.toString().toRequestBody(jsonTyp)
        val antwort = ausfuehren(autorisiert("/api/push/devices").post(koerper).build())
        antwort["push"]?.jsonPrimitive?.booleanOrNull == true
    }

    suspend fun pushGeraetAbmelden(token: String) {
        withContext(Dispatchers.IO) {
            val koerper = buildJsonObject { put("token", JsonPrimitive(token)) }.toString().toRequestBody(jsonTyp)
            ausfuehren(autorisiert("/api/push/devices").delete(koerper).build())
        }
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
                    json.parseToJsonElement(text).let { (it as? JsonObject)?.get("error")?.jsonPrimitive?.content }
                }.getOrNull()
                throw ApiFehler(antwort.code, detail ?: text.take(200))
            }
            return runCatching { json.parseToJsonElement(text) as JsonObject }.getOrElse { JsonObject(emptyMap()) }
        }
    }
}
