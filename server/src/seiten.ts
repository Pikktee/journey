/**
 * Seiten, die der Server selbst beantwortet — mit einem Kopf, der zur
 * aufgerufenen Adresse passt.
 *
 * **Warum überhaupt.** Maptale sind statische Seiten hinter Nginx, und das
 * bleibt so. Nur eine Sorte Information kann eine statische Seite nicht
 * tragen: die, die pro Adresse verschieden ist. Ein `/@henrik` und ein
 * `/@anna` bekamen bisher dieselbe `profil.html` — also denselben Titel,
 * dieselbe (fehlende) Vorschaukarte und dasselbe pauschale `noindex`. Wer den
 * Link in einen Chat legte, bekam eine nackte URL; wer sein Profil auffindbar
 * machen wollte, konnte es nicht.
 *
 * Verworfen, damit es nicht wiederkommt:
 *
 * | Weg | Warum nicht |
 * | --- | --- |
 * | `noindex` per JavaScript entfernen | Google verarbeitet das `noindex` im initialen HTML, BEVOR es JavaScript rendert. Die Seite fliegt raus, ehe der Code läuft |
 * | `X-Robots-Tag` im Vhost | Nginx weiß nicht, ob DIESE Person indexiert werden will — es gäbe nur einen Schalter für alle |
 * | Je Profil eine statische Datei schreiben | Cache-Invalidierung und ein Schreibpfad für einen Gewinn, der erst bei Zehntausenden Profilen zählt |
 *
 * **Woher das HTML kommt.** Nicht aus dem Image: Die Bundle-Namen tragen
 * Hashes, ein mitkopiertes `profil.html` wäre nach dem nächsten Web-Deploy eine
 * Seite, die auf gelöschte Assets zeigt. Stattdessen holt der Container die
 * fertige Datei zur Laufzeit über denselben Nginx, der sie auch dem Browser
 * ausliefert (`konfig.webUrl`), und hält sie ein paar Minuten im Speicher —
 * ein Abruf pro Cache-Periode, keine Kopplung an den Build, kein zusätzlicher
 * Deploy-Schritt.
 *
 * **Was ersetzt wird.** Nur der Block zwischen zwei Markern (`MARKE_AUF` /
 * `MARKE_ZU`). Der Rest der Seite bleibt Byte für Byte, wie der Build sie
 * geschrieben hat — insbesondere die gehashten Asset-Verweise, die niemand
 * hier kennen muss. Fehlt der Marker (alte Datei, kaputter Build), wird die
 * Seite unverändert durchgereicht: schlechter Kopf ist besser als keine Seite.
 */
import type { Konfig } from './config.js'

/** Anfang und Ende des Blocks, den der Server ersetzt. Stehen so im HTML. */
export const MARKE_AUF = '<!-- maptale:meta -->'
export const MARKE_ZU = '<!-- /maptale:meta -->'

/** Wie lange eine geholte Seite im Speicher gilt. */
const FRISCHE_MS = 5 * 60 * 1000

/**
 * Was in den Kopf geschrieben wird. Alles optional außer Titel und `robots` —
 * eine Seite ohne Titel gibt es nicht, und „darf das in den Index?" ist die
 * Frage, wegen der das hier überhaupt existiert.
 */
export type Metablock = {
  titel: string
  robots: 'index' | 'noindex'
  beschreibung?: string | null
  /** Absolute Adresse dieser Seite — `canonical` und `og:url`. */
  url?: string | null
  /** Absolute Adresse des Vorschaubilds. */
  bild?: string | null
  bildAlt?: string | null
  ogTyp?: 'website' | 'profile' | 'article'
}

/**
 * HTML-Text so entschärfen, dass er in einem Attribut stehen darf.
 *
 * Die Werte kommen aus der Datenbank, also von Menschen: Ein Anzeigename
 * `Anna " /><script>` würde sonst aus dem Attribut ausbrechen. Escaped wird
 * auch `'`, weil nicht garantiert ist, in welcher Anführungsart ein Wert
 * landet, und `&` zuerst, sonst würde es die eigenen Ersetzungen zerlegen.
 */
export function alsAttribut(wert: string): string {
  return wert
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Text auf eine Länge bringen, die als Beschreibung taugt.
 *
 * Abgeschnitten wird an der letzten Wortgrenze, nicht mitten im Wort — und
 * Zeilenumbrüche werden zu Leerzeichen, weil eine Bio mehrzeilig sein darf,
 * ein `meta`-Attribut aber nicht.
 */
export function alsBeschreibung(roh: string | null | undefined, maxLaenge = 200): string | null {
  const text = roh?.replace(/\s+/g, ' ').trim()
  if (!text) return null
  if (text.length <= maxLaenge) return text
  const knapp = text.slice(0, maxLaenge)
  const luecke = knapp.lastIndexOf(' ')
  return `${(luecke > maxLaenge * 0.6 ? knapp.slice(0, luecke) : knapp).trimEnd()}…`
}

/** Aus einem Metablock die Zeilen bauen, die zwischen den Markern stehen. */
export function baueMeta(meta: Metablock): string {
  const zeilen: string[] = [
    `<title>${alsAttribut(meta.titel)}</title>`,
    `<meta name="robots" content="${meta.robots}" />`,
  ]
  if (meta.beschreibung) {
    const b = alsAttribut(meta.beschreibung)
    zeilen.push(`<meta name="description" content="${b}" />`)
    zeilen.push(`<meta property="og:description" content="${b}" />`)
  }
  // `canonical` sagt, unter welcher Adresse diese Seite zu Hause ist — nötig,
  // weil dieselbe Person auch unter `/profil?id=…` erreichbar ist und beides
  // sonst als zwei Seiten mit gleichem Inhalt gälte.
  if (meta.url) {
    zeilen.push(`<link rel="canonical" href="${alsAttribut(meta.url)}" />`)
    zeilen.push(`<meta property="og:url" content="${alsAttribut(meta.url)}" />`)
  }
  zeilen.push(`<meta property="og:type" content="${meta.ogTyp ?? 'website'}" />`)
  zeilen.push('<meta property="og:site_name" content="Maptale" />')
  zeilen.push('<meta property="og:locale" content="de_DE" />')
  zeilen.push(`<meta property="og:title" content="${alsAttribut(meta.titel)}" />`)
  if (meta.bild) {
    zeilen.push(`<meta property="og:image" content="${alsAttribut(meta.bild)}" />`)
    if (meta.bildAlt) zeilen.push(`<meta property="og:image:alt" content="${alsAttribut(meta.bildAlt)}" />`)
    zeilen.push('<meta name="twitter:card" content="summary_large_image" />')
  }
  return zeilen.join('\n  ')
}

/** Den Marker-Block in einer gebauten Seite durch den eigenen Kopf ersetzen. */
export function setzeMeta(html: string, meta: Metablock): string {
  const von = html.indexOf(MARKE_AUF)
  const bis = html.indexOf(MARKE_ZU)
  // Ohne Marker unverändert durchreichen: Eine Seite mit dem Standardkopf ist
  // brauchbar, eine Ausnahme an dieser Stelle wäre eine weiße Seite.
  if (von === -1 || bis === -1 || bis < von) return html
  return html.slice(0, von + MARKE_AUF.length) + '\n  ' + baueMeta(meta) + '\n  ' + html.slice(bis)
}

/**
 * Holt gebaute HTML-Seiten und hält sie kurz im Speicher.
 *
 * Der Zwischenspeicher ist absichtlich dumm: Ablauf nach Zeit, kein Horchen auf
 * Deploys. Nach einem Web-Deploy zeigt die Seite also bis zu `FRISCHE_MS` lang
 * die vorige Fassung — für einen Meta-Kopf und eine Handvoll Skript-Verweise
 * ist das folgenlos, und die Alternative wäre ein Signalweg vom Deploy in den
 * Container, den es nur dafür gäbe.
 *
 * Schlägt der Abruf fehl, wird die letzte bekannte Fassung weiterbenutzt, egal
 * wie alt sie ist: Ein kurzer Nginx-Aussetzer soll nicht jede Profilseite
 * mitreißen.
 */
export class SeitenQuelle {
  private readonly gespeichert = new Map<string, { html: string; bis: number }>()
  private readonly laufend = new Map<string, Promise<string>>()

  constructor(
    private readonly konfig: Pick<Konfig, 'webUrl'>,
    private readonly hole: (url: string) => Promise<string> = standardAbruf,
    private readonly jetzt: () => number = Date.now,
  ) {}

  /** `'profil.html'` → der Inhalt der gebauten Datei. */
  async seite(datei: string): Promise<string> {
    const stand = this.gespeichert.get(datei)
    if (stand && stand.bis > this.jetzt()) return stand.html
    // Mehrere gleichzeitige Anfragen teilen sich EINEN Abruf — sonst schickt
    // ein Ansturm nach Cache-Ablauf ebenso viele Anfragen an Nginx zurück.
    const laufend = this.laufend.get(datei)
    if (laufend) return laufend
    const versuch = this.hole(`${this.konfig.webUrl.replace(/\/+$/, '')}/${datei}`)
      .then((html) => {
        this.gespeichert.set(datei, { html, bis: this.jetzt() + FRISCHE_MS })
        return html
      })
      .catch((fehler) => {
        if (stand) return stand.html
        throw fehler
      })
      .finally(() => this.laufend.delete(datei))
    this.laufend.set(datei, versuch)
    return versuch
  }
}

async function standardAbruf(url: string): Promise<string> {
  const antwort = await fetch(url, { headers: { accept: 'text/html' } })
  if (!antwort.ok) throw new Error(`${url} antwortete ${antwort.status}`)
  return antwort.text()
}
