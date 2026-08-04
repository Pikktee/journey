# Konzept: Mehrsprachigkeit (i18n) & URL-Routing

## 1. Zielsetzung
Maptale soll international ausgerichtet werden und sowohl im Web als auch in der Android-App mehrsprachig (zunächst Deutsch und Englisch) nutzbar sein.

---

## 2. Architektur & URL-Routing

### 🏆 Empfohlener Ansatz: Subpfade auf `maptale.io`
* **`https://maptale.io/en/`** — Englische Version (Global/Default)
* **`https://maptale.io/de/`** — Deutsche Version
* **`https://maptale.de`** — Leitet automatisch (301) weiter auf `https://maptale.io/de/`

### Vorteilsanalyse:
* **SEO-Stärke:** Alle Backlinks und Domain-Autoritäten fließen auf der Hauptdomain `maptale.io` zusammen.
* **Suchmaschinen-Indexierung:** Über `hreflang`-Tags erkennt Google exakt die passende Sprachversion für den jeweiligen Nutzer.
* **Wartungsfreundlichkeit:** Einheitliche Server- und Caddy/Nginx-Konfiguration.

---

## 3. Aufschlüsselung der Komponenten

### A. Web-App & Studio (`src/` & HTML-Entrypoints)
* Einführung eines leichtgewichtigen i18n-Systems (JSON-Wörterbücher für `de` und `en`).
* Abstraktion aller UI-Texte auf Landingpages, im Studio, Player, Inspektor und den Rechtstexten.

### B. Backend & System-Mails (`server/src/`)
* Erweiterung des Benutzerkontos um das Feld `sprache` (`de` | `en`).
* Mehrsprachige Mail-Vorlagen (`server/src/mailvorlagen.ts`) für Verifikation, Passwort-Reset und Warteliste.

### C. Android-App (`android/app/`)
* Nutzung des nativen Android-Ressourcensystems über `res/values-de/strings.xml` und `res/values-en/strings.xml`.

---

## 4. Aufwandsschätzung

| Komponente | Geschätzter Aufwand |
| :--- | :--- |
| **Frontend & Web Studio** | 1,5 – 2 Tage |
| **Backend & E-Mails** | 1 Tag |
| **Android-App** | 0,5 Tage |
| **Routing & SEO-Testing** | 0,5 Tage |
| **Gesamtaufwand** | **ca. 3 – 5 Entwicklungs-Tage** |
