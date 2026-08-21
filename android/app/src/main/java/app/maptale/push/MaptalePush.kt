// Push an- und abmelden — die dünne Naht zu Firebase.
//
// Die App macht mit Firebase genau zwei Dinge: sich für Nachrichten anmelden
// und die eigene Adresse dem EIGENEN Server geben. Alles Weitere — wer welche
// Meldung bekommt, wann sie ausgelöst wird — entscheidet der Server. Kein
// Anbieter-SDK in der Oberfläche, keine Nachrichtenlogik in der App.
//
// **Die Adresse ist die FID, nicht der Registrierungs-Token.** FCM hat den
// Token mit SDK 25.1.0 (Juni 2026) abgelöst: `getToken`, `deleteToken` und
// `onNewToken` sind deprecated, an ihre Stelle treten `register()`,
// `unregister()` und `onRegistered()`, adressiert wird über die
// Firebase-Installations-ID. Die v1-API des Servers schickt sie entsprechend
// als `fid`.
//
// **Auto-Init ist aus** (`firebase_messaging_auto_init_enabled=false` im
// Manifest). Das ist keine Feinheit: `firebase-messaging` zieht
// `firebase-installations` mit, und die meldet beim App-START eine
// Installations-ID an Google — auch wenn nie ein Push verschickt wird.
// Eingeschaltet wird sie erst hier, nach der Zustimmung.
package app.maptale.push

import android.content.Context
import android.util.Log
import app.maptale.MaptaleApp
import com.google.firebase.FirebaseApp
import com.google.firebase.installations.FirebaseInstallations
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.tasks.await

object MaptalePush {

    /**
     * Ist Firebase in DIESEM Build überhaupt eingerichtet?
     *
     * Ohne `google-services.json` fehlen die erzeugten Ressourcen, Firebase
     * initialisiert sich beim Start nicht und `getApps` bleibt leer. Jeder
     * Zugriff auf `FirebaseMessaging.getInstance()` würfe dann — deshalb steht
     * diese Frage VOR jedem Zugriff und nicht in einem try/catch dahinter.
     */
    fun available(context: Context): Boolean = FirebaseApp.getApps(context).isNotEmpty()

    /**
     * Push einschalten: bei FCM anmelden und die Adresse beim eigenen Server
     * hinterlegen.
     *
     * Aufzurufen, sobald jemand angemeldet ist UND der Benachrichtigung
     * zugestimmt hat. Mehrfach aufzurufen ist harmlos — die Server-Route
     * schreibt dieselbe Zeile um, statt eine zweite anzulegen.
     *
     * Die FID wird NACH `register()` gelesen und nicht im Callback abgewartet:
     * `onRegistered` meldet sich verlässlich bei einer ÄNDERUNG, aber ein
     * erneutes Anmelden mit unveränderter Adresse muss auch dann beim Server
     * ankommen, wenn es dort noch nie eine gab (neue Installation, zweites
     * Konto, frisch erteilte Erlaubnis). Auf einen Callback zu warten, der
     * vielleicht nicht kommt, hieße auf Meldungen zu warten, die nie kommen.
     *
     * `false` heißt „Push gibt es hier nicht" (kein Firebase, kein Dienstkonto
     * auf dem Server, kein Netz). Der Aufrufer muss daraus nichts machen: Der
     * periodische Abruf läuft weiter, und genau dafür ist er da.
     */
    suspend fun enable(app: MaptaleApp): Boolean {
        if (!available(app)) return false
        return runCatching {
            val messaging = FirebaseMessaging.getInstance()
            // Erst JETZT darf Firebase seine Installations-ID melden.
            messaging.isAutoInitEnabled = true
            messaging.register().await()
            app.apiClient.registerPushDevice(FirebaseInstallations.getInstance().id.await())
        }.getOrElse { error ->
            Log.w("Maptale", "Push konnte nicht eingeschaltet werden", error)
            false
        }
    }

    /**
     * Push ausschalten: beim Server abmelden, bei FCM abmelden, Auto-Init aus.
     *
     * In DIESER Reihenfolge — nach `unregister()` ist die Adresse nicht mehr
     * gültig, und die Zeile bliebe auf dem Server stehen. Sie fiele erst beim
     * nächsten Versand auf, und der ginge dann an ein Gerät, das nichts mehr
     * hören wollte.
     *
     * Beim ABMELDEN vom Konto ist das der Aufruf, der die Zeile wegnimmt — das
     * serverseitige CASCADE greift nur, wenn der Zugang von außen widerrufen
     * wird.
     */
    suspend fun disable(app: MaptaleApp) {
        if (!available(app)) return
        runCatching {
            val fid = FirebaseInstallations.getInstance().id.await()
            app.apiClient.unregisterPushDevice(fid)
            val messaging = FirebaseMessaging.getInstance()
            messaging.unregister().await()
            messaging.isAutoInitEnabled = false
        }.onFailure { error ->
            // Ein misslungenes Abmelden darf das Abmelden vom KONTO nicht
            // aufhalten. Die Zeile fällt spätestens, wenn FCM die Adresse als
            // ungültig meldet — oder mit dem Zugang, an dem sie hängt.
            Log.w("Maptale", "Push konnte nicht abgemeldet werden", error)
        }
    }
}
