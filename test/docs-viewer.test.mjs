/*
 * Drift-Wächter für den Doku-Viewer (`npm run docs`).
 *
 * Er prüft die eine Eigenschaft, die man einem Generator nicht ansieht:
 * ERSCHEINT NEUES VON SELBST? Ein Ordner, eine `CLAUDE.md`, ein Konzept — wer
 * so etwas anlegt, merkt nie, dass es im Viewer fehlt; die Seite sieht ja
 * vollständig aus. Deshalb steht die Prüfung hier und nicht im Auge des
 * Betrachters.
 */

import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import {
  WURZEL,
  bereicheDieserDoku,
  sammleDokumente,
  sammleMockups,
  sammleRoadmap,
} from '../scripts/docs-viewer/sammeln.mjs'
import { bereichSeite, uebersichtSeite } from '../scripts/docs-viewer/seiten.mjs'
import { SYSTEMTEILE, systemteileVon } from '../scripts/docs-viewer/sammeln.mjs'
import {
  archivZiel,
  pruefePfad,
  rueckZiel,
  ZIELBEREICHE,
} from '../scripts/docs-viewer/dienst.mjs'

const dokumente = sammleDokumente()
const bereiche = bereicheDieserDoku()
const mockups = sammleMockups()

describe('Bereiche', () => {
  it('kennt jeden Ordner unter docs/, der Dokumente enthält', () => {
    // `archive/` ist die ABLAGE und keine Gliederung: Was dort liegt, hängt im
    // Viewer unter dem Bereich, aus dem es kam (Kopfzeile „Archiviert aus:").
    const ordner = new Set(
      dokumente
        .filter((d) => d.quelle.startsWith('docs/') && !d.archiviert)
        .map((d) => d.quelle.split('/')[1])
        .filter((teil) => !teil.endsWith('.md')),
    )
    for (const id of ordner) expect(bereiche.map((b) => b.id)).toContain(id)
  })

  it('führt keinen Bereich ohne Dokumente', () => {
    for (const b of bereiche)
      expect(dokumente.some((d) => d.bereich === b.id), `Bereich ${b.id} ist leer`).toBe(true)
  })

  it('ordnet jedes Dokument einem Bereich der Liste zu', () => {
    const ids = new Set(bereiche.map((b) => b.id))
    for (const d of dokumente) expect(ids, d.quelle).toContain(d.bereich)
  })
})

describe('Handbuch', () => {
  it('nimmt jede CLAUDE.md des Repos auf', () => {
    const gefunden = execFileSync('git', ['ls-files', '*CLAUDE.md', 'CLAUDE.md'], {
      cwd: WURZEL,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean)
    const erfasst = new Set(dokumente.map((d) => d.quelle))
    for (const pfad of gefunden) expect(erfasst, `${pfad} fehlt im Viewer`).toContain(pfad)
  })
})

describe('Roadmap', () => {
  const roadmap = sammleRoadmap(dokumente, mockups)

  it('verweist nur auf Dokumente, die es gibt', () => {
    expect(roadmap.unbekannt).toEqual([])
  })

  it('lässt kein Konzept unter den Tisch fallen', () => {
    // Drei Töpfe, und jedes Konzept liegt in genau einem: eingeplant,
    // abgearbeitet oder ohne Phase. Fiele eines aus allen dreien, wüsste
    // niemand davon — das ist der Fehler, den diese Ansicht verhindern soll.
    const inPhasen = new Set(roadmap.phasen.flatMap((p) => p.eintraege.map((e) => e.dok.abs)))
    const erledigt = new Set(roadmap.erledigt.map((d) => d.abs))
    const offen = new Set([...roadmap.offen.map((d) => d.abs), ...erledigt])
    // Archivierte Konzepte gehören nicht auf die Roadmap: Sie sind erledigt
    // oder verworfen — als „noch nicht eingeplant" zu erscheinen wäre eine
    // Aufforderung, sie einzuplanen.
    for (const d of dokumente.filter((x) => x.bereich === 'concepts' && !x.archiviert))
      expect(inPhasen.has(d.abs) || offen.has(d.abs), d.quelle).toBe(true)
  })
})

describe('Roadmap-Ansicht', () => {
  const roadmap = sammleRoadmap(dokumente, mockups)
  const html = uebersichtSeite({ bereiche, dokumente, mockups, bilder: [], roadmap })

  it('trennt Abgearbeitetes von dem, was niemand eingeplant hat', () => {
    // Beides in einer Liste behauptete Versäumnisse, wo Erledigtes stand.
    for (const d of roadmap.erledigt) expect(roadmap.offen).not.toContain(d)
    expect(html).toContain('Abgearbeitet')
  })

  it('zeigt den Statussatz der laufenden Vorhaben, nicht nur die Ampel', () => {
    const laufend = roadmap.phasen[0]?.eintraege ?? []
    const mitStand = laufend.filter((e) => e.dok?.kopf.status && !/^(konzept|entwurf)/i.test(e.dok.kopf.status))
    for (const e of mitStand)
      expect(html, e.dok.quelle).toContain(e.dok.kopf.status.slice(0, 24))
  })

  it('markiert den Widerspruch zwischen Phase und Stand', () => {
    // „In Arbeit" plus „nichts gebaut" ist entweder falsch einsortiert oder
    // veraltet — die Ansicht soll das zeigen und nicht glätten.
    const strittig = (roadmap.phasen[0]?.eintraege ?? []).filter((e) => e.dok?.ampel?.art === 'offen')
    if (strittig.length) expect(html).toContain('Stand prüfen')
    else expect(html).not.toContain('Stand prüfen')
  })
})

describe('Übersichtsseite', () => {
  const html = uebersichtSeite({
    bereiche,
    dokumente,
    mockups,
    bilder: [],
    roadmap: sammleRoadmap(dokumente, mockups),
  })

  it('nennt Mengen nur als Zahl, nie als ausgeschriebenes Wort', () => {
    // „sechs Bereiche" stand einmal im Text und blieb stehen, als der siebte
    // dazukam. Zahlwörter vor einer zählbaren Sache sind hier deshalb verboten.
    const zahlwort =
      /\b(ein|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf)\s+(Bereiche|Bereichen|Dokumente|Dokumenten|Prototypen|Mockups|Konzepte|Konzepten)\b/i
    expect(html.match(zahlwort)?.[0] ?? null).toBeNull()
  })

  it('zeigt die tatsächliche Zahl der Bereiche und Dokumente', () => {
    // Die Zahlen stehen ausgezeichnet im Satz (<b>43</b> Dokumente …), deshalb
    // wird auf das Auszeichnungs-Muster geprüft und nicht auf den ganzen Satz.
    expect(html).toContain(`<b>${dokumente.length}</b> Dokumente`)
    expect(html).toContain(`<b>${bereiche.length}</b> Bereichen`)
    expect(html).toContain(`<b>${mockups.length}</b> Prototypen`)
  })

  it('verlinkt jeden Bereich', () => {
    for (const b of bereiche) expect(html).toContain(`href="${b.id}/index.html"`)
  })
})

describe('Archiv', () => {
  it('ist kein eigener Bereich mehr, sondern hängt an seiner Herkunft', () => {
    expect(bereiche.map((b) => b.id)).not.toContain('archive')
    const archiviert = dokumente.filter((d) => d.archiviert)
    expect(archiviert.length).toBeGreaterThan(0)
    for (const d of archiviert) expect(bereiche.map((b) => b.id), d.quelle).toContain(d.bereich)
  })

  it('taucht nicht in den fünf jüngsten Änderungen der Übersicht auf', () => {
    const html = uebersichtSeite({
      bereiche,
      dokumente,
      mockups: [],
      bilder: [],
      roadmap: sammleRoadmap(dokumente, mockups),
    })
    const zeitstrahl = html.slice(html.indexOf('Zuletzt bewegt'))
    const kurzliste = zeitstrahl.slice(0, zeitstrahl.indexOf('<details'))
    for (const d of dokumente.filter((x) => x.archiviert))
      expect(kurzliste.includes(`href="${d.ziel}"`), d.quelle).toBe(false)
  })
})

describe('Listen', () => {
  const html = uebersichtSeite({
    bereiche,
    dokumente,
    mockups,
    bilder: [],
    roadmap: sammleRoadmap(dokumente, mockups),
  })

  it('gibt Zeitangaben relativ und das genaue Datum im Tooltip', () => {
    // „vor 3 Tagen" beantwortet „ist das noch aktuell?", ein Datum muss man
    // dafür erst im Kopf ausrechnen. Beides steht da, aber in dieser Rolle.
    expect(html).toMatch(/class="zeit"/)
  })

  it('reicht die Sortierdaten an jede Karte durch', () => {
    // Ohne diese Attribute sortiert der Viewer nichts — und es fiele nicht
    // auf, weil die Liste ja trotzdem dasteht.
    const seite = bereichSeite({
      bereich: bereiche.find((b) => b.id === 'concepts'),
      dokumente,
      bereiche,
      roadmap: sammleRoadmap(dokumente, mockups),
    })
    for (const attribut of ['data-datum', 'data-titel', 'data-minuten', 'data-verweise'])
      expect(seite, attribut).toContain(attribut)
    expect(seite).toContain('data-sortierung')
  })
})

describe('Klappentexte', () => {
  it('gibt jedem Dokument einen Satz mit auf den Weg', () => {
    for (const d of dokumente) expect(d.klappentext.length, d.quelle).toBeGreaterThan(10)
  })
})

describe('Schreibende Seite', () => {
  it('lässt nur Doku-Pfade zu', () => {
    // Der teuerste Fehler wäre ein Pfad, der als Zeichenkette harmlos aussieht
    // und aufgelöst aus der Doku herausführt.
    expect(() => pruefePfad('src/main.ts')).toThrow()
    expect(() => pruefePfad('docs/../package.json')).toThrow()
    expect(() => pruefePfad('docs/_site/index.html')).toThrow()
    expect(() => pruefePfad('../../etc/hosts')).toThrow()
    expect(pruefePfad('docs/roadmap.md')).toContain('/docs/roadmap.md')
    expect(pruefePfad('CLAUDE.md')).toContain('/CLAUDE.md')
  })

  it('verschiebt Dokumente und Mockups in ihr jeweiliges Archiv', () => {
    const konzept = dokumente.find((d) => d.bereich === 'concepts' && !d.archiviert)
    expect(archivZiel(konzept.quelle)).toContain('/docs/archive/')
    const mockup = mockups.find((m) => !m.archiv)
    expect(archivZiel('docs/' + mockup.quelle)).toContain('/docs/archive/mockups/')
  })

  it('holt nur in bekannte Bereiche zurück', () => {
    const archiviert = dokumente.find((d) => d.archiviert)
    if (!archiviert) return
    expect(() => rueckZiel(archiviert.quelle, 'irgendwo')).toThrow()
    expect(rueckZiel(archiviert.quelle, ZIELBEREICHE[0])).toContain('/docs/' + ZIELBEREICHE[0] + '/')
  })

  it('nimmt kein Dokument doppelt ins Archiv', () => {
    const archiviert = dokumente.find((d) => d.archiviert)
    if (!archiviert) return
    expect(() => archivZiel(archiviert.quelle)).toThrow()
  })
})

describe('Systemteile', () => {
  it('ordnet fast jedes Dokument mindestens einem Teil zu', () => {
    const ohne = dokumente.filter((d) => !d.teile.length)
    // Ein paar reine Gedankenpapiere nennen keine einzige Datei — das ist in
    // Ordnung. Bleibt mehr als ein Fünftel ohne Zuordnung, stimmt die Regel
    // nicht mehr und man sucht den Fehler in der Doku statt im Generator.
    expect(ohne.length / dokumente.length).toBeLessThan(0.2)
  })

  it('lässt den eigenen Ort schwerer wiegen als die Verweise', () => {
    // src/studio/CLAUDE.md verweist mehr auf den Server als auf sich selbst.
    const studio = dokumente.find((d) => d.quelle === 'src/studio/CLAUDE.md')
    if (studio) expect(studio.teile).toContain('studio')
    const android = dokumente.find((d) => d.quelle === 'android/CLAUDE.md')
    if (android) expect(android.teile).toContain('android')
  })

  it('nimmt die ausdrückliche Angabe, wenn eine dasteht', () => {
    const text = 'Systemteile: Android-App, Backend\n\nText über src/studio/editor.ts und src/main.ts.'
    expect(systemteileVon(text)).toEqual(['android', 'backend'])
  })

  it('kennt jeden vergebenen Teil in der Liste', () => {
    const ids = new Set(SYSTEMTEILE.map((t) => t.id))
    for (const d of dokumente) for (const id of d.teile) expect(ids, d.quelle).toContain(id)
    for (const m of mockups) for (const id of m.teile) expect(ids, m.quelle).toContain(id)
  })

  it('ordnet Mockups über ihren Namen zu', () => {
    const app = mockups.find((m) => m.name.startsWith('app-'))
    if (app) expect(app.teile).toContain('android')
  })
})

