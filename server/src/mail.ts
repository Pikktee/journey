// Transaktionaler Mail-Versand (M9) hinter einem schmalen Interface — genau wie
// Storage/Geocoder/Wetter/Video: die Routen kennen nur `MailTransport`, die
// konkrete Implementierung wird in index.ts (Prod) bzw. den Tests (Fake)
// hereingereicht. Damit sind die Registrierungs-/Reset-Flüsse ohne echten
// Mailserver testbar, und ein Anbieterwechsel zieht keine Ringe durch den Code.

export interface MailMessage {
  an: string
  betreff: string
  text: string
  /**
   * HTML-Fassung (Maptale-Layout, s. maillayout.ts). Optional, und beide
   * Fassungen gehen IMMER zusammen raus: Der Text-Teil ist nicht nur für
   * Mail-Programme ohne HTML da — eine Mail ohne ihn landet bei vielen Filtern
   * schneller im Spam, und Vorlesewerkzeuge nehmen ihn lieber.
   */
  html?: string
  /**
   * Zusätzliche Kopfzeilen — heute genau eine Sorte: `List-Unsubscribe` samt
   * Ein-Klick-Zusage an einer WERBEmail (RFC 8058, s. newsletter.ts).
   *
   * Sie stehen nicht fest im Versand, weil sie nicht an jede Mail gehören: An
   * einem Passwort-Reset wäre „Abbestellen" eine Zusage, die niemand einhalten
   * will — abbestellen lässt sich der Newsletter, nicht das eigene Konto.
   */
  kopfzeilen?: Record<string, string>
}

export interface MailTransport {
  sende(nachricht: MailMessage): Promise<void>
}

// Die TEXTE der System-Mails stehen nicht mehr hier, sondern im Katalog
// mailvorlagen.ts — sie sind seit v0.42 in der Verwaltung anpassbar, und ein
// zweiter Satz Texte im Code wäre genau die Sorte Liste, die auseinanderläuft.
// Gebaut werden die Mails über `app.mailvorlagen.rendere(...)`.

/**
 * Dev-Versand: schreibt die Mail (inkl. Link) ins Log, statt sie zu verschicken.
 * So lässt sich der komplette Registrierungs-/Reset-Fluss lokal ohne Mailserver
 * durchspielen — der Bestätigungslink steht im Server-Terminal.
 */
export class ConsoleMail implements MailTransport {
  constructor(private readonly log: (zeile: string) => void = console.log) {}
  async sende(nachricht: MailMessage): Promise<void> {
    this.log(
      `\n📧 Mail an ${nachricht.an}\n   Betreff: ${nachricht.betreff}\n   ${nachricht.text.replace(/\n/g, '\n   ')}\n`,
    )
  }
}

/**
 * Produktions-Versand über die HTTP-API von Resend (resend.com, Free-Tier
 * genügt für die zu erwartenden Volumina). Bewusst per fetch — keine
 * Abhängigkeit, kein SMTP-Betrieb. Fällt der Versand aus, wirft `sende` und der
 * Aufrufer entscheidet (Registrierung schlägt dann sichtbar fehl).
 */
export class ResendMail implements MailTransport {
  constructor(
    private readonly apiKey: string,
    private readonly absender: string,
  ) {}

  async sende(nachricht: MailMessage): Promise<void> {
    const antwort = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      // `text` geht IMMER mit: Resend baut daraus multipart/alternative, und der
      // Text-Teil ist die Fassung, die jedes Programm anzeigen kann.
      body: JSON.stringify({
        from: this.absender,
        to: nachricht.an,
        subject: nachricht.betreff,
        text: nachricht.text,
        ...(nachricht.html ? { html: nachricht.html } : {}),
        ...(nachricht.kopfzeilen ? { headers: nachricht.kopfzeilen } : {}),
      }),
    })
    if (!antwort.ok) {
      throw new Error(`Mail-Versand fehlgeschlagen (${antwort.status}): ${await antwort.text()}`)
    }
  }
}
