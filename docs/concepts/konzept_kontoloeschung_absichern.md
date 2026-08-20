---
stand: 2026-08-20
status: Befund vom 2026-08-20, nichts gebaut
betrifft:
  - server/src/routes/auth.ts
  - src/konto/kontodialoge.ts
  - datenschutz.html
systemteile: [Backend, Konto]
icon: schluessel
---

# Konto löschen: die unwiderruflichste Aktion ist die ungeschützteste

**Befund vom 2026-08-20**, gefunden beim Smoke der Welle 1, und zwar auf die
teuerste Art: durch Auslösen. `DELETE /api/auth/me` verlangt **kein Passwort**.
Eine gültige Sitzung genügt, und der Aufruf löscht Konto, alle Touren, alle
Medien, Avatar, Banner und ein fertiges Export-Archiv. Es gibt keinen
Papierkorb und keine Frist; die einzige Rückfrage steht in der Oberfläche
([kontodialoge.ts](../../src/konto/kontodialoge.ts) sendet einen LEEREN Body).

## Warum das ein Widerspruch ist, kein Versehen

Das Projekt hat die Frage an anderer Stelle schon entschieden, und zwar anders.
`CLAUDE.md` sagt zu Passwort- und Adresswechsel:

> Eine offene Sitzung beweist nur, dass jemand am Gerät saß.

Deshalb verlangen **beide** das aktuelle Passwort. Für die Aktion, die alles
löscht, gilt dieselbe Begründung stärker: Wer an einem offenen Browser sitzt,
ändert die Adresse nicht (dafür bräuchte er das Passwort), löscht aber das
ganze Konto. Die Rangfolge steht damit auf dem Kopf.

Die zweite Lücke ist die Bühne: Die Bestätigung ist ein Dialog. Alles, was am
Client vorbei ruft, sieht sie nie. Für den Betreiber ist das heute ein
theoretischer Fall (drei Konten, alle seine), für ein Produkt mit fremden
Konten ist es keiner mehr.

## Was zu tun ist

1. **Passwortpflicht am Server** (`required: ['password']`, Prüfung wie beim
   Adresswechsel), 403 mit Klartext bei falschem Passwort. Der Dialog bekommt
   ein Passwortfeld; das ist dieselbe Mechanik wie in `oeffneMailDialog`.
2. **Nur der eigene Weg**, kein Nebenweg: Admins löschen fremde Konten weiter
   über `DELETE /api/admin/users/:id`, das hinter `erfordereAdmin` steht.
3. **Die Zusage in [datenschutz.html](../../datenschutz.html) mitlesen**, bevor
   der Text formuliert wird: Dort steht, was beim Löschen passiert. Wer die
   Hürde ändert, ändert dort keine Zusage, aber der Wortlaut sollte zueinander
   passen.

Offen und bewusst nicht mitentschieden: ob die Löschung eine **Frist** bekommt
(„in 30 Tagen, bis dahin widerrufbar"). Das wäre ein eigener Entwurf mit
eigenen DSGVO-Fragen; Art. 17 verlangt unverzügliche Löschung, eine
Widerrufsfrist ist damit vereinbar, aber sie muss dann auch beschrieben sein.

## Was der Befund über die Prüfung sagt

Er stand in keiner Testsuite und in keinem der drei Reviews des
Englisch-Konzepts, weil er **kein Migrationsfehler** ist: Die Route verhält
sich seit ihrem ersten Tag so. Gefunden hat ihn eine falsche Annahme („die
Route wird schon ein Passwort verlangen") beim Versuch, drei Konto-Funktionen
ungefährlich zu prüfen. Der Preis war der Verlust der lokalen Dev-Daten
(wiederhergestellt aus `scripts/seed-demo-touren.mjs`), der Ertrag dieser
Eintrag.

Die Lehre für künftige Prüfungen steht in
[welle-1-stand.md](../specs/welle-1-stand.md): Eine löschende Route wird nicht
„zur Probe" aufgerufen. Was sie verlangt, liest man im Schema, bevor man sie
anfasst.
