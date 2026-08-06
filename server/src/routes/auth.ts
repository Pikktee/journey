// Auth-Routen: Login (Web-Session und/oder App-Token), Logout, Ich-Abfrage
// sowie der M9-Betriebsteil — Selbst-Registrierung mit E-Mail-Bestätigung,
// Passwort-Reset und Konto-Löschung. Alle unauthentifizierten, teuren oder
// mail-auslösenden Endpunkte sind pro Quelle/Adresse gebremst.

import type { Readable } from 'node:stream'
import type { FastifyInstance } from 'fastify'
import { erfordereBenutzer, SESSION_COOKIE, SESSION_HINWEIS_COOKIE } from '../app.js'
import { nameAusEmail, type ProfilAenderung } from '../auth/auth.js'
import { HANDLE_TEXTE } from '../handle.js'
import { istTitelbildVorschlag, titelbildUrl } from '../profilfelder.js'
import type { EinladungsFehler } from '../auth/einladungen.js'
import { wartelisteAngeboten } from '../auth/warteliste.js'
import { baueBremse } from '../bremse.js'
import { quotaStand, speicherAufteilung } from '../quota.js'
import { WEB_PFADE } from '../webpfade.js'

interface LoginBody {
  email: string
  passwort: string
  /** Gesetzt (z. B. „Pixel 9"): zusätzlich ein API-Token für die App erzeugen */
  tokenLabel?: string
}

/**
 * Handle und Titelbild stehen neben den Profilfeldern, aber nicht in
 * `ProfilAenderung`: Beide können scheitern bzw. brauchen eine eigene Behandlung
 * (Aufräumen der alten Datei) und laufen deshalb an `setzeProfil` vorbei — s. Route.
 */
type ProfilBody = ProfilAenderung & { handle?: string; titelbild?: string }

/**
 * Ein Profilbild ist ein Vorschaubild, kein Foto-Upload — die App skaliert vor
 * dem Senden auf ~512 px. Das Limit fängt nur ab, wenn jemand am Client
 * vorbei ein Rohfoto schickt.
 */
const MAX_AVATAR_BYTES = 2 * 1024 * 1024

/**
 * Das Titelbild läuft über die ganze Seitenbreite — hier ist ein Foto in
 * Bildschirmgröße die Regel und nicht der Ausreißer. Trotzdem gedeckelt: Ein
 * Banner ist kein Medien-Upload, und die Quota fasst es (wie den Avatar) nicht
 * an.
 */
const MAX_TITELBILD_BYTES = 8 * 1024 * 1024

/**
 * Öffentlicher Pfad eines Avatars.
 *
 * Der Dateiname hängt als Parameter dran, obwohl die Route ihn nicht braucht:
 * Er macht die URL nach jedem Upload zu einer neuen und bricht damit den
 * Cache. Ohne ihn zeigte der Browser nach einem Bildwechsel weiter das alte
 * Bild — bei `immutable` ein Jahr lang.
 */
const avatarUrl = (userId: string, datei: string): string =>
  `/api/benutzer/${userId}/avatar?v=${encodeURIComponent(datei)}`

/** Das eigene Profil, wie es `/auth/me` und der Profil-PATCH ausliefern. */
function alsProfilAntwort(app: FastifyInstance, userId: string) {
  const profil = app.auth.profil(userId)
  return {
    handle: profil?.handle ?? null,
    anzeigename: profil?.anzeigename ?? null,
    bio: profil?.bio ?? null,
    ort: profil?.ort ?? null,
    website: profil?.website ?? null,
    instagram: profil?.instagram ?? null,
    avatarUrl: profil?.avatar ? avatarUrl(userId, profil.avatar) : null,
    titelbild: profil?.titelbild ?? null,
    titelbildUrl: titelbildUrl(userId, profil?.titelbild ?? null),
    sichtbarkeit: profil?.sichtbarkeit ?? 'private',
    // Zweiter, unabhängiger Zustand neben der Sichtbarkeit: „über den Link
    // erreichbar" und „unter dem eigenen Namen auffindbar" sind verschiedene
    // Entscheidungen (s. server/src/routes/seiten.ts). Steht hier mit, damit
    // der Schalter der Kontoeinstellungen beim Aufbau richtig liegt.
    suchmaschinen:
      ((app.deps.db.prepare('SELECT suchmaschinen FROM users WHERE id = ?').get(userId) as
        | { suchmaschinen: number }
        | undefined)?.suchmaschinen ?? 0) === 1,
  }
}

const emailSchema = { type: 'string', maxLength: 254 } as const
const passwortSchema = { type: 'string', minLength: 8, maxLength: 1024 } as const

/**
 * Warum ein Einladungscode nicht zieht — in Worten, die dem Eingeladenen sagen,
 * was er tun kann. „Ungültig" allein ließe ihn zwischen Tippfehler und
 * abgelaufener Einladung raten.
 */
const CODE_FEHLER: Record<EinladungsFehler, string> = {
  unbekannt: 'Diesen Einladungscode gibt es nicht. Bitte prüfe die Schreibweise.',
  verbraucht: 'Dieser Einladungscode wurde bereits eingelöst.',
  abgelaufen: 'Dieser Einladungscode ist abgelaufen.',
}

export function registriereAuthRouten(app: FastifyInstance): void {
  const { konfig, mail, storage, benutzerStorage, db } = app.deps
  const loginGebremst = baueBremse(10)
  const registrierGebremst = baueBremse(5, 10 * 60_000) // 5 pro 10 min je IP
  const resetGebremst = baueBremse(5, 10 * 60_000)
  // Großzügiger als die Registrierung: Diese Route wird beim Abtippen eines
  // Codes mehrfach getroffen. Gegen Raten reicht es trotzdem — bei 25^8
  // Möglichkeiten sind zwölf Versuche je zehn Minuten kein Angriffsweg.
  const codeGebremst = baueBremse(12, 10 * 60_000)

  const setzeSessionCookie = (
    reply: import('fastify').FastifyReply,
    userId: string,
    request?: import('fastify').FastifyRequest,
  ): { id: string; ablauf: Date } => {
    // Gerät und grober Ort wandern in die Sitzung, damit die Kontoeinstellungen
    // sie später wiedererkennbar auflisten können (s. AuthDienst.geraete).
    const session = app.auth.erzeugeSession(userId, {
      userAgent: request?.headers['user-agent'] ?? null,
      ip: request?.ip ?? null,
    })
    const cookieBasis = {
      path: '/',
      sameSite: 'lax' as const,
      secure: konfig.hinterTls,
      expires: session.ablauf,
    }
    reply.setCookie(SESSION_COOKIE, session.id, { ...cookieBasis, httpOnly: true })
    // Lesbar für studio.html: Boot-Splash überspringen, solange die Sitzung steht.
    reply.setCookie(SESSION_HINWEIS_COOKIE, '1', { ...cookieBasis, httpOnly: false })
    return session
  }

  const loescheSessionCookies = (reply: import('fastify').FastifyReply): void => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    reply.clearCookie(SESSION_HINWEIS_COOKIE, { path: '/' })
  }

  // — Login —
  app.post<{ Body: LoginBody }>(
    '/api/auth/login',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['email', 'passwort'],
          properties: { email: emailSchema, passwort: { type: 'string', maxLength: 1024 }, tokenLabel: { type: 'string', maxLength: 60 } },
        },
      },
    },
    async (request, reply) => {
      if (loginGebremst(`ip:${request.ip}`, `mail:${request.body.email.toLowerCase().trim()}`)) {
        return reply.code(429).send({ fehler: 'Zu viele Anmeldeversuche. Bitte warte einen Moment.' })
      }
      const benutzer = await app.auth.login(request.body.email, request.body.passwort)
      if (!benutzer) return reply.code(401).send({ fehler: 'E-Mail oder Passwort stimmt nicht.' })

      setzeSessionCookie(reply, benutzer.id, request)
      const antwort: { benutzer: typeof benutzer; apiToken?: string } = { benutzer }
      if (request.body.tokenLabel) antwort.apiToken = app.auth.erzeugeToken(benutzer.id, request.body.tokenLabel)
      return antwort
    },
  )

  // — Selbst-Registrierung (M9) — legt einen UNbestätigten Benutzer an und
  // verschickt den Bestätigungslink. Anmelden geht sofort, Hochladen erst nach
  // Bestätigung (Gate in POST /api/tours).
  //
  // Steht die Instanz auf „nur mit Einladung", ist `code` Pflicht. Geprüft wird
  // ZWEIMAL: einmal vorab für eine brauchbare Fehlermeldung, und einmal beim
  // Einlösen nach dem Anlegen — nur dort ist es atomar. Scheitert das Einlösen
  // (zwei Anmeldungen mit demselben Code in derselben Sekunde), wird das eben
  // angelegte Konto wieder zurückgenommen; ein halb registrierter Benutzer wäre
  // schlimmer als ein abgewiesener.
  // `name` ist OPTIONAL: Das Formular fragt nur noch E-Mail und Passwort ab —
  // je weniger Felder, desto mehr Leute kommen an. Fehlt er, wird er aus der
  // Adresse abgeleitet (nameAusEmail); wer ihn mitschickt, behält ihn.
  //
  // `newsletter` ist das Kästchen unter den Feldern — nicht vorangekreuzt und
  // nicht gekoppelt: Fehlt es oder steht es auf `false`, ändert das an der
  // Registrierung nichts. Wirksam wird die Einwilligung erst mit der
  // Bestätigung der Adresse (Riegel in `NewsletterDienst.empfaenger`), womit
  // der Klick auf den Bestätigungslink das Double-Opt-in gleich miterledigt.
  app.post<{ Body: { email: string; passwort: string; name?: string; code?: string; newsletter?: boolean } }>(
    '/api/auth/register',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['email', 'passwort'],
          properties: {
            email: emailSchema,
            passwort: passwortSchema,
            name: { type: 'string', minLength: 1, maxLength: 80 },
            code: { type: 'string', maxLength: 40 },
            newsletter: { type: 'boolean' },
          },
        },
      },
    },
    async (request, reply) => {
      if (!konfig.registrierungOffen) return reply.code(403).send({ fehler: 'Zurzeit sind keine neuen Konten möglich.' })
      if (registrierGebremst(`ip:${request.ip}`)) {
        return reply.code(429).send({ fehler: 'Zu viele Registrierungen. Bitte versuche es später erneut.' })
      }
      const email = request.body.email.toLowerCase().trim()
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply.code(400).send({ fehler: 'Diese E-Mail-Adresse stimmt nicht.' })

      const codePflicht = app.einladungen.pflicht()
      const code = request.body.code?.trim() ?? ''
      if (codePflicht) {
        if (!code) return reply.code(403).send({ fehler: 'Für ein neues Konto brauchst du einen Einladungscode.' })
        const grund = app.einladungen.pruefe(code)
        if (grund) return reply.code(403).send({ fehler: CODE_FEHLER[grund] })
      }
      if (app.auth.emailVergeben(email)) return reply.code(409).send({ fehler: 'Für diese E-Mail gibt es schon ein Konto.' })

      const name = request.body.name?.trim() || nameAusEmail(email)
      const benutzer = await app.auth.legeBenutzerAn(email, request.body.passwort, name, false)
      if (codePflicht && !app.einladungen.loeseEin(code, benutzer.id)) {
        app.auth.loescheBenutzer(benutzer.id)
        return reply.code(403).send({ fehler: CODE_FEHLER.verbraucht })
      }
      // Nur ein ausdrückliches `true` zählt — und nur als PROTOKOLLIERTE
      // Einwilligung, nicht als stille Spalte: `setze` schreibt Zustand,
      // Zeitpunkt, Quelle und Textfassung in einem Zug.
      if (request.body.newsletter === true) app.newsletter.setze(benutzer.id, true, 'registrierung')
      const token = app.auth.erzeugeMailToken(benutzer.id, 'verify')
      const link = `${konfig.basisUrl}${WEB_PFADE.anmelden}#verify=${token}`
      // Die Bestätigungsmail bleibt WERBEFREI: kein Satz über den Newsletter,
      // keine List-Unsubscribe-Kopfzeile. Ein „Übrigens, unser Newsletter …"
      // machte aus der transaktionalen Mail selbst eine Werbemail — und
      // beworben wird die Einwilligung ohnehin nicht, sie wird bestätigt.
      const { betreff, text, html } = app.mailvorlagen.rendere(
        'verifikation',
        { name: benutzer.name },
        { basisUrl: konfig.basisUrl, link },
      )
      try {
        await mail.sende({ an: benutzer.email, betreff, text, html })
      } catch (fehler) {
        app.log.error({ fehler }, 'Bestätigungsmail konnte nicht versendet werden')
      }
      // Direkt einloggen (Cookie) — der Nutzer sieht sofort sein Studio mit dem
      // Hinweis „E-Mail bestätigen", statt nach der Registrierung ausgesperrt zu sein.
      setzeSessionCookie(reply, benutzer.id, request)
      return reply.code(201).send({ benutzer, verifiziert: false })
    },
  )

  // — Einladungscode prüfen, OHNE ihn zu verbrauchen —
  //
  // Der erste Schritt der Registrierung: Wer keine gültige Einladung hat, soll
  // das erfahren, bevor er Name, Adresse und Passwort eintippt. Verbraucht wird
  // der Code erst beim Anlegen des Kontos (dort atomar) — diese Route ist rein
  // lesend und darf deshalb auch mehrfach gefragt werden.
  //
  // Sie verrät nichts über die Einladung außer „geht / geht nicht (warum)":
  // Die Notiz („Anna vom Radclub") ist eine Verwaltungsangabe und bleibt drin.
  app.post<{ Body: { code: string } }>(
    '/api/auth/einladung-pruefen',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['code'],
          properties: { code: { type: 'string', maxLength: 40 } },
        },
      },
    },
    async (request, reply) => {
      if (!konfig.registrierungOffen) return reply.code(403).send({ fehler: 'Zurzeit sind keine neuen Konten möglich.' })
      if (codeGebremst(`ip:${request.ip}`)) {
        return reply.code(429).send({ fehler: 'Zu viele Versuche. Bitte versuche es später erneut.' })
      }
      // Ohne Einladungspflicht ist jeder Code müßig — die Antwort ist trotzdem
      // „geht", damit ein Formular, das noch fragt, niemanden aussperrt.
      if (!app.einladungen.pflicht()) return { ok: true, pflicht: false }
      const grund = app.einladungen.pruefe(request.body.code)
      if (grund) return reply.code(403).send({ fehler: CODE_FEHLER[grund] })
      return { ok: true, pflicht: true }
    },
  )

  // — E-Mail bestätigen — Token aus dem Mail-Link einlösen; danach eingeloggt.
  app.post<{ Body: { token: string } }>(
    '/api/auth/verifiziere',
    { schema: { body: { type: 'object', additionalProperties: false, required: ['token'], properties: { token: { type: 'string', maxLength: 200 } } } } },
    async (request, reply) => {
      const userId = app.auth.loeseMailToken(request.body.token, 'verify')
      if (!userId) return reply.code(400).send({ fehler: 'Dieser Bestätigungslink gilt nicht mehr.' })
      app.auth.verifiziereEmail(userId)
      setzeSessionCookie(reply, userId, request)
      return { ok: true }
    },
  )

  // — Passwort-Reset anfordern — IMMER 200 (keine Existenz-Auskunft); nur wenn
  // die Adresse existiert, wird ein Reset-Token verschickt.
  app.post<{ Body: { email: string } }>(
    '/api/auth/passwort-reset-anfordern',
    { schema: { body: { type: 'object', additionalProperties: false, required: ['email'], properties: { email: emailSchema } } } },
    async (request, reply) => {
      const email = request.body.email.toLowerCase().trim()
      if (resetGebremst(`ip:${request.ip}`, `mail:${email}`)) {
        return reply.code(429).send({ fehler: 'Zu viele Anfragen. Bitte versuche es später erneut.' })
      }
      const userId = app.auth.benutzerIdFuerEmail(email)
      if (userId) {
        const token = app.auth.erzeugeMailToken(userId, 'reset')
        const link = `${konfig.basisUrl}${WEB_PFADE.anmelden}#reset=${token}`
        // Der Name des KONTOS, nicht der Adress-Anfang: Die Mail geht ohnehin
        // nur an die eigene Adresse, und „Hallo mira.wolf," liest sich wie ein
        // Datenbankfeld.
        const name = app.auth.benutzerNachId(userId)?.name || 'du'
        const { betreff, text, html } = app.mailvorlagen.rendere(
          'reset',
          { name },
          { basisUrl: konfig.basisUrl, link },
        )
        try {
          await mail.sende({ an: email, betreff, text, html })
        } catch (fehler) {
          app.log.error({ fehler }, 'Reset-Mail konnte nicht versendet werden')
        }
      }
      return { ok: true }
    },
  )

  // — Passwort neu setzen — Token einlösen, Passwort ersetzen, alle Sitzungen
  // beenden, den Nutzer frisch einloggen.
  app.post<{ Body: { token: string; passwort: string } }>(
    '/api/auth/passwort-reset',
    { schema: { body: { type: 'object', additionalProperties: false, required: ['token', 'passwort'], properties: { token: { type: 'string', maxLength: 200 }, passwort: passwortSchema } } } },
    async (request, reply) => {
      const userId = app.auth.loeseMailToken(request.body.token, 'reset')
      if (!userId) return reply.code(400).send({ fehler: 'Dieser Link gilt nicht mehr. Fordere einen neuen an.' })
      await app.auth.setzePasswort(userId, request.body.passwort)
      setzeSessionCookie(reply, userId, request)
      return { ok: true }
    },
  )

  // — Session aus einem API-Token —
  //
  // Für den Player IN DER APP: der läuft als WebView auf dem Web-Origin und
  // holt Tour-JSON und Medien wie ein Browser, also mit Cookie. Das API-Token
  // der App kann er nicht mitschicken (es steckt im OkHttp-Client, nicht im
  // WebView). Ohne Sitzung sieht der WebView nur Touren, die ohnehin für jeden
  // mit Link sichtbar sind — private Touren wären in der eigenen App
  // unabspielbar. Die App tauscht deshalb vor dem Abspielen ihr Token gegen
  // eine Sitzung und setzt sie als Cookie.
  app.post('/api/auth/session-aus-token', async (request, reply) => {
    const benutzer = erfordereBenutzer(request, reply)
    if (!benutzer) return
    const session = setzeSessionCookie(reply, benutzer.id, request)
    return { sessionId: session.id, ablauf: session.ablauf.toISOString() }
  })

  app.post('/api/auth/logout', async (request, reply) => {
    const sessionId = request.cookies[SESSION_COOKIE]
    if (sessionId) app.auth.beendeSession(sessionId)
    loescheSessionCookies(reply)
    return { ok: true }
  })

  // ————— Kontoeinstellungen (Etappe 3) —————

  // — Passwort ändern —
  //
  // Das ALTE Passwort steht dabei: Ein offener Laptop ist sonst ein
  // übernommenes Konto, und die Sitzung allein beweist nur, dass jemand am
  // Gerät saß. Danach fallen alle anderen Zugänge (s. setzePasswort) — die
  // eigene Sitzung bleibt, sonst wirft der Wechsel einen aus der Seite, auf der
  // man gerade steht.
  app.post<{ Body: { alt: string; neu: string } }>(
    '/api/auth/me/passwort',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['alt', 'neu'],
          properties: { alt: { type: 'string', maxLength: 1024 }, neu: passwortSchema },
        },
      },
    },
    async (request, reply) => {
      const benutzer = erfordereBenutzer(request, reply)
      if (!benutzer) return
      if (loginGebremst(`pw:${benutzer.id}`)) {
        return reply.code(429).send({ fehler: 'Zu viele Versuche. Bitte warte einen Moment.' })
      }
      if (!(await app.auth.login(benutzer.email, request.body.alt))) {
        return reply.code(403).send({ fehler: 'Das aktuelle Passwort stimmt nicht.' })
      }
      const sessionId = request.cookies[SESSION_COOKIE]
      await app.auth.setzePasswort(benutzer.id, request.body.neu, sessionId)
      // Ohne Sitzung (App-Token) gibt es keine zu behalten — dann bekommt der
      // Aufrufer hier eine frische, statt abgemeldet dazustehen.
      if (!sessionId) setzeSessionCookie(reply, benutzer.id, request)
      return { ok: true }
    },
  )

  // — E-Mail-Adresse ändern: anstoßen —
  //
  // Die Mail geht an die NEUE Adresse, und erst der Klick dort macht sie gültig
  // (der Token trägt sie bis dahin, s. AuthDienst.loeseMailTokenMitNutzlast).
  // Sonst genügte ein Tippfehler, um sich selbst auszusperren. Das Passwort
  // steht dabei aus demselben Grund wie oben.
  //
  // Ob die Adresse schon vergeben ist, wird geprüft — aber die Antwort ist
  // dieselbe wie im Erfolgsfall: Diese Route wäre sonst eine Auskunft darüber,
  // wer bei Maptale ein Konto hat. Verschickt wird dann nichts.
  app.post<{ Body: { email: string; passwort: string } }>(
    '/api/auth/me/email',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['email', 'passwort'],
          properties: { email: emailSchema, passwort: { type: 'string', maxLength: 1024 } },
        },
      },
    },
    async (request, reply) => {
      const benutzer = erfordereBenutzer(request, reply)
      if (!benutzer) return
      if (resetGebremst(`mailwechsel:${benutzer.id}`)) {
        return reply.code(429).send({ fehler: 'Zu viele Anfragen. Bitte versuche es später erneut.' })
      }
      const email = request.body.email.toLowerCase().trim()
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return reply.code(400).send({ fehler: 'Diese E-Mail-Adresse stimmt nicht.' })
      }
      if (!(await app.auth.login(benutzer.email, request.body.passwort))) {
        return reply.code(403).send({ fehler: 'Das Passwort stimmt nicht.' })
      }
      if (email === benutzer.email) {
        return reply.code(400).send({ fehler: 'Das ist bereits deine Adresse.' })
      }
      if (!app.auth.emailVergeben(email)) {
        const token = app.auth.erzeugeMailToken(benutzer.id, 'email', email)
        const link = `${konfig.basisUrl}${WEB_PFADE.konto}#email=${token}`
        const { betreff, text, html } = app.mailvorlagen.rendere(
          'email-wechsel',
          { name: benutzer.name },
          { basisUrl: konfig.basisUrl, link },
        )
        try {
          await mail.sende({ an: email, betreff, text, html })
        } catch (fehler) {
          app.log.error({ fehler }, 'Mail zum Adresswechsel konnte nicht versendet werden')
        }
      }
      return { ok: true }
    },
  )

  // — E-Mail-Adresse ändern: bestätigen —
  //
  // Ohne Anmeldung bedienbar: Der Link wird im Postfach der neuen Adresse
  // angeklickt, und das ist im Zweifel ein anderer Browser als der, in dem die
  // Sitzung steht. Der Token IST der Nachweis — er hängt an genau einem Konto
  // und wurde nur ausgestellt, weil dort jemand sein Passwort eingegeben hat.
  app.post<{ Body: { token: string } }>(
    '/api/auth/email-bestaetigen',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['token'],
          properties: { token: { type: 'string', maxLength: 200 } },
        },
      },
    },
    async (request, reply) => {
      const eingeloest = app.auth.loeseMailTokenMitNutzlast(request.body.token, 'email')
      if (!eingeloest?.nutzlast) {
        return reply.code(400).send({ fehler: 'Dieser Link gilt nicht mehr. Stoße den Wechsel erneut an.' })
      }
      if (!app.auth.uebernimmEigeneEmail(eingeloest.userId, eingeloest.nutzlast)) {
        // Zwischen Absenden und Klick können Tage liegen — in denen sich jemand
        // anderes mit genau dieser Adresse registriert haben kann.
        return reply.code(409).send({ fehler: 'Diese Adresse gehört inzwischen zu einem anderen Konto.' })
      }
      return { ok: true, email: eingeloest.nutzlast }
    },
  )

  // — Angemeldete Geräte —
  //
  // Sitzungen UND App-Tokens (s. AuthDienst.geraete). `dieses` markiert die
  // Sitzung, aus der gefragt wird: Sie trägt in der Oberfläche keinen
  // Abmelden-Knopf — wer sich selbst hier abmeldet, hat nichts gewonnen, außer
  // sich noch einmal anmelden zu dürfen.
  app.get('/api/auth/me/geraete', async (request, reply) => {
    const benutzer = erfordereBenutzer(request, reply)
    if (!benutzer) return
    const eigene = request.cookies[SESSION_COOKIE]
    return {
      geraete: app.auth.geraete(benutzer.id).map((g) => ({ ...g, dieses: g.id === `sitzung:${eigene}` })),
    }
  })

  app.delete<{ Params: { id: string } }>('/api/auth/me/geraete/:id', async (request, reply) => {
    const benutzer = erfordereBenutzer(request, reply)
    if (!benutzer) return
    if (!app.auth.meldeGeraetAb(benutzer.id, request.params.id)) {
      return reply.code(404).send({ fehler: 'Dieses Gerät ist nicht (mehr) angemeldet.' })
    }
    // Auch die eigene Sitzung darf fallen (etwa vom Telefon aus) — dann müssen
    // die Cookies mit weg, sonst hinge der Browser an einer toten Sitzung.
    if (request.params.id === `sitzung:${request.cookies[SESSION_COOKIE]}`) loescheSessionCookies(reply)
    return { ok: true }
  })

  // — Newsletter: Einwilligung setzen oder zurücknehmen —
  //
  // KEIN zweites Double-Opt-in. Das DOI ist kein Selbstzweck, sondern das
  // Mittel, um nachzuweisen, dass die Einwilligung vom INHABER der Adresse
  // stammt — es verhindert, dass jemand eine fremde Adresse einträgt. Genau
  // dieser Fall ist hier ausgeschlossen: Die Adresse ist beim Anlegen des
  // Kontos bestätigt worden, und diese Route erreicht nur, wer angemeldet ist.
  //
  // Solange die Adresse unbestätigt ist, wird der Wunsch trotzdem angenommen —
  // gesperrt ist nicht der Schalter, sondern der VERSAND (s.
  // `NewsletterDienst.empfaenger`). Ein Schalter, der sich nicht umlegen lässt,
  // wäre eine Einwilligung, die man erst nach einem Umweg geben darf; ein
  // Versand an eine unbestätigte Adresse dagegen wäre die Mail, gegen die das
  // Double-Opt-in gebaut ist. Die Oberfläche sagt das an der Zeile dazu.
  app.post<{ Body: { an: boolean } }>(
    '/api/auth/me/newsletter',
    {
      schema: {
        body: { type: 'object', additionalProperties: false, required: ['an'], properties: { an: { type: 'boolean' } } },
      },
    },
    async (request, reply) => {
      const benutzer = erfordereBenutzer(request, reply)
      if (!benutzer) return
      app.newsletter.setze(benutzer.id, request.body.an, 'konto')
      return { ok: true, newsletter: request.body.an, versandRuht: !app.auth.istVerifiziert(benutzer.id) }
    },
  )

  // — „In Suchmaschinen erscheinen" —
  //
  // Eigene Route und kein Feld in `PATCH /profil`: Das Profil-Formular ist der
  // Ort für das, was auf der Seite STEHT; das hier entscheidet, wer die Seite
  // finden darf. Zusammengelegt wäre es ein Häkchen zwischen Ort und Instagram.
  //
  // Angenommen wird der Wunsch auch bei privatem Profil — wirksam wird er dann
  // nicht (`seiten.ts` verlangt beides). Ein gesperrter Schalter zwänge in eine
  // Reihenfolge, die niemand kennt; die Zeile in der Oberfläche sagt stattdessen
  // dazu, worauf er wartet.
  app.post<{ Body: { an: boolean } }>(
    '/api/auth/me/suchmaschinen',
    {
      schema: {
        body: { type: 'object', additionalProperties: false, required: ['an'], properties: { an: { type: 'boolean' } } },
      },
    },
    async (request, reply) => {
      const benutzer = erfordereBenutzer(request, reply)
      if (!benutzer) return
      db.prepare('UPDATE users SET suchmaschinen = ? WHERE id = ?').run(request.body.an ? 1 : 0, benutzer.id)
      const profil = app.auth.profil(benutzer.id)
      return { ok: true, suchmaschinen: request.body.an, wirktRuht: profil?.sichtbarkeit !== 'public' }
    },
  )

  // — Speicher, aufgeschlüsselt —
  //
  // Eigene Route und nicht Teil von `/auth/me`: Die Aufteilung läuft über ALLE
  // Dateien aller Touren, und `/auth/me` ist der heißeste Aufruf der API.
  app.get('/api/auth/me/speicher', async (request, reply) => {
    const benutzer = erfordereBenutzer(request, reply)
    if (!benutzer) return
    const [stand, aufteilung] = await Promise.all([
      quotaStand(db, storage, benutzerStorage, benutzer.id, konfig.maxSpeicherProBenutzer),
      speicherAufteilung(db, storage, benutzerStorage, benutzer.id),
    ])
    return { ...stand, aufteilung }
  })

  // — Konto samt aller Daten löschen (DSGVO) — Storage-Dateien zuerst (die DB
  // kennt sie nicht mehr, sobald der Cascade greift), dann die DB-Zeile.
  app.delete('/api/auth/me', async (request, reply) => {
    const benutzer = erfordereBenutzer(request, reply)
    if (!benutzer) return
    for (const tourId of app.auth.tourIds(benutzer.id)) await storage.loescheTour(tourId)
    // Auch die Benutzerdateien (Avatar) — sie hängen an keiner Tour und
    // überlebten den Cascade sonst als Waisen auf der Platte.
    await benutzerStorage.loescheTour(benutzer.id).catch(() => undefined)
    app.auth.loescheBenutzer(benutzer.id)
    loescheSessionCookies(reply)
    return { ok: true }
  })

  // — Ich-Abfrage OHNE 401 (Studio pollt bei jedem Laden). Angemeldet: um
  // Verifikations-Stand, Quota und Profil angereichert. Zusätzlich den
  // UX-Hinweis-Cookie auffrischen — ältere Sitzungen ohne maptale_dabei
  // bekommen ihn so beim nächsten /me (z. B. Entdecken), bevor Studio lädt.
  app.get('/api/auth/me', async (request, reply) => {
    // Auch ohne Anmeldung: Das Registrierungsformular muss wissen, ob es nach
    // einem Einladungscode fragen soll — und genau dort ist niemand angemeldet.
    // Dasselbe gilt für die Warteliste: Ob sie überhaupt angeboten wird, hängt
    // an zwei Schaltern und einem Riegel; die Seite soll das nicht nachrechnen.
    const registrierung = {
      offen: konfig.registrierungOffen,
      einladungPflicht: app.einladungen.pflicht(),
      warteliste: wartelisteAngeboten(
        app.warteliste.offen(),
        app.einladungen.pflicht(),
        konfig.registrierungOffen,
      ),
    }
    if (!request.benutzer) return { benutzer: null, registrierung }
    const sessionId = request.cookies[SESSION_COOKIE]
    if (sessionId && request.cookies[SESSION_HINWEIS_COOKIE] !== '1') {
      // Ablauf kennen wir hier nicht exakt — Max-Age wie Session-Dauer reicht.
      reply.setCookie(SESSION_HINWEIS_COOKIE, '1', {
        path: '/',
        httpOnly: false,
        sameSite: 'lax',
        secure: konfig.hinterTls,
        maxAge: 30 * 24 * 60 * 60,
      })
    }
    const quota = await quotaStand(db, storage, benutzerStorage, request.benutzer.id, konfig.maxSpeicherProBenutzer)
    return {
      benutzer: request.benutzer,
      verifiziert: app.auth.istVerifiziert(request.benutzer.id),
      quota,
      registrierung,
      // Eine Spalte, kein Aufruf: Der Schalter der Kontoeinstellungen soll
      // beim Aufbau schon in der richtigen Lage stehen, und `/auth/me` ist die
      // Antwort, auf die diese Seite ohnehin wartet.
      newsletter: app.newsletter.stand(request.benutzer.id),
      profil: alsProfilAntwort(app, request.benutzer.id),
    }
  })

  // — Profil ändern —
  //
  // Der Handle läuft NICHT durch `setzeProfil`: Er kann als einziges Feld
  // scheitern (Form, reserviert, vergeben) und wird deshalb zuerst gesetzt —
  // ein 409 nach halb geschriebenem Profil wäre eine Lüge über den Zustand.
  // Die Prüfung im Browser bleibt reine Bequemlichkeit; entschieden wird hier.
  app.patch<{ Body: ProfilBody }>(
    '/api/auth/me/profil',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            // '' leert das Feld; fehlt es, bleibt es unverändert
            anzeigename: { type: 'string', maxLength: 80 },
            bio: { type: 'string', maxLength: 500 },
            ort: { type: 'string', maxLength: 80 },
            // Großzügig bemessen: Was keine Adresse ist, verwirft die
            // Normalisierung ohnehin (profilfelder.ts) — die Länge ist hier nur
            // der Riegel gegen ein hingeschicktes Megabyte.
            website: { type: 'string', maxLength: 300 },
            instagram: { type: 'string', maxLength: 300 },
            sichtbarkeit: { enum: ['private', 'public'] },
            handle: { type: 'string', maxLength: 30 },
            // Nur ein mitgelieferter Vorschlag; eigene Bilder gehen den Weg des
            // Avatars (PUT …/titelbild). '' entfernt das Bild.
            titelbild: { type: 'string', maxLength: 60 },
          },
        },
      },
    },
    async (request, reply) => {
      const benutzer = erfordereBenutzer(request, reply)
      if (!benutzer) return
      const { handle, titelbild, ...rest } = request.body
      if (handle !== undefined) {
        const fehler = app.auth.setzeHandle(benutzer.id, handle)
        if (fehler) return reply.code(fehler === 'vergeben' ? 409 : 400).send({ fehler: HANDLE_TEXTE[fehler] })
      }
      if (titelbild !== undefined) {
        const wert = titelbild.trim()
        if (wert && !istTitelbildVorschlag(wert)) {
          return reply.code(400).send({ fehler: 'Dieses Titelbild gibt es nicht.' })
        }
        // Der Wechsel auf einen Vorschlag räumt ein vorher hochgeladenes Bild
        // weg — sonst bliebe es als Waise im Storage liegen, unerreichbar und
        // trotzdem auf der Platte.
        const alt = app.auth.profil(benutzer.id)?.titelbild ?? null
        app.auth.setzeTitelbild(benutzer.id, wert || null)
        if (alt?.includes('/')) await benutzerStorage.loesche(benutzer.id, alt).catch(() => undefined)
      }
      app.auth.setzeProfil(benutzer.id, rest)
      return alsProfilAntwort(app, benutzer.id)
    },
  )

  // — Avatar hochladen (roher Bild-Body) —
  //
  // Der Dateiname trägt einen Zeitstempel: Ein fester Name würde nach einem
  // Wechsel aus dem Browser-Cache weiter das alte Bild liefern. Zählt nicht
  // gegen die Tour-Quota — ein Profilbild ist kein Reise-Inhalt.
  app.put('/api/auth/me/avatar', async (request, reply) => {
    const benutzer = erfordereBenutzer(request, reply)
    if (!benutzer) return
    const alt = app.auth.profil(benutzer.id)?.avatar ?? null
    const datei = `avatar/${Date.now()}.jpg`
    await benutzerStorage.schreibeStream(benutzer.id, datei, request.body as Readable, MAX_AVATAR_BYTES)
    app.auth.setzeAvatar(benutzer.id, datei)
    // Erst nach dem erfolgreichen Schreiben aufräumen — bricht der Upload ab,
    // bleibt das bisherige Bild bestehen.
    if (alt && alt !== datei) await benutzerStorage.loesche(benutzer.id, alt).catch(() => undefined)
    return { avatarUrl: avatarUrl(benutzer.id, datei) }
  })

  app.delete('/api/auth/me/avatar', async (request, reply) => {
    const benutzer = erfordereBenutzer(request, reply)
    if (!benutzer) return
    const alt = app.auth.profil(benutzer.id)?.avatar
    if (alt) await benutzerStorage.loesche(benutzer.id, alt).catch(() => undefined)
    app.auth.setzeAvatar(benutzer.id, null)
    return { ok: true }
  })

  // — Eigenes Titelbild hochladen —
  //
  // Derselbe Weg wie beim Avatar (Zeitstempel im Namen gegen den Cache, altes
  // Bild erst nach erfolgreichem Schreiben weg), nur großzügiger bemessen: Das
  // Banner ist 230 px hoch, aber über die ganze Seitenbreite — ein Bild, das
  // dort scharf sein soll, ist ein anderes Kaliber als ein 112-px-Kreis.
  //
  // Kein Zuschnitt: Das Banner ist ein fester Ausschnitt (`object-fit: cover`,
  // Mitte). Eine Zuschnitt-Oberfläche wäre ein eigenes Stück Arbeit, und ohne
  // sie ist das Ergebnis bei einem querformatigen Bild dasselbe.
  app.put('/api/auth/me/titelbild', async (request, reply) => {
    const benutzer = erfordereBenutzer(request, reply)
    if (!benutzer) return
    const alt = app.auth.profil(benutzer.id)?.titelbild ?? null
    const datei = `titelbild/${Date.now()}.jpg`
    await benutzerStorage.schreibeStream(benutzer.id, datei, request.body as Readable, MAX_TITELBILD_BYTES)
    app.auth.setzeTitelbild(benutzer.id, datei)
    // Nur eigene Dateien aufräumen — ein Vorschlag liegt im Build und gehört
    // allen (er hat keinen Schrägstrich, s. profilfelder.ts).
    if (alt?.includes('/') && alt !== datei) await benutzerStorage.loesche(benutzer.id, alt).catch(() => undefined)
    return { titelbildUrl: titelbildUrl(benutzer.id, datei) }
  })

  app.delete('/api/auth/me/titelbild', async (request, reply) => {
    const benutzer = erfordereBenutzer(request, reply)
    if (!benutzer) return
    const alt = app.auth.profil(benutzer.id)?.titelbild
    if (alt?.includes('/')) await benutzerStorage.loesche(benutzer.id, alt).catch(() => undefined)
    app.auth.setzeTitelbild(benutzer.id, null)
    return { ok: true }
  })

  // — Titelbild ausliefern (öffentlich, wie der Avatar) —
  app.get<{ Params: { id: string } }>('/api/benutzer/:id/titelbild', async (request, reply) => {
    const titelbild = app.auth.profil(request.params.id)?.titelbild
    // Ein Vorschlag wird hier NICHT ausgeliefert: Er liegt als statische Datei
    // im Build und geht nie durch die API.
    if (!titelbild?.includes('/')) return reply.code(404).send({ fehler: 'Kein Titelbild' })
    const info = await benutzerStorage.info(request.params.id, titelbild)
    if (!info) return reply.code(404).send({ fehler: 'Kein Titelbild' })
    return reply
      .header('content-type', 'image/jpeg')
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'public, max-age=31536000, immutable')
      .header('content-length', String(info.groesse))
      .send(benutzerStorage.leseStream(request.params.id, titelbild))
  })

  // — Avatar ausliefern (öffentlich) —
  //
  // Ohne Anmeldung, wie die Medien geteilter Touren: Ein Avatar erscheint neben
  // öffentlichen Touren in der Galerie und muss dort für jeden ladbar sein. Der
  // Dateiname wechselt bei jedem Upload, deshalb darf lange gecacht werden.
  app.get<{ Params: { id: string } }>('/api/benutzer/:id/avatar', async (request, reply) => {
    const profil = app.auth.profil(request.params.id)
    if (!profil?.avatar) return reply.code(404).send({ fehler: 'Kein Profilbild' })
    const info = await benutzerStorage.info(request.params.id, profil.avatar)
    if (!info) return reply.code(404).send({ fehler: 'Kein Profilbild' })
    return reply
      .header('content-type', 'image/jpeg')
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'public, max-age=31536000, immutable')
      .header('content-length', String(info.groesse))
      .send(benutzerStorage.leseStream(request.params.id, profil.avatar))
  })
}
