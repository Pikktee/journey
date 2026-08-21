// Profil: das öffentliche Gesicht oben, das Konto darunter.
//
// Die Trennung ist keine Optik, sondern der Unterschied zwischen „was andere
// sehen" und „was mich betrifft". Deshalb wird der Anzeigename auch NIE mit dem
// Klarnamen aus der Registrierung vorbelegt — wer sich mit echtem Namen
// anmeldet, soll ihn nicht durch bloßes Nichtstun veröffentlichen.
//
// Der Verifikations-Hinweis erscheint nur, wenn die Adresse noch nicht bestätigt
// ist: ein grünes „Bestätigt" wäre eine Auszeichnung fürs Nichtstun. Fehlt die
// Bestätigung, blockiert sie dagegen jeden Upload — dann muss es auffallen.
//
// Oben steht die Reisebilanz, nicht das Formular: Wer sein Profil öffnet, will
// in aller Regel sehen, was er zusammengereist hat, und nicht seine Bio pflegen.
package app.maptale.ui

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.WarningAmber
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.maptale.BuildConfig
import app.maptale.MaptaleApp
import app.maptale.gallery.READ_PERMISSION
import app.maptale.gallery.canReadGallery
import app.maptale.push.MaptalePush
import app.maptale.tracker.TrackerPollWorker
import app.maptale.tracker.TrackerAction
import app.maptale.tracker.TrackerReturn
import app.maptale.tracker.actionLabel
import app.maptale.tracker.providerAction
import app.maptale.tracker.providerText
import app.maptale.tracker.openAuthorization
import app.maptale.upload.TrackerProvider
import coil.compose.AsyncImage
import kotlinx.coroutines.launch
import java.util.Locale

@Composable
fun ProfileScreen(viewModel: ProfileViewModel, zurRueckmeldung: () -> Unit = {}) {
    val account by viewModel.account.collectAsState()
    val lokale by viewModel.localTours.collectAsState(initial = emptyList())
    val vomServer by viewModel.serverTours.collectAsState()
    val context = LocalContext.current
    val app = context.applicationContext as MaptaleApp

    var displayName by remember { mutableStateOf<String?>(null) }
    var bio by remember { mutableStateOf<String?>(null) }
    var hinweisOhneNamen by remember { mutableStateOf(false) }
    var bildBlatt by remember { mutableStateOf(false) }
    var kontoLoeschenDialog by remember { mutableStateOf(false) }
    val tracker by viewModel.tracker.collectAsState()
    var meldung by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) { viewModel.refresh() }

    // Push einschalten, sobald die Benachrichtigungs-Erlaubnis erteilt ist.
    //
    // Die Abfrage ab Android 13 IST der Zustimmungsmoment (Konzept 9.1): Wer
    // sie ablehnt, bekommt keinen Token hinterlegt — dann läge eine Adresse
    // auf dem Server, an die nichts gehen darf. Bis Android 12 gibt es keine
    // Abfrage, dort zählt das Verbinden selbst als Zustimmung.
    val meldeErlaubnis = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { erlaubt -> if (erlaubt) app.appScope.launch { MaptalePush.enable(app) } }

    // Der Foto-Nachzug braucht das Leserecht auf Bilder. Erfragt wird es erst
    // beim Einschalten des Schalters — nicht beim Anmelden, nicht beim Start.
    val autoPhotos by viewModel.autoPhotos.collectAsState()
    val galerieErlaubnis = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { erlaubt -> viewModel.setAutoPhotos(erlaubt) }

    // Nach der Rückkehr aus dem Browser den Stand frisch holen. Bewusst NICHT
    // dem `ok=1` im Deep Link glauben: Was zählt, ist was auf dem Server steht.
    //
    // Der Rückweg aus dem Verknüpfen ist zugleich der Moment für Push: Erst
    // jetzt gibt es überhaupt etwas zu melden. Vorher — etwa beim Anmelden —
    // stünde die Systemabfrage vor einer Frage, die sich niemand gestellt hat.
    LaunchedEffect(Unit) {
        TrackerReturn.events.collect {
            viewModel.refresh()
            if (Build.VERSION.SDK_INT >= 33) {
                meldeErlaubnis.launch(Manifest.permission.POST_NOTIFICATIONS)
            } else {
                app.appScope.launch { MaptalePush.enable(app) }
            }
        }
    }

    meldung?.let { text ->
        LaunchedEffect(text) {
            kotlinx.coroutines.delay(4000)
            meldung = null
        }
    }

    // Einmalig befüllen, sobald das Profil geladen ist; danach gehört der Text
    // dem Nutzer. Bewusst NICHT aus account.name (dem Klarnamen) vorbelegt.
    LaunchedEffect(account?.profile) {
        account?.profile?.let {
            if (displayName == null) displayName = it.displayName.orEmpty()
            if (bio == null) bio = it.bio.orEmpty()
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            if (displayName != null || bio != null) {
                viewModel.saveProfile(displayName.orEmpty(), bio.orEmpty())
            }
        }
    }

    val bildWaehler = rememberLauncherForActivityResult(
        ActivityResultContracts.PickVisualMedia(),
    ) { uri ->
        if (uri != null) {
            viewModel.setAvatar { requireNotNull(context.contentResolver.openInputStream(uri)) }
        }
    }

    val waehleBild = {
        bildWaehler.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
    }

    val statistik = remember(lokale, vomServer) {
        computeTravelStats(mergeTours(lokale, vomServer))
    }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp),
    ) {
        Spacer(Modifier.statusBarsPadding().height(24.dp))

        // — Wer man ist —
        //
        // Beide Bild-Aktionen hängen am Bild selbst, statt als Textzeilen
        // darunter zu stehen. Vorher las sich der Kopf als Liste von
        // Aufforderungen („Anzeigenamen festlegen", „Bild entfernen") — zwei
        // Nebensachen in der Rolle der Hauptsache. Das Kamerazeichen an der Ecke
        // ist das gewohnte Zeichen dafür, dass sich hier ein Bild setzen lässt;
        // was es damit zu tun gibt, fragt ein Blatt, sobald schon eines da ist.
        val avatarUrl = account?.profile?.avatarUrl?.let { app.serverUrl() + it }
        Box(Modifier.size(100.dp)) {
            Box(
                Modifier
                    .size(96.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.surfaceContainer)
                    .border(1.dp, MaterialTheme.colorScheme.outlineVariant, CircleShape)
                    .clickable(
                        onClickLabel = if (avatarUrl == null) "Profilbild wählen" else "Profilbild ändern",
                    ) {
                        if (avatarUrl == null) waehleBild() else bildBlatt = true
                    },
                contentAlignment = Alignment.Center,
            ) {
                if (avatarUrl != null) {
                    AsyncImage(
                        model = avatarUrl,
                        contentDescription = "Profilbild",
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxSize(),
                    )
                } else {
                    Icon(
                        Icons.Default.Person,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
                        modifier = Modifier.size(40.dp),
                    )
                }
            }
            Box(
                Modifier
                    .align(Alignment.BottomEnd)
                    .size(30.dp)
                    .clip(CircleShape)
                    .background(Sun),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Default.PhotoCamera,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onPrimary,
                    modifier = Modifier.size(16.dp),
                )
            }
        }

        // Der Name steht hier nur, wenn es einen gibt. Ein Platzhalter wäre
        // doppelt: Das Feld dafür steht wenige Zeilen weiter unten, samt
        // Beschriftung und Erklärung.
        displayName?.takeIf { it.isNotBlank() }?.let {
            Spacer(Modifier.height(14.dp))
            Text(it, style = MaterialTheme.typography.headlineMedium)
        }

        // — Was man gereist ist —
        Spacer(Modifier.height(24.dp))
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Kennzahl(statistik.tourCount.toString(), "Reisen", Modifier.weight(1f))
            Trenner()
            Kennzahl(String.format(Locale.GERMAN, "%.0f", statistik.km), "Kilometer", Modifier.weight(1f))
            Trenner()
            Kennzahl(String.format(Locale.GERMAN, "%.0f", statistik.gainM), "Höhenmeter", Modifier.weight(1f))
        }

        Spacer(Modifier.height(34.dp))
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

        // — Was andere sehen —
        Spacer(Modifier.height(26.dp))
        SectionTitle("Öffentliches Profil")
        Spacer(Modifier.height(14.dp))
        BrandField(
            value = displayName.orEmpty(),
            onValueChange = { displayName = it },
            label = { Text("Anzeigename") },
            placeholder = { Text("Wie du in der Galerie erscheinst") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(12.dp))
        BrandField(
            value = bio.orEmpty(),
            onValueChange = { bio = it },
            label = { Text("Über dich") },
            placeholder = { Text("Ein, zwei Sätze") },
            textStyle = MaterialTheme.typography.bodyMedium.copy(color = Ink),
            modifier = Modifier.fillMaxWidth().height(104.dp),
        )

        Spacer(Modifier.height(18.dp))
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text("Profilseite freigeben", style = MaterialTheme.typography.titleSmall)
                Spacer(Modifier.height(2.dp))
                Text(
                    "Deine öffentlichen Reisen erscheinen dann unter einer eigenen Seite.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Switch(
                checked = account?.profile?.public == true,
                onCheckedChange = { an ->
                    // Ohne Anzeigenamen wäre die Seite namenlos — einmal nachfragen
                    if (an && displayName.isNullOrBlank()) hinweisOhneNamen = true
                    else viewModel.setPublic(an)
                },
            )
        }

        // — Verbundene Dienste —
        //
        // Der Abschnitt bleibt AUS, solange der Server keinen Anbieter meldet:
        // eine Überschrift über einer leeren Fläche wäre eine Auskunft über
        // nichts. Sichtbar wird er, sobald es etwas zu verbinden gibt.
        if (tracker.isNotEmpty()) {
            Spacer(Modifier.height(30.dp))
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Spacer(Modifier.height(26.dp))
            SectionTitle("Verbundene Dienste")
            Spacer(Modifier.height(14.dp))
            for (anbieter in tracker) {
                TrackerZeile(
                    anbieter = anbieter,
                    beiAktion = { aktion ->
                        when (aktion) {
                            TrackerAction.DISCONNECT -> viewModel.disconnectTracker(anbieter.id) { meldung = it }
                            else -> viewModel.connectTracker(
                                anbieter.id,
                                oeffne = { url ->
                                    // Custom Tab, kein WebView: Mehrere Anbieter
                                    // sperren eingebettete Browser für OAuth.
                                    // Zurück kommt die App über den Deep Link
                                    // maptale://tracker/…
                                    if (!openAuthorization(context, url)) {
                                        meldung = "Kein Browser gefunden."
                                    }
                                },
                                beiFehler = { meldung = it },
                            )
                        }
                    },
                )
                Spacer(Modifier.height(10.dp))
            }

            // — Fotos automatisch ergänzen —
            //
            // Die stehende Einwilligung. Sie steht HIER und nicht in einem
            // eigenen Abschnitt, weil sie nur zu Cloud-Touren gehört: Was die
            // App selbst aufzeichnet, hat seine Fotos schon.
            //
            // Der Schalter fragt beim EINSCHALTEN nach dem Leserecht und bleibt
            // aus, wenn es verweigert wird — ein „an", hinter dem nichts
            // passieren kann, wäre die schlechtere Auskunft.
            Spacer(Modifier.height(8.dp))
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text("Fotos automatisch ergänzen", style = MaterialTheme.typography.titleSmall)
                    Spacer(Modifier.height(2.dp))
                    Text(
                        if (autoPhotos) {
                            "Bilder aus der Zeit einer neuen Tour kommen ohne Nachfrage dazu."
                        } else {
                            "Ohne diesen Schalter fragt die App bei jeder neuen Tour nach."
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Switch(
                    checked = autoPhotos,
                    onCheckedChange = { an ->
                        if (!an) viewModel.setAutoPhotos(false)
                        else if (canReadGallery(context)) viewModel.setAutoPhotos(true)
                        else galerieErlaubnis.launch(READ_PERMISSION)
                    },
                )
            }
        }

        Spacer(Modifier.height(30.dp))
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

        // — Was einen selbst betrifft —
        Spacer(Modifier.height(26.dp))
        SectionTitle("Konto")
        Spacer(Modifier.height(14.dp))

        if (account != null && !account!!.verified) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(MaterialTheme.shapes.medium)
                    .background(MaterialTheme.colorScheme.errorContainer)
                    .padding(14.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    Icons.Default.WarningAmber,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onErrorContainer,
                    modifier = Modifier.size(20.dp),
                )
                Text(
                    "Bestätige deine E-Mail-Adresse. Bis dahin lassen sich keine Reisen hochladen.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onErrorContainer,
                )
            }
            Spacer(Modifier.height(14.dp))
        }

        Text(
            account?.email ?: "…",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurface,
        )

        account?.let { stand ->
            if (stand.limitBytes > 0) {
                Spacer(Modifier.height(16.dp))
                LinearProgressIndicator(
                    progress = { stand.quotaFraction.coerceIn(0f, 1f) },
                    trackColor = MaterialTheme.colorScheme.surfaceContainerHigh,
                    color = Sun,
                    modifier = Modifier.fillMaxWidth().height(4.dp),
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    "${megabyte(stand.usedBytes)} von ${megabyte(stand.limitBytes)} belegt",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        // Rückmeldung: der Weg zum Formular, solange Maptale in der Alpha ist.
        // Er steht hier und nicht in einem Menü, weil die App keines hat — und
        // über dem Abmelden, weil er die häufigere Handlung ist.
        Spacer(Modifier.height(26.dp))
        TextButton(onClick = zurRueckmeldung) {
            Icon(
                Icons.AutoMirrored.Filled.Chat,
                contentDescription = null,
                modifier = Modifier.size(16.dp),
            )
            Text("Rückmeldung geben", Modifier.padding(start = 8.dp))
        }

        TextButton(onClick = {
            // Den Cloud-Abfrage-Lauf mit beenden: Er klopfte sonst weiter an
            // eine Tür, für die es keinen Schlüssel mehr gibt.
            TrackerPollWorker.cancel(context)
            // Push VOR dem Abmelden abbestellen — danach gibt es kein Token
            // mehr, mit dem sich das beim Server sagen ließe, und die Adresse
            // bliebe dort stehen. Erst dann abmelden.
            app.appScope.launch {
                MaptalePush.disable(app)
                viewModel.logout()
            }
        }) {
            Icon(
                Icons.AutoMirrored.Filled.Logout,
                contentDescription = null,
                modifier = Modifier.size(16.dp),
            )
            Text("Abmelden", Modifier.padding(start = 8.dp))
        }

        // Konto löschen ganz unten und ohne Symbol: Es ist der einzige Schritt
        // in dieser App, der nichts zurücklässt — er soll gesucht werden, nicht
        // ins Auge fallen. Was daran hängt, sagt der Dialog, nicht diese Zeile.
        Spacer(Modifier.height(30.dp))
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        Spacer(Modifier.height(14.dp))
        TextButton(
            onClick = { kontoLoeschenDialog = true },
            colors = ButtonDefaults.textButtonColors(
                contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
            ),
            contentPadding = PaddingValues(horizontal = 0.dp, vertical = 8.dp),
        ) { Text("Konto löschen") }

        // Welcher Stand ist installiert? Ohne diese Zeile ist das am Gerät
        // nicht zu beantworten — und zwei Builds mit derselben Nummer sahen
        // von außen identisch aus. Leise ganz unten: gesucht wird sie nur,
        // wenn etwas nicht stimmt.
        Spacer(Modifier.height(24.dp))
        Text(
            "Maptale ${BuildConfig.VERSION_NAME} · Build ${BuildConfig.VERSION_CODE}",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
        )
        Spacer(Modifier.height(56.dp))
    }

    if (bildBlatt) {
        BildBlatt(
            schliessen = { bildBlatt = false },
            waehlen = { bildBlatt = false; waehleBild() },
            entfernen = { bildBlatt = false; viewModel.deleteAvatar() },
        )
    }

    if (kontoLoeschenDialog) {
        AlertDialog(
            onDismissRequest = { kontoLoeschenDialog = false },
            icon = {
                Icon(
                    Icons.Default.WarningAmber,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.error,
                )
            },
            title = { Text("Konto endgültig löschen?") },
            text = {
                Text(
                    "Alle deine Touren, Fotos und dein Profil werden vom Server " +
                        "entfernt. Geteilte Links führen danach ins Leere. " +
                        "Das lässt sich nicht rückgängig machen.",
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    kontoLoeschenDialog = false
                    // Die Serverzeile fällt mit dem Konto (CASCADE); hier geht
                    // es um das GERÄT: Token löschen, Auto-Init aus. Sonst
                    // meldete die App nach dem Löschen weiter eine Adresse an
                    // Google, für die es kein Konto mehr gibt.
                    app.appScope.launch { MaptalePush.disable(app) }
                    // Die Navigation folgt von selbst: Ohne gültiges Token
                    // zeigt MaptaleNavigation wieder die Anmeldung.
                    viewModel.deleteAccount(danach = {})
                }) { Text("Endgültig löschen", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = {
                TextButton(onClick = { kontoLoeschenDialog = false }) { Text("Abbrechen") }
            },
        )
    }

    if (hinweisOhneNamen) {
        AlertDialog(
            onDismissRequest = { hinweisOhneNamen = false },
            title = { Text("Noch ohne Anzeigenamen") },
            text = { Text("Ohne Anzeigenamen erscheint deine Profilseite namenlos. Trotzdem freischalten?") },
            confirmButton = {
                TextButton(onClick = {
                    hinweisOhneNamen = false
                    viewModel.setPublic(true)
                }) { Text("Freischalten") }
            },
            dismissButton = { TextButton(onClick = { hinweisOhneNamen = false }) { Text("Abbrechen") } },
        )
    }
}

/** Eine Zahl mit ihrer Bedeutung darunter — Ziffern in gleicher Breite. */
@Composable
private fun Kennzahl(wert: String, beschriftung: String, modifier: Modifier = Modifier) {
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(wert, style = MaterialTheme.typography.displayMedium.copy(fontSize = 30.sp))
        Spacer(Modifier.height(4.dp))
        Text(
            beschriftung,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** Senkrechter Strich zwischen den Kennzahlen. */
@Composable
private fun Trenner() {
    Box(
        Modifier
            .width(1.dp)
            .height(30.dp)
            .background(MaterialTheme.colorScheme.outlineVariant),
    )
}

private fun megabyte(bytes: Long): String =
    String.format(Locale.GERMAN, "%.0f MB", bytes / 1024.0 / 1024.0)

/** Was sich mit einem vorhandenen Profilbild anstellen lässt. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun BildBlatt(schliessen: () -> Unit, waehlen: () -> Unit, entfernen: () -> Unit) {
    ModalBottomSheet(onDismissRequest = schliessen, sheetState = rememberModalBottomSheetState()) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 24.dp).navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text("Profilbild", style = MaterialTheme.typography.headlineSmall)
            Spacer(Modifier.height(12.dp))
            Blattzeile(Icons.Default.PhotoCamera, "Anderes Bild wählen", waehlen)
            Blattzeile(
                Icons.Default.DeleteOutline,
                "Bild entfernen",
                entfernen,
                farbe = MaterialTheme.colorScheme.error,
            )
            Spacer(Modifier.height(20.dp))
        }
    }
}

@Composable
private fun Blattzeile(
    symbol: androidx.compose.ui.graphics.vector.ImageVector,
    text: String,
    beiKlick: () -> Unit,
    farbe: Color = MaterialTheme.colorScheme.onSurface,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(MaterialTheme.shapes.small)
            .clickable(onClick = beiKlick)
            .padding(vertical = 14.dp, horizontal = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(symbol, contentDescription = null, tint = farbe, modifier = Modifier.size(20.dp))
        Text(text, style = MaterialTheme.typography.bodyLarge, color = farbe)
    }
}

/**
 * Eine Zeile der verbundenen Dienste.
 *
 * Vier Zustände, und sie müssen unterscheidbar bleiben — der teuerste Fehler
 * wäre, `abgelaufen` wie „nicht verbunden" aussehen zu lassen: Dann wartet
 * jemand auf Touren, die nie kommen. Deshalb heißt der Knopf dort „Neu
 * verbinden" und der Satz nennt den Grund (Texte in tracker/TrackerModell.kt,
 * gemeinsam mit der Weboberfläche gehalten).
 */
@Composable
private fun TrackerZeile(anbieter: TrackerProvider, beiAktion: (TrackerAction) -> Unit) {
    val aktion = providerAction(anbieter)
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                anbieter.name,
                style = MaterialTheme.typography.titleSmall,
                // Ein Anbieter, den dieser Server nicht anbietet, tritt zurück
                color = if (anbieter.available) {
                    MaterialTheme.colorScheme.onSurface
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                },
            )
            Spacer(Modifier.height(2.dp))
            Text(
                providerText(anbieter),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (aktion != null) {
            TextButton(onClick = { beiAktion(aktion) }) {
                Text(
                    actionLabel(aktion),
                    color = if (aktion == TrackerAction.DISCONNECT) {
                        MaterialTheme.colorScheme.error
                    } else {
                        MaterialTheme.colorScheme.primary
                    },
                )
            }
        }
    }
}
