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
import {
  bereichSeite,
  dokumentSeite,
  mockupSeite,
  uebersichtSeite,
} from '../scripts/docs-viewer/seiten.mjs'
import { escape } from '../scripts/docs-viewer/markdown.mjs'
import { ICONS, icon } from '../scripts/docs-viewer/icons.mjs'
import { SYSTEMTEILE, systemteileVon, verknuepfeMockups } from '../scripts/docs-viewer/sammeln.mjs'
import {
  archivZiel,
  editorBefehl,
  loeseHeraus,
  ordnePhase,
  roadmapOrdnen,
  roadmapSetzen,
  roadmapVerschieben,
  pruefePfad,
  rueckZiel,
  saubererName,
  ZIELBEREICHE,
} from '../scripts/docs-viewer/dienst.mjs'
import {
  FELDER,
  kopfVon,
  leseYaml,
  schreibeYaml,
  setzeKopf,
  teileKopf,
} from '../scripts/docs-viewer/kopf.mjs'
import { ampelAus, kopfDiff, kopfWerteAus } from '../scripts/docs-viewer/sammeln.mjs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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
      expect(
        dokumente.some((d) => d.bereich === b.id),
        `Bereich ${b.id} ist leer`,
      ).toBe(true)
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
    // Auf der Roadmap dürfen auch MOCKUPS stehen (ein Mockup ist oft der
    // nächste Schritt) — die haben kein `dok`. Der Zugriff ohne Fragezeichen
    // brach in dem Moment, in dem der erste Mockup eingeplant wurde.
    const inPhasen = new Set(
      roadmap.phasen.flatMap((p) => p.eintraege.map((e) => e.dok?.abs).filter(Boolean)),
    )
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
    const mitStand = laufend.filter(
      (e) => e.dok?.kopf.status && !/^(konzept|entwurf)/i.test(e.dok.kopf.status),
    )
    for (const e of mitStand) expect(html, e.dok.quelle).toContain(e.dok.kopf.status.slice(0, 24))
  })

  it('markiert den Widerspruch zwischen Phase und Stand', () => {
    // „In Arbeit" plus „nichts gebaut" ist entweder falsch einsortiert oder
    // veraltet — die Ansicht soll das zeigen und nicht glätten.
    //
    // Seit man Einträge zwischen den Spalten ZIEHEN kann, steht der Marker immer
    // im Markup; sichtbar macht ihn die CSS-Regel der laufenden Phase anhand von
    // `data-ampel`. Geprüft wird deshalb die Mechanik und nicht die Anwesenheit
    // einer Zeichenkette: Der Eintrag trägt das Attribut, und das Blatt hat die
    // Regel, die daraus den Marker macht. Die alte Fassung prüfte einen
    // `else`-Zweig, der seither nie mehr zutreffen kann.
    const strittig = (roadmap.phasen[0]?.eintraege ?? []).filter(
      (e) => e.dok?.ampel?.art === 'offen',
    )
    for (const e of strittig) expect(html).toContain(`data-datei="${e.quelle}" data-ampel="offen"`)
    const blatt = readFileSync(join(WURZEL, 'scripts/docs-viewer/assets/stil.css'), 'utf8')
    expect(blatt).toMatch(/\.rm-phase\.jetzt li\[data-ampel='offen'\] \.rm-fuss/)
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
      /\b(ein|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf)\s+(Bereiche|Bereichen|Dokumente|Dokumenten|Mockups|Mockups|Konzepte|Konzepten)\b/i
    expect(html.match(zahlwort)?.[0] ?? null).toBeNull()
  })

  it('zeigt die tatsächliche Zahl der Bereiche und Dokumente', () => {
    // Die Zahlen stehen ausgezeichnet im Satz (<b>43</b> Dokumente …), deshalb
    // wird auf das Auszeichnungs-Muster geprüft und nicht auf den ganzen Satz.
    expect(html).toContain(`<b>${dokumente.length}</b> Dokumente`)
    expect(html).toContain(`<b>${bereiche.length}</b> Bereichen`)
    expect(html).toContain(`<b>${mockups.length}</b> Mockups`)
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
    for (const d of archiviert)
      expect(
        bereiche.map((b) => b.id),
        d.quelle,
      ).toContain(d.bereich)
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

  it('holt dorthin zurück, wo die Datei herkam', () => {
    // Ein Mockup kennt nur einen Weg zurück — der Bereich ist dabei ohne
    // Belang, weil er für ein Mockup keine Bedeutung hat.
    const mockup = mockups.find((m) => m.archiv)
    if (mockup) expect(rueckZiel('docs/' + mockup.quelle)).toContain('/docs/mockups/')

    // Ein Dokument nennt seine Herkunft im Kopf: Sie gilt auch dann, wenn der
    // Aufrufer keinen oder einen unsinnigen Bereich mitschickt.
    const mitHerkunft = dokumente.find((d) => d.archiviert && d.kopf.archiviertAus)
    if (mitHerkunft) {
      const her = mitHerkunft.kopf.archiviertAus
      expect(rueckZiel(mitHerkunft.quelle)).toContain('/docs/' + her + '/')
      expect(rueckZiel(mitHerkunft.quelle, 'irgendwo')).toContain('/docs/' + her + '/')
      // Ein ausdrücklich genannter Bereich schlägt sie — das ist der Fall,
      // den die Auswahl im Viewer noch anbietet.
      const anders = ZIELBEREICHE.find((b) => b !== her)
      expect(rueckZiel(mitHerkunft.quelle, anders)).toContain('/docs/' + anders + '/')
    }
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
    const text =
      'Systemteile: Android-App, Backend\n\nText über src/studio/editor.ts und src/main.ts.'
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

/* ── Der Kopf eines Dokuments ─────────────────────────────────────────────
 * Front Matter ist die strukturierte Fassung dessen, was vorher als Prosa
 * unter der Überschrift stand. Zwei Sorten Fehler sind dabei still, und genau
 * die stehen hier: ein Feld, das falsch geschrieben ist (der Leser sieht die
 * Angabe im Dokument, der Viewer nie), und ein Dokument, das den Stand ZWEIMAL
 * trägt — einmal im Kopf, einmal noch als Zeile im Text. */

describe('Front Matter', () => {
  it('liest Skalare, Klammerlisten und Strichlisten', () => {
    const { daten, koerper } = teileKopf(
      '---\nstand: 2026-08-17\nsystemteile: [Player, Studio]\nbetrifft:\n  - src/ui.ts\n  - src/tour.ts\n---\n\n# Titel\n',
    )
    expect(daten.stand).toBe('2026-08-17')
    expect(daten.systemteile).toEqual(['Player', 'Studio'])
    expect(daten.betrifft).toEqual(['src/ui.ts', 'src/tour.ts'])
    expect(koerper).toBe('# Titel\n')
  })

  it('erkennt nur einen Block in der ersten Zeile', () => {
    // Mitten im Text ist `---` eine waagerechte Linie, und die kommt in
    // unseren Konzepten vor.
    const { roh } = teileKopf('# Titel\n\nText\n\n---\n\nMehr Text\n')
    expect(roh).toBe(null)
  })

  it('zitiert Werte, die sonst die Zeile zerreißen', () => {
    const roh = schreibeYaml({ status: 'Etappe 1: gebaut', stand: '2026-08-17' })
    expect(leseYaml(roh).status).toBe('Etappe 1: gebaut')
    expect(leseYaml(roh).stand).toBe('2026-08-17')
  })

  it('setzt und entfernt einzelne Felder', () => {
    const mit = setzeKopf('# Titel\n\nText\n', { archiviert_aus: 'concepts' })
    expect(teileKopf(mit).daten.archiviert_aus).toBe('concepts')
    const ohne = setzeKopf(mit, { archiviert_aus: null })
    expect(teileKopf(ohne).roh).toBe(null)
    expect(ohne).toContain('# Titel')
  })

  it('lässt Front Matter die Prosa-Zeile FELDWEISE schlagen', () => {
    // Nicht Block gegen Block: Ein Kopf mit nur `stand:` darf die übrigen
    // Angaben des Dokuments nicht löschen.
    const kopf = kopfVon(
      '---\nstand: 2026-08-17\n---\n\n# T\n\nStatus: **Entwurf, nichts gebaut**\n',
    )
    expect(kopf.stand).toBe('2026-08-17')
    expect(kopf.status).toBe('Entwurf, nichts gebaut')
  })

  it('gibt Betrifft immer als Liste zurück', () => {
    expect(kopfVon('# T\n\nBetrifft: `src/ui.ts`, `src/tour.ts`\n').betrifft).toEqual([
      'src/ui.ts',
      'src/tour.ts',
    ])
    expect(kopfVon('---\nbetrifft: [src/ui.ts]\n---\n\n# T\n').betrifft).toEqual(['src/ui.ts'])
  })

  it('kennt jeden Feldnamen, der in der Doku steht', () => {
    // Ein Tippfehler (`sytemteile:`) wird stumm ignoriert — das Dokument sieht
    // dann vollständig aus und der Viewer weiß nichts davon. Geprüft wird nur
    // `docs/`: DESIGN.md an der Wurzel trägt einen YAML-Block, der dort der
    // INHALT ist (Farben, Schrift), und der wird bewusst nicht gedeutet.
    for (const d of dokumente.filter((d) => d.quelle.startsWith('docs/'))) {
      const { roh, daten } = teileKopf(readFileSync(join(WURZEL, d.quelle), 'utf8'))
      if (roh == null) continue
      for (const name of Object.keys(daten)) expect(FELDER, `${d.quelle}: ${name}`).toContain(name)
    }
  })

  it('trägt dasselbe Feld nie zweimal', () => {
    // Gemeint ist DASSELBE Feld an zwei Orten: Ein archiviertes Dokument mit
    // `archiviert_aus` im Kopf und einer Prosa-Zeile „Stand: …" im Text ist in
    // Ordnung — dort steht jede Angabe genau einmal. Zwei Ständen dagegen
    // glaubt man dem falschen.
    const doppelt = []
    for (const d of dokumente.filter((d) => d.quelle.startsWith('docs/'))) {
      const { roh, daten, koerper } = teileKopf(readFileSync(join(WURZEL, d.quelle), 'utf8'))
      if (roh == null) continue
      for (const [feld, wort] of [
        ['stand', 'Stand'],
        ['status', 'Status'],
        ['betrifft', 'Betrifft'],
        ['archiviert_aus', 'Archiviert aus'],
      ])
        if (daten[feld] != null && new RegExp(`^\\*{0,2}${wort}\\*{0,2}\\s*:`, 'm').test(koerper))
          doppelt.push(`${d.quelle} (${feld})`)
    }
    expect(doppelt).toEqual([])
  })

  it('hält den Körper aus der Lesezeit heraus', () => {
    // Front Matter ist eine Angabe ÜBER das Dokument, kein Teil seines Textes:
    // Stünde er im Modell, zählte er als Lesezeit mit und wäre durchsuchbar.
    for (const d of dokumente.filter((d) => d.quelle.startsWith('docs/')))
      expect(d.text.trimStart().startsWith('---'), d.quelle).toBe(false)
  })

  it('lässt DESIGN.md seinen YAML-Kopf BEHALTEN', () => {
    // Dort ist der Block der Inhalt (Google-DESIGN.md-Format): Farben,
    // Schrift, Maße. Gedeutet als Metadaten verschwände das halbe
    // Design-System aus der Ansicht, ohne dass eine Zeile fehlte.
    const design = dokumente.find((d) => d.quelle === 'DESIGN.md')
    expect(design, 'DESIGN.md fehlt im Modell').toBeTruthy()
    expect(design.text).toContain('primary:')
    expect(design.kopf.stand).toBe('')
  })
})

describe('Ampel aus dem Status', () => {
  it('macht aus „noch nicht gebaut" keinen fertigen Stand', () => {
    // Die Falle: „noch nicht gebaut" und „nichts davon umgesetzt" enthalten
    // beide Wörter, an denen die späteren Prüfungen hängen.
    for (const satz of [
      'geplant, noch nicht gebaut',
      'nichts davon umgesetzt',
      'am 13.08. geprüft und VERTAGT (§9), nichts davon umgesetzt',
      'Entwurf, nichts gebaut',
    ])
      expect(ampelAus({ status: satz }, 'concepts').art, satz).toBe('offen')
  })

  it('erkennt Gebautes und Angefangenes weiterhin', () => {
    expect(ampelAus({ status: 'Server und Studio gebaut, App offen' }, 'concepts').art).toBe(
      'unterwegs',
    )
    expect(ampelAus({ status: 'Etappen 1–7 umgesetzt' }, 'architecture').art).toBe('unterwegs')
    expect(ampelAus({ status: 'live seit 2026-08-10' }, 'concepts').art).toBe('fertig')
  })
})

describe('Konzept und Mockup kennen sich', () => {
  // ABGELEITET, NICHT VERLANGT: Die Konzepte verlinken ihre Mockups ohnehin
  // im Text. Ein Pflichtfeld wäre beim nächsten Mockup vergessen; wer
  // verlinkt, stellt die Beziehung her. Wo der Link fehlt, sie aber besteht,
  // übersteuert `<meta name="maptale:gehoert-zu">`.
  // Die MODULWEITEN `dokumente` verknüpfen, nicht eine frische Kopie: Sonst
  // hängt die Rückrichtung an Objekten, die der Test danach nie ansieht.
  const eigene = verknuepfeMockups(dokumente, sammleMockups())

  it('führt die Beziehung in beide Richtungen', () => {
    const mitKonzept = eigene.filter((m) => m.konzepte.length)
    expect(mitKonzept.length, 'kein Mockup mit Konzept').toBeGreaterThan(5)
    for (const m of mitKonzept)
      for (const k of m.konzepte) {
        const dok = dokumente.find((d) => d.quelle === k.quelle)
        expect(dok, k.quelle).toBeTruthy()
        expect(
          dok.prototypen.map((p) => p.quelle),
          `${k.quelle} kennt ${m.quelle} nicht`,
        ).toContain(m.quelle)
      }
  })

  it('erlaubt mehrere Konzepte je Mockup', () => {
    // `studio-konto.html` gehört zu Profil/Konto UND Newsletter. Eine
    // 1:1-Beziehung hätte einen der beiden verschluckt.
    const mehrfach = eigene.filter((m) => m.konzepte.length > 1)
    expect(mehrfach.length).toBeGreaterThan(0)
  })

  it('erfindet kein Konzept, wo keins ist', () => {
    // 14 von 25 gehören zu keinem, und bei mehreren ist das richtig:
    // `logo-varianten.html` wurde gezeichnet und direkt gebaut.
    const ohne = eigene.filter((m) => !m.konzepte.length)
    expect(ohne.length).toBeGreaterThan(0)
    for (const m of ohne) expect(m.konzepte).toEqual([])
  })

  it('sagt an JEDER Kachel, ob eine Beziehung besteht — Zeile oder Marke', () => {
    // Drei Fassungen, jede an derselben Frage gescheitert: „Gehört zu …" war ein
    // Satzanfang und zu leise; das Etikett mit „keines verlinkt" stand im selben
    // Grau wie ein ausgefüllter Wert und ging unter. Jetzt trägt die Kachel
    // ENTWEDER die Beziehung als Zeile ODER die Marke „ohne Konzept" oben bei
    // den übrigen Marken — nie beides und nie keins von beiden.
    const html = mockupSeite({
      mockups: eigene,
      bereiche,
      roadmap: sammleRoadmap(dokumente, eigene),
      schriftLokal: false,
    })
    const kacheln = html.split('<article class="mockup"').slice(1)
    expect(kacheln.length).toBe(eigene.length)
    for (const kachel of kacheln) {
      const bis = kachel.indexOf('</article>')
      const inhalt = kachel.slice(0, bis === -1 ? undefined : bis)
      const hatZeile = inhalt.includes('mockup-konzept-etikett')
      const hatMarke = inhalt.includes('marke-fehlt')
      const archiviert = inhalt.includes('ampel-ruht')
      // JEDE Kachel hat die Beziehungszeile — gefüllt oder als leere Spur, die
      // sie auf Höhe ihrer Nachbarn hält. Ohne sie war die Höhenspanne 75 px.
      expect(inhalt.includes('class="mockup-konzept'), 'Spur fehlt').toBe(true)
      expect(inhalt.includes('mockup-konzept leer'), 'leere Spur falsch gesetzt').toBe(!hatZeile)
      // Im Archiv steht keine Marke: Was dort liegt, wird nicht mehr eingeplant.
      if (archiviert) continue
      expect(hatZeile !== hatMarke, inhalt.slice(0, 90)).toBe(true)
    }
    expect(html).not.toContain('Gehört zu')
    expect(html).not.toContain('keines verlinkt')
  })

  it('reserviert die Spuren, die die Kacheln gleich hoch machen', () => {
    // Gleich hohe Kacheln entstehen aus gleich hohen INHALTEN, nicht aus
    // Streckung: Gestreckt mit Fuß unten klaffte in kurzen Kacheln ein Loch von
    // 80 px. Gemessen kam die Spanne (75 px) aus zwei Stellen — Titel ein- oder
    // zweizeilig, Beziehungszeile null- bis zweizeilig. Beide haben jetzt eine
    // feste Spur.
    const blatt = readFileSync(join(WURZEL, 'scripts/docs-viewer/assets/stil.css'), 'utf8')
    expect(blatt).toMatch(/\.mockup-text h3 \{[^}]*min-height/)
    expect(blatt).toMatch(/\.mockup-text h3 \{[^}]*line-clamp: 2/)
    expect(blatt).toMatch(/\.mockup-konzept \{[^}]*min-height/)
    expect(blatt).toMatch(/\.mockup-konzept-wert \{[^}]*text-overflow: ellipsis/)
  })

  it('hebt Karten beim Überfahren ohne sie zu BEWEGEN', () => {
    // `transform: translateY(-2px)` auf `:hover` ist ein Hover, der gegen den
    // Zeiger arbeitet: Die Karte wandert unter ihm weg, verliert an der Kante
    // den Hover, fällt zurück — sie zuckt. Bei kurzen Kacheln ständig.
    // KOMMENTARE ZUERST WEG: Die erste Fassung dieses Wächters schlug an ihrem
    // eigenen Begleittext an, der die verworfene Regel zitiert.
    const blatt = readFileSync(join(WURZEL, 'scripts/docs-viewer/assets/stil.css'), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    )
    const hoverRegeln = blatt.match(/[^}]*:hover[^{]*\{[^}]*\}/g) ?? []
    const bewegend = hoverRegeln.filter((r) => /transform:\s*translate/.test(r))
    expect(bewegend, 'Hover verschiebt ein Element').toEqual([])
  })

  it('verlinkt das Konzept von der Kachel aus', () => {
    const html = mockupSeite({
      mockups: eigene,
      bereiche,
      roadmap: sammleRoadmap(dokumente, eigene),
      schriftLokal: false,
    })
    const mit = eigene.find((m) => m.konzepte.length)
    expect(html).toContain('mockup-konzept')
    expect(html).toContain(`href="${mit.konzepte[0].ziel}"`)
  })
})

describe('Auf die Roadmap kommen nur Konzepte', () => {
  // Ein Mockup ist eine ANTWORT in einem Konzept, kein eigener Plan: Er hat
  // keinen Status, keine Ampel und kann nie abgearbeitet sein — auf einer Karte
  // neben Konzepten fehlte ihm genau die Auskunft, um die es dort geht. Der
  // Anlass war handfest: „Maptale App, vorhandene Bilder hinzufügen" stand neben
  // „Medien nachreichen — die App-Seite fehlt noch", also dasselbe Vorhaben
  // zweimal, einmal mit Status und einmal ohne.
  const roadmap = sammleRoadmap(dokumente, mockups)

  it('führt kein Mockup als Eintrag', () => {
    for (const phase of roadmap.phasen)
      for (const e of phase.eintraege) {
        expect(e.dok, `${phase.name}: Eintrag ohne Dokument`).toBeTruthy()
        expect(e.quelle.endsWith('.html'), e.quelle).toBe(false)
      }
  })

  it('übergeht einen eingetragenen Mockup nicht stumm', () => {
    // Er landet in `prototypen` und wird beim Bauen genannt — als „fehlende
    // Datei" gemeldet zu werden wäre die falsche Auskunft, und stumm zu
    // verschwinden die schlechtere.
    expect(roadmap.prototypen).toBeDefined()
    expect(roadmap.unbekannt).toEqual([])
  })

  it('weist ein Mockup beim Einplanen ab', () => {
    const mockup = mockups.find((m) => !m.archiv)
    expect(() => roadmapSetzen('docs/' + mockup.quelle, 'Angedacht')).toThrow(/Konzepte/)
  })

  it('bietet auf einer Mockup-Kachel keine Phase an', () => {
    // Ein Menü, das eine Phase anbietet, die der Sammler danach verweigert,
    // wäre eine Einladung in eine Sackgasse.
    const html = mockupSeite({ mockups, bereiche, roadmap, schriftLokal: false })
    expect(html).not.toContain('data-roadmap-phase')
  })
})

describe('Roadmap als Ablauf', () => {
  const roadmap = sammleRoadmap(dokumente, mockups)
  const html = uebersichtSeite({
    dokumente,
    bereiche,
    mockups,
    bilder: [],
    roadmap,
    schriftLokal: false,
  })

  it('leitet die Gegenrichtung einer Blockade selbst ab', () => {
    // Notiert wird nur EINE Richtung (`[wartet auf: …]` am wartenden Eintrag).
    // Stünden beide in der Datei, liefen sie beim ersten Umplanen auseinander.
    const wartend = roadmap.phasen.flatMap((p) => p.eintraege).filter((e) => e.wartet)
    expect(wartend.length, 'keine Blockade in roadmap.md').toBeGreaterThan(0)
    for (const e of wartend) {
      const ziel = roadmap.phasen
        .flatMap((p) => p.eintraege)
        .find((a) => a.quelle === e.wartet.quelle)
      if (!ziel) continue
      expect(ziel.blockiert.map((b) => b.quelle)).toContain(e.quelle)
    }
    // Gezeigt wird nur die WARTENDE Seite: Dieselbe Abhängigkeit stand sonst
    // zweimal auf derselben Seite, und handeln muss man dort, wo etwas wartet.
    // Die Gegenrichtung bleibt im Modell — sie ist die Grundlage der Prüfung
    // oben und macht die Beziehung nachvollziehbar.
    expect(html).toContain('wartet auf')
    expect(html).not.toContain('class="rm-kette blockiert"')
  })

  it('nimmt den Linktext aus roadmap.md als Kartennamen', () => {
    // Dort steht der kurze Name; der Dokumenttitel ist oft „Umbauplan: … (x.ts)".
    const mitNamen = roadmap.phasen.flatMap((p) => p.eintraege).filter((e) => e.beschriftung)
    expect(mitNamen.length).toBeGreaterThan(0)
    for (const e of mitNamen.slice(0, 5)) expect(html).toContain(`>${e.beschriftung}<`)
  })

  it('zeigt den Statussatz nicht mehr als Text auf der Karte', () => {
    // Zwei angeschnittene Sätze übereinander liest niemand. Der Stand hängt im
    // Tooltip; sichtbar bleibt er nur als Fund („Stand prüfen").
    // Über ALLE Phasen und nicht über die erste: Die laufende Spalte darf leer
    // sein (und ist es, sobald abgearbeitet ist, was in Arbeit war).
    const mitStatus = roadmap.phasen.flatMap((p) => p.eintraege).filter((e) => e.dok?.kopf.status)
    expect(mitStatus.length).toBeGreaterThan(0)
    expect(html).not.toContain('class="rm-stand"')
  })

  it('behält den Kurznamen, wenn eine Phase gewechselt wird', () => {
    // Ein Phasenwechsel löst die Zeile heraus und schreibt sie neu. Die
    // Oberfläche übergibt dabei den DOKUMENTTITEL — ohne Schutz setzte jedes
    // Verschieben den von Hand gewählten Kurznamen still zurück auf
    // „Umbauplan: Studio-Editor zerlegen (editor.ts)".
    const zeilen = [
      '## In Arbeit',
      '* [Studio-Editor zerlegen](concepts/x.md) — Bevor er wächst.',
      '## Beschlossen',
    ]
    const { beschriftung, schritt } = loeseHeraus(zeilen, 'concepts/x.md')
    expect(beschriftung).toBe('Studio-Editor zerlegen')
    expect(schritt).toBe('Bevor er wächst.')
    // Ein Dateiname als Linktext ist KEIN Kurzname — dort darf der Titel greifen.
    expect(loeseHeraus(['* [x.md](concepts/x.md) — y'], 'concepts/x.md').beschriftung).toBe('')
  })

  it('gibt jeder Karte ein eigenes Zeichen', () => {
    // Das Icon steht von Hand im Kopf (`icon:`), und genau deshalb kann es
    // fehlen oder sich verschreiben. Beides ist still: Die Karte bekommt das
    // neutrale Blatt und sieht aus, als gehörte sie dorthin. Zwei Wächter:
    // jeder Name muss es geben, und auf der Roadmap muss jeder eins haben.
    for (const d of dokumente)
      if (d.kopf.icon)
        expect(Object.keys(ICONS), `${d.quelle}: icon: ${d.kopf.icon}`).toContain(d.kopf.icon)
    for (const e of roadmap.phasen.flatMap((p) => p.eintraege))
      expect(ICONS[e.dok.kopf.icon], `${e.quelle} hat kein Zeichen`).toBeTruthy()
    // Und der Rückfall trägt: ein unbekannter Name kostet keine Karte.
    expect(icon('gibtesnicht')).toContain('<svg')
    expect(icon('gibtesnicht')).toBe(icon('blatt'))
  })

  it('zeigt eine leere Phase trotzdem als Spalte', () => {
    // Der Grund ist nicht Vollständigkeit, sondern Bedienbarkeit: In eine
    // Spalte, die nicht da ist, kann man nichts ziehen. Räumt man „In Arbeit"
    // leer, wäre die Phase sonst nur noch über die Datei erreichbar — und der
    // Platzhalter sagt, dass die leere Spalte ein Angebot ist und kein Fehler.
    const leer = {
      ...roadmap,
      phasen: [
        { name: 'In Arbeit', zeitraum: '', text: '', eintraege: [] },
        ...roadmap.phasen.slice(1),
      ],
    }
    const seite = uebersichtSeite({
      dokumente,
      bereiche,
      mockups,
      bilder: [],
      roadmap: leer,
      schriftLokal: false,
    })
    expect(seite).toContain('data-phase="In Arbeit"')
    expect(seite).toContain('rm-leer')
    // Und die laufende Phase bleibt die erste: `phasen[0]` ist die Grundlage
    // der Ruht-Warnung beim Bauen — ohne die leere Spalte wäre das „Beschlossen".
    expect(leer.phasen[0].name).toBe('In Arbeit')
  })

  it('meldet, was im Code ist, aber in keiner Phase steht', () => {
    // Der teurere Teil von „ohne Phase": Ein Vorhaben, an dem gearbeitet wird,
    // taucht auf der Roadmap gar nicht auf — und fällt genau deshalb niemandem
    // auf. Dieselbe Frage wie „Stand prüfen", nur andersherum.
    expect(roadmap.imCode).toBeDefined()
    expect(roadmap.nurGedacht.every((d) => !roadmap.imCode.includes(d))).toBe(true)
    if (roadmap.imCode.length) expect(html).toContain('in keiner Phase')
  })
})

describe('Karten sind zwischen den Phasen austauschbar', () => {
  // Seit man Einträge zwischen den Spalten ZIEHEN kann, darf ihr Inhalt nicht
  // mehr an der Phase hängen. Vorher wurde der nächste Schritt nur in den ersten
  // zwei Spalten gerendert und „Stand prüfen" nur in der ersten: Ein Eintrag aus
  // „Angedacht" stand nach dem Zug ohne Schritt zwischen Nachbarn, die alle
  // einen haben. Die Phase entscheidet jetzt nur über die DARSTELLUNG (CSS am
  // Elternteil), und die passt sich beim Umzug von selbst an.
  const roadmap = sammleRoadmap(dokumente, mockups)
  const html = uebersichtSeite({
    dokumente,
    bereiche,
    mockups,
    bilder: [],
    roadmap,
    schriftLokal: false,
  })

  it('rendert den nächsten Schritt in JEDER Phase', () => {
    let gesehen = 0
    for (const phase of roadmap.phasen) {
      // Eine LEERE Phase ist erlaubt — sie steht trotzdem als Spalte da, damit
      // man etwas hineinziehen kann. Geprüft wird, was sie trägt, nicht dass
      // sie etwas trägt.
      const mitSchritt = phase.eintraege.filter((e) => e.schritt)
      gesehen += mitSchritt.length
      for (const e of mitSchritt)
        expect(html, `${phase.name}: ${e.quelle}`).toContain(escape(e.schritt))
    }
    expect(gesehen, 'keine einzige Phase hat einen Schritt').toBeGreaterThan(0)
  })

  it('trägt den Widerspruchs-Marker als Daten, nicht als Berechnung', () => {
    // `data-ampel` steht am Eintrag, sichtbar macht ihn die CSS-Regel der
    // laufenden Phase. Als JS-Berechnung wäre er nach jedem Zug veraltet.
    expect(html).toContain('data-ampel="offen"')
    const entwuerfeSpaeterePhasen = (roadmap.phasen[2]?.eintraege ?? []).filter(
      (e) => e.dok?.ampel?.art === 'offen',
    )
    expect(entwuerfeSpaeterePhasen.length, 'kein Entwurf in der letzten Phase').toBeGreaterThan(0)
    // Auch dort steht der Marker im Markup — nur unsichtbar.
    expect(html.match(/Stand prüfen/g).length).toBeGreaterThan(
      (roadmap.phasen[0]?.eintraege ?? []).length,
    )
  })

  it('gibt dem Griff eine eigene Spalte, keinen Platz über dem Text', () => {
    // Absolut positioniert lag er auf den ersten Buchstaben des Titels — in den
    // knappen Zeilen der letzten Phase war das nicht zu übersehen.
    const blatt = readFileSync(join(WURZEL, 'scripts/docs-viewer/assets/stil.css'), 'utf8')
    expect(blatt).toMatch(/\.rm-liste\[data-phase\] li \{[^}]*grid-template-columns/)
    expect(html).toContain('class="rm-inhalt"')
  })
})

describe('Reihenfolge in einer Phase', () => {
  // Gezogen wird mit der Maus, geschrieben wird die ganze Reihenfolge EINER
  // Phase. Geprüft wird die echte Funktion aus dem Dienst, nur an Zeilen statt
  // an der Datei — eine nachgebaute Kopie im Test wäre grün geblieben, während
  // der Code daneben bricht.
  const zeilen = () => [
    '## In Arbeit',
    '',
    '* [A](concepts/a.md) — Erstens.',
    '* [B](concepts/b.md) — Zweitens. [wartet auf: concepts/a.md]',
    '* [C](concepts/c.md) — Drittens.',
    '',
    '## Beschlossen',
    '',
    '* [D](concepts/d.md) — Viertens.',
  ]

  it('ordnet die Zeilen einer Phase neu, samt Schritt und Blockade', () => {
    const nach = ordnePhase(zeilen(), 'In Arbeit', [
      'concepts/c.md',
      'concepts/b.md',
      'concepts/a.md',
    ])
    expect(nach[2]).toContain('[C]')
    expect(nach[3]).toContain('[B]')
    expect(nach[3]).toContain('[wartet auf: concepts/a.md]')
    expect(nach[4]).toContain('[A]')
  })

  it('lässt die anderen Phasen unberührt', () => {
    const nach = ordnePhase(zeilen(), 'In Arbeit', [
      'concepts/c.md',
      'concepts/a.md',
      'concepts/b.md',
    ])
    expect(nach[8]).toContain('[D]')
    expect(nach[6]).toBe('## Beschlossen')
  })

  it('verliert nichts, was in der Reihenfolge fehlt', () => {
    // Eine veraltete Seite darf die Datei nicht leer räumen: Was sie nicht
    // nennt, behält seine Lage am Ende.
    const nach = ordnePhase(zeilen(), 'In Arbeit', ['concepts/c.md'])
    const punkte = nach.filter((z) => z.startsWith('* ['))
    expect(punkte.length).toBe(4)
    expect(nach[2]).toContain('[C]')
    expect(punkte.some((z) => z.includes('[A]'))).toBe(true)
    expect(punkte.some((z) => z.includes('[B]'))).toBe(true)
  })

  it('prüft die ganze Reihenfolge, BEVOR es schreibt', () => {
    // Ein Phasenwechsel sind zwei Schreibvorgänge. Scheitert der zweite, stand
    // die Phase schon woanders, während die Meldung „Außerhalb der Doku"
    // behauptete, es sei nichts passiert. Genau so beobachtet.
    const datei = join(WURZEL, 'docs/roadmap.md')
    const vorher = readFileSync(datei, 'utf8')
    expect(() =>
      roadmapVerschieben('docs/concepts/editor-ausbau.md', 'In Arbeit', ['concepts/gibtsnicht.md']),
    ).toThrow(/Außerhalb der Doku|Gibt es nicht/)
    expect(readFileSync(datei, 'utf8'), 'roadmap.md wurde trotz Fehler angefasst').toBe(vorher)
  })

  it('unterscheidet eine unbekannte Phase von einer Nichtänderung', () => {
    // Beides fiel vorher auf dieselbe Antwort, und deshalb blieb ein echter
    // Fehler still: Die Oberfläche schickte die Phase nicht mit, der Server
    // ordnete eine Phase namens `''` — nichts passierte, und die Meldung lautete
    // „Reihenfolge unverändert". Genau diese Verwechslung darf es nicht geben.
    expect(() => roadmapOrdnen('', ['docs/concepts/editor-ausbau.md'])).toThrow(/Unbekannte Phase/)
    expect(() => roadmapOrdnen('Gibt es nicht', ['docs/concepts/editor-ausbau.md'])).toThrow(
      /Unbekannte Phase/,
    )
  })

  it('meldet „nichts zu tun", wo sich nichts ändert', () => {
    expect(
      ordnePhase(zeilen(), 'In Arbeit', ['concepts/a.md', 'concepts/b.md', 'concepts/c.md']),
    ).toBe(null)
    expect(ordnePhase(zeilen(), 'Gibt es nicht', ['concepts/a.md'])).toBe(null)
  })
})

describe('Keine Angabe steht zweimal', () => {
  // Über dem Titel standen fünf Marken, drei davon Kompressionen des Textes
  // einen Zentimeter tiefer: „Entwurf" für den ganzen Statussatz, „Player" für
  // die Pfadliste, „zuletzt 17. Aug." neben einem „Stand: 17. August". Die
  // Regel dagegen gilt zweimal: DIE ZUSAMMENFASSUNG ERSCHEINT NUR, WO DIE
  // AUSFÜHRUNG FEHLT.
  const seite = (dok) =>
    dokumentSeite({
      dok,
      html: '<h1>T</h1>',
      ueberschriften: [],
      dokumente,
      bereiche,
      nachAbs: new Map(dokumente.map((d) => [d.abs, d])),
      roadmap: sammleRoadmap(dokumente, mockups),
      schriftLokal: false,
    })

  /** Nur die Kopftafel, nicht der Text des Dokuments darunter. */
  const tafelVon = (html) => html.slice(html.indexOf('kopftafel'), html.indexOf('</dl>'))

  it('trägt keine Marken über dem Titel — dort stehen nur Weg und Werkzeuge', () => {
    // Fünf Marken in einer Reihe, darunter eine HANDLUNG in derselben Form:
    // Man musste jede lesen, um zu wissen, ob sie etwas sagt oder etwas tut.
    const html = seite(dokumente.find((d) => d.kopf.status))
    const kopfzeile = html.slice(html.indexOf('dok-kopfzeile'), html.indexOf('class="prosa"'))
    expect(kopfzeile).not.toContain('class="chip"')
    expect(kopfzeile).not.toContain('class="ampel')
    expect(kopfzeile).not.toContain('phasen-chip')
    expect(kopfzeile).toContain('data-bearbeiten')
  })

  it('nennt den Status genau einmal, und dort immer', () => {
    const mitSatz = dokumente.find((d) => d.kopf.status && d.ampel)
    expect(tafelVon(seite(mitSatz))).toContain(mitSatz.kopf.status.slice(0, 20))

    // Ohne eigenen Satz steht dort das Wort der Ampel — die Handbuch-Dateien
    // tragen „Verbindlich", und das sagt kein Satz im Dokument.
    const ohneSatz = dokumente.find((d) => !d.kopf.status && d.ampel)
    expect(ohneSatz, 'kein Dokument ohne Status').toBeTruthy()
    expect(tafelVon(seite(ohneSatz))).toContain('tafel-status')
  })

  it('stellt Stand und Git-Datum in EINE Zeile', () => {
    // Zwei Daten in derselben Form aus zwei Quellen (Autor und Git) sind
    // schlimmer als eines: Man sieht ihnen nicht an, welches welches ist.
    // Nebeneinander liest man den Vergleich, und der ist die Auskunft.
    const dok = dokumente.find((d) => d.geaendert && d.kopf.stand)
    const tafel = tafelVon(seite(dok))
    expect(tafel).toContain('>Stand</dt>')
    expect(tafel).toContain('geändert ')
    expect(tafel).not.toContain('>Geändert</dt>')
    // Die alte Form war eine Pille „zuletzt 17. Aug. 2026" über dem Titel.
    expect(seite(dok)).not.toContain('chip">zuletzt')
  })

  it('führt die Lesezeit in der Tafel und nicht über dem Titel', () => {
    const dok = dokumente.find((d) => d.kopf.status)
    const tafel = tafelVon(seite(dok))
    expect(tafel).toContain('>Länge</dt>')
    expect(tafel).toContain(`${dok.minuten} min`)
    expect(tafel).toContain('Wörter')
  })

  it('zeigt Systemteile nur, wo „Betrifft" fehlt', () => {
    const mitBetrifft = dokumente.find((d) => d.kopf.betrifft.length && d.teile.length)
    if (mitBetrifft) expect(seite(mitBetrifft)).not.toContain('class="teil-chip')
    const ohneBetrifft = dokumente.find((d) => !d.kopf.betrifft.length && d.teile.length)
    if (ohneBetrifft) expect(seite(ohneBetrifft)).toContain('class="teil-chip')
  })
})

describe('Im Editor öffnen', () => {
  // Eine Prüfung, die nicht vom Rechner abhängt: Sie schreibt vor, WELCHE
  // Quellen befragt werden, nicht welcher Editor gefunden wird.
  const pruefe = { imPfad: (n) => n === 'code', existiert: () => false }

  it('fragt $EDITOR und $VISUAL NICHT', () => {
    // Der Dev-Server erbt `EDITOR=vi`. Ein losgelassenes `vi` ohne Terminal
    // öffnet nichts und beendet sich stumm — die Seite meldete trotzdem „In vi
    // geöffnet". Genau dieser Fall.
    expect(editorBefehl({ EDITOR: 'vi' }, pruefe)).toEqual(['code'])
    expect(editorBefehl({ VISUAL: 'nano', EDITOR: 'vim' }, pruefe)).toEqual(['code'])
  })

  it('nimmt MAPTALE_EDITOR, wenn er im Pfad liegt', () => {
    expect(editorBefehl({ MAPTALE_EDITOR: 'code' }, pruefe)).toEqual(['code'])
    expect(editorBefehl({ MAPTALE_EDITOR: 'code --wait' }, pruefe)).toEqual(['code', '--wait'])
  })

  it('sagt es, wenn MAPTALE_EDITOR ein Terminal braucht', () => {
    // Sonst behauptet der Knopf Erfolg und tut nichts, und man sucht den
    // Fehler an der Datei.
    expect(() => editorBefehl({ MAPTALE_EDITOR: 'vim' }, pruefe)).toThrow(/Terminal/)
    expect(() => editorBefehl({ MAPTALE_EDITOR: 'gibtsnicht' }, pruefe)).toThrow(/nicht im Pfad/)
  })

  it('nimmt die App, wo das CLI-Kürzel fehlt', () => {
    // Der Dev-Server startet über devhub, dessen PATH nicht der einer
    // Anmeldeshell ist — ein Kürzel aus dem Terminal kann dort fehlen.
    const nurApp = { imPfad: () => false, existiert: (p) => p === '/Applications/Zed.app' }
    expect(editorBefehl({}, nurApp)).toEqual(['open', '-a', '/Applications/Zed.app'])
    expect(editorBefehl({ MAPTALE_EDITOR: 'zed' }, nurApp)).toEqual([
      'open',
      '-a',
      '/Applications/Zed.app',
    ])
  })
})

describe('Umbenennen', () => {
  it('macht aus einem Titel einen Dateinamen, der in eine URL passt', () => {
    expect(saubererName('Probe: Ümbenennen 2!')).toBe('probe-uembenennen-2')
    expect(saubererName('  Konzept — Föhn  ')).toBe('konzept-foehn')
  })

  it('verweigert einen leeren Namen', () => {
    expect(() => saubererName('   ')).toThrow()
    expect(() => saubererName('!!!')).toThrow()
  })
})

describe('Datei und Editor auf der Seite', () => {
  it('nennt auf jeder Dokumentseite ihre Quelldatei', () => {
    // „Wo steht das?" war vorher eine Fußnote am Ende der Seite. Es ist die
    // Frage, mit der man ein Konzept aufschlägt, wenn man es ändern will.
    const dok = dokumente.find((d) => d.quelle === 'docs/concepts/konzept_video_export.md')
    const html = dokumentSeite({
      dok,
      html: '<h1>T</h1><p>x</p>',
      ueberschriften: [],
      dokumente,
      bereiche,
      nachAbs: new Map(dokumente.map((d) => [d.abs, d])),
      roadmap: sammleRoadmap(dokumente, mockups),
      schriftLokal: false,
    })
    expect(html).toContain(dok.quelle)
    expect(html).toContain('data-editor-oeffnen')
    // Die Tafel gehört UNTER den Titel: Sie sagt etwas über dieses Dokument.
    expect(html.indexOf('</h1>')).toBeLessThan(html.indexOf('kopftafel'))
  })

  it('schreibt den Stand auf Deutsch', () => {
    // Im Dokument steht ISO, weil sich das sortieren lässt. Gelesen wird es von
    // Menschen — und „2026-08-17" ist ein Sortierschlüssel, kein Datum.
    const dok = dokumente.find((d) => d.kopf.stand === '2026-08-17')
    expect(dok, 'kein Dokument mit ISO-Stand').toBeTruthy()
    const html = dokumentSeite({
      dok,
      html: '<h1>T</h1>',
      ueberschriften: [],
      dokumente,
      bereiche,
      nachAbs: new Map(dokumente.map((d) => [d.abs, d])),
      roadmap: sammleRoadmap(dokumente, mockups),
      schriftLokal: false,
    })
    const tafel = html.slice(html.indexOf('kopftafel'), html.indexOf('</dl>'))
    expect(tafel).toContain('17. August 2026')
    expect(tafel).not.toContain('2026-08-17')
  })

  it('erfindet keinen Tag, wo keiner behauptet wurde', () => {
    // „August 2026" bleibt „August 2026": Ein Datum daraus zu machen wäre eine
    // Genauigkeit, die das Dokument nie zugesagt hat.
    const dok = dokumente.find((d) => /^[A-ZÄÖÜ][a-zäöü]+ \d{4}$/.test(d.kopf.stand))
    if (!dok) return
    const html = dokumentSeite({
      dok,
      html: '<h1>T</h1>',
      ueberschriften: [],
      dokumente,
      bereiche,
      nachAbs: new Map(dokumente.map((d) => [d.abs, d])),
      roadmap: sammleRoadmap(dokumente, mockups),
      schriftLokal: false,
    })
    expect(html.slice(html.indexOf('kopftafel'), html.indexOf('</dl>'))).toContain(dok.kopf.stand)
  })

  it('bietet Umbenennen, Editor und Pfad an jedem Objekt an', () => {
    const html = bereichSeite({
      bereich: bereiche.find((b) => b.id === 'concepts'),
      dokumente,
      bereiche,
      roadmap: sammleRoadmap(dokumente, mockups),
      schriftLokal: false,
    })
    for (const marke of ['data-umbenennen>', 'data-editor-oeffnen', 'data-pfad-kopieren'])
      expect(html).toContain(marke)
    // Die Maske liegt in JEDER Seite, weil in jeder Seite Objekte stehen.
    expect(html).toContain('data-umbenennen-schicht')
  })

  it('führt in der Seitenleiste keine Historie — außer der offenen Seite', () => {
    const seite = (dok) =>
      dokumentSeite({
        dok,
        html: '<h1>T</h1>',
        ueberschriften: [],
        dokumente,
        bereiche,
        nachAbs: new Map(dokumente.map((d) => [d.abs, d])),
        roadmap: sammleRoadmap(dokumente, mockups),
        schriftLokal: false,
      })
    const leiste = (html) =>
      html.slice(html.indexOf('<aside class="leiste"'), html.indexOf('</aside>'))

    // Die Leiste ist die Nachbarschaft, in der man weiterliest. Archiviertes
    // beschreibt oft gerade NICHT den heutigen Stand — es steht auf der
    // Bereichsseite hinter seiner eigenen Falte.
    const historie = dokumente.find((d) => d.archiviert)
    const lebend = dokumente.find((d) => !d.archiviert && d.bereich === historie.bereich)
    expect(leiste(seite(lebend))).not.toContain(escape(historie.titel))

    // Die Ausnahme: das offene Dokument. Ohne sie stünde man in einer Liste
    // ohne sich selbst.
    const alt = dokumente.find((d) => d.archiviert)
    const eigene = leiste(seite(alt))
    expect(eigene).toContain(escape(alt.titel))
    expect(eigene).toContain('aria-current="page"')
    expect(eigene).toContain('leiste-archiv')
  })

  it('zeigt den Verlauf und darin die Sprünge des Kopfes', () => {
    const dok = dokumente.find((d) => (d.verlauf ?? []).some((c) => c.kopf.length))
    expect(dok, 'kein Dokument mit erkannter Kopfänderung — liest der Diff noch mit?').toBeTruthy()
    const html = dokumentSeite({
      dok,
      html: '<h1>T</h1>',
      ueberschriften: [],
      dokumente,
      bereiche,
      nachAbs: new Map(dokumente.map((d) => [d.abs, d])),
      roadmap: sammleRoadmap(dokumente, mockups),
      schriftLokal: false,
    })
    expect(html).toContain('class="verlauf"')
    // Der Weg dorthin steht in der Kopftafel — ohne ihn findet den Block niemand.
    expect(html).toContain('href="#verlauf"')
    const sprung = dok.verlauf.find((c) => c.kopf.length).kopf[0]
    expect(html).toContain(escape(sprung.nach))
  })

  it('erfindet keine Kopfänderung, wo nur Fließtext steht', () => {
    // Der Kopfbereich wird über die Hunk-Zeilennummern abgegrenzt. Fiele diese
    // Grenze weg, würde jedes `status:` in einem Codeblock zur Statusänderung —
    // und in der Doku ÜBER den Viewer steht so etwas dutzendfach.
    for (const dok of dokumente)
      for (const c of dok.verlauf ?? [])
        for (const k of c.kopf) {
          expect(k.von === '' && k.nach === '').toBe(false)
          // Der Kopf trägt Werte, keine Markdown-Absätze.
          expect(k.nach.length + k.von.length).toBeLessThan(400)
        }
  })

  it('liest den Kopf aus beiden Formen — Front Matter und alte Prosa-Zeile', () => {
    // Die Umstellung auf Front Matter ist vom 2026-08-17. Wer nur YAML liest,
    // hat für die gesamte Historie davor einen leeren Verlauf.
    expect(kopfWerteAus(['status: Entwurf, nichts gebaut', 'stand: 2026-08-17'])).toEqual({
      status: 'Entwurf, nichts gebaut',
      stand: '2026-08-17',
    })
    expect(kopfWerteAus(['Stand: **2026-08-07** · Status: **Konzept, nichts gebaut** ·'])).toEqual({
      stand: '2026-08-07',
      status: 'Konzept, nichts gebaut',
    })
    expect(kopfWerteAus([])).toEqual({})
  })

  it('meldet nur Felder, die sich wirklich geändert haben', () => {
    const gleich = { status: 'Entwurf', stand: '2026-08-01' }
    expect(kopfDiff(gleich, { ...gleich })).toEqual([])
    const [eins] = kopfDiff({ status: 'Entwurf' }, { status: 'Etappe 1 gebaut' })
    expect(eins).toMatchObject({ feld: 'status', von: 'Entwurf', nach: 'Etappe 1 gebaut' })
    // Ein neu angelegtes Dokument hat kein Vorher — das ist kein Sprung, aber
    // eine Angabe: „Status: neu Entwurf".
    expect(kopfDiff({}, { status: 'Entwurf' })[0].von).toBe('')
  })

  it('führt die Historie über Umbenennungen und Archiv-Umzüge hinweg', () => {
    // Ohne `-M` und die `rename from`-Zeilen bräche der Verlauf genau an der
    // Umbenennung ab — und der Viewer benennt selbst um (`git mv`).
    const umgezogen = execFileSync(
      'git',
      ['log', '-M', '--diff-filter=R', '--name-status', '--format=', '--', 'docs'],
      { cwd: WURZEL, encoding: 'utf8' },
    )
      .split('\n')
      .map((z) => z.split('\t'))
      .filter((t) => t[0]?.startsWith('R') && t[2]?.endsWith('.md'))
    if (!umgezogen.length) return
    for (const [, alt, neu] of umgezogen) {
      const dok = dokumente.find((d) => d.quellePfad === neu || 'docs/' + d.quelle === neu)
      // Das Ziel kann seinerseits weitergezogen sein — dann greift der Test
      // beim letzten Namen der Kette.
      if (!dok || !dok.verlauf.length) continue
      const vorDemUmzug = execFileSync('git', ['log', '--format=%H', '--', alt], {
        cwd: WURZEL,
        encoding: 'utf8',
      })
        .split('\n')
        .filter(Boolean)
      const bekannt = new Set(dok.verlauf.map((c) => c.sha))
      expect(
        vorDemUmzug.filter((sha) => bekannt.has(sha)).length,
        `${neu} hat die Commits von ${alt} verloren`,
      ).toBeGreaterThan(0)
    }
  })

  it('legt den Konzept-Link einer Mockup-Kachel ÜBER die Kartenfläche', () => {
    // `.karte-flaeche` ist ein unsichtbarer Link über der ganzen Kachel. Ein
    // Konzept-Titel darunter sieht aus wie ein Link, öffnet aber das Mockup —
    // die Beziehung stand da und war der einzige Weg, der nicht funktionierte.
    const css = readFileSync(join(WURZEL, 'scripts/docs-viewer/assets/stil.css'), 'utf8')
    const zIndex = (wahl) => {
      const block = new RegExp(`${wahl}\\s*\\{([^}]*)\\}`).exec(css)
      const treffer = /z-index:\s*(-?\d+)/.exec(block?.[1] ?? '')
      return treffer ? Number(treffer[1]) : 0
    }
    expect(zIndex('\\.mockup-konzept a')).toBeGreaterThan(zIndex('\\.karte-flaeche'))
  })

  it('führt im Fuß Startseite, Impressum und Datenschutz', () => {
    const html = uebersichtSeite({
      dokumente,
      bereiche,
      mockups,
      bilder: [],
      roadmap: sammleRoadmap(dokumente, mockups),
      schriftLokal: false,
    })
    expect(html).toContain('href="/impressum"')
    expect(html).toContain('href="/datenschutz"')
    expect(html).toContain('>Startseite<')
  })
})
