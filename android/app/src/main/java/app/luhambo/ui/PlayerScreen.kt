// Abspielen im WebView: lädt den gehosteten Web-Player mit ?tour=srv:<id> —
// komplette Wiederverwendung der Engine (Plan-Entscheid), braucht Internet.
package app.luhambo.ui

import android.annotation.SuppressLint
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
                    // MapLibre GL braucht WebGL — in modernen WebViews vorhanden
                    webViewClient = WebViewClient()
                    loadUrl("$serverUrl/?tour=srv:$serverTourId")
                }
            },
        )
    }
}
