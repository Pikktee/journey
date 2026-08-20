// Die Start-Migration gegen die Verträge, die sie herstellen soll.
//
// Der Wächter, auf den es ankommt, ist der ZWEISEITIGE: Jeder neue Schlüssel
// aus `keys-v2.ts` muss im JSON-Schema vorkommen, und jeder alte darf es nicht
// mehr. Eine Abbildung, die auf einen Namen zeigt, den das Schema nicht kennt,
// schreibt Dateien um, die der Server danach ablehnt — und ein alter Name, der
// im Schema stehen blieb, ist eine Umbenennung, die nur halb geschehen ist.
import { describe, expect, it } from 'vitest'
import { FELDER, SCHEMA_KENNUNGEN, WERTE } from '../src/migrations/keys-v2.js'
import { bildeAb } from '../src/migrations/start.js'
import { UPLOAD_SCHEMA_ID, uploadManifestJsonSchema } from '../src/schema/upload.js'
import { EDITS_SCHEMA_ID, editsJsonSchema } from '../src/schema/edits.js'
import { ANREICHERUNG_SCHEMA_ID } from '../src/pipeline/anreicherung.js'
import { TOUR_SCHEMA_ID } from '../src/pipeline/enrich.js'

/** Alle Eigenschaftsnamen eines JSON-Schemas, beliebig tief. */
function namen(schema: unknown, hinein = new Set<string>()): Set<string> {
  if (Array.isArray(schema)) {
    for (const teil of schema) namen(teil, hinein)
    return hinein
  }
  if (!schema || typeof schema !== 'object') return hinein
  for (const [schluessel, wert] of Object.entries(schema as Record<string, unknown>)) {
    if (schluessel === 'properties' && wert && typeof wert === 'object') {
      for (const name of Object.keys(wert as object)) hinein.add(name)
    }
    namen(wert, hinein)
  }
  return hinein
}

/** Alle Enum-Werte eines JSON-Schemas. */
function werte(schema: unknown, hinein = new Set<string>()): Set<string> {
  if (Array.isArray(schema)) {
    for (const teil of schema) werte(teil, hinein)
    return hinein
  }
  if (!schema || typeof schema !== 'object') return hinein
  for (const [schluessel, wert] of Object.entries(schema as Record<string, unknown>)) {
    if (schluessel === 'enum' && Array.isArray(wert)) {
      for (const w of wert) if (typeof w === 'string') hinein.add(w)
    }
    werte(wert, hinein)
  }
  return hinein
}

/**
 * Felder, die im Manifest STEHEN, aber nie hochgeladen werden — und deshalb
 * nicht im JSON-Schema der Route auftauchen. `removed` ist der Grabstein eines
 * gelöschten Mediums: den setzt der Server, ein Client darf ihn nicht schicken.
 */
const NUR_SERVERSEITIG = new Set(['removed'])

const SCHEMATA = {
  manifest: uploadManifestJsonSchema,
  edits: editsJsonSchema,
} as const

describe('keys-v2 gegen die JSON-Schemata', () => {
  for (const datei of ['manifest', 'edits'] as const) {
    it(`${datei}: jeder NEUE Feldname steht im Schema`, () => {
      const vorhanden = namen(SCHEMATA[datei])
      const fehlend = Object.values(FELDER[datei]).filter(
        (neu) => !vorhanden.has(neu) && !NUR_SERVERSEITIG.has(neu),
      )
      expect(fehlend).toEqual([])
    })

    it(`${datei}: kein ALTER Feldname steht mehr im Schema`, () => {
      const vorhanden = namen(SCHEMATA[datei])
      // `quelle`/`removed` heißen in beiden Dateien gleich; geprüft wird der
      // alte Name, und der darf nirgends mehr auftauchen.
      const uebrig = Object.keys(FELDER[datei]).filter((alt) => vorhanden.has(alt))
      expect(uebrig).toEqual([])
    })
  }

  it('edits: jeder NEUE Wert steht im Schema, kein alter mehr', () => {
    const vorhanden = werte(editsJsonSchema)
    for (const [feld, abbildung] of Object.entries(WERTE.edits)) {
      for (const [alt, neu] of Object.entries(abbildung)) {
        expect(vorhanden.has(neu), `${feld}: ${neu} fehlt im Schema`).toBe(true)
        expect(vorhanden.has(alt), `${feld}: ${alt} steht noch im Schema`).toBe(false)
      }
    }
  })

  it('die Kennungen zeigen auf die Konstanten, die der Server heute schreibt', () => {
    expect(SCHEMA_KENNUNGEN['maptale/upload@1']).toBe(UPLOAD_SCHEMA_ID)
    expect(SCHEMA_KENNUNGEN['maptale/edits@1']).toBe(EDITS_SCHEMA_ID)
    expect(SCHEMA_KENNUNGEN['maptale/anreicherung@1']).toBe(ANREICHERUNG_SCHEMA_ID)
    expect(SCHEMA_KENNUNGEN['maptale/tour@1']).toBe(TOUR_SCHEMA_ID)
    // Die Alt-Marke wird genauso erkannt — sie steht in jeder Datei, die vor
    // der Umbenennung des Produkts entstanden ist.
    expect(SCHEMA_KENNUNGEN['luhambo/upload@1']).toBe(UPLOAD_SCHEMA_ID)
    expect(SCHEMA_KENNUNGEN['luhambo/edits@1']).toBe(EDITS_SCHEMA_ID)
  })
})

describe('bildeAb', () => {
  it('zieht Felder und Werte eines Overlays mit', () => {
    const alt = {
      schema: 'luhambo/edits@1',
      medien: { m1: { geloescht: true, reihe: 3 } },
      momente: [{ art: 'umkreisen', dauerS: 6 }],
      kamera: [{ f: 0.5, preset: 'nah', skala: 1.2 }],
      audio: [
        { datei: 'a.mp3', typ: 'musik', quelle: 'bibliothek', lautstaerke: 0.8, ab: 0, bis: 1 },
      ],
      wetter: [{ f: 0, mode: 'rain', staerke: 0.6 }],
      titelbild: 'm1',
    }
    expect(bildeAb(alt, 'edits')).toEqual({
      schema: 'luhambo/edits@1', // die Kennung zieht `mitKennung` nach, nicht `bildeAb`
      media: { m1: { removed: true, order: 3 } },
      moments: [{ kind: 'orbit', durationS: 6 }],
      camera: [{ f: 0.5, preset: 'near', scale: 1.2 }],
      audio: [{ file: 'a.mp3', type: 'music', source: 'library', volume: 0.8, from: 0, to: 1 }],
      weather: [{ f: 0, mode: 'rain', intensity: 0.6 }],
      cover: 'm1',
    })
  })

  it('lässt gleichlautende Werte fremder Felder in Ruhe', () => {
    // `mode: 'rain'` bleibt — die Werte hängen am Feld, nicht am Wortlaut.
    expect(bildeAb({ wetter: [{ mode: 'nah' }] }, 'edits')).toEqual({ weather: [{ mode: 'nah' }] })
  })
})
