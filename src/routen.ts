/**
 * Der URL-Raum von Maptale — die eine Stelle, an der steht, welche Seite unter
 * welchem Pfad liegt.
 *
 * Vorher stand er vierfach parallel: in `vite.config.js` (Build-Eingänge), in
 * den `href`s von sechs HTML-Dateien, in [app-nav.ts](./app-nav.ts) und in
 * `server/src/routes/auth.ts` (Mail-Links). Genau die Sorte Liste, die in
 * diesem Projekt schon einmal auseinanderlief (die Fortbewegungs-`MODI`).
 *
 * **Kein Router.** Maptale sind drei bewusst getrennte statische Einstiege;
 * ein Server-Router hieße, jede Seite durch Node zu schicken, statt sie von
 * Nginx ausliefern zu lassen. Diese Tabelle definiert den URL-Raum, sie
 * bedient ihn nicht — Nginx (`deploy/cloudpanel-nginx.conf`) und die
 * Dev-Middleware in `vite.config.js` leiten sich aus ihr ab.
 *
 * **Ohne `.html`.** Die Endung ist ein Implementierungsdetail des Builds und
 * gehört nicht in eine URL, die jemand vorliest oder in einer Mail anklickt.
 * Die `…​.html`-Adressen antworten weiterhin — die Dateien liegen nun einmal im
 * Build —, aber das ist ein Nebeneffekt und keine Zusage: Nichts im Code zeigt
 * mehr dorthin. Solange Maptale nicht produktiv genutzt wird, ist ein Pfad noch
 * frei änderbar; sobald die ersten Touren geteilt sind, ist er es nicht mehr.
 *
 * **Mehrsprachigkeit.** Die Pfade sind deutsch, weil das Produkt deutsch ist;
 * englische Pfade wären der schlechteste Zwischenschritt (englische URL am
 * deutschen Produkt, und beim echten i18n bräuchte es trotzdem Sprachpräfixe).
 * Vorwärtskompatibel ist stattdessen, dass jede Seite einen SPRACHNEUTRALEN
 * Namen trägt und der Pfad nur dessen heutige Ausprägung ist: Aus
 * `pfad: '/anmelden'` wird dann `pfade: { de: '/anmelden', en: '/sign-in' }`
 * samt `/en/`-Präfix, ohne dass eine einzige Link-Stelle im Code sich ändert —
 * die rufen alle `pfad('anmelden')`. Die dann alten Pfade bleiben für immer
 * als Alias bestehen; Mail-Links sind in der Welt.
 */

/** Sprachneutraler Name einer Seite. Er, nicht der Pfad, steht im Code. */
export type Seite =
  | 'start'
  | 'player'
  | 'app'
  | 'anmelden'
  | 'registrieren'
  | 'galerie'
  | 'profil'
  | 'verwaltung'
  | 'impressum'
  | 'datenschutz'

export type Route = {
  /** Ausgelieferter Pfad, ohne Endung und ohne Schrägstrich am Ende. */
  readonly pfad: string
  /** Datei im Build, die unter diesem Pfad liegt. Mehrere Pfade dürfen dieselbe tragen. */
  readonly datei: string
}

/**
 * Drei Pfade zeigen auf `studio.html`, weil dieselbe Seite drei Dinge ist:
 * die Tür (`/anmelden`, `/registrieren`) und der Raum dahinter (`/app`).
 * Welche Ansicht gilt, entscheidet die Anmeldung, nicht der Server — die Seite
 * schreibt den Pfad beim Wechsel per `replaceState` nach (s. `studio.ts`).
 *
 * `/app` heißt nicht `/studio`: Ein Konto braucht auch, wer nur mit der App
 * aufzeichnet und nie etwas schneidet (die App verweist zum Registrieren
 * ausdrücklich auf die Website). „Studio" bleibt das Wort für den
 * Schneideraum in der Oberfläche, nicht für die Adresse der ganzen App.
 */
export const ROUTEN: Readonly<Record<Seite, Route>> = {
  start: { pfad: '/', datei: 'index.html' },
  player: { pfad: '/erlebnis', datei: 'erlebnis.html' },
  app: { pfad: '/app', datei: 'studio.html' },
  anmelden: { pfad: '/anmelden', datei: 'studio.html' },
  registrieren: { pfad: '/registrieren', datei: 'studio.html' },
  galerie: { pfad: '/galerie', datei: 'galerie.html' },
  profil: { pfad: '/profil', datei: 'profil.html' },
  verwaltung: { pfad: '/admin', datei: 'admin.html' },
  impressum: { pfad: '/impressum', datei: 'impressum.html' },
  datenschutz: { pfad: '/datenschutz', datei: 'datenschutz.html' },
}

/**
 * Link auf eine Seite. `anhang` trägt Query und/oder Fragment mit —
 * `pfad('player', '?tour=srv:t_1')`, `pfad('anmelden', '#verify=abc')`.
 */
export function pfad(seite: Seite, anhang = ''): string {
  return ROUTEN[seite].pfad + anhang
}

/**
 * Pfad → Datei für alles, was nicht schon von `try_files $uri.html` erschlagen
 * wird. Quelle für die Dev-Middleware; die drei Studio-Aliasse stehen als
 * `location =`-Blöcke im Nginx-Vhost.
 */
export const PFAD_ZU_DATEI: Readonly<Record<string, string>> = Object.fromEntries(
  Object.values(ROUTEN).map((r) => [r.pfad, r.datei]),
)

/**
 * Die Eingänge des Vite-Builds — jede Datei genau einmal, geschlüsselt nach
 * ihrem Namen ohne Endung. Kommt eine Seite dazu, landet sie von selbst im
 * `dist/`, ohne zweiten Eintrag in `vite.config.js`.
 */
export const EINSTIEGE: Readonly<Record<string, string>> = Object.fromEntries(
  [...new Set(Object.values(ROUTEN).map((r) => r.datei))].map((datei) => [
    datei.replace(/\.html$/, ''),
    datei,
  ]),
)
