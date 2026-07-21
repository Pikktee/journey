// Kamera während der Aufzeichnung: Foto (CameraX ImageCapture) ODER Video
// (VideoCapture/Recorder, FHD) — umschaltbar, die Kamera bindet beim Wechsel neu
// (nicht jedes Gerät kann Preview + Image + Video gleichzeitig). Der Anker ist
// der letzte akzeptierte Trackpunkt (robuster als EXIF-GPS, Plan M3/M4); Dauer
// und Poster des Videos ermittelt das Backend beim Anreichern.
//
// Bedienung wie in einer gewohnten Kamera-App: Kneifen zoomt stufenlos, die
// Pille springt auf feste Stufen, ein Tippen setzt Fokus und Belichtung. Alles,
// was die Hand bedient — Zoom, Foto/Video, Auslöser, Kamerawechsel — liegt
// unten; oben stehen nur Schließen und Blitz. Nach dem Auslösen schließt der
// Screen — an einem Punkt der Strecke entsteht in aller Regel EIN Foto.
package app.luhambo.kamera

import android.Manifest
import android.content.pm.PackageManager
import android.view.OrientationEventListener
import android.view.Surface
import android.view.ViewGroup
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.FocusMeteringAction
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.video.FallbackStrategy
import androidx.camera.video.FileOutputOptions
import androidx.camera.video.Quality
import androidx.camera.video.QualitySelector
import androidx.camera.video.Recorder
import androidx.camera.video.Recording
import androidx.camera.video.VideoCapture
import androidx.camera.video.VideoRecordEvent
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Cameraswitch
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.FlashAuto
import androidx.compose.material.icons.filled.FlashOff
import androidx.compose.material.icons.filled.FlashOn
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.draw.clip
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import app.luhambo.LuhamboApp
import app.luhambo.aufzeichnung.AufzeichnungsZustand
import app.luhambo.ui.Alarm
import app.luhambo.ui.Rundknopf
import app.luhambo.ui.Sonne
import app.luhambo.ui.Tinte
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private enum class AufnahmeModus { FOTO, VIDEO }

/** Blitz-Zyklus des Auslösers; Reihenfolge wie in gängigen Kamera-Apps. */
private enum class BlitzModus(val ausCameraX: Int, val beschriftung: String) {
    AUS(ImageCapture.FLASH_MODE_OFF, "Blitz aus"),
    AUTOMATISCH(ImageCapture.FLASH_MODE_AUTO, "Blitz automatisch"),
    AN(ImageCapture.FLASH_MODE_ON, "Blitz an"),
    ;

    fun naechster(): BlitzModus = entries[(ordinal + 1) % entries.size]
}

/** Wie lange der Fokus-Ring nach dem Tippen stehen bleibt. */
private const val FOKUS_RING_MS = 900L

@Composable
fun KameraScreen(zurueck: () -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val app = context.applicationContext as LuhamboApp
    val dichte = LocalDensity.current

    var modus by remember { mutableStateOf(AufnahmeModus.FOTO) }
    var speichert by remember { mutableStateOf(false) } // Foto wird gerade abgelegt
    var aufnahmeLaeuft by remember { mutableStateOf<Recording?>(null) } // laufende Videoaufnahme
    var vorschau by remember { mutableStateOf<PreviewView?>(null) }
    var provider by remember { mutableStateOf<ProcessCameraProvider?>(null) }
    var kamera by remember { mutableStateOf<Camera?>(null) }
    var vorne by remember { mutableStateOf(false) }
    var blitz by remember { mutableStateOf(BlitzModus.AUS) }
    // Zoom-Grenzen und -Stand kommen vom gebundenen Objektiv; beim Kamerawechsel
    // gelten andere, deshalb hängen sie am Kamera-Handle und nicht am Screen.
    var zoomMin by remember { mutableStateOf(1f) }
    var zoomMax by remember { mutableStateOf(1f) }
    var zoom by remember { mutableStateOf(1f) }
    var fokusPunkt by remember { mutableStateOf<Offset?>(null) }
    // Ton ist Opt-in: withAudioEnabled() wirft ohne RECORD_AUDIO, also nur mit Erlaubnis
    var tonErlaubt by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
                PackageManager.PERMISSION_GRANTED,
        )
    }
    // Genau einmal zurück navigieren: der X-Knopf und der asynchrone Foto-Callback
    // dürfen nicht beide popBackStack aufrufen (sonst überspringt es einen Screen).
    var fertig by remember { mutableStateOf(false) }
    val zurueckEinmal = { if (!fertig) { fertig = true; zurueck() } }

    val imageCapture = remember { ImageCapture.Builder().setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY).build() }
    val videoCapture = remember {
        // FHD bevorzugt, notfalls die nächstniedrige verfügbare Qualität
        val recorder = Recorder.Builder()
            .setQualitySelector(QualitySelector.from(Quality.FHD, FallbackStrategy.lowerQualityOrHigherThan(Quality.SD)))
            .build()
        VideoCapture.withOutput(recorder)
    }

    // Der Blitz sitzt an der Rückseite — vorne gibt es keinen, also gilt dort „aus".
    val blitzNutzbar = modus == AufnahmeModus.FOTO && !vorne
    LaunchedEffect(blitz, blitzNutzbar) {
        imageCapture.flashMode = if (blitzNutzbar) blitz.ausCameraX else ImageCapture.FLASH_MODE_OFF
    }

    // Geräteausrichtung nachführen: die Compose-UI ist nicht rotationsgebunden,
    // also muss die Aufnahme-Rotation aktiv gesetzt werden, sonst schreibt CameraX
    // die EXIF-Orientation nur für die beim Binden gültige Displaylage korrekt.
    DisposableEffect(imageCapture, videoCapture) {
        val lauscher = object : OrientationEventListener(context) {
            override fun onOrientationChanged(grad: Int) {
                if (grad == OrientationEventListener.ORIENTATION_UNKNOWN) return
                val rotation = when {
                    grad >= 315 || grad < 45 -> Surface.ROTATION_0
                    grad < 135 -> Surface.ROTATION_270
                    grad < 225 -> Surface.ROTATION_180
                    else -> Surface.ROTATION_90
                }
                imageCapture.targetRotation = rotation
                videoCapture.targetRotation = rotation
            }
        }
        if (lauscher.canDetectOrientation()) lauscher.enable()
        onDispose { lauscher.disable() }
    }

    // Video im App-Speicher ablegen und im App-Scope registrieren — das Finalize
    // kommt asynchron NACH dem Stopp, muss also den Screen-Wechsel überleben.
    fun starteVideoAufnahme() {
        val aufnahme = AufzeichnungsZustand.aktuell.value ?: return
        val (relativ, datei) = app.repository.neueMediumDatei(aufnahme.tourId, "mp4")
        var vorbereitung = videoCapture.output.prepareRecording(context, FileOutputOptions.Builder(datei).build())
        if (tonErlaubt) vorbereitung = vorbereitung.withAudioEnabled()
        aufnahmeLaeuft = vorbereitung.start(ContextCompat.getMainExecutor(context)) { ereignis ->
            if (ereignis is VideoRecordEvent.Finalize) {
                if (ereignis.hasError()) {
                    datei.delete()
                } else {
                    val anker = aufnahme.letzterPunkt?.let { it.lng to it.lat }
                    app.appScope.launch {
                        app.repository.registriereVideo(aufnahme.tourId, relativ, System.currentTimeMillis(), anker)
                    }
                }
            }
        }
    }

    val audioLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { erlaubt ->
        tonErlaubt = erlaubt // ohne Erlaubnis wird stumm aufgenommen
        starteVideoAufnahme()
    }

    // Kamera (neu) binden, sobald Vorschau + Provider stehen, der Modus wechselt
    // oder auf das andere Objektiv umgeschaltet wird.
    LaunchedEffect(modus, provider, vorschau, vorne) {
        val p = provider ?: return@LaunchedEffect
        val view = vorschau ?: return@LaunchedEffect
        val preview = Preview.Builder().build().also { it.surfaceProvider = view.surfaceProvider }
        p.unbindAll()
        val gebunden = p.bindToLifecycle(
            lifecycleOwner,
            if (vorne) CameraSelector.DEFAULT_FRONT_CAMERA else CameraSelector.DEFAULT_BACK_CAMERA,
            preview,
            if (modus == AufnahmeModus.FOTO) imageCapture else videoCapture,
        )
        kamera = gebunden
        // Der Zoom-Stand gehört zum Objektiv: nach dem Wechsel gelten die Grenzen
        // der neuen Kamera, ein übernommener Wert wäre schlicht falsch.
        val stand = gebunden.cameraInfo.zoomState.value
        zoomMin = stand?.minZoomRatio ?: 1f
        zoomMax = stand?.maxZoomRatio ?: 1f
        zoom = stand?.zoomRatio ?: 1f
        fokusPunkt = null
    }

    fun setzeZoom(neu: Float) {
        val geklemmt = neu.coerceIn(zoomMin, zoomMax)
        kamera?.cameraControl?.setZoomRatio(geklemmt)
        zoom = geklemmt
    }

    // Fokus-Ring wieder ausblenden (CameraX beendet die Messung selbst nach 3 s)
    LaunchedEffect(fokusPunkt) {
        if (fokusPunkt != null) {
            delay(FOKUS_RING_MS)
            fokusPunkt = null
        }
    }

    val stufen = remember(zoomMin, zoomMax) { zoomStufen(zoomMin, zoomMax) }

    Box(Modifier.fillMaxSize()) {
        AndroidView(
            modifier = Modifier
                .fillMaxSize()
                // Kneifen zoomt stufenlos, Tippen fokussiert. Beide Gesten liegen
                // über der Vorschau, weil die PreviewView selbst keine annimmt.
                .pointerInput(kamera, zoomMin, zoomMax) {
                    detectTransformGestures { _, _, faktor, _ ->
                        if (faktor != 1f) setzeZoom(zoom * faktor)
                    }
                }
                .pointerInput(kamera) {
                    detectTapGestures { stelle ->
                        val view = vorschau ?: return@detectTapGestures
                        val punkt = view.meteringPointFactory.createPoint(stelle.x, stelle.y)
                        kamera?.cameraControl?.startFocusAndMetering(
                            FocusMeteringAction.Builder(punkt, FocusMeteringAction.FLAG_AF or FocusMeteringAction.FLAG_AE)
                                .setAutoCancelDuration(3, java.util.concurrent.TimeUnit.SECONDS)
                                .build(),
                        )
                        fokusPunkt = stelle
                    }
                },
            factory = { ctx ->
                val view = PreviewView(ctx).apply {
                    layoutParams = ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT,
                    )
                }
                val future = ProcessCameraProvider.getInstance(ctx)
                future.addListener({ provider = future.get() }, ContextCompat.getMainExecutor(ctx))
                vorschau = view
                view
            },
        )

        // Fokus-Ring an der getippten Stelle
        fokusPunkt?.let { stelle ->
            val ringGroesse = 72.dp
            val halb = with(dichte) { ringGroesse.toPx() / 2 }
            Box(
                Modifier
                    .offset { IntOffset((stelle.x - halb).toInt(), (stelle.y - halb).toInt()) }
                    .size(ringGroesse)
                    .border(2.dp, Color.White, CircleShape),
            )
        }

        // Schließen: läuft eine Aufnahme, erst sauber stoppen (Finalize registriert
        // sie asynchron), dann zurück — sonst direkt zurück.
        //
        // statusBarsPadding ist hier Pflicht, nicht Feinschliff: Die Vorschau
        // füllt den Bildschirm bis unter die Systemleisten, und ohne den Abstand
        // liegen X, Blitz und Umschalter auf der Uhr.
        Rundknopf(
            symbol = Icons.Default.Close,
            beschreibung = "Schließen",
            beiKlick = {
                if (aufnahmeLaeuft != null) {
                    aufnahmeLaeuft?.stop()
                    aufnahmeLaeuft = null
                }
                zurueckEinmal()
            },
            modifier = Modifier.align(Alignment.TopStart).statusBarsPadding().padding(12.dp),
        )

        // Blitz oben rechts — während einer laufenden Videoaufnahme gesperrt
        if (aufnahmeLaeuft == null && blitzNutzbar) {
            Box(Modifier.align(Alignment.TopEnd).statusBarsPadding().padding(12.dp)) {
                Box(
                    Modifier
                        .size(40.dp)
                        .clip(CircleShape)
                        .background(Color(0x8A06090E))
                        .clickable(onClickLabel = blitz.beschriftung) { blitz = blitz.naechster() },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        when (blitz) {
                            BlitzModus.AUS -> Icons.Default.FlashOff
                            BlitzModus.AUTOMATISCH -> Icons.Default.FlashAuto
                            BlitzModus.AN -> Icons.Default.FlashOn
                        },
                        contentDescription = blitz.beschriftung,
                        tint = if (blitz == BlitzModus.AUS) Tinte else Sonne,
                        modifier = Modifier.size(20.dp),
                    )
                }
            }
        }

        if (aufnahmeLaeuft != null) {
            Row(
                Modifier
                    .align(Alignment.TopCenter)
                    .statusBarsPadding()
                    .padding(top = 16.dp)
                    .background(Color(0xB306090E), CircleShape)
                    .padding(start = 12.dp, end = 15.dp, top = 7.dp, bottom = 7.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(Modifier.size(8.dp).clip(CircleShape).background(Alarm))
                Text("AUFNAHME", style = MaterialTheme.typography.labelSmall, color = Tinte)
            }
        }

        // Alle Bedienelemente unten am Daumen — die Reihenfolge ist die jeder
        // Kamera-App: Zoom, Betriebsart, Auslöser.
        Column(
            Modifier
                .align(Alignment.BottomCenter)
                .navigationBarsPadding()
                .padding(bottom = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // Zoom-Pille: feste Stufen zum Anspringen; beim Kneifen dazwischen
            // zeigt sie stattdessen den erreichten Wert.
            if (stufen.size > 1 && aufnahmeLaeuft == null) {
                val aktiv = aktiveStufe(stufen, zoom)
                Row(
                    Modifier
                        .background(Color(0x8A06090E), RoundedCornerShape(50))
                        .padding(horizontal = 5.dp, vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(3.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (aktiv == null) {
                        Text(
                            formatiereZoom(zoom),
                            color = Sonne,
                            style = MaterialTheme.typography.labelMedium,
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
                        )
                    } else {
                        stufen.forEachIndexed { index, stufe ->
                            val gewaehlt = index == aktiv
                            Text(
                                stufe.beschriftung,
                                color = if (gewaehlt) Sonne else Tinte,
                                style = MaterialTheme.typography.labelMedium,
                                modifier = Modifier
                                    .clip(CircleShape)
                                    .clickable { setzeZoom(stufe.ratio) }
                                    .background(if (gewaehlt) Color(0x26FFFFFF) else Color.Transparent)
                                    .padding(horizontal = 12.dp, vertical = 7.dp),
                            )
                        }
                    }
                }
                Spacer(Modifier.size(18.dp))
            }

            // Foto/Video als Wortpaar statt als Chips: Chips sehen nach Filter
            // aus, hier wird die Betriebsart gewechselt.
            if (aufnahmeLaeuft == null) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    AufnahmeModus.entries.forEach { eintrag ->
                        val gewaehlt = modus == eintrag
                        Text(
                            if (eintrag == AufnahmeModus.FOTO) "FOTO" else "VIDEO",
                            style = MaterialTheme.typography.labelSmall,
                            color = if (gewaehlt) Sonne else Tinte.copy(alpha = 0.65f),
                            modifier = Modifier
                                .clip(CircleShape)
                                .clickable { modus = eintrag }
                                .padding(horizontal = 14.dp, vertical = 8.dp),
                        )
                    }
                }
                Spacer(Modifier.size(14.dp))
            }

            Row(
                Modifier.fillMaxWidth().padding(horizontal = 32.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(Modifier.weight(1f))
                Ausloeser(
                    modus = modus,
                    speichert = speichert,
                    laeuftVideo = aufnahmeLaeuft != null,
                    beiKlick = {
                        val aufnahme = AufzeichnungsZustand.aktuell.value ?: return@Ausloeser
                        if (modus == AufnahmeModus.FOTO) {
                            if (speichert) return@Ausloeser
                            speichert = true
                            val (relativ, datei) = app.repository.neueMediumDatei(aufnahme.tourId, "jpg")
                            imageCapture.takePicture(
                                ImageCapture.OutputFileOptions.Builder(datei).build(),
                                ContextCompat.getMainExecutor(context),
                                object : ImageCapture.OnImageSavedCallback {
                                    override fun onImageSaved(ergebnis: ImageCapture.OutputFileResults) {
                                        app.appScope.launch {
                                            // Vor dem Registrieren physisch aufrecht drehen (EXIF → Pixel),
                                            // damit das Foto in Player UND Studio richtig herum erscheint.
                                            withContext(Dispatchers.IO) { richteFotoAuf(datei) }
                                            val anker = aufnahme.letzterPunkt?.let { it.lng to it.lat }
                                            app.repository.registriereFoto(aufnahme.tourId, relativ, System.currentTimeMillis(), anker)
                                            speichert = false
                                            zurueckEinmal()
                                        }
                                    }

                                    override fun onError(fehler: ImageCaptureException) {
                                        datei.delete()
                                        speichert = false
                                    }
                                },
                            )
                        } else if (aufnahmeLaeuft != null) {
                            // Stopp: Finalize registriert asynchron im App-Scope, wir gehen zurück
                            aufnahmeLaeuft?.stop()
                            aufnahmeLaeuft = null
                            zurueckEinmal()
                        } else {
                            // Start: Ton beim ersten Mal anfragen (danach startet der Launcher-Callback)
                            if (tonErlaubt) starteVideoAufnahme()
                            else audioLauncher.launch(Manifest.permission.RECORD_AUDIO)
                        }
                    },
                )
                Box(Modifier.weight(1f), contentAlignment = Alignment.CenterEnd) {
                    if (aufnahmeLaeuft == null) {
                        Rundknopf(
                            symbol = Icons.Default.Cameraswitch,
                            beschreibung = if (vorne) "Rückkamera" else "Frontkamera",
                            beiKlick = { vorne = !vorne },
                        )
                    }
                }
            }
        }
    }
}

/**
 * Der Auslöser — dieselbe Form wie der Aufnahme-Knopf der Hauptleiste.
 *
 * Vorher war es ein Standard-FAB: ein abgerundetes Rechteck mit Kamerasymbol.
 * In einer Vollbild-Kamera erwartet die Hand einen Kreis an dieser Stelle, und
 * ein Symbol darin sagt nichts, was die Lage nicht schon sagt.
 */
@Composable
private fun Ausloeser(
    modus: AufnahmeModus,
    speichert: Boolean,
    laeuftVideo: Boolean,
    beiKlick: () -> Unit,
) {
    val beschreibung = when {
        modus == AufnahmeModus.FOTO -> "Foto aufnehmen"
        laeuftVideo -> "Aufnahme stoppen"
        else -> "Video aufnehmen"
    }
    Box(
        Modifier
            .size(74.dp)
            .clip(CircleShape)
            .border(3.dp, Tinte.copy(alpha = 0.9f), CircleShape)
            .clickable(onClickLabel = beschreibung, onClick = beiKlick),
        contentAlignment = Alignment.Center,
    ) {
        when {
            speichert -> CircularProgressIndicator(Modifier.size(28.dp), color = Tinte, strokeWidth = 3.dp)
            // Laufendes Video: Quadrat im Ring — das Zeichen für „stoppen"
            laeuftVideo -> Box(
                Modifier.size(26.dp).clip(RoundedCornerShape(5.dp)).background(Alarm),
            )
            else -> Box(
                Modifier
                    .size(58.dp)
                    .clip(CircleShape)
                    .background(if (modus == AufnahmeModus.FOTO) Tinte else Alarm),
            )
        }
    }
}
