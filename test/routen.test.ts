// Der URL-Raum: eine Tabelle, drei Abnehmer, die nicht voneinander wissen.
//
// src/routen.ts ist die Quelle. Der Nginx-Vhost und die Kopie im Server
// (Mail-Links, eigener rootDir) leiten sich davon ab, KÖNNEN sie aber nicht
// importieren — genau die Lage, in der in diesem Projekt schon einmal etwas
// auseinanderlief (die Fortbewegungs-MODI). Ein Fehler hier fällt sonst erst
// auf, wenn jemand einen Link in seiner Mail anklickt.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { HANDLE_REGELN, RESERVIERTE_HANDLES } from '../src/handle'
import { EINSTIEGE, PFAD_ZU_DATEI, ROUTEN, handleAusPfad, pfad, profilPfad } from '../src/routen'

const wurzel = join(dirname(fileURLToPath(import.meta.url)), '..')
const lies = (p: string): string => readFileSync(join(wurzel, p), 'utf8')

const SEITEN = Object.keys(ROUTEN) as (keyof typeof ROUTEN)[]

describe('routen', () => {
  it('trägt keine .html-Endung und beginnt mit einem Schrägstrich', () => {
    for (const seite of SEITEN) {
      const p = ROUTEN[seite].pfad
      expect(p, `${seite}`).toMatch(/^\/(?:[a-z0-9-]+)?$/)
      expect(p, `${seite}`).not.toContain('.html')
    }
  })

  it('verweist nur auf Dateien, die es gibt', () => {
    for (const seite of SEITEN) {
      expect(existsSync(join(wurzel, ROUTEN[seite].datei)), ROUTEN[seite].datei).toBe(true)
    }
  })

  it('vergibt keinen Pfad zweimal', () => {
    const pfade = SEITEN.map((s) => ROUTEN[s].pfad)
    expect(new Set(pfade).size).toBe(pfade.length)
  })

  it('hängt Query und Fragment an', () => {
    expect(pfad('player', '?tour=srv:t_1')).toBe('/erlebnis?tour=srv:t_1')
    expect(pfad('anmelden', '#verify=abc')).toBe('/anmelden#verify=abc')
    expect(pfad('app')).toBe('/app')
  })

  it('führt jede Datei genau einmal als Vite-Eingang', () => {
    const dateien = Object.values(EINSTIEGE)
    expect(new Set(dateien).size).toBe(dateien.length)
    expect(new Set(dateien)).toEqual(new Set(Object.values(PFAD_ZU_DATEI)))
    expect(dateien).toContain('index.html')
  })

  // — Der Handle-Namensraum (/@henrik) —
  //
  // Er liegt NEBEN der Tabelle, nicht darin: `/@…` ist kein Seitenpfad, sondern
  // ein eigener Namensraum (s. src/handle.ts). Was ihn zusammenhält, sind diese
  // drei Prüfungen — sonst entwertet ein neuer Pfad still einen vergebenen
  // Handle, oder Browser und Server sind sich uneins darüber, was gültig ist.
  describe('Profil-Adressen', () => {
    it('baut und liest /@handle ohne Query-Kodierung', () => {
      // `encodeURIComponent('@')` wäre `%40` — aus der vorlesbaren Adresse
      // würde eine, die niemand diktiert.
      expect(profilPfad('henrik')).toBe('/@henrik')
      expect(handleAusPfad('/@henrik')).toBe('henrik')
      expect(handleAusPfad('/@anna-maria')).toBe('anna-maria')
      expect(handleAusPfad('/galerie')).toBeNull()
      expect(handleAusPfad('/')).toBeNull()
    })

    it('reserviert jeden Seitenpfad als Handle', () => {
      for (const seite of SEITEN) {
        const p = ROUTEN[seite].pfad
        if (p === '/') continue
        expect(RESERVIERTE_HANDLES.has(p.slice(1)), `${p} fehlt in RESERVIERTE_HANDLES`).toBe(true)
      }
    })

    it('kennt den Namensraum auch im Dev-Server', () => {
      // Ohne das Gegenstück in der Vite-Middleware liefe der Dev-Server auf
      // einem anderen URL-Raum als die Produktion — und das fiele erst nach dem
      // Deploy auf. Die Prüfung gegen HANDLE_REGELN gehört dazu: Vite bedient
      // unter `/@` seine eigenen Adressen (`/@vite/client`, `/@fs/…`).
      const config = lies('vite.config.js')
      expect(config).toContain('HANDLE_REGELN')
      expect(config).toContain("pfad.startsWith('/@')")
      expect(config).toContain('ROUTEN.profil.datei')
    })

    it('hält die Server-Kopie deckungsgleich', () => {
      // server/ hat einen eigenen rootDir und kann src/handle.ts nicht
      // importieren. Läuft die Kopie auseinander, ist ein Handle im Browser
      // grün und wird vom Server abgelehnt — oder umgekehrt.
      const quelle = lies('server/src/handle.ts')
      expect(quelle).toContain(`export const HANDLE_REGELN = ${HANDLE_REGELN.toString()}`)
      const liste = quelle.match(/RESERVIERTE_HANDLES[^[]*\[([\s\S]*?)\]/)?.[1] ?? ''
      const serverWorte = new Set([...liste.matchAll(/'([^']+)'/g)].map((t) => t[1]))
      expect(serverWorte).toEqual(RESERVIERTE_HANDLES)
    })
  })

  // — Nginx —
  //
  // Zwei Wege führen zu einer Seite: entweder es gibt eine gleichnamige Datei
  // (dann greift `try_files $uri $uri.html`), oder der Pfad braucht einen
  // eigenen `location =`-Block. Fehlt beides, landet der Aufruf auf der
  // Landing — stumm, mit 200, und niemand merkt es beim Deploy.
  describe('Nginx-Vhost', () => {
    const vhost = lies('deploy/cloudpanel-nginx.conf')

    it('löst .html-lose Pfade über try_files auf — und endet ehrlich mit 404', () => {
      expect(vhost).toContain('try_files $uri $uri.html $uri/ =404;')
      // Kein Fallback auf die Landing: ein Soft-404 (Status 200 mit falschem
      // Inhalt) belügt Browser wie Suchmaschinen, und einen Client-Router, der
      // ihn bräuchte, gibt es hier nicht.
      expect(vhost).not.toContain('/index.html;')
    })

    it('hängt die gestaltete Fehlerseite ein — und die Datei liegt im Build', () => {
      expect(vhost).toContain('error_page 404 /404.html;')
      // public/ kopiert Vite unverändert nach dist/ — ohne Eintrag in
      // routen.ts, weil eine Fehlerseite kein Ziel ist, das man verlinkt.
      expect(existsSync(join(wurzel, 'public/404.html'))).toBe(true)
    })

    it('holt die geerbten Header zurück, wo ein add_header sie unterdrückt', () => {
      // nginx vererbt add_header nur, solange die Location selbst keines setzt.
      // Ohne den Include verlöre jede Antwort aus diesem Block die
      // Sicherheits-Header aus global_settings — lautlos.
      const block = vhost.match(/location \/ \{[\s\S]*?\n\}/)?.[0] ?? ''
      expect(block).toContain('add_header Cache-Control')
      expect(block).toContain('include /etc/nginx/global_settings;')
    })

    it('leitet /@henrik auf die Profilseite', () => {
      // Ohne diesen Block landet jeder Profil-Link auf der 404-Seite — und der
      // Deploy zieht den Vhost nicht mit.
      expect(vhost).toMatch(/location\s+~\s+\^\/@\s*\{[^}]*profil\.html/)
    })

    it('bedient jeden Pfad — über die gleichnamige Datei oder einen eigenen Block', () => {
      for (const seite of SEITEN) {
        const { pfad: p, datei } = ROUTEN[seite]
        if (p === '/') continue
        const gleichnamig = datei === `${p.slice(1)}.html`
        const eigenerBlock = new RegExp(`location\\s*=\\s*${p}\\s*\\{[^}]*${datei}`).test(vhost)
        expect(gleichnamig || eigenerBlock, `${p} → ${datei}`).toBe(true)
      }
    })
  })

  // — Server-Kopie —
  describe('Mail-Pfade im Server', () => {
    const quelle = lies('server/src/webpfade.ts')
    const auth = lies('server/src/routes/auth.ts')

    it('nennt dieselben Pfade wie die Tabelle', () => {
      for (const seite of ['anmelden', 'registrieren', 'impressum', 'datenschutz'] as const) {
        expect(quelle, seite).toContain(`${seite}: '${ROUTEN[seite].pfad}'`)
      }
    })

    it('baut Bestätigung und Reset aus WEB_PFADE statt aus einer getippten Adresse', () => {
      expect(auth).toContain('${WEB_PFADE.anmelden}#verify=')
      expect(auth).toContain('${WEB_PFADE.anmelden}#reset=')
      expect(auth).not.toContain('studio.html#')
    })
  })

  // — Die Seiten selbst —
  it('verlinkt in den HTML-Seiten keine .html-Adressen mehr', () => {
    const seiten = [...new Set(SEITEN.map((s) => ROUTEN[s].datei))]
    for (const datei of seiten) {
      const treffer = lies(datei).match(/href="\/[a-z0-9-]*\.html/g)
      expect(treffer, `${datei}: ${treffer?.join(', ')}`).toBeNull()
    }
  })
})
