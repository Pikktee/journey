// Die rechnenden Teile der Karte „Verbundene Dienste" (src/konto/trackermodell.ts).
//
// Geprüft wird vor allem, dass die vier Zustände einer Verknüpfung sich
// UNTERSCHEIDBAR anfühlen — der teuerste Fehler wäre, „abgelaufen" wie „nicht
// verbunden" aussehen zu lassen: Dann wartet jemand auf Touren, die nie kommen.

import { describe, expect, it } from 'vitest'
import {
  anbieterKnopf,
  anbieterSatz,
  datumMitZeit,
  importSatz,
  importTitel,
  importTon,
  letzterAnkunftsSatz,
  kurzesDatum,
  rueckkehrText,
  type AnbieterStand,
  type ImportStand,
} from '../src/konto/trackermodell.js'

function anbieter(teil: Partial<AnbieterStand> = {}): AnbieterStand {
  return {
    id: 'polar',
    name: 'Polar',
    available: true,
    connected: false,
    status: null,
    connectedAt: null,
    lastSyncAt: null,
    error: null,
    ...teil,
  }
}

function importe(teil: Partial<ImportStand> = {}): ImportStand {
  return {
    id: 'i_1',
    provider: 'polar',
    externalId: 'aQlC83',
    status: 'done',
    tourId: 't_abc',
    reportedAt: '2026-08-09T14:32:00Z',
    finishedAt: '2026-08-09T14:33:00Z',
    error: null,
    ...teil,
  }
}

describe('Anbieter-Zeile', () => {
  it('unterscheidet alle vier Zustände', () => {
    const saetze = [
      anbieterSatz(anbieter()),
      anbieterSatz(anbieter({ connected: true, status: 'active' })),
      anbieterSatz(anbieter({ status: 'expired' })),
      anbieterSatz(anbieter({ available: false })),
    ]
    expect(new Set(saetze).size).toBe(4)
  })

  it('sagt bei abgelaufenem Zugang, was zu tun ist — und nennt den Grund', () => {
    const satz = anbieterSatz(
      anbieter({ status: 'expired', error: 'Zugriff beim Anbieter widerrufen.' }),
    )
    expect(satz).toContain('widerrufen')
    expect(satz).toContain('neu verbinden')
  })

  it('nennt bei einer aktiven Verknüpfung das Datum', () => {
    const satz = anbieterSatz(
      anbieter({ connected: true, status: 'active', connectedAt: '2026-08-09T10:00:00Z' }),
    )
    expect(satz).toContain('9. Aug')
  })

  it('bietet dem nicht eingerichteten Anbieter keinen Knopf an', () => {
    // Ein „Verbinden", das auf eine Fehlerseite des Anbieters führt, wäre die
    // schlechtere Auskunft als gar kein Knopf.
    expect(anbieterKnopf(anbieter({ available: false }))).toBeNull()
  })

  it('beschriftet den Knopf nach dem Zustand', () => {
    expect(anbieterKnopf(anbieter())).toEqual({ text: 'Verbinden', art: 'primaer' })
    expect(anbieterKnopf(anbieter({ connected: true, status: 'active' }))).toEqual({
      text: 'Trennen',
      art: 'gefahr',
    })
    // Abgelaufen führt NICHT auf „Trennen": Da ist nichts mehr zu trennen,
    // sondern etwas neu herzustellen.
    expect(anbieterKnopf(anbieter({ status: 'expired' }))).toEqual({
      text: 'Neu verbinden',
      art: 'primaer',
    })
  })
})

describe('Importliste', () => {
  it('meldet einen fertigen Import schlicht, solange die Tour nichts über sich sagt', () => {
    expect(importSatz(importe())).toBe('Als Tour angelegt')
    expect(importTon(importe())).toBe('ok')
  })

  // Der frühere Satz war „Als Tour angelegt" und sonst nichts — die einzige
  // Statuszeile ohne Inhalt, während die Fehlerfälle ihren Grund nannten.
  it('sagt bei einer fertigen Tour, WELCHE Fahrt angekommen ist', () => {
    const i = importe({
      tour: {
        title: 'Frankfurt-Runde',
        km: 4.23,
        placedMedia: 12,
        status: 'ready',
        visibility: 'private',
      },
    })
    expect(importTitel(i)).toBe('Frankfurt-Runde')
    expect(importSatz(i)).toBe('Spielbereit · 4,2 km · 12 Aufnahmen')
  })

  it('verspricht nichts, was noch rendert', () => {
    const i = importe({
      tour: { title: null, km: null, placedMedia: null, status: 'processing', visibility: null },
    })
    expect(importSatz(i)).toContain('wird noch verarbeitet')
    // Ohne Tourtitel gibt es keine Überschrift: Der Dienstname stünde über
    // einem Dialog, der bereits „Verlauf · Polar" heißt, und die
    // Anbieter-Kennung („aQlC83") sagt niemandem etwas, der hier steht.
    expect(importTitel(i)).toBeNull()
  })

  it('lässt Nullwerte weg, statt „0,0 km" zu behaupten', () => {
    const i = importe({
      tour: { title: 'Ohne Zahlen', km: 0, placedMedia: 0, status: 'ready', visibility: null },
    })
    expect(importSatz(i)).toBe('Spielbereit')
  })

  it('fasst den letzten Stand für die Anbieter-Zeile zusammen', () => {
    expect(letzterAnkunftsSatz([])).toBeNull()
    const fertig = importe({
      tour: { title: 'Abendrunde', km: 8, placedMedia: 3, status: 'ready', visibility: null },
    })
    expect(letzterAnkunftsSatz([fertig])).toContain('Zuletzt: Abendrunde')
    // Die Reihenfolge kommt vom Server (jüngste zuerst) — gelesen wird die erste.
    expect(letzterAnkunftsSatz([importe({ status: 'skipped' }), fertig])).toContain('übersprungen')
  })

  it('führt „übersprungen" NICHT als Fehler', () => {
    // Eine Halleneinheit ohne GPS ist normal. Rot markiert, wäre die Liste
    // eines Vielsportlers dauerhaft alarmiert.
    const i = importe({ status: 'skipped', error: 'Aktivität ohne GPS-Route' })
    expect(importTon(i)).toBe('warn')
    expect(importSatz(i)).toContain('keine Strecke')
  })

  it('übersetzt Betreiber-Fehlertexte in eine Auskunft für den Nutzer', () => {
    expect(importSatz(importe({ status: 'skipped', error: 'Speicher voll (Quota)' }))).toContain(
      'dein Speicher ist voll',
    )
    expect(
      importSatz(
        importe({ status: 'failed', error: 'Bitte bestätige zuerst deine E-Mail-Adresse' }),
      ),
    ).toContain('noch nicht bestätigt')
  })

  it('behält einen unbekannten Fehlertext, statt ihn zu verschlucken', () => {
    const satz = importSatz(importe({ status: 'failed', error: 'Polar antwortete 500' }))
    expect(satz).toContain('Polar antwortete 500')
    expect(importTon(importe({ status: 'failed' }))).toBe('failed')
  })

  it('zeigt einen laufenden Import als solchen', () => {
    expect(importTon(importe({ status: 'running' }))).toBe('running')
    expect(importSatz(importe({ status: 'pending' }))).toContain('Wird geholt')
  })

  it('sagt, ob es noch einen Anlauf gibt', () => {
    // Der Server unterscheidet das seit dem Wiederhol-Weg. Beides gleich zu
    // beschriften ließe den einen warten und den anderen hoffen.
    const nochmal = importe({
      status: 'failed',
      error: 'Polar antwortete 500',
      retryable: true,
      attempts: 1,
    })
    expect(importSatz(nochmal)).toContain('wird noch einmal versucht')

    const aufgegeben = importe({
      status: 'failed',
      error: 'Polar antwortete 500',
      retryable: false,
      attempts: 3,
    })
    expect(importSatz(aufgegeben)).toContain('aufgegeben nach 3 Versuchen')
  })

  it('hängt nichts an, wo es nichts zu sagen gibt', () => {
    // Endgültig übersprungen (ohne Route) ist beim ersten Mal entschieden —
    // „aufgegeben nach 1 Versuch" wäre eine Zahl ohne Aussage.
    const ohneRoute = importe({
      status: 'skipped',
      error: 'Aktivität ohne GPS-Route',
      retryable: false,
      attempts: 1,
    })
    expect(importSatz(ohneRoute)).toBe('Übersprungen — die Aufzeichnung hat keine Strecke')
    // Ältere Antwort ohne die Felder: lieber nichts sagen als das Falsche
    expect(importSatz(importe({ status: 'failed', error: 'Kaputt' }))).toBe(
      'Nicht geklappt — Kaputt',
    )
  })
})

describe('Datumsformate', () => {
  it('kürzt für die Anbieterzeile auf den Tag', () => {
    expect(kurzesDatum('2026-08-09T14:32:00Z')).toMatch(/9\. Aug/)
  })

  it('nennt in der Chronik auch die Uhrzeit', () => {
    expect(datumMitZeit('2026-08-09T14:32:00Z')).toMatch(/9\. Aug.*\d{2}:\d{2}/)
  })

  it('liefert bei kaputtem Datum nichts statt „Invalid Date"', () => {
    expect(kurzesDatum('gestern')).toBe('')
    expect(datumMitZeit('')).toBe('')
  })
})

describe('Rückkehr vom Anbieter', () => {
  it('unterscheidet Erfolg, Abbruch, Ablauf und Fehler', () => {
    const texte = ['verbunden', 'abgebrochen', 'expired', 'failed'].map((w) => rueckkehrText(w))
    expect(texte.every((t) => typeof t === 'string' && t.length > 0)).toBe(true)
    expect(new Set(texte).size).toBe(4)
  })

  it('lässt den Abbruch nicht wie eine Störung klingen', () => {
    // Er ist eine Entscheidung — wer ihn als Fehler liest, sucht ein Problem,
    // das er selbst ausgelöst hat.
    const text = rueckkehrText('abgebrochen') ?? ''
    expect(text).not.toMatch(/Fehler|schiefgelaufen|nicht geklappt/i)
    expect(text).toContain('nichts verknüpft')
  })

  it('ignoriert einen unbekannten Wert', () => {
    expect(rueckkehrText('irgendwas')).toBeNull()
  })
})
