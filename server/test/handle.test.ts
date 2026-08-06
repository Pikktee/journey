// Der Handle — die Adresse einer Person (`maptale.io/@henrik`).
//
// Geprüft wird hier, was nur der Server entscheiden kann: Vergabe beim Anlegen,
// Kollisionen, die 90-Tage-Sperre nach einer Änderung und das Weiterleiten
// alter Adressen. Form und reservierte Wörter liegen in src/handle.ts und
// werden im Web-Projekt geprüft (test/handle.test.ts) — der Drift-Wächter in
// test/routen.test.ts hält beide Kopien zusammen.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { oeffneDb } from '../src/db.js'
import { freierHandle, handleAusEmail } from '../src/handle.js'
import { baueTestApp, type TestUmgebung } from './helfer.js'

async function patch(u: TestUmgebung, payload: Record<string, unknown>) {
  return u.app.inject({ method: 'PATCH', url: '/api/auth/me/profil', cookies: u.cookies, payload })
}

async function meinHandle(u: TestUmgebung): Promise<string | null> {
  const antwort = await u.app.inject({ method: 'GET', url: '/api/auth/me', cookies: u.cookies })
  return (antwort.json() as { profil: { handle: string | null } }).profil.handle
}

function nutzerId(u: TestUmgebung): string {
  return (u.app.deps.db.prepare('SELECT id FROM users LIMIT 1').get() as { id: string }).id
}

describe('handleAusEmail', () => {
  it('nimmt den lokalen Teil ohne Plus-Zusatz', () => {
    expect(handleAusEmail('mira.wolf@example.com')).toBe('mira.wolf')
    expect(handleAusEmail('mira+maptale@example.com')).toBe('mira')
    expect(handleAusEmail('Henrik.Süd@example.com')).toBe('henrik.sued')
  })

  it('erfindet einen Stamm, wo nichts Brauchbares übrig bleibt', () => {
    // „ä@…" ergäbe sonst einen leeren Handle — der Zähler macht daraus
    // „reisende", „reisende2" …
    expect(handleAusEmail('ä@example.com')).toBe('reisende')
    expect(handleAusEmail('ab@example.com')).toBe('reisende')
  })
})

describe('freierHandle', () => {
  it('hängt erst bei Kollision einen Zähler an', () => {
    const belegt = new Set(['henrik', 'henrik2'])
    expect(freierHandle('anna', (h) => belegt.has(h))).toBe('anna')
    expect(freierHandle('henrik', (h) => belegt.has(h))).toBe('henrik3')
  })

  it('weicht reservierten Wörtern aus', () => {
    // `admin@maptale.io` darf nicht zu `/@admin` werden
    expect(freierHandle('admin', () => false)).toBe('admin2')
  })

  it('hält die 30 Zeichen ein, indem der Zähler hineinschneidet', () => {
    const lang = 'a'.repeat(30)
    const ergebnis = freierHandle(lang, (h) => h === lang)
    expect(ergebnis).toHaveLength(30)
    expect(ergebnis.endsWith('2')).toBe(true)
  })
})

describe('Vergabe', () => {
  it('gibt jedem neuen Konto sofort eine Adresse', async () => {
    const u = await baueTestApp()
    expect(await meinHandle(u)).toBe('test')
  })

  it('zählt hoch, wenn der Name schon vergeben ist', async () => {
    const u = await baueTestApp()
    const zweiter = await u.app.auth.legeBenutzerAn('test@anders.example', 'geheim123', 'Zweite')
    expect(u.app.auth.handleVon(zweiter.id)).toBe('test2')
  })
})

describe('Handle ändern', () => {
  it('setzt einen neuen und liefert ihn zurück', async () => {
    const u = await baueTestApp()
    const antwort = await patch(u, { handle: 'henrik' })
    expect(antwort.statusCode).toBe(200)
    expect((antwort.json() as { handle: string }).handle).toBe('henrik')
    expect(await meinHandle(u)).toBe('henrik')
  })

  it('nimmt Großschreibung und Leerraum an, speichert aber klein', async () => {
    // Groß/Klein unterscheidet in einer URL nicht — ein gemischtes @Henrik wäre
    // Zierde mit Fehlerquelle.
    const u = await baueTestApp()
    await patch(u, { handle: '  Henrik  ' })
    expect(await meinHandle(u)).toBe('henrik')
  })

  it('derselbe Handle noch einmal ist kein Fehler', async () => {
    const u = await baueTestApp()
    await patch(u, { handle: 'henrik' })
    expect((await patch(u, { handle: 'henrik' })).statusCode).toBe(200)
    expect((await patch(u, { handle: 'HENRIK' })).statusCode).toBe(200)
  })

  it('lehnt Form, reservierte Wörter und den ID-Präfix ab', async () => {
    const u = await baueTestApp()
    expect((await patch(u, { handle: 'ab' })).statusCode).toBe(400)
    expect((await patch(u, { handle: '-anna' })).statusCode).toBe(400)
    expect((await patch(u, { handle: 'galerie' })).statusCode).toBe(400)
    expect((await patch(u, { handle: 'u_fremd' })).statusCode).toBe(400)
    expect((await patch(u, { handle: 'x'.repeat(31) })).statusCode).toBe(400)
    // Nichts davon hat den Bestand angerührt
    expect(await meinHandle(u)).toBe('test')
  })

  it('lehnt einen fremden Handle mit 409 ab', async () => {
    const u = await baueTestApp()
    await u.app.auth.legeBenutzerAn('anna@example.com', 'geheim123', 'Anna')
    const antwort = await patch(u, { handle: 'anna' })
    expect(antwort.statusCode).toBe(409)
    expect(await meinHandle(u)).toBe('test')
  })

  it('lässt das übrige Profil unangetastet, wenn der Handle scheitert', async () => {
    // Sonst wäre die 409-Antwort eine Lüge über den Zustand: Bio geschrieben,
    // Adresse nicht.
    const u = await baueTestApp()
    await u.app.auth.legeBenutzerAn('anna@example.com', 'geheim123', 'Anna')
    await patch(u, { handle: 'anna', bio: 'Neue Bio' })
    const me = (await u.app.inject({ method: 'GET', url: '/api/auth/me', cookies: u.cookies })).json() as {
      profil: { bio: string | null }
    }
    expect(me.profil.bio).toBeNull()
  })
})

describe('90-Tage-Sperre', () => {
  it('hält den aufgegebenen Handle für andere fest', async () => {
    const u = await baueTestApp()
    await patch(u, { handle: 'henrik' })
    const anna = await u.app.auth.legeBenutzerAn('anna@example.com', 'geheim123', 'Anna')
    // Anna kann Henriks alte Adresse nicht übernehmen — sonst erbte sie alle
    // Links, die noch auf ihn zeigen.
    expect(u.app.auth.setzeHandle(anna.id, 'test')).toBe('vergeben')
  })

  it('lässt den früheren Besitzer zurück', async () => {
    const u = await baueTestApp()
    await patch(u, { handle: 'henrik' })
    expect((await patch(u, { handle: 'test' })).statusCode).toBe(200)
  })

  it('gibt die Adresse frei, sobald die Frist um ist', async () => {
    const u = await baueTestApp()
    await patch(u, { handle: 'henrik' })
    u.app.deps.db.prepare('UPDATE handles_reserviert SET frei_ab = ?').run('2020-01-01T00:00:00.000Z')
    const anna = await u.app.auth.legeBenutzerAn('anna@example.com', 'geheim123', 'Anna')
    expect(u.app.auth.setzeHandle(anna.id, 'test')).toBeNull()
  })
})

describe('Profil unter der Adresse', () => {
  async function oeffentlichesProfil(u: TestUmgebung): Promise<void> {
    await patch(u, { anzeigename: 'Reisende', sichtbarkeit: 'public' })
  }

  it('antwortet auf den Handle wie auf die ID', async () => {
    const u = await baueTestApp()
    await oeffentlichesProfil(u)
    const perHandle = await u.app.inject({ method: 'GET', url: '/api/benutzer/test/profil' })
    const perId = await u.app.inject({ method: 'GET', url: `/api/benutzer/${nutzerId(u)}/profil` })
    expect(perHandle.statusCode).toBe(200)
    expect(perHandle.json()).toEqual(perId.json())
    expect((perHandle.json() as { handle: string }).handle).toBe('test')
  })

  it('führt einen aufgegebenen Handle weiter zur Person', async () => {
    // Geteilte Links leben lange — sie dürfen an einer Namensänderung nicht
    // zerbrechen.
    const u = await baueTestApp()
    await oeffentlichesProfil(u)
    await patch(u, { handle: 'henrik' })
    const alt = await u.app.inject({ method: 'GET', url: '/api/benutzer/test/profil' })
    expect(alt.statusCode).toBe(200)
    // Die Antwort nennt die KANONISCHE Adresse, damit die Seite umschreiben kann
    expect((alt.json() as { handle: string }).handle).toBe('henrik')
  })

  it('antwortet auf einen unbekannten Handle mit 404', async () => {
    const u = await baueTestApp()
    await oeffentlichesProfil(u)
    expect((await u.app.inject({ method: 'GET', url: '/api/benutzer/niemand/profil' })).statusCode).toBe(404)
  })

  it('verrät ohne freigegebenes Profil nicht einmal, dass es die Adresse gibt', async () => {
    const u = await baueTestApp()
    await patch(u, { anzeigename: 'Reisende' })
    const privat = await u.app.inject({ method: 'GET', url: '/api/benutzer/test/profil' })
    expect(privat.statusCode).toBe(404)
  })
})

describe('Migration für Bestandskonten', () => {
  it('vergibt Handles deterministisch nach Anlegedatum', async () => {
    // Der Zustand vor der Migration wird nachgestellt: Handles weg,
    // user_version zurück — beim nächsten Öffnen läuft Schritt 11 erneut.
    const verzeichnis = mkdtempSync(join(tmpdir(), 'maptale-handle-'))
    const pfad = join(verzeichnis, 'test.db')
    try {
      const vorbereitung = oeffneDb(pfad)
      const stand = vorbereitung.pragma('user_version', { simple: true }) as number
      const anlegen = vorbereitung.prepare(
        "INSERT INTO users (id, email, pw_hash, name, created_at) VALUES (?, ?, 'x', ?, ?)",
      )
      anlegen.run('u_alt1', 'mira.wolf@example.com', 'Mira', '2026-01-01T00:00:00.000Z')
      anlegen.run('u_alt2', 'mira.wolf@anders.example', 'Mira Zwei', '2026-02-01T00:00:00.000Z')
      anlegen.run('u_alt3', 'admin@example.com', 'Chef', '2026-03-01T00:00:00.000Z')
      vorbereitung.exec('UPDATE users SET handle = NULL')
      vorbereitung.pragma(`user_version = ${stand - 1}`)
      vorbereitung.close()

      const db = oeffneDb(pfad)
      const handles = Object.fromEntries(
        (db.prepare('SELECT id, handle FROM users').all() as Array<{ id: string; handle: string }>).map((z) => [
          z.id,
          z.handle,
        ]),
      )
      // Wer zuerst da war, bekommt den kurzen Namen; reservierte Wörter fallen aus
      expect(handles).toEqual({ u_alt1: 'mira.wolf', u_alt2: 'mira.wolf2', u_alt3: 'admin2' })
      db.close()
    } finally {
      rmSync(verzeichnis, { recursive: true, force: true })
    }
  })

  it('legt den UNIQUE-Index ohne Rücksicht auf Groß/Klein an', () => {
    // Zwei Konten „@Henrik" und „@henrik" wären dieselbe Adresse mit zwei
    // Besitzern — die Datenbank muss das ausschließen, nicht erst der Code.
    const db = oeffneDb(':memory:')
    const anlegen = db.prepare(
      "INSERT INTO users (id, email, pw_hash, name, created_at, handle) VALUES (?, ?, 'x', 'N', '2026-01-01', ?)",
    )
    anlegen.run('u_1', 'a@x.de', 'henrik')
    expect(() => anlegen.run('u_2', 'b@x.de', 'Henrik')).toThrow(/UNIQUE/)
    db.close()
  })
})
