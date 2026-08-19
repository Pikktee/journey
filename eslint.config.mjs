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
      // Agenten-Worktrees liegen innerhalb des Repos; sonst prüft ESLint einen
      // alten Stand ein zweites Mal (dasselbe steht in .prettierignore).
      '.claude/worktrees/',
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
    rules: {
      // Messskripte greifen bewusst lose in window.__j und Playwright-Seiten:
      // `any` ist dort Werkzeug, kein Versehen (21 Stellen, alle in
      // scripts/messungen). In src/ und server/src steht die Regel scharf.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  {
    rules: {
      // AUS-LISTE, Zählstand vom 2026-08-19 (gemessen mit installierten
      // node_modules beider Welten, 502 Befunde gesamt). Achtung: Ohne
      // server/node_modules sind alle Fastify-Typen `any` und die
      // unsafe-Familie meldet Tausende Phantom-Befunde. Die echten
      // unsafe-Treffer verschwinden größtenteils mit den typisierten
      // API-Verträgen der Wellen 1 und 2.
      '@typescript-eslint/no-unnecessary-type-assertion': 'off', // 236, autofixbar
      '@typescript-eslint/require-await': 'off', // 72
      '@typescript-eslint/no-misused-promises': 'off', // 36
      '@typescript-eslint/no-unsafe-assignment': 'off', // 32
      '@typescript-eslint/no-unsafe-member-access': 'off', // 30
      '@typescript-eslint/no-unused-vars': 'off', // 27
      '@typescript-eslint/no-unsafe-call': 'off', // 14
      'no-useless-assignment': 'off', // 9
      '@typescript-eslint/no-base-to-string': 'off', // 9
      '@typescript-eslint/no-unsafe-argument': 'off', // 7
      'no-redeclare': 'off', // 6
      'no-empty': 'off', // 5
      'prefer-const': 'off', // 5, autofixbar
      '@typescript-eslint/no-floating-promises': 'off', // 5
      'no-useless-escape': 'off', // 1
      'no-control-regex': 'off', // 1
      '@typescript-eslint/restrict-template-expressions': 'off', // 1
      '@typescript-eslint/unbound-method': 'off', // 1
      '@typescript-eslint/no-unused-expressions': 'off', // 1
      'no-irregular-whitespace': 'off', // 1
      '@typescript-eslint/ban-ts-comment': 'off', // 1
      '@typescript-eslint/no-unsafe-return': 'off', // 1
      '@typescript-eslint/no-non-null-asserted-optional-chain': 'off', // 1
    },
  },
)
