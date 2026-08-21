// Nachtrag der Titelbilder für Bestandstouren (einmalig beim Start).
import { describe, expect, it } from 'vitest'
import { backfillCovers } from '../src/pipeline/cover.js'
import { TOUR_JSON_PATH } from '../src/routes/tours.js'
import { baueTestApp } from './helfer.js'

describe('trageTitelbilderNach', () => {
  it('füllt die cover-Spalte aus dem fertigen tour.json', async () => {
    const u = await baueTestApp()
    const id = await legeFertigeTourAn(u)
    // Zustand vor Einführung der Spalte nachstellen
    u.app.deps.db.prepare('UPDATE tours SET cover = NULL WHERE id = ?').run(id)

    expect(await backfillCovers(u.app.deps.db, u.storage, TOUR_JSON_PATH)).toBe(1)
    expect(cover(u, id)).toBe(`/api/media/${id}/m1.jpg`)
  })

  it('läuft ein zweites Mal ins Leere', async () => {
    const u = await baueTestApp()
    await legeFertigeTourAn(u)
    // Die Tour hat ihr Titelbild schon vom Rendern — nichts nachzutragen
    expect(await backfillCovers(u.app.deps.db, u.storage, TOUR_JSON_PATH)).toBe(0)
  })

  it('eine kaputte Tour hält den Start nicht auf', async () => {
    const u = await baueTestApp()
    const id = await legeFertigeTourAn(u)
    u.app.deps.db.prepare('UPDATE tours SET cover = NULL WHERE id = ?').run(id)
    await u.storage.remove(id, TOUR_JSON_PATH)

    const gemeldet: string[] = []
    expect(
      await backfillCovers(u.app.deps.db, u.storage, TOUR_JSON_PATH, (n) => gemeldet.push(n)),
    ).toBe(0)
    expect(gemeldet).toHaveLength(1)
    expect(cover(u, id)).toBeNull()
  })
})

type Umgebung = Awaited<ReturnType<typeof baueTestApp>>

function cover(u: Umgebung, id: string): string | null {
  return (
    u.app.deps.db.prepare('SELECT cover FROM tours WHERE id = ?').get(id) as {
      cover: string | null
    }
  ).cover
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
  await u.app.processing.get(id)
  return id
}
