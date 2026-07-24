// Was Luhambo aus den abgelegten Dateien gelesen hat — die Grundlage des
// Prüf-Screens („Neue Tour"). DOM-frei und unter Vitest getestet; die Anzeige
// liegt in studio.ts.
//
// Die Haltung dahinter: vor dem Hochladen zeigen, was ankam. Eine Aufnahme
// ohne Ortsangabe, eine, die Stunden neben der Aufzeichnung liegt, ein Track
// ohne Zeitstempel — das sind Dinge, die man VORHER wissen will, nicht
// hinterher an einer Tour, die anders aussieht als erwartet.

import { gpxZeitspanne, medientyp, type MediumEingabe } from './upload.js'

/** Ein Trackpunkt aus dem GPX: [lng, lat, Zeit in ms]. */
export type GpxPunkt = [number, number, number]

/**
 * Trackpunkte aus GPX-XML. Wie `gpxZeitspanne` bewusst mit festem Fenster statt
 * unbeschränktem Suchen — bei einer 40 000-Punkte-Aufzeichnung ist der
 * Unterschied zwischen O(N) und O(N²) der zwischen sofort und Sekunden.
 */
export function gpxPunkte(xml: string): GpxPunkt[] {
  const punkte: GpxPunkt[] = []
  const tagRe = /<trkpt\b([^>]*)>/g
  let treffer: RegExpExecArray | null
  while ((treffer = tagRe.exec(xml)) !== null) {
    const attr = treffer[1] ?? ''
    const lat = Number(/\blat="([^"]+)"/.exec(attr)?.[1])
    const lng = Number(/\blon="([^"]+)"/.exec(attr)?.[1])
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    const inhalt = xml.slice(tagRe.lastIndex, tagRe.lastIndex + 500)
    const ms = Date.parse(/<time>([^<]+)<\/time>/.exec(inhalt)?.[1] ?? '')
    punkte.push([lng, lat, Number.isFinite(ms) ? ms : NaN])
  }
  return punkte
}

/** Haversine in Metern — reicht für die Kilometerangabe der Vorschau. */
function distanzM(a: readonly number[], b: readonly number[]): number {
  const RAD = Math.PI / 180
  const dLat = ((b[1] as number) - (a[1] as number)) * RAD
  const dLng = ((b[0] as number) - (a[0] as number)) * RAD
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a[1] as number) * RAD) * Math.cos((b[1] as number) * RAD) * Math.sin(dLng / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(h))
}

/**
 * Wegpunkte in einen 0..100-Kasten legen — dieselbe Rechnung wie die Signatur
 * der Bibliothek (server/src/pipeline/signatur.ts), hier aber MIT den
 * Bildpunkten je Eingabepunkt: die Vorschau setzt Foto-Marken auf die Strecke,
 * dafür braucht sie mehr als den Pfad.
 */
export function projiziereVorschau(punkte: ReadonlyArray<readonly [number, number]>): {
  d: string
  bild: Array<[number, number]>
} | null {
  if (punkte.length < 2) return null
  const lats = punkte.map((p) => p[1])
  const kx = Math.cos((((Math.min(...lats) + Math.max(...lats)) / 2) * Math.PI) / 180)
  const xs = punkte.map((p) => p[0] * kx)
  const x0 = Math.min(...xs)
  const y0 = Math.min(...lats)
  const spanne = Math.max(Math.max(...xs) - x0, Math.max(...lats) - y0)
  if (!(spanne > 0)) return null
  const versatzX = (spanne - (Math.max(...xs) - x0)) / 2
  const versatzY = (spanne - (Math.max(...lats) - y0)) / 2
  const bild = punkte.map((_, i): [number, number] => [
    Math.round(((xs[i] as number) - x0 + versatzX) * (100 / spanne) * 10) / 10,
    Math.round((100 - ((lats[i] as number) - y0 + versatzY) * (100 / spanne)) * 10) / 10,
  ])
  return { d: bild.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(''), bild }
}

/** Index des Trackpunkts, der einer Zeit am nächsten liegt (Track ist zeitsortiert). */
export function punktZuZeit(punkte: readonly GpxPunkt[], ms: number): number {
  let beste = -1
  let bestAbstand = Infinity
  for (const [i, p] of punkte.entries()) {
    const abstand = Math.abs(p[2] - ms)
    if (abstand < bestAbstand) {
      bestAbstand = abstand
      beste = i
    }
  }
  return beste
}

export interface AufnahmeBefund {
  datei: string
  typ: 'photo' | 'video'
  /** Aufnahmezeit in ms — aus EXIF, sonst der Dateizeit (dann `zeitGeraten`) */
  zeitMs: number
  zeitGeraten: boolean
  ort: [number, number] | null
}

export type MeldungArt = 'ohne-ort' | 'ohne-zeit' | 'ausserhalb' | 'keine-orte' | 'ohne-track'

export interface Meldung {
  art: MeldungArt
  /** Ton der Meldung: `hinweis` erklärt nur, `warnung` verlangt eine Entscheidung */
  ton: 'hinweis' | 'warnung'
  text: string
  /** Dateien, um die es geht — der Knopf „Weglassen" greift genau auf sie zu */
  dateien: string[]
}

export interface Pruefbefund {
  track: {
    punkte: GpxPunkt[]
    startMs: number
    endMs: number
    km: number
  } | null
  aufnahmen: AufnahmeBefund[]
  /** Zeitachse des Filmstreifens: Aufzeichnung UND Aufnahmen, damit Ausreißer sichtbar sind */
  vonMs: number
  bisMs: number
  meldungen: Meldung[]
  /** Kann daraus eine Tour werden? */
  bereit: boolean
  /** Wie die Strecke zustande kommt — die Tour aus Fotos hat keine aufgezeichnete */
  quelle: 'aufzeichnung' | 'fotos' | 'keine'
}

/** Aufnahmen, die weiter als das hinter/vor der Aufzeichnung liegen, werden gemeldet. */
const TOLERANZ_MS = 20 * 60 * 1000

export function pruefe(gpx: string | null, aufnahmen: readonly AufnahmeBefund[]): Pruefbefund {
  const spanne = gpx ? gpxZeitspanne(gpx) : null
  const punkte = gpx ? gpxPunkte(gpx) : []
  let km = 0
  for (let i = 1; i < punkte.length; i++) km += distanzM(punkte[i - 1] as GpxPunkt, punkte[i] as GpxPunkt)

  const track = spanne
    ? { punkte, startMs: spanne.startMs, endMs: spanne.endMs, km: Math.round(km / 100) / 10 }
    : null

  const zeiten = aufnahmen.map((a) => a.zeitMs).filter((t) => Number.isFinite(t))
  const vonMs = Math.min(track?.startMs ?? Infinity, ...(zeiten.length ? zeiten : [Infinity]))
  const bisMs = Math.max(track?.endMs ?? -Infinity, ...(zeiten.length ? zeiten : [-Infinity]))

  const meldungen: Meldung[] = []
  const ohneOrt = aufnahmen.filter((a) => !a.ort)
  const ohneZeit = aufnahmen.filter((a) => a.zeitGeraten)
  const mitOrt = aufnahmen.filter((a) => a.ort)

  if (track) {
    // Ohne Ortsangabe ist kein Fehler, solange es eine Aufzeichnung gibt: die
    // Uhrzeit sagt, wo jemand war. Deshalb Hinweis, nicht Warnung.
    if (ohneOrt.length) {
      meldungen.push({
        art: 'ohne-ort',
        ton: 'hinweis',
        text:
          ohneOrt.length === 1
            ? 'Eine Aufnahme ohne Ortsangabe — eingeordnet nach ihrer Uhrzeit.'
            : `${ohneOrt.length} Aufnahmen ohne Ortsangabe — eingeordnet nach ihrer Uhrzeit.`,
        dateien: ohneOrt.map((a) => a.datei),
      })
    }
    const ausserhalb = aufnahmen.filter(
      (a) => Number.isFinite(a.zeitMs) && (a.zeitMs < track.startMs - TOLERANZ_MS || a.zeitMs > track.endMs + TOLERANZ_MS),
    )
    if (ausserhalb.length) {
      const abstand = Math.max(
        ...ausserhalb.map((a) => Math.max(track.startMs - a.zeitMs, a.zeitMs - track.endMs)),
      )
      meldungen.push({
        art: 'ausserhalb',
        ton: 'warnung',
        text:
          ausserhalb.length === 1
            ? `Eine Aufnahme liegt ${formatiereAbstand(abstand)} außerhalb der Aufzeichnung.`
            : `${ausserhalb.length} Aufnahmen liegen bis zu ${formatiereAbstand(abstand)} außerhalb der Aufzeichnung.`,
        dateien: ausserhalb.map((a) => a.datei),
      })
    }
  } else if (mitOrt.length >= 2) {
    // Kein Track, aber verortete Fotos: die Orte SIND die Strecke.
    meldungen.push({
      art: 'ohne-track',
      ton: 'hinweis',
      text: 'Keine Aufzeichnung dabei — die Kamera fliegt von Foto zu Foto, in der Reihenfolge der Uhrzeiten.',
      dateien: [],
    })
    if (ohneOrt.length) {
      meldungen.push({
        art: 'ohne-ort',
        ton: 'warnung',
        text:
          ohneOrt.length === 1
            ? 'Eine Aufnahme hat keine Ortsangabe — sie bekommt im Editor von Hand einen Platz.'
            : `${ohneOrt.length} Aufnahmen haben keine Ortsangabe — sie bekommen im Editor von Hand einen Platz.`,
        dateien: ohneOrt.map((a) => a.datei),
      })
    }
  } else if (aufnahmen.length) {
    meldungen.push({
      art: 'keine-orte',
      ton: 'warnung',
      text:
        'Ohne Aufzeichnung braucht es mindestens zwei Fotos mit Ortsangabe — sonst gibt es keine Strecke, über die die Kamera fliegen könnte.',
      dateien: [],
    })
  }

  if (ohneZeit.length) {
    meldungen.push({
      art: 'ohne-zeit',
      ton: 'hinweis',
      text:
        ohneZeit.length === 1
          ? 'Eine Aufnahme hat keinen Zeitstempel — es gilt das Datum der Datei.'
          : `${ohneZeit.length} Aufnahmen haben keinen Zeitstempel — es gilt das Datum der Datei.`,
      dateien: ohneZeit.map((a) => a.datei),
    })
  }

  const quelle: Pruefbefund['quelle'] = track ? 'aufzeichnung' : mitOrt.length >= 2 ? 'fotos' : 'keine'
  return {
    track,
    aufnahmen: [...aufnahmen].sort((a, b) => a.zeitMs - b.zeitMs),
    vonMs: Number.isFinite(vonMs) ? vonMs : 0,
    bisMs: Number.isFinite(bisMs) ? bisMs : 0,
    meldungen,
    bereit: quelle !== 'keine',
    quelle,
  }
}

/** „1 h 41 min" / „18 min" — die Größenordnung zählt, nicht die Sekunde. */
export function formatiereAbstand(ms: number): string {
  const minuten = Math.round(Math.abs(ms) / 60000)
  if (minuten < 60) return `${minuten} min`
  const stunden = Math.floor(minuten / 60)
  const rest = minuten % 60
  return rest ? `${stunden} h ${rest} min` : `${stunden} h`
}

/**
 * Wegpunkte für eine Tour OHNE Aufzeichnung: die verorteten Fotos in zeitlicher
 * Reihenfolge. Höhe 0 — der Player holt sie ohnehin aus dem Geländemodell und
 * überschreibt sie ([src/elevation.js]).
 */
export function baueFotoSegmente(
  aufnahmen: readonly AufnahmeBefund[],
  modus: string,
): Array<{ mode: string; pts: Array<[number, number, number, number]> }> {
  const verortet = aufnahmen
    .filter((a): a is AufnahmeBefund & { ort: [number, number] } => !!a.ort)
    .sort((a, b) => a.zeitMs - b.zeitMs)
  if (verortet.length < 2) return []
  const t0 = verortet[0]!.zeitMs
  return [
    {
      mode: modus,
      pts: verortet.map((a): [number, number, number, number] => [a.ort[0], a.ort[1], 0, (a.zeitMs - t0) / 1000]),
    },
  ]
}

/**
 * Grobe Laufzeit der fertigen Kamerafahrt — dieselbe Größenordnung wie die
 * Schätzung im Editor: rund 25 s je Kilometer plus 4 s Halt je Aufnahme.
 * Bewusst als „≈" beschriftet; genau wird es erst mit den Kamera-Einstellungen.
 */
export function schaetzeFahrtS(km: number, aufnahmen: number): number {
  return Math.round(km * 25 + aufnahmen * 4)
}

/** Aus einem Befund die Medien-Einträge fürs Manifest (Reihenfolge = Zeit). */
export function medienAusBefund(befund: Pruefbefund, isoMitZone: (ms: number) => string): MediumEingabe[] {
  return befund.aufnahmen.map((a, i) => {
    const eintrag: MediumEingabe = {
      id: `m${i + 1}`,
      type: a.typ,
      file: a.datei,
      takenAt: isoMitZone(a.zeitMs),
    }
    if (a.ort) eintrag.anchor = a.ort
    return eintrag
  })
}

/** Wird die Datei überhaupt angenommen? (GPX oder bekannter Medientyp) */
export function istBrauchbar(dateiname: string): boolean {
  return dateiname.toLowerCase().endsWith('.gpx') || medientyp(dateiname) !== null
}
