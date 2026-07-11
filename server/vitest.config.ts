import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // index.ts ist reiner Zusammenbau echter Abhängigkeiten (Netz, FS, Port)
      exclude: ['src/index.ts'],
      thresholds: { lines: 80, functions: 80 },
    },
  },
})
