# Push einrichten (Firebase Cloud Messaging)

Der Code ist gebaut — Server ([push.ts](../../server/src/push.ts),
[fcm.ts](../../server/src/fcm.ts)) und App
([push/](../../android/app/src/main/java/app/maptale/push/)). Was hier steht, sind die
Handgriffe, die ein Google-Konto brauchen und deshalb nicht im Repo stehen können.
Hintergrund und Begründung: [konzept_tracker_integrationen.md](../concepts/konzept_tracker_integrationen.md),
Abschnitt 9.

**Ohne diese Einrichtung ist nichts kaputt.** Server und App laufen vollständig, die
Registrier-Route antwortet `push: false`, und die App bleibt bei ihrem periodischen Abruf
(`TrackerAbfrageWorker`, alle 15 Minuten) — den es aus genau diesem Grund weiter gibt. Push
verkürzt „deine Tour ist fertig" von Minuten auf Sekunden; er ersetzt nichts.

## 1. Firebase-Projekt anlegen

[console.firebase.google.com](https://console.firebase.google.com) → **Projekt hinzufügen**.

- **Google Analytics ABWÄHLEN.** Es ist eine zweite Datenübertragung an Google, die niemand
  braucht — und die in der Datenschutzerklärung stünde. Die App nimmt `firebase-analytics`
  bewusst nicht einmal als Abhängigkeit auf.
- Projektname frei, etwa `maptale`.

Dann **Android-App hinzufügen**:

| Feld | Wert |
|---|---|
| Paketname | `app.maptale` (exakt — er steht in `android/app/build.gradle.kts` als `applicationId`) |
| App-Name | Maptale |
| SHA-1 | **nicht nötig** — die braucht nur Google-Anmeldung/Dynamic Links, nicht FCM |

## 2. `google-services.json` hinterlegen

Die Datei aus der Konsole herunterladen und **lokal** ablegen:

```
android/app/google-services.json
```

Sie ist gitignored. Für die CI in ein Secret (`ANDROID_GOOGLE_SERVICES_JSON_BASE64`),
dieselbe Form wie beim Debug-Keystore:

```bash
base64 -i android/app/google-services.json | pbcopy
```

**Warum nicht ins Repo:** Sie ist ein Schlüssel. Und warum der Build sie nicht verlangt: Das
`google-services`-Plugin bricht ab, wenn sie fehlt — fest angewandt könnte niemand mehr
bauen, der sie nicht hat. `android/app/build.gradle.kts` wendet es deshalb nur an, wenn die
Datei da ist; sonst meldet der Build eine Zeile und die App läuft ohne Push.

## 3. Dienstkonto für den Server

Firebase-Konsole → **Projekteinstellungen → Dienstkonten → Neuen privaten Schlüssel
generieren**. Heraus kommt eine JSON-Datei.

In die Server-Umgebung als **Base64** (der private Schlüssel enthält Zeilenumbrüche und
überlebt keine `.env`-Zeile im Klartext):

```bash
base64 -i dienstkonto.json
```

```
MAPTALE_FCM_SERVICE_ACCOUNT=<base64>
```

Roher JSON-Text wird auch angenommen (erkannt am führenden `{`) — praktisch beim lokalen
Ausprobieren, in der `.env` des Servers nicht.

**Der Schlüssel ist ein Vollzugriff auf den Nachrichtenversand des Projekts.** Er gehört in
`/srv/maptale/.env` und nirgendwo sonst; `docker-compose.cloudpanel.yml` reicht ihn durch.

## 4. Gegenprobe

Nach dem Deploy:

```bash
curl -s -X POST https://maptale.io/api/push/geraete \
  -H "authorization: Bearer <app-token>" -H 'content-type: application/json' \
  -d '{"token":"test-fid","plattform":"android"}'
```

- `{"ok":true,"push":true,…}` → Dienstkonto ist gelesen, Push ist an.
- `{"ok":false,"push":false}` → kein Dienstkonto in der Umgebung.
- Startet der Container gar nicht und meldet „MAPTALE_FCM_SERVICE_ACCOUNT ist kein lesbares
  JSON", ist die Base64-Zeile beim Kopieren abgeschnitten worden.

Danach am Gerät: App neu installieren, anmelden, einen Tracker verbinden (dabei die
Benachrichtigungs-Erlaubnis erteilen) und eine Aktivität aufzeichnen. Die Meldung soll
Sekunden nach dem Import kommen, nicht Minuten.

Ein Test-Gerät kann seine Adresse selbst zeigen: `adb logcat -s Maptale` beim Verbinden —
oder in der Firebase-Konsole unter **Messaging → Testnachricht senden** die FID eintragen.

## Was man dabei falsch machen kann

- **Die Adresse ist die FID, nicht der Registrierungs-Token.** FCM hat den Token mit SDK
  25.1.0 (Juni 2026) abgelöst; die v1-API führt `token` als deprecated und will `fid`. Wer
  eine Anleitung von früher befolgt, baut gegen ein abgekündigtes Feld.
- **Eine `notification` im Nachrichten-Körper** ließe Android die Meldung selbst anzeigen —
  am Quittieren vorbei, doppelt zum periodischen Abruf, und der Text läge auf dem
  Sperrbildschirm. Maptale schickt ausschließlich `data`.
- **Auto-Init wieder einschalten.** `firebase_messaging_auto_init_enabled=false` im Manifest
  ist kein Schönheitsfehler: Ohne es meldet `firebase-installations` schon beim App-Start
  eine Kennung an Google — vor jeder Zustimmung.
- **Analytics nachträglich dazunehmen.** Dann stimmt die Datenschutzerklärung nicht mehr
  (Abschnitte 7, 9, 10).
