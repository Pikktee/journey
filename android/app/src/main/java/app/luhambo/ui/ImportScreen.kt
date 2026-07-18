// Import-Screen (M8): GPX per SAF-Picker wählen, Fotos/Videos aus der Galerie
// dazunehmen, optional einen Titel setzen — dann hochladen. Das Parsen und
// Platzieren macht der Server; hier nur Auswahl + Fortschritt.
package app.luhambo.ui

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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ImportScreen(
    viewModel: ImportViewModel,
    zurueck: () -> Unit,
    abspielen: (String) -> Unit,
) {
    val zustand by viewModel.zustand.collectAsState()
    var gpxUri by remember { mutableStateOf<Uri?>(null) }
    var gpxName by remember { mutableStateOf<String?>(null) }
    var medienUris by remember { mutableStateOf<List<Uri>>(emptyList()) }
    var titel by remember { mutableStateOf("") }

    // SAF: GPX öffnen (OpenDocument gibt eine dauerhaft lesbare Uri). GPX hat
    // keinen verlässlichen MIME-Typ → breit filtern und alles zulassen.
    val gpxWahl = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri ->
        if (uri != null) {
            gpxUri = uri
            gpxName = uri.lastPathSegment?.substringAfterLast('/')
        }
    }
    val medienWahl = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenMultipleDocuments(),
    ) { uris -> if (uris.isNotEmpty()) medienUris = uris }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Tour importieren") },
                navigationIcon = {
                    IconButton(onClick = zurueck) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Zurück")
                    }
                },
            )
        },
    ) { innen ->
        Column(
            Modifier.fillMaxSize().padding(innen).padding(20.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                "Wähle eine GPX-Aufzeichnung (z. B. aus Komoot) und optional Fotos oder Videos. " +
                    "Luhambo baut daraus eine Kamerafahrt — Wetter und Ortsnamen kommen automatisch.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            OutlinedButton(
                onClick = { gpxWahl.launch(arrayOf("application/gpx+xml", "application/xml", "text/xml", "*/*")) },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Icon(Icons.Default.Map, contentDescription = null)
                Text("  " + (gpxName ?: "GPX-Datei wählen"))
            }

            OutlinedButton(
                onClick = { medienWahl.launch(arrayOf("image/*", "video/*")) },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Icon(Icons.Default.PhotoLibrary, contentDescription = null)
                Text(
                    "  " + if (medienUris.isEmpty()) "Fotos & Videos wählen (optional)"
                    else "${medienUris.size} Medien gewählt",
                )
            }

            OutlinedTextField(
                value = titel,
                onValueChange = { titel = it },
                label = { Text("Titel (optional)") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )

            when (val z = zustand) {
                is ImportViewModel.Zustand.Laedt -> {
                    LinearProgressIndicator(progress = { z.fortschritt }, modifier = Modifier.fillMaxWidth())
                    Text(z.text, style = MaterialTheme.typography.bodySmall)
                }
                is ImportViewModel.Zustand.Fehler ->
                    Text(z.nachricht, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
                is ImportViewModel.Zustand.Fertig -> {
                    Text("Import fertig!", color = MaterialTheme.colorScheme.primary)
                    Button(onClick = { abspielen(z.serverTourId) }, modifier = Modifier.fillMaxWidth()) {
                        Text("Abspielen")
                    }
                }
                ImportViewModel.Zustand.Ruhe -> {}
            }

            val laeuft = zustand is ImportViewModel.Zustand.Laedt
            Button(
                onClick = { gpxUri?.let { viewModel.importiere(it, medienUris, titel.ifBlank { null }) } },
                enabled = gpxUri != null && !laeuft,
                modifier = Modifier.fillMaxWidth(),
            ) {
                if (laeuft) {
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
