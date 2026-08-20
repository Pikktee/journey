// Die Newsletter-Einwilligung: wer sie gegeben hat, wann, woher — und der Weg
// wieder hinaus.
//
// Das hier ist Teil A des [Newsletter-Konzepts](../../docs/concepts/konzept_newsletter.md):
// die Einwilligung. Teil B (Entwurf erzeugen, redigieren, stapelweise
// versenden) kommt später und findet hier schon vor, was er braucht — die
// Empfängerliste und die Kopfzeilen nach RFC 8058.
//
// Vier Dinge tragen das, und jedes davon lässt sich „vereinfachen", bis es
// rechtlich kippt:
//
//   1. **Nicht vorangekreuzt, nicht gekoppelt.** Ein vorbelegtes Kästchen ist
//      seit Planet49 (EuGH C-673/17) keine wirksame Einwilligung, und die
//      Registrierung funktioniert unabhängig davon. Das ist eine Regel der
//      Oberfläche — hier steht sie, weil der Server sie nicht erzwingen kann:
//      Er sieht nur ein Feld, das fehlt oder `false` ist.
//   2. **Kein Boolean, sondern eine Historie** (s. Migration 16).
//   3. **Der Riegel: unbestätigte Adresse = kein Versand.** Nicht der Schalter
//      ist gesperrt, sondern der VERSAND — der Wunsch darf gespeichert werden,
//      solange nichts rausgeht. Deshalb steht der Riegel in `empfaenger()` und
//      nicht nur in der Oberfläche.
//   4. **Der Weg hinaus geht ohne Anmeldung.** Ein Widerruf muss so einfach
//      sein wie die Einwilligung (Art. 7 Abs. 3) — der Abmeldelink trägt einen
//      signierten Token und braucht weder Passwort noch Sitzung.

import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Db } from './db.js'
import { neueSessionId } from './ids.js'
import { WEB_PFADE } from './webpfade.js'

/** Woher eine Ein- oder Austragung kam — steht so in der Historie. */
export type EinwilligungsQuelle = 'signup' | 'account' | 'unsubscribe_link'

export interface Einwilligung {
  at: string
  state: 'on' | 'off'
  source: EinwilligungsQuelle
  textVersion: string
}

/**
 * Die Sätze, denen zugestimmt wird — mit Label.
 *
 * Gespeichert wird das LABEL, nicht der Satz: Sonst stünde derselbe Wortlaut
 * tausendfach in der Tabelle. Damit das Label trotzdem etwas beweist, muss der
 * WORTLAUT unverändert bleiben, solange das Label steht — **wer den Text
 * ändert, hebt das Datum im Label**. Ein Drift-Wächter
 * ([test/newsletter-einwilligung.test.ts](../../test/newsletter-einwilligung.test.ts))
 * hält die Sätze gegen die Oberfläche: Stünde in `studio.html` etwas anderes
 * als hier, behauptete die Historie eine Zustimmung zu einem Text, den niemand
 * gelesen hat.
 *
 * `unsubscribe_link` hat keinen eigenen Satz — man widerruft, was man zugesagt hat;
 * die Zeile hält fest, WORAUS man aussteigt.
 */
export const EINWILLIGUNGSTEXTE = {
  // Kurz wie überall sonst: Zweck und Widerruf, mehr trägt ein Kästchen neben
  // einem Formular nicht. Die Bedingungen dahinter (wie oft, worüber, wo man
  // abbestellt) stehen in der Datenschutzerklärung, die unter dem Formular
  // verlinkt ist, und ausführlich in den Kontoeinstellungen — ein Absatz an
  // dieser Stelle wird nicht gelesen, und ungelesen ist er kein besserer
  // Nachweis als ein Satz, den man erfasst.
  signup: {
    fassung: 'registrierung-2026-08-06',
    text: 'Schick mir Neuigkeiten zu Maptale. Abbestellen jederzeit.',
  },
  // Zweite Fassung desselben Tages: Der Wortlaut IST der Nachweis — wer ihn
  // ändert, ohne die Kennung mitzuziehen, behauptet für alte Einträge einen
  // Satz, der so nie dastand. (Der Kommentar steht VOR dem Eintrag, weil der
  // Wächter in test/newsletter-einwilligung.test.ts den Block roh liest.)
  account: {
    fassung: 'konto-2026-08-06-2',
    text: 'Ein paar Mal im Jahr Neues von Maptale. Abbestellen jederzeit.',
  },
} as const

/** Ein Empfänger des Versands (Teil B) — mehr braucht eine Mail nicht. */
export interface Empfaenger {
  id: string
  email: string
  name: string
}

/**
 * Der Abmelde-Token: signiert, nicht gespeichert.
 *
 * Er hängt an keiner Zeile in der Datenbank und läuft nicht ab — beides mit
 * Absicht. Ein Token mit Frist stünde in einer Mail, die jemand ein Jahr später
 * aus dem Archiv holt, und wäre dann genau dort tot, wo er gebraucht wird; ein
 * gespeicherter Token bräuchte je Mail eine Zeile, die niemand aufräumt.
 * Signiert wird mit dem Cookie-Geheimnis: Wer es wechselt, entwertet alte
 * Abmeldelinks — dann bleibt der Schalter in den Kontoeinstellungen, und genau
 * darauf zeigt die Fehlermeldung.
 */
export function abmeldeToken(userId: string, geheimnis: string): string {
  const signatur = createHmac('sha256', geheimnis)
    .update(`newsletter:${userId}`)
    .digest('base64url')
  return `${Buffer.from(userId, 'utf8').toString('base64url')}.${signatur}`
}

/** Token → Benutzer-ID; null bei Unfug oder falscher Signatur. */
export function pruefeAbmeldeToken(token: string, geheimnis: string): string | null {
  const [kopf, signatur] = token.split('.')
  if (!kopf || !signatur) return null
  const userId = Buffer.from(kopf, 'base64url').toString('utf8')
  if (!userId) return null
  const erwartet = createHmac('sha256', geheimnis)
    .update(`newsletter:${userId}`)
    .digest('base64url')
  // Konstante Zeit — die Länge muss vorher stimmen, sonst wirft timingSafeEqual.
  if (signatur.length !== erwartet.length) return null
  if (!timingSafeEqual(Buffer.from(signatur), Buffer.from(erwartet))) return null
  return userId
}

/** Die Adresse, unter der ein Abmeldelink liegt — eine Stelle für Mail und Kopfzeile. */
export const abmeldeUrl = (basisUrl: string, token: string): string =>
  `${basisUrl.replace(/\/+$/, '')}${WEB_PFADE.konto}#newsletter-aus=${token}`

/** Die Adresse, die der Ein-Klick-Widerruf der Mail-Programme anspricht. */
export const einKlickUrl = (basisUrl: string, token: string): string =>
  `${basisUrl.replace(/\/+$/, '')}/api/newsletter/one-click/${token}`

/**
 * `List-Unsubscribe` samt Ein-Klick-Zusage (RFC 8058) — für jede Werbemail.
 *
 * Seit 2024 verlangen Gmail und Yahoo das von Massenversendern; fehlt es,
 * leidet die Zustellbarkeit ALLER Mails aus derselben Domain, auch der
 * transaktionalen. Die beiden Kopfzeilen gehören zusammen: Ohne
 * `List-Unsubscribe-Post` ist die URL nur ein Link, den der Mail-Client
 * öffnet, statt den Widerruf selbst abzuschicken.
 *
 * Transaktionale Mails (Bestätigung, Reset) bekommen sie NICHT — sie sind
 * keine Werbung, und ein „Abbestellen" an einem Passwort-Reset wäre eine
 * Zusage, die niemand einhalten will.
 */
export function newsletterKopfzeilen(basisUrl: string, token: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${einKlickUrl(basisUrl, token)}>, <${abmeldeUrl(basisUrl, token)}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
}

export class NewsletterDienst {
  constructor(private readonly db: Db) {}

  /** Steht der Schalter an? (Der Wunsch — ob etwas rausgeht, sagt `empfaenger`.) */
  stand(userId: string): boolean {
    const zeile = this.db.prepare('SELECT newsletter FROM users WHERE id = ?').get(userId) as
      { newsletter: number } | undefined
    return !!zeile?.newsletter
  }

  /**
   * Ein- oder austragen — Spalte und Historie in EINER Transaktion.
   *
   * Auch der unveränderte Zustand wird protokolliert, wenn er ausdrücklich
   * gesetzt wurde: Ein zweites „aus" über den Abmeldelink ist die Auskunft,
   * dass jemand es noch einmal versucht hat — und genau die will man haben,
   * wenn später jemand behauptet, der Link habe nicht gewirkt.
   */
  setze(userId: string, an: boolean, quelle: EinwilligungsQuelle): void {
    const textfassung =
      quelle === 'unsubscribe_link' ? 'abmeldelink' : EINWILLIGUNGSTEXTE[quelle].fassung
    this.db.transaction(() => {
      this.db.prepare('UPDATE users SET newsletter = ? WHERE id = ?').run(an ? 1 : 0, userId)
      this.db
        .prepare(
          `INSERT INTO newsletter_consents (id, user_id, at, state, source, text_version)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          neueSessionId(),
          userId,
          new Date().toISOString(),
          an ? 'on' : 'off',
          quelle,
          textfassung,
        )
    })()
  }

  /** Die Historie eines Kontos, jüngste zuerst — der Nachweis nach Art. 7 Abs. 1. */
  verlauf(userId: string): Einwilligung[] {
    return this.db
      .prepare(
        `SELECT at, state, source, text_version AS textVersion FROM newsletter_consents
         WHERE user_id = ? ORDER BY at DESC, rowid DESC`,
      )
      .all(userId) as Einwilligung[]
  }

  /**
   * Alte Protokollzeilen wegräumen — was drei Jahre her und überholt ist.
   *
   * Drei Jahre, weil so lange jemand vorhalten kann, ohne Einwilligung
   * angeschrieben worden zu sein (regelmäßige Verjährung, §§ 195, 199 BGB); der
   * Nachweis muss so lange tragen, aber keinen Tag länger — eine Historie „für
   * immer" wäre Sammeln ohne Zweck.
   *
   * Die JÜNGSTE Zeile bleibt immer stehen, egal wie alt: Sie erklärt den
   * aktuellen Zustand. Ohne sie stünde in `users` ein „an", zu dem es keine
   * Herkunft mehr gäbe — genau der Fall, gegen den die Tabelle gebaut ist.
   */
  raeumeAuf(): number {
    const grenze = new Date(Date.now() - 3 * 365 * 24 * 60 * 60 * 1000).toISOString()
    return this.db
      .prepare(
        `DELETE FROM newsletter_consents WHERE at < ? AND id NOT IN (
           SELECT id FROM newsletter_consents e
           WHERE e.at = (SELECT MAX(at) FROM newsletter_consents
                         WHERE user_id = e.user_id)
         )`,
      )
      .run(grenze).changes
  }

  /**
   * Wer den Newsletter bekommen darf — Einwilligung UND bestätigte Adresse.
   *
   * Der zweite Teil ist der Riegel: Zwischen Registrierung und Klick auf den
   * Bestätigungslink ist die Adresse nur eine Behauptung, und eine Werbemail an
   * eine Adresse, die niemand bestätigt hat, ist genau die Nachricht, gegen die
   * das Double-Opt-in gebaut ist. Der Klick auf den Bestätigungslink IST damit
   * das Double-Opt-in für den Newsletter gleich mit.
   *
   * Derselbe Riegel deckt den Adresswechsel ab: Die neue Adresse landet erst
   * nach dem Klick im neuen Postfach in `users` — und trägt dann schon
   * `email_verified = 1`. Setzt ein Admin den Haken ab (Benutzerverwaltung),
   * ruht der Versand, bis er wieder steht.
   */
  empfaenger(): Empfaenger[] {
    return this.db
      .prepare(
        `SELECT id, email, name FROM users
         WHERE newsletter = 1 AND email_verified = 1 ORDER BY created_at ASC`,
      )
      .all() as Empfaenger[]
  }
}
