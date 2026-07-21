// Farbwelt der App — die des Web-Players und der Website: fast schwarze Nacht,
// warmes Cremeweiß als Schrift, Sonnengelb als einziger Akzent.
//
// Die App ist bewusst NUR dunkel. Das ist keine fehlende Hälfte, sondern eine
// Entscheidung: Der Player läuft immer nachts, die Website ebenso, und
// Reisefotos stehen auf dunklem Grund, ohne dass ein weißer Rahmen gegen sie
// anleuchtet. Ein zweites Schema wäre eine zweite Marke.
//
// Alle Farbrollen sind gesetzt, nicht nur eine Handvoll. Vorher waren es fünf —
// den Rest füllte Material aus seiner Grundpalette auf, und die ist violett
// getönt: Trennlinien, Eingabefeld-Ränder und Sekundärtexte waren lilagrau in
// einer nachtblauen App. Genau daher kam der Eindruck, hier sei eine Vorlage
// nicht zu Ende gestaltet worden.
//
// `surfaceTint` ist durchsichtig, und das ist wichtig: Material mischt sonst
// die Primärfarbe in jede erhobene Fläche. Bei Sonnengelb als Primärfarbe legte
// das einen Braunstich über Navigationsleiste, Blätter und Dialoge.
package app.luhambo.ui

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/** Der Akzent der Marke — sparsam einsetzen, sonst verliert er seine Wirkung. */
val Sonne = Color(0xFFF5A623)

/** Warmes Cremeweiß statt reinem Weiß: ruhiger auf großen dunklen Flächen. */
val Tinte = Color(0xFFF2EDE3)

/** Der Grund, auf dem alles liegt. */
val Nacht = Color(0xFF06090E)

/** Erhobene Flächen: Leisten, Blätter, Eingaben. */
val NachtFlaeche = Color(0xFF10151C)

/** Gedämpfte Schrift — warmes Grau, damit es zur Tinte gehört. */
val Gedaempft = Color(0xFF9C978E)

/** Aufnahme und Fehler. */
val Alarm = Color(0xFFE5484D)

private val DunklesSchema = darkColorScheme(
    primary = Sonne,
    onPrimary = Color(0xFF1B1206),
    primaryContainer = Color(0xFF3B2A0F),
    onPrimaryContainer = Color(0xFFFFD9A0),

    // Ausgewählte Chips und Ähnliches: warmer Grund, goldene Schrift — kein
    // zweiter Farbklang, der mit der Sonne konkurriert.
    secondary = Color(0xFFCBB893),
    onSecondary = Color(0xFF1B1206),
    secondaryContainer = Color(0xFF2A2118),
    onSecondaryContainer = Sonne,

    tertiary = Color(0xFF8FB2CE),
    onTertiary = Color(0xFF0B131B),
    tertiaryContainer = Color(0xFF1C2A36),
    onTertiaryContainer = Color(0xFFCFE2F2),

    background = Nacht,
    onBackground = Tinte,
    surface = Nacht,
    onSurface = Tinte,
    surfaceVariant = Color(0xFF1A212A),
    onSurfaceVariant = Gedaempft,
    surfaceTint = Color.Transparent,

    // Die Abstufungen, aus denen Material Blätter, Menüs und Dialoge baut
    surfaceContainerLowest = Color(0xFF03060A),
    surfaceContainerLow = Color(0xFF0B0F15),
    surfaceContainer = NachtFlaeche,
    surfaceContainerHigh = Color(0xFF161C25),
    surfaceContainerHighest = Color(0xFF1E252F),

    // Ränder von Eingabefeldern (outline) sichtbar, Trennlinien (Variant) leise
    outline = Color(0xFF3C4650),
    outlineVariant = Color(0xFF232B35),

    error = Alarm,
    onError = Color(0xFF2A0A0C),
    errorContainer = Color(0xFF3A1618),
    onErrorContainer = Color(0xFFFFC9CB),

    inverseSurface = Tinte,
    inverseOnSurface = Nacht,
    inversePrimary = Color(0xFF7A5410),
    scrim = Color(0xFF000000),
)

// Etwas straffer als Materials Vorgabe: stark gerundete Ecken lassen jede
// Fläche nach Knopf aussehen. Chips und Marken-Plaketten runden separat voll.
private val Formen = Shapes(
    extraSmall = RoundedCornerShape(6.dp),
    small = RoundedCornerShape(10.dp),
    medium = RoundedCornerShape(14.dp),
    large = RoundedCornerShape(20.dp),
    extraLarge = RoundedCornerShape(28.dp),
)

@Composable
fun LuhamboTheme(inhalt: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = DunklesSchema,
        typography = LuhamboTypografie,
        shapes = Formen,
        content = inhalt,
    )
}
