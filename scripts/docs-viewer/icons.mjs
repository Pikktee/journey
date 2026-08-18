/* ── Die Zeichen der Konzepte ──────────────────────────────────────────────
 *
 * Achtzehn Karten in drei Spalten sahen sich alle gleich an: eine Zeile Titel,
 * eine Zeile Schritt. Wer die Roadmap überfliegt, sucht aber nicht Text, er
 * sucht WIEDER — „das mit dem Video", „das mit dem Geld". Ein Zeichen je Karte
 * ist der Anker dafür.
 *
 * Drei Regeln, die den Satz zusammenhalten:
 *
 * 1. VON HAND, nicht abgeleitet. Der naheliegende Weg wäre ein Icon je
 *    Systemteil — der steht schon im Kopf jedes Dokuments. Aber elf der
 *    achtzehn Konzepte nennen zwei bis vier Teile („Modi konsolidieren":
 *    android, backend, studio, player), und das erste davon zu nehmen ist eine
 *    Auskunft über die Reihenfolge einer Liste, nicht über das Vorhaben.
 * 2. EIN Strichgewicht, EIN Raster. Alle Pfade leben in 24×24, werden nur
 *    gestrichen (nie gefüllt) und tragen weder eigene Strichstärke noch
 *    eigene Farbe: Das setzt das Blatt, damit zwanzig Zeichen nebeneinander
 *    wie ein Satz aussehen und nicht wie eine Sammlung.
 * 3. Ein unbekannter Name ist KEIN Fehler, sondern das neutrale Blatt. Ein
 *    Tippfehler im Front Matter darf keine Karte kosten — er soll nur nichts
 *    behaupten.
 */

/** Name → Pfade. Alles in einem 24×24-Feld, nur Konturen. */
export const ICONS = {
  // Ein Blatt Papier: der Rückfall, wenn nichts angegeben ist.
  blatt: ['M6 3h7l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z', 'M13 3v5h5'],
  film: ['M3 5h18v14H3z', 'M7 5v14', 'M17 5v14', 'M3 12h18'],
  kamera: ['M3 8h4l2-3h6l2 3h4v11H3z', 'M12 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z'],
  muenze: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v10', 'M14.5 9.5h-4a1.8 1.8 0 0 0 0 3.5h3a1.8 1.8 0 0 1 0 3.5h-4'],
  globus: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M3 12h18', 'M12 3c2.5 2.5 3.7 5.6 3.7 9s-1.2 6.5-3.7 9c-2.5-2.5-3.7-5.6-3.7-9S9.5 5.5 12 3z'],
  brief: ['M3 6h18v12H3z', 'm3 7 9 6 9-6'],
  schluessel: ['M7.5 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z', 'M10.7 12H20', 'M17 12v3', 'M20 12v2.5'],
  paket: ['M3.5 7.5 12 4l8.5 3.5v9L12 20l-8.5-3.5z', 'M3.5 7.5 12 11l8.5-3.5', 'M12 11v9'],
  tempo: ['M4 17a8 8 0 1 1 16 0', 'm12.6 15.4 3.9-5.4', 'M12 18a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8z'],
  regler: ['M4 8h16', 'M4 16h16', 'M9 5v6', 'M16 13v6'],
  stift: ['M4 20v-3.5L16.5 4a2.1 2.1 0 0 1 3 3L7 19.5z', 'm14.5 6 3.5 3.5'],
  bilder: ['M3 6h12v10H3z', 'm3 13 3.5-3 4 3.5', 'M18 9h3v11H9v-3'],
  leinwand: ['M4 4h16v12H4z', 'm8 12 3-3.5 2.5 2.5L16 8', 'M12 16v4'],
  antenne: ['M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'M7.5 7.5a6.5 6.5 0 0 0 0 9', 'M16.5 7.5a6.5 6.5 0 0 1 0 9', 'M4.5 4.5a10.5 10.5 0 0 0 0 15', 'M19.5 4.5a10.5 10.5 0 0 1 0 15'],
  koffer: ['M3 8h18v12H3z', 'M9 8V5h6v3', 'M3 13h18'],
  puls: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'm7.5 12.5h2l1.5-3 2 5 1.5-2h2'],
  buchstaben: ['m4 17 4-10 4 10', 'M5.4 13.5h5.2', 'M20 9.5c0-1.1-1-1.7-2.4-1.7-1.6 0-2.6.8-2.6 2s1 1.7 2.6 1.9c1.6.2 2.6.7 2.6 1.9s-1.1 2-2.7 2C15.9 15.6 15 15 15 14'],
  module: ['M4 4h7v6H4z', 'M13 4h7v6h-7z', 'M4 14h7v6H4z', 'M13 14h7v6h-7z'],
  weiche: ['M6 20V9a3 3 0 0 1 3-3h9', 'm15 3 3 3-3 3', 'M6 14h5a3 3 0 0 0 3-3'],
}

/** Ein Zeichen als SVG. Unbekannt oder leer → das neutrale Blatt. */
export function icon(name, klasse = 'icon') {
  const pfade = ICONS[name] || ICONS.blatt
  return `<svg class="${klasse}" viewBox="0 0 24 24" aria-hidden="true">${pfade
    .map((d) => `<path d="${d}"/>`)
    .join('')}</svg>`
}
