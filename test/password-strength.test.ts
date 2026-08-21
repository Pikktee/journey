// Passwortbewertung: Länge trägt, Muster ziehen herunter, persönliche Angaben
// sind ein Ausschluss. Die Tests halten vor allem die REIHENFOLGE der Ratschläge
// fest — es soll immer nur der eine dastehen, der gerade am meisten bringt.

import { describe, expect, it } from 'vitest'
import { scorePassword, MIN_LENGTH, MIN_SCORE } from '../src/password-strength.js'

describe('Länge', () => {
  it('sagt bei leerem Feld gar nichts', () => {
    const b = scorePassword('')
    expect(b).toMatchObject({ score: 0, label: '', hint: '', acceptable: false })
  })

  it('zählt herunter, solange die Mindestlänge fehlt', () => {
    expect(scorePassword('abc').hint).toBe(`Noch ${MIN_LENGTH - 3} Zeichen`)
    expect(scorePassword('abcdefg').hint).toBe('Noch 1 Zeichen')
    expect(scorePassword('abcdefg').acceptable).toBe(false)
  })

  it('steigt mit der Länge, ohne dass Sonderzeichen nötig wären', () => {
    // Genau der Fall, für den die Bewertung gebaut ist: drei harmlose Wörter
    const worte = scorePassword('lampe wolke treppe')
    expect(worte.score).toBe(4)
    expect(worte.acceptable).toBe(true)
  })

  it('hält ein kurzes Passwort mit nur einer Zeichenart klein', () => {
    expect(scorePassword('vogelnest').score).toBeLessThanOrEqual(1)
  })

  it('lässt Vielfalt eine Stufe gutmachen', () => {
    const einfach = scorePassword('birnenbaum')
    const gemischt = scorePassword('Birnenbaum7')
    expect(gemischt.score).toBeGreaterThan(einfach.score)
  })
})

describe('Bekannte Muster', () => {
  it('verwirft, was auf jeder Rateliste steht', () => {
    // Alle lang genug, um NICHT schon an der Mindestlänge zu scheitern —
    // sonst prüfte der Test die Reihenfolge der Ratschläge, nicht die Liste.
    for (const pw of ['passwort', 'geheim123', 'willkommen', 'maptale123']) {
      const b = scorePassword(pw)
      expect(b.score, pw).toBe(0)
      expect(b.hint, pw).toContain('Rateliste')
    }
  })

  it('erkennt ein häufiges Wort auch mitten im Passwort', () => {
    expect(scorePassword('xxpasswortxx').score).toBe(0)
  })

  it('verwirft reine Wiederholungen', () => {
    expect(scorePassword('abcabcabcabc').score).toBe(0)
    expect(scorePassword('aaaaaaaaaa').score).toBe(0)
    expect(scorePassword('abcabcabcabc').hint).toContain('wiederholt')
  })

  it('drückt Tastaturwege auf schwach — in beide Richtungen', () => {
    expect(scorePassword('Xqwertz9!kl').score).toBeLessThanOrEqual(1)
    expect(scorePassword('Xpoiuztre9!').score).toBeLessThanOrEqual(1)
    expect(scorePassword('Mein4321Haus').score).toBeLessThanOrEqual(1)
  })
})

describe('Persönliche Angaben', () => {
  const wer = ['Henrik Heil', 'henrik.heil@gmail.com']

  it('drückt herunter, was im Namen oder in der Adresse steht', () => {
    const b = scorePassword('henrikheil2026!', wer)
    expect(b.score).toBeLessThanOrEqual(1)
    expect(b.hint).toContain('Namen')
  })

  it('lässt dasselbe Passwort ohne diese Angaben in Ruhe', () => {
    expect(scorePassword('henrikheil2026!').score).toBeGreaterThan(1)
  })

  it('schlägt nicht bei kurzen Zufallstreffern an', () => {
    // „hei" steckt in „Heil", ist aber zu kurz, um etwas zu bedeuten
    expect(scorePassword('Heiterkeit im Tal', wer).score).toBe(4)
  })

  it('erkennt den lokalen Teil einer Adresse auch ohne den Namen', () => {
    expect(scorePassword('Sonnehenrik42', ['henrik@example.com']).score).toBeLessThanOrEqual(1)
  })
})

describe('Schwelle zum Absenden', () => {
  it('reicht genau ab der brauchbaren Stufe', () => {
    for (const pw of ['aaaaaaaa', 'passwort', 'vogelnest']) {
      expect(scorePassword(pw).acceptable, pw).toBe(false)
    }
    const gerade = scorePassword('Birnenbaum7')
    expect(gerade.score).toBeGreaterThanOrEqual(MIN_SCORE)
    expect(gerade.acceptable).toBe(true)
  })

  it('nennt bei jeder unzureichenden Eingabe einen Weg nach vorn', () => {
    for (const pw of ['abc', 'aaaaaaaa', 'passwort', 'vogelnest', 'Xqwertz9!kl']) {
      expect(scorePassword(pw).hint, pw).not.toBe('')
    }
  })

  it('schweigt erst, wenn nichts mehr zu verbessern ist', () => {
    expect(scorePassword('lampe wolke treppe').hint).toBe('')
  })
})
