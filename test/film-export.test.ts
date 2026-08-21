import { describe, expect, it } from 'vitest'
import {
  wrapAttribution,
  exportClipDurationS,
  fileName,
  ownTourId,
  exportPixelRatio,
  exportQuery,
  EXPORT_FPS_CHOICES,
  isExportFps,
  isEmbedded,
  remainingS,
  remainingText,
  exportViewport,
  filmTimeAtFrame,
  progressText,
  pausedText,
  frameCount,
  isOwnReadyTour,
  isExportRequest,
  attributionOpacity,
  introPanelOpacity,
  wrapLines,
  finalePanelOpacity,
  parseExportFormat,
  engineLoopSource,
  audioClipsFromTracks,
  mergeSegments,
  weatherLoopSource,
  EXPORT_ATTRIBUTION_S,
  EXPORT_FINALE_S,
  EXPORT_FPS,
  EXPORT_INTRO_S,
  EXPORT_TAB_PX,
  EXPORT_SCALE_MIN,
  EXPORT_DEFAULT,
} from '../src/film-export'

describe('istExportAnfrage', () => {
  it('erkennt die Query und die Body-Klasse', () => {
    expect(isExportRequest('?export=1', false)).toBe(true)
    expect(isExportRequest('app=1&export=1', false)).toBe(true)
    expect(isExportRequest('', true)).toBe(true)
    expect(isExportRequest('?app=1', false)).toBe(false)
    expect(isExportRequest('?export=0', false)).toBe(false)
  })
})

describe('eigene Tour', () => {
  it('nimmt nur Server-Kennungen mit t_', () => {
    expect(ownTourId('t_abc123')).toBe('t_abc123')
    expect(ownTourId('srv:t_abc123')).toBe('t_abc123')
    expect(ownTourId('kohphangan')).toBeNull()
    expect(ownTourId('srv:kohphangan')).toBeNull()
  })

  it('lässt nur fertige eigene Touren durch', () => {
    const liste = [{ id: 't_mine' }, { id: 't_andere' }]
    expect(isOwnReadyTour('srv:t_mine', liste)).toBe(true)
    expect(isOwnReadyTour('t_fremd', liste)).toBe(false)
    expect(isOwnReadyTour('kohphangan', liste)).toBe(false)
  })
})

const F = (orientation: 'landscape' | 'portrait', size: 720 | 1080, fps: 24 | 30 | 50 | 60 = 30) =>
  ({ orientation, size, fps }) as const

describe('Format', () => {
  it('nimmt Quer 720 bei 30 als Vorgabe', () => {
    expect(parseExportFormat('')).toEqual(EXPORT_DEFAULT)
    expect(parseExportFormat('?export=1')).toEqual(F('landscape', 720))
    expect(parseExportFormat('?orientation=portrait&size=1080&fps=60')).toEqual(
      F('portrait', 1080, 60),
    )
    expect(parseExportFormat('?lage=quadrat&groesse=4k&fps=120')).toEqual(EXPORT_DEFAULT)
  })

  it('nimmt nur die vier angebotenen Bildraten', () => {
    expect(EXPORT_FPS_CHOICES).toEqual([24, 30, 50, 60])
    expect(EXPORT_FPS_CHOICES).toContain(EXPORT_FPS)
    for (const n of EXPORT_FPS_CHOICES) expect(isExportFps(n)).toBe(true)
    // 25 und 120 sind gängige Zahlen und trotzdem nicht im Angebot — die Query
    // darf sie nicht durchreichen, sonst stünde im Blatt keiner der Knöpfe an.
    for (const n of [0, 25, 29, 90, 120]) expect(isExportFps(n)).toBe(false)
  })

  it('setzt Viewport ohne Extra-Schnitt', () => {
    expect(exportViewport(F('landscape', 720))).toEqual({ width: 1280, height: 720 })
    expect(exportViewport(F('portrait', 720))).toEqual({ width: 720, height: 1280 })
    expect(exportViewport(F('landscape', 1080))).toEqual({ width: 1920, height: 1080 })
    expect(exportViewport(F('portrait', 1080))).toEqual({ width: 1080, height: 1920 })
    // Die Bildrate rührt an der Zeichenfläche NICHT: Sie tastet die Filmzeit
    // öfter ab, sie ändert nicht, was im Bild steht.
    expect(exportViewport(F('landscape', 720, 60))).toEqual(exportViewport(F('landscape', 720, 24)))
  })

  it('zieht 720p auf 1,5, 1080p nicht weiter hoch', () => {
    expect(exportPixelRatio(F('landscape', 720))).toBe(1.5)
    expect(exportPixelRatio(F('portrait', 1080))).toBe(1)
  })

  it('schreibt Lage, Größe und Bildrate in die Query', () => {
    expect(exportQuery(F('portrait', 1080, 50))).toBe(
      '?export=1&orientation=portrait&size=1080&fps=50',
    )
  })
})

describe('Dateiname', () => {
  it('trägt Lage und Größe im Slug', () => {
    expect(fileName('Koh Pha-ngan')).toBe('maptale-koh-pha-ngan-landscape-720.mp4')
    expect(fileName('Straße am See', F('portrait', 1080))).toBe(
      'maptale-strasse-am-see-portrait-1080.mp4',
    )
    expect(fileName('   ')).toBe('maptale-tour-landscape-720.mp4')
  })

  it('nennt die Bildrate nur, wenn sie abweicht', () => {
    // Der Regelfall behält seinen gewohnten Namen; zwei Fassungen derselben
    // Tour überschreiben einander trotzdem nicht.
    expect(fileName('Koh Pha-ngan', F('landscape', 720, 30))).toBe(
      'maptale-koh-pha-ngan-landscape-720.mp4',
    )
    expect(fileName('Koh Pha-ngan', F('landscape', 720, 60))).toBe(
      'maptale-koh-pha-ngan-landscape-720-60fps.mp4',
    )
    expect(fileName('Koh Pha-ngan', F('landscape', 720, 24))).toBe(
      'maptale-koh-pha-ngan-landscape-720-24fps.mp4',
    )
  })
})

describe('Clip-Zeit', () => {
  it('hängt Intro und Finale an die Fahrt', () => {
    expect(exportClipDurationS(100, true)).toBe(EXPORT_INTRO_S + 100 + EXPORT_FINALE_S)
    expect(exportClipDurationS(100, false)).toBe(EXPORT_INTRO_S + 100)
    expect(exportClipDurationS(0, true)).toBe(0)
  })

  it('zählt Frames über die ganze Clip-Dauer', () => {
    expect(frameCount(10, EXPORT_FPS)).toBe(300)
    expect(frameCount(exportClipDurationS(10, false), EXPORT_FPS)).toBe(
      Math.round((EXPORT_INTRO_S + 10) * EXPORT_FPS),
    )
  })

  it('setzt die Filmsekunde auf i / fps, geklemmt auf die Dauer', () => {
    expect(filmTimeAtFrame(0, 30, 200)).toBe(0)
    expect(filmTimeAtFrame(30, 30, 200)).toBe(1)
    expect(filmTimeAtFrame(299, 30, 200)).toBeCloseTo(299 / 30)
    expect(filmTimeAtFrame(400, 30, 5)).toBe(5)
  })

  it('nennt Filmlänge und Frame', () => {
    expect(progressText(222, 1240, 7200)).toBe('3:42 · Frame 1240 von 7200')
  })

  it('sagt beim Verdecken Pause, nicht Abbruch', () => {
    expect(pausedText(222, 0, 7200)).toBe('Pausiert. Tab wieder öffnen · 3:42')
    expect(pausedText(222, 1240, 7200)).toBe(
      'Pausiert. Tab wieder öffnen · 3:42 · Frame 1240 von 7200',
    )
  })
})

// `kartenSicht` stand hier und ist mit dem Karten-Nachbau gegangen (Etappe 2
// der Kartenleinwand): Die Deckkraft der Foto-Karte rechnet jetzt
// `cardPhases` in src/card-painter.ts — für Bildschirm und Film aus einer
// Quelle, mit Blende UND Abgang statt einer linearen Rampe. Geprüft wird sie
// in test/kartenmaler.test.ts.

describe('Ton-Mix aus filmS', () => {
  it('verschiebt Studio-Spuren hinter das Intro', () => {
    const { clips, oneShots } = audioClipsFromTracks(
      [
        {
          type: 'music',
          src: '/a.mp3',
          f0: 0,
          f1: 1,
          filmFromS: 2,
          filmToS: 10,
          gain: 0.5,
        },
        { type: 'sfx', src: '/b.mp3', f0: 0, f1: 0, filmFromS: 4, filmToS: 4, gain: 1 },
      ],
      6,
      20,
      0.8,
    )
    expect(clips).toEqual([
      {
        src: '/a.mp3',
        fromClipS: 8,
        toClipS: 16,
        fileFromS: 0,
        loop: true,
        gain: 0.4,
      },
    ])
    expect(oneShots).toEqual([{ src: '/b.mp3', atClipS: 10, gain: 0.8 }])
  })

  it('kennt Motor und Wetter wie der Player', () => {
    expect(engineLoopSource('moped')).toBe('/audio/eng-moped.mp3')
    expect(engineLoopSource('walk')).toBeNull()
    expect(weatherLoopSource('rain', 1)?.src).toBe('/audio/rain.mp3')
    expect(weatherLoopSource('off', 1)).toBeNull()
  })

  it('zieht gleiche Frames zu Abschnitten', () => {
    const abs = mergeSegments(5, 1, (i) => {
      if (i < 3) return { src: 'a', gain: 0.2 }
      if (i === 3) return { src: 'b', gain: 0.1 }
      return null
    })
    expect(abs).toEqual([
      { src: 'a', fromClipS: 0, toClipS: 3, gain: 0.2 },
      { src: 'b', fromClipS: 3, toClipS: 4, gain: 0.1 },
    ])
  })
})

describe('Export-Kamera und Einbrand', () => {
  it('hält Walk aus dem Esri-Überzoom', () => {
    // Die Klemme sitzt seit dem Takt-Umbau in `Tour.exportSkalaMin` — hier steht
    // nur noch, dass die Zahl über der Fußgänger-Skala (0,5) liegt.
    expect(EXPORT_SCALE_MIN).toBeGreaterThan(0.5)
    expect(EXPORT_SCALE_MIN).toBeLessThanOrEqual(1)
  })

  it('hält den Marker in der Nähe des Player-Pucks', () => {
    expect(EXPORT_TAB_PX).toBeGreaterThanOrEqual(36)
    expect(EXPORT_TAB_PX).toBeLessThanOrEqual(48)
  })

  it('bricht die Rechtezeile an den Quellen, nicht mitten im Namen', () => {
    const mass = (s: string) => s.length * 10
    const zeilen = wrapAttribution(
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
    expect(attributionOpacity(0, 10)).toBe(0)
    expect(attributionOpacity(7.9, 10)).toBe(0)
    expect(attributionOpacity(8, 10)).toBe(0)
    expect(attributionOpacity(8.2, 10)).toBeCloseTo(0.5)
    expect(attributionOpacity(9, 10)).toBe(1)
    expect(attributionOpacity(10, 10)).toBe(1)
  })

  it('blendet die Startscreen-Tafel erst mit der Anfahrt aus', () => {
    expect(introPanelOpacity(0)).toBe(1)
    expect(introPanelOpacity(EXPORT_INTRO_S - 0.1)).toBe(1)
    expect(introPanelOpacity(EXPORT_INTRO_S + 0.6)).toBeCloseTo(0.5)
    expect(introPanelOpacity(EXPORT_INTRO_S + 1.2)).toBe(0)
    expect(introPanelOpacity(EXPORT_INTRO_S + 40)).toBe(0)
  })

  it('blendet die Finale-Tafel aus der Zeit SEIT dem Phasenwechsel ein', () => {
    // Nicht aus der Clip-Zeit: Ob und wann das Finale beginnt, entscheidet die
    // Engine (`showFinale`, Filmende), nicht der Encoder.
    expect(finalePanelOpacity(-1)).toBe(0)
    expect(finalePanelOpacity(0)).toBe(0)
    expect(finalePanelOpacity(0.45)).toBeCloseTo(0.5)
    expect(finalePanelOpacity(0.9)).toBe(1)
    expect(finalePanelOpacity(5)).toBe(1)
  })
})

describe('Rahmen im Studio', () => {
  it('markiert den eingebetteten Lauf in der Query', () => {
    expect(exportQuery(F('landscape', 720))).not.toContain('embedded')
    expect(exportQuery(F('landscape', 720), true)).toContain('embedded=1')
    expect(isEmbedded('?export=1&embedded=1')).toBe(true)
    expect(isEmbedded('?export=1')).toBe(false)
  })

  it('schätzt die Restzeit erst, wenn genug Bilder da sind', () => {
    // Die ersten Bilder tragen die Kachel-Erstladung und wären als Hochrechnung
    // das Zehnfache der Wahrheit.
    expect(remainingS(3, 1800, 6)).toBeNull()
    expect(remainingS(0, 1800, 0)).toBeNull()
    // 60 von 1800 in 30 s ⇒ 1740 Bilder à 0,5 s = 870 s
    expect(remainingS(60, 1800, 30)).toBeCloseTo(870)
    expect(remainingS(1800, 1800, 30)).toBeNull()
  })

  it('sagt die Restzeit in Minuten, nicht in Sekunden', () => {
    expect(remainingText(null)).toBe('Restzeit wird geschätzt')
    expect(remainingText(40)).toBe('noch keine Minute')
    expect(remainingText(70)).toBe('noch etwa 1 Minute')
    expect(remainingText(870)).toBe('noch etwa 15 Minuten')
    expect(remainingText(7400)).toBe('noch etwa 2 Stunden')
  })
})

describe('umbrich (Beschreibung auf der Titeltafel)', () => {
  // Die Tafel ist der einzige Ort, an dem der Export Text SETZT statt ihn zu
  // grabben — die Beschreibung ist zugleich der einzige Teil, dessen Höhe vom
  // Inhalt abhängt. Ein falscher Umbruch verschöbe den ganzen Block.
  const ctx = { measureText: (t: string) => ({ width: t.length * 10 }) }

  it('bricht an der Wortgrenze, sobald die Zeile nicht mehr passt', () => {
    expect(wrapLines(ctx, 'eins zwei drei vier', 100)).toEqual(['eins zwei', 'drei vier'])
  })

  it('lässt einen kurzen Satz in einer Zeile', () => {
    expect(wrapLines(ctx, 'kurz und gut', 1000)).toEqual(['kurz und gut'])
  })

  it('gibt ein überlanges Wort als eigene Zeile aus, statt zu hängen', () => {
    expect(wrapLines(ctx, 'Donaudampfschifffahrtsgesellschaft ja', 100)).toEqual([
      'Donaudampfschifffahrtsgesellschaft',
      'ja',
    ])
  })

  it('macht aus Leerraum keine leeren Zeilen', () => {
    expect(wrapLines(ctx, '  ', 100)).toEqual([])
    expect(wrapLines(ctx, 'a\n\nb', 1000)).toEqual(['a b'])
  })
})
