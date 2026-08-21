// Room-Schema der Aufzeichnung. Alles landet zuerst lokal (Flush alle 30 s im
// Service) — der Upload ist entkoppelt und pro Medium wiederaufnehmbar.
package app.maptale.data

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/** Zustand einer Tour über ihren Lebenszyklus in der App. */
enum class TourStatus { RECORDING, DRAFT, UPLOADING, UPLOADED, FAILED }

/** Fortbewegungsmittel — Werte identisch zum Austauschformat `maptale/upload@2`. */
enum class TravelMode(val key: String, val label: String) {
    WALK("walk", "Zu Fuß"),
    BIKE("bike", "Rad"),
    MOPED("moped", "Moped"),
    JEEP("jeep", "Jeep"),
    TRAM("tram", "Tram"),
    FERRY("ferry", "Fähre"),
    ;

    companion object {
        fun fromKey(s: String): TravelMode = entries.firstOrNull { it.key == s } ?: WALK
    }
}

@Entity(tableName = "tours")
data class TourEntity(
    /** App-lokale ID; geht als clientTourId zum Backend (idempotentes Anlegen) */
    @PrimaryKey val id: String,
    val title: String?,
    val description: String?,
    /** Epoche ms des Aufnahme-Starts */
    val startMs: Long,
    /** Epoche ms des Aufnahme-Endes; null solange die Aufnahme läuft */
    val endMs: Long?,
    /** IANA-Zeitzone zum Aufnahmezeitpunkt */
    val zone: String,
    val status: TourStatus,
    /** Vom Backend vergebene Tour-ID (t_…), sobald hochgeladen */
    val serverId: String? = null,
    val error: String? = null,
    /** Distanz in Metern (laufend gepflegt, für die Liste ohne Punkt-Query) */
    val distanceM: Double = 0.0,
    /**
     * Wurde die Fortbewegung erkannt statt gewählt? („Automatisch" im Startblatt)
     *
     * Geht als `travelModesAuto` ins Upload-Manifest und erlaubt dem Server, die
     * Aufteilung zu verfeinern — etwa ein Fahrzeug an seiner Trasse als
     * Straßenbahn zu erkennen. Wer den Modus selbst gewählt hat, wird nie
     * überstimmt, deshalb muss der Unterschied mitreisen: Der Server sieht sonst
     * nur „walk" und kann eine Angabe nicht von einer Vorgabe unterscheiden.
     */
    val travelModeAuto: Boolean = false,
)

@Entity(
    tableName = "track_points",
    indices = [Index("tourId")],
)
data class TrackPointEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val tourId: String,
    val lng: Double,
    val lat: Double,
    val ele: Double,
    /** Sekunden seit Tour-Start (tOffset des Austauschformats) */
    val tOffsetS: Double,
    val accuracyM: Float,
)

@Entity(
    tableName = "travel_mode_changes",
    indices = [Index("tourId")],
)
data class TravelModeChangeEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val tourId: String,
    /** Sekunden seit Tour-Start, ab denen der Modus gilt */
    val tOffsetS: Double,
    val travelMode: TravelMode,
)

/** Upload-Zustand je Medium — macht den Upload pro Datei wiederaufnehmbar. */
enum class MediumUploadStatus { LOCAL, UPLOADED }

@Entity(
    tableName = "media",
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
    val type: String,
    /** Dateipfad relativ zu filesDir */
    val file: String,
    /** Epoche ms der Aufnahme */
    val takenAtMs: Long,
    /** GPS-Anker (letzter Trackpunkt beim Auslösen); null falls keiner da war */
    val anchorLng: Double?,
    val anchorLat: Double?,
    val uploadStatus: MediumUploadStatus = MediumUploadStatus.LOCAL,
    /**
     * Der eine Nutzertext zum Medium — in der Oberfläche „Titel", im Manifest
     * `caption`, im fertigen Tour-JSON `title` (der Player zeigt ihn als
     * Überschrift des Foto-Stopps). null = nie beschriftet.
     */
    val caption: String? = null,
)
