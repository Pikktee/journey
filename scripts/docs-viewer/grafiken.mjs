/*
 * Die Grafiken des Viewers. Alles SVG, alles zur Bauzeit erzeugt, nichts
 * zufällig: Dieselbe Doku muss zweimal dasselbe Bild ergeben, sonst rauscht
 * jeder Lauf durch das Diff und man sieht die echte Änderung nicht mehr.
 *
 * Die Motive greifen den Gegenstand des Produkts auf — Höhenlinien, eine
 * Route, ein Kartenraster —, statt abstrakte Icons zu setzen: Das Handbuch
 * eines Kartenprodukts darf nach Karte aussehen.
 */

/** Ein deterministischer Zufall, damit die Motive lebendig, aber stabil sind. */
function streu(saat) {
  let z = saat >>> 0
  return () => {
    z = (z * 1664525 + 1013904223) >>> 0
    return z / 4294967296
  }
}

const rund = (n) => Math.round(n * 100) / 100

/* ── Bereichsmotive ───────────────────────────────────────────────────────
 * 220 × 120, randlos, als Kopf jeder Bereichskarte. Sie tragen die Leitfarbe
 * über `currentColor`, damit ein Bereich seine Farbe an einer Stelle ändert. */

function motivKompass() {
  const strahlen = Array.from({ length: 16 }, (_, i) => {
    const w = (i / 16) * Math.PI * 2
    const lang = i % 4 === 0
    const r1 = lang ? 15 : 22
    return `<line x1="${rund(110 + Math.cos(w) * r1)}" y1="${rund(60 + Math.sin(w) * r1 * 0.8)}" x2="${rund(110 + Math.cos(w) * 30)}" y2="${rund(60 + Math.sin(w) * 24)}" stroke="currentColor" stroke-width="${lang ? 1.4 : 0.8}" opacity="${lang ? 0.8 : 0.35}" />`
  }).join('')
  return `<circle cx="110" cy="60" r="33" fill="none" stroke="currentColor" stroke-width="0.8" opacity="0.22"/>
    ${strahlen}
    <path d="M110 35 L117 60 L110 85 L103 60 Z" fill="currentColor" opacity="0.85"/>
    <circle cx="110" cy="60" r="3.6" fill="var(--bg-tief)" stroke="currentColor" stroke-width="1.4"/>`
}

function motivSchichten() {
  const z = streu(7)
  let raus = ''
  for (let i = 0; i < 5; i++) {
    const y = 92 - i * 14
    const punkte = Array.from({ length: 12 }, (_, k) => {
      const x = k * 20
      return `${x},${rund(y - Math.sin(k * 0.7 + i) * 4 - z() * 3)}`
    }).join(' ')
    raus += `<polyline points="${punkte}" fill="none" stroke="currentColor" stroke-width="1.3" opacity="${rund(0.18 + i * 0.13)}"/>`
  }
  return raus + `<circle cx="150" cy="36" r="4.5" fill="currentColor" opacity="0.9"/><line x1="150" y1="40" x2="150" y2="60" stroke="currentColor" stroke-width="1.2" opacity="0.5"/>`
}

function motivHorizont() {
  // Der Verlauf bleibt schwach: Als kräftiger Himmel war „Konzepte" die einzige
  // Kachel, die man aus drei Metern sah — eine Farbfläche schlägt jede Linie.
  return `<defs><linearGradient id="mh" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="currentColor" stop-opacity="0.22"/>
      <stop offset="1" stop-color="currentColor" stop-opacity="0"/>
    </linearGradient></defs>
    <rect x="0" y="0" width="220" height="72" fill="url(#mh)"/>
    <circle cx="110" cy="72" r="19" fill="currentColor" opacity="0.7"/>
    <line x1="0" y1="72" x2="220" y2="72" stroke="currentColor" stroke-width="1.2" opacity="0.8"/>
    ${Array.from({ length: 3 }, (_, i) => `<line x1="0" y1="${82 + i * 11}" x2="220" y2="${82 + i * 11}" stroke="currentColor" stroke-width="0.8" opacity="${rund(0.28 - i * 0.07)}"/>`).join('')}`
}

function motivRaster() {
  let raus = ''
  for (let x = 10; x <= 210; x += 25)
    raus += `<line x1="${x}" y1="14" x2="${x}" y2="106" stroke="currentColor" stroke-width="0.7" opacity="0.2"/>`
  for (let y = 18; y <= 102; y += 21)
    raus += `<line x1="6" y1="${y}" x2="214" y2="${y}" stroke="currentColor" stroke-width="0.7" opacity="0.2"/>`
  raus += `<rect x="60" y="39" width="50" height="21" fill="currentColor" opacity="0.6"/>
    <rect x="110" y="60" width="50" height="21" fill="currentColor" opacity="0.32"/>
    <rect x="35" y="60" width="25" height="21" fill="currentColor" opacity="0.45"/>`
  return raus
}

function motivRoute() {
  const d = 'M18 92 C 58 92, 50 34, 92 34 S 148 84, 202 30'
  return `<path d="${d}" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" opacity="0.1"/>
    <path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.85"/>
    ${[[18, 92], [92, 34], [202, 30]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4.5" fill="var(--bg-tief)" stroke="currentColor" stroke-width="1.8"/>`).join('')}`
}

function motivSediment() {
  // Waagerechte Balken sahen aus wie ein ladender Platzhalter. Jetzt sind es
  // Schichten mit einer Bruchkante: Ablagerung, nicht Skelett.
  const z = streu(23)
  let raus = ''
  for (let i = 0; i < 6; i++) {
    const y = 24 + i * 14
    const punkte = Array.from({ length: 9 }, (_, k) => {
      const x = k * 28
      const knick = x > 120 ? 6 + i * 1.6 : 0
      return `${x},${rund(y + knick + Math.sin(k * 0.9 + i) * 1.6 + z() * 1.4)}`
    }).join(' ')
    raus += `<polyline points="${punkte}" fill="none" stroke="currentColor" stroke-width="${i === 2 ? 1.6 : 1}" opacity="${rund(0.34 - i * 0.04)}"/>`
  }
  return raus + `<line x1="120" y1="18" x2="120" y2="106" stroke="currentColor" stroke-width="0.9" opacity="0.28" stroke-dasharray="3 4"/>`
}

const MOTIVE = {
  kompass: motivKompass,
  schichten: motivSchichten,
  horizont: motivHorizont,
  raster: motivRaster,
  route: motivRoute,
  sediment: motivSediment,
}

// `meet` und nicht `slice`: Beschnitten fehlte dem Kompass die Spitze und der
// Route ihr Anfangspunkt — ein Motiv, dem der Gegenstand fehlt, ist Dekor.
export function motiv(name) {
  const zeichne = MOTIVE[name] ?? motivRaster
  return `<svg class="motiv" viewBox="0 0 220 120" aria-hidden="true" preserveAspectRatio="xMidYMid meet">${zeichne()}</svg>`
}

/* ── Titelgrafik ──────────────────────────────────────────────────────────
 * Höhenlinien mit einer Route darüber und vier Foto-Halten: das Produkt in
 * einem Bild.
 *
 * Sie steht NEBEN dem Titel in einem eigenen Rahmen und nicht mehr dahinter.
 * Als Hintergrund lief die Route quer durch die Überschrift, und jeder
 * Schleier, der den Text rettete, machte die Grafik zu Grauschleier-Rauschen:
 * Zwei Dinge im selben Rechteck, von denen keines gewinnt. Ein gerahmter
 * Ausschnitt darf dagegen kräftig sein — er konkurriert mit nichts. */

export function titelgrafik() {
  const z = streu(11)
  // Die Fläche ist 16:10 und der Rahmen zeigt sie GANZ (kein `slice`): Ein
  // Ausschnitt einer breiten Grafik zeigte drei flache Linien und nichts sonst.
  let linien = ''
  for (let i = 0; i < 13; i++) {
    const grund = 700 - i * 52
    const punkte = Array.from({ length: 41 }, (_, k) => {
      const x = k * 30
      const y =
        grund -
        Math.sin(k * 0.19 + i * 0.5) * (30 + i * 4) -
        Math.sin(k * 0.07 + i) * 18 -
        z() * 6
      return `${x},${rund(y)}`
    }).join(' ')
    linien += `<polyline points="${punkte}" fill="none" stroke="var(--linien-ton)" stroke-width="${i % 3 === 0 ? 1.6 : 1}" opacity="${rund(0.08 + i * 0.028)}"/>`
  }
  const route = 'M 60 660 C 250 640, 330 470, 500 470 S 720 560, 860 380 S 1050 250, 1150 250'
  const halte = [
    [190, 648],
    [500, 470],
    [860, 380],
    [1150, 250],
  ]
  return `<svg class="titelgrafik" viewBox="0 0 1200 750" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <defs>
      <linearGradient id="tg-route" x1="0" y1="1" x2="1" y2="0">
        <stop offset="0" stop-color="var(--akzent-2)"/>
        <stop offset="1" stop-color="var(--akzent)"/>
      </linearGradient>
      <radialGradient id="tg-glut" cx="0.74" cy="0.28" r="0.66">
        <stop offset="0" stop-color="var(--akzent)" stop-opacity="0.2"/>
        <stop offset="1" stop-color="var(--akzent)" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="1200" height="750" fill="var(--bg-tief)"/>
    <rect width="1200" height="750" fill="url(#tg-glut)"/>
    ${linien}
    <path d="${route}" fill="none" stroke="url(#tg-route)" stroke-width="16" stroke-linecap="round" opacity="0.15"/>
    <path d="${route}" fill="none" stroke="url(#tg-route)" stroke-width="3.4" stroke-linecap="round"/>
    ${halte
      .map(
        ([x, y], i) => `<g class="halt" style="--verzug:${i * 0.4}s">
          <line x1="${x}" y1="${y}" x2="${x}" y2="${y - 46}" stroke="var(--akzent)" stroke-width="1.8" opacity="0.5"/>
          <circle cx="${x}" cy="${y - 54}" r="11" fill="var(--bg-tief)" stroke="var(--akzent)" stroke-width="2.2"/>
          <circle cx="${x}" cy="${y - 54}" r="3.6" fill="var(--akzent)"/>
          <ellipse cx="${x}" cy="${y}" rx="8" ry="3" fill="var(--akzent)" opacity="0.4"/>
        </g>`,
      )
      .join('')}
  </svg>`
}

/* ── Verweis-Karte ────────────────────────────────────────────────────────
 * Wer zeigt auf wen — als GRAPH, nicht mehr als Kreis.
 *
 * Der Kreis war ehrlich und unlesbar: Er ordnet nach Bereich und sonst nach
 * nichts, alle Beschriftungen stehen radial auf engstem Raum, und ein Zoom
 * schiebt sofort die Hälfte aus dem Bild. Die Lage eines Punktes sagte nichts
 * über seine Verbindungen — dabei ist genau das die Frage.
 *
 * Jetzt bestimmt ein Kräfte-Layout die Lage: Was aufeinander zeigt, rückt
 * zusammen; was einen Bereich teilt, bleibt beieinander. Gerechnet wird beim
 * BAUEN und deterministisch (fester Startzustand, feste Schrittzahl) — dieselbe
 * Doku ergibt dieselbe Karte, sonst rauscht jeder Lauf durchs Diff und die
 * Karte sähe bei jedem Laden anders aus.
 */

/** Ein Kräfte-Layout in Handarbeit: Abstoßung, Federn, Heimatzug. */
function verteile(alleKnoten, kanten, bereiche) {
  const BREITE = 1600
  const HOEHE = 1100
  const z = streu(1337)

  /*
   * EINSAME PUNKTE GEHÖREN NICHT INS FELD.
   *
   * Ein Dokument ohne Verweise hat im Kräfte-Layout keine Feder, also auch
   * keinen Ort: Es driftet dorthin, wo gerade Platz ist, und lag dann als
   * namenloser Punkt irgendwo am Rand — Rauschen, das aussieht wie Struktur.
   * Es wegzulassen wäre die falsche Antwort (dass ein Dokument mit niemandem
   * verbunden ist, ist eine AUSKUNFT, und oft die interessantere). Also
   * bekommen sie eine eigene Ablage unter dem Feld: eine Reihe, beschriftet,
   * in Ruhe.
   */
  const knoten = alleKnoten.filter((k) => k.grad)
  const einsam = alleKnoten.filter((k) => !k.grad)
  const ABLAGE = einsam.length ? 170 : 0

  // Startlage: die Bereiche als Inseln auf einem Kreis, ihre Dokumente knapp
  // daneben. Ein zufälliger Start würde je nach Saat mal verschlungene, mal
  // saubere Ergebnisse liefern; von den Inseln aus findet das Layout immer
  // dieselbe Ordnung.
  const heimat = new Map()
  bereiche.forEach((b, i) => {
    const w = (i / bereiche.length) * Math.PI * 2 - Math.PI / 2
    heimat.set(b.id, { x: BREITE / 2 + Math.cos(w) * 380, y: HOEHE / 2 + Math.sin(w) * 300 })
  })
  for (const k of knoten) {
    const h = heimat.get(k.bereich) ?? { x: BREITE / 2, y: HOEHE / 2 }
    k.x = h.x + (z() - 0.5) * 160
    k.y = h.y + (z() - 0.5) * 160
    k.vx = 0
    k.vy = 0
  }

  const proAbs = new Map(knoten.map((k) => [k.abs, k]))
  const paare = kanten
    .map(({ von, nach }) => ({ a: proAbs.get(von), b: proAbs.get(nach) }))
    .filter((p) => p.a && p.b)

  const SCHRITTE = 420
  for (let schritt = 0; schritt < SCHRITTE; schritt++) {
    const kuehl = 1 - schritt / SCHRITTE

    // Abstoßung: jeder gegen jeden. Bei 43 Knoten sind das 900 Paare je
    // Schritt — für eine Bauzeit-Rechnung ist das nichts.
    for (let i = 0; i < knoten.length; i++) {
      for (let j = i + 1; j < knoten.length; j++) {
        const a = knoten[i]
        const b = knoten[j]
        let dx = b.x - a.x
        let dy = b.y - a.y
        let d2 = dx * dx + dy * dy
        if (d2 < 1) {
          dx = (z() - 0.5) * 2
          dy = (z() - 0.5) * 2
          d2 = 1
        }
        const kraft = 26000 / d2
        const d = Math.sqrt(d2)
        a.vx -= (dx / d) * kraft
        a.vy -= (dy / d) * kraft
        b.vx += (dx / d) * kraft
        b.vy += (dy / d) * kraft
      }
    }

    // Federn entlang der Verweise. Die Ruhelänge wächst mit dem Grad der
    // Beteiligten: Ein Knotenpunkt mit zwanzig Kanten zöge sonst alles auf
    // einen Fleck.
    for (const { a, b } of paare) {
      const dx = b.x - a.x
      const dy = b.y - a.y
      const d = Math.max(1, Math.hypot(dx, dy))
      const ruhe = 130 + Math.min(120, (a.grad + b.grad) * 4)
      const kraft = (d - ruhe) * 0.012
      a.vx += (dx / d) * kraft
      a.vy += (dy / d) * kraft
      b.vx -= (dx / d) * kraft
      b.vy -= (dy / d) * kraft
    }

    // Heimatzug: hält die Bereiche zusammen, auch wenn ein Dokument nichts
    // nennt und niemand es nennt.
    for (const k of knoten) {
      const h = heimat.get(k.bereich)
      if (!h) continue
      k.vx += (h.x - k.x) * (k.grad ? 0.008 : 0.02)
      k.vy += (h.y - k.y) * (k.grad ? 0.008 : 0.02)
    }

    for (const k of knoten) {
      k.x += Math.max(-30, Math.min(30, k.vx)) * kuehl
      k.y += Math.max(-30, Math.min(30, k.vy)) * kuehl
      k.vx *= 0.82
      k.vy *= 0.82
    }
  }

  // Auf die Fläche einpassen — mit Rand für die Beschriftungen.
  const xs = knoten.map((k) => k.x)
  const ys = knoten.map((k) => k.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const rand = 150
  const feldHoehe = HOEHE - ABLAGE
  const skala = Math.min(
    (BREITE - rand * 2) / Math.max(1, maxX - minX),
    (feldHoehe - rand * 2) / Math.max(1, maxY - minY),
  )
  for (const k of knoten) {
    k.x = rand + (k.x - minX) * skala
    k.y = rand + (k.y - minY) * skala
  }

  // Die Ablage: eine Reihe, mittig, notfalls mehrere. Der Abstand ist so
  // gewählt, dass die Namen nebeneinander Platz haben — sie stehen hier immer,
  // nicht erst beim Zeigen: Ein namenloser Punkt in einer Ablage wäre die
  // Auskunft „hier ist etwas", ohne zu sagen, was.
  const SPALTE = 260
  const proReihe = Math.max(1, Math.floor((BREITE - 160) / SPALTE))
  einsam.forEach((k, i) => {
    const reihe = Math.floor(i / proReihe)
    const inReihe = Math.min(proReihe, einsam.length - reihe * proReihe)
    const spalte = i % proReihe
    k.x = BREITE / 2 + (spalte - (inReihe - 1) / 2) * SPALTE
    k.y = feldHoehe + 52 + reihe * 62
  })

  return { BREITE, HOEHE: feldHoehe + (einsam.length ? Math.ceil(einsam.length / proReihe) * 62 + 60 : 0), ABLAGE_Y: feldHoehe }
}

export function verweiskarte(dokumente, bereiche) {
  if (!dokumente.length) return ''
  const bekannt = new Set(dokumente.map((d) => d.abs))

  const knoten = dokumente.map((d) => ({
    abs: d.abs,
    titel: d.titel,
    ziel: d.ziel,
    bereich: d.bereich,
    teile: d.teile ?? [],
    prototyp: (d.prototypen ?? []).length > 0,
    ton: bereiche.find((b) => b.id === d.bereich)?.ton ?? '#7e8a99',
    grad: d.verweise.filter((v) => bekannt.has(v)).length + d.rueckverweise.length,
  }))
  const kanten = dokumente.flatMap((d) =>
    d.verweise.filter((v) => bekannt.has(v)).map((v) => ({ von: d.abs, nach: v })),
  )
  const { BREITE, HOEHE, ABLAGE_Y } = verteile(knoten, kanten, bereiche)
  const proAbs = new Map(knoten.map((k) => [k.abs, k]))

  /*
   * Die Ausgabe ist nur der STARTZUSTAND.
   *
   * Gerechnet wird beim Bauen (damit die Karte sofort geordnet dasteht und in
   * jedem Lauf gleich aussieht), weitergerechnet wird im Browser: viewer.js
   * liest diese Koordinaten, lässt die Kräfte weiterlaufen und schiebt die
   * Gruppen. Deshalb sitzt jeder Knoten in einer eigenen Gruppe mit
   * translate — eine Verschiebung ist dann ein Attribut und kein Neuaufbau —
   * und jede Kante ist eine gerade Linie statt einer Kurve: Zwei Endpunkte
   * lassen sich pro Bild fortschreiben, ein Bezier-Pfad müsste neu getextet
   * werden.
   *
   * Das Etikett hängt in einer eigenen Gruppe, weil es beim Zoomen NICHT
   * mitwachsen soll (s. viewer.js): Mitskalierte Schrift wird beim
   * Hineinzoomen riesig und beim Hinauszoomen unlesbar — man zoomt aber, um
   * MEHR zu lesen, nicht um größere Buchstaben zu sehen.
   */
  const linien = kanten
    .map(({ von, nach }) => {
      const a = proAbs.get(von)
      const b = proAbs.get(nach)
      if (!a || !b) return ''
      return `<line class="bogen" data-von="${von}" data-nach="${nach}" data-bereich="${a.bereich}" style="--ton:${a.ton}" x1="${rund(a.x)}" y1="${rund(a.y)}" x2="${rund(b.x)}" y2="${rund(b.y)}"/>`
    })
    .join('')

  const punkte = knoten
    .map((k) => {
      const r = 6 + Math.min(16, k.grad * 1.7)
      return `<g class="knoten${k.grad >= 3 ? ' wichtig' : ''}${k.grad ? '' : ' einsam'}"
        transform="translate(${rund(k.x)} ${rund(k.y)})"
        data-abs="${k.abs}" data-ziel="${k.ziel}" data-bereich="${k.bereich}"
        data-teile="${k.teile.join(' ')}" data-r="${rund(r)}" data-grad="${k.grad}"
        data-titel="${k.titel.toLowerCase().replace(/"/g, '')}">
        <circle r="${rund(r)}" fill="${k.ton}" opacity="${k.grad ? 0.9 : 0.5}"/>
        ${
          /*
           * „Dazu gibt es ein Mockup" — als RING um den Punkt, nicht als
           * eigener Punkt. Die 18 Mockups als Knoten aufzunehmen hieße 18
           * Blätter mehr (12 mit genau einer Kante, 6 ganz ohne): Punkte, die
           * zur Struktur nichts beitragen, in einem Bild, dessen ganzer Wert
           * die Struktur ist. Ein Mockup ist eine ANTWORT in einem Konzept,
           * kein Nachbar davon — dieselbe Linie wie auf der Roadmap.
           * Gestrichelt, weil eine geschlossene Linie hier „ausgewählt" hieße.
           */
          k.prototyp ? `<circle class="prototyp-ring" r="${rund(r + 5)}" fill="none" stroke="${k.ton}"/>` : ''
        }
        <circle class="halo" r="${rund(r + 14)}" fill="transparent"/>
        <g class="etikett" transform="translate(0 ${rund(r + 8)})"><text text-anchor="middle" dominant-baseline="hanging">${kurz(kartenName(k.titel), 30)}</text></g>
      </g>`
    })
    .join('')

  // Die Trennlinie sagt, dass unten etwas ANDERES steht — ohne sie sähe die
  // Reihe aus wie ein weiterer, besonders ordentlicher Teil des Graphen.
  const ablage = knoten.some((k) => !k.grad)
    ? `<g class="ablage">
        <line x1="80" y1="${rund(ABLAGE_Y)}" x2="${BREITE - 80}" y2="${rund(ABLAGE_Y)}"/>
        <text x="80" y="${rund(ABLAGE_Y + 24)}">Ohne Verweise</text>
      </g>`
    : ''

  return `<svg class="verweiskarte" viewBox="0 0 ${BREITE} ${HOEHE}" role="img"
      aria-label="Graph der Querverweise zwischen den Dokumenten">
    <g class="karten-welt" data-welt>
      ${ablage}
      <g class="boegen">${linien}</g>
      <g class="knoten-schicht">${punkte}</g>
    </g>
  </svg>`
}

/**
 * Der Name, wie er UNTER EINEM PUNKT steht — nicht der Titel des Dokuments.
 *
 * Auf der Karte waren 25 von 37 Etiketten gekappt („Konzept: Newsletter —
 * Einwi…", „Umbauplan: Renderer-Labor b…"), und was dabei wegfiel, war jedes
 * Mal der unterscheidende Teil. Weg müssen deshalb drei Sorten Ballast:
 *
 * 1. Die GATTUNG vorn („Konzept:", „Umbauplan:", „Handbuch:"). Sie steht an
 *    fast jedem Titel, kostet ein Drittel der Zeile und sagt dasselbe wie die
 *    Farbe des Punktes, die daneben ohnehin in der Legende erklärt ist.
 * 2. Der UNTERTITEL hinter „ — ", „: " oder „ & ". Er beantwortet eine Frage,
 *    die man an ein Dokument stellt, nicht an einen Punkt in einem Graphen.
 * 3. Die Klammer am Ende („(editor.ts)", „(Backlog)").
 *
 * Gekürzt wird nur, solange etwas Kenntliches übrig bleibt (mindestens zehn
 * Zeichen): „Maptale — Tech-Stack & Systemarchitektur" darf nicht zu „Maptale"
 * werden, sonst heißt der Punkt wie das ganze Projekt.
 */
export function kartenName(titel) {
  let name = String(titel).replace(/^(Konzept|Umbauplan|Umsetzung|Handbuch):\s*/, '')
  for (const trenner of [' — ', ' – ', ': ', ' & ']) {
    const i = name.indexOf(trenner)
    if (i >= 10) name = name.slice(0, i)
  }
  return name.replace(/\s*\([^()]*\)\s*$/, '').trim() || String(titel)
}

/** Lange Titel werden gekappt — unter einem Punkt ist wenig Platz. */
function kurz(titel, max = 26) {
  const rein = titel.replace(/[<&>]/g, '')
  return rein.length > max ? rein.slice(0, max - 1).trimEnd() + '…' : rein
}
