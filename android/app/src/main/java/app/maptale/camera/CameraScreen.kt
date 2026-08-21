// Kamera während der Aufzeichnung: Foto (CameraX ImageCapture) ODER Video
// (VideoCapture/Recorder, FHD) — umschaltbar, die Kamera bindet beim Wechsel neu
// (nicht jedes Gerät kann Preview + Image + Video gleichzeitig). Der Anker ist
// der letzte akzeptierte Trackpunkt (robuster als EXIF-GPS, Plan M3/M4); Dauer
// und Poster des Videos ermittelt das Backend beim Anreichern.
//
// Preview und VideoCapture entstehen PRO BINDUNG, nicht einmal beim Start: ob
// stabilisiert werden darf, hängt am Objektiv und gilt nach einem Kamerawechsel
// neu, und beides ist nur im Builder setzbar (s. Stabilization.kt). Die
// Aufnahme-Rotation liegt deshalb als Zustand vor und wird jeder frischen
// Instanz mitgegeben — sonst stünde sie zwischen Bindung und der nächsten
// Sensormeldung auf dem Standardwert und das Video käme gedreht heraus.
//
// Bedienung wie in einer gewohnten Kamera-App: Kneifen zoomt stufenlos, die
// Pille springt auf feste Stufen, ein Tippen setzt Fokus und Belichtung. Alles,
// was die Hand bedient — Zoom, Foto/Video, Auslöser, Kamerawechsel — liegt
// unten; oben stehen nur Schließen und Blitz. Nach dem Auslösen schließt der
// Screen — an einem Punkt der Strecke entsteht in aller Regel EIN Foto.
package app.maptale.camera

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
import app.maptale.MaptaleApp
import app.maptale.recording.RecordingState
import app.maptale.ui.Danger
import app.maptale.ui.RoundButton
import app.maptale.ui.Sun
import app.maptale.ui.Ink
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private enum class CaptureMode { PHOTO, VIDEO }

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
fun CameraScreen(back: () -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val app = context.applicationContext as MaptaleApp
    val dichte = LocalDensity.current

    var captureMode by remember { mutableStateOf(CaptureMode.PHOTO) }
    var speichert by remember { mutableStateOf(false) } // Foto wird gerade abgelegt
    var aufnahmeLaeuft by remember { mutableStateOf<Recording?>(null) } // laufende Videoaufnahme
    var preview by remember { mutableStateOf<PreviewView?>(null) }
    var provider by remember { mutableStateOf<ProcessCameraProvider?>(null) }
    var camera by remember { mutableStateOf<Camera?>(null) }
    // Steht nur im Video-Modus, weil es dort gebunden wird — im Foto-Modus ist es null.
    var videoCapture by remember { mutableStateOf<VideoCapture<Recorder>?>(null) }
    // Aufnahme-Rotation: Zustand statt Feld, weil die Video-Instanz pro Bindung wechselt.
    var rotation by remember { mutableStateOf(Surface.ROTATION_0) }
    var frontCamera by remember { mutableStateOf(false) }
    var blitz by remember { mutableStateOf(BlitzModus.AUS) }
    // Zoom-Grenzen und -Stand kommen vom gebundenen Objektiv; beim Kamerawechsel
    // gelten andere, deshalb hängen sie am Kamera-Handle und nicht am Screen.
    var zoomMin by remember { mutableStateOf(1f) }
    var zoomMax by remember { mutableStateOf(1f) }
    var zoom by remember { mutableStateOf(1f) }
    var focusPoint by remember { mutableStateOf<Offset?>(null) }
    // Ton ist Opt-in: withAudioEnabled() wirft ohne RECORD_AUDIO, also nur mit Erlaubnis
    var tonErlaubt by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
                PackageManager.PERMISSION_GRANTED,
        )
    }
    // Genau einmal zurück navigieren: der X-Knopf und der asynchrone Foto-Callback
    // dürfen nicht beide popBackStack aufrufen (sonst überspringt es einen Screen).
    var done by remember { mutableStateOf(false) }
    val backOnce = { if (!done) { done = true; back() } }

    val imageCapture = remember { ImageCapture.Builder().setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY).build() }

    // Der Blitz sitzt an der Rückseite — vorne gibt es keinen, also gilt dort „aus".
    val flashUsable = captureMode == CaptureMode.PHOTO && !frontCamera
    LaunchedEffect(blitz, flashUsable) {
        imageCapture.flashMode = if (flashUsable) blitz.ausCameraX else ImageCapture.FLASH_MODE_OFF
    }

    // Geräteausrichtung nachführen: die Compose-UI ist nicht rotationsgebunden,
    // also muss die Aufnahme-Rotation aktiv gesetzt werden, sonst schreibt CameraX
    // die EXIF-Orientation nur für die beim Binden gültige Displaylage korrekt.
    DisposableEffect(Unit) {
        val lauscher = object : OrientationEventListener(context) {
            override fun onOrientationChanged(grad: Int) {
                if (grad == OrientationEventListener.ORIENTATION_UNKNOWN) return
                rotation = when {
                    grad >= 315 || grad < 45 -> Surface.ROTATION_0
                    grad < 135 -> Surface.ROTATION_270
                    grad < 225 -> Surface.ROTATION_180
                    else -> Surface.ROTATION_90
                }
            }
        }
        if (lauscher.canDetectOrientation()) lauscher.enable()
        onDispose { lauscher.disable() }
    }

    // Die Rotation an den STEHENDEN Instanzen nachziehen. Beim Bauen bekommt sie
    // jede Instanz schon über ihren Builder mit; dieser Effekt deckt das Drehen
    // danach ab, solange dieselbe Instanz gebunden bleibt.
    LaunchedEffect(rotation, videoCapture) {
        imageCapture.targetRotation = rotation
        videoCapture?.targetRotation = rotation
    }

    // Video im App-Speicher ablegen und im App-Scope registrieren — das Finalize
    // kommt asynchron NACH dem Stopp, muss also den Screen-Wechsel überleben.
    fun starteVideoAufnahme() {
        val activeRecording = RecordingState.current.value ?: return
        // Steht erst nach der Bindung im Video-Modus — bis dahin gibt es nichts aufzunehmen.
        val recorder = videoCapture ?: return
        val (relative, file) = app.repository.newMediumFile(activeRecording.tourId, "mp4")
        var pending = recorder.output.prepareRecording(context, FileOutputOptions.Builder(file).build())
        if (tonErlaubt) pending = pending.withAudioEnabled()
        aufnahmeLaeuft = pending.start(ContextCompat.getMainExecutor(context)) { ereignis ->
            if (ereignis is VideoRecordEvent.Finalize) {
                if (ereignis.hasError()) {
                    file.delete()
                } else {
                    val anchor = activeRecording.lastPoint?.let { it.lng to it.lat }
                    app.appScope.launch {
                        app.repository.registerVideo(activeRecording.tourId, relative, System.currentTimeMillis(), anchor)
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
    LaunchedEffect(captureMode, provider, preview, frontCamera) {
        val p = provider ?: return@LaunchedEffect
        val view = preview ?: return@LaunchedEffect
        val selector = if (frontCamera) CameraSelector.DEFAULT_FRONT_CAMERA else CameraSelector.DEFAULT_BACK_CAMERA

        // Erst fragen, dann einschalten: ungeprüft gesetzt quittiert die HAL die
        // Stabilisierung mit einem Fehler, sie wird nicht still übergangen. Im
        // Foto-Modus bleibt das Kamera-Handle bewusst null und es wird gar nicht
        // gefragt — die Video-Fähigkeit liest Camcorder-Profile, und dieser
        // Effekt läuft auf dem Hauptthread bei JEDEM Öffnen der Kamera.
        val fuerVideo = captureMode == CaptureMode.VIDEO
        val info = if (fuerVideo) runCatching { p.getCameraInfo(selector) }.getOrNull() else null
        val stabil = chooseStabilization(
            fuerVideo = fuerVideo,
            vorschauMoeglich = info != null && Preview.getPreviewCapabilities(info).isStabilizationSupported(),
            videoMoeglich = info != null && Recorder.getVideoCapabilities(info).isStabilizationSupported(),
        )

        val preview = Preview.Builder()
            .apply { if (stabil == Stabilization.PREVIEW) setPreviewStabilizationEnabled(true) }
            .build()
            .also { it.surfaceProvider = view.surfaceProvider }

        val recorder = if (!fuerVideo) {
            videoCapture = null
            imageCapture
        } else {
            // FHD bevorzugt, notfalls die nächstniedrige verfügbare Qualität
            val recorder = Recorder.Builder()
                .setQualitySelector(QualitySelector.from(Quality.FHD, FallbackStrategy.lowerQualityOrHigherThan(Quality.SD)))
                .build()
            VideoCapture.Builder(recorder)
                .setTargetRotation(rotation)
                .apply { if (stabil == Stabilization.VIDEO_ONLY) setVideoStabilizationEnabled(true) }
                .build()
                .also { videoCapture = it }
        }

        p.unbindAll()
        val gebunden = p.bindToLifecycle(lifecycleOwner, selector, preview, recorder)
        camera = gebunden
        // Der Zoom-Stand gehört zum Objektiv: nach dem Wechsel gelten die Grenzen
        // der neuen Kamera, ein übernommener Wert wäre schlicht falsch.
        val stand = gebunden.cameraInfo.zoomState.value
        zoomMin = stand?.minZoomRatio ?: 1f
        zoomMax = stand?.maxZoomRatio ?: 1f
        zoom = stand?.zoomRatio ?: 1f
        focusPoint = null
    }

    fun setZoom(next: Float) {
        val geklemmt = next.coerceIn(zoomMin, zoomMax)
        camera?.cameraControl?.setZoomRatio(geklemmt)
        zoom = geklemmt
    }

    // Fokus-Ring wieder ausblenden (CameraX beendet die Messung selbst nach 3 s)
    LaunchedEffect(focusPoint) {
        if (focusPoint != null) {
            delay(FOKUS_RING_MS)
            focusPoint = null
        }
    }

    val stufen = remember(zoomMin, zoomMax) { zoomLevels(zoomMin, zoomMax) }

    Box(Modifier.fillMaxSize()) {
        AndroidView(
            modifier = Modifier
                .fillMaxSize()
                // Kneifen zoomt stufenlos, Tippen fokussiert. Beide Gesten liegen
                // über der Vorschau, weil die PreviewView selbst keine annimmt.
                .pointerInput(camera, zoomMin, zoomMax) {
                    detectTransformGestures { _, _, faktor, _ ->
                        if (faktor != 1f) setZoom(zoom * faktor)
                    }
                }
                .pointerInput(camera) {
                    detectTapGestures { spot ->
                        val view = preview ?: return@detectTapGestures
                        val point = view.meteringPointFactory.createPoint(spot.x, spot.y)
                        camera?.cameraControl?.startFocusAndMetering(
                            FocusMeteringAction.Builder(point, FocusMeteringAction.FLAG_AF or FocusMeteringAction.FLAG_AE)
                                .setAutoCancelDuration(3, java.util.concurrent.TimeUnit.SECONDS)
                                .build(),
                        )
                        focusPoint = spot
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
                preview = view
                view
            },
        )

        // Fokus-Ring an der getippten Stelle
        focusPoint?.let { spot ->
            val ringSize = 72.dp
            val halb = with(dichte) { ringSize.toPx() / 2 }
            Box(
                Modifier
                    .offset { IntOffset((spot.x - halb).toInt(), (spot.y - halb).toInt()) }
                    .size(ringSize)
                    .border(2.dp, Color.White, CircleShape),
            )
        }

        // Schließen: läuft eine Aufnahme, erst sauber stoppen (Finalize registriert
        // sie asynchron), dann zurück — sonst direkt zurück.
        //
        // statusBarsPadding ist hier Pflicht, nicht Feinschliff: Die Vorschau
        // füllt den Bildschirm bis unter die Systemleisten, und ohne den Abstand
        // liegen X, Blitz und Umschalter auf der Uhr.
        RoundButton(
            symbol = Icons.Default.Close,
            description = "Schließen",
            onClick = {
                if (aufnahmeLaeuft != null) {
                    aufnahmeLaeuft?.stop()
                    aufnahmeLaeuft = null
                }
                backOnce()
            },
            modifier = Modifier.align(Alignment.TopStart).statusBarsPadding().padding(12.dp),
        )

        // Blitz oben rechts — während einer laufenden Videoaufnahme gesperrt
        if (aufnahmeLaeuft == null && flashUsable) {
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
                        tint = if (blitz == BlitzModus.AUS) Ink else Sun,
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
                Box(Modifier.size(8.dp).clip(CircleShape).background(Danger))
                Text("AUFNAHME", style = MaterialTheme.typography.labelSmall, color = Ink)
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
                val aktiv = activeLevel(stufen, zoom)
                Row(
                    Modifier
                        .background(Color(0x8A06090E), RoundedCornerShape(50))
                        .padding(horizontal = 5.dp, vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(3.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (aktiv == null) {
                        Text(
                            formatZoom(zoom),
                            color = Sun,
                            style = MaterialTheme.typography.labelMedium,
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
                        )
                    } else {
                        stufen.forEachIndexed { index, stufe ->
                            val gewaehlt = index == aktiv
                            Text(
                                stufe.beschriftung,
                                color = if (gewaehlt) Sun else Ink,
                                style = MaterialTheme.typography.labelMedium,
                                modifier = Modifier
                                    .clip(CircleShape)
                                    .clickable { setZoom(stufe.ratio) }
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
            //
            // Der halbdunkle Grund ist derselbe wie an der Zoom-Pille und aus
            // demselben Grund da: Die Wörter liegen auf dem LIVE-Bild, und über
            // einer hellen Wand oder Himmel stand hier heller Text auf hellem
            // Motiv. Das nicht gewählte Wort trug zusätzlich nur 65 % Deckkraft
            // und verschwand dann ganz. Gedämpft wird es weiterhin, aber gegen
            // den eigenen Grund und nicht gegen ein Bild, das niemand kennt.
            if (aufnahmeLaeuft == null) {
                Row(
                    Modifier
                        .background(Color(0x8A06090E), RoundedCornerShape(50))
                        .padding(horizontal = 5.dp, vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    CaptureMode.entries.forEach { entry ->
                        val gewaehlt = captureMode == entry
                        Text(
                            if (entry == CaptureMode.PHOTO) "FOTO" else "VIDEO",
                            style = MaterialTheme.typography.labelSmall,
                            color = if (gewaehlt) Sun else Ink,
                            modifier = Modifier
                                .clip(CircleShape)
                                .clickable { captureMode = entry }
                                .background(if (gewaehlt) Color(0x26FFFFFF) else Color.Transparent)
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
                    captureMode = captureMode,
                    speichert = speichert,
                    laeuftVideo = aufnahmeLaeuft != null,
                    onClick = {
                        val activeRecording = RecordingState.current.value ?: return@Ausloeser
                        if (captureMode == CaptureMode.PHOTO) {
                            if (speichert) return@Ausloeser
                            speichert = true
                            val (relative, file) = app.repository.newMediumFile(activeRecording.tourId, "jpg")
                            imageCapture.takePicture(
                                ImageCapture.OutputFileOptions.Builder(file).build(),
                                ContextCompat.getMainExecutor(context),
                                object : ImageCapture.OnImageSavedCallback {
                                    override fun onImageSaved(ergebnis: ImageCapture.OutputFileResults) {
                                        app.appScope.launch {
                                            // Vor dem Registrieren aufrecht drehen (EXIF → Pixel) und auf
                                            // Uploadgröße bringen — danach ist die Datei das, was hochgeht.
                                            withContext(Dispatchers.IO) { preparePhotoForUpload(file) }
                                            val anchor = activeRecording.lastPoint?.let { it.lng to it.lat }
                                            app.repository.registerPhoto(activeRecording.tourId, relative, System.currentTimeMillis(), anchor)
                                            speichert = false
                                            backOnce()
                                        }
                                    }

                                    override fun onError(error: ImageCaptureException) {
                                        file.delete()
                                        speichert = false
                                    }
                                },
                            )
                        } else if (aufnahmeLaeuft != null) {
                            // Stopp: Finalize registriert asynchron im App-Scope, wir gehen zurück
                            aufnahmeLaeuft?.stop()
                            aufnahmeLaeuft = null
                            backOnce()
                        } else {
                            // Start: Ton beim ersten Mal anfragen (danach startet der Launcher-Callback)
                            if (tonErlaubt) starteVideoAufnahme()
                            else audioLauncher.launch(Manifest.permission.RECORD_AUDIO)
                        }
                    },
                )
                Box(Modifier.weight(1f), contentAlignment = Alignment.CenterEnd) {
                    if (aufnahmeLaeuft == null) {
                        RoundButton(
                            symbol = Icons.Default.Cameraswitch,
                            description = if (frontCamera) "Rückkamera" else "Frontkamera",
                            onClick = { frontCamera = !frontCamera },
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
    captureMode: CaptureMode,
    speichert: Boolean,
    laeuftVideo: Boolean,
    onClick: () -> Unit,
) {
    val description = when {
        captureMode == CaptureMode.PHOTO -> "Foto aufnehmen"
        laeuftVideo -> "Aufnahme stoppen"
        else -> "Video aufnehmen"
    }
    Box(
        Modifier
            .size(74.dp)
            .clip(CircleShape)
            .border(3.dp, Ink.copy(alpha = 0.9f), CircleShape)
            .clickable(onClickLabel = description, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        when {
            speichert -> CircularProgressIndicator(Modifier.size(28.dp), color = Ink, strokeWidth = 3.dp)
            // Laufendes Video: Quadrat im Ring — das Zeichen für „stoppen"
            laeuftVideo -> Box(
                Modifier.size(26.dp).clip(RoundedCornerShape(5.dp)).background(Danger),
            )
            else -> Box(
                Modifier
                    .size(58.dp)
                    .clip(CircleShape)
                    .background(if (captureMode == CaptureMode.PHOTO) Ink else Danger),
            )
        }
    }
}
