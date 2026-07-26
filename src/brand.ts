/**
 * MAPTALE — ZENTRALES BRANDING & DESIGN SYSTEM (Single Source of Truth)
 *
 * Dieses Modul definiert die zentralen Marken-Assets, Farben, Logo-SVGs und
 * Navigations-Helpers für das gesamte Maptale-Ökosystem.
 */

export const BRAND_COLORS = {
  amber: '#F59E0B',      // Primäres Maptale Sonnen-Orange
  coral: '#FF6F52',      // Warmer Verlauf & Akzent
  bg: '#0A0D14',         // Sehr dunkle Kachel-Fläche
  bgDark: '#06090E',     // Tiefes Nachtschwarz für Body & Viewport
  text: '#F2EDE3',       // Warmes Cremeweiß
  muted: 'rgba(242, 237, 227, 0.64)',
  line: 'rgba(255, 255, 255, 0.08)'
} as const;

export const BRAND_FONTS = {
  /** Titel, Wortmarke, Display */
  display: "'Outfit', system-ui, -apple-system, sans-serif",
  /** UI, Fließtext, Navigation, Schaltflächen */
  sans: "'Outfit', system-ui, -apple-system, sans-serif",
  /** Nur Kennzahlen, Attribution, Tabular-Nums — nicht für Labels/Navigation */
  mono: "'IBM Plex Mono', monospace"
} as const;

export interface LogoOptions {
  height?: number; // Standard 44px
  showText?: boolean;
  textColor?: string;
}

/**
 * Generiert das freigegebene Maptale Logo-SVG (Konzept 44: Perfekt Verankert 1)
 */
export function getBrandLogoSvg(options: LogoOptions = {}): string {
  const height = options.height ?? 44;
  const showText = options.showText ?? true;
  const textColor = options.textColor ?? '#FFFFFF';

  // Das 152x46 viewBox SVG skaliert sauber über Höhe (knapp um die Wortmarke)
  const viewBoxWidth = showText ? 152 : 44;
  const svgWidth = Math.round(height * (viewBoxWidth / 46));

  const textMarkup = showText
    ? `<text x="53.5" y="30.5" font-family="${BRAND_FONTS.display}" font-weight="700" font-size="23" fill="${textColor}" letter-spacing="-0.01em">Maptale</text>`
    : '';

  return `<svg width="${svgWidth}" height="${height}" viewBox="0 0 ${viewBoxWidth} 46" fill="none" xmlns="http://www.w3.org/2000/svg">
  <g transform="translate(4, 3)">
    <circle cx="20" cy="20" r="16" fill="none" stroke="${BRAND_COLORS.amber}" stroke-width="2"/>
    <ellipse cx="20" cy="20" rx="8" ry="16" fill="none" stroke="${BRAND_COLORS.amber}" stroke-width="1.2" opacity="0.45"/>
    <path d="M 8 22 C 14 14, 26 26, 32 18" fill="none" stroke="${BRAND_COLORS.coral}" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="8" cy="22" r="2" fill="${BRAND_COLORS.coral}"/>
    <circle cx="32" cy="18" r="2.5" fill="#FFF"/>
  </g>
  ${textMarkup}
</svg>`;
}
