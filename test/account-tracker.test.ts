// Die rechnenden Teile der Karte „Verbundene Dienste" (src/account/tracker-model.ts).
//
// Geprüft wird vor allem, dass die vier Zustände einer Verknüpfung sich
// UNTERSCHEIDBAR anfühlen — der teuerste Fehler wäre, „abgelaufen" wie „nicht
// verbunden" aussehen zu lassen: Dann wartet jemand auf Touren, die nie kommen.

import { describe, expect, it } from 'vitest'
import {
  providerButtonLabel,
  providerSentence,
  formatDateTime,
  importSentence,
  importTitle,
  importTone,
  lastArrivalSentence,
  formatShortDate,
  returnText,
  type ProviderState,
  type ImportEntry,
} from '../src/account/tracker-model.js'

function anbieter(teil: Partial<ProviderState> = {}): ProviderState {
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

function importe(teil: Partial<ImportEntry> = {}): ImportEntry {
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
      providerSentence(anbieter()),
      providerSentence(anbieter({ connected: true, status: 'active' })),
      providerSentence(anbieter({ status: 'expired' })),
      providerSentence(anbieter({ available: false })),
    ]
    expect(new Set(saetze).size).toBe(4)
  })

  it('sagt bei abgelaufenem Zugang, was zu tun ist — und nennt den Grund', () => {
    const satz = providerSentence(
      anbieter({ status: 'expired', error: 'Zugriff beim Anbieter widerrufen.' }),
    )
    expect(satz).toContain('widerrufen')
    expect(satz).toContain('neu verbinden')
  })

  it('nennt bei einer aktiven Verknüpfung das Datum', () => {
    const satz = providerSentence(
      anbieter({ connected: true, status: 'active', connectedAt: '2026-08-09T10:00:00Z' }),
    )
    expect(satz).toContain('9. Aug')
  })

  it('bietet dem nicht eingerichteten Anbieter keinen Knopf an', () => {
    // Ein „Verbinden", das auf eine Fehlerseite des Anbieters führt, wäre die
    // schlechtere Auskunft als gar kein Knopf.
    expect(providerButtonLabel(anbieter({ available: false }))).toBeNull()
  })

  it('beschriftet den Knopf nach dem Zustand', () => {
    expect(providerButtonLabel(anbieter())).toEqual({ text: 'Verbinden', tone: 'primary' })
    expect(providerButtonLabel(anbieter({ connected: true, status: 'active' }))).toEqual({
      text: 'Trennen',
      tone: 'danger',
    })
    // Abgelaufen führt NICHT auf „Trennen": Da ist nichts mehr zu trennen,
    // sondern etwas neu herzustellen.
    expect(providerButtonLabel(anbieter({ status: 'expired' }))).toEqual({
      text: 'Neu verbinden',
      tone: 'primary',
    })
  })
})

describe('Importliste', () => {
  it('meldet einen fertigen Import schlicht, solange die Tour nichts über sich sagt', () => {
    expect(importSentence(importe())).toBe('Als Tour angelegt')
    expect(importTone(importe())).toBe('ok')
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
    expect(importTitle(i)).toBe('Frankfurt-Runde')
    expect(importSentence(i)).toBe('Spielbereit · 4,2 km · 12 Aufnahmen')
  })

  it('verspricht nichts, was noch rendert', () => {
    const i = importe({
      tour: { title: null, km: null, placedMedia: null, status: 'processing', visibility: null },
    })
    expect(importSentence(i)).toContain('wird noch verarbeitet')
    // Ohne Tourtitel gibt es keine Überschrift: Der Dienstname stünde über
    // einem Dialog, der bereits „Verlauf · Polar" heißt, und die
    // Anbieter-Kennung („aQlC83") sagt niemandem etwas, der hier steht.
    expect(importTitle(i)).toBeNull()
  })

  it('lässt Nullwerte weg, statt „0,0 km" zu behaupten', () => {
    const i = importe({
      tour: { title: 'Ohne Zahlen', km: 0, placedMedia: 0, status: 'ready', visibility: null },
    })
    expect(importSentence(i)).toBe('Spielbereit')
  })

  it('fasst den letzten Stand für die Anbieter-Zeile zusammen', () => {
    expect(lastArrivalSentence([])).toBeNull()
    const fertig = importe({
      tour: { title: 'Abendrunde', km: 8, placedMedia: 3, status: 'ready', visibility: null },
    })
    expect(lastArrivalSentence([fertig])).toContain('Zuletzt: Abendrunde')
    // Die Reihenfolge kommt vom Server (jüngste zuerst) — gelesen wird die erste.
    expect(lastArrivalSentence([importe({ status: 'skipped' }), fertig])).toContain('übersprungen')
  })

  it('führt „übersprungen" NICHT als Fehler', () => {
    // Eine Halleneinheit ohne GPS ist normal. Rot markiert, wäre die Liste
    // eines Vielsportlers dauerhaft alarmiert.
    const i = importe({ status: 'skipped', error: 'Aktivität ohne GPS-Route' })
    expect(importTone(i)).toBe('warn')
    expect(importSentence(i)).toContain('keine Strecke')
  })

  it('übersetzt Betreiber-Fehlertexte in eine Auskunft für den Nutzer', () => {
    expect(
      importSentence(importe({ status: 'skipped', error: 'Speicher voll (Quota)' })),
    ).toContain('dein Speicher ist voll')
    expect(
      importSentence(
        importe({ status: 'failed', error: 'Bitte bestätige zuerst deine E-Mail-Adresse' }),
      ),
    ).toContain('noch nicht bestätigt')
  })

  it('behält einen unbekannten Fehlertext, statt ihn zu verschlucken', () => {
    const satz = importSentence(importe({ status: 'failed', error: 'Polar antwortete 500' }))
    expect(satz).toContain('Polar antwortete 500')
    expect(importTone(importe({ status: 'failed' }))).toBe('failed')
  })

  it('zeigt einen laufenden Import als solchen', () => {
    expect(importTone(importe({ status: 'running' }))).toBe('running')
    expect(importSentence(importe({ status: 'pending' }))).toContain('Wird geholt')
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
    expect(importSentence(nochmal)).toContain('wird noch einmal versucht')

    const aufgegeben = importe({
      status: 'failed',
      error: 'Polar antwortete 500',
      retryable: false,
      attempts: 3,
    })
    expect(importSentence(aufgegeben)).toContain('aufgegeben nach 3 Versuchen')
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
    expect(importSentence(ohneRoute)).toBe('Übersprungen — die Aufzeichnung hat keine Strecke')
    // Ältere Antwort ohne die Felder: lieber nichts sagen als das Falsche
    expect(importSentence(importe({ status: 'failed', error: 'Kaputt' }))).toBe(
      'Nicht geklappt — Kaputt',
    )
  })
})

describe('Datumsformate', () => {
  it('kürzt für die Anbieterzeile auf den Tag', () => {
    expect(formatShortDate('2026-08-09T14:32:00Z')).toMatch(/9\. Aug/)
  })

  it('nennt in der Chronik auch die Uhrzeit', () => {
    expect(formatDateTime('2026-08-09T14:32:00Z')).toMatch(/9\. Aug.*\d{2}:\d{2}/)
  })

  it('liefert bei kaputtem Datum nichts statt „Invalid Date"', () => {
    expect(formatShortDate('gestern')).toBe('')
    expect(formatDateTime('')).toBe('')
  })
})

describe('Rückkehr vom Anbieter', () => {
  it('unterscheidet Erfolg, Abbruch, Ablauf und Fehler', () => {
    const texte = ['verbunden', 'abgebrochen', 'abgelaufen', 'fehler'].map((w) => returnText(w))
    expect(texte.every((t) => typeof t === 'string' && t.length > 0)).toBe(true)
    expect(new Set(texte).size).toBe(4)
  })

  it('lässt den Abbruch nicht wie eine Störung klingen', () => {
    // Er ist eine Entscheidung — wer ihn als Fehler liest, sucht ein Problem,
    // das er selbst ausgelöst hat.
    const text = returnText('abgebrochen') ?? ''
    expect(text).not.toMatch(/Fehler|schiefgelaufen|nicht geklappt/i)
    expect(text).toContain('nichts verknüpft')
  })

  it('ignoriert einen unbekannten Wert', () => {
    expect(returnText('irgendwas')).toBeNull()
  })
})
