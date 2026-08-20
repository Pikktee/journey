// Welche Bilder der Galerie gehören zu einer Tour? — die rechnenden Teile,
// ohne MediaStore, ohne Netz, ohne Compose.
//
// Der ganze Foto-Nachzug hängt an zwei Entscheidungen, und beide sind hier
// nachprüfbar: WELCHES Zeitfenster gilt, und WAS darin überhaupt in Frage
// kommt. Alles Übrige (die Abfrage, der Upload, die Meldung) ist Mechanik.
package app.maptale.galerie

/**
 * Wie weit über die Tour hinaus gesucht wird — auf jeder Seite. NULL.
 *
 * **Sie stand bis 2026-08-10 bei ZWEI STUNDEN, mit einer falschen Begründung:**
 * „EXIF trägt oft keine Zone, Tracks tragen UTC". Nur lesen wir gar kein EXIF,
 * sondern `MediaStore.DATE_TAKEN` — und das ist bereits normalisierte
 * UTC-Zeit, Android rechnet die Zone beim Auslösen heraus. Die Warnung galt
 * einer Datenquelle, die wir nicht benutzen.
 *
 * Was sie anrichtete: Zwei Touren desselben Vormittags bekamen DIESELBEN
 * dreizehn Fotos. Am Gerät gemeldet, an zwei Runden im Abstand von 1:43 min.
 *
 * **Warum jetzt gar keine und nicht bloß eine kleine.** Jede Toleranz > 0
 * greift in die Nachbartour hinein, sobald zwei Aufzeichnungen dicht
 * aufeinander folgen — bei fünf Minuten überlappten die Fenster des gemeldeten
 * Falls immer noch um acht. Man kann das nicht durch eine kleinere Zahl lösen,
 * nur durch eine kleinere Wahrscheinlichkeit; und ein Foto, das in zwei Touren
 * auftaucht, ist ein sichtbarer Fehler, während ein fehlendes bloß fehlt.
 *
 * Die Regel ist damit die, die man auch erwartet: **Ein Foto gehört zu der
 * Tour, die lief, als es entstand.** Der Preis ist das Bild vom Startpunkt,
 * kurz bevor man auf Aufnahme drückt — das lässt sich im Studio nachreichen,
 * und dort entscheidet ein Mensch statt einer Zahl.
 */
const val TOLERANZ_MS = 0L

/** Ein Bild der Galerie, so weit es für die Zuordnung zählt. */
data class Galeriebild(
    /** MediaStore-Kennung — sie identifiziert das Bild beim späteren Öffnen. */
    val id: Long,
    val dateiname: String,
    /** Aufnahmezeitpunkt in Millisekunden seit 1970 (UTC). */
    val takenAtMs: Long,
    /** GPS aus dem Bild, wenn vorhanden — schlägt die Zeit (s. `anker`). */
    val breite: Double? = null,
    val laenge: Double? = null,
    /** Ordner, in dem das Bild liegt (MediaStore-BUCKET_DISPLAY_NAME). */
    val ordner: String? = null,
    /**
     * Video statt Foto.
     *
     * Sie liegen in ZWEI Sammlungen (`MediaStore.Images` und
     * `MediaStore.Video`) und werden getrennt abgefragt — das Feld hält fest,
     * woher der Eintrag kam. Daran hängen drei Dinge, die sonst leise falsch
     * laufen: die Content-URI beim Öffnen, die erlaubten Endungen und der
     * `type` im Manifest. Ein Video als `photo` angemeldet lässt der Server mit
     * 400 abprallen, und weil das Nachreichen keine halben Stapel kennt,
     * scheiterte damit der ganze Nachzug einer Tour.
     */
    val istVideo: Boolean = false,
) {
    /**
     * Der GPS-Anker als [lng, lat] — die Reihenfolge des Manifests, nicht die
     * der Umgangssprache.
     *
     * **Fotos mit GPS schlagen die Zeit.** Hat das Bild eigene Koordinaten,
     * wird es dort verankert; die Zeit ist nur der Rückfall. Das ist bereits
     * die Logik des Manifests (`anchor` optional) — sie muss hier nur richtig
     * gefüttert werden.
     */
    val anker: Pair<Double, Double>?
        get() = if (breite != null && laenge != null) laenge to breite else null
}

/**
 * Ordner, aus denen NICHT genommen wird — auch dann nicht, wenn die Zeit passt.
 *
 * Der Zeitfenster-Scan erwischt sonst den Screenshot aus der Pause, das
 * Bild aus dem Familienchat und das fotografierte Ticket. Gesucht wird in
 * echten Kameraaufnahmen; alles andere ist Beifang, den niemand in seiner
 * Reise sehen will.
 *
 * Verglichen wird kleingeschrieben und auf ENTHALTEN — Hersteller hängen an
 * („Screenshots" vs. „Screenshot", „WhatsApp Images").
 */
private val GESPERRTE_ORDNER = listOf(
    "screenshot",
    "whatsapp",
    "telegram",
    "signal",
    "threema",
    "download",
    "instagram",
    "facebook",
    "snapchat",
    "messenger",
)

/**
 * Ordner, die als Kameraaufnahmen gelten.
 *
 * Positiv- UND Negativliste, weil beide für sich nicht reichen: Nur die
 * Positivliste verlöre die Bilder von Herstellern, die ihren Kamera-Ordner
 * anders nennen; nur die Negativliste ließe jede künftige Foto-App durch. Wer
 * hier trifft, ist dabei — wer in der Sperrliste steht, ist draußen — und der
 * Rest kommt nur bei einer ausdrücklichen Auswahl in Frage.
 */
private val KAMERA_ORDNER = listOf("camera", "dcim", "kamera", "100andro", "open camera")

/**
 * Endungen, die der Server als Foto annimmt (`ENDUNGEN` in `schema/upload.ts`).
 *
 * **Gefiltert wird HIER und nicht erst beim Hochladen**, weil das Nachreichen
 * keine halben Stapel kennt: Ein einziger Eintrag mit unbekannter Endung lässt
 * die ganze Anfrage mit 400 scheitern — und damit den kompletten Nachzug einer
 * Tour. Genau so ist er am Pixel 9 gestorben, das neben jedem Foto eine
 * RAW-Datei (`.dng`) ablegt.
 *
 * Nebenwirkung, die man sonst extra bauen müsste: Das RAW und sein JPEG sind
 * DASSELBE Bild. Ohne diesen Filter läge beides in der Tour.
 */
private val ERLAUBTE_ENDUNGEN = setOf("jpg", "jpeg", "png", "webp", "heic", "heif")

/**
 * Endungen, die der Server als VIDEO annimmt (`ENDUNGEN.video` in
 * `schema/upload.ts`).
 *
 * Eigene Liste und keine gemeinsame: Der Server prüft die Endung GEGEN den
 * angemeldeten `type`. Ein `.mp4` als `photo` gemeldet ist dort so falsch wie
 * ein `.jpg` als `video` — und weil das Nachreichen keine halben Stapel kennt,
 * risse ein einziger falscher Eintrag den ganzen Nachzug mit sich (genau so
 * starb er am Pixel 9 an einer `.dng`-Datei).
 */
private val ERLAUBTE_VIDEO_ENDUNGEN = setOf("mp4", "mov", "webm")

/**
 * Nimmt der Server diese Aufnahme überhaupt an?
 *
 * `heic`/`heif` sind seit v0.55.3 dabei — die Voreinstellung vieler Kameras.
 * Der Server löst sie beim Aufbereiten auf; gelöst wurde das dort und nicht
 * hier, weil es sonst nur Android repariert hätte: Das Studio nimmt dieselben
 * Dateien entgegen, und die spätere iOS-App bekäme das Problem ein zweites Mal.
 *
 * Videos werden an ihrer eigenen Liste gemessen — die Kamera legt neben einer
 * `.mp4` gern eine `.lrv` (Low-Resolution-Vorschau) oder `.thm` ab, und die
 * gehören so wenig in die Tour wie das RAW neben dem JPEG.
 */
fun endungErlaubt(dateiname: String, istVideo: Boolean = false): Boolean {
    val endung = dateiname.substringAfterLast('.', "").lowercase()
    return endung in (if (istVideo) ERLAUBTE_VIDEO_ENDUNGEN else ERLAUBTE_ENDUNGEN)
}

/** Ist das Bild eine echte Kameraaufnahme? */
fun istKamerabild(ordner: String?): Boolean {
    val name = ordner?.lowercase() ?: return false
    if (GESPERRTE_ORDNER.any { name.contains(it) }) return false
    return KAMERA_ORDNER.any { name.contains(it) }
}

/**
 * Das Suchfenster einer Tour in Millisekunden, samt Toleranz.
 *
 * Als eigene Funktion, weil dasselbe Fenster an zwei Stellen gebraucht wird:
 * für die MediaStore-Abfrage (die grob vorfiltert) und für die Zuordnung
 * danach. Zwei Rechnungen wären zwei Gelegenheiten, sie auseinanderlaufen zu
 * lassen.
 */
fun suchfenster(startMs: Long, endMs: Long): LongRange =
    (startMs - TOLERANZ_MS)..(endMs + TOLERANZ_MS)

/**
 * Die Bilder, die zu dieser Tour vorgeschlagen werden.
 *
 * @param bekannteZeitenMs Aufnahmezeitpunkte der Medien, die die Tour SCHON
 *   hat. Sie fallen heraus — sonst schlüge jeder zweite Lauf dieselben Fotos
 *   erneut vor, und wer einmal „nein" gesagt hat, bekäme die Frage bei jedem
 *   Öffnen wieder. Verglichen wird auf die Sekunde genau (nicht auf die
 *   Millisekunde): Der Server schreibt ISO-Zeitstempel, und die tragen keine.
 */
fun passendeBilder(
    bilder: List<Galeriebild>,
    startMs: Long,
    endMs: Long,
    bekannteZeitenMs: Set<Long> = emptySet(),
): List<Galeriebild> {
    val fenster = suchfenster(startMs, endMs)
    val bekannt = bekannteZeitenMs.map { it / 1000 }.toSet()
    return bilder
        .filter { it.takenAtMs in fenster }
        .filter { istKamerabild(it.ordner) }
        .filter { endungErlaubt(it.dateiname, it.istVideo) }
        .filterNot { it.takenAtMs / 1000 in bekannt }
        .sortedBy { it.takenAtMs }
}

/**
 * Der Satz, der die gefundenen Bilder meldet.
 *
 * Zwei Formen für zwei Lagen — sie sind nicht dasselbe: Ohne stehende
 * Einwilligung ist es eine FRAGE („hinzufügen?"), mit ihr eine MITTEILUNG über
 * etwas, das schon geschehen ist. Eine Frage über eine erledigte Sache liest
 * sich wie ein Fehler, eine Mitteilung über eine offene wie eine verpasste
 * Gelegenheit.
 */
fun nachzugSatz(anzahl: Int, automatisch: Boolean, videos: Int = 0): String? {
    if (anzahl <= 0) return null
    // Das Wort muss decken, was tatsächlich kommt: „3 Fotos hinzugefügt" über
    // zwei Bildern und einem Video ist schlicht falsch, und wer das Video
    // vermisst, sucht den Fehler beim Hochladen. Ein reiner Videofund heißt
    // beim Namen, ein gemischter „Aufnahmen".
    val wort = when {
        videos <= 0 -> if (anzahl == 1) "Foto" else "Fotos"
        videos == anzahl -> if (anzahl == 1) "Video" else "Videos"
        else -> "Aufnahmen"
    }
    return if (automatisch) "$anzahl $wort hinzugefügt" else "$anzahl $wort aus dieser Zeit gefunden — hinzufügen?"
}
