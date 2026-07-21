// Room-Schema der Aufzeichnung. Alles landet zuerst lokal (Flush alle 30 s im
// Service) — der Upload ist entkoppelt und pro Medium wiederaufnehmbar.
package app.luhambo.daten

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/** Zustand einer Tour über ihren Lebenszyklus in der App. */
enum class TourStatus { AUFNAHME, ENTWURF, LAEDT_HOCH, HOCHGELADEN, FEHLER }

/** Fortbewegungsmittel — Werte identisch zum Austauschformat `luhambo/upload@1`. */
enum class Modus(val schluessel: String, val anzeige: String) {
    WALK("walk", "Zu Fuß"),
    BIKE("bike", "Rad"),
    MOPED("moped", "Moped"),
    JEEP("jeep", "Jeep"),
    TRAM("tram", "Tram"),
    FERRY("ferry", "Fähre"),
    ;

    companion object {
        fun vonSchluessel(s: String): Modus = entries.firstOrNull { it.schluessel == s } ?: WALK
    }
}

@Entity(tableName = "touren")
data class TourEntity(
    /** App-lokale ID; geht als clientTourId zum Backend (idempotentes Anlegen) */
    @PrimaryKey val id: String,
    val titel: String?,
    val beschreibung: String?,
    /** Epoche ms des Aufnahme-Starts */
    val startMs: Long,
    /** Epoche ms des Aufnahme-Endes; null solange die Aufnahme läuft */
    val endeMs: Long?,
    /** IANA-Zeitzone zum Aufnahmezeitpunkt */
    val zone: String,
    val status: TourStatus,
    /** Vom Backend vergebene Tour-ID (t_…), sobald hochgeladen */
    val serverId: String? = null,
    val fehler: String? = null,
    /** Distanz in Metern (laufend gepflegt, für die Liste ohne Punkt-Query) */
    val distanzM: Double = 0.0,
)

@Entity(
    tableName = "trackpunkte",
    indices = [Index("tourId")],
)
data class TrackpunktEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val tourId: String,
    val lng: Double,
    val lat: Double,
    val ele: Double,
    /** Sekunden seit Tour-Start (tOffset des Austauschformats) */
    val tOffsetS: Double,
    val genauigkeitM: Float,
)

@Entity(
    tableName = "moduswechsel",
    indices = [Index("tourId")],
)
data class ModuswechselEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val tourId: String,
    /** Sekunden seit Tour-Start, ab denen der Modus gilt */
    val tOffsetS: Double,
    val modus: Modus,
)

/** Upload-Zustand je Medium — macht den Upload pro Datei wiederaufnehmbar. */
enum class MediumUploadStatus { LOKAL, HOCHGELADEN }

@Entity(
    tableName = "medien",
    // Medien-IDs (m1, m2, …) sind nur PRO TOUR eindeutig (so will es das
    // Austauschformat) — der Schlüssel braucht beide Spalten, sonst kollidiert
    // das erste Foto der zweiten Tour mit dem der ersten.
    primaryKeys = ["tourId", "id"],
    indices = [Index("tourId")],
)
data class MediumEntity(
    /** Tour-eindeutige Medien-ID (m1, m2, …) — Teil der Server-URL */
    val id: String,
    val tourId: String,
    /** photo | video (Video ab M4) */
    val typ: String,
    /** Dateipfad relativ zu filesDir */
    val datei: String,
    /** Epoche ms der Aufnahme */
    val aufgenommenMs: Long,
    /** GPS-Anker (letzter Trackpunkt beim Auslösen); null falls keiner da war */
    val ankerLng: Double?,
    val ankerLat: Double?,
    val uploadStatus: MediumUploadStatus = MediumUploadStatus.LOKAL,
    /**
     * Der eine Nutzertext zum Medium — in der Oberfläche „Titel", im Manifest
     * `caption`, im fertigen Tour-JSON `title` (der Player zeigt ihn als
     * Überschrift des Foto-Stopps). null = nie beschriftet.
     */
    val caption: String? = null,
)
