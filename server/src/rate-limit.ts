// Einfache In-Memory-Bremse pro Schlüssel (IP und/oder E-Mail): max. N Ereignisse
// je Fenster. Bewusst schlank — hinter dem Proxy zählt sonst dessen Adresse,
// daher bremsen die Aufrufer zusätzlich je Zieladresse.
//
// Der Zustand hängt an der Closure, nicht am Modul: Parallele App-Instanzen
// (vor allem in Tests) blockieren sich sonst gegenseitig.

export function buildRateLimit(maxAttempts: number, windowMs = 60_000) {
  const attempts = new Map<string, { n: number; reset: number }>()
  return (...keys: string[]): boolean => {
    const now = Date.now()
    if (attempts.size > 10_000) attempts.clear() // Speicher-Backstop
    let limited = false
    for (const key of keys) {
      const e = attempts.get(key)
      if (!e || e.reset < now) attempts.set(key, { n: 1, reset: now + windowMs })
      else if (++e.n > maxAttempts) limited = true
    }
    return limited
  }
}
