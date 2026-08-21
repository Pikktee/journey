// Eine fertige Reise: ansehen, abspielen, benennen, teilen, löschen.
//
// Bis hierher gab es diese Seite nicht: Nach dem Upload gewann in der Liste die
// Server-Karte, und die sprang direkt in den Player. Der lokale Detail-Screen
// wäre leer geblieben — er liest die Zeile in Room, und die beschreibt den
// Entwurf VOR dem Upload. Damit waren Fotos, Umbenennen und Löschen nach dem
// Hochladen nur noch im Studio erreichbar.
//
// Aufbau wie beim Entwurf ([TourScreen]), damit sich beide gleich anfühlen:
// Titelbild mit dem Namen darin, Kennzahlen, Fotogitter, Beschreibung. Der
// Unterschied liegt in der Quelle — hier kommt alles über die API.
package app.maptale.ui

import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.AddPhotoAlternate
import androidx.compose.material.icons.filled.HourglassEmpty
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.outlined.Landscape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.unit.dp
import app.maptale.MaptaleApp
import app.maptale.gallery.canReadGallery
import app.maptale.gallery.backfillMessage
import app.maptale.recording.PhotoMark
import app.maptale.recording.thinOut
import app.maptale.upload.ServerMedium
import coil.compose.AsyncImage
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

@Composable
fun ServerTourScreen(
    viewModel: ServerTourViewModel,
    back: () -> Unit,
    abspielen: (serverId: String) -> Unit,
) {
    val tour by viewModel.tour.collectAsState()
    val detail by viewModel.detail.collectAsState()
    val loading by viewModel.loading.collectAsState()
    val error by viewModel.error.collectAsState()
    val app = LocalContext.current.applicationContext as MaptaleApp

    var title by rememberSaveable { mutableStateOf<String?>(null) }
    var description by rememberSaveable { mutableStateOf<String?>(null) }
    var deleteDialog by remember { mutableStateOf(false) }
    var shareLink by remember { mutableStateOf(false) }
    var largePhoto by remember { mutableStateOf<ServerMedium?>(null) }
    // Der VideoView schickt kein Bearer-Token — er kennt nur Kopfzeilen, die wir
    // ihm mitgeben. Dieselbe Sitzung wie beim WebView-Player tut es auch hier.
    var session by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { session = runCatching { app.apiClient.sessionForPlayer() }.getOrNull() }

    // Fotos aus der Galerie, die zeitlich passen — der Weg ohne stehende
    // Einwilligung. Gesucht wird nur, wenn das Leserecht schon erteilt ist und
    // die Automatik AUS ist: Mit Automatik hat der Meldungspfad die Bilder
    // längst hochgeladen, und dann wäre die Frage hier ein zweites Angebot für
    // etwas, das schon geschehen ist.
    val suggestion by viewModel.photoSuggestion.collectAsState()
    val backfillRunning by viewModel.backfillRunning.collectAsState()
    var backfillMessage by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(tour?.status) {
        if (tour?.playable == true &&
            canReadGallery(app) &&
            !app.settings.currentAccount().autoPhotos
        ) {
            viewModel.findPhotos(app)
        }
    }

    // Einmalig befüllen, sobald geladen ist; danach gehören die Texte dem Nutzer.
    //
    // Die Abfrage auf die QUELLE ist entscheidend, nicht die auf das Feld: Beide
    // Werte kommen erst nach einem Netzabruf. Ohne sie liefe der Effekt schon
    // beim ersten Bild, machte aus dem noch fehlenden Titel per orEmpty() einen
    // leeren String — und weil der nicht mehr null ist, käme der echte Titel
    // danach nie an.
    LaunchedEffect(tour) { tour?.let { if (title == null) title = it.title.orEmpty() } }
    LaunchedEffect(detail) { detail?.let { if (description == null) description = it.description.orEmpty() } }

    DisposableEffect(Unit) {
        onDispose { if (title != null) viewModel.saveTexts(title, description) }
    }

    val bottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
    val media = detail?.media.orEmpty()
    val currentTour = tour

    Box(Modifier.fillMaxSize()) {
        LazyVerticalGrid(
            columns = GridCells.Fixed(3),
            modifier = Modifier.fillMaxSize(),
            horizontalArrangement = Arrangement.spacedBy(2.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
            contentPadding = PaddingValues(bottom = bottom + 36.dp),
        ) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                Serverkopf(
                    titelbild = currentTour?.cover?.let { app.serverUrl() + it },
                    title = title.orEmpty(),
                    setTitle = { title = it },
                    abspielen = currentTour
                        ?.takeIf { it.playable }
                        ?.let { t -> { abspielen(t.id) } },
                )
            }

            item(span = { GridItemSpan(maxLineSpan) }) {
                Column(Modifier.padding(horizontal = 20.dp)) {
                    Spacer(Modifier.height(16.dp))
                    Text(
                        stats(currentTour, media.size),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (currentTour != null && !currentTour.playable) {
                        Row(
                            Modifier.fillMaxWidth().padding(top = 10.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(
                                Icons.Default.HourglassEmpty,
                                contentDescription = null,
                                tint = Sun,
                                modifier = Modifier.size(15.dp),
                            )
                            Text(
                                "Wird noch verarbeitet",
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    error?.let {
                        Text(
                            it,
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.error,
                            modifier = Modifier.padding(top = 10.dp),
                        )
                    }

                    // — Fotos aus der Galerie nachreichen —
                    //
                    // Der Weg OHNE stehende Einwilligung: eine FRAGE, hier und
                    // nicht auf dem Sperrbildschirm. Sie steht nur da, wenn
                    // wirklich etwas gefunden wurde — ein „0 Fotos gefunden"
                    // wäre eine Meldung über nichts.
                    backfillMessage(
                        suggestion.size,
                        automatisch = false,
                        videos = suggestion.count { it.isVideo },
                    )?.let { frage ->
                        Row(
                            Modifier.fillMaxWidth().padding(top = 14.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(
                                Icons.Default.AddPhotoAlternate,
                                contentDescription = null,
                                tint = Sun,
                                modifier = Modifier.size(15.dp),
                            )
                            Text(frage, style = MaterialTheme.typography.labelMedium, modifier = Modifier.weight(1f))
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            TextButton(
                                onClick = {
                                    viewModel.acceptPhotos(app) { count ->
                                        backfillMessage = backfillMessage(
                                            count,
                                            automatisch = true,
                                            videos = suggestion.count { it.isVideo },
                                        )
                                            ?: "Die Fotos ließen sich nicht hinzufügen."
                                    }
                                },
                                enabled = !backfillRunning,
                                contentPadding = PaddingValues(horizontal = 0.dp),
                            ) { Text(if (backfillRunning) "Wird hinzugefügt …" else "Hinzufügen") }
                            TextButton(
                                onClick = { viewModel.discardSuggestion() },
                                enabled = !backfillRunning,
                                colors = ButtonDefaults.textButtonColors(
                                    contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
                                ),
                            ) { Text("Nein danke") }
                        }
                    }
                    backfillMessage?.let {
                        Text(
                            it,
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(top = 10.dp),
                        )
                    }

                    // Die Form der Reise. Nur wenn ein Track da ist — eine reine
                    // Foto-Tour oder eine noch in Verarbeitung hätte keinen.
                    val route = remember(detail) { detail?.route?.let { thinOut(it) }.orEmpty() }
                    // Nur platzierte Medien: Wo der Server keinen Anker fand,
                    // gibt es auch keine Stelle auf dem Weg, an die der Punkt
                    // gehörte. Im Gitter darunter sind sie trotzdem alle.
                    val photoMarks = remember(detail) {
                        media.mapNotNull { photo ->
                            val lng = photo.anchorLng
                            val lat = photo.anchorLat
                            if (lng != null && lat != null) PhotoMark(photo.id, lng, lat) else null
                        }
                    }
                    if (route.size >= 2) {
                        Spacer(Modifier.height(22.dp))
                        SectionTitle("Route")
                        Spacer(Modifier.height(10.dp))
                        RouteSketch(
                            track = route,
                            abgeschlossen = true,
                            media = photoMarks,
                            beiFotoklick = { id ->
                                media.firstOrNull { it.id == id }?.let { treffer -> largePhoto = treffer }
                            },
                            modifier = Modifier.fillMaxWidth().height(150.dp),
                        )
                    }
                    Spacer(Modifier.height(22.dp))
                }
            }

            items(media, key = { it.id }) { photo ->
                Box(
                    Modifier
                        .aspectRatio(1f)
                        .background(MaterialTheme.colorScheme.surfaceContainer)
                        .clickable { largePhoto = photo },
                ) {
                    AsyncImage(
                        // Das Raster zeigt Drittelbreiten — dafür genügt die
                        // Kachel-Fassung. Die Vollansicht holt das große Bild.
                        model = app.serverUrl() + (photo.thumb ?: photo.path),
                        contentDescription = photo.title,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxSize(),
                    )
                    if (photo.isVideo) {
                        VideoBadge(Modifier.align(Alignment.Center))
                    }
                }
            }

            item(span = { GridItemSpan(maxLineSpan) }) {
                Column(Modifier.padding(horizontal = 20.dp)) {
                    if (loading && media.isEmpty()) {
                        Box(Modifier.fillMaxWidth().padding(vertical = 24.dp), Alignment.Center) {
                            CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp, color = Sun)
                        }
                    }
                    Spacer(Modifier.height(30.dp))
                    SectionTitle("Beschreibung")
                    Spacer(Modifier.height(10.dp))
                    BrandField(
                        value = description ?: "",
                        onValueChange = { description = it },
                        placeholder = { Text("Was war das für ein Tag?") },
                        modifier = Modifier.fillMaxWidth().height(104.dp),
                        textStyle = MaterialTheme.typography.bodyMedium.copy(color = Ink),
                    )
                    Spacer(Modifier.height(26.dp))
                    TextButton(
                        onClick = { deleteDialog = true },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text("Tour löschen", color = MaterialTheme.colorScheme.error)
                    }
                }
            }
        }

        RoundButton(
            symbol = Icons.AutoMirrored.Filled.ArrowBack,
            description = "Zurück",
            onClick = back,
            modifier = Modifier.align(Alignment.TopStart).statusBarsPadding().padding(12.dp),
        )
        RoundButton(
            symbol = Icons.Default.Share,
            description = "Tour teilen",
            onClick = { shareLink = true },
            modifier = Modifier.align(Alignment.TopEnd).statusBarsPadding().padding(12.dp),
        )
    }

    largePhoto?.let { photo ->
        Fotoschau(
            imageUrl = app.serverUrl() + photo.path,
            videoUrl = (app.serverUrl() + photo.sourcePath).takeIf { photo.isVideo },
            session = session,
            caption = photo.caption,
            timeLabel = photo.timeLabel,
            setTitle = { viewModel.setPhotoTitle(photo.id, it) },
            schliessen = { largePhoto = null },
        )
    }

    if (shareLink && currentTour != null) {
        ShareSheet(
            serverTourId = currentTour.id,
            title = title ?: currentTour.title,
            aktuelleSichtbarkeit = Visibility.fromKey(currentTour.visibility),
            schliessen = { shareLink = false },
            setVisibility = viewModel::setVisibility,
        )
    }

    if (deleteDialog) {
        AlertDialog(
            onDismissRequest = { deleteDialog = false },
            title = { Text("Tour löschen?") },
            text = {
                Text(
                    "Die Tour wird mit allen Fotos vom Server entfernt. " +
                        "Geteilte Links führen danach ins Leere. Das lässt sich nicht rückgängig machen.",
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    deleteDialog = false
                    // Kein Sichern beim Verlassen mehr — die Tour ist ja weg
                    title = null
                    viewModel.delete(danach = back)
                }) { Text("Löschen", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { deleteDialog = false }) { Text("Abbrechen") } },
        )
    }
}

@Composable
private fun Serverkopf(
    titelbild: String?,
    title: String,
    setTitle: (String) -> Unit,
    abspielen: (() -> Unit)?,
) {
    val keyboard = LocalSoftwareKeyboardController.current
    val focus = remember { FocusRequester() }
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
                    tint = Ink,
                    modifier = Modifier.size(38.dp),
                )
            }
        }

        EditRow(
            value = title,
            setValue = setTitle,
            platzhalter = "Unbenannte Tour",
            stil = MaterialTheme.typography.headlineMedium,
            focus = focus,
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(start = 18.dp, end = 14.dp, bottom = 10.dp),
        )
    }
}

/**
 * Ein Foto formatfüllend, mit beschreibbarem Titel darunter.
 *
 * Der Text wird im Player zur Überschrift des Foto-Stopps und ist bei geteilten
 * Reisen für jeden sichtbar — deshalb „Titel" und nicht „Notiz". Gesichert wird
 * beim Schließen; ein Häkchen für eine einzelne Zeile wäre Zeremonie.
 */
@Composable
private fun Fotoschau(
    imageUrl: String,
    /** Gesetzt, wenn das Medium ein Video ist — dann wird abgespielt statt gezeigt. */
    videoUrl: String?,
    session: String?,
    caption: String,
    /** „Foto · 14:32“ — der Zeitstempel über dem Titel. */
    timeLabel: String?,
    setTitle: (String) -> Unit,
    schliessen: () -> Unit,
) {
    val keyboard = LocalSoftwareKeyboardController.current
    val focusManager = LocalFocusManager.current
    var text by rememberSaveable(caption) { mutableStateOf(caption) }
    val focus = remember { FocusRequester() }

    val cancel = {
        setTitle(text)
        schliessen()
    }
    // Auch die Zurück-Geste sichert — sonst wäre der Text je nach Ausstieg da
    // oder weg.
    BackHandler(onBack = cancel)

    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Black)
        // Tippen auf das Bild schließt die Tastatur. Ohne diesen Ausweg ist man
        // bei offener Tastatur gefangen: Sie verdeckt den Schließen-Knopf, und
        // wer die Zeile nicht mit dem Häkchen beendet, findet keinen Weg hinaus.
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
            ) { focusManager.clearFocus() },
    ) {
        if (videoUrl != null) {
            VideoSurface(
                source = Uri.parse(videoUrl),
                kopfzeilen = session?.let { mapOf("Cookie" to "maptale_session=$it") }.orEmpty(),
                // `bildUrl` ist bei einem Video das Poster — dasselbe Bild, das
                // schon die Kachel zeigte. Es steht, bis das erste Videobild da ist.
                standbild = imageUrl,
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            AsyncImage(
                model = imageUrl,
                contentDescription = caption.ifBlank { timeLabel },
                contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize(),
            )
        }

        Column(
            Modifier
                .align(Alignment.BottomStart)
                // imePadding vor navigationBarsPadding: So sitzt die Zeile bei
                // offener Tastatur direkt darüber und sonst über der Systemleiste.
                .imePadding()
                .navigationBarsPadding()
                .padding(horizontal = 22.dp, vertical = 18.dp),
        ) {
            if (timeLabel != null) {
                SectionTitle(timeLabel)
                Spacer(Modifier.height(8.dp))
            }
            EditRow(
                value = text,
                setValue = { text = it },
                platzhalter = "Was ist hier zu sehen?",
                stil = MaterialTheme.typography.titleLarge,
                focus = focus,
            )
        }

        RoundButton(
            symbol = Icons.Default.Close,
            description = "Schließen",
            onClick = cancel,
            modifier = Modifier.align(Alignment.TopStart).statusBarsPadding().padding(12.dp),
        )
    }
}

private val DATUM = DateTimeFormatter.ofPattern("d. MMM yyyy", Locale.GERMAN)

private fun stats(tour: app.maptale.upload.ServerTour?, media: Int): String {
    val share = buildList {
        tour?.km?.let { add(String.format(Locale.GERMAN, "%.1f km", it)) }
        tour?.gainM?.takeIf { it > 0 }?.let { add(String.format(Locale.GERMAN, "%.0f hm", it)) }
        add(if (media == 1) "1 Foto" else "$media Fotos")
        tour?.createdAt?.let { iso ->
            runCatching { DATUM.withZone(ZoneId.systemDefault()).format(Instant.parse(iso)) }.getOrNull()?.let(::add)
        }
    }
    return share.joinToString(" · ")
}
