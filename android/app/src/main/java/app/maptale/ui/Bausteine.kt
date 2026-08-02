// Kleinteile, die mehrere Screens teilen — damit sie nicht dreimal leicht
// verschieden aussehen.
package app.maptale.ui

import android.media.MediaPlayer
import android.net.Uri
import android.widget.MediaController
import android.widget.VideoView
import androidx.compose.foundation.background
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextFieldColors
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import app.maptale.aufzeichnung.Bildpunkt
import app.maptale.aufzeichnung.Fotomarke
import app.maptale.aufzeichnung.Fotopunkt
import app.maptale.aufzeichnung.Projektion
import app.maptale.aufzeichnung.Spurpunkt
import app.maptale.aufzeichnung.aufLinie
import app.maptale.aufzeichnung.balleFotos
import coil.compose.AsyncImage
import kotlin.math.hypot

/** Pill-Radius für Primär-CTAs (DESIGN.md `rounded.full`). */
val Pill = RoundedCornerShape(50)

/**
 * Explizite Eingabefarben — Creme auf bg-deep, nie System-Schwarz auf Grau.
 * Material3 kann ohne das je nach Geräte-Theme die Default-Palette durchreichen.
 */
@Composable
fun markenEingabeFarben(): TextFieldColors = OutlinedTextFieldDefaults.colors(
    focusedTextColor = Tinte,
    unfocusedTextColor = Tinte,
    disabledTextColor = Tinte.copy(alpha = 0.38f),
    errorTextColor = Tinte,
    focusedContainerColor = Nacht,
    unfocusedContainerColor = Nacht,
    disabledContainerColor = Nacht.copy(alpha = 0.6f),
    errorContainerColor = Nacht,
    cursorColor = Sonne,
    focusedBorderColor = Sonne,
    unfocusedBorderColor = Color(0xFF3C4650),
    disabledBorderColor = Color(0xFF3C4650).copy(alpha = 0.4f),
    errorBorderColor = Alarm,
    focusedLabelColor = Sonne,
    unfocusedLabelColor = Gedaempft,
    disabledLabelColor = Gedaempft.copy(alpha = 0.5f),
    errorLabelColor = Alarm,
    focusedPlaceholderColor = Gedaempft,
    unfocusedPlaceholderColor = Gedaempft,
)

/** OutlinedTextField mit Markenfarben — Standard für Anmeldung und Formulare. */
@Composable
fun MarkenFeld(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    label: @Composable (() -> Unit)? = null,
    placeholder: @Composable (() -> Unit)? = null,
    enabled: Boolean = true,
    singleLine: Boolean = false,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    textStyle: TextStyle = MaterialTheme.typography.bodyLarge.copy(color = Tinte),
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier,
        label = label,
        placeholder = placeholder,
        enabled = enabled,
        singleLine = singleLine,
        visualTransformation = visualTransformation,
        keyboardOptions = keyboardOptions,
        textStyle = textStyle,
        shape = MaterialTheme.shapes.small,
        colors = markenEingabeFarben(),
    )
}

/**
 * Primär-CTA: Amber→Coral-Verlauf, Pill, Text auf dunklem Braun.
 */
@Composable
fun PrimaerKnopf(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    inhalt: @Composable () -> Unit,
) {
    val interaktion = remember { MutableInteractionSource() }
    Box(
        modifier
            .height(52.dp)
            .clip(Pill)
            .background(VerlaufPrimaer, Pill)
            .then(
                if (!enabled) Modifier.background(Color(0x9906090E), Pill)
                else Modifier,
            )
            .clickable(
                enabled = enabled,
                interactionSource = interaktion,
                indication = null,
                onClick = onClick,
            ),
        contentAlignment = Alignment.Center,
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) { inhalt() }
    }
}

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
 *
 * **Bis das erste Bild da ist, steht [standbild] im Weg — nicht Schwarz.** Ein
 * VideoView zeigt vor dem ersten dekodierten Frame nichts, und „nichts" heißt
 * auf einer dunklen Bühne: eine leere schwarze Fläche ohne Ladehinweis, ohne
 * Abspielzeichen, ohne Fehler. Über Mobilfunk dauerte das bei einer Aufnahme
 * vom Telefon mehrere Sekunden (gemessen ~5 s) — lange genug, dass jeder
 * vernünftige Mensch das Video für kaputt hält und zurückgeht. Gezeigt wird
 * dasselbe Bild wie auf der Kachel, damit der Wechsel zur Wiedergabe nicht
 * springt.
 *
 * Und **ein Fehler wird gesagt**: Ohne `setOnErrorListener` verschwand ein
 * gescheiterter Start spurlos in der schwarzen Fläche.
 */
@Composable
fun Videoflaeche(
    quelle: Uri,
    modifier: Modifier = Modifier,
    kopfzeilen: Map<String, String> = emptyMap(),
    /** Standbild für die Wartezeit: Poster-URL (Server) oder Videodatei (lokal). */
    standbild: Any? = null,
) {
    // Auf `quelle` geschlüsselt: ein anderes Video fängt wieder beim Warten an.
    var laeuft by remember(quelle) { mutableStateOf(false) }
    var fehler by remember(quelle) { mutableStateOf(false) }
    var gesetzt by remember { mutableStateOf<Pair<Uri, Map<String, String>>?>(null) }

    Box(modifier, contentAlignment = Alignment.Center) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { ctx ->
                VideoView(ctx).apply {
                    setMediaController(MediaController(ctx).also { it.setAnchorView(this) })
                    setOnPreparedListener { spieler ->
                        spieler.isLooping = false
                        start()
                    }
                    // Das erste GERENDERTE Bild, nicht `onPrepared`: Zwischen
                    // „bereit" und „sichtbar" liegt noch der erste Frame.
                    setOnInfoListener { _, was, _ ->
                        if (was == MediaPlayer.MEDIA_INFO_VIDEO_RENDERING_START) laeuft = true
                        false
                    }
                    // `true` = wir haben den Fehler behandelt; sonst schöbe
                    // VideoView seinen eigenen Systemdialog darüber.
                    setOnErrorListener { _, _, _ ->
                        fehler = true
                        true
                    }
                }
            },
            // Die Quelle gehört in den update-Block, nicht in die factory: Die
            // läuft genau einmal, und beim Server kommt die Sitzung für die
            // Kopfzeilen erst aus dem Netz. Wer sie dort setzt, spielt ein
            // privates Video ohne Anmeldung an — und bekommt nie eine zweite
            // Chance. Der Vergleich mit dem zuletzt Gesetzten verhindert, dass
            // jede Recomposition die Wiedergabe von vorn beginnen lässt.
            update = { ansicht ->
                val jetzt = quelle to kopfzeilen
                if (gesetzt != jetzt) {
                    gesetzt = jetzt
                    laeuft = false
                    fehler = false
                    ansicht.setVideoURI(quelle, kopfzeilen)
                }
            },
            onRelease = { ansicht ->
                // Ohne das läuft der Ton weiter, wenn die Ansicht verschwindet
                ansicht.stopPlayback()
            },
        )

        if (!laeuft) {
            if (standbild != null) {
                AsyncImage(
                    model = standbild,
                    contentDescription = null,
                    contentScale = ContentScale.Fit,
                    modifier = Modifier.fillMaxSize(),
                )
            }
            if (fehler) {
                Text(
                    "Video lässt sich nicht abspielen",
                    style = MaterialTheme.typography.labelLarge,
                    color = Tinte,
                    modifier = Modifier
                        .clip(Pill)
                        .background(Color(0xB306090E))
                        .padding(horizontal = 16.dp, vertical = 10.dp),
                )
            } else {
                CircularProgressIndicator(
                    color = Tinte,
                    strokeWidth = 2.dp,
                    modifier = Modifier.size(30.dp),
                )
            }
        }
    }
}

/**
 * Ein Weg als Strichzeichnung — live wachsend oder als fertige Route.
 *
 * Keine Karte, mit Absicht: Ein Kartenrenderer samt Kachel-Downloads liefe
 * stundenlang neben der Aufzeichnung her und wäre genau das, was den Akku
 * leert. Die Form des Weges genügt für das, was man wissen will — läuft die
 * Aufnahme plausibel? bzw.: welche Gestalt hatte diese Reise?
 *
 * Zwei Zustände: Läuft die Aufnahme (`abgeschlossen = false`), markiert ein
 * heller Kopf die aktuelle Position, und eine leere Spur zeigt „Suche Position".
 * Ist die Tour fertig, tragen Anfang und Ende je eine Marke — gefüllt der
 * Start, ein Ring das Ziel; bei einer Rundtour fallen sie zusammen.
 *
 * Sind [fotos] gesetzt, sitzen sie als Cremepunkte auf dem Weg. Das macht die
 * Skizze zum RÄUMLICHEN Verzeichnis: „das Bild von oben am Grat" findet man hier,
 * im zeitlich sortierten Gitter darunter nicht. Als Kacheln ginge das nicht —
 * ein erkennbares Vorschaubild misst ~40 dp, ein Dutzend davon deckt die Linie
 * vollständig zu.
 */
@Composable
fun Routenskizze(
    spur: List<Spurpunkt>,
    modifier: Modifier = Modifier,
    abgeschlossen: Boolean = false,
    fotos: List<Fotomarke> = emptyList(),
    beiFotoklick: ((String) -> Unit)? = null,
) {
    if (spur.isEmpty()) {
        if (abgeschlossen) return // ohne Track keine Skizze, kein leerer Kasten
        Box(modifier, contentAlignment = Alignment.Center) {
            Text(
                "Suche Position …",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        return
    }

    val dichte = LocalDensity.current
    val randPx = with(dichte) { 14.dp.toPx() }
    // Zusammenfassen etwa ab Punktdurchmesser — enger sähe es nur nach Klecks aus.
    val ballAbstandPx = with(dichte) { 13.dp.toPx() }
    // Großzügige Trefferfläche: Die Punkte sind winzig, die Fingerkuppe ist es nicht.
    val trefferPx = with(dichte) { 22.dp.toPx() }

    // Die Geometrie liegt NEBEN dem Zeichnen, nicht darin: Der Tipp muss dieselben
    // Punkte treffen, die gemalt wurden — sonst zeigt die Skizze das eine und
    // öffnet das andere.
    var flaeche by remember { mutableStateOf(IntSize.Zero) }
    val geometrie = remember(flaeche, spur, fotos) {
        val projektion = Projektion.aus(spur, flaeche.width.toFloat(), flaeche.height.toFloat(), randPx)
            ?: return@remember null
        val linie = spur.map { projektion.projiziere(it) }
        Skizzengeometrie(
            linie = linie,
            fotos = balleFotos(
                fotos.map { it.id to aufLinie(projektion.projiziere(Spurpunkt(it.lng, it.lat)), linie) },
                ballAbstandPx,
            ),
        )
    }

    val klick = beiFotoklick
    Canvas(
        modifier
            .onSizeChanged { flaeche = it }
            .then(
                if (klick != null && fotos.isNotEmpty()) {
                    Modifier.pointerInput(geometrie) {
                        detectTapGestures { tipp ->
                            geometrie?.fotos
                                ?.minByOrNull { hypot(it.punkt.x - tipp.x, it.punkt.y - tipp.y) }
                                ?.takeIf { hypot(it.punkt.x - tipp.x, it.punkt.y - tipp.y) <= trefferPx }
                                ?.let { klick(it.id) }
                        }
                    }
                } else {
                    Modifier
                },
            ),
    ) {
        val gezeichnet = geometrie ?: return@Canvas

        if (gezeichnet.linie.size >= 2) {
            val pfad = Path().apply {
                moveTo(gezeichnet.linie.first().x, gezeichnet.linie.first().y)
                for (p in gezeichnet.linie.drop(1)) lineTo(p.x, p.y)
            }
            drawPath(
                pfad,
                color = Sonne,
                style = Stroke(
                    width = 3.dp.toPx(),
                    cap = StrokeCap.Round,
                    join = StrokeJoin.Round,
                ),
            )
        }

        // Alle Marken folgen derselben Grammatik: ein haarfeiner dunkler Rand,
        // dann die Füllung. Der Rand trennt sie von der gelben Linie, ohne sie
        // zu zerhacken — ein breiter Hof riss sichtbare Löcher in den Weg.
        fun DrawScope.marke(bei: Bildpunkt, aussen: Float, male: DrawScope.(Offset) -> Unit) {
            val mitte = Offset(bei.x, bei.y)
            drawCircle(Nacht, radius = aussen, center = mitte)
            male(mitte)
        }

        // Foto-Punkte gut halb so groß wie Start und Ziel: Sie sind die zweite
        // Stimme, das Gelb der Linie bleibt der eine kräftige Ton. Bei voller
        // Größe wurde die Skizze zur Perlenschnur.
        for (foto in gezeichnet.fotos) {
            marke(foto.punkt, 3.2.dp.toPx()) { mitte ->
                drawCircle(Tinte, radius = 2.4.dp.toPx(), center = mitte)
            }
        }

        if (abgeschlossen) {
            // Start gefüllt, Ziel als Ring — so ist die Richtung ablesbar, ohne
            // dass es eine Beschriftung braucht. Zuletzt gezeichnet: Wo ein Foto
            // genau am Anfang oder Ende liegt, gewinnt die Wegmarke.
            marke(gezeichnet.linie.first(), 5.2.dp.toPx()) { mitte ->
                drawCircle(Sonne, radius = 4.2.dp.toPx(), center = mitte)
            }
            marke(gezeichnet.linie.last(), 5.2.dp.toPx()) { mitte ->
                drawCircle(Tinte, radius = 4.2.dp.toPx(), center = mitte, style = Stroke(width = 1.8.dp.toPx()))
            }
        } else {
            marke(gezeichnet.linie.last(), 5.2.dp.toPx()) { mitte ->
                drawCircle(Tinte, radius = 4.2.dp.toPx(), center = mitte)
            }
        }
    }
}

/** Was die Skizze zeichnet und was ein Tipp trifft — dieselben Koordinaten. */
private data class Skizzengeometrie(val linie: List<Bildpunkt>, val fotos: List<Fotopunkt>)

/**
 * Abschnittsüberschrift — Titelstil, keine Versal-Dachzeile.
 * DESIGN.md: keine Eyebrows; Gliederung über Gewicht und Farbe, nicht Tracking.
 */
@Composable
fun Abschnittstitel(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        style = MaterialTheme.typography.titleSmall,
        color = Gedaempft,
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
