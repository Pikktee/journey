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
  importTon,
  kurzesDatum,
  rueckkehrText,
  type AnbieterStand,
  type ImportStand,
} from '../src/konto/trackermodell.js'

function anbieter(teil: Partial<AnbieterStand> = {}): AnbieterStand {
  return {
    id: 'polar',
    name: 'Polar',
    verfuegbar: true,
    verbunden: false,
    status: null,
    verbundenSeit: null,
    zuletztSync: null,
    fehler: null,
    ...teil,
  }
}

function importe(teil: Partial<ImportStand> = {}): ImportStand {
  return {
    id: 'i_1',
    anbieter: 'polar',
    externeId: 'aQlC83',
    status: 'fertig',
    tourId: 't_abc',
    gemeldetAm: '2026-08-09T14:32:00Z',
    fertigAm: '2026-08-09T14:33:00Z',
    fehler: null,
    ...teil,
  }
}

describe('Anbieter-Zeile', () => {
  it('unterscheidet alle vier Zustände', () => {
    const saetze = [
      anbieterSatz(anbieter()),
      anbieterSatz(anbieter({ verbunden: true, status: 'aktiv' })),
      anbieterSatz(anbieter({ status: 'abgelaufen' })),
      anbieterSatz(anbieter({ verfuegbar: false })),
    ]
    expect(new Set(saetze).size).toBe(4)
  })

  it('sagt bei abgelaufenem Zugang, was zu tun ist — und nennt den Grund', () => {
    const satz = anbieterSatz(anbieter({ status: 'abgelaufen', fehler: 'Zugriff beim Anbieter widerrufen.' }))
    expect(satz).toContain('widerrufen')
    expect(satz).toContain('neu verbinden')
  })

  it('nennt bei einer aktiven Verknüpfung das Datum', () => {
    const satz = anbieterSatz(anbieter({ verbunden: true, status: 'aktiv', verbundenSeit: '2026-08-09T10:00:00Z' }))
    expect(satz).toContain('9. Aug')
  })

  it('bietet dem nicht eingerichteten Anbieter keinen Knopf an', () => {
    // Ein „Verbinden", das auf eine Fehlerseite des Anbieters führt, wäre die
    // schlechtere Auskunft als gar kein Knopf.
    expect(anbieterKnopf(anbieter({ verfuegbar: false }))).toBeNull()
  })

  it('beschriftet den Knopf nach dem Zustand', () => {
    expect(anbieterKnopf(anbieter())).toEqual({ text: 'Verbinden', art: 'primaer' })
    expect(anbieterKnopf(anbieter({ verbunden: true, status: 'aktiv' }))).toEqual({
      text: 'Trennen',
      art: 'gefahr',
    })
    // Abgelaufen führt NICHT auf „Trennen": Da ist nichts mehr zu trennen,
    // sondern etwas neu herzustellen.
    expect(anbieterKnopf(anbieter({ status: 'abgelaufen' }))).toEqual({
      text: 'Neu verbinden',
      art: 'primaer',
    })
  })
})

describe('Importliste', () => {
  it('meldet einen fertigen Import schlicht', () => {
    expect(importSatz(importe())).toBe('Als Tour angelegt')
    expect(importTon(importe())).toBe('ok')
  })

  it('führt „übersprungen" NICHT als Fehler', () => {
    // Eine Halleneinheit ohne GPS ist normal. Rot markiert, wäre die Liste
    // eines Vielsportlers dauerhaft alarmiert.
    const i = importe({ status: 'uebersprungen', fehler: 'Aktivität ohne GPS-Route' })
    expect(importTon(i)).toBe('warn')
    expect(importSatz(i)).toContain('keine Strecke')
  })

  it('übersetzt Betreiber-Fehlertexte in eine Auskunft für den Nutzer', () => {
    expect(importSatz(importe({ status: 'uebersprungen', fehler: 'Speicher voll (Quota)' }))).toContain(
      'dein Speicher ist voll',
    )
    expect(
      importSatz(importe({ status: 'fehler', fehler: 'Bitte bestätige zuerst deine E-Mail-Adresse' })),
    ).toContain('noch nicht bestätigt')
  })

  it('behält einen unbekannten Fehlertext, statt ihn zu verschlucken', () => {
    const satz = importSatz(importe({ status: 'fehler', fehler: 'Polar antwortete 500' }))
    expect(satz).toContain('Polar antwortete 500')
    expect(importTon(importe({ status: 'fehler' }))).toBe('fehler')
  })

  it('zeigt einen laufenden Import als solchen', () => {
    expect(importTon(importe({ status: 'laeuft' }))).toBe('laeuft')
    expect(importSatz(importe({ status: 'wartet' }))).toContain('Wird geholt')
  })

  it('sagt, ob es noch einen Anlauf gibt', () => {
    // Der Server unterscheidet das seit dem Wiederhol-Weg. Beides gleich zu
    // beschriften ließe den einen warten und den anderen hoffen.
    const nochmal = importe({ status: 'fehler', fehler: 'Polar antwortete 500', wiederholbar: true, versuche: 1 })
    expect(importSatz(nochmal)).toContain('wird noch einmal versucht')

    const aufgegeben = importe({ status: 'fehler', fehler: 'Polar antwortete 500', wiederholbar: false, versuche: 3 })
    expect(importSatz(aufgegeben)).toContain('aufgegeben nach 3 Versuchen')
  })

  it('hängt nichts an, wo es nichts zu sagen gibt', () => {
    // Endgültig übersprungen (ohne Route) ist beim ersten Mal entschieden —
    // „aufgegeben nach 1 Versuch" wäre eine Zahl ohne Aussage.
    const ohneRoute = importe({
      status: 'uebersprungen',
      fehler: 'Aktivität ohne GPS-Route',
      wiederholbar: false,
      versuche: 1,
    })
    expect(importSatz(ohneRoute)).toBe('Übersprungen — die Aufzeichnung hat keine Strecke')
    // Ältere Antwort ohne die Felder: lieber nichts sagen als das Falsche
    expect(importSatz(importe({ status: 'fehler', fehler: 'Kaputt' }))).toBe('Nicht geklappt — Kaputt')
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
    const texte = ['verbunden', 'abgebrochen', 'abgelaufen', 'fehler'].map((w) => rueckkehrText(w))
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
