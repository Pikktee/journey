// Wer die Tour sehen darf — und wie der Link dorthin aussieht.
//
// Reine Logik, damit die Sichtbarkeits-Stufen an einer Stelle stehen und der
// Link nicht in einem Composable zusammengeklebt wird.
package app.maptale.ui

import app.maptale.upload.Settings

/**
 * Sichtbarkeit einer Tour. Die Reihenfolge ist die der Öffnung — sie bestimmt
 * auch, wie die Auswahl im Teilen-Blatt untereinandersteht.
 */
enum class Visibility(val key: String, val label: String, val explanation: String) {
    PRIVATE("private", "Privat", "Nur du siehst diese Tour."),
    UNLISTED("unlisted", "Über Link", "Jeder mit dem Link kann sie ansehen."),
    PUBLIC("public", "Öffentlich", "Erscheint zusätzlich in der Galerie auf der Website."),
    ;

    companion object {
        fun fromKey(s: String?): Visibility =
            entries.firstOrNull { it.key == s } ?: PRIVATE

        /**
         * Zur Wahl stehende Stufen.
         *
         * „Öffentlich" stand erst zur Wahl, als es die Galerie wirklich gab —
         * vorher wäre es ein Versprechen auf eine Seite gewesen, die niemand
         * aufrufen kann. Der Schalter bleibt, damit sich die Stufe im Notfall
         * wieder abschalten lässt (etwa wenn die Galerie zeitweise fehlt).
         */
        fun selectable(galerieVerfuegbar: Boolean): List<Visibility> =
            if (galerieVerfuegbar) entries.toList() else listOf(PRIVATE, UNLISTED)
    }
}

/** Gibt es die öffentliche Galerie? Seit /galerie steht: ja. */
const val GALLERY_AVAILABLE = true

/**
 * Öffentlicher Link auf den Web-Player einer Tour.
 *
 * Ohne `.html` — der URL-Raum steht in `src/routen.ts` im Repo, aufgelöst vom
 * Nginx-Vhost. Dieser Link wird verschickt und vorgelesen; die kurze Form ist
 * die einzige, die jemand zu sehen bekommt.
 *
 * Die Tour steht im PFAD, nicht in einer Query (`tourPfad` in routen.ts): Erst
 * dadurch ist sie eine Adresse, die für sich steht — mit eigener Vorschaukarte,
 * sobald der Server die Seite selbst beantwortet. Kein `srv:`-Präfix mehr; die
 * Server-Kennung trägt ihr `t_` selbst.
 */
fun shareLink(serverTourId: String, basis: String = Settings.STANDARD_SERVER): String =
    "${basis.trimEnd('/')}/tour/$serverTourId"
