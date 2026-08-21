// Benutzerverwaltung: Konten anlegen, ändern, löschen — dazu Einladungen und
// der Schalter, ob Registrierungen überhaupt frei stehen.
//
// Jede Route hier liegt hinter `requireAdmin`. Drei Regeln ziehen sich durch,
// alle aus derselben Sorge — man soll sich nicht selbst die Tür zumauern:
//
//   1. Wer in der Konfiguration als Admin steht (`adminEmails`), lässt sich
//      weder herabstufen noch löschen. Sonst wäre die Änderung ohnehin nur bis
//      zum nächsten Start gültig (s. AuthService.promoteAdmins) — ein stiller
//      Rückfall ist schlimmer als ein ehrliches „geht nicht".
//   2. Das eigene Konto lässt sich nicht herabstufen oder löschen. Wer gehen
//      will, nimmt „Konto löschen" im Studio; dort steht die Warnung dazu.
//   3. Der letzte verbleibende Admin bleibt Admin.

import { requireAdmin } from '../app.js'
import { EmailTakenError, type AccountUpdate, type Role } from '../auth/auth.js'
import { DEFAULT_VALID_DAYS } from '../auth/invitations.js'
import { renderMail, type MailParts } from '../mail-layout.js'
import { exampleValues, isTemplateKey, validateParts, getTemplate } from '../mail-templates.js'
import { usedBytes } from '../quota.js'
import type { FastifyInstance } from 'fastify'

const emailSchema = { type: 'string', maxLength: 254 } as const
const EMAIL_FORM = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export type AdminStats = {
  realtime: number
  today: { pageviews: number; visitors: number }
  last7Days: { pageviews: number; visitors: number }
  total: number
  referrer: Array<{ source: string; count: number }>
  pages: Array<{ path: string; count: number }>
}

/**
 * Zahlen der Reichweitenmessung aus der Umami-Datenbank (eigener Container auf
 * demselben Host, deshalb `docker exec … psql`).
 *
 * Das Passwort kommt aus `MAPTALE_UMAMI_DB_PASSWORD` und steht bewusst nirgends
 * im Quelltext. Fehlt es, gibt es keine Notfall-Vorgabe: Die Route liefert
 * dieselbe leere Auskunft wie bei jedem anderen Ausfall (Container weg, psql
 * langsam), und der Reiter zeigt Nullen statt einer Fehlerseite.
 */
async function holeUmamiStatistiken(dbPasswort: string | null): Promise<AdminStats> {
  const leeresErgebnis: AdminStats = {
    realtime: 0,
    today: { pageviews: 0, visitors: 0 },
    last7Days: { pageviews: 0, visitors: 0 },
    total: 0,
    referrer: [],
    pages: [],
  }
  if (!dbPasswort) return leeresErgebnis
  try {
    const cmd = `
      SELECT COUNT(DISTINCT session_id) FROM website_event WHERE created_at >= NOW() - INTERVAL '5 minutes';
      SELECT COUNT(*), COUNT(DISTINCT session_id) FROM website_event WHERE created_at >= CURRENT_DATE;
      SELECT COUNT(*), COUNT(DISTINCT session_id) FROM website_event WHERE created_at >= NOW() - INTERVAL '7 days';
      SELECT COUNT(*) FROM website_event;
      SELECT referrer_domain, COUNT(*) as anzahl FROM website_event WHERE referrer_domain IS NOT NULL AND referrer_domain != '' GROUP BY referrer_domain ORDER BY anzahl DESC LIMIT 5;
      SELECT url_path, COUNT(*) as anzahl FROM website_event GROUP BY url_path ORDER BY anzahl DESC LIMIT 5;
    `
    const { stdout } = await execFileAsync(
      'docker',
      [
        'exec',
        '-i',
        'umami-db-1',
        'psql',
        '-U',
        'umami',
        '-d',
        'umami',
        '-t',
        '-A',
        '-F',
        '|',
        '-c',
        cmd,
      ],
      { timeout: 3000, env: { ...process.env, PGPASSWORD: dbPasswort } },
    )

    const zeilen = stdout
      .trim()
      .split('\n')
      .map((z) => z.trim())
      .filter(Boolean)
    if (zeilen.length < 4) return leeresErgebnis

    const echtzeit = parseInt(zeilen[0] || '0', 10) || 0

    const heuteTeile = (zeilen[1] || '').split('|')
    const heute = {
      pageviews: parseInt(heuteTeile[0] || '0', 10) || 0,
      visitors: parseInt(heuteTeile[1] || '0', 10) || 0,
    }

    const tage7Teile = (zeilen[2] || '').split('|')
    const letzte7Tage = {
      pageviews: parseInt(tage7Teile[0] || '0', 10) || 0,
      visitors: parseInt(tage7Teile[1] || '0', 10) || 0,
    }

    const gesamt = parseInt(zeilen[3] || '0', 10) || 0

    const referrer: Array<{ source: string; count: number }> = []
    const seiten: Array<{ path: string; count: number }> = []

    for (let i = 4; i < zeilen.length; i++) {
      const z = zeilen[i]
      if (!z) continue
      const teile = z.split('|')
      if (teile.length < 2) continue
      const name = teile[0] || ''
      const anzahl = parseInt(teile[1] || '0', 10) || 0
      if (name.startsWith('/')) {
        seiten.push({ path: name, count: anzahl })
      } else {
        referrer.push({ source: name, count: anzahl })
      }
    }

    return {
      realtime: echtzeit,
      today: heute,
      last7Days: letzte7Tage,
      total: gesamt,
      referrer,
      pages: seiten,
    }
  } catch {
    return leeresErgebnis
  }
}

export function registerAdminRoutes(app: FastifyInstance): void {
  const { config, storage, userStorage, db } = app.deps

  /** Steht die Adresse in der Konfiguration? Dann ist die Rolle unantastbar. */
  const festerAdmin = (email: string): boolean =>
    config.adminEmails.includes(email.toLowerCase().trim())

  // — Statistiken —
  app.get('/api/admin/stats', async (request, reply) => {
    if (!requireAdmin(request, reply)) return
    return holeUmamiStatistiken(config.umamiDbPassword)
  })

  // — Benutzer —

  // Die Speicherbelegung wird pro Konto aus dem Storage summiert (wie in
  // /auth/me). Das ist ein Verzeichnis-Durchlauf je Tour — bei der Größenordnung
  // dieser Instanz vernachlässigbar, und die Alternative wäre eine mitgeführte
  // Zählung, die driften kann.
  app.get('/api/admin/users', async (request, reply) => {
    if (!requireAdmin(request, reply)) return
    const zeilen = app.auth.allUsers()
    const benutzer = []
    for (const z of zeilen) {
      benutzer.push({
        ...z,
        fixed: festerAdmin(z.email),
        storage: await usedBytes(db, storage, userStorage, z.id),
      })
    }
    return { users: benutzer, quotaLimit: config.maxStoragePerUser }
  })

  // Ein vom Admin angelegtes Konto gilt sofort als bestätigt: Die Bestätigung
  // beweist, dass die Adresse dem Anmelder gehört — hier hat ein Mensch das
  // Konto von Hand eingetragen, und eine Mail an eine Adresse, die er selbst
  // getippt hat, beweist nichts zusätzlich. Der Haken ist im Formular trotzdem
  // umschaltbar.
  app.post<{
    Body: { email: string; password: string; name: string; role?: Role; verified?: boolean }
  }>(
    '/api/admin/users',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['email', 'password', 'name'],
          properties: {
            email: emailSchema,
            password: { type: 'string', minLength: 8, maxLength: 1024 },
            name: { type: 'string', minLength: 1, maxLength: 80 },
            role: { enum: ['user', 'admin'] },
            verified: { type: 'boolean' },
          },
        },
      },
    },
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return
      const email = request.body.email.toLowerCase().trim()
      if (!EMAIL_FORM.test(email))
        return reply.code(400).send({ error: 'Ungültige E-Mail-Adresse' })
      try {
        const benutzer = await app.auth.createUser(
          email,
          request.body.password,
          request.body.name.trim(),
          request.body.verified ?? true,
          request.body.role ?? 'user',
        )
        return reply.code(201).send({ user: benutzer })
      } catch (fehler) {
        if (fehler instanceof EmailTakenError)
          return reply.code(409).send({ error: fehler.message })
        throw fehler
      }
    },
  )

  app.patch<{
    Params: { id: string }
    Body: AccountUpdate & { password?: string }
  }>(
    '/api/admin/users/:id',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            email: emailSchema,
            name: { type: 'string', minLength: 1, maxLength: 80 },
            role: { enum: ['user', 'admin'] },
            verified: { type: 'boolean' },
            password: { type: 'string', minLength: 8, maxLength: 1024 },
          },
        },
      },
    },
    async (request, reply) => {
      const admin = requireAdmin(request, reply)
      if (!admin) return
      const ziel = app.auth.userById(request.params.id)
      if (!ziel) return reply.code(404).send({ error: 'Unbekanntes Konto' })

      const entzug = request.body.role === 'user' && ziel.role === 'admin'
      if (entzug && festerAdmin(ziel.email)) {
        return reply
          .code(409)
          .send({ error: 'Diese Adresse ist in der Konfiguration als Admin gesetzt' })
      }
      if (entzug && ziel.id === admin.id) {
        return reply.code(409).send({ error: 'Die eigene Admin-Rolle lässt sich nicht ablegen' })
      }
      if (entzug && app.auth.adminCount() <= 1) {
        return reply.code(409).send({ error: 'Es muss mindestens einen Administrator geben' })
      }
      if (
        request.body.email !== undefined &&
        !EMAIL_FORM.test(request.body.email.toLowerCase().trim())
      ) {
        return reply.code(400).send({ error: 'Ungültige E-Mail-Adresse' })
      }

      const { password: passwort, ...felder } = request.body
      try {
        app.auth.updateAccount(ziel.id, felder)
      } catch (fehler) {
        if (fehler instanceof EmailTakenError)
          return reply.code(409).send({ error: fehler.message })
        throw fehler
      }
      // Ein neu gesetztes Passwort wirft alle Sitzungen und Token des Kontos
      // ab (setzePasswort) — genau richtig, wenn ein Admin es zurücksetzt.
      if (passwort) await app.auth.setPassword(ziel.id, passwort)
      return { user: app.auth.userById(ziel.id) }
    },
  )

  // Löschen räumt erst den Storage ab, dann die DB-Zeile (der Cascade nimmt
  // Touren, Sitzungen und Token mit) — dieselbe Reihenfolge wie beim
  // Selbst-Löschen in /auth/me, aus demselben Grund: danach weiß niemand mehr,
  // welche Dateien zu diesem Konto gehörten.
  app.delete<{ Params: { id: string } }>('/api/admin/users/:id', async (request, reply) => {
    const admin = requireAdmin(request, reply)
    if (!admin) return
    const ziel = app.auth.userById(request.params.id)
    if (!ziel) return reply.code(404).send({ error: 'Unbekanntes Konto' })
    if (ziel.id === admin.id)
      return reply.code(409).send({ error: 'Das eigene Konto lässt sich hier nicht löschen' })
    if (festerAdmin(ziel.email)) {
      return reply
        .code(409)
        .send({ error: 'Diese Adresse ist in der Konfiguration als Admin gesetzt' })
    }
    if (ziel.role === 'admin' && app.auth.adminCount() <= 1) {
      return reply.code(409).send({ error: 'Es muss mindestens einen Administrator geben' })
    }
    for (const tourId of app.auth.tourIds(ziel.id)) await storage.removeTour(tourId)
    await userStorage.removeTour(ziel.id).catch(() => undefined)
    app.auth.deleteUser(ziel.id)
    return { ok: true }
  })

  // — Einladungen + Schalter —

  app.get('/api/admin/invitations', async (request, reply) => {
    if (!requireAdmin(request, reply)) return
    return {
      invitations: app.invitations.all(),
      invitationRequired: app.invitations.required(),
      registrationOpen: config.registrationOpen,
      baseUrl: config.baseUrl,
    }
  })

  app.post<{ Body: { note?: string; validDays?: number } }>(
    '/api/admin/invitations',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            note: { type: 'string', maxLength: 120 },
            // 0 = läuft nicht ab
            validDays: { type: 'integer', minimum: 0, maximum: 365 },
          },
        },
      },
    },
    async (request, reply) => {
      const admin = requireAdmin(request, reply)
      if (!admin) return
      const tage = request.body?.validDays ?? DEFAULT_VALID_DAYS
      const einladung = app.invitations.create(admin.id, request.body?.note ?? null, tage || null)
      return reply.code(201).send({ invitation: einladung })
    },
  )

  app.delete<{ Params: { code: string } }>(
    '/api/admin/invitations/:code',
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return
      if (!app.invitations.revoke(request.params.code)) {
        return reply.code(404).send({ error: 'Unbekannter Code' })
      }
      return { ok: true }
    },
  )

  // Beide Schalter über eine Route, beide optional: Der Aufrufer schickt, was
  // er umlegen will, und bekommt den ganzen Stand zurück — so kann die
  // Oberfläche nach jeder Änderung dasselbe rendern.
  app.patch<{ Body: { invitationRequired?: boolean; waitlistOpen?: boolean } }>(
    '/api/admin/settings',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            invitationRequired: { type: 'boolean' },
            waitlistOpen: { type: 'boolean' },
          },
        },
      },
    },
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return
      if (request.body.invitationRequired !== undefined)
        app.invitations.setRequired(request.body.invitationRequired)
      if (request.body.waitlistOpen !== undefined) app.waitlist.setOpen(request.body.waitlistOpen)
      return {
        invitationRequired: app.invitations.required(),
        waitlistOpen: app.waitlist.open(),
      }
    },
  )

  // — System-Mails —
  //
  // Bearbeitet werden die WORTE, nicht das HTML (Begründung in mailvorlagen.ts).
  // Deshalb nimmt die Route fünf Textfelder und rendert selbst — die Oberfläche
  // schickt niemals Markup, und die Vorschau zeigt garantiert dasselbe Layout,
  // das später im Postfach steht.

  const bausteinSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['subject', 'title', 'text', 'button', 'footer'],
    properties: {
      subject: { type: 'string', maxLength: 200 },
      title: { type: 'string', maxLength: 200 },
      text: { type: 'string', maxLength: 4000 },
      button: { type: 'string', maxLength: 60 },
      footer: { type: 'string', maxLength: 2000 },
    },
  } as const

  app.get('/api/admin/mail-templates', async (request, reply) => {
    if (!requireAdmin(request, reply)) return
    return { templates: app.mailTemplates.alle(), baseUrl: config.baseUrl }
  })

  app.patch<{ Params: { key: string }; Body: MailParts }>(
    '/api/admin/mail-templates/:key',
    { schema: { body: bausteinSchema } },
    async (request, reply) => {
      const admin = requireAdmin(request, reply)
      if (!admin) return
      const schluessel = request.params.key
      if (!isTemplateKey(schluessel)) return reply.code(404).send({ error: 'Unbekannte Vorlage' })
      // Die Prüfung ist keine Formsache: Eine Mail ohne ihren Link ist für den
      // Empfänger eine Sackgasse — und auffallen würde das erst im Postfach.
      const probleme = validateParts(getTemplate(schluessel), request.body)
      if (probleme.length)
        return reply.code(400).send({ error: probleme.join(' '), issues: probleme })
      app.mailTemplates.setze(schluessel, request.body, admin.id)
      return { templates: app.mailTemplates.alle() }
    },
  )

  app.delete<{ Params: { key: string } }>(
    '/api/admin/mail-templates/:key',
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return
      const schluessel = request.params.key
      if (!isTemplateKey(schluessel)) return reply.code(404).send({ error: 'Unbekannte Vorlage' })
      app.mailTemplates.setzeZurueck(schluessel)
      return { templates: app.mailTemplates.alle() }
    },
  )

  // Vorschau der NOCH NICHT gespeicherten Fassung: Der Dialog schickt, was
  // gerade in den Feldern steht, und bekommt gerendertes HTML zurück. Serverseitig,
  // weil es sonst zwei Layouts gäbe — und das im Postfach wäre das andere.
  app.post<{ Params: { key: string }; Body: MailParts }>(
    '/api/admin/mail-templates/:key/preview',
    { schema: { body: bausteinSchema } },
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return
      const schluessel = request.params.key
      if (!isTemplateKey(schluessel)) return reply.code(404).send({ error: 'Unbekannte Vorlage' })
      const eintrag = getTemplate(schluessel)
      const werte = exampleValues(eintrag)
      const { betreff, text, html } = rendereVorschau(request.body, werte)
      return { subject: betreff, text, html, issues: validateParts(eintrag, request.body) }
    },
  )

  // Testmail an die eigene Adresse — der einzige Weg, das Ergebnis dort zu
  // sehen, wo es ankommt. Bewusst NUR an das eigene Konto: Ein Formularfeld für
  // den Empfänger machte aus der Verwaltung ein Versandwerkzeug.
  app.post<{ Params: { key: string }; Body: { blocks?: MailParts } }>(
    '/api/admin/mail-templates/:key/test',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: { blocks: bausteinSchema },
        },
      },
    },
    async (request, reply) => {
      const admin = requireAdmin(request, reply)
      if (!admin) return
      const schluessel = request.params.key
      if (!isTemplateKey(schluessel)) return reply.code(404).send({ error: 'Unbekannte Vorlage' })
      const eintrag = getTemplate(schluessel)
      // Ohne mitgeschickte Fassung die gespeicherte: So lässt sich auch aus der
      // Liste heraus testen, nicht nur aus dem offenen Dialog.
      const bausteine = request.body?.blocks ?? app.mailTemplates.bausteine(schluessel)
      const { betreff, text, html } = rendereVorschau(bausteine, exampleValues(eintrag))
      try {
        await app.deps.mail.sende({ an: admin.email, betreff: `[Test] ${betreff}`, text, html })
      } catch (fehler) {
        app.log.error({ fehler }, 'Test-Mail konnte nicht versendet werden')
        return reply.code(502).send({ error: 'Die Testmail konnte nicht versendet werden' })
      }
      return { ok: true, to: admin.email }
    },
  )

  /** Beispielwerte einsetzen und rendern, ohne den gespeicherten Stand anzufassen. */
  function rendereVorschau(bausteine: MailParts, werte: Record<string, string>) {
    return renderMail(bausteine, werte, {
      basisUrl: config.baseUrl,
      link: werte.link ?? `${config.baseUrl}/`,
    })
  }

  // — Betriebsprotokoll —
  //
  // Nur lesen: Es gibt kein „Löschen", denn der Puffer ist ohnehin flüchtig
  // (s. audit-log.ts) — ein Knopf, der Spuren beseitigt, wäre die einzige
  // Wirkung. `since` liefert nur das Neue: Die Ansicht fragt im Sekundentakt
  // nach, solange sie offen ist, und soll dabei nicht 500 Zeilen wiederholen.
  app.get<{ Querystring: { level?: string; since?: string } }>(
    '/api/admin/audit-log',
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return
      const severity =
        request.query.level === 'failed' || request.query.level === 'warning'
          ? request.query.level
          : undefined
      const seit = Number(request.query.since)
      const alle = app.auditLog.list({ ...(severity ? { severity } : {}) })
      const eintraege = Number.isFinite(seit) && seit > 0 ? alle.filter((e) => e.no > seit) : alle
      return { entries: eintraege, ...app.auditLog.count(), startedAt: START_ZEIT }
    },
  )
}

/**
 * Wann dieser Prozess hochkam — die Ansicht sagt damit „seit dem Neustart um
 * 14:02", statt einen leeren Puffer als „alles in Ordnung" auszugeben.
 */
const START_ZEIT = new Date().toISOString()
