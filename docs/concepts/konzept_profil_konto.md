# Umsetzung: Profil & Kontoeinstellungen

**Stand:** 6. August 2026 · Mockup abgenommen, Umsetzung offen.
**Mockup:** [docs/mockups/studio-konto.html](../mockups/studio-konto.html)
(Mockup-Leiste oben schaltet zwischen den Ansichten und Zuständen.)
**Newsletter:** eigenes Konzept, [konzept_newsletter.md](konzept_newsletter.md).

Fünf Etappen, jede für sich deploybar. Die Reihenfolge ist nicht
Geschmackssache: Etappe 1 legt den Handle fest, und ein Handle, der einmal in
einer geteilten URL steht, ist nicht mehr frei änderbar. Alles andere kann
warten, das nicht.

---

## Etappe 1 — Der Handle und seine Adresse ✅

**Umgesetzt am 6. August 2026.** Der Vhost ist auf dem Server bereits nachgezogen
(`location ~ ^/@`, Sicherung daneben, `nginx -t` + Reload, Gegenprobe grün) — das
darf vor dem Code laufen. Der Rest wartet auf den nächsten Release.
Was wo liegt: [src/handle.ts](../../src/handle.ts) (Regeln, reservierte Wörter,
`zuHandle`) mit Server-Kopie [server/src/handle.ts](../../server/src/handle.ts)
und Drift-Wächter; `profilPfad`/`handleAusPfad` in
[src/routen.ts](../../src/routen.ts); Migration 11+12 in
[server/src/db.ts](../../server/src/db.ts); Vergabe und 90-Tage-Sperre in
[server/src/auth/auth.ts](../../server/src/auth/auth.ts).

**Ziel:** `maptale.io/@henrik` funktioniert, überall wo heute `?id=<uuid>` steht.
Ohne jede sichtbare Änderung an der Oberfläche.

**Server**
- Migration: `users.handle TEXT UNIQUE`, `users.handle_geaendert_am TEXT`.
- Neue Tabelle `handles_reserviert (handle, user_id, frei_ab)` — 90 Tage Sperre
  nach einer Änderung (Begründung: s. Mockup-Kommentar bei `zeigeHandleStand`).
- Vergabe beim Anlegen des Kontos: aus dem Lokalteil der E-Mail
  transliteriert (`zuHandle()` aus dem Mockup), bei Kollision mit Zähler.
  Bestandskonten bekommen ihren Handle in derselben Migration.
- Reservierte Wörter **neben** [src/routen.ts](../../src/routen.ts) pflegen, samt
  Drift-Wächter: Ein neuer Pfad darf keinen vergebenen Handle überschreiben.
- `GET /api/benutzer/:handle/profil` zusätzlich zur ID-Variante
  ([server/src/routes/galerie.ts](../../server/src/routes/galerie.ts) kennt heute
  nur `:id`).
- `PATCH /api/auth/me/profil` um `handle` erweitern, mit Prüfung gegen
  Regeln/Reservierung/Vergabe (dieselbe Logik wie im Mockup, aber serverseitig —
  die Client-Prüfung bleibt reine Bequemlichkeit).

**Web**
- [src/routen.ts](../../src/routen.ts): Eintrag `profil` bekommt eine Funktion
  `profilPfad(handle)` → `/@henrik`. Die alte Form `?id=…` bleibt als Alias
  bestehen und leitet weiter — Mail- und Chat-Links sind in der Welt.
- **Vhost von Hand nachziehen.** Der Deploy zieht ihn nicht mit; die Datei liegt
  auf dem Server unter `/etc/nginx/sites-enabled/maptale.io.conf` (SSH als
  `root@178.104.147.230`, Zugang ist eingerichtet). Neben die drei vorhandenen
  Studio-Aliasse gehört:

  ```nginx
  location ~ ^/@ { rewrite ^ /profil.html last; }
  ```

  Vorgehen: erst `cp maptale.io.conf maptale.io.conf.bak.<datum>` (so machen es
  die vorhandenen Sicherungen dort auch), dann `nginx -t`, dann
  `systemctl reload nginx`, dann Gegenprobe mit `curl -I https://maptale.io/@henrik`.
  [deploy/cloudpanel-nginx.conf](../../deploy/cloudpanel-nginx.conf) ist nur die
  Vorlage im Repo und muss dieselbe Zeile bekommen, sonst driftet sie weiter
  ab. Der Wächter in [test/routen.test.ts](../../test/routen.test.ts) prüft die
  neue Regel mit.
- Reihenfolge beim Ausrollen: Vhost zuerst schadet nicht (`/@…` antwortet dann
  mit der Profilseite, die den unbekannten Handle als „nicht gefunden" zeigt),
  Code danach. Umgekehrt wäre die Adresse für die Dauer eines Deploys tot.
- Dev-Middleware in [vite.config.js](../../vite.config.js) analog.

**Fallstrick:** `@` ist in URLs erlaubt, aber `encodeURIComponent('@')` macht
`%40` daraus. In `pfad()` also nicht durch die Query-Kodierung schicken.

---

## Etappe 2 — Die Profilseite ✅

**Umgesetzt am 6. August 2026.** Titelbild, Avatar, Handle, Ort, Links,
Kennzahl-Chips, Tourenraster und das Bearbeiten-Modal stehen; die vier
Vorschlagsbilder liegen in `public/titelbilder/`.
Nicht gebaut: die **Ortssuche**. Sie ist im Mockup ausdrücklich „eine Attrappe
derselben Idee" — echt wäre sie ein Nominatim-Aufruf an jedem Tastendruck, also
eine ratenbegrenzte Fremdquelle im Tippweg. Das Ortsfeld ist Freitext; wenn die
Vorschläge kommen sollen, ist das ein eigener Schritt (Proxy-Route + Zwischenspeicher).
Ebenfalls bewusst offen: der **Zuschnitt** hochgeladener Titelbilder — das Banner
ist ein fester Ausschnitt (`object-fit: cover`), was bei querformatigen Bildern
dasselbe Ergebnis liefert.
**Nachgezogen am 6. August 2026** (zusammen mit Etappe 3): Ein Profil ohne Anzeigenamen
zeigt jetzt seinen Handle statt „Ohne Namen" (und dann nicht zweimal), und ohne gewähltes
Titelbild steht im Banner eines der vier Vorschlagsbilder — deterministisch aus dem Handle
gewählt (`standardTitelbild`), damit dieselbe Person nicht bei jedem Aufruf ein anderes
Kopfbild hat. Der Knopf im Titelbild-Dialog heißt deshalb „Zurücksetzen" statt „Entfernen":
Danach steht dort nicht nichts.

**Ziel:** [profil.html](../../profil.html) wird zu dem, was das Mockup zeigt —
für Fremde wie für den Besitzer, mit Bearbeiten-Modal.

**Server**
- Migration: `users.ort`, `users.website`, `users.instagram`, `users.titelbild`.
  (`anzeigename`, `bio`, `avatar`, `profil_sichtbarkeit` gibt es seit M-Ausbau.)
- Titelbilder: die vier Vorschläge liegen als statische Dateien im Build
  (`public/titelbilder/`), eigene Uploads gehen den Weg des Avatars
  (`benutzerStorage`, Dateiname mit Zeitstempel gegen Browser-Cache).
- Kennzahlen (Touren, km, Höhenmeter) aus `tours.stats_json` — **nur über
  öffentliche Touren summiert**, sonst verrät die Zahl private Fahrten.

**Web**
- Profilseite: Titelbild, Avatar, Handle, Ort, Links, Kennzahl-Chips,
  Tourenraster. Rechnende Teile DOM-frei nach
  [src/galerie/galeriemodell.ts](../../src/galerie/galeriemodell.ts) bzw. ein
  neues `profilmodell.ts` (Handle-Prüfung, Kennzahlen, Link-Typen) — testbar
  ohne Browser, wie im Projekt üblich.
- Bearbeiten-Modal nur, wenn die Sitzung dem Profil gehört.

**Aufwand-Treiber:** die Bildwege (Titelbild-Upload, Zuschnitt, Auslieferung),
nicht das Formular.

---

## Etappe 3 — Kontoeinstellungen ✅

**Umgesetzt am 6. August 2026.** Seite [konto.html](../../konto.html) +
[src/konto/](../../src/konto/) unter `/konto`; Migration 15 (Sitzungs-Kennzeichen,
`mail_tokens.nutzlast` + Zweck `email`); Routen `POST /api/auth/me/passwort`,
`POST /api/auth/me/email`, `POST /api/auth/email-bestaetigen`,
`GET|DELETE /api/auth/me/geraete[/:id]`, `GET /api/auth/me/speicher`; Mail-Vorlage
`email-wechsel`. Das Konto-Menü hat jetzt „Mein Profil" und „Kontoeinstellungen"
(Studio wie öffentliche Seiten). Umami-Tag: JA (s. CLAUDE.md).

Zwei Abweichungen vom Mockup, beide bewusst:

- **Der Newsletter-Schalter fehlt** — er ist Etappe 4 und hängt an
  Einwilligungs-Protokoll und Abmeldelink; ein Schalter ohne die wäre eine Zusage ohne
  Deckung. Ebenso fehlt der ZIP-Export (Etappe 5).
- **„In Suchmaschinen erscheinen" fehlt VORERST.** `profil.html` ist eine statische Seite
  mit festem `noindex` — der Schalter könnte heute nichts bewirken, außer zu behaupten, er
  täte es. Die Entscheidung ist inzwischen gefallen: Er kommt mit **Etappe 6** zurück,
  sobald die Profilseite serverseitig ausgeliefert wird.

Zusätzlich zum Mockup: **Die Geräteliste zeigt auch die App-Tokens.** Die App meldet sich
mit einem Token an, nicht mit einer Sitzung — eine Liste nur aus Sitzungen hätte genau das
Gerät nicht dabei, das im Mockup als „Maptale App · Pixel 9" gezeichnet ist.

**Ziel:** eigene Seite `/konto`, Inhalt wie im Mockup.

**Server**
- `POST /api/auth/me/passwort` — altes Passwort prüfen, neues setzen.
- `POST /api/auth/me/email` — Änderung anstoßen; wirksam erst nach Klick auf
  den Link an die **neue** Adresse (`mail_tokens` mit neuem `zweck`).
- Sessions sichtbar machen: Migration `sessions.user_agent`, `sessions.ip_prefix`
  (nur die ersten zwei Oktette — mehr braucht niemand, um ein fremdes Gerät zu
  erkennen), `sessions.zuletzt_gesehen`. Dazu `GET /api/auth/me/sessions` und
  `DELETE /api/auth/me/sessions/:id`.
- Speicher-Aufschlüsselung: `quotaStand` liefert heute eine Summe; für die
  vier Balkenabschnitte braucht es die Aufteilung nach Medienart.

**Web**
- Neuer Eintrag in [src/routen.ts](../../src/routen.ts) (`konto` → `/konto`),
  neue Datei `konto.html` + `src/konto/`. Konto-Menü im Studio bekommt die zwei
  Einträge „Mein Profil" und „Kontoeinstellungen".

**Nicht vergessen:** Umami-Tag. Die Seite gehört in die Gruppe „mit Tag" oder
bewusst nicht — [CLAUDE.md](../../CLAUDE.md) beschreibt die Entscheidung.

---

## Etappe 4 — Newsletter-Einwilligung ✅

**Umgesetzt am 6. August 2026.** Migration 16 (`users.newsletter` +
`newsletter_einwilligungen`), [server/src/newsletter.ts](../../server/src/newsletter.ts) +
[routes/newsletter.ts](../../server/src/routes/newsletter.ts); Routen
`POST /api/auth/me/newsletter`, `POST /api/newsletter/abmelden`,
`POST /api/newsletter/ein-klick/:token`, dazu `newsletter` in `/auth/me` und im
Registrierungs-Körper. Oberfläche: Kästchen in der Registrierung
([studio.html](../../studio.html)), Block „Benachrichtigungen" in
[konto.html](../../konto.html), Abmeldelink über `/konto#newsletter-aus=<token>`.
Datenschutzerklärung um Zweck, Rechtsgrundlage, Empfänger und Frist ergänzt.

Drei Entscheidungen, die vom Konzept abweichen oder es schärfen:

- **Der Schalter ist auch bei unbestätigter Adresse bedienbar.** Das Konzept sagt
  „bleibt gesperrt"; gesperrt ist jetzt der VERSAND. Ein toter Schalter ließe rätseln,
  ob die Einwilligung angekommen ist — und eine Einwilligung darf man geben, bevor man
  sie einlösen kann. Der Riegel sitzt dort, wo er wirkt: in `empfaenger()`.
- **Gespeichert wird ein Label, nicht der Wortlaut** (sonst stünde derselbe Satz
  tausendfach in der Tabelle). Damit das Label etwas beweist, hält ein Drift-Wächter
  die Sätze in der Oberfläche gegen `EINWILLIGUNGSTEXTE`.
- **Die drei Jahre Aufbewahrung sind gebaut**, nicht nur zugesagt: `raeumeAuf()` läuft
  täglich neben der Warteliste und lässt die jüngste Zeile immer stehen.

Was Teil B mitbekommt (Versand, noch nicht gebaut): `NewsletterDienst.empfaenger()` und
`newsletterKopfzeilen()` samt `MailNachricht.kopfzeilen` bis zu Resend.

---

## Etappe 5 — Datenexport

Der einzige Punkt mit echtem Hintergrundlauf: ZIP aus Touren, Medien und
Konto-Angaben bauen, irgendwo ablegen, Link mit 48-Stunden-Frist per Mail.
Braucht eine kleine Job-Verwaltung (Status, Aufräumen alter Archive) — deshalb
zuletzt, obwohl es im Mockup nur eine Zeile ist.

**Bewusst später:** die automatische Newsletter-Erzeugung, Mehrsprachigkeit.

---

## Etappe 5.5 — Auffindbar und teilbar (klein)

Beim Prüfen von Etappe 3 aufgefallen: Es gibt **keine `robots.txt`** (live 404),
**keine Sitemap** und **nirgends Open-Graph-Tags**. Wer heute einen Tour- oder
Profil-Link in WhatsApp, Slack oder Mastodon teilt, bekommt keine Vorschaukarte,
sondern eine nackte URL — bei einem Produkt, dessen Kern das Teilen von Reisen
ist, kein Nebenschauplatz.

- `public/robots.txt`: Verwaltung, Konto und Studio ausschließen, Sitemap nennen.
- `public/sitemap.xml` für die statischen Seiten (Landing, Galerie, Impressum,
  Datenschutz). Profile und Touren kommen erst mit Etappe 6 dazu — vorher
  dürfen sie ohnehin nicht in den Index.
- `og:title`, `og:description`, `og:image`, `twitter:card` in
  [index.html](../../index.html), [galerie.html](../../galerie.html) und
  [erlebnis.html](../../erlebnis.html). Für die statischen Seiten reichen feste
  Werte samt einem Marken-Bild.

Etwa eine Stunde, unabhängig vom Rest.

---

## Etappe 6 — Die Profilseite serverseitig ausliefern

**Erst danach kann „In Suchmaschinen erscheinen" zurück ins Konto** — und dann
bewirkt der Schalter auch etwas. Heute trägt [profil.html](../../profil.html)
ein festes `noindex`, weil sie statisch für alle gleich ausgeliefert wird.

Verworfene Wege, damit sie nicht wiederkommen:

| Weg | Warum nicht |
| --- | --- |
| `noindex` per JavaScript entfernen | Google verarbeitet das `noindex` im initialen HTML, **bevor** es JavaScript rendert. Die Seite fliegt raus, ehe der Code läuft |
| `X-Robots-Tag` im Vhost | Nginx weiß nicht, ob DIESER Nutzer indexiert werden will — nur ein Schalter für alle oder keinen |
| Bei jeder Änderung eine statische Datei je Profil schreiben | Cache-Invalidierung und ein Schreibpfad für einen Gewinn, der erst bei Zehntausenden Profilen zählt |

**Der Weg:** Fastify beantwortet `/@handle` selbst und setzt im HTML-Kopf
`robots`, `title`, `description` und die `og:`-Tags nach dem, was in der
Datenbank steht (Titelbild als `og:image` — das löst die Teilen-Vorschau gleich
mit). Der Rest der Seite bleibt clientseitig wie heute.

Der Knackpunkt ist, woher der Server das gebaute HTML nimmt — die Bundle-Namen
tragen Hashes, der API-Container kennt den Docroot nicht. Zwei Varianten:

1. Der Build kopiert `dist/profil.html` ins API-Image. Koppelt Web-Build und
   Image und braucht einen neuen Deploy-Schritt.
2. **Empfohlen:** Der Container holt `profil.html` zur Laufzeit über Nginx
   (`127.0.0.1`), hält sie ein paar Minuten im Speicher und ersetzt darin nur
   den Meta-Block. Keine Kopplung, kein neuer Deploy-Schritt, ein Fetch pro
   Cache-Periode.

Im Vhost wird aus `location ~ ^/@ { rewrite ^ /profil.html last; }` ein
`proxy_pass` an die API — wieder von Hand, s. Etappe 1.

Dazu gehört: Sitemap um öffentliche, indexierbare Profile ergänzen,
`canonical`-URL setzen, und der Schalter im Konto schreibt ein Feld
`suchmaschinen` (Standard **aus** — ein Profil über den Link zu teilen ist
etwas anderes, als unter dem eigenen Namen auffindbar zu sein).

---

## Was die Umsetzung am ehesten kippt

1. **Der Vhost.** Er wird vom Deploy nicht mitgezogen. Ohne die `@`-Regel
   landet jeder Profil-Link auf der Landing — und zwar still.
2. **Handle-Vergabe für Bestandskonten.** Die Migration muss deterministisch
   und kollisionsfrei sein; einmal vergeben, ist der Name in der Welt.
3. **Kennzahlen und Tourenliste.** Beide müssen serverseitig auf „öffentlich"
   filtern. Ein Filter, der nur im Frontend sitzt, ist kein Filter.
4. **Coverage-Gate.** Der Server deployt nur mit 80 % Testabdeckung — die neuen
   Routen brauchen Tests im selben Zug, nicht danach.

---

## Entschieden — und ausdrücklich verworfen

Damit nicht wieder vorgeschlagen wird, was schon abgeräumt ist:

| Entschieden | Warum |
| --- | --- |
| Profil-URL `maptale.io/@henrik` | eigener Namensraum, sprachneutral (aus `/profil` würde bei i18n `/en/profile`) |
| Handle ≠ Anzeigename, 90 Tage Sperre | Namen sind doppelt und ändern sich, Adressen dürfen das nicht; 90 Tage wiegen Identitätsschutz gegen blockierte Namen auf |
| Profilseite zeigt nur öffentliche Touren | private Touren wohnen in „Meine Touren"; Kennzahlen zählen deshalb auch nur die öffentlichen |
| Bearbeiten im Modal | robuster als `contenteditable` (Enter, eingefügtes HTML, Firefox), Verwerfen ist trivial |
| Sichtbarkeits-Schalter an zwei Stellen | Modal und Kontoeinstellungen, aber EIN Zustand — man findet ihn dort, wo man ihn sucht |
| Radius 8 / 12 / 14 (Knopf / Karte / Modal) | schärfer als der bisherige 10-px-Stand; **gilt bisher nur im Mockup** — `DESIGN.md`, `studio.html`, Editor und Admin ziehen als eigener Schritt nach |
| `--text-3` auf `#7e8a99` | 4,0:1 war zu wenig für 12-px-Meta-Zeilen, jetzt 5,6:1 |
| Labels in Satzschrift | gesperrte Versalien sind die alte Player-Sprache (s. `CLAUDE.md`) |
| Titelbilder als Fotos | gezeichnete Routen über Rastern lasen sich als Kursdiagramm |

| Verworfen | Warum |
| --- | --- |
| „Öffentliche Ansicht" (Vorschau-Modus) | seit die Seite nur öffentliche Touren zeigt, verschwinden darin bloß drei Knöpfe |
| Privatzone / Start und Ziel verbergen | fachlich sinnvoll (ein GPS-Track verrät die Wohnadresse), aber bewusst gestrichen — wenn öffentliche Profile live gehen, gehört das Thema wenigstens in die Datenschutzerklärung |
| Zwei-Faktor-Bestätigung | vorerst nicht; ohne Wiederherstellungscodes sperrt sich der erste Nutzer mit verlorenem Telefon aus |
| Passkeys (WebAuthn) | kein Knopf, sondern ein zweiter kompletter Anmeldeweg: Challenge-Fluss, Credential-ID/Public Key/Signaturzähler, Geräteverwaltung, Wiederherstellung bei Geräteverlust. Der Gewinn ist Phishing-Resistenz — die zählt, wo Geld oder Identität hängen. Hier hängen Reisefotos daran, und angemeldet bleibt man 30 Tage: Die Anmeldung erlebt ein Nutzer vielleicht viermal im Jahr. Falls doch, dann als **Ergänzung** zum Passwort, nie als Ersatz |
| Drittes freies Link-Feld | „Weiteres Profil" mit Platzhalter stellt eine Frage, auf die die meisten keine Antwort haben; kommt als „Link hinzufügen" wieder, wenn es Bedarf gibt |
| „Alle anderen Geräte abmelden" | einzelnes Abmelden genügt |
| Kennzahlen als Kacheln oder Sparklines | drei Anläufe; Chips mit einem Zeichen sind der Kompromiss zwischen Dashboard-Optik und Fließtext |
| Speicher erweitern / Videos verkleinern | setzt ein Preismodell bzw. eine Medien-Pipeline voraus, die es nicht gibt |

**Noch offen, außerhalb dieser fünf Etappen:** EXIF beim Ausliefern öffentlicher
Fotos strippen (ungeprüft, ob der Server das heute tut), Einwilligung zur
Veröffentlichung mit Zeitstempel protokollieren, und die Datenschutzerklärung um
öffentliche Profile, Handles und geteilte Tracks ergänzen.

---

## Vorschlag für den Anfang

Etappe 1 komplett, in einem Zug bis zum Deploy: Migration, Route, Vhost,
Weiterleitung der alten Links, Tests. Danach ist die Adresse festgeklopft und
alles Weitere kann in beliebiger Reihenfolge folgen.
