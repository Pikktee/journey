// Abspielen im WebView: lädt den gehosteten Web-Player mit /erlebnis.html?tour=srv:<id>
// — komplette Wiederverwendung der Engine (Plan-Entscheid), braucht Internet.
// serverUrl ist das Prod-Web-Origin (fest, s. Navigation). WebChromeClient +
// onReceivedError schreiben JS-/Ladefehler ins Logcat (Tag „LuhamboPlayer"),
// damit ein schwarzer Bildschirm diagnostizierbar bleibt.
package app.luhambo.ui

import android.annotation.SuppressLint
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView

@SuppressLint("SetJavaScriptEnabled")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PlayerScreen(serverUrl: String, serverTourId: String, zurueck: () -> Unit) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Wiedergabe") },
                navigationIcon = {
                    IconButton(onClick = zurueck) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Zurück")
                    }
                },
            )
        },
    ) { innen ->
        AndroidView(
            modifier = Modifier.fillMaxSize().padding(innen),
            factory = { ctx ->
                WebView(ctx).apply {
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    // Der Player startet Audio/Video (Motor, Wetter, Musik) ohne
                    // frische Nutzergeste — sonst blockt der WebView den Autoplay.
                    settings.mediaPlaybackRequiresUserGesture = false
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
                    loadUrl("$serverUrl/erlebnis.html?tour=srv:$serverTourId")
                }
            },
        )
    }
}
