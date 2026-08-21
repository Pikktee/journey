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
val Sun = Color(0xFFF59E0B)

/** Warmer Verlauf- & Zweitakzent (DESIGN.md `coral`). */
val Coral = Color(0xFFFF6F52)

/** Warmes Cremeweiß auf Dunkel (DESIGN.md `text` / `on-surface`). */
val Ink = Color(0xFFF2EDE3)

/** Seitengrund — bg-deep. */
val Night = Color(0xFF06090E)

/** Kachel- / Flächengrund — bg. */
val NightBg = Color(0xFF0A0D14)

/** Erhobene Flächen: Leisten, Blätter. */
val NightSurface = Color(0xFF10151C)

/** Gedämpfte Schrift ≈ muted (Tinte @ 64 %). */
val Muted = Color(0xA3F2EDE3)

/** Text auf Amber/Coral-CTAs (DESIGN.md `on-cta`). */
val OnCta = Color(0xFF1A1206)

/** Aufnahme und Fehler — bewusst nicht Koralle. */
val Danger = Color(0xFFE5484D)

/** Amber → Coral, Primär-CTAs. */
val PrimaryGradient = Brush.linearGradient(listOf(Sun, Coral))

/**
 * Ein GESPERRTER CTA ist eine eigene Gestalt, kein abgedunkelter aktiver.
 *
 * Vorher lag ein Schleier (Tinte @ 60 % Nacht) über dem Amber-Verlauf,
 * während die Schrift `OnCta` blieb — die ist dunkel, weil sie auf Amber
 * steht. Nach dem Abdunkeln standen dann dunkle Schrift auf dunklem Grund:
 * gemessen 2,1:1, also unter jeder Lesbarkeitsschwelle (4,5:1). Am Telefon
 * sah der Anmelde-Knopf dadurch nicht gesperrt aus, sondern kaputt.
 *
 * Deshalb kippt der gesperrte Zustand BEIDES: gedämpfte Fläche UND helle
 * Schrift, zusammen 4,4:1. Wer hier etwas ändert, prüft das Paar und nicht
 * eine Hälfte davon.
 */
val ButtonDisabled = Color(0x1FF2EDE3)

/** Schrift auf `ButtonDisabled` — Tinte @ 50 %. */
val OnButtonDisabled = Color(0x80F2EDE3)

private val DunklesSchema = darkColorScheme(
    primary = Sun,
    onPrimary = OnCta,
    primaryContainer = Color(0xFF3B2A0F),
    onPrimaryContainer = Color(0xFFFFD9A0),

    // Ausgewählte Chips: warmer Grund, goldene Schrift — kein zweiter Klang.
    secondary = Color(0xFFCBB893),
    onSecondary = OnCta,
    secondaryContainer = Color(0xFF2A2118),
    onSecondaryContainer = Sun,

    tertiary = Color(0xFF8FB2CE),
    onTertiary = Color(0xFF0B131B),
    tertiaryContainer = Color(0xFF1C2A36),
    onTertiaryContainer = Color(0xFFCFE2F2),

    background = Night,
    onBackground = Ink,
    surface = NightBg,
    onSurface = Ink,
    surfaceVariant = Color(0xFF1A212A),
    onSurfaceVariant = Muted,
    surfaceTint = Color.Transparent,

    surfaceContainerLowest = Color(0xFF03060A),
    surfaceContainerLow = Color(0xFF0B0F15),
    surfaceContainer = NightSurface,
    surfaceContainerHigh = Color(0xFF161C25),
    surfaceContainerHighest = Color(0xFF1E252F),

    // line ≈ rgba(255,255,255,0.08); Outline etwas kräftiger für Eingaben
    outline = Color(0xFF3C4650),
    outlineVariant = Color(0x14FFFFFF),

    error = Danger,
    onError = Color(0xFF2A0A0C),
    errorContainer = Color(0xFF3A1618),
    onErrorContainer = Color(0xFFFFC9CB),

    inverseSurface = Ink,
    inverseOnSurface = Night,
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
        typography = MaptaleTypography,
        shapes = Formen,
        content = inhalt,
    )
}
