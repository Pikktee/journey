// Rückmeldung geben — die Web-Maske /feedback?app=1 in einem WebView.
//
// Bewusst KEINE eigene Compose-Maske: Text, Felder und der freiwillige
// technische Kontext stehen dann einmal im Web und nicht zweimal, und eine
// bessere Formulierung erreicht die App ohne neues Release. Der Preis steht
// offen: Ohne Netz gibt es hier nichts zu sehen — genau dann, wenn jemand
// vielleicht melden will, dass nichts lädt. Wer das ändern will, braucht eine
// native Maske samt Warteschlange; die Route (`POST /api/feedback`) nimmt
// beides an.
//
// Anders als der Player läuft dieser Screen NICHT im Vollbild: Er ist ein
// Formular, kein Erlebnis, und eine Leiste mit „Zurück" ist hier der Weg
// hinaus statt verschenkter Bühne.
package app.maptale.ui

import android.annotation.SuppressLint
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView

@SuppressLint("SetJavaScriptEnabled")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FeedbackScreen(
    serverUrl: String,
    /** Tauscht das API-Token gegen eine Sitzung; null = ohne Anmeldung weiter. */
    sitzungHolen: suspend () -> String?,
    zurueck: () -> Unit,
) {
    // Dieselbe Reihenfolge wie im Player: erst das Sitzungs-Cookie, dann laden.
    // Ohne Sitzung käme die Meldung anonym an — sie zählt trotzdem, aber die
    // Rückfrage wäre nur über eine von Hand getippte Adresse möglich.
    var bereit by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        val sitzung = sitzungHolen()
        if (sitzung != null) {
            CookieManager.getInstance().apply {
                setAcceptCookie(true)
                setCookie("$serverUrl/", "maptale_session=$sitzung; Path=/; Secure; SameSite=Lax")
                flush()
            }
        }
        bereit = true
    }

    Column(Modifier.fillMaxSize().statusBarsPadding()) {
        TopAppBar(
            title = { Text("Rückmeldung geben") },
            navigationIcon = {
                IconButton(onClick = zurueck) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Zurück")
                }
            },
        )
        if (!bereit) return@Column
        AndroidView(
            modifier = Modifier.fillMaxSize().navigationBarsPadding(),
            factory = { ctx ->
                WebView(ctx).apply {
                    layoutParams = ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT,
                    )
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    // Kein eigener WebChromeClient: Hier läuft kein WebGL und
                    // nichts, dessen Konsole man mitlesen müsste.
                    webViewClient = WebViewClient()
                    loadUrl("$serverUrl/feedback?app=1")
                }
            },
            onRelease = { web ->
                web.stopLoading()
                web.loadUrl("about:blank")
                (web.parent as? ViewGroup)?.removeView(web)
                web.removeAllViews()
                web.destroy()
            },
        )
    }
}
