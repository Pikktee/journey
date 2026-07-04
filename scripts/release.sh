#!/usr/bin/env bash
# ————————————————————————————————————————————
#  Luhambo — Release-Tool
#
#  Hebt die Version an, erzeugt einen Git-Tag (vX.Y.Z) und pusht ihn.
#  Der Tag-Push löst den Deploy-Workflow (.github/workflows/deploy.yml)
#  aus, der auf Railway deployt.
#
#  Nutzung:
#    npm run release              # interaktiv fragen
#    npm run release bugfix       # Patch  (0.1.0 → 0.1.1)
#    npm run release minor        # Minor  (0.1.0 → 0.2.0)
#    npm run release major        # Major  (0.1.0 → 1.0.0)
# ————————————————————————————————————————————
set -euo pipefail

cd "$(dirname "$0")/.."

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BOLD=$'\033[1m'; DIM=$'\033[2m'; OFF=$'\033[0m'
die() { echo "${RED}✗ $*${OFF}" >&2; exit 1; }

# — Argument in npm-version-Level übersetzen —
level="${1:-}"
case "$level" in
  bugfix|patch|fix) level="patch" ;;
  minor)            level="minor" ;;
  major)            level="major" ;;
  "")               level="" ;;  # → interaktiv
  *) die "Unbekannter Release-Typ: '$level' (erlaubt: bugfix|minor|major)" ;;
esac

current="$(node -p "require('./package.json').version")"

# — Interaktive Auswahl, wenn kein Argument —
if [ -z "$level" ]; then
  echo "${BOLD}Luhambo Release${OFF}  ${DIM}(aktuell v$current)${OFF}"
  echo "  1) bugfix  — Patch"
  echo "  2) minor   — neue Features"
  echo "  3) major   — Breaking Changes"
  printf "Auswahl [1-3]: "
  read -r choice
  case "$choice" in
    1) level="patch" ;;
    2) level="minor" ;;
    3) level="major" ;;
    *) die "Abgebrochen." ;;
  esac
fi

# — Vorbedingungen —
[ -z "$(git status --porcelain)" ] || die "Arbeitsverzeichnis ist nicht sauber — bitte erst committen/stashen."

branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$branch" != "main" ]; then
  echo "${YELLOW}⚠ Du bist auf '$branch', nicht 'main'.${OFF}"
  printf "Trotzdem releasen? [y/N] "
  read -r ok
  [ "$ok" = "y" ] || [ "$ok" = "Y" ] || die "Abgebrochen."
fi

# Sicherstellen, dass lokal aktuell ist (Tag-Kollisionen / Rückstand vermeiden)
git fetch --quiet --tags origin || die "git fetch fehlgeschlagen."
if git rev-parse --verify --quiet "origin/$branch" >/dev/null; then
  behind="$(git rev-list --count "HEAD..origin/$branch")"
  [ "$behind" = "0" ] || die "Lokaler Branch ist $behind Commit(s) hinter origin/$branch — bitte erst 'git pull'."
fi

# — Vorschau —
next="$(node -e "const s='$current'.split('.').map(Number);const l='$level';if(l==='major'){s[0]++;s[1]=0;s[2]=0}else if(l==='minor'){s[1]++;s[2]=0}else{s[2]++};console.log(s.join('.'))")"
echo
echo "  ${DIM}v$current${OFF}  →  ${BOLD}${GREEN}v$next${OFF}  ${DIM}($level)${OFF}"
printf "Release erstellen und pushen? [y/N] "
read -r go
[ "$go" = "y" ] || [ "$go" = "Y" ] || die "Abgebrochen."

# — Version anheben (commit + Tag vX.Y.Z), dann pushen —
npm version "$level" -m "release: v%s" >/dev/null
tag="v$next"
git push --follow-tags origin "$branch"

echo
echo "${GREEN}✓ $tag gepusht.${OFF} Der Deploy-Workflow läuft jetzt auf GitHub Actions."
echo "${DIM}  → https://github.com/Pikktee/journey/actions${OFF}"
