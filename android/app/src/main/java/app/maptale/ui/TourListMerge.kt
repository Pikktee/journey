// Eine Liste statt zweier. Bisher standen „Auf diesem Gerät" und „Deine Touren"
// getrennt untereinander — eine Trennung, die den Nutzer den Upload-Zustand
// verwalten ließ, obwohl der ihn nicht interessiert. Seit die App automatisch
// hochlädt, ist der Ort einer Tour eine Durchgangsstation, kein Ordner.
//
// Reine Logik über den beiden Quellen (Room + Serverliste), damit die Regeln
// prüfbar sind: welche Darstellung bei einer Tour gewinnt, die es doppelt gibt.
package app.maptale.ui

import app.maptale.data.TourEntity
import app.maptale.data.TourStatus
import app.maptale.upload.ServerTour

/** Ein Eintrag der verschmolzenen Liste. */
sealed interface TourEntry {
    val key: String

    /** Auf dem Gerät: läuft, wartet auf den Upload oder ist dabei fehlgeschlagen. */
    data class Local(val tour: TourEntity) : TourEntry {
        override val key get() = tour.id
    }

    /** Beim Server angekommen — auch im Studio erstellte Touren landen hier. */
    data class Server(val tour: ServerTour) : TourEntry {
        override val key get() = tour.id
    }
}

/**
 * Lokale Entwürfe und Serverliste zu EINER zeitlich absteigenden Liste
 * verbinden.
 *
 * Die Doppelung entsteht früh: der Upload-Worker vermerkt die Server-ID, sobald
 * das Manifest angelegt ist — ab dann kennt der Server die Tour, während sie
 * lokal noch Medien hochlädt. Wer dann gewinnt, entscheidet, was der Nutzer
 * sieht:
 *
 * - Noch nicht fertig hochgeladen → die LOKALE Darstellung, denn nur sie kennt
 *   Fortschritt und Fehler.
 * - Fertig hochgeladen → die SERVER-Darstellung, denn nur sie kennt Titelbild,
 *   Kilometer und Verarbeitungsstand.
 *
 * Eine laufende Aufnahme steht immer oben: sie ist das, was gerade passiert.
 */
fun mergeTours(lokale: List<TourEntity>, vomServer: List<ServerTour>): List<TourEntry> {
    val uploaded = lokale
        .filter { it.status == TourStatus.UPLOADED }
        .mapNotNull { it.serverId }
        .toSet()
    // Server-Einträge, die lokal noch in Arbeit sind, werden unterdrückt
    val localInProgress = lokale
        .filter { it.status != TourStatus.UPLOADED }
        .mapNotNull { it.serverId }
        .toSet()

    val entries = mutableListOf<Pair<Long, TourEntry>>()
    for (tour in lokale) {
        if (tour.serverId != null && tour.serverId in uploaded) continue
        entries += tour.startMs to TourEntry.Local(tour)
    }
    for (tour in vomServer) {
        if (tour.id in localInProgress) continue
        entries += timestamp(tour.createdAt) to TourEntry.Server(tour)
    }

    return entries
        .sortedWith(compareByDescending<Pair<Long, TourEntry>> { running(it.second) }.thenByDescending { it.first })
        .map { it.second }
}

private fun running(entry: TourEntry): Boolean =
    entry is TourEntry.Local && entry.tour.status == TourStatus.RECORDING

/**
 * ISO-Zeitstempel des Servers zu Millisekunden. Ein unlesbarer Wert darf die
 * Sortierung nicht kippen — die Tour landet dann hinten statt irgendwo.
 */
internal fun timestamp(iso: String): Long =
    runCatching { java.time.Instant.parse(iso).toEpochMilli() }.getOrDefault(0L)
