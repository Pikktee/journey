// Die Autorisierungsseite des Anbieters öffnen.
//
// **Kein WebView.** Mehrere Anbieter sperren eingebettete Browser für OAuth,
// und der Grund ist gut: In einem WebView wäre die Adresse nicht prüfbar und
// das Passwort ginge durch unsere App. Ein echter Browser zeigt beides — die
// Adresse und das Schloss —, und wir bekommen den Inhalt nie zu sehen.
//
// Ein CUSTOM TAB ist dabei die aufgeräumtere Form desselben Browsers: Er läuft
// in unserer Aufgabe statt als eigene App, schließt sich nach dem Rückweg von
// selbst und lässt keinen Tab zurück, den niemand mehr braucht. An der
// Sicherheit ändert er nichts — es ist derselbe Browser mit derselben
// Anmeldung, nur ohne Tabs, Menü und Lesezeichen.
package app.maptale.tracker

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent

/**
 * `NightSurface` aus ui/Theme.kt — die Leiste trägt dieselbe dunkle Fläche wie
 * die App, damit der Übergang nicht blitzt.
 *
 * Bewusst NICHT das Sonnengelb des Akzents: Chrome wählt die Schriftfarbe der
 * Adresse nach der Helligkeit der Leiste, und auf Gelb würde sie schwarz —
 * ein greller Balken mitten im dunklen Ablauf. Der Akzent gehört auf Knöpfe,
 * nicht auf Flächen.
 */
private const val LEISTE = 0xFF10151C.toInt()

/**
 * `true`, wenn die Seite geöffnet werden konnte.
 *
 * Der Rückfall ist eingebaut, aber nicht sichtbar: `CustomTabsIntent` ist im
 * Kern ein gewöhnlicher `ACTION_VIEW`-Intent mit Zusatzangaben. Kennt der
 * Standard-Browser Custom Tabs nicht, ignoriert er sie und öffnet die Seite
 * ganz normal — es gibt also keinen Fall, in dem hier nichts passiert, außer
 * es ist gar kein Browser installiert. Genau den fängt das `catch`.
 */
fun openAuthorization(context: Context, url: String): Boolean {
    val adresse = Uri.parse(url)
    val tab = CustomTabsIntent.Builder()
        .setShowTitle(false)
        .setUrlBarHidingEnabled(false)
        .setDefaultColorSchemeParams(
            CustomTabColorSchemeParams.Builder().setToolbarColor(LEISTE).build(),
        )
        .build()
    return try {
        tab.launchUrl(context, adresse)
        true
    } catch (fehler: ActivityNotFoundException) {
        // Kein Browser, der Custom Tabs versteht — der nackte Weg als letzte
        // Möglichkeit. Scheitert auch der, ist wirklich kein Browser da.
        try {
            context.startActivity(Intent(Intent.ACTION_VIEW, adresse))
            true
        } catch (auchDasNicht: ActivityNotFoundException) {
            false
        }
    }
}
