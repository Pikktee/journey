# Konzept: Social Login — Anmelden mit Google (und später Apple)

Stand: 7. August 2026 · Status: **Konzept, nichts gebaut** · Betrifft: `server/src/auth/`,
[src/studio/](../../src/studio/) (Anmeldebühne), [src/konto/](../../src/konto/), `android/`,
später `ios/`, `datenschutz.html`

## 1. Zielsetzung

Wer sich heute anmelden will, tippt E-Mail und Passwort, wartet auf eine Bestätigungsmail und
klickt darin. Das ist ein sauberer Ablauf und trotzdem die Stelle, an der die meisten
abspringen — bei einem Produkt, das man erst nach der Anmeldung überhaupt beurteilen kann,
wiegt jeder zusätzliche Schritt doppelt. Ein „Mit Google anmelden" ersetzt beide Schritte
durch einen Tipp und bringt die Adresse **bereits bestätigt** mit.

Zwei Dinge, die dieses Konzept ausdrücklich nicht behauptet:

- **Es ist keine zweite Kontenwelt.** Am Ende jedes Ablaufs steht dieselbe Sitzung bzw.
  dasselbe App-Token wie heute. Der Anbieter beweist eine Identität, mehr nicht — die Konten
  gehören weiter Maptale.
- **Es ist nicht der Knopf.** Der Knopf ist ein Nachmittag. Die Arbeit steckt in der
  Kontenverknüpfung (Abschnitt 5) und in den Abläufen, die heute stillschweigend ein Passwort
  voraussetzen (Abschnitt 6).

---

## 2. Leitentscheidung: Der Server prüft das Token, die Clients halten nichts

```
Client (Web / Android / iOS)          Server                         Anbieter
  ID-Token holen  ────────────────►  Signatur gegen JWKS prüfen
                                     aud / iss / exp / nonce
                                     ├─ Identität bekannt?  → Sitzung
                                     ├─ E-Mail bekannt?     → verknüpfen (Abschnitt 5)
                                     └─ neu?                → Konto anlegen (Abschnitt 6)
  ◄──────────────────────────────    Sitzung (Web) / App-Token (Android)
```

**Die E-Mail-Adresse aus einem Client ist keine Auskunft, sondern eine Behauptung.** Nur der
Server darf das ID-Token prüfen, und er prüft es vollständig: Signatur gegen die
öffentlichen Schlüssel des Anbieters, `aud` gegen die eigene Client-ID, `iss`, `exp` und die
`nonce`. Wer stattdessen die vom Client mitgeschickten Profildaten glaubt, hat eine
Anmeldung gebaut, bei der jeder jedes Konto bekommt.

Dieselbe Naht gibt es hier schon: `POST /api/auth/session-aus-token` tauscht das App-Token
der Android-App gegen eine Sitzung für den WebView-Player. Der Social Login ist die zweite
Sorte Eintrittskarte an derselben Tür — kein neuer Türrahmen.

**Ein Anbieter ist eine Datei.** Registry plus Adapter-Vertrag wie in
[konzept_tracker_integrationen.md](konzept_tracker_integrationen.md): Wer keine Client-ID
hinterlegt hat, erscheint nicht in der Oberfläche — die Linie von `config.ts`, nach der ein
fehlender Schlüssel ein Feature ausschaltet und nicht kaputtmacht.

---

## 3. Anbieter

| Anbieter | Empfehlung | Warum |
|---|---|---|
| **Google** | **ja, zuerst** | Größte Abdeckung, bestätigte Adresse inklusive, auf Android der native Weg. Ein Adapter |
| **Apple** | **ja, sobald es iOS gibt** | Nicht Kür: Apple verlangt „Sign in with Apple", sobald eine iOS-App einen anderen Fremd-Login anbietet |
| **Facebook** | **nein** | s. unten |
| GitHub / Microsoft | nein | Falsches Publikum. Maptale ist kein Entwicklerwerkzeug |

### Warum Facebook nicht

`public_profile` und `email` gehen zwar ohne App Review, aber der Preis steht daneben:
Meta-SDK in der App, **Business-Verifizierung**, sobald irgendetwas über diese Basisdaten
hinausgeht, und ein **Pflicht-Endpunkt für den Data-Deletion-Callback** — eine Route, die
Meta aufruft und die mit einer Bestätigungsnummer und einer Status-URL antworten muss. Dazu
ein Absatz in der Datenschutzerklärung und ein Eintrag im Data-Safety-Formular, der schwerer
wiegt als alles, was dort sonst steht.

Für eine Anmeldeart, deren Nutzung seit Jahren fällt, ist das der schlechteste Tausch der
Liste. Wenn ein zweiter Anbieter kommt, ist es Apple — der ist auf iOS ohnehin Pflicht und
gibt Nutzern die Adressverschleierung, die zu diesem Produkt besser passt.

### Der Fallstrick, der aus Velosia schon bekannt ist

Velosia hat einen nativen Google-Login. Zwei Dinge daraus gelten hier unverändert:

1. **Bei Play App Signing zählt Googles Zertifikat, nicht der Upload-Key.** Der OAuth-Client
   in der Google Cloud Console prüft den **SHA-1 der tatsächlichen Signatur** — bei einer aus
   Play installierten App ist das Googles App-Signing-Key. Fehlt dessen Fingerabdruck, bricht
   die Anmeldung genau für die echten Nutzer und funktioniert bei jedem lokalen Test.
   Einzutragen sind **beide**: Upload-Key für Debug-Builds, App-Signing-Key für Play.
2. **Der Code aus Velosia ist nicht übertragbar.** Dort läuft es über
   `play-services-auth` / `GoogleSignInClient` — diese API ist abgekündigt und wird aus dem
   SDK entfernt. Der heutige Weg ist **Credential Manager** (`androidx.credentials` +
   `googleid`) mit „Sign in with Google". Übertragbar ist die Konsolen-Arbeit, nicht das
   Kotlin.

---

## 4. Datenmodell

Eine Tabelle, ein Migrationsschritt:

```sql
CREATE TABLE identitaeten (
  id TEXT PRIMARY KEY,
  benutzer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  anbieter TEXT NOT NULL,            -- 'google' | 'apple' | …
  subject TEXT NOT NULL,             -- die 'sub'-Kennung des Anbieters
  email_beim_verknuepfen TEXT,       -- nur zur Anzeige, nie als Schlüssel
  verknuepft_am TEXT NOT NULL,
  zuletzt_genutzt_am TEXT
);
CREATE UNIQUE INDEX idx_identitaet ON identitaeten(anbieter, subject);
CREATE UNIQUE INDEX idx_identitaet_konto ON identitaeten(benutzer_id, anbieter);
```

Drei Punkte, die man beim Vereinfachen verliert:

- **Der Schlüssel ist `sub`, nicht die E-Mail.** Adressen ändern sich, `sub` nicht. Wer auf
  die Adresse zeigt, hat beim ersten Postfachwechsel eines Nutzers ein zweites Konto.
- **`email_beim_verknuepfen` ist Anzeige, kein Abgleich.** Sie steht in „Angemeldete Geräte"
  und im Konto („verbunden mit henrik@…"), damit erkennbar bleibt, welches Google-Konto
  gemeint ist. Zum Nachschlagen taugt sie nicht.
- **`ON DELETE CASCADE`** — Konto gelöscht heißt Identität weg. Sonst bliebe ein
  Verknüpfungssatz stehen, der beim nächsten Login ins Leere zeigt.

`users.password_hash` wird **nullable**. Genau daran hängt Abschnitt 6.

---

## 5. Kontenverknüpfung — hier steckt die Arbeit

Vier Fälle, und nur der erste ist trivial:

| Fall | Verhalten |
|---|---|
| `sub` bekannt | Anmelden. Fertig |
| `sub` neu, Adresse unbekannt | Neues Konto (Abschnitt 6) |
| `sub` neu, Adresse gehört einem Konto **mit bestätigter E-Mail** | Verknüpfen und anmelden |
| `sub` neu, Adresse gehört einem Konto **ohne bestätigte E-Mail** | **Nicht verknüpfen.** Anmelden mit Passwort verlangen, Verknüpfung danach im Konto |

**Die Regel dahinter:** Verknüpft wird nur, wenn *beide* Seiten die Adresse bestätigt haben —
der Anbieter über `email_verified` im Token, Maptale über `users.email_verified`. Ohne diese
Bedingung genügt es, ein Konto auf eine fremde Adresse anzulegen und zu warten, bis deren
Inhaber sich mit Google anmeldet; das Konto wäre dann übernommen, samt aller Touren. Das ist
kein theoretischer Fall, es ist der klassische Weg, wie Social Login zur Kontoübernahme wird.

**Trennen darf nicht aussperren.** Die letzte verbliebene Anmeldemethode lässt sich nicht
entfernen: Wer nur Google verknüpft hat und kein Passwort besitzt, muss erst eines setzen.
Die Meldung sagt das, statt den Knopf grau zu machen.

---

## 6. Was ein Social-Signup überspringt — und deshalb nachholen muss

Die heutige Registrierung
([server/src/routes/auth.ts](../../server/src/routes/auth.ts)) sammelt vier Dinge ein, die
ein Google-Klick alle vier übergeht:

1. **Den Einladungscode.** Steht die Instanz auf „nur mit Einladung", ist er Pflicht. Ein
   Google-Knopf, der Konten anlegt, wäre sonst der Weg um die Warteliste herum. Reihenfolge
   deshalb: **erst der Code, dann der Anbieter** — der geprüfte Code wandert in den
   `state`-Parameter und wird erst mit dem Anlegen eingelöst.
2. **Den Handle.** Er gehört der Person und wird nicht geraten. Ein kurzer
   Willkommens-Schritt nach dem ersten Login, mit Vorschlag aus dem Namen, aber änderbar.
3. **Die Newsletter-Einwilligung.** Sie ist eine dokumentierte Historie mit Wortlaut
   (Art. 7 Abs. 1 DSGVO), kein Boolean — sie darf nicht mitwandern und **nicht
   vorangekreuzt** sein. Das Kästchen steht im selben Willkommens-Schritt, leer.
4. **Das Passwort.** Und das ist die Falle, die man erst im Betrieb merkt: **Passwortwechsel
   und E-Mail-Wechsel verlangen heute das aktuelle Passwort**, und ein Google-Konto hat
   keines. Ohne Antwort darauf sitzt ein Teil der Nutzer in Kontoeinstellungen, die für sie
   nicht bedienbar sind. Zwei Wege stehen zur Wahl (Abschnitt 10, offen): beim ersten Login
   ein Passwort setzen lassen — ehrlich, aber es nimmt genau die Bequemlichkeit zurück, für
   die man das Feature baut — oder die Wiederanmeldung beim Anbieter als gleichwertigen
   Nachweis akzeptieren. Zweites ist die bessere Antwort und die aufwendigere.

Dazu eine Kleinigkeit mit Signalwirkung: Ein über Google angelegtes Konto braucht **keine
Bestätigungsmail**. Die Adresse ist bereits bestätigt, und eine Mail „Bitte bestätige deine
Adresse" nach einem Ein-Klick-Login sieht aus, als hätte etwas nicht funktioniert.

---

## 7. Oberfläche

**Web ist der Hauptplatz**, nicht die App: Konten entstehen heute im Studio, die
Android-App verweist dafür ausdrücklich auf die Website
(`ui/AnmeldungScreen.kt`). Der Knopf steht also zuerst auf der Anmeldebühne des Studios,
über den Feldern, mit einer Trennlinie „oder mit E-Mail".

**Android** bekommt Credential Manager. Das ist dort mehr als ein zweiter Knopf: Der Dialog
kommt vom System, zeigt die auf dem Gerät angemeldeten Konten und macht aus der Anmeldung
einen Tipp. Nebeneffekt, den man mitnehmen sollte, wenn man ohnehin dort ist: Credential
Manager kann auch **Passkeys** — dieselbe API, dieselbe Naht auf dem Server (ein weiterer
Identitäts-Anbieter). Das ist kein Teil dieses Konzepts, aber der Grund, den Vertrag aus
Abschnitt 2 nicht auf OAuth zuzuschneiden.

**Kontoeinstellungen** bekommen eine Zeile „Verbundene Konten": verknüpfen, trennen,
sichtbar machen, mit welcher Adresse. Sie gehört neben „Angemeldete Geräte" — beides
beantwortet dieselbe Frage: Wer kommt hier rein?

---

## 8. Datenschutz und Store-Angaben

- **`datenschutz.html` bekommt einen Abschnitt** vor dem ersten Login: welcher Anbieter,
  welche Daten (Kennung, Adresse, Anzeigename, Profilbild), dass keine Daten an den Anbieter
  zurückfließen, und wie man trennt. Im Repo ist dieser Text eine Zusage.
- **Das Play-Data-Safety-Formular** nennt die Anmeldedaten. Solange die App nur im internen
  Test liegt, entfällt das Formular
  ([konzept_play_store_interner_test.md](konzept_play_store_interner_test.md), Abschnitt 3) —
  spätestens mit dem geschlossenen Test nicht mehr.
- **Der Anbieter erfährt, dass jemand Maptale nutzt.** Das ist der Preis und gehört in einem
  Satz in die Oberfläche, nicht nur ins Kleingedruckte.

---

## 9. Umsetzungsplan

| # | Etappe | Inhalt | Aufwand |
|---|---|---|---|
| 1 | **Server-Naht** | `identitaeten`-Migration, `password_hash` nullable, Anbieter-Vertrag + Registry, ID-Token-Prüfung gegen JWKS, Verknüpfungsregeln aus Abschnitt 5 mit Tests | 3–4 Tage |
| 2 | **Google im Web** | OAuth-Client, Knopf auf der Anmeldebühne, Willkommens-Schritt (Handle, Newsletter), Einladungscode vorgeschaltet | 2–3 Tage |
| 3 | **Konto-Verwaltung** | „Verbundene Konten" in den Kontoeinstellungen, trennen mit Aussperr-Riegel | 1 Tag |
| 4 | **Passwortlose Konten** | Wiederanmeldung als Passwort-Ersatz in Passwort-/E-Mail-Wechsel und Kontolöschung | 1–2 Tage |
| 5 | **Android** | Credential Manager, **beide SHA-1 im OAuth-Client** (Abschnitt 3), App-Token wie bisher | 2 Tage |
| 6 | **Datenschutz + Data Safety** | Abschnitt in `datenschutz.html`, Formular nachziehen | 0,5 Tage |
| — | **Apple** | mit dem iOS-Projekt; auf iOS Pflicht, sobald Google dort steht | im iOS-Projekt |

Etappen 1–4 sind das erste sinnvolle Release: **eine Woche konzentrierte Arbeit** im Web,
danach kostet Android zwei Tage und Apple später einen Adapter.

Was den Aufwand sprengt, wenn man es unterschätzt: die **Verknüpfungsfälle** (Abschnitt 5 —
jeder einzelne braucht einen Test, und der falsche ist eine Kontoübernahme) und die
**passwortlosen Konten** (Abschnitt 6 — sie brechen Abläufe, die heute niemand als
passwortabhängig wahrnimmt).

---

## 10. Offene Entscheidungen

1. **Wie weist sich ein passwortloses Konto aus?** Wiederanmeldung beim Anbieter oder
   Passwortpflicht beim ersten Login. Gehört zu Etappe 4 und bestimmt, wie viel von der
   gewonnenen Bequemlichkeit übrig bleibt.
2. **Darf Social Login Konten *anlegen* oder nur *anmelden*?** Bei Einladungspflicht ist
   „nur anmelden" die konservative Antwort — sie nimmt dem Feature aber genau die Wirkung,
   um die es geht. Vorschlag: anlegen erlaubt, Code vorgeschaltet.
3. **Profilbild vom Anbieter übernehmen?** Bequem, aber es ist ein fremd gehostetes Bild mit
   eigener Lebensdauer. Vorschlag: einmalig kopieren oder gar nicht.
4. **Passkeys mitnehmen?** Credential Manager kann beides. Wenn Etappe 5 ohnehin dort
   arbeitet, ist die Frage, ob man den Vertrag gleich breit genug schneidet — nicht, ob man
   Passkeys sofort baut.
