// ESLint für beide TypeScript-Welten (src/ und server/src/) aus einer Config.
// Der Typecheck (tsc --noEmit) bleibt das schärfste Gate; ESLint findet, was
// tsc nicht sieht: schwebende Promises, unsichere any-Ketten, tote Bedingungen.
//
// Regel-Politik (konzept_codebase_english_refactoring.md, Werkzeug-Vorstufe):
// Was der Bestand sauber besteht, steht auf `error`. Was heute Befunde hätte,
// steht unten in der AUS-LISTE mit Zählstand vom 2026-08-19 und wird
// angeschaltet, sobald sein Zählstand 0 ist; die Refactoring-Wellen räumen
// ihre Dateien dabei mit ab. Nicht auf `warn` stellen: Warnungen, die die CI
// nicht brechen, liest niemand.
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'dist/',
      'server/dist/',
      'docs/_site/',
      'docs/_site.bau.*/',
      'public/',
      'android/',
      'coverage/',
      'server/coverage/',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.browser, ...globals.node },
    },
  },

  // Skripte, Configs und .mjs-Tests liegen außerhalb der beiden
  // tsconfig-Welten (eigener Lauf unter Node bzw. Vites Config-Loader):
  // keine typbasierten Regeln.
  {
    files: ['scripts/**/*', '**/*.mjs', '**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  {
    rules: {
      // AUS-LISTE, Zählstand vom 2026-08-19. Die unsafe-Familie (7209 von
      // 7553 Befunden) sitzt fast vollständig in Server-Routen und -Tests:
      // Fastify-Bodies und Test-JSON sind heute `any` und werden erst mit den
      // typisierten API-Verträgen der Wellen 1 und 2 sauber. Vorher wäre jede
      // Abschaltung ein Feld voller eslint-disable-Kommentare.
      '@typescript-eslint/no-unsafe-member-access': 'off', // 3497
      '@typescript-eslint/no-unsafe-call': 'off', // 2478
      '@typescript-eslint/no-unsafe-assignment': 'off', // 803
      '@typescript-eslint/no-unsafe-return': 'off', // 247
      '@typescript-eslint/no-unsafe-argument': 'off', // 184
      '@typescript-eslint/require-await': 'off', // 124
      '@typescript-eslint/no-unnecessary-type-assertion': 'off', // 75, autofixbar
      '@typescript-eslint/no-unused-vars': 'off', // 37
      '@typescript-eslint/no-misused-promises': 'off', // 36
      '@typescript-eslint/no-explicit-any': 'off', // 21
      'no-useless-assignment': 'off', // 9
      '@typescript-eslint/no-base-to-string': 'off', // 9
      'no-redeclare': 'off', // 6
      'no-empty': 'off', // 5
      '@typescript-eslint/no-floating-promises': 'off', // 5
      'prefer-const': 'off', // 4, autofixbar
      '@typescript-eslint/no-unused-expressions': 'off', // 3
      '@typescript-eslint/no-redundant-type-constituents': 'off', // 2
      'no-useless-escape': 'off', // 1
      'no-control-regex': 'off', // 1
      '@typescript-eslint/restrict-template-expressions': 'off', // 1
      '@typescript-eslint/unbound-method': 'off', // 1
      'no-irregular-whitespace': 'off', // 1
      '@typescript-eslint/ban-ts-comment': 'off', // 1
      '@typescript-eslint/no-non-null-asserted-optional-chain': 'off', // 1
    },
  },
)
