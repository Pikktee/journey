# Konzept: Tracker-Integrationen & Automatische Foto-Zuordnung

## 1. Zielsetzung
Automatische Synchronisation von Workouts & GPS-Tracks aus externen Sport-Trackern (Garmin, Strava, Apple Watch, Polar, Suunto) mit automatischer Foto-Zuordnung aus der Smartphone-Galerie.

---

## 2. Die zwei Integrations-Pfade

### Weg A: Smartphone-Ebene via Health Connect & HealthKit (Schnell & Gratis) 📱
* **Technologie:** **Google Health Connect** (Android) und **Apple HealthKit** (iOS).
* **Funktionsweise:** Die Maptale App liest auf dem Smartphone des Nutzers neu aufgezeichnete Workouts lokal aus der System-Health-API ab.
* **Vorteile:**
  * Funktioniert ohne manuelle API-Partneranträge bei den Herstellern.
  * Deckt mit minimalem Aufwand sofort Garmin, Apple Watch, Polar, Suunto und Wahoo ab.
* **Aufwand:** ca. **2 – 3 Tage** (Mobile App).

### Weg B: Cloud-zu-Cloud Integration via Webhooks (Relive-Modell) ☁️
* **Technologie:** OAuth 2.0 Authentifizierung + HTTP-Webhooks (`/api/webhooks/...`).
* **Funktionsweise:** Der Nutzer verknüpft sein Konto einmalig im Web/in der App. Sobald eine Aktivität bei Garmin oder Strava beendet wird, pusht der Anbieter die Route per Webhook direkt an den Maptale-Server.
* **Vorteile:** 100 % serverseitig ("Zero Click") – funktioniert selbst wenn das Smartphone ausgeschaltet ist.
* **Aufwand:**
  * Backend-Webhook-Infrastruktur & FIT/GPX-Parsing: ca. **2 – 3 Tage**.
  * Je Anbieter (Strava, Garmin, Suunto): ca. **0,5 – 2 Tage** pro Schnittstelle.

---

## 3. Automatische Foto-Zuordnung (EXIF Time-Matching)

* **Die Realität:** Garmin-Uhren & Fahrradcomputer speichern nur GPS/Höhen-Daten, aber keine Fotos.
* **Der Mechanismus:**
  1. Maptale nimmt den GPS-Trackzeitraum (z. B. 14:00 bis 16:00 Uhr).
  2. Die Maptale-App scannt die lokale Smartphone-Galerie nach Fotos mit EXIF-Aufnahmezeitpunkten im selben Zeitraum.
  3. Die App komprimiert die Treffer-Fotos lokal und ordnet sie auf die Sekunde genau der richtigen Stelle im 3D-Kameraflug zu.

---

## 4. Rechtlicher Status & API-Richtlinien

* **Keine Patentklagen:** Visualisierungen von 3D-Kamerafahrten über GPS-Daten sind mathematische Datenverarbeitungen ohne Monopol.
* **Strava API TOS:** Strava verlangt, dass keine fremden Markenlogos in generierten Videos eingebunden werden.
* **Kartendaten-Attribution:** Vorbildlich gelöst durch Maptales integrierte Attribution-Badges.
