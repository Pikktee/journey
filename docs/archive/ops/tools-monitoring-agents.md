# Maptale Werkzeug- & Agenten-Empfehlungen

Archiviert aus: ops

Diese Übersicht beschreibt spezialisierte Tools, Monitoring-Systeme und automatisierte KI-/CI-Agenten, die maßgeschneidert für den selbstgehosteten Stack von **Maptale** (Node.js/Fastify, SQLite, Nginx, MapLibre WebGL, Android Kotlin) eingesetzt werden können.

---

## 1. Selbstgehostete Infrastruktur-Tools

| Tool | Zweck | Nutzen für Maptale | Status |
| :--- | :--- | :--- | :--- |
| **Umami Analytics** | Datenschutzfreundliche Web-Analyse | DSGVO/TDDDG-konformes Tracking ohne Cookie-Banner; nativ im Maptale-Adminbereich integriert. | 🟢 Aktiv (`analytics.maptale.io`) |
| **Uptime Kuma** | Erreichbarkeits- & SSL-Monitoring | Überwacht `maptale.io`, API und SSL-Zertifikate minütlich; sendet Push-Alerts & stellt öffentliche Statusseite bereit (`status.maptale.io`). | 🟡 Empfohlen |
| **Litestream** | Echtzeit-Streaming für SQLite | Katastrophenschutz für SQLite: Streamt Datenbank-WAL-Frames in Echtzeit auf Hetzner Storage Box für Point-in-Time-Recovery. | 🟡 Empfohlen |
| **GlitchTip** | Fehler- & Crash-Tracking | Sentry-kompatibles, leichtgewichtiges Error-Tracking für Fastify-Backend, WebGL-Frontend und Android-App. | 🟡 Empfohlen |
| **Dozzle** | Live Docker-Log-Viewer | Farbiges, Echtzeit-Log-Monitoring aller Docker-Container im Browser ohne SSH-Zwang. | 🟡 Empfohlen |
| **ntfy.sh / Gotify** | Push-Benachrichtigungen | Sendet Instant-Push-Alerts bei Server-Fehlern, neuen Registrierungen oder System-Meldungen auf das Smartphone. | 🟡 Empfohlen |

---

## 2. Medien & Performance

### 🖼️ Imgproxy — Dynamische Bildoptimierung
* **Funktion:** On-the-fly-Konvertierung und Skalierung von Tourfotos. Statt 5 MB JPEGs an Mobilgeräte auszuliefern, generiert Imgproxy per URL-Parameter automatisch WebP/AVIF-Thumbnails in der exakt richtigen Auflösung.
* **Nutzen:** Enorme Verbesserung der Ladezeiten auf der Erlebnis-Seite und in der Galerie, besonders auf mobilen Daten.
* **Setup:** Ein Docker-Container, kein Code-Umbau nötig — nur die Bild-URLs anpassen.

### 📊 GoAccess — Echtzeit-Nginx-Log-Analyse
* **Funktion:** Parst Nginx-Access-Logs und zeigt ein Live-Dashboard als Terminal-UI oder statische HTML-Seite.
* **Nutzen:** Zeigt auf einen Blick, welche Pfade am meisten Traffic erzeugen, welche Bots scannen und welche HTTP-Statuscodes auftreten — unabhängig von Umami (das nur JS-fähige Browser erfasst).

---

## 3. Automatisierung & Workflow

### 🔄 n8n — Visueller Workflow-Automator (selbstgehostet)
* **Funktion:** Selbstgehostete Alternative zu Zapier/Make mit grafischem Flow-Editor.
* **Beispiel-Workflows für Maptale:**
  * Neue Registrierung → Telegram-Nachricht an den Admin.
  * Täglicher API-Healthcheck → bei Fehler automatisch `docker restart maptale-api-1`.
  * Wartelisten-Eintrag → automatische Willkommens-Mail nach X Tagen.
  * Wöchentlicher Speicher-Report → Zusammenfassung per E-Mail.

### 🐳 Watchtower — Automatische Docker-Updates
* **Funktion:** Überwacht laufende Docker-Container und aktualisiert sie automatisch, wenn ein neues Image gepusht wird.
* **Nutzen:** Zero-Downtime-Updates für `maptale-api` und `umami` nach einem `git push` und Image-Build.

### 🔁 Renovate (GitHub App) — Intelligente Dependency-Updates
* **Funktion:** Intelligentere Alternative zu Dependabot. Erstellt gebündelte PRs für Paket-Updates, gruppiert Minor/Patch-Upgrades und versteht Monorepo-Strukturen.
* **Nutzen:** Hält `package.json`, `build.gradle.kts` und Docker-Base-Images (`node:22-alpine`, `postgres:15-alpine`) konsistent und sicher aktuell.

---

## 4. Automatisierte KI- & CI/CD-Agenten

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

## 5. Sicherheit & Härtung

### 🕷️ OWASP ZAP — Automatisierter Penetrationstest
* **Funktion:** Crawlt `maptale.io` als CI-Job und prüft auf XSS, CSRF, offene Redirects, fehlende Security-Header und SQL-Injection.
* **Einsatz:** Wöchentlicher Cron oder als GitHub Actions Workflow nach jedem Deploy.

### ⚡ Nuclei — Blitzschneller Vulnerability-Scanner
* **Funktion:** Schneller Scanner mit tausenden Community-Templates. Findet fehlkonfigurierte Nginx-Header, bekannte CVEs in exponierten Services und veraltete TLS-Ciphers.
* **Nutzen:** Erkennt Schwachstellen, bevor ein Angreifer es tut. In Sekunden durchgelaufen.

### 🔒 Mozilla Observatory (API) — Security-Header-Audit
* **Funktion:** Automatisierter Check gegen Mozillas Best-Practice-Katalog.
* **Nutzen:** Gibt eine Note (A+ bis F) für Content-Security-Policy, HSTS, X-Content-Type-Options, Referrer-Policy etc. Ziel: **A+** halten.

### 🛡️ CrowdSec — Kollaborativer Angriffsschutz
* **Funktion:** Moderne Alternative zu Fail2ban. Analysiert Nginx- und SSH-Logs in Echtzeit und blockiert bösartige IPs sofort auf Firewall-Ebene.
* **Bonus:** Ist ein weltweites Verteidigungs-Netzwerk — wird ein Angreifer auf einem anderen Server erkannt, wird dein Server vorbeugend mit geschützt.

---

## 6. Docker & Server-Management

### 🐳 Portainer CE — Docker-Web-UI
* **Funktion:** Web-Oberfläche für Docker-Container-Management. Container starten, stoppen, Logs ansehen, Volumes inspizieren und Compose-Stacks deployen — alles im Browser.
* **Nutzen:** Kein SSH nötig für Alltags-Aufgaben. Ideal zusammen mit Dozzle.

### ⏰ Healthchecks.io (selbstgehostet) — Dead Man's Switch
* **Funktion:** „Dead Man's Switch" für Cron-Jobs. Jeder Cron-Job (Backup, Cert-Renewal, Cleanup) pingt nach erfolgreichem Lauf einen Endpunkt. Bleibt der Ping aus, wirst du sofort alarmiert.
* **Nutzen:** Entdeckt stille Fehler, die sonst untergehen — z. B. ein Backup-Skript, das seit Wochen nicht mehr läuft.

---

## 7. Suche & Entdecken

### 🔍 Meilisearch — Typo-tolerante Volltextsuche
* **Funktion:** Blitzschnelle Volltextsuche (< 50 ms) mit Tippfehler-Toleranz und Facettenfiltern.
* **Nutzen:** Könnte die Galerie- und Tour-Entdecken-Funktion massiv aufwerten. Nutzer tippt „Stockhol" und findet sofort Stockholm-Touren. Mehrsprachig, selbstgehostet, ein Docker-Container.

---

## 8. Node.js-spezifisches Profiling & Load-Testing

### 🔬 Clinic.js — Node.js-Diagnostik-Suite
* **Funktion:** Erkennt Event-Loop-Blockaden, langsame I/O-Operationen und Memory-Leaks im Fastify-Backend. Erzeugt interaktive Flame-Graphs.
* **Einsatz:** Vor Launch oder nach Performance-Beschwerden lokal gegen den Dev-Server laufen lassen.

### 🏋️ autocannon — HTTP-Load-Testing
* **Funktion:** Simuliert hunderte gleichzeitige Erlebnis-Seiten-Aufrufe und misst Durchsatz, Latenz (p50/p99) und Fehlerrate.
* **Nutzen:** Zeigt, ab wann der Hetzner VPS unter Last einknickt. Wichtig vor einem Launch oder einem Prestige-Social-Media-Post.

---

## 9. Spezialisierte Performance- & Geodaten-Tools

* **MapLibre / MapTiler Latency Monitor:** Misst Latenzen beim Laden von Vektortiles, DEM-Höhendaten und 3D-Building-Geometrien.
* **Core Web Vitals Audit (Lighthouse CLI):** Prüft regelmäßig Largest Contentful Paint (LCP) und Interaction to Next Paint (INP) der Erlebnis-Seite für maximale Flüssigkeit auf Mobilgeräten.
