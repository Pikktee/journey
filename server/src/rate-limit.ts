// Einfache In-Memory-Bremse pro Schlüssel (IP und/oder E-Mail): max. N Ereignisse
// je Fenster. Bewusst schlank — hinter dem Proxy zählt sonst dessen Adresse,
// daher bremsen die Aufrufer zusätzlich je Zieladresse.
//
// Der Zustand hängt an der Closure, nicht am Modul: Parallele App-Instanzen
// (vor allem in Tests) blockieren sich sonst gegenseitig.

export function buildRateLimit(maxVersuche: number, fensterMs = 60_000) {
  const versuche = new Map<string, { n: number; reset: number }>()
  return (...schluessel: string[]): boolean => {
    const jetzt = Date.now()
    if (versuche.size > 10_000) versuche.clear() // Speicher-Backstop
    let gebremst = false
    for (const key of schluessel) {
      const e = versuche.get(key)
      if (!e || e.reset < jetzt) versuche.set(key, { n: 1, reset: jetzt + fensterMs })
      else if (++e.n > maxVersuche) gebremst = true
    }
    return gebremst
  }
}
