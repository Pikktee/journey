import { describe, expect, it } from 'vitest'
import {
  brichAttribution,
  clipDauerS,
  dateiname,
  eigeneTourId,
  exportPixelRatio,
  exportQuery,
  EXPORT_FPS_WAHL,
  istExportFps,
  istEingebettet,
  restzeitS,
  restzeitText,
  exportViewport,
  filmSBeiFrame,
  fortschrittText,
  pauseText,
  frameAnzahl,
  istEigeneBereiteTour,
  istExportAnfrage,
  attributionSicht,
  introTafelSicht,
  finaleTafelSicht,
  leseExportFormat,
  motorQuelle,
  tonKlipsAusSpuren,
  verdichteAbschnitte,
  wetterQuelle,
  EXPORT_ATTRIBUTION_S,
  EXPORT_FINALE_S,
  EXPORT_FPS,
  EXPORT_INTRO_S,
  EXPORT_REITER_PX,
  EXPORT_SKALA_MIN,
  EXPORT_VORGABE,
} from '../src/exportfilm'

describe('istExportAnfrage', () => {
  it('erkennt die Query und die Body-Klasse', () => {
    expect(istExportAnfrage('?export=1', false)).toBe(true)
    expect(istExportAnfrage('app=1&export=1', false)).toBe(true)
    expect(istExportAnfrage('', true)).toBe(true)
    expect(istExportAnfrage('?app=1', false)).toBe(false)
    expect(istExportAnfrage('?export=0', false)).toBe(false)
  })
})

describe('eigene Tour', () => {
  it('nimmt nur Server-Kennungen mit t_', () => {
    expect(eigeneTourId('t_abc123')).toBe('t_abc123')
    expect(eigeneTourId('srv:t_abc123')).toBe('t_abc123')
    expect(eigeneTourId('kohphangan')).toBeNull()
    expect(eigeneTourId('srv:kohphangan')).toBeNull()
  })

  it('lässt nur fertige eigene Touren durch', () => {
    const liste = [{ id: 't_mine' }, { id: 't_andere' }]
    expect(istEigeneBereiteTour('srv:t_mine', liste)).toBe(true)
    expect(istEigeneBereiteTour('t_fremd', liste)).toBe(false)
    expect(istEigeneBereiteTour('kohphangan', liste)).toBe(false)
  })
})

const F = (lage: 'quer' | 'hoch', groesse: 720 | 1080, fps: 24 | 30 | 50 | 60 = 30) =>
  ({ lage, groesse, fps }) as const

describe('Format', () => {
  it('nimmt Quer 720 bei 30 als Vorgabe', () => {
    expect(leseExportFormat('')).toEqual(EXPORT_VORGABE)
    expect(leseExportFormat('?export=1')).toEqual(F('quer', 720))
    expect(leseExportFormat('?lage=hoch&groesse=1080&fps=60')).toEqual(F('hoch', 1080, 60))
    expect(leseExportFormat('?lage=quadrat&groesse=4k&fps=120')).toEqual(EXPORT_VORGABE)
  })

  it('nimmt nur die vier angebotenen Bildraten', () => {
    expect(EXPORT_FPS_WAHL).toEqual([24, 30, 50, 60])
    expect(EXPORT_FPS_WAHL).toContain(EXPORT_FPS)
    for (const n of EXPORT_FPS_WAHL) expect(istExportFps(n)).toBe(true)
    // 25 und 120 sind gängige Zahlen und trotzdem nicht im Angebot — die Query
    // darf sie nicht durchreichen, sonst stünde im Blatt keiner der Knöpfe an.
    for (const n of [0, 25, 29, 90, 120]) expect(istExportFps(n)).toBe(false)
  })

  it('setzt Viewport ohne Extra-Schnitt', () => {
    expect(exportViewport(F('quer', 720))).toEqual({ breite: 1280, hoehe: 720 })
    expect(exportViewport(F('hoch', 720))).toEqual({ breite: 720, hoehe: 1280 })
    expect(exportViewport(F('quer', 1080))).toEqual({ breite: 1920, hoehe: 1080 })
    expect(exportViewport(F('hoch', 1080))).toEqual({ breite: 1080, hoehe: 1920 })
    // Die Bildrate rührt an der Zeichenfläche NICHT: Sie tastet die Filmzeit
    // öfter ab, sie ändert nicht, was im Bild steht.
    expect(exportViewport(F('quer', 720, 60))).toEqual(exportViewport(F('quer', 720, 24)))
  })

  it('zieht 720p auf 1,5, 1080p nicht weiter hoch', () => {
    expect(exportPixelRatio(F('quer', 720))).toBe(1.5)
    expect(exportPixelRatio(F('hoch', 1080))).toBe(1)
  })

  it('schreibt Lage, Größe und Bildrate in die Query', () => {
    expect(exportQuery(F('hoch', 1080, 50))).toBe('?export=1&lage=hoch&groesse=1080&fps=50')
  })
})

describe('Dateiname', () => {
  it('trägt Lage und Größe im Slug', () => {
    expect(dateiname('Koh Pha-ngan')).toBe('maptale-koh-pha-ngan-quer-720.mp4')
    expect(dateiname('Straße am See', F('hoch', 1080))).toBe('maptale-strasse-am-see-hoch-1080.mp4')
    expect(dateiname('   ')).toBe('maptale-tour-quer-720.mp4')
  })

  it('nennt die Bildrate nur, wenn sie abweicht', () => {
    // Der Regelfall behält seinen gewohnten Namen; zwei Fassungen derselben
    // Tour überschreiben einander trotzdem nicht.
    expect(dateiname('Koh Pha-ngan', F('quer', 720, 30))).toBe('maptale-koh-pha-ngan-quer-720.mp4')
    expect(dateiname('Koh Pha-ngan', F('quer', 720, 60))).toBe(
      'maptale-koh-pha-ngan-quer-720-60fps.mp4',
    )
    expect(dateiname('Koh Pha-ngan', F('quer', 720, 24))).toBe(
      'maptale-koh-pha-ngan-quer-720-24fps.mp4',
    )
  })
})

describe('Clip-Zeit', () => {
  it('hängt Intro und Finale an die Fahrt', () => {
    expect(clipDauerS(100, true)).toBe(EXPORT_INTRO_S + 100 + EXPORT_FINALE_S)
    expect(clipDauerS(100, false)).toBe(EXPORT_INTRO_S + 100)
    expect(clipDauerS(0, true)).toBe(0)
  })


  it('zählt Frames über die ganze Clip-Dauer', () => {
    expect(frameAnzahl(10, EXPORT_FPS)).toBe(300)
    expect(frameAnzahl(clipDauerS(10, false), EXPORT_FPS)).toBe(
      Math.round((EXPORT_INTRO_S + 10) * EXPORT_FPS),
    )
  })

  it('setzt die Filmsekunde auf i / fps, geklemmt auf die Dauer', () => {
    expect(filmSBeiFrame(0, 30, 200)).toBe(0)
    expect(filmSBeiFrame(30, 30, 200)).toBe(1)
    expect(filmSBeiFrame(299, 30, 200)).toBeCloseTo(299 / 30)
    expect(filmSBeiFrame(400, 30, 5)).toBe(5)
  })

  it('nennt Filmlänge und Frame', () => {
    expect(fortschrittText(222, 1240, 7200)).toBe('3:42 · Frame 1240 von 7200')
  })

  it('sagt beim Verdecken Pause, nicht Abbruch', () => {
    expect(pauseText(222, 0, 7200)).toBe('Pausiert. Tab wieder öffnen · 3:42')
    expect(pauseText(222, 1240, 7200)).toBe('Pausiert. Tab wieder öffnen · 3:42 · Frame 1240 von 7200')
  })
})

// `kartenSicht` stand hier und ist mit dem Karten-Nachbau gegangen (Etappe 2
// der Kartenleinwand): Die Deckkraft der Foto-Karte rechnet jetzt
// `kartenPhasen` in src/kartenmaler.ts — für Bildschirm und Film aus einer
// Quelle, mit Blende UND Abgang statt einer linearen Rampe. Geprüft wird sie
// in test/kartenmaler.test.ts.

describe('Ton-Mix aus filmS', () => {
  it('verschiebt Studio-Spuren hinter das Intro', () => {
    const { klips, schuesse } = tonKlipsAusSpuren(
      [
        {
          type: 'music',
          src: '/a.mp3',
          f0: 0,
          f1: 1,
          filmVonS: 2,
          filmBisS: 10,
          gain: 0.5,
        },
        { type: 'sfx', src: '/b.mp3', f0: 0, f1: 0, filmVonS: 4, filmBisS: 4, gain: 1 },
      ],
      6,
      20,
      0.8,
    )
    expect(klips).toEqual([
      {
        src: '/a.mp3',
        vonClipS: 8,
        bisClipS: 16,
        dateiVonS: 0,
        loop: true,
        gain: 0.4,
      },
    ])
    expect(schuesse).toEqual([{ src: '/b.mp3', beiClipS: 10, gain: 0.8 }])
  })

  it('kennt Motor und Wetter wie der Player', () => {
    expect(motorQuelle('moped')).toBe('/audio/eng-moped.mp3')
    expect(motorQuelle('walk')).toBeNull()
    expect(wetterQuelle('rain', 1)?.src).toBe('/audio/rain.mp3')
    expect(wetterQuelle('off', 1)).toBeNull()
  })

  it('zieht gleiche Frames zu Abschnitten', () => {
    const abs = verdichteAbschnitte(5, 1, (i) => {
      if (i < 3) return { src: 'a', gain: 0.2 }
      if (i === 3) return { src: 'b', gain: 0.1 }
      return null
    })
    expect(abs).toEqual([
      { src: 'a', vonClipS: 0, bisClipS: 3, gain: 0.2 },
      { src: 'b', vonClipS: 3, bisClipS: 4, gain: 0.1 },
    ])
  })
})

describe('Export-Kamera und Einbrand', () => {
  it('hält Walk aus dem Esri-Überzoom', () => {
    // Die Klemme sitzt seit dem Takt-Umbau in `Tour.exportSkalaMin` — hier steht
    // nur noch, dass die Zahl über der Fußgänger-Skala (0,5) liegt.
    expect(EXPORT_SKALA_MIN).toBeGreaterThan(0.5)
    expect(EXPORT_SKALA_MIN).toBeLessThanOrEqual(1)
  })

  it('hält den Marker in der Nähe des Player-Pucks', () => {
    expect(EXPORT_REITER_PX).toBeGreaterThanOrEqual(36)
    expect(EXPORT_REITER_PX).toBeLessThanOrEqual(48)
  })

  it('bricht die Rechtezeile an den Quellen, nicht mitten im Namen', () => {
    const mass = (s: string) => s.length * 10
    const zeilen = brichAttribution(
      '© Esri, Maxar · Mapzen / AWS Open Data · OpenStreetMap · Open-Meteo',
      280,
      mass,
    )
    expect(zeilen.length).toBeGreaterThan(1)
    expect(zeilen.some((z) => z.includes('Esri'))).toBe(true)
    expect(zeilen.join(' · ')).not.toMatch(/Esri,$/)
  })

  it('zeigt die Quellen nur in den letzten Sekunden', () => {
    expect(EXPORT_ATTRIBUTION_S).toBe(2)
    expect(attributionSicht(0, 10)).toBe(0)
    expect(attributionSicht(7.9, 10)).toBe(0)
    expect(attributionSicht(8, 10)).toBe(0)
    expect(attributionSicht(8.2, 10)).toBeCloseTo(0.5)
    expect(attributionSicht(9, 10)).toBe(1)
    expect(attributionSicht(10, 10)).toBe(1)
  })

  it('blendet die Startscreen-Tafel erst mit der Anfahrt aus', () => {
    expect(introTafelSicht(0)).toBe(1)
    expect(introTafelSicht(EXPORT_INTRO_S - 0.1)).toBe(1)
    expect(introTafelSicht(EXPORT_INTRO_S + 0.6)).toBeCloseTo(0.5)
    expect(introTafelSicht(EXPORT_INTRO_S + 1.2)).toBe(0)
    expect(introTafelSicht(EXPORT_INTRO_S + 40)).toBe(0)
  })

  it('blendet die Finale-Tafel aus der Zeit SEIT dem Phasenwechsel ein', () => {
    // Nicht aus der Clip-Zeit: Ob und wann das Finale beginnt, entscheidet die
    // Engine (`showFinale`, Filmende), nicht der Encoder.
    expect(finaleTafelSicht(-1)).toBe(0)
    expect(finaleTafelSicht(0)).toBe(0)
    expect(finaleTafelSicht(0.45)).toBeCloseTo(0.5)
    expect(finaleTafelSicht(0.9)).toBe(1)
    expect(finaleTafelSicht(5)).toBe(1)
  })
})

describe('Rahmen im Studio', () => {
  it('markiert den eingebetteten Lauf in der Query', () => {
    expect(exportQuery(F('quer', 720))).not.toContain('rahmen')
    expect(exportQuery(F('quer', 720), true)).toContain('rahmen=1')
    expect(istEingebettet('?export=1&rahmen=1')).toBe(true)
    expect(istEingebettet('?export=1')).toBe(false)
  })

  it('schätzt die Restzeit erst, wenn genug Bilder da sind', () => {
    // Die ersten Bilder tragen die Kachel-Erstladung und wären als Hochrechnung
    // das Zehnfache der Wahrheit.
    expect(restzeitS(3, 1800, 6)).toBeNull()
    expect(restzeitS(0, 1800, 0)).toBeNull()
    // 60 von 1800 in 30 s ⇒ 1740 Bilder à 0,5 s = 870 s
    expect(restzeitS(60, 1800, 30)).toBeCloseTo(870)
    expect(restzeitS(1800, 1800, 30)).toBeNull()
  })

  it('sagt die Restzeit in Minuten, nicht in Sekunden', () => {
    expect(restzeitText(null)).toBe('Restzeit wird geschätzt')
    expect(restzeitText(40)).toBe('noch keine Minute')
    expect(restzeitText(70)).toBe('noch etwa 1 Minute')
    expect(restzeitText(870)).toBe('noch etwa 15 Minuten')
    expect(restzeitText(7400)).toBe('noch etwa 2 Stunden')
  })
})
