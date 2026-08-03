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
import { benutzteBytes } from '../quota.js'
import type { FastifyInstance } from 'fastify'

const emailSchema = { type: 'string', maxLength: 254 } as const
const EMAIL_FORM = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export function registriereAdminRouten(app: FastifyInstance): void {
  const { konfig, storage, benutzerStorage, db } = app.deps

  /** Steht die Adresse in der Konfiguration? Dann ist die Rolle unantastbar. */
  const festerAdmin = (email: string): boolean => konfig.adminEmails.includes(email.toLowerCase().trim())

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
}
