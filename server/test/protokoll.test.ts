// Betriebsprotokoll: Ringpuffer und die Anbindung ans Logger-Ziel.

import { describe, expect, it } from 'vitest'
import { Protokoll, protokollZiel } from '../src/protokoll.js'

const pino = (level: number, felder: Record<string, unknown> = {}): string =>
  `${JSON.stringify({ level, time: 1785865569312, pid: 1, hostname: 'test', ...felder })}\n`

describe('Protokoll (Ringpuffer)', () => {
  it('hält die neuesten Meldungen und wirft die ältesten heraus', () => {
    const p = new Protokoll(3)
    for (const n of [1, 2, 3, 4, 5]) p.schreibe('warnung', `Meldung ${n}`)
    expect(p.liste().map((e) => e.text)).toEqual(['Meldung 5', 'Meldung 4', 'Meldung 3'])
    expect(p.zaehle()).toEqual({ gesamt: 3, fehler: 0 })
  })

  it('zählt fortlaufend weiter, auch über das Herausfallen hinweg', () => {
    // Daran erkennt die Ansicht neue Einträge — eine Nummer darf nie zweimal
    // vorkommen, sonst hielte sie Altes für Neues.
    const p = new Protokoll(2)
    for (const n of [1, 2, 3, 4]) p.schreibe('warnung', `M${n}`)
    expect(p.liste().map((e) => e.nr)).toEqual([4, 3])
  })

  it('filtert nach Stufe und begrenzt auf Wunsch', () => {
    const p = new Protokoll()
    p.schreibe('warnung', 'nur eine Warnung')
    p.schreibe('fehler', 'echter Fehler')
    p.schreibe('warnung', 'noch eine')
    expect(p.liste({ stufe: 'fehler' }).map((e) => e.text)).toEqual(['echter Fehler'])
    expect(p.liste({ limit: 2 })).toHaveLength(2)
    expect(p.zaehle()).toEqual({ gesamt: 3, fehler: 1 })
  })

  it('kappt sehr lange Meldungen', () => {
    const p = new Protokoll()
    p.schreibe('fehler', 'x'.repeat(5000))
    expect(p.liste()[0]?.text.length).toBe(2000)
  })
})

describe('protokollZiel (pino-Anbindung)', () => {
  it('reicht JEDE Zeile nach stdout durch — auch die, die es nicht puffert', () => {
    // Der Durchgriff ist der Zweck: Das Docker-Log bleibt die vollständige
    // Quelle, der Puffer ist nur die Kurzfassung fürs Admin-Fenster.
    const p = new Protokoll()
    const raus: string[] = []
    const ziel = protokollZiel(p, (z) => void raus.push(z))
    ziel.write(pino(30, { msg: 'incoming request' }))
    ziel.write(pino(40, { msg: 'Bildanalyse: HTTP 402' }))
    expect(raus).toHaveLength(2)
    expect(p.liste()).toHaveLength(1) // info gehört nicht ins Protokoll
  })

  it('ordnet die pino-Level den zwei Stufen zu', () => {
    const p = new Protokoll()
    const ziel = protokollZiel(p, () => {})
    ziel.write(pino(20, { msg: 'debug' }))
    ziel.write(pino(40, { msg: 'warnung' }))
    ziel.write(pino(50, { msg: 'fehler' }))
    ziel.write(pino(60, { msg: 'fatal' }))
    expect(p.liste().map((e) => [e.stufe, e.text])).toEqual([
      ['fehler', 'fatal'],
      ['fehler', 'fehler'],
      ['warnung', 'warnung'],
    ])
  })

  it('nimmt Anfrage und Fehlertext als Detail dazu', () => {
    const p = new Protokoll()
    const ziel = protokollZiel(p, () => {})
    ziel.write(
      pino(50, {
        msg: 'Anreicherung fehlgeschlagen',
        err: { message: 'Track nicht lesbar' },
        req: { method: 'POST', url: '/api/tours/t_1/finalize' },
        res: { statusCode: 500 },
      }),
    )
    expect(p.liste()[0]).toMatchObject({
      stufe: 'fehler',
      text: 'Anreicherung fehlgeschlagen',
      detail: 'POST /api/tours/t_1/finalize · HTTP 500 · Track nicht lesbar',
    })
  })

  it('stolpert nicht über fremde Zeilen', () => {
    // Ein Logger, der am Loggen scheitert, reißt den Prozess mit.
    const p = new Protokoll()
    const raus: string[] = []
    const ziel = protokollZiel(p, (z) => void raus.push(z))
    expect(() => ziel.write('kein JSON\n')).not.toThrow()
    expect(raus).toEqual(['kein JSON\n'])
    expect(p.liste()).toHaveLength(0)
  })

  it('fällt auf den Fehlertext zurück, wenn die Meldung leer ist', () => {
    const p = new Protokoll()
    const ziel = protokollZiel(p, () => {})
    ziel.write(pino(50, { err: { message: 'ECONNREFUSED' } }))
    expect(p.liste()[0]?.text).toBe('ECONNREFUSED')
  })
})
