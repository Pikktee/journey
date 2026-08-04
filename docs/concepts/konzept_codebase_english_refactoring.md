# Konzept: Refactoring der Codebase auf Englisch

## 1. Zielsetzung
Vereinheitlichung aller Bezeichner (Funktionen, Methoden, Typen, Variablen, Dateinamen und Datenbankspalten) auf Englisch, um die Codebase international entwicklerfreundlich und wartbar zu gestalten.

---

## 2. Abgrenzung & Betroffene Module

1. **Backend (Node.js / Fastify / TypeScript):**
   * *Typen & Funktionen:* z. B. `MailBausteine` ➔ `MailTemplate`, `konfigAusEnv` ➔ `configFromEnv`, `gefaehrlichesLoeschen` ➔ `deleteAccountDangerously`.
   * *Datenbank-Schema:* SQLite-Tabellen & Spalten wie `mailvorlagen`, `geaendert_am`, `geheimnis`.
2. **Web Frontend (Vite / TypeScript):**
   * *Dateien & Module:* `audiotracks.ts`, `routen.ts`, `baukasten`.
3. **Android App (Kotlin / Compose):**
   * *Composables & Klassen:* `AnmeldungScreen` ➔ `LoginScreen`, `Einstellungen` ➔ `Settings`, `PrimaerKnopf` ➔ `PrimaryButton`.

---

## 3. Risikominimierung durch Testabdeckung

Die Codebase verfügt über ein umfassendes Test-Set (**über 890 automatisierte Tests**):
* `vitest` für Web Frontend & Node.js Backend
* Kotlin JVM Unit-Tests für Android

Das Refactoring kann schrittweise pro Modul durchgeführt werden, wobei nach jedem Schritt die automatisierten Tests die Funktionsfähigkeit garantieren.

---

## 4. Aufwandsschätzung & Vorgehen

| Phase | Aufgabenbereich | Geschätzter Aufwand |
| :--- | :--- | :--- |
| **Phase 1** | Server-Types, API-Routen & Node.js Utilities | 1 Tag |
| **Phase 2** | Web Frontend Components & State Management | 1 Tag |
| **Phase 3** | Android App Composables & ViewModels | 0,5 Tage |
| **Phase 4** | Datenbank-Spalten & Migrationsskript | 0,5 Tage |
| **Gesamtaufwand** | | **ca. 2,5 – 3 Entwicklungs-Tage** |
