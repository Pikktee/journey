// Welche Bilder der Galerie gehören zu einer Tour? — die rechnenden Teile,
// ohne MediaStore, ohne Netz, ohne Compose.
//
// Der ganze Foto-Nachzug hängt an zwei Entscheidungen, und beide sind hier
// nachprüfbar: WELCHES Zeitfenster gilt, und WAS darin überhaupt in Frage
// kommt. Alles Übrige (die Abfrage, der Upload, die Meldung) ist Mechanik.
package app.maptale.galerie

/**
 * Wie weit über die Tour hinaus gesucht wird — auf jeder Seite.
 *
 * **Das ist die Zeitzonen-Vorsorge, kein Großzügigkeitspuffer.** EXIF-Zeiten
 * tragen oft keine Zone (`DateTimeOriginal` ist lokale Kamerazeit), Tracks
 * tragen UTC. Wo Android den Versatz nicht kennt, liegt ein Bild um den
 * Zonen-Versatz daneben — bei einer Reise mit Zeitzonenwechsel um Stunden.
 * Zwei Stunden fangen den europäischen Alltagsfall (Sommerzeit, Nachbarzone)
 * und lassen die Entscheidung trotzdem beim Nutzer: Ein Vorschlag, der ein Bild
 * zu viel zeigt, ist ehrlicher als eine Automatik, die eines zu wenig findet.
 *
 * Wer das größer macht, holt die Fotos des Abendessens danach mit herein.
 */
const val TOLERANZ_MS = 2 * 60 * 60 * 1000L

/** Ein Bild der Galerie, so weit es für die Zuordnung zählt. */
data class Galeriebild(
    /** MediaStore-Kennung — sie identifiziert das Bild beim späteren Öffnen. */
    val id: Long,
    val dateiname: String,
    /** Aufnahmezeitpunkt in Millisekunden seit 1970 (UTC). */
    val aufgenommenMs: Long,
    /** GPS aus dem Bild, wenn vorhanden — schlägt die Zeit (s. `anker`). */
    val breite: Double? = null,
    val laenge: Double? = null,
    /** Ordner, in dem das Bild liegt (MediaStore-BUCKET_DISPLAY_NAME). */
    val ordner: String? = null,
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
fun suchfenster(startMs: Long, endeMs: Long): LongRange =
    (startMs - TOLERANZ_MS)..(endeMs + TOLERANZ_MS)

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
    endeMs: Long,
    bekannteZeitenMs: Set<Long> = emptySet(),
): List<Galeriebild> {
    val fenster = suchfenster(startMs, endeMs)
    val bekannt = bekannteZeitenMs.map { it / 1000 }.toSet()
    return bilder
        .filter { it.aufgenommenMs in fenster }
        .filter { istKamerabild(it.ordner) }
        .filterNot { it.aufgenommenMs / 1000 in bekannt }
        .sortedBy { it.aufgenommenMs }
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
fun nachzugSatz(anzahl: Int, automatisch: Boolean): String? = when {
    anzahl <= 0 -> null
    automatisch && anzahl == 1 -> "1 Foto hinzugefügt"
    automatisch -> "$anzahl Fotos hinzugefügt"
    anzahl == 1 -> "1 Foto aus dieser Zeit gefunden — hinzufügen?"
    else -> "$anzahl Fotos aus dieser Zeit gefunden — hinzufügen?"
}
