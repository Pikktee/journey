// Nachbearbeitung eines Entwurfs: Titel/Beschreibung anpassen (Auto-Titel
// bleibt Vorschlag), Hochladen anstoßen, danach direkt abspielen.
package app.luhambo.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.luhambo.daten.TourStatus
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TourScreen(
    viewModel: TourViewModel,
    zurueck: () -> Unit,
    abspielen: (serverId: String) -> Unit,
) {
    val tour by viewModel.tour.collectAsState(initial = null)
    val fotoAnzahl by viewModel.fotoAnzahl.collectAsState(initial = 0)

    var titel by rememberSaveable { mutableStateOf<String?>(null) }
    var beschreibung by rememberSaveable { mutableStateOf<String?>(null) }
    var loeschenDialog by remember { mutableStateOf(false) }

    // Editierfelder einmalig aus der DB befüllen (danach gehört der Text dem Nutzer)
    LaunchedEffect(tour?.id) {
        titel = titel ?: tour?.titel
        beschreibung = beschreibung ?: tour?.beschreibung
    }

    val aktuelleTour = tour ?: return

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Tour bearbeiten") },
                navigationIcon = {
                    IconButton(onClick = zurueck) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Zurück")
                    }
                },
                actions = {
                    IconButton(onClick = { loeschenDialog = true }) {
                        Icon(Icons.Default.Delete, contentDescription = "Tour löschen")
                    }
                },
            )
        },
    ) { innen ->
        Column(
            Modifier.fillMaxSize().padding(innen).padding(20.dp).verticalScroll(rememberScrollState()),
        ) {
            OutlinedTextField(
                value = titel ?: "",
                onValueChange = { titel = it },
                label = { Text("Titel") },
                placeholder = { Text("Wird beim Hochladen automatisch benannt") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
            )
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = beschreibung ?: "",
                onValueChange = { beschreibung = it },
                label = { Text("Beschreibung") },
                modifier = Modifier.fillMaxWidth().height(120.dp),
            )
            Spacer(Modifier.height(12.dp))
            Text(
                String.format(
                    Locale.GERMAN,
                    "%.1f km · %d Foto%s",
                    aktuelleTour.distanzM / 1000,
                    fotoAnzahl,
                    if (fotoAnzahl == 1) "" else "s",
                ),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            aktuelleTour.fehler?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
            }

            Spacer(Modifier.height(24.dp))

            when (aktuelleTour.status) {
                TourStatus.LAEDT_HOCH -> {
                    Button(onClick = {}, enabled = false, modifier = Modifier.fillMaxWidth()) {
                        // size, nicht height: height allein lässt die Breite beim
                        // Standardmaß (40dp) und der Kreis wird seitlich beschnitten.
                        CircularProgressIndicator(Modifier.size(20.dp).padding(end = 4.dp))
                        Text("Wird hochgeladen …")
                    }
                }
                TourStatus.HOCHGELADEN -> {
                    aktuelleTour.serverId?.let { serverId ->
                        Button(onClick = { abspielen(serverId) }, modifier = Modifier.fillMaxWidth()) {
                            Icon(Icons.Default.PlayArrow, contentDescription = null)
                            Text("Tour abspielen", Modifier.padding(start = 8.dp))
                        }
                    }
                }
                else -> {
                    Button(
                        onClick = { viewModel.speichereUndLadeHoch(titel, beschreibung) },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Icon(Icons.Default.CloudUpload, contentDescription = null)
                        Text("Hochladen", Modifier.padding(start = 8.dp))
                    }
                }
            }
        }
    }

    if (loeschenDialog) {
        AlertDialog(
            onDismissRequest = { loeschenDialog = false },
            title = { Text("Tour löschen?") },
            text = { Text("Track, Fotos und Entwurf werden vom Gerät entfernt.") },
            confirmButton = {
                TextButton(onClick = {
                    loeschenDialog = false
                    viewModel.loesche(danach = zurueck)
                }) { Text("Löschen") }
            },
            dismissButton = { TextButton(onClick = { loeschenDialog = false }) { Text("Abbrechen") } },
        )
    }
}
