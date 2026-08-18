---
stand: 2026-08-06
status: Teil A (Einwilligung) ist umgesetzt, Teil B (Erzeugung und Versand) offen
---

# Konzept: Newsletter — Einwilligung, Erzeugung, Versand

Was gebaut wurde und wo es steht:
[konzept_profil_konto.md](../architecture/konzept_profil_konto.md), Etappe 4 — samt der drei Stellen, an
denen die Umsetzung dieses Papier schärft (Schalter statt Sperre bei unbestätigter
Adresse, Label statt Wortlaut in der Historie, Aufräum-Lauf für die drei Jahre).
**Betrifft:** Registrierung ([studio.html](../../studio.html)), Kontoeinstellungen
([docs/mockups/studio-konto.html](../archive/mockups/studio-konto.html)), Mail-Schicht
([server/src/mail.ts](../../server/src/mail.ts), `mailvorlagen.ts`), Verwaltung
([src/admin/](../../src/admin/)).

Zwei Dinge, die zusammengehören, aber getrennt gebaut werden können:
**(A)** wie jemand den Newsletter bestellt, **(B)** wie er entsteht und rausgeht.
A ist klein und rechtlich heikel, B ist größer und rechtlich harmlos — deshalb
zuerst A.

---

## A. Einwilligung

### A.1 In den Kontoeinstellungen (steht im Mockup)

Ein Schalter „Updates & Neues von Maptale", **standardmäßig aus**. Kein zweites
Double-Opt-In: Das DOI ist kein Selbstzweck, sondern das Mittel, um
nachzuweisen, dass die Einwilligung vom **Inhaber** der Adresse stammt — es
verhindert, dass jemand eine fremde Adresse einträgt. Genau dieser Fall ist im
angemeldeten Bereich ausgeschlossen: Die Adresse ist beim Anlegen des Kontos
bestätigt worden, und den Schalter erreicht nur, wer angemeldet ist.

### A.2 Bei der Registrierung (neu)

Ein zusätzliches Kästchen unter E-Mail und Passwort:

> ☐ Schick mir ein paar Mal im Jahr Neuigkeiten zu Maptale. Abbestellen
> jederzeit in den Kontoeinstellungen oder über den Link in jeder Mail.

Vier Bedingungen, an denen nicht gerüttelt wird:

1. **Nicht vorangekreuzt.** Ein vorbelegtes Kästchen ist seit dem
   Planet49-Urteil des EuGH (C-673/17) keine wirksame Einwilligung.
2. **Nicht gekoppelt.** Die Registrierung funktioniert unabhängig davon; das
   Kästchen ist kein Bestandteil der AGB-Zustimmung.
3. **Eigener Satz, eigene Zeile.** Nicht in einen Absatz mit anderen
   Zustimmungen gemischt.
4. **Wirksam erst mit der Kontobestätigung.** Zum Zeitpunkt der Registrierung
   ist die Adresse noch unbestätigt — es geht also nichts raus, bevor der
   Bestätigungslink geklickt wurde. Damit ist der Klick auf diesen Link
   faktisch das Double-Opt-In für den Newsletter gleich mit.

**Wichtig für die vorhandene Verifikationsmail:** Sie darf keine Werbung
enthalten, sonst wird sie selbst zur unerlaubten Werbemail. Ein Satz wie
„Übrigens, unser Newsletter …" ist dort tabu — die Einwilligung wird durch den
Klick bestätigt, nicht beworben.

### A.3 Datenmodell

Ein Boolean reicht nicht. Im Streitfall steht sonst „an" da und niemand weiß,
seit wann und wofür. Nötig ist eine kleine Historie (Art. 7 Abs. 1 DSGVO):

| Feld | Zweck |
| --- | --- |
| `zeitpunkt` | wann ein- oder ausgetragen |
| `benutzer_id` | wer |
| `zustand` | `an` \| `aus` |
| `quelle` | `registrierung` \| `konto` \| `abmeldelink` |
| `textfassung` | Version des Einwilligungstextes, dem zugestimmt wurde |

Aufbewahrung: mindestens drei Jahre nach der Abmeldung. Der aktuelle Zustand
bleibt als Spalte an `users` (schneller Zugriff beim Versand), die Historie
liegt in einer eigenen Tabelle.

### A.4 Riegel

- Solange die E-Mail unbestätigt ist, bleibt der Schalter gesperrt.
- Nach einem Adresswechsel ruht der Versand, bis die neue Adresse bestätigt ist.
- Jede Mail trägt `List-Unsubscribe` mit One-Click (RFC 8058). Seit 2024
  verlangen Gmail und Yahoo das von Massenversendern; ohne leidet die
  Zustellbarkeit auch der transaktionalen Mails aus derselben Domain.
- Der Abmeldelink funktioniert **ohne Anmeldung** (signierter Token) — ein
  Widerruf muss so einfach sein wie die Einwilligung (Art. 7 Abs. 3).

---

## B. Erzeugung und Versand

### B.1 Der Ablauf, wie er gedacht ist

```
Verwaltung → „Newsletter vorbereiten"
   ↓
Änderungen seit dem letzten Versand einsammeln
   ↓
Entwurf erzeugen lassen (Claude API)
   ↓
Redigieren in der Verwaltung  ←── hier ist der Mensch, immer
   ↓
Testversand an das eigene Konto
   ↓
Übersetzungen erzeugen (je Zielsprache) + freigeben
   ↓
Versand in Stapeln an alle mit Einwilligung
```

### B.2 Woher der Inhalt kommt

Die Quelle ist das, was ohnehin entsteht: **Version-Tags und Commits**. Das
Repo hat deutsche Commit-Messages und Releases über
[scripts/release.sh](../../scripts/release.sh); zwischen dem letzten Newsletter
(gespeicherter Tag oder Datum) und heute liegen alle Änderungen.

Was den Entwurf brauchbar macht, ist die **Auswahl**, nicht die Vollständigkeit:

- Nur nutzersichtbare Änderungen. `feat:` und größere `fix:` ja, `chore:`,
  `refactor:`, `test:`, Abhängigkeits-Updates nein.
- Gruppieren nach Bereich (Player, Studio, App), nicht nach Commit-Reihenfolge.
- Aus „feat(studio): Standard als Kamera-Wert" wird ein Satz, der beschreibt,
  **was man jetzt kann** — nicht, was geändert wurde.
- Höchstens fünf bis sieben Punkte. Ein Newsletter, der alles aufzählt, wird
  nicht gelesen.

Der Entwurf entsteht über die Claude API (siehe Skill `claude-api` für Modelle
und Parameter). Eingabe: gefilterte Commit-Liste plus die vorigen Newsletter als
Stilvorlage. Ausgabe: Betreff, Vorschautext, Fließtext in der Sprache des
Produkts (Deutsch).

### B.3 Übersetzung

Erst relevant, wenn es Nutzer mit anderer Sprache gibt — das hängt an
[konzept_mehrsprachigkeit_i18n.md](konzept_mehrsprachigkeit_i18n.md), das für
`users` ohnehin ein Feld `sprache` (`de` | `en`) vorsieht. Bis dahin geht der
Newsletter deutsch raus.

Wenn es soweit ist: Übersetzung ebenfalls über die Claude API, aber **mit
derselben Freigabe wie das Original**. Eine Sprache, die niemand im Haus liest,
wird sonst zur Blackbox — und ein Fehler im englischen Betreff geht an alle
englischen Nutzer, ohne dass es jemand merkt.

### B.4 Versand

Läuft über die vorhandene Mail-Schicht: `MailVersand`-Interface, in Produktion
[`ResendMail`](../../server/src/mail.ts). Zu beachten:

- **Stapelweise** versenden, nicht in einer Schleife über alle. Resend hat
  Ratenbegrenzungen; ein abgebrochener Lauf darf nicht dazu führen, dass die
  erste Hälfte die Mail zweimal bekommt → Versandprotokoll je Empfänger.
- **Jede Mail einzeln adressiert**, niemals viele Empfänger in einem `to`.
- **Bounces und Beschwerden** auswerten: Wer hart bounct, wird stillgelegt;
  wer sich beschwert, sofort ausgetragen.
- Die Vorlage kommt aus demselben Layout wie die System-Mails
  (`maillayout.ts`), Text- und HTML-Fassung immer zusammen.

### B.5 Was in der Verwaltung dazukommt

Ein Reiter „Newsletter" neben den Mail-Vorlagen: Liste der Ausgaben (Entwurf,
freigegeben, versendet), Editor mit Vorschau, Testversand, Empfängerzahl,
Versandprotokoll. Die vorhandene Vorlagen-Verwaltung (v0.42) ist das Vorbild.

---

## C. Was dagegen spricht — und was nicht

**Kein Gegenargument, aber eine Reihenfolge:** A (Einwilligung) ist in einem
Nachmittag gebaut und Voraussetzung für alles Weitere. B lohnt sich erst, wenn
es Empfänger gibt. Zwei bis vier Ausgaben im Jahr rechtfertigen keine
Versand-Infrastruktur auf Vorrat — die Automatik der **Zusammenfassung** ist der
eigentliche Gewinn, nicht die des Versands.

**Der einzige echte Einwand** betrifft die Erzeugung: Ein Text, der aus
Commits entsteht, klingt schnell nach Changelog und behauptet leicht Dinge, die
so nicht stimmen („neu: X" für etwas, das nur repariert wurde). Deshalb ist die
Freigabe durch einen Menschen keine Formalie, sondern der Kern des Ablaufs — und
deshalb steht sie oben im Diagramm mit einem Pfeil markiert.

**Nicht automatisieren:** den Versandzeitpunkt. „Alle drei Monate automatisch"
führt dazu, dass irgendwann ein Newsletter rausgeht, weil der Kalender es sagt,
und nicht, weil es etwas zu erzählen gibt.

---

## D. Offene Punkte

- ~~Die Datenschutzerklärung erwähnt den Newsletter nicht.~~ **Erledigt mit Teil A:**
  [datenschutz.html](../../datenschutz.html) Abschnitt 2 (Zweck und was protokolliert
  wird), 3 (Art. 6 Abs. 1 lit. a, Widerruf), 9 (Resend) und 10 (drei Jahre für den
  Nachweis). Wer den Umfang ändert, ändert dort eine Zusage.
- Auftragsverarbeitungsvertrag mit Resend prüfen — für transaktionale Mails
  besteht er hoffentlich schon, für Werbung gilt derselbe.
- Vor dem ersten echten Versand: anwaltliche Gegenprüfung der beiden
  Einwilligungstexte (Registrierung, Kontoeinstellungen). Der Aufwand ist klein,
  der Abmahnwert eines falschen Satzes nicht.
