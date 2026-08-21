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
import {
  findPlaceholders,
  renderMail,
  type RenderedMail,
  type LayoutContext,
  type MailParts,
} from './mail-layout.js'

export type TemplateKey =
  'verification' | 'reset' | 'email-change' | 'waitlist' | 'waitlist-invitation' | 'export'

export interface PlaceholderDescription {
  name: string
  /** Was der Platzhalter einsetzt — steht so in der Verwaltung. */
  description: string
  /** Beispielwert für Vorschau und Testmail. */
  example: string
}

export interface TemplateEntry {
  key: TemplateKey
  name: string
  /** Wann diese Mail rausgeht — die Frage, die man vor dem Bearbeiten hat. */
  occasion: string
  placeholders: PlaceholderDescription[]
  /**
   * Trägt der Knopf den Hauptlink? Dann muss `{{link}}` nicht im Text stehen.
   * Ohne Knopf wäre die Mail ohne den Platzhalter eine Sackgasse.
   */
  hasLink: boolean
  defaultContent: MailParts
}

const LINK_INFO = (what: string, example: string): PlaceholderDescription => ({
  name: 'link',
  description: `${what}, steckt im Knopf; im Text nur nötig, wenn du den Knopf leerst`,
  example,
})

/**
 * Der Katalog. Reihenfolge = Reihenfolge in der Verwaltung: erst die beiden
 * Mails an Konto-Inhaber, dann die beiden der Warteliste.
 */
export const TEMPLATES: readonly TemplateEntry[] = [
  {
    key: 'verification',
    name: 'E-Mail bestätigen',
    occasion:
      'Geht sofort nach der Registrierung raus. Ohne den Klick darf niemand Touren hochladen.',
    hasLink: true,
    placeholders: [
      {
        name: 'name',
        description: 'Name des Kontos (aus der Registrierung oder der Adresse abgeleitet)',
        example: 'Mira Wolf',
      },
      LINK_INFO('Bestätigungslink', 'https://maptale.io/anmelden#verify=beispiel'),
    ],
    defaultContent: {
      subject: 'Bestätige deine E-Mail-Adresse',
      title: 'Willkommen bei Maptale',
      text:
        'Hallo {{name}},\n\n' +
        'schön, dass du da bist. Ein Klick fehlt noch: Damit gehört die Adresse offiziell zu deinem Konto, ' +
        'und du kannst deine erste Tour hochladen.',
      button: 'E-Mail bestätigen',
      footer:
        'Der Link gilt 24 Stunden. Läuft er ab, lässt du dir im Studio einen neuen schicken.\n\n' +
        'Du hast dich nicht bei Maptale registriert? Dann ignoriere diese Nachricht. Ohne den Klick passiert nichts.',
    },
  },
  {
    key: 'reset',
    name: 'Passwort zurücksetzen',
    occasion: 'Geht raus, wenn jemand auf der Anmeldeseite „Passwort vergessen" wählt.',
    hasLink: true,
    placeholders: [
      {
        name: 'name',
        description: 'Name des Kontos, zu dem die Adresse gehört',
        example: 'Mira Wolf',
      },
      LINK_INFO('Link zum neuen Passwort', 'https://maptale.io/anmelden#reset=beispiel'),
    ],
    defaultContent: {
      subject: 'Passwort zurücksetzen',
      title: 'Neues Passwort setzen',
      text:
        'Hallo {{name}},\n\n' +
        'für dein Maptale-Konto wurde ein neues Passwort angefordert. Über den Knopf unten legst du es fest.',
      button: 'Passwort neu setzen',
      footer:
        'Der Link gilt 1 Stunde.\n\n' +
        'Warst du das nicht, ist nichts passiert: Dein bisheriges Passwort bleibt gültig, und ohne diesen Link ' +
        'lässt es sich nicht ändern.',
    },
  },
  {
    key: 'email-change',
    name: 'Neue E-Mail-Adresse bestätigen',
    occasion:
      'Geht an die NEUE Adresse, wenn jemand sie in den Kontoeinstellungen einträgt. Erst der Klick macht sie zur Anmeldeadresse, bis dahin gilt die alte weiter.',
    hasLink: true,
    placeholders: [
      { name: 'name', description: 'Name des Kontos', example: 'Mira Wolf' },
      LINK_INFO('Bestätigungslink', 'https://maptale.io/konto#email=beispiel'),
    ],
    defaultContent: {
      subject: 'Bestätige deine neue E-Mail-Adresse',
      title: 'Neue Adresse bestätigen',
      text:
        'Hallo {{name}},\n\n' +
        'du möchtest dich bei Maptale künftig mit dieser Adresse anmelden. Ein Klick macht sie gültig.',
      button: 'Adresse bestätigen',
      footer:
        'Der Link gilt 2 Stunden. Bis du ihn anklickst, bleibt deine bisherige Adresse in Kraft.\n\n' +
        'Du kennst Maptale nicht? Dann hat jemand deine Adresse falsch eingetippt. Ignoriere diese Nachricht: Ohne den Klick passiert nichts, und dein Postfach bekommt keine weitere Post von uns.',
    },
  },
  {
    key: 'waitlist',
    name: 'Warteliste: Platz bestätigen',
    occasion:
      'Geht raus, sobald sich jemand ohne Einladungscode einträgt. Erst der Klick macht daraus einen Platz in der Schlange (Double-Opt-in).',
    hasLink: true,
    placeholders: [
      LINK_INFO('Bestätigungslink', 'https://maptale.io/registrieren#warteliste=beispiel'),
    ],
    defaultContent: {
      subject: 'Bitte bestätige deinen Platz auf der Warteliste',
      title: 'Fast auf der Liste',
      text:
        'Hallo,\n\n' +
        'du möchtest Maptale ausprobieren, schön!\n\n' +
        'Maptale wächst gerade von Einladung zu Einladung. Bestätige mit einem Klick, dass wir dich vormerken dürfen.',
      button: 'Platz bestätigen',
      footer:
        'Sobald ein Platz frei wird, schicken wir dir einen Einladungscode an diese Adresse. Sonst bekommst du keine Post von uns.\n\n' +
        'Hast du dich nicht eingetragen, ignoriere diese Nachricht: Ohne den Klick wird deine Adresse nicht ' +
        'gespeichert und nach kurzer Zeit gelöscht.',
    },
  },
  {
    key: 'waitlist-invitation',
    name: 'Warteliste: Platz ist frei',
    occasion:
      'Geht raus, wenn du in der Warteliste auf „Einladen" drückst, mit dem frisch erzeugten Code.',
    hasLink: true,
    placeholders: [
      {
        name: 'code',
        description: 'Der Einladungscode. Steht er allein in einem Absatz, wird er hervorgehoben.',
        example: 'MAPT-4F7K',
      },
      LINK_INFO(
        'Registrierung mit eingetragenem Code',
        'https://maptale.io/registrieren#einladung=MAPT-4F7K',
      ),
      {
        name: 'leaveLink',
        description:
          'Weg aus der Warteliste, muss in der Mail stehen (Löschung ohne Umweg über uns)',
        example: 'https://maptale.io/registrieren#warteliste-austragen=beispiel',
      },
    ],
    defaultContent: {
      subject: 'Dein Platz ist frei',
      title: 'Es ist so weit',
      text:
        'Hallo,\n\n' +
        'du kannst dir jetzt ein Maptale-Konto anlegen. Dein Einladungscode:\n\n' +
        '{{code}}\n\n' +
        'Der Knopf trägt ihn schon ein. Abtippen musst du nichts.',
      button: 'Konto anlegen',
      footer:
        'Der Code gilt für eine Anmeldung.\n\n' +
        'Magst du doch nicht mehr? Dann trag dich hier aus, wir löschen deine Adresse sofort:\n\n' +
        '{{leaveLink}}',
    },
  },
  {
    key: 'export',
    name: 'Datenexport fertig',
    occasion:
      'Geht raus, sobald das angeforderte ZIP gebaut ist (Art. 20 DSGVO). ' +
      'Der Link gilt 48 Stunden, danach ist das Archiv gelöscht, nicht nur unerreichbar.',
    hasLink: true,
    placeholders: [
      { name: 'name', description: 'Name des Kontos', example: 'Mira Wolf' },
      LINK_INFO('Link zum Archiv', 'https://maptale.io/api/export/beispiel'),
      { name: 'size', description: 'Größe des Archivs, fertig formatiert', example: '1,4 GB' },
      { name: 'deadline', description: 'Wie lange der Link gilt', example: '48 Stunden' },
    ],
    defaultContent: {
      subject: 'Dein Datenexport ist fertig',
      title: 'Deine Daten liegen bereit',
      text:
        'Hallo {{name}},\n\n' +
        'dein Archiv ist gebaut: {{size}} mit allen Touren, Medien und Konto-Angaben. ' +
        'Über den Knopf unten lädst du es herunter.',
      button: 'Archiv herunterladen',
      footer:
        'Der Link gilt {{deadline}}. Danach wird das Archiv gelöscht; du kannst jederzeit ein neues anfordern.\n\n' +
        'Behandle den Link wie ein Passwort: Wer ihn hat, kann deine Daten herunterladen.',
    },
  },
]

const BY_KEY = new Map(TEMPLATES.map((v) => [v.key, v]))

export const isTemplateKey = (value: string): value is TemplateKey =>
  BY_KEY.has(value as TemplateKey)

export function getTemplate(key2: TemplateKey): TemplateEntry {
  const entry = BY_KEY.get(key2)
  if (!entry) throw new Error(`Unbekannte Mail-Vorlage: ${key2}`)
  return entry
}

/** Beispielbelegung für Vorschau und Testmail. */
export const exampleValues = (entry: TemplateEntry): Record<string, string> =>
  Object.fromEntries(entry.placeholders.map((p) => [p.name, p.example]))

/**
 * Was an einer bearbeiteten Vorlage nicht stimmt — leer heißt: geht raus.
 *
 * Die wichtigste Regel ist die letzte: Eine Mail, in der der einzige Link fehlt,
 * ist keine Geschmacksfrage, sondern eine Sackgasse für den Empfänger. Deshalb
 * lehnt der Server sie ab, statt sie zu verschicken.
 */
export function validateParts(entry: TemplateEntry, blocks2: MailParts): string[] {
  const issues: string[] = []
  if (!blocks2.subject.trim()) issues.push('Der Betreff darf nicht leer sein.')
  if (!blocks2.title.trim()) issues.push('Die Überschrift darf nicht leer sein.')
  if (!blocks2.text.trim()) issues.push('Der Text darf nicht leer sein.')

  const used = new Set([
    ...findPlaceholders(blocks2.subject),
    ...findPlaceholders(blocks2.title),
    ...findPlaceholders(blocks2.text),
    ...findPlaceholders(blocks2.footer),
  ])
  const known = new Set(entry.placeholders.map((p) => p.name))
  for (const name of used) {
    if (!known.has(name))
      issues.push(`{{${name}}} gibt es in dieser Mail nicht, es bliebe so stehen, wie es dasteht.`)
  }

  // Ein Platzhalter, der den einzigen Weg der Mail trägt, muss ankommen: `link`
  // über den Knopf ODER im Text, alle anderen im Text.
  for (const p of entry.placeholders) {
    if (used.has(p.name)) continue
    if (p.name === 'link' && entry.hasLink && blocks2.button.trim()) continue
    issues.push(
      p.name === 'link'
        ? 'Ohne Knopf muss {{link}} im Text stehen, sonst kommt der Empfänger nirgendwohin.'
        : `{{${p.name}}} fehlt, diese Angabe geht sonst verloren.`,
    )
  }
  return issues
}

/** Unterscheiden sich zwei Fassungen inhaltlich? Randleerraum zählt nicht. */
export const differs = (a: MailParts, b: MailParts): boolean =>
  (['subject', 'title', 'text', 'button', 'footer'] as const).some(
    (field) => a[field].trim() !== b[field].trim(),
  )

interface TemplateRow {
  key: string
  subject: string
  title: string
  body: string
  button: string
  footer: string
  updated_at: string
  updated_by: string | null
}

export interface MailTemplateStatus extends TemplateEntry {
  /** Was tatsächlich verschickt wird: die Anpassung, sonst der Standard. */
  blocks: MailParts
  customized: boolean
  updatedAt: string | null
  /** E-Mail der Person, die zuletzt angepasst hat; null, wenn das Konto weg ist. */
  updatedBy: string | null
}

export class MailTemplateService {
  constructor(private readonly db: Db) {}

  /** Die wirksamen Bausteine einer Vorlage — Anpassung, sonst Standard. */
  blocks2(key2: TemplateKey): MailParts {
    const row = this.db.prepare('SELECT * FROM mail_templates WHERE key = ?').get(key2) as
      TemplateRow | undefined
    if (!row) return getTemplate(key2).defaultContent
    return {
      subject: row.subject,
      title: row.title,
      text: row.body,
      button: row.button,
      footer: row.footer,
    }
  }

  /** Der ganze Katalog samt Anpassungsstand — die Liste in der Verwaltung. */
  all(): MailTemplateStatus[] {
    const rows = this.db
      .prepare(
        `SELECT v.*, u.email AS bearbeiter FROM mail_templates v
         LEFT JOIN users u ON u.id = v.updated_by`,
      )
      .all() as Array<TemplateRow & { editor: string | null }>
    const target = new Map(rows.map((z) => [z.key, z]))
    return TEMPLATES.map((entry) => {
      const z = target.get(entry.key)
      return {
        ...entry,
        blocks: z
          ? { subject: z.subject, title: z.title, text: z.body, button: z.button, footer: z.footer }
          : entry.defaultContent,
        customized: Boolean(z),
        updatedAt: z?.updated_at ?? null,
        updatedBy: z?.editor ?? null,
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
  set(key2: TemplateKey, blocks2: MailParts, userId: string | null): void {
    if (!differs(blocks2, getTemplate(key2).defaultContent)) {
      this.reset(key2)
      return
    }
    this.db
      .prepare(
        `INSERT INTO mail_templates (key, subject, title, body, button, footer, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           subject = excluded.subject, title = excluded.title, body = excluded.body,
           button = excluded.button, footer = excluded.footer,
           updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      )
      .run(
        key2,
        blocks2.subject.trim(),
        blocks2.title.trim(),
        blocks2.text.trim(),
        blocks2.button.trim(),
        blocks2.footer.trim(),
        new Date().toISOString(),
        userId,
      )
  }

  /** Zurück auf den Stand im Code; false, wenn nie etwas angepasst war. */
  reset(key2: TemplateKey): boolean {
    return this.db.prepare('DELETE FROM mail_templates WHERE key = ?').run(key2).changes > 0
  }

  /** Die fertige Mail — der eine Weg, auf dem System-Mails entstehen. */
  render(key2: TemplateKey, values: Record<string, string>, context: LayoutContext): RenderedMail {
    return renderMail(this.blocks2(key2), values, context)
  }
}
