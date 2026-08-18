---
stand: 2026-08-07
status: Konzept, nichts gebaut
betrifft:
  - android/
  - .github/workflows/deploy.yml
  - docs/ops/android-release.md
  - datenschutz.html
  - index.html (Download-Knopf)
icon: paket
---

# Konzept: Die Android-App in den Play Store — interner Test als erster Schritt

**Der Weg ist schon einmal gegangen worden** — mit Velosia (Repo `vintamie`, Paketname
`com.velosia.app`, seit Juni 2026 im internen Test). Der dort erprobte Ablauf samt der
Stellen, an denen Maptale abweicht, steht in **Abschnitt 14**; wer nur die Handgriffe
sucht, fängt dort an.

## 1. Zielsetzung

Die App liegt heute als **debug-signierter APK** am GitHub-Release und wird von der Landing
verlinkt ([android-release.md](../ops/android-release.md)). Ziel dieses Konzepts ist der
kleinste vollständige Schritt in den Play Store: ein **interner Test** (Internal testing
track) mit bis zu 100 eingeladenen Konten, ausgeliefert über den Play Store, aktualisierbar
wie jede andere App.

**Produktion ist ausdrücklich nicht das Ziel dieser Etappe** — aber jede Entscheidung hier
wird so getroffen, dass sie der Weg dorthin ist und nicht ein Umweg. Drei Dinge sind der
Grund, warum der interne Test überhaupt der richtige erste Schritt ist:

1. **Er ist der billigste Track.** Builds sind in Minuten bei den Testern, es gibt keine
   ausgewachsene Richtlinien- und Sicherheitsprüfung, und **das Data-Safety-Formular entfällt,
   solange die App ausschließlich in diesem Track liegt** (Play-Console-Hilfe, Abschnitt
   „Which developers need to complete the Data safety form"). Man kann den Test starten,
   bevor der Store-Eintrag fertig ist.
2. **Er zwingt trotzdem alles Harte einmal durch:** Entwicklerkonto, echter Signaturschlüssel,
   AAB statt APK, Paketname für die Ewigkeit, `targetSdk`. Genau diese Dinge sind später nicht
   mehr billig zu ändern — der Signaturschlüssel gar nicht.
3. **Er löst das Update-Problem.** Der heutige APK-Weg kann eine vorhandene Installation nur
   aktualisieren, wenn der Debug-Keystore als Secret hinterlegt ist; über Play macht das Play.

Was er **nicht** löst: Die 12-Tester-Regel (Abschnitt 3) hängt am *geschlossenen* Test, nicht
am internen. Wer irgendwann in die Produktion will, sollte das beim Zuschnitt der Etappen
wissen — deshalb steht der geschlossene Test in Abschnitt 11 als eigene Etappe und nicht als
Fußnote.

---

## 2. Warum Play und nicht weiter der APK von der Landing

Der Sideload-Weg funktioniert und bleibt vorerst bestehen. Er wird aber gerade teurer, und
zwar aus einem Grund, der nichts mit Maptale zu tun hat:

**Android-Entwicklerverifizierung.** Ab **30. September 2026** müssen Apps auf zertifizierten
Android-Geräten in Brasilien, Indonesien, Singapur und Thailand einem **verifizierten
Entwickler** zugeordnet sein; **2027 wird das global ausgerollt** — unabhängig von der
Bezugsquelle, also auch für einen APK von der eigenen Website. Wer nicht verifiziert ist,
dessen App lässt sich nur noch über einen einmaligen „Erweitert"-Ablauf mit Warnhinweisen
installieren. Für Verteilung außerhalb von Play gibt es die Android Developer Console, dort
registriert man Paketname plus SHA-256-Fingerabdruck des Signaturschlüssels; die Variante
ohne Identitätsprüfung („Limited distribution") ist auf **20 Geräte** begrenzt und damit für
ein Produkt keine Option.

Ein Play-Console-Konto erledigt die Verifizierung nebenbei. Das ist das eigentliche Argument
für diesen Schritt — nicht Reichweite, die ein interner Test ohnehin nicht bringt.

Dazu kommen drei Dinge, die man erst vermisst, wenn man sie hatte:

| | APK von der Landing | Interner Test über Play |
|---|---|---|
| Update auf dem Gerät | nur bei identischer Signatur, sonst deinstallieren | automatisch |
| Signaturschlüssel | Debug-Keystore als CI-Secret | Play App Signing, Upload-Key austauschbar |
| Absturzberichte | keine | Android Vitals (Abstürze, ANRs, pro Gerätemodell) |
| Wer hat welchen Stand? | unbekannt | pro Track sichtbar |
| Erste Installation | „Unbekannte Quellen" erlauben | ein Tipp |

---

## 3. Was der interne Test verlangt — und was er ausdrücklich nicht verlangt

**Verlangt:**

| Punkt | Detail |
|---|---|
| Play-Console-Konto | **Vorhanden** (Velosia). 25 USD und Identitätsprüfung sind erledigt |
| Paketname | `app.maptale`. **Unveränderlich, für immer, auch bei Löschung der App** |
| Artefakt | **AAB** (`bundleRelease`), nicht APK. Ein debug-signiertes Artefakt lehnt Play ab |
| Signatur | echter Release-Keystore als **Upload-Key** + Play App Signing |
| `targetSdk` | **36** — s. Abschnitt 4, das ist die Terminfalle |
| Store-Eintrag | Name, Kurz-/Vollbeschreibung, Icon 512², Feature-Grafik 1024×500, ≥ 2 Telefon-Screenshots, Kategorie, Kontakt, **Datenschutz-URL** |
| App-Content-Angaben | Zielgruppe, Inhaltsbewertung, Werbung (nein), Regierungs-App (nein), Finanz-/Gesundheitsfunktionen (nein), **Deklaration des Foreground-Service-Typs `location`**, Konto-Löschung |
| Tester | Liste aus Google-Konto-Adressen (bis 100) + Opt-in-Link |

**Nicht verlangt** — und das ist der Grund für den Zuschnitt:

- **Kein Data-Safety-Formular**, solange die App nur in diesem Track lebt. Es wird fällig,
  sobald ein geschlossener, offener oder Produktions-Release existiert.
- **Keine 12 Tester über 14 Tage.** Diese Regel gilt für persönliche Konten, die nach dem
  13.11.2023 angelegt wurden, und sie hängt am **geschlossenen** Test als Bedingung für den
  Zugang zur Produktion. Der interne Test zählt dafür ausdrücklich **nicht** — er ist aber
  auch nicht davon blockiert.
- **Keine vollständige Richtlinienprüfung.** Interne Tests unterliegen nicht der üblichen
  Policy-/Security-Review. Das ist bequem und zugleich die Falle: Was hier durchgeht, muss
  beim ersten geschlossenen Release trotzdem halten.

**Die Rechnung für die Produktion sieht man am besten hier:** geschlossener Test starten →
12 Konten opt-in halten → 14 zusammenhängende Tage → Antrag auf Produktionszugang →
Prüfung. Fällt ein Tester zwischendurch raus und die Zahl unter 12, beginnt das Fenster von
vorn. Das sind realistisch drei bis vier Wochen Wartezeit, in denen niemand programmiert —
und genau deshalb gehört der geschlossene Test früh gestartet, auch wenn die App noch nicht
fertig ist.

---

## 4. Die Terminfalle: `targetSdk` 36 ab dem 31. August 2026

Die App steht auf `compileSdk = 35` / `targetSdk = 35`
([android/app/build.gradle.kts](../../android/app/build.gradle.kts)).

Ab dem **31.08.2026** müssen **neue Apps und Updates** auf API 36 (Android 16) zielen, um
überhaupt eingereicht werden zu können. Für den internen Test gibt es **keine Ausnahme** —
die einzige in der Richtlinie genannte betrifft dauerhaft private Organisations-Apps. Heute
ist der 7. August: **24 Tage.** Die Verlängerung bis zum 1.11.2026 ist ein Formular für
*bestehende* Apps mit Richtlinien-Warnung, nicht für eine Erstveröffentlichung.

Daraus folgt die Reihenfolge des Umsetzungsplans: **erst 36, dann Play.** Ein Upload unter 35
kurz vor Toresschluss wäre ein Sieg von drei Wochen Dauer.

Was der Sprung auf 36 an dieser App tatsächlich anfasst:

| Verhaltensänderung | Betrifft Maptale |
|---|---|
| **Edge-to-edge ist Pflicht** (`windowOptOutEdgeToEdgeEnforcement` wirkungslos) | `enableEdgeToEdge` steht schon in `MainActivity`; zu prüfen sind die Stellen, die Insets von Hand rechnen (`TourScreen`, `ServerTourScreen`: `WindowInsets.navigationBars`) und die Leiste mit `contentWindowInsets = WindowInsets(0,0,0,0)` in `Navigation.kt` |
| **Predictive Back an, `onBackPressed` wird ignoriert** | jeder eigene Zurück-Griff — Kamera, Aufzeichnung, Vollbild-Player. Notausgang `android:enableOnBackInvokedCallback="false"` existiert, ist aber Schulden auf Zeit |
| **Große Displays ignorieren Orientierungs-/Seitenverhältnis-Sperren** (ab sw600dp) | die App sperrt nichts im Manifest — geprüft werden muss trotzdem, ob Kamera und Aufzeichnung im Querformat auf einem Tablet bedienbar bleiben. Der Opt-out fällt mit API 37 weg |
| **`PlayerScreen` blendet die System-Leisten aus** | Immersive bleibt erlaubt, aber die Wiederherstellung beim Verlassen muss unter 36 nachgeprüft werden |
| **16-KB-Speicherseiten** | betrifft nur native Bibliotheken. Die Abhängigkeitsliste ist im Wesentlichen JVM-Code — **einmal am fertigen AAB nachmessen**, nicht annehmen |

Das ist kein Zeilen-Tausch in Gradle, sondern ein QA-Durchlauf auf einem Android-16-Gerät.
Realistisch ein bis zwei Tage — und er gehört ohnehin gemacht, unabhängig vom Store.

---

## 5. Der Signaturschlüssel — die eine unumkehrbare Entscheidung

Heute signiert der Workflow mit einem **Debug**-Keystore (optional aus dem Secret
`ANDROID_DEBUG_KEYSTORE_BASE64`). Play nimmt debug-signierte Artefakte nicht an, und ein
Debug-Schlüssel wäre auch der falsche: Sein Passwort ist von Android vorgegeben und öffentlich
bekannt.

Also **Play App Signing**, und zwar in der Variante, die man nicht bereut:

- Der **Upload-Key** ist ein neuer, echter Keystore, der nur diesem Repo gehört. Er
  unterschreibt, was zu Play hochgeht. Geht er verloren, lässt er sich über den Support
  **ersetzen**.
- Den **App-Signing-Key** — den, mit dem Play die Auslieferung an die Geräte signiert —
  erzeugt Play selbst und verwahrt ihn. Das ist genau der Grund, ihn nicht selbst
  mitzubringen: Ein selbst hochgeladener Schlüssel ist unersetzlich, und wer ihn verliert,
  kann die App im Store **nie wieder** aktualisieren.

Dieser Absatz löst zugleich die Frage auf, die [android-release.md](../ops/android-release.md)
am Ende offen lässt („Und der Play Store?"): Der Release-Keystore ist nur noch ein
Upload-Key, keine Ewigkeits-Identität mehr — das macht den Schritt kleiner, als er dort steht,
und die Datei ist mit dieser Etappe fortzuschreiben.

**Die Folge, die jeden heutigen Nutzer trifft:** Die Play-Fassung trägt eine andere Signatur
als der APK von der Landing. Android legt sie deshalb **nicht** über die vorhandene
Installation — wer wechselt, muss deinstallieren. Und beim Deinstallieren verschwindet die
Room-Datenbank samt **allen lokalen, noch nicht hochgeladenen Aufnahmen**. Das ist keine
Randnotiz, sondern der wichtigste Satz in der Einladungsmail an die Tester:

> Bitte lade offene Aufnahmen hoch, bevor du die alte App entfernst.

Denkbar wäre, das die App selbst sagen zu lassen (Hinweis im Profil, solange lokale Entwürfe
existieren) — s. Abschnitt 12.

---

## 6. Was sich im Repo ändert

Wenig, und das ist Absicht. Die Versionslogik bleibt, wie sie ist: `versionName` und
`versionCode` kommen aus der `package.json` (heute `0.50.0` → `5000`), gehalten vom
Drift-Wächter in [test/versionen.test.ts](../../test/versionen.test.ts).

**`android/app/build.gradle.kts`**

```kotlin
compileSdk = 36
targetSdk  = 36

signingConfigs {
    create("release") {
        // Wie beim Debug-Keystore: Pfad und Passwörter kommen aus der Umgebung,
        // nie aus dem Repo. Fehlt der Schlüssel, bleibt der Release-Build
        // unsigniert — dann scheitert der Upload, nicht der Build.
        val hinterlegt = System.getenv("MAPTALE_RELEASE_KEYSTORE")?.takeIf { it.isNotBlank() }
        if (hinterlegt != null) { /* storeFile / storePassword / keyAlias / keyPassword */ }
    }
}
```

**Neuer Job `play-intern` in [deploy.yml](../../.github/workflows/deploy.yml)**, neben
`android-apk` und mit demselben Test-Gate (`needs: [pruefen, pruefen-android]`):

```
./gradlew bundleRelease   →   AAB   →   Upload in den Track "internal"
```

Für den Upload gibt es zwei Wege: eine Action gegen die Play Developer API oder den **Gradle
Play Publisher** — letzterer läuft bei Velosia seit Monaten und ist deshalb der Vorschlag
(Abschnitt 14). Beide brauchen ein **Dienstkonto** (Google Cloud, Android-Publisher-API
aktiviert) mit der Console-Berechtigung „Releases für Testkanäle"; sein JSON-Schlüssel ist
ein Secret.

| Neues Secret | Inhalt |
|---|---|
| `ANDROID_RELEASE_KEYSTORE_BASE64` | Upload-Keystore |
| `ANDROID_RELEASE_KEYSTORE_PASSWORT` / `_KEY_ALIAS` / `_KEY_PASSWORT` | dessen Zugangsdaten |
| `PLAY_SERVICE_ACCOUNT_JSON` | Dienstkonto für die Play Developer API |

**Der Job muss ausbleiben können.** Genau wie der Server-Rollout ohne `CLOUDPANEL_DOCROOT`
still übersprungen wird, überspringt dieser Job sich selbst, wenn
`PLAY_SERVICE_ACCOUNT_JSON` fehlt — sonst wird jeder Tag rot, bis die Console eingerichtet ist.

**Zwei Fallen, die dieser Job hat und der APK-Job nicht:**

- **Ein `versionCode` ist bei Play endgültig verbraucht.** Ein zweiter Lauf desselben Tags
  (Neustart eines fehlgeschlagenen Workflows) läuft in „Version code 5000 has already been
  used" und färbt den Tag rot, obwohl alles in Ordnung ist. Der Job prüft deshalb vorher, ob
  die Nummer im Track schon liegt, und beendet sich dann erfolgreich.
- **Play antwortet asynchron.** Der Upload ist nicht die Veröffentlichung; der interne Track
  braucht Minuten. Ein Job, der auf „verfügbar" wartet, wartet auf etwas, das er nicht
  kontrolliert.

**Was bleibt:** Der `android-apk`-Job wird nicht abgeschaltet. Solange die Landing den APK
verlinkt, muss er weiterlaufen — und er ist der Weg für alle ohne Play Services. Die
Entscheidung, ob der Download-Knopf irgendwann auf Play zeigt, gehört in Abschnitt 12.

---

## 7. Der Store-Eintrag — Material, das größtenteils schon existiert

Nichts davon muss gestaltet werden, das ist schon passiert:

| Play verlangt | Woher |
|---|---|
| Icon 512×512 | `android/app/src/main/res/mipmap-*/ic_launcher.png` in groß bzw. `logo-mark.svg` |
| Feature-Grafik 1024×500 | aus dem Landing-Hero, wie das OG-Bild ([scripts/gen-og-bild.mjs](../../scripts/gen-og-bild.mjs)) |
| Screenshots (≥ 2) | [docs/mockups/landing/](../mockups/landing/) hat Aufnahme, Liste, Live, Player — für den Store sind echte Geräteaufnahmen ehrlicher |
| Kurzbeschreibung (80) / Vollbeschreibung (4000) | Landing-Texte, sprachlich auf den Store gezogen |
| Datenschutz-URL | `https://maptale.io/datenschutz` — existiert und deckt die App bereits ab (Abschnitt 7 nennt die WebView-Ausnahme) |
| Kontaktangaben | [impressum.html](../../impressum.html) |

Sprache: Deutsch als Standard-Store-Sprache, passend zum Produkt. Englisch kommt mit
[konzept_mehrsprachigkeit_i18n.md](konzept_mehrsprachigkeit_i18n.md), nicht vorher.

---

## 8. Berechtigungen und Deklarationen — was Play zu dieser App fragt

Der Berechtigungssatz ist bewusst schmal
([AndroidManifest.xml](../../android/app/src/main/AndroidManifest.xml)) und das zahlt sich hier aus:

| Berechtigung | Play-Behandlung |
|---|---|
| `ACCESS_FINE_LOCATION` / `_COARSE_` | gewöhnlich. **Kein `ACCESS_BACKGROUND_LOCATION`** — das ist der Grund, warum die aufwendige Hintergrundstandort-Prüfung samt Demo-Video entfällt |
| `FOREGROUND_SERVICE_LOCATION` | **Deklaration des Typs `location` in der Console**, mit Begründung und in der Regel einem kurzen Video des Ablaufs. Die Begründung steht bereits im Manifest-Kommentar: Aufzeichnung läuft weiter, während das Telefon in der Tasche steckt |
| `CAMERA`, `RECORD_AUDIO` | gewöhnlich; die App nimmt selbst auf |
| `ACTIVITY_RECOGNITION` | gewöhnlich; nur bei „Automatisch", blockiert den Start nie |
| `POST_NOTIFICATIONS`, `INTERNET` | gewöhnlich |
| keine `READ_MEDIA_*` | die App liest die Galerie nicht — kein Photo-and-Video-Permissions-Formular |

**Konto-Löschung:** Play verlangt für Apps mit Konten sowohl einen Weg **in** der App als auch
eine **Web-Adresse**, unter der sich die Löschung ohne Installation beantragen lässt. Der
In-App-Weg existiert (`ui/ProfilScreen.kt`, „Konto löschen"); die öffentliche URL ist die
Lücke. Kleinste ehrliche Antwort: ein Abschnitt in `datenschutz.html`, der den Weg über
`/konto` beschreibt und eine Kontaktadresse nennt — die Alternative wäre eine eigene Seite,
und die will begründet sein.

**`datenschutz.html` bekommt einen Absatz „Verteilung über Google Play"**, bevor der erste
Tester installiert: Google als Empfänger (Play-Konto, Gerätedaten, Absturzberichte über
Android Vitals) und die Abgrenzung zur Umami-Messung, die nur im WebView-Player läuft. Im
Repo ist dieser Text eine Zusage — wer den Umfang ändert, ändert sie dort mit.

---

## 9. Tests und Tester

Die Testerliste ist eine Liste von **Google-Konto-Adressen** (bis 100). Zwei Dinge, die man
vorher wissen sollte:

- **Wer im internen Test ist, bekommt nichts anderes.** Ein Konto in der internen Liste
  erhält nur den internen Build, nie den geschlossenen oder offenen — auch wenn es dort
  ebenfalls eingetragen ist. Für den späteren geschlossenen Test braucht es also andere
  Konten oder eine aufgeräumte Liste.
- **Die Adresse ist das Google-Konto, nicht die Maptale-Anmeldung.** Das verwechselt beim
  Einladen jeder einmal.

Am Repo ändert sich für Tests nichts: `pruefen-android` bleibt das Gate, der Play-Job hängt
daran. Was der Store zusätzlich prüft — Startzeit, Abstürze, ANRs — steht danach in Android
Vitals und ist genau die Rückmeldung, die es heute nicht gibt.

---

## 10. In-App-Updates — der einzige „Auto-Updater", der hier Sinn ergibt

Play aktualisiert installierte Apps von selbst. Der Grund, trotzdem etwas zu bauen, ist nicht
die Bequemlichkeit, sondern eine Eigenheit dieses Produkts: **Die App ist Client einer API,
die sich mit jedem Web-Release bewegt**, und der Player kommt als WebView ohnehin vom
Web-Origin. Das Web ist der App also strukturell voraus. Ein alter App-Stand, der auf ein
geändertes Manifest- oder Routenformat trifft, scheitert still — und Play entscheidet nach
eigenem Zeitplan, wann es aktualisiert; bei jemandem, der den Store nie öffnet, können das
Tage sein.

**Was gebaut wird:** `com.google.android.play:app-update(-ktx)`, zwei Abhängigkeiten und
ungefähr ein Bildschirm Code. Auf Nicht-Play-Installationen — Sideload, Emulator, Debug —
ist die Bibliothek wirkungslos, sie darf also überall mitlaufen.

**Was NICHT gebaut wird: ein selbst installierender Updater.** Velosia hatte genau das (APK
laden, über `REQUEST_INSTALL_PACKAGES` installieren) und musste es zum Play-Umzug wieder
ausbauen: Signatur-Konflikt zwischen Play-Fassung und Sideload, doppelte Update-Dialoge, eine
sensible Berechtigung. Mit der Entwicklerverifizierung (Abschnitt 2) wird ein App-eigener
Installer eher schwieriger, nicht leichter.

**Der Auslöser ist eine Mindestversion vom Server, nicht Neuheit.** Zwei Flows stehen zur
Wahl, und die Wahl gehört nicht der App:

| Flow | Wann | Wirkung |
|---|---|---|
| **flexibel** (Standard) | es gibt eine neuere Fassung | lädt im Hintergrund, danach eine „Neu starten"-Leiste. Nichts wird unterbrochen |
| **immediate** | der Server bedient diesen Stand nicht mehr | blockierender Vollbild-Ablauf |

Dafür nennt die API eine **kleinste noch bedienstete App-Version** — ein Feld in einer
Antwort, die es schon gibt, kein neuer Endpunkt. Damit hängt die Unterbrechung an echtem
Bruch statt an einer neuen Nummer; ohne diese Kopplung wird aus dem Update-Hinweis eine
Belästigung, und die trifft ausgerechnet die Leute, die gerade unterwegs sind.

**Die Falle, die diese App von anderen unterscheidet:** Ein blockierender Ablauf startet die
App neu und beendet damit den Foreground-Service — **eine laufende Aufzeichnung wäre weg**.
Geprüft wird deshalb beim Start und in der Tourliste, **nie** während Aufnahme oder Upload.
Das ist keine Feinheit der Bedienung, sondern der Unterschied zwischen einem Update und einem
Datenverlust.

Einsortiert: frühestens **Etappe 6**. Vorher gibt es keine Play-Installation, an der die
Bibliothek etwas täte.

---

## 11. Umsetzungsplan

Reihenfolge nach Blockierwirkung. Etappe 8 steht hinten, weil sie das Data-Safety-Formular
verlangt — ihre 14 Tage laufen aber unabhängig, sie darf also vorgezogen werden, sobald ein
hochladbares AAB existiert.

| # | Etappe | Inhalt | Ergebnis | Aufwand |
|---|---|---|---|---|
| 1 | ~~**Konto anlegen**~~ | **Entfällt** — das Play-Console-Konto existiert und ist verifiziert (Velosia, Abschnitt 14). Damit fällt die einzige Etappe mit Wartezeit weg | — | — |
| 2 | **API 36** | `compileSdk`/`targetSdk` = 36, Insets- und Zurück-Durchlauf, Querformat auf Tablet, 16-KB-Prüfung am AAB | Vor dem 31.8. einreichbar | 1–2 Tage |
| 3 | **Release-Signatur** | Upload-Keystore erzeugen, `signingConfigs.release`, Secrets hinterlegen, `bundleRelease` lokal prüfen | Ein AAB, das Play annimmt | 0,5 Tage |
| 4 | **App in der Console** | Paketname `app.maptale`, Store-Eintrag, App-Content-Formulare, FGS-Deklaration `location` | Upload möglich | 0,5–1 Tag |
| 5 | **Erster interner Test** | AAB von Hand hochladen, Testerliste, Opt-in-Link, Installationshinweis „vorher hochladen, dann deinstallieren" | App kommt aus dem Play Store | 0,5 Tage |
| 6 | **Automatisieren** | Job `play-intern` in `deploy.yml`, Dienstkonto, Überspringen ohne Secret, `versionCode`-Kollision abfangen | Jeder Tag landet im internen Test | 0,5–1 Tag |
| 7 | **In-App-Updates** | `app-update`, flexibler Flow, Mindestversion aus der API, **nie während Aufnahme oder Upload** (Abschnitt 10) | Alte Stände laufen dem Server nicht mehr hinterher | 0,5 Tage |
| 8 | **Doku nachziehen** | [android-release.md](../ops/android-release.md) um den Play-Weg erweitern, `datenschutz.html`, Lösch-URL | Kein zweiter Stand der Wahrheit | 0,5 Tage |
| 9 | **Geschlossener Test** | Data-Safety-Formular, 12+ Tester einladen, 14 Tage halten | Antrag auf Produktion möglich | 0,5 Tage + **14 Tage Wartezeit** |
| 10 | **Entwicklerverifizierung prüfen** | Über Play abgedeckt; für den Landing-APK Paketname + SHA-256 in der Android Developer Console registrieren | Sideload bleibt ab 09/2026 installierbar | 1–2 h |
| — | Produktion | eigener Beschluss, nicht Teil dieses Konzepts | offen | — |

**Etappen 2–8 sind etwa viereinhalb Arbeitstage.** Weil das Konto steht, gibt es keine
Wartezeit mehr, die man parallel ausnutzen könnte — der kritische Pfad ist allein der
**31. August**, also Etappe 2 vor allem anderen Technischen.

### Haken zum Abarbeiten (außerhalb des Repos)

- [x] Play-Console-Konto angelegt und Identität geprüft (mit Velosia erledigt)
- [ ] Kontotyp und Anlagedatum nachgesehen — entscheidet die 12-Tester-Regel, Abschnitt 12
- [ ] Upload-Keystore erzeugt, **außerhalb des Repos gesichert** (Verlust = Support-Fall)
- [ ] Dienstkonto: bestehendes von Velosia wiederverwenden **oder** neues anlegen;
      in der Console für `app.maptale` berechtigen („Releases für Testkanäle")
- [ ] App `app.maptale` in der Console angelegt (Name ist endgültig)
- [ ] Store-Eintrag: Icon, Feature-Grafik, 2+ Screenshots, Texte, Datenschutz-URL
- [ ] App-Content: Zielgruppe, Inhaltsbewertung, Werbung, Datensicherheit (entfällt vorerst)
- [ ] Foreground-Service-Typ `location` deklariert (mit Video)
- [ ] Lösch-URL im Datenschutz ergänzt und in der Console eingetragen
- [ ] Testerliste zusammengestellt (Google-Konten!), Opt-in-Link verschickt
- [ ] Einladungstext enthält den Hinweis auf Deinstallation + Datenverlust

---

## 12. Offene Entscheidungen

Nichts davon blockiert Etappe 2, aber jedes will vor seiner Etappe beantwortet sein:

1. **Welcher Kontotyp ist das vorhandene Konto — und wann wurde es angelegt?** Das ist
   keine Entscheidung mehr, sondern eine Frage an die Console, aber sie bestimmt den
   späteren Weg in die Produktion: Ein **persönliches** Konto, das nach dem 13.11.2023
   angelegt wurde, unterliegt der 12-Tester-Regel; ein Organisationskonto nicht. Da Velosia
   bereits im internen Test liegt, ist die Antwort ablesbar — sie gehört hier festgehalten,
   bevor jemand Etappe 8 plant. Die öffentliche Kontaktanschrift ist ohnehin keine neue
   Offenlegung, sie steht im [Impressum](../../impressum.html).
2. **Bleibt der Download-Knopf der Landing beim APK?** Solange nur ein interner Test
   existiert, ja — ein Play-Link ohne Zugang führt auf eine Fehlseite. Sobald ein offener
   Test oder die Produktion steht, ist der APK der Sonderweg für Geräte ohne Play Services
   und gehört unter „Sonstiges", nicht auf den Hauptknopf.
3. **Warnt die App vor dem Wechsel selbst?** Ein Hinweis im Profil, solange lokale Entwürfe
   existieren („3 Aufnahmen sind noch nicht hochgeladen"), wäre die sicherste Fassung von
   Abschnitt 5 — er hilft aber auch unabhängig vom Store-Wechsel und ist vielleicht ohnehin
   fällig.
4. **`isMinifyEnabled` im Release?** Steht auf `false`. Für den internen Test ist das richtig
   (lesbare Stacktraces, keine ProGuard-Überraschungen bei Room/Serialization); vor der
   Produktion neu stellen, dann mit hochgeladener Mapping-Datei.
5. **Wie viele Sprachen im Store-Eintrag?** Siehe
   [konzept_mehrsprachigkeit_i18n.md](konzept_mehrsprachigkeit_i18n.md) — der Store-Eintrag
   ist eine weitere Übersetzungsstelle und sollte dort mitgedacht werden, statt zweimal
   entschieden zu werden.

---

## 13. Do / Don't

**Do**

- API 36 vor allem anderen Technischen — der 31.8. ist keine Empfehlung.
- Play den App-Signing-Key erzeugen lassen; selbst nur einen Upload-Key halten.
- Den Play-Job überspringbar bauen (fehlendes Secret = grüner Tag), wie beim Server-Rollout.
- Die `versionCode`-Herkunft aus der `package.json` unangetastet lassen.
- Tester ausdrücklich vor dem Datenverlust beim Deinstallieren warnen.
- Den geschlossenen Test früh starten, wenn Produktion je das Ziel ist — die 14 Tage laufen
  nicht schneller, weil man wartet.

**Don't**

- Einen eigenen App-Signing-Key hochladen. Verloren heißt: nie wieder ein Update.
- Debug-Keystore, Release-Keystore oder Dienstkonto-JSON ins Repo legen.
- Den `android-apk`-Job abschalten, solange die Landing ihn verlinkt.
- Den internen Test für eine Richtlinienprüfung halten — er ist keine.
- Das Data-Safety-Formular „schon mal ausfüllen" und dabei etwas zusagen, was
  `datenschutz.html` nicht sagt. Beide Texte müssen dasselbe behaupten.
- Den Paketnamen für einen Testlauf „vorläufig" anders wählen. Er ist endgültig.
- Einen App-eigenen Installer bauen (`REQUEST_INSTALL_PACKAGES`). Das ist der Weg, den
  Velosia wieder zurückbauen musste.
- Ein Update erzwingen, während aufgezeichnet oder hochgeladen wird — der Neustart nimmt
  die Aufnahme mit.

---

## 14. Anhang: Der Ablauf bei Velosia — und wo Maptale abweicht

Velosia (Repo `vintamie`, `com.velosia.app`) liegt seit Juni 2026 im internen Test. Die
Anleitung dort ist `android/PLAY_STORE_GUIDE.md`, die Automatisierung steckt in
`deploy.py` (`--play`) und im unteren Drittel von `android/app/build.gradle`. Das ist keine
Theorie, sondern ein laufender Aufbau — die folgenden neun Schritte sind seine Zusammenfassung.

### Die neun Schritte

| # | Schritt | Wie es bei Velosia gemacht wurde |
|---|---|---|
| 1 | **Entwicklerkonto** | Vorhanden (25 USD einmalig, Identitätsprüfung 1–2 Tage). **Entfällt für Maptale** — dasselbe Konto trägt beide Apps |
| 2 | **Upload-Keystore erzeugen** | `keytool -genkeypair -v -keystore velosia-release.jks -keyalg RSA -keysize 2048 -validity 9125 -alias velosia`, Datei bleibt in `android/` |
| 3 | **Signierung verdrahten** | `android/keystore.properties` (gitignoriert) mit `storeFile` / `storePassword` / `keyAlias` / `keyPassword`; `keystore.properties.example` ist die einzige eingecheckte Vorlage. Gradle lädt sie, wenn sie existiert, und fällt sonst auf den Debug-Key zurück |
| 4 | **`targetSdk` auf den Pflichtstand** | Damals 35 samt AGP-/Gradle-Sprung, danach ein voller Release-Build gegen die Verhaltensänderungen |
| 5 | **App in der Console anlegen** | Name, Standardsprache Deutsch, Typ App, kostenlos. Paketname beim ersten Upload endgültig |
| 6 | **AAB bauen** | `./gradlew bundleRelease` → `app/build/outputs/bundle/release/app-release.aab`. `versionCode` vorher erhöhen |
| 7 | **Play App Signing** | Beim ersten Upload automatisch aktiv: eigener Upload-Key rein, Googles App-Signing-Key raus |
| 8 | **Store-Pflichtangaben** | Datenschutz-URL, Data-Safety-Formular, Inhaltsbewertung, Zielgruppe, Kategorie, Beschreibung, Icon 512² + Feature-Grafik 1024×500 (liegen dort als SVG **und** PNG in `android/store-assets/`), ≥ 2 Screenshots |
| 9 | **Internen Test starten** | Test → Interner Test → Testerliste (Google-Konten) → Release mit dem AAB → „Einführung starten" → **Beitrittslink** an die Tester |

### Die Automatisierung, die daraus entstanden ist

Velosia lädt nicht von Hand hoch. Das Muster ist zweiteilig und passt fast unverändert:

```groovy
// android/app/build.gradle — Plugin nur, wenn der Schlüssel da ist
def playKeyFile = rootProject.file("play-deploy-key.json")
if (playKeyFile.exists()) { apply plugin: 'com.github.triplet.play' }

play {
    serviceAccountCredentials.set(playKeyFile)
    track.set("internal")
    defaultToAppBundles.set(true)
    releaseStatus.set(ReleaseStatus.COMPLETED)   // Testkanal: keine gestaffelte Ausrollung
}
```

Der Upload ist dann ein Task: `./gradlew :app:publishReleaseBundle`. Voraussetzung ist ein
**Dienstkonto** mit aktivierter Android-Publisher-API und der Console-Berechtigung
*„Releases für Testkanäle"*; sein JSON liegt als `android/play-deploy-key.json`,
gitignoriert. Fehlt eine der beiden Dateien, überspringt `deploy.py` den Upload mit einer
Meldung, statt zu scheitern — **dieselbe Linie, die dieses Konzept in Abschnitt 6 für den
GitHub-Job vorsieht**, und der Grund, warum sie dort nicht neu erfunden werden muss.

### Vier Stellen, an denen Maptale abweicht

1. **Der Signaturschlüssel wird zum CI-Secret, nicht zur Datei auf einer Maschine.**
   Velosia veröffentlicht von einem lokalen Rechner aus (`deploy.py --play`); bei Maptale
   hängt alles am Version-Tag in GitHub Actions. Keystore und Dienstkonto-JSON müssen also
   base64-kodiert als Secrets liegen und im Job in `$RUNNER_TEMP` geschrieben werden — den
   Mechanismus gibt es schon, er trägt heute den Debug-Keystore
   ([deploy.yml](../../.github/workflows/deploy.yml), Schritt „Signaturschlüssel bereitlegen").
2. **Kein `versionCode`-Hochzähler.** `deploy.py` erhöht die Nummer per Regex in der
   Gradle-Datei — genau das ist bei Maptale verboten und wird von
   [test/versionen.test.ts](../../test/versionen.test.ts) verhindert: Die Nummer kommt aus
   der `package.json`. Was Velosia dadurch nie erlebt hat, kann Maptale treffen — der
   **zweite Lauf desselben Tags** meldet „version code already used" (Abschnitt 6).
3. **Heute keine SHA-1-Nachpflege — aber nur, solange es keinen Google-Login gibt.** Bei
   Velosia ist der Fallstrick nach dem ersten Upload der native Google-Login: Play signiert
   mit *seinem* Zertifikat, und dessen SHA-1 muss zusätzlich in den OAuth-Client der Google
   Cloud Console, sonst bricht die Anmeldung ausgerechnet für die Play-Installationen — also
   für alle echten Nutzer. Maptale hat eigene Konten
   (`POST /api/auth/session-aus-token`), der Schritt entfällt vorerst. Er kommt zurück, wenn
   [konzept_social_login.md](konzept_social_login.md) umgesetzt wird — dort steht er als
   eigener Punkt, damit er nicht ein zweites Mal überrascht.
4. **Kein Selbst-Updater auszubauen — aber einer aufzubauen.** Velosia musste seinen
   APK-Downloader samt `REQUEST_INSTALL_PACKAGES` entfernen und durch die
   **In-App-Updates-API** ersetzen; Maptale hat nie einen gehabt und fängt deshalb gleich
   an der richtigen Stelle an. Was Velosia dabei nicht braucht und Maptale schon: den
   Riegel gegen Unterbrechungen während einer laufenden Aufzeichnung (Abschnitt 10).

### Was Velosia teurer gemacht hat, als es musste

- **Data Safety wurde ausgefüllt, obwohl der interne Test davon ausgenommen ist.** Kein
  Fehler, aber es war nicht der kritische Pfad — und die Angaben veralten, während man auf
  den ersten geschlossenen Test wartet.
- **Der Release-Build fällt bei fehlender `keystore.properties` still auf den Debug-Key
  zurück.** Bequem für lokale Läufe, aber der Kommentar im Build-File muss den Satz „ein
  solcher Build darf **nicht** hochgeladen werden" tragen — sonst ist der einzige Hinweis
  auf den Unterschied eine Fehlermeldung von Play. Bei Maptale scheitert der Upload lieber
  hart (Abschnitt 6).
