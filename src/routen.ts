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
  | 'konto'
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
  // Eigene Seite, nicht im Studio: Das Studio ist der Schneideraum, das hier
  // ist der Ordner mit den Papieren. Der Pfad heißt `/konto` und nicht
  // `/einstellungen` — es sind die Angaben zum KONTO, während „Einstellungen"
  // das Wort für Vorlieben ist, die es hier gar nicht gibt.
  konto: { pfad: '/konto', datei: 'konto.html' },
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
 * Die Adresse einer Person: `/@henrik`.
 *
 * Ein eigener Namensraum neben der Tabelle — nicht `/profil?id=…`. Warum das
 * `@` und warum im Pfad: [handle.ts](./handle.ts). Ausgeliefert wird dieselbe
 * `profil.html`; im Vhost steht dafür ein `location ~ ^/@`, im Dev die
 * Middleware in `vite.config.js`.
 *
 * Der Handle wird NICHT durch `encodeURIComponent` geschickt: Das machte aus
 * dem `@` ein `%40` und aus der Adresse eine, die niemand vorliest. Er kann es
 * auch nicht brauchen — erlaubt sind nur `a–z 0–9 . _ -` (`HANDLE_REGELN`).
 */
export function profilPfad(handle: string): string {
  return `/@${handle}`
}

/**
 * Die Adresse einer Tour: `/tour/t_9fK4mHx2QbVnRs`.
 *
 * Der zweite parametrisierte Namensraum neben `/@handle` — und aus demselben
 * Grund NICHT in `ROUTEN`: Die Tabelle führt feste Pfade, hier steht hinter
 * dem Präfix eine Kennung.
 *
 * **Warum kein `?tour=…` mehr.** Ein Query-Parameter ist kein Ort, sondern
 * eine Anweisung an eine Seite. Solange er das war, konnte eine Tour nie eine
 * eigene Vorschaukarte, keinen eigenen Titel und keinen Eintrag in der Sitemap
 * bekommen — das alles hängt an einer Adresse, die für sich steht. Der Pfad
 * ist die Vorbedingung dafür, dass der Server ihn später selbst beantwortet
 * und Titel, Beschreibung und Titelbild in den Kopf schreibt (Etappe 6 in
 * docs/architecture/konzept_profil_konto.md). Die Query-Form bleibt bedienbar —
 * sie kostet nichts und alte Installationen der Android-App bauen sie noch.
 *
 * **Warum die rohe ID und kein Slug.** Die Kennung einer aufgezeichneten Tour
 * ist absichtlich opak (14 Zeichen, ~2^80 — `server/src/ids.ts`): Genau ihre
 * Unerratbarkeit IST die Sichtbarkeitsstufe `unlisted`, „jeder mit dem Link,
 * sonst niemand". Ein sprechender Slug unter einem bekannten Handle wäre kein
 * Geheimnis mehr, und eine kurze laufende Nummer erst recht nicht (die `no`
 * der Tour ist ohnehin nur pro Besitzer eindeutig).
 *
 * **Warum kein `srv:` im Pfad.** Der Player kennt zwei Herkünfte: die
 * mitgelieferten Touren aus `src/tours.ts` (Schlüssel `kohphangan`) und die
 * aufgezeichneten vom Server. Im Query-Param unterschied sie ein Präfix; im
 * Pfad tut das die Kennung selbst, denn Server-IDs beginnen mit `t_`. Ein
 * `/tour/srv:t_…` wäre ein Doppelpräfix, das nur erklärt, wo etwas herkommt —
 * eine Auskunft, die niemanden angeht, der den Link anklickt. Damit die
 * Unterscheidung trägt, darf keine mitgelieferte Tour `t_` heißen; ein
 * Wächter in test/routen.test.ts prüft das.
 */
export function tourPfad(param: string): string {
  const kennung = param.startsWith('srv:') ? param.slice(4) : param
  // Anders als der Handle wird die Kennung kodiert: Sie kommt aus einer
  // Server-Antwort, nicht aus einer geprüften Zeichenmenge. Die echten IDs
  // (`t_…`, 54er-Alphabet) und die Schlüssel aus `tours.ts` gehen unverändert
  // durch — es kostet also nichts und fängt ab, was nicht hierher gehört.
  return `/tour/${encodeURIComponent(kennung)}`
}

/**
 * `/tour/t_9fK…` → `srv:t_9fK…`, `/tour/kohphangan` → `kohphangan`;
 * alles andere → null.
 *
 * Die Gegenrichtung zu `tourPfad`. Zurückgegeben wird die Form, die der Player
 * intern führt (mit `srv:`) — sie ist zugleich der Schlüssel seiner Merker
 * (`maptale:pos:<id>`), und ein Wechsel dort ließe jede gemerkte Position
 * verwaisen.
 */
export function tourAusPfad(pfadteil: string): string | null {
  const treffer = /^\/tour\/([^/?#]+)/.exec(pfadteil)
  if (!treffer?.[1]) return null
  const kennung = decodeURIComponent(treffer[1])
  return kennung.startsWith('t_') ? `srv:${kennung}` : kennung
}

/**
 * `/@henrik` → `henrik`; alles andere → null.
 *
 * Die Gegenrichtung zu `profilPfad`, für die Profilseite: Sie liegt unter zwei
 * Adressen (Handle im Pfad, ID in der Query) und muss wissen, unter welcher sie
 * gerade aufgerufen wurde.
 */
export function handleAusPfad(pfadteil: string): string | null {
  const treffer = /^\/@([^/?#]+)/.exec(pfadteil)
  return treffer?.[1] ? decodeURIComponent(treffer[1]) : null
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
