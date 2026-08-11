import { defineConfig } from 'vite'

import { HANDLE_REGELN } from './src/handle.ts'
import { EINSTIEGE, PFAD_ZU_DATEI, ROUTEN, tourAusPfad } from './src/routen.ts'

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
    // Geprüft wird gegen HANDLE_REGELN und nicht bloß auf `/@`: Vite bedient
    // unter genau diesem Präfix seine eigenen Adressen (`/@vite/client`,
    // `/@fs/…`, `/@react-refresh`). Ein pauschales Umschreiben lieferte dem
    // Dev-Server statt seines Clients eine HTML-Seite — und zwar nur im Dev,
    // wo es keine Entsprechung in Produktion gibt.
    // `/tour/<kennung>` ist der zweite parametrisierte Namensraum (s.
    // src/routen.ts); in Nginx ist das `location ^~ /tour/`. Anders als beim
    // Handle braucht es hier keine Zeichenprüfung — unter `/tour/` bedient
    // Vite nichts Eigenes.
    const handle = pfad.startsWith('/@') ? pfad.slice(2) : null
    const datei =
      pfad === '/'
        ? null
        : handle && HANDLE_REGELN.test(handle)
          ? ROUTEN.profil.datei
          : tourAusPfad(pfad)
            ? ROUTEN.player.datei
            : PFAD_ZU_DATEI[pfad]
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
 * Einstiege war der Grund für die eigenen Dateien (s. Kopf von src/basis.css).
 */
/**
 * Die geteilten Blätter in der Reihenfolge, in der sie gelten müssen. Sie
 * tragen ihren Namen als Custom Property (`--blatt-basis: 1` usw.) — s. unten,
 * warum der DATEINAME nach dem Bauen nichts mehr taugt.
 */
export const GETEILTE_BLAETTER = ['basis', 'werkzeug', 'grundelemente']

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
        // grundelemente.css überschreibt bewusst den Werkzeug-Knopf, wie
        // vorher in der Seite auch. Der Dateiname trägt das nicht mehr — Vite
        // benennt eine CSS-Datei nach dem JS-Chunk, in den sie fällt, und
        // grundelemente.css heißt im dist `app-nav-<hash>.css`, weil Galerie,
        // Konto und Profil sich dieses Modul teilen. `originalFileNames` ist
        // für CSS-Assets leer. Also erkennt jedes Blatt sich an seiner eigenen
        // Custom Property, die die Minifizierung nicht wegwirft.
        const rang = (verweis) => {
          const pfad = verweis.match(/href="\/?([^"]+)"/)?.[1]
          const quelle = String(ctx.bundle?.[pfad?.replace(/^\//, '')]?.source ?? '')
          const treffer = GETEILTE_BLAETTER.findIndex((b) => quelle.includes(`--blatt-${b}:`))
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
          ohne.slice(0, stelle) + sortiert.map((v) => `  ${v.trim()}\n`).join('') + ohne.slice(stelle)
        )
      },
    },
  }
}

export default defineConfig({
  plugins: [saubereUrls(), basisZuerst()],
  build: {
    // main.ts lädt Remote-Touren per Top-Level-Await (Boot-Screen überbrückt).
    // Vites Default-Target (u. a. Chrome 87/Safari 14) kann kein TLA — diese
    // Targets (TLA: Chrome 89+/Firefox 89+/Safari 15+) kann die App ohnehin
    // voraussetzen, MapLibre GL verlangt moderne Browser.
    target: ['es2022', 'chrome107', 'edge107', 'firefox104', 'safari16'],
    // Einstiegsseiten kommen aus src/routen.ts — derselben Tabelle, aus der
    // sich Links, Dev-Middleware und der Nginx-Block ableiten. `/` ist die
    // schlanke Landing (kein MapLibre), der Player liegt unter /erlebnis —
    // Alt-Deeplinks `/?tour=…` (und die App-WebView) fängt ein Redirect in
    // index.html ab.
    rollupOptions: { input: EINSTIEGE },
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
      // Datenbank, s. server/src/routes/seiten.ts) — im Dev muss das denselben
      // Weg nehmen, sonst liefe der Dev-Server auf einem anderen URL-Raum als
      // Produktion und der Unterschied fiele erst nach dem Deploy auf.
      //
      // Als Regex und nicht als Präfix `/@`: Vite bedient unter genau diesem
      // Präfix seine EIGENEN Adressen (`/@vite/client`, `/@fs/…`). Das Muster
      // verlangt deshalb, was auch ein Handle sein darf (HANDLE_REGELN) —
      // insbesondere keinen Schrägstrich, den Vites Pfade alle haben.
      //
      // Das Gegenstück in `saubereUrls()` schreibt weiterhin auf profil.html
      // um; es greift nur noch, wenn die API nicht läuft (dann geht der Proxy
      // ins Leere und Vite liefert die statische Seite).
      '^/@[a-z0-9._-]+$': process.env.MAPTALE_API || 'http://localhost:8787',
    },
  },
})
