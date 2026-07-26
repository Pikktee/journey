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
package app.maptale.ui

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/** Der Akzent der Marke — Amber (DESIGN.md `primary` / `amber`). */
val Sonne = Color(0xFFF59E0B)

/** Warmer Verlauf- & Zweitakzent (DESIGN.md `coral`). */
val Koralle = Color(0xFFFF6F52)

/** Warmes Cremeweiß auf Dunkel (DESIGN.md `text` / `on-surface`). */
val Tinte = Color(0xFFF2EDE3)

/** Seitengrund — bg-deep. */
val Nacht = Color(0xFF06090E)

/** Kachel- / Flächengrund — bg. */
val NachtBg = Color(0xFF0A0D14)

/** Erhobene Flächen: Leisten, Blätter. */
val NachtFlaeche = Color(0xFF10151C)

/** Gedämpfte Schrift ≈ muted (Tinte @ 64 %). */
val Gedaempft = Color(0xA3F2EDE3)

/** Text auf Amber/Coral-CTAs (DESIGN.md `on-cta`). */
val AufCta = Color(0xFF1A1206)

/** Aufnahme und Fehler — bewusst nicht Koralle. */
val Alarm = Color(0xFFE5484D)

/** Amber → Coral, Primär-CTAs. */
val VerlaufPrimaer = Brush.linearGradient(listOf(Sonne, Koralle))

private val DunklesSchema = darkColorScheme(
    primary = Sonne,
    onPrimary = AufCta,
    primaryContainer = Color(0xFF3B2A0F),
    onPrimaryContainer = Color(0xFFFFD9A0),

    // Ausgewählte Chips: warmer Grund, goldene Schrift — kein zweiter Klang.
    secondary = Color(0xFFCBB893),
    onSecondary = AufCta,
    secondaryContainer = Color(0xFF2A2118),
    onSecondaryContainer = Sonne,

    tertiary = Color(0xFF8FB2CE),
    onTertiary = Color(0xFF0B131B),
    tertiaryContainer = Color(0xFF1C2A36),
    onTertiaryContainer = Color(0xFFCFE2F2),

    background = Nacht,
    onBackground = Tinte,
    surface = NachtBg,
    onSurface = Tinte,
    surfaceVariant = Color(0xFF1A212A),
    onSurfaceVariant = Gedaempft,
    surfaceTint = Color.Transparent,

    surfaceContainerLowest = Color(0xFF03060A),
    surfaceContainerLow = Color(0xFF0B0F15),
    surfaceContainer = NachtFlaeche,
    surfaceContainerHigh = Color(0xFF161C25),
    surfaceContainerHighest = Color(0xFF1E252F),

    // line ≈ rgba(255,255,255,0.08); Outline etwas kräftiger für Eingaben
    outline = Color(0xFF3C4650),
    outlineVariant = Color(0x14FFFFFF),

    error = Alarm,
    onError = Color(0xFF2A0A0C),
    errorContainer = Color(0xFF3A1618),
    onErrorContainer = Color(0xFFFFC9CB),

    inverseSurface = Tinte,
    inverseOnSurface = Nacht,
    inversePrimary = Color(0xFF7A5410),
    scrim = Color(0xFF000000),
)

// DESIGN.md: Cards ≈ 12–16 px; CTAs sind separat Pill (PrimaerKnopf).
private val Formen = Shapes(
    extraSmall = RoundedCornerShape(7.dp),
    small = RoundedCornerShape(9.dp),
    medium = RoundedCornerShape(12.dp),
    large = RoundedCornerShape(16.dp),
    extraLarge = RoundedCornerShape(24.dp),
)

@Composable
fun MaptaleTheme(inhalt: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = DunklesSchema,
        typography = MaptaleTypografie,
        shapes = Formen,
        content = inhalt,
    )
}
