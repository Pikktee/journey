// Verbundene Dienste: die rechnenden Teile, ohne Compose und ohne Netz.
//
// Dieselben Sätze wie im Web (src/konto/trackermodell.ts) — bewusst
// nachgebaut und nicht geteilt: Ein gemeinsames Modul für vier Zeilen Text
// hieße ein Shared-Module-Setup für null geteilte Logik (Konzept, Abschnitt 2).
// Zusammengehalten werden beide Fassungen von dem, was sie sagen müssen, nicht
// von einer Datei.
package app.maptale.tracker

import app.maptale.upload.TrackerProvider
import app.maptale.upload.TrackerImport

/** Was rechts in der Zeile steht — oder nichts, wenn es nichts zu tun gibt. */
enum class TrackerAction { CONNECT, RECONNECT, DISCONNECT }

/**
 * Der Satz unter dem Anbieternamen.
 *
 * Vier Zustände, vier Auskünfte. Der teuerste Fehler wäre, `abgelaufen` wie
 * „nicht verbunden" aussehen zu lassen: Dann wartet jemand auf Touren, die nie
 * kommen, und sieht keinen Grund dafür.
 */
fun providerText(a: TrackerProvider): String = when {
    !a.available -> "Auf diesem Server noch nicht eingerichtet."
    a.abgelaufen -> a.fehler?.let { "Der Zugang gilt nicht mehr: $it Bitte neu verbinden." }
        ?: "Der Zugang gilt nicht mehr — bitte neu verbinden."
    a.verbunden -> "Verbunden. Neue Aufzeichnungen kommen von selbst an."
    else -> "Nach dem Verbinden landen neue Aufzeichnungen von selbst in deiner Bibliothek."
}

/** Die Aktion der Zeile; null bei einem Anbieter, den dieser Server nicht anbietet. */
fun providerAction(a: TrackerProvider): TrackerAction? = when {
    !a.available -> null
    a.abgelaufen -> TrackerAction.RECONNECT
    a.verbunden -> TrackerAction.DISCONNECT
    else -> TrackerAction.CONNECT
}

fun actionLabel(aktion: TrackerAction): String = when (aktion) {
    TrackerAction.CONNECT -> "Verbinden"
    TrackerAction.RECONNECT -> "Neu verbinden"
    TrackerAction.DISCONNECT -> "Trennen"
}

/**
 * Die Meldung über neu angekommene Touren.
 *
 * Nur FERTIGE zählen: Eine übersprungene Halleneinheit ist kein Ereignis, über
 * das jemand eine Benachrichtigung bekommen sollte — und ein Fehler, den der
 * Nutzer ohnehin nicht beheben kann, ist auf dem Sperrbildschirm nur Lärm.
 * Beides steht in der Liste im Konto, dort gehört es hin.
 *
 * `null` heißt: nichts melden.
 */
fun messageFor(importe: List<TrackerImport>): String? {
    val fertige = importe.count { it.status == "done" }
    return when {
        fertige <= 0 -> null
        fertige == 1 -> "Eine neue Tour ist da"
        else -> "$fertige neue Touren sind da"
    }
}

/**
 * Der Deep Link, mit dem der Server nach dem Verknüpfen zurückruft:
 * `maptale://tracker/<anbieter>?ok=1`.
 *
 * Gibt die Anbieter-Kennung zurück, wenn es EINE ERFOLGREICHE Rückkehr war —
 * sonst null. Der Aufrufer lädt daraufhin neu; er verlässt sich NICHT auf das
 * `ok`, sondern fragt den Server nach dem tatsächlichen Zustand: Was zählt, ist
 * was dort steht, nicht was im Link behauptet wird.
 */
fun providerFromDeepLink(uri: String?): String? {
    if (uri == null) return null
    val ohneSchema = uri.removePrefix("maptale://tracker/")
    if (ohneSchema == uri) return null
    val id = ohneSchema.substringBefore('?').trim('/')
    return id.ifEmpty { null }
}
