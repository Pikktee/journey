// Drift-Wächter für die Versionsnummer.
//
// Sie stand einmal an zwei Stellen — in der package.json und noch einmal fest
// in der Gradle-Datei der App. Gepflegt wurde in der Praxis nur die erste: Der
// App-Code änderte sich zweimal, die Nummer blieb auf 0.2.0, und am Gerät war
// nicht mehr zu erkennen, welcher Stand installiert ist. Seitdem LIEST die
// Gradle-Datei die package.json. Dieser Test hält den Weg zurück versperrt.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const gradle = readFileSync(new URL('../android/app/build.gradle.kts', import.meta.url), 'utf8')
const paket = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string
}

/** Spiegel der Rechnung in build.gradle.kts — 0.33.0 → 3300. */
function versionsZahl(version: string): number {
  const [major, minor, patch] = version.split('.').map(Number)
  return major! * 10000 + minor! * 100 + patch!
}

describe('App-Version', () => {
  it('wird aus der package.json abgeleitet, nicht zweitgepflegt', () => {
    expect(gradle).toMatch(/versionName\s*=\s*repoVersion/)
    expect(gradle).toMatch(/versionCode\s*=\s*versionsZahl\(repoVersion\)/)
    // Eine feste Nummer wäre genau der Rückfall, der schon einmal passiert ist
    expect(gradle).not.toMatch(/versionName\s*=\s*"/)
    expect(gradle).not.toMatch(/versionCode\s*=\s*\d/)
  })

  it('bleibt in der Reihenfolge, die Android verlangt', () => {
    // versionCode darf NIE kleiner werden, sonst verweigert das Gerät das Update
    const folge = ['0.2.0', '0.3.0', '0.33.0', '0.33.1', '1.0.0', '1.0.1']
    const zahlen = folge.map(versionsZahl)
    expect(zahlen).toEqual([...zahlen].sort((a, b) => a - b))
    expect(new Set(zahlen).size).toBe(zahlen.length)
  })

  it('deckt die aktuelle Version ab (Minor/Patch unter 100)', () => {
    // Darüber kippt die Rechnung: 0.100.0 läge hinter 1.0.0. Der Gradle-Build
    // bricht dort ab — dieser Test sagt es früher.
    const [, minor, patch] = paket.version.split('.').map(Number)
    expect(minor).toBeLessThan(100)
    expect(patch).toBeLessThan(100)
  })

  it('steht auf der Landing nicht als zweite Zahl', () => {
    // Dieselbe Falle wie in Gradle: v0.1.0 blieb stehen, die Fußzeile zeigte 0.62.0.
    const landing = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
    expect(landing).not.toMatch(/v0\.\d+\.\d+/)
    expect(landing).toContain('id="app-version"')
    expect(landing).toContain('APP_VERSION')
    expect(landing.match(/class="phone-slide/g)?.length).toBe(4)
    expect(landing).toContain('android-mark')
    expect(landing.match(/class="store-soon"/g)?.length).toBe(2)
    expect(landing).toContain('Google Play')
    expect(landing).toContain('App Store')
  })
})
