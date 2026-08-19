#!/usr/bin/env node
/**
 * Erzeugt alle Ableitungen der Maptale-Marke („Offener Globus") aus EINER Geometrie.
 *
 *   node scripts/gen-logo.mjs
 *
 * Geschrieben werden:
 *   public/logo-mark.svg                              Zeichen allein (Nav, 28 px)
 *   public/logo.svg                                   Zeichen + Wortmarke
 *   public/favicon.svg                                Kachel, REDUZIERTE Stufe (16–32 px)
 *   public/branding/kachel-180.svg                    Kachel, volle Stufe (Quelle für apple-touch-icon.png)
 *   android/.../drawable/ic_marke.xml                 In-App-Marke
 *   android/.../drawable/ic_launcher_vordergrund.xml  Adaptive-Icon-Vordergrund
 *
 * Das Zeichen: ein Globus, dessen Umriss genau dort aufreißt, wo die Route ihn kreuzt — die
 * Reise verlässt die Welt. Zwei Dinge sind Absicht und keine Schludrigkeit:
 *
 * 1. ZWEI STUFEN. Das volle Gitter (Äquator + zwei Breitenkreise + Meridian bei 30 %) ist ab
 *    etwa 20 px nur noch Grauschleier. Deshalb hat das Favicon weniger Linien, dafür
 *    kräftigere — Strichstärken skalieren NICHT mit dem Radius, sie werden pro Stufe gesetzt.
 * 2. DER ZIELPUNKT IST KLEIN (r 1,9 auf R 15,2). Vorher war er weiß und r 2,5 — damit der
 *    stärkste Kontrast im ganzen Zeichen, an seinem äußersten Rand. Creme und klein.
 *
 * Die PNGs sind Renderings der SVGs und liegen daneben im Repo; erneuern (Playwright oder ein
 * anderer Renderer, Hauptsache exakte Pixelmaße und transparenter Rand):
 *   favicon-32.png                ← public/favicon.svg              bei 32 × 32
 *   apple-touch-icon.png          ← public/branding/kachel-180.svg  bei 180 × 180
 *   public/branding/mail-logo.png ← public/logo.svg                 bei 456 × 138 (3 ×)
 *
 * Das Mail-Logo MUSS ein PNG sein: Mail-Programme rendern kein SVG, und die HTML-Mails
 * (server/src/maillayout.ts) laden es über die öffentliche Basis-URL. Es ist die einzige
 * Ableitung mit CREMEFARBENER Wortmarke statt Weiß (#F2EDE3 wie der Fließtext daneben) —
 * die Mail ist durchgehend warm-dunkel, ein weißes Wort stäche heraus. Beim Rendern muss die
 * Outfit-Schrift wirklich geladen sein (android/app/src/main/res/font/outfit.ttf reicht),
 * sonst steht dort die Systemschrift und das Logo ist unbrauchbar.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..')

const AMBER = '#F59E0B'
const CREME = '#F2EDE3'
const ROUTE_VON = '#F0940A'
const ROUTE_BIS = '#FF8A5C'
const KACHEL = '#0D1117'

/** Route in Einheiten des Kugelradius, relativ zum Mittelpunkt. */
const ROUTE = {
  start: [-1.0263, 0.2237],
  c1: [-0.5, -0.4342],
  c2: [0.4737, 0.4342],
  ziel: [1.0263, -0.2763],
}

const rad = (g) => (g * Math.PI) / 180
const grad = (r) => (r * 180) / Math.PI
const z = (n) => Number(n.toFixed(2)).toString()
const pkt = (m, [u, v]) => [m.cx + u * m.R, m.cy + v * m.R]
const aufKreis = (m, g) => [m.cx + m.R * Math.cos(rad(g)), m.cy - m.R * Math.sin(rad(g))]
/** Bildwinkel eines Routenendes — dort reißt der Umriss auf. */
const winkelVon = ([u, v]) => (grad(Math.atan2(-v, u)) + 360) % 360

/**
 * Gitter-Geometrie: frontal projizierte Kugel — Meridiane sind Ellipsen, Breitenkreise
 * werden zu Sehnen. Die ganze Gruppe kippt um die Blickachse; das ist exakt die Projektion
 * einer Kugel mit geneigter Achse und braucht nur Kreis-, Ellipsen- und Linienprimitive.
 */
function gitterTeile(m, { breiten, meridiane }) {
  const sehnen = breiten.map((phi) => {
    const y = m.cy - m.R * Math.sin(rad(phi))
    const halb = m.R * Math.cos(rad(phi))
    return { art: 'sehne', y, x1: m.cx - halb, x2: m.cx + halb }
  })
  const ellipsen = meridiane.map((lam) => ({ art: 'meridian', rx: m.R * Math.sin(rad(lam)) }))
  return [...sehnen, ...ellipsen]
}

/** Die zwei Umriss-Bögen: alles außer den Lücken an den Routen-Durchstoßpunkten. */
function umrissBoegen(m, luecke) {
  const a = winkelVon(ROUTE.ziel)
  const b = winkelVon(ROUTE.start)
  return [
    [a + luecke, b - luecke],
    [b + luecke, a + 360 - luecke],
  ]
}

const STUFE_VOLL = {
  luecke: 13,
  umriss: 1.25,
  opUmriss: 0.78,
  gitter: 0.8,
  opGitter: 0.3,
  breiten: [0, 32, -32],
  meridiane: [34],
  route: 2.5,
  rStart: 1.6,
  rZiel: 1.9,
  kippung: -17,
}

/** Weniger Linien, dafür kräftigere — alles unter ~20 px. */
const STUFE_KLEIN = {
  ...STUFE_VOLL,
  luecke: 16,
  umriss: 1.7,
  opUmriss: 1,
  gitter: 1,
  opGitter: 0.42,
  breiten: [0],
  meridiane: [36],
  route: 3,
  rStart: 1.7,
  rZiel: 2,
}

/* ---------------------------------------------------------------- SVG ---- */

function markeSvg(m, s, gradientId) {
  const boegen = umrissBoegen(m, s.luecke).map(([von, bis]) => {
    const [x1, y1] = aufKreis(m, von)
    const [x2, y2] = aufKreis(m, bis)
    const gross = Math.abs(bis - von) > 180 ? 1 : 0
    return `<path d="M ${z(x1)} ${z(y1)} A ${z(m.R)} ${z(m.R)} 0 ${gross} 0 ${z(x2)} ${z(y2)}"/>`
  })

  const gitter = gitterTeile(m, s).map((t) =>
    t.art === 'sehne'
      ? `<line x1="${z(t.x1)}" y1="${z(t.y)}" x2="${z(t.x2)}" y2="${z(t.y)}"/>`
      : `<ellipse cx="${z(m.cx)}" cy="${z(m.cy)}" rx="${z(t.rx)}" ry="${z(m.R)}"/>`,
  )

  const [sx, sy] = pkt(m, ROUTE.start)
  const [c1x, c1y] = pkt(m, ROUTE.c1)
  const [c2x, c2y] = pkt(m, ROUTE.c2)
  const [zx, zy] = pkt(m, ROUTE.ziel)

  return `<g fill="none" stroke="${AMBER}" stroke-width="${s.umriss}" opacity="${s.opUmriss}"
    stroke-linecap="round">${boegen.join('')}</g>
  <g transform="rotate(${s.kippung} ${z(m.cx)} ${z(m.cy)})" fill="none" stroke="${AMBER}"
    stroke-width="${s.gitter}" opacity="${s.opGitter}">${gitter.join('')}</g>
  <path d="M ${z(sx)} ${z(sy)} C ${z(c1x)} ${z(c1y)}, ${z(c2x)} ${z(c2y)}, ${z(zx)} ${z(zy)}"
    fill="none" stroke="url(#${gradientId})" stroke-width="${s.route}" stroke-linecap="round"/>
  <circle cx="${z(sx)}" cy="${z(sy)}" r="${s.rStart}" fill="${AMBER}"/>
  <circle cx="${z(zx)}" cy="${z(zy)}" r="${s.rZiel}" fill="${CREME}"/>`
}

function verlauf(m, id) {
  const [sx, sy] = pkt(m, ROUTE.start)
  const [zx, zy] = pkt(m, ROUTE.ziel)
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse"
    x1="${z(sx)}" y1="${z(sy)}" x2="${z(zx)}" y2="${z(zy)}">
    <stop offset="0" stop-color="${ROUTE_VON}"/><stop offset="1" stop-color="${ROUTE_BIS}"/>
  </linearGradient>`
}

const VOLL = { cx: 20, cy: 20, R: 15.2 }

/** Zeichen allein. viewBox schneidet so, dass die ausbrechende Route Luft behält. */
const logoMark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="2.4 2.4 35.2 35.2" width="46" height="46">
  <defs>${verlauf(VOLL, 'maptale-route')}</defs>
  ${markeSvg(VOLL, STUFE_VOLL, 'maptale-route')}
</svg>
`

const logo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 152 46" width="152" height="46">
  <defs>${verlauf({ ...VOLL, cx: VOLL.cx + 3, cy: VOLL.cy + 3 }, 'maptale-route')}</defs>
  <g transform="translate(3, 3)">
    ${markeSvg(VOLL, STUFE_VOLL, 'maptale-route')}
  </g>
  <text x="53.5" y="30.5" font-family="'Outfit', system-ui, -apple-system, sans-serif" font-weight="700" font-size="23" fill="#FFFFFF" letter-spacing="-0.01em">Maptale</text>
</svg>
`

/** Kachel: Zeichen zentriert, Rand ≈ 14 % — sonst klebt die Route am Eck. */
const kachel = (R, stufe, kantenRadius) => {
  const m = { cx: 20, cy: 20, R }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40">
  <defs>${verlauf(m, 'maptale-route')}</defs>
  <rect width="40" height="40" rx="${kantenRadius}" fill="${KACHEL}"/>
  ${markeSvg(m, stufe, 'maptale-route')}
</svg>
`
}

/* ------------------------------------------------------- Android ---- */

function markeVector(m, s, viewport) {
  const boegen = umrissBoegen(m, s.luecke).map(([von, bis]) => {
    const [x1, y1] = aufKreis(m, von)
    const [x2, y2] = aufKreis(m, bis)
    const gross = Math.abs(bis - von) > 180 ? 1 : 0
    return `    <path
        android:pathData="M${z(x1)},${z(y1)} A${z(m.R)},${z(m.R)} 0 ${gross} 0 ${z(x2)},${z(y2)}"
        android:strokeColor="${AMBER}"
        android:strokeWidth="${s.umriss}"
        android:strokeAlpha="${s.opUmriss}"
        android:strokeLineCap="round"
        android:fillColor="#00000000" />`
  })

  const gitter = gitterTeile(m, s).map((t) => {
    const daten =
      t.art === 'sehne'
        ? `M${z(t.x1)},${z(t.y)} L${z(t.x2)},${z(t.y)}`
        : `M${z(m.cx)},${z(m.cy - m.R)} A${z(t.rx)},${z(m.R)} 0 1 1 ${z(m.cx)},${z(m.cy + m.R)}` +
          ` A${z(t.rx)},${z(m.R)} 0 1 1 ${z(m.cx)},${z(m.cy - m.R)}`
    return `        <path
            android:pathData="${daten}"
            android:strokeColor="${AMBER}"
            android:strokeWidth="${s.gitter}"
            android:strokeAlpha="${s.opGitter}"
            android:fillColor="#00000000" />`
  })

  const [sx, sy] = pkt(m, ROUTE.start)
  const [c1x, c1y] = pkt(m, ROUTE.c1)
  const [c2x, c2y] = pkt(m, ROUTE.c2)
  const [zx, zy] = pkt(m, ROUTE.ziel)

  return `<?xml version="1.0" encoding="utf-8"?>
<!--
  ERZEUGT von scripts/gen-logo.mjs — nicht von Hand pflegen, sonst driftet die Marke
  von public/logo-mark.svg weg. Änderungen dort im Skript machen und neu erzeugen.
-->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:aapt="http://schemas.android.com/aapt"
    android:width="${viewport}dp"
    android:height="${viewport}dp"
    android:viewportWidth="${viewport}"
    android:viewportHeight="${viewport}">

    <!-- Umriss, aufgerissen an den Durchstoßpunkten der Route -->
${boegen.join('\n')}

    <!-- Gitter: gekippte Kugel (Meridian + Breitenkreise) -->
    <group
        android:rotation="${s.kippung}"
        android:pivotX="${z(m.cx)}"
        android:pivotY="${z(m.cy)}">
${gitter.join('\n')}
    </group>

    <!-- Route -->
    <path
        android:pathData="M${z(sx)},${z(sy)} C${z(c1x)},${z(c1y)} ${z(c2x)},${z(c2y)} ${z(zx)},${z(zy)}"
        android:strokeWidth="${s.route}"
        android:strokeLineCap="round"
        android:fillColor="#00000000">
        <aapt:attr name="android:strokeColor">
            <gradient
                android:type="linear"
                android:startX="${z(sx)}"
                android:startY="${z(sy)}"
                android:endX="${z(zx)}"
                android:endY="${z(zy)}">
                <item android:offset="0" android:color="${ROUTE_VON}" />
                <item android:offset="1" android:color="${ROUTE_BIS}" />
            </gradient>
        </aapt:attr>
    </path>

    <!-- Start -->
    <path
        android:pathData="M${z(sx)},${z(sy)} m-${s.rStart},0 a${s.rStart},${s.rStart} 0 1,1 ${s.rStart * 2},0 a${s.rStart},${s.rStart} 0 1,1 -${s.rStart * 2},0"
        android:fillColor="${AMBER}" />

    <!-- Ziel -->
    <path
        android:pathData="M${z(zx)},${z(zy)} m-${s.rZiel},0 a${s.rZiel},${s.rZiel} 0 1,1 ${s.rZiel * 2},0 a${s.rZiel},${s.rZiel} 0 1,1 -${s.rZiel * 2},0"
        android:fillColor="${CREME}" />
</vector>
`
}

/* --------------------------------------------------------- schreiben ---- */

const dateien = [
  ['public/logo-mark.svg', logoMark],
  ['public/logo.svg', logo],
  // Favicon: reduzierte Stufe, weil es bei 16–32 px ausgeliefert wird.
  ['public/favicon.svg', kachel(12.4, STUFE_KLEIN, 9)],
  // 180 px hat Platz für das volle Gitter.
  ['public/branding/kachel-180.svg', kachel(13.2, STUFE_VOLL, 9)],
  ['android/app/src/main/res/drawable/ic_marke.xml', markeVector(VOLL, STUFE_VOLL, 40)],
  [
    'android/app/src/main/res/drawable/ic_launcher_vordergrund.xml',
    // Adaptive Icons beschneiden großzügig: alles Wichtige in die Safe-Zone (∅ 66 von 108).
    markeVector(
      { cx: 54, cy: 54, R: 25.6 },
      { ...STUFE_VOLL, umriss: 2.1, gitter: 1.35, route: 4.2, rStart: 2.7, rZiel: 3.2 },
      108,
    ),
  ],
]

for (const [pfad, inhalt] of dateien) {
  writeFileSync(join(WURZEL, pfad), inhalt)
  console.log('geschrieben:', pfad)
}
