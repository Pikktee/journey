// Passwortbewertung: Länge trägt, Muster ziehen herunter, persönliche Angaben
// sind ein Ausschluss. Die Tests halten vor allem die REIHENFOLGE der Ratschläge
// fest — es soll immer nur der eine dastehen, der gerade am meisten bringt.

import { describe, expect, it } from 'vitest'
import { bewertePasswort, MIN_LAENGE, MIN_SCORE } from '../src/passwortstaerke.js'

describe('Länge', () => {
  it('sagt bei leerem Feld gar nichts', () => {
    const b = bewertePasswort('')
    expect(b).toMatchObject({ score: 0, wort: '', tipp: '', reicht: false })
  })

  it('zählt herunter, solange die Mindestlänge fehlt', () => {
    expect(bewertePasswort('abc').tipp).toBe(`Noch ${MIN_LAENGE - 3} Zeichen`)
    expect(bewertePasswort('abcdefg').tipp).toBe('Noch 1 Zeichen')
    expect(bewertePasswort('abcdefg').reicht).toBe(false)
  })

  it('steigt mit der Länge, ohne dass Sonderzeichen nötig wären', () => {
    // Genau der Fall, für den die Bewertung gebaut ist: drei harmlose Wörter
    const worte = bewertePasswort('lampe wolke treppe')
    expect(worte.score).toBe(4)
    expect(worte.reicht).toBe(true)
  })

  it('hält ein kurzes Passwort mit nur einer Zeichenart klein', () => {
    expect(bewertePasswort('vogelnest').score).toBeLessThanOrEqual(1)
  })

  it('lässt Vielfalt eine Stufe gutmachen', () => {
    const einfach = bewertePasswort('birnenbaum')
    const gemischt = bewertePasswort('Birnenbaum7')
    expect(gemischt.score).toBeGreaterThan(einfach.score)
  })
})

describe('Bekannte Muster', () => {
  it('verwirft, was auf jeder Rateliste steht', () => {
    // Alle lang genug, um NICHT schon an der Mindestlänge zu scheitern —
    // sonst prüfte der Test die Reihenfolge der Ratschläge, nicht die Liste.
    for (const pw of ['passwort', 'geheim123', 'willkommen', 'maptale123']) {
      const b = bewertePasswort(pw)
      expect(b.score, pw).toBe(0)
      expect(b.tipp, pw).toContain('Rateliste')
    }
  })

  it('erkennt ein häufiges Wort auch mitten im Passwort', () => {
    expect(bewertePasswort('xxpasswortxx').score).toBe(0)
  })

  it('verwirft reine Wiederholungen', () => {
    expect(bewertePasswort('abcabcabcabc').score).toBe(0)
    expect(bewertePasswort('aaaaaaaaaa').score).toBe(0)
    expect(bewertePasswort('abcabcabcabc').tipp).toContain('wiederholt')
  })

  it('drückt Tastaturwege auf schwach — in beide Richtungen', () => {
    expect(bewertePasswort('Xqwertz9!kl').score).toBeLessThanOrEqual(1)
    expect(bewertePasswort('Xpoiuztre9!').score).toBeLessThanOrEqual(1)
    expect(bewertePasswort('Mein4321Haus').score).toBeLessThanOrEqual(1)
  })
})

describe('Persönliche Angaben', () => {
  const wer = ['Henrik Heil', 'henrik.heil@gmail.com']

  it('drückt herunter, was im Namen oder in der Adresse steht', () => {
    const b = bewertePasswort('henrikheil2026!', wer)
    expect(b.score).toBeLessThanOrEqual(1)
    expect(b.tipp).toContain('Namen')
  })

  it('lässt dasselbe Passwort ohne diese Angaben in Ruhe', () => {
    expect(bewertePasswort('henrikheil2026!').score).toBeGreaterThan(1)
  })

  it('schlägt nicht bei kurzen Zufallstreffern an', () => {
    // „hei" steckt in „Heil", ist aber zu kurz, um etwas zu bedeuten
    expect(bewertePasswort('Heiterkeit im Tal', wer).score).toBe(4)
  })

  it('erkennt den lokalen Teil einer Adresse auch ohne den Namen', () => {
    expect(bewertePasswort('Sonnehenrik42', ['henrik@example.com']).score).toBeLessThanOrEqual(1)
  })
})

describe('Schwelle zum Absenden', () => {
  it('reicht genau ab der brauchbaren Stufe', () => {
    for (const pw of ['aaaaaaaa', 'passwort', 'vogelnest']) {
      expect(bewertePasswort(pw).reicht, pw).toBe(false)
    }
    const gerade = bewertePasswort('Birnenbaum7')
    expect(gerade.score).toBeGreaterThanOrEqual(MIN_SCORE)
    expect(gerade.reicht).toBe(true)
  })

  it('nennt bei jeder unzureichenden Eingabe einen Weg nach vorn', () => {
    for (const pw of ['abc', 'aaaaaaaa', 'passwort', 'vogelnest', 'Xqwertz9!kl']) {
      expect(bewertePasswort(pw).tipp, pw).not.toBe('')
    }
  })

  it('schweigt erst, wenn nichts mehr zu verbessern ist', () => {
    expect(bewertePasswort('lampe wolke treppe').tipp).toBe('')
  })
})
