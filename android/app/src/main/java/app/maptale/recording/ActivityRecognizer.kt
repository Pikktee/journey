// Anbindung an die Aktivitätserkennung von Play Services (Transition-API).
//
// Sie meldet Übergänge — „Fahrzeug betreten", „Fußweg beendet" — statt in einem
// Takt zu pollen; das ist der akkuschonende Weg und liefert genau die Kanten,
// aus denen Modus-Wechsel werden. Die Deutung selbst passiert nicht hier,
// sondern in `ActivityInterpretation` (pure, getestet).
//
// Die Registrierung hängt am Lebenszyklus der AUFNAHME, nicht an dem der App:
// Wer sie beim Stoppen vergisst, lässt einen PendingIntent zurück, der die App
// noch Tage später weckt.
//
// Es gibt bewusst KEINEN eigenen BroadcastReceiver: Die Übergänge gehen als
// Intent an den ohnehin laufenden Aufzeichnungs-Service — dieselbe Aktions-
// Mechanik, mit der auch Pause und Stopp gesteuert werden. Ein Receiver wäre
// eine weitere Manifest-Komponente, die nach dem Stoppen der Aufnahme ins Leere
// liefe.
package app.maptale.recording

import android.Manifest
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import com.google.android.gms.location.ActivityRecognition
import com.google.android.gms.location.ActivityTransition
import com.google.android.gms.location.ActivityTransitionRequest
import com.google.android.gms.location.ActivityTransitionResult
import com.google.android.gms.location.DetectedActivity

object ActivityRecognizer {

    private const val REQUEST_CODE = 42

    /** Diese Aktivitäten interessieren — der Rest (STILL, TILTING) sagt nichts über das Mittel. */
    private val ARTEN = mapOf(
        DetectedActivity.ON_FOOT to ActivityKind.ON_FOOT,
        DetectedActivity.WALKING to ActivityKind.ON_FOOT,
        DetectedActivity.RUNNING to ActivityKind.ON_FOOT,
        DetectedActivity.ON_BICYCLE to ActivityKind.CYCLING,
        DetectedActivity.IN_VEHICLE to ActivityKind.VEHICLE,
    )

    fun canRecognize(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACTIVITY_RECOGNITION) ==
            PackageManager.PERMISSION_GRANTED

    /**
     * Übergänge anfordern. Ohne Berechtigung passiert nichts — die Aufnahme
     * läuft dann ohne Automatik weiter, statt zu scheitern.
     */
    fun start(context: Context) {
        if (!canRecognize(context)) return
        // Nur ENTER: Das Verlassen einer Aktivität ist immer das Betreten der
        // nächsten, und doppelte Kanten machten die Glättung nur unruhiger.
        val uebergaenge = ARTEN.keys.map { art ->
            ActivityTransition.Builder()
                .setActivityType(art)
                .setActivityTransition(ActivityTransition.ACTIVITY_TRANSITION_ENTER)
                .build()
        }
        runCatching {
            ActivityRecognition.getClient(context)
                .requestActivityTransitionUpdates(ActivityTransitionRequest(uebergaenge), intent(context))
        }
    }

    /** Übergänge abbestellen; nach dem Stoppen der Aufnahme Pflicht. */
    fun stop(context: Context) {
        runCatching {
            ActivityRecognition.getClient(context).removeActivityTransitionUpdates(intent(context))
        }
        intent(context).cancel()
    }

    /**
     * Bewegungsart aus einem eingegangenen Übergangs-Intent.
     *
     * Liefert den ZULETZT gemeldeten Übergang: Ein Intent kann mehrere tragen,
     * und der jüngste beschreibt den aktuellen Zustand.
     */
    fun activityKindFrom(intent: Intent): ActivityKind? {
        if (!ActivityTransitionResult.hasResult(intent)) return null
        val events = ActivityTransitionResult.extractResult(intent)?.transitionEvents ?: return null
        return events.lastOrNull { ARTEN.containsKey(it.activityType) }?.let { ARTEN[it.activityType] }
    }

    private fun intent(context: Context): PendingIntent = PendingIntent.getService(
        context,
        REQUEST_CODE,
        Intent(context, RecordingService::class.java).setAction(RecordingService.ACTION_ACTIVITY),
        // MUTABLE, weil Play Services die Übergänge als Extras hineinschreibt
        PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
}
