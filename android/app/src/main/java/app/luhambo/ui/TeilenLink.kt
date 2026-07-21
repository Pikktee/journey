// Wer die Tour sehen darf — und wie der Link dorthin aussieht.
//
// Reine Logik, damit die Sichtbarkeits-Stufen an einer Stelle stehen und der
// Link nicht in einem Composable zusammengeklebt wird.
package app.luhambo.ui

import app.luhambo.upload.Einstellungen

/**
 * Sichtbarkeit einer Tour. Die Reihenfolge ist die der Öffnung — sie bestimmt
 * auch, wie die Auswahl im Teilen-Blatt untereinandersteht.
 */
enum class Sichtbarkeit(val schluessel: String, val anzeige: String, val erklaerung: String) {
    PRIVAT("private", "Privat", "Nur du siehst diese Tour."),
    UNGELISTET("unlisted", "Über Link", "Jeder mit dem Link kann sie ansehen."),
    OEFFENTLICH("public", "Öffentlich", "Erscheint zusätzlich in der Galerie auf der Website."),
    ;

    companion object {
        fun vonSchluessel(s: String?): Sichtbarkeit =
            entries.firstOrNull { it.schluessel == s } ?: PRIVAT

        /**
         * Zur Wahl stehende Stufen.
         *
         * „Öffentlich" stand erst zur Wahl, als es die Galerie wirklich gab —
         * vorher wäre es ein Versprechen auf eine Seite gewesen, die niemand
         * aufrufen kann. Der Schalter bleibt, damit sich die Stufe im Notfall
         * wieder abschalten lässt (etwa wenn die Galerie zeitweise fehlt).
         */
        fun waehlbare(galerieVerfuegbar: Boolean): List<Sichtbarkeit> =
            if (galerieVerfuegbar) entries.toList() else listOf(PRIVAT, UNGELISTET)
    }
}

/** Gibt es die öffentliche Galerie? Seit /galerie.html steht: ja. */
const val GALERIE_VERFUEGBAR = true

/** Öffentlicher Link auf den Web-Player einer Tour. */
fun teilenLink(serverTourId: String, basis: String = Einstellungen.STANDARD_SERVER): String =
    "${basis.trimEnd('/')}/erlebnis.html?tour=srv:$serverTourId"
