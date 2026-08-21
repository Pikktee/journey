// Geteilter Live-Zustand der laufenden Aufzeichnung: der Service schreibt,
// die UI (und die Kamera für den Foto-Anker) lesen per StateFlow. Bewusst ein
// Prozess-Singleton statt Service-Binding — überlebt Recompositions und
// Config-Changes ohne Binder-Zeremonie.
package app.maptale.recording

import app.maptale.data.TravelMode
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

data class ActiveRecording(
    val tourId: String,
    val startMs: Long,
    val travelMode: TravelMode,
    val distanceM: Double = 0.0,
    val pointCount: Int = 0,
    val paused: Boolean = false,
    /** Letzte akzeptierte Position — Anker für Fotos (robuster als Foto-EXIF) */
    val lastPoint: RawPoint? = null,
    /**
     * Der bisherige Weg als Linie für die Skizze auf dem Aufnahme-Screen.
     *
     * Liegt hier und nicht in der Datenbank, weil die Punkte dort nur alle
     * 30 Sekunden gebündelt ankommen — die Linie soll aber mitwachsen, während
     * man geht. Gedeckelt auf [SPUR_HOECHSTZAHL], sonst wüchse sie über eine
     * Tagestour unbegrenzt.
     */
    val track: List<TrackPoint> = emptyList(),
)

object RecordingState {
    private val intern = MutableStateFlow<ActiveRecording?>(null)
    val current: StateFlow<ActiveRecording?> = intern

    fun start(tourId: String, startMs: Long, travelMode: TravelMode) {
        intern.value = ActiveRecording(tourId, startMs, travelMode)
    }

    fun update(aenderung: (ActiveRecording) -> ActiveRecording) {
        intern.value = intern.value?.let(aenderung)
    }

    fun clear() {
        intern.value = null
    }
}
