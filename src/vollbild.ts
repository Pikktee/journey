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
 * - **Die Viewport-Höhe muss mitgehen.** Der Wechsel ändert `innerHeight`, und
 *   daran hängt `--vh-app` (die Foto-Karte bemisst sich daran). `main.ts` hört
 *   deshalb zusätzlich auf `fullscreenchange`.
 */

/** Ältere Safari-Fassungen kennen die Namen nur mit `webkit`-Vorsatz. */
type WebkitElement = HTMLElement & { webkitRequestFullscreen?: () => unknown }
type WebkitDokument = Document & {
  webkitFullscreenEnabled?: boolean
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => unknown
}

const dok = () => document as WebkitDokument

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
