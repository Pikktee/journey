// Der Empfänger: Firebase weckt die App, die App fragt den eigenen Server.
//
// **Die Nachricht trägt keine Inhalte, nur einen Anlass** (`type`, `tourId`).
// Was gemeldet wird, holt die App über dieselben Routen wie der periodische
// Abruf — und quittiert es auch dort. Ein Push mit fertigem Text liefe über
// Googles Server und läge auf dem Sperrbildschirm; ein Wecken genügt, und FCM
// ist nicht Ende-zu-Ende-verschlüsselt.
//
// Deshalb ist es eine DATEN-Nachricht ohne `notification`-Block: Nur so
// bekommt die App sie überhaupt in die Hand (Android zeigte eine
// `notification` sonst selbst an, am Quittieren vorbei und doppelt zum
// periodischen Abruf).
package app.maptale.push

import android.util.Log
import app.maptale.MaptaleApp
import app.maptale.tracker.meldeOffeneImporte
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class MaptalePushDienst : FirebaseMessagingService() {

    /**
     * Eigener Scope statt `MaptaleApp.appScope`: Der ist an `Dispatchers.Main`
     * gebunden, und ein Dienst, der nur wecken soll, hat auf dem Hauptthread
     * nichts verloren. `SupervisorJob`, damit ein Fehlschlag nicht den nächsten
     * Weckruf mitnimmt.
     */
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /**
     * Eine neue Adresse (FID) — nach einer Neuinstallation, nach dem
     * Zurücksetzen der App-Daten und wann immer FCM es für nötig hält.
     *
     * `onRegistered` und nicht `onNewToken`: FCM hat den Registrierungs-Token
     * mit SDK 25.1.0 zugunsten der Installations-ID abgelöst, die alte
     * Rückmeldung ist deprecated (s. `MaptalePush`).
     *
     * Ungefragt und jederzeit: Deshalb ist die Server-Route ein UPSERT und
     * kein INSERT. Wer hier nichts tut, hat irgendwann eine Adresse in der
     * Datenbank, an die nichts mehr geht — und der Nutzer wartet auf Meldungen,
     * die niemand mehr zustellen kann.
     */
    override fun onRegistered(fid: String) {
        val app = applicationContext as? MaptaleApp ?: return
        scope.launch {
            if (!app.einstellungen.aktuellesKonto().angemeldet) return@launch
            runCatching { app.apiClient.pushGeraetAnmelden(fid) }
                .onFailure { Log.w("Maptale", "Push-Adresse konnte nicht hinterlegt werden", it) }
        }
    }

    override fun onMessageReceived(nachricht: RemoteMessage) {
        val app = applicationContext as? MaptaleApp ?: return
        // Der Typ wird GEPRÜFT und nicht bloß gelesen: Ein anderer Anlass ist
        // eine spätere Fassung des Servers, die diese App noch nicht kennt —
        // sie soll ihn übergehen, nicht als Import melden.
        if (nachricht.data["type"] != "import-finished") return
        // Die `tourId` aus der Nachricht wird bewusst NICHT verwendet, um die
        // Meldung zu bauen: Was gemeldet wird, entscheidet der Server über
        // seine Liste offener Importe — sonst gäbe es zwei Wahrheiten darüber,
        // was der Nutzer schon gesehen hat.
        scope.launch { meldeOffeneImporte(app) }
    }
}
