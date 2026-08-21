// Wie gut ist dieses Passwort? — DOM-frei und geteilt zwischen Studio
// (Registrierung, Passwort-Reset) und Benutzerverwaltung.
//
// Bewusst KEIN zxcvbn: dessen Wörterbücher wiegen ein paar hundert Kilobyte und
// lägen im Basis-Bundle jeder Seite, auf der man sich anmelden kann. Die
// Bewertung hier ist gröber, trifft aber die Fälle, die zählen.
//
// Sie folgt dem, was das NIST seit 2017 empfiehlt: **Länge ist der Hebel**,
// erzwungene Zeichenklassen sind es nicht. „Hund!2026" erfüllt jede klassische
// Regel und ist trotzdem schlecht; „lampe wolke treppe" erfüllt keine und ist
// gut. Deshalb zählt hier vor allem, wie lang etwas ist — und was dagegen
// spricht (bekannte Muster, der eigene Name, Tastaturwege).

export interface PasswordAssessment {
  /** 0 = unbrauchbar, 1 = schwach, 2 = brauchbar, 3 = gut, 4 = stark */
  score: 0 | 1 | 2 | 3 | 4
  /** Das Wort zur Stufe, wie es unter dem Feld steht */
  label: string
  /** Der EINE Rat, der jetzt am meisten bringt; leer, wenn nichts mehr fehlt */
  hint: string
  /** Genügt es zum Absenden? (Ab „brauchbar") */
  acceptable: boolean
}

/** Kürzer geht nicht — dieselbe Schranke prüft der Server im Schema. */
export const MIN_LENGTH = 8

/** Ab dieser Stufe lassen die Formulare das Absenden zu. */
export const MIN_SCORE = 2

const LABELS = ['Unbrauchbar', 'Schwach', 'Brauchbar', 'Gut', 'Stark'] as const

/**
 * Die üblichen Verdächtigen, deutsch und englisch.
 *
 * Keine Liste der „10.000 häufigsten" — die wäre wieder ein Wörterbuch im
 * Bundle. Diese hier fängt das ab, was Menschen tippen, wenn sie sich gerade
 * kein Passwort ausdenken wollen.
 */
const COMMON = [
  'passwort',
  'password',
  'passwort1',
  'geheim',
  'geheim123',
  'qwertz',
  'qwerty',
  'asdfgh',
  'hallo',
  'hallo123',
  'test',
  'test1234',
  'admin',
  'administrator',
  'willkommen',
  'welcome',
  'sommer',
  'winter',
  'fussball',
  'schatz',
  'liebe',
  'sonne',
  'monkey',
  'dragon',
  'letmein',
  'iloveyou',
  'starwars',
  'maptale',
]

/** Tastaturwege und Zählreihen — in beiden Richtungen. */
const SEQUENCES = [
  'qwertzuiop',
  'qwertyuiop',
  'asdfghjkl',
  'yxcvbnm',
  'zxcvbnm',
  '1234567890',
  'abcdefghijklmnopqrstuvwxyz',
]

const charClasses = (pw: string): number =>
  Number(/[a-zäöüß]/.test(pw)) +
  Number(/[A-ZÄÖÜ]/.test(pw)) +
  Number(/[0-9]/.test(pw)) +
  Number(/[^A-Za-zÄÖÜäöüß0-9]/.test(pw))

/** Steckt eine Reihe von ≥ 4 Zeichen darin — vorwärts oder rückwärts? */
function hasSequence(lower: string): boolean {
  for (const sequence of SEQUENCES) {
    const reversed = [...sequence].reverse().join('')
    for (let i = 0; i + 4 <= sequence.length; i++) {
      if (lower.includes(sequence.slice(i, i + 4)) || lower.includes(reversed.slice(i, i + 4)))
        return true
    }
  }
  return false
}

/** „aaaa" oder „abcabcabc" — ein kurzes Stück, das sich wiederholt. */
function isRepetition(lower: string): boolean {
  if (lower.length < 4) return false
  for (let n = 1; n <= Math.floor(lower.length / 2); n++) {
    const chunk = lower.slice(0, n)
    if (chunk.repeat(Math.ceil(lower.length / n)).slice(0, lower.length) === lower) return true
  }
  return false
}

/**
 * Enthält das Passwort ein Stück aus Name oder E-Mail?
 *
 * Geprüft werden nur Bruchstücke ab vier Zeichen: Bei kürzeren träfe fast
 * jedes Passwort zu, das zufällig „ann" enthält, und die Warnung wäre Rauschen.
 */
function hasPersonalPart(lower: string, personal: readonly string[]): boolean {
  for (const raw of personal) {
    for (const part of raw.toLowerCase().split(/[^a-zäöüß0-9]+/)) {
      if (part.length >= 4 && lower.includes(part)) return true
    }
  }
  return false
}

/**
 * Bewertet ein Passwort. `persoenlich` sind Name und E-Mail des Anmelders —
 * ohne sie bliebe „henrikheil2026" unbeanstandet, obwohl es das Erste ist, was
 * jemand probiert, der den Namen kennt.
 */
export function scorePassword(pw: string, personal: readonly string[] = []): PasswordAssessment {
  if (!pw) return { score: 0, label: '', hint: '', acceptable: false }

  const missing = MIN_LENGTH - pw.length
  if (missing > 0) {
    return {
      score: 0,
      label: LABELS[0],
      hint: `Noch ${missing} Zeichen`,
      acceptable: false,
    }
  }

  const lower = pw.toLowerCase()

  // Länge trägt die Bewertung …
  let score = pw.length >= 16 ? 4 : pw.length >= 12 ? 3 : pw.length >= 10 ? 2 : 1
  // … Vielfalt hebt sie um eine Stufe, sobald überhaupt Substanz da ist.
  if (charClasses(pw) >= 3 && pw.length >= 10) score++
  // Eintönig UND kurz: das ist schnell durchprobiert.
  if (charClasses(pw) === 1 && pw.length < 14) score = Math.min(score, 1)

  let hint = ''
  const capAt = (max: number, reason: string): void => {
    if (score > max) {
      score = max
      hint = reason
    } else if (!hint) {
      hint = reason
    }
  }

  if (COMMON.some((h) => lower === h || (h.length >= 6 && lower.includes(h)))) {
    capAt(0, 'Das kennt jede Rateliste. Nimm lieber etwas Eigenes.')
  } else if (isRepetition(lower)) {
    capAt(0, 'Das wiederholt sich nur. Ein paar echte Wörter halten länger.')
  } else if (hasSequence(lower)) {
    capAt(1, 'Tastaturwege wie „qwertz" werden zuerst probiert.')
  } else if (hasPersonalPart(lower, personal)) {
    capAt(1, 'Nimm nichts, was in deinem Namen oder deiner Adresse steht.')
  }

  score = Math.max(0, Math.min(4, score)) as 0 | 1 | 2 | 3 | 4

  if (!hint) {
    if (score < MIN_SCORE) hint = 'Länger hilft mehr als komplizierter. Drei Wörter genügen.'
    else if (score < 4) hint = 'Noch ein paar Zeichen, dann ist es richtig stark.'
  }

  return {
    score: score as 0 | 1 | 2 | 3 | 4,
    label: LABELS[score] ?? LABELS[0],
    hint,
    acceptable: score >= MIN_SCORE,
  }
}
