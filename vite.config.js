import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    // main.js lädt Remote-Touren per Top-Level-Await (Boot-Screen überbrückt).
    // Vites Default-Target (u. a. Chrome 87/Safari 14) kann kein TLA — diese
    // Targets (TLA: Chrome 89+/Firefox 89+/Safari 15+) kann die App ohnehin
    // voraussetzen, MapLibre GL verlangt moderne Browser.
    target: ['es2022', 'chrome107', 'edge107', 'firefox104', 'safari16'],
    // Einstiegsseiten: Player (index.html), Studio (studio.html) und die
    // statischen Rechtstexte (M9), damit sie im dist/-Build landen.
    rollupOptions: {
      input: {
        main: 'index.html',
        studio: 'studio.html',
        impressum: 'impressum.html',
        datenschutz: 'datenschutz.html',
      },
    },
  },
  server: {
    port: Number(process.env.PORT) || 5173,
    strictPort: true,
    // Luhambo-Backend (server/): im Dev denselben Origin sprechen wie in
    // Produktion (Caddy proxyt /api) — kein CORS, keine Backend-URL im Code.
    // LUHAMBO_API übersteuert das Ziel (z. B. wenn 8787 anderweitig belegt ist).
    proxy: {
      '/api': process.env.LUHAMBO_API || 'http://localhost:8787',
    },
  },
})
