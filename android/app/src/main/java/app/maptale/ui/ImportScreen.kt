// Import-Screen (M8): GPX per SAF-Picker wählen, Fotos/Videos aus der Galerie
// dazunehmen, optional einen Titel setzen — dann hochladen. Das Parsen und
// Platzieren macht der Server; hier nur Auswahl + Fortschritt.
//
// DERZEIT OHNE EINSTIEG: Auf dem Telefon führt der Weg über die Aufnahme, und
// eine GPX-Datei liegt selten dort — das ist eine Aufgabe fürs Studio am
// Rechner. Der Code bleibt trotzdem stehen: er ist vollständig und getestet und
// wird gebraucht, sobald die App GPX-Dateien per „Öffnen mit" annimmt
// (Intent-Filter im Manifest). Wer ihn wieder erreichbar macht, hängt eine
// Route in Navigation.kt ein.
package app.maptale.ui

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Map
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ImportScreen(
    viewModel: ImportViewModel,
    back: () -> Unit,
    abspielen: (String) -> Unit,
) {
    val state by viewModel.state.collectAsState()
    var gpxUri by remember { mutableStateOf<Uri?>(null) }
    var gpxName by remember { mutableStateOf<String?>(null) }
    var mediaUris by remember { mutableStateOf<List<Uri>>(emptyList()) }
    var title by remember { mutableStateOf("") }

    // SAF: GPX öffnen (OpenDocument gibt eine dauerhaft lesbare Uri). GPX hat
    // keinen verlässlichen MIME-Typ → breit filtern und alles zulassen.
    val gpxPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri ->
        if (uri != null) {
            gpxUri = uri
            gpxName = uri.lastPathSegment?.substringAfterLast('/')
        }
    }
    val mediaPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenMultipleDocuments(),
    ) { uris -> if (uris.isNotEmpty()) mediaUris = uris }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Tour importieren") },
                navigationIcon = {
                    IconButton(onClick = back) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Zurück")
                    }
                },
            )
        },
    ) { inner ->
        Column(
            Modifier.fillMaxSize().padding(inner).padding(20.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                "Wähle eine GPX-Aufzeichnung (z. B. aus Komoot) und optional Fotos oder Videos. " +
                    "Maptale baut daraus eine Kamerafahrt. Wetter und Ortsnamen kommen automatisch.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            OutlinedButton(
                onClick = { gpxPicker.launch(arrayOf("application/gpx+xml", "application/xml", "text/xml", "*/*")) },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Icon(Icons.Default.Map, contentDescription = null)
                Text("  " + (gpxName ?: "GPX-Datei wählen"))
            }

            OutlinedButton(
                onClick = { mediaPicker.launch(arrayOf("image/*", "video/*")) },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Icon(Icons.Default.PhotoLibrary, contentDescription = null)
                Text(
                    "  " + if (mediaUris.isEmpty()) "Fotos & Videos wählen (optional)"
                    else "${mediaUris.size} Medien gewählt",
                )
            }

            OutlinedTextField(
                value = title,
                onValueChange = { title = it },
                label = { Text("Titel (optional)") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )

            when (val z = state) {
                is ImportViewModel.State.Loading -> {
                    LinearProgressIndicator(progress = { z.progress }, modifier = Modifier.fillMaxWidth())
                    Text(z.text, style = MaterialTheme.typography.bodySmall)
                }
                is ImportViewModel.State.Failed ->
                    Text(z.message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
                is ImportViewModel.State.Complete -> {
                    Text("Import fertig!", color = MaterialTheme.colorScheme.primary)
                    Button(onClick = { abspielen(z.serverTourId) }, modifier = Modifier.fillMaxWidth()) {
                        Text("Abspielen")
                    }
                }
                ImportViewModel.State.Idle -> {}
            }

            val running = state is ImportViewModel.State.Loading
            Button(
                onClick = { gpxUri?.let { viewModel.importGpx(it, mediaUris, title.ifBlank { null }) } },
                enabled = gpxUri != null && !running,
                modifier = Modifier.fillMaxWidth(),
            ) {
                if (running) {
                    CircularProgressIndicator(modifier = Modifier.height(18.dp), strokeWidth = 2.dp)
                } else {
                    Text("Importieren & hochladen")
                }
            }

            Text(
                "Ohne Zeitstempel im GPX ist kein Import möglich.",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}
