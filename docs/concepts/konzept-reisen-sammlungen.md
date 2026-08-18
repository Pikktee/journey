---
icon: koffer
---

# Konzept: Touren vs. Reisen (Roadmap M8 / M9)

Dieses Dokument beschreibt die funktionale und begriffliche Differenzierung zwischen **Einzel-Touren** und **Mehrtages-Reisen** in Maptale.

---

## 1. Begriffe & Abgrenzung

### **A. Die Einzel-Tour (Atomare Einheit)**
- **Was es ist**: Eine einzelne, zusammenhängende GPS-Aufzeichnung mit Zeitstempeln, Höhendaten, Geschwindigkeiten und zugeordneten Fotos/Medien.
- **Anwendungsfälle**:
  - Tages-Wanderung (z. B. *Lauterbrunnen → Grindelwald*)
  - Feierabend-Runde mit dem Moped oder Fahrrad
  - Spaziergang, Ausflug oder Einzelfahrt
- **Begrifflichkeit in der UI**:
  - In der Navigationsleiste: **„Meine Touren“** (Sammlung aller eigenen Tracks)
  - Im Player: **„Tour abspielen“** / **„GPS-Track“**
  - Beim Upload: **„Neue Tour aufzeichnen“**

### **B. Die Reise (Mehrtagessammlung / Container)**
- **Was es ist**: Ein übergeordneter Ordner / Album / Story-Container, der **mehrere zusammenhängende Touren** chronologisch oder thematisch bündelt.
- **Anwendungsfälle**:
  - 14-Tage Urlaub (z. B. *Koh Phangan Entdeckungsreise* mit 8 Einzeltouren)
  - Transalp / Alpenüberquerung (z. B. *Alpen-Cross 2026* mit 6 Tages-Etappen)
  - Roadtrip oder Fernreise
- **Begrifflichkeit in der UI**:
  - Im Profil & Entdecken-Bereich: **„Reisealbum“** / **„Reise-Story“**
  - Player-Modus: **„Gesamte Reise abspielen“** (nahtlose Übergänge zwischen den Etappen)

---

## 2. Vorteile der Trennung

1. **Ehrliche & Präzise UX**: Ein 3-km-Spaziergang wird nicht künstlich zur „Reise“ aufgeblasen, sondern bleibt eine ehrliche **Tour**.
2. **Skalierbarkeit für Urlaube**: Ein 2-wöchiger Urlaub wird nicht mehr in 14 ungeordneten Einzelteilen angezeigt, sondern sauber in **einer übergeordneten Reise** strukturiert.
3. **Nahtloses Storytelling**: In der 3D-Player-Engine können Tages-Etappen nacheinander mit Pausen-Kompression abgefahren werden.

---

## 3. Einordnung in die Entwicklungs-Roadmap

- **Aktueller Stand (M1 – M6)**: Fokus auf die perfekte Einzel-Tour (Aufnahme, Anreicherung, 3D-Player, Edit-Overlay, Studio-Bibliothek).
- **Zukunft (M8 – M9)**: Einführung des `Reise`-Objekts im Backend & Schema (`server/src/schema/trip.ts`), das mehrere `tourId`s mit Abschnitten und Kapitel-Intro verdrahtet.
