// Der Rückweg aus dem Browser: `maptale://tracker/<anbieter>?ok=1`.
//
// Ein prozessweiter Kanal statt eines Navigations-Arguments, weil der Deep
// Link die Activity trifft, der Zustand aber im Profil-Screen liegt — und der
// kann beim Eintreffen gerade neu aufgebaut werden. `MutableSharedFlow` mit
// Puffer 1 und `DROP_OLDEST`: Wer zwischendurch nicht zuhört, verpasst nichts
// Wesentliches (der Screen holt beim Erscheinen ohnehin frisch), doppelte
// Rückkehren sind aber auch kein Grund für zwei Ladeläufe.
package app.maptale.tracker

import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow

object TrackerReturn {

    private val intern = MutableSharedFlow<String>(
        replay = 1,
        extraBufferCapacity = 0,
        onBufferOverflow = BufferOverflow.DROP_OLDEST,
    )

    /** Die Anbieter-Kennung, aus der die App gerade zurückkam. */
    val events: SharedFlow<String> = intern

    /**
     * Einen empfangenen Deep Link melden. `true`, wenn er einer von uns war —
     * der Aufrufer weiß dann, dass er ihn nicht weiterreichen muss.
     */
    fun report(uri: String?): Boolean {
        val anbieter = providerFromDeepLink(uri) ?: return false
        intern.tryEmit(anbieter)
        return true
    }
}
