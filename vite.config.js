import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'

import { defineConfig } from 'vite'

import { HANDLE_PATTERN } from './src/handle.ts'
import { ENTRIES, PATH_TO_FILE, ROUTES, tourFromPath } from './src/routes.ts'

/**
 * URLs ohne `.html` — im Dev und in der Vorschau.
 *
 * In Produktion macht das Nginx (`try_files $uri $uri.html …` plus die drei
 * `location =`-Blöcke für /app, /anmelden, /registrieren, s.
 * deploy/cloudpanel-nginx.conf). Ohne dieses Gegenstück liefe der Dev-Server
 * auf einem anderen URL-Raum als die Produktion — und genau das würde erst
 * nach dem Deploy auffallen.
 */
function saubereUrls() {
  const umschreiben = (req) => {
    const schnitt = req.url.search(/[?#]/)
    const pfad = (schnitt === -1 ? req.url : req.url.slice(0, schnitt)).replace(/(.)\/+$/, '$1')
    const rest = schnitt === -1 ? '' : req.url.slice(schnitt)
    // `/` liefert Vite selbst; `/erlebnis.html` steht gar nicht in der Tabelle.
    // `/@henrik` ist der eigene Namensraum der Profile (s. src/handle.ts) und
    // steht deshalb nicht in der Tabelle, sondern als eigene Regel — in Nginx
    // ist das `location ~ ^/@`. Der Handle bleibt in der Adresszeile stehen;
    // die Seite liest ihn dort.
    //
    // Geprüft wird gegen HANDLE_PATTERN und nicht bloß auf `/@`: Vite bedient
    // unter genau diesem Präfix seine eigenen Adressen (`/@vite/client`,
    // `/@fs/…`, `/@react-refresh`). Ein pauschales Umschreiben lieferte dem
    // Dev-Server statt seines Clients eine HTML-Seite — und zwar nur im Dev,
    // wo es keine Entsprechung in Produktion gibt.
    // `/tour/<kennung>` ist der zweite parametrisierte Namensraum (s.
    // src/routes.ts); in Nginx ist das `location ^~ /tour/`. Anders als beim
    // Handle braucht es hier keine Zeichenprüfung — unter `/tour/` bedient
    // Vite nichts Eigenes.
    const handle = pfad.startsWith('/@') ? pfad.slice(2) : null
    const datei =
      pfad === '/'
        ? null
        : handle && HANDLE_PATTERN.test(handle)
          ? ROUTES.profile.file
          : tourFromPath(pfad)
            ? ROUTES.player.file
            : PATH_TO_FILE[pfad]
    if (datei) req.url = `/${datei}${rest}`
  }
  // Bewusst kein Ausdrucks-Body: `middlewares.use()` gibt die Connect-App
  // zurück, und die IST eine Funktion — Vite hielte sie für den Post-Hook von
  // `configureServer` und riefe sie ohne Request auf (`req.url` von undefined).
  const middleware = (server) => {
    server.middlewares.use((req, _res, next) => {
      umschreiben(req)
      next()
    })
  }
  return {
    name: 'maptale-saubere-urls',
    configureServer: middleware,
    configurePreviewServer: middleware,
  }
}

/**
 * Der Doku-Viewer unter `/doku` — nur im Dev-Server und in der Vorschau.
 *
 * Er liegt fertig gebaut in `docs/_site/` (`npm run docs`) und wird von hier
 * ROH ausgeliefert. Das ist der Punkt: Bäte man Vite darum, ginge jede
 * `.css`-Datei durch seine Transformation und käme als `text/javascript`
 * zurück — die Seiten stünden dann ungestaltet da. Deshalb ein eigener
 * Handler mit eigener Typ-Tabelle statt `publicDir` oder einem Alias.
 *
 * `apply: 'serve'` ist kein Detail: Die interne Doku hat im `dist/` nichts zu
 * suchen, und der Ordner steht in `.gitignore`.
 */
function dokuAusliefern() {
  const TYPEN = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.md': 'text/plain; charset=utf-8',
  }
  /**
   * Im Dev-Server bekommt jede ausgelieferte Doku-Seite Vites eigenen Client
   * angehängt — DIE Zeile, an der das automatische Neuladen hängt.
   *
   * Die Doku ist rohes, gebautes HTML und geht durch keine Vite-Transformation:
   * Ohne diesen Verweis besteht keine Verbindung zum Dev-Server, und ein
   * `full-reload` ginge ins Leere. In der Vorschau (`npm run preview`) bleibt
   * er weg — dort prüft man die gebaute Fassung, und die hat keinen Wächter.
   */
  const mitDevClient = (inhalt, dev) => {
    if (!dev) return inhalt
    const marke = '<script type="module" src="/@vite/client"></script>'
    return inhalt.includes('</body>')
      ? inhalt.replace('</body>', marke + '</body>')
      : inhalt + marke
  }

  const middleware = (server, dev) => {
    // Die schreibende Seite: bearbeiten, archivieren, zurückholen. Sie hängt
    // bewusst hier und nicht im Backend — sie schreibt in den Arbeitsbaum
    // dieses Rechners und hat auf einem Server nichts verloren.
    server.middlewares.use('/doku/api/', async (req, res) => {
      const antworte = (code, koerper) => {
        res.statusCode = code
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify(koerper))
      }
      try {
        const aktion = decodeURI((req.url || '/').split(/[?#]/)[0]).replace(/^\/+/, '')
        const roh = await new Promise((fertig, fehler) => {
          let puffer = ''
          req.on('data', (stueck) => {
            puffer += stueck
            if (puffer.length > 4_000_000) fehler(new Error('Zu groß'))
          })
          req.on('end', () => fertig(puffer))
          req.on('error', fehler)
        })
        const { fuehreAus } = await import('./scripts/docs-viewer/dienst.mjs')
        antworte(200, { ok: true, ...(await fuehreAus(aktion, roh ? JSON.parse(roh) : {})) })
      } catch (fehler) {
        antworte(400, { ok: false, meldung: String(fehler.message || fehler) })
      }
    })

    server.middlewares.use('/doku', (req, res, next) => {
      const pfad = decodeURI((req.url || '/').split(/[?#]/)[0])
      // `..` im Pfad zeigte aus dem Ordner heraus — ein Dev-Server ist kein
      // Grund, das Repo über HTTP anzubieten.
      if (pfad.includes('..')) return next()
      const wurzel = join(process.cwd(), 'docs', '_site')

      // OHNE abschließenden Schrägstrich ist die Seite kaputt, nicht nur
      // unschön: Der Browser löst `assets/stil.css` dann gegen das ÜBERGEORDNETE
      // Verzeichnis auf, also gegen die Wurzel des Servers — die Seite kommt an,
      // ihr Blatt nicht. Deshalb erst umleiten, dann ausliefern; dasselbe gilt
      // für jeden Ordner darunter (`/doku/concepts`).
      const original = (req.originalUrl || req.url || '').split(/[?#]/)[0]
      const zeigtAufOrdner =
        pfad === '/' ||
        (!pfad.endsWith('/') &&
          existsSync(join(wurzel, pfad, 'index.html')) &&
          statSync(join(wurzel, pfad)).isDirectory())
      if (zeigtAufOrdner && !original.endsWith('/')) {
        res.writeHead(301, { Location: original + '/' })
        return res.end()
      }

      const rel = pfad.endsWith('/') ? pfad + 'index.html' : pfad
      const datei = join(wurzel, rel)
      if (!existsSync(datei) || !statSync(datei).isFile()) {
        // Ohne gebaute Doku fiele die Anfrage in Vites SPA-Fallback und
        // lieferte die Landing — man klickt auf „Doku" und landet auf der
        // Startseite, ohne zu erfahren, warum.
        if (!existsSync(join(wurzel, 'index.html'))) {
          res.statusCode = 404
          res.setHeader('Content-Type', 'text/html; charset=utf-8')
          return res.end(
            '<!doctype html><meta charset="utf-8"><title>Doku nicht gebaut</title>' +
              '<body style="margin:0;display:grid;place-items:center;min-height:100vh;' +
              'background:#090c11;color:#f2ede3;font:400 16px/1.6 system-ui,sans-serif">' +
              '<div style="max-width:36ch;text-align:center">' +
              '<h1 style="font-size:22px;margin:0 0 10px">Die Doku ist noch nicht gebaut</h1>' +
              '<p style="color:#a7b1bf;margin:0 0 16px">Einmal bauen, dann steht sie unter <code>/doku/</code>:</p>' +
              '<code style="display:block;padding:12px 16px;border-radius:10px;background:#161e2c">npm run docs</code>' +
              '</div></body>',
          )
        }
        // Eine Doku-Seite, die es nicht (mehr) gibt, fiele hier in Vites
        // SPA-Fallback und käme als LANDING zurück — mit Status 200. Wer
        // einem alten Link folgt, stünde also auf der Startseite des
        // Produkts und wüsste nicht, warum. Zwei Antworten sind besser:
        // Wurde die Datei nur verschoben (archiviert, umbenannt), führt der
        // Weg dorthin; sonst sagt eine Seite im Viewer-Ton, was fehlt.
        if (rel.endsWith('.html')) {
          const name = rel.split('/').pop()
          const treffer = readdirSync(wurzel, { recursive: true })
            .map((e) => String(e))
            .filter((e) => e.endsWith('/' + name) || e === name)
          if (treffer.length === 1) {
            res.writeHead(302, { Location: '/doku/' + treffer[0] })
            return res.end()
          }
          res.statusCode = 404
          res.setHeader('Content-Type', 'text/html; charset=utf-8')
          return res.end(
            '<!doctype html><meta charset="utf-8"><title>Nicht gefunden</title>' +
              '<body style="margin:0;display:grid;place-items:center;min-height:100vh;' +
              'background:#090c11;color:#f2ede3;font:400 16px/1.6 system-ui,sans-serif">' +
              '<div style="max-width:40ch;text-align:center">' +
              '<h1 style="font-size:22px;margin:0 0 10px">Diese Seite gibt es hier nicht</h1>' +
              '<p style="color:#a7b1bf;margin:0 0 16px">Vielleicht wurde sie umbenannt oder archiviert.</p>' +
              '<a href="/doku/" style="color:#e8b04b">Zur Übersicht</a>' +
              '</div></body>',
          )
        }
        return next()
      }
      const endung = extname(datei).toLowerCase()
      res.setHeader('Content-Type', TYPEN[endung] || 'application/octet-stream')
      // Ohne diese Zeile ist der Wächter die halbe Miete: Die Seite lädt neu,
      // holt `assets/stil.css` aber aus dem Speicher-Cache des Browsers und
      // zeigt weiter die alte Fassung. Die Doku trägt keine Hashes im
      // Dateinamen, an denen der Browser eine neue Fassung erkennen könnte.
      if (dev) res.setHeader('Cache-Control', 'no-store')

      // Einem geöffneten PROTOTYP gibt der Dev-Server eine kleine Leiste mit
      // (zurück zur Doku, Roadmap, Archivieren). Sie wird beim Ausliefern
      // angehängt und steht NICHT in der Datei: Das Mockup ist eine Vorlage
      // und soll auch im Finder genau das zeigen, was es zeigt.
      const istMockup = /^\/(mockups|archive\/mockups)\//.test(rel) && endung === '.html'
      if (istMockup) {
        const quelle = 'docs' + rel
        const inhalt = readFileSync(datei, 'utf8')
        const leiste = `<script src="/doku/assets/mockupleiste.js" data-datei="${quelle}"></script>`
        return res.end(
          mitDevClient(
            inhalt.includes('</body>')
              ? inhalt.replace('</body>', leiste + '</body>')
              : inhalt + leiste,
            dev,
          ),
        )
      }
      if (endung === '.html') return res.end(mitDevClient(readFileSync(datei, 'utf8'), dev))
      res.end(readFileSync(datei))
    })
  }
  return {
    name: 'maptale-doku',
    apply: 'serve',
    // Vite darf das GEBAUTE Verzeichnis nicht beobachten. Sonst meldet es jede
    // der ~100 Dateien, die ein Doku-Bau schreibt, als geänderte Quelle und
    // schickt eine Lawine eigener Reload-Nachrichten hinterher — in der die
    // eine, auf die es ankommt, untergeht.
    config: () => ({ server: { watch: { ignored: ['**/docs/_site*/**'] } } }),
    configureServer: (server) => {
      middleware(server, true)
      beobachteDoku(server)
    },
    configurePreviewServer: (server) => middleware(server, false),
  }
}

/**
 * Der Wächter über den Quellen der Doku: speichern, hinschauen, fertig.
 *
 * Der Viewer ist eine GEBAUTE Website — `docs/_site/` entsteht aus `docs/*.md`
 * und den Skripten unter `scripts/docs-viewer/`. Wer eine Quelle änderte, sah
 * bis hierher weiter die alte Fassung, bis er von Hand `npm run docs` aufrief.
 * Die Tücke daran ist, dass es sich als INHALTLICHER Fehler tarnt: Ein
 * korrigiertes Skript verhält sich unverändert falsch, weil der Browser die
 * Fassung von vorgestern ausführt.
 *
 * Die Mechanik gab es halb schon — `dienst.mjs` ruft `baueNeu()` nach jeder
 * Schreibaktion des Viewers. Sie greift nur nicht für das, was im Editor
 * passiert. Genau diese Lücke schließt der Wächter.
 *
 * Vier Dinge, die man dabei kippt:
 *
 *   - `docs/_site/` liegt SELBST unter `docs/`. Ohne den Ausschluss löst der
 *     Bau die nächste Runde aus, und die übernächste.
 *   - Gebaut wird, ohne den Server anzuhalten (`baueNeuNebenher`): Der Wächter
 *     läuft im Vite-Prozess, ein synchroner Bau hielte auch den Player an.
 *   - Ein Speichern über mehrere Dateien ist EIN Anlass, nicht acht — 150 ms
 *     Ruhe, und während eines laufenden Baus wird gemerkt statt gestartet.
 *   - Der Browser erfährt davon nur, weil jede Doku-Seite im Dev Vites Client
 *     trägt (s. `mitDevClient`). Ohne ihn baut der Wächter still vor sich hin.
 */
function beobachteDoku(server) {
  if (!server.watcher || !server.ws) return
  const wurzel = process.cwd()
  const quellen = [join(wurzel, 'docs'), join(wurzel, 'scripts', 'docs-viewer')]
  const gebaut = join(wurzel, 'docs', '_site')

  let laeuft = false
  let nochmal = false
  let warteAuf = null

  const bauen = async (anlassUm = 0) => {
    if (laeuft) return void (nochmal = true)
    const dienst = await import('./scripts/docs-viewer/dienst.mjs')
    // Was der Viewer SELBST geschrieben hat (archivieren, umbenennen,
    // speichern), hat er auch schon gebaut, und die Seite ist danach längst
    // umgezogen — ein zweiter Lauf lädt sie bloß noch einmal neu, und zwar
    // auf die Adresse, die es nicht mehr gibt. Die KULANZ hängt daran, dass
    // `anlassUm` die Meldezeit des Dateisystems ist und nicht die
    // Schreibzeit: Sie trifft gelegentlich erst nach dem Bau ein.
    const KULANZ = 400
    if (anlassUm && anlassUm < dienst.letzterEigenerBau() + KULANZ) return
    laeuft = true
    try {
      await dienst.baueNeuNebenher()
      server.ws.send({ type: 'full-reload', path: '*' })
      server.config.logger.info('  \x1b[32m\u279c\x1b[0m  Doku neu gebaut')
    } catch (fehler) {
      // Ein kaputtes Dokument soll den Dev-Server nicht mitnehmen: melden,
      // stehen bleiben, beim nächsten Speichern wieder versuchen.
      server.config.logger.error('  Doku-Bau fehlgeschlagen: ' + (fehler.message || fehler))
    }
    laeuft = false
    if (nochmal) {
      nochmal = false
      bauen()
    }
  }

  const beruehrt = (pfad) => {
    // `gebaut` ist ein Präfix und deckt damit auch die kurzlebigen
    // Nachbarordner des Baus ab (`_site.neu`, `_site.alt`, s. build.mjs).
    if (pfad.startsWith(gebaut)) return
    if (!quellen.some((q) => pfad.startsWith(q))) return
    clearTimeout(warteAuf)
    const anlassUm = Date.now()
    warteAuf = setTimeout(() => bauen(anlassUm), 150)
  }

  server.watcher.add(quellen)
  for (const art of ['add', 'change', 'unlink']) server.watcher.on(art, beruehrt)
}

/**
 * Die geteilten Stylesheets (basis, werkzeug, grundelemente) müssen VOR dem
 * inline-`<style>` der Seite stehen — sonst schlagen sie bei gleicher
 * Spezifität genau das, was die Seite absichtlich anders macht.
 *
 * Im Quelltext stehen die `<link>` an der richtigen Stelle. Vite hängt gebautes
 * CSS aber grundsätzlich ans ENDE des `<head>`, egal wo der Verweis stand — die
 * Verwaltung wurde dadurch 80 px breit (`--wrap: 1080px` verlor gegen die 1160
 * der Basis), ohne dass sich eine Zeile ihres eigenen CSS geändert hätte. Und
 * es fiele erst nach dem Deploy auf, weil der Dev-Server die Verweise stehen
 * lässt.
 *
 * Also: nach der Asset-Injektion die Verweise wieder nach vorn ziehen — in
 * GENAU dieser Reihenfolge, sie ist Teil der Gestaltung: Tokens, dann das
 * Werkzeug-Register, dann die Bausteine (deren `.km-eintrag` bewusst über den
 * Werkzeug-Knopf schreibt, wie vorher in der Seite auch). Nicht stattdessen
 * `@import` in jeden `<style>`-Block — Vite löst den zwar korrekt auf, kopiert
 * die Dateien dann aber in JEDE Seite; der geteilte Browser-Cache über alle
 * Einstiege war der Grund für die eigenen Dateien (s. Kopf von src/base.css).
 */
/**
 * Die geteilten Blätter in der Reihenfolge, in der sie gelten müssen. Sie
 * tragen ihren Namen als Custom Property (`--sheet-base: 1` usw.) — s. unten,
 * warum der DATEINAME nach dem Bauen nichts mehr taugt.
 */
export const GETEILTE_BLAETTER = ['base', 'toolkit', 'page-elements']

export function basisZuerst() {
  return {
    name: 'maptale-basis-zuerst',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        // Verschoben werden ALLE gebauten Stylesheets: Was in einer eigenen
        // Datei liegt, ist Basis; was im <style> der Seite steht, ist deren
        // Abweichung davon — und die gehört nach hinten.
        const verweise = [...html.matchAll(/[ \t]*<link rel="stylesheet"[^>]*>\n?/g)]
          .map((m) => m[0])
          .filter((v) => /href="[^"]*\/assets\//.test(v))
        if (!verweise.length) return html

        // Untereinander zählt die Reihenfolge auch: `.km-eintrag` aus
        // page-elements.css überschreibt bewusst den Werkzeug-Knopf, wie
        // vorher in der Seite auch. Der Dateiname trägt das nicht mehr — Vite
        // benennt eine CSS-Datei nach dem JS-Chunk, in den sie fällt, und
        // page-elements.css heißt im dist `app-nav-<hash>.css`, weil Galerie,
        // Konto und Profil sich dieses Modul teilen. `originalFileNames` ist
        // für CSS-Assets leer. Also erkennt jedes Blatt sich an seiner eigenen
        // Custom Property, die die Minifizierung nicht wegwirft.
        const rang = (verweis) => {
          const pfad = verweis.match(/href="\/?([^"]+)"/)?.[1]
          const quelle = String(ctx.bundle?.[pfad?.replace(/^\//, '')]?.source ?? '')
          const treffer = GETEILTE_BLAETTER.findIndex((b) => quelle.includes(`--sheet-${b}:`))
          return treffer === -1 ? GETEILTE_BLAETTER.length : treffer
        }
        const sortiert = verweise
          .map((v, i) => ({ v, rang: rang(v), i }))
          .sort((a, b) => a.rang - b.rang || a.i - b.i)
          .map((x) => x.v)

        let ohne = html
        for (const v of verweise) ohne = ohne.replace(v, '')
        // Kommentare ausblenden, BEVOR nach dem <style> gesucht wird: Die
        // Erklärung über dem Verweis nennt das Wort selbst, und die Links
        // landeten dadurch IM Kommentar — die Seite kam ganz ohne Stylesheet.
        // Sichtbar war das nur im gebauten Stand, nicht im Dev.
        const ohneKommentare = ohne.replace(/<!--[\s\S]*?-->/g, (k) => ' '.repeat(k.length))
        const stelle = ohneKommentare.search(/[ \t]*<style[\s>]/)
        if (stelle === -1) return html
        return (
          ohne.slice(0, stelle) +
          sortiert.map((v) => `  ${v.trim()}\n`).join('') +
          ohne.slice(stelle)
        )
      },
    },
  }
}

export default defineConfig({
  plugins: [saubereUrls(), dokuAusliefern(), basisZuerst()],
  build: {
    // main.ts lädt Remote-Touren per Top-Level-Await (Boot-Screen überbrückt).
    // Vites Default-Target (u. a. Chrome 87/Safari 14) kann kein TLA — diese
    // Targets (TLA: Chrome 89+/Firefox 89+/Safari 15+) kann die App ohnehin
    // voraussetzen, MapLibre GL verlangt moderne Browser.
    target: ['es2022', 'chrome107', 'edge107', 'firefox104', 'safari16'],
    // Einstiegsseiten kommen aus src/routes.ts — derselben Tabelle, aus der
    // sich Links, Dev-Middleware und der Nginx-Block ableiten. `/` ist die
    // schlanke Landing (kein MapLibre), der Player liegt unter /erlebnis —
    // Alt-Deeplinks `/?tour=…` (und die App-WebView) fängt ein Redirect in
    // index.html ab.
    rollupOptions: { input: ENTRIES },
  },
  server: {
    port: Number(process.env.PORT) || 5173,
    strictPort: true,
    // Maptale-Backend (server/): im Dev denselben Origin sprechen wie in
    // Produktion (Caddy proxyt /api) — kein CORS, keine Backend-URL im Code.
    // MAPTALE_API übersteuert das Ziel (z. B. wenn 8787 anderweitig belegt ist).
    proxy: {
      '/api': process.env.MAPTALE_API || 'http://localhost:8787',
      // `/@henrik` beantwortet seit Etappe 6 die API selbst (Meta-Kopf aus der
      // Datenbank, s. server/src/routes/pages.ts) — im Dev muss das denselben
      // Weg nehmen, sonst liefe der Dev-Server auf einem anderen URL-Raum als
      // Produktion und der Unterschied fiele erst nach dem Deploy auf.
      //
      // Als Regex und nicht als Präfix `/@`: Vite bedient unter genau diesem
      // Präfix seine EIGENEN Adressen (`/@vite/client`, `/@fs/…`). Das Muster
      // verlangt deshalb, was auch ein Handle sein darf (HANDLE_PATTERN) —
      // insbesondere keinen Schrägstrich, den Vites Pfade alle haben.
      //
      // Das Gegenstück in `saubereUrls()` schreibt weiterhin auf profil.html
      // um; es greift nur noch, wenn die API nicht läuft (dann geht der Proxy
      // ins Leere und Vite liefert die statische Seite).
      '^/@[a-z0-9._-]+$': process.env.MAPTALE_API || 'http://localhost:8787',
    },
  },
})
