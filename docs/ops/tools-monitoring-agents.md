# Maptale Werkzeug- & Agenten-Empfehlungen

Diese Übersicht beschreibt spezialisierte Tools, Monitoring-Systeme und automatisierte KI-/CI-Agenten, die maßgeschneidert für den selbstgehosteten Stack von **Maptale** (Node.js/Fastify, SQLite, Nginx, MapLibre WebGL, Android Kotlin) eingesetzt werden können.

---

## 1. Selbstgehostete Infrastruktur-Tools

| Tool | Zweck | Nutzen für Maptale | Status |
| :--- | :--- | :--- | :--- |
| **Umami Analytics** | Datenschutzfreundliche Web-Analyse | DSGVO/TDDDG-konformes Tracking ohne Cookie-Banner; nativ im Maptale-Adminbereich integriert. | 🟢 Aktiv (`analytics.maptale.io`) |
| **Uptime Kuma** | Erreichbarkeits- & SSL-Monitoring | Überwacht `maptale.io`, API und SSL-Zertifikate minütlich; sendet Push-Alerts & stellt öffentliche Statusseite bereit. | 🟡 Empfohlen |
| **Litestream** |cht-Streaming für SQLite | Katastrophenschutz für SQLite: Streamt Datenbank-WAL-Frames in Echtzeit auf Hetzner Storage Box für Point-in-Time-Recovery. | 🟡 Empfohlen |
| **GlitchTip** | Fehler- & Crash-Tracking | Sentry-kompatibles, leichtgewichtiges Error-Tracking für Fastify-Backend, WebGL-Frontend und Android-App. | 🟡 Empfohlen |
| **Dozzle** | Live Docker-Log-Viewer | Farbiges, Echtzeit-Log-Monitoring aller Docker-Container im Browser ohne SSH-Zwang. | 🟡 Empfohlen |
| **ntfy.sh / Gotify** | Push-Benachrichtigungen | Sendet Instant-Push-Alerts bei Server-Fehlern, neuen Registrierungen oder System-Meldungen auf das Smartphone. | 🟡 Empfohlen |

---

## 2. Automatisierte KI- & CI/CD-Agenten

### 🛡️ Privacy & TDDDG Audit Agent (Täglicher Cron)
* **Funktion:** Ein headless Browser-Agent (Playwright / Puppeteer), der jeden Tag `maptale.io`, `/erlebnis` und `/galerie` aufruft.
* **Prüfung:**
  * Prüft, ob Drittanbieter-Cookies oder unbefugte externe Skripte (z. B. Google Fonts CDN, Tracking-Skripte) geladen wurden.
  * Verifiziert Nginx Security Header (`Content-Security-Policy`, `X-Frame-Options`, `Referrer-Policy`).
  * Stellt sicher, dass Maptale zu 100 % cookie-banner-frei und rechtssicher bleibt.

### 🎭 Synthetischer E2E User-Flow Agent (Stündlicher Check)
* **Funktion:** Simuliert kontinuierlich echte Nutzeraktionen auf dem Live-System.
* **Ablauf:**
  1. Öffnet `maptale.io/erlebnis?tour=oberland`.
  2. Wartet auf die Initialisierung des WebGL-Kontexts von MapLibre GL / Three.js.
  3. Simuliert Klick auf den Tour-Play-Button & Audio-Player.
  4. Schlägt Alarm (via Ntfy/Telegram), falls WebGL abstürzt, Asset-404s auftreten oder die Karte blockiert.

### 🔐 Security & Secret Scanner Agent (PR & Commit Gate)
* **Funktion:** Schützt das Quellcode-Repository vor unbeabsichtigtem Hochladen vertraulicher Daten.
* **Tools:** `trufflehog` / `gitleaks` & `npm audit`.
* **Prüfung:** Erkennt API-Keys, Private Keys oder bekannte Sicherheitslücken in Paketabhängigkeiten, bevor sie im `main`-Branch landen.

### 🧹 Speicher- & Medien-Aufräum-Agent (Wöchentlich)
* **Funktion:** Wöchentlicher Wartungs-Job auf dem Server.
* **Aufgaben:**
  * Identifiziert verwaiste Mediendateien im `/uploads`-Ordner (Dateien ohne zugehöriges Konto/Tour).
  * Führt SQLite-Integritätsprüfungen (`PRAGMA integrity_check;`) und Reindizierung durch.
  * Prüft, ob komprimierte Vorschaubilder (`.webp`, `.avif`) korrekt generiert wurden.

---

## 3. Spezialisierte Performance- & Geodaten-Tools

* **MapLibre / MapTiler Latency Monitor:** Misst Latenzen beim Laden von Vektortiles, DEM-Höhendaten und 3D-Building-Geometrien.
* **Core Web Vitals Audit (Lighthouse CLI):** Prüft regelmäßig Largest Contentful Paint (LCP) und Interaction to Next Paint (INP) der Erlebnis-Seite für maximale Flüssigkeit auf Mobilgeräten.
