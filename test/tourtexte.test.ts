// Die Texte des Startscreens: was gezeigt wird und was weggelassen.
//
// Alle vier Funktionen sind aus einer Beobachtung am Bild entstanden, nicht aus
// dem Datenmodell — die Tests halten deshalb die BEOBACHTUNG fest, nicht die
// Implementierung: „0 hm" darf nicht erscheinen, die Stationszeile darf den
// Titel nicht wiederholen, und ein Text an der Grenze bleibt ungekürzt.
import { describe, expect, it } from 'vitest'
import {
  BESCHREIBUNG_MAX,
  formatiereFilmdauer,
  kennzahlen,
  kuerzeBeschreibung,
  zeigeRoute,
} from '../src/tourtexte.js'

describe('kuerzeBeschreibung', () => {
  it('lässt einen Text an der Grenze unangetastet', () => {
    const genau = 'a'.repeat(BESCHREIBUNG_MAX)
    expect(kuerzeBeschreibung(genau)).toBe(genau)
  })

  it('kürzt Bestandstexte an der Wortgrenze und setzt ein Auslassungszeichen', () => {
    const lang = `${'Wort '.repeat(60)}Ende`
    const kurz = kuerzeBeschreibung(lang) ?? ''
    expect(kurz.length).toBeLessThanOrEqual(BESCHREIBUNG_MAX + 1)
    expect(kurz.endsWith('…')).toBe(true)
    // An der Wortgrenze heißt: kein halbes Wort vor dem Zeichen.
    expect(kurz).not.toMatch(/Wor…$/)
  })

  it('kappt hart, wenn ein einzelnes Wort die ganze Grenze füllt', () => {
    // Sonst bliebe von 150 Zeichen ein Fragment von zehn.
    const monster = 'A'.repeat(400)
    const kurz = kuerzeBeschreibung(monster) ?? ''
    expect(kurz.length).toBe(BESCHREIBUNG_MAX + 1)
  })

  it('macht aus Leerraum und null dasselbe: keine Zeile', () => {
    expect(kuerzeBeschreibung('   ')).toBeNull()
    expect(kuerzeBeschreibung(null)).toBeNull()
    expect(kuerzeBeschreibung(undefined)).toBeNull()
  })

  it('zieht Zeilenumbrüche zu einem Absatz zusammen', () => {
    expect(kuerzeBeschreibung('Erste Zeile.\n\n  Zweite   Zeile.')).toBe(
      'Erste Zeile. Zweite Zeile.',
    )
  })
})

describe('zeigeRoute', () => {
  it('lässt die Zeile weg, wenn sie nur den Titel wiederholt', () => {
    // Der Fall aus dem Screenshot: eine Rundtour, automatisch benannt.
    expect(zeigeRoute(['Völklingen'], 'Runde bei Völklingen')).toBe(false)
    // Und A nach B, ebenfalls automatisch benannt.
    expect(zeigeRoute(['Völklingen', 'Saarbrücken'], 'Völklingen<br />→ Saarbrücken')).toBe(false)
  })

  it('zeigt sie, sobald eine Station nicht im Titel steht', () => {
    expect(zeigeRoute(['Völklingen', 'Saarbrücken'], 'Nach Hause durchs Warndt')).toBe(true)
    expect(zeigeRoute(['Thong Sala', 'Haad Rin'], 'Koh<br />Pha-ngan')).toBe(true)
  })

  it('kennt keine Groß- und Kleinschreibung', () => {
    expect(zeigeRoute(['völklingen'], 'Runde bei Völklingen')).toBe(false)
  })

  it('zeigt nichts, wenn es keine Station gibt', () => {
    expect(zeigeRoute([], 'Irgendwas')).toBe(false)
    expect(zeigeRoute(['  '], 'Irgendwas')).toBe(false)
  })
})

describe('formatiereFilmdauer', () => {
  it('rundet auf die nächste Sekunde statt abzuschneiden', () => {
    expect(formatiereFilmdauer(159.6)).toBe('2:40')
    expect(formatiereFilmdauer(159.4)).toBe('2:39')
  })

  it('füllt Sekunden zweistellig und nennt Stunden nur, wenn es welche gibt', () => {
    expect(formatiereFilmdauer(65)).toBe('1:05')
    expect(formatiereFilmdauer(3725)).toBe('1:02:05')
  })

  it('bleibt bei negativen Werten bei null', () => {
    expect(formatiereFilmdauer(-3)).toBe('0:00')
  })
})

describe('kennzahlen', () => {
  it('lässt die Null weg statt sie zu behaupten', () => {
    // Der Befund am Bild: „0.1 km · 0 hm · 8 Fotos" — die Mitte sagt nichts.
    const werte = kennzahlen({ filmDauerS: 160, km: 0.14, hoehenmeter: 0, fotos: 8 })
    expect(werte.map((w) => w.art)).toEqual(['dauer', 'km', 'fotos'])
  })

  it('stellt die Filmdauer voran', () => {
    const werte = kennzahlen({ filmDauerS: 490, km: 41.8, hoehenmeter: 612, fotos: 12 })
    expect(werte[0]).toEqual({ art: 'dauer', text: '8:10 Min' })
    expect(werte.map((w) => w.text)).toEqual(['8:10 Min', '41,8 km', '612 hm', '12 Fotos'])
  })

  it('schreibt die Distanz mit Dezimalkomma', () => {
    expect(kennzahlen({ km: 0.14, fotos: 0 })[0]?.text).toBe('0,1 km')
  })

  it('rundet Höhenmeter und lässt sie unter einem Meter weg', () => {
    expect(kennzahlen({ hoehenmeter: 0.4, fotos: 1 }).some((w) => w.art === 'hm')).toBe(false)
    expect(kennzahlen({ hoehenmeter: 611.6, fotos: 1 }).find((w) => w.art === 'hm')?.text).toBe(
      '612 hm',
    )
  })

  it('setzt den Singular bei genau einem Foto', () => {
    expect(kennzahlen({ fotos: 1 })[0]?.text).toBe('1 Foto')
  })

  it('zeigt keine Dauer, solange keine bekannt ist', () => {
    expect(kennzahlen({ filmDauerS: null, km: 3, fotos: 2 }).some((w) => w.art === 'dauer')).toBe(
      false,
    )
  })
})
