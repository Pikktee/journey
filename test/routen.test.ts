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
import {
  EINSTIEGE,
  PFAD_ZU_DATEI,
  ROUTEN,
  handleAusPfad,
  pfad,
  profilPfad,
  tourAusPfad,
  tourPfad,
} from '../src/routen'

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
    expect(pfad('galerie', '?seite=2')).toBe('/galerie?seite=2')
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

  // — Der Tour-Namensraum (/tour/<kennung>) —
  //
  // Der zweite parametrisierte Namensraum neben /@handle. Was ihn zusammenhält:
  // die Unterscheidung „Server-Tour oder mitgelieferte" hängt allein am
  // `t_`-Präfix, und der Rückweg muss genau die Form liefern, unter der der
  // Player seine Merker führt.
  describe('Tour-Adressen', () => {
    it('baut und liest /tour/<kennung> in beide Richtungen', () => {
      expect(tourPfad('srv:t_9fK4mHx2QbVnRs')).toBe('/tour/t_9fK4mHx2QbVnRs')
      expect(tourPfad('kohphangan')).toBe('/tour/kohphangan')
      expect(tourAusPfad('/tour/t_9fK4mHx2QbVnRs')).toBe('srv:t_9fK4mHx2QbVnRs')
      expect(tourAusPfad('/tour/kohphangan')).toBe('kohphangan')
      expect(tourAusPfad('/erlebnis')).toBeNull()
      expect(tourAusPfad('/@henrik')).toBeNull()
      expect(tourAusPfad('/')).toBeNull()
    })

    it('bleibt über Hin- und Rückweg dieselbe Tour', () => {
      // Der zurückgegebene Param IST der Schlüssel der Positions-Merker
      // (`maptale:pos:<id>`) — kippt er, verwaist jede gemerkte Position.
      for (const param of ['srv:t_abc', 'kohphangan', 'stockholm', 'oberland']) {
        expect(tourAusPfad(tourPfad(param)), param).toBe(param)
      }
    })

    it('hält keine mitgelieferte Tour unter einem t_-Namen', () => {
      // Die einzige Unterscheidung zwischen Server-Tour und Registry im Pfad.
      // Ein `t_`-Schlüssel in tours.js machte aus einer statischen Tour still
      // einen Backend-Aufruf, der 404 gibt.
      const tours = lies('src/tours.js')
      expect(tours).not.toMatch(/^\s{2}t_[a-z0-9_]*\s*:/m)
    })

    it('kennt den Namensraum auch im Dev-Server', () => {
      const config = lies('vite.config.js')
      expect(config).toContain('tourAusPfad')
      expect(config).toContain('ROUTEN.player.datei')
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

    it('leitet /tour/<kennung> auf den Player — und schlägt die Endungs-Regex', () => {
      // Ohne diesen Block landet jeder geteilte Tour-Link auf der 404-Seite.
      // `^~` ist nicht Kosmetik: In CloudPanels Gerüst steht eine
      // Regex-Location auf Datei-Endungen, und Regex schlägt jede gewöhnliche
      // Prefix-Location.
      expect(vhost).toMatch(/location\s+\^~\s+\/tour\/\s*\{[^}]*erlebnis\.html/)
    })

    it('reicht /@henrik an die API durch, statt profil.html auszuliefern', () => {
      // Seit Etappe 6 beantwortet die API die Seite selbst — nur sie weiß, ob
      // dieses Profil in den Index darf. Stünde hier wieder ein `rewrite`,
      // bekäme jede Person denselben Kopf: den mit dem festen `noindex`.
      const block = vhost.match(/location ~ \^\/@ \{[\s\S]*?\n\}/)?.[0] ?? ''
      expect(block).toContain('proxy_pass http://127.0.0.1:8790;')
      expect(block).not.toContain('profil.html')
      // Ohne den Include verlöre die Antwort die geerbten Sicherheits-Header.
      expect(block).toContain('include /etc/nginx/global_settings;')
    })

    it('reicht die Profil-Sitemap an die API durch', () => {
      expect(vhost).toMatch(/location = \/sitemap-profile\.xml \{[\s\S]*?proxy_pass/)
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

  // — Auffindbarkeit —
  //
  // robots.txt und sitemap.xml sind eine dritte Ableitung der Tabelle, und die
  // stillste von allen: Eine neue Seite, die in keiner von beiden vorkommt,
  // funktioniert tadellos — sie taucht nur nie in einer Suche auf, und niemand
  // merkt es. Deshalb muss jeder Pfad hier eine Zuordnung haben.
  describe('robots.txt und sitemap.xml', () => {
    const robots = lies('public/robots.txt')
    const sitemap = lies('public/sitemap.xml')
    const BASIS = 'https://maptale.io'

    /**
     * Gecrawlt, aber bewusst nicht in der Sitemap. Wer eine Seite hier
     * einträgt, trifft eine Entscheidung und schreibt sie hin — das ist der
     * Zweck der Liste.
     *
     * `player`: eine Adresse ohne `?tour=…` ist nur die Standard-Tour, kein
     * eigenständiger Inhalt; holen dürfen die Vorschau-Bots sie trotzdem.
     * `profil`: trägt heute `noindex` im HTML (statisch für alle gleich) und
     * kommt mit Etappe 6 in die Sitemap.
     */
    const NICHT_GELISTET = new Set<keyof typeof ROUTEN>(['player', 'profil'])

    it('ordnet jeden Pfad zu — gelistet, gesperrt oder ausdrücklich beides nicht', () => {
      for (const seite of SEITEN) {
        const p = ROUTEN[seite].pfad
        const gelistet = sitemap.includes(`<loc>${BASIS}${p === '/' ? '/' : p}</loc>`)
        const gesperrt = new RegExp(`^Disallow: ${p}$`, 'm').test(robots)
        const bewusst = NICHT_GELISTET.has(seite)
        expect(
          [gelistet, gesperrt, bewusst].filter(Boolean).length,
          `${seite} (${p}): genau eines von gelistet/gesperrt/NICHT_GELISTET`,
        ).toBe(1)
      }
    })

    it('nennt beide Sitemaps unter ihrer echten Adresse', () => {
      expect(robots).toContain(`Sitemap: ${BASIS}/sitemap.xml`)
      expect(existsSync(join(wurzel, 'public/sitemap.xml'))).toBe(true)
      // Die zweite kommt aus der Datenbank (server/src/routes/seiten.ts) und
      // liegt deshalb NICHT im Build — der Vhost reicht sie an die API durch.
      expect(robots).toContain(`Sitemap: ${BASIS}/sitemap-profile.xml`)
      expect(lies('deploy/cloudpanel-nginx.conf')).toContain('location = /sitemap-profile.xml')
    })

    it('hält den Meta-Block der Profilseite ersetzbar', () => {
      // Die Marker sind der Vertrag zwischen profil.html und dem Server
      // (server/src/seiten.ts). Verschwinden sie beim Aufräumen, reicht der
      // Server die Seite stumm unverändert durch: jedes Profil wieder mit
      // demselben Kopf und festem noindex — und niemand merkt es.
      const html = lies('profil.html')
      expect(html).toContain('<!-- maptale:meta -->')
      expect(html).toContain('<!-- /maptale:meta -->')
      expect(html.indexOf('<!-- maptale:meta -->')).toBeLessThan(html.indexOf('<!-- /maptale:meta -->'))
      // Der Server-seitige Vertrag: dieselben Zeichenketten dort.
      const quelle = lies('server/src/seiten.ts')
      expect(quelle).toContain("MARKE_AUF = '<!-- maptale:meta -->'")
      expect(quelle).toContain("MARKE_ZU = '<!-- /maptale:meta -->'")
    })

    it('bedient /@handle im Dev über denselben Weg wie in Produktion', () => {
      // Ohne den Proxy liefe der Dev-Server auf einem anderen URL-Raum: Die
      // Profilseite käme statisch, ohne Meta-Kopf — und der Unterschied fiele
      // erst nach dem Deploy auf.
      expect(lies('vite.config.js')).toContain("'^/@[a-z0-9._-]+$'")
    })

    it('sperrt nichts, was ein noindex tragen soll', () => {
      // Ein Disallow hebt ein noindex auf: Was nicht geholt werden darf, kann
      // auch nicht gelesen werden — die URL landet dann OHNE Inhalt im Index.
      // Die Profilseite lebt genau von diesem noindex (bis Etappe 6).
      // erlebnis.html: solange die Seite für alle Touren gleich ausgeliefert
      // wird, kann sie `public` nicht von `unlisted` unterscheiden — und
      // `unlisted` verspricht „jeder mit dem Link, sonst niemand". Ein
      // Suchtreffer bräche das. Die Vorschaukarten bleiben unberührt, die Bots
      // der Messenger kümmern sich nicht um `robots`.
      for (const datei of ['profil.html', 'erlebnis.html'] as const) {
        expect(lies(datei), datei).toContain('name="robots" content="noindex"')
      }
      expect(robots).not.toMatch(/^Disallow: \/profil$/m)
      expect(robots).not.toMatch(/^Disallow: \/@/m)
      // Dasselbe für die Touren: Ein gesperrtes /tour/ hieße heute „geteilter
      // Link ohne Vorschaubild" und nähme Etappe 6 die Wahl pro Tour.
      expect(robots).not.toMatch(/^Disallow: \/tour/m)
    })

    it('listet keinen Pfad, den es nicht gibt', () => {
      const pfade = new Set(SEITEN.map((s) => ROUTEN[s].pfad))
      for (const treffer of sitemap.matchAll(/<loc>https:\/\/maptale\.io([^<]*)<\/loc>/g)) {
        expect(pfade.has(treffer[1] ?? ''), `Sitemap nennt ${treffer[1]}`).toBe(true)
      }
    })
  })

  // — Vorschaukarten geteilter Links —
  //
  // Die Bots von WhatsApp, Slack & Co. führen kein JavaScript aus: Was nicht im
  // ausgelieferten HTML steht, gibt es für sie nicht. Und relative Bild-URLs
  // löst keiner von ihnen auf.
  describe('Open Graph', () => {
    const SEITEN_MIT_KARTE = ['index.html', 'galerie.html', 'erlebnis.html'] as const
    const BILD = 'https://maptale.io/og/maptale.jpg'

    it('trägt Titel, Beschreibung, Bild und Karten-Art', () => {
      for (const datei of SEITEN_MIT_KARTE) {
        const html = lies(datei)
        for (const tag of ['og:type', 'og:title', 'og:description', 'og:image']) {
          expect(html, `${datei}: ${tag}`).toContain(`property="${tag}"`)
        }
        expect(html, `${datei}: twitter:card`).toContain('name="twitter:card"')
        expect(html, `${datei}: og:image absolut`).toContain(`content="${BILD}"`)
      }
    })

    it('hat das Bild wirklich im Build liegen', () => {
      // public/ kopiert Vite unverändert nach dist/. Erzeugt wird die Datei von
      // scripts/gen-og-bild.mjs — fehlt sie, zeigt jede geteilte Karte ein Loch.
      expect(existsSync(join(wurzel, 'public/og/maptale.jpg'))).toBe(true)
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
