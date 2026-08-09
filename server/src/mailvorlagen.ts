// Die Texte der System-Mails — als Katalog im Code, mit optionaler
// Überschreibung in der Datenbank.
//
// **Der Standard bleibt im Code, die Datenbank hält nur Abweichungen.** So
// wandert eine bessere Formulierung mit dem nächsten Deploy zu allen, die nichts
// angepasst haben — und wer etwas angepasst hat, behält es. Das ist auch der
// Grund, warum „Zurücksetzen" ein DELETE ist und kein Zurückschreiben der
// Vorgabe: Nach dem Zurücksetzen hängt die Vorlage wieder am Code.
//
// Was der Betreiber ändern darf, sind die WORTE (Betreff, Überschrift, Absätze,
// Knopfbeschriftung, Kleingedrucktes) — nicht das Layout und nicht das HTML.
// Freies HTML hätte drei Preise: eine kaputte Mail wäre nur im Postfach
// sichtbar, jede Layout-Verbesserung ginge an angepassten Vorlagen vorbei, und
// ein Eingabefeld, aus dem HTML in eine Mail fließt, ist eine Einladung zum
// Missbrauch, sobald es je einen zweiten Admin gibt.

import type { Db } from './db.js'
import { findePlatzhalter, rendereMail, type GerenderteMail, type LayoutKontext, type MailBausteine } from './maillayout.js'

export type VorlagenSchluessel =
  | 'verifikation'
  | 'reset'
  | 'email-wechsel'
  | 'warteliste'
  | 'warteliste-einladung'
  | 'export'

export interface PlatzhalterInfo {
  name: string
  /** Was der Platzhalter einsetzt — steht so in der Verwaltung. */
  beschreibung: string
  /** Beispielwert für Vorschau und Testmail. */
  beispiel: string
}

export interface VorlagenEintrag {
  schluessel: VorlagenSchluessel
  name: string
  /** Wann diese Mail rausgeht — die Frage, die man vor dem Bearbeiten hat. */
  anlass: string
  platzhalter: PlatzhalterInfo[]
  /**
   * Trägt der Knopf den Hauptlink? Dann muss `{{link}}` nicht im Text stehen.
   * Ohne Knopf wäre die Mail ohne den Platzhalter eine Sackgasse.
   */
  hatLink: boolean
  standard: MailBausteine
}

const LINK_INFO = (was: string, beispiel: string): PlatzhalterInfo => ({
  name: 'link',
  beschreibung: `${was}, steckt im Knopf; im Text nur nötig, wenn du den Knopf leerst`,
  beispiel,
})

/**
 * Der Katalog. Reihenfolge = Reihenfolge in der Verwaltung: erst die beiden
 * Mails an Konto-Inhaber, dann die beiden der Warteliste.
 */
export const VORLAGEN: readonly VorlagenEintrag[] = [
  {
    schluessel: 'verifikation',
    name: 'E-Mail bestätigen',
    anlass: 'Geht sofort nach der Registrierung raus. Ohne den Klick darf niemand Touren hochladen.',
    hatLink: true,
    platzhalter: [
      { name: 'name', beschreibung: 'Name des Kontos (aus der Registrierung oder der Adresse abgeleitet)', beispiel: 'Mira Wolf' },
      LINK_INFO('Bestätigungslink', 'https://maptale.io/anmelden#verify=beispiel'),
    ],
    standard: {
      betreff: 'Bestätige deine E-Mail-Adresse',
      titel: 'Willkommen bei Maptale',
      text:
        'Hallo {{name}},\n\n' +
        'schön, dass du da bist. Ein Klick fehlt noch: Damit gehört die Adresse offiziell zu deinem Konto, ' +
        'und du kannst deine erste Tour hochladen.',
      knopf: 'E-Mail bestätigen',
      fuss:
        'Der Link gilt 24 Stunden. Läuft er ab, lässt du dir im Studio einen neuen schicken.\n\n' +
        'Du hast dich nicht bei Maptale registriert? Dann ignoriere diese Nachricht. Ohne den Klick passiert nichts.',
    },
  },
  {
    schluessel: 'reset',
    name: 'Passwort zurücksetzen',
    anlass: 'Geht raus, wenn jemand auf der Anmeldeseite „Passwort vergessen" wählt.',
    hatLink: true,
    platzhalter: [
      { name: 'name', beschreibung: 'Name des Kontos, zu dem die Adresse gehört', beispiel: 'Mira Wolf' },
      LINK_INFO('Link zum neuen Passwort', 'https://maptale.io/anmelden#reset=beispiel'),
    ],
    standard: {
      betreff: 'Passwort zurücksetzen',
      titel: 'Neues Passwort setzen',
      text:
        'Hallo {{name}},\n\n' +
        'für dein Maptale-Konto wurde ein neues Passwort angefordert. Über den Knopf unten legst du es fest.',
      knopf: 'Passwort neu setzen',
      fuss:
        'Der Link gilt 1 Stunde.\n\n' +
        'Warst du das nicht, ist nichts passiert: Dein bisheriges Passwort bleibt gültig, und ohne diesen Link ' +
        'lässt es sich nicht ändern.',
    },
  },
  {
    schluessel: 'email-wechsel',
    name: 'Neue E-Mail-Adresse bestätigen',
    anlass:
      'Geht an die NEUE Adresse, wenn jemand sie in den Kontoeinstellungen einträgt. Erst der Klick macht sie zur Anmeldeadresse, bis dahin gilt die alte weiter.',
    hatLink: true,
    platzhalter: [
      { name: 'name', beschreibung: 'Name des Kontos', beispiel: 'Mira Wolf' },
      LINK_INFO('Bestätigungslink', 'https://maptale.io/konto#email=beispiel'),
    ],
    standard: {
      betreff: 'Bestätige deine neue E-Mail-Adresse',
      titel: 'Neue Adresse bestätigen',
      text:
        'Hallo {{name}},\n\n' +
        'du möchtest dich bei Maptale künftig mit dieser Adresse anmelden. Ein Klick macht sie gültig.',
      knopf: 'Adresse bestätigen',
      fuss:
        'Der Link gilt 2 Stunden. Bis du ihn anklickst, bleibt deine bisherige Adresse in Kraft.\n\n' +
        'Du kennst Maptale nicht? Dann hat jemand deine Adresse falsch eingetippt. Ignoriere diese Nachricht: Ohne den Klick passiert nichts, und dein Postfach bekommt keine weitere Post von uns.',
    },
  },
  {
    schluessel: 'warteliste',
    name: 'Warteliste: Platz bestätigen',
    anlass:
      'Geht raus, sobald sich jemand ohne Einladungscode einträgt. Erst der Klick macht daraus einen Platz in der Schlange (Double-Opt-in).',
    hatLink: true,
    platzhalter: [LINK_INFO('Bestätigungslink', 'https://maptale.io/registrieren#warteliste=beispiel')],
    standard: {
      betreff: 'Bitte bestätige deinen Platz auf der Warteliste',
      titel: 'Fast auf der Liste',
      text:
        'Hallo,\n\n' +
        'du möchtest Maptale ausprobieren, schön!\n\n' +
        'Maptale wächst gerade von Einladung zu Einladung. Bestätige mit einem Klick, dass wir dich vormerken dürfen.',
      knopf: 'Platz bestätigen',
      fuss:
        'Sobald ein Platz frei wird, schicken wir dir einen Einladungscode an diese Adresse. Sonst bekommst du keine Post von uns.\n\n' +
        'Hast du dich nicht eingetragen, ignoriere diese Nachricht: Ohne den Klick wird deine Adresse nicht ' +
        'gespeichert und nach kurzer Zeit gelöscht.',
    },
  },
  {
    schluessel: 'warteliste-einladung',
    name: 'Warteliste: Platz ist frei',
    anlass: 'Geht raus, wenn du in der Warteliste auf „Einladen" drückst, mit dem frisch erzeugten Code.',
    hatLink: true,
    platzhalter: [
      { name: 'code', beschreibung: 'Der Einladungscode. Steht er allein in einem Absatz, wird er hervorgehoben.', beispiel: 'MAPT-4F7K' },
      LINK_INFO('Registrierung mit eingetragenem Code', 'https://maptale.io/registrieren#einladung=MAPT-4F7K'),
      {
        name: 'austragenLink',
        beschreibung: 'Weg aus der Warteliste, muss in der Mail stehen (Löschung ohne Umweg über uns)',
        beispiel: 'https://maptale.io/registrieren#warteliste-austragen=beispiel',
      },
    ],
    standard: {
      betreff: 'Dein Platz ist frei',
      titel: 'Es ist so weit',
      text:
        'Hallo,\n\n' +
        'du kannst dir jetzt ein Maptale-Konto anlegen. Dein Einladungscode:\n\n' +
        '{{code}}\n\n' +
        'Der Knopf trägt ihn schon ein. Abtippen musst du nichts.',
      knopf: 'Konto anlegen',
      fuss:
        'Der Code gilt für eine Anmeldung.\n\n' +
        'Magst du doch nicht mehr? Dann trag dich hier aus, wir löschen deine Adresse sofort:\n\n' +
        '{{austragenLink}}',
    },
  },
  {
    schluessel: 'export',
    name: 'Datenexport fertig',
    anlass:
      'Geht raus, sobald das angeforderte ZIP gebaut ist (Art. 20 DSGVO). ' +
      'Der Link gilt 48 Stunden, danach ist das Archiv gelöscht, nicht nur unerreichbar.',
    hatLink: true,
    platzhalter: [
      { name: 'name', beschreibung: 'Name des Kontos', beispiel: 'Mira Wolf' },
      LINK_INFO('Link zum Archiv', 'https://maptale.io/api/export/beispiel'),
      { name: 'groesse', beschreibung: 'Größe des Archivs, fertig formatiert', beispiel: '1,4 GB' },
      { name: 'frist', beschreibung: 'Wie lange der Link gilt', beispiel: '48 Stunden' },
    ],
    standard: {
      betreff: 'Dein Datenexport ist fertig',
      titel: 'Deine Daten liegen bereit',
      text:
        'Hallo {{name}},\n\n' +
        'dein Archiv ist gebaut: {{groesse}} mit allen Touren, Medien und Konto-Angaben. ' +
        'Über den Knopf unten lädst du es herunter.',
      knopf: 'Archiv herunterladen',
      fuss:
        'Der Link gilt {{frist}}. Danach wird das Archiv gelöscht; du kannst jederzeit ein neues anfordern.\n\n' +
        'Behandle den Link wie ein Passwort: Wer ihn hat, kann deine Daten herunterladen.',
    },
  },
]

const NACH_SCHLUESSEL = new Map(VORLAGEN.map((v) => [v.schluessel, v]))

export const istVorlagenSchluessel = (wert: string): wert is VorlagenSchluessel => NACH_SCHLUESSEL.has(wert as VorlagenSchluessel)

export function vorlage(schluessel: VorlagenSchluessel): VorlagenEintrag {
  const eintrag = NACH_SCHLUESSEL.get(schluessel)
  if (!eintrag) throw new Error(`Unbekannte Mail-Vorlage: ${schluessel}`)
  return eintrag
}

/** Beispielbelegung für Vorschau und Testmail. */
export const beispielWerte = (eintrag: VorlagenEintrag): Record<string, string> =>
  Object.fromEntries(eintrag.platzhalter.map((p) => [p.name, p.beispiel]))

/**
 * Was an einer bearbeiteten Vorlage nicht stimmt — leer heißt: geht raus.
 *
 * Die wichtigste Regel ist die letzte: Eine Mail, in der der einzige Link fehlt,
 * ist keine Geschmacksfrage, sondern eine Sackgasse für den Empfänger. Deshalb
 * lehnt der Server sie ab, statt sie zu verschicken.
 */
export function pruefeBausteine(eintrag: VorlagenEintrag, bausteine: MailBausteine): string[] {
  const probleme: string[] = []
  if (!bausteine.betreff.trim()) probleme.push('Der Betreff darf nicht leer sein.')
  if (!bausteine.titel.trim()) probleme.push('Die Überschrift darf nicht leer sein.')
  if (!bausteine.text.trim()) probleme.push('Der Text darf nicht leer sein.')

  const benutzt = new Set([
    ...findePlatzhalter(bausteine.betreff),
    ...findePlatzhalter(bausteine.titel),
    ...findePlatzhalter(bausteine.text),
    ...findePlatzhalter(bausteine.fuss),
  ])
  const bekannt = new Set(eintrag.platzhalter.map((p) => p.name))
  for (const name of benutzt) {
    if (!bekannt.has(name)) probleme.push(`{{${name}}} gibt es in dieser Mail nicht, es bliebe so stehen, wie es dasteht.`)
  }

  // Ein Platzhalter, der den einzigen Weg der Mail trägt, muss ankommen: `link`
  // über den Knopf ODER im Text, alle anderen im Text.
  for (const p of eintrag.platzhalter) {
    if (benutzt.has(p.name)) continue
    if (p.name === 'link' && eintrag.hatLink && bausteine.knopf.trim()) continue
    probleme.push(
      p.name === 'link'
        ? 'Ohne Knopf muss {{link}} im Text stehen, sonst kommt der Empfänger nirgendwohin.'
        : `{{${p.name}}} fehlt, diese Angabe geht sonst verloren.`,
    )
  }
  return probleme
}

/** Unterscheiden sich zwei Fassungen inhaltlich? Randleerraum zählt nicht. */
export const weichtAb = (a: MailBausteine, b: MailBausteine): boolean =>
  (['betreff', 'titel', 'text', 'knopf', 'fuss'] as const).some((feld) => a[feld].trim() !== b[feld].trim())

interface VorlagenZeile {
  schluessel: string
  betreff: string
  titel: string
  text: string
  knopf: string
  fuss: string
  geaendert_am: string
  geaendert_von: string | null
}

export interface VorlagenStand extends VorlagenEintrag {
  /** Was tatsächlich verschickt wird: die Anpassung, sonst der Standard. */
  bausteine: MailBausteine
  angepasst: boolean
  geaendertAm: string | null
  /** E-Mail der Person, die zuletzt angepasst hat; null, wenn das Konto weg ist. */
  geaendertVon: string | null
}

export class MailVorlagenDienst {
  constructor(private readonly db: Db) {}

  /** Die wirksamen Bausteine einer Vorlage — Anpassung, sonst Standard. */
  bausteine(schluessel: VorlagenSchluessel): MailBausteine {
    const zeile = this.db.prepare('SELECT * FROM mailvorlagen WHERE schluessel = ?').get(schluessel) as
      | VorlagenZeile
      | undefined
    if (!zeile) return vorlage(schluessel).standard
    return { betreff: zeile.betreff, titel: zeile.titel, text: zeile.text, knopf: zeile.knopf, fuss: zeile.fuss }
  }

  /** Der ganze Katalog samt Anpassungsstand — die Liste in der Verwaltung. */
  alle(): VorlagenStand[] {
    const zeilen = this.db
      .prepare(
        `SELECT v.*, u.email AS bearbeiter FROM mailvorlagen v
         LEFT JOIN users u ON u.id = v.geaendert_von`,
      )
      .all() as Array<VorlagenZeile & { bearbeiter: string | null }>
    const nach = new Map(zeilen.map((z) => [z.schluessel, z]))
    return VORLAGEN.map((eintrag) => {
      const z = nach.get(eintrag.schluessel)
      return {
        ...eintrag,
        bausteine: z
          ? { betreff: z.betreff, titel: z.titel, text: z.text, knopf: z.knopf, fuss: z.fuss }
          : eintrag.standard,
        angepasst: Boolean(z),
        geaendertAm: z?.geaendert_am ?? null,
        geaendertVon: z?.bearbeiter ?? null,
      }
    })
  }

  /**
   * Anpassung speichern — oder die Zeile löschen, wenn sie dem Standard
   * entspricht.
   *
   * Sonst trüge eine Vorlage das Etikett „Angepasst", ohne sich vom Code zu
   * unterscheiden: Wer sie von Hand auf den Auslieferungstext zurückschreibt,
   * hätte sie in Wahrheit vom Code ABGEHÄNGT — spätere Verbesserungen kämen
   * dort nie an.
   */
  setze(schluessel: VorlagenSchluessel, bausteine: MailBausteine, benutzerId: string | null): void {
    if (!weichtAb(bausteine, vorlage(schluessel).standard)) {
      this.setzeZurueck(schluessel)
      return
    }
    this.db
      .prepare(
        `INSERT INTO mailvorlagen (schluessel, betreff, titel, text, knopf, fuss, geaendert_am, geaendert_von)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(schluessel) DO UPDATE SET
           betreff = excluded.betreff, titel = excluded.titel, text = excluded.text,
           knopf = excluded.knopf, fuss = excluded.fuss,
           geaendert_am = excluded.geaendert_am, geaendert_von = excluded.geaendert_von`,
      )
      .run(
        schluessel,
        bausteine.betreff.trim(),
        bausteine.titel.trim(),
        bausteine.text.trim(),
        bausteine.knopf.trim(),
        bausteine.fuss.trim(),
        new Date().toISOString(),
        benutzerId,
      )
  }

  /** Zurück auf den Stand im Code; false, wenn nie etwas angepasst war. */
  setzeZurueck(schluessel: VorlagenSchluessel): boolean {
    return this.db.prepare('DELETE FROM mailvorlagen WHERE schluessel = ?').run(schluessel).changes > 0
  }

  /** Die fertige Mail — der eine Weg, auf dem System-Mails entstehen. */
  rendere(schluessel: VorlagenSchluessel, werte: Record<string, string>, kontext: LayoutKontext): GerenderteMail {
    return rendereMail(this.bausteine(schluessel), werte, kontext)
  }
}
