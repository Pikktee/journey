// Kamera während der Aufzeichnung: Foto (CameraX ImageCapture) ODER Video
// (VideoCapture/Recorder, FHD) — umschaltbar, die Kamera bindet beim Wechsel neu
// (nicht jedes Gerät kann Preview + Image + Video gleichzeitig). Der Anker ist
// der letzte akzeptierte Trackpunkt (robuster als EXIF-GPS, Plan M3/M4); Dauer
// und Poster des Videos ermittelt das Backend beim Anreichern.
package app.luhambo.kamera

import android.Manifest
import android.content.pm.PackageManager
import android.view.ViewGroup
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
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
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import app.luhambo.LuhamboApp
import app.luhambo.aufzeichnung.AufzeichnungsZustand
import kotlinx.coroutines.launch

private enum class AufnahmeModus { FOTO, VIDEO }

@Composable
fun KameraScreen(zurueck: () -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val app = context.applicationContext as LuhamboApp

    var modus by remember { mutableStateOf(AufnahmeModus.FOTO) }
    var speichert by remember { mutableStateOf(false) } // Foto wird gerade abgelegt
    var aufnahmeLaeuft by remember { mutableStateOf<Recording?>(null) } // laufende Videoaufnahme
    var vorschau by remember { mutableStateOf<PreviewView?>(null) }
    var provider by remember { mutableStateOf<ProcessCameraProvider?>(null) }
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

    // Kamera (neu) binden, sobald Vorschau + Provider stehen oder der Modus wechselt
    LaunchedEffect(modus, provider, vorschau) {
        val p = provider ?: return@LaunchedEffect
        val view = vorschau ?: return@LaunchedEffect
        val preview = Preview.Builder().build().also { it.surfaceProvider = view.surfaceProvider }
        p.unbindAll()
        p.bindToLifecycle(
            lifecycleOwner,
            CameraSelector.DEFAULT_BACK_CAMERA,
            preview,
            if (modus == AufnahmeModus.FOTO) imageCapture else videoCapture,
        )
    }

    Box(Modifier.fillMaxSize()) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
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

        // Schließen: läuft eine Aufnahme, erst sauber stoppen (Finalize registriert
        // sie asynchron), dann zurück — sonst direkt zurück.
        IconButton(
            onClick = {
                if (aufnahmeLaeuft != null) {
                    aufnahmeLaeuft?.stop()
                    aufnahmeLaeuft = null
                }
                zurueckEinmal()
            },
            modifier = Modifier.align(Alignment.TopStart).padding(12.dp),
        ) {
            Icon(Icons.Default.Close, contentDescription = "Schließen")
        }

        // Foto/Video-Umschalter (während einer laufenden Aufnahme gesperrt)
        if (aufnahmeLaeuft == null) {
            Row(
                Modifier.align(Alignment.TopCenter).padding(top = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                FilterChip(
                    selected = modus == AufnahmeModus.FOTO,
                    onClick = { modus = AufnahmeModus.FOTO },
                    label = { Text("Foto") },
                )
                FilterChip(
                    selected = modus == AufnahmeModus.VIDEO,
                    onClick = { modus = AufnahmeModus.VIDEO },
                    label = { Text("Video") },
                )
            }
        } else {
            Text(
                "● Aufnahme läuft",
                color = Color(0xFFE5484D),
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.align(Alignment.TopCenter).padding(top = 20.dp),
            )
        }

        FloatingActionButton(
            onClick = {
                val aufnahme = AufzeichnungsZustand.aktuell.value ?: return@FloatingActionButton
                if (modus == AufnahmeModus.FOTO) {
                    if (speichert) return@FloatingActionButton
                    speichert = true
                    val (relativ, datei) = app.repository.neueMediumDatei(aufnahme.tourId, "jpg")
                    imageCapture.takePicture(
                        ImageCapture.OutputFileOptions.Builder(datei).build(),
                        ContextCompat.getMainExecutor(context),
                        object : ImageCapture.OnImageSavedCallback {
                            override fun onImageSaved(ergebnis: ImageCapture.OutputFileResults) {
                                app.appScope.launch {
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
            modifier = Modifier.align(Alignment.BottomCenter).padding(32.dp).size(72.dp),
        ) {
            when {
                speichert -> CircularProgressIndicator(Modifier.size(28.dp))
                modus == AufnahmeModus.FOTO -> Icon(Icons.Default.PhotoCamera, contentDescription = "Foto aufnehmen")
                aufnahmeLaeuft != null -> Icon(Icons.Default.Stop, contentDescription = "Aufnahme stoppen")
                else -> Icon(Icons.Default.Videocam, contentDescription = "Video aufnehmen")
            }
        }
    }
}
