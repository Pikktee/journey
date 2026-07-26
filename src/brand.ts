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
} as const;

export const BRAND_FONTS = {
  /** Titel, Wortmarke, Display, UI — eine Schrift */
  display: "'Outfit', system-ui, -apple-system, sans-serif",
  /** Alias von display (historisch getrennt) */
  sans: "'Outfit', system-ui, -apple-system, sans-serif",
  /**
   * Optional: Karten-Attribution / Debug.
   * Nicht für Kennzahlen — dort Outfit + `font-variant-numeric: tabular-nums`.
   */
  mono: "'IBM Plex Mono', monospace",
} as const;

/** CSS-Snippet für gleichbreite Ziffern in Outfit (Anti-Zucken ohne Mono). */
export const BRAND_TABULAR_NUMS = 'font-variant-numeric: tabular-nums' as const;

export interface LogoOptions {
  height?: number; // Standard 44px
  showText?: boolean;
  textColor?: string;
}

/**
 * Generiert das freigegebene Maptale Logo-SVG (Mark + optional Wortmarke).
 * In der Nav bevorzugt: `/logo-mark.svg` (28px) + Text „Maptale“ — siehe DESIGN.md.
 */
export function getBrandLogoSvg(options: LogoOptions = {}): string {
  const height = options.height ?? 44;
  const showText = options.showText ?? true;
  const textColor = options.textColor ?? '#FFFFFF';

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
