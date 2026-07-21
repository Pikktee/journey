// Ein Foto groß, mit genau einer Handlung daneben: beschriften.
//
// Die Bühne ist fest und schwarz — Hoch- und Querformat teilen sich denselben
// Rahmen, das Bild wird eingepasst statt beschnitten. Darunter EINE Zeile für
// den Nutzertext. Sie heißt „Titel", weil sie im Player als Überschrift des
// Foto-Stopps erscheint (und bei geteilten Touren für jeden sichtbar ist) —
// „Notiz" würde eine Privatheit versprechen, die es nicht gibt.
//
// Gespeichert wird beim Verlassen, nicht über einen Knopf: ein „Sichern" für
// eine einzelne Zeile wäre Zeremonie ohne Gewinn.
package app.luhambo.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage

@Composable
fun FotoVollansicht(
    viewModel: FotoViewModel,
    zurueck: () -> Unit,
    loeschenErlaubt: Boolean = true,
) {
    val medium by viewModel.medium.collectAsState(initial = null)
    val tastatur = LocalSoftwareKeyboardController.current
    var titel by rememberSaveable { mutableStateOf<String?>(null) }
    var fragtLoeschen by remember { mutableStateOf(false) }

    // Einmalig aus der Datenbank befüllen; danach gehört das Feld dem Nutzer
    // (dasselbe Muster wie die Titelfelder im Tour-Entwurf).
    LaunchedEffect(medium?.id) {
        if (titel == null) medium?.let { titel = it.caption.orEmpty() }
    }

    // Beim Verlassen sichern — egal ob über den Knopf, die Zurück-Geste oder
    // weil der Screen anderweitig abgeräumt wird.
    DisposableEffect(Unit) {
        onDispose { titel?.let { viewModel.setzeTitel(it) } }
    }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        Column(Modifier.fillMaxSize()) {
            Box(
                Modifier.fillMaxWidth().weight(1f),
                contentAlignment = Alignment.Center,
            ) {
                medium?.let { m ->
                    AsyncImage(
                        model = viewModel.datei(m),
                        contentDescription = "Aufgenommenes Foto",
                        contentScale = ContentScale.Fit,
                        modifier = Modifier.fillMaxSize(),
                    )
                }
            }

            TextField(
                value = titel.orEmpty(),
                onValueChange = { titel = it },
                placeholder = { Text("Titel hinzufügen", color = Color(0x99FFFFFF)) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { tastatur?.hide() }),
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = Color.Transparent,
                    unfocusedContainerColor = Color.Transparent,
                    focusedTextColor = Color.White,
                    unfocusedTextColor = Color.White,
                ),
                modifier = Modifier
                    .fillMaxWidth()
                    .navigationBarsPadding()
                    .padding(horizontal = 8.dp),
            )
        }

        IconButton(
            onClick = zurueck,
            modifier = Modifier.align(Alignment.TopStart).statusBarsPadding().padding(8.dp),
        ) {
            Icon(Icons.Default.Close, contentDescription = "Schließen", tint = Color.White)
        }

        if (loeschenErlaubt) {
            IconButton(
                onClick = { fragtLoeschen = true },
                modifier = Modifier.align(Alignment.TopEnd).statusBarsPadding().padding(8.dp),
            ) {
                Icon(Icons.Default.DeleteOutline, contentDescription = "Foto löschen", tint = Color.White)
            }
        }
    }

    if (fragtLoeschen) {
        AlertDialog(
            onDismissRequest = { fragtLoeschen = false },
            title = { Text("Foto löschen?") },
            text = { Text("Das Foto wird vom Gerät entfernt und erscheint nicht in der Tour.") },
            confirmButton = {
                TextButton(onClick = {
                    fragtLoeschen = false
                    // Der Titel des gelöschten Fotos darf nicht nachträglich
                    // wieder eingetragen werden (DisposableEffect oben).
                    titel = null
                    viewModel.loesche(zurueck)
                }) { Text("Löschen") }
            },
            dismissButton = { TextButton(onClick = { fragtLoeschen = false }) { Text("Abbrechen") } },
        )
    }
}
