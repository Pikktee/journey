// Navigations-Graph der App: Start-Gate (Anmeldung) → Reiter Touren/Profil mit
// dem Aufnahme-Knopf dazwischen → Aufzeichnung ↔ Kamera ↔ Foto, Tour-Detail →
// Player.
//
// Die Leiste trägt nur zwei Reiter; der große Knopf in der Mitte ist bewusst
// KEIN dritter. Er wechselt nicht die Ansicht, sondern startet etwas — und
// während eine Aufnahme läuft, führt er zurück zu ihr, statt eine zweite zu
// beginnen. Alles, was Bühne braucht (Aufzeichnung, Kamera, Foto, Detail,
// Player), läuft ohne Leiste.
package app.luhambo.ui

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
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
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
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
import app.luhambo.LuhamboApp
import app.luhambo.aufzeichnung.AufzeichnungsService
import app.luhambo.aufzeichnung.AufzeichnungsZustand
import app.luhambo.daten.Modus
import app.luhambo.kamera.KameraScreen
import app.luhambo.upload.Einstellungen

/** Reiter der Hauptnavigation. */
private const val REITER_TOUREN = "touren"
private const val REITER_PROFIL = "profil"

@Composable
fun LuhamboNavigation() {
    val app = LocalContext.current.applicationContext as LuhamboApp
    // Start-Gate: das Konto kommt asynchron aus dem DataStore. Solange es noch
    // null ist, kurz laden; ohne gültiges Token zuerst die Anmeldung, sonst App.
    val konto by app.einstellungen.konto.collectAsState(initial = null)

    when {
        konto == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        konto?.angemeldet != true -> AnmeldungScreen(
            viewModel = viewModel(factory = LuhamboViewModelFactory(app)),
        )
        else -> AngemeldeteNavigation(app)
    }
}

@Composable
private fun AngemeldeteNavigation(app: LuhamboApp) {
    val navController = rememberNavController()
    val context = LocalContext.current
    val aufnahme by AufzeichnungsZustand.aktuell.collectAsState()
    var neueTour by remember { mutableStateOf(false) }

    val eintrag by navController.currentBackStackEntryAsState()
    val route = eintrag?.destination?.route
    val leisteSichtbar = route == REITER_TOUREN || route == REITER_PROFIL

    // Ohne Standort-Erlaubnis beendet sich der Aufzeichnungs-Service wortlos.
    // Sie wird deshalb erst erfragt, wenn wirklich losgeht — und die Wahl aus
    // dem Blatt so lange gemerkt, bis der Systemdialog beantwortet ist.
    var wunsch by remember { mutableStateOf<Pair<String?, Modus>?>(null) }
    val rechteLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { ergebnis ->
        val wahl = wunsch
        wunsch = null
        if (ergebnis[Manifest.permission.ACCESS_FINE_LOCATION] == true && wahl != null) {
            AufzeichnungsService.starte(context, wahl.second, wahl.first)
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
                TourenScreen(
                    viewModel = viewModel(factory = LuhamboViewModelFactory(app)),
                    zurAufzeichnung = { navController.navigate("aufzeichnung") },
                    zurTour = { tourId -> navController.navigate("tour/$tourId") },
                    zumPlayer = { serverId -> navController.navigate("player/$serverId") },
                )
            }
            composable(REITER_PROFIL) {
                ProfilScreen(viewModel = viewModel(factory = LuhamboViewModelFactory(app)))
            }
            composable("aufzeichnung") {
                AufzeichnungScreen(
                    zurKamera = { navController.navigate("kamera") },
                    zumFoto = { tourId, mediumId -> navController.navigate("foto/$tourId/$mediumId") },
                    fertig = { tourId ->
                        navController.navigate("tour/$tourId") { popUpTo(REITER_TOUREN) }
                    },
                )
            }
            composable("kamera") {
                KameraScreen(zurueck = { navController.popBackStack() })
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
                FotoVollansicht(
                    viewModel = viewModel(factory = LuhamboViewModelFactory(app, tourId, mediumId)),
                    zurueck = { navController.popBackStack() },
                )
            }
            composable(
                "tour/{tourId}",
                arguments = listOf(navArgument("tourId") { type = NavType.StringType }),
            ) { ziel ->
                val tourId = ziel.arguments?.getString("tourId") ?: return@composable
                TourScreen(
                    viewModel = viewModel(factory = LuhamboViewModelFactory(app, tourId)),
                    zurueck = { navController.popBackStack() },
                    abspielen = { serverId -> navController.navigate("player/$serverId") },
                    zumFoto = { mediumId -> navController.navigate("foto/$tourId/$mediumId") },
                )
            }
            composable(
                "player/{serverId}",
                arguments = listOf(navArgument("serverId") { type = NavType.StringType }),
            ) { ziel ->
                val serverId = ziel.arguments?.getString("serverId") ?: return@composable
                // Der Player lädt erlebnis.html vom WEB-Origin (Prod, fest verdrahtet).
                // Nicht aus konto.serverUrl, sonst zöge die noch nicht geladene erste
                // DataStore-Emission (null) den WebView auf die tote Dev-URL.
                PlayerScreen(
                    serverUrl = Einstellungen.STANDARD_SERVER,
                    serverTourId = serverId,
                    sitzungHolen = { runCatching { app.apiClient.sitzungFuerPlayer() }.getOrNull() },
                    zurueck = { navController.popBackStack() },
                )
            }
        }
    }

    if (neueTour) {
        NeueTourBlatt(
            schliessen = { neueTour = false },
            starten = { titel, modus ->
                neueTour = false
                wunsch = titel to modus
                rechteLauncher.launch(
                    buildList {
                        add(Manifest.permission.ACCESS_FINE_LOCATION)
                        if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
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
    selectedIconColor = Tinte,
    selectedTextColor = Tinte,
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
            .background(Nacht)
            .border(2.dp, Tinte.copy(alpha = 0.5f), CircleShape)
            .clickable(onClickLabel = beschriftung, onClick = beiKlick)
            .semantics { contentDescription = beschriftung },
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .size(44.dp)
                .clip(CircleShape)
                .background(if (aufnahmeLaeuft) Alarm else Sonne),
        )
    }
}

@Composable
private fun Hauptleiste(
    aktuelleRoute: String?,
    aufnahmeLaeuft: Boolean,
    wechsle: (String) -> Unit,
    aufnahmeKnopf: () -> Unit,
) {
    Box(contentAlignment = Alignment.TopCenter) {
        NavigationBar(
            containerColor = NachtFlaeche,
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
        Ausloeser(
            aufnahmeLaeuft = aufnahmeLaeuft,
            beiKlick = aufnahmeKnopf,
            modifier = Modifier.offset(y = (-20).dp),
        )
    }
}
