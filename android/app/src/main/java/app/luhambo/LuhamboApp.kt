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
import app.luhambo.daten.TourStatus
import app.luhambo.upload.ApiClient
import app.luhambo.upload.Einstellungen
import app.luhambo.upload.Einstellungen.Companion.STANDARD_SERVER
import app.luhambo.upload.UploadWorker
import coil.ImageLoader
import coil.ImageLoaderFactory
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.launch
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient

class LuhamboApp : Application(), ImageLoaderFactory {

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

    /** Basis-Adresse des Servers für Bild-URLs (Titelbilder aus der Tourliste). */
    fun serverUrl(): String = einstellungen.letzterStand.serverUrl

    /**
     * Bild-Lader mit Anmeldung: Titelbilder privater Touren liefert der Server
     * nur mit Token. Der Header geht ausschließlich an unser eigenes Origin —
     * ein Token an fremde Hosts zu schicken, wäre ein Leck.
     */
    private val bildLader: ImageLoader by lazy {
        val serverHost = STANDARD_SERVER.toHttpUrlOrNull()?.host
        ImageLoader.Builder(this)
            .okHttpClient {
                OkHttpClient.Builder().addInterceptor { kette ->
                    val anfrage = kette.request()
                    val token = einstellungen.letzterStand.apiToken
                    val eigenerHost = anfrage.url.host == serverHost ||
                        anfrage.url.host == einstellungen.letzterStand.serverUrl.toHttpUrlOrNull()?.host
                    kette.proceed(
                        if (token != null && eigenerHost) {
                            anfrage.newBuilder().header("Authorization", "Bearer $token").build()
                        } else {
                            anfrage
                        },
                    )
                }.build()
            }
            .build()
    }

    override fun newImageLoader(): ImageLoader = bildLader

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
        // Kontostand mitlesen, damit der Bild-Lader synchron an das Token kommt
        einstellungen.konto.launchIn(appScope)

        appScope.launch {
            // Nach Prozess-Tod gestrandete Aufnahmen zu abschließbaren Entwürfen machen
            repository.schliesseVerwaisteAufnahmen()
            // Liegengebliebene Entwürfe nachreichen. Normalerweise übernimmt das
            // WorkManager selbst (seine Warteschlange überlebt Neustarts) — das
            // hier fängt die Fälle, in denen sie verloren ging, etwa nach einem
            // erzwungenen Beenden. Deshalb KEEP: ein wartender Versuch wird
            // nicht zurückgesetzt.
            for (tour in repository.tourenMitStatus(TourStatus.ENTWURF)) {
                if (tour.endeMs != null) UploadWorker.starte(this@LuhamboApp, tour.id, ersetzen = false)
            }
        }
    }

    companion object {
        const val KANAL_AUFZEICHNUNG = "aufzeichnung"
    }
}
