// DI-Wurzel der App (bewusst ohne Framework): baut die wenigen Singletons —
// Datenbank, Repository, Einstellungen, API-Client — und reicht sie an
// ViewModels/Service/Worker. Spiegelbild von baueApp(deps) im Backend.
package app.luhambo

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.util.Log
import app.luhambo.benennung.AndroidGeocoder
import app.luhambo.benennung.TourBenennung
import app.luhambo.daten.LuhamboDb
import app.luhambo.daten.TourRepository
import app.luhambo.upload.ApiClient
import app.luhambo.upload.Einstellungen
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class LuhamboApp : Application() {

    /** Prozessweiter Scope für Arbeit, die keine Composition überleben muss —
     *  z. B. das Registrieren eines gerade gespeicherten Fotos/Videos. Der
     *  Exception-Handler ist ein Sicherheitsnetz: ein Fehler beim Registrieren
     *  (z. B. seltene DB-Kollision) soll geloggt werden, nicht die App abschießen. */
    val appScope = CoroutineScope(
        SupervisorJob() + Dispatchers.Main.immediate +
            CoroutineExceptionHandler { _, fehler -> Log.e("Luhambo", "Unbehandelt im appScope", fehler) },
    )

    val db: LuhamboDb by lazy { LuhamboDb.baue(this) }
    val repository: TourRepository by lazy { TourRepository(db, filesDir) }
    val einstellungen: Einstellungen by lazy { Einstellungen(this) }
    val apiClient: ApiClient by lazy { ApiClient(einstellungen) }
    val benennung: TourBenennung by lazy { TourBenennung(AndroidGeocoder(this)) }

    override fun onCreate() {
        super.onCreate()
        // Kanal für die Aufzeichnungs-Notification (Pflicht des Foreground-Service)
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(
                KANAL_AUFZEICHNUNG,
                "Tour-Aufzeichnung",
                NotificationManager.IMPORTANCE_LOW,
            ).apply { description = "Läuft, während eine Tour aufgezeichnet wird" },
        )
        // Nach Prozess-Tod gestrandete Aufnahmen zu abschließbaren Entwürfen machen
        appScope.launch { repository.schliesseVerwaisteAufnahmen() }
    }

    companion object {
        const val KANAL_AUFZEICHNUNG = "aufzeichnung"
    }
}
