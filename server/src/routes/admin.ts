// Benutzerverwaltung: Konten anlegen, ändern, löschen — dazu Einladungen und
// der Schalter, ob Registrierungen überhaupt frei stehen.
//
// Jede Route hier liegt hinter `erfordereAdmin`. Drei Regeln ziehen sich durch,
// alle aus derselben Sorge — man soll sich nicht selbst die Tür zumauern:
//
//   1. Wer in der Konfiguration als Admin steht (`adminEmails`), lässt sich
//      weder herabstufen noch löschen. Sonst wäre die Änderung ohnehin nur bis
//      zum nächsten Start gültig (s. AuthDienst.hebeAdmins) — ein stiller
//      Rückfall ist schlimmer als ein ehrliches „geht nicht".
//   2. Das eigene Konto lässt sich nicht herabstufen oder löschen. Wer gehen
//      will, nimmt „Konto löschen" im Studio; dort steht die Warnung dazu.
//   3. Der letzte verbleibende Admin bleibt Admin.

import { erfordereAdmin } from '../app.js'
import { EmailVergebenFehler, type KontoAenderung, type Rolle } from '../auth/auth.js'
import { GUELTIG_TAGE_STANDARD } from '../auth/einladungen.js'
import { rendereMail, type MailBausteine } from '../maillayout.js'
import { beispielWerte, istVorlagenSchluessel, pruefeBausteine, vorlage } from '../mailvorlagen.js'
import { benutzteBytes } from '../quota.js'
import type { FastifyInstance } from 'fastify'

const emailSchema = { type: 'string', maxLength: 254 } as const
const EMAIL_FORM = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export type AdminStatistiken = {
  echtzeit: number
  heute: { aufrufe: number; besucher: number }
  letzte7Tage: { aufrufe: number; besucher: number }
  gesamt: number
  referrer: Array<{ quelle: string; anzahl: number }>
  seiten: Array<{ pfad: string; anzahl: number }>
}

async function holeUmamiStatistiken(): Promise<AdminStatistiken> {
  const leeresErgebnis: AdminStatistiken = {
    echtzeit: 0,
    heute: { aufrufe: 0, besucher: 0 },
    letzte7Tage: { aufrufe: 0, besucher: 0 },
    gesamt: 0,
    referrer: [],
    seiten: [],
  }
  try {
    const cmd = `
      SELECT COUNT(DISTINCT session_id) FROM website_event WHERE created_at >= NOW() - INTERVAL '5 minutes';
      SELECT COUNT(*), COUNT(DISTINCT session_id) FROM website_event WHERE created_at >= CURRENT_DATE;
      SELECT COUNT(*), COUNT(DISTINCT session_id) FROM website_event WHERE created_at >= NOW() - INTERVAL '7 days';
      SELECT COUNT(*) FROM website_event;
      SELECT referrer_domain, COUNT(*) as anzahl FROM website_event WHERE referrer_domain IS NOT NULL AND referrer_domain != '' GROUP BY referrer_domain ORDER BY anzahl DESC LIMIT 5;
      SELECT url_path, COUNT(*) as anzahl FROM website_event GROUP BY url_path ORDER BY anzahl DESC LIMIT 5;
    `
    const { stdout } = await execFileAsync('docker', [
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
    ], { timeout: 3000, env: { ...process.env, PGPASSWORD: 'UmamiSecurePGPass2026!' } })

    const zeilen = stdout.trim().split('\n').map((z) => z.trim()).filter(Boolean)
    if (zeilen.length < 4) return leeresErgebnis

    const echtzeit = parseInt(zeilen[0] || '0', 10) || 0

    const heuteTeile = (zeilen[1] || '').split('|')
    const heute = { aufrufe: parseInt(heuteTeile[0] || '0', 10) || 0, besucher: parseInt(heuteTeile[1] || '0', 10) || 0 }

    const tage7Teile = (zeilen[2] || '').split('|')
    const letzte7Tage = { aufrufe: parseInt(tage7Teile[0] || '0', 10) || 0, besucher: parseInt(tage7Teile[1] || '0', 10) || 0 }

    const gesamt = parseInt(zeilen[3] || '0', 10) || 0

    const referrer: Array<{ quelle: string; anzahl: number }> = []
    const seiten: Array<{ pfad: string; anzahl: number }> = []

    for (let i = 4; i < zeilen.length; i++) {
      const z = zeilen[i]
      if (!z) continue
      const teile = z.split('|')
      if (teile.length < 2) continue
      const name = teile[0] || ''
      const anzahl = parseInt(teile[1] || '0', 10) || 0
      if (name.startsWith('/')) {
        seiten.push({ pfad: name, anzahl })
      } else {
        referrer.push({ quelle: name, anzahl })
      }
    }

    return { echtzeit, heute, letzte7Tage, gesamt, referrer, seiten }
  } catch {
    return leeresErgebnis
  }
}

export function registriereAdminRouten(app: FastifyInstance): void {
  const { konfig, storage, benutzerStorage, db } = app.deps

  /** Steht die Adresse in der Konfiguration? Dann ist die Rolle unantastbar. */
  const festerAdmin = (email: string): boolean => konfig.adminEmails.includes(email.toLowerCase().trim())

  // — Statistiken —
  app.get('/api/admin/statistiken', async (request, reply) => {
    if (!erfordereAdmin(request, reply)) return
    return holeUmamiStatistiken()
  })

  // — Benutzer —

  // Die Speicherbelegung wird pro Konto aus dem Storage summiert (wie in
  // /auth/me). Das ist ein Verzeichnis-Durchlauf je Tour — bei der Größenordnung
  // dieser Instanz vernachlässigbar, und die Alternative wäre eine mitgeführte
  // Zählung, die driften kann.
  app.get('/api/admin/benutzer', async (request, reply) => {
    if (!erfordereAdmin(request, reply)) return
    const zeilen = app.auth.alleBenutzer()
    const benutzer = []
    for (const z of zeilen) {
      benutzer.push({
        ...z,
        fest: festerAdmin(z.email),
        speicher: await benutzteBytes(db, storage, benutzerStorage, z.id),
      })
    }
    return { benutzer, quotaLimit: konfig.maxSpeicherProBenutzer }
  })

  // Ein vom Admin angelegtes Konto gilt sofort als bestätigt: Die Bestätigung
  // beweist, dass die Adresse dem Anmelder gehört — hier hat ein Mensch das
  // Konto von Hand eingetragen, und eine Mail an eine Adresse, die er selbst
  // getippt hat, beweist nichts zusätzlich. Der Haken ist im Formular trotzdem
  // umschaltbar.
  app.post<{ Body: { email: string; passwort: string; name: string; rolle?: Rolle; verifiziert?: boolean } }>(
    '/api/admin/benutzer',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['email', 'passwort', 'name'],
          properties: {
            email: emailSchema,
            passwort: { type: 'string', minLength: 8, maxLength: 1024 },
            name: { type: 'string', minLength: 1, maxLength: 80 },
            rolle: { enum: ['nutzer', 'admin'] },
            verifiziert: { type: 'boolean' },
          },
        },
      },
    },
    async (request, reply) => {
      if (!erfordereAdmin(request, reply)) return
      const email = request.body.email.toLowerCase().trim()
      if (!EMAIL_FORM.test(email)) return reply.code(400).send({ fehler: 'Ungültige E-Mail-Adresse' })
      try {
        const benutzer = await app.auth.legeBenutzerAn(
          email,
          request.body.passwort,
          request.body.name.trim(),
          request.body.verifiziert ?? true,
          request.body.rolle ?? 'nutzer',
        )
        return reply.code(201).send({ benutzer })
      } catch (fehler) {
        if (fehler instanceof EmailVergebenFehler) return reply.code(409).send({ fehler: fehler.message })
        throw fehler
      }
    },
  )

  app.patch<{
    Params: { id: string }
    Body: KontoAenderung & { passwort?: string }
  }>(
    '/api/admin/benutzer/:id',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            email: emailSchema,
            name: { type: 'string', minLength: 1, maxLength: 80 },
            rolle: { enum: ['nutzer', 'admin'] },
            verifiziert: { type: 'boolean' },
            passwort: { type: 'string', minLength: 8, maxLength: 1024 },
          },
        },
      },
    },
    async (request, reply) => {
      const admin = erfordereAdmin(request, reply)
      if (!admin) return
      const ziel = app.auth.benutzerNachId(request.params.id)
      if (!ziel) return reply.code(404).send({ fehler: 'Unbekanntes Konto' })

      const entzug = request.body.rolle === 'nutzer' && ziel.rolle === 'admin'
      if (entzug && festerAdmin(ziel.email)) {
        return reply.code(409).send({ fehler: 'Diese Adresse ist in der Konfiguration als Admin gesetzt' })
      }
      if (entzug && ziel.id === admin.id) {
        return reply.code(409).send({ fehler: 'Die eigene Admin-Rolle lässt sich nicht ablegen' })
      }
      if (entzug && app.auth.anzahlAdmins() <= 1) {
        return reply.code(409).send({ fehler: 'Es muss mindestens einen Administrator geben' })
      }
      if (request.body.email !== undefined && !EMAIL_FORM.test(request.body.email.toLowerCase().trim())) {
        return reply.code(400).send({ fehler: 'Ungültige E-Mail-Adresse' })
      }

      const { passwort, ...felder } = request.body
      try {
        app.auth.aendereKonto(ziel.id, felder)
      } catch (fehler) {
        if (fehler instanceof EmailVergebenFehler) return reply.code(409).send({ fehler: fehler.message })
        throw fehler
      }
      // Ein neu gesetztes Passwort wirft alle Sitzungen und Token des Kontos
      // ab (setzePasswort) — genau richtig, wenn ein Admin es zurücksetzt.
      if (passwort) await app.auth.setzePasswort(ziel.id, passwort)
      return { benutzer: app.auth.benutzerNachId(ziel.id) }
    },
  )

  // Löschen räumt erst den Storage ab, dann die DB-Zeile (der Cascade nimmt
  // Touren, Sitzungen und Token mit) — dieselbe Reihenfolge wie beim
  // Selbst-Löschen in /auth/me, aus demselben Grund: danach weiß niemand mehr,
  // welche Dateien zu diesem Konto gehörten.
  app.delete<{ Params: { id: string } }>('/api/admin/benutzer/:id', async (request, reply) => {
    const admin = erfordereAdmin(request, reply)
    if (!admin) return
    const ziel = app.auth.benutzerNachId(request.params.id)
    if (!ziel) return reply.code(404).send({ fehler: 'Unbekanntes Konto' })
    if (ziel.id === admin.id) return reply.code(409).send({ fehler: 'Das eigene Konto lässt sich hier nicht löschen' })
    if (festerAdmin(ziel.email)) {
      return reply.code(409).send({ fehler: 'Diese Adresse ist in der Konfiguration als Admin gesetzt' })
    }
    if (ziel.rolle === 'admin' && app.auth.anzahlAdmins() <= 1) {
      return reply.code(409).send({ fehler: 'Es muss mindestens einen Administrator geben' })
    }
    for (const tourId of app.auth.tourIds(ziel.id)) await storage.loescheTour(tourId)
    await benutzerStorage.loescheTour(ziel.id).catch(() => undefined)
    app.auth.loescheBenutzer(ziel.id)
    return { ok: true }
  })

  // — Einladungen + Schalter —

  app.get('/api/admin/einladungen', async (request, reply) => {
    if (!erfordereAdmin(request, reply)) return
    return {
      einladungen: app.einladungen.alle(),
      einladungPflicht: app.einladungen.pflicht(),
      registrierungOffen: konfig.registrierungOffen,
      basisUrl: konfig.basisUrl,
    }
  })

  app.post<{ Body: { notiz?: string; gueltigTage?: number } }>(
    '/api/admin/einladungen',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            notiz: { type: 'string', maxLength: 120 },
            // 0 = läuft nicht ab
            gueltigTage: { type: 'integer', minimum: 0, maximum: 365 },
          },
        },
      },
    },
    async (request, reply) => {
      const admin = erfordereAdmin(request, reply)
      if (!admin) return
      const tage = request.body?.gueltigTage ?? GUELTIG_TAGE_STANDARD
      const einladung = app.einladungen.erstelle(admin.id, request.body?.notiz ?? null, tage || null)
      return reply.code(201).send({ einladung })
    },
  )

  app.delete<{ Params: { code: string } }>('/api/admin/einladungen/:code', async (request, reply) => {
    if (!erfordereAdmin(request, reply)) return
    if (!app.einladungen.widerrufe(request.params.code)) {
      return reply.code(404).send({ fehler: 'Unbekannter Code' })
    }
    return { ok: true }
  })

  // Beide Schalter über eine Route, beide optional: Der Aufrufer schickt, was
  // er umlegen will, und bekommt den ganzen Stand zurück — so kann die
  // Oberfläche nach jeder Änderung dasselbe rendern.
  app.patch<{ Body: { einladungPflicht?: boolean; wartelisteOffen?: boolean } }>(
    '/api/admin/einstellungen',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: { einladungPflicht: { type: 'boolean' }, wartelisteOffen: { type: 'boolean' } },
        },
      },
    },
    async (request, reply) => {
      if (!erfordereAdmin(request, reply)) return
      if (request.body.einladungPflicht !== undefined) app.einladungen.setzePflicht(request.body.einladungPflicht)
      if (request.body.wartelisteOffen !== undefined) app.warteliste.setzeOffen(request.body.wartelisteOffen)
      return { einladungPflicht: app.einladungen.pflicht(), wartelisteOffen: app.warteliste.offen() }
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
    required: ['betreff', 'titel', 'text', 'knopf', 'fuss'],
    properties: {
      betreff: { type: 'string', maxLength: 200 },
      titel: { type: 'string', maxLength: 200 },
      text: { type: 'string', maxLength: 4000 },
      knopf: { type: 'string', maxLength: 60 },
      fuss: { type: 'string', maxLength: 2000 },
    },
  } as const

  app.get('/api/admin/mailvorlagen', async (request, reply) => {
    if (!erfordereAdmin(request, reply)) return
    return { vorlagen: app.mailvorlagen.alle(), basisUrl: konfig.basisUrl }
  })

  app.patch<{ Params: { schluessel: string }; Body: MailBausteine }>(
    '/api/admin/mailvorlagen/:schluessel',
    { schema: { body: bausteinSchema } },
    async (request, reply) => {
      const admin = erfordereAdmin(request, reply)
      if (!admin) return
      const schluessel = request.params.schluessel
      if (!istVorlagenSchluessel(schluessel)) return reply.code(404).send({ fehler: 'Unbekannte Vorlage' })
      // Die Prüfung ist keine Formsache: Eine Mail ohne ihren Link ist für den
      // Empfänger eine Sackgasse — und auffallen würde das erst im Postfach.
      const probleme = pruefeBausteine(vorlage(schluessel), request.body)
      if (probleme.length) return reply.code(400).send({ fehler: probleme.join(' '), probleme })
      app.mailvorlagen.setze(schluessel, request.body, admin.id)
      return { vorlagen: app.mailvorlagen.alle() }
    },
  )

  app.delete<{ Params: { schluessel: string } }>('/api/admin/mailvorlagen/:schluessel', async (request, reply) => {
    if (!erfordereAdmin(request, reply)) return
    const schluessel = request.params.schluessel
    if (!istVorlagenSchluessel(schluessel)) return reply.code(404).send({ fehler: 'Unbekannte Vorlage' })
    app.mailvorlagen.setzeZurueck(schluessel)
    return { vorlagen: app.mailvorlagen.alle() }
  })

  // Vorschau der NOCH NICHT gespeicherten Fassung: Der Dialog schickt, was
  // gerade in den Feldern steht, und bekommt gerendertes HTML zurück. Serverseitig,
  // weil es sonst zwei Layouts gäbe — und das im Postfach wäre das andere.
  app.post<{ Params: { schluessel: string }; Body: MailBausteine }>(
    '/api/admin/mailvorlagen/:schluessel/vorschau',
    { schema: { body: bausteinSchema } },
    async (request, reply) => {
      if (!erfordereAdmin(request, reply)) return
      const schluessel = request.params.schluessel
      if (!istVorlagenSchluessel(schluessel)) return reply.code(404).send({ fehler: 'Unbekannte Vorlage' })
      const eintrag = vorlage(schluessel)
      const werte = beispielWerte(eintrag)
      const { betreff, text, html } = rendereVorschau(request.body, werte)
      return { betreff, text, html, probleme: pruefeBausteine(eintrag, request.body) }
    },
  )

  // Testmail an die eigene Adresse — der einzige Weg, das Ergebnis dort zu
  // sehen, wo es ankommt. Bewusst NUR an das eigene Konto: Ein Formularfeld für
  // den Empfänger machte aus der Verwaltung ein Versandwerkzeug.
  app.post<{ Params: { schluessel: string }; Body: { bausteine?: MailBausteine } }>(
    '/api/admin/mailvorlagen/:schluessel/test',
    {
      schema: {
        body: { type: 'object', additionalProperties: false, properties: { bausteine: bausteinSchema } },
      },
    },
    async (request, reply) => {
      const admin = erfordereAdmin(request, reply)
      if (!admin) return
      const schluessel = request.params.schluessel
      if (!istVorlagenSchluessel(schluessel)) return reply.code(404).send({ fehler: 'Unbekannte Vorlage' })
      const eintrag = vorlage(schluessel)
      // Ohne mitgeschickte Fassung die gespeicherte: So lässt sich auch aus der
      // Liste heraus testen, nicht nur aus dem offenen Dialog.
      const bausteine = request.body?.bausteine ?? app.mailvorlagen.bausteine(schluessel)
      const { betreff, text, html } = rendereVorschau(bausteine, beispielWerte(eintrag))
      try {
        await app.deps.mail.sende({ an: admin.email, betreff: `[Test] ${betreff}`, text, html })
      } catch (fehler) {
        app.log.error({ fehler }, 'Test-Mail konnte nicht versendet werden')
        return reply.code(502).send({ fehler: 'Die Testmail konnte nicht versendet werden' })
      }
      return { ok: true, an: admin.email }
    },
  )

  /** Beispielwerte einsetzen und rendern, ohne den gespeicherten Stand anzufassen. */
  function rendereVorschau(bausteine: MailBausteine, werte: Record<string, string>) {
    return rendereMail(bausteine, werte, { basisUrl: konfig.basisUrl, link: werte.link ?? `${konfig.basisUrl}/` })
  }

  // — Betriebsprotokoll —
  //
  // Nur lesen: Es gibt kein „Löschen", denn der Puffer ist ohnehin flüchtig
  // (s. protokoll.ts) — ein Knopf, der Spuren beseitigt, wäre die einzige
  // Wirkung. `seit` liefert nur das Neue: Die Ansicht fragt im Sekundentakt
  // nach, solange sie offen ist, und soll dabei nicht 500 Zeilen wiederholen.
  app.get<{ Querystring: { stufe?: string; seit?: string } }>('/api/admin/protokoll', async (request, reply) => {
    if (!erfordereAdmin(request, reply)) return
    const stufe = request.query.stufe === 'fehler' || request.query.stufe === 'warnung' ? request.query.stufe : undefined
    const seit = Number(request.query.seit)
    const alle = app.protokoll.liste({ ...(stufe ? { stufe } : {}) })
    const eintraege = Number.isFinite(seit) && seit > 0 ? alle.filter((e) => e.nr > seit) : alle
    return { eintraege, ...app.protokoll.zaehle(), gestartet: START_ZEIT }
  })
}

/**
 * Wann dieser Prozess hochkam — die Ansicht sagt damit „seit dem Neustart um
 * 14:02", statt einen leeren Puffer als „alles in Ordnung" auszugeben.
 */
const START_ZEIT = new Date().toISOString()
