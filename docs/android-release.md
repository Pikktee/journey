# Android-Release — wie die App zu den Leuten kommt

Die Landing verlinkt den Download fest auf
`github.com/Pikktee/journey/releases/latest/download/maptale-android.apk`.
Dieser Pfad zeigt IMMER auf das jüngste Release — was dort hängt, ist also das,
was jeder bekommt, der auf „Android-App laden" tippt.

Bis August 2026 wurde dieser APK von Hand gebaut und hochgeladen. Das lief
erwartbar auseinander: Die Website stand bei 0.33, das Asset im Release bei 0.2,
und auf dem Testgerät lag ein dritter Stand — alle drei trugen unterschiedliche
Nummern für Code, der sich längst weiterbewegt hatte. Seitdem baut der
Deploy-Workflow den APK bei jedem Version-Tag mit.

## Der Ablauf

```bash
npm run release minor
```

Das hebt die Version in der `package.json` und pusht den Tag `vX.Y.Z`. Der Tag
löst [.github/workflows/deploy.yml](../.github/workflows/deploy.yml) aus, und
dort laufen nach demselben Test-Gate wie der Server-Deploy zwei Dinge parallel:

| Job | Ergebnis |
|---|---|
| `deploy` | API-Image nach GHCR, Web-Build in den CloudPanel-Docroot |
| `android-apk` | APK bauen → Release `android-X.Y.Z` mit Asset `maptale-android.apk` |

Existiert das Release schon (von Hand angelegt), wird nur die Datei ersetzt —
ein selbst geschriebener Text bleibt dann stehen.

**Es gibt nichts von Hand zu tun.** Wer den APK trotzdem lokal braucht:

```bash
cd android && JAVA_HOME=/opt/homebrew/opt/openjdk@17 ./gradlew assembleDebug
```

## Die Versionsnummer kommt aus der package.json

`android/app/build.gradle.kts` liest sie beim Konfigurieren:

- `versionName` = die Version des Repos, unverändert (`0.34.0`)
- `versionCode` = daraus gerechnet: `major * 10000 + minor * 100 + patch`
  (`0.34.0` → `3400`)

Der `versionCode` muss monoton steigen, sonst verweigert Android das Update. Die
Rechnung hält die semver-Reihenfolge ein, **solange Minor und Patch unter 100
bleiben** — bei `0.100.0` läge das Ergebnis hinter `1.0.0`, deshalb bricht der
Build dort ab, statt still die Reihenfolge zu drehen.

Ein Drift-Wächter ([test/versionen.test.ts](../test/versionen.test.ts)) lässt die
Web-Tests fehlschlagen, sobald jemand wieder eine feste Nummer in die
Gradle-Datei schreibt. Die App zeigt ihren Stand unten im Profil an:
„Maptale 0.34.0 · Build 3400".

Nebenwirkung, die man kennen muss: Die App-Nummer springt bei JEDEM Web-Release
mit, auch wenn sich unter `android/` nichts geändert hat. Sie beschreibt den
Stand des Repos, nicht den Funktionsumfang der App.

## Der Signaturschlüssel — der Teil, der wehtut

Android lässt einen APK nur dann über eine vorhandene Installation legen, wenn
**beide dieselbe Signatur tragen**. Ein Debug-Build wird lokal mit
`~/.android/debug.keystore` signiert; auf einem GitHub-Läufer gibt es diese Datei
nicht, und Gradle erzeugt bei jedem Lauf einen neuen Schlüssel.

Folge ohne hinterlegten Schlüssel: Jedes Release ist für sich installierbar, aber
**kein Update** — wer die App schon hat, muss sie erst deinstallieren (und
verliert dabei lokale, noch nicht hochgeladene Aufnahmen). Der Workflow schreibt
diesen Warnhinweis dann selbst in die Release-Notizen.

### Abhilfe: den Debug-Keystore einmal als Secret hinterlegen

```bash
base64 -i ~/.android/debug.keystore | gh secret set ANDROID_DEBUG_KEYSTORE_BASE64
```

Danach signiert der Workflow mit demselben Schlüssel wie ein lokaler Build, jedes
Release aktualisiert sauber, und der Warnhinweis verschwindet von selbst.

Ein Debug-Keystore ist **kein Geheimnis** — Passwort und Alias sind von Android
vorgegeben (`android` / `androiddebugkey`), er ist eine Identität, kein Schutz.
Trotzdem gehört er nicht ins Repo, sondern in die Secrets: Er entscheidet, wer
Updates für diese App-Installationen ausliefern kann.

Optional lassen sich abweichende Werte setzen (`MAPTALE_DEBUG_KEYSTORE_PASSWORT`,
`MAPTALE_DEBUG_KEY_ALIAS`, `MAPTALE_DEBUG_KEY_PASSWORT` als Umgebungsvariablen im
Job) — ohne sie gelten die Android-Vorgaben.

### Und der Play Store?

Dafür bräuchte es einen **echten** Release-Keystore (`signingConfigs.release`),
der niemals wechseln darf: Geht er verloren, lässt sich die App im Store nicht
mehr aktualisieren. Solange die Verteilung über die Landing läuft, ist der
Debug-Weg der ehrlichere — er verspricht keine Signatur, die er nicht halten kann.

## Wenn etwas schiefgeht

**Das Release entsteht, aber ohne APK.** Der Gradle-Build ist gescheitert; im
Job-Log steht die Ursache. Das Release lässt sich mit
`gh release delete android-X.Y.Z` entfernen und der Tag erneut pushen.

**„App nicht installiert" auf dem Gerät.** Fast immer die Signatur (s. oben).
Prüfen:

```bash
adb shell dumpsys package app.maptale | grep -A2 "signatures"
```

**Der Download-Link liefert einen alten Stand.** `gh release list` zeigt, welches
Release `Latest` ist — GitHub setzt das auf das zuletzt angelegte, nicht auf das
mit der höchsten Nummer. Ein von Hand nachgetragenes älteres Release kann den
Link also zurückwerfen.
