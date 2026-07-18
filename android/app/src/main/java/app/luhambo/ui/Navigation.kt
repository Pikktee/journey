// Navigations-Graph der App: Start (Liste) → Aufzeichnung ↔ Kamera,
// Tour-Entwurf → Player (WebView), Einstellungen.
package app.luhambo.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
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
    val navController = rememberNavController()
    val app = LocalContext.current.applicationContext as LuhamboApp

    NavHost(navController = navController, startDestination = "start") {
        composable("start") {
            StartScreen(
                viewModel = viewModel(factory = LuhamboViewModelFactory(app)),
                zurAufzeichnung = { navController.navigate("aufzeichnung") },
                zurTour = { tourId -> navController.navigate("tour/$tourId") },
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
            val konto by app.einstellungen.konto.collectAsState(initial = null)
            PlayerScreen(
                serverUrl = konto?.serverUrl ?: Einstellungen.STANDARD_SERVER,
                serverTourId = serverId,
                zurueck = { navController.popBackStack() },
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
