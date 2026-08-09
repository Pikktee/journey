// DI-Wurzel der App (bewusst ohne Framework): baut die wenigen Singletons —
// Datenbank, Repository, Einstellungen, API-Client — und reicht sie an
// ViewModels/Service/Worker. Spiegelbild von baueApp(deps) im Backend.
package app.maptale

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.util.Log
import app.maptale.benennung.AndroidGeocoder
import app.maptale.benennung.TourBenennung
import app.maptale.daten.MaptaleDb
import app.maptale.daten.TourRepository
import app.maptale.daten.TourStatus
import app.maptale.upload.ApiClient
import app.maptale.upload.Einstellungen
import app.maptale.upload.Einstellungen.Companion.STANDARD_SERVER
import app.maptale.tracker.TrackerAbfrageWorker
import app.maptale.upload.UploadWorker
import coil.ImageLoader
import coil.ImageLoaderFactory
import coil.decode.VideoFrameDecoder
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.launch
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient

class MaptaleApp : Application(), ImageLoaderFactory {

    /** Prozessweiter Scope für Arbeit, die keine Composition überleben muss —
     *  z. B. das Registrieren eines gerade gespeicherten Fotos/Videos. Der
     *  Exception-Handler ist ein Sicherheitsnetz: ein Fehler beim Registrieren
     *  (z. B. seltene DB-Kollision) soll geloggt werden, nicht die App abschießen. */
    val appScope = CoroutineScope(
        SupervisorJob() + Dispatchers.Main.immediate +
            CoroutineExceptionHandler { _, fehler -> Log.e("Maptale", "Unbehandelt im appScope", fehler) },
    )

    val db: MaptaleDb by lazy { MaptaleDb.baue(this) }
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
            // Ohne diesen Decoder kann Coil aus einer Videodatei kein Bild
            // gewinnen und zeichnet eine schwarze Fläche — genau das passierte
            // mit jedem aufgenommenen Video, in der Kachelreihe wie in der
            // Vollansicht. Er greift nur lokal: Was beim Server liegt, hat ein
            // fertiges Standbild (poster) aus der Anreicherung.
            .components { add(VideoFrameDecoder.Factory()) }
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
        // Eigener Kanal für Cloud-Importe: Wer die Aufzeichnungs-Meldung
        // stummschaltet (sie steht ja dauerhaft), soll dabei nicht auch die
        // Nachricht „deine Tour ist da" verlieren — es sind zwei verschiedene
        // Anliegen, und Android lässt sie nur getrennt regeln, wenn sie
        // getrennte Kanäle haben.
        manager.createNotificationChannel(
            NotificationChannel(
                KANAL_IMPORTE,
                "Neue Touren",
                NotificationManager.IMPORTANCE_DEFAULT,
            ).apply { description = "Meldet Touren, die aus einer verbundenen Uhr angekommen sind" },
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
                if (tour.endeMs != null) UploadWorker.starte(this@MaptaleApp, tour.id, ersetzen = false)
            }
            // Cloud-Importe abfragen, solange ein Konto angemeldet ist. Der
            // Lauf wird beim Abmelden wieder beendet (ProfilViewModel) — sonst
            // klopfte er weiter an eine Tür, für die es keinen Schlüssel gibt.
            if (einstellungen.aktuellesKonto().angemeldet) {
                TrackerAbfrageWorker.sicherstellen(this@MaptaleApp)
            }
        }
    }

    companion object {
        const val KANAL_AUFZEICHNUNG = "aufzeichnung"
        const val KANAL_IMPORTE = "importe"
    }
}
