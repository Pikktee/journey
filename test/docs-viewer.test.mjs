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
import { bereichSeite, dokumentSeite, uebersichtSeite } from '../scripts/docs-viewer/seiten.mjs'
import { SYSTEMTEILE, systemteileVon } from '../scripts/docs-viewer/sammeln.mjs'
import {
  archivZiel,
  editorBefehl,
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
import { ampelAus } from '../scripts/docs-viewer/sammeln.mjs'
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
    const kopf = kopfVon('---\nstand: 2026-08-17\n---\n\n# T\n\nStatus: **Entwurf, nichts gebaut**\n')
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
    expect(ampelAus({ status: 'Server und Studio gebaut, App offen' }, 'concepts').art).toBe('unterwegs')
    expect(ampelAus({ status: 'Etappen 1–7 umgesetzt' }, 'architecture').art).toBe('unterwegs')
    expect(ampelAus({ status: 'live seit 2026-08-10' }, 'concepts').art).toBe('fertig')
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

  it('zeigt die Ampel nicht neben ihrem eigenen Statussatz', () => {
    const mitStatus = dokumente.find((d) => d.kopf.status && d.ampel)
    expect(mitStatus, 'kein Dokument mit Status').toBeTruthy()
    const html = seite(mitStatus)
    expect(html).toContain(mitStatus.kopf.status.slice(0, 20))
    expect(html).not.toContain('class="ampel ampel-')
  })

  it('zeigt sie weiterhin, wo kein Satz dasteht', () => {
    // Die Handbuch-Dateien tragen „Verbindlich", und das steht in keinem Satz.
    const ohneStatus = dokumente.find((d) => !d.kopf.status && d.ampel)
    expect(ohneStatus, 'kein Dokument ohne Status').toBeTruthy()
    expect(seite(ohneStatus)).toContain('class="ampel ampel-')
  })

  it('führt das Git-Datum nur EINMAL, und nicht in der Form des Stands', () => {
    // Zwei Daten in derselben Form aus zwei Quellen (Autor und Git) sind
    // schlimmer als eines: Man sieht ihnen nicht an, welches welches ist.
    const dok = dokumente.find((d) => d.geaendert && d.kopf.stand)
    const html = seite(dok)
    expect(html).not.toContain('zuletzt ')
    expect(html).toContain('>Geändert</dt>')
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
