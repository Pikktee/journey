// Foreground-Service der Tour-Aufzeichnung. Er wird gestartet, während die App
// im Vordergrund ist (⇒ kein ACCESS_BACKGROUND_LOCATION nötig) und hält per
// Notification + foregroundServiceType="location" die GPS-Updates am Leben.
//
// Geschäftslogik lebt NICHT hier: der PunktFilter entscheidet (pure Klasse),
// das Repository persistiert. Der Service verdrahtet nur FusedLocation,
// Puffer und den 30-s-Flush (Absturz kostet höchstens 30 s Track).
package app.luhambo.aufzeichnung

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
import app.luhambo.LuhamboApp
import app.luhambo.MainActivity
import app.luhambo.R
import app.luhambo.daten.Modus
import app.luhambo.daten.TrackpunktEntity
import app.luhambo.upload.UploadWorker
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.tasks.await

class AufzeichnungsService : LifecycleService() {

    private val app get() = application as LuhamboApp
    private val filter = PunktFilter()
    private val puffer = mutableListOf<TrackpunktEntity>()

    private var tourId: String? = null
    private var startMs = 0L
    private var pausiert = false

    private val locationClient by lazy { LocationServices.getFusedLocationProviderClient(this) }

    private val callback = object : LocationCallback() {
        override fun onLocationResult(ergebnis: LocationResult) {
            val id = tourId ?: return
            if (pausiert) return
            for (ort in ergebnis.locations) {
                val punkt = RohPunkt(
                    lng = ort.longitude,
                    lat = ort.latitude,
                    ele = if (ort.hasAltitude()) ort.altitude else 0.0,
                    tOffsetS = (ort.time - startMs) / 1000.0,
                    genauigkeitM = if (ort.hasAccuracy()) ort.accuracy else 999f,
                    // Unterscheidet Gehen von Stehen — ohne das hielte der
                    // Filter das Positionsrauschen einer Rast für Wegstrecke.
                    tempoMps = if (ort.hasSpeed()) ort.speed else null,
                )
                if (!filter.pruefe(punkt)) continue
                synchronized(puffer) {
                    puffer.add(
                        TrackpunktEntity(
                            tourId = id,
                            lng = punkt.lng,
                            lat = punkt.lat,
                            ele = punkt.ele,
                            tOffsetS = punkt.tOffsetS,
                            genauigkeitM = punkt.genauigkeitM,
                        ),
                    )
                }
                AufzeichnungsZustand.aktualisiere {
                    it.copy(
                        distanzM = filter.distanzM,
                        punktAnzahl = it.punktAnzahl + 1,
                        letzterPunkt = punkt,
                    )
                }
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        when (intent?.action) {
            AKTION_START -> starteAufzeichnung(
                Modus.vonSchluessel(intent.getStringExtra(EXTRA_MODUS) ?: "walk"),
                intent.getStringExtra(EXTRA_TITEL),
            )
            AKTION_MODUS -> wechsleModus(Modus.vonSchluessel(intent.getStringExtra(EXTRA_MODUS) ?: "walk"))
            AKTION_PAUSE -> setzePause(true)
            AKTION_WEITER -> setzePause(false)
            AKTION_STOPP -> beendeAufzeichnung()
        }
        return START_STICKY
    }

    private fun starteAufzeichnung(modus: Modus, titel: String?) {
        if (tourId != null) return // läuft schon
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            stopSelf()
            return
        }
        startForeground(
            NOTIFICATION_ID,
            baueNotification(),
            ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION,
        )
        lifecycleScope.launch {
            val tour = app.repository.starteAufnahme(modus, titel = titel)
            tourId = tour.id
            startMs = tour.startMs
            AufzeichnungsZustand.starte(tour.id, tour.startMs, modus)

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

    private fun wechsleModus(modus: Modus) {
        val id = tourId ?: return
        val tOffsetS = (System.currentTimeMillis() - startMs) / 1000.0
        lifecycleScope.launch { app.repository.wechsleModus(id, tOffsetS, modus) }
        AufzeichnungsZustand.aktualisiere { it.copy(modus = modus) }
    }

    private fun setzePause(an: Boolean) {
        pausiert = an
        AufzeichnungsZustand.aktualisiere { it.copy(pausiert = an) }
    }

    private fun beendeAufzeichnung() {
        val id = tourId ?: return
        lifecycleScope.launch {
            // FusedLocation batcht bis 10 s — erst die einbehaltenen Fixe
            // ausliefern lassen (Callback nimmt noch an), DANN abklemmen.
            runCatching { locationClient.flushLocations().await() }
            tourId = null // stoppt Flush-Schleife und Callback-Annahme
            locationClient.removeLocationUpdates(callback)
            flush(id)
            // Auto-Titel kommt erst beim Upload/Nachbearbeiten (Geocoder braucht
            // Netz) — hier wird nur sauber abgeschlossen.
            app.repository.beendeAufnahme(id, titel = null)
            // Sofort in die Upload-Warteschlange: die Tour ist fertig, und
            // niemand will nach der Reise noch einen Knopf suchen. WorkManager
            // wartet notfalls auf Netz und überlebt das stopSelf gleich darunter.
            UploadWorker.starte(this@AufzeichnungsService, id)
            AufzeichnungsZustand.beende()
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
        app.repository.speicherePunkte(ziel, batch, filter.distanzM)
    }

    private fun baueNotification(): Notification {
        val oeffnen = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, LuhamboApp.KANAL_AUFZEICHNUNG)
            .setContentTitle("Luhambo zeichnet auf")
            .setContentText("Deine Tour wird aufgezeichnet")
            .setSmallIcon(R.drawable.ic_launcher_vordergrund)
            .setOngoing(true)
            .setContentIntent(oeffnen)
            .build()
    }

    override fun onDestroy() {
        locationClient.removeLocationUpdates(callback)
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
        const val AKTION_START = "app.luhambo.START"
        const val AKTION_STOPP = "app.luhambo.STOPP"
        const val AKTION_PAUSE = "app.luhambo.PAUSE"
        const val AKTION_WEITER = "app.luhambo.WEITER"
        const val AKTION_MODUS = "app.luhambo.MODUS"
        const val EXTRA_MODUS = "modus"
        const val EXTRA_TITEL = "titel"

        fun starte(context: Context, modus: Modus, titel: String? = null) =
            sende(context, AKTION_START, vordergrund = true) {
                putExtra(EXTRA_MODUS, modus.schluessel)
                titel?.ifBlank { null }?.let { putExtra(EXTRA_TITEL, it) }
            }

        fun wechsleModus(context: Context, modus: Modus) =
            sende(context, AKTION_MODUS) { putExtra(EXTRA_MODUS, modus.schluessel) }

        fun pausiere(context: Context) = sende(context, AKTION_PAUSE)
        fun setzeFort(context: Context) = sende(context, AKTION_WEITER)
        fun stoppe(context: Context) = sende(context, AKTION_STOPP)

        // Nur der START geht als startForegroundService (verpflichtet binnen 5 s
        // zu startForeground). Steuer-Aktionen erreichen den ohnehin laufenden
        // Service per startService — käme eine verspätet an, wenn er schon weg
        // ist, würde startForegroundService ohne startForeground-Aufruf crashen.
        private fun sende(context: Context, aktion: String, vordergrund: Boolean = false, extras: Intent.() -> Unit = {}) {
            val intent = Intent(context, AufzeichnungsService::class.java).apply {
                action = aktion
                extras()
            }
            if (vordergrund) context.startForegroundService(intent) else context.startService(intent)
        }
    }
}
