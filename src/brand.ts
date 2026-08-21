/**
 * Maptale — Brand-Tokens und Logo-Helper fürs Web.
 *
 * Kanonische Quelle (Do/Don’ts, Rationale, volle Palette): /DESIGN.md
 * Dieses Modul hält die oft gebrauchten Hex-Werte und Font-Stacks für Code bereit.
 */

export const BRAND_COLORS = {
  /** Primäres Sonnen-Orange */
  amber: '#F59E0B',
  /** Warmer Verlauf & Zweitakzent */
  coral: '#FF6F52',
  /** Kachel- / Flächengrund */
  bg: '#0A0D14',
  /** Seiten- / Body-Grund */
  bgDark: '#06090E',
  /** Warmes Cremeweiß auf Dunkel */
  text: '#F2EDE3',
  muted: 'rgba(242, 237, 227, 0.64)',
  line: 'rgba(255, 255, 255, 0.08)',
  /** Text auf Amber/Coral-CTAs */
  onCta: '#1a1206',
} as const

export const BRAND_FONTS = {
  /** Titel, Wortmarke, Display, UI — eine Schrift (Fallback: s. base.css) */
  display: "'Outfit', 'Outfit Fallback', system-ui, -apple-system, sans-serif",
  /** Alias von display (historisch getrennt) */
  sans: "'Outfit', 'Outfit Fallback', system-ui, -apple-system, sans-serif",
  /**
   * Optional: Karten-Attribution / Debug.
   * Nicht für Kennzahlen — dort Outfit + `font-variant-numeric: tabular-nums`.
   */
  mono: "'IBM Plex Mono', monospace",
} as const

/** CSS-Snippet für gleichbreite Ziffern in Outfit (Anti-Zucken ohne Mono). */
export const BRAND_TABULAR_NUMS = 'font-variant-numeric: tabular-nums' as const

export interface LogoOptions {
  height?: number // Standard 44px
  showText?: boolean
  textColor?: string
}

/**
 * Das Zeichen „Offener Globus“ im 40er-Raster: Der Umriss reißt genau dort auf, wo die Route
 * ihn kreuzt — die Reise verlässt die Welt. Das Gitter ist eine frontal projizierte, um die
 * Blickachse gekippte Kugel (Meridian als Ellipse, Breitenkreise als Sehnen).
 *
 * Erzeugt von `scripts/gen-logo.mjs`, identisch mit `public/logo-mark.svg` — ein Drift-Wächter
 * in `test/brand.test.ts` vergleicht beide. Änderungen gehören ins Skript, nicht hierher.
 */
const MARKE = `<g fill="none" stroke="${BRAND_COLORS.amber}" stroke-width="1.25" opacity="0.78"
    stroke-linecap="round"><path d="M 33.41 12.85 A 15.2 15.2 0 0 0 4.8 19.81"/><path d="M 6.26 26.49 A 15.2 15.2 0 0 0 35.19 19.45"/></g>
  <g transform="rotate(-17 20 20)" fill="none" stroke="${BRAND_COLORS.amber}"
    stroke-width="0.8" opacity="0.3"><line x1="4.8" y1="20" x2="35.2" y2="20"/><line x1="7.11" y1="11.95" x2="32.89" y2="11.95"/><line x1="7.11" y1="28.05" x2="32.89" y2="28.05"/><ellipse cx="20" cy="20" rx="8.5" ry="15.2"/></g>
  <path d="M 4.4 23.4 C 12.4 13.4, 27.2 26.6, 35.6 15.8"
    fill="none" stroke="url(#maptale-route)" stroke-width="2.5" stroke-linecap="round"/>
  <circle cx="4.4" cy="23.4" r="1.6" fill="${BRAND_COLORS.amber}"/>
  <circle cx="35.6" cy="15.8" r="1.9" fill="${BRAND_COLORS.text}"/>`

/** Der Routen-Verlauf braucht Nutzer-Koordinaten, weil er über zwei Pfade hinweg gleich liegt. */
const verlauf = (
  versatz: number,
) => `<linearGradient id="maptale-route" gradientUnits="userSpaceOnUse"
    x1="${4.4 + versatz}" y1="${23.4 + versatz}" x2="${35.6 + versatz}" y2="${15.8 + versatz}">
    <stop offset="0" stop-color="#F0940A"/><stop offset="1" stop-color="#FF8A5C"/>
  </linearGradient>`

/**
 * Generiert das freigegebene Maptale Logo-SVG (Mark + optional Wortmarke).
 * In der Nav bevorzugt: `/logo-mark.svg` (28px) + Text „Maptale“ — siehe DESIGN.md.
 */
export function getBrandLogoSvg(options: LogoOptions = {}): string {
  const height = options.height ?? 44
  const showText = options.showText ?? true
  const textColor = options.textColor ?? '#FFFFFF'

  const viewBoxWidth = showText ? 152 : 46
  const svgWidth = Math.round(height * (viewBoxWidth / 46))

  const textMarkup = showText
    ? `<text x="53.5" y="30.5" font-family="${BRAND_FONTS.display}" font-weight="700" font-size="23" fill="${textColor}" letter-spacing="-0.01em">Maptale</text>`
    : ''

  // Versatz 3 zentriert das Zeichen in 46×46 — die ausbrechende Route braucht den Rand.
  const versatz = 3

  return `<svg width="${svgWidth}" height="${height}" viewBox="0 0 ${viewBoxWidth} 46" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>${verlauf(versatz)}</defs>
  <g transform="translate(${versatz}, ${versatz})">
    ${MARKE}
  </g>
  ${textMarkup}
</svg>`
}
