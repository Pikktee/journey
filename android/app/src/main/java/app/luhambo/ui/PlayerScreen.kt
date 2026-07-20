// Abspielen im WebView: lädt den gehosteten Web-Player mit
// /erlebnis.html?tour=srv:<id>&app=1 — komplette Wiederverwendung der Engine
// (Plan-Entscheid), braucht Internet. serverUrl ist das Prod-Web-Origin (fest,
// s. Navigation), `app=1` schaltet den App-Modus des Players: dort entfallen die
// Tour-Auswahl und alle Verweise auf die Landing-Seite, die in der App ins Leere
// führen würden.
//
// Der Screen läuft ECHT im Vollbild (keine Titelleiste, System-Leisten versteckt):
// die Kamerafahrt IST der Inhalt, jede Leiste darüber verschenkt Bühne. Zurück
// geht über die System-Geste; beim Verlassen kommen die Leisten wieder.
//
// Zurück in die Tourliste führt der Knopf im Web-Player über PlayerBruecke
// (window.LuhamboApp.verlassen) — zusätzlich zur System-Zurück-Geste.
//
// Kritisch für den Ton: der WebView wird beim Verlassen vollständig abgebaut
// (about:blank + destroy) und im Hintergrund pausiert — sonst laufen Musik,
// Fahrgeräusche und Wetter-Loops weiter, obwohl der Player längst zu ist.
package app.luhambo.ui

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.util.Log
import android.webkit.JavascriptInterface
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.findViewTreeLifecycleOwner

/** Die Activity hinter einem (möglicherweise verpackten) Compose-Context. */
private tailrec fun Context.findeActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findeActivity()
    else -> null
}

/**
 * Brücke für den „Player verlassen"-Knopf der Web-Oberfläche. Im Vollbild gibt es
 * keine Titelleiste mehr; ohne sichtbaren Ausweg bliebe nur die System-Geste, die
 * nicht jeder kennt. Der Web-Player ruft `window.LuhamboApp.verlassen()`.
 *
 * Nur diese eine, mit @JavascriptInterface annotierte Methode ist aus JavaScript
 * erreichbar (seit API 17), und der WebView lädt ausschließlich unser eigenes
 * Origin — die Angriffsfläche bleibt damit auf genau diesen Aufruf beschränkt.
 * Der Rückweg läuft über den Haupt-Thread, weil Navigation UI-Arbeit ist.
 */
private class PlayerBruecke(private val ansicht: WebView, private val zurueck: () -> Unit) {
    @JavascriptInterface
    fun verlassen() {
        ansicht.post { zurueck() }
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun PlayerScreen(serverUrl: String, serverTourId: String, zurueck: () -> Unit) {
    val ansicht = LocalView.current

    // — Vollbild: System-Leisten weg, Wischen holt sie kurz zurück —
    DisposableEffect(ansicht) {
        val fenster = ansicht.context.findeActivity()?.window
        val steuerung = fenster?.let { WindowCompat.getInsetsController(it, ansicht) }
        steuerung?.apply {
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            hide(WindowInsetsCompat.Type.systemBars())
        }
        onDispose { steuerung?.show(WindowInsetsCompat.Type.systemBars()) }
    }

    // Referenz auf den WebView, damit Lebenszyklus-Beobachter und Abbau ihn erreichen
    val halter = remember { arrayOfNulls<WebView>(1) }

    // — App im Hintergrund: Ton anhalten, beim Zurückkommen fortsetzen —
    val lebenszyklus = ansicht.findViewTreeLifecycleOwner()?.lifecycle
    DisposableEffect(lebenszyklus) {
        val beobachter = LifecycleEventObserver { _, ereignis ->
            val web = halter[0]
            when (ereignis) {
                Lifecycle.Event.ON_PAUSE -> {
                    web?.onPause()
                    web?.pauseTimers()
                }
                Lifecycle.Event.ON_RESUME -> {
                    web?.onResume()
                    web?.resumeTimers()
                }
                else -> Unit
            }
        }
        lebenszyklus?.addObserver(beobachter)
        onDispose { lebenszyklus?.removeObserver(beobachter) }
    }

    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { ctx ->
            WebView(ctx).apply {
                halter[0] = this
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                // Der Player startet Audio/Video (Motor, Wetter, Musik) ohne
                // frische Nutzergeste — sonst blockt der WebView den Autoplay.
                settings.mediaPlaybackRequiresUserGesture = false
                // Weg zurück in die Tourliste für den Knopf im Web-Player
                addJavascriptInterface(PlayerBruecke(this, zurueck), "LuhamboApp")
                // MapLibre GL braucht WebGL — in modernen WebViews vorhanden.
                webChromeClient = object : WebChromeClient() {
                    override fun onConsoleMessage(nachricht: ConsoleMessage): Boolean {
                        Log.d(
                            "LuhamboPlayer",
                            "${nachricht.messageLevel()} ${nachricht.message()} " +
                                "(${nachricht.sourceId()}:${nachricht.lineNumber()})",
                        )
                        return true
                    }
                }
                webViewClient = object : WebViewClient() {
                    override fun onReceivedError(
                        view: WebView,
                        anfrage: WebResourceRequest,
                        fehler: WebResourceError,
                    ) {
                        Log.e(
                            "LuhamboPlayer",
                            "Ladefehler ${fehler.errorCode} ${fehler.description} für ${anfrage.url}",
                        )
                    }
                }
                loadUrl("$serverUrl/erlebnis.html?tour=srv:$serverTourId&app=1")
            }
        },
        // Verlassen des Players: erst die Seite entladen (das stoppt Musik-, Motor-
        // und Wetter-Loops SOFORT), dann den WebView zerstören. Ohne das lief der
        // Ton weiter, weil der WebView bis zur Garbage Collection am Leben blieb.
        onRelease = { web ->
            halter[0] = null
            web.stopLoading()
            web.loadUrl("about:blank")
            web.onPause()
            web.pauseTimers()
            (web.parent as? ViewGroup)?.removeView(web)
            web.removeAllViews()
            web.destroy()
        },
    )
}
