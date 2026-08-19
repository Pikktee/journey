/**
 * WAS im Datenexport steckt — die Liste, nach der das ZIP gebaut wird.
 *
 * Getrennt von [export.ts](./export.ts) (Auftragsverwaltung, ZIP-Mechanik),
 * damit man diese Frage ohne Datenbank und ohne Dateisystem prüfen kann: Sie
 * ist die einzige, die sich mit jedem neuen Feld ändert.
 *
 * **Der Maßstab ist Art. 20 DSGVO, nicht „ein Backup".** Herausgegeben wird,
 * was die Person bereitgestellt hat oder was sie betrifft — in einem Format,
 * das ein anderes Programm lesen kann (JSON), nicht als Abzug unserer
 * Datenbank. Deshalb:
 *
 * - **Medien im Original-Layout der Tour** (`touren/<nr>-<titel>/media/…`).
 *   Ein Ordner je Tour mit sprechendem Namen — wer das ZIP öffnet, sucht seine
 *   Reise, nicht `t_9fK4mHx2QbVnRs`. Die Kennung steht trotzdem in der
 *   `tour.json` daneben, sonst wäre die Zuordnung verloren.
 * - **Kein Passwort-Hash, keine Sitzungen, keine Anmelde-Tokens.** Sie betreffen
 *   die Person nicht im Sinne der Auskunft, sondern sind Zugangsmittel; im
 *   Export wären sie nur ein zusätzlicher Ort, an dem sie liegen.
 * - **Push-Geräte dagegen schon** — und das ist kein Widerspruch zur Zeile
 *   darüber: Ein FCM-Registrierungs-Token öffnet nichts, er ist eine ADRESSE.
 *   Er ist zudem das eine Datum, das wir an Google weitergeben (Art. 15 Abs. 1
 *   lit. c) — wer wissen will, was dort über ihn liegt, braucht genau diesen
 *   Wert, um es zuzuordnen. Ihn wegzulassen machte die Auskunft an der Stelle
 *   unvollständig, an der sie am wenigsten selbstverständlich ist.
 * - **Die Newsletter-Historie gehört dazu** (Zeitpunkt, Zustand, Quelle): Sie
 *   ist der Nachweis, den wir über die Person führen — genau das, was Art. 15
 *   sichtbar machen will.
 */

/** Ein Konto, wie es im Export erscheint. */
export type KontoAngaben = {
  email: string
  name: string
  handle: string | null
  angelegtAm: string
  emailBestaetigt: boolean
  rolle: string
  profil: {
    anzeigename: string | null
    bio: string | null
    ort: string | null
    website: string | null
    instagram: string | null
    sichtbarkeit: string
    inSuchmaschinen: boolean
  }
  newsletter: {
    aktuell: boolean
    historie: Array<{ zeitpunkt: string; zustand: string; quelle: string; textfassung: string }>
  }
  /** Geräte, an die Push-Meldungen gehen (s. Kopf dieser Datei). */
  pushGeraete: Array<{
    plattform: string
    token: string
    angelegtAm: string
    zuletztGesehenAm: string
  }>
}

/** Eine Tour, wie sie im Export beschrieben wird. */
export type TourAngaben = {
  id: string
  nummer: number
  titel: string | null
  beschreibung: string | null
  sichtbarkeit: string
  status: string
  angelegtAm: string
  geaendertAm: string
  statistik: unknown
}

/**
 * Ordnername einer Tour im Archiv: `03-runde-bei-frankfurt`.
 *
 * Aus Nummer und Titel, nicht aus der Kennung — und die Nummer VORNE, damit
 * die Ordner in derselben Reihenfolge stehen wie in der Bibliothek. Was nicht
 * durch den Filter kommt (Umlaute werden übertragen, alles Übrige fällt weg),
 * ergibt zusammen mit der Nummer immer noch einen eindeutigen Namen: Zwei
 * Touren können denselben Titel haben, aber nie dieselbe Nummer.
 */
export function tourOrdner(nummer: number, titel: string | null): string {
  const wort = (titel ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  const nr = String(nummer).padStart(2, '0')
  return wort ? `${nr}-${wort}` : nr
}

/** Dateiendungen, die bereits komprimiert sind — sie gehen ungepackt ins ZIP. */
const SCHON_GEPACKT = /\.(jpe?g|png|webp|gif|mp4|mov|m4v|webm|mp3|m4a|aac|ogg|opus|zip)$/i

export const istGepackt = (name: string): boolean => SCHON_GEPACKT.test(name)

/**
 * Der Begleittext im Archiv.
 *
 * Ein ZIP mit 400 Dateien und ohne ein Wort dazu ist eine Zumutung — und die
 * Auskunft nach Art. 15 ist erst eine, wenn man versteht, was man da hat.
 */
export function liesmich(konto: KontoAngaben, touren: TourAngaben[], erstelltAm: string): string {
  return [
    'Maptale · Datenexport',
    '=====================',
    '',
    `Erstellt am: ${erstelltAm}`,
    `Konto: ${konto.email}`,
    `Touren: ${touren.length}`,
    '',
    'Was liegt hier?',
    '',
    '  konto.json          Deine Konto- und Profilangaben, dazu die Historie deiner',
    '                      Newsletter-Einwilligung (Zeitpunkt, Zustand, Herkunft).',
    '  touren.json         Alle Touren in einer Liste: Titel, Sichtbarkeit, Kennzahlen.',
    '  touren/<nr>-<titel>/',
    '    tour.json         Die fertige Tour, wie der Player sie abspielt: Strecke,',
    '                      Zeiten, Wetter, Foto-Stopps.',
    '    manifest.json     Was beim Hochladen ankam (Rohdaten der Aufzeichnung).',
    '    bearbeitung.json  Deine Änderungen im Studio, sofern du welche gemacht hast.',
    '    media/            Fotos, Videos, Poster und Klänge dieser Tour.',
    '',
    'Die Dateien sind JSON und lassen sich mit jedem Texteditor öffnen; Fotos und',
    'Videos liegen als gewöhnliche Dateien vor.',
    '',
    'Nicht enthalten sind Zugangsdaten (Passwort, Sitzungen, App-Tokens), sie sind',
    'Schlüssel, keine Auskunft, und gehören nicht in ein Archiv, das durch die Welt',
    'geht. Ebenso fehlen Daten, die wir gar nicht speichern.',
    '',
    'Fragen dazu: https://maptale.io/datenschutz',
    '',
  ].join('\n')
}
