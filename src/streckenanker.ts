// Die Übersetzung, mit der jeder `f`-Anker einer Tour an seinem gemeinten Ort
// landet (Gleichlauf-Konzept §8D, E4/E11).
//
// Der Server misst `f` auf der ROHEN Geometrie, der Player fährt auf einer
// Catmull-Rom-geglätteten, alle 14 m abgetasteten Route — die ist 2,2–3,0 %
// länger, und die Dehnung verteilt sich ungleichmäßig. `f × route.total` lag
// deshalb je nach Stelle bis zu 9 Filmsekunden neben dem Anker.
//
// Die Abhilfe ist eine Tabelle statt einer Formel: je Wegpunkt sein `f`
// (kommt aus dem Tour-JSON) und sein `s` (rechnet `buildRoute` mit, `route.wpS`).
// Dazwischen wird linear interpoliert — genau die Annahme, unter der der Server
// misst.
//
// **Kuratierte Touren bekommen nie ein Wegpunkt-`f`** (src/tours.ts ist eine
// Datei mit Wegpunkten, keine Aufzeichnung). Für sie ist der Rückfall auf
// `f × route.total` DAUERHAFT, nicht übergangsweise — dasselbe gilt für jede
// aufgezeichnete Tour bis zu ihrem nächsten Render.

/**
 * Übersetzt einen Streckenanteil `f` (0..1, wie der Server ihn misst) in Streckenmeter.
 *
 * `quelle` sagt, WELCHE der beiden Rechnungen dahintersteht — die Tabelle oder
 * der Rückfall. Bei einer kuratierten Tour ist der Rückfall der Normalfall; bei
 * einer aufgezeichneten wäre er ein Datenfehler, der sich als „alles wie
 * früher" tarnt. Deshalb steht er in `window.__j.anker` zum Nachsehen, wie die
 * verworfene Zeit der Filmuhr (src/filmuhr.ts).
 */
export type SBeiF = ((f: number) => number) & { quelle: 'tabelle' | 'rueckfall' }

/**
 * Baut die Übersetzung aus der Wegpunkt-Tabelle. `wegpunktF` und `wegpunktS`
 * sind parallel: derselbe Wegpunkt, sein Server-`f` und sein Wegstand auf der
 * gebauten Route.
 *
 * Ist die Tabelle unbrauchbar — kein `f` geliefert, Längen ungleich, weniger
 * als zwei Punkte, unendliche Werte —, kommt der Rückfall `f × total` zurück.
 * Das ist kein Notbehelf, sondern das bisherige Verhalten (s. Kopf).
 *
 * **Rückwärts (`?reverse=1`) fällt hier von selbst an:** Dort dreht der Player
 * Segmente UND Punkte um, `wegpunktF` läuft also absteigend, während `wegpunktS`
 * weiter steigt. Die Tabelle wird dann gespiegelt statt verworfen — der Anker
 * gehört auch rückwärts an seinen physischen Ort.
 */
export function baueSBeiF(
  wegpunktF: readonly number[] | null | undefined,
  wegpunktS: readonly number[],
  total: number,
): SBeiF {
  const klemme = (f: number) => (Number.isFinite(f) ? Math.max(0, Math.min(1, f)) : 0)
  const rueckfall: SBeiF = Object.assign((f: number) => klemme(f) * total, {
    quelle: 'rueckfall' as const,
  })

  if (!wegpunktF || wegpunktF.length < 2 || wegpunktF.length !== wegpunktS.length) return rueckfall
  if (!(total > 0)) return rueckfall
  if (!wegpunktF.every(Number.isFinite) || !wegpunktS.every(Number.isFinite)) return rueckfall

  // Rückwärts gelesene Tabelle spiegeln, danach ist `fs` nicht-fallend.
  const abwaerts = (wegpunktF[wegpunktF.length - 1] as number) < (wegpunktF[0] as number)
  const fs = abwaerts ? [...wegpunktF].reverse() : [...wegpunktF]
  const ss = abwaerts ? [...wegpunktS].reverse() : [...wegpunktS]

  // Streng steigende Stützstellen: Nahtpunkte kommen doppelt vor (dieselbe
  // Stelle in zwei Segmenten), und eine Aufzeichnung im Stand liefert viele
  // Punkte mit demselben `f`. Beides ist gültig — aber als Stützstelle taugt
  // nur der jeweils LETZTE: Ein Anker genau auf dem Plateau meint das Ende der
  // Standzeit, nicht ihren Anfang (die lower_bound-Konvention „Plateau →
  // Ankunft" aus §8C, hier in ihrer f-Fassung).
  const kf: number[] = []
  const ks: number[] = []
  for (let i = 0; i < fs.length; i++) {
    const f = fs[i] as number
    if (kf.length && f <= (kf[kf.length - 1] as number)) {
      if (f < (kf[kf.length - 1] as number)) return rueckfall // nicht monoton → unbrauchbar
      ks[ks.length - 1] = ss[i] as number
      continue
    }
    kf.push(f)
    ks.push(ss[i] as number)
  }
  if (kf.length < 2) return rueckfall

  return Object.assign(
    (f: number) => {
      const ziel = klemme(f)
      if (ziel <= (kf[0] as number)) return ks[0] as number
      if (ziel >= (kf[kf.length - 1] as number)) return ks[ks.length - 1] as number
      // Binärsuche: erste Stützstelle mit kf[hi] >= ziel
      let lo = 0
      let hi = kf.length - 1
      while (lo < hi) {
        const mitte = (lo + hi) >> 1
        if ((kf[mitte] as number) < ziel) lo = mitte + 1
        else hi = mitte
      }
      const f1 = kf[hi] as number
      const f0 = kf[hi - 1] as number
      const s1 = ks[hi] as number
      const s0 = ks[hi - 1] as number
      const spanne = f1 - f0
      return spanne <= 0 ? s1 : s0 + ((ziel - f0) / spanne) * (s1 - s0)
    },
    { quelle: 'tabelle' as const },
  )
}
