// Compose-Theme: dunkle Grundstimmung des Web-Players (Nachtblau + Sonnengelb).
package app.luhambo.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val Sonne = Color(0xFFF5A623)
val Nacht = Color(0xFF0E1420)
val NachtFlaeche = Color(0xFF1A2332)

private val DunklesSchema = darkColorScheme(
    primary = Sonne,
    onPrimary = Nacht,
    background = Nacht,
    surface = NachtFlaeche,
    secondary = Color(0xFF7FB4E6),
)

private val HellesSchema = lightColorScheme(
    primary = Color(0xFFB87400),
    secondary = Color(0xFF2E6DA4),
)

@Composable
fun LuhamboTheme(inhalt: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (isSystemInDarkTheme()) DunklesSchema else HellesSchema,
        content = inhalt,
    )
}
