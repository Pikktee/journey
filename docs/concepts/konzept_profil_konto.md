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

## Etappe 3 — Kontoeinstellungen

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

## Etappe 4 — Newsletter-Einwilligung

Klein, aber Voraussetzung für alles Weitere im
[Newsletter-Konzept](konzept_newsletter.md): Kästchen bei der Registrierung,
Schalter im Konto, Einwilligungs-Historie, Abmeldelink ohne Anmeldung,
`List-Unsubscribe`-Header. Ein Nachmittag, wenn Etappe 3 steht.

---

## Etappe 5 — Datenexport

Der einzige Punkt mit echtem Hintergrundlauf: ZIP aus Touren, Medien und
Konto-Angaben bauen, irgendwo ablegen, Link mit 48-Stunden-Frist per Mail.
Braucht eine kleine Job-Verwaltung (Status, Aufräumen alter Archive) — deshalb
zuletzt, obwohl es im Mockup nur eine Zeile ist.

**Bewusst später:** die automatische Newsletter-Erzeugung, Mehrsprachigkeit.

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
