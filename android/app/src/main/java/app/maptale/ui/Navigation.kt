// Navigations-Graph der App: Start-Gate (Anmeldung) → Reiter Touren/Profil mit
// dem Aufnahme-Knopf dazwischen → Aufzeichnung ↔ Kamera ↔ Foto, Tour-Detail →
// Player.
//
// Die Leiste trägt nur zwei Reiter; der große Knopf in der Mitte ist bewusst
// KEIN dritter. Er wechselt nicht die Ansicht, sondern startet etwas — und
// während eine Aufnahme läuft, führt er zurück zu ihr, statt eine zweite zu
// beginnen. Alles, was Bühne braucht (Aufzeichnung, Kamera, Foto, Detail,
// Player), läuft ohne Leiste.
package app.maptale.ui

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.outlined.Map
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.filled.Map
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemColors
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import app.maptale.MaptaleApp
import app.maptale.recording.RecordingService
import app.maptale.recording.RecordingState
import app.maptale.data.TravelMode
import app.maptale.camera.CameraScreen
import app.maptale.upload.Settings
import kotlinx.coroutines.delay
import java.util.Locale

/**
 * Gemerkter Startwunsch, bis der Berechtigungsdialog beantwortet ist.
 *
 * Eine eigene Klasse statt `TravelMode?`, weil zwei verschiedene „nichts" zu
 * unterscheiden sind: kein Wunsch offen — oder ein Wunsch ohne Angabe des
 * Fortbewegungsmittels („Automatisch").
 */
private data class Startwunsch(val travelMode: TravelMode?)

/** Reiter der Hauptnavigation. */
private const val REITER_TOUREN = "touren"
private const val REITER_PROFIL = "profil"

@Composable
fun MaptaleNavigation() {
    val app = LocalContext.current.applicationContext as MaptaleApp
    // Start-Gate: das Konto kommt asynchron aus dem DataStore. Solange es noch
    // null ist, kurz laden; ohne gültiges Token zuerst die Anmeldung, sonst App.
    val account by app.settings.account.collectAsState(initial = null)

    when {
        account == null -> Box(
            Modifier.fillMaxSize().background(Night),
            contentAlignment = Alignment.Center,
        ) {
            CircularProgressIndicator(color = Sun)
        }
        account?.loggedIn != true -> LoginScreen(
            viewModel = viewModel(factory = MaptaleViewModelFactory(app)),
        )
        else -> AngemeldeteNavigation(app)
    }
}

@Composable
private fun AngemeldeteNavigation(app: MaptaleApp) {
    val navController = rememberNavController()
    val context = LocalContext.current
    val aufnahme by RecordingState.current.collectAsState()
    var neueTour by remember { mutableStateOf(false) }

    // Eigener Sekundentakt: Die Leiste ist auch dann sichtbar, wenn der
    // Aufzeichnungs-Screen längst verlassen wurde — sie kann sich seine Uhr
    // nicht ausleihen.
    var jetztMs by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(aufnahme?.tourId) {
        while (aufnahme != null) {
            jetztMs = System.currentTimeMillis()
            delay(1000)
        }
    }
    val laufendeDauer = aufnahme?.let {
        val s = ((jetztMs - it.startMs) / 1000).coerceAtLeast(0)
        String.format(Locale.GERMAN, "%d:%02d:%02d", s / 3600, s / 60 % 60, s % 60)
    }

    val eintrag by navController.currentBackStackEntryAsState()
    val route = eintrag?.destination?.route
    val leisteSichtbar = route == REITER_TOUREN || route == REITER_PROFIL

    // Ohne Standort-Erlaubnis beendet sich der Aufzeichnungs-Service wortlos.
    // Sie wird deshalb erst erfragt, wenn wirklich losgeht — und die Wahl aus
    // dem Blatt so lange gemerkt, bis der Systemdialog beantwortet ist.
    var wunsch by remember { mutableStateOf<Startwunsch?>(null) }
    val rechteLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { ergebnis ->
        val wahl = wunsch
        wunsch = null
        if (ergebnis[Manifest.permission.ACCESS_FINE_LOCATION] == true && wahl != null) {
            // `null` heißt „Automatisch": Der Service erkennt das Mittel dann
            // unterwegs selbst — sofern die Bewegungs-Erlaubnis erteilt wurde,
            // sonst leitet es der Server aus dem Tempo ab. Eine Absage dort darf
            // die Aufnahme nicht verhindern, sie kostet nur die Automatik.
            RecordingService.start(context, wahl.travelMode, null)
            navController.navigate("aufzeichnung")
        }
    }

    Scaffold(
        // Die Systemleisten-Abstände macht jeder Screen selbst (sie haben eigene
        // Scaffolds mit Titelleiste). Ohne das käme der Abstand zur Statusleiste
        // doppelt: einmal von hier, einmal vom Screen darin.
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        bottomBar = {
            if (leisteSichtbar) {
                Hauptleiste(
                    aktuelleRoute = route,
                    aufnahmeLaeuft = aufnahme != null,
                    dauer = laufendeDauer,
                    wechsle = { ziel -> wechsleReiter(navController, ziel) },
                    aufnahmeKnopf = {
                        // Läuft schon eine Aufnahme, führt der Knopf zu ihr zurück —
                        // zwei gleichzeitige Aufzeichnungen gibt es nicht.
                        if (aufnahme != null) navController.navigate("aufzeichnung") else neueTour = true
                    },
                )
            }
        },
    ) { innen ->
        NavHost(
            navController = navController,
            startDestination = REITER_TOUREN,
            // Nur unten Platz machen — für die Leiste, wo sie steht
            modifier = Modifier.padding(bottom = if (leisteSichtbar) innen.calculateBottomPadding() else 0.dp),
        ) {
            composable(REITER_TOUREN) {
                ToursScreen(
                    viewModel = viewModel(factory = MaptaleViewModelFactory(app)),
                    zurAufzeichnung = { navController.navigate("aufzeichnung") },
                    zurTour = { tourId -> navController.navigate("tour/$tourId") },
                    zurServerTour = { serverId -> navController.navigate("servertour/$serverId") },
                )
            }
            composable(REITER_PROFIL) {
                ProfileScreen(
                    viewModel = viewModel(factory = MaptaleViewModelFactory(app)),
                    zurRueckmeldung = { navController.navigate("rueckmeldung") },
                )
            }
            composable("rueckmeldung") {
                // Wie der Player vom Prod-Web-Origin und nicht aus
                // account.serverUrl: Die erste DataStore-Emission ist null und
                // zöge den WebView auf eine tote Adresse.
                FeedbackScreen(
                    serverUrl = Settings.STANDARD_SERVER,
                    sitzungHolen = { runCatching { app.apiClient.sessionForPlayer() }.getOrNull() },
                    zurueck = { navController.popBackStack() },
                )
            }
            composable("aufzeichnung") {
                RecordingScreen(
                    zurKamera = { navController.navigate("kamera") },
                    zumFoto = { tourId, mediumId -> navController.navigate("foto/$tourId/$mediumId") },
                    fertig = { tourId ->
                        navController.navigate("tour/$tourId") { popUpTo(REITER_TOUREN) }
                    },
                )
            }
            composable("kamera") {
                CameraScreen(zurueck = { navController.popBackStack() })
            }
            composable(
                "foto/{tourId}/{mediumId}",
                arguments = listOf(
                    navArgument("tourId") { type = NavType.StringType },
                    navArgument("mediumId") { type = NavType.StringType },
                ),
            ) { ziel ->
                val tourId = ziel.arguments?.getString("tourId") ?: return@composable
                val mediumId = ziel.arguments?.getString("mediumId") ?: return@composable
                MediumFullscreen(
                    viewModel = viewModel(factory = MaptaleViewModelFactory(app, tourId, mediumId)),
                    zurueck = { navController.popBackStack() },
                )
            }
            composable(
                "tour/{tourId}",
                arguments = listOf(navArgument("tourId") { type = NavType.StringType }),
            ) { ziel ->
                val tourId = ziel.arguments?.getString("tourId") ?: return@composable
                TourScreen(
                    viewModel = viewModel(factory = MaptaleViewModelFactory(app, tourId)),
                    zurueck = { navController.popBackStack() },
                    abspielen = { serverId -> navController.navigate("player/$serverId") },
                    zumFoto = { mediumId -> navController.navigate("foto/$tourId/$mediumId") },
                )
            }
            composable(
                "servertour/{serverId}",
                arguments = listOf(navArgument("serverId") { type = NavType.StringType }),
            ) { ziel ->
                val serverId = ziel.arguments?.getString("serverId") ?: return@composable
                ServerTourScreen(
                    viewModel = viewModel(factory = MaptaleViewModelFactory(app, serverId)),
                    zurueck = { navController.popBackStack() },
                    abspielen = { id -> navController.navigate("player/$id") },
                )
            }
            composable(
                "player/{serverId}",
                arguments = listOf(navArgument("serverId") { type = NavType.StringType }),
            ) { ziel ->
                val serverId = ziel.arguments?.getString("serverId") ?: return@composable
                // Der Player lädt erlebnis.html vom WEB-Origin (Prod, fest verdrahtet).
                // Nicht aus account.serverUrl, sonst zöge die noch nicht geladene erste
                // DataStore-Emission (null) den WebView auf die tote Dev-URL.
                PlayerScreen(
                    serverUrl = Settings.STANDARD_SERVER,
                    serverTourId = serverId,
                    sitzungHolen = { runCatching { app.apiClient.sessionForPlayer() }.getOrNull() },
                    zurueck = { navController.popBackStack() },
                )
            }
        }
    }

    if (neueTour) {
        NewTourSheet(
            schliessen = { neueTour = false },
            starten = { travelMode ->
                neueTour = false
                wunsch = Startwunsch(travelMode)
                rechteLauncher.launch(
                    buildList {
                        add(Manifest.permission.ACCESS_FINE_LOCATION)
                        if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
                        // Nur bei „Automatisch" gefragt — wer sein Mittel selbst
                        // gewählt hat, braucht keine Bewegungserkennung.
                        if (travelMode == null) add(Manifest.permission.ACTIVITY_RECOGNITION)
                    }.toTypedArray(),
                )
            },
        )
    }
}

/**
 * Reiter wechseln, ohne den Rückweg-Stapel wachsen zu lassen: Touren und Profil
 * behalten ihren Zustand, ein zweites Tippen auf denselben Reiter tut nichts.
 */
private fun wechsleReiter(navController: NavHostController, ziel: String) {
    navController.navigate(ziel) {
        popUpTo(navController.graph.startDestinationId) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}

/**
 * Farben der beiden Reiter.
 *
 * Ohne Kasten hinter dem Symbol: Die Standard-Pille von Material ist farblos
 * und sähe neben dem großen Auslöser nach nicht zu Ende gestalteter Vorlage
 * aus — und zwei zusätzliche Flächen würden ihm die Aufmerksamkeit streitig
 * machen. Der aktive Reiter zeigt sich stattdessen dreifach: gefülltes Symbol
 * (statt Umriss), heller Text und volle Tinte statt gedämpfter.
 *
 * Bewusst NICHT in Sonnengelb: Der Akzent gehört dem Auslöser daneben. Zwei
 * gelbe Punkte nebeneinander, und keiner von beiden führt mehr.
 */
@Composable
private fun reiterFarben(): NavigationBarItemColors = NavigationBarItemDefaults.colors(
    selectedIconColor = Ink,
    selectedTextColor = Ink,
    indicatorColor = Color.Transparent,
    unselectedIconColor = MaterialTheme.colorScheme.onSurfaceVariant,
    unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant,
)

/**
 * Der Aufnahme-Knopf als Kamera-Auslöser: heller Ring, farbiger Kern.
 *
 * Vorher war es eine gefüllte gelbe Scheibe mit einem dunklen Punkt in der
 * Mitte — die las sich als Ring mit Loch, nicht als Knopf, und war die größte
 * Farbfläche der App. Ring und Kern sind die Form, die jede Kamera-App benutzt;
 * sie ist sofort verständlich und braucht dafür deutlich weniger Gelb.
 */
@Composable
private fun Ausloeser(aufnahmeLaeuft: Boolean, beiKlick: () -> Unit, modifier: Modifier = Modifier) {
    val beschriftung =
        if (aufnahmeLaeuft) "Zur laufenden Aufzeichnung" else "Neue Tour aufzeichnen"
    Box(
        modifier
            .size(64.dp)
            .clip(CircleShape)
            // Der eigene dunkle Grund schneidet den Knopf sauber aus der Leiste
            .background(Night)
            .border(2.dp, Ink.copy(alpha = 0.5f), CircleShape)
            .clickable(onClickLabel = beschriftung, onClick = beiKlick)
            .semantics { contentDescription = beschriftung },
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .size(44.dp)
                .clip(CircleShape)
                .background(if (aufnahmeLaeuft) Danger else Sun),
        )
    }
}

@Composable
private fun Hauptleiste(
    aktuelleRoute: String?,
    aufnahmeLaeuft: Boolean,
    /** Laufende Aufnahmedauer als „0:07:12"; null, wenn nichts läuft. */
    dauer: String?,
    wechsle: (String) -> Unit,
    aufnahmeKnopf: () -> Unit,
) {
    Box(contentAlignment = Alignment.TopCenter) {
        NavigationBar(
            containerColor = NightSurface,
            tonalElevation = 0.dp,
        ) {
            NavigationBarItem(
                selected = aktuelleRoute == REITER_TOUREN,
                onClick = { wechsle(REITER_TOUREN) },
                colors = reiterFarben(),
                icon = {
                    Icon(
                        if (aktuelleRoute == REITER_TOUREN) Icons.Filled.Map else Icons.Outlined.Map,
                        contentDescription = null,
                    )
                },
                label = { Text("Touren") },
            )
            // Platzhalter unter dem Aufnahme-Knopf: er schwebt darüber und ist
            // kein Reiter — er wechselt nichts, er startet etwas.
            NavigationBarItem(selected = false, onClick = {}, enabled = false, icon = {}, label = {})
            NavigationBarItem(
                selected = aktuelleRoute == REITER_PROFIL,
                onClick = { wechsle(REITER_PROFIL) },
                colors = reiterFarben(),
                icon = {
                    Icon(
                        if (aktuelleRoute == REITER_PROFIL) Icons.Filled.Person else Icons.Outlined.Person,
                        contentDescription = null,
                    )
                },
                label = { Text("Profil") },
            )
        }
        Column(
            Modifier.offset(y = (-20).dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Ausloeser(aufnahmeLaeuft = aufnahmeLaeuft, beiKlick = aufnahmeKnopf)
            // Die laufende Zeit unter dem Knopf: Aus jeder Ansicht heraus ist so
            // zu sehen, dass gerade aufgezeichnet wird — sonst verrät es nur die
            // rote Farbe, und die kann man für Zierde halten.
            if (dauer != null) {
                Spacer(Modifier.height(3.dp))
                Text(
                    dauer,
                    style = MaterialTheme.typography.labelSmall,
                    color = Danger,
                )
            }
        }
    }
}
