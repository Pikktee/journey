// Der Handle: Regeln und Aufbereitung. DOM-frei, wie das Modul selbst — im
// Browser ist die Prüfung Bequemlichkeit, entschieden wird auf dem Server, und
// beide müssen dasselbe sagen (Drift-Wächter in routen.test.ts).
import { describe, expect, it } from 'vitest'
import { HANDLE_REGELN, RESERVIERTE_HANDLES, pruefeHandleForm, zuHandle } from '../src/handle'

describe('zuHandle', () => {
  it('übersetzt Umlaute, statt sie zu verschlucken', () => {
    // „henriksd" wäre das Ergebnis eines bloßen Filters — und der Nutzer suchte
    // den Fehler bei sich.
    expect(zuHandle('Henrik Süd')).toBe('henrik-sued')
    expect(zuHandle('Straße')).toBe('strasse')
    expect(zuHandle('José')).toBe('jose')
  })

  it('macht aus Leerraum Bindestriche und wirft alles Übrige weg', () => {
    expect(zuHandle('  Anna   Maria ')).toBe('anna-maria')
    expect(zuHandle('a/b?c#d')).toBe('abcd')
  })

  it('lässt kein Trennzeichen an den Rand — auch nicht nach dem Kürzen', () => {
    expect(zuHandle('-henrik-')).toBe('henrik')
    expect(zuHandle('...anna')).toBe('anna')
    // 30 Zeichen ist die Grenze; der Schnitt darf nicht auf einem Punkt enden
    const lang = zuHandle(`${'a'.repeat(29)}.bcd`)
    expect(lang.length).toBeLessThanOrEqual(30)
    expect(lang.endsWith('.')).toBe(false)
  })
})

describe('pruefeHandleForm', () => {
  it('nimmt gewöhnliche Adressen an', () => {
    for (const gut of ['henrik', 'anna-maria', 'tom.reist', 'r2_d2', 'abc']) {
      expect(pruefeHandleForm(gut), gut).toBeNull()
    }
  })

  it('nennt den Grund, statt bloß „ungültig" zu sagen', () => {
    expect(pruefeHandleForm('')).toBe('leer')
    expect(pruefeHandleForm('  ')).toBe('leer')
    expect(pruefeHandleForm('ab')).toBe('kurz')
    expect(pruefeHandleForm('-anna')).toBe('form')
    expect(pruefeHandleForm('anna-')).toBe('form')
    expect(pruefeHandleForm('Anna Maria')).toBe('form')
    expect(pruefeHandleForm('a'.repeat(31))).toBe('form')
  })

  it('hält die Seitenpfade frei', () => {
    expect(pruefeHandleForm('galerie')).toBe('reserviert')
    expect(pruefeHandleForm('Impressum')).toBe('reserviert')
  })

  it('sperrt den ID-Präfix', () => {
    // `/api/benutzer/:id/profil` unterscheidet ID und Handle am `u_`. Ein
    // Handle „u_abc" führte sonst auf ein fremdes Profil.
    expect(pruefeHandleForm('u_abcdef')).toBe('reserviert')
  })
})

describe('HANDLE_REGELN', () => {
  it('deckt sich mit dem, was die Prüfung durchlässt', () => {
    for (const handle of RESERVIERTE_HANDLES) {
      // Ein reserviertes Wort, das die Form gar nicht erfüllt, wäre ein
      // toter Eintrag — die Prüfung käme nie bis zur Liste.
      expect(HANDLE_REGELN.test(handle), handle).toBe(true)
    }
  })
})
