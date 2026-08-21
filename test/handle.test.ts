// Der Handle: Regeln und Aufbereitung. DOM-frei, wie das Modul selbst — im
// Browser ist die Prüfung Bequemlichkeit, entschieden wird auf dem Server, und
// beide müssen dasselbe sagen (Drift-Wächter in routes.test.ts).
import { describe, expect, it } from 'vitest'
import { HANDLE_PATTERN, RESERVED_HANDLES, validateHandleForm, toHandle } from '../src/handle'

describe('zuHandle', () => {
  it('übersetzt Umlaute, statt sie zu verschlucken', () => {
    // „henriksd" wäre das Ergebnis eines bloßen Filters — und der Nutzer suchte
    // den Fehler bei sich.
    expect(toHandle('Henrik Süd')).toBe('henrik-sued')
    expect(toHandle('Straße')).toBe('strasse')
    expect(toHandle('José')).toBe('jose')
  })

  it('macht aus Leerraum Bindestriche und wirft alles Übrige weg', () => {
    expect(toHandle('  Anna   Maria ')).toBe('anna-maria')
    expect(toHandle('a/b?c#d')).toBe('abcd')
  })

  it('lässt kein Trennzeichen an den Rand — auch nicht nach dem Kürzen', () => {
    expect(toHandle('-henrik-')).toBe('henrik')
    expect(toHandle('...anna')).toBe('anna')
    // 30 Zeichen ist die Grenze; der Schnitt darf nicht auf einem Punkt enden
    const lang = toHandle(`${'a'.repeat(29)}.bcd`)
    expect(lang.length).toBeLessThanOrEqual(30)
    expect(lang.endsWith('.')).toBe(false)
  })
})

describe('pruefeHandleForm', () => {
  it('nimmt gewöhnliche Adressen an', () => {
    for (const gut of ['henrik', 'anna-maria', 'tom.reist', 'r2_d2', 'abc']) {
      expect(validateHandleForm(gut), gut).toBeNull()
    }
  })

  it('nennt den Grund, statt bloß „ungültig" zu sagen', () => {
    expect(validateHandleForm('')).toBe('empty')
    expect(validateHandleForm('  ')).toBe('empty')
    expect(validateHandleForm('ab')).toBe('tooShort')
    expect(validateHandleForm('-anna')).toBe('format')
    expect(validateHandleForm('anna-')).toBe('format')
    expect(validateHandleForm('Anna Maria')).toBe('format')
    expect(validateHandleForm('a'.repeat(31))).toBe('format')
  })

  it('hält die Seitenpfade frei', () => {
    expect(validateHandleForm('galerie')).toBe('reserved')
    expect(validateHandleForm('Impressum')).toBe('reserved')
  })

  it('sperrt den ID-Präfix', () => {
    // `/api/benutzer/:id/profil` unterscheidet ID und Handle am `u_`. Ein
    // Handle „u_abc" führte sonst auf ein fremdes Profil.
    expect(validateHandleForm('u_abcdef')).toBe('reserved')
  })
})

describe('HANDLE_REGELN', () => {
  it('deckt sich mit dem, was die Prüfung durchlässt', () => {
    for (const handle of RESERVED_HANDLES) {
      // Ein reserviertes Wort, das die Form gar nicht erfüllt, wäre ein
      // toter Eintrag — die Prüfung käme nie bis zur Liste.
      expect(HANDLE_PATTERN.test(handle), handle).toBe(true)
    }
  })
})
