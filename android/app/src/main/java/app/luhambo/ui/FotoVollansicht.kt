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

import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.foundation.layout.Spacer
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import app.luhambo.daten.TourStatus
import coil.compose.AsyncImage

@Composable
fun FotoVollansicht(viewModel: FotoViewModel, zurueck: () -> Unit) {
    val medium by viewModel.medium.collectAsState(initial = null)
    val tour by viewModel.tour.collectAsState(initial = null)
    val tastatur = LocalSoftwareKeyboardController.current
    // Während des Uploads ist das Manifest schon beim Server; verschwindet eine
    // Datei danach, hängt seine Vollständigkeitsprüfung. Und was hochgeladen
    // ist, wird nicht mehr auf dem Gerät gelöscht — dafür gibt es das Studio.
    val loeschenErlaubt = tour?.status == TourStatus.AUFNAHME ||
        tour?.status == TourStatus.ENTWURF ||
        (tour?.status == TourStatus.FEHLER && tour?.serverId == null)
    var titel by rememberSaveable { mutableStateOf<String?>(null) }
    var fragtLoeschen by remember { mutableStateOf(false) }
    val fokus = remember { FocusRequester() }

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
                    if (m.typ == "video") {
                        // Lokale Datei — hier braucht es keine Anmeldung
                        Videoflaeche(
                            quelle = Uri.fromFile(viewModel.datei(m)),
                            modifier = Modifier.fillMaxSize(),
                        )
                    } else {
                        AsyncImage(
                            model = viewModel.datei(m),
                            contentDescription = "Aufgenommenes Foto",
                            contentScale = ContentScale.Fit,
                            modifier = Modifier.fillMaxSize(),
                        )
                    }
                }
            }

            // Kein Material-Textfeld: dessen Container und Unterstrich zögen auf
            // schwarzem Grund einen grauen Kasten unter das Bild. Hier steht
            // nur die Zeile selbst — mit gesperrter Überschrift darüber, damit
            // erkennbar bleibt, dass sie beschreibbar ist.
            Column(
                Modifier
                    .fillMaxWidth()
                    .navigationBarsPadding()
                    .padding(horizontal = 20.dp, vertical = 18.dp),
            ) {
                Abschnittstitel("Titel")
                Schreibzeile(
                    wert = titel.orEmpty(),
                    setzeWert = { titel = it },
                    platzhalter = "Was ist hier zu sehen?",
                    stil = MaterialTheme.typography.titleLarge,
                    fokus = fokus,
                    fertig = { tastatur?.hide() },
                )
            }
        }

        Rundknopf(
            symbol = Icons.Default.Close,
            beschreibung = "Schließen",
            beiKlick = zurueck,
            modifier = Modifier.align(Alignment.TopStart).statusBarsPadding().padding(12.dp),
        )

        if (loeschenErlaubt) {
            Rundknopf(
                symbol = Icons.Default.DeleteOutline,
                beschreibung = "Foto löschen",
                beiKlick = { fragtLoeschen = true },
                modifier = Modifier.align(Alignment.TopEnd).statusBarsPadding().padding(12.dp),
            )
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
