import { defineConfig } from 'vitest/config'

// Web-Tests (logikhaltige Module: geo.ts, remote.ts, künftig Studio).
// server/ hat sein eigenes Vitest-Projekt — hier bewusst ausgeschlossen.
export default defineConfig({
  test: {
    environment: 'node',
    // .mjs gehört dazu: Der Wächter des Doku-Viewers importiert dessen
    // Generator, und der liegt als ESM-Skript außerhalb von src/ — in
    // TypeScript geschrieben forderte der Test Typdeklarationen für Dateien,
    // die tsc bewusst nicht sieht (TS7016, s. CLAUDE.md).
    include: ['test/**/*.test.{js,mjs,ts}'],
    exclude: ['server/**', 'node_modules/**'],
  },
})
