// Nachtrag der Titelbilder für Bestandstouren (einmalig beim Start).
import { describe, expect, it } from 'vitest'
import { trageTitelbilderNach } from '../src/pipeline/cover.js'
import { TOURJSON_PFAD } from '../src/routes/tours.js'
import { baueTestApp } from './helfer.js'

describe('trageTitelbilderNach', () => {
  it('füllt die cover-Spalte aus dem fertigen tour.json', async () => {
    const u = await baueTestApp()
    const id = await legeFertigeTourAn(u)
    // Zustand vor Einführung der Spalte nachstellen
    u.app.deps.db.prepare('UPDATE tours SET cover = NULL WHERE id = ?').run(id)

    expect(await trageTitelbilderNach(u.app.deps.db, u.storage, TOURJSON_PFAD)).toBe(1)
    expect(cover(u, id)).toBe(`/api/media/${id}/m1.jpg`)
  })

  it('läuft ein zweites Mal ins Leere', async () => {
    const u = await baueTestApp()
    await legeFertigeTourAn(u)
    // Die Tour hat ihr Titelbild schon vom Rendern — nichts nachzutragen
    expect(await trageTitelbilderNach(u.app.deps.db, u.storage, TOURJSON_PFAD)).toBe(0)
  })

  it('eine kaputte Tour hält den Start nicht auf', async () => {
    const u = await baueTestApp()
    const id = await legeFertigeTourAn(u)
    u.app.deps.db.prepare('UPDATE tours SET cover = NULL WHERE id = ?').run(id)
    await u.storage.loesche(id, TOURJSON_PFAD)

    const gemeldet: string[] = []
    expect(await trageTitelbilderNach(u.app.deps.db, u.storage, TOURJSON_PFAD, (n) => gemeldet.push(n))).toBe(0)
    expect(gemeldet).toHaveLength(1)
    expect(cover(u, id)).toBeNull()
  })
})

type Umgebung = Awaited<ReturnType<typeof baueTestApp>>

function cover(u: Umgebung, id: string): string | null {
  return (u.app.deps.db.prepare('SELECT cover FROM tours WHERE id = ?').get(id) as { cover: string | null }).cover
}

async function legeFertigeTourAn(u: Umgebung): Promise<string> {
  const { beispielManifest } = await import('./helfer.js')
  const angelegt = await u.app.inject({
    method: 'POST',
    url: '/api/tours',
    cookies: u.cookies,
    payload: beispielManifest(),
  })
  const id = (angelegt.json() as { id: string }).id
  await u.app.inject({
    method: 'PUT',
    url: `/api/tours/${id}/media/m1`,
    cookies: u.cookies,
    headers: { 'content-type': 'application/octet-stream' },
    payload: Buffer.from('fake-jpeg-bytes'),
  })
  await u.app.inject({ method: 'POST', url: `/api/tours/${id}/finalize`, cookies: u.cookies })
  await u.app.verarbeitungen.get(id)
  return id
}
