// Betriebslog: Ringpuffer und die Anbindung ans Logger-Ziel.

import { describe, expect, it } from 'vitest'
import { AuditLog, auditLogTarget } from '../src/audit-log.js'

const pino = (level: number, felder: Record<string, unknown> = {}): string =>
  `${JSON.stringify({ level, time: 1785865569312, pid: 1, hostname: 'test', ...felder })}\n`

describe('Protokoll (Ringpuffer)', () => {
  it('hält die neuesten Meldungen und wirft die ältesten heraus', () => {
    const p = new AuditLog(3)
    for (const n of [1, 2, 3, 4, 5]) p.write('warning', `Meldung ${n}`)
    expect(p.list().map((e) => e.text)).toEqual(['Meldung 5', 'Meldung 4', 'Meldung 3'])
    expect(p.count()).toEqual({ total: 3, errorCount: 0 })
  })

  it('zählt fortlaufend weiter, auch über das Herausfallen hinweg', () => {
    // Daran erkennt die Ansicht neue Einträge — eine Nummer darf nie zweimal
    // vorkommen, sonst hielte sie Altes für Neues.
    const p = new AuditLog(2)
    for (const n of [1, 2, 3, 4]) p.write('warning', `M${n}`)
    expect(p.list().map((e) => e.no)).toEqual([4, 3])
  })

  it('filtert nach Stufe und begrenzt auf Wunsch', () => {
    const p = new AuditLog()
    p.write('warning', 'nur eine Warnung')
    p.write('failed', 'echter Fehler')
    p.write('warning', 'noch eine')
    expect(p.list({ severity: 'failed' }).map((e) => e.text)).toEqual(['echter Fehler'])
    expect(p.list({ limit: 2 })).toHaveLength(2)
    expect(p.count()).toEqual({ total: 3, errorCount: 1 })
  })

  it('kappt sehr lange Meldungen', () => {
    const p = new AuditLog()
    p.write('failed', 'x'.repeat(5000))
    expect(p.list()[0]?.text.length).toBe(2000)
  })
})

describe('protokollZiel (pino-Anbindung)', () => {
  it('reicht JEDE Zeile nach stdout durch — auch die, die es nicht puffert', () => {
    // Der Durchgriff ist der Zweck: Das Docker-Log bleibt die vollständige
    // Quelle, der Puffer ist nur die Kurzfassung fürs Admin-Fenster.
    const p = new AuditLog()
    const raus: string[] = []
    const ziel = auditLogTarget(p, (z) => void raus.push(z))
    ziel.write(pino(30, { msg: 'incoming request' }))
    ziel.write(pino(40, { msg: 'Bildanalyse: HTTP 402' }))
    expect(raus).toHaveLength(2)
    expect(p.list()).toHaveLength(1) // info gehört nicht ins Protokoll
  })

  it('ordnet die pino-Level den zwei Stufen zu', () => {
    const p = new AuditLog()
    const ziel = auditLogTarget(p, () => {})
    ziel.write(pino(20, { msg: 'debug' }))
    ziel.write(pino(40, { msg: 'warning' }))
    ziel.write(pino(50, { msg: 'failed' }))
    ziel.write(pino(60, { msg: 'fatal' }))
    expect(p.list().map((e) => [e.level, e.text])).toEqual([
      ['failed', 'fatal'],
      ['failed', 'failed'],
      ['warning', 'warning'],
    ])
  })

  it('nimmt Anfrage und Fehlertext als Detail dazu', () => {
    const p = new AuditLog()
    const ziel = auditLogTarget(p, () => {})
    ziel.write(
      pino(50, {
        msg: 'Anreicherung fehlgeschlagen',
        err: { message: 'Track nicht lesbar' },
        req: { method: 'POST', url: '/api/tours/t_1/finalize' },
        res: { statusCode: 500 },
      }),
    )
    expect(p.list()[0]).toMatchObject({
      level: 'failed',
      text: 'Anreicherung fehlgeschlagen',
      detail: 'POST /api/tours/t_1/finalize · HTTP 500 · Track nicht lesbar',
    })
  })

  it('stolpert nicht über fremde Zeilen', () => {
    // Ein Logger, der am Loggen scheitert, reißt den Prozess mit.
    const p = new AuditLog()
    const raus: string[] = []
    const ziel = auditLogTarget(p, (z) => void raus.push(z))
    expect(() => ziel.write('kein JSON\n')).not.toThrow()
    expect(raus).toEqual(['kein JSON\n'])
    expect(p.list()).toHaveLength(0)
  })

  it('fällt auf den Fehlertext zurück, wenn die Meldung leer ist', () => {
    const p = new AuditLog()
    const ziel = auditLogTarget(p, () => {})
    ziel.write(pino(50, { err: { message: 'ECONNREFUSED' } }))
    expect(p.list()[0]?.text).toBe('ECONNREFUSED')
  })
})
