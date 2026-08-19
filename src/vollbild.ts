/**
 * Vollbild im mobilen Browser — angeboten, nie vorausgesetzt.
 *
 * Im Querformat frisst die Adressleiste des Browsers einen Streifen, der genau
 * dort fehlt, wo der Film ihn braucht. Die Fullscreen API nimmt sie weg; auf
 * Android samt Systemleiste.
 *
 * Vier Dinge, die man beim nächsten Anfassen leicht kippt:
 *
 * - **Es ist eine FÄHIGKEIT, kein Gerät.** Auf dem iPhone gab es Fullscreen
 *   jahrelang nur für `<video>` (unser Bild ist ein WebGL-Canvas, also nichts),
 *   seit Safari 26 auch für beliebige Elemente. `fullscreenEnabled` fragt genau
 *   das ab: altes iOS fällt still durch, neues bekommt Vollbild, und wir lesen
 *   nie einen User-Agent. In einem `iframe` ohne `allow="fullscreen"` steht dort
 *   ebenfalls `false` — auch das ist die richtige Antwort.
 * - **Nichts hängt am Erfolg.** Der Aufruf kann trotz Nutzergeste ablehnen, und
 *   eine unbehandelte Promise-Ablehnung risse den Start-Handler ab: Dann startet
 *   die Tour nicht, weil das Vollbild nicht klappte. Vollbild ist Komfort,
 *   Abspielen ist der Zweck.
 * - **Der Aufruf braucht eine Nutzergeste.** Beim Laden ruft ihn niemand
 *   erfolgreich; der Ort ist der Start-Knopf, an dem ohnehin getippt wird.
 * - **Können und Wollen sind zwei Fragen.** Der Schreibtisch KANN Vollbild und
 *   soll es trotzdem nicht bekommen (`vollbildErwuenscht`).
 * - **Die Viewport-Höhe muss mitgehen.** Der Wechsel ändert `innerHeight`, und
 *   daran hängt `--vh-app` (die Foto-Karte bemisst sich daran). `main.ts` hört
 *   deshalb zusätzlich auf `fullscreenchange`.
 */

/** Ältere Safari-Fassungen kennen die Namen nur mit `webkit`-Präfix. */
type WebkitElement = HTMLElement & { webkitRequestFullscreen?: () => unknown }
type WebkitDokument = Document & {
  webkitFullscreenEnabled?: boolean
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => unknown
}

const dok = () => document as WebkitDokument

/**
 * LOHNT sich Vollbild hier — unabhängig davon, ob es ginge?
 *
 * Am Schreibtisch nicht. Dort hat das Fenster die Größe, die jemand ihm gegeben
 * hat, und die Adressleiste kostet keinen nennenswerten Anteil daran; den Schirm
 * zu übernehmen ist dann eine Anmaßung, kein Dienst. Auf dem Telefon frisst die
 * Leiste im Querformat genau den Streifen, um den es geht, und ein Fenster gibt
 * es nicht.
 *
 * Gefragt wird auch das nach der FÄHIGKEIT und nie nach dem Gerät:
 * `(hover: none) and (pointer: coarse)` heißt „Finger und keine Maus". Ein
 * Notebook mit Berührungsbildschirm hat ein Trackpad und meldet `hover: hover` —
 * es fällt also heraus, und das ist richtig. Tablets fallen hinein, und auch das
 * ist richtig: Sie haben dieselbe Leiste und dasselbe fehlende Fenster.
 *
 * Nicht an der BREITE festgemacht: Ein schmales Browserfenster am Schreibtisch
 * ist kein Telefon, und ein Tablet quer ist breiter als mancher Laptop.
 */
export function vollbildErwuenscht(): boolean {
  return window.matchMedia?.('(hover: none) and (pointer: coarse)').matches ?? false
}

/** Kann dieses Dokument überhaupt ins Vollbild? */
export function vollbildMoeglich(): boolean {
  const d = dok()
  return Boolean(d.fullscreenEnabled ?? d.webkitFullscreenEnabled)
}

/** Steht gerade etwas im Vollbild? */
export function imVollbild(): boolean {
  const d = dok()
  return Boolean(d.fullscreenElement ?? d.webkitFullscreenElement)
}

/**
 * Ins Vollbild, wenn es geht. Muss aus einer Nutzergeste heraus laufen.
 * Schlägt es fehl, sieht die Seite aus wie zuvor — es gibt keine Meldung.
 */
export function betreteVollbild(): void {
  if (!vollbildMoeglich() || imVollbild()) return
  const el = document.documentElement as WebkitElement
  try {
    // Das Promise wird abgefangen, nicht ausgewertet: Ob es geklappt hat, sieht
    // man am Bild, und ein Fehlschlag ist kein Fall, den die Seite behandelt.
    const p = el.requestFullscreen ? el.requestFullscreen() : el.webkitRequestFullscreen?.()
    void Promise.resolve(p).catch(() => {})
  } catch {
    /* leer: siehe oben */
  }
}

/**
 * Zurück aus dem Vollbild. Beim Verlassen der Seite tun das die Browser von
 * selbst; der ausdrückliche Aufruf ist der Fall, in dem man im Dokument bleibt.
 */
export function verlasseVollbild(): void {
  if (!imVollbild()) return
  const d = dok()
  try {
    const p = d.exitFullscreen ? d.exitFullscreen() : d.webkitExitFullscreen?.()
    void Promise.resolve(p).catch(() => {})
  } catch {
    /* leer */
  }
}
