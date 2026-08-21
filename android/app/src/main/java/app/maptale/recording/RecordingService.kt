// Foreground-Service der Tour-Aufzeichnung. Er wird gestartet, während die App
// im Vordergrund ist (⇒ kein ACCESS_BACKGROUND_LOCATION nötig) und hält per
// Notification + foregroundServiceType="location" die GPS-Updates am Leben.
//
// Geschäftslogik lebt NICHT hier: der PunktFilter entscheidet (pure Klasse),
// das Repository persistiert. Der Service verdrahtet nur FusedLocation,
// Puffer und den 30-s-Flush (Absturz kostet höchstens 30 s Track).
package app.maptale.recording

import android.Manifest
import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import app.maptale.MaptaleApp
import app.maptale.MainActivity
import app.maptale.R
import app.maptale.data.TravelMode
import app.maptale.data.TrackPointEntity
import app.maptale.upload.UploadWorker
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.tasks.await

class RecordingService : LifecycleService() {

    private val app get() = application as MaptaleApp
    private val filter = PointFilter()
    private val puffer = mutableListOf<TrackPointEntity>()

    private var tourId: String? = null
    private var startMs = 0L
    private var paused = false
    /** Nur bei „Automatisch" erkennt die App das Fortbewegungsmittel selbst. */
    private var travelModeAuto = false

    private val locationClient by lazy { LocationServices.getFusedLocationProviderClient(this) }

    private val callback = object : LocationCallback() {
        override fun onLocationResult(ergebnis: LocationResult) {
            val id = tourId ?: return
            if (paused) return
            for (ort in ergebnis.locations) {
                val punkt = RawPoint(
                    lng = ort.longitude,
                    lat = ort.latitude,
                    ele = if (ort.hasAltitude()) ort.altitude else 0.0,
                    tOffsetS = (ort.time - startMs) / 1000.0,
                    accuracyM = if (ort.hasAccuracy()) ort.accuracy else 999f,
                    // Unterscheidet Gehen von Stehen — ohne das hielte der
                    // Filter das Positionsrauschen einer Rast für Wegstrecke.
                    speedMps = if (ort.hasSpeed()) ort.speed else null,
                )
                if (!filter.check(punkt)) continue
                synchronized(puffer) {
                    puffer.add(
                        TrackPointEntity(
                            tourId = id,
                            lng = punkt.lng,
                            lat = punkt.lat,
                            ele = punkt.ele,
                            tOffsetS = punkt.tOffsetS,
                            accuracyM = punkt.accuracyM,
                        ),
                    )
                }
                RecordingState.update {
                    it.copy(
                        distanceM = filter.distanceM,
                        pointCount = it.pointCount + 1,
                        lastPoint = punkt,
                        track = appendPoint(it.track, TrackPoint(punkt.lng, punkt.lat)),
                    )
                }
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        when (intent?.action) {
            ACTION_START -> startRecording(
                // Ohne EXTRA_MODUS heißt „Automatisch": walk als Startwert, aber
                // die Erkennung übernimmt.
                intent.getStringExtra(EXTRA_TRAVEL_MODE)?.let(TravelMode::fromKey),
                intent.getStringExtra(EXTRA_TITLE),
            )
            ACTION_TRAVEL_MODE -> changeTravelMode(TravelMode.fromKey(intent.getStringExtra(EXTRA_TRAVEL_MODE) ?: "walk"))
            ACTION_ACTIVITY -> ActivityRecognizer.activityKindFrom(intent)?.let(::deuteBewegung)
            ACTION_PAUSE -> setzePause(true)
            ACTION_RESUME -> setzePause(false)
            ACTION_STOP -> finishRecording()
        }
        return START_STICKY
    }

    /**
     * Erkannte Bewegung übernehmen.
     *
     * Roh mitgeschrieben, nicht hier geglättet: Was zu kurz war, fällt beim Bau
     * des Manifests heraus (ActivityInterpretation.glaette). Ein Zustandsautomat mit
     * Timern im Service wäre die zweite Stelle, die dieselbe Entscheidung trifft
     * — und die schwerer zu testende.
     */
    private fun deuteBewegung(art: ActivityKind) {
        if (!travelModeAuto || paused) return
        val neu = ActivityInterpretation.travelModeFor(art)
        if (neu == RecordingState.current.value?.travelMode) return
        changeTravelMode(neu)
    }

    private fun startRecording(gewaehlt: TravelMode?, title: String?) {
        if (tourId != null) return // läuft schon
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            stopSelf()
            return
        }
        // „Automatisch" (kein gewählter Modus) heißt: Die Erkennung entscheidet.
        // Ohne die Berechtigung dafür bliebe sie stumm — dann ist es keine
        // Automatik mehr, und der Server soll seine Tempo-Erkennung anwenden.
        val automatik = gewaehlt == null && ActivityRecognizer.canRecognize(this)
        travelModeAuto = automatik
        val travelMode = gewaehlt ?: TravelMode.WALK
        startForeground(
            NOTIFICATION_ID,
            baueNotification(),
            ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION,
        )
        if (automatik) ActivityRecognizer.start(this)
        lifecycleScope.launch {
            val tour = app.repository.startRecording(travelMode, title = title, travelModeAuto = automatik)
            tourId = tour.id
            startMs = tour.startMs
            RecordingState.start(tour.id, tour.startMs, travelMode)

            val anfrage = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 2_000L)
                .setMinUpdateDistanceMeters(0f) // filtern macht der PunktFilter
                .setMaxUpdateDelayMillis(10_000L) // Batching spart Akku
                .build()
            locationClient.requestLocationUpdates(anfrage, callback, Looper.getMainLooper())

            // 30-s-Flush: Puffer in die DB, Distanz für die Liste nachziehen
            while (tourId != null) {
                delay(30_000L)
                flush()
            }
        }
    }

    private fun changeTravelMode(travelMode: TravelMode) {
        val id = tourId ?: return
        val tOffsetS = (System.currentTimeMillis() - startMs) / 1000.0
        lifecycleScope.launch { app.repository.changeTravelMode(id, tOffsetS, travelMode) }
        RecordingState.update { it.copy(travelMode = travelMode) }
    }

    private fun setzePause(an: Boolean) {
        paused = an
        RecordingState.update { it.copy(paused = an) }
    }

    private fun finishRecording() {
        val id = tourId ?: return
        // Vor allem anderen abbestellen: Ein liegen gebliebener PendingIntent
        // weckt die App noch tagelang bei jedem Übergang.
        ActivityRecognizer.stop(this)
        travelModeAuto = false
        lifecycleScope.launch {
            // FusedLocation batcht bis 10 s — erst die einbehaltenen Fixe
            // ausliefern lassen (Callback nimmt noch an), DANN abklemmen.
            runCatching { locationClient.flushLocations().await() }
            tourId = null // stoppt Flush-Schleife und Callback-Annahme
            locationClient.removeLocationUpdates(callback)
            flush(id)
            // Auto-Titel kommt erst beim Upload/Nachbearbeiten (Geocoder braucht
            // Netz) — hier wird nur sauber abgeschlossen.
            app.repository.finishRecording(id, title = null)
            // Sofort in die Upload-Warteschlange: die Tour ist fertig, und
            // niemand will nach der Reise noch einen Knopf suchen. WorkManager
            // wartet notfalls auf Netz und überlebt das stopSelf gleich darunter.
            UploadWorker.start(this@RecordingService, id)
            RecordingState.clear()
            stopSelf()
        }
    }

    private suspend fun flush(id: String? = tourId) {
        val ziel = id ?: return
        val batch = synchronized(puffer) {
            val kopie = puffer.toList()
            puffer.clear()
            kopie
        }
        app.repository.savePoints(ziel, batch, filter.distanceM)
    }

    private fun baueNotification(): Notification {
        val oeffnen = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, MaptaleApp.CHANNEL_RECORDING)
            .setContentTitle("Maptale zeichnet auf")
            .setContentText("Deine Tour wird aufgezeichnet")
            .setSmallIcon(R.drawable.ic_launcher_vordergrund)
            .setOngoing(true)
            .setContentIntent(oeffnen)
            .build()
    }

    override fun onDestroy() {
        locationClient.removeLocationUpdates(callback)
        ActivityRecognizer.stop(this)
        // Beendet das SYSTEM den Service (nicht der Stopp-Knopf), hängen bis zu
        // 30 s Punkte im Puffer — kurz und blockierend retten (kleiner Insert;
        // lifecycleScope ist hier bereits beendet). Die Tour selbst räumt der
        // nächste App-Start auf (schliesseVerwaisteAufnahmen).
        val id = tourId
        if (id != null) {
            tourId = null
            runCatching { runBlocking { flush(id) } }
        }
        super.onDestroy()
    }

    companion object {
        private const val NOTIFICATION_ID = 1
        const val ACTION_START = "app.maptale.START"
        const val ACTION_STOP = "app.maptale.STOP"
        const val ACTION_PAUSE = "app.maptale.PAUSE"
        const val ACTION_RESUME = "app.maptale.RESUME"
        const val ACTION_TRAVEL_MODE = "app.maptale.TRAVEL_MODE"
        /** Übergang der Aktivitätserkennung (PendingIntent aus Bewegungserkennung) */
        const val ACTION_ACTIVITY = "app.maptale.ACTIVITY"
        const val EXTRA_TRAVEL_MODE = "travelMode"
        const val EXTRA_TITLE = "title"

        /** `modus = null` heißt „Automatisch": die Erkennung entscheidet unterwegs. */
        fun start(context: Context, travelMode: TravelMode?, title: String? = null) =
            sende(context, ACTION_START, vordergrund = true) {
                travelMode?.let { putExtra(EXTRA_TRAVEL_MODE, it.key) }
                title?.ifBlank { null }?.let { putExtra(EXTRA_TITLE, it) }
            }

        fun changeTravelMode(context: Context, travelMode: TravelMode) =
            sende(context, ACTION_TRAVEL_MODE) { putExtra(EXTRA_TRAVEL_MODE, travelMode.key) }

        fun pausiere(context: Context) = sende(context, ACTION_PAUSE)
        fun setzeFort(context: Context) = sende(context, ACTION_RESUME)
        fun stop(context: Context) = sende(context, ACTION_STOP)

        // Nur der START geht als startForegroundService (verpflichtet binnen 5 s
        // zu startForeground). Steuer-Aktionen erreichen den ohnehin laufenden
        // Service per startService — käme eine verspätet an, wenn er schon weg
        // ist, würde startForegroundService ohne startForeground-Aufruf crashen.
        private fun sende(context: Context, aktion: String, vordergrund: Boolean = false, extras: Intent.() -> Unit = {}) {
            val intent = Intent(context, RecordingService::class.java).apply {
                action = aktion
                extras()
            }
            if (vordergrund) context.startForegroundService(intent) else context.startService(intent)
        }
    }
}
