// Kleinteile, die mehrere Screens teilen — damit sie nicht dreimal leicht
// verschieden aussehen.
package app.luhambo.ui

import android.net.Uri
import android.widget.MediaController
import android.widget.VideoView
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import java.util.Locale

/**
 * Runder Knopf, der über einem Bild schwebt.
 *
 * Eigener halbdunkler Grund statt einer Leiste: Wo das Bild bis unter die
 * Statusleiste läuft, wäre ein Symbol ohne Untergrund auf hellem Himmel
 * unsichtbar.
 */
@Composable
fun Rundknopf(
    symbol: ImageVector,
    beschreibung: String,
    beiKlick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier
            .size(40.dp)
            .clip(CircleShape)
            .background(Color(0x8A06090E))
            .clickable(onClickLabel = beschreibung, onClick = beiKlick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(symbol, contentDescription = beschreibung, tint = Tinte, modifier = Modifier.size(20.dp))
    }
}

/**
 * Kleines Abspielzeichen über einer Kachel — sagt „hier bewegt sich etwas".
 *
 * Ohne das sieht ein Video im Gitter aus wie ein Foto, das zufällig unscharf
 * geraten ist: Die Kachel zeigt ja nur ein Standbild daraus.
 */
@Composable
fun Videoabzeichen(modifier: Modifier = Modifier) {
    Box(
        modifier
            .size(26.dp)
            .clip(CircleShape)
            .background(Color(0xA606090E)),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            Icons.Default.PlayArrow,
            contentDescription = "Video",
            tint = Tinte,
            modifier = Modifier.size(16.dp),
        )
    }
}

/**
 * Ein abspielbares Video mit den Bedienelementen des Systems.
 *
 * `VideoView` statt eines eigenen Players: Es steckt im Framework, kann Datei-
 * und Netz-Quellen und bringt die gewohnte Leiste mit. Die Kopfzeilen sind der
 * Grund für die zweite Signatur — Medien beim Server hängen hinter der
 * Anmeldung, und ohne sie käme nur ein Ladefehler.
 */
@Composable
fun Videoflaeche(
    quelle: Uri,
    modifier: Modifier = Modifier,
    kopfzeilen: Map<String, String> = emptyMap(),
) {
    AndroidView(
        modifier = modifier,
        factory = { ctx ->
            VideoView(ctx).apply {
                setMediaController(MediaController(ctx).also { it.setAnchorView(this) })
                setVideoURI(quelle, kopfzeilen)
                setOnPreparedListener { spieler ->
                    spieler.isLooping = false
                    start()
                }
            }
        },
        onRelease = { ansicht ->
            // Ohne das läuft der Ton weiter, wenn die Ansicht verschwindet
            ansicht.stopPlayback()
        },
    )
}

/** Kleine gesperrte Versal-Überschrift — die Gliederung der Website. */
@Composable
fun Abschnittstitel(text: String, modifier: Modifier = Modifier) {
    Text(
        text.uppercase(Locale.GERMAN),
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = modifier,
    )
}

/**
 * Eine Textzeile, die man direkt beschreiben kann — mit Stift als Hinweis.
 *
 * Der Stift ist NICHT selbst der Knopf, sondern liegt in derselben Klickzone
 * wie der Text: Ein Symbol, das nach Schaltfläche aussieht, aber nur auf ein
 * anderes Ziel zeigt, ist der klassische Affordance-Fehler — man tippt darauf
 * und nichts geschieht. Text und Symbol teilen sich deshalb eine Fläche von
 * mindestens 48 dp Höhe (Materials Mindestmaß für Berührungsziele), und ein
 * Tippen irgendwo darin setzt den Schreibzeiger.
 *
 * Zeilenumbrüche werden herausgefiltert, statt das Feld einzeilig zu machen:
 * Umbrechen DARF die Zeile — sonst schneidet ein langer Name mitten im Wort ab
 * —, ein echtes Newline enthalten soll der Text aber nicht.
 */
@Composable
fun Schreibzeile(
    wert: String,
    setzeWert: (String) -> Unit,
    platzhalter: String,
    stil: TextStyle,
    fokus: FocusRequester,
    modifier: Modifier = Modifier,
    farbe: Color = Tinte,
) {
    val fokusManager = LocalFocusManager.current
    var wirdBearbeitet by remember { mutableStateOf(false) }

    // Bestätigen heißt: Fokus WEG. Die Tastatur nur zu schließen reichte nicht —
    // das Feld blieb aktiv, der Schreibzeiger blinkte weiter, und man wusste
    // nicht, ob die Änderung nun gilt.
    val bestaetige = { fokusManager.clearFocus() }

    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(
            Modifier
                .weight(1f)
                .clickable(
                    // Kein Ripple: Das hier ist eine Textzeile, keine
                    // Schaltfläche — der Schreibzeiger ist die Rückmeldung.
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    onClickLabel = "Bearbeiten",
                ) { fokus.requestFocus() },
        ) {
            if (wert.isEmpty()) {
                Text(platzhalter, style = stil, color = farbe.copy(alpha = 0.45f), maxLines = 2)
            }
            BasicTextField(
                value = wert,
                onValueChange = { setzeWert(it.replace("\n", " ")) },
                textStyle = stil.copy(color = farbe),
                cursorBrush = SolidColor(Sonne),
                maxLines = 2,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { bestaetige() }),
                modifier = Modifier
                    .fillMaxWidth()
                    .focusRequester(fokus)
                    .onFocusChanged { wirdBearbeitet = it.isFocused },
            )
        }
        // Der Stift wird beim Schreiben zum Haken — dieselbe Stelle, zwei
        // Zustände: „lässt sich ändern" und „fertig". Ein sichtbarer Abschluss
        // an genau der Stelle, an der man ihn sucht.
        if (wirdBearbeitet) {
            Box(
                Modifier
                    .size(44.dp)
                    .clip(CircleShape)
                    .clickable(onClickLabel = "Fertig", onClick = bestaetige),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Default.Check,
                    contentDescription = "Fertig",
                    tint = Sonne,
                    modifier = Modifier.size(22.dp),
                )
            }
        } else {
            Icon(
                Icons.Default.Edit,
                // Die Zeile trägt die Beschriftung; ein zweites Mal „Bearbeiten"
                // würde die Sprachausgabe nur wiederholen.
                contentDescription = null,
                tint = farbe.copy(alpha = 0.5f),
                modifier = Modifier.size(17.dp),
            )
        }
    }
}
