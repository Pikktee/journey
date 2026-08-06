---
version: alpha
name: Maptale
description: >-
  Filmisches, warm-dunkles Design für Relive-artige 3D-Reisen.
  Eine Marke über Landing, Player, Studio, Galerie und Android.
colors:
  primary: "#F59E0B"
  secondary: "#FF6F52"
  amber: "#F59E0B"
  coral: "#FF6F52"
  text: "#F2EDE3"
  on-surface: "#F2EDE3"
  muted: "rgba(242, 237, 227, 0.64)"
  faint: "rgba(242, 237, 227, 0.42)"
  bg: "#0A0D14"
  surface: "#0A0D14"
  bg-deep: "#06090E"
  line: "rgba(255, 255, 255, 0.08)"
  topbar: "rgba(13, 17, 24, 0.82)"
  topbar-border: "#222b37"
  on-cta: "#1a1206"
  # Flächenstufen über dem Grund — Karten, Felder, gehobene Zeilen.
  surface-1: "#10151d"
  surface-2: "#151c26"
  surface-3: "#1c2530"
  border-strong: "#2e3a49"
  # Opake Sekundärtexte. Neben muted/faint, weil das andere Farben sind und
  # nicht andere Namen: muted/faint sind Creme mit Deckkraft (sie nehmen den
  # Grund an), text-2/text-3 sind blaugrau und stehen fest.
  text-2: "#a7b1bf"
  text-3: "#67727f"
  card: "rgba(255, 255, 255, 0.035)"
  # Status. Coral ist Zweitakzent und NIE Fehlerrot (s. Colors).
  success: "#3ecf8e"
  danger: "#e5484d"
  info: "#5b9dff"
  accent-violet: "#c58bff"
  warning: "#e8a13c"
  # Nur im Player: Glasflächen über der Karte und der helle Papierton.
  glass: "rgba(12, 15, 20, 0.55)"
  glass-border: "rgba(255, 255, 255, 0.1)"
  paper: "#f6f1e7"
typography:
  display:
    fontFamily: Outfit
    fontSize: 48px
    fontWeight: 700
    lineHeight: 1.08
    letterSpacing: -0.015em
  title:
    fontFamily: Outfit
    fontSize: 17px
    fontWeight: 700
    lineHeight: 1
    letterSpacing: -0.02em
  body:
    fontFamily: Outfit
    fontSize: 17px
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: Outfit
    fontSize: 13.5px
    fontWeight: 500
    lineHeight: 1.3
  numeric:
    fontFamily: Outfit
    fontSize: 17px
    fontWeight: 500
    lineHeight: 1.2
    fontFeature: "tnum"
rounded:
  sm: 7px
  md: 9px
  lg: 12px
  # Karten und Tafeln. Zwischen lg und xl, weil eine Tourkarte breiter ist als
  # ein Dialog — 12 px wirken daran spitz, 16 px weich. Der Wert war im Code
  # längst der häufigste; er stand nur nirgends geschrieben.
  card: 14px
  xl: 16px
  full: 999px
elevation:
  shadow: "0 14px 34px rgba(2, 5, 10, 0.5), 0 2px 8px rgba(2, 5, 10, 0.35)"
spacing:
  wrap: 1160px
  page-gutter: 22px
  topbar-h: 58px
  brand-gap: 0.45em
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-cta}"
    rounded: "{rounded.full}"
  button-primary-gradient:
    backgroundColor: "linear-gradient(120deg, #F59E0B, #FF6F52)"
    textColor: "{colors.on-cta}"
    rounded: "{rounded.full}"
  nav-pill:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.md}"
    padding: 7px
  brand-mark:
    height: 28px
    textColor: "{colors.text}"
  topbar:
    height: "{spacing.topbar-h}"
    backgroundColor: "{colors.topbar}"
  card:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
  chip:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.muted}"
    rounded: "{rounded.sm}"
  input:
    backgroundColor: "{colors.bg-deep}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
  flash-message:
    backgroundColor: "linear-gradient(165deg, rgba(26, 34, 45, 0.95), rgba(9, 12, 17, 0.96))"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
---

# Design System: Maptale

Kanonische Quelle für Marke und UI. Coding-Assistenten und Menschen lesen **diese Datei**.
Code-Tokens (CSS-Variablen, `src/brand.ts`, Android `Theme.kt` / `Typografie.kt`) müssen dazu passen —
bei Widerspruch gilt `DESIGN.md`.

## Overview

Maptale ist eine filmische Reise-Marke: warmes Dunkel, Satellitenboden, Amber als Sonne.
Keine SaaS-Dashboard-Ästhetik, kein Light Mode. Die gleiche Stimme gilt für Landing, Player,
Studio, Galerie/Profil und die Android-App.

Sprache in UI, Doku und Commits: **Deutsch**. Produktname in der UI: **Maptale** (nie Luhambo).

## Colors

Dunkle Flächen, ein warmer Akzentverlauf, cremefarbenes Textweiß.

- **Amber (`#F59E0B`):** Primärakzent, Fokusringe, aktive Zustände, Verlaufsstart.
- **Coral (`#FF6F52`):** Verlaufsende und warmer Zweitakzent — nie allein als „Fehlerrot“ missbrauchen.
- **Text / Ink (`#F2EDE3`):** Fließtext und Überschriften auf Dunkel.
- **Muted / Faint:** Sekundär- und Tertiärtext (`rgba(242, 237, 227, 0.64)` / `0.42`).
- **BG (`#0A0D14`) / BG-Deep (`#06090E`):** Flächen und Seitengrund.
- **Line:** feine Trenner `rgba(255, 255, 255, 0.08)`; Topbar-Rand oft `#222b37`.
- **On-CTA (`#1a1206`):** Text auf Amber/Coral-Knöpfen.

### Ein Namenssystem: `src/basis.css`

Die Werte oben stehen genau einmal im Code, als CSS-Variablen in
[`src/basis.css`](src/basis.css). Jede Seite bindet sie ein (Einstiegsmodul per `import`,
die Landing und die Rechtstexte per `<link>` bzw. `@import` — sie haben kein Bundle).
**Keine HTML-Datei definiert eigene Farb-Tokens**, und die Werte selbst stehen nirgends
sonst roh im Code. Ein Drift-Wächter ([`test/basis-css.test.ts`](test/basis-css.test.ts))
liest den YAML-Kopf dieser Datei und hält beides nach.

Es gab zwei Namenssysteme für dieselben Farben (`--akzent`/`--text`/`--fl-1` in Studio,
Admin, Galerie und Landing gegen `--amber`/`--ink` in Konto und Profil) — dazu ein drittes
im Player, wo `--ink` nicht der Text, sondern der HINTERGRUND war. Es gilt das erste:

| YAML | CSS-Variable | | YAML | CSS-Variable |
|---|---|---|---|---|
| `primary` / `amber` | `--akzent` | | `surface-1…3` | `--fl-1` … `--fl-3` |
| `secondary` / `coral` | `--akzent-2` | | `border-strong` | `--rand-hell` |
| `text` | `--text` | | `text-2` / `text-3` | `--text-2` / `--text-3` |
| `muted` | `--text-gedaempft` | | `card` | `--tafel` |
| `faint` | `--text-zart` | | `success` / `danger` | `--gruen` / `--rot` |
| `bg` | `--bg` | | `info` / `accent-violet` | `--blau` / `--lila` |
| `bg-deep` | `--bg-tief` | | `warning` | `--warn` |
| `line` | `--linie` | | `glass` / `glass-border` | `--glas` / `--glas-rand` |
| `topbar` | `--topbar-bg` | | `paper` | `--papier` |
| `topbar-border` | `--rand` | | `rounded.*` | `--radius-sm` … `--radius-full` |
| `on-cta` | `--auf-akzent` | | `elevation.shadow` | `--schatten` |

`--rand` ist eine FARBE (die opake Trennlinie). Wer einen Seitenabstand meint, nimmt
`--seitenrand` — die Landing hatte beides unter demselben Namen.

## Typography

**Eine UI-Schrift: Outfit** (400–700) für Display, Fließtext, Navigation, Labels und Wortmarke.

**Zahlen ausrichten:** OpenType **Tabular Figures** — nicht Mono.

| Plattform | Mittel |
|-----------|--------|
| Web | `font-variant-numeric: tabular-nums` (oder `font-feature-settings: "tnum"`) |
| Android / Compose | `fontFeatureSettings = "tnum"` am `TextStyle` |

**IBM Plex Mono** ist optional und eng begrenzt: Karten-Attribution, Debug — nicht für km, Zeiten,
Mail, Nav oder Kennzahlen. Anti-Zucken bei live tickenden Werten löst `tnum` in Outfit.

Verboten als Markenschrift: Fraunces, Inter, generische System-Stacks als „Design“,
Versalien-Eyebrow-Tracking.

## Layout

- Content-Breite: `--wrap: 1160px` (Landing, Galerie, Studio-Bibliothek); seitlicher Gutter ≈ 22px.
- Studio-**Editor** bleibt full-bleed.
- App-Topbar ≈ 58px, `rgba(13, 17, 24, 0.82)`, Blur, Rand `#222b37`.
- App-Nav in drei Zonen: **Logo | zentriert Meine Touren / Entdecken | rechts Aktionen**.
- Wortmarke: `logo-mark.svg` (28px) + Text „Maptale“, `inline-flex`, `align-items: center`,
  `gap: 0.45em`, Logo `translate: 0 1px`. Der Brand-**Link** ist direktes Grid-/Flex-Kind —
  kein Block-Wrapper (sonst bläht die Zeilenhöhe und die Marke sitzt zu hoch).
- Auf Studio-Hauptscreen nur „Maptale“, kein „Studio“ in der Wortmarke.

## Elevation & Depth

Hierarchie über Tonwerte und feine Ränder, nicht über schwere Schattenstapel.
Primär-CTAs dürfen einen warmen Amber-Glow tragen. Player: dezentes Grain + Vignette
(Kino), ohne Klicks zu fangen. Karten-Attribution muss sichtbar bleiben (Esri/Maxar, Terrain, …).

## Shapes

- CTAs: Pill (`border-radius: 999px` → `--radius-full`).
- Nav-Pills / kleine Chips / Knöpfe und Felder im Werkzeug: 9px → `--radius-md`.
- Menüs und Dialogfelder: 12px → `--radius-lg`. Karten und Tafeln: 14px →
  `--radius-karte`. Dialoge: 16px → `--radius-xl`.
- Fokus: 2px Amber-Outline mit Offset.

**Fünf Stufen, sonst keine.** Der Bestand trug 8, 10, 13 und 15 daneben — pro
Seite eine eigene Antwort auf dieselbe Frage. Wer einen sechsten Wert braucht,
ändert die Skala hier, nicht die eine Regel. Ausgenommen sind Detailmaße, die
keine Marken-Rolle haben: Scrollbalken, Wellenform-Ecken, Fortschrittsbalken,
Avatare (`50%`).

## Components

- **Primary button:** Gradient Amber → Coral, Text `#1a1206`. Hover-Hintergrund in der
  `:hover`-Regel **wiederholen** — globale `button:hover` schlägt sonst die Markenfläche.
- **Ghost / secondary:** Outline auf Glas/Dunkel, Text creme.
- **Tour cards:** erlaubt — sie sind die Interaktion (Abspielen/Öffnen). Titelbild + optional
  Routen-Signatur.
- **Profil-Chip:** Pill mit Initialen-Punkt im Amber→Coral-Verlauf.
- **Flash Messages (Statusmeldungen):** Erfolgs-, Fehler- und Laufmeldungen erscheinen als
  schwebende dunkle Kapsel mittig unter der Kopfleiste — nie als Textzeile im Header.
  Fläche `linear-gradient(165deg, rgba(26,34,45,.95), rgba(9,12,17,.96))` mit Rand `line`,
  Radius `lg`, weichem Schatten und Backdrop-Blur; Text Outfit, ein konkreter Satz.
  Drei Arten: **Erfolg** (Haken in Grün, blendet nach ~4 s aus), **Fehler** (× in Rot, ~7 s),
  **laufend** („wird gespeichert …", Amber-Kreisel, bleibt bis zur Ablösung). Eine Meldung
  zur Zeit — eine neue ersetzt die alte mit kurzem Puls, kein Stapel. Ausnahme modale
  Dialoge: der Browser-Top-Layer liegt über allem, dort meldet eine Fußzeile IM Dialog
  (s. Bibliothek im Studio), kein Toast dahinter. Referenz: `.editor-flash` in `studio.html`.
- **Assets:** Favicon, Apple-Touch und Logo unter `public/` / `public/branding/` — nicht neu erfinden.

## Das Zeichen: Offener Globus

Ein Globus, dessen Umriss **genau dort aufreißt, wo die Route ihn kreuzt** — die Reise verlässt
die Welt. Das Gitter (Äquator, zwei Breitenkreise, ein Meridian) ist eine frontal projizierte,
um die Blickachse gekippte Kugel: Meridiane werden zu Ellipsen, Breitenkreise zu Sehnen.

Alle Ableitungen entstehen aus **einer** Geometrie in [`scripts/gen-logo.mjs`](scripts/gen-logo.mjs)
(`node scripts/gen-logo.mjs`) — `logo-mark.svg`, `logo.svg`, `favicon.svg`, `branding/kachel-180.svg`
und die beiden Android-Vektoren. Von Hand gepflegt wird nur das Skript. Der String in
[`src/brand.ts`](src/brand.ts) ist die einzige Kopie; ein Drift-Wächter in `test/brand.test.ts`
hält ihn deckungsgleich mit `logo-mark.svg`.

Drei Regeln, die das Zeichen tragen — sie waren vorher verletzt und sind der Grund für den Umbau:

- **Der Umriss ist Rahmen, nicht Hauptsache.** 1,25 px bei 78 % Deckkraft auf Radius 15,2; die
  Route ist mit 2,5 px die lauteste Linie. Vorher waren beide gleich stark, das Zeichen wirkte fett.
- **Ein Globus braucht ein Netz, keinen Einzelstrich.** Vier Gitterlinien bei 30 % lesen als
  Kugel; eine einzelne Ellipse bei 45 % liest als Zufallsstrich.
- **Zwei Stufen, nicht eine.** Ab etwa 20 px wird das volle Gitter Grauschleier. `favicon.svg`
  ist deshalb die reduzierte Fassung: weniger Linien, dafür kräftigere. Strichstärken skalieren
  **nicht** mit dem Radius, sie werden pro Stufe gesetzt.

Der Zielpunkt am Routenende ist Creme (`#F2EDE3`) und klein (r 1,9). Weiß und r 2,5 machten ihn
zum stärksten Kontrast im Zeichen — am äußersten Rand, wo er den Blick aus der Mitte zog.

Auf hellem Grund (Presse, Fremd-Einbettung) gilt die **Kachel** (`apple-touch-icon.png` /
`branding/kachel-180.svg`), nicht das nackte Zeichen: dessen Cremepunkt verschwindet dort.

## Do's and Don'ts

**Do**

- Outfit überall in der Produkt-UI; Zahlen mit `tabular-nums` / `tnum`.
- Brand im ersten Viewport hero-stark; eine Headline, ein kurzer Satz, CTAs, ein dominant visual.
- `prefers-reduced-motion` respektieren; Motion für Präsenz, nicht für Lärm.
- Android dieselben Farben (`Sonne`/`Koralle`/`Tinte`/`Nacht`) und Outfit + `tnum`.

**Don't**

- Keine Dachzeilen / Eyebrows über Headlines.
- Keine Cards, Stat-Leisten, Chip-Cluster oder Promo-Badges **im Hero**.
- Kein Light Mode, kein lila SaaS-Glow, kein Mono „weil Zahlen“.
- Keine neue Display-Serif oder Inter als Markenersatz.
- Headline darf die Wortmarke nicht erschlagen.
