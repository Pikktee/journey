// Eine einzelne Tour: ansehen, abspielen, benennen.
//
// Seit der Upload automatisch läuft, ist das hier keine Freigabe-Station mehr,
// sondern die Detailansicht. Der Titel wird darum beim Verlassen gesichert und
// — sobald die Tour beim Server ist — gleich dorthin nachgezogen: sonst bliebe
// eine nachträgliche Umbenennung für immer auf dem Gerät liegen.
//
// Der Titel steht IM Kopfbild und ist dort direkt beschreibbar. Vorher lagen
// zwei beschriftete Eingabefelder ganz oben und die Fotos darunter — das machte
// aus der Erinnerung an eine Reise einen Erfassungsbogen. Jetzt ist das erste,
// was man sieht, das Bild; wer den Namen ändern will, tippt ihn an.
package app.luhambo.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.outlined.Landscape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import app.luhambo.daten.TourEntity
import app.luhambo.daten.TourStatus
import coil.compose.AsyncImage
import java.util.Locale

@Composable
fun TourScreen(
    viewModel: TourViewModel,
    zurueck: () -> Unit,
    abspielen: (serverId: String) -> Unit,
    zumFoto: (mediumId: String) -> Unit,
) {
    val tour by viewModel.tour.collectAsState(initial = null)
    val medien by viewModel.medien.collectAsState(initial = emptyList())
    val sichtbarkeit by viewModel.sichtbarkeit.collectAsState()
    val route by viewModel.route.collectAsState()

    var titel by rememberSaveable { mutableStateOf<String?>(null) }
    var beschreibung by rememberSaveable { mutableStateOf<String?>(null) }
    var loeschenDialog by remember { mutableStateOf(false) }
    var teilen by remember { mutableStateOf(false) }

    LaunchedEffect(tour?.serverId) { if (tour?.serverId != null) viewModel.ladeSichtbarkeit() }

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
    val unten = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()

    Box(Modifier.fillMaxSize()) {
        LazyVerticalGrid(
            columns = GridCells.Fixed(3),
            modifier = Modifier.fillMaxSize(),
            // Enge Fugen: die Fotos sollen als zusammenhängende Fläche lesen,
            // nicht als Reihe einzelner Kacheln.
            horizontalArrangement = Arrangement.spacedBy(2.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
            contentPadding = PaddingValues(bottom = unten + 36.dp),
        ) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                Kopfbild(
                    tour = aktuelleTour,
                    titelbild = medien.lastOrNull()?.let { viewModel.datei(it) },
                    titel = titel.orEmpty(),
                    setzeTitel = { titel = it },
                    abspielen = aktuelleTour.serverId
                        ?.takeIf { aktuelleTour.status == TourStatus.HOCHGELADEN }
                        ?.let { id -> { abspielen(id) } },
                )
            }

            item(span = { GridItemSpan(maxLineSpan) }) {
                Column(Modifier.padding(horizontal = 20.dp)) {
                    Spacer(Modifier.height(16.dp))
                    Kennzahlen(aktuelleTour, medien.size)
                    Zustandszeile(
                        status = aktuelleTour.status,
                        fehler = aktuelleTour.fehler,
                        erneutVersuchen = { viewModel.ladeHoch(titel, beschreibung) },
                    )
                    // Die Form der Reise — sobald ein Track vorliegt.
                    if (route.size >= 2) {
                        Spacer(Modifier.height(22.dp))
                        Abschnittstitel("Route")
                        Spacer(Modifier.height(10.dp))
                        Routenskizze(
                            spur = route,
                            abgeschlossen = true,
                            modifier = Modifier.fillMaxWidth().height(150.dp),
                        )
                    }
                    // Keine Überschrift „N Fotos" — die Zahl steht schon in der
                    // Zeile darüber, und ein eingerückter Text unmittelbar über
                    // dem randlosen Gitter risse eine Fluchtlinie auf, die
                    // nirgends fortgesetzt wird.
                    Spacer(Modifier.height(22.dp))
                }
            }

            items(medien, key = { it.id }) { medium ->
                Box(
                    Modifier
                        .aspectRatio(1f)
                        .background(MaterialTheme.colorScheme.surfaceContainer)
                        .clickable { zumFoto(medium.id) },
                ) {
                    AsyncImage(
                        model = viewModel.datei(medium),
                        contentDescription = medium.caption ?: "Aufnahme ${medium.id}",
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxSize(),
                    )
                    if (medium.typ == "video") {
                        Videoabzeichen(Modifier.align(Alignment.Center))
                    }
                }
            }

            item(span = { GridItemSpan(maxLineSpan) }) {
                Column(Modifier.padding(horizontal = 20.dp)) {
                    Spacer(Modifier.height(30.dp))
                    Abschnittstitel("Beschreibung")
                    Spacer(Modifier.height(10.dp))
                    OutlinedTextField(
                        value = beschreibung ?: "",
                        onValueChange = { beschreibung = it },
                        placeholder = { Text("Was war das für ein Tag?") },
                        modifier = Modifier.fillMaxWidth().height(104.dp),
                        textStyle = MaterialTheme.typography.bodyMedium,
                    )
                    Spacer(Modifier.height(26.dp))
                    // Löschen steht unten, nicht in der Kopfleiste: Es ist der
                    // einzige Schritt hier, der sich nicht rückgängig machen
                    // lässt — er soll gesucht, nicht getroffen werden.
                    TextButton(
                        onClick = { loeschenDialog = true },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text("Tour löschen", color = MaterialTheme.colorScheme.error)
                    }
                }
            }
        }

        // Die Knöpfe schweben über dem Bild, damit der Kopf randlos bleibt
        Rundknopf(
            symbol = Icons.AutoMirrored.Filled.ArrowBack,
            beschreibung = "Zurück",
            beiKlick = zurueck,
            modifier = Modifier.align(Alignment.TopStart).statusBarsPadding().padding(12.dp),
        )
        // Teilen erst, wenn die Tour beim Server liegt — vorher gäbe es keinen
        // Link, auf den man jemanden schicken könnte.
        if (aktuelleTour.serverId != null) {
            Rundknopf(
                symbol = Icons.Default.Share,
                beschreibung = "Tour teilen",
                beiKlick = { teilen = true },
                modifier = Modifier.align(Alignment.TopEnd).statusBarsPadding().padding(12.dp),
            )
        }
    }

    if (teilen) {
        aktuelleTour.serverId?.let { serverId ->
            TeilenBlatt(
                serverTourId = serverId,
                titel = titel ?: aktuelleTour.titel,
                aktuelleSichtbarkeit = sichtbarkeit ?: Sichtbarkeit.PRIVAT,
                schliessen = { teilen = false },
                setzeSichtbarkeit = viewModel::setzeSichtbarkeit,
            )
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
                }) { Text("Löschen", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { loeschenDialog = false }) { Text("Abbrechen") } },
        )
    }
}

/**
 * Titelbild mit dem Namen der Reise darauf — beschreibbar.
 *
 * Liegt eine fertige Tour vor, führt ein Abspiel-Knopf in der Mitte zum Player:
 * Die Tour IST ein Film, und ein Dreieck auf einem Standbild sagt das ohne Wort.
 */
@Composable
private fun Kopfbild(
    tour: TourEntity,
    titelbild: java.io.File?,
    titel: String,
    setzeTitel: (String) -> Unit,
    abspielen: (() -> Unit)?,
) {
    val tastatur = LocalSoftwareKeyboardController.current
    val fokus = remember { FocusRequester() }
    Box(Modifier.fillMaxWidth().aspectRatio(16f / 11f)) {
        if (titelbild != null) {
            AsyncImage(
                model = titelbild,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            Box(
                Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surfaceContainer),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Outlined.Landscape,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.35f),
                    modifier = Modifier.size(40.dp),
                )
            }
        }

        Box(
            Modifier.fillMaxSize().background(
                Brush.verticalGradient(
                    0f to Color(0x66000000),
                    0.32f to Color(0x1A000000),
                    1f to Color(0xF00A0D12),
                ),
            ),
        )

        if (abspielen != null) {
            Box(
                Modifier
                    .align(Alignment.Center)
                    .size(66.dp)
                    .clip(CircleShape)
                    .background(Color(0x8A06090E))
                    .clickable(onClickLabel = "Tour abspielen", onClick = abspielen),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Default.PlayArrow,
                    contentDescription = "Tour abspielen",
                    tint = Tinte,
                    modifier = Modifier.size(38.dp),
                )
            }
        }

        Schreibzeile(
            wert = titel,
            setzeWert = setzeTitel,
            platzhalter = if (tour.serverId == null) "Tour benennen" else "Unbenannte Tour",
            stil = MaterialTheme.typography.headlineMedium,
            fokus = fokus,
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(start = 18.dp, end = 14.dp, bottom = 10.dp),
        )
    }
}

/** Die harten Zahlen der Reise, in gleich breiten Ziffern. */
@Composable
private fun Kennzahlen(tour: TourEntity, fotos: Int) {
    val teile = buildList {
        add(String.format(Locale.GERMAN, "%.1f km", tour.distanzM / 1000))
        dauer(tour)?.let { add(it) }
        add(if (fotos == 1) "1 Foto" else "$fotos Fotos")
    }
    Text(
        teile.joinToString(" · "),
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

/**
 * Was gerade mit der Tour passiert — und nur dann, wenn etwas passiert.
 *
 * Die fertige Tour meldet nichts: Der Abspiel-Knopf im Bild sagt bereits, dass
 * sie fertig ist.
 */
@Composable
private fun Zustandszeile(status: TourStatus, fehler: String?, erneutVersuchen: () -> Unit) {
    when (status) {
        TourStatus.HOCHGELADEN, TourStatus.AUFNAHME -> Unit
        TourStatus.LAEDT_HOCH -> Hinweiszeile {
            // size, nicht height: height allein lässt die Breite beim
            // Standardmaß (40 dp) und der Kreis wird seitlich beschnitten.
            CircularProgressIndicator(
                Modifier.size(15.dp),
                strokeWidth = 2.dp,
                color = Sonne,
            )
            Text(
                "Wird hochgeladen",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        TourStatus.FEHLER -> Hinweiszeile {
            Icon(
                Icons.Default.ErrorOutline,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.error,
                modifier = Modifier.size(15.dp),
            )
            Text(
                fehler ?: "Upload fehlgeschlagen",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.weight(1f, fill = false),
            )
            TextButton(onClick = erneutVersuchen, contentPadding = PaddingValues(horizontal = 8.dp)) {
                Icon(Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(15.dp))
                Text("Erneut", Modifier.padding(start = 6.dp))
            }
        }
        // ENTWURF: der Upload läuft von selbst — hier steht nur, woran es hakt
        else -> Hinweiszeile {
            Icon(
                Icons.Default.CloudUpload,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(15.dp),
            )
            Text(
                "Wird geladen, sobald eine Verbindung besteht",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

// RowScope, nicht nur @Composable: sonst steht `weight` im Inhalt nicht zur
// Verfügung, und ein langer Fehlertext drängt den Knopf daneben aus dem Bild.
@Composable
private fun Hinweiszeile(inhalt: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(top = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) { inhalt() }
}

/** Aufnahmedauer als „1 h 12 min"; null, solange die Aufnahme läuft. */
private fun dauer(tour: TourEntity): String? {
    val ende = tour.endeMs ?: return null
    val minuten = ((ende - tour.startMs) / 60_000).coerceAtLeast(0)
    if (minuten < 1) return null
    return if (minuten < 60) "$minuten min" else "${minuten / 60} h ${minuten % 60} min"
}
