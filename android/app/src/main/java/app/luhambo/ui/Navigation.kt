// Navigations-Graph der App: Start-Gate (Anmeldung) → Start (Liste) →
// Aufzeichnung ↔ Kamera, Tour-Entwurf → Player (WebView), Einstellungen.
package app.luhambo.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import app.luhambo.LuhamboApp
import app.luhambo.kamera.KameraScreen
import app.luhambo.upload.Einstellungen

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

    NavHost(navController = navController, startDestination = "start") {
        composable("start") {
            StartScreen(
                viewModel = viewModel(factory = LuhamboViewModelFactory(app)),
                zurAufzeichnung = { navController.navigate("aufzeichnung") },
                zurTour = { tourId -> navController.navigate("tour/$tourId") },
                zumPlayer = { serverId -> navController.navigate("player/$serverId") },
                zuEinstellungen = { navController.navigate("einstellungen") },
                zuImport = { navController.navigate("import") },
            )
        }
        composable("import") {
            ImportScreen(
                viewModel = viewModel(factory = LuhamboViewModelFactory(app)),
                zurueck = { navController.popBackStack() },
                abspielen = { serverId -> navController.navigate("player/$serverId") },
            )
        }
        composable("aufzeichnung") {
            AufzeichnungScreen(
                zurKamera = { navController.navigate("kamera") },
                fertig = { tourId ->
                    navController.navigate("tour/$tourId") { popUpTo("start") }
                },
            )
        }
        composable("kamera") {
            KameraScreen(zurueck = { navController.popBackStack() })
        }
        composable(
            "tour/{tourId}",
            arguments = listOf(navArgument("tourId") { type = NavType.StringType }),
        ) { eintrag ->
            val tourId = eintrag.arguments?.getString("tourId") ?: return@composable
            TourScreen(
                viewModel = viewModel(factory = LuhamboViewModelFactory(app, tourId)),
                zurueck = { navController.popBackStack() },
                abspielen = { serverId -> navController.navigate("player/$serverId") },
            )
        }
        composable(
            "player/{serverId}",
            arguments = listOf(navArgument("serverId") { type = NavType.StringType }),
        ) { eintrag ->
            val serverId = eintrag.arguments?.getString("serverId") ?: return@composable
            // Der Player lädt erlebnis.html vom WEB-Origin (Prod, fest verdrahtet).
            // Nicht aus konto.serverUrl, sonst zöge die noch nicht geladene erste
            // DataStore-Emission (null) den WebView auf die tote Dev-URL.
            PlayerScreen(
                serverUrl = Einstellungen.STANDARD_SERVER,
                serverTourId = serverId,
            )
        }
        composable("einstellungen") {
            EinstellungenScreen(
                viewModel = viewModel(factory = LuhamboViewModelFactory(app)),
                zurueck = { navController.popBackStack() },
            )
        }
    }
}
