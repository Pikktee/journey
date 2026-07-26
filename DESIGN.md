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
  xl: 16px
  full: 999px
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

CSS-Aliase: Landing/Galerie nutzen `--amber` / `--coral`; Studio historisch auch `--akzent` /
`--akzent-2` (gleiche Hex-Werte). Neue UI bevorzugt `--amber` / `--coral`.

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

- CTAs: Pill (`border-radius: 999px`).
- Nav-Pills / kleine Chips: ≈ 9px.
- Karten, Dialoge, Menüs: ≈ 12–16px.
- Fokus: 2px Amber-Outline mit Offset.

## Components

- **Primary button:** Gradient Amber → Coral, Text `#1a1206`. Hover-Hintergrund in der
  `:hover`-Regel **wiederholen** — globale `button:hover` schlägt sonst die Markenfläche.
- **Ghost / secondary:** Outline auf Glas/Dunkel, Text creme.
- **Tour cards:** erlaubt — sie sind die Interaktion (Abspielen/Öffnen). Titelbild + optional
  Routen-Signatur.
- **Profil-Chip:** Pill mit Initialen-Punkt im Amber→Coral-Verlauf.
- **Assets:** Favicon, Apple-Touch und Logo unter `public/` / `public/branding/` — nicht neu erfinden.

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
