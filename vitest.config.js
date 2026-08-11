import { defineConfig } from 'vitest/config'

// Web-Tests (logikhaltige Module: geo.ts, remote.ts, künftig Studio).
// server/ hat sein eigenes Vitest-Projekt — hier bewusst ausgeschlossen.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.{js,ts}'],
    exclude: ['server/**', 'node_modules/**'],
  },
})
