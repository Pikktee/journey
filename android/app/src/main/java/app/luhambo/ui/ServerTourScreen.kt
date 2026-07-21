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
package app.luhambo.ui

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
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.HourglassEmpty
import androidx.compose.material.icons.filled.PlayArrow
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
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.luhambo.LuhamboApp
import app.luhambo.upload.Serverfoto
import coil.compose.AsyncImage
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

@Composable
fun ServerTourScreen(
    viewModel: ServerTourViewModel,
    zurueck: () -> Unit,
    abspielen: (serverId: String) -> Unit,
) {
    val tour by viewModel.tour.collectAsState()
    val detail by viewModel.detail.collectAsState()
    val laedt by viewModel.laedt.collectAsState()
    val fehler by viewModel.fehler.collectAsState()
    val app = LocalContext.current.applicationContext as LuhamboApp

    var titel by rememberSaveable { mutableStateOf<String?>(null) }
    var beschreibung by rememberSaveable { mutableStateOf<String?>(null) }
    var loeschenDialog by remember { mutableStateOf(false) }
    var teilen by remember { mutableStateOf(false) }
    var grossesFoto by remember { mutableStateOf<Serverfoto?>(null) }
    // Der VideoView schickt kein Bearer-Token — er kennt nur Kopfzeilen, die wir
    // ihm mitgeben. Dieselbe Sitzung wie beim WebView-Player tut es auch hier.
    var sitzung by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { sitzung = runCatching { app.apiClient.sitzungFuerPlayer() }.getOrNull() }

    // Einmalig befüllen, sobald geladen ist; danach gehören die Texte dem Nutzer.
    //
    // Die Abfrage auf die QUELLE ist entscheidend, nicht die auf das Feld: Beide
    // Werte kommen erst nach einem Netzabruf. Ohne sie liefe der Effekt schon
    // beim ersten Bild, machte aus dem noch fehlenden Titel per orEmpty() einen
    // leeren String — und weil der nicht mehr null ist, käme der echte Titel
    // danach nie an.
    LaunchedEffect(tour) { tour?.let { if (titel == null) titel = it.titel.orEmpty() } }
    LaunchedEffect(detail) { detail?.let { if (beschreibung == null) beschreibung = it.beschreibung.orEmpty() } }

    DisposableEffect(Unit) {
        onDispose { if (titel != null) viewModel.sichereTexte(titel, beschreibung) }
    }

    val unten = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
    val fotos = detail?.fotos.orEmpty()
    val aktuelleTour = tour

    Box(Modifier.fillMaxSize()) {
        LazyVerticalGrid(
            columns = GridCells.Fixed(3),
            modifier = Modifier.fillMaxSize(),
            horizontalArrangement = Arrangement.spacedBy(2.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
            contentPadding = PaddingValues(bottom = unten + 36.dp),
        ) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                Serverkopf(
                    titelbild = aktuelleTour?.cover?.let { app.serverUrl() + it },
                    titel = titel.orEmpty(),
                    setzeTitel = { titel = it },
                    abspielen = aktuelleTour
                        ?.takeIf { it.spielbar }
                        ?.let { t -> { abspielen(t.id) } },
                )
            }

            item(span = { GridItemSpan(maxLineSpan) }) {
                Column(Modifier.padding(horizontal = 20.dp)) {
                    Spacer(Modifier.height(16.dp))
                    Text(
                        kennzahlen(aktuelleTour, fotos.size),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (aktuelleTour != null && !aktuelleTour.spielbar) {
                        Row(
                            Modifier.fillMaxWidth().padding(top = 10.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(
                                Icons.Default.HourglassEmpty,
                                contentDescription = null,
                                tint = Sonne,
                                modifier = Modifier.size(15.dp),
                            )
                            Text(
                                "Wird noch verarbeitet",
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    fehler?.let {
                        Text(
                            it,
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.error,
                            modifier = Modifier.padding(top = 10.dp),
                        )
                    }
                    Spacer(Modifier.height(22.dp))
                }
            }

            items(fotos, key = { it.id }) { foto ->
                Box(
                    Modifier
                        .aspectRatio(1f)
                        .background(MaterialTheme.colorScheme.surfaceContainer)
                        .clickable { grossesFoto = foto },
                ) {
                    AsyncImage(
                        model = app.serverUrl() + foto.pfad,
                        contentDescription = foto.titel,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxSize(),
                    )
                    if (foto.istVideo) {
                        Videoabzeichen(Modifier.align(Alignment.Center))
                    }
                }
            }

            item(span = { GridItemSpan(maxLineSpan) }) {
                Column(Modifier.padding(horizontal = 20.dp)) {
                    if (laedt && fotos.isEmpty()) {
                        Box(Modifier.fillMaxWidth().padding(vertical = 24.dp), Alignment.Center) {
                            CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp, color = Sonne)
                        }
                    }
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
                    TextButton(
                        onClick = { loeschenDialog = true },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text("Tour löschen", color = MaterialTheme.colorScheme.error)
                    }
                }
            }
        }

        Rundknopf(
            symbol = Icons.AutoMirrored.Filled.ArrowBack,
            beschreibung = "Zurück",
            beiKlick = zurueck,
            modifier = Modifier.align(Alignment.TopStart).statusBarsPadding().padding(12.dp),
        )
        Rundknopf(
            symbol = Icons.Default.Share,
            beschreibung = "Tour teilen",
            beiKlick = { teilen = true },
            modifier = Modifier.align(Alignment.TopEnd).statusBarsPadding().padding(12.dp),
        )
    }

    grossesFoto?.let { foto ->
        Fotoschau(
            bildUrl = app.serverUrl() + foto.pfad,
            videoUrl = (app.serverUrl() + foto.quellPfad).takeIf { foto.istVideo },
            sitzung = sitzung,
            nutzertext = foto.nutzertext,
            zeitzeile = foto.zeitzeile,
            setzeTitel = { viewModel.setzeFotoTitel(foto.id, it) },
            schliessen = { grossesFoto = null },
        )
    }

    if (teilen && aktuelleTour != null) {
        TeilenBlatt(
            serverTourId = aktuelleTour.id,
            titel = titel ?: aktuelleTour.titel,
            aktuelleSichtbarkeit = Sichtbarkeit.vonSchluessel(aktuelleTour.visibility),
            schliessen = { teilen = false },
            setzeSichtbarkeit = viewModel::setzeSichtbarkeit,
        )
    }

    if (loeschenDialog) {
        AlertDialog(
            onDismissRequest = { loeschenDialog = false },
            title = { Text("Tour löschen?") },
            text = {
                Text(
                    "Die Tour wird mit allen Fotos vom Server entfernt. " +
                        "Geteilte Links führen danach ins Leere. Das lässt sich nicht rückgängig machen.",
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    loeschenDialog = false
                    // Kein Sichern beim Verlassen mehr — die Tour ist ja weg
                    titel = null
                    viewModel.loesche(danach = zurueck)
                }) { Text("Löschen", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { loeschenDialog = false }) { Text("Abbrechen") } },
        )
    }
}

@Composable
private fun Serverkopf(
    titelbild: String?,
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
            platzhalter = "Unbenannte Tour",
            stil = MaterialTheme.typography.headlineMedium,
            fokus = fokus,
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
    bildUrl: String,
    /** Gesetzt, wenn das Medium ein Video ist — dann wird abgespielt statt gezeigt. */
    videoUrl: String?,
    sitzung: String?,
    nutzertext: String,
    /** „Foto · 14:32“ — der Zeitstempel über dem Titel. */
    zeitzeile: String?,
    setzeTitel: (String) -> Unit,
    schliessen: () -> Unit,
) {
    val tastatur = LocalSoftwareKeyboardController.current
    val fokusManager = LocalFocusManager.current
    var text by rememberSaveable(nutzertext) { mutableStateOf(nutzertext) }
    val fokus = remember { FocusRequester() }

    val beenden = {
        setzeTitel(text)
        schliessen()
    }
    // Auch die Zurück-Geste sichert — sonst wäre der Text je nach Ausstieg da
    // oder weg.
    BackHandler(onBack = beenden)

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
            ) { fokusManager.clearFocus() },
    ) {
        if (videoUrl != null) {
            Videoflaeche(
                quelle = Uri.parse(videoUrl),
                kopfzeilen = sitzung?.let { mapOf("Cookie" to "luhambo_session=$it") }.orEmpty(),
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            AsyncImage(
                model = bildUrl,
                contentDescription = nutzertext.ifBlank { zeitzeile },
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
            if (zeitzeile != null) {
                Abschnittstitel(zeitzeile)
                Spacer(Modifier.height(8.dp))
            }
            Schreibzeile(
                wert = text,
                setzeWert = { text = it },
                platzhalter = "Was ist hier zu sehen?",
                stil = MaterialTheme.typography.titleLarge,
                fokus = fokus,
            )
        }

        Rundknopf(
            symbol = Icons.Default.Close,
            beschreibung = "Schließen",
            beiKlick = beenden,
            modifier = Modifier.align(Alignment.TopStart).statusBarsPadding().padding(12.dp),
        )
    }
}

private val DATUM = DateTimeFormatter.ofPattern("d. MMM yyyy", Locale.GERMAN)

private fun kennzahlen(tour: app.luhambo.upload.ServerTour?, fotos: Int): String {
    val teile = buildList {
        tour?.km?.let { add(String.format(Locale.GERMAN, "%.1f km", it)) }
        tour?.hoehenmeter?.takeIf { it > 0 }?.let { add(String.format(Locale.GERMAN, "%.0f hm", it)) }
        add(if (fotos == 1) "1 Foto" else "$fotos Fotos")
        tour?.erstelltAm?.let { iso ->
            runCatching { DATUM.withZone(ZoneId.systemDefault()).format(Instant.parse(iso)) }.getOrNull()?.let(::add)
        }
    }
    return teile.joinToString(" · ")
}
