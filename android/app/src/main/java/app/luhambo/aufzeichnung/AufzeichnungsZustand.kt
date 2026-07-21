// Geteilter Live-Zustand der laufenden Aufzeichnung: der Service schreibt,
// die UI (und die Kamera für den Foto-Anker) lesen per StateFlow. Bewusst ein
// Prozess-Singleton statt Service-Binding — überlebt Recompositions und
// Config-Changes ohne Binder-Zeremonie.
package app.luhambo.aufzeichnung

import app.luhambo.daten.Modus
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

data class LaufendeAufzeichnung(
    val tourId: String,
    val startMs: Long,
    val modus: Modus,
    val distanzM: Double = 0.0,
    val punktAnzahl: Int = 0,
    val pausiert: Boolean = false,
    /** Letzte akzeptierte Position — Anker für Fotos (robuster als Foto-EXIF) */
    val letzterPunkt: RohPunkt? = null,
    /**
     * Der bisherige Weg als Linie für die Skizze auf dem Aufnahme-Screen.
     *
     * Liegt hier und nicht in der Datenbank, weil die Punkte dort nur alle
     * 30 Sekunden gebündelt ankommen — die Linie soll aber mitwachsen, während
     * man geht. Gedeckelt auf [SPUR_HOECHSTZAHL], sonst wüchse sie über eine
     * Tagestour unbegrenzt.
     */
    val spur: List<Spurpunkt> = emptyList(),
)

object AufzeichnungsZustand {
    private val intern = MutableStateFlow<LaufendeAufzeichnung?>(null)
    val aktuell: StateFlow<LaufendeAufzeichnung?> = intern

    fun starte(tourId: String, startMs: Long, modus: Modus) {
        intern.value = LaufendeAufzeichnung(tourId, startMs, modus)
    }

    fun aktualisiere(aenderung: (LaufendeAufzeichnung) -> LaufendeAufzeichnung) {
        intern.value = intern.value?.let(aenderung)
    }

    fun beende() {
        intern.value = null
    }
}
