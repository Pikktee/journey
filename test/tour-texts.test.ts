// Die Texte des Startscreens: was gezeigt wird und was weggelassen.
//
// Alle vier Funktionen sind aus einer Beobachtung am Bild entstanden, nicht aus
// dem Datenmodell — die Tests halten deshalb die BEOBACHTUNG fest, nicht die
// Implementierung: „0 hm" darf nicht erscheinen, die Stationszeile darf den
// Titel nicht wiederholen, und ein Text an der Grenze bleibt ungekürzt.
import { describe, expect, it } from 'vitest'
import {
  DESCRIPTION_MAX,
  formatFilmDuration,
  stats,
  truncateDescription,
  showRoute,
} from '../src/tour-texts.js'

describe('kuerzeBeschreibung', () => {
  it('lässt einen Text an der Grenze unangetastet', () => {
    const genau = 'a'.repeat(DESCRIPTION_MAX)
    expect(truncateDescription(genau)).toBe(genau)
  })

  it('kürzt Bestandstexte an der Wortgrenze und setzt ein Auslassungszeichen', () => {
    const lang = `${'Wort '.repeat(60)}Ende`
    const kurz = truncateDescription(lang) ?? ''
    expect(kurz.length).toBeLessThanOrEqual(DESCRIPTION_MAX + 1)
    expect(kurz.endsWith('…')).toBe(true)
    // An der Wortgrenze heißt: kein halbes Wort vor dem Zeichen.
    expect(kurz).not.toMatch(/Wor…$/)
  })

  it('kappt hart, wenn ein einzelnes Wort die ganze Grenze füllt', () => {
    // Sonst bliebe von 150 Zeichen ein Fragment von zehn.
    const monster = 'A'.repeat(400)
    const kurz = truncateDescription(monster) ?? ''
    expect(kurz.length).toBe(DESCRIPTION_MAX + 1)
  })

  it('macht aus Leerraum und null dasselbe: keine Zeile', () => {
    expect(truncateDescription('   ')).toBeNull()
    expect(truncateDescription(null)).toBeNull()
    expect(truncateDescription(undefined)).toBeNull()
  })

  it('zieht Zeilenumbrüche zu einem Absatz zusammen', () => {
    expect(truncateDescription('Erste Zeile.\n\n  Zweite   Zeile.')).toBe(
      'Erste Zeile. Zweite Zeile.',
    )
  })
})

describe('zeigeRoute', () => {
  it('lässt die Zeile weg, wenn sie nur den Titel wiederholt', () => {
    // Der Fall aus dem Screenshot: eine Rundtour, automatisch benannt.
    expect(showRoute(['Völklingen'], 'Runde bei Völklingen')).toBe(false)
    // Und A nach B, ebenfalls automatisch benannt.
    expect(showRoute(['Völklingen', 'Saarbrücken'], 'Völklingen<br />→ Saarbrücken')).toBe(false)
  })

  it('zeigt sie, sobald eine Station nicht im Titel steht', () => {
    expect(showRoute(['Völklingen', 'Saarbrücken'], 'Nach Hause durchs Warndt')).toBe(true)
    expect(showRoute(['Thong Sala', 'Haad Rin'], 'Koh<br />Pha-ngan')).toBe(true)
  })

  it('kennt keine Groß- und Kleinschreibung', () => {
    expect(showRoute(['völklingen'], 'Runde bei Völklingen')).toBe(false)
  })

  it('zeigt nichts, wenn es keine Station gibt', () => {
    expect(showRoute([], 'Irgendwas')).toBe(false)
    expect(showRoute(['  '], 'Irgendwas')).toBe(false)
  })
})

describe('formatiereFilmdauer', () => {
  it('rundet auf die nächste Sekunde statt abzuschneiden', () => {
    expect(formatFilmDuration(159.6)).toBe('2:40')
    expect(formatFilmDuration(159.4)).toBe('2:39')
  })

  it('füllt Sekunden zweistellig und nennt Stunden nur, wenn es welche gibt', () => {
    expect(formatFilmDuration(65)).toBe('1:05')
    expect(formatFilmDuration(3725)).toBe('1:02:05')
  })

  it('bleibt bei negativen Werten bei null', () => {
    expect(formatFilmDuration(-3)).toBe('0:00')
  })
})

describe('kennzahlen', () => {
  it('lässt die Null weg statt sie zu behaupten', () => {
    // Der Befund am Bild: „0.1 km · 0 hm · 8 Fotos" — die Mitte sagt nichts.
    const werte = stats({ filmDurationS: 160, km: 0.14, elevationGain: 0, photos: 8 })
    expect(werte.map((w) => w.kind)).toEqual(['dauer', 'km', 'fotos'])
  })

  it('stellt die Filmdauer voran', () => {
    const werte = stats({ filmDurationS: 490, km: 41.8, elevationGain: 612, photos: 12 })
    expect(werte[0]).toEqual({ kind: 'dauer', text: '8:10 Min' })
    expect(werte.map((w) => w.text)).toEqual(['8:10 Min', '41,8 km', '612 hm', '12 Fotos'])
  })

  it('schreibt die Distanz mit Dezimalkomma', () => {
    expect(stats({ km: 0.14, photos: 0 })[0]?.text).toBe('0,1 km')
  })

  it('rundet Höhenmeter und lässt sie unter einem Meter weg', () => {
    expect(stats({ elevationGain: 0.4, photos: 1 }).some((w) => w.kind === 'hm')).toBe(false)
    expect(stats({ elevationGain: 611.6, photos: 1 }).find((w) => w.kind === 'hm')?.text).toBe(
      '612 hm',
    )
  })

  it('setzt den Singular bei genau einem Foto', () => {
    expect(stats({ photos: 1 })[0]?.text).toBe('1 Foto')
  })

  it('zeigt keine Dauer, solange keine bekannt ist', () => {
    expect(stats({ filmDurationS: null, km: 3, photos: 2 }).some((w) => w.kind === 'dauer')).toBe(
      false,
    )
  })
})
