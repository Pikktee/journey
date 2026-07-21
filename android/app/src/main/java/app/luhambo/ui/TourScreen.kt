// Eine einzelne Tour: Titel anpassen, Fotos durchsehen, abspielen.
//
// Seit der Upload automatisch läuft, ist das hier keine Freigabe-Station mehr,
// sondern die Detailansicht. Der Titel wird darum beim Verlassen gesichert und
// — sobald die Tour beim Server ist — gleich dorthin nachgezogen: sonst bliebe
// eine nachträgliche Umbenennung für immer auf dem Gerät liegen.
package app.luhambo.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
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
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import app.luhambo.daten.TourStatus
import coil.compose.AsyncImage
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TourScreen(
    viewModel: TourViewModel,
    zurueck: () -> Unit,
    abspielen: (serverId: String) -> Unit,
    zumFoto: (mediumId: String) -> Unit,
) {
    val tour by viewModel.tour.collectAsState(initial = null)
    val medien by viewModel.medien.collectAsState(initial = emptyList())

    var titel by rememberSaveable { mutableStateOf<String?>(null) }
    var beschreibung by rememberSaveable { mutableStateOf<String?>(null) }
    var loeschenDialog by remember { mutableStateOf(false) }

    // Einmalig aus der Datenbank befüllen; danach gehört der Text dem Nutzer.
    // Die Ausnahme ist der Auto-Titel, den der Upload-Worker nachträgt: hat der
    // Nutzer nichts getippt, soll er ihn sehen statt eines leeren Feldes.
    LaunchedEffect(tour?.id, tour?.titel) {
        if (titel.isNullOrBlank()) titel = tour?.titel
        beschreibung = beschreibung ?: tour?.beschreibung
    }

    // Beim Verlassen sichern — kein „Speichern"-Knopf für zwei Textfelder
    DisposableEffect(tour?.id) {
        onDispose { if (titel != null) viewModel.sichereTexte(titel, beschreibung) }
    }

    val aktuelleTour = tour ?: return

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Tour") },
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
        Column(Modifier.fillMaxSize().padding(innen).padding(horizontal = 20.dp)) {
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
                modifier = Modifier.fillMaxWidth().height(100.dp),
            )
            Spacer(Modifier.height(12.dp))
            Text(
                String.format(
                    Locale.GERMAN,
                    "%.1f km · %d Foto%s",
                    aktuelleTour.distanzM / 1000,
                    medien.size,
                    if (medien.size == 1) "" else "s",
                ),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            aktuelleTour.fehler?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
            }

            Spacer(Modifier.height(16.dp))
            Zustandsknopf(
                status = aktuelleTour.status,
                serverId = aktuelleTour.serverId,
                abspielen = abspielen,
                erneutVersuchen = { viewModel.ladeHoch(titel, beschreibung) },
            )
            Spacer(Modifier.height(20.dp))

            if (medien.isNotEmpty()) {
                LazyVerticalGrid(
                    columns = GridCells.Adaptive(104.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(medien, key = { it.id }) { medium ->
                        Box(
                            Modifier
                                .size(104.dp)
                                .clip(RoundedCornerShape(10.dp))
                                .clickable { zumFoto(medium.id) },
                            contentAlignment = Alignment.Center,
                        ) {
                            AsyncImage(
                                model = viewModel.datei(medium),
                                contentDescription = medium.caption ?: "Aufnahme ${medium.id}",
                                contentScale = ContentScale.Crop,
                                modifier = Modifier.fillMaxSize(),
                            )
                        }
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
                    // Der Titel des gelöschten Entwurfs darf nicht nachträglich
                    // wieder gesichert werden (DisposableEffect oben).
                    titel = null
                    viewModel.loesche(danach = zurueck)
                }) { Text("Löschen") }
            },
            dismissButton = { TextButton(onClick = { loeschenDialog = false }) { Text("Abbrechen") } },
        )
    }
}

@Composable
private fun Zustandsknopf(
    status: TourStatus,
    serverId: String?,
    abspielen: (String) -> Unit,
    erneutVersuchen: () -> Unit,
) {
    when (status) {
        TourStatus.LAEDT_HOCH -> Button(onClick = {}, enabled = false, modifier = Modifier.fillMaxWidth()) {
            // size, nicht height: height allein lässt die Breite beim
            // Standardmaß (40dp) und der Kreis wird seitlich beschnitten.
            CircularProgressIndicator(Modifier.size(20.dp).padding(end = 4.dp))
            Text("Wird hochgeladen …", Modifier.padding(start = 8.dp))
        }
        TourStatus.HOCHGELADEN -> serverId?.let {
            Button(onClick = { abspielen(it) }, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Default.PlayArrow, contentDescription = null)
                Text("Tour abspielen", Modifier.padding(start = 8.dp))
            }
        }
        TourStatus.FEHLER -> Button(onClick = erneutVersuchen, modifier = Modifier.fillMaxWidth()) {
            Icon(Icons.Default.Refresh, contentDescription = null)
            Text("Erneut versuchen", Modifier.padding(start = 8.dp))
        }
        // ENTWURF: der Upload läuft von selbst — hier steht nur, woran es hakt
        else -> Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                Icons.Default.CloudUpload,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(18.dp),
            )
            Text(
                "Wird hochgeladen, sobald eine Verbindung besteht",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
