// DI-Wurzel der App (bewusst ohne Framework): baut die wenigen Singletons —
// Datenbank, Repository, Einstellungen, API-Client — und reicht sie an
// ViewModels/Service/Worker. Spiegelbild von baueApp(deps) im Backend.
package app.maptale

import android.Manifest
import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.pm.PackageManager
import android.util.Log
import androidx.core.app.ActivityCompat
import app.maptale.naming.AndroidGeocoder
import app.maptale.naming.TourNaming
import app.maptale.data.MaptaleDb
import app.maptale.data.TourRepository
import app.maptale.data.TourStatus
import app.maptale.push.MaptalePush
import app.maptale.upload.ApiClient
import app.maptale.upload.Settings
import app.maptale.upload.Settings.Companion.STANDARD_SERVER
import app.maptale.tracker.TrackerPollWorker
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

    val db: MaptaleDb by lazy { MaptaleDb.build(this) }
    val repository: TourRepository by lazy { TourRepository(db, filesDir) }
    val settings: Settings by lazy { Settings(this) }
    val apiClient: ApiClient by lazy { ApiClient(settings) }
    val naming: TourNaming by lazy { TourNaming(AndroidGeocoder(this)) }

    /** Basis-Adresse des Servers für Bild-URLs (Titelbilder aus der Tourliste). */
    fun serverUrl(): String = settings.lastAccount.serverUrl

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
                    val token = settings.lastAccount.apiToken
                    val eigenerHost = anfrage.url.host == serverHost ||
                        anfrage.url.host == settings.lastAccount.serverUrl.toHttpUrlOrNull()?.host
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
                CHANNEL_RECORDING,
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
                CHANNEL_IMPORTS,
                "Neue Touren",
                NotificationManager.IMPORTANCE_DEFAULT,
            ).apply { description = "Meldet Touren, die aus einer verbundenen Uhr angekommen sind" },
        )
        // Dritter Kanal für das Übertragen. Er hängt an einem
        // Vordergrunddienst und ist damit Pflicht, aber er ist auch inhaltlich
        // ein eigenes Anliegen: Die Aufzeichnungs-Meldung steht, WÄHREND man
        // unterwegs ist, diese, während Daten gehen. Wer die eine
        // stummschaltet, meint selten die andere. IMPORTANCE_LOW, weil ein
        // Upload nichts ist, wofür ein Telefon Geräusche machen sollte.
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_UPLOAD,
                "Touren übertragen",
                NotificationManager.IMPORTANCE_LOW,
            ).apply { description = "Läuft, während eine Tour zum Server geladen wird" },
        )
        // Kontostand mitlesen, damit der Bild-Lader synchron an das Token kommt
        settings.account.launchIn(appScope)

        appScope.launch {
            // Einmaliger Umzug der WorkManager-Warteschlange auf die
            // umbenannten Worker-Klassen. Er läuft VOR dem Einreihen: Sonst
            // träfe das KEEP unten auf einen Auftrag, der eine Zeile später
            // abgeräumt wird, und der periodische Abruf liefe nie wieder an.
            WorkQueueMigration.run(this@MaptaleApp, settings)
            // Nach Prozess-Tod gestrandete Aufnahmen zu abschließbaren Entwürfen machen
            repository.closeOrphanedRecordings()
            // Liegengebliebene Entwürfe nachreichen. Normalerweise übernimmt das
            // WorkManager selbst (seine Warteschlange überlebt Neustarts) — das
            // hier fängt die Fälle, in denen sie verloren ging, etwa nach einem
            // erzwungenen Beenden. Deshalb KEEP: ein wartender Versuch wird
            // nicht zurückgesetzt.
            for (tour in repository.toursByStatus(TourStatus.DRAFT)) {
                if (tour.endMs != null) UploadWorker.start(this@MaptaleApp, tour.id, ersetzen = false)
            }
            // Cloud-Importe abfragen, solange ein Konto angemeldet ist. Der
            // Lauf wird beim Abmelden wieder beendet (ProfilViewModel) — sonst
            // klopfte er weiter an eine Tür, für die es keinen Schlüssel gibt.
            if (settings.currentAccount().loggedIn) {
                TrackerPollWorker.ensure(this@MaptaleApp)
                // Push nachziehen, WENN die Erlaubnis schon steht. Ohne diesen
                // Anlauf hinge der Token an einem einzigen Moment (dem
                // Verknüpfen): Wer die App neu installiert, das Konto auf einem
                // zweiten Gerät anmeldet oder die Erlaubnis später in den
                // Systemeinstellungen erteilt, bekäme nie einen — und wartete
                // auf Meldungen, die niemand adressieren kann. Von sich aus
                // FRAGT die App hier nichts: Ein Systemdialog beim Start, ohne
                // dass jemand etwas getan hat, ist genau die Abfrage, die man
                // wegtippt.
                if (ActivityCompat.checkSelfPermission(this@MaptaleApp, Manifest.permission.POST_NOTIFICATIONS)
                    == PackageManager.PERMISSION_GRANTED
                ) {
                    MaptalePush.enable(this@MaptaleApp)
                }
            }
        }
    }

    companion object {
        const val CHANNEL_RECORDING = "aufzeichnung"
        const val CHANNEL_IMPORTS = "importe"
        const val CHANNEL_UPLOAD = "upload"
    }
}
