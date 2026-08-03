// Transaktionaler Mail-Versand (M9) hinter einem schmalen Interface — genau wie
// Storage/Geocoder/Wetter/Video: die Routen kennen nur `MailVersand`, die
// konkrete Implementierung wird in index.ts (Prod) bzw. den Tests (Fake)
// hereingereicht. Damit sind die Registrierungs-/Reset-Flüsse ohne echten
// Mailserver testbar, und ein Anbieterwechsel zieht keine Ringe durch den Code.

export interface MailNachricht {
  an: string
  betreff: string
  text: string
}

export interface MailVersand {
  sende(nachricht: MailNachricht): Promise<void>
}

/** Baut Betreff + Text der beiden System-Mails an einer Stelle (DRY, testbar). */
export function baueVerifikationsMail(name: string, link: string): { betreff: string; text: string } {
  return {
    betreff: 'Maptale: Bitte bestätige deine E-Mail-Adresse',
    text:
      `Hallo ${name},\n\n` +
      `willkommen bei Maptale! Bitte bestätige deine E-Mail-Adresse über diesen Link:\n\n${link}\n\n` +
      `Der Link ist 24 Stunden gültig. Falls du dich nicht registriert hast, ignoriere diese Nachricht.\n\n` +
      `— Maptale`,
  }
}

export function baueResetMail(name: string, link: string): { betreff: string; text: string } {
  return {
    betreff: 'Maptale: Passwort zurücksetzen',
    text:
      `Hallo ${name},\n\n` +
      `du (oder jemand) hat ein neues Passwort für dein Maptale-Konto angefordert. ` +
      `Setze es über diesen Link neu:\n\n${link}\n\n` +
      `Der Link ist 1 Stunde gültig. Hast du das nicht angefordert, ist nichts passiert — ` +
      `dein aktuelles Passwort bleibt gültig.\n\n— Maptale`,
  }
}

/**
 * Warteliste, Schritt 1: der Bestätigungslink (Double-Opt-in).
 *
 * Ohne Anrede — wir kennen nur die Adresse, und ein aus ihr abgeleiteter Name
 * wäre hier eine Behauptung über jemanden, der noch gar kein Konto hat. Der
 * letzte Absatz ist der wichtigste: Wer nicht geklickt hat, steht auf keiner
 * Liste, also muss auch niemand widersprechen.
 */
export function baueWartelisteMail(link: string): { betreff: string; text: string } {
  return {
    betreff: 'Maptale: Bitte bestätige deinen Platz auf der Warteliste',
    text:
      `Hallo,\n\n` +
      `du möchtest Maptale ausprobieren — schön!\n\n` +
      `Maptale wächst gerade von Einladung zu Einladung. Bestätige über diesen Link, ` +
      `dass wir dich vormerken dürfen:\n\n${link}\n\n` +
      `Sobald ein Platz frei wird, schicken wir dir einen Einladungscode an diese Adresse. ` +
      `Sonst bekommst du keine Post von uns.\n\n` +
      `Hast du dich nicht eingetragen, ignoriere diese Nachricht einfach: Ohne den Klick ` +
      `wird deine Adresse nicht gespeichert und nach kurzer Zeit gelöscht.\n\n— Maptale`,
  }
}

/**
 * Warteliste, Schritt 2: der Platz ist frei.
 *
 * Der Austragen-Link steht mit in der Mail und nicht nur in der Bestätigung:
 * Zwischen beiden können Monate liegen, und wer die erste Mail gelöscht hat,
 * hätte sonst keinen Weg mehr aus der Liste heraus.
 */
export function baueWartelisteEinladungsMail(
  code: string,
  link: string,
  austragenLink: string,
): { betreff: string; text: string } {
  return {
    betreff: 'Maptale: Dein Platz ist frei',
    text:
      `Hallo,\n\n` +
      `es ist so weit — du kannst dir jetzt ein Maptale-Konto anlegen.\n\n` +
      `Dein Einladungscode: ${code}\n\n` +
      `Am schnellsten geht es über diesen Link, er trägt den Code schon ein:\n\n${link}\n\n` +
      `Der Code gilt für eine Anmeldung. Magst du doch nicht mehr? ` +
      `Dann trag dich hier aus, wir löschen deine Adresse sofort:\n\n${austragenLink}\n\n— Maptale`,
  }
}

/**
 * Dev-Versand: schreibt die Mail (inkl. Link) ins Log, statt sie zu verschicken.
 * So lässt sich der komplette Registrierungs-/Reset-Fluss lokal ohne Mailserver
 * durchspielen — der Bestätigungslink steht im Server-Terminal.
 */
export class KonsoleMail implements MailVersand {
  constructor(private readonly log: (zeile: string) => void = console.log) {}
  async sende(nachricht: MailNachricht): Promise<void> {
    this.log(`\n📧 Mail an ${nachricht.an}\n   Betreff: ${nachricht.betreff}\n   ${nachricht.text.replace(/\n/g, '\n   ')}\n`)
  }
}

/**
 * Produktions-Versand über die HTTP-API von Resend (resend.com, Free-Tier
 * genügt für die zu erwartenden Volumina). Bewusst per fetch — keine
 * Abhängigkeit, kein SMTP-Betrieb. Fällt der Versand aus, wirft `sende` und der
 * Aufrufer entscheidet (Registrierung schlägt dann sichtbar fehl).
 */
export class ResendMail implements MailVersand {
  constructor(
    private readonly apiKey: string,
    private readonly absender: string,
  ) {}

  async sende(nachricht: MailNachricht): Promise<void> {
    const antwort = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: this.absender, to: nachricht.an, subject: nachricht.betreff, text: nachricht.text }),
    })
    if (!antwort.ok) {
      throw new Error(`Mail-Versand fehlgeschlagen (${antwort.status}): ${await antwort.text()}`)
    }
  }
}
