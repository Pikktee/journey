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
    betreff: 'Luhambo: Bitte bestätige deine E-Mail-Adresse',
    text:
      `Hallo ${name},\n\n` +
      `willkommen bei Luhambo! Bitte bestätige deine E-Mail-Adresse über diesen Link:\n\n${link}\n\n` +
      `Der Link ist 24 Stunden gültig. Falls du dich nicht registriert hast, ignoriere diese Nachricht.\n\n` +
      `— Luhambo`,
  }
}

export function baueResetMail(name: string, link: string): { betreff: string; text: string } {
  return {
    betreff: 'Luhambo: Passwort zurücksetzen',
    text:
      `Hallo ${name},\n\n` +
      `du (oder jemand) hat ein neues Passwort für dein Luhambo-Konto angefordert. ` +
      `Setze es über diesen Link neu:\n\n${link}\n\n` +
      `Der Link ist 1 Stunde gültig. Hast du das nicht angefordert, ist nichts passiert — ` +
      `dein aktuelles Passwort bleibt gültig.\n\n— Luhambo`,
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
