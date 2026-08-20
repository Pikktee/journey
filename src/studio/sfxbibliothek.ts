// Kuratierte Musik- und Effektbibliothek: ein fester Satz, den wir EINMAL über
// ElevenLabs erzeugen (scripts/gen-music-library.mjs für die Musik,
// scripts/gen-sfx-library.mjs für Atmosphären und Effekte) und statisch unter
// public/audio/sfx/ ausliefern. Anders als hochgeladene Tour-Audios sind diese
// GLOBAL — jede Tour kann sie auswählen, ohne eine Datei mitzubringen.
// (Eigene Dateien bleiben daneben jederzeit möglich: „Datei hochladen …".)
//
// Diese Datei ist die Autorität für Anzeige und Dateinamen; die Prompts zum
// Erzeugen liegen in den Skripten. Ein Drift-Wächter
// (test/studio-baukasten.test.ts) hält die Dateinamen-Menge beider Seiten
// synchron.

/** Wie ein Effekt abgespielt wird — deckt sich mit AudioEintrag.typ. */
export type SfxTyp = 'music' | 'sfx'

export interface SfxEffekt {
  /** Dateiname unter public/audio/sfx/ — zugleich die Overlay-Referenz (audio.file). */
  file: string
  /** Anzeigename im Studio-Katalog. */
  name: string
  /**
   * 'music' = komponiertes Stück (Loop über eine Spanne, typ 'music'),
   * 'umgebung' = Dauer-Atmosphäre (ebenfalls Loop, typ 'music'),
   * 'effekt' = punktueller One-Shot (typ 'sfx').
   */
  kategorie: 'music' | 'umgebung' | 'effekt'
  type: SfxTyp
  /** Ein Satz zum Charakter — Tooltip im Studio. */
  beschreibung: string
}

// Musik: zehn Stücke für die Stimmungen, die auf einer Reise vorkommen. Sie
// laufen über eine Spanne und schleifen — deshalb typ 'music' wie die
// Atmosphären, aber eine eigene Kategorie: eine Komposition ist etwas anderes
// als der Klang eines Ortes.
const MUSIK: SfxEffekt[] = [
  {
    file: 'mus-aufbruch.mp3',
    name: 'Aufbruch',
    kategorie: 'music',
    type: 'music',
    beschreibung: 'Hoffnungsvoller Folk zum Losfahren, Gitarre, Shaker, Glockenspiel',
  },
  {
    file: 'mus-fernweh.mp3',
    name: 'Fernweh',
    kategorie: 'music',
    type: 'music',
    beschreibung: 'Weit und sehnsüchtig: Klavier über langsamen Streichern',
  },
  {
    file: 'mus-kuestenstrasse.mp3',
    name: 'Küstenstraße',
    kategorie: 'music',
    type: 'music',
    beschreibung: 'Sonnige Fahrt am Meer, Surfgitarre, lockeres Schlagzeug',
  },
  {
    file: 'mus-nachtfahrt.mp3',
    name: 'Nachtfahrt',
    kategorie: 'music',
    type: 'music',
    beschreibung: 'Pulsierender Synthwave durchs Dunkel',
  },
  {
    file: 'mus-bergpass.mp3',
    name: 'Bergpass',
    kategorie: 'music',
    type: 'music',
    beschreibung: 'Weite Streicher und Hörner in dünner Höhenluft',
  },
  {
    file: 'mus-tropen.mp3',
    name: 'Tropen',
    kategorie: 'music',
    type: 'music',
    beschreibung: 'Marimba, Nylongitarre, warme Perkussion',
  },
  {
    file: 'mus-stadtpuls.mp3',
    name: 'Stadtpuls',
    kategorie: 'music',
    type: 'music',
    beschreibung: 'Trockener Groove, Funkgitarre, tiefer Bass',
  },
  {
    file: 'mus-goldene-stunde.mp3',
    name: 'Goldene Stunde',
    kategorie: 'music',
    type: 'music',
    beschreibung: 'Glühende Gitarrenflächen, fast ohne Takt',
  },
  {
    file: 'mus-regentag.mp3',
    name: 'Regentag',
    kategorie: 'music',
    type: 'music',
    beschreibung: 'Stilles Klavier, sparsam gesetzt',
  },
  {
    file: 'mus-heimkehr.mp3',
    name: 'Heimkehr',
    kategorie: 'music',
    type: 'music',
    beschreibung: 'Ruhig auflösend, Gitarre und Klavier zum Ankommen',
  },
]

// Umgebungs-Atmosphären: nahtlose Loops, laufen über einen Streckenbereich.
const UMGEBUNG: SfxEffekt[] = [
  {
    file: 'amb-hafen.mp3',
    name: 'Hafen',
    kategorie: 'umgebung',
    type: 'music',
    beschreibung: 'Möwen, Wellen an der Kaimauer, ferne Boote',
  },
  {
    file: 'amb-wald.mp3',
    name: 'Wald',
    kategorie: 'umgebung',
    type: 'music',
    beschreibung: 'Vogelgezwitscher und Blätterrauschen',
  },
  {
    file: 'amb-stadt.mp3',
    name: 'Stadt',
    kategorie: 'umgebung',
    type: 'music',
    beschreibung: 'Belebte Straße: ferner Verkehr, Schritte, Stimmen',
  },
  {
    file: 'amb-markt.mp3',
    name: 'Markt',
    kategorie: 'umgebung',
    type: 'music',
    beschreibung: 'Stimmengewirr, Rufe, geschäftiges Treiben',
  },
  {
    file: 'amb-brandung.mp3',
    name: 'Strand',
    kategorie: 'umgebung',
    type: 'music',
    beschreibung: 'Sanfte Meeresbrandung, auslaufende Wellen',
  },
  {
    file: 'amb-grillen.mp3',
    name: 'Tropennacht',
    kategorie: 'umgebung',
    type: 'music',
    beschreibung: 'Grillen und Zikaden in warmer Nacht',
  },
  {
    file: 'amb-bach.mp3',
    name: 'Bach',
    kategorie: 'umgebung',
    type: 'music',
    beschreibung: 'Plätscherndes Wasser über Steine',
  },
  {
    file: 'amb-bergwind.mp3',
    name: 'Bergwind',
    kategorie: 'umgebung',
    type: 'music',
    beschreibung: 'Sanfter Wind in der Höhe, ferne Kuhglocken',
  },
  {
    file: 'amb-fahrtwind.mp3',
    name: 'Fahrtwind',
    kategorie: 'umgebung',
    type: 'music',
    beschreibung: 'Luftrauschen der schnellen Vorwärtsfahrt',
  },
  {
    file: 'amb-seewind.mp3',
    name: 'Seewind',
    kategorie: 'umgebung',
    type: 'music',
    beschreibung: 'Frischer Wind über offenem Wasser',
  },
]

// Punktuelle Effekte: feuern einmal beim Überfahren ihrer Marke.
const EFFEKT: SfxEffekt[] = [
  {
    file: 'sfx-tempelglocke.mp3',
    name: 'Tempelglocke',
    kategorie: 'effekt',
    type: 'sfx',
    beschreibung: 'Einzelner Schlag einer asiatischen Tempelglocke',
  },
  {
    file: 'sfx-kirchenglocke.mp3',
    name: 'Kirchenglocke',
    kategorie: 'effekt',
    type: 'sfx',
    beschreibung: 'Läuten einer Kirchenglocke',
  },
  {
    file: 'sfx-moewe.mp3',
    name: 'Möwe',
    kategorie: 'effekt',
    type: 'sfx',
    beschreibung: 'Einzelner Möwenschrei',
  },
  {
    file: 'sfx-schiffshorn.mp3',
    name: 'Schiffshorn',
    kategorie: 'effekt',
    type: 'sfx',
    beschreibung: 'Tiefes Horn eines auslaufenden Schiffs',
  },
  {
    file: 'sfx-hupe.mp3',
    name: 'Hupe',
    kategorie: 'effekt',
    type: 'sfx',
    beschreibung: 'Kurze Autohupe',
  },
  {
    file: 'sfx-hund.mp3',
    name: 'Hund',
    kategorie: 'effekt',
    type: 'sfx',
    beschreibung: 'Bellender Hund',
  },
  {
    file: 'sfx-applaus.mp3',
    name: 'Applaus',
    kategorie: 'effekt',
    type: 'sfx',
    beschreibung: 'Kurzer Jubel und Applaus',
  },
  {
    file: 'sfx-kamera.mp3',
    name: 'Kamera',
    kategorie: 'effekt',
    type: 'sfx',
    beschreibung: 'Auslöser einer Spiegelreflexkamera',
  },
]

export const SFX_BIBLIOTHEK: readonly SfxEffekt[] = [...MUSIK, ...UMGEBUNG, ...EFFEKT]

/** Überschriften der Gruppen im Katalog — Reihenfolge wie in SFX_BIBLIOTHEK. */
export const KATEGORIE_NAMEN: Record<SfxEffekt['kategorie'], string> = {
  music: 'Musik',
  umgebung: 'Atmosphäre',
  effekt: 'Effekte',
}

/** Menge der Bibliotheks-Dateinamen — für die Validierung (Server/Player-Referenz). */
export const SFX_DATEIEN: ReadonlySet<string> = new Set(SFX_BIBLIOTHEK.map((e) => e.file))

/** Katalog-Eintrag zu einem Dateinamen (für Anzeige eines gesetzten Bibliothekseffekts). */
export function sfxEffekt(file: string): SfxEffekt | undefined {
  return SFX_BIBLIOTHEK.find((e) => e.file === file)
}
