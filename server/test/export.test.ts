// Datenexport (Art. 20 DSGVO): Auftragsverwaltung, Inhalt, Fristen.
//
// Zwei Dinge kann man hier nur mit Tests festhalten, weil sie sich im Betrieb
// nie zeigen, solange sie klappen: dass ein zweiter Klick keinen zweiten Lauf
// startet (die Sekunde dazwischen sieht niemand), und dass abgelaufene Archive
// wirklich verschwinden — nicht bloß unerreichbar werden.
import { describe, expect, it } from 'vitest'
import { ExportDienst, FRIST_STUNDEN, baueArchiv } from '../src/export.js'
import { istGepackt, liesmich, tourOrdner } from '../src/exportinhalt.js'
import { sammleEintraege, sammleKonto, sammleTouren } from '../src/exportlauf.js'
import { alsGroesse } from '../src/routes/export.js'
import { MemStorage } from '../src/storage.js'
import { baueTestApp, beispielManifest, type TestUmgebung } from './helfer.js'

/** Alle Bytes eines Stroms — für die Archiv-Prüfungen. */
async function alsBuffer(strom: NodeJS.ReadableStream): Promise<Buffer> {
  const teile: Buffer[] = []
  for await (const stueck of strom) teile.push(Buffer.from(stueck as Buffer))
  return Buffer.concat(teile)
}

/**
 * Die Dateinamen in einem ZIP — aus dem Central Directory gelesen.
 *
 * Bewusst ohne Entpack-Bibliothek: Der Test soll prüfen, dass ein GÜLTIGES
 * Archiv entsteht, und dafür ist das Lesen der Struktur aussagekräftiger als
 * ein zweites Werkzeug, das dieselbe Bibliothek noch einmal verwendet.
 */
function zipNamen(buf: Buffer): string[] {
  const namen: string[] = []
  // Local File Header: PK\x03\x04, Dateiname ab Byte 30, Länge bei 26.
  for (let i = 0; i < buf.length - 4; i++) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x03 && buf[i + 3] === 0x04) {
      const nameLen = buf.readUInt16LE(i + 26)
      namen.push(buf.subarray(i + 30, i + 30 + nameLen).toString('utf8'))
    }
  }
  return namen
}

async function legeTourAn(u: TestUmgebung, no: string, title: string): Promise<string> {
  const a = await u.app.inject({
    method: 'POST',
    url: '/api/tours',
    cookies: u.cookies,
    payload: { ...beispielManifest(), clientTourId: `ct-${no}` },
  })
  const id = (a.json() as { id: string }).id
  u.app.deps.db
    .prepare('UPDATE tours SET title = ?, status = ? WHERE id = ?')
    .run(title, 'ready', id)
  await u.storage.schreibe(id, 'tour.json', JSON.stringify({ id, title }))
  await u.storage.schreibe(id, 'media/m1.w1920.jpg', Buffer.from('fake-jpeg'))
  await u.storage.schreibe(id, 'enrichment.json', JSON.stringify({ intern: true }))
  return id
}

describe('Auftragsverwaltung', () => {
  it('startet auf zwei Anforderungen hintereinander nur EINEN Lauf', async () => {
    // Der Kern der Aufgabe. Der Schutz liegt im partiellen UNIQUE-Index, nicht
    // in einer Prüfung im Code — zwischen SELECT und INSERT läge sonst ein
    // Fenster, in dem beide Anfragen dasselbe sehen.
    const u = await baueTestApp()
    const wer = u.app.auth.benutzerAusSession(u.cookies.maptale_session)!.id
    const erste = u.app.exporte.fordereAn(wer)
    const zweite = u.app.exporte.fordereAn(wer)
    expect(erste.neu).toBe(true)
    expect(zweite.neu).toBe(false)
    expect(zweite.stand.id).toBe(erste.stand.id)
    const alle = u.app.deps.db.prepare('SELECT count(*) n FROM data_exports').get() as { n: number }
    expect(alle.n).toBe(1)
  })

  it('lässt nach einem fertigen Auftrag einen neuen zu', async () => {
    const u = await baueTestApp()
    const wer = u.app.auth.benutzerAusSession(u.cookies.maptale_session)!.id
    const erste = u.app.exporte.fordereAn(wer)
    u.app.exporte.melde(erste.stand.id, 100, 3)
    expect(u.app.exporte.fordereAn(wer).neu).toBe(true)
  })

  it('setzt die Frist ab der FERTIGSTELLUNG', async () => {
    const u = await baueTestApp()
    const wer = u.app.auth.benutzerAusSession(u.cookies.maptale_session)!.id
    const a = u.app.exporte.fordereAn(wer)
    const fertig = u.app.exporte.melde(a.stand.id, 100, 3)
    const spanne = new Date(fertig!.expiresAt!).getTime() - new Date(fertig!.finishedAt!).getTime()
    expect(Math.round(spanne / 3_600_000)).toBe(FRIST_STUNDEN)
  })

  it('gibt ein abgelaufenes Archiv nicht mehr heraus', async () => {
    const db = (await baueTestApp()).app.deps.db
    const archive = new MemStorage()
    let jetzt = new Date('2026-08-06T10:00:00Z')
    const dienst = new ExportDienst(db, archive, () => jetzt)
    db.prepare(
      `INSERT INTO users (id, email, pw_hash, name, created_at, handle) VALUES ('u_9','a@b.c','x','A','2026-01-01','a9')`,
    ).run()
    const a = dienst.fordereAn('u_9')
    dienst.melde(a.stand.id, 10, 1)
    expect(dienst.abrufbar(a.stand.id)).not.toBeNull()
    jetzt = new Date('2026-08-08T11:00:00Z') // 49 Stunden später
    expect(dienst.abrufbar(a.stand.id)).toBeNull()
  })

  it('löscht abgelaufene Archive samt Datei', async () => {
    // „Abgelaufen" muss WEG heißen, nicht „unerreichbar" — sonst läge ein ZIP
    // mit allen Fotos einer Person unbegrenzt herum.
    const db = (await baueTestApp()).app.deps.db
    const archive = new MemStorage()
    let jetzt = new Date('2026-08-06T10:00:00Z')
    const dienst = new ExportDienst(db, archive, () => jetzt)
    db.prepare(
      `INSERT INTO users (id, email, pw_hash, name, created_at, handle) VALUES ('u_8','c@d.e','x','A','2026-01-01','a8')`,
    ).run()
    const a = dienst.fordereAn('u_8')
    await archive.schreibe(a.stand.id, 'maptale-export.zip', Buffer.from('inhalt'))
    dienst.melde(a.stand.id, 6, 1)
    jetzt = new Date('2026-08-09T10:00:00Z')
    expect(await dienst.raeumeAuf()).toBe(1)
    expect(await archive.info(a.stand.id, 'maptale-export.zip')).toBeNull()
    expect(db.prepare('SELECT count(*) n FROM data_exports').get()).toEqual({ n: 0 })
  })

  it('befreit ein Konto, dessen Lauf abgestürzt ist', async () => {
    // Ohne das bliebe es für immer im Zustand „läuft" — der UNIQUE-Index
    // ließe keinen zweiten Auftrag zu, und niemand käme je an seine Daten.
    const db = (await baueTestApp()).app.deps.db
    let jetzt = new Date('2026-08-06T10:00:00Z')
    const dienst = new ExportDienst(db, new MemStorage(), () => jetzt)
    db.prepare(
      `INSERT INTO users (id, email, pw_hash, name, created_at, handle) VALUES ('u_7','e@f.g','x','A','2026-01-01','a7')`,
    ).run()
    dienst.fordereAn('u_7')
    jetzt = new Date('2026-08-06T17:00:00Z') // sieben Stunden später
    await dienst.raeumeAuf()
    expect(dienst.fordereAn('u_7').neu).toBe(true)
  })
})

describe('Konto löschen', () => {
  it('nimmt das Export-Archiv mit', async () => {
    // Die Zeile fällt dem Cascade zum Opfer; ohne sie findet der stündliche
    // Aufräumer die Datei nie wieder, und ein ZIP mit ALLEN Daten des
    // gelöschten Kontos bliebe für immer liegen.
    const u = await baueTestApp()
    const wer = u.app.auth.benutzerAusSession(u.cookies.maptale_session)!.id
    const a = u.app.exporte.fordereAn(wer)
    await u.archive.schreibe(a.stand.id, 'maptale-export.zip', Buffer.from('daten'))
    u.app.exporte.melde(a.stand.id, 5, 1)

    const weg = await u.app.inject({ method: 'DELETE', url: '/api/auth/me', cookies: u.cookies })
    expect(weg.statusCode).toBe(200)
    expect(await u.archive.info(a.stand.id, 'maptale-export.zip')).toBeNull()
  })
})

describe('Download-Token', () => {
  it('gilt nur mit gültiger Signatur', () => {
    const t = ExportDienst.token('x_abc', 'geheim')
    expect(ExportDienst.ausToken(t, 'geheim')).toBe('x_abc')
    expect(ExportDienst.ausToken(t, 'anderes')).toBeNull()
    expect(ExportDienst.ausToken('x_abc.gefaelscht', 'geheim')).toBeNull()
    expect(ExportDienst.ausToken('unfug', 'geheim')).toBeNull()
    expect(ExportDienst.ausToken('', 'geheim')).toBeNull()
  })
})

describe('Inhalt', () => {
  it('benennt Tour-Ordner nach Nummer und Titel', () => {
    expect(tourOrdner(3, 'Runde bei Frankfurt')).toBe('03-runde-bei-frankfurt')
    expect(tourOrdner(12, 'Über den Grimselpass!')).toBe('12-ueber-den-grimselpass')
    // Ohne Titel bleibt die Nummer — sie ist je Konto eindeutig.
    expect(tourOrdner(7, null)).toBe('07')
    expect(tourOrdner(7, '???')).toBe('07')
  })

  it('erkennt, was schon komprimiert ist', () => {
    // Fotos und Videos noch einmal durch Deflate zu schicken kostet die CPU
    // des ganzen Servers und spart nichts.
    for (const n of ['a.jpg', 'b.JPEG', 'c.mp4', 'd.m4a', 'e.png'])
      expect(istGepackt(n), n).toBe(true)
    for (const n of ['tour.json', 'liesmich.txt', 'edits.json'])
      expect(istGepackt(n), n).toBe(false)
  })

  it('sammelt Konto samt Newsletter-Historie', async () => {
    const u = await baueTestApp()
    const id = u.app.auth.benutzerAusSession(u.cookies.maptale_session)!.id
    u.app.newsletter.setze(id, true, 'account')
    const konto = sammleKonto(u.app.deps.db, id)!
    expect(konto.email).toBe('test@example.com')
    expect(konto.newsletter.aktuell).toBe(true)
    expect(konto.newsletter.historie).toHaveLength(1)
    expect(konto.newsletter.historie[0]?.quelle).toBe('account')
    // Zugangsmittel gehören nicht ins Archiv.
    expect(JSON.stringify(konto)).not.toContain('pw_hash')
    expect(JSON.stringify(konto)).not.toMatch(/\$argon/)
  })

  it('legt jede Tour mit ihren Medien ab — ohne den Anreicherungs-Cache', async () => {
    const u = await baueTestApp()
    const id = u.app.auth.benutzerAusSession(u.cookies.maptale_session)!.id
    await legeTourAn(u, '1', 'Runde bei Lauterbrunnen')
    const entries = await sammleEintraege(
      { db: u.app.deps.db, storage: u.storage },
      id,
      '2026-08-06T12:00:00Z',
    )
    const namen = entries.map((e) => e.name)
    expect(namen).toContain('liesmich.txt')
    expect(namen).toContain('konto.json')
    expect(namen).toContain('touren.json')
    expect(namen).toContain('touren/01-runde-bei-lauterbrunnen/tour.json')
    expect(namen).toContain('touren/01-runde-bei-lauterbrunnen/media/m1.w1920.jpg')
    // Der Rechenweg der Anreicherung ist unser Zwischenspeicher, keine Auskunft.
    expect(namen.some((n) => n.includes('anreicherung'))).toBe(false)
    // Und das Foto geht ungepackt hinein.
    expect(entries.find((e) => e.name.endsWith('.jpg'))?.gepackt).toBe(true)
  })

  it('nennt im Begleittext, was drin ist und was nicht', async () => {
    const u = await baueTestApp()
    const id = u.app.auth.benutzerAusSession(u.cookies.maptale_session)!.id
    const text = liesmich(
      sammleKonto(u.app.deps.db, id)!,
      sammleTouren(u.app.deps.db, id),
      '2026-08-06',
    )
    expect(text).toContain('konto.json')
    expect(text).toContain('Nicht enthalten sind Zugangsdaten')
  })
})

describe('Archiv', () => {
  it('baut ein gültiges ZIP mit allen Einträgen', async () => {
    const buf = await alsBuffer(
      baueArchiv([
        { name: 'liesmich.txt', inhalt: 'Hallo' },
        { name: 'touren/01-a/tour.json', inhalt: '{"a":1}' },
        { name: 'touren/01-a/media/m1.jpg', inhalt: Buffer.from('bild'), gepackt: true },
      ]),
    )
    expect(buf.subarray(0, 2).toString()).toBe('PK')
    expect(zipNamen(buf)).toEqual([
      'liesmich.txt',
      'touren/01-a/tour.json',
      'touren/01-a/media/m1.jpg',
    ])
  })
})

describe('Routen', () => {
  it('antwortet sofort und baut im Hintergrund', async () => {
    const u = await baueTestApp()
    const a = await u.app.inject({ method: 'POST', url: '/api/auth/me/export', cookies: u.cookies })
    expect(a.statusCode).toBe(200)
    expect((a.json() as { dataExport: { status: string } }).dataExport.status).toBe('running')
  })

  it('legt bei einem zweiten Klick keinen zweiten Auftrag an', async () => {
    const u = await baueTestApp()
    const [a, b] = await Promise.all([
      u.app.inject({ method: 'POST', url: '/api/auth/me/export', cookies: u.cookies }),
      u.app.inject({ method: 'POST', url: '/api/auth/me/export', cookies: u.cookies }),
    ])
    expect(a.statusCode).toBe(200)
    expect(b.statusCode).toBe(200)
    expect((a.json() as { dataExport: { id: string } }).dataExport.id).toBe(
      (b.json() as { dataExport: { id: string } }).dataExport.id,
    )
  })

  it('liefert das fertige Archiv aus und schickt genau eine Mail', async () => {
    const u = await baueTestApp()
    await legeTourAn(u, '1', 'Runde bei Lauterbrunnen')
    await u.app.inject({ method: 'POST', url: '/api/auth/me/export', cookies: u.cookies })
    // Auf den Hintergrundlauf warten — er hängt an keinem await der Route.
    await warteAufFertig(u)

    const stand = u.app.exporte.stand(u.app.auth.benutzerAusSession(u.cookies.maptale_session)!.id)!
    expect(stand.status).toBe('done')
    expect(stand.bytes).toBeGreaterThan(0)

    const mails = u.mail.nachrichten.filter((m) => m.betreff.includes('Datenexport'))
    expect(mails).toHaveLength(1)
    const link = mails[0]!.text.match(/https?:\/\/\S+\/api\/export\/\S+/)?.[0]
    expect(link).toBeTruthy()

    const pfad = new URL(link!).pathname
    const datei = await u.app.inject({ method: 'GET', url: pfad })
    expect(datei.statusCode).toBe(200)
    expect(datei.headers['content-type']).toBe('application/zip')
    expect(datei.headers['content-disposition']).toContain('maptale-export.zip')
    // Kein Proxy darf das Archiv einer Person vorhalten.
    expect(datei.headers['cache-control']).toBe('private, no-store')
    expect(zipNamen(datei.rawPayload)).toContain(
      'touren/01-runde-bei-lauterbrunnen/media/m1.w1920.jpg',
    )
  })

  it('weist einen gefälschten oder abgelaufenen Link ab — mit derselben Antwort', async () => {
    // Ein eigener Text für „abgelaufen" verriete, dass es diesen Auftrag gab.
    const u = await baueTestApp()
    const a = await u.app.inject({ method: 'GET', url: '/api/export/x_gibtsnicht.falschesignatur' })
    expect(a.statusCode).toBe(404)
    expect(a.json()).toEqual({ error: 'Dieser Link ist abgelaufen oder ungültig.' })
  })

  it('bleibt ohne Anmeldung verschlossen', async () => {
    const u = await baueTestApp()
    expect((await u.app.inject({ method: 'POST', url: '/api/auth/me/export' })).statusCode).toBe(
      401,
    )
  })

  it('meldet den Stand über /auth/me', async () => {
    const u = await baueTestApp()
    const leer = await u.app.inject({ method: 'GET', url: '/api/auth/me', cookies: u.cookies })
    expect((leer.json() as { dataExport: unknown }).dataExport).toBeNull()
    await u.app.inject({ method: 'POST', url: '/api/auth/me/export', cookies: u.cookies })
    const voll = await u.app.inject({ method: 'GET', url: '/api/auth/me', cookies: u.cookies })
    expect((voll.json() as { dataExport: { status: string } }).dataExport.status).toBeTruthy()
  })
})

describe('Größenangabe', () => {
  it('schreibt sie so, wie sie in der Mail stehen soll', () => {
    expect(alsGroesse(512)).toBe('512 Bytes')
    expect(alsGroesse(1024 * 1024 * 3.5)).toBe('3,5 MB')
    expect(alsGroesse(1024 * 1024 * 1024 * 1.4)).toBe('1,4 GB')
    expect(alsGroesse(1024 * 1024 * 250)).toBe('250 MB')
  })
})

/** Wartet, bis der Hintergrundlauf den Auftrag abgeschlossen hat. */
async function warteAufFertig(u: TestUmgebung): Promise<void> {
  const id = u.app.auth.benutzerAusSession(u.cookies.maptale_session)!.id
  for (let i = 0; i < 100; i++) {
    if (u.app.exporte.stand(id)?.status !== 'running') return
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error('Export wurde nicht fertig')
}
